"""Mizlaj (mizlaj.com.sa / مؤسسة مزلاج العقارية) scraper — Saudi Laravel + Inertia.js site.

مؤسسة مزلاج العقارية is a small Saudi real-estate brokerage (boutique catalog ~19 active
listings: Madinah, Tabuk, Asir, Jazan, Jeddah, Taif, Eastern). Saudi-owned + REGA-licensed
(per-listing رقم ترخيص الإعلان) → passes the Saudi-only rule. No auth, no proxy, cloud-easy.

Data path (auth-free):
  (1) GET https://mizlaj.com.sa/api/guest/listings/map-data
        → {"data":[ {id, slug, name, total_price, price_per_meter, space, reference_number,
                     ad_license_number, latitude, longitude, location:{region,city,district,...},
                     city/district/region objects (often null), advertisement_type?}, … ]}
        This is the authoritative list of EVERY listing.
  (2) For each slug, GET https://mizlaj.com.sa/guest/listings/<slug>  (Inertia HTML page).
        The page carries an Inertia <div … data-page="{…}"> blob: regex it out, HTML-unescape,
        json.loads, read props.listing → property_age, property_face (شمالي→direction),
        Arabic description, media.images[] (full https://mizlaj.com.sa/files/… URLs, no auth),
        propertyType {code=AR type word, name_ar=usage}, city/district/region {name_en},
        advertisement_type, and rega_advertisements[] (license/area/street-width/plan/utilities/
        number_of_rooms — we read ONLY the property fields, never the employee/owner PII).

TYPE: propertyType.code (Arabic) → canonical English (TYPE_MAP_AR), falling back to the listing
  `name`. ارض/عمارة route Residential vs Commercial by usage (propertyType.name_ar: تجاري /
  استعمال مختلط → commercial Land/Building). محطة→Gas Station (commercial). شقة/فيلا/دور/استراحة →
  residential. DEAL: advertisement_type Sell→Buy, Rent→Rent.

PHOTOS: props.listing.media.images[] — already full https URLs on mizlaj.com.sa/files/…, no auth.

⛔⛔ PDPL ABSOLUTE — mizlaj's props.listing EXPOSES SELLER/OWNER PII that we MUST NEVER persist:
  owner_full_name, owner_id_number (national ID), owner_phone, contract_first_name/last_name,
  contract_birth_date, contract_identification_number, contract_deed_number/owner_id,
  deed_serial_number, notes, user{…}, and inside rega_advertisements[]/rega_advertisement:
  responsible_employee_name + responsible_employee_phone_number.
  → We build additional_info from a strict WHITELIST of property/price/photo/location fields only;
    we NEVER copy props.listing wholesale, and we REDACT any 05x/+9665/9200/wa.me phone from the
    title + description text.

Usage:  python -m scrapers.mizlaj.run [--limit N] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
import html
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

from scrapers.common import db, normalize  # noqa: E402

BASE = "https://mizlaj.com.sa"
MAP_DATA = f"{BASE}/api/guest/listings/map-data"
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))

# propertyType.code (Arabic type word) → canonical English type. عمارة/ارض get usage-routed below.
TYPE_MAP_AR = {
    "شقة": "Apartment", "شقه": "Apartment", "استوديو": "Studio",
    "فيلا": "Villa", "فلة": "Villa", "دوبلكس": "Villa", "قصر": "Villa",
    "دور": "Floor", "روف": "Floor", "بيت": "House", "منزل": "House",
    "عمارة": "Building", "عماره": "Building", "بناية": "Building",
    "ارض": "Residential Land", "أرض": "Residential Land",
    "استراحة": "Rest House", "استراحه": "Rest House", "إستراحة": "Rest House", "إستراحه": "Rest House",
    "شاليه": "Chalet", "مزرعة": "Farm", "مزرعه": "Farm", "غرفة": "Room", "غرفه": "Room", "مخيم": "Camp",
    # commercial
    "محل": "Shop", "مكتب": "Office", "مستودع": "Warehouse", "معرض": "Showroom",
    "ورشة": "Workshop", "ورشه": "Workshop", "مصنع": "Factory", "فندق": "Hotel",
    "محطة": "Gas Station", "محطه": "Gas Station", "برج": "Commercial Building", "مجمع": "Commercial Building",
}
COMMERCIAL_TYPES = {
    "Shop", "Office", "Warehouse", "Showroom", "Workshop", "Factory", "Hotel",
    "Gas Station", "Commercial Building", "Commercial Land",
}
# Usage labels (propertyType.name_ar) that flip a LAND or BUILDING to commercial.
COMMERCIAL_USAGE = {"تجاري", "استعمال مختلط", "صناعي"}

# Arabic region label (map-data location.region or detail region object) → canonical English region.
REGION_AR = {
    "منطقة الرياض": "Riyadh", "الرياض": "Riyadh", "منطقة مكة المكرمة": "Makkah", "مكة المكرمة": "Makkah",
    "منطقة المدينة المنورة": "Madinah", "المدينة المنورة": "Madinah", "منطقة القصيم": "Qassim",
    "المنطقة الشرقية": "Eastern Province", "منطقة عسير": "Asir", "منطقة تبوك": "Tabuk",
    "منطقة حائل": "Hail", "منطقة جازان": "Jazan", "منطقة نجران": "Najran", "منطقة الباحة": "Al Bahah",
    "منطقة الجوف": "Al Jawf", "منطقة الحدود الشمالية": "Northern Borders",
}
# detail region.name_en (REGA English) → our canonical region label.
REGION_EN = {
    "Riyadh": "Riyadh", "Al Riyadh": "Riyadh", "Makkah Al Mukarramah": "Makkah", "Makkah": "Makkah",
    "Al Madinah Al Munawwarah": "Madinah", "Al Madinah": "Madinah", "Madinah": "Madinah",
    "Al Qassim": "Qassim", "Qassim": "Qassim", "Eastern Province": "Eastern Province",
    "Eastern Region": "Eastern Province", "Asir": "Asir", "Aseer": "Asir", "Tabuk": "Tabuk",
    "Hail": "Hail", "Ha'il": "Hail", "Jazan": "Jazan", "Jizan": "Jazan", "Najran": "Najran",
    "Al Bahah": "Al Bahah", "Al Baha": "Al Bahah", "Al Jawf": "Al Jawf", "Al Jouf": "Al Jawf",
    "Northern Borders": "Northern Borders", "Northern Border": "Northern Borders",
}
# city (English canonical) → region, used when neither region source resolves.
CITY_TO_REGION = {
    "Riyadh": "Riyadh", "Al Kharj": "Riyadh", "Diriyah": "Riyadh",
    "Jeddah": "Makkah", "Mecca": "Makkah", "Taif": "Makkah", "Rabigh": "Makkah",
    "Medina": "Madinah", "Yanbu": "Madinah", "Al Ula": "Madinah",
    "Dammam": "Eastern Province", "Khobar": "Eastern Province", "Dhahran": "Eastern Province",
    "Hofuf": "Eastern Province", "Jubail": "Eastern Province", "Qatif": "Eastern Province",
    "Hafar Al Batin": "Eastern Province",
    "Buraidah": "Qassim", "Unaizah": "Qassim", "Abha": "Asir", "Khamis Mushait": "Asir",
    "Ahad Rafidah": "Asir", "Mahayel": "Asir", "Bisha": "Asir", "Tabuk": "Tabuk", "Hail": "Hail",
    "Jazan": "Jazan", "Sabya": "Jazan", "Najran": "Najran", "Al Baha": "Al Bahah",
    "Arar": "Northern Borders", "Sakaka": "Al Jawf",
}

# REGA property_face (English) → Arabic direction word stored in `direction`.
FACE_EN_AR = {
    "Northern": "شمالي", "North": "شمالي", "Southern": "جنوبي", "South": "جنوبي",
    "Eastern": "شرقي", "East": "شرقي", "Western": "غربي", "West": "غربي",
    "North-Eastern": "شمالي شرقي", "North-Western": "شمالي غربي",
    "South-Eastern": "جنوبي شرقي", "South-Western": "جنوبي غربي",
}
# REGA property_utilities (Arabic) → canonical amenity boolean columns.
UTIL_COLS = {
    "كهرباء": "electricity", "مياه": "water_supply", "ماء": "water_supply",
    "صرف صحي": "sanitation", "ألياف ضوئية": "optical_fibers", "هاتف": None, "غاز": None,
}

# Phone / contact patterns to REDACT from title+description (PDPL).
_PHONE_RE = re.compile(
    r"(?:\+?9665\d{8}"            # +9665XXXXXXXX
    r"|00966\d{9}"                # 00966XXXXXXXXX
    r"|9200\d{6}"                 # 9200XXXXXX unified numbers
    r"|0?5\d{8}"                  # 05XXXXXXXX / 5XXXXXXXX
    r"|wa\.me/\S+"                # wa.me links
    r"|واتس\S*\s*\d[\d\s\-]{6,})"  # "واتساب 05..."
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")

DATA_PAGE_RE = re.compile(r'data-page="(.*?)"', re.S)

_last = 0.0


def _throttle() -> None:
    global _last
    wait = _last + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
    })
    return s


def _int(v: Any) -> Optional[int]:
    n = normalize.to_int(v)
    return n if n else None


def _num(v: Any) -> Optional[float]:
    if v in (None, "", "—"):
        return None
    try:
        s = str(v).translate(normalize._TRANS)
        s = re.sub(r"[^\d.]", "", s)
        return float(s) if s else None
    except (TypeError, ValueError):
        return None


def _redact(text: Optional[str]) -> Optional[str]:
    """Strip phone numbers / wa.me / contact lines from free text (PDPL)."""
    if not text:
        return text
    t = _PHONE_LOOSE.sub(" ", text)
    t = _PHONE_RE.sub(" ", t)
    t = re.sub(r"_?للاتصال[^_\n]*", " ", t)
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip() or None


def fetch_map_data(s: cc.Session) -> list[dict]:
    _throttle()
    for attempt in range(3):
        try:
            r = s.get(MAP_DATA, timeout=30, headers={"Accept": "application/json"})
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code != 200:
            time.sleep(2 * (attempt + 1)); continue
        try:
            j = r.json()
        except Exception:
            return []
        return j.get("data") or (j if isinstance(j, list) else [])
    return []


def fetch_detail(s: cc.Session, slug: str) -> Optional[dict]:
    """Fetch the Inertia page for a slug and return the parsed props.listing dict (or None)."""
    url = f"{BASE}/guest/listings/{slug}"
    _throttle()
    for attempt in range(3):
        try:
            r = s.get(url, timeout=40, allow_redirects=True)
        except Exception:
            time.sleep(1.5 * (attempt + 1)); continue
        if r.status_code != 200:
            time.sleep(1.5 * (attempt + 1)); continue
        m = DATA_PAGE_RE.search(r.text)
        if not m:
            return None
        try:
            page = json.loads(html.unescape(m.group(1)))
        except Exception:
            return None
        listing = (page.get("props") or {}).get("listing")
        if isinstance(listing, dict) and "data" in listing and isinstance(listing["data"], dict):
            listing = listing["data"]  # tolerate an Inertia resource wrapper
        return listing if isinstance(listing, dict) else None
    return None


def _approved_rega(listing: dict) -> dict:
    """Best REGA advertisement object: prefer status=='approved', else the first non-empty one.
    We only ever READ property fields from it — NEVER the employee name/phone (PDPL)."""
    ads = listing.get("rega_advertisements")
    if isinstance(ads, list) and ads:
        for a in ads:
            if isinstance(a, dict) and a.get("status") == "approved":
                return a
        for a in ads:
            if isinstance(a, dict) and (a.get("number_of_rooms") or a.get("ad_license_number")):
                return a
        if isinstance(ads[0], dict):
            return ads[0]
    single = listing.get("rega_advertisement")
    return single if isinstance(single, dict) else {}


# City suffix sometimes encoded only in the listing name ("… - الطائف"). Resolve via map_city.
def _city_from_name(name: Optional[str]) -> Optional[str]:
    if not name or " - " not in name:
        return None
    tail = name.rsplit(" - ", 1)[-1].strip()
    return normalize.map_city(tail)


def _photos(listing: dict) -> list[str]:
    media = listing.get("media") or {}
    imgs = media.get("images") if isinstance(media, dict) else None
    out: list[str] = []
    seen: set[str] = set()
    BAD = ("placeholder", "no-image", "no_image", "noimage", "default")
    if isinstance(imgs, list):
        for u in imgs:
            url = u if isinstance(u, str) else (u.get("url") or u.get("path") if isinstance(u, dict) else None)
            if not isinstance(url, str):
                continue
            if url.startswith("/"):
                url = BASE + url
            if not url.startswith("http") or any(b in url.lower() for b in BAD):
                continue
            if url not in seen:
                seen.add(url)
                out.append(url)
    return out[:25]


def map_listing(md: dict, listing: Optional[dict]) -> tuple[Optional[dict], str]:
    """Combine the map-data record `md` with the detail-page `listing` into a canonical row.
    Returns (row, category) or (None, "residential") to skip."""
    listing = listing or {}
    lid = md.get("id") or listing.get("id")
    slug = md.get("slug") or listing.get("slug")
    if not slug:
        return None, "residential"

    # ── type + category ──
    pt = listing.get("propertyType") or {}
    type_code = (pt.get("code") or pt.get("id") or "").strip() if isinstance(pt, dict) else ""
    usage = (pt.get("name_ar") or pt.get("name") or "").strip() if isinstance(pt, dict) else ""
    name = md.get("name") or listing.get("name") or ""
    property_type = TYPE_MAP_AR.get(type_code)
    if not property_type:
        property_type = normalize.map_type(name)  # fall back to the listing title
    if not property_type:
        property_type = "Residential Land"  # safe default (most ambiguous mizlaj rows are land)
    is_commercial_usage = usage in COMMERCIAL_USAGE
    # Land / Building flip to their commercial variant when the usage says so.
    if property_type == "Residential Land" and is_commercial_usage:
        property_type = "Commercial Land"
    elif property_type == "Building" and is_commercial_usage:
        property_type = "Commercial Building"
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"

    # ── transaction type ──
    adv = (listing.get("advertisement_type") or md.get("advertisement_type") or "Sell")
    adv = str(adv).strip().lower()
    is_rent = adv in ("rent", "rental", "lease") or "إيجار" in name or "للايجار" in name
    if "للبيع" in name or adv == "sell":
        is_rent = False

    # ── price ── (total_price can be a float/decimal-string like 18614666.7 → round it; using
    # _int() would strip the dot and 100× the value)
    price_raw = _num(md.get("total_price") or listing.get("total_price")
                     or md.get("min_price") or listing.get("min_price"))
    price = round(price_raw) if price_raw else None
    if not price or price < 1000:
        return None, category  # reject junk prices (<1000 SAR)
    area = _num(md.get("space") or listing.get("space"))
    # price_per_meter arrives as a DECIMAL string ("2946.17") — round the float, don't _int()
    # it (which would strip the dot → 294617). Derive from price/area when absent.
    ppm_raw = _num(md.get("price_per_meter") or listing.get("price_per_meter"))
    ppm = round(ppm_raw) if ppm_raw else None
    if not ppm and price and area and not is_rent:
        ppm = round(price / area)

    # ── REGA advertisement (property fields ONLY — never employee PII) ──
    rega = _approved_rega(listing)
    rega_lic = (md.get("ad_license_number") or listing.get("ad_license_number")
                or rega.get("ad_license_number"))
    rega_lic = str(rega_lic).strip() if rega_lic else None
    rega_status = rega.get("status")
    street_width = _num(rega.get("street_width"))
    plan_number = rega.get("plan_number")
    land_number = rega.get("land_number")
    rooms = _int(rega.get("number_of_rooms"))

    # ── bedrooms (residential only, sane range) ──
    bedrooms = rooms if (rooms and category == "residential" and 0 < rooms <= 20) else None

    # ── property age / facade ──
    age = listing.get("property_age")
    property_age = _int(age) if (age is not None and str(age).strip() != "") else None
    face_en = listing.get("property_face") or rega.get("property_face")
    direction = None
    if face_en:
        direction = FACE_EN_AR.get(str(face_en).strip(), str(face_en).strip())

    # ── location (detail objects → map-data location → name suffix) ──
    city_obj = listing.get("city") if isinstance(listing.get("city"), dict) else None
    district_obj = listing.get("district") if isinstance(listing.get("district"), dict) else None
    region_obj = listing.get("region") if isinstance(listing.get("region"), dict) else None
    md_loc = md.get("location") if isinstance(md.get("location"), dict) else {}

    city_ar = (city_obj or {}).get("name_ar") or (city_obj or {}).get("name") \
        or md_loc.get("city") or md.get("city")
    district_ar = (district_obj or {}).get("name_ar") or (district_obj or {}).get("name") \
        or md_loc.get("district")
    region_ar = (region_obj or {}).get("name_ar") or (region_obj or {}).get("name") \
        or md_loc.get("region")

    city = None
    if city_obj and city_obj.get("name_en"):
        city = normalize.map_city(city_obj.get("name_en")) or normalize.map_city(city_ar or "")
    city = city or normalize.map_city(city_ar or "") or _city_from_name(name)

    region = None
    if region_obj and region_obj.get("name_en"):
        region = REGION_EN.get(str(region_obj["name_en"]).strip())
    if not region and region_ar:
        region = REGION_AR.get(str(region_ar).strip())
    if not region and city:
        region = CITY_TO_REGION.get(city)
    if region and not city:
        city = region  # region-only listing: surface the region as the city label

    # ── PDPL-safe text ──
    title = _redact(name) or name
    description = _redact(listing.get("description"))

    # ── location detail fields from map-data location object (street/postal/building) ──
    street_name = md_loc.get("street") or None
    building_number = md_loc.get("buildingNumber") or None
    zip_code = md_loc.get("postalCode") or None
    additional_number = md_loc.get("additionalNumber") or None
    lat = md.get("latitude") or listing.get("latitude") or md_loc.get("latitude")
    lng = md.get("longitude") or listing.get("longitude") or md_loc.get("longitude")

    # ── amenity columns from REGA property_utilities ──
    amenities: dict[str, bool] = {}
    utils = rega.get("property_utilities")
    util_list = utils if isinstance(utils, list) else []
    for u in util_list:
        col = UTIL_COLS.get(str(u).strip())
        if col:
            amenities[col] = True

    # ── additional_info: STRICT WHITELIST of property/price/photo/location/REGA fields.
    # NEVER copy props.listing wholesale — it carries owner/employee PII. ──
    info: dict[str, Any] = {
        "reference_number": md.get("reference_number") or listing.get("reference_number"),
        "city_ar": city_ar or None,
        "region_ar": region_ar or None,
        "district_ar": district_ar or None,
        "property_usage_ar": usage or None,
        "property_type_ar": type_code or None,
        "property_face": (str(face_en).strip() if face_en else None),
        "rega_ad_license_number": rega_lic,
        "rega_license_end_date": rega.get("ad_license_end_date"),
        "rega_license_status": rega_status,
        "rega_property_area": rega.get("property_area"),
        "street_width_m": street_width,
        "plan_number": plan_number,
        "land_number": land_number,
        "latitude": _num(lat),
        "longitude": _num(lng),
        "is_featured": bool(md.get("is_featured") or listing.get("is_featured")),
    }
    info = {k: v for k, v in info.items() if v not in (None, "", "—", [])}

    row: dict[str, Any] = {
        "ad_number": f"MZ{lid}",
        "listing_url": f"{BASE}/guest/listings/{slug}",
        "source": "Mizlaj",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": round(area) if area else None,
        "bedrooms": bedrooms,
        "property_age": property_age,
        "direction": direction,
        "street_width_m": round(street_width) if street_width else None,
        "price_total": price if not is_rent else None,
        "price_annual": price if is_rent else None,
        "price_per_meter": ppm,
        "rent_period": ("annual" if is_rent else None),
        "city": city,
        "region": region,
        "neighborhood": district_ar or None,
        "street_name": street_name,
        "building_number": building_number,
        "zip_code": zip_code,
        "additional_number": additional_number,
        "rega_location_verified": bool(rega_lic),
        "title": title,
        "description": description,
        "photo_urls": _photos(listing),
        "additional_info": info,
    }
    row.update(amenities)
    return row, category


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    s = session()
    md_rows = fetch_map_data(s)
    if not md_rows:
        print("✗ Mizlaj: map-data returned no listings")
        return 1
    if args.limit:
        md_rows = md_rows[: args.limit]
    print(f"Mizlaj: {len(md_rows)} listings from map-data"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

    run_id = None if args.limit else db.begin_run("mizlaj")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        for md in md_rows:
            slug = md.get("slug")
            if not slug:
                continue
            listing = fetch_detail(s, slug)
            row, cat = map_listing(md, listing)
            if not row:
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            seen += 1

        if res:
            db.upsert_mizlaj_residential_batch(res)
        if com:
            db.upsert_mizlaj_commercial_batch(com)

        if args.limit:
            print(f"✓ Mizlaj VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            for r in (res + com)[:8]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "price_total", "price_per_meter")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:74])
            if run_id is None:
                return 0

        # Full run: prune listings active before but not seen this crawl (we fetched the FULL catalog).
        pruned = 0
        for tbl, rows_seen in (("mizlaj_residential_listings", res),
                               ("mizlaj_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Mizlaj")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Mizlaj: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"pruned={pruned}")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
