"""Aqaratikom (aqaratikom.com → backend nawait.sa) scraper — Saudi Laravel JSON API.

عقاراتكم / نوايت is a Saudi REGA-integrated real-estate marketplace. The aqaratikom.com SPA
talks to a Laravel backend at https://nawait.sa/api/v1 (BASE_URL baked into the page bundle).
Saudi-owned + per-listing REGA رقم ترخيص الإعلان → passes the Saudi-only rule. No auth, no proxy,
cloud-easy. ~169 active listings (≈97 sale + ≈72 rent).

Data path (auth-free, JSON):
  (1) LIST  POST {BASE}/ad  body {"type":"sell"|"rent","page":N}
        → Laravel paginator {data:[ad…], meta:{current_page,last_page,…}}. We page each `type`
          to last_page. Each ad is already rich:
            id (UUID), price ("75,000"), short_price, meter_price, type ("rent"/"sell"),
            is_licensed, is_sold, link (nawait.sa/real-estate/<id>),
            estate{area,title,address,bedroom,category(AR),city(AR),neighborhood,lat,long,media[]},
            owner_name, phone  ← PII, handled below.
  (2) DETAIL GET {BASE}/ad/<id>  → {data:{…}} with the fuller record: estate.details[] (halls,
        bathrooms, elevator, kitchen, street-width, façade/direction, purpose), estate.description,
        estate.age, subtype (rent period: بيع/يومي/شهري/سنوي), license_number, instrument_number,
        utilities[], authority_details[] (REGA: ad license, plan/lot, age, services, region/
        district, land-usage). We fetch detail for EVERY listing (catalog is small) to fill the
        faceted columns.

TYPE: estate.category (Arabic) → canonical English (TYPE_MAP_AR). ارض/عمارة route Residential vs
  Commercial by the listing's purpose (الغرض / نوع استخدام الأرض = تجاري/صناعي/استعمال مختلط →
  commercial). معرض→Showroom, مكتب→Office, مجمع→Commercial Building are inherently commercial.
DEAL: ad.type sell→Buy, rent→Rent. RENT PERIOD from subtype (يومي→daily, شهري→monthly, else annual).

⛔⛔ PDPL ABSOLUTE — the API EXPOSES advertiser/employee PII we MUST NEVER persist:
  • ad.owner_name (usually an INDIVIDUAL person, e.g. "محمد الخالدي") → store ONLY if it is a
    registered COMPANY (starts شركة / مؤسسة …); otherwise null. Person names are NEVER stored.
  • ad.phone / ad.whatsapp → ALWAYS dropped.
  • authority_details[] "اسم الموظف المسؤول" (employee name) + "رقم هاتف الموظف المسؤول" (employee
    phone) → NEVER read into our row (we whitelist only property fields).
  • owner_profile / owner_id / advertiser_relation → never stored.
  We also REDACT any 05x / +9665 / 9200 / 920 / wa.me / واتساب phone from title + description.

Usage:  python -m scrapers.aqaratikom.run [--limit N] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
import hashlib
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

BASE = "https://nawait.sa/api/v1"
LIST_URL = f"{BASE}/ad"
WORKERS = int(os.environ.get("AQARATIKOM_WORKERS", "6"))
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.15"))

# estate.category (Arabic) → canonical English type. ارض/عمارة are routed res/com by purpose below.
TYPE_MAP_AR = {
    "شقة": "Apartment", "شقه": "Apartment", "استوديو": "Apartment", "دوبلكس": "Villa",
    "فيلا": "Villa", "فلة": "Villa", "قصر": "Villa", "دور": "Floor", "روف": "Floor",
    "بيت": "House", "منزل": "House", "غرفة": "Room", "غرفه": "Room",
    "عمارة": "Building", "عماره": "Building", "بناية": "Building",
    "ارض": "Residential Land", "أرض": "Residential Land",
    "استراحة": "Rest House", "استراحه": "Rest House", "إستراحة": "Rest House", "إستراحه": "Rest House",
    "شاليه": "Chalet", "مزرعة": "Farm", "مزرعه": "Farm", "مخيم": "Camp",
    # inherently-commercial
    "محل": "Shop", "معرض": "Showroom", "مكتب": "Office", "مستودع": "Warehouse",
    "ورشة": "Workshop", "ورشه": "Workshop", "مصنع": "Factory", "فندق": "Hotel",
    "محطة": "Gas Station", "محطه": "Gas Station", "برج": "Commercial Building",
    "مجمع": "Commercial Building", "مجمع تجاري": "Commercial Building",
}
COMMERCIAL_TYPES = {
    "Shop", "Showroom", "Office", "Warehouse", "Workshop", "Factory", "Hotel",
    "Gas Station", "Commercial Building", "Commercial Land",
}
# Land / Building purpose labels that flip the type to its commercial variant.
COMMERCIAL_USAGE = {"تجاري", "استعمال مختلط", "صناعي", "تجاري سكني", "مكتبي"}

# estate.city (Arabic) → canonical English region (city handled by normalize.map_city).
REGION_AR = {
    "منطقة الرياض": "Riyadh", "منطقة مكة المكرمة": "Makkah", "منطقة المدينة المنورة": "Madinah",
    "منطقة القصيم": "Qassim", "المنطقة الشرقية": "Eastern Province", "منطقة عسير": "Asir",
    "منطقة تبوك": "Tabuk", "منطقة حائل": "Hail", "منطقة جازان": "Jazan", "منطقة نجران": "Najran",
    "منطقة الباحة": "Al Bahah", "منطقة الجوف": "Al Jawf", "منطقة الحدود الشمالية": "Northern Borders",
}

# REGA façade label (Arabic) kept canonical for `direction`.
_DIRECTIONS = {
    "شمالية", "جنوبية", "شرقية", "غربية", "شمالي", "جنوبي", "شرقي", "غربي",
    "شمالية شرقية", "شمالية غربية", "جنوبية شرقية", "جنوبية غربية",
    "شمال", "جنوب", "شرق", "غرب",
}

# estate.details[]/authority utility labels → canonical amenity boolean columns.
UTIL_COLS = {
    "كهرباء": "electricity", "توفر الكهرباء": "electricity",
    "مياه": "water_supply", "ماء": "water_supply", "توفر الماء": "water_supply",
    "صرف صحي": "sanitation", "ألياف ضوئية": "optical_fibers",
}

# Phone / contact patterns to REDACT from title+description (PDPL).
_PHONE_RE = re.compile(
    r"(?:\+?00?966\d{8,9}"
    r"|\b966\d{8,9}\b"
    r"|0?5\d(?:[\s\.\-]?\d){7}"
    r"|\b9200\d{4,6}\b"
    r"|\b920\d{6}\b"
    r"|\b800\d{7}\b"
    r"|wa\.me/\S+"
    r"|واتس\S*\s*\d[\d\s\-]{6,})"
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")
# A company name is allowed; an individual person name is NOT.
_COMPANY_RE = re.compile(r"^\s*(شركة|مؤسسة|مكتب|مجموعة|company|est\.?|corp)\b", re.I)
# PDPL: broker/owner/contact attribution markers. The description prose can append a block like
# "*الوسيط العقاري* *ضيف الله غرسان الزهراني*" — a broker's NATURAL-PERSON name. That always sits at
# the END of the text (after the property details), so we TRUNCATE the description at the first such
# marker — dropping the name and any trailing contact info. (June 2026 PDPL audit: broker name leak.)
_CUT_MARKERS = (
    "الوسيط العقاري", "المسوق العقاري", "اسم المعلن", "اسم المالك", "المالك", "المعلن",
    "للتواصل", "للحجز", "للاستفسار", "التواصل", "تواصل معنا", "اتصل",
    "[ اتصال", "واتساب", "ادارة التأجير", "إدارة التأجير", "ادارة الإيجار",
)

_local = threading.local()
_last_lock = threading.Lock()
_last = 0.0


def _throttle() -> None:
    global _last
    with _last_lock:
        wait = _last + MIN_INTERVAL - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last = time.monotonic()


def _session() -> cc.Session:
    s = getattr(_local, "s", None)
    if s is None:
        s = cc.Session(impersonate="chrome124")
        s.headers.update({
            "Accept": "application/json",
            "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
            "Content-Type": "application/json",
        })
        _local.s = s
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
    if not text:
        return text
    t = _PHONE_LOOSE.sub(" ", text)
    t = _PHONE_RE.sub(" ", t)
    t = re.sub(r"_?للاتصال[^_\n]*", " ", t)
    # PDPL: truncate at the first broker/owner/contact marker — everything after is attribution that
    # can carry an individual person's name. (audit: broker name "ضيف الله…" survived in description.)
    cut = len(t)
    for m in _CUT_MARKERS:
        i = t.find(m)
        if i != -1:
            cut = min(cut, i)
    t = t[:cut]
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    t = re.sub(r"[\s*_\-]+$", "", t)  # trim trailing markdown/whitespace left by the cut
    return t.strip() or None


def _company_or_none(owner_name: Optional[str]) -> Optional[str]:
    """PDPL: keep a registered COMPANY/established-org name; drop any individual person name."""
    if not owner_name or not isinstance(owner_name, str):
        return None
    name = owner_name.strip()
    return name if _COMPANY_RE.match(name) else None


# ── Fetch ────────────────────────────────────────────────────────────────────────
def fetch_list_page(deal_type: str, page: int) -> Optional[dict]:
    s = _session()
    body = f'{{"type":"{deal_type}","page":{page}}}'
    _throttle()
    for attempt in range(3):
        try:
            r = s.post(LIST_URL, data=body, timeout=30)
        except Exception:
            time.sleep(1.5 * (attempt + 1)); continue
        if r.status_code != 200:
            time.sleep(1.5 * (attempt + 1)); continue
        try:
            return r.json()
        except Exception:
            return None
    return None


def fetch_all_ads(deal_type: str, max_items: int = 0) -> list[dict]:
    """Page the /ad paginator for one deal type to last_page; return all summary ads."""
    out: list[dict] = []
    first = fetch_list_page(deal_type, 1)
    if not first:
        return out
    out += first.get("data") or []
    last = ((first.get("meta") or {}).get("last_page")) or 1
    for p in range(2, int(last) + 1):
        if max_items and len(out) >= max_items:
            break
        pg = fetch_list_page(deal_type, p)
        if not pg:
            break
        out += pg.get("data") or []
    return out


def fetch_detail(ad_id: str) -> Optional[dict]:
    s = _session()
    url = f"{BASE}/ad/{ad_id}"
    _throttle()
    for attempt in range(3):
        try:
            r = s.get(url, timeout=30)
        except Exception:
            time.sleep(1.2 * (attempt + 1)); continue
        if r.status_code != 200:
            time.sleep(1.2 * (attempt + 1)); continue
        try:
            j = r.json()
        except Exception:
            return None
        d = j.get("data") if isinstance(j, dict) else None
        return d if isinstance(d, dict) else None
    return None


# ── Helpers ────────────────────────────────────────────────────────────────────
def _details_map(estate: dict) -> dict[str, str]:
    """estate.details[] → {title: value} (Arabic)."""
    out: dict[str, str] = {}
    for d in estate.get("details") or []:
        if isinstance(d, dict):
            title = (d.get("title") or d.get("name") or "").strip()
            val = d.get("value")
            if title and val not in (None, ""):
                out[title] = str(val).strip()
    return out


def _authority_map(detail: dict) -> dict[str, str]:
    """authority_details[] → {name: value}, EXCLUDING any employee-PII rows (PDPL)."""
    out: dict[str, str] = {}
    BLOCK = ("اسم الموظف", "هاتف الموظف", "جوال الموظف", "رقم الموظف")
    for d in detail.get("authority_details") or []:
        if not isinstance(d, dict):
            continue
        name = (d.get("name") or d.get("title") or "").strip()
        if not name or any(b in name for b in BLOCK):
            continue
        val = d.get("value")
        if val not in (None, ""):
            out[name] = str(val).strip()
    return out


def _yes(v: Optional[str]) -> Optional[bool]:
    if v is None:
        return None
    v = str(v).strip()
    if v in ("نعم", "متوفر", "يوجد", "true", "1"):
        return True
    if v in ("لا", "غير متوفر", "لايوجد", "لا يوجد", "false", "0"):
        return False
    return None


def _photos(estate: dict) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    BAD = ("placeholder", "no-image", "no_image", "noimage", "default", "logo", "icon", "avatar")
    for m in estate.get("media") or []:
        if not isinstance(m, dict):
            continue
        if (m.get("type") or "image") != "image":
            continue
        url = m.get("url")
        if not isinstance(url, str) or not url.startswith("http"):
            continue
        if any(b in url.lower() for b in BAD) or url in seen:
            continue
        seen.add(url)
        out.append(url)
    return out[:25]


def _rent_period(subtype: Optional[str]) -> str:
    s = (subtype or "").strip()
    if "يوم" in s:
        return "daily"
    if "شهر" in s:
        return "monthly"
    return "annual"


def _video(estate: dict) -> Optional[str]:
    for m in estate.get("media") or []:
        if isinstance(m, dict) and m.get("type") == "video" and isinstance(m.get("url"), str):
            return m["url"]
    return None


# ── Mapping ────────────────────────────────────────────────────────────────────
def map_listing(ad: dict, detail: Optional[dict]) -> tuple[Optional[dict], str]:
    detail = detail or {}
    aid = ad.get("id") or detail.get("id")
    if not aid:
        return None, "residential"
    # Prefer the richer detail.estate, fall back to the summary estate.
    estate = (detail.get("estate") if isinstance(detail.get("estate"), dict) else None) \
        or (ad.get("estate") if isinstance(ad.get("estate"), dict) else {}) or {}

    dmap = _details_map(estate)
    amap = _authority_map(detail)

    # ── purpose / usage (for land + building routing) ──
    usage = (dmap.get("الغرض") or dmap.get("الغرض من العقار")
             or amap.get("نوع استخدام الأرض") or "").strip()
    is_commercial_usage = any(u in usage for u in COMMERCIAL_USAGE) and "سكني" not in usage

    # ── type + category ──
    cat_ar = (estate.get("category") or "").strip()
    mapped_type = TYPE_MAP_AR.get(cat_ar) or normalize.map_type(cat_ar) \
        or normalize.map_type(estate.get("title") or "")
    # Unmapped type → STORE the raw category/title text, never a guessed default (owner directive
    # 2026-07-16: never confidently misclassify — the raw value trips the DB novel-type detector,
    # which quarantines + alerts). The legacy value below feeds ONLY the routing/sanity rules
    # (including the commercial-usage flips), so table routing is unchanged.
    property_type = mapped_type or "Residential Land"  # type-truth: routing-legacy only — never stored
    if property_type == "Residential Land" and is_commercial_usage:
        property_type = "Commercial Land"
    elif property_type == "Building" and is_commercial_usage:
        property_type = "Commercial Building"
    stored_property_type = property_type if mapped_type else (cat_ar or (estate.get("title") or "").strip() or "unknown")
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"

    # ── transaction type + rent period ──
    deal = (ad.get("type") or detail.get("type") or "sell").strip().lower()
    is_rent = deal == "rent"
    subtype = detail.get("subtype")
    rent_period = _rent_period(subtype) if is_rent else None

    # ── price (string "75,000") ──
    price = _int(ad.get("price") or detail.get("price"))
    if not price or price < 500:
        return None, category
    area = _num(estate.get("area")) or _num(dmap.get("المنطقة")) or _num(amap.get("مساحة العقار"))
    ppm = _int(ad.get("meter_price") or detail.get("price_of_meters"))
    if not ppm and price and area and not is_rent:
        ppm = round(price / area)

    # ── faceted property fields ──
    bedroom = _int(estate.get("bedroom")) or _int(amap.get("عدد الغرف"))
    bedrooms = bedroom if (bedroom and category == "residential" and 0 < bedroom <= 30) else None
    bathrooms = _int(dmap.get("عدد دورة المياه") or dmap.get("عدد دورات المياه"))
    halls = _int(dmap.get("عدد الصالات"))
    street_w = _num(dmap.get("عرض الشارع"))
    # age: estate.age is numeric (years); authority gives a free-text Arabic phrase → keep raw in info
    age = _int(estate.get("age"))
    direction = None
    face = (dmap.get("واجهة العقار") or dmap.get("واجهة الأرض") or "").strip()
    if face:
        direction = face if face in _DIRECTIONS else face

    # ── amenities ──
    amenities: dict[str, bool] = {}
    el = _yes(dmap.get("مصعد"))
    if el is not None:
        amenities["elevator"] = el
    ki = _yes(dmap.get("مطبخ"))
    if ki is not None:
        amenities["kitchen"] = ki
    driver = _yes(dmap.get("غرفة السائق"))
    if driver is not None:
        amenities["driver_room"] = driver
    # utility flags from estate.details + REGA utilities list
    for label, val in dmap.items():
        col = UTIL_COLS.get(label)
        if col and _yes(val) is not False:
            amenities[col] = True
    for u in (detail.get("utilities") or []):
        if isinstance(u, dict):
            col = UTIL_COLS.get((u.get("name") or "").strip())
            if col:
                amenities[col] = True

    # ── location ──
    city_ar = (estate.get("city") or "").strip()
    city = normalize.map_city(city_ar) if city_ar else None
    neighborhood = (estate.get("neighborhood") or estate.get("neighborhood?")
                    or amap.get("الحي/رقم الحي") or dmap.get("الحي")) or None
    if isinstance(neighborhood, str):
        neighborhood = neighborhood.strip() or None
    region_ar = (amap.get("المنطقة/رقم المنطقة") or "").strip()
    region = REGION_AR.get(region_ar) or normalize.region_for_city(city)

    # ── REGA license ──
    rega_lic = (detail.get("license_number") or amap.get("رقم ترخيص الإعلان"))
    rega_lic = str(rega_lic).strip() if rega_lic else None

    # ── PDPL-safe text ──
    title = _redact(estate.get("title")) or (estate.get("title") or "").strip() or None
    description = _redact(estate.get("description"))

    # ── deterministic globally-unique ad number from the listing UUID/URL ──
    ad_number = "AQTK" + hashlib.md5(str(aid).encode("utf-8")).hexdigest()[:12]
    listing_url = ad.get("link") or detail.get("link") or f"https://nawait.sa/real-estate/{aid}"

    # ── additional_info: STRICT whitelist (property/price/photo/location/REGA) — NEVER owner PII ──
    info: dict[str, Any] = {
        "source_id": str(aid),
        "category_ar": cat_ar or None,
        "city_ar": city_ar or None,
        "region_ar": region_ar or None,
        "usage_ar": usage or None,
        "subtype_ar": (subtype or None) if is_rent else None,
        "property_age_text": amap.get("عمر العقار") or None,
        "plan_number": amap.get("رقم المخطط") or None,
        "lot_number": amap.get("رقم القطعة") or None,
        "rega_ad_license_number": rega_lic,
        "rega_license_issue_date": amap.get("تاريخ اصدار الاعلان") or None,
        "rega_license_end_date": amap.get("تاريخ انتهاء الرخصة") or None,
        "instrument_number": detail.get("instrument_number") or None,
        "street_width_m": round(street_w) if street_w else None,
        "is_able_financing": bool(ad.get("is_able_financing") or detail.get("is_able_financing")),
        "is_furnished": bool(estate.get("is_furniture")),
        "latitude": _num(estate.get("lat")),
        "longitude": _num(estate.get("long")),
        "owner_company": _company_or_none(ad.get("owner_name") or detail.get("owner_name")),
        "is_featured": bool(ad.get("is_featured")),
    }
    info = {k: v for k, v in info.items() if v not in (None, "", [], False) or k == "owner_company"}
    if info.get("owner_company") is None:
        info.pop("owner_company", None)

    row: dict[str, Any] = {
        "ad_number": ad_number,
        "listing_url": listing_url,
        "source": "Aqaratikom",
        "active": not bool(ad.get("is_sold") or detail.get("is_sold")),
        "property_type": stored_property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": round(area) if area else None,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "halls": halls,
        "property_age": age,
        "direction": direction,
        "street_width_m": round(street_w) if street_w else None,
        "price_total": price if not is_rent else None,
        "price_annual": price if is_rent else None,
        "price_per_meter": ppm,
        "rent_period": rent_period,
        "city": city,
        "region": region,
        "neighborhood": neighborhood,
        "rega_location_verified": bool(rega_lic),
        "title": title,
        "description": description,
        "photo_urls": _photos(estate),
        "video_url": _video(estate),
        "additional_info": info,
    }
    row.update(amenities)
    return row, category


# ── Main ────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    cap = max(args.limit * 2, 30) if args.limit else 0
    ads: list[dict] = []
    for deal in ("sell", "rent"):
        ads += fetch_all_ads(deal, max_items=cap)
        if cap and len(ads) >= cap:
            break
    # de-dup by id (a listing can't be in both, but be safe)
    seen_ids: set[str] = set()
    uniq: list[dict] = []
    for a in ads:
        i = a.get("id")
        if i and i not in seen_ids:
            seen_ids.add(i)
            uniq.append(a)
    ads = uniq
    if not ads:
        print("✗ Aqaratikom: list endpoint returned no ads")
        return 1
    if args.limit:
        ads = ads[: args.limit]
    print(f"Aqaratikom: {len(ads)} ads from /ad ({WORKERS} workers)"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

    run_id = None if args.limit else db.begin_run("aqaratikom")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        res_buf: list[dict] = []
        com_buf: list[dict] = []

        def flush() -> None:
            nonlocal res_buf, com_buf
            if res_buf:
                db.upsert_aqaratikom_residential_batch(res_buf)
                res_buf = []
            if com_buf:
                db.upsert_aqaratikom_commercial_batch(com_buf)
                com_buf = []

        def work(ad: dict) -> Optional[tuple[dict, str]]:
            det = fetch_detail(ad.get("id"))
            return map_listing(ad, det)

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for result in ex.map(work, ads):
                if not result:
                    continue
                row, cat = result
                if not row:
                    continue
                if args.type != "all" and cat != args.type:
                    continue
                (com_buf if cat == "commercial" else res_buf).append(row)
                (com if cat == "commercial" else res).append(row)
                seen += 1
                if len(res_buf) + len(com_buf) >= 40:
                    flush()
                    print(f"  …{seen} upserted", flush=True)
        flush()

        if args.limit:
            print(f"✓ Aqaratikom VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            for r in (res + com)[:8]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "bathrooms", "price_total",
                    "price_annual", "price_per_meter", "rent_period")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:74])
            return 0

        # Full run: prune listings active before but not seen this crawl (we fetched the FULL catalog).
        pruned = 0
        for tbl, rows_seen in (("aqaratikom_residential_listings", res),
                               ("aqaratikom_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Aqaratikom")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Aqaratikom: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
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
