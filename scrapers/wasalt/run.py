"""Wasalt scraper → writes into the SAME tables as Aqar, tagged source='Wasalt'.

Wasalt (wasalt.sa) is a Next.js app: every search page embeds a `__NEXT_DATA__` JSON blob whose
`searchResult.properties` is a list of 32 fully-structured listings (price, city, district, type,
beds, area, photos). So unlike Aqar (discover URLs → enrich each page), here ONE search-page fetch
yields 32 complete listings — fast and clean.

Search endpoint (paginated, 1-indexed, 32/page):
  https://wasalt.sa/en/{sale|rent}/search?propertyFor={sale|rent}&countryId=1&type={residential|commercial}&propertyTypeData={SLUG}&page={N}

Each listing is mapped onto the aqar_*_listings schema and upserted with a namespaced ad_number
("WST<id>") so it never collides with an Aqar ad number, and source='Wasalt' so the app shows
"Hosted on Wasalt" and opens the wasalt.sa listing on click.

Usage (from ezhalah-app/ with the venv active):
    python -m scrapers.wasalt.run --deal sale --type residential --slug apartment --pages 3
    python -m scrapers.wasalt.run --all --pages 200          # full sweep, all types × sale+rent
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db

BASE = "https://wasalt.sa"
NEXT_RE = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.4"))
PAGE_SIZE = 32

# Wasalt's property-type slugs per category (the search's propertyTypeData). Each listing still
# carries its REAL subtype in propertyInfo.propertySubType — these just drive query coverage.
SLUGS = {
    "residential": ["apartment", "villa-townhouse", "floor", "building", "land", "rest-house", "chalet", "farm", "room", "duplex"],
    "commercial":  ["shop", "office", "warehouse", "commercial-land", "showroom", "building", "land"],
}

# Wasalt propertySubType (English) → our canonical taxonomy type. Unknowns fall back to the raw value.
TYPE_MAP = {
    "Apartment": "Apartment", "Villa": "Villa", "Townhouse": "Villa", "Duplex": "Villa",
    "Floor": "Floor", "Building": "Building", "Residential Building": "Building",
    "Land": "Residential Land", "Residential Land": "Residential Land", "Plot": "Residential Land",
    "Rest House": "Rest House", "Resthouse": "Rest House", "Chalet": "Chalet", "Farm": "Farm",
    "Room": "Room", "Office": "Office", "Shop": "Shop", "Commercial Shop": "Shop",
    "Warehouse": "Warehouse", "Showroom": "Showroom", "Commercial Land": "Commercial Land",
    "Commercial Building": "Commercial Building", "Hotel": "Hotel", "Workshop": "Workshop",
}

# Wasalt city spelling → our canonical DB city label. Wasalt transliterates inconsistently
# ("Aldammam", "Makkah Al Mukarramah", "Alttayif"), so this map is REQUIRED or a city search would
# never match the Wasalt rows. Covers the observed high-volume spellings; unmapped → "Other".
CITY_MAP = {
    "Riyadh": "Riyadh", "Jeddah": "Jeddah", "Khobar": "Khobar", "Al Khobar": "Khobar",
    "Makkah Al Mukarramah": "Mecca", "Makkah": "Mecca", "Mecca": "Mecca",
    "Aldammam": "Dammam", "Al Dammam": "Dammam", "Dammam": "Dammam",
    "Madinah": "Medina", "Al Madinah Al Munawwarah": "Medina", "Medina": "Medina",
    "Alttayif": "Taif", "Al Taif": "Taif", "Taif": "Taif",
    "Al Ahsa": "Hofuf", "Al Hofuf": "Hofuf", "Hofuf": "Hofuf",
    "Alzahran": "Dhahran", "Dhahran": "Dhahran",
    "Khamis Mushayt": "Khamis Mushait", "Khamis Mushait": "Khamis Mushait",
    "Eanizah": "Unaizah", "Unaizah": "Unaizah", "Bariduh": "Buraidah", "Buraidah": "Buraidah",
    "Almuzahimih": "Al Muzahimiyah", "Thawl": "Thuwal",
    "Jubail Industrial City": "Jubail", "Jubail": "Jubail", "Al Jubail": "Jubail",
    "Alqunafdhuh": "Al Qunfudhah", "Al Qatif": "Qatif", "Qatif": "Qatif",
    "Jazan": "Jazan", "Abha": "Abha", "Abqaiq": "Abqaiq", "Diriyah": "Diriyah",
    "Al Kharj": "Al Kharj", "Al Baha": "Al Baha", "Al-Namas": "Al Namas", "Najran": "Najran",
    "Tabuk": "Tabuk", "Hail": "Hail", "Arar": "Arar", "Sakaka": "Sakaka", "Yanbu": "Yanbu",
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
    s.headers.update({"Accept-Language": "en,ar;q=0.8"})
    return s


def fetch_page(s: cc.Session, deal: str, cat: str, slug: str, page: int) -> tuple[int, int, list[dict]]:
    """Return (count, total_pages, properties[]) for one search page."""
    seg = "sale" if deal == "sale" else "rent"
    url = (f"{BASE}/en/{seg}/search?propertyFor={deal}&countryId=1&type={cat}"
           f"&propertyTypeData={slug}&page={page}")
    _throttle()
    for attempt in range(3):
        try:
            r = s.get(url, timeout=30)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code != 200:
            time.sleep(2 * (attempt + 1)); continue
        m = NEXT_RE.search(r.text)
        if not m:
            return 0, 0, []
        sr = (json.loads(m.group(1)).get("props", {}).get("pageProps", {}).get("searchResult") or {})
        props = [p for p in (sr.get("properties") or []) if isinstance(p, dict)]
        return int(sr.get("count") or 0), int(sr.get("totalPages") or 0), props
    return 0, 0, []


def _attr(prop: dict, key: str) -> Any:
    for a in prop.get("attributes") or []:
        if a.get("key") == key:
            return a.get("value")
    return None


def map_property(prop: dict, deal: str) -> Optional[dict[str, Any]]:
    info = prop.get("propertyInfo") or {}
    pid = prop.get("id")
    slug = info.get("slug")
    if not pid or not slug:
        return None
    sub = info.get("propertySubType") or ""
    property_type = TYPE_MAP.get(sub, sub or None)
    raw_city = (info.get("city") or info.get("state") or "").strip()
    # Map to our canonical label; an unmapped/garbled Wasalt spelling → "Other" (honest, won't pollute
    # a real city search). High-volume cities are all covered in CITY_MAP.
    city = CITY_MAP.get(raw_city) or "Other"
    is_rent = deal == "rent"
    area = _attr(prop, "builtUpArea") or info.get("builtUpArea") or prop.get("floorSize")
    try:
        area_m2 = int(float(area)) if area not in (None, "", "0") else None
    except (TypeError, ValueError):
        area_m2 = None
    beds = _attr(prop, "noOfBedrooms")
    try:
        bedrooms = int(beds) if beds not in (None, "") else None
    except (TypeError, ValueError):
        bedrooms = None
    sale_price = info.get("salePrice") or info.get("conversionPrice")
    rent_price = info.get("expectedRent")
    imgs = (prop.get("propertyFiles") or {}).get("images") or []
    photo_urls = [f"https://cdn.wasalt.sa/{i}" for i in imgs[:30] if isinstance(i, str)]
    return {
        "ad_number": f"WST{pid}",
        "listing_url": f"{BASE}/en/property/{slug}",
        "source": "Wasalt",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": area_m2,
        "bedrooms": bedrooms,
        "price_annual": int(rent_price) if (is_rent and rent_price) else None,
        "price_total": int(sale_price) if (not is_rent and sale_price) else None,
        "rent_period": "annual" if is_rent else None,
        "city": city,
        "neighborhood": info.get("zone") or info.get("address"),
        "title": info.get("title"),
        "photo_urls": photo_urls,
        "rega_location_verified": bool(prop.get("isRegaProp")),
    }


def upsert(row: dict, main_type: str) -> None:
    # Residential → its own Wasalt table. Commercial Wasalt is a later milestone (separate table);
    # skip commercial rows for now so a residential sweep that bumps into one doesn't error.
    if main_type == "Commercial":
        return
    db.upsert_wasalt_residential(row)


def scrape_slice(s, deal: str, cat: str, slug: str, *, max_pages: int) -> int:
    count, total_pages, _ = fetch_page(s, deal, cat, slug, 1)
    pages = min(max_pages, total_pages or max_pages)
    print(f"\n── WASALT {slug.upper():<16} {deal.upper():<4} {cat.upper():<11} count={count} pages≤{pages}")
    is_commercial = cat == "commercial"
    upserter = db.upsert_wasalt_commercial_batch if is_commercial else db.upsert_wasalt_residential_batch
    upserted = 0
    for page in range(1, pages + 1):
        _, _, props = fetch_page(s, deal, cat, slug, page)
        if not props:
            break
        batch = []
        for prop in props:
            row = map_property(prop, deal)
            if not row or not row.get("property_type"):
                continue
            batch.append(row)
        if batch:
            try:
                upserter(batch)  # one round-trip per page
                upserted += len(batch)
            except Exception as e:
                print(f"   ✗ batch upsert failed (page {page}): {str(e)[:90]}")
        if page % 20 == 0:
            print(f"   [{page}/{pages}] upserted so far: {upserted}")
    print(f"   ✓ {slug}/{deal}: {upserted} upserted")
    return upserted


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--deal", choices=["sale", "rent"], default="sale")
    p.add_argument("--type", choices=["residential", "commercial"], default="residential")
    p.add_argument("--slug", default="apartment")
    p.add_argument("--pages", type=int, default=3)
    p.add_argument("--all", action="store_true", help="sweep every type × sale+rent")
    args = p.parse_args()

    s = session()
    run_id = db.begin_run("wasalt")
    total = 0
    try:
        if args.all:
            for cat, slugs in SLUGS.items():
                for slug in slugs:
                    for deal in ("sale", "rent"):
                        total += scrape_slice(s, deal, cat, slug, max_pages=args.pages)
        else:
            total = scrape_slice(s, args.deal, args.type, args.slug, max_pages=args.pages)
        ok = True
        notes = f"upserted={total}"
    except Exception as e:
        ok = False
        notes = str(e)[:400]
        print(f"\n✗ FATAL: {e}")
    finally:
        db.end_run(run_id, ok=ok, rows_seen=total, rows_upserted=total, notes=notes)
    print(f"\n📊 Wasalt done. {total} upserted. (run_id={run_id})")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
