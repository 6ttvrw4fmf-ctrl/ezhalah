"""curl_cffi session w/ realistic browser fingerprint + polite throttling.

We use curl_cffi (NOT vanilla requests) because Saudi real-estate sites — especially
Bayut and Property Finder behind Cloudflare — fingerprint TLS handshakes. curl_cffi
impersonates Chrome's TLS, which gets us past most basic anti-bot checks without
needing a real browser. We only reach for Playwright when even that fails.

`session()` returns a session pinned to a recent Chrome.
`get(url)` calls it with automatic retry/backoff and a polite per-host throttle.
"""
from __future__ import annotations

import os
import random
import threading
import time
from typing import Optional
from urllib.parse import urlsplit

from curl_cffi import requests as cc


# Polite throttle: request STARTS are spaced at least MIN_INTERVAL seconds apart PER HOST. Unlike
# the old "sleep 2s after each request" model, this only spaces the *starts*, so many workers can
# have requests in flight at once — that's what lets the concurrent scraper run ~6–8× faster while
# still not bursting the host. Override with SCRAPE_MIN_INTERVAL (e.g. 0.5 to be gentler, 0.2 to
# push harder). Default 0.3s ≈ ~3 request-starts/sec.
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))
_last_hit: dict[str, float] = {}
_throttle_lock = threading.Lock()


# Statuses that mean "the server had a moment", not "this page is gone". Retrying these is the
# whole point of get(); anything else 4xx/5xx is permanent and bails immediately.
#
# THE CLOUDFLARE 52x FAMILY WAS MISSING UNTIL 2026-08-26, and it cost a full day of a platform.
# ramzalqasim.com sits behind Cloudflare and its origin flaps: probing /maps from two unrelated
# networks returned 200,200 / 200,522 / 200,200. On 2026-08-26 the daily run drew a 522 on page 1
# of the walk and gave up on the spot — no scrape_runs row, no listings refreshed, the whole
# platform skipped for the day. A re-dispatch reproduced it exactly (Actions run 32940436435:
# "page 1 HTTP 522" -> exit 1, 48 seconds).
#
# These are Cloudflare edge-to-origin errors — the edge is fine, it just could not reach or wait
# for the origin — which is exactly the transient shape 502/503/504 already covered:
#   520 unknown origin error   521 origin down          522 origin connection timed out
#   523 origin unreachable     524 origin timed out      530 origin DNS failure (paired w/ 1016)
#
# 530 is included deliberately even though a LONG 530 outage (erapulse, down since 2026-08-25)
# will still fail after the retries — retrying costs seconds and cannot manufacture a false
# success, and a brief DNS blip is as recoverable as any other. A genuine outage still ends in
# None, so the caller's fail-safe behaviour is unchanged.
TRANSIENT_STATUSES = frozenset({429, 502, 503, 504, 520, 521, 522, 523, 524, 530})


def _throttle(url: str) -> None:
    host = urlsplit(url).netloc
    # Reserve the next time-slot under a lock so concurrent threads never collide on the same host.
    with _throttle_lock:
        now = time.monotonic()
        target = max(now, _last_hit.get(host, 0.0) + MIN_INTERVAL)
        _last_hit[host] = target
    sleep_for = target - time.monotonic()
    if sleep_for > 0:
        time.sleep(sleep_for + random.uniform(0.0, 0.08))  # tiny jitter


# Each worker thread gets its OWN curl_cffi session — sessions aren't guaranteed thread-safe, so a
# shared one would corrupt under concurrency. Thread-local keeps each warm + isolated.
_local = threading.local()


def _build_session(profile: str = "chrome124", proxies: Optional[dict] = None) -> cc.Session:
    s = cc.Session(impersonate=profile, proxies=proxies)   # impersonate OWNS the User-Agent
    s.headers.update(
        {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "no-cache",
        }
    )
    return s


def session() -> cc.Session:
    s = getattr(_local, "session", None)
    if s is None:
        s = _build_session()
        # When the URL we're about to fetch is wasalt.sa, route through the Saudi residential proxy
        # so the cloud workflows don't get blocked. Liveness uses this `get(url)` helper for every
        # check, so without this the cloud liveness for wasalt_*_listings would see every page as
        # "dead" and wrongly mark live listings inactive. Aqar URLs ignore the proxy (no env var).
        _local.session = s
    return s


