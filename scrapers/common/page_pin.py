"""The source's OWN map pin, read off its ad page — through the one gate (source_pin.sa_pin).

Owner 2026-10-19: «fix the ones we don't get a pin — make sure every new listing gets the pin».
Six native-preview sites publish a pin on the ad page that no scraper read (sakan, abralosol,
nofodh, bossbih, aqalemhajer, reinvest). Each site prints it differently; this module knows the
shapes, each measured on a live ad that day:

  · a Maps frame «maps.google.com/maps?q=24.56,46.75&output=embed»  (nofodh — only the ads that have one;
    its JSON-LD "geo" is the company office on every page and is deliberately NOT read)
  · a Maps link with coordinates  «google.com/maps/place/25.45,49.60»  (abralosol, bossbih),
    «google.com/maps?q=24.81,46.63»  (reinvest's embed)
  · a Maps JS marker  «new google.maps.LatLng(21.62,39.16)»  (sakan — only when the page also
    says `show_exact_location = true`; otherwise the marker is the site's approximation)
  · a short link  «maps.app.goo.gl/…»  that 302s to a Maps URL carrying the pair  (aqalemhajer)

NEVER a default map centre: nofodh's page also prints `center: { lat: 24.79, lng: 46.70 }` for an
empty selector map, which is the same number on every ad. Only the four shapes above are read, in
that order, and a bare `lat:`/`lng:` pair is deliberately not one of them.

A pin outside Saudi Arabia, at 0,0 or not numeric is rejected by sa_pin(). Nothing is geocoded.
"""
from __future__ import annotations

import atexit
import os
import re
import time
from typing import Callable, Optional
from html import unescape
from urllib.parse import unquote

from scrapers.common.source_pin import pin_dict

_NUM = r"(-?\d{1,2}\.\d{3,})"
_JSONLD_GEO = re.compile(r'"geo"\s*:\s*\{[^{}]*?"latitude"\s*:\s*"?' + _NUM + r'"?[^{}]*?"longitude"\s*:\s*"?' + _NUM + r'"?', re.S)
_MAPS_LINK = re.compile(
    # «q= 24.49,43.97»: ialqarawi writes a space (or its %20 / «+») after «q=» on some ads (re-read 40074411510).
    r"(?:maps/place/|maps/search/|maps\?q=|[?&]q=|[?&]query=|[?&]ll=|maps/@|/@)(?:\s|%20|\+)*" + _NUM
    + r"\s*(?:,|%2C)\s*" + _NUM)
_LATLNG_CTOR = re.compile(r"google\.maps\.LatLng\(\s*" + _NUM + r"\s*,\s*" + _NUM + r"\s*\)")
_EXACT_ON = re.compile(r"show_exact_location\s*=\s*true")
_SHORT_LINK = re.compile(r"https://(?:maps\.app\.goo\.gl|goo\.gl/maps)/[A-Za-z0-9_-]+")
# A Maps place link written in degrees-minutes-seconds — «maps/place/25°26'36.7"N+49°34'20.7"E» (shomou,
# owner 2026-10-20 night). Read after HTML-unescape + URL-decode; only N/E halves are Saudi.
_DMS_LINK = re.compile(r"(?:maps/place/|[?&]q=)(\d{1,2})°(\d{1,2})'(\d{1,2}(?:\.\d+)?)\"([NS])[+\s]*"
                       r"(\d{1,3})°(\d{1,2})'(\d{1,2}(?:\.\d+)?)\"([EW])")
# …also inside an embed's «?q=» — «maps.google.com/maps?hl=ar&q=25°24'43.2"N+49°36'48.8"E&output=embed»
# (aljassim, owner 2026-10-20 night).
# A Google Maps embed's own centre — «maps/embed?pb=…!2dLNG!3dLAT…» (wadod). Not read by pin_from_html:
# on bossbih the embed is the OFFICE on every page; a scraper uses it only where it is measured per ad.
_EMBED_PB = re.compile(r"maps/embed\?pb=[^\"'<>\s]*?!2d(-?\d{1,3}\.\d{3,})!3d(-?\d{1,2}\.\d{3,})")


def pin_from_html(text: Optional[str]) -> dict:
    """{"latitude","longitude"} from the page's own pin, else {}."""
    if not text:
        return {}
    text = unescape(text)   # «maps/search/?api=1&amp;query=LAT,LNG» (opensooq) — the entity hides the «&query=» shape
    # A Maps link/frame carrying the pair is the ad's own pin. JSON-LD "geo" is NOT read any more:
    # on nofodh it is the Organization block (the company's office) printed on every page — 2,556
    # ads landed on one point before this was measured (owner caught it, 2026-10-19 night).
    m = _MAPS_LINK.search(text)
    if m:
        return pin_dict(m.group(1), m.group(2))
    d = _DMS_LINK.search(unquote(text))
    if d:
        la = int(d.group(1)) + int(d.group(2)) / 60 + float(d.group(3)) / 3600
        lo = int(d.group(5)) + int(d.group(6)) / 60 + float(d.group(7)) / 3600
        if d.group(4) == "N" and d.group(8) == "E":
            return pin_dict(round(la, 7), round(lo, 7))
    if _EXACT_ON.search(text):          # a marker without that flag may be the site's approximation
        m = _LATLNG_CTOR.search(text)
        if m:
            return pin_dict(m.group(1), m.group(2))
    return {}


