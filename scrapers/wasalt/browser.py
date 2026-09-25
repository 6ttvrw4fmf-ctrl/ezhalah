"""Cloudflare-capable page fetcher for wasalt.sa — a real Chromium, because nothing else works.

WHY THIS EXISTS. wasalt.sa tightened Cloudflare bot protection on 2026-08-17. GitHub issue #1019
([RESOLVED DIAGNOSIS], 2026-08-24) proved the proxy is healthy — DNS, TCP, CONNECT and TLS all
succeed in under a second and it exits in Jeddah — and that the failure is an interaction between
the proxy's ASN and curl_cffi's chrome124 TLS fingerprint: that one combination is silently
null-routed, while the other three request shapes reach the origin and get a real 403 challenge
page. The conclusion there was that no proxy swap and no concurrency tweak can fix it, because the
challenge requires executing JavaScript, and it recommended a real browser. Owner chose that
option on 2026-09-18.

MEASURED, 2026-09-18, before any of this was written:

    headless Chromium          -> HTTP 403, challenge never clears (waited 24s)
    HEADED Chromium + flags    -> HTTP 200 in 4.7s, 910KB, __NEXT_DATA__ present,
                                  searchResult.properties == 32 real listings

So HEADLESS IS NOT OPTIONAL TO GET RIGHT — it is the difference between working and not. Cloudflare
detects headless Chromium regardless of user-agent. On a CI runner with no display that means the
process must be wrapped in xvfb; `headless=False` under xvfb is a real browser as far as Cloudflare
is concerned, `headless=True` is not.

The direct (no-proxy) fetch is what was measured working. That is deliberate: if it holds from the
runner too, wasalt stops consuming metered proxy bandwidth entirely. WASALT_PROXY_URL is still
honoured if set, so the proxy can be put back without a code change should the runner's IP be
treated differently from a laptop's.

BANDWIDTH. A browser would otherwise pull images, fonts and media that this scraper never reads —
it only wants the __NEXT_DATA__ JSON. Those request types are aborted at the route layer, which is
both a cost control and a speed one.
"""
from __future__ import annotations

import json
import os
import random
import re
from collections import Counter
from typing import Any, Optional

_NEXT_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)

# FAILURE CLASSIFICATION, persisted (2026-09-19, after a daily-engineer run misread a blended 24h
# average and called a since-recovered Cloudflare-bypass rollout "proxy bandwidth exhaustion").
# run.py's fail-visibly guard already turns a 0-row run into "FETCHED 0 ROWS — proxy/network
# block", but that label was written for the OLD http path and is a guess for this one: a browser
# attempt can fail for launch reasons, a Cloudflare challenge that never clears, a navigation
# exception (often the proxy/TLS interaction the module docstring documents), or an unclassified
# empty shell — four different root causes that all look identical from scrape_runs alone. Every
# `_page_once` failure was already being PRINTED with exactly this detail and nothing else read it
# — the same gap dealapp's `_record_status_200_no_schema` closed for its own fetch path (see
# scrapers/dealapp/run.py). Bucket names and counts only, never page content (PDPL, same rule).
_fail_reasons: Counter = Counter()


def _record_failure(reason: str) -> None:
    _fail_reasons[reason] += 1


def fail_reasons_summary(limit: int = 6, max_len: int = 200) -> str:
    """The failure tally rendered for `scrape_runs.notes`. Empty string when nothing failed."""
    if not _fail_reasons:
        return ""
    total = sum(_fail_reasons.values())
    items = _fail_reasons.most_common(limit)
    parts = ",".join(f"{k}={v}" for k, v in items)
    return f" browser_fail_total={total} browser_fail={parts}"[:max_len]

# Everything the page needs to EXECUTE (document/script/xhr/fetch) is allowed; everything that is
# merely rendered is not. The challenge is JS, so scripts must never be blocked.
_BLOCKED_RESOURCE_TYPES = {"image", "media", "font", "stylesheet"}

