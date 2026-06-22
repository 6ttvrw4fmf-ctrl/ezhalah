"""Aqar City (aqarcity.net / عقار ستي) scraper — Saudi Laravel/jQuery site, server-rendered HTML.

عقار ستي is a Saudi property platform with per-listing REGA advertising licences (رقم ترخيص الإعلان)
and broker FAL licences (رخصة فال). ~2,267 listings in the sitemap. Behind Cloudflare; it sets an
APP_SESSION_MANAGER cookie on first hit (a fresh request may 302→/notfound until the cookie lands),
so we WARM the session once then fetch with cookies kept. No proxy needed.

Data path: NO public JSON API. Enumerate /property/<id> URLs from the gzipped child sitemap
(sitemap-index.xml → sitemap-1.xml.gz), then fetch each detail page. Active pages embed two
<script type="application/ld+json"> blocks:
  • Residence/Product + Offer → name, description, offers.price + unitText(YEAR/MONTH),
    geo lat/lng, address(street/city/region/postal), image[] (full + thumbnail variants),
    datePublished/dateModified, identifier/sku.
  • BreadcrumbList → city / district / category.
Plus a `pi-item__label`/`pi-item__value` spec table in the visible HTML:
  التصنيف(type) · مساحة العقار(area) · عدد الغرف(beds) · عمر العقار(age) · واجهة العقار(direction) ·
  عرض الشارع(street width) · خدمات العقار(services) · license create/expiry dates + status · use ·
  plan/parcel numbers · deed location text. EXPIRED listings render a "هذا الإعلان منتهي" shell with
  no JSON-LD → skipped.

PDPL: the page exposes the advertiser NAME (seller.name / المعلن …) and the description free-text
frequently embeds the advertiser's 05x phone — we NEVER store the name and REDACT every phone /
wa.me link from title + description before storing. Advertiser TYPE only (not name/number) is fine.

Field map (Aqar City → our schema):
  offers.price + unitText YEAR|MONTH      → price_total | price_annual (+ rent_period)
  مساحة العقار / area_m2                   → area_m2
  عدد الغرف                                → bedrooms
  التصنيف (AR) / breadcrumb category       → property_type (TYPE_MAP) + res/com routing
  للبيع|سكني sale vs للإيجار rent          → transaction_type Buy|Rent
  addressLocality (AR) + breadcrumb city   → city (CITY_AR/map_city) ; region from addressRegion
  district (breadcrumb) / حي               → neighborhood
  رقم ترخيص الإعلان (from desc) + dates     → additional_info (REGA panel)
  رخصة فال                                 → additional_info (broker license)
  geo lat/lng, postal, street, plot/plan   → additional_info
  image[] (full-size only)                 → photo_urls

Usage:  python -m scrapers.aqarcity.run [--limit N] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from gzip import decompress
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db, normalize  # noqa: E402

BASE = "https://www.aqarcity.net"
SITEMAP_INDEX = f"{BASE}/sitemaps/sitemap-index.xml"
SITEMAP_FALLBACK = f"{BASE}/sitemap.xml"
# Cloudflare-fronted origin; keep concurrency gentle (same spirit as Sanadak's 4 workers).
WORKERS = int(os.environ.get("AQARCITY_WORKERS", "4"))

# Arabic property-type word (from التصنيف / breadcrumb) → canonical English. The site uses some
# verbose labels (e.g. "شقَّة صغيرة (استوديو)") so we substring-match after exact lookup.
TYPE_MAP_AR = {
    "شقة": "Apartment", "شقه": "Apartment", "شقَّة": "Apartment", "استوديو": "Studio",
    "فيلا": "Villa", "فلة": "Villa", "دوبلكس": "Villa", "قصر": "Villa",
    "دور": "Floor", "روف": "Floor", "بيت": "House", "منزل": "House",
    "عمارة": "Building", "عماره": "Building", "بناية": "Building",
    "أرض": "Residential Land", "ارض": "Residential Land",
    "استراحة": "Rest House", "استراحه": "Rest House", "شاليه": "Chalet",
    "مزرعة": "Farm", "مزرعه": "Farm", "غرفة": "Room", "غرفه": "Room",
    # commercial
    "محل": "Shop", "مكتب": "Office", "مستودع": "Warehouse", "معرض": "Showroom",
    "ورشة": "Workshop", "ورشه": "Workshop", "مصنع": "Factory", "فندق": "Hotel",
    "محطة": "Gas Station", "برج": "Commercial Building", "مجمع": "Commercial Building",
}
COMMERCIAL_TYPES = {
    "Shop", "Office", "Warehouse", "Showroom", "Workshop", "Factory", "Hotel",
    "Gas Station", "Commercial Building", "Commercial Land",
}

# Arabic region label → canonical English region (from address.addressRegion, e.g. "منطقة مكة المكرمة").
REGION_AR = {
    "الرياض": "Riyadh", "مكة": "Makkah", "مكه": "Makkah", "المدينة": "Madinah",
    "الشرقية": "Eastern Province", "القصيم": "Qassim", "عسير": "Asir", "تبوك": "Tabuk",
    "حائل": "Hail", "جازان": "Jazan", "نجران": "Najran", "الباحة": "Al Bahah",
    "الحدود الشمالية": "Northern Borders", "الجوف": "Al Jawf",
}
# city (English canonical) → region, used when addressRegion is missing.
CITY_TO_REGION = {
    "Riyadh": "Riyadh", "Al Kharj": "Riyadh", "Diriyah": "Riyadh",
    "Jeddah": "Makkah", "Mecca": "Makkah", "Taif": "Makkah",
    "Medina": "Madinah", "Yanbu": "Madinah",
    "Dammam": "Eastern Province", "Khobar": "Eastern Province", "Dhahran": "Eastern Province",
    "Hofuf": "Eastern Province", "Jubail": "Eastern Province", "Qatif": "Eastern Province",
    "Hafar Al Batin": "Eastern Province",
    "Buraidah": "Qassim", "Unaizah": "Qassim", "Abha": "Asir", "Khamis Mushait": "Asir",
    "Ahad Rafidah": "Asir", "Tabuk": "Tabuk", "Hail": "Hail", "Jazan": "Jazan",
    "Najran": "Najran", "Al Baha": "Al Bahah", "Arar": "Northern Borders", "Sakaka": "Al Jawf",
}

# Spec-table services (خدمات العقار) → canonical amenity columns.
SERVICE_COLS = {
    "كهرباء": "electricity", "مياه": "water_supply", "ماء": "water_supply",
    "صرف صحي": "sanitation", "هاتف": None, "ألياف ضوئية": "optical_fibers",
    "تصريف الفيضانات": None, "غاز": None,
}

# Phone / contact patterns to REDACT from title+description (PDPL).
_PHONE_RE = re.compile(
    r"(?:\+?9665\d{8}"            # +9665XXXXXXXX
    r"|00966\d{9}"                # 00966XXXXXXXXX
    r"|0?5\d{8}"                  # 05XXXXXXXX / 5XXXXXXXX
    r"|wa\.me/\S+"                # wa.me links
    r"|واتس\S*\s*\d[\d\s\-]{6,})"  # "واتساب 05..."
)
# Decorative wrappers the contact number is sometimes wrapped in: ((05..)), [05..], 05.5.5...
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")

PI_RE = re.compile(
    r'pi-item__label\">\s*(?:<i[^>]*></i>)?\s*(.*?)\s*</div>\s*'
    r'<div class="pi-item__value">\s*(.*?)\s*</div>',
    re.S,
)
LDJSON_RE = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)

_local = threading.local()


def _session() -> cc.Session:
    s = getattr(_local, "s", None)
    if s is None:
        s = cc.Session(impersonate="chrome124")
        s.headers.update({
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
        })
        _local.s = s
    return s


def session() -> cc.Session:
    return cc.Session(impersonate="chrome124")


def _int(v: Any) -> Optional[int]:
    n = normalize.to_int(v)
    return n if n else None


def _float(v: Any) -> Optional[float]:
    if v in (None, "", "—"):
        return None
    try:
        s = str(v).translate(normalize._TRANS)
        s = re.sub(r"[^\d.]", "", s)
        return float(s) if s else None
    except (TypeError, ValueError):
        return None


def _strip_tags(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def _redact(text: Optional[str]) -> Optional[str]:
    """Remove phone numbers / wa.me / contact blocks from free text (PDPL)."""
    if not text:
        return text
    t = _PHONE_LOOSE.sub(" ", text)
    t = _PHONE_RE.sub(" ", t)
    # the line that introduces the contact ("للاتصال والاستفسار") often survives — drop trailing digits
    t = re.sub(r"_?للاتصال[^_\n]*", " ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t or None


# ── Sitemap enumeration ───────────────────────────────────────────────────────
def sitemap_urls(s: cc.Session) -> list[str]:
    """Return /property/<id> URLs from the gzipped child sitemap (fallback: plain sitemap.xml)."""
    urls: list[str] = []
    try:
        idx = s.get(SITEMAP_INDEX, timeout=30).text
        children = re.findall(r"<loc>([^<]+)</loc>", idx)
        for child in children:
            try:
                r = s.get(child, timeout=30)
                body = decompress(r.content).decode("utf-8", "replace") if child.endswith(".gz") else r.text
            except Exception:
                continue
            urls += re.findall(r"<loc>([^<]+/property/\d+)</loc>", body)
    except Exception:
        pass
    if not urls:  # fallback
        try:
            body = s.get(SITEMAP_FALLBACK, timeout=30).text
            urls = re.findall(r"<loc>([^<]+/property/\d+)</loc>", body)
        except Exception:
            pass
    # de-dup, keep ONLY /property/<id> (exclude /properties/, /property/create, etc.)
    seen, out = set(), []
    for u in urls:
        if re.search(r"/property/\d+$", u) and u not in seen:
            seen.add(u)
            out.append(u)
    # newest ids first (active listings cluster at the top)
    out.sort(key=lambda u: int(re.search(r"/property/(\d+)", u).group(1)), reverse=True)
    return out


def fetch_one(url: str) -> Optional[tuple[str, str]]:
    """Warm the session (Cloudflare cookie) then fetch the detail page. Returns (body, url) or None."""
    s = _session()
    for attempt in range(3):
        try:
            # First call warms APP_SESSION_MANAGER; the page itself is also returned on the 2nd call.
            s.get(url, timeout=45, allow_redirects=True)
            r = s.get(url, timeout=45, allow_redirects=True)
        except Exception:
            time.sleep(1.5 * (attempt + 1))
            continue
        if r.status_code == 200 and "/property/" in str(r.url):
            return r.text, url
        time.sleep(1.0 * (attempt + 1))
    return None


# ── Parsing ────────────────────────────────────────────────────────────────────
def _ld_blocks(body: str) -> tuple[Optional[dict], Optional[dict]]:
    """Return (listing_obj, breadcrumb_obj) from the page's ld+json scripts."""
    listing = breadcrumb = None
    for raw in LDJSON_RE.findall(body):
        try:
            d = json.loads(raw)
        except Exception:
            continue
        t = d.get("@type")
        if t == "BreadcrumbList":
            breadcrumb = d
        elif t in ("Residence", "Product", "Place", "Offer", "House", "Apartment", "Accommodation"):
            listing = d
        elif listing is None and isinstance(d.get("offers"), dict):
            listing = d
    return listing, breadcrumb


