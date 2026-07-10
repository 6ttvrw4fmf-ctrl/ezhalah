"""Raghdan (raghdan.sa / رغدان للعقارات) scraper — Saudi Next.js platform, JSON-LD detail pages.

رغدان للعقارات is a Saudi real-estate brokerage platform (mostly Makkah + Riyadh listings, plus
Eastern Province / Madinah). Saudi-owned + REGA-registered brokers → passes the Saudi-only rule.
No auth, no proxy, cloud-friendly. ~1,065 listings advertised; the public sitemap currently
surfaces ~355 `/ar/property/<firebaseId>/` URLs (Firebase push-IDs, ~20-char alnum).

Data path: NO public JSON list API. Enumerate /ar/property/<id>/ URLs from sitemap.xml (EXCLUDING
the /ar/properties/ plural index, /ar/market/, /ar/news/, /ar/public-profile/ etc.), then fetch
each detail page. Each active page embeds <script type="application/ld+json"> blocks:
  • RealEstateListing → name, description, offers(price, priceCurrency SAR, businessFunction
    Sell|LeaseOut), floorSize(value + unitCode MTK = m²), numberOfRooms, address(streetAddress,
    addressLocality=city, addressRegion=region, postalCode), geo lat/long, image[] (full Firebase
    Storage URLs with embedded ?alt=media&token=… → public), AND a broker{RealEstateAgent name+addr}.
  • BreadcrumbList → city / district.

PRICE SEMANTICS (verified by survey):
  • Buy + LAND (ارض): offers.price is the PER-METER rate → total = price × area, price_per_meter = price.
  • Buy + building/apartment/etc.: offers.price is the TOTAL → price_per_meter = total / area.
  • Rent: offers.price is the ANNUAL total.

DESCRIPTION free-text carries structured specs (no agent contact):
  "المساحة 148.62 م²، عدد الغرف 4، العمر: جديد، الواجهة: شرقية"
  → area / rooms / age-text / facade. (numberOfRooms is also a top-level JSON-LD field.)

PDPL: the JSON-LD `broker` block exposes the brokerage NAME + address — we NEVER store the name.
`address.streetAddress` is free-text that on this source is frequently a PERSON name (e.g.
"نصر الجيلاني", "أيمن الحبشي") rather than a verifiable street — under the absolute PDPL rule we
DROP it entirely (can't tell an owner/advertiser name from an official street name). We also REDACT
any phone / wa.me from title + description as a belt-and-braces measure.

Field map (Raghdan → our schema):
  offers.price (+ businessFunction) → price_total | price_annual | price_per_meter (see above)
  floorSize.value (MTK)             → area_m2
  numberOfRooms / "عدد الغرف"        → bedrooms (residential only)
  name first word / breadcrumb      → property_type (TYPE_MAP) + res/com routing
  Sell→Buy / LeaseOut→Rent          → transaction_type
  addressLocality (AR)              → city (normalize.map_city) ; addressRegion (AR) → region
  breadcrumb district               → neighborhood
  geo lat/lng, postal, street, age  → additional_info / columns

Usage:  python -m scrapers.raghdan.run [--limit N] [--type residential|commercial|all]
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
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db, normalize  # noqa: E402

BASE = "https://raghdan.sa"
SITEMAP = f"{BASE}/sitemap.xml"
WORKERS = int(os.environ.get("RAGHDAN_WORKERS", "4"))

# Arabic property-type word (first token of `name`, or breadcrumb) → canonical English type.
TYPE_MAP_AR = {
    "شقة": "Apartment", "شقه": "Apartment", "استوديو": "Studio",
    "فيلا": "Villa", "فلة": "Villa", "دوبلكس": "Duplex", "قصر": "Villa",
    "دور": "Floor", "روف": "Floor", "بيت": "House", "منزل": "House",
    "عمارة": "Building", "عماره": "Building", "بناية": "Building", "برج": "Building",
    "أرض": "Residential Land", "ارض": "Residential Land", "اراضي": "Residential Land",
    "استراحة": "Rest House", "استراحه": "Rest House", "شاليه": "Chalet",
    "مزرعة": "Farm", "مزرعه": "Farm", "غرفة": "Room", "غرفه": "Room",
    "مخيم": "Camp",
    # commercial
    "محل": "Shop", "مكتب": "Office", "مستودع": "Warehouse", "معرض": "Showroom",
    "ورشة": "Workshop", "ورشه": "Workshop", "مصنع": "Factory", "فندق": "Hotel",
    "محطة": "Gas Station", "مجمع": "Commercial Building",
}
COMMERCIAL_TYPES = {
    "Shop", "Office", "Warehouse", "Showroom", "Workshop", "Factory", "Hotel",
    "Gas Station", "Commercial Building", "Commercial Land",
}
# Land types: for these, a Buy `offers.price` is the PER-METER rate, not the total.
LAND_TYPES = {"Residential Land", "Commercial Land", "Farm"}

# addressRegion (AR) → canonical English region. Raghdan uses "منطقة …" / "المنطقة الشرقية" labels.
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
    "Tabuk": "Tabuk", "Hail": "Hail", "Jazan": "Jazan", "Najran": "Najran",
    "Al Baha": "Al Bahah", "Arar": "Northern Borders", "Sakaka": "Al Jawf",
}

# Arabic age phrase (from "العمر: …") → years. "جديد"/"اقل من سنة" → 0; the rest are coarse buckets.
AGE_AR = {
    "جديد": 0, "جديده": 0, "اقل من سنة": 0, "أقل من سنة": 0,
    "سنة": 1, "سنه": 1, "سنتين": 2, "ثلاث سنوات": 3, "اربع سنوات": 4, "أربع سنوات": 4,
    "خمس سنوات": 5, "ست سنوات": 6, "سبع سنوات": 7, "ثمان سنوات": 8, "تسع سنوات": 9,
    "عشر سنوات": 10,
}

# Phone / contact patterns to REDACT from title + description (PDPL belt-and-braces).
_PHONE_RE = re.compile(
    r"(?:\+?9665\d{8}"
    r"|00966\d{9}"
    r"|0?5\d{8}"
    r"|9200\d{4,}"
    r"|wa\.me/\S+"
    r"|واتس\S*\s*\d[\d\s\-]{6,})"
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")

LDJSON_RE = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
# Firebase push-IDs are ~20 chars of [A-Za-z0-9_-]; allow a tolerant 12–40 range.
PROP_URL_RE = re.compile(r"https://raghdan\.sa/ar/property/[A-Za-z0-9_-]{12,40}/?$")

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
    if not text:
        return text
    t = _PHONE_LOOSE.sub(" ", text)
    t = _PHONE_RE.sub(" ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t or None


# ── Sitemap enumeration ───────────────────────────────────────────────────────
def sitemap_urls(s: cc.Session) -> list[str]:
    """Return de-duped /ar/property/<firebaseId>/ URLs from sitemap.xml (one big urlset).
    EXCLUDES the /ar/properties/ plural index, /ar/market/, /ar/news/, /ar/public-profile/ …"""
    urls: list[str] = []
    try:
        body = s.get(SITEMAP, timeout=90).text
        for u in re.findall(r"<loc>([^<]+)</loc>", body):
            if PROP_URL_RE.match(u):
                urls.append(u if u.endswith("/") else u + "/")
    except Exception:
        pass
    seen, out = set(), []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def fetch_one(url: str) -> Optional[tuple[str, str]]:
    s = _session()
    for attempt in range(3):
        try:
            r = s.get(url, timeout=45, allow_redirects=True)
        except Exception:
            time.sleep(1.2 * (attempt + 1))
            continue
        if r.status_code == 200 and "/ar/property/" in str(r.url):
            return r.text, url
        if r.status_code in (429, 502, 503, 504):
            time.sleep(2.0 * (attempt + 1))
            continue
        if r.status_code in (404, 410):
            return None
        time.sleep(1.0 * (attempt + 1))
    return None


# ── Parsing ────────────────────────────────────────────────────────────────────
def _ld_blocks(body: str) -> tuple[Optional[dict], Optional[dict]]:
    """Return (RealEstateListing, BreadcrumbList) from the page's ld+json scripts."""
    listing = breadcrumb = None
    for raw in LDJSON_RE.findall(body):
        try:
            d = json.loads(raw)
        except Exception:
            continue
        t = d.get("@type")
        if t == "RealEstateListing":
            listing = d
        elif t == "BreadcrumbList":
            breadcrumb = d
    return listing, breadcrumb