# FAIL FAST, TRY MORE EXITS. Measured 2026-09-18 with sticky sessions on: 9 of 20 slices succeed,
# and every failure is net::ERR_TIMED_OUT — roughly half the sticky exits simply cannot reach
# wasalt.sa. A good exit connects in a few seconds, so a 90s wait bought nothing and just spent the
# budget: 3 attempts x 90s = one slow failure. At ~50% per attempt the arithmetic is
# 1-(0.5^n): 3 tries = 88%, 6 tries = 98%. Short timeout + more attempts beats a long timeout.
_NAV_TIMEOUT_MS = int(os.environ.get("WASALT_BROWSER_NAV_TIMEOUT_MS", "60000"))
_CHALLENGE_WAIT_MS = int(os.environ.get("WASALT_BROWSER_CHALLENGE_WAIT_MS", "5000"))
_CHALLENGE_ROUNDS = int(os.environ.get("WASALT_BROWSER_CHALLENGE_ROUNDS", "6"))
# A residential proxy rotates exits, and a dead exit shows up as ERR_TIMED_OUT. The http path has
# always had a retry ladder with s.rotate() between attempts; the browser path shipped without one
# and its first real run came back 2 slices OK / 4 timed out. Same ladder, same reason.
_ATTEMPTS = int(os.environ.get("WASALT_BROWSER_ATTEMPTS", "4"))
_BACKOFF_S = float(os.environ.get("WASALT_BROWSER_BACKOFF_S", "1.5"))

# DataImpulse sticky-session ports. 823 is the ROTATING gateway (a new exit per connection); any
# port in the sticky range pins one exit for the session. Values match the plan shown on the
# dashboard 2026-09-18 ("Sticky range 10000 - 20000").
_ROTATING_PORT = int(os.environ.get("WASALT_PROXY_ROTATING_PORT", "823"))
_STICKY_LO = int(os.environ.get("WASALT_PROXY_STICKY_LO", "10000"))
_STICKY_HI = int(os.environ.get("WASALT_PROXY_STICKY_HI", "20000"))
_STICKY = os.environ.get("WASALT_BROWSER_STICKY", "1").strip().lower() not in ("0", "false", "no")


_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def browser_enabled() -> bool:
    return os.environ.get("WASALT_BROWSER", "").strip().lower() not in ("", "0", "false", "no")


def _playwright_proxy(purl: str) -> Optional[dict]:
    """Split a user:pass@host:port proxy URL into Playwright's separate-fields shape.

    Every other client in this repo takes credentials inline — curl_cffi, requests and httpx all
    accept `http://user:pass@host:port` — but Chromium does NOT. Handing it an inline-credential
    URL as `server` fails with net::ERR_INVALID_AUTH_CREDENTIALS, which reads like a Cloudflare
    rejection and is not one (cost a CI round on 2026-09-18). Playwright wants
    {"server": "http://host:port", "username": ..., "password": ...}.

    Credentials are never logged: callers print `server` only.
    """
    purl = (purl or "").strip()
    if not purl:
        return None
    from urllib.parse import urlsplit, unquote
    u = urlsplit(purl if "://" in purl else f"http://{purl}")
    host = u.hostname or ""
    if not host:
        return None
    port = u.port
    # STICKY SESSION. A browser issues many sub-requests per page (document, scripts, XHR). On the
    # ROTATING gateway port each of those lands on a DIFFERENT exit IP, so Cloudflare sees one
    # session hopping between addresses mid-page and drops it — which is exactly the
    # net::ERR_TIMED_OUT this scraper hit on 15 of 20 slices even with a retry ladder. DataImpulse
    # exposes sticky sessions as a port range (10000-20000 on this plan, per the dashboard): one
    # port == one stable exit for the life of the session, which is what a real browser looks like.
    #
    # A curl-style single-request fetch does not care, which is why the http path never needed this.
    if _STICKY and port == _ROTATING_PORT:
        port = random.randint(_STICKY_LO, _STICKY_HI)
    server = f"{u.scheme or 'http'}://{host}" + (f":{port}" if port else "")
    out: dict[str, str] = {"server": server}
    if u.username:
        out["username"] = unquote(u.username)
    if u.password:
        out["password"] = unquote(u.password)
    return out

