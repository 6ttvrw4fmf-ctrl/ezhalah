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


def _build_session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
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


def _rotate_session() -> cc.Session:
    """Force a fresh TCP connection for this thread by discarding the cached session and
    building a new one. 2026-08-21 incident fix: the OLD code reused ONE session/connection
    across every retry attempt of get(), so through the shared Webshare Saudi-residential proxy
    (see session()'s wasalt.sa note) a retry after a failed attempt was guaranteed to hang on the
    exact same bad route again. Called between retries so a fresh attempt gets a real chance at a
    different route (mirrors the same fix in scrapers/wasalt/run.py's RotatingSession)."""
    s = _build_session()
    _local.session = s
    return s


def get(url: str, *, max_retries: int = 3, timeout: int = 25) -> Optional[cc.Response]:
    """Polite, retry-on-soft-fail GET. Returns the Response on 2xx, None on permanent failure.
    Routes wasalt.sa requests through WASALT_PROXY_URL when set (cloud liveness needs this)."""
    s = session()
    # Per-request proxy: wasalt.sa from cloud needs the Saudi residential proxy or every page
    # comes back as "blocked" and liveness would wrongly strike every Wasalt listing. Aqar URLs
    # pass proxies=None and use the cloud IP directly.
    proxies = None
    if "wasalt.sa" in url or "wasalt.com" in url:
        purl = os.environ.get("WASALT_PROXY_URL", "").strip()
        if purl:
            proxies = {"http": purl, "https": purl}
    host = urlsplit(url).netloc
    for attempt in range(max_retries):
        _throttle(url)
        try:
            r = s.get(url, timeout=timeout, allow_redirects=True, proxies=proxies)
        except Exception as e:
            print(f"   ⚠ http.get attempt {attempt + 1}/{max_retries} for {host} raised "
                  f"{type(e).__name__}: {str(e)[:160]}")
            if attempt < max_retries - 1:
                s = _rotate_session()
            time.sleep(2 * (attempt + 1))
            continue
        if r.status_code == 200:
            return r
        if r.status_code in TRANSIENT_STATUSES:
            # Server-side temporary hiccup — back off, rotate the connection, and retry.
            print(f"   ⚠ http.get attempt {attempt + 1}/{max_retries} for {host} got "
                  f"HTTP {r.status_code}")
            if attempt < max_retries - 1:
                s = _rotate_session()
            time.sleep(3 * (attempt + 1))
            continue
        # 4xx (other than rate-limit) is permanent — bail out.
        return None
    return None