def pin_from_embed(text: Optional[str]) -> dict:
    """The centre of the page's own Google Maps embed (`!2dLNG!3dLAT`), else {} — per-ad sites only."""
    m = _EMBED_PB.search(unescape(text or ""))
    return pin_dict(m.group(2), m.group(1)) if m else {}


_PAGE_SESSION: list = []


def pin_from_page(text: Optional[str]) -> dict:
    """A page's own pin by every safe shape: a Maps link/frame (pin_from_html), else a maps.app.goo.gl
    link followed through resolve_redirect (its headless-Chromium leg where the job installed it)."""
    pin = pin_from_html(text)
    if pin:
        return pin
    short = short_maps_link(text)
    if not short:
        return {}
    if not _PAGE_SESSION:
        try:
            from curl_cffi import requests as _cc
            _PAGE_SESSION.append(_cc.Session(impersonate="chrome124"))
        except Exception:  # noqa: BLE001
            import requests as _rq
            _PAGE_SESSION.append(_rq.Session())
    return pin_from_short_link(short, lambda u: resolve_redirect(_PAGE_SESSION[0], u))


def short_maps_link(text: Optional[str]) -> Optional[str]:
    m = _SHORT_LINK.search(text or "")
    return m.group(0) if m else None


def pin_from_short_link(url: Optional[str], resolve: Callable[[str], Optional[str]]) -> dict:
    """Follow a maps.app.goo.gl / goo.gl/maps link to the Maps URL it names and read the pair.
    `resolve(url)` returns the final URL (or None when the hop failed); the caller owns the session."""
    if not url:
        return {}
    try:
        final = resolve(url)
    except Exception:  # noqa: BLE001 — a failed hop is "no pin this fetch", never a crash
        return {}
    final = _maps_url_in(final)
    if not final:
        return {}
    m = _MAPS_LINK.search(final)
    return pin_dict(m.group(1), m.group(2)) if m else {}


_DEBUG_LEFT = [3]   # the first few resolutions of a run are printed, so a crawl log shows what Google answered


def _maps_url_in(candidate: Optional[str]) -> Optional[str]:
    """The candidate itself when it carries a pair — also after URL-decoding, because Google's
    consent interstitial for datacenter addresses hides the Maps URL inside `continue=…%3Fq%3D…`."""
    if not candidate:
        return None
    for form in (candidate, unquote(candidate), unquote(unquote(candidate))):
        if _MAPS_LINK.search(form):
            return form
    return None


def _maps_url_in_body(text: Optional[str]) -> Optional[str]:
    """A Maps URL carrying a pair inside a page BODY. Measured on the GitHub runner 2026-10-19:
    goo.gl answers a datacenter address with HTTP 200 and no Location at all — an interstitial
    page whose markup names the destination (a link, a form's continue=, a script). The body is
    HTML-unescaped and URL-decoded before the search; only a pair inside Saudi Arabia survives
    sa_pin() afterwards, so a stray number cannot become a pin."""
    if not text:
        return None
    body = text[:400_000]
    for form in (body, unescape(body), unquote(unescape(body))):
        m = _MAPS_LINK.search(form)
        if m:
            return form[max(0, m.start() - 60):m.end()]
    return None


def _hop_proxies() -> Optional[dict]:
    """Owner 2026-10-19 («ok use the proxy»): Google answers GitHub runners with a script page
    instead of the goo.gl redirect, so ONLY this hop goes through the Saudi residential proxy when
    the job has it (WASALT_PROXY_URL — a few KB per new ad). Site pages never use it from here."""
    purl = os.environ.get("WASALT_PROXY_URL", "").strip()
    return {"http": purl, "https": purl} if purl else None


_BROWSER: dict = {"pw": None, "browser": None, "ctx": None, "dead": False}


def _browser_hop_enabled() -> bool:
    """PIN_BROWSER_HOP=1 — set by small-sources-sync.yml only for the sources whose job installed
    Chromium (matrix.browser). Everywhere else the hop is the plain HTTP one above."""
    return os.environ.get("PIN_BROWSER_HOP", "").strip() == "1"


def _browser_close() -> None:
    for k in ("ctx", "browser"):
        try:
            if _BROWSER[k] is not None:
                _BROWSER[k].close()
        except Exception:  # noqa: BLE001
            pass
    try:
        if _BROWSER["pw"] is not None:
            _BROWSER["pw"].stop()
    except Exception:  # noqa: BLE001
        pass
    _BROWSER.update(pw=None, browser=None, ctx=None)


