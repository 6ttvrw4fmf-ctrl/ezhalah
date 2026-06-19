"""Enrichment: fetch a single Aqar listing URL and return a normalized row.

Aqar embeds a structured JSON blob inside each page via the Next.js `__NEXT_DATA__`
script tag — same trick most Next.js sites use. Pulling that one blob is far more
reliable than parsing the rendered HTML (which changes every redesign).
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from scrapers.common.http import get
from scrapers.common import normalize as N


LISTING_ID_RE = re.compile(r"-(\d{6,})/?$")
NEXT_DATA_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.DOTALL)


def _extract_next_data(html: str) -> Optional[dict[str, Any]]:
    m = NEXT_DATA_RE.search(html)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None


def _find_listing_obj(d: Any) -> Optional[dict[str, Any]]:
    """Walk the Next data tree, return the first dict that looks like a listing
    (has both a price and an area/size field). Aqar nests this a few levels deep
    and the exact shape changes between page versions, so we sniff instead of pin.
    """
    if isinstance(d, dict):
        keys = set(d.keys())
        priceish = {"price", "rent", "amount"}
        areaish  = {"area", "size", "space", "meter", "m"}
        if any(k in keys for k in priceish) and any(any(a in str(k).lower() for a in areaish) for k in keys):
            return d
        for v in d.values():
            r = _find_listing_obj(v)
            if r is not None:
                return r
    elif isinstance(d, list):
        for v in d:
            r = _find_listing_obj(v)
            if r is not None:
                return r
    return None


def enrich(url: str) -> Optional[dict[str, Any]]:
    """Fetch a single Aqar listing URL and return a row ready for upsert_listing().
    Returns None if we couldn't fetch or parse.
    """
    r = get(url)
    if r is None:
        return None
    html = r.text

    nd = _extract_next_data(html)
    listing = _find_listing_obj(nd) if nd else None

    # Source id is always the trailing number in the URL — even if Next-data parsing fails.
    m = LISTING_ID_RE.search(url)
    if not m:
        return None
    source_id = m.group(1)

    # We try Next data first (richer + cleaner), then fall back to obvious HTML cues.
    price = None
    size_m2 = None
    bedrooms = None
    bathrooms = None
    district = None
    city_ar = None
    type_ar = None
    title = None
    description = None
    images: list[str] = []
    latitude = None
    longitude = None

    if listing:
        # Best-effort field hunts — Aqar's schema is loose, so accept a few aliases.
        for k in ("price", "rent", "amount"):
            v = listing.get(k)
            if v is not None:
                price = N.to_int(v)
                break
        for k in ("area", "size", "space", "meter"):
            v = listing.get(k)
            if v is not None:
                size_m2 = N.to_int(v)
                break
        for k in ("beds", "rooms", "bedrooms", "bedroom"):
            v = listing.get(k)
            if v is not None:
                bedrooms = N.to_int(v)
                break
        for k in ("baths", "bathrooms", "bathroom", "wc"):
            v = listing.get(k)
            if v is not None:
                bathrooms = N.to_int(v)
                break
        district  = listing.get("district") or listing.get("neighborhood") or None
        city_ar   = listing.get("city") or listing.get("region") or None
        type_ar   = listing.get("category") or listing.get("type") or None
        title     = listing.get("title") or None
        description = listing.get("content") or listing.get("description") or None
        latitude  = listing.get("lat") or listing.get("latitude")
        longitude = listing.get("lng") or listing.get("longitude")
        # Image arrays can live under "imgs" / "images" / "photos" — accept any.
        for k in ("imgs", "images", "photos"):
            v = listing.get(k)
            if isinstance(v, list) and v:
                images = [str(x) for x in v if isinstance(x, (str, dict))]
                break

    # HTML-level fallbacks. Aqar is an old-school server-rendered site (no JSON blob),
    # so these regexes are actually the PRIMARY path on most pages.
    if not images:
        images = list(dict.fromkeys(re.findall(r'https://images\.aqar\.fm[^"\'\s]+', html)))[:12]
    if not title:
        mt = re.search(r"<title>(.*?)</title>", html, re.DOTALL)
        title = mt.group(1).strip() if mt else None
    if size_m2 is None:
        ms = re.search(r"(\d{2,5})\s*(?:م2|م²|متر|m2|m²)", html)
        size_m2 = int(ms.group(1)) if ms else None

    # Price — Aqar prints rent like "69,000 §/سنوي" and sale like "1,200,000 §".
    # We capture the figure + the period so we can store an annual figure for rent rows.
    if price is None:
        # Annual / monthly / daily / weekly explicit
        period_word: Optional[str] = None
        for word, key in (("سنوي", "annual"), ("شهري", "monthly"), ("يومي", "daily"), ("أسبوعي", "weekly")):
            mp = re.search(rf"(\d[\d,]{{2,}})\s*[§ر﷼]?\s*/?\s*{word}", html)
            if mp:
                price = N.to_int(mp.group(1))
                period_word = key
                break
        # Generic SAR number (sale prices, or rent without an explicit period)
        if price is None:
            mp = re.search(r"(\d{1,3}(?:,\d{3}){1,3})\s*[§ر﷼]", html)
            if mp:
                price = N.to_int(mp.group(1))
        # Annualize if the page says monthly/etc.
        if period_word and price:
            price = N.annualize_rent(price, period_word)

    # Bedrooms — "غرف النوم 3" or "غرف النوم: 3"
    if bedrooms is None:
        mb = re.search(r"غرف\s*النوم[\s:]*?(\d+)", html)
        if mb:
            bedrooms = int(mb.group(1))

    # Bathrooms — "دورات المياه 3"
    if bathrooms is None:
        mbt = re.search(r"دورات\s*المياه[\s:]*?(\d+)", html)
        if mbt:
            bathrooms = int(mbt.group(1))

    # District — Aqar always prints "حي <name>" in the URL slug. Pull it from there.
    if not district:
        md = re.search(r"/(?:حي|الحي)-([^/]+?)/", url)
        if md:
            district = "حي " + md.group(1).replace("-", " ")

    # Living rooms — "غرفة المعيشة 1" / "صالة 1" (Aqar uses several variants).
    living_rooms: Optional[int] = None
    for label in (r"غرفة\s*المعيشة", r"المعيشة", r"صالة", r"صالات"):
        ml = re.search(rf"{label}[\s:]*?(\d+)", html)
        if ml:
            living_rooms = int(ml.group(1))
            break

    # Property age — "عمر العقار 10 سنة/سنوات" or just "10 سنوات".
    property_age_years: Optional[int] = None
    ma = re.search(r"عمر\s*العقار[\s:]*?(\d+)", html)
    if ma:
        property_age_years = int(ma.group(1))

    # Amenities — Aqar shows a short list (kitchen, AC, water, etc.). Pull the common ones.
    AMENITY_PATTERNS = [
        ("kitchen",     r"مطبخ"),
        ("ac",          r"مكيف"),
        ("water",       r"توفر\s*الماء"),
        ("electricity", r"توفر\s*الكهرباء"),
        ("sewage",      r"توفر\s*صرف\s*صحي|صرف\s*صحي"),
        ("pool",        r"مسبح"),
        ("elevator",    r"مصعد"),
        ("furnished",   r"مفروشة?"),
        ("parking",     r"موقف|مواقف|مرآب|كراج"),
        ("garden",      r"حديقة"),
        ("driver_room", r"غرفة\s*سائق"),
        ("maid_room",   r"غرفة\s*خادمة"),
    ]
    amenities: list[str] = []
    for key, pat in AMENITY_PATTERNS:
        if re.search(pat, html):
            amenities.append(key)

    # Payment terms / deposit — Aqar often prints "تأمين: 3,500 ريال" or "دفعة سنوية".
    payment_terms: Optional[str] = None
    mp_pay = re.search(r"(تأمين[^<\n]{0,80})", html)
    if mp_pay:
        payment_terms = re.sub(r"\s+", " ", mp_pay.group(1)).strip()[:200]

    # Human-readable posted/updated strings — useful even though they're not real timestamps.
    posted_at_text: Optional[str] = None
    updated_at_text: Optional[str] = None
    mpd = re.search(r"تاريخ\s*الإعلان[\s:]*([^\n<]{1,40})", html)
    if mpd:
        posted_at_text = mpd.group(1).strip()
    mud = re.search(r"آخر\s*تحديث[\s:]*([^\n<]{1,40})", html)
    if mud:
        updated_at_text = mud.group(1).strip()

    # Map raw Arabic categorical values onto the canonical English ones the app expects.
    type_eng = N.map_type(type_ar or "") or N.map_type(title or "")
    city_eng = N.map_city(city_ar or "") or N.map_city(title or "") or "Riyadh"
    if not type_eng:
        return None  # without a recognisable type the row is useless to the engine

    # Aqar lists rent annually by default (their UI sometimes shows monthly too — but
    # the price embedded in __NEXT_DATA__ for rent rows is annual).
    deal_eng = "Rent" if "للإيجار" in url or "rent" in url.lower() else "Buy"

    return {
        "source_platform": "aqar",
        "source_id": source_id,
        "source_url": url,
        "deal": deal_eng,
        "type": type_eng,
        "category": N.category_for_type(type_eng),
        "city": city_eng,
        "district": district,
        "price": price,
        "price_period": "annual" if deal_eng == "Rent" else "total",
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "living_rooms": living_rooms,
        "size_m2": size_m2,
        "property_age_years": property_age_years,
        "amenities": amenities,
        "payment_terms": payment_terms,
        "posted_at_text": posted_at_text,
        "updated_at_text": updated_at_text,
        "images": images,
        "title": title,
        "description": description,
        "latitude": latitude,
        "longitude": longitude,
        "posted_at": None,         # not reliably exposed; daily liveness will refresh
        "active": True,
        "raw_json": None,
    }
