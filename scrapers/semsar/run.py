"""Semsar (semsarsaudi.com / سمسار السعودية) scraper — classic ASP classifieds, STATIC HTML.

semsarsaudi.com is a large user-generated real-estate classifieds board (all property types,
all KSA regions). It is part of a multi-country Semsar network (semsaruae.com, semsarmasr.com)
and — critically — its OWN Saudi board mixes in NON-Saudi listings (Bahrain البحرين, Turkey تركيا,
Egypt مصر, …). ⚠️ SAUDI-ONLY: we DROP any listing whose JSON-LD addressCountry != "SA" (and, as a
backup, any listing we can't resolve to a Saudi city/region).

⚠️ CHARSET: the server emits `charset=windows-1256` (Arabic). curl_cffi mis-labels the response
utf-8, so we ALWAYS decode `response.content` with windows-1256 ourselves — never `.text`.

Data path (auth-free, cloud-easy, no proxy):
  (1) Enumerate listing ids from the paginated search endpoint
        /property?cid=0&s=1&{sale|rent}=1&pf=0&pt=0&af=0&at=0&pm=any&furniture=-1[&p=N]
      cid=0 = all cities. We page until a page yields no NEW ids (the board repeats a handful of
      sticky/featured rows on every page, so we dedupe globally and stop on no-new-ids).
  (2) For each id, GET /property/<id>/x and parse the page's JSON-LD <script type=ld+json> blob.
      It carries EVERYTHING we need cleanly:
        @type (Apartment/House/Room/Building/Place/LocalBusiness…) + name + description + image[]
        numberOfRooms, floorSize.value (m²),
        address{ addressRegion=CITY, addressLocality=region|district, addressCountry } ← Saudi gate
        offers.priceSpecification{ price, priceCurrency, unitCode ANN|MON } + businessFunction
          (LeaseOut→Rent / Sell→Buy),
        amenityFeature[] (مصعد→elevator, جراج/موقف سيارات→parking, …).
      The JSON-LD `@type` is unreliable for our taxonomy (commercial rows come through as
      Place/LocalBusiness), so property_type is derived from the Arabic `name` via
      normalize.map_type(), with the JSON-LD @type only as a last-resort fallback.

⛔⛔ PDPL ABSOLUTE — the JSON-LD `provider` object EXPOSES the advertiser's PERSON name +
  telephone ("provider":{"name":"ابومشاري","telephone":"+966545460875"}), and the page title /
  description carry "إضغط هنا للاتصال" + inline 05x / +9665 numbers. We:
    • NEVER read or store `provider` (person name) or ANY phone number / national ID,
    • REDACT every 05x / +9665 / 9200 / 920 / wa.me / واتساب pattern from title + description
      before storing (a registered شركة…/مؤسسة… company name in the body is left intact).

Usage:  python -m scrapers.semsar.run [--limit N] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
import hashlib
import html as ihtml
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

BASE = "https://www.semsarsaudi.com"
SEARCH = (BASE + "/property?cid=0&s=1&{deal}=1&pf=0&pt=0&af=0&at=0&pm=any&furniture=-1")
WORKERS = int(os.environ.get("SEMSAR_WORKERS", "6"))
MAX_PAGES = int(os.environ.get("SEMSAR_MAX_PAGES", "200"))

# ── property type (Arabic name word → canonical English). Order matters: title is free text, so
# scan in priority order and take the first hit. Commercial words win over generic residential.
TYPE_RULES = [
    ("أرض تجارية", "Commercial Land"), ("ارض تجارية", "Commercial Land"),
    ("معرض", "Showroom"),
    ("مستودع", "Warehouse"), ("مخزن", "Warehouse"),
    ("مكتب", "Office"), ("مكاتب", "Office"),
    ("محل", "Shop"), ("محلات", "Shop"),
    ("ورشة", "Workshop"), ("ورشه", "Workshop"),
    ("مصنع", "Factory"),
    ("محطة", "Gas Station"), ("محطه", "Gas Station"),
    ("فندق", "Hotel"),
    ("عمارة تجارية", "Commercial Building"), ("عماره تجارية", "Commercial Building"),
    ("استراحة", "Rest House"), ("استراحه", "Rest House"), ("منتجع", "Rest House"),
    ("شاليه", "Chalet"),
    ("مزرعة", "Farm"), ("مزرعه", "Farm"),
    ("عمارة", "Building"), ("عماره", "Building"), ("بناية", "Building"), ("عمائر", "Building"),
    ("روف", "Floor"), ("دور", "Floor"), ("أدوار", "Floor"),
    ("شقة", "Apartment"), ("شقه", "Apartment"), ("شقق", "Apartment"), ("استوديو", "Apartment"),
    ("دوبلكس", "Villa"), ("دوبلكس", "Villa"), ("قصر", "Villa"), ("قصور", "Villa"),
    ("فيلا", "Villa"), ("فلة", "Villa"), ("فلل", "Villa"),
    ("غرفة", "Room"), ("غرفه", "Room"), ("غرف سكن", "Room"),
    ("بيت", "House"), ("منزل", "House"), ("منازل", "House"), ("بيوت", "House"),
    ("أرض", "Residential Land"), ("ارض", "Residential Land"), ("أراضي", "Residential Land"),
    ("اراضي", "Residential Land"), ("قطعة", "Residential Land"),
]
# JSON-LD @type → fallback canonical English (only used when the title yields nothing).
LD_TYPE = {
    "Apartment": "Apartment", "House": "Villa", "SingleFamilyResidence": "Villa",
    "Residence": "House", "Room": "Room", "Building": "Building", "ApartmentComplex": "Building",
    "Hotel": "Hotel", "Place": "Residential Land", "LocalBusiness": "Shop",
}
COMMERCIAL_TYPES = {
    "Shop", "Office", "Warehouse", "Showroom", "Workshop", "Factory", "Hotel",
    "Gas Station", "Commercial Building", "Commercial Land",
}
LAND_TYPES = {"Residential Land", "Commercial Land", "Farm"}

# Saudi region (Arabic label that appears in addressLocality/addressRegion) → canonical English.
REGION_AR = {
    "الرياض": "Riyadh", "منطقة الرياض": "Riyadh",
    "مكة": "Makkah", "مكة المكرمة": "Makkah", "منطقة مكة المكرمة": "Makkah",
    "المدينة": "Madinah", "المدينة المنورة": "Madinah", "منطقة المدينة المنورة": "Madinah",
    "القصيم": "Qassim", "منطقة القصيم": "Qassim",
    "الشرقية": "Eastern Province", "المنطقة الشرقية": "Eastern Province",
    "عسير": "Asir", "منطقة عسير": "Asir",
    "تبوك": "Tabuk", "منطقة تبوك": "Tabuk",
    "حائل": "Hail", "منطقة حائل": "Hail",
    "جازان": "Jazan", "جيزان": "Jazan", "منطقة جازان": "Jazan",
    "نجران": "Najran", "منطقة نجران": "Najran",
    "الباحة": "Al Bahah", "منطقة الباحة": "Al Bahah",
    "الجوف": "Al Jawf", "منطقة الجوف": "Al Jawf",
    "الحدود الشمالية": "Northern Borders", "منطقة الحدود الشمالية": "Northern Borders",
}
# Region labels that must NOT be treated as a neighborhood when they land in addressLocality.
_REGION_WORDS = set(REGION_AR) | {"السعودية", "المملكة العربية السعودية"}

# Amenity names (JSON-LD amenityFeature) → canonical boolean columns.
AMENITY_COLS = {
    "مصعد": "elevator",
    "جراج/موقف سيارات": "parking", "موقف سيارات": "parking", "جراج": "parking",
    "مطبخ": "kitchen", "مطبخ راكب": "kitchen",
}

# Phone / contact patterns to REDACT from title+description (PDPL). Hardened battery.
_PHONE_RE = re.compile(
    r"(?:\+?00?966\d{8,9}"          # +966xxxxxxxx / 00966xxxxxxxxx
    r"|\b966\d{8,9}\b"              # bare 966xxxxxxxx
    r"|0?5\d(?:[\s\.\-]?\d){7}"     # 05xxxxxxxx / 5xxxxxxxx, separators allowed
    r"|\b9200\d{4}\b"              # 9200xxxx short-codes
    r"|\b920\d{6}\b"               # 920xxxxxx unified
    r"|\b800\d{7}\b"               # 800xxxxxxx toll-free
    r"|wa\.me/\S+"
    r"|واتس\S*\s*\d[\d\s\-]{6,})"
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")
# Bare contact-channel keywords to strip defensively even without a trailing number (PDPL):
# the board peppers descriptions with "للتواصل واتساب" / "whatsapp" / "اتصال" call-to-actions.
_CONTACT_KW = re.compile(
    r"(?:للتواصل|للاستفسار|للحجز|للاتصال)?\s*"
    r"(?:واتس\s*اب|واتساب|الواتس|whats\s*app|whatsapp|تواصل\s*معنا)\s*[:：]?\s*\d*",
    re.I,
)
# "إضغط هنا للاتصال ومعرفة السعر" call-to-action prefix the board injects into og:title.
_CTA_RE = re.compile(r"[ا]?[إض]?غط\s*هنا\s*للاتصال[^|:]*[:：]?\s*")

LD_RE = re.compile(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.S)
PROPERTY_ID_RE = re.compile(r"/property/(\d+)/")
# bedrooms / bathrooms from the Arabic title/description, e.g. "3غرف" / "دورتين مياه"
BEDS_RE = re.compile(r"([\d٠-٩]{1,2})\s*غرف")
BATHS_RE = re.compile(r"([\d٠-٩]{1,2})\s*(?:دورات?|حمامات?|دورت)\s*(?:مياه|مياة|المياه|حمام)?")

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


def _decode(r: cc.Response) -> str:
    """ALWAYS decode the raw bytes as windows-1256 (server's real charset). curl_cffi's `.text`
    guesses utf-8 and mangles every Arabic glyph on this site."""
    return r.content.decode("windows-1256", errors="replace")


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", ihtml.unescape(s or ""))).strip()


def _to_int(v: Any) -> Optional[int]:
    n = normalize.to_int(v)
    return n if n else None


def _to_float(v: Any) -> Optional[float]:
    if v in (None, "", "—"):
        return None
    s = str(v).translate(normalize._TRANS)
    s = re.sub(r"[^\d.]", "", s)
    try:
        return float(s) if s else None
    except ValueError:
        return None


# Letter-for-digit obfuscation: this UGC board hides mobiles as "o5o2981000" (letter o = 0) to dodge
# digit filters. De-obfuscate any digit/letter-o run that becomes an 8+ digit number, so _PHONE_RE
# then catches it. (audit: o5o2981000 = 0502981000 bypassed every redactor.)
_OBFUSC_RUN_RE = re.compile(r"[oO0-9٠-٩][oO0-9٠-٩\s.\-]{6,}[oO0-9٠-٩]")
# A contact call-to-action + the ~40 chars after it (phone, WhatsApp, or a seller ALIAS like "ام صقر").
_CONTACT_LINE_RE = re.compile(
    r"(?:للتواصل|للحجز|للاستفسار|للاتصال|اتصل(?:\s*(?:بنا|على))?|"
    r"رقم\s*(?:الجوال|الجوّال|التواصل|الهاتف|الواتس)|جوال|موبايل|"
    r"واتس\S*|whats\s*app|whatsapp)[^\n]{0,40}", re.I)


def _deobfuscate(t: str) -> str:
    def fix(m: "re.Match[str]") -> str:
        d = m.group(0).replace("o", "0").replace("O", "0")
        return d if len(re.sub(r"\D", "", d)) >= 8 else m.group(0)
    return _OBFUSC_RUN_RE.sub(fix, t)


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return text
    t = ihtml.unescape(text)
    t = _deobfuscate(t)            # o5o… → 050… so the phone patterns below catch it
    t = _CTA_RE.sub(" ", t)
    t = _CONTACT_LINE_RE.sub(" ", t)   # drops the CTA + phone/whatsapp/seller-alias that follows
    t = _PHONE_LOOSE.sub(" ", t)
    t = _PHONE_RE.sub(" ", t)
    t = _CONTACT_KW.sub(" ", t)
    t = re.sub(r"_?للاتصال[^_\n]*", " ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t or None


def _map_type(name: str, ld_type: Optional[str]) -> str:
    for word, eng in TYPE_RULES:
        if word in name:
            return eng
    if ld_type and ld_type in LD_TYPE:
        return LD_TYPE[ld_type]
    return "Residential Land"


# ── Enumeration ────────────────────────────────────────────────────────────────
def enumerate_ids(s: cc.Session, limit: int = 0) -> list[str]:
    """Collect listing ids from the paginated all-cities search (sale + rent), deduped and ordered.
    Stops a deal stream when a page yields no NEW ids (sticky featured rows repeat every page)."""
    ordered: list[str] = []
    seen: set[str] = set()
    for deal in ("sale", "rent"):
        base = SEARCH.format(deal=deal)
        empty_streak = 0
        for p in range(1, MAX_PAGES + 1):
            url = base + (f"&p={p}" if p > 1 else "")
            try:
                r = s.get(url, timeout=40)
            except Exception:
                empty_streak += 1
                if empty_streak >= 2:
                    break
                continue
            if r.status_code != 200:
                break
            page_ids = PROPERTY_ID_RE.findall(_decode(r))
            new = [i for i in dict.fromkeys(page_ids) if i not in seen]
            if not new:
                empty_streak += 1
                if empty_streak >= 2:   # two consecutive no-new-id pages → end of this stream
                    break
                continue
            empty_streak = 0
            for i in new:
                seen.add(i)
                ordered.append(i)
            if limit and len(ordered) >= max(limit * 3, 30):
                return ordered
    return ordered


def fetch_one(pid: str) -> Optional[tuple[str, str]]:
    """Fetch a listing detail page. Returns (decoded_html, pid) or None."""
    s = _session()
    url = f"{BASE}/property/{pid}/x"
    for attempt in range(3):
        try:
            r = s.get(url, timeout=45, allow_redirects=True)
        except Exception:
            time.sleep(1.2 * (attempt + 1))
            continue
        if r.status_code == 200 and len(r.content) > 2000:
            return _decode(r), pid
        time.sleep(1.0 * (attempt + 1))
    return None


# ── Parsing ──────────────────────────────────────────────────────────────────────
def _ld(body: str) -> Optional[dict]:
    for m in LD_RE.finditer(body):
        raw = m.group(1).strip()
        try:
            d = json.loads(raw)
        except Exception:
            continue
        if isinstance(d, list):
            d = next((x for x in d if isinstance(x, dict) and x.get("address")), d[0] if d else {})
        if isinstance(d, dict) and (d.get("address") or d.get("offers") or d.get("@type")):
            return d
    return None


def _images(d: dict) -> list[str]:
    imgs = d.get("image")
    if isinstance(imgs, str):
        imgs = [imgs]
    out: list[str] = []
    seen: set[str] = set()
    BAD = ("logo", "icon", "placeholder", "no-image", "no_image", "favicon", "avatar", "/svg/",
           "default", "blank")
    for u in (imgs or []):
        if not isinstance(u, str):
            continue
        u = ihtml.unescape(u.strip())
        if u.startswith("//"):
            u = "https:" + u
        if not u.startswith("http") or any(b in u.lower() for b in BAD):
            continue
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out[:25]


def map_listing(body: str, pid: str) -> tuple[Optional[dict], str]:
    """Parse one detail page's JSON-LD into a canonical row. Returns (row, category) or
    (None, _) to SKIP (non-Saudi, junk, or unparseable)."""
    d = _ld(body)
    if not d:
        return None, "residential"

    addr = d.get("address") if isinstance(d.get("address"), dict) else {}
    country = (addr.get("addressCountry") or "").strip().upper()

    name_raw = _clean(d.get("name") or "")
    desc_raw = d.get("description") or ""

    # ── property type / category ──
    ld_t = d.get("@type")
    ld_t = next((x for x in ld_t if x != "Product"), None) if isinstance(ld_t, list) else ld_t
    property_type = _map_type(name_raw, ld_t)
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"
    is_land = property_type in LAND_TYPES

    # ── transaction type (businessFunction LeaseOut→Rent / Sell→Buy; fall back to title) ──
    off = d.get("offers") if isinstance(d.get("offers"), dict) else {}
    bf = str(off.get("businessFunction") or "")
    is_rent = "LeaseOut" in bf or "Lease" in bf
    if "Sell" in bf:
        is_rent = False
    if not bf:  # no offer → infer from Arabic
        is_rent = (("للإيجار" in name_raw or "للايجار" in name_raw or "إيجار" in name_raw
                    or "ايجار" in name_raw) and "للبيع" not in name_raw)

    # ── location (addressRegion holds the CITY; addressLocality holds region or district) ──
    city_ar = (addr.get("addressRegion") or "").strip()
    locality_ar = (addr.get("addressLocality") or "").strip()
    city = normalize.map_city(city_ar) or normalize.map_city(locality_ar)
    region = normalize.region_for_city(city) if city else None
    if not region:
        # try resolving a region directly from either Arabic label
        region = (REGION_AR.get(locality_ar) or REGION_AR.get(city_ar)
                  or normalize.region_for_city(normalize.map_city(name_raw) or ""))

    # ⚠️ SAUDI-ONLY GATE: drop anything not in Saudi Arabia. Primary signal is the JSON-LD
    # addressCountry; if that's blank, require a resolvable Saudi city OR region. A foreign
    # country code (BH/TR/EG/AE/…) is an immediate skip even if a Saudi-looking word leaks in.
    if country and country != "SA":
        return None, category
    if not country and not city and not region:
        return None, category

    # neighborhood: locality, unless it's actually a region/country word.
    neighborhood = None
    if locality_ar and locality_ar not in _REGION_WORDS and normalize.map_city(locality_ar) != city:
        neighborhood = locality_ar
    if region and not city:
        city = region  # region-only listing: surface region as the city label

    # ── area / rooms / baths ──
    fs = d.get("floorSize") if isinstance(d.get("floorSize"), dict) else {}
    area = _to_float(fs.get("value"))
    rooms = _to_int(d.get("numberOfRooms"))
    bedrooms = rooms if (rooms and category == "residential" and not is_land and 0 < rooms <= 20) else None
    if bedrooms is None and category == "residential" and not is_land:
        bm = BEDS_RE.search(name_raw)
        if bm:
            n = _to_int(bm.group(1))
            bedrooms = n if (n and 0 < n <= 20) else None
    baths = None
    if category == "residential" and not is_land:
        bm = BATHS_RE.search(name_raw) or BATHS_RE.search(_clean(desc_raw))
        if bm:
            n = _to_int(bm.group(1))
            baths = n if (n and 0 < n <= 15) else None

    # ── price ── (only present on some listings; sellers often hide it behind "call")
    ps = off.get("priceSpecification") if isinstance(off.get("priceSpecification"), dict) else {}
    price = _to_int(ps.get("price"))
    if price is not None and price < 1000:
        price = None  # junk / placeholder price
    unit = (ps.get("unitCode") or "").strip().upper()  # ANN annual, MON monthly
    rent_period = None
    price_annual = None
    price_total = None
    if is_rent:
        if price:
            if unit == "MON":
                rent_period = "monthly"
                price_annual = price * 12
            else:
                rent_period = "annual"
                price_annual = price
    else:
        price_total = price
    price_per_meter = None
    if price_total and area and area > 0 and is_land:
        price_per_meter = int(round(price_total / area))

    # ── amenities → boolean columns ──
    amenities: dict[str, bool] = {}
    for a in (d.get("amenityFeature") or []):
        if not isinstance(a, dict):
            continue
        col = AMENITY_COLS.get((a.get("name") or "").strip())
        if col and a.get("value") in (True, "true", "True", 1, "1"):
            amenities[col] = True

    # ── PDPL-safe text (NEVER touch d["provider"] — person name + phone) ──
    title = _redact(name_raw) or name_raw
    description = _redact(_clean(desc_raw))

    listing_url = f"{BASE}/property/{pid}/x"
    md = (d.get("mainEntityOfPage") or {})
    canonical = md.get("@id") if isinstance(md, dict) else None
    if isinstance(canonical, str) and canonical.startswith("http"):
        listing_url = canonical

    # deterministic, namespaced ad number (md5 of the numeric id) — same listing → same SM id
    # across runs, upserts cleanly on ad_number.
    ad_id = int(hashlib.md5(pid.encode("utf-8")).hexdigest()[:12], 16)

    info: dict[str, Any] = {
        "semsar_id": pid,
        "city_ar": city_ar or None,
        "locality_ar": locality_ar or None,
        "ld_type": ld_t,
        "price_unit": unit or None,
    }
    info = {k: v for k, v in info.items() if v not in (None, "", [])}

    row: dict[str, Any] = {
        "ad_number": f"SM{ad_id}",
        "listing_url": listing_url,
        "source": "Semsar",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": int(round(area)) if area else None,
        "bedrooms": bedrooms,
        "bathrooms": baths,
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": price_per_meter,
        "rent_period": rent_period,
        "city": city,
        "region": region,
        "neighborhood": neighborhood,
        "rega_location_verified": False,
        "title": title,
        "description": description,
        "photo_urls": _images(d),
        "additional_info": info,
    }
    row.update(amenities)
    return row, category


# ── Main ──────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: upsert only the first N parsed Saudi listings, NO prune")
    args = ap.parse_args()

    s = session()
    s.headers.update({"Accept-Language": "ar,en-US;q=0.7,en;q=0.6"})
    ids = enumerate_ids(s, limit=args.limit)
    print(f"Semsar: {len(ids)} candidate listing ids ({WORKERS} workers)"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")
    if not ids:
        print("✗ Semsar: enumeration returned no ids")
        return 1

    run_id = None if args.limit else db.begin_run("semsar")
    res: list[dict] = []
    com: list[dict] = []
    skipped_foreign = 0
    seen = 0
    try:
        res_buf: list[dict] = []
        com_buf: list[dict] = []

        def flush() -> None:
            nonlocal res_buf, com_buf
            if res_buf:
                db.upsert_semsar_residential_batch(res_buf)
                res_buf = []
            if com_buf:
                db.upsert_semsar_commercial_batch(com_buf)
                com_buf = []

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for result in ex.map(fetch_one, ids):
                if not result:
                    continue
                body, pid = result
                row, cat = map_listing(body, pid)
                if not row:
                    skipped_foreign += 1
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
            print(f"✓ Semsar VALIDATION: {len(res)} residential + {len(com)} commercial upserted "
                  f"(no prune); {skipped_foreign} non-Saudi/junk skipped")
            for r in (res + com)[:8]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "price_total", "price_annual",
                    "price_per_meter")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:74])
            return 0

        # Full run: prune listings active before but not seen this crawl.
        pruned = 0
        c = db.sb()
        for tbl, rows_seen in (("semsar_residential_listings", res),
                               ("semsar_commercial_listings", com)):
            seen_ads = {r["ad_number"] for r in rows_seen}
            existing = (c.table(tbl).select("ad_number").eq("source", "Semsar")
                        .eq("active", True).execute().data) or []
            gone = [r["ad_number"] for r in existing if r["ad_number"] not in seen_ads]
            for i in range(0, len(gone), 200):
                c.table(tbl).update({"active": False}).in_("ad_number", gone[i:i + 200]).execute()
            pruned += len(gone)
        print(f"✓ Semsar: {len(res)} residential + {len(com)} commercial upserted, "
              f"{skipped_foreign} non-Saudi/junk skipped, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen,
                   notes=f"foreign_skipped={skipped_foreign} pruned={pruned}")
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
