"""curl_cffi session w/ realistic browser fingerprint + polite throttling.

We use curl_cffi (NOT vanilla requests) because Saudi real-estate sites — especially
Bayut and Property Finder behind Cloudflare — fingerprint TLS handshakes. curl_cffi
impersonates Chrome's TLS, which gets us past most basic anti-bot checks without
needing a real browser. We only reach for Playwright when even that fails.

`session()` returns a session pinned to a recent Chrome.
`get(url)` calls it with automatic retry/backoff and a polite per-host throttle.
"""
from __future__ import annotations

import random
import time
from typing import Optional
from urllib.parse import urlsplit

from curl_cffi import requests as cc


# Polite throttle: at most one request every MIN_INTERVAL seconds PER HOST. Avoids
# hammering any one site even when many scrapers run in parallel.
MIN_INTERVAL = 2.0  # seconds
_last_hit: dict[str, float] = {}


def _throttle(url: str) -> None:
    host = urlsplit(url).netloc
    now = time.monotonic()
    last = _last_hit.get(host, 0.0)
    wait = (last + MIN_INTERVAL) - now
    if wait > 0:
        time.sleep(wait + random.uniform(0.0, 0.4))  # small jitter
    _last_hit[host] = time.monotonic()


# Reuse a single curl_cffi session — keeps TLS state warm and is much faster.
_session: Optional[cc.Session] = None


def session() -> cc.Session:
    global _session
    if _session is None:
        _session = cc.Session(impersonate="chrome124")
        _session.headers.update(
            {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
                "Accept-Encoding": "gzip, deflate, br",
                "Cache-Control": "no-cache",
            }
        )
    return _session


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
