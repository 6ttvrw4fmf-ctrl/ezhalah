"""Al Hoshan (alhoshan.sa) scraper — Saudi Next.js site, clean public JSON API.

Al Hoshan العقارية is a small Saudi real-estate company (boutique catalog ~24 active listings,
mostly Riyadh/Qassim). Saudi-owned + REGA-licensed → passes the Saudi-only rule. No auth, no proxy,
cloud-friendly (public API on the same domain).

API:
  POST https://www.alhoshan.sa/api/alhoshan/properties/search   body {page, limit<=20}
       → {success, data:{items:[…]} | [...], meta:{page,total,totalPages,hasNext}}
  GET  https://www.alhoshan.sa/api/alhoshan/properties/{id GUID}/media
       → {data:[{cdnUrl,…}…]}  the FULL gallery, in the site's own order
  (the list item IS the full record for FIELDS, but for images it carries only primaryImageUrl —
   the gallery hides behind /media, keyed by the internal `id` GUID; the {publicId} form 400s.)

Field map (Al Hoshan item → our schema):
  publicId                         → ad_number (AH{publicId}) + listing_url /properties/{publicId}
  purpose  sale|rentLong|rentShort → transaction_type Buy|Rent
  currentPrice|price               → price_total (Buy) | price_annual (Rent)
  specs.propertyType (slug)        → property_type (TYPE_MAP) + residential/commercial routing
  specs.city (Arabic)              → city (normalize.map_city → canonical)
  specs.district                   → neighborhood
  specs.area / bedrooms / bathrooms→ area_m2 / bedrooms / bathrooms
  advertisingLicenseNumber         → rega_location_verified
  id (GUID) → /media data[].cdnUrl → photo_urls (fallback primaryImageUrl; ~3 publish no photo)
  specs.{yearBuilt,direction,floors,parkingSpaces,features} → additional_info

Usage:  python -m scrapers.alhoshan.run [--limit-test] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db, normalize
from scrapers.common.arabic_location import to_catalog
from scrapers.common.source_pin import pin_dict
from scrapers.common.http import retry_smarter_session

# PDPL: never store these containers (advertiser / brokerage identity).
_PII = {"advertiser", "brokerageBadge", "brokerageContract"}

BASE = "https://www.alhoshan.sa"
SEARCH = f"{BASE}/api/alhoshan/properties/search"
# Full gallery per listing. Takes the internal `id` GUID from the list item — the {publicId}
# form returns 400 (verified live 2026-09-05).
MEDIA = BASE + "/api/alhoshan/properties/{guid}/media"
PAGE_SIZE = 20  # server caps pageSize at 20
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))

# Al Hoshan propertyType slug → our canonical taxonomy.
TYPE_MAP = {
    "villa": "Villa", "apartment": "Apartment", "floor": "Floor", "building": "Building",
    "duplex": "Duplex", "palace": "Villa", "room": "Room", "rest_house": "Rest House",
    "chalet": "Chalet", "farm": "Farm", "land_residential": "Residential Land",
    "land": "Residential Land", "house": "House",
    # The site's own dictionary: townhouse «تاون هاوس» → Duplex (owner 2026-10-12: town house is
    # under Duplex; taxonomy Duplex rawTypes; normalize slug townhouse→Duplex). whole_floor «دور كامل» → Floor. AH1039 is filed
    # whole_floor while its office title says «فيلا دورين»: the structured field wins (the page's
    # own spec grid and SEO title say «دور كامل»); the title is kept verbatim on the card.
    "townhouse": "تاون هاوس", "whole_floor": "Floor",
    # commercial
    "office": "Office", "shop": "Shop", "showroom": "Showroom", "warehouse": "Warehouse",
    "land_commercial": "Commercial Land", "commercial_building": "Commercial Building",
    "workshop": "Workshop", "hotel": "Hotel", "station": "Gas Station", "factory": "Factory",
    "mixed_building": "Commercial Building", "commercial": "Commercial Building",
}
COMMERCIAL_TYPES = {
    "Office", "Shop", "Showroom", "Warehouse", "Commercial Land", "Commercial Building",
    "Workshop", "Hotel", "Gas Station", "Factory",
}
# specs.city often carries a REGION label ("منطقة القصيم") → canonical region for the hierarchy.
# Full 99-city → 13-region map (shared with the region-stamp tooling) so every city resolves.
CITY_TO_REGION = {
    "Riyadh": "Riyadh", "Al Kharj": "Riyadh", "Al Muzahimiyah": "Riyadh", "Diriyah": "Riyadh",
    "Al Majmaah": "Riyadh", "Thadiq": "Riyadh", "Shaqra": "Riyadh", "Al Quwayiyah": "Riyadh",
    "Al Zulfi": "Riyadh", "Dawadmi": "Riyadh", "Hawtat Bani Tamim": "Riyadh", "Rumah": "Riyadh",
    "Al Ghat": "Riyadh", "Al Dalam": "Riyadh", "Afif": "Riyadh", "As Sulayyil": "Riyadh",
    "Al Hariq": "Riyadh", "Al Ammariyah": "Riyadh", "Malham": "Riyadh", "Al Hayathim": "Riyadh",
    "Jeddah": "Makkah", "Mecca": "Makkah", "Taif": "Makkah", "Thuwal": "Makkah", "KAEC": "Makkah",
    "Al Qunfudhah": "Makkah", "Rabigh": "Makkah", "Al Jumum": "Makkah", "Al Lith": "Makkah",
    "Al Kamil": "Makkah", "Raniyah": "Makkah", "Turabah": "Makkah", "Al Khurma": "Makkah",
    "Medina": "Madinah", "Al Hanakiyah": "Madinah", "Yanbu": "Madinah", "Al Ula": "Madinah",
    "Mahd adh Dhahab": "Madinah", "Badr": "Madinah", "Khaybar": "Madinah",
    "Dammam": "Eastern Province", "Khobar": "Eastern Province", "Hofuf": "Eastern Province",
    "Dhahran": "Eastern Province", "Jubail": "Eastern Province", "Hafar Al Batin": "Eastern Province",
    "Abqaiq": "Eastern Province", "An Nairyah": "Eastern Province", "Safwa": "Eastern Province",
    "Qatif": "Eastern Province", "Sayhat": "Eastern Province", "Khafji": "Eastern Province",
    "Tarout": "Eastern Province", "Ras Tanura": "Eastern Province", "Anak": "Eastern Province",
    "Al Uyun": "Eastern Province",
    "Buraidah": "Qassim", "Unaizah": "Qassim", "Al Bukayriyah": "Qassim", "Riyadh Al Khabra": "Qassim",
    "Al Badai": "Qassim", "Ar Rass": "Qassim", "An Nabhaniyah": "Qassim", "Al Mithnab": "Qassim",
    "Ash Shamasiyah": "Qassim",
    "Khamis Mushait": "Asir", "Abha": "Asir", "Mahayel": "Asir", "Al Majardah": "Asir",
    "Bisha": "Asir", "Ahad Rafidah": "Asir", "Tathlith": "Asir", "Balsamar": "Asir", "Al Namas": "Asir",
    "Jazan": "Jazan", "Sabya": "Jazan", "Baysh": "Jazan", "Abu Arish": "Jazan",
    "Samtah": "Jazan", "Ahad Al Masarihah": "Jazan",
    "Hail": "Hail", "Baqaa": "Hail", "Al Ghazalah": "Hail", "Ash Shanan": "Hail",
    "Tabuk": "Tabuk", "Tayma": "Tabuk", "Duba": "Tabuk", "Al Wajh": "Tabuk", "Umluj": "Tabuk",
    "Arar": "Northern Borders", "Rafha": "Northern Borders", "Turaif": "Northern Borders",
    "Sakaka": "Al Jawf", "Dawmat Al Jandal": "Al Jawf", "Qurayyat": "Al Jawf",
    "Najran": "Najran", "Sharurah": "Najran", "Al Baha": "Al Bahah",
}
# Arabic region labels Al Hoshan puts in specs.city → canonical region directly.
REGION_AR = {
    "منطقة الرياض": "Riyadh", "الرياض": "Riyadh", "منطقة مكة المكرمة": "Makkah",
    "منطقة القصيم": "Qassim", "القصيم": "Qassim", "المنطقة الشرقية": "Eastern Province",
    "منطقة المدينة المنورة": "Madinah", "منطقة عسير": "Asir", "منطقة تبوك": "Tabuk",
    "منطقة حائل": "Hail", "منطقة جازان": "Jazan", "منطقة نجران": "Najran",
    "منطقة الباحة": "Al Bahah", "منطقة الجوف": "Al Jawf", "منطقة الحدود الشمالية": "Northern Borders",
}

_last = 0.0


def _throttle() -> None:
    global _last
    wait = _last + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()


def session() -> cc.Session:
    # 2026-10-03: two runs in a row timed out CONNECTING from the GitHub runner (76 s, 0 rows), so
    # probe 3 profiles DIRECT, then the residential proxy (`proxy: true` → WASALT_PROXY_URL), and keep
    # the session the host answers. Never raises: an unserved probe falls back to the old DIRECT session.
    s, tried = retry_smarter_session(BASE + "/", headers={"Accept": "application/json",
                                                          "Content-Type": "application/json"})
    print(f"Al Hoshan: probe {' '.join(tried)}", flush=True)
    return s


def _int(v: Any) -> Optional[int]:
    try:
        return int(float(v)) if v not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        return None


def _items(payload: dict) -> list[dict]:
    d = payload.get("data")
    if isinstance(d, list):
        return d
    if isinstance(d, dict):
        return d.get("items") or d.get("properties") or d.get("data") or []
    return []


def fetch_page(s: cc.Session, page: int) -> tuple[list[dict], dict]:
    """(items, meta) of one search page. Raises when the page never answers 200: a failed fetch is
    not an empty catalogue (2026-10-08: the API answered Cloudflare 502 three nights' runs in a row
    and the run read «None listings across 1 pages», a 0-row source, instead of the outage)."""
    _throttle()
    last = "no answer"
    for attempt in range(3):
        try:
            r = s.post(SEARCH, timeout=30, json={"page": page, "limit": PAGE_SIZE})
        except Exception as e:  # noqa: BLE001 — retried below, reported if every try fails
            last = f"{type(e).__name__}"
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code != 200:
            last = f"HTTP {r.status_code}"
            time.sleep(2 * (attempt + 1)); continue
        j = r.json()
        return _items(j), (j.get("meta") or {})
    raise RuntimeError(f"search page {page} answered {last} on 3 tries — the source API is failing, "
                       "not empty")


def fetch_media(s: cc.Session, guid: Any) -> Optional[list[str]]:
    """One listing's full gallery, in the site's own order (first = card thumbnail).

    The list item exposes ONLY primaryImageUrl, so 7/33 listings with 2-27 source photos were
    stored with exactly 1 (verified live 2026-09-05 on 1003 + 1021: /media's data[].cdnUrl is
    identical, in content AND order, to the detail page's rendered gallery, and its first element
    equals primaryImageUrl). Binding is structural: the endpoint is keyed by the listing's own
    internal GUID and every returned cdnUrl lives under /property-images/{that same GUID}/, so a
    related-listing's photo cannot leak in. None on ANY failure → caller degrades to the old
    primaryImageUrl behavior (fewer images, never wrong ones). [] is a real source answer
    (the 3 imageless listings) and must stay [].
    """
    if not guid:
        return None
    _throttle()
    try:
        r = s.get(MEDIA.format(guid=guid), timeout=30)
        if r.status_code != 200:
            return None
        return [m["cdnUrl"] for m in ((r.json() or {}).get("data") or [])
                if isinstance(m, dict) and isinstance(m.get("cdnUrl"), str)
                and m["cdnUrl"].startswith("http")]
    except Exception:
        return None


def _additional_info(p: dict, specs: dict) -> list[dict[str, Any]]:
    """The card's detailed-specs panel — mirrors Al Hoshan's own 'المواصفات التفصيلية' extras
    (the ones not already shown as card fields: floor, building age, parking, facade, features,
    ad-license)."""
    from datetime import datetime
    rows: list[dict[str, Any]] = []
    # Building AGE (years) — Al Hoshan shows عمر البناء as an age, not the raw build year.
    yb = specs.get("yearBuilt")
    if isinstance(yb, (int, float)) and yb > 1900:
        rows.append({"key": "age", "label": "Building age (years)", "value": str(max(0, datetime.now().year - int(yb)))})
    if specs.get("direction"):
        rows.append({"key": "direction", "label": "Facade", "value": str(specs["direction"])})
    if specs.get("floors") not in (None, "", 0, "0"):
        rows.append({"key": "floor", "label": "Floor", "value": str(specs["floors"])})
    if specs.get("parkingSpaces") not in (None, "", 0, "0"):
        rows.append({"key": "parking", "label": "Number of Parkings", "value": str(specs["parkingSpaces"])})
    feats = specs.get("features")
    if isinstance(feats, list) and feats:
        rows.append({"key": "features", "label": "Features", "value": "، ".join(str(f) for f in feats)})
    lic = p.get("advertisingLicenseNumber")
    if lic and not str(lic).startswith("•"):  # skip Al Hoshan's masked (••••) values
        rows.append({"key": "adlic", "label": "Ad license number", "value": str(lic)})
    return rows


def source_status(p: dict) -> str:
    """What the record ITSELF says about being on the market: 'live' | 'unpublished' | 'unmeasured'.

    MEASURED 2026-10-02 over the whole feed (34 of 34 items): isPublished=True, moderationStatus=
    'approved', listingExpiresAt=None on every one. No sold / rented field exists, and the Arabic
    words «مؤجر» «غير متاح» «محجوز» on a live page come from the site's own dictionary (contract
    form, app-store labels, payment states) — furniture, never read. The 13 ids missing from the
    1001-1047 range answer 404.

      isPublished is False → 'unpublished': the record's own flag; main() does not upsert it.
      isPublished unreadable (absent / not a boolean) → RAISE. "Could not read" is not "available";
          the run fails and writes nothing.
      moderationStatus other than 'approved', or an expiry date set → 'unmeasured'. Neither was
          ever observed, so today's behaviour is kept (the row is upserted) and main() counts it in
          the run notes. Nobody guesses what an unseen value means.
    """
    pub = p.get("isPublished")
    if not isinstance(pub, bool):
        raise RuntimeError(f"alhoshan item {p.get('publicId')!r}: isPublished unreadable ({pub!r}) — "
                           "refusing to upsert on a status that could not be read")
    if not pub:
        return "unpublished"
    if p.get("moderationStatus") != "approved" or p.get("listingExpiresAt") is not None:
        return "unmeasured"
    return "live"


def map_listing(p: dict, photos: Optional[list[str]] = None) -> tuple[Optional[dict], str]:
    pub = p.get("publicId")
    if not pub:
        return None, "residential"
    specs = p.get("specs") or {}
    type_slug = (specs.get("propertyType") or "").strip().lower()
    property_type = TYPE_MAP.get(type_slug)
    if not property_type:
        return None, "residential"  # unknown type → skip rather than mis-shelve
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"

    purpose = (p.get("purpose") or "").lower()
    is_rent = purpose.startswith("rent")
    price = p.get("currentPrice") or p.get("price") or p.get("basePrice")

    # ── rent period (2026-08-11 audit): Al Hoshan publishes no period field, but the SITE ITSELF
    # defines a priced rentLong amount as covering 12 months — its pages caption the figure with
    # «يمكن تقسيط مبلغ الإيجار على 12 شهر» and render exactly price÷12 as «… / شهرياً» — so that
    # amount is source-backed ANNUAL. rentShort is daily-class (no annual bucket), and a zero/
    # absent price states no period at all (AH1024 stored سنوي with NULL price): both UNKNOWN.
    rent_period = "annual" if (purpose == "rentlong" and _int(price)) else None

    # RNPL: NOT CAPTURED, on purpose (2026-08-09, owner's source-is-truth rule).
    #
    # This used to read `monthly_inst = round(price / 12)` and then set BOTH
    # `rent_now_pay_later = bool(monthly_inst)` and `rent_now_pay_later_monthly = monthly_inst`.
    # Two separate fabrications:
    #   • the instalment was DERIVED (price ÷ 12). Al Hoshan publishes no such number — only monthly
    #     × 12 into the annual column is an approved reversible normalization, and this is neither
    #     reversible nor published;
    #   • the flag was a BRAND TAGLINE («استأجر الحين.. وادفع بعدين») encoded as a per-listing fact,
    #     so it read `true` for every priced rental whether or not that listing offers financing.
    # The API exposes no per-listing RNPL field, so the honest answer is UNKNOWN. If Al Hoshan ever
    # publishes one per listing, read THAT — do not reinstate the division.
    monthly_inst = None

    # specs.city may be a city OR a region label — resolve both.
    raw_city = (specs.get("city") or "").strip()
    region = REGION_AR.get(raw_city)
    city = normalize.map_city(raw_city) or "Other"
    if region is None:
        region = CITY_TO_REGION.get(city)
    if region and city == "Other":
        city = region  # a region-only listing: surface the region as the city label too

    img = p.get("primaryImageUrl")
    photo = (img if isinstance(img, str) and img.startswith("http")
             else (BASE + img if isinstance(img, str) and img.startswith("/") else None))

    # Native Arabic R/C/D (ADDITIVE — the live English city/region/neighborhood above are untouched)
    # + catalog IDs, resolved from the source's own Arabic specs.city/specs.district. `region` (the
    # scraper's own region signal) disambiguates same-name twins (e.g. «بيش» Asir vs Jazan).
    cid, rid = to_catalog(raw_city, region_hint=region)
    # Complete-source capture (capture-once contract): the whole API item MINUS broker PII. The Al
    # Hoshan list item IS the full record for FIELDS (description, lat/lng, street, all specs, seo*)
    # — images are the one exception, chased via fetch_media(). Stored in source_capture, which the
    # app never selects. Numbers unchanged.

    row = {
        "ad_number": f"AH{pub}",
        "listing_url": f"{BASE}/properties/{pub}",
        "source": "Alhoshan",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": _int(specs.get("area")),
        # specs.bedrooms IS a real API field, but alhoshan.sa's own front end renders it under the
        # generic label "الغرف" ("Rooms") — confirmed via the site's own embedded i18n dictionary
        # ("specBedrooms":"الغرف"; a second, unused key "bedrooms":"غرف النوم" exists but the
        # rendered spec grid never uses it). Live-confirmed wrong 2026-07-28 on ad AH1012: DB stored
        # 10 (this field) while the page's own free-text description explicitly enumerates 5 real
        # bedrooms. Same "total rooms mislabeled as bedrooms" pattern as the other nulled platforms
        # (PR#263) — the JSON key name alone isn't proof of bedroom-specificity. Owner decision:
        # null rather than store an unverifiable figure.
        "bedrooms": None,
        "bathrooms": _int(specs.get("bathrooms")),
        "price_total": _int(price) if not is_rent else None,
        "price_annual": _int(price) if is_rent else None,
        "rent_period": rent_period,
        # Both UNKNOWN: Al Hoshan's API publishes no per-listing RNPL field (see above).
        "rent_now_pay_later": None,
        "rent_now_pay_later_monthly": monthly_inst,
        "city": city,
        "region": region,
        "neighborhood": specs.get("district") or None,
        "title": p.get("title"),
        # /media gallery when the fetch succeeded (source order preserved, first = thumbnail);
        # a failed fetch (photos=None) degrades to the list item's primaryImageUrl, and an empty
        # source gallery stays [] — fewer images on failure, never a wrong or invented one.
        "photo_urls": photos if photos else ([photo] if photo else []),
        "rega_location_verified": bool(p.get("advertisingLicenseNumber")),
        # Owner 2026-10-20: the search API item's own latitude/longitude — under item.specs (numbers, e.g. 24.5149529,46.7431743).
        # Rows keep their legacy shape under "rows" (buildAdditionalInfo unwraps it); the index reads the pin.
        "additional_info": {"rows": _additional_info(p, specs), **pin_dict(specs.get("latitude"), specs.get("longitude"))},   # the pair lives under item.specs (measured 2026-10-20)
        # ── Arabic-native (additive, shadow) + complete-source capture ──────────
        "city_ar": raw_city or None,
        "district_ar": (specs.get("district") or "").strip() or None,
        "city_id": cid,
        "region_id": rid,
        "source_capture": {k: v for k, v in p.items() if k not in _PII},
    }
    row.update(af_answers(p, specs))
    return row, category


# ── Advanced Filter answers from the record's OWN fields (🔬 AF engineer, 2026-10-14) ─────────────────────
# specs.direction («north») and specs.parkingSpaces (a count) are structured, and both were filed only in the
# additional_info panel: on 10-14, 23 of 30 active ads stated a facade and 8 a parking count, and the
# direction / parking columns were NULL on all of them (alhoshan 0 of 3 findable, direction missed 5 of 5).
# specs.features is empty on every active record, so kitchen and the rooms have no structured field and the
# record's own description is the statement (law §2), yes-or-nothing; parking is never read from prose.
_PROSE_COLS = ("kitchen", "elevator", "maid_room", "driver_room", "air_conditioner", "private_entrance")


def af_answers(p: dict, specs: dict) -> dict[str, Any]:
    out: dict[str, Any] = {}
    facade = normalize.facade_from_slug(specs.get("direction"))
    if facade:
        out["direction"] = facade
    spaces = _int(specs.get("parkingSpaces"))
    if spaces and spaces > 0:
        out["parking"] = True
    for col, val in normalize.prose_amenities(p.get("description"), skip=("parking",)).items():
        if col in _PROSE_COLS:
            out[col] = val
    return out


# ── LIVENESS (measured 2026-10-27) ────────────────────────────────────────────────────────────────
# Owner 2026-10-26: every ad we show gets a direct dead-ad check. The crawl reads only the SEARCH list
# (POST …/properties/search), which is not any ad's own record, so each ad is re-read at its OWN record:
#   GET https://www.alhoshan.sa/api/alhoshan/properties/{id GUID}
# MEASURED 2026-10-27 from a browser UA: a live ad's GUID (AH1041, 3bd3eaa7-…) answers 200
# {"success":true,"data":{"publicId":1041,"isPublished":true,"moderationStatus":"approved",
# "listingExpiresAt":null,…}}; a GUID the API does not hold answers HTTP 404 with the JSON body {};
# the publicId form (/properties/1041) answers 400 «The value '1041' is not valid» (a malformed ask,
# never a removal). The HTML page /properties/<id> 308-redirects to a slug and timed out from here,
# so it is not used. isPublished=false on the record itself is the same retirement source_status()
# already refuses to upsert. Anything else (400/403/5xx, an HTML 404, a record for another publicId,
# an unmeasured moderation/expiry state) is no opinion → UNKNOWN.
RECORD = BASE + "/api/alhoshan/properties/{guid}"


def _json(body: str) -> Optional[dict]:
    try:
        import json
        j = json.loads(body or "")
        return j if isinstance(j, dict) else None
    except Exception:  # noqa: BLE001
        return None


def _make_signal(ad_number: str):
    def _signal(status, body, _moved):
        j = _json(body)
        if j is None:
            return None                               # an HTML / Cloudflare page is not the API's answer
        if status in (404, 410):
            return "gone"                             # the API's own JSON 404 for a record it no longer holds
        if status != 200:
            return None
        d = j.get("data") if isinstance(j.get("data"), dict) else None
        if not d or f"AH{d.get('publicId')}" != ad_number:
            return None                               # not provably THIS record
        if d.get("isPublished") is False:
            return "gone"
        if (d.get("isPublished") is True and d.get("moderationStatus") == "approved"
                and d.get("listingExpiresAt") is None):
            return "live"
        return None
    return _signal


def _stored_guid(ad_number: str) -> Optional[str]:
    """The record's internal GUID, from the row's own stored source_capture (the API item). A failed
    lookup is None → UNKNOWN, never a kill."""
    for tbl in ("alhoshan_residential_listings", "alhoshan_commercial_listings"):
        try:
            r = db.sb().table(tbl).select("source_capture").eq("ad_number", ad_number).limit(1).execute()
        except Exception:  # noqa: BLE001
            return None
        if r.data:
            cap = r.data[0].get("source_capture") or {}
            g = cap.get("id") if isinstance(cap, dict) else None
            return g if isinstance(g, str) and g else None
    return None


def _make_verify_gone(s, control_ad: Optional[str], guid_by_ad: dict[str, str]):
    """verify_gone: read the ad's OWN API record under the shared law. Removals are gated on an ad
    THIS crawl just listed still answering live through the same probe (fails closed)."""
    from scrapers.common.http_liveness import LivenessProbe

    def probe(ad_number: str, canary=None):
        guid = guid_by_ad.get(ad_number) or _stored_guid(ad_number)
        if not guid:
            return "unknown", f"{ad_number!r}: no stored record GUID to probe"
        url = RECORD.format(guid=guid)
        return LivenessProbe(platform="alhoshan", signal=_make_signal(ad_number), session=lambda: s,
                             url_for=lambda _ad: url, canary=canary).verify_gone(ad_number)

    state: dict[str, tuple[bool, str]] = {}

    def canary() -> tuple[bool, str]:
        if "v" not in state:
            if not control_ad:
                state["v"] = (False, "no row from this run to use as a positive control")
            else:
                verdict, why = probe(control_ad)
                state["v"] = (verdict == "live", f"positive control {control_ad}: {why}")
        return state["v"]

    return lambda ad_number: probe(ad_number, canary=canary)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit-test", action="store_true", help="dry-run: fetch + map, no DB write")
    args = ap.parse_args()

    s = session()
    # begin_run BEFORE the first fetch: a crawl that dies on page 1 must still leave its failure row.
    run_id = None if args.limit_test else db.begin_run("alhoshan")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    status: dict[str, int] = {}   # source_status() tally of every item carrying a publicId
    try:
        items, meta = fetch_page(s, 1)
        total = meta.get("total")
        pages = meta.get("totalPages") or 1
        print(f"Al Hoshan: {total} listings across {pages} pages")
        page = 1
        while True:
            for p in items:
                if not p.get("publicId"):
                    continue
                st = source_status(p)          # raises when the record's own flag is unreadable
                status[st] = status.get(st, 0) + 1
                if st == "unpublished":
                    continue
                row, cat = map_listing(p, fetch_media(s, p.get("id")))
                if not row:
                    continue
                if args.type != "all" and cat != args.type:
                    continue
                (com if cat == "commercial" else res).append(row)
                seen += 1
            if not meta.get("hasNext") or page >= pages:
                break
            page += 1
            items, meta = fetch_page(s, page)     # raises on a page that never answers
            if not items:
                # The page before said hasNext. A half-read catalogue is not a complete one.
                raise RuntimeError(f"search page {page} unreadable after hasNext — refusing a partial catalogue")

        if args.limit_test:
            print(f"DRY RUN — would upsert {len(res)} residential + {len(com)} commercial")
            for r in (res + com)[:6]:
                print("  ", {k: r[k] for k in ("ad_number", "property_type", "transaction_type", "city", "region", "neighborhood", "area_m2", "price_total", "price_annual")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:70])
            return 0

        if res:
            db.upsert_alhoshan_residential_batch(res)
        if com:
            db.upsert_alhoshan_commercial_batch(com)
        # FULL-REFRESH prune: we fetched the COMPLETE catalog → anything not seen is gone.
        pruned = 0
        # An ad whose category flipped this run is superseded in the table it LEFT. Runs BEFORE
        # prune_unseen: that helper reasons from ABSENCE one table at a time and its circuit
        # breakers protect the orphan rather than age it out, after which verify_gone asks "is
        # this URL live?" — it is, in the sibling table — so the orphan never dies and the same
        # ad renders as TWO cards on one URL. No-ops unless a flip actually happened this run.
        superseded = db.retire_superseded_siblings(
            res_table="alhoshan_residential_listings", com_table="alhoshan_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source="Alhoshan")
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")

        guid_by_ad = {r["ad_number"]: (r.get("source_capture") or {}).get("id")
                      for r in res + com if (r.get("source_capture") or {}).get("id")}
        verify_gone = _make_verify_gone(s, next(iter(sorted(guid_by_ad)), None), guid_by_ad)
        for tbl, rows_seen in (("alhoshan_residential_listings", res), ("alhoshan_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Alhoshan",
                                verify_gone=verify_gone)
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
            # The list is not any ad's own record: ask each listed ad's OWN record too, and record
            # only a 'live' answer (db.stamp_seen_alive cannot hide anything).
            db.stamp_seen_alive(tbl, {r["ad_number"] for r in rows_seen}, verify_gone, source="Alhoshan")
        print(f"✓ Al Hoshan: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"pruned={pruned} unpublished_skipped={status.get('unpublished', 0)} status_unmeasured={status.get('unmeasured', 0)}", check_tables=["alhoshan_residential_listings", "alhoshan_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI instead of a silent success.", flush=True)
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


# Owner 2026-10-13: every site keeps its COMPLETE source record (PDPL-clean) beside the mapped columns.
from scrapers.common.capture import capture_source_items  # noqa: E402
capture_source_items(globals())


if __name__ == "__main__":
    raise SystemExit(main())
