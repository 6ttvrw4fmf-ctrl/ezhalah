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
        _local.session = s
    return s


def get(url: str, *, max_retries: int = 3, timeout: int = 25) -> Optional[cc.Response]:
    """Polite, retry-on-soft-fail GET. Returns the Response on 2xx, None on permanent failure."""
    s = session()
    for attempt in range(max_retries):
        _throttle(url)
        try:
            r = s.get(url, timeout=timeout, allow_redirects=True)
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
