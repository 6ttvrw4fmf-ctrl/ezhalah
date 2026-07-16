"""Al Hoshan (alhoshan.sa) scraper — Saudi Next.js site, clean public JSON API.

Al Hoshan العقارية is a small Saudi real-estate company (boutique catalog ~24 active listings,
mostly Riyadh/Qassim). Saudi-owned + REGA-licensed → passes the Saudi-only rule. No auth, no proxy,
cloud-friendly (public API on the same domain).

API:
  POST https://www.alhoshan.sa/api/alhoshan/properties/search   body {page, limit<=20}
       → {success, data:{items:[…]} | [...], meta:{page,total,totalPages,hasNext}}
  (the list item IS the full record — the detail endpoint adds nothing.)

Field map (Al Hoshan item → our schema):
  publicId                         → ad_number (AH{publicId}) + listing_url /properties/{publicId}
  purpose  sale|rentLong|rentShort → transaction_type Buy|Rent
  currentPrice|price               → price_total (Buy) | price_annual (Rent)
  specs.propertyType (slug)        → property_type (TYPE_MAP) + residential/commercial routing
  specs.city (Arabic)              → city (normalize.map_city → canonical)
  specs.district                   → neighborhood
  specs.area / bedrooms / bathrooms→ area_m2 / bedrooms / bathrooms
  advertisingLicenseNumber         → rega_location_verified
  primaryImageUrl                  → photo_urls (only ~15/24 have one)
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

# PDPL: never store these containers (advertiser / brokerage identity).
_PII = {"advertiser", "brokerageBadge", "brokerageContract"}

BASE = "https://www.alhoshan.sa"
SEARCH = f"{BASE}/api/alhoshan/properties/search"
PAGE_SIZE = 20  # server caps pageSize at 20
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))

# Al Hoshan propertyType slug → our canonical taxonomy.
TYPE_MAP = {
    "villa": "Villa", "apartment": "Apartment", "floor": "Floor", "building": "Building",
    "duplex": "Villa", "palace": "Villa", "room": "Room", "rest_house": "Rest House",
    "chalet": "Chalet", "farm": "Farm", "land_residential": "Residential Land",
    "land": "Residential Land", "house": "House",
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
    s = cc.Session(impersonate="chrome124")
    s.headers.update({"Accept": "application/json", "Content-Type": "application/json"})
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
    _throttle()
    for attempt in range(3):
        try:
            r = s.post(SEARCH, timeout=30, json={"page": page, "limit": PAGE_SIZE})
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code != 200:
            time.sleep(2 * (attempt + 1)); continue
        j = r.json()
        return _items(j), (j.get("meta") or {})
    return [], {}


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


def map_listing(p: dict) -> tuple[Optional[dict], str]:
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

    # "أقساط" rent-now-pay-later: Al Hoshan markets annual rent payable in 12 monthly installments
    # (brand tagline "استأجر الحين.. وادفع بعدين"). No per-listing flag in the API, so it's the
    # standard offer on any annual rental — monthly = annual / 12 (mirrors their on-site banner).
    monthly_inst = round(_int(price) / 12) if (is_rent and _int(price)) else None

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
    # Hoshan list item IS the full record (description, lat/lng, street, all specs, seo*) — no detail
    # endpoint to chase. Stored in source_capture, which the app never selects. Numbers unchanged.

    row = {
        "ad_number": f"AH{pub}",
        "listing_url": f"{BASE}/properties/{pub}",
        "source": "Alhoshan",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": _int(specs.get("area")),
        "bedrooms": _int(specs.get("bedrooms")),
        "bathrooms": _int(specs.get("bathrooms")),
        "price_total": _int(price) if not is_rent else None,
        "price_annual": _int(price) if is_rent else None,
        "rent_period": "annual" if is_rent else None,
        "rent_now_pay_later": bool(monthly_inst),
        "rent_now_pay_later_monthly": monthly_inst,
        "city": city,
        "region": region,
        "neighborhood": specs.get("district") or None,
        "title": p.get("title"),
        "photo_urls": [photo] if photo else [],
        "rega_location_verified": bool(p.get("advertisingLicenseNumber")),
        "additional_info": _additional_info(p, specs),
        # ── Arabic-native (additive, shadow) + complete-source capture ──────────
        "city_ar": raw_city or None,
        "district_ar": (specs.get("district") or "").strip() or None,
        "city_id": cid,
        "region_id": rid,
        "source_capture": {k: v for k, v in p.items() if k not in _PII},
    }
    return row, category


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit-test", action="store_true", help="dry-run: fetch + map, no DB write")
    args = ap.parse_args()

    s = session()
    items, meta = fetch_page(s, 1)
    total = meta.get("total")
    pages = meta.get("totalPages") or 1
    print(f"Al Hoshan: {total} listings across {pages} pages")

    run_id = None if args.limit_test else db.begin_run("alhoshan")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        page = 1
        while True:
            for p in items:
                row, cat = map_listing(p)
                if not row:
                    continue
                if args.type != "all" and cat != args.type:
                    continue
                (com if cat == "commercial" else res).append(row)
                seen += 1
            if not meta.get("hasNext") or page >= pages:
                break
            page += 1
            items, meta = fetch_page(s, page)
            if not items:
                break

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
        for tbl, rows_seen in (("alhoshan_residential_listings", res), ("alhoshan_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Alhoshan")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Al Hoshan: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"pruned={pruned}", check_tables=["alhoshan_residential_listings", "alhoshan_commercial_listings"])
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
