"""curl_cffi session w/ realistic browser fingerprint + polite throttling.

We use curl_cffi (NOT vanilla requests) because Saudi real-estate sites — especially
Bayut and Property Finder behind Cloudflare — fingerprint TLS handshakes. curl_cffi
impersonates Chrome's TLS, which gets us past most basic anti-bot checks without
needing a real browser. We only reach for Playwright when even that fails.

`session()` returns a session pinned to a recent Chrome.
`get(url)` calls it with automatic retry/backoff and a polite per-host throttle.
`head(url)` does the same existence check WITHOUT downloading the body — for a lightweight liveness
sweep over many thousands of rows where full-page bandwidth would be prohibitive (owner 2026-07-06).
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


def session() -> cc.Session:
    s = getattr(_local, "session", None)
    if s is None:
        s = cc.Session(impersonate="chrome124")
        s.headers.update(
            {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
                "Accept-Encoding": "gzip, deflate, br",
                "Cache-Control": "no-cache",
            }
        )
        # When the URL we're about to fetch is wasalt.sa, route through the Saudi residential proxy
        # so the cloud workflows don't get blocked. Liveness uses this `get(url)` helper for every
        # check, so without this the cloud liveness for wasalt_*_listings would see every page as
        # "dead" and wrongly mark live listings inactive. Aqar URLs ignore the proxy (no env var).
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
    for attempt in range(max_retries):
        _throttle(url)
        try:
            r = s.get(url, timeout=timeout, allow_redirects=True, proxies=proxies)
        except Exception:
            time.sleep(2 * (attempt + 1))
            continue
        if r.status_code == 200:
            return r
        if r.status_code in (429, 502, 503, 504):
            # Server-side temporary hiccup — back off and retry.
            time.sleep(3 * (attempt + 1))
            continue
        # 4xx (other than rate-limit) is permanent — bail out.
        return None
    return None


def head(url: str, *, max_retries: int = 3, timeout: int = 20) -> Optional[cc.Response]:
    """Cheap existence check: HEAD only, no body ever downloaded (~a few hundred bytes vs a ~400KB
    full page). Same throttle, proxy-routing, and browser-TLS-impersonation as get() — reuses the
    identical session so it gets past the same Cloudflare bot-check get() already gets past in
    production (a bare, non-impersonated request to wasalt.sa was confirmed live 2026-07-06 to get
    an immediate Cloudflare challenge page — this MUST go through session()'s chrome124 impersonation
    + the Saudi proxy, never a plain HTTP client).

    Returns the Response on 200 or a definitive 404/410 (both are usable signals for the caller).
    Returns None on anything inconclusive (timeout, 5xx, 429, or a 403 challenge) — the caller must
    treat None as "leave the row untouched," exactly like get()'s callers already do. 403 is treated
    as retry-then-inconclusive here (not a hard permanent-fail like get() treats other 4xx) because
    Cloudflare's challenge response IS a 403 and we cannot yet tell that apart from a real block —
    when in doubt, never claim a listing is dead from an ambiguous signal."""
    s = session()
    proxies = None
    if "wasalt.sa" in url or "wasalt.com" in url:
        purl = os.environ.get("WASALT_PROXY_URL", "").strip()
        if purl:
            proxies = {"http": purl, "https": purl}
    for attempt in range(max_retries):
        _throttle(url)
        try:
            r = s.head(url, timeout=timeout, allow_redirects=True, proxies=proxies)
        except Exception:
            time.sleep(2 * (attempt + 1))
            continue
        if r.status_code == 200 or r.status_code in (404, 410):
            return r  # definitive either way — no retry needed
        if r.status_code in (429, 403, 502, 503, 504):
            # Rate-limit, Cloudflare challenge, or a server hiccup — all inconclusive. Back off and
            # retry; if every attempt comes back inconclusive, the caller gets None (untouched row).
            time.sleep(3 * (attempt + 1))
            continue
        # Any other status is unexpected/unverified behavior — never guess dead from it.
        return None
    return None
