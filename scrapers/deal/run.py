# ═══════════════════════════════════════════════════════════════════════════════════════════════
# RETIRED / DEPRECATED — DO NOT RUN, DO NOT ADD TO ANY WORKFLOW MATRIX.
#
# Deprecated 2026-06-26 (live `deprecated_platforms` row; the experiment was reverted 2026-06-24
# after 2 runs). This was a JSON-API experiment against api.dealapp.sa — the SAME site the active
# `dealapp` pipeline (scrapers/dealapp/, HTML/schema.org path) covers — so running both would
# double-list dealapp.sa inventory. Its 36 DB rows (deal_residential_listings) are retained but
# never user-visible (0 active, 0 in active_listing_ids_v2/search_listings_ar); freshness alerts
# are suppressed via the hardcoded `tablename not like 'deal\_%'` literal in
# check_scraper_freshness().
#
# `deal` is listed in scrapers/RETIRED_PLATFORMS.txt — the hermetic guard
# (scrapers/common/tests/test_retired_platforms_guard.py) fails CI if this slug ever re-enters a
# workflow matrix. Un-retiring requires owner approval; if dealapp.sa coverage needs this JSON
# API, evolve scrapers/dealapp/ instead of resurrecting this slug.
# See docs/ARCHITECTURE.md §12 "Retired platforms".
# ═══════════════════════════════════════════════════════════════════════════════════════════════
"""Deal (dealapp.sa) scraper — public JSON API behind an anonymous JWT.

RETIRED 2026-06-26 — see the header block above. Kept for reference only.

dealapp.sa is an Ionic SPA backed by api.dealapp.sa/production. The listings endpoint needs a token,
but ANY visitor can get one: POST /production/user/skip → the JWT comes back in the `authorization`
RESPONSE header (role=GUEST). With it, GET /production/ad?page=N&limit=10 returns the full feed
(~65.5k listings). limit is capped at 10 by the API, so we page deep.

Field map (Deal ad → our schema):
  title / price / area               → title / price_total|price_annual / area_m2
  purpose  SALE|RENT                 → transaction_type Buy|Rent
  propertyType.propertyType          → property_type (TYPE_MAP) + residential/commercial routing
  city/district  {name_en}           → city (canonical) / neighborhood
  media.main {url|thumbnail,type}    → photo_urls cover (IMAGE → url; else thumbnail — never a
                                       non-image url). Full gallery (media.extra[], ~12 imgs) is
                                       detail-only: GET /ad/{_id}; the list feed gives main only.
  relatedQuestions / regaRawData     → additional_info (street width, age, rooms, usage)
  code, location.coordinates         → ad_number, GPS
Only status=APPROVED + published=True are kept (skip pending/hidden).

Usage:  python -m scrapers.deal.run --pages 7000 [--limit-test 2] [--type residential|commercial|all]
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

from scrapers.common import db

API = "https://api.dealapp.sa/production"
HEADERS = {"Accept": "application/json", "Origin": "https://dealapp.sa", "Referer": "https://dealapp.sa/"}
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.2"))
PER_PAGE = 10  # API hard cap

# Deal propertyType (UPPERCASE-DASH or spaced) → our canonical taxonomy type.
TYPE_MAP = {
    # residential
    "VILLA": "Villa", "VILLA-IN-COMPLEX": "Villa", "VILLA-2-APARTMENTS": "Villa",
    "VILLA3-APARTMENTS": "Villa", "VILLA-APARTMENT": "Villa", "BONE-VILLA": "Villa",
    "TOWNHOUSE": "Villa", "DUPLEX": "Villa", "DUPLEX APARTMENT": "Villa", "PENTHOUSE": "Apartment",
    "CASTLE": "Villa", "DEMOTIC-HOUSE": "House", "COUNTRY HOUSE": "Villa", "COMPOUND": "Compound",
    "APARTMENT": "Apartment", "APARTMENT-TOWER": "Apartment", "APARTMENT-COMPLEX": "Apartment",
    "ROVE-APARTMENT": "Apartment", "STUDIO": "Apartment", "FURNISHED-APARTMENT": "Apartment",
    "SERVICED APARTMENT BUILDING": "Building", "ROOM": "Room", "DRIVERS ROOM": "Room",
    "UPPER ANNEX": "Apartment", "FLOOR": "Floor", "FLOOR AND APARTMENT": "Floor",
    "FLOOR WITH TWO APARTMENTS": "Floor", "FLOOR WITH THREE APARTMENTS": "Floor",
    "RESIDENTIAL-BUILDING": "Building", "FUR-APART-BUILDING": "Building", "BUILDING": "Building",
    "RESIDENTIAL-LAND": "Residential Land", "RAW-LAND": "Residential Land", "BLOCK-LAND": "Residential Land",
    "DEMOLITION-HOUSE": "Residential Land", "FARM": "Farm", "AGRICULTURAL-LAND": "Agriculture Plot",
    "YARD": "Residential Land", "CHALET": "Chalet", "RESORT": "Rest House", "REST": "Rest House",
    "BACHELOR REST HOUSE": "Rest House", "CHALET LAND": "Residential Land", "WATERFRONT LAND": "Residential Land",
    "CAMP": "Rest House", "INVESTMENT LAND": "Residential Land", "TOURIST LAND": "Residential Land",
    # commercial
    "OFFICE": "Office", "OFFICE TOWER": "Office", "JOINT OFFICES": "Office", "BUSINESS CENTER": "Office",
    "INDEPENDENT ADMINISTRATIVE BUILDING": "Commercial Building", "COMMERCIAL-BUILDING": "Commercial Building",
    "TOWER": "Commercial Building", "RES-COMM-BUILDING": "Commercial Building", "SHELL BUILDING": "Commercial Building",
    "COMMERCIAL-LAND": "Commercial Land", "INDUSTRIAL-LAND": "Industrial Land", "WAREHOUSE-LAND": "Industrial Land",
    "EDUCATIONAL-LAND": "Commercial Land", "HOSPITAL-LAND": "Commercial Land", "MOSQUE-LAND": "Commercial Land",
    "GAS-STATION-LAND": "Commercial Land", "SERVICES LAND": "Commercial Land", "PARKING LAND": "Commercial Land",
    "RESIDENTIAL COMMERCIAL LAND": "Commercial Land",
    "SHOP": "Shop", "DROP-OFF-SHOP": "Shop", "DRIVE THRU": "Shop", "KIOSK": "Kiosk",
    "CAR SHOWROOM": "Showroom", "EXHIBITION": "Showroom", "SHOPPING MALL": "Commercial Building",
    "STRIP MALL": "Commercial Building", "MALL": "Commercial Building",
    "STOREHOUSE": "Warehouse", "WAREHOUSE": "Warehouse", "CLOUD WAREHOUSES": "Warehouse", "WORKSHOP": "Workshop",
    "FACTORY": "Factory", "WORKERS-RESD": "Workshop", "GAS-STATION": "Gas Station", "STATION": "Gas Station",
    "HOTEL": "Hotel", "RESTAURANT": "Shop", "CAFE": "Shop", "CLOUD KITCHENS": "Shop", "WEDDING HALL": "Hotel",
    "HOSPITAL": "Health Center", "MEDICAL COMPLEX": "Health Center", "HEALTH CENTRE": "Health Center",
    "CLINICS BUILDING": "Health Center", "SCHOOL": "School", "CINEMA": "Cinema", "CAR PARKING": "Parking",
    "CAR WASH FACILITY": "Shop", "ATM": "Bank", "ELECTRICITY SUBSTATION": "Commercial Building",
    "TELECOMMUNICATION TOWER": "Telecom Tower", "FOOTBALL FIELD": "Commercial Building",
    "DROP OFF SHOP": "Shop",
}
# Which final types are COMMERCIAL → route to the commercial table.
COMMERCIAL_TYPES = {
    "Office", "Commercial Building", "Commercial Land", "Industrial Land", "Shop", "Kiosk", "Showroom",
    "Warehouse", "Workshop", "Factory", "Gas Station", "Hotel", "Health Center", "School", "Cinema",
    "Parking", "Bank", "Telecom Tower",
}

# Deal city name_en → our canonical label (so a "Mecca" search matches Deal's "Makkah Al Mukarramah").
CITY_MAP = {
    "Makkah Al Mukarramah": "Mecca", "Al Madinah Al Munawwarah": "Medina",
    "Ad Dir'iyah": "Diriyah", "Ad Diriyah": "Diriyah", "Al Khobar": "Khobar",
    "Aldammam": "Dammam", "Al Ahsa": "Hofuf", "Al Hufuf": "Hofuf",
}

_last = 0.0


def _throttle() -> None:
    global _last
    wait = _last + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()


def new_token(s: cc.Session) -> str:
    """Anonymous register → JWT from the `authorization` response header."""
    r = s.post(f"{API}/user/skip", timeout=20, headers=HEADERS, json={})
    return r.headers.get("authorization", "")


def session() -> tuple[cc.Session, dict]:
    s = cc.Session(impersonate="chrome124")
    s.headers.update(HEADERS)
    auth = {**HEADERS, "authorization": new_token(s)}
    return s, auth


def fetch_page(s: cc.Session, auth: dict, page: int) -> tuple[list[dict], int]:
    _throttle()
    for attempt in range(3):
        try:
            r = s.get(f"{API}/ad?page={page}&limit={PER_PAGE}", timeout=30, headers=auth)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code == 401:  # token expired → refresh once
            auth["authorization"] = new_token(s); continue
        if r.status_code != 200:
            time.sleep(2 * (attempt + 1)); continue
        d = r.json()
        return (d.get("data") or []), int(d.get("total") or 0)
    return [], 0


def _name(v: Any) -> Optional[str]:
    if isinstance(v, dict):
        return v.get("name_en") or v.get("name_ar")
    return v if isinstance(v, str) else None


def _city(v: Any) -> Optional[str]:
    # Forward-fix (2026-07-10 location-data-quality audit, item-7 follow-up): an honest None beats
    # the literal "Other" sentinel this used to fall back to when the source had no city name at all.
    raw = _name(v)
    return CITY_MAP.get(raw, raw) if raw else None


def _int(v: Any) -> Optional[int]:
    try:
        return int(float(v)) if v not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        return None


def _media_image(m: dict) -> Optional[str]:
    """Resolve ONE displayable image URL from a media item (main or extra entry).

    Rule: for an IMAGE the `url` *is* the image; for anything else (VIDEO, future
    types) `url` is a non-image asset (e.g. a .qt/.mp4 — confirmed served as
    video/quicktime, which breaks <img>), so we MUST use `thumbnail`. Never fall
    back to `url` for a non-IMAGE item. Returns None if no usable image exists.
    """
    if not isinstance(m, dict):
        return None
    t = m.get("type")
    if t == "IMAGE" and isinstance(m.get("url"), str) and m["url"]:
        return m["url"]
    thumb = m.get("thumbnail")
    if isinstance(thumb, str) and thumb:  # VIDEO (or unknown type) → its image thumbnail
        return thumb
    # last resort: an IMAGE item missing its url but carrying a thumbnail is handled above;
    # a non-IMAGE with no thumbnail has no displayable image.
    return None


def _photos(L: dict) -> list[str]:
    """Collect listing photos as displayable image URLs (deduped, order-preserving).

    The /ad LIST endpoint returns only `media.main` (a single cover image), even though
    `mediaMetaData.imagesCount` is often 12-13 — i.e. the gallery is NOT in the list feed.
    The full gallery lives in `media.extra[]` and is only returned by the per-listing
    detail call `GET /production/ad/{_id}` (see enrich step). This function reads whatever
    media is present: `main` plus any `extra[]` entries if a detail-enriched record is
    passed in. On a plain list record it yields the single cover image (by design — we do
    NOT fire 65k detail calls inline; the /user/skip token endpoint hard rate-limits 429).
    """
    media = (L.get("media") or {})
    out: list[str] = []
    cover = _media_image(media.get("main") or {})
    if cover:
        out.append(cover)
    for item in (media.get("extra") or []):
        img = _media_image(item)
        if img:
            out.append(img)
    # dedupe, keep first occurrence (cover stays at index 0)
    return list(dict.fromkeys(out))


_EXTRA = [
    ("propertyAgeRange", "Age"), ("streetWidthRange", "Street width"),
    ("roomsNumRange", "Rooms"), ("usage", "Property usage"), ("facade", "Facade"),
]


def _additional_info(L: dict) -> list[dict[str, Any]]:
    rq = L.get("relatedQuestions") or {}
    rows = []
    for key, label in _EXTRA:
        v = rq.get(key)
        if v not in (None, "", 0, "0", False):
            rows.append({"key": key, "label": label, "value": str(v)})
    return rows


def map_listing(L: dict) -> tuple[Optional[dict], str]:
    pid = L.get("_id") or L.get("id")
    if not pid:
        return None, "residential"
    if L.get("status") != "APPROVED" or not L.get("published"):
        return None, "skip"
    pt = (L.get("propertyType") or {}).get("propertyType") or ""
    property_type = TYPE_MAP.get(pt.upper(), pt.replace("-", " ").title() if pt else None)
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"
    is_rent = (L.get("purpose") or "").upper() in ("RENT", "RENTAL")
    rq = L.get("relatedQuestions") or {}
    # property_age column is a smallint: "NEW" → 0, a numeric range → its leading number, else null.
    age_raw = rq.get("propertyAgeRange")
    age_int = 0 if str(age_raw).strip().upper() in ("NEW", "NEW_PROPERTY") else _int(str(age_raw).split("-")[0]) if age_raw else None
    beds_int = _int(str(rq.get("roomsNumRange")).split("-")[0]) if rq.get("roomsNumRange") else None
    row = {
        "ad_number": f"DEAL{L.get('code') or pid}",
        "listing_url": f"https://dealapp.sa/ar/marketplace/ad/{pid}",
        "source": "Deal",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": _int(L.get("area")),
        "bedrooms": beds_int,
        "price_total": _int(L.get("price")) if not is_rent else None,
        "price_annual": _int(L.get("price")) if is_rent else None,
        "rent_period": "annual" if is_rent else None,
        "city": _city(L.get("city")),
        "neighborhood": (_name(L.get("district")) or "").replace(" Dist.", "").strip() or None,
        "title": L.get("title"),
        "photo_urls": _photos(L),
        "property_age": age_int,  # smallint — see age_raw handling above
        "rega_location_verified": bool(L.get("regaLicenseEndDate")),
        "additional_info": _additional_info(L),
    }
    return row, category


def scrape(type_filter: str, max_pages: int, dry: int) -> int:
    s, auth = session()
    _, total = fetch_page(s, auth, 1)
    pages = min(max_pages, (total + PER_PAGE - 1) // PER_PAGE) if total else max_pages
    print(f"Deal: total={total}, scraping up to {pages} pages (limit {PER_PAGE}/page)")
    run_id = None if dry else db.begin_run("deal")
    res: list[dict] = []
    com: list[dict] = []
    seen = skipped = 0
    BATCH = 300
    try:
        for page in range(1, pages + 1):
            listings, _ = fetch_page(s, auth, page)
            if not listings:
                break
            for L in listings:
                row, cat = map_listing(L)
                if cat == "skip" or not row or not row.get("property_type"):
                    skipped += 1; continue
                if type_filter != "all" and cat != type_filter:
                    continue
                (com if cat == "commercial" else res).append(row)
                seen += 1
            if dry and page >= dry:
                break
            if not dry and (len(res) >= BATCH or len(com) >= BATCH):
                if res: db.upsert_deal_residential_batch(res); res = []
                if com: db.upsert_deal_commercial_batch(com); com = []
            if page % 100 == 0:
                print(f"  [{page}/{pages}] kept {seen}, skipped {skipped}")
        if dry:
            print(f"DRY RUN — would upsert {len(res)} residential + {len(com)} commercial (skipped {skipped})")
            for r in res[:4]:
                print("  ", {k: r[k] for k in ("ad_number", "property_type", "transaction_type", "city", "neighborhood", "area_m2", "price_total")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:80])
            return 0
        if res: db.upsert_deal_residential_batch(res)
        if com: db.upsert_deal_commercial_batch(com)
        print(f"✓ Deal: kept {seen}, skipped {skipped}")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"skipped={skipped}")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--pages", type=int, default=7000)
    p.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    p.add_argument("--limit-test", type=int, default=0, help="dry-run: process N pages, no DB write")
    args = p.parse_args()
    return scrape(args.type, args.pages, args.limit_test)


if __name__ == "__main__":
    raise SystemExit(main())
