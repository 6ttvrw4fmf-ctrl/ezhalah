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
from typing import Any, Optional

_NEXT_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)

# Everything the page needs to EXECUTE (document/script/xhr/fetch) is allowed; everything that is
# merely rendered is not. The challenge is JS, so scripts must never be blocked.
_BLOCKED_RESOURCE_TYPES = {"image", "media", "font", "stylesheet"}

# FAIL FAST, TRY MORE EXITS. Measured 2026-09-18 with sticky sessions on: 9 of 20 slices succeed,
# and every failure is net::ERR_TIMED_OUT — roughly half the sticky exits simply cannot reach
# wasalt.sa. A good exit connects in a few seconds, so a 90s wait bought nothing and just spent the
# budget: 3 attempts x 90s = one slow failure. At ~50% per attempt the arithmetic is
# 1-(0.5^n): 3 tries = 88%, 6 tries = 98%. Short timeout + more attempts beats a long timeout.
_NAV_TIMEOUT_MS = int(os.environ.get("WASALT_BROWSER_NAV_TIMEOUT_MS", "30000"))
_CHALLENGE_WAIT_MS = int(os.environ.get("WASALT_BROWSER_CHALLENGE_WAIT_MS", "5000"))
_CHALLENGE_ROUNDS = int(os.environ.get("WASALT_BROWSER_CHALLENGE_ROUNDS", "6"))
# A residential proxy rotates exits, and a dead exit shows up as ERR_TIMED_OUT. The http path has
# always had a retry ladder with s.rotate() between attempts; the browser path shipped without one
# and its first real run came back 2 slices OK / 4 timed out. Same ladder, same reason.
_ATTEMPTS = int(os.environ.get("WASALT_BROWSER_ATTEMPTS", "6"))
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

    def close(self) -> None:
        for obj, meth in ((self._ctx, "close"), (self._browser, "close"), (self._pw, "stop")):
            if obj is not None:
                try:
                    getattr(obj, meth)()
                except Exception:
                    pass
        self._ctx = self._browser = self._pw = None