def _browser_hop(url: str, wait_s: float = 15.0) -> Optional[str]:
    """Owner 2026-10-20 («get the 3 small sites» — Playwright, not the proxy): a real headless
    Chromium opens the short link and we read the URL it lands on. Google answers a plain HTTP
    client on a datacenter address with a 200 script page (measured 2026-10-19), but a browser runs
    that script and ends on Maps — or on the consent page, whose `continue=` names the Maps URL
    (_maps_url_in decodes it). One browser per crawl, closed at exit; a browser that cannot launch
    turns the hop off for the rest of the run instead of failing every ad."""
    if _BROWSER["dead"]:
        return None
    try:
        if _BROWSER["ctx"] is None:
            from playwright.sync_api import sync_playwright  # installed only where the job needs it
            pw = sync_playwright().start()
            browser = pw.chromium.launch(headless=True)
            ctx = browser.new_context(locale="ar-SA", viewport={"width": 1280, "height": 800})
            _BROWSER.update(pw=pw, browser=browser, ctx=ctx)
            atexit.register(_browser_close)
    except Exception as e:  # noqa: BLE001
        _BROWSER["dead"] = True
        print(f"   ⓘ short-link browser hop unavailable: {type(e).__name__}: {str(e)[:120]}", flush=True)
        return None
    page = None
    try:
        page = _BROWSER["ctx"].new_page()
        page.goto(url, wait_until="commit", timeout=20_000)
        deadline = time.time() + wait_s
        while time.time() < deadline:
            hit = _maps_url_in(page.url)
            if hit:
                return hit
            page.wait_for_timeout(400)
        return _maps_url_in_body(page.content())   # a page that never redirected may name the destination
    except Exception as e:  # noqa: BLE001 — one ad's hop failing is "no pin this fetch"
        print(f"   ⓘ short-link browser hop {url[:60]}: {type(e).__name__}", flush=True)
        return None
    finally:
        try:
            if page is not None:
                page.close()
        except Exception:  # noqa: BLE001
            pass


def resolve_redirect(session, url: str, hops: int = 4) -> Optional[str]:
    """The URL a short link lands on. First by hand, hop by hop, so Maps itself is never loaded
    (measured 2026-10-19: goo.gl → maps.google.com?q=LAT,LNG on the first hop). If that reads
    nothing — a client that cannot do a manual hop, or a shape we do not know — let the client
    follow the redirects itself and read the final URL it reports (decoded, see _maps_url_in)."""
    cur, seen, hit = url, [], None
    proxies = _hop_proxies()
    if proxies:
        seen.append("via proxy")
    try:
        for _ in range(hops):
            r = session.get(cur, allow_redirects=False, timeout=20, proxies=proxies)
            loc = r.headers.get("location") or r.headers.get("Location")
            seen.append(f"{r.status_code}→{(loc or '')[:90]}")
            if r.status_code in (301, 302, 303, 307, 308) and loc:
                cur = loc
                hit = _maps_url_in(cur)
                if hit:
                    break
                continue
            body = getattr(r, "text", None) or ""
            hit = _maps_url_in_body(body)     # a 200 interstitial names the destination
            if hit:
                seen.append("pair in body")
            else:
                # Diagnostic for the crawl log: what did Google answer? (title + the first Maps/redirect hint)
                t = re.search(r"<title>(.{0,80})", body, re.S)
                g = re.search(r".{0,40}(?:google\.[a-z.]+/maps|http-equiv|window\.location|sorry|unusual traffic|consent)[^<]{0,120}", body, re.I)
                seen.append(f"body {len(body)}B title={t.group(1).strip() if t else chr(63)} hint={g.group(0).strip() if g else chr(45)}")
            break
    except Exception as e:  # noqa: BLE001 — fall through to the client's own follow
        seen.append(f"manual hop raised {type(e).__name__}")
    if not hit:
        try:
            r = session.get(url, allow_redirects=True, timeout=30, proxies=proxies)
            final = str(getattr(r, "url", "") or "")
            seen.append(f"follow→{final[:90]}")
            hit = _maps_url_in(final) or _maps_url_in_body(getattr(r, "text", None))
        except Exception as e:  # noqa: BLE001
            seen.append(f"follow raised {type(e).__name__}")
    if not hit and _browser_hop_enabled():
        hit = _browser_hop(url)
        seen.append(f"browser→{(hit or 'none')[:90]}")
    if _DEBUG_LEFT[0] > 0:
        _DEBUG_LEFT[0] -= 1
        print(f"   ⓘ short-link pin {url[:60]}: {' | '.join(seen)} → {'pin' if hit else 'none'}", flush=True)
    return hit