class BrowserFetcher:
    """One Chromium for the whole run. Launching per page would dominate the wall clock."""

    def __init__(self) -> None:
        self._pw = None
        self._browser = None
        self._ctx = None

    def _ensure(self) -> None:
        if self._ctx is not None:
            return
        from playwright.sync_api import sync_playwright  # imported lazily: only this path needs it
        # START THE DRIVER ONCE PER PROCESS. _recycle() drops the browser and context to get a new
        # proxy exit, but must NOT drop the driver: a second sync_playwright().start() in the same
        # thread fails with "Playwright Sync API inside the asyncio loop" — the first driver's loop
        # is still running. That error is what a recycle used to produce, so the browser never
        # launched at all and the whole slice returned no __NEXT_DATA__. Measured across three CI
        # runs: the more the code recycled, the worse it got (9/20 -> 6/20 -> 3/20 slices).
        if self._pw is None:
            self._pw = sync_playwright().start()
        args = [
            # Without this, navigator.webdriver and the CDP surface give the automation away and
            # Cloudflare serves the challenge forever.
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",                    # required in the CI container
            "--disable-dev-shm-usage",         # /dev/shm is tiny on runners; without this Chromium crashes
            # THROUGH A RESIDENTIAL PROXY, FORCE HTTP/1.1. Measured 2026-09-18: with proxy auth
            # correct, every navigation still died at net::ERR_TIMED_OUT — the same silent
            # null-route issue #1019 saw for (proxy x chrome-shaped traffic). A browser negotiates
            # HTTP/2 and QUIC by default and many residential proxies terminate or mangle both,
            # which surfaces exactly as a connect timeout rather than an error. curl_cffi's
            # successful shapes were HTTP/1.1, so this makes the browser match them.
            "--disable-http2",
            "--disable-quic",
            # SHRINK THE TLS ClientHello. Measured 2026-09-18 by wasalt-proxy-diagnostic.yml:
            # through the Saudi residential proxy the CONNECT tunnel opens fine (HTTP/1.1 200 OK in
            # 757ms) and then the TLS HANDSHAKE times out at 15s — but only for Chrome-shaped
            # clients. curl_cffi with chrome124 impersonation times out identically, while the SAME
            # proxy with a plain non-impersonated curl completes TLS and returns a real response in
            # 1.7s. The exit itself is healthy (Riyadh, Zain 5G, AS43766).
            # Chrome 124+ offers a post-quantum key share by default, which pushes the ClientHello
            # past one MTU; mobile-carrier middleboxes routinely drop the fragmented record, and a
            # dropped ClientHello presents as a hang, not an error — i.e. net::ERR_TIMED_OUT.
            # Disabling it restores a single-segment ClientHello. Unknown feature names are ignored
            # by Chromium, so naming all three spellings is safe across versions.
            "--disable-features=PostQuantumKyber,TLS13KyberSupport,X25519MLKEM768",
        ]
        # headless=False is LOAD-BEARING (see module docstring). Under xvfb on CI this is still a
        # real browser; flipping it to True is the single change that breaks this module.
        self._browser = self._pw.chromium.launch(headless=False, args=args)
        ctx_kwargs: dict[str, Any] = {
            "locale": "en-US",
            "viewport": {"width": 1366, "height": 900},
            "user_agent": _UA,
        }
        proxy = _playwright_proxy(os.environ.get("WASALT_PROXY_URL", ""))
        if proxy:
            ctx_kwargs["proxy"] = proxy
        self._ctx = self._browser.new_context(**ctx_kwargs)
        self._ctx.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});")
        self._ctx.route("**/*", self._route)

    @staticmethod
    def _route(route, request) -> None:
        if request.resource_type in _BLOCKED_RESOURCE_TYPES:
            route.abort()
        else:
            route.continue_()

    def _next_data_once(self, url: str) -> Optional[dict]:
        """One attempt. See next_data() for the retry ladder."""
        data, _status, _n = self._page_once(url)
        return data

    def _page_once(self, url: str) -> tuple[Optional[dict], Optional[int], int]:
        """One attempt, reporting (parsed __NEXT_DATA__, HTTP status, bytes).

        The status is NOT redundant with the payload. wasalt answers a dead listing with a REAL
        HTTP 404 whose body still carries a perfectly parseable __NEXT_DATA__ (`page: "/404"`,
        propertyDetailsV3 null) — measured 2026-09-19: dead 404/211KB, alive 200/326KB. A liveness
        verdict needs to tell that apart from a challenge shell, and only the status does it."""
        try:
            self._ensure()
        except Exception as e:
            # A browser that never launched is a DIFFERENT failure from a challenge that never
            # cleared, and the caller only sees None for both. Say which, or the next person
            # debugging this is back to guessing (the first CI run of this module hit exactly that).
            print(f"   ⚠ wasalt browser LAUNCH failed: {type(e).__name__}: {str(e)[:300]}")
            _record_failure("launch_failed")
            return None, None, 0
        page = self._ctx.new_page()
        status = None
        html = ""
        try:
            resp = page.goto(url, wait_until="domcontentloaded", timeout=_NAV_TIMEOUT_MS)
            status = resp.status if resp is not None else None
            for _ in range(_CHALLENGE_ROUNDS):
                html = page.content()
                if "__NEXT_DATA__" in html:
                    break
                # Cloudflare's interstitial solves itself once the JS has run; give it time rather
                # than retrying the navigation, which restarts the challenge.
                page.wait_for_timeout(_CHALLENGE_WAIT_MS)
            m = _NEXT_RE.search(html)
            if not m:
                challenged = ("Just a moment" in html) or ("_cf_chl_opt" in html)
                print(f"   ⚠ wasalt browser: no __NEXT_DATA__ (http={status} "
                      f"challenge={'YES' if challenged else 'no'} html={len(html)}B)")
                _record_failure("challenge_shell" if challenged else "no_next_data_unclassified")
                return None, status, len(html)
            return json.loads(m.group(1)), status, len(html)
        except Exception as e:
            print(f"   ⚠ wasalt browser NAV failed (http={status}): "
                  f"{type(e).__name__}: {str(e)[:300]}")
            _record_failure(f"nav_exception:{type(e).__name__}")
            return None, status, len(html)
        finally:
            try:
                page.close()
            except Exception:
                pass

    def _recycle(self) -> None:
        """Tear the context down so the next attempt gets a NEW proxy exit.

        The residential pool hands out a different exit per connection, so recreating the context
        is the browser equivalent of the http path's s.rotate() — retrying on the same dead exit
        would just spend the ladder for nothing.
        """
        for obj, meth in ((self._ctx, "close"), (self._browser, "close")):
            if obj is not None:
                try:
                    getattr(obj, meth)()
                except Exception:
                    pass
        self._ctx = self._browser = None

    def next_data(self, url: str) -> Optional[dict]:
        """Return the page's parsed __NEXT_DATA__, or None if no attempt produced one.

        None means "no parseable answer" — the caller must treat that as INVALID, never as an
        empty result set. That distinction is the whole point of fetch_page()'s `valid` flag: a
        challenge shell and a genuinely empty category must not look alike.
        """
        import time as _t
        for attempt in range(_ATTEMPTS):
            data = self._next_data_once(url)
            if data is not None:
                return data
            if attempt < _ATTEMPTS - 1:
                print(f"   ↻ wasalt browser retry {attempt + 2}/{_ATTEMPTS} on a fresh proxy exit")
                self._recycle()
                _t.sleep(_BACKOFF_S * (attempt + 1))
        return None

    def page_data(self, url: str) -> tuple[Optional[dict], Optional[int], int]:
        """next_data() plus the HTTP status and byte count, over the SAME retry ladder.

        `(None, …)` keeps next_data()'s meaning — no parseable answer, which the caller must treat
        as UNKNOWN and never as a verdict about the listing. A returned dict WITH a 404 status is
        a different thing entirely: the source answered, and it said the listing is gone.
        """
        import time as _t
        last: tuple[Optional[dict], Optional[int], int] = (None, None, 0)
        for attempt in range(_ATTEMPTS):
            data, status, nbytes = self._page_once(url)
            if data is not None:
                return data, status, nbytes
            last = (None, status, nbytes)
            # A REAL 404 with no parseable body is still the source answering. Retrying it on a
            # fresh exit only spends the ladder to be told the same thing.
            if status in (404, 410):
                return last
            if attempt < _ATTEMPTS - 1:
                print(f"   ↻ wasalt browser retry {attempt + 2}/{_ATTEMPTS} on a fresh proxy exit")
                self._recycle()
                _t.sleep(_BACKOFF_S * (attempt + 1))
        return last

    def close(self) -> None:
        for obj, meth in ((self._ctx, "close"), (self._browser, "close"), (self._pw, "stop")):
            if obj is not None:
                try:
                    getattr(obj, meth)()
                except Exception:
                    pass
        self._ctx = self._browser = self._pw = None