# ── TLS-fingerprint negotiation ───────────────────────────────────────────────────────────────────
# Some hosts block SPECIFIC Chrome fingerprints while serving others. Measured on ialqarawi.com
# 2026-09-23: chrome116/120/124 each drew an identical 75,193-byte «403 - Forbidden», while
# chrome (the alias for curl_cffi's newest build), safari17_0, safari15_5, firefox133 and edge101
# all returned the full 1,143,328-byte catalogue from the SAME IP. So a 403 here is the handshake,
# not the address and not a dead site — and pinning one profile is a time bomb, because the alias
# moves with the installed curl_cffi version (0.15.0 locally vs whatever CI resolves).
# The scraper asks for a profile the host actually serves, and says so loudly when none is.
IMPERSONATE_ORDER = ("chrome", "safari17_0", "firefox133", "edge101", "safari15_5")


def negotiated_session(probe_url: str, *, order: tuple[str, ...] = IMPERSONATE_ORDER,
                       headers: Optional[dict] = None, timeout: int = 40,
                       served=lambda r: r.status_code == 200,
                       proxies: Optional[dict] = None) -> cc.Session:
    """A session whose TLS fingerprint this host actually answers, chosen by probing it once.

    The chosen profile is recorded on the session as `_impersonate_profile` so a run can log it.
    Raises RuntimeError naming every profile tried when the host serves none — that message is the
    difference between "they blocked our handshake" and "the site is gone".
    """
    last = ""
    for prof in order:
        # proxies= (2026-09-24): a host walled through the residential proxy answers a DIFFERENT profile
        # than it does directly (sakani: chrome → 403 page, safari17_0 → 200), so the probe must ride
        # the same route the run will use.
        s = cc.Session(impersonate=prof, proxies=proxies)   # impersonate OWNS the User-Agent — never set one here
        if headers:
            s.headers.update(headers)
        try:
            r = s.get(probe_url, timeout=timeout)
        except Exception as e:             # noqa: BLE001 — any transport error → try the next one
            last = f"{prof}:{type(e).__name__}"
            continue
        if served(r):
            s.__dict__["_impersonate_profile"] = prof
            return s
        last = f"{prof}:HTTP {r.status_code}"
    raise RuntimeError(f"no TLS profile was served by {probe_url} (tried {', '.join(order)}; last {last})")


RETRY_SMARTER_ORDER = ("chrome124", "safari17_0", "firefox133")


def retry_smarter_session(probe_url: str, *, headers: Optional[dict] = None, timeout: int = 40,
                          order: tuple[str, ...] = RETRY_SMARTER_ORDER,
                          proxy_env: str = "WASALT_PROXY_URL") -> tuple[cc.Session, list[str]]:
    """Probe `probe_url` with every profile in `order` DIRECT, then — when `proxy_env` is set —
    every profile again through that residential proxy, each with a fresh session. Returns the
    first session the host answers 200, plus one `route/profile:outcome` line per attempt.

    Unlike negotiated_session() this NEVER raises: when nothing is served it returns a plain
    `order[0]` DIRECT session so the caller's own fetch fails exactly as it did before and its
    existing failure path (prune guard, end_run ok=False) is untouched. The attempt log is the
    point — "down at source" needs 2+ profiles AND the proxy on record (SCRAPING_ENGINEER.md
    step 6), and a scraper pinned to one profile with no proxy could never produce that evidence.
    """
    purl = os.environ.get(proxy_env, "").strip()
    routes: list[tuple[str, Optional[dict]]] = [("direct", None)]
    if purl:
        routes.append(("proxy", {"http": purl, "https": purl}))
    tried: list[str] = []
    answered: Optional[cc.Session] = None
    for route, proxies in routes:
        for prof in order:
            s = cc.Session(impersonate=prof, proxies=proxies)   # impersonate OWNS the User-Agent
            if headers:
                s.headers.update(headers)
            try:
                r = s.get(probe_url, timeout=timeout)
            except Exception as e:             # noqa: BLE001 — recorded, then the next one
                tried.append(f"{route}/{prof}:{type(e).__name__}")
                continue
            tried.append(f"{route}/{prof}:{r.status_code}")
            if r.status_code == 200:
                s.__dict__["_impersonate_profile"] = f"{route}/{prof}"
                return s, tried
            if answered is None:
                s.__dict__["_impersonate_profile"] = f"{route}/{prof}"
                answered = s
    # 2026-10-06 (Scraping Engineer): hasaad's probe URL answered 404 through the proxy after every
    # DIRECT connect timed out, and the old code then handed back a fresh DIRECT session — so every
    # later fetch (the sitemap indexes, the list-page fallback) timed out on the one route already
    # proven dead. A route that ANSWERED (any HTTP status) reaches the host; the probe URL alone was
    # missing. Hand that session back; only when nothing answered at all is the plain DIRECT one used.
    if answered is not None:
        return answered, tried
    s = cc.Session(impersonate=order[0])
    if headers:
        s.headers.update(headers)
    return s, tried


