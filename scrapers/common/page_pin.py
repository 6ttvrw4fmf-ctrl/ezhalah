"""The source's OWN map pin, read off its ad page — through the one gate (source_pin.sa_pin).

Owner 2026-10-19: «fix the ones we don't get a pin — make sure every new listing gets the pin».
Six native-preview sites publish a pin on the ad page that no scraper read (sakan, abralosol,
nofodh, bossbih, aqalemhajer, reinvest). Each site prints it differently; this module knows the
shapes, each measured on a live ad that day:

  · JSON-LD  «"geo":{"@type":"GeoCoordinates","latitude":24.72,"longitude":46.74}»   (nofodh)
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

import re
from typing import Callable, Optional
from urllib.parse import unquote

from scrapers.common.source_pin import pin_dict

_NUM = r"(-?\d{1,2}\.\d{3,})"
_JSONLD_GEO = re.compile(r'"geo"\s*:\s*\{[^{}]*?"latitude"\s*:\s*"?' + _NUM + r'"?[^{}]*?"longitude"\s*:\s*"?' + _NUM + r'"?', re.S)
_MAPS_LINK = re.compile(
    r"(?:maps/place/|maps/search/|maps\?q=|[?&]q=|[?&]query=|[?&]ll=|maps/@|/@)" + _NUM + r"\s*(?:,|%2C)\s*" + _NUM)
_LATLNG_CTOR = re.compile(r"google\.maps\.LatLng\(\s*" + _NUM + r"\s*,\s*" + _NUM + r"\s*\)")
_EXACT_ON = re.compile(r"show_exact_location\s*=\s*true")
_SHORT_LINK = re.compile(r"https://(?:maps\.app\.goo\.gl|goo\.gl/maps)/[A-Za-z0-9_-]+")


def pin_from_html(text: Optional[str]) -> dict:
    """{"latitude","longitude"} from the page's own pin, else {}."""
    if not text:
        return {}
    m = _JSONLD_GEO.search(text)
    if m:
        return pin_dict(m.group(1), m.group(2))
    m = _MAPS_LINK.search(text)
    if m:
        return pin_dict(m.group(1), m.group(2))
    if _EXACT_ON.search(text):          # a marker without that flag may be the site's approximation
        m = _LATLNG_CTOR.search(text)
        if m:
            return pin_dict(m.group(1), m.group(2))
    return {}


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


def resolve_redirect(session, url: str, hops: int = 4) -> Optional[str]:
    """The URL a short link lands on. First by hand, hop by hop, so Maps itself is never loaded
    (measured 2026-10-19: goo.gl → maps.google.com?q=LAT,LNG on the first hop). If that reads
    nothing — a client that cannot do a manual hop, or a shape we do not know — let the client
    follow the redirects itself and read the final URL it reports (decoded, see _maps_url_in)."""
    cur, seen, hit = url, [], None
    try:
        for _ in range(hops):
            r = session.get(cur, allow_redirects=False, timeout=20)
            loc = r.headers.get("location") or r.headers.get("Location")
            seen.append(f"{r.status_code}→{(loc or '')[:90]}")
            if r.status_code in (301, 302, 303, 307, 308) and loc:
                cur = loc
                hit = _maps_url_in(cur)
                if hit:
                    break
                continue
            break
    except Exception as e:  # noqa: BLE001 — fall through to the client's own follow
        seen.append(f"manual hop raised {type(e).__name__}")
    if not hit:
        try:
            r = session.get(url, allow_redirects=True, timeout=30)
            final = str(getattr(r, "url", "") or "")
            seen.append(f"follow→{final[:90]}")
            hit = _maps_url_in(final)
        except Exception as e:  # noqa: BLE001
            seen.append(f"follow raised {type(e).__name__}")
    if _DEBUG_LEFT[0] > 0:
        _DEBUG_LEFT[0] -= 1
        print(f"   ⓘ short-link pin {url[:60]}: {' | '.join(seen)} → {'pin' if hit else 'none'}", flush=True)
    return hit