# ── HARD PER-CALL DEADLINE (ops_incident #708, 2026-09-25) ─────────────────────────────────────────
# page.goto() honours _NAV_TIMEOUT_MS, but new_page(), page.content() and page.close() take no
# timeout at all: a wedged renderer or a dead driver pipe blocks the calling thread forever, and with
# one browser on one thread that is the whole job. A watchdog THREAD cannot rescue it — Playwright's
# sync driver is bound to the thread that started it (see liveness._pmap) — so the browser runs in a
# forked child process and the parent waits on a pipe with a deadline. On expiry the child is
# SIGKILLed (the Playwright driver sees its stdin close and tears Chromium down), the call returns
# "no parseable answer" — which every caller already maps to UNKNOWN, never dead — and the next call
# forks a fresh browser.
_UNBOUNDED_SLACK_S = 30.0   # per attempt: launch + new_page + content + close, none of them bounded


def ladder_budget_s() -> float:
    """Worst case for one page_data() whose Playwright calls all return: the whole retry ladder."""
    per_attempt = _NAV_TIMEOUT_MS / 1000 + _CHALLENGE_ROUNDS * _CHALLENGE_WAIT_MS / 1000 + _UNBOUNDED_SLACK_S
    backoff = sum(_BACKOFF_S * (a + 1) for a in range(_ATTEMPTS - 1))
    return _ATTEMPTS * per_attempt + backoff