def _rotate_session() -> cc.Session:
    """Force a fresh TCP connection for this thread by discarding the cached session and
    building a new one. 2026-08-21 incident fix: the OLD code reused ONE session/connection
    across every retry attempt of get(), so through the shared DataImpulse Saudi-residential proxy
    (see session()'s wasalt.sa note) a retry after a failed attempt was guaranteed to hang on the
    exact same bad route again. Called between retries so a fresh attempt gets a real chance at a
    different route (mirrors the same fix in scrapers/wasalt/run.py's RotatingSession)."""
    s = _build_session()
    _local.session = s
    return s


def get(url: str, *, max_retries: int = 3, timeout: int = 25,
        keep: tuple[int, ...] = ()) -> Optional[cc.Response]:
    """Polite, retry-on-soft-fail GET. Returns the Response on 2xx, None on permanent failure.
    Routes wasalt.sa requests through WASALT_PROXY_URL when set (cloud liveness needs this).

    `keep`: statuses returned as a Response instead of None. A liveness sweep passes (404, 410):
    for it a 404 is the ANSWER ("gone"), not a failure, and collapsing it to None made it read as
    "no answer" — aqar's sweep could never strike on a 404 (2026-09-28)."""
    s = session()
    # Per-request proxy: wasalt.sa from cloud needs the Saudi residential proxy or every page
    # comes back as "blocked" and liveness would wrongly strike every Wasalt listing. Aqar URLs
    # pass proxies=None and use the cloud IP directly.
    proxies = None
    if "wasalt.sa" in url or "wasalt.com" in url:
        # PROVIDER OF RECORD: DataImpulse (gw.dataimpulse.com), a METERED Saudi-residential pool,
        # in place since 2026-07-09 15:38 (see migration 20260727154828, which attributes the
        # first 10 GB quota overrun to it). The repo previously said "Webshare" in nine places
        # because the provider was swapped by editing the GitHub secret alone, with no code or
        # doc change -- corrected 2026-08-26. Three separate investigations into the wasalt
        # failure rate reasoned about the wrong vendor's behaviour because of that drift.
        # The VALUE lives only in the WASALT_PROXY_URL secret and must never be written here.
        purl = os.environ.get("WASALT_PROXY_URL", "").strip()
        if purl:
            proxies = {"http": purl, "https": purl}
    host = urlsplit(url).netloc
    pinned = None if proxies is not None else _host_route.get(host)
    if pinned is not None:
        s = _route_session(*pinned)
    blocked = None    # the reason the default route looks BLOCKED (401/403 or refused), if it does
    for attempt in range(max_retries):
        _throttle(url)
        try:
            r = s.get(url, timeout=timeout, allow_redirects=True, proxies=proxies)
        except Exception as e:
            print(f"   ⚠ http.get attempt {attempt + 1}/{max_retries} for {host} raised "
                  f"{type(e).__name__}: {str(e)[:160]}")
            blocked = type(e).__name__
            if attempt < max_retries - 1:
                s = _route_session(*pinned, fresh=True) if pinned else _rotate_session()
            time.sleep(2 * (attempt + 1))
            continue
        if r.status_code == 200:
            _escape_failures.pop(host, None)
            return r
        if r.status_code in BLOCK_STATUSES:
            blocked = f"HTTP {r.status_code}"
            break
        if r.status_code in TRANSIENT_STATUSES:
            # Server-side temporary hiccup — back off, rotate the connection, and retry.
            print(f"   ⚠ http.get attempt {attempt + 1}/{max_retries} for {host} got "
                  f"HTTP {r.status_code}")
            if attempt < max_retries - 1:
                s = _rotate_session()
            time.sleep(3 * (attempt + 1))
            continue
        if r.status_code in keep:
            return r
        # 4xx (other than rate-limit) is permanent — bail out.
        return None
    if blocked is not None and proxies is None:
        return _escape_block(url, host, blocked, timeout=timeout, current=pinned)
    return None


