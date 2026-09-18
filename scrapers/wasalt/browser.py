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
import re
from typing import Any, Optional

_NEXT_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)

# Everything the page needs to EXECUTE (document/script/xhr/fetch) is allowed; everything that is
# merely rendered is not. The challenge is JS, so scripts must never be blocked.
_BLOCKED_RESOURCE_TYPES = {"image", "media", "font", "stylesheet"}

_NAV_TIMEOUT_MS = int(os.environ.get("WASALT_BROWSER_NAV_TIMEOUT_MS", "90000"))
_CHALLENGE_WAIT_MS = int(os.environ.get("WASALT_BROWSER_CHALLENGE_WAIT_MS", "5000"))
_CHALLENGE_ROUNDS = int(os.environ.get("WASALT_BROWSER_CHALLENGE_ROUNDS", "6"))

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
    server = f"{u.scheme or 'http'}://{host}" + (f":{u.port}" if u.port else "")
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
        self._pw = sync_playwright().start()
        args = [
            # Without this, navigator.webdriver and the CDP surface give the automation away and
            # Cloudflare serves the challenge forever.
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",                    # required in the CI container
            "--disable-dev-shm-usage",         # /dev/shm is tiny on runners; without this Chromium crashes
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

    def next_data(self, url: str) -> Optional[dict]:
        """Return the page's parsed __NEXT_DATA__, or None if the page never produced one.

        None means "no parseable answer" — the caller must treat that as INVALID, never as an
        empty result set. That distinction is the whole point of fetch_page()'s `valid` flag: a
        challenge shell and a genuinely empty category must not look alike.
        """
        try:
            self._ensure()
        except Exception as e:
            # A browser that never launched is a DIFFERENT failure from a challenge that never
            # cleared, and the caller only sees None for both. Say which, or the next person
            # debugging this is back to guessing (the first CI run of this module hit exactly that).
            print(f"   ⚠ wasalt browser LAUNCH failed: {type(e).__name__}: {str(e)[:300]}")
            return None
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
                return None
            return json.loads(m.group(1))
        except Exception as e:
            print(f"   ⚠ wasalt browser NAV failed (http={status}): "
                  f"{type(e).__name__}: {str(e)[:300]}")
            return None
        finally:
            try:
                page.close()
            except Exception:
                pass

    def close(self) -> None:
        for obj, meth in ((self._ctx, "close"), (self._browser, "close"), (self._pw, "stop")):
            if obj is not None:
                try:
                    getattr(obj, meth)()
                except Exception:
                    pass
        self._ctx = self._browser = self._pw = None
