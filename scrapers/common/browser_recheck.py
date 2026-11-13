"""The real-browser re-check every «site down» verdict must pass first (OWNER ORDER 2026-11-12, backlog 1828).

The owner, 06:41 UTC 11-12, on fahadalshahri: the site showed an automatic «Checking your browser before
accessing. Just a moment...» page (HTTP 403 first) that passed ON ITS OWN in a few seconds with no puzzle;
then the store API answered 200 with all 26 products. Our curl_cffi sessions cannot run that check, so they
read 403 and the site was paged P0 silent_scraper_death as if it had died.

So, before a 403/503 becomes a verdict, a REAL browser re-reads the URL:
  (a) the browser reads it         → our transport, not a dead site: the page is served from the browser
                                     and the host is pinned to it for the rest of the run;
  (b) the browser fails too        → the site is really failing: the caller's own failure path runs
                                     unchanged (and now has the browser's answer to print);
  (c) a CAPTCHA / puzzle / login   → STOP. Never solve or bypass it. The host is marked walled for the
                                     run and the line «CAPTCHA wall — owner decision» is logged.

Honest identity: the User-Agent says EzhalahBot with our address. Polite: ≤ 1 request a second per host,
the automatic check is waited up to WAIT_S seconds, images/fonts/media are never downloaded. The browser
is opened only after every curl_cffi route has already been refused, so a healthy site never pays for it.
Off switch: SCRAPE_BROWSER_RECHECK=0.
"""
from __future__ import annotations

import os
import re
import threading
import time
from typing import Any, Optional
from urllib.parse import urlsplit

HONEST_UA = "Mozilla/5.0 (compatible; EzhalahBot/1.0; +https://ezhalah.com)"
WAIT_S = 15.0
MIN_INTERVAL_S = 1.0

# An AUTOMATIC check: the page runs a script and lets the visitor in by itself.
CHALLENGE = re.compile(
    r"Checking your browser|Just a moment\.\.\.|cf-browser-verification|/cdn-cgi/challenge-platform|"
    r"DDoS protection by|Please wait while we (?:are )?check|Verifying you are human\. This may take",
    re.I)
# A wall a PERSON must answer. Never solved, never bypassed: the run stops for that host.
CAPTCHA = re.compile(
    r"cf-turnstile|g-recaptcha|recaptcha/api\.js|h-captcha|hcaptcha\.com|captcha-delivery|"
    r"Verify you are human by completing|<form[^>]+(?:login|signin)[^>]*>.*?type=[\"']password",
    re.I | re.S)


def enabled() -> bool:
    v = os.environ.get("SCRAPE_BROWSER_RECHECK", "").strip()
    if v:
        return v != "0"
    # Unit tests stub hosts that refuse on purpose; they must never launch a real Chromium. The tests
    # that cover this module switch it on explicitly (SCRAPE_BROWSER_RECHECK=1) with a stubbed page.
    return "PYTEST_CURRENT_TEST" not in os.environ


def classify(status: Optional[int], body: str) -> str:
    """'captcha' (a person must answer: stop), 'challenge' (an automatic check still showing),
    'ok' (a real 200 page), or 'failed' (anything else: the site really answered badly)."""
    body = body or ""
    head = body[:200_000]
    if CAPTCHA.search(head):
        return "captcha"
    if CHALLENGE.search(head):
        return "challenge"
    if status == 200:
        return "ok"
    return "failed"


class BrowserResponse:
    """The slice of a curl_cffi Response the scrapers read (status_code, text, content, headers, url, json())."""

    def __init__(self, url: str, status: int, text: str, headers: Optional[dict] = None):
        self.url = url
        self.status_code = status
        self.text = text
        self.content = text.encode("utf-8")
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}
        self.via = "browser"

    def json(self) -> Any:
        import json as _json
        return _json.loads(self.text)


_last_hit: dict[str, float] = {}
_hit_lock = threading.Lock()
_local = threading.local()          # Playwright's sync API is per thread: one browser per thread
walled_hosts: set[str] = set()      # hosts that showed a CAPTCHA this run: never asked again
log: list[str] = []                 # one line per re-check, for the run's notes / alert detail


def _pace(host: str) -> None:
    with _hit_lock:
        now = time.monotonic()
        slot = max(now, _last_hit.get(host, 0.0) + MIN_INTERVAL_S)
        _last_hit[host] = slot
    if slot > now:
        time.sleep(slot - now)


SKIPPED_TYPES = ("image", "font", "media", "stylesheet")


def _route(route) -> None:
    """Every request the browser makes: pictures, fonts, media and styles are never fetched; every
    other request (the page, its scripts, the automatic check, our fetch) waits for the same per-host
    ≤ 1 request/second slot (CodeRabbit #12157: pacing once per re-check let goto + fetch go together)."""
    req = route.request
    if req.resource_type in SKIPPED_TYPES:
        route.abort()
        return
    _pace(urlsplit(req.url).netloc)
    route.continue_()