# ── Retry smarter on a BLOCK (2026-09-28, Scraping Engineer) ──────────────────────────────────────
# aqar-sweep run 36360844470: all 95 city shards fetched 0 pages in ~5s each, and the commercial
# sweep 10 minutes later died the same way, after weeks of ~13.6k rows per run. get() gave up on
# the first 403 with no log line, pinned to ONE fingerprint (chrome124) on ONE route, so the crawl
# could neither get past a handshake block nor say what the host answered. A block is usually the
# handshake, not a ban (SCRAPING_ENGINEER.md step 5a): on 401/403 or a refused connection, try the
# other browser profiles DIRECT, then — only when the workflow opts in with SCRAPE_PROXY_FALLBACK_URL
# — every profile through the residential proxy. The first route that answers 200 is pinned for that
# host for the rest of the process, so the escape costs a few requests once, not per page. When no
# route works for EXHAUST_AFTER escapes in a row (any 200 resets the count, so one page that is
# genuinely 403 on a healthy host cannot end the run) the host is marked exhausted and later calls
# fail fast exactly as before (None), so a real ban cannot become a probe storm or a proxy bill. A 404/410 is never escaped: a
# page that is gone stays gone. The metered proxy is never used unless the workflow set the var.
BLOCK_STATUSES = frozenset({401, 403})
FALLBACK_PROFILES = ("chrome124", "safari17_0", "firefox133", "edge101")
_host_route: dict[str, tuple[str, bool]] = {}      # host -> (profile, via_proxy) that answered 200
_host_exhausted: set[str] = set()
_escape_failures: dict[str, int] = {}
EXHAUST_AFTER = 3
_escape_locks: dict[str, threading.Lock] = {}
_escape_locks_guard = threading.Lock()


def _proxy_fallback() -> Optional[dict]:
    purl = os.environ.get("SCRAPE_PROXY_FALLBACK_URL", "").strip()
    return {"http": purl, "https": purl} if purl else None


def _route_session(profile: str, via_proxy: bool, *, fresh: bool = False) -> cc.Session:
    routes = _local.__dict__.setdefault("routes", {})
    s = None if fresh else routes.get((profile, via_proxy))
    if s is None:
        s = _build_session(profile, _proxy_fallback() if via_proxy else None)
        routes[(profile, via_proxy)] = s
    return s


def _escape_block(url: str, host: str, reason: str, *, timeout: int,
                  current: Optional[tuple[str, bool]]) -> Optional[cc.Response]:
    with _escape_locks_guard:
        lock = _escape_locks.setdefault(host, threading.Lock())
    with lock:   # one thread probes per host; the others then reuse its verdict
        if host in _host_exhausted:
            return None
        route = _host_route.get(host)
        if route is not None and route != current:
            # Another thread already found a working route while we waited — use it.
            return _fetch_on(route, url, timeout)
        tried = [f"{'proxy' if current and current[1] else 'direct'}/"
                 f"{current[0] if current else 'chrome124'}:{reason}"]
        legs = [(p, False) for p in FALLBACK_PROFILES]
        if _proxy_fallback() is not None:
            legs += [(p, True) for p in FALLBACK_PROFILES]
        for leg in legs:
            if leg == (current or ("chrome124", False)):
                continue
            _throttle(url)
            try:
                r = _route_session(*leg, fresh=True).get(url, timeout=timeout, allow_redirects=True)
            except Exception as e:             # noqa: BLE001 — recorded, then the next leg
                tried.append(f"{'proxy' if leg[1] else 'direct'}/{leg[0]}:{type(e).__name__}")
                continue
            tried.append(f"{'proxy' if leg[1] else 'direct'}/{leg[0]}:{r.status_code}")
            if r.status_code == 200:
                _escape_failures.pop(host, None)
                _host_route[host] = leg
                print(f"   ↻ http.get {host} blocked, escaped via {tried[-1]} "
                      f"(tried {', '.join(tried)}) — pinned for this run", flush=True)
                return r
        _escape_failures[host] = _escape_failures.get(host, 0) + 1
        final = _escape_failures[host] >= EXHAUST_AFTER
        if final:
            _host_exhausted.add(host)
            _host_route.pop(host, None)
        print(f"   ✗ http.get {host} BLOCKED on every route (tried {', '.join(tried)}"
              f"{'' if _proxy_fallback() else '; proxy fallback not enabled'})"
              + (f" — {EXHAUST_AFTER} in a row, failing fast for the rest of this run" if final else ""),
              flush=True)
        return None


def _fetch_on(route: tuple[str, bool], url: str, timeout: int) -> Optional[cc.Response]:
    _throttle(url)
    try:
        r = _route_session(*route).get(url, timeout=timeout, allow_redirects=True)
    except Exception:                          # noqa: BLE001
        return None
    return r if r.status_code == 200 else None
