"""Aldarim scraper — clean public JSON API, no auth, no browser.

Discovered via Playwright network-intercept: aldarim.sa (a Nuzul SaaS tenant) serves its listings
from a PUBLIC paginated API at aldarim.nzl-backend.com/api/public/properties. ~231 listings total,
very rich per-listing data. So the scraper is just: paginate the API → map → upsert. (The Aqar way.)

Field map (Aldarim API → our schema):
  category   residential|commercial   → which table
  purpose    sell|rent                → transaction_type Buy|Rent
  type       land|villa|apartment|...  → property_type (TYPE_MAP)
  city/district  {name_en}            → city / neighborhood
  selling_price / rent_price_annually  → price_total / price_annual
  area (or built_up_area)             → area_m2 ; bedrooms/bathrooms direct
  cover_image_url + images[]          → photo_urls (full S3 URLs, verified to load)
  plan_number/plot_number/rega/majlis → additional_info (the rich extras panel)

Usage:  python -m scrapers.aldarim.run --pages 50 [--limit-test 1]
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

API = "https://aldarim.nzl-backend.com/api/public/properties"
SITE = "https://www.aldarim.sa/en/properties"
HEADERS = {"Accept": "application/json", "Origin": "https://www.aldarim.sa",
           "Referer": "https://www.aldarim.sa/"}
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))
PER_PAGE = 50

# Aldarim `type` → our canonical taxonomy. Land's residential/commercial split is decided by category.
TYPE_MAP = {
    "land": "Residential Land", "villa": "Villa", "townhouse": "Villa", "duplex": "Villa",
    "mansion": "Villa", "apartment": "Apartment", "tower_apartment": "Apartment",
    "building_apartment": "Apartment", "villa_apartment": "Apartment", "floor": "Floor",
    "villa_floor": "Floor", "building": "Building", "farm": "Farm", "istraha": "Rest House",
    "compound": "Compound", "office": "Office", "store": "Shop", "storage": "Warehouse",
    "showroom": "Showroom", "resort": "Hotel", "hotel": "Hotel",
}
# A few types we treat as commercial-land when category is commercial.
_LAND_TYPES = {"land"}

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
    """Return (listings, last_page) for one API page."""
    _throttle()
    for attempt in range(3):
        try:
            r = s.get(f"{API}?page={page}&per_page={PER_PAGE}", timeout=30)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code != 200:
            time.sleep(2 * (attempt + 1)); continue
        d = r.json()
        meta = d.get("meta") or {}
        return (d.get("data") or []), int(meta.get("last_page") or 1)
    return [], 1


def _name(v: Any) -> Optional[str]:
    """city/district come as {id,name_en,name_ar} (or sometimes a plain string)."""
    if isinstance(v, dict):
        return v.get("name_en") or v.get("name_ar")
    return v if isinstance(v, str) else None


def _int(v: Any) -> Optional[int]:
    try:
        return int(float(v)) if v not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        return None


def _photos(L: dict) -> list[str]:
    out: list[str] = []
    cov = L.get("cover_image_url")
    if isinstance(cov, str) and cov.startswith("http"):
        out.append(cov)
    for im in L.get("images") or []:
        u = im.get("url") if isinstance(im, dict) else im
        if isinstance(u, str) and u.startswith("http") and u not in out:
            out.append(u)
    return out[:30]


# additional_info: the rich Aldarim-only extras, as label/value rows (like Wasalt's panel).
_EXTRA_FIELDS = [
    ("year_built", "Age"), ("facade", "Facade"), ("rega_ad_number", "REGA Ad No."),
    ("plan_number", "Plan number"), ("plot_number", "Land number"),
    ("number_of_floors", "Total Floors"), ("unit_floor_number", "Floor"),
    ("majlis_rooms", "Majlis"), ("living_rooms", "Living rooms"),
    ("maid_rooms", "Maid room"), ("driver_rooms", "Driver room"),
    ("parking_spots", "Parking"), ("street_width", "Street width"),
]


def _additional_info(L: dict) -> list[dict[str, Any]]:
    rows = []
    for key, label in _EXTRA_FIELDS:
        v = L.get(key)
        if v not in (None, "", 0, "0", False):
            rows.append({"key": key, "label": label, "value": str(v)})
    if L.get("is_furnished") is not None:
        rows.append({"key": "is_furnished", "label": "Furniture",
                     "value": "Furnished" if L.get("is_furnished") else "Un-Furnished"})
    return rows


def map_listing(L: dict) -> tuple[Optional[dict], str]:
    """Return (row, category). category in {'residential','commercial'} decides the table."""
    pid = L.get("id")
    if not pid:
        return None, "residential"
    category = (L.get("category") or "residential").lower()
    is_rent = (L.get("purpose") or "").lower() in ("rent", "rental")
    t = (L.get("type") or "").lower()
    property_type = TYPE_MAP.get(t, t.title() if t else None)
    if t in _LAND_TYPES and category == "commercial":
        property_type = "Commercial Land"

    area = _int(L.get("area")) or _int(L.get("built_up_area"))
    rent_price = (L.get("rent_price_annually") or L.get("rent_price_monthly"))
    row = {
        "ad_number": f"ALD{pid}",
        "listing_url": f"https://www.aldarim.sa/en/properties/{pid}",
        "source": "Aldarim",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": area,
        "bedrooms": _int(L.get("bedrooms")),
        "bathrooms": _int(L.get("bathrooms")),
        "halls": _int(L.get("living_rooms")),
        "reception_rooms_majlis": _int(L.get("majlis_rooms")),
        "price_total": _int(L.get("selling_price")) if not is_rent else None,
        "price_annual": _int(rent_price) if is_rent else None,
        "rent_period": "annual" if is_rent else None,
        "city": _name(L.get("city")) or "Other",
        "neighborhood": (_name(L.get("district")) or "").replace(" Dist.", "").strip() or None,
        "title": L.get("name_en") or L.get("name_ar"),
        "photo_urls": _photos(L),
        "property_age": str(L.get("year_built")) if L.get("year_built") else None,
        "rega_location_verified": bool(L.get("rega_ad_number")),
        "additional_info": _additional_info(L),
        # (no detail_enriched — that's a Wasalt-only enrichment flag; Aldarim's API is already complete.)
    }
    return row, category


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--pages", type=int, default=50)
    p.add_argument("--limit-test", type=int, default=0, help="If >0, only process this many pages and DON'T upsert (dry run preview).")
    args = p.parse_args()

    s = session()
    run_id = None if args.limit_test else db.begin_run("aldarim")
    res_rows: list[dict] = []
    com_rows: list[dict] = []
    _, last_page = fetch_page(s, 1)
    pages = min(args.pages, last_page)
    print(f"Aldarim: {last_page} pages total, scraping {pages} (per_page={PER_PAGE})")
    seen = 0
    try:
        for page in range(1, pages + 1):
            listings, _ = fetch_page(s, page)
            if not listings:
                break
            for L in listings:
                # SKIP sold/rented — Aldarim's API returns them, but they're not available to buy/rent.
                # (Found in recon: 74 of 231 were sold/rented. We only show what's actually on offer.)
                if (L.get("availability_status") or "").lower() not in ("available", "", None):
                    continue
                row, cat = map_listing(L)
                if not row or not row.get("property_type"):
                    continue
                (com_rows if cat == "commercial" else res_rows).append(row)
                seen += 1
            if args.limit_test and page >= args.limit_test:
                break
        if args.limit_test:
            print(f"DRY RUN — would upsert {len(res_rows)} residential + {len(com_rows)} commercial")
            for r in (res_rows[:3]):
                print("  sample:", {k: r[k] for k in ("ad_number", "property_type", "transaction_type", "city", "neighborhood", "area_m2", "price_total", "source")})
                print("    photo[0]:", (r["photo_urls"] or ["(none)"])[0][:90])
            return 0
        if res_rows:
            db.upsert_aldarim_residential_batch(res_rows)
        if com_rows:
            db.upsert_aldarim_commercial_batch(com_rows)
        # FULL-REFRESH liveness: we just fetched the COMPLETE available inventory, so any Aldarim
        # row NOT seen this run is gone (sold/rented/removed) → mark it inactive. This makes the daily
        # sync self-cleaning, so we never show a stale listing. (Replaces a separate liveness job.)
        pruned = 0
        if not args.pages or pages >= last_page:  # only prune on a FULL crawl, never a partial run
            c = db.sb()
            seen_res = [r["ad_number"] for r in res_rows]
            seen_com = [r["ad_number"] for r in com_rows]
            for tbl, seen_ads in (("aldarim_residential_listings", seen_res), ("aldarim_commercial_listings", seen_com)):
                rows = (c.table(tbl).select("ad_number").eq("source", "Aldarim").eq("active", True).execute().data) or []
                gone = [r["ad_number"] for r in rows if r["ad_number"] not in set(seen_ads)]
                for i in range(0, len(gone), 200):
                    c.table(tbl).update({"active": False}).in_("ad_number", gone[i:i + 200]).execute()
                pruned += len(gone)
        print(f"✓ Aldarim: {len(res_rows)} residential + {len(com_rows)} commercial upserted, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res_rows) + len(com_rows), notes=f"pruned={pruned}")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