def _breadcrumb_district(bc: Optional[dict]) -> Optional[str]:
    """The 4th crumb (under city) is the district/neighborhood; the 5th is the listing itself."""
    if not bc:
        return None
    items = bc.get("itemListElement") or []
    # crumbs: [home, العقارات, city, district, listing]
    if len(items) >= 5:
        name = (items[3].get("name") or "").strip()
        # the district crumb's name is the bare neighborhood (e.g. "النرجس")
        if name and "للبيع" not in name and "للإيجار" not in name:
            return name
    return None


def _map_type(*candidates: str) -> Optional[str]:
    for c in candidates:
        if not c:
            continue
        c = c.strip()
        first = c.split(" ")[0] if " " in c else c
        for cand in (c, first):
            if cand in TYPE_MAP_AR:
                return TYPE_MAP_AR[cand]
        for word, eng in TYPE_MAP_AR.items():
            if word in c:
                return eng
    return None


def _images(ld: Optional[dict]) -> list[str]:
    """Full-size Firebase Storage URLs from JSON-LD image[]. Tokens are embedded (public).
    Drops obvious logos/placeholders; no size-suffix stripping needed (Firebase serves originals)."""
    out: list[str] = []
    seen: set[str] = set()
    BAD = ("logo", "placeholder", "no_image", "no-image", "noimage", "default-")
    for u in (ld.get("image") if ld else None) or []:
        if not isinstance(u, str) or not u.startswith("http"):
            continue
        if any(b in u.lower() for b in BAD):
            continue
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out[:25]