def _pi_table(body: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for m in PI_RE.finditer(body):
        k = _strip_tags(m.group(1))
        v = _strip_tags(m.group(2))
        if k and v and v != "—":
            out[k] = v
    return out


def _breadcrumb_parts(bc: Optional[dict]) -> dict[str, str]:
    parts: dict[str, str] = {}
    if not bc:
        return parts
    for it in bc.get("itemListElement", []):
        item = it.get("item", "")
        name = (it.get("name") or "").strip()
        if "/city/" in item:
            parts["city"] = name
        elif "/district/" in item:
            parts["district"] = name
        elif "/category/" in item:
            parts["category"] = name
    return parts


def _map_type(*candidates: str) -> Optional[str]:
    for c in candidates:
        if not c:
            continue
        c = c.strip()
        if c in TYPE_MAP_AR:
            return TYPE_MAP_AR[c]
        for word, eng in TYPE_MAP_AR.items():
            if word in c:
                return eng
    return None


def _images(ld: Optional[dict], body: str) -> list[str]:
    """Photos for the card. Prefer the full-size /properties/<file> URL; if a listing only has the
    /thumbnails/<file> variant on the page (because the full-size was deleted on the CDN), keep the
    thumbnail rather than dropping the listing to zero photos — better small image than no image.
    For each thumbnail we also try the synthesised full-size URL (strip '/thumbnails/'): the client
    onError fallback will skip it cheaply if the file doesn't exist.

    Also drops listings' 'no-image' placeholders."""
    fulls: list[str] = []
    thumbs: list[str] = []
    seen: set[str] = set()
    BAD = ("no_image", "no-image", "noimage")

    def add(bucket: list[str], u: str) -> None:
        if any(b in u.lower() for b in BAD):
            return
        if u in seen:
            return
        seen.add(u)
        bucket.append(u)

    if ld:
        for u in ld.get("image", []) or []:
            if not isinstance(u, str):
                continue
            (thumbs if "/thumbnails/" in u else fulls).append(u) if False else add(
                thumbs if "/thumbnails/" in u else fulls, u)
    for u in re.findall(r"https://www\.aqarcity\.net/public/upload/properties/(?:thumbnails/)?[^\s\"'\\]+?\.(?:jpe?g|png|webp)", body):
        add(thumbs if "/thumbnails/" in u else fulls, u)

    # When we only have thumbnails, also try the synthesised full-size URL ahead of each thumb so
    # the card prefers the higher-res file when it exists.
    if not fulls and thumbs:
        out: list[str] = []
        for tu in thumbs:
            synth = tu.replace("/thumbnails/", "/")
            if synth not in out and not any(b in synth.lower() for b in BAD):
                out.append(synth)
            if tu not in out:
                out.append(tu)
        return out[:25]

    return (fulls + thumbs)[:25]


def _sane_beds(n: Optional[int], category: str) -> Optional[int]:
    """Bedrooms only make sense for residential listings within a human range. Guards against the
    source emitting a garbage numberOfRooms (e.g. 23000 on an office)."""
    if n is None or category == "commercial" or n <= 0 or n > 20:
        return None
    return n


def map_listing(body: str, url: str) -> tuple[Optional[dict], str]:
    if "هذا الإعلان منتهي" in body or "Page Not Found" in body:
        return None, "residential"
    ld, bc = _ld_blocks(body)
    if not ld:
        return None, "residential"
    pid = re.search(r"/property/(\d+)", url).group(1)
    pi = _pi_table(body)
    crumb = _breadcrumb_parts(bc)

    # ── type + category ──
    property_type = _map_type(pi.get("التصنيف", ""), crumb.get("category", "")) or "Residential Land"
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"

    # ── transaction type ──
    title_raw = ld.get("name") or ""
    offers = ld.get("offers") or {}
    spec = offers.get("priceSpecification") or {}
    unit = (spec.get("unitText") or "").upper()
    is_rent = ("للإيجار" in title_raw or "للايجار" in title_raw
               or "إيجار" in title_raw or unit in ("MONTH", "WEEK", "DAY", "YEAR") and "للبيع" not in title_raw)
    # explicit sale wins
    if "للبيع" in title_raw:
        is_rent = False

    price = _int(offers.get("price"))
    rent_period = None
    if is_rent:
        # aqarcity's structured unitText is unreliably "YEAR" even for true monthly rentals, so also
        # detect شهري/شهرياً/بالشهر in the PAGE BODY (where the lister's "1,700 شهرياً" text lives —
        # the JSON-LD description is a different, truncated copy that omits it). Verified to fire only
        # on genuinely-monthly ads, never on buy/annual pages. (monthly-rent memo.)
        monthly = unit == "MONTH" or bool(
            re.search(r"شهري|بالشهر|في\s*الشهر|/\s*شهر", body))
        rent_period = "monthly" if monthly else "annual"
    area = _float(pi.get("مساحة العقار"))
    price_per_meter = round(price / area) if (price and area and not is_rent) else None

    # ── location ──
    addr = ld.get("address") or {}
    raw_city = (addr.get("addressLocality") or crumb.get("city") or "").strip()
    city = normalize.map_city(raw_city) or "Other"
    raw_region = (addr.get("addressRegion") or "").strip()
    region = None
    for ar, en in REGION_AR.items():
        if ar in raw_region:
            region = en
            break
    if not region:
        region = CITY_TO_REGION.get(city)
    district = crumb.get("district") or None

    # ── PDPL-safe text ──
    title = _redact(_strip_tags(title_raw))
    description = _redact(ld.get("description"))

    # ── JSON-LD additionalProperty (clean, structured — preferred over HTML/desc regex) ──
    ap = {p.get("name"): p.get("value") for p in (ld.get("additionalProperty") or [])
          if isinstance(p, dict)}
    if not district and ap.get("district"):
        district = ap["district"].replace("حي ", "").strip() or district
    if not area:
        fs = ld.get("floorSize") or {}
        area = _float(fs.get("value")) if isinstance(fs, dict) else None

    # ── REGA ad-license number: JSON-LD adLicenseNumber first, else the description free-text ──
    rega_no = _int(ap.get("adLicenseNumber"))
    if not rega_no:
        m = re.search(r"ترخيص الإعلان[^0-9٠-٩]{0,4}([0-9٠-٩]{9,12})", ld.get("description") or "")
        if m:
            rega_no = _int(m.group(1))
    fal_no = None
    m = re.search(r"رخصة فال\s*([0-9٠-٩]{6,})", body)
    if m:
        fal_no = _int(m.group(1))

    geo = ld.get("geo") or {}

    # ── amenity columns from خدمات العقار ──
    amenities: dict[str, bool] = {}
    services_raw = pi.get("خدمات العقار", "")
    for ar, col in SERVICE_COLS.items():
        if col and ar in services_raw:
            amenities[col] = True

    # ── additional_info: every remaining valuable field (NO name, NO phone) ──
    info: dict[str, Any] = {
        "city_ar": raw_city or None,
        "region_ar": raw_region or None,
        "district_ar": district,
        "category_ar": pi.get("التصنيف") or crumb.get("category"),
        "rega_ad_license_number": rega_no,
        "rega_license_issue_date": pi.get("تاريخ إنشاء ترخيص الإعلان"),
        "rega_license_expiry_date": pi.get("تاريخ انتهاء ترخيص الإعلان"),
        "rega_license_status": pi.get("حالة ترخيص الإعلان"),
        "broker_fal_license": fal_no,
        "property_use": pi.get("استخدام العقار"),
        "property_age": pi.get("عمر العقار"),
        "facade": pi.get("واجهة العقار"),
        "street_width": pi.get("عرض الشارع"),
        "services": services_raw or None,
        "plan_number": pi.get("رقم المخطط"),
        "parcel_number": pi.get("رقم القطعة"),
        "deed_location_text": pi.get("وصف موقع العقار حسب الصك"),
        "building_code_compliant": pi.get("مطابقة كود البناء السعودي"),
        "warranties": pi.get("الضمانات و مددها"),
        "latitude": geo.get("latitude"),
        "longitude": geo.get("longitude"),
        "street_address": _redact(addr.get("streetAddress")),
        "postal_code": addr.get("postalCode"),
        "date_published": ld.get("datePublished"),
        "date_modified": ld.get("dateModified"),
        "availability": offers.get("availability"),
        "availability_ends": offers.get("availabilityEnds"),
        "price_unit": unit or None,
    }
    info = {k: v for k, v in info.items() if v not in (None, "", "—")}

    # additional_number (الرقم الإضافي) lives inside the street address text
    extra_num = None
    m = re.search(r"الرقم الإضافي\s*([0-9٠-٩]+)", addr.get("streetAddress") or "")
    if m:
        extra_num = re.sub(r"[^\d]", "", str(_int(m.group(1)) or ""))

    row: dict[str, Any] = {
        "ad_number": f"AC{pid}",
        "listing_url": url,
        "source": "Aqarcity",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": round(area) if area else None,
        "bedrooms": _sane_beds(_int(pi.get("عدد الغرف")) or _int((ld.get("numberOfRooms") or {}).get("value")), category),
        "bathrooms": _int(pi.get("عدد دورات المياه")),
        "property_age": 0 if pi.get("عمر العقار") in ("جديد", "جديده") else None,
        "direction": pi.get("واجهة العقار") or None,
        "street_width_m": _int(pi.get("عرض الشارع")),
        "price_total": price if not is_rent else None,
        "price_annual": price if is_rent else None,
        "price_per_meter": price_per_meter,
        "rent_period": rent_period,
        "city": city,
        "region": region,
        "neighborhood": district,
        "zip_code": addr.get("postalCode") or None,
        "additional_number": extra_num or None,
        "rega_location_verified": bool(rega_no),
        "title": title,
        "description": description,
        "photo_urls": _images(ld, body),
        "date_added": ld.get("datePublished") or None,
        "last_update": ld.get("dateModified") or None,
        "additional_info": info,
    }
    row.update(amenities)  # electricity/water_supply/sanitation/optical_fibers booleans
    return row, category


# ── Main ────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="small validation run: upsert only the first N successfully-parsed listings, NO prune")
    args = ap.parse_args()

    s = session()
    urls = sitemap_urls(s)
    if args.limit:
        # take newest 3× the limit so expired/notfound shells don't starve the target count
        urls = urls[: max(args.limit * 3, 30)]
    print(f"Aqarcity: {len(urls)} candidate listings ({WORKERS} workers)"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

    run_id = None if args.limit else db.begin_run("aqarcity")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        res_buf: list[dict] = []
        com_buf: list[dict] = []

        def flush() -> None:
            nonlocal res_buf, com_buf
            if res_buf:
                db.upsert_aqarcity_residential_batch(res_buf)
                res_buf = []
            if com_buf:
                db.upsert_aqarcity_commercial_batch(com_buf)
                com_buf = []

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for result in ex.map(fetch_one, urls):
                if not result:
                    continue
                body, u = result
                row, cat = map_listing(body, u)
                if not row:
                    continue
                if args.type != "all" and cat != args.type:
                    continue
                (com_buf if cat == "commercial" else res_buf).append(row)
                (com if cat == "commercial" else res).append(row)
                seen += 1
                if len(res_buf) + len(com_buf) >= 50:
                    flush()
                    print(f"  …{seen} upserted", flush=True)
                if args.limit and seen >= args.limit:
                    break
        flush()

        if args.limit:
            print(f"✓ Aqarcity VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            for r in (res + com)[:6]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "price_total", "price_annual", "rent_period")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:72])
            return 0

        # Full run: prune listings that were active before but weren't seen this crawl.
        pruned = 0
        c = db.sb()
        for tbl, rows_seen in (("aqarcity_residential_listings", res),
                               ("aqarcity_commercial_listings", com)):
            seen_ads = {r["ad_number"] for r in rows_seen}
            existing = (c.table(tbl).select("ad_number").eq("source", "Aqarcity")
                        .eq("active", True).execute().data) or []
            gone = [r["ad_number"] for r in existing if r["ad_number"] not in seen_ads]
            for i in range(0, len(gone), 200):
                c.table(tbl).update({"active": False}).in_("ad_number", gone[i:i + 200]).execute()
            pruned += len(gone)
        print(f"✓ Aqarcity: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
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
