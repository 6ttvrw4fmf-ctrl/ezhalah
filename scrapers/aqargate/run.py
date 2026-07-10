"""Aqargate (aqargate.com) scraper — Saudi Houzez WordPress site, clean public REST API.

No auth, no token, no rate-limit. Listings are a WordPress custom post type exposed at
/wp-json/wp/v2/properties (paginated, X-WP-TotalPages header). ~257 listings. Each carries the full
Saudi REGA ad data under property_meta.advertisement_response (price, area, rooms, plan/land number,
license, and a clean {region, city, district} location). The featured image is a direct `thumbnail` URL.

Field map (Aqargate property → our schema):
  property_type_text (Arabic)        → property_type (TYPE_MAP_AR) + residential/commercial routing
  property_status_text  بيع|إيجار     → transaction_type Buy|Rent
  ad.location.city (Arabic)          → city (normalize.map_city → canonical English)
  ad.location.district               → neighborhood
  ad.propertyPrice / landTotalAnnualRent → price_total | price_annual
  ad.propertyArea / numberOfRooms    → area_m2 / bedrooms
  thumbnail                          → photo_urls (full URL, verified to load)
  ad.propertyAge/Face/planNumber/... → additional_info (Age, Facade, Plan/Land number, Street width, Usage)
  link, fave_property_id             → listing_url, ad_number

Usage:  python -m scrapers.aqargate.run [--limit-test 1] [--type residential|commercial|all]
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

import copy

from scrapers.common import db, normalize
from scrapers.common.arabic_location import to_catalog

# PDPL: advertiser/agent identity + contact inside advertisement_response — never stored.
_PII = {"advertiserId", "advertiserName", "responsibleEmployeeName",
        "responsibleEmployeePhoneNumber", "phoneNumber"}

API = "https://aqargate.com/wp-json/wp/v2/properties"
HEADERS = {"Accept": "application/json"}
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))
PER_PAGE = 100  # WordPress REST cap

# Aqargate property_type (Arabic) → our canonical taxonomy.
TYPE_MAP_AR = {
    "شقة": "Apartment", "شقَّة صغيرة (استوديو)": "Apartment", "شقة مفروشة": "Apartment", "روف": "Floor",
    "فيلا": "Villa", "قصر": "Villa", "دور": "Floor", "عمارة": "Building", "برج": "Building",
    "ارض": "Residential Land", "أرض": "Residential Land", "مزرعة": "Farm", "إستراحة": "Rest House",
    "استراحة": "Rest House", "شاليه": "Chalet", "غرفة": "Room", "مجمع": "Compound",
    # commercial
    "مكتب": "Office", "معرض": "Showroom", "محطة": "Gas Station", "مستودع": "Warehouse",
    "مصنع": "Factory", "ورشة": "Workshop", "فندق": "Hotel", "كشك": "Kiosk", "موقف سيارات": "Parking",
    "مدرسة": "School", "مستشفى، مركز صحي": "Health Center", "سينما": "Cinema", "صراف": "Bank",
    "برج اتصالات": "Telecom Tower", "محطة كهرباء": "Commercial Building",
}
COMMERCIAL_TYPES = {
    "Office", "Showroom", "Gas Station", "Warehouse", "Factory", "Workshop", "Hotel", "Kiosk",
    "Parking", "School", "Health Center", "Cinema", "Bank", "Telecom Tower", "Commercial Building",
    "Commercial Land",
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
    s.headers.update(HEADERS)
    return s


def fetch_page(s: cc.Session, page: int) -> tuple[list[dict], int]:
    _throttle()
    for attempt in range(3):
        try:
            r = s.get(f"{API}?page={page}&per_page={PER_PAGE}", timeout=30)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code == 400:  # past the last page
            return [], 0
        if r.status_code != 200:
            time.sleep(2 * (attempt + 1)); continue
        total_pages = int(r.headers.get("X-WP-TotalPages") or 1)
        return (r.json() or []), total_pages
    return [], 0


def _int(v: Any) -> Optional[int]:
    try:
        return int(float(v)) if v not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        return None


def _text(v: Any) -> Optional[str]:
    if isinstance(v, list):
        return v[0] if v else None
    return v if isinstance(v, str) else None


def _val(v: Any) -> Optional[str]:
    """Clean a scalar into a display string, or None if empty/placeholder."""
    if v in (None, "", 0, "0", []):
        return None
    s = str(v).strip()
    return s or None


def _additional_info(ar: dict) -> list[dict[str, Any]]:
    """Card 'Additional Information' panel — ONLY the fields we show for the other sources
    (mirrors the Wasalt set: usage / age / facade / ad source / plan & land number / street /
    services / obligations / license date). NEVER include the advertiser or responsible-person
    name or phone number — that is personal data (PDPL)."""
    rows: list[dict[str, Any]] = []

    def add(key: str, label: str, value: Optional[str]) -> None:
        if value:
            rows.append({"key": key, "label": label, "value": value})

    usages = ar.get("propertyUsages")
    usage = (", ".join(str(u) for u in usages) if isinstance(usages, list) and usages
             else _val(usages) or _val(ar.get("mainLandUseTypeName")))
    add("usage", "Property usage", usage)
    add("propertyAge", "Age", _val(ar.get("propertyAge")))
    add("propertyFace", "Facade", _val(ar.get("propertyFace")))
    add("adSource", "Ad source", _val(ar.get("adSource")))
    add("planNumber", "Plan number", _val(ar.get("planNumber")))
    add("landNumber", "Land number", _val(ar.get("landNumber")))
    add("streetWidth", "Street width", _val(ar.get("streetWidth")))
    utils = ar.get("propertyUtilities")
    if isinstance(utils, list) and utils:
        add("services", "Property services", "، ".join(str(u) for u in utils))
    add("obligations", "Other obligations on the property", _val(ar.get("obligationsOnTheProperty")))
    add("regaAdvLicDate", "License Issuance Date", _val(ar.get("creationDate")))
    return rows


def map_listing(p: dict) -> tuple[Optional[dict], str]:
    meta = p.get("property_meta") or {}
    ar = meta.get("advertisement_response") or {}
    pid = _text(meta.get("fave_property_id")) or str(p.get("id") or "")
    if not pid:
        return None, "residential"
    type_ar = (_text(p.get("property_type_text")) or "").strip()
    property_type = TYPE_MAP_AR.get(type_ar, type_ar or None)
    is_rent = (_text(p.get("property_status_text")) or "").strip() == "إيجار"
    loc = ar.get("location") or {}
    # Land in a commercial usage → Commercial Land
    if property_type == "Residential Land":
        usages = " ".join(str(u) for u in (ar.get("propertyUsages") or []))
        if "تجاري" in usages:
            property_type = "Commercial Land"
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"

    # Forward-fix (2026-07-10 location-data-quality audit): an honest None beats the literal "Other"
    # sentinel on this legacy column — the additive city_ar/city_id columns below already resolve
    # most rows independently; this just closes the remaining leak on the raw-column read path.
    city = normalize.map_city(loc.get("city") or "")

    # Native STRUCTURED Arabic (ADDITIVE — live city/neighborhood above untouched). Aqargate's REST
    # carries a clean {region, city, district} in Arabic → resolve catalog IDs with the region as the
    # twin-disambiguation hint (no parser, no loose matching). source_capture = the whole WordPress
    # property MINUS advertiser PII (nested in advertisement_response). Numbers/photos unchanged.
    city_ar = (loc.get("city") or "").strip() or None
    region_ar = (loc.get("region") or "").strip() or None
    district_ar = (loc.get("district") or "").strip() or None
    cid, rid = to_catalog(city_ar, region_hint=region_ar)
    cap = copy.deepcopy(p)
    _arc = (cap.get("property_meta") or {}).get("advertisement_response")
    if isinstance(_arc, dict):
        for _k in _PII:
            _arc.pop(_k, None)

    price = ar.get("propertyPrice") or ar.get("landTotalPrice")
    rent = ar.get("landTotalAnnualRent") or ar.get("propertyPrice")
    thumb = p.get("thumbnail")
    row = {
        "ad_number": f"AG{pid.replace('AG-', '').replace('AG', '')}",
        "listing_url": p.get("link"),
        "source": "Aqargate",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": _int(ar.get("propertyArea")),
        "bedrooms": _int(ar.get("numberOfRooms")),
        "bathrooms": _int(ar.get("numberOfBathrooms")),
        "price_total": _int(price) if not is_rent else None,
        "price_annual": _int(rent) if is_rent else None,
        "rent_period": "annual" if is_rent else None,
        "city": city,
        "neighborhood": loc.get("district") or None,
        "title": (p.get("title") or {}).get("rendered"),
        "photo_urls": [thumb] if isinstance(thumb, str) and thumb.startswith("http") else [],
        "property_age": _int(ar.get("propertyAge")),
        "rega_location_verified": bool(ar.get("adLicenseNumber")),
        "additional_info": _additional_info(ar),
        # ── Arabic-native structured (additive, shadow) + complete-source capture ──
        "city_ar": city_ar,
        "district_ar": district_ar,
        "city_id": cid,
        "region_id": rid,
        "source_capture": cap,
    }
    return row, category


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    p.add_argument("--limit-test", type=int, default=0, help="dry-run: process N pages, no DB write")
    args = p.parse_args()

    s = session()
    _, total_pages = fetch_page(s, 1)
    print(f"Aqargate: {total_pages} pages (per_page={PER_PAGE})")
    run_id = None if args.limit_test else db.begin_run("aqargate")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        for page in range(1, total_pages + 1):
            listings, _ = fetch_page(s, page)
            if not listings:
                break
            for p_ in listings:
                row, cat = map_listing(p_)
                if not row or not row.get("property_type"):
                    continue
                if args.type != "all" and cat != args.type:
                    continue
                (com if cat == "commercial" else res).append(row)
                seen += 1
            if args.limit_test and page >= args.limit_test:
                break
        if args.limit_test:
            print(f"DRY RUN — would upsert {len(res)} residential + {len(com)} commercial")
            for r in res[:4]:
                print("  ", {k: r[k] for k in ("ad_number", "property_type", "transaction_type", "city", "neighborhood", "area_m2", "price_total")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:80])
            return 0
        if res: db.upsert_aqargate_residential_batch(res)
        if com: db.upsert_aqargate_commercial_batch(com)
        # FULL-REFRESH prune: we fetched the COMPLETE catalog, so any Aqargate row not seen this run
        # is gone → mark inactive (self-cleaning, replaces a separate liveness job).
        pruned = 0
        for tbl, rows_seen in (("aqargate_residential_listings", res), ("aqargate_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Aqargate")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Aqargate: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"pruned={pruned}")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
