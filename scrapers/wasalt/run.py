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

# Detail-page fetch is EXPENSIVE: one extra ~400KB HTML request PER listing. Through the Saudi
# residential PROXY (cloud sweeps) that would burn the metered proxy bandwidth fast, so it's OFF by
# default. Run LOCALLY (user's own Saudi IP, free bandwidth) with WASALT_FETCH_DETAIL=1 to backfill
# the deep "Additional Information" fields (street / ad source / plan number / land number). Without
# it, the card still shows the base panel built from the FREE search-list data. (cost guard.)
FETCH_DETAIL = os.environ.get("WASALT_FETCH_DETAIL", "").strip().lower() not in ("", "0", "false", "no")

# Wasalt's property-type slugs per category (the search's propertyTypeData). Each listing still
# carries its REAL subtype in propertyInfo.propertySubType — these just drive query coverage.
SLUGS = {
    "residential": ["apartment", "villa-townhouse", "floor", "building", "land", "rest-house", "chalet", "farm", "room", "duplex"],
    "commercial":  ["shop", "office", "warehouse", "commercial-land", "showroom", "building", "land"],
}

# Wasalt propertySubType → our canonical taxonomy type. Wasalt uses DIFFERENT names than Aqar
# ("Office Space" not "Office", "Repair shop" not "Workshop", "Station" not "Gas Station",
# "Booth" not "Kiosk") — without this map the filter for "Office" wouldn't match Wasalt's
# "Office Space" rows and the kept-field contract would break.
TYPE_MAP = {
    # Residential
    "Apartment": "Apartment", "Villa": "Villa", "Townhouse": "Villa", "Duplex": "Villa",
    "Floor": "Floor", "Building": "Building", "Residential Building": "Building",
    "Land": "Residential Land", "Residential Land": "Residential Land", "Plot": "Residential Land",
    "Rest House": "Rest House", "Resthouse": "Rest House", "Chalet": "Chalet", "Farm": "Farm",
    "Room": "Room", "Small apartment (studio)": "Apartment", "Studio": "Apartment",
    # Commercial (Wasalt's names → ours)
    "Office": "Office", "Office Space": "Office",
    "Shop": "Shop", "Commercial Shop": "Shop",
    "Warehouse": "Warehouse",
    "Showroom": "Showroom",
    "Commercial Land": "Commercial Land",
    "Commercial Building": "Commercial Building", "Tower": "Commercial Building",
    "Hotel": "Hotel",
    "Workshop": "Workshop", "Repair shop": "Workshop",
    "Gas Station": "Gas Station", "Station": "Gas Station",
    "Kiosk": "Kiosk", "Booth": "Kiosk",
    "Parking": "Parking", "Car parking": "Parking",
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
    # Route through a Saudi residential proxy when WASALT_PROXY_URL is set in the env.
    # This is how the GitHub Actions cloud workflows reach wasalt.sa — Wasalt geo-blocks bare
    # datacenter IPs but accepts a Saudi residential proxy. Local runs leave the var unset and
    # use the user's own Saudi home IP directly. (user request: 24/7 cloud parity with Aqar.)
    proxy = os.environ.get("WASALT_PROXY_URL", "").strip()
    if proxy:
        s.proxies = {"http": proxy, "https": proxy}
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


# Wasalt's `additionalAttributes` LIVES ON THE DETAIL PAGE (not the search-list page). Fetching
# every detail is expensive, so we batch the slug → additional_info during a sweep IF the slug is
# new. This module-local LRU avoids re-fetching the same slug within one run.
_DETAIL_CACHE: dict[str, list[dict[str, Any]]] = {}


def _fetch_additional_attributes(s: cc.Session, slug: str) -> list[dict[str, Any]]:
    """Fetch the listing's detail page and return its additionalAttributes list (or [] on failure).
    Wasalt's detail page __NEXT_DATA__ exposes propertyDetailsV3.additionalAttributes — 20-30
    label/value rows that populate the on-site 'Additional Information' panel."""
    if slug in _DETAIL_CACHE:
        return _DETAIL_CACHE[slug]
    _throttle()  # detail fetches count toward the same politeness budget as search pages
    try:
        r = s.get(f"{BASE}/en/property/{slug}", timeout=25)
        if r.status_code != 200:
            _DETAIL_CACHE[slug] = []
            return []
        m = NEXT_RE.search(r.text)
        if not m:
            _DETAIL_CACHE[slug] = []
            return []
        pdv = (json.loads(m.group(1)).get("props", {}).get("pageProps", {})
               .get("propertyDetailsV3") or {})
        raw = pdv.get("additionalAttributes") or []
        # Keep only rows with a non-empty value the user would care about.
        keep_keys = {
            "propertyMainType", "completionYear", "propertyFacade", "street", "adSource",
            "planNumber", "landNumber", "obligations", "zipCode", "regaAdvLicDate",
            "additionalNumber", "buildingNumber", "electricityMeter", "waterMeter",
            "noOfFloors", "floorNumber", "furnishingType", "noOfParkings",
        }
        rows = []
        for a in raw:
            if not isinstance(a, dict): continue
            k = a.get("key"); lbl = a.get("label"); v = a.get("value")
            if k in keep_keys and v not in (None, "", "None"):
                rows.append({"key": k, "label": lbl, "value": v})
        _DETAIL_CACHE[slug] = rows
        return rows
    except Exception:
        _DETAIL_CACHE[slug] = []
        return []


def _base_additional_info(prop: dict, info: dict) -> list[dict[str, Any]]:
    """Build the 'Additional Information' panel from the FREE search-list data (no detail fetch).
    Covers the fields Wasalt exposes on the list page: Property usage, Age, Furniture, Facade. The
    deeper fields (Street / Ad source / Plan / Land number) only exist on the detail page and are
    added by _fetch_additional_attributes when WASALT_FETCH_DETAIL is enabled."""
    out: list[dict[str, Any]] = []
    def add(key, label, value):
        if value not in (None, "", "None"):
            out.append({"key": key, "label": label, "value": str(value)})
    add("propertyMainType", "Property usage", info.get("possessionType") or info.get("propertyMainType"))
    add("completionYear", "Age", _attr(prop, "completionYear"))
    add("furnishingType", "Furniture", info.get("furnishingType"))
    add("propertyFacade", "Facade", info.get("facingType") or _attr(prop, "facing"))
    return out


def map_property(prop: dict, deal: str, s: Optional[cc.Session] = None) -> Optional[dict[str, Any]]:
    info = prop.get("propertyInfo") or {}
    pid = prop.get("id")
    slug = info.get("slug")
    if not pid or not slug:
        return None
    sub = info.get("propertySubType") or ""
    property_type = TYPE_MAP.get(sub, sub or None)
    # Resolve the "Additional Information" panel ONCE so we can also set the detail_enriched flag.
    if FETCH_DETAIL and s is not None:
        deep = _fetch_additional_attributes(s, slug)
        addl_info = deep or _base_additional_info(prop, info)
        detail_enriched = bool(deep)  # True only when the detail page actually yielded deep rows
    else:
        addl_info = _base_additional_info(prop, info)
        detail_enriched = False
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
    def _i(v):
        try: return int(v) if v not in (None, "") else None
        except (TypeError, ValueError): return None
    bedrooms = _i(_attr(prop, "noOfBedrooms"))
    bathrooms = _i(_attr(prop, "noOfBathrooms"))
    halls_or_majlis = _i(_attr(prop, "noOfLivingRooms") or _attr(prop, "livingRooms") or _attr(prop, "noOfHalls"))
    sale_price = info.get("salePrice") or info.get("conversionPrice")
    rent_price = info.get("expectedRent")
    imgs = (prop.get("propertyFiles") or {}).get("images") or []
    photo_urls = [f"https://cdn.wasalt.sa/{i}" for i in imgs[:30] if isinstance(i, str)]

    # Aqar-parity rich fields (user request: same feature row + features grid as Aqar). Wasalt
    # exposes them on prop.attributes (key/value), propertyInfo.*, and prop.featureAmenities.
    age_raw = _attr(prop, "completionYear")  # "New" or a year-count string
    property_age = str(age_raw) if age_raw not in (None, "") else None

    # Direction / facade — Wasalt sometimes carries it on streetInfo[].en.facing or attributes.facing.
    direction = None
    for si in prop.get("streetInfo") or []:
        en = (si.get("en") or {}) if isinstance(si, dict) else {}
        if en.get("facing"):
            direction = en["facing"]; break
    if not direction:
        direction = _attr(prop, "facing") or _attr(prop, "direction")

    street_name = None
    for si in prop.get("streetInfo") or []:
        if isinstance(si, dict):
            street_name = si.get("streetName") or street_name
    if not street_name:
        street_name = info.get("streetName")

    # Wasalt's `furnishingType` → matches Aqar's "Furnished/Un-Furnished" tag; "possessionType"
    # is the property usage (Residential/Commercial). We carry both via residence_type.
    residence_type = info.get("possessionType") or None
    project_name = info.get("project") or info.get("managedBy") or None

    # Feature amenities (Wasalt's curated list of nearby amenities — Parking, Mosque, etc.). We map
    # each into the closest Aqar feature-grid boolean so the card UI lights up the same icons.
    amenities = [(a or {}).get("name", "").lower() for a in (prop.get("featureAmenities") or []) if isinstance(a, dict)]
    has = lambda *kws: any(kw in a for a in amenities for kw in kws)
    return {
        "ad_number": f"WST{pid}",
        "listing_url": f"{BASE}/en/property/{slug}",
        "source": "Wasalt",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": area_m2,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "halls": halls_or_majlis,
        "reception_rooms_majlis": halls_or_majlis,  # Wasalt doesn't separate; same number
        "property_age": property_age,
        "direction": direction,
        "street_name": street_name,
        "residence_type": residence_type,
        "project_name": project_name,
        "price_annual": int(rent_price) if (is_rent and rent_price) else None,
        "price_total": int(sale_price) if (not is_rent and sale_price) else None,
        "rent_period": "annual" if is_rent else None,
        "city": city,
        "neighborhood": info.get("zone") or info.get("address"),
        "title": info.get("title"),
        "photo_urls": photo_urls,
        "rega_location_verified": bool(prop.get("isRegaProp")),
        # "Additional Information" panel + the enriched flag (resolved above). Base rows come FREE
        # from the search-list; deep rows only when WASALT_FETCH_DETAIL=1. detail_enriched lets the
        # cloud "new-only" enricher skip rows that already have the deep fields. (cost guard.)
        "additional_info": addl_info,
        "detail_enriched": detail_enriched,
        # Feature-grid booleans the card already renders. Wasalt amenities map roughly:
        "parking":          has("parking", "garage"),
        "elevator":         has("elevator", "lift"),
        "kitchen":          has("kitchen"),
        "maid_room":        has("maid"),
        "driver_room":      has("driver"),
        "air_conditioner":  has("air condition", "ac "),
        "water_supply":     has("water"),
        "electricity":      has("electric"),
        "sanitation":       has("sewage", "sanitation", "drainage"),
        "private_entrance": has("private entrance"),
        "optical_fibers":   has("fiber", "fibre", "ftth"),
        "laundry_room":     has("laundry"),
        "balcony_terrace":  has("balcony", "terrace"),
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
            # Pass the session so map_property can fetch the detail page's additionalAttributes
            # (only on first sight of the slug — cached after that).
            row = map_property(prop, deal, s)
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
