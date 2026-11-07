"""The OWNER'S HONEST CLIENT for sources onboarded staged on 2026-11-05 (owner: «honest UA, ≤ 1 req/s, obey robots,
a CAPTCHA or challenge stops the run — never bypass it»). Same rule as scrapers/propertyfinder/crawl.py:
  * our own bot user-agent «Ezhalah-bot/1.0 (+https://ezhalah.com)», never a browser identity, no impersonation,
    no proxy, no fingerprint tricks (that is why these sites are OWNER_HONEST_CLIENT in the resilience ratchet);
  * request STARTS at least MIN_GAP_S apart (one process, one host at a time);
  * HTTP 401/403/429/503, or a page carrying a wall word (captcha / security check / cf-chl …) raises Blocked and
    the caller stops the whole run: nothing is pruned, nothing is retried around it;
  * the caller names the robots.txt rule it obeys (`allowed`): a URL it refuses is a programming error.
"""
from __future__ import annotations

import time
from typing import Any, Callable, Optional

from curl_cffi import requests as cc  # NO impersonate argument anywhere: an honest client

UA = "Ezhalah-bot/1.0 (+https://ezhalah.com)"
MIN_GAP_S = 1.1
WALL_WORDS = ("captcha", "security check", "attention required", "cf-chl", "access denied",
              "are you a robot", "verify you are human", "request blocked", "التحقق الأمني")


class Blocked(RuntimeError):
    """The site refused the honest bot (or served a wall). The run stops; nothing is pruned."""


_last = [0.0]


def request(method: str, url: str, *, allowed: Callable[[str], bool], json_body: Optional[dict] = None,
            verify: bool = True, accept: str = "*/*", sleep: Callable[[float], None] = time.sleep,
            session: Any = None) -> Any:
    """One polite request. Returns the response of a 200; raises Blocked on any wall or non-200."""
    if not allowed(url):
        raise ValueError(f"refusing a URL robots.txt or the owner rule does not allow: {url}")
    wait = MIN_GAP_S - (time.time() - _last[0])
    if wait > 0:
        sleep(wait)
    _last[0] = time.time()
    headers = {"User-Agent": UA, "Accept": accept, "Accept-Language": "ar"}
    r = (session or cc).request(method, url, headers=headers, json=json_body, timeout=45, verify=verify)
    low = (r.text or "")[:4000].lower()
    if r.status_code in (401, 403, 429, 503) or any(w in low for w in WALL_WORDS):
        raise Blocked(f"HTTP {r.status_code} wall at {url}: {(r.text or '')[:160]!r}")
    if r.status_code != 200:
        raise Blocked(f"HTTP {r.status_code} at {url} (not a 200 — stopping, never guessing)")
    return r


def get_text(url: str, **kw: Any) -> str:
    return request("GET", url, accept="text/html,application/xml;q=0.9,*/*;q=0.8", **kw).text


def get_json(url: str, **kw: Any) -> Any:
    return request("GET", url, accept="application/json", **kw).json()


def post_json(url: str, body: dict, **kw: Any) -> Any:
    return request("POST", url, json_body=body, accept="application/json", **kw).json()