def _desc_specs(desc: str) -> dict[str, str]:
    """Parse 'المساحة 148.62 م²، عدد الغرف 4، العمر: جديد، الواجهة: شرقية' into parts."""
    out: dict[str, str] = {}
    if not desc:
        return out
    for seg in re.split(r"[،,]", desc):
        seg = seg.strip()
        if seg.startswith("المساحة"):
            out["area"] = seg
        elif seg.startswith("عدد الغرف"):
            out["rooms"] = re.sub(r"[^\d]", "", seg.translate(normalize._TRANS))
        elif seg.startswith("العمر"):
            out["age"] = seg.split(":", 1)[-1].strip()
        elif seg.startswith("الواجهة"):
            out["facade"] = seg.split(":", 1)[-1].strip()
    return out


def _sane_beds(n: Optional[int], category: str, property_type: str) -> Optional[int]:
    """Bedrooms only for residential non-land within a human range (guards garbage like 150)."""
    if n is None or category == "commercial" or property_type in LAND_TYPES or n <= 0 or n > 20:
        return None
    return n


def map_listing(body: str, url: str) -> tuple[Optional[dict], str]:
    if "هذا الإعلان" in body and "منتهي" in body:
        return None, "residential"
    ld, bc = _ld_blocks(body)
    if not ld:
        return None, "residential"

    m = re.search(r"/ar/property/([A-Za-z0-9_-]+)/?$", url)
    if not m:
        return None, "residential"
    fid = m.group(1)
    listing_url = f"{BASE}/ar/property/{fid}/"

    name = ld.get("name") or ""
    description_raw = ld.get("description") or ""
    specs = _desc_specs(description_raw)

    # ── type + category ──
    property_type = _map_type(name, _breadcrumb_district(bc) or "") or "Residential Land"
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"

    # ── transaction type (businessFunction Sell|LeaseOut; name للبيع|للإيجار) ──
    offers = ld.get("offers") or {}
    bf = (offers.get("businessFunction") or "").lower()
    is_rent = "leaseout" in bf or "lease" in bf or "للإيجار" in name or "للايجار" in name
    if "sell" in bf or "للبيع" in name:
        is_rent = False

    # ── area ──
    fs = ld.get("floorSize") or {}
    area = _float(fs.get("value")) if isinstance(fs, dict) else None
    if not area:
        area = _float(re.sub(r"[^\d.]", " ", specs.get("area", "")).strip().split(" ")[0]) if specs.get("area") else None

    # ── price ──
    raw_price = _int(offers.get("price"))
    price_total = price_annual = price_per_meter = None
    rent_period = None
    if raw_price:
        if is_rent:
            price_annual = raw_price
            rent_period = "annual"
        elif property_type in LAND_TYPES:
            # Buy + land: offers.price is the PER-METER rate.
            price_per_meter = raw_price
            if area:
                price_total = round(raw_price * area)
        else:
            # Buy + building/unit: offers.price is the TOTAL.
            price_total = raw_price
            if area:
                price_per_meter = round(raw_price / area)

    # SANITY: reject absurdly low TOTAL sale prices (data-entry slips) — keep the row but null price.
    if price_total is not None and price_total < 1000:
        price_total = None
        price_per_meter = None
    if price_annual is not None and price_annual < 1000:
        price_annual = None

    # ── location ──
    addr = ld.get("address") or {}
    raw_city = (addr.get("addressLocality") or "").strip()
    raw_region = (addr.get("addressRegion") or "").strip()
    # Forward-fix (2026-07-10 location-data-quality audit): removed the "Other" fallback AND the
    # subsequent "if region and city == 'Other': city = region" block below it — that block used to
    # silently surface a REGION NAME as the city label whenever city resolution failed but region
    # resolution succeeded. A region name is not a city; an honest None is correct, and the raw
    # Arabic signal this scraper captures elsewhere is unchanged for a DB-side resolver to use.
    city = normalize.map_city(raw_city)
    region = None
    for ar, en in REGION_AR.items():
        if ar in raw_region:
            region = en
            break
    if not region:
        region = CITY_TO_REGION.get(city)
    district = _breadcrumb_district(bc)

    # ── PDPL-safe text (broker.name is DROPPED entirely; phones redacted) ──
    title = _redact(_strip_tags(name))
    description = _redact(description_raw)

    # ── property age (from "العمر: …" text) ──
    age_text = specs.get("age")
    property_age = AGE_AR.get(age_text) if age_text else None

    geo = ld.get("geo") or {}
    # NOTE: address.streetAddress is DROPPED for PDPL — too often a person name, not a street.

    info: dict[str, Any] = {
        "firebase_id": fid,
        "city_ar": raw_city or None,
        "region_ar": raw_region or None,
        "district_ar": district,
        "facade": specs.get("facade"),
        "age_text": age_text,
        "latitude": geo.get("latitude"),
        "longitude": geo.get("longitude"),
        "postal_code": addr.get("postalCode"),
        "price_currency": offers.get("priceCurrency"),
        "availability": offers.get("availability"),
        "business_function": offers.get("businessFunction"),
    }
    info = {k: v for k, v in info.items() if v not in (None, "", "—")}

    row: dict[str, Any] = {
        "ad_number": f"RG{fid}",
        "listing_url": listing_url,
        "source": "Raghdan",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": round(area) if area else None,
        "bedrooms": _sane_beds(_int(specs.get("rooms")) or _int(ld.get("numberOfRooms")),
                               category, property_type),
        "property_age": property_age,
        "direction": specs.get("facade") or None,
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": price_per_meter,
        "rent_period": rent_period,
        "city": city,
        "region": region,
        "neighborhood": district,
        "zip_code": addr.get("postalCode") or None,
        "title": title,
        "description": description,
        "photo_urls": _images(ld),
        "additional_info": info,
    }
    return row, category


# ── Main ────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="small validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    s = session()
    urls = sitemap_urls(s)
    if args.limit:
        urls = urls[: max(args.limit * 3, 30)]
    print(f"Raghdan: {len(urls)} candidate listings ({WORKERS} workers)"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

    run_id = None if args.limit else db.begin_run("raghdan")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        res_buf: list[dict] = []
        com_buf: list[dict] = []

        def flush() -> None:
            nonlocal res_buf, com_buf
            if res_buf:
                db.upsert_raghdan_residential_batch(res_buf)
                res_buf = []
            if com_buf:
                db.upsert_raghdan_commercial_batch(com_buf)
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
            print(f"✓ Raghdan VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            for r in (res + com)[:6]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "price_total", "price_annual",
                    "price_per_meter", "rent_period")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:80])
            return 0

        # Full run: prune listings that were active before but weren't seen this crawl.
        pruned = 0
        for tbl, rows_seen in (("raghdan_residential_listings", res),
                               ("raghdan_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Raghdan")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Raghdan: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
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
