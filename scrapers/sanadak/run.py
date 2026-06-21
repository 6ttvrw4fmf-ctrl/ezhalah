"""Sanadak (sanadak.sa / منصة سندك العقارية) scraper — Saudi Next.js/RSC site, REGA-integrated.

سندك is a Saudi-owned, REGA-integrated property platform (FAL license per listing, links to
rega.gov.sa, .sa, Arabic-first). Saudi-only rule: PASS. ~1,164 active listings (931 res + 233 com).
No auth, no proxy, no geo-block (CloudFront).

Data path: NO public JSON API. Enumerate ALL active listings from /sitemap.xml (1,164
/property-details/{slug}-{advertisementNumber} URLs — sitemap carries only published listings), then
fetch each with the `RSC: 1` header → a text/x-component flight payload that embeds the full listing
JSON. Parse the listing object by balanced braces (anchored on "advertisementNumber"); the `media`
field is a lazy RSC ref, so image URLs are pulled from the CloudFront URLs in the body.

Field map (Sanadak → our schema):
  price                              → price_total | price_annual
  lotSize                            → area_m2 (reliable; built area often 0)
  numberBedrooms / numberBathrooms   → bedrooms / bathrooms
  propertyType (EN) + propertyTypeText (AR) → property_type (TYPE_MAP) + res/com routing
  listingType  Sale|Rent             → transaction_type Buy|Rent
  city (AR) + district               → city (map_city) + neighborhood ; region derived from city
  sellerLicenseNumber (FAL) + advertisementNumber (REGA) → rega + ad_number; additional_info
  media / cloudfront URLs            → photo_urls
  isPublished / listingStatusText منشور → keep only published
  NEVER store sellerName/sellerPhonenumber/sellerWhatsAppNumber (PDPL — personal data).

Usage:  python -m scrapers.sanadak.run [--limit-test] [--type residential|commercial|all]
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

from scrapers.common import db, normalize

BASE = "https://sanadak.sa"
SITEMAP = f"{BASE}/sitemap.xml"
CDN = "dp57m2l5m3m9o.cloudfront.net"
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.35"))

TYPE_MAP = {
    "Apartment": "Apartment", "Villa": "Villa", "Floor": "Floor", "Building": "Building",
    "Duplex": "Villa", "Palace": "Villa", "Room": "Room", "RestHouse": "Rest House",
    "Chalet": "Chalet", "Farm": "Farm", "Land": "Residential Land", "House": "House",
    "Townhouse": "Villa", "Studio": "Apartment", "Penthouse": "Apartment",
    # commercial
    "Office": "Office", "Shop": "Shop", "Showroom": "Showroom", "Warehouse": "Warehouse",
    "CommercialLand": "Commercial Land", "CommercialBuilding": "Commercial Building",
    "Workshop": "Workshop", "Hotel": "Hotel", "Station": "Gas Station", "Factory": "Factory",
}
TYPE_MAP_AR = {
    "شقة": "Apartment", "فيلا": "Villa", "دور": "Floor", "عمارة": "Building", "قصر": "Villa",
    "غرفة": "Room", "استراحة": "Rest House", "إستراحة": "Rest House", "شاليه": "Chalet",
    "مزرعة": "Farm", "أرض": "Residential Land", "ارض": "Residential Land", "بيت": "House",
    "دوبلكس": "Villa", "روف": "Floor",
    "مكتب": "Office", "محل": "Shop", "معرض": "Showroom", "مستودع": "Warehouse",
    "ورشة": "Workshop", "فندق": "Hotel", "مصنع": "Factory", "أرض تجارية": "Commercial Land",
}
COMMERCIAL_TYPES = {"Office", "Shop", "Showroom", "Warehouse", "Commercial Land",
                    "Commercial Building", "Workshop", "Hotel", "Gas Station", "Factory"}

# city (Arabic) → canonical English + region.
CITY_AR = {
    "الرياض": "Riyadh", "جدة": "Jeddah", "مكة": "Mecca", "مكة المكرمة": "Mecca", "المدينة": "Medina",
    "المدينة المنورة": "Medina", "الدمام": "Dammam", "الخبر": "Khobar", "الظهران": "Dhahran",
    "الأحساء": "Hofuf", "الهفوف": "Hofuf", "الطائف": "Taif", "بريدة": "Buraidah", "عنيزة": "Unaizah",
    "أبها": "Abha", "خميس مشيط": "Khamis Mushait", "تبوك": "Tabuk", "حائل": "Hail", "جازان": "Jazan",
    "نجران": "Najran", "الباحة": "Al Baha", "عرعر": "Arar", "سكاكا": "Sakaka", "ينبع": "Yanbu",
    "الجبيل": "Jubail", "القطيف": "Qatif", "الخرج": "Al Kharj", "الدرعية": "Diriyah",
}
CITY_TO_REGION = {
    "Riyadh": "Riyadh", "Al Kharj": "Riyadh", "Diriyah": "Riyadh",
    "Jeddah": "Makkah", "Mecca": "Makkah", "Taif": "Makkah",
    "Medina": "Madinah", "Yanbu": "Madinah",
    "Dammam": "Eastern Province", "Khobar": "Eastern Province", "Dhahran": "Eastern Province",
    "Hofuf": "Eastern Province", "Jubail": "Eastern Province", "Qatif": "Eastern Province",
    "Buraidah": "Qassim", "Unaizah": "Qassim", "Abha": "Asir", "Khamis Mushait": "Asir",
    "Tabuk": "Tabuk", "Hail": "Hail", "Jazan": "Jazan", "Najran": "Najran",
    "Al Baha": "Al Bahah", "Arar": "Northern Borders", "Sakaka": "Al Jawf",
}

_last = 0.0


def _throttle() -> None:
    global _last
    wait = _last + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()


def session() -> cc.Session:
    return cc.Session(impersonate="chrome124")


def _int(v: Any) -> Optional[int]:
    try:
        return int(float(v)) if v not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        return None


def sitemap_urls(s: cc.Session) -> list[str]:
    r = s.get(SITEMAP, timeout=30)
    return re.findall(r"<loc>([^<]*property-details[^<]*)</loc>", r.text)


def _extract_obj(body: str, anchor: str = '"advertisementNumber"') -> Optional[dict]:
    i = body.find(anchor)
    if i < 0:
        return None
    depth = 0
    start = None
    for j in range(i, -1, -1):
        c = body[j]
        if c == "}":
            depth += 1
        elif c == "{":
            if depth == 0:
                start = j
                break
            depth -= 1
    if start is None:
        return None
    depth = 0
    for k in range(start, len(body)):
        c = body[k]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(body[start:k + 1])
                except Exception:
                    return None
    return None


def _images(body: str) -> list[str]:
    urls = re.findall(rf"https://{re.escape(CDN)}/[^\s\"\\]+\.(?:jpe?g|png|webp)", body)
    seen, out = set(), []
    for u in urls:
        base = re.sub(r"-\d+x\d+(?=\.)", "", u)  # collapse size variants
        if base not in seen:
            seen.add(base)
            out.append(u)
        if len(out) >= 8:
            break
    return out


def map_listing(o: dict, body: str, url: str) -> tuple[Optional[dict], str]:
    if not o.get("isPublished", True):
        return None, "residential"
    ad = o.get("advertisementNumber") or o.get("adNumber") or o.get("id")
    type_en = (o.get("propertyType") or "").strip()
    type_ar = (o.get("propertyTypeText") or "").strip()
    property_type = TYPE_MAP.get(type_en) or TYPE_MAP_AR.get(type_ar) or "Residential Land"
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"
    is_rent = (o.get("listingType") or "").strip().lower() == "rent" or "إيجار" in (o.get("listingTypeText") or "")

    raw_city = (o.get("city") or "").strip()
    city = CITY_AR.get(raw_city) or normalize.map_city(raw_city) or "Other"
    region = CITY_TO_REGION.get(city)
    price = _int(o.get("price"))

    extra = []
    for key, label in (("sellerLicenseNumber", "Ad license number"), ("advertisementNumber", "Ad number"),
                       ("streetWidth", "Street width"), ("landNumber", "Land number"),
                       ("documentType", "Deed type"), ("propertyFacingDirection", "Facade")):
        v = o.get(key)
        if v not in (None, "", 0, "0"):
            extra.append({"key": key, "label": label, "value": str(v)})

    row = {
        "ad_number": f"SN{ad}",
        "listing_url": url,
        "source": "Sanadak",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": _int(o.get("lotSize")),
        "bedrooms": _int(o.get("numberBedrooms")),
        "bathrooms": _int(o.get("numberBathrooms")),
        "price_total": price if not is_rent else None,
        "price_annual": price if is_rent else None,
        "rent_period": "annual" if is_rent else None,
        "city": city,
        "region": region,
        "neighborhood": o.get("district") or None,
        "title": o.get("title") or None,
        "photo_urls": _images(body),
        "rega_location_verified": bool(o.get("sellerLicenseNumber")),
        "additional_info": extra,
    }
    return row, category


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit-test", type=int, default=0, help="dry-run: process N listings, no DB write")
    args = ap.parse_args()

    s = session()
    urls = sitemap_urls(s)
    print(f"Sanadak: {len(urls)} listings from sitemap")
    run_id = None if args.limit_test else db.begin_run("sanadak")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        for idx, u in enumerate(urls):
            if args.limit_test and seen >= args.limit_test:
                break
            _throttle()
            try:
                body = s.get(u, timeout=30, headers={"RSC": "1"}).text
            except Exception:
                continue
            o = _extract_obj(body)
            if not o:
                continue
            row, cat = map_listing(o, body, u)
            if not row:
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            seen += 1
            if not args.limit_test and seen % 200 == 0:
                print(f"  …{seen}/{len(urls)}", flush=True)

        if args.limit_test:
            print(f"DRY RUN — {len(res)} residential + {len(com)} commercial")
            for r in (res + com)[:6]:
                print("  ", {k: r[k] for k in ("ad_number", "property_type", "transaction_type", "city", "region", "neighborhood", "area_m2", "bedrooms", "price_total", "price_annual")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:70])
            return 0

        if res:
            db.upsert_sanadak_residential_batch(res)
        if com:
            db.upsert_sanadak_commercial_batch(com)
        pruned = 0
        c = db.sb()
        for tbl, rows_seen in (("sanadak_residential_listings", res), ("sanadak_commercial_listings", com)):
            seen_ads = {r["ad_number"] for r in rows_seen}
            existing = (c.table(tbl).select("ad_number").eq("source", "Sanadak").eq("active", True).execute().data) or []
            gone = [r["ad_number"] for r in existing if r["ad_number"] not in seen_ads]
            for i in range(0, len(gone), 200):
                c.table(tbl).update({"active": False}).in_("ad_number", gone[i:i + 200]).execute()
            pruned += len(gone)
        print(f"✓ Sanadak: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"pruned={pruned}")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