def _context():
    ctx = getattr(_local, "ctx", None)
    if ctx is not None:
        return ctx
    from playwright.sync_api import sync_playwright   # imported only when a re-check is really needed
    pw = sync_playwright().start()
    try:
        browser = pw.chromium.launch(headless=os.environ.get("BROWSER_HEADED", "") != "1",
                                     executable_path=os.environ.get("BROWSER_EXECUTABLE") or None,
                                     args=["--no-sandbox", "--disable-dev-shm-usage"])
    except Exception:
        pw.stop()           # no Chromium on this runner: leave nothing running, the caller reads «unavailable»
        raise
    ctx = browser.new_context(user_agent=HONEST_UA, locale="ar-SA")
    ctx.route("**/*", _route)
    _local.pw, _local.browser, _local.ctx = pw, browser, ctx
    return ctx


FETCH_TIMEOUT_S = 30.0


def _page_fetch(url: str, wait_s: float) -> tuple[Optional[int], str, dict, str]:
    """(status, body, headers, verdict) read by a real browser. The origin is opened first so an
    automatic check can run and set its cookie; the URL itself is then read with that session."""
    parts = urlsplit(url)
    origin = f"{parts.scheme}://{parts.netloc}/"
    ctx = _context()
    page = ctx.new_page()
    try:
        page.goto(origin, wait_until="domcontentloaded", timeout=int(wait_s * 1000) + 15_000)
        deadline = time.monotonic() + wait_s
        verdict = classify(200, page.content())
        while verdict == "challenge" and time.monotonic() < deadline:
            page.wait_for_timeout(1000)
            verdict = classify(200, page.content())
        if verdict in ("captcha", "challenge"):
            return None, page.content(), {}, verdict
        # The abort covers the request AND the body read, so a response that never ends cannot hold the
        # host's escape lock past FETCH_TIMEOUT_S (CodeRabbit #12157); an aborted read raises → «unavailable».
        got = page.evaluate(
            """async ([u, ms]) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
                 try { const r = await fetch(u, {credentials: 'include', signal: c.signal});
                       const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
                       return {status: r.status, text: await r.text(), headers: h}; }
                 finally { clearTimeout(t); } }""", [url, int(FETCH_TIMEOUT_S * 1000)])
        status, body = int(got["status"]), got["text"] or ""
        return status, body, got.get("headers") or {}, classify(status, body)
    finally:
        try:
            page.close()
        except Exception:   # noqa: BLE001 — a page that failed to close must not mask the answer
            pass


def stop_on_captcha(url: str, status: Optional[int], body: str, *, via: str) -> bool:
    """True (and the host walled for the run) when an answer from ANY transport is a CAPTCHA. Every
    caller checks this before escaping to another route, so a person-only wall is never worked around."""
    host = urlsplit(url).netloc
    if host in walled_hosts:
        return True
    if classify(status, body) != "captcha":
        return False
    walled_hosts.add(host)
    line = f"browser re-check {host}: CAPTCHA/puzzle wall seen by {via} — STOP, never solved or bypassed; owner decision"
    log.append(line)
    print(f"   🧭 {line}", flush=True)
    return True


def is_walled(url: str) -> bool:
    return urlsplit(url).netloc in walled_hosts


def recheck(url: str, *, reason: str, wait_s: float = WAIT_S,
            keep: tuple[int, ...] = ()) -> tuple[Optional[BrowserResponse], str]:
    """Re-read `url` in a real browser after curl_cffi was refused (`reason`). Returns (response, verdict):
    a BrowserResponse for verdict 'ok', or for a plain (non-wall) answer whose status is in `keep` (a
    liveness sweep's 404/410 is its answer); None for 'captcha' / 'challenge' / 'failed' / 'unavailable'."""
    host = urlsplit(url).netloc
    if not enabled():
        return None, "disabled"
    if host in walled_hosts:
        return None, "captcha"
    _pace(host)
    try:
        status, body, headers, verdict = _page_fetch(url, wait_s)
    except Exception as e:   # noqa: BLE001 — no Chromium on this runner, a crash: the caller's path stands
        verdict, status, body, headers = "unavailable", None, "", {}
        detail = f"{type(e).__name__}: {str(e)[:120]}"
    else:
        detail = f"HTTP {status}" if status is not None else "no page"
    if verdict == "captcha":
        walled_hosts.add(host)
        line = (f"browser re-check {host}: CAPTCHA/puzzle wall after {reason} — STOP, never solved or "
                f"bypassed; owner decision")
    else:
        line = f"browser re-check {host}: {verdict} ({detail}) after {reason}"
    log.append(line)
    print(f"   🧭 {line}", flush=True)
    if verdict == "ok" and status == 200:
        return BrowserResponse(url, status, body, headers), verdict
    if verdict == "failed" and status in keep:
        return BrowserResponse(url, status, body, headers), verdict
    return None, verdict


def summary() -> str:
    """The run's browser re-check lines, for scrape_runs.notes (empty when none ran)."""
    return " | ".join(dict.fromkeys(log))[:600]