def hard_deadline_s() -> float:
    """Derived from the ladder so raising _ATTEMPTS or a timeout can never make the deadline cut a
    healthy-but-slow check short; only a genuinely stuck call ever reaches it."""
    override = float(os.environ.get("WASALT_BROWSER_HARD_DEADLINE_S", "0") or 0)
    return override if override > 0 else ladder_budget_s() + 60.0


_NO_ANSWER: tuple[Optional[dict], Optional[int], int] = (None, None, 0)


def _take_fail_reasons() -> dict:
    out = dict(_fail_reasons)
    _fail_reasons.clear()
    return out


def _bounded_child(conn, factory) -> None:
    # The failure tally is what run.py persists to scrape_runs.notes; it is counted here, in the
    # child, so each reply carries the new counts back and the parent's tally stays complete.
    _fail_reasons.clear()
    fetcher = factory() if factory is not None else BrowserFetcher()
    try:
        while True:
            try:
                url = conn.recv()
            except EOFError:
                return
            if url is None:
                return
            method, url = url
            try:
                out = getattr(fetcher, method)(url)
                conn.send(("ok", out, _take_fail_reasons()))
            except Exception as e:
                conn.send(("error", f"{type(e).__name__}: {str(e)[:300]}", _take_fail_reasons()))
    finally:
        try:
            fetcher.close()
        except Exception:
            pass


class BoundedBrowserFetcher:
    """BrowserFetcher.page_data() with a hard wall-clock deadline per call. Same contract:
    (parsed __NEXT_DATA__ | None, status, nbytes); a timeout, a crash or an exception is (None, None, 0)."""

    def __init__(self, factory=None, deadline_s: Optional[float] = None) -> None:
        self._factory = factory
        self.deadline_s = deadline_s if deadline_s is not None else hard_deadline_s()
        self._proc = None
        self._conn = None
        self.deadline_kills = 0
        self.child_failures = 0

    def _start(self) -> None:
        import multiprocessing as mp
        import sys
        sys.stdout.flush()
        sys.stderr.flush()
        # fork, not spawn: the parent never starts Playwright itself (only children do), so there is
        # no driver loop to duplicate, and the child inherits the environment and any test doubles.
        ctx = mp.get_context("fork")
        parent_conn, child_conn = ctx.Pipe()
        proc = ctx.Process(target=_bounded_child, args=(child_conn, self._factory), daemon=True)
        proc.start()
        child_conn.close()
        self._proc, self._conn = proc, parent_conn

    def _discard(self) -> None:
        proc, conn = self._proc, self._conn
        self._proc = self._conn = None
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        if proc is not None:
            try:
                if proc.is_alive():
                    proc.kill()
                proc.join(10)
            except Exception:
                pass

    def page_data(self, url: str) -> tuple[Optional[dict], Optional[int], int]:
        return self._call("page_data", url, _NO_ANSWER)

    def next_data(self, url: str) -> Optional[dict]:
        return self._call("next_data", url, None)

    def _call(self, method: str, url: str, no_answer):
        if self._proc is None or not self._proc.is_alive():
            self._discard()
            self._start()
        try:
            self._conn.send((method, url))
            if not self._conn.poll(self.deadline_s):
                self.deadline_kills += 1
                print(f"   ⏱ wasalt browser: no answer within {self.deadline_s:.0f}s — killed the "
                      f"browser process, row counts as no answer (never dead)", flush=True)
                _record_failure("hard_deadline")
                self._discard()
                return no_answer
            kind, payload, child_fails = self._conn.recv()
            _fail_reasons.update(child_fails)
        except (EOFError, OSError) as e:
            self.child_failures += 1
            print(f"   ⚠ wasalt browser process died mid-call: {type(e).__name__}", flush=True)
            _record_failure("browser_process_died")
            self._discard()
            return no_answer
        if kind == "ok":
            return payload
        # A raise leaves the child's browser in an unknown state; a fresh one is cheaper than a
        # poisoned one failing every row after it.
        self.child_failures += 1
        print(f"   ⚠ wasalt browser raised: {payload}", flush=True)
        _record_failure("page_data_raised")
        self._discard()
        return no_answer

    def close(self) -> None:
        if self._proc is not None and self._conn is not None:
            try:
                self._conn.send(None)
                self._proc.join(30)
            except Exception:
                pass
        self._discard()
