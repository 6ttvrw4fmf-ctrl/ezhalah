"""Toor (toor.ooo / منصة توور) scraper — Saudi property platform, server-rendered HTML.

Toor is a small REGA-licensed Saudi listings platform (~80 active listings in their sitemap).
It's a server-rendered Adminlte/ewcore site behind Cloudflare; the per-listing detail page
embeds every value we need directly in HTML — no auth, no captcha, no proxy needed.

Data path: NO public JSON API for catalog enumeration. Two-step sitemap:
  • https://toor.ooo/sitemap_index.xml → references sitemap_properties_1.xml
  • https://www.toor.ooo/sitemap_properties_1.xml → ~82 detail URLs (each with one main image)

Each /Platform?PageId=Details&PropertyId=<uuid> page contains:
  • A Product JSON-LD block: name (title), description, image (main_picture).
  • Top chip block (`background-alfa font-size-12px`) with [property_type, offer_type,
    usage(سكني|تجاري|زراعي), handover(الإفراغ فوري)].
  • Visible card stats row with icon_s_bed/icon_s_bathtub/icon_s_land_area numeric values.
  • Address line under title: "<city>, <district>[, <street>][, <postal>]".
  • Price band: `<div class="font-size-32px st__J3hQ4o"><div>SAR_PRICE</div>` (also shown as
    a raw "| 550000 |" near the title).
  • REGA panel: "رقم ترخيص الإعلان: <NN>", "تاريخ الإصدار", "تاريخ الإنتهاء".
  • Spec sections for عمر العقار، الواجهة، عرض الشارع الرئيسي، الإفراغ، معلومات الخدمات.

PDPL: the page renders a "صاحب الإعلان" name + phone block, plus the description may
embed contact phones. We NEVER store name/phone — we redact every 05x/+966/wa.me pattern
from title + description before storing, and never read the contact panel.

Auctions (مزاد) are SKIPPED — Ezhalah only displays buy/rent listings.

Field map (Toor → our schema):
  Product.name                              → title
  Product.description                       → description
  Product.image                             → photo_urls[0]
  chip[0]                                   → property_type (TYPE_MAP) + res/com routing
  chip[1] (للبيع/للإيجار/مزاد)               → transaction_type Buy|Rent (مزاد→skip)
  chip[2] (سكني/تجاري/زراعي)                → usage routing override (تجاري→commercial)
  font-size-32px<div>NUMBER<                → price_total (Buy) | price_annual (Rent)
  icon_s_bed                                → bedrooms
  icon_s_bathtub                            → bathrooms
  icon_s_land_area                          → area_m2
  address line (city, district, …, postal)  → city/region/neighborhood/zip_code
  ICBM/geo.position meta                    → additional_info (latitude/longitude)
  REGA ad license number + dates            → additional_info (rega_ad_license_number …)
  عمر العقار / الواجهة / عرض الشارع / الإفراغ → additional_info / property_age / direction
  معلومات الخدمات (كهرباء/مياه/…)            → electricity/water_supply/sanitation booleans

Usage:  python -m scrapers.toor.run [--limit N] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
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

BASE = "https://www.toor.ooo"
SITEMAP_INDEX = "https://toor.ooo/sitemap_index.xml"
SITEMAP_PROPERTIES = f"{BASE}/sitemap_properties_1.xml"
# Cloudflare-fronted origin; keep concurrency gentle (4 workers, same spirit as Sanadak/Aqarcity).
WORKERS = int(os.environ.get("TOOR_WORKERS", "4"))

# Chip-text (Arabic property type) → canonical English type. Toor's data-property-type list has 29
# values (data-property-type-id 1–29); we only see the ones that actually appear in chips. The
# remainder are fallback-mapped via substring lookup so "شقَّة صغيرة (استوديو)" → "Studio" etc.
TYPE_MAP_AR = {
    "ارض": "Land", "أرض": "Land",  # site uses bare "ارض"; routing below picks residential vs commercial
    "شقة": "Apartment", "شقه": "Apartment", "شقَّة صغيرة (استوديو)": "Studio",
    "فيلا": "Villa", "دور": "Floor", "عمارة": "Building",
    "إستراحة": "Rest House", "استراحه": "Rest House", "شالية": "Chalet", "شاليه": "Chalet",
    "غرفة": "Room", "مزرعة": "Farm",
    # commercial
    "محل": "Shop", "مكتب": "Office", "مستودع": "Warehouse", "معرض": "Showroom",
    "كشك": "Kiosk", "مجمع": "Commercial Building", "برج": "Commercial Building",
    "فندق": "Hotel", "موقف سيارات": "Parking", "ورشة": "Workshop", "صراف": "ATM",
    "مصنع": "Factory", "مدرسة": "School", "مستشفى / مركز صحي": "Hospital",
    "محطة كهرباء": "Power Station", "برج اتصالات": "Telecom Tower",
    "محطة": "Gas Station", "سينما": "Cinema", "آخر": None,
}
COMMERCIAL_TYPES = {
    "Shop", "Office", "Warehouse", "Showroom", "Kiosk", "Commercial Building",
    "Hotel", "Parking", "Workshop", "ATM", "Factory", "School", "Hospital",
    "Power Station", "Telecom Tower", "Gas Station", "Cinema",
}

# Canonical city → region (Saudi). Toor's address-line city names match these.
CITY_TO_REGION = {
    "Riyadh": "Riyadh", "Al Kharj": "Riyadh", "Diriyah": "Riyadh",
    "Jeddah": "Makkah", "Mecca": "Makkah", "Taif": "Makkah",
    "Medina": "Madinah", "Yanbu": "Madinah",
    "Dammam": "Eastern Province", "Khobar": "Eastern Province", "Dhahran": "Eastern Province",
    "Hofuf": "Eastern Province", "Jubail": "Eastern Province", "Qatif": "Eastern Province",
    "Hafar Al Batin": "Eastern Province",
    "Buraidah": "Qassim", "Unaizah": "Qassim", "Abha": "Asir", "Khamis Mushait": "Asir",
    "Tabuk": "Tabuk", "Hail": "Hail", "Jazan": "Jazan",
    "Najran": "Najran", "Al Baha": "Al Bahah", "Arar": "Northern Borders", "Sakaka": "Al Jawf",
}

# Spec-table services → canonical amenity columns (the page lists chips like "كهرباء", "هاتف",
# "ألياف ضوئية" under "معلومات الخدمات").
SERVICE_COLS = {
    "كهرباء": "electricity", "مياه": "water_supply", "ماء": "water_supply",
    "صرف صحي": "sanitation", "ألياف ضوئية": "optical_fibers",
}

# Phone / contact patterns to REDACT from title+description (PDPL).
_PHONE_RE = re.compile(
    r"(?:\+?9665\d{8}"            # +9665XXXXXXXX
    r"|00966\d{9}"                # 00966XXXXXXXXX
    r"|0?5\d{8}"                  # 05XXXXXXXX / 5XXXXXXXX
    r"|9200\d{4,7}"               # unified 9200 numbers
    r"|wa\.me/\S+"                # wa.me links
    r"|واتس\S*\s*\d[\d\s\-]{6,})"
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")

# Regex patterns for the various per-listing values inside the detail-page HTML.
CHIP_RE = re.compile(
    r'<div class="d-inline-flex background-alfa[^"]*"[^>]*>\s*([^<]+?)\s*</div>', re.S)
PRICE_RE = re.compile(
    r'class="d-flex font-weight-500 color-beta font-size-32px[^"]*"[^>]*>\s*'
    r'<div[^>]*>\s*([\d,]+)\s*</div>',
    re.S)
PRICE_RE_FALLBACK = re.compile(
    r'font-size-18px[^"]*"[^>]*>\s*([\d,]+)\s*<span class="font-weight-400[^>]*>\s*<img alt="ر\.س"', re.S)
ICON_BED_RE = re.compile(r'icon_s_bed\b[^"]*"[^>]*></i>\s*</div>\s*<div[^>]*>\s*<span[^>]*>\s*([\d٠-٩]+)\s*<', re.S)
ICON_BATH_RE = re.compile(r'icon_s_(?:bathtub|bath)\b[^"]*"[^>]*></i>\s*</div>\s*<div[^>]*>\s*<span[^>]*>\s*([\d٠-٩]+)\s*<', re.S)
ICON_AREA_RE = re.compile(r'icon_s_land_area\b[^"]*"[^>]*></i>\s*</div>\s*<div[^>]*>\s*<span[^>]*>\s*([\d٠-٩.,]+)\s*<', re.S)
ICBM_RE = re.compile(r'<meta name="ICBM"[^>]*content="\s*([0-9.+-]+)\s*,\s*([0-9.+-]+)\s*"')
LDJSON_PRODUCT_RE = re.compile(
    r'\{\s*"@context":\s*"https://schema\.org",\s*"@type":\s*"Product"(.*?)\}\s*</script>', re.S)
ADDRESS_TITLE_RE = re.compile(
    r'<span class="d-block[^"]*font-size-18px[^"]*"[^>]*>\s*([^<]+?)\s*</span>\s*'
    r'<span[^>]*class="[^"]*font-size-16px[^"]*"[^>]*>\s*([^<]+?)\s*</span>',
    re.S)
# fallback: visible "city, district, ..." line that begins with arabic city
ADDR_LINE_RE = re.compile(
    r'>\s*([ء-ي][^<>]{1,80}(?:,\s*[ء-ي\d][^<>]{1,80}){1,4})\s*<', re.S)
REGA_NO_RE = re.compile(r'رقم ترخيص الإعلان[:\s]*([\d٠-٩]+)')
REGA_ISSUE_RE = re.compile(r'تاريخ الإصدار\s*[:：]?\s*([\d٠-٩]{1,4}[/\-][\d٠-٩]{1,2}[/\-][\d٠-٩]{2,4})')
REGA_EXPIRY_RE = re.compile(r'تاريخ الإنتهاء\s*[:：]?\s*([\d٠-٩]{1,4}[/\-][\d٠-٩]{1,2}[/\-][\d٠-٩]{2,4})')

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
    t = re.sub(r"_?للاتصال[^_\n]*", " ", t)
    t = re.sub(r"_?للتواصل[^_\n]*", " ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t or None


def _unescape_ldjson_str(s: str) -> str:
    """Cheap JSON-string unescape for the values we pull out of the Product LD block via regex."""
    return (s.replace('\\"', '"')
             .replace('\\\\', '\\')
             .replace('\\n', '\n')
             .replace('\\/', '/'))


# ── Sitemap enumeration ───────────────────────────────────────────────────────
def sitemap_urls(s: cc.Session) -> list[str]:
    """Return Toor detail-page URLs from sitemap_properties_1.xml. The sitemap_index references
    properties/agents/schemas children — we only walk the properties one.
    """
    urls: list[str] = []
    try:
        body = s.get(SITEMAP_PROPERTIES, timeout=30).text
    except Exception:
        # Fallback: walk the index and pick the properties child.
        try:
            idx = s.get(SITEMAP_INDEX, timeout=30).text
            for child in re.findall(r"<loc>([^<]*sitemap_properties_\d+\.xml)</loc>", idx):
                try:
                    body = s.get(child, timeout=30).text
                    break
                except Exception:
                    continue
            else:
                return []
        except Exception:
            return []
    # extract every <loc> that points at a Details page
    raw = re.findall(r"<loc>(https://[^<]+?PageId=Details[^<]*)</loc>", body)
    seen: set[str] = set()
    out: list[str] = []
    for u in raw:
        u = u.replace("&amp;", "&")
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out


def fetch_one(url: str) -> Optional[tuple[str, str]]:
    """Fetch a Toor detail page. Returns (body, url) or None on failure / empty shell."""
    s = _session()
    for attempt in range(3):
        try:
            r = s.get(url, timeout=45, allow_redirects=True)
        except Exception:
            time.sleep(1.2 * (attempt + 1))
            continue
        if r.status_code == 200 and len(r.text) > 200_000:
            return r.text, url
        time.sleep(0.8 * (attempt + 1))
    return None


# ── Parsing ────────────────────────────────────────────────────────────────────
def _chips(body: str) -> list[str]:
    """The 2–4 small chips overlaid on the listing's main image: [property_type, offer_type,
    usage, handover]. Empty list means the listing is an unrendered shell (skip).
    """
    out: list[str] = []
    for m in CHIP_RE.finditer(body):
        v = re.sub(r"\s+", " ", m.group(1)).strip()
        if v:
            out.append(v)
        if len(out) >= 6:
            break
    return out


def _ld_product(body: str) -> dict[str, Optional[str]]:
    """Pull name / description / image out of the Product JSON-LD block via regex.
    We use regex rather than json.loads because the block is hand-templated and sometimes contains
    raw newlines inside the description string that break strict JSON parsing.
    """
    m = LDJSON_PRODUCT_RE.search(body)
    if not m:
        return {"name": None, "description": None, "image": None}
    inside = m.group(1)
    out: dict[str, Optional[str]] = {"name": None, "description": None, "image": None}
    for key in ("name", "description", "image"):
        mm = re.search(rf'"{key}":\s*"([^"]*)"', inside, re.S)
        if mm:
            out[key] = _unescape_ldjson_str(mm.group(1)).strip() or None
    return out


def _address_line(body: str, title: Optional[str]) -> Optional[str]:
    """Find the visible address line under the listing title: "<city>, <district>[, <street>][, <postal>]".

    We anchor the search on the listing title text so we never pick up unrelated comma-separated
    lines elsewhere on the page (e.g. the meta-keywords list).
    """
    if not title:
        return None
    idx = 0
    while True:
        i = body.find(title, idx)
        if i < 0:
            break
        # the address line sits within ~600 chars after each visible occurrence of the title
        win = body[i:i + 1200]
        win = re.sub(r"<[^>]+>", " | ", win)
        win = re.sub(r"\s+", " ", win)
        # split into segments by '|' and find the first segment that looks like "AR, AR, ..."
        for seg in win.split("|"):
            seg = seg.strip()
            if "," not in seg or len(seg) < 6 or len(seg) > 200:
                continue
            parts = [p.strip() for p in seg.split(",")]
            if len(parts) < 2:
                continue
            # first part must be Arabic city-like text (no digits, mostly letters)
            head = parts[0]
            if not head or not any("ء" <= c <= "ي" for c in head):
                continue
            if "للبيع" in seg or "استئجار" in seg or "عقارات السعودية" in seg or "للايجار" in seg:
                continue
            return seg
        idx = i + len(title)
    return None


def _images_for(ld_image: Optional[str], body: str, sitemap_image: Optional[str]) -> list[str]:
    """Photo list for the card. Prefer Product.image (the main_picture URL embedded in HTML).
    Fall back to the sitemap image. EXCLUDE property_default.jpg / property.jpg placeholders.
    Toor's detail page only serves one main_picture per listing in HTML; the additional gallery
    images are fetched client-side via /api/getMediaByProperty/<uuid> — empty for every active
    listing in the current ~82-listing catalog, so we don't bother calling it.
    """
    out: list[str] = []
    seen: set[str] = set()
    BAD = ("property_default", "/property.jpg")

    def add(u: Optional[str]) -> None:
        if not u or not isinstance(u, str):
            return
        if any(b in u for b in BAD):
            return
        if u in seen:
            return
        seen.add(u)
        out.append(u)

    add(ld_image)
    # any other distinct main_picture URLs embedded in the body
    for m in re.finditer(r'https://files\.toor\.ooo/properties_picture/[^\s"\'<>`]+\.(?:jpe?g|png|webp)', body, re.I):
        add(m.group(0))
    add(sitemap_image)
    return out[:25]


def _spec_value(body: str, label: str) -> Optional[str]:
    """Return the value rendered next to a label like 'عمر العقار' or 'الواجهة' on the spec
    section. The site renders "<div class='font-size-18px'>عمر العقار</div><div ...>VALUE</div>"
    with deeply nested wrappers, so we normalize via strip-tags within a 400-char window.
    """
    out = None
    for m in re.finditer(re.escape(label), body):
        i = m.end()
        win = body[i:i + 400]
        text = re.sub(r"<[^>]+>", " | ", win)
        text = re.sub(r"\s+", " ", text)
        for seg in text.split("|"):
            seg = seg.strip()
            if seg and seg != label and len(seg) < 80 and not seg.startswith("rgb"):
                out = seg
                break
        if out:
            break
    return out


def _services(body: str) -> dict[str, bool]:
    """Read the "معلومات الخدمات" section and map each Arabic service chip to a column.
    The section runs from "معلومات الخدمات" up to the next big-font heading ("الحدود والأطوال" /
    "الموقع والجوار" / etc.) — anything outside that window is unrelated UI labels and ignored.
    """
    amen: dict[str, bool] = {}
    i = body.find("معلومات الخدمات")
    if i < 0:
        return amen
    end_marks = ["الحدود والأطوال", "الموقع والجوار", "معلومات إضافية",
                 "الميزات والمرافق", "معلومات رخصة الإعلان"]
    end_i = len(body)
    for em in end_marks:
        j = body.find(em, i + 5)
        if 0 < j < end_i:
            end_i = j
    chunk = body[i:end_i]
    text = re.sub(r"<[^>]+>", " | ", chunk)
    text = re.sub(r"\s+", " ", text)
    for ar, col in SERVICE_COLS.items():
        if col and ar in text:
            amen[col] = True
    return amen


def _age_to_int(age_text: Optional[str]) -> Optional[int]:
    """Convert Toor's textual age (e.g. "اكثر من عشر سنوات", "جديد", "5 سنوات") to an integer.
    Anything unparseable returns None — we only want a best-effort hint, not noise."""
    if not age_text:
        return None
    t = age_text.strip()
    if t in ("جديد", "جديده", "جديدة"):
        return 0
    # numeric like "5 سنوات"
    m = re.search(r"[\d٠-٩]+", t)
    if m:
        n = _int(m.group(0))
        if n is not None:
            return n
    # textual buckets
    if "أكثر من عشر" in t or "اكثر من عشر" in t:
        return 11
    if "أكثر من خمس" in t or "اكثر من خمس" in t:
        return 6
    return None


def _city_region(addr_line: Optional[str]) -> tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
    """(city_en, region_en, district_ar, postal) from the visible address line."""
    if not addr_line:
        return None, None, None, None
    parts = [p.strip() for p in addr_line.split(",") if p.strip()]
    raw_city = parts[0] if parts else None
    district = parts[1] if len(parts) > 1 else None
    # postal = the last numeric-only part (5 digits)
    postal = None
    for p in reversed(parts):
        if re.fullmatch(r"\d{5}", p):
            postal = p
            break
    city_en = normalize.map_city(raw_city or "") if raw_city else None
    region_en = CITY_TO_REGION.get(city_en) if city_en else None
    return city_en, region_en, district, postal


def map_listing(body: str, url: str, sitemap_image: Optional[str] = None) -> tuple[Optional[dict], str]:
    """Return (row, category) where category ∈ {residential, commercial}. None row means skip."""
    chips = _chips(body)
    if not chips:
        return None, "residential"  # unrendered / empty shell
    # Chips are emitted in a stable order [property_type, offer_type, usage?, handover?] but the
    # optional usage chip is sometimes missing, which would mis-bucket the handover chip ("الإفراغ
    # فوري") as the usage. So we pick each role by content-match rather than position.
    chip_type_ar = chips[0]
    OFFER_VALS = {"للبيع", "للإيجار", "للايجار", "مزاد"}
    USAGE_VALS = {"سكني", "تجاري", "زراعي", "صناعي", "استثماري"}
    offer_type = next((c for c in chips if c in OFFER_VALS), "")
    usage = next((c for c in chips if c in USAGE_VALS), "")

    # Drop auctions (Toor lists them under "مزاد"); Ezhalah only ingests Buy/Rent.
    if offer_type == "مزاد":
        return None, "residential"

    is_rent = ("إيجار" in offer_type) or ("ايجار" in offer_type)
    is_buy = "بيع" in offer_type
    if not (is_rent or is_buy):
        # Unknown offer type — default to Buy (Toor's catalog is overwhelmingly sales).
        is_buy = True

    # Property type from chip; substring fallback for compound labels.
    property_type = TYPE_MAP_AR.get(chip_type_ar)
    if not property_type:
        for word, eng in TYPE_MAP_AR.items():
            if word and word in chip_type_ar:
                property_type = eng
                break

    # Land usage routing: usage chip is the source of truth for residential vs commercial.
    is_commercial_usage = usage == "تجاري"
    if property_type == "Land":
        property_type = "Residential Land" if not is_commercial_usage else "Commercial Land"
    category = "commercial" if (property_type in COMMERCIAL_TYPES or is_commercial_usage) else "residential"
    if property_type is None:
        property_type = "Residential Land"  # safe default; usage chip drives routing above

    # ── core text fields (Product JSON-LD) ──
    ld = _ld_product(body)
    title = _redact(ld.get("name"))
    description = _redact(ld.get("description"))
    addr_line = _address_line(body, ld.get("name") or title)
    city_en, region_en, district_ar, postal = _city_region(addr_line)

    # ── numerics from icon rows ──
    area_m = ICON_AREA_RE.search(body)
    area = _float(area_m.group(1)) if area_m else None
    beds_m = ICON_BED_RE.search(body)
    beds = _int(beds_m.group(1)) if beds_m else None
    baths_m = ICON_BATH_RE.search(body)
    baths = _int(baths_m.group(1)) if baths_m else None

    # Sanity: bedrooms only make sense for residential; cap at 20.
    if category == "commercial" or property_type in ("Residential Land", "Commercial Land"):
        beds = None
    if beds is not None and (beds <= 0 or beds > 20):
        beds = None

    # ── price ──
    pm = PRICE_RE.search(body)
    if not pm:
        pm = PRICE_RE_FALLBACK.search(body)
    price = _int(pm.group(1)) if pm else None
    if price is not None and price < 1000:
        # Reject implausibly tiny prices (display glitch / unit confusion).
        price = None
    price_per_meter = round(price / area) if (price and area and is_buy) else None

    # ── REGA license + dates ──
    rega_no = None
    m = REGA_NO_RE.search(body)
    if m:
        rega_no = _int(m.group(1))
    rega_issue = REGA_ISSUE_RE.search(body)
    rega_expiry = REGA_EXPIRY_RE.search(body)

    # ── specs from the labelled blocks ──
    age_text = _spec_value(body, "عمر العقار")
    facade = _spec_value(body, "الواجهة")
    handover = _spec_value(body, "الإفراغ")  # often "فوري"
    street_w_text = _spec_value(body, "عرض الشارع الرئيسي")
    street_w = _int(street_w_text) if street_w_text else None

    # ── geo (page meta) ──
    icbm = ICBM_RE.search(body)
    lat = lng = None
    if icbm:
        lat, lng = icbm.group(1), icbm.group(2)
        # Toor sets a default 24.7136,46.6753 (Riyadh KSA centroid) on every page when the listing
        # has no precise pin — skip storing those as if they were the listing's coordinates.
        if lat == "24.7136" and lng == "46.6753":
            lat = lng = None

    # ── property id (uuid) ──
    pid_m = re.search(r"PropertyId=([0-9a-f-]{36})", url)
    pid = pid_m.group(1) if pid_m else None
    if not pid:
        return None, "residential"

    # ── amenity columns from "معلومات الخدمات" ──
    amenities = _services(body)

    # ── additional_info: every remaining valuable field (NO name, NO phone) ──
    info: dict[str, Any] = {
        "city_ar": addr_line.split(",")[0].strip() if addr_line else None,
        "region_ar": None,  # Toor doesn't ship a separate region label; CITY_TO_REGION derives it
        "district_ar": district_ar,
        "category_ar": chip_type_ar,
        "usage_ar": usage or None,
        "offer_ar": offer_type or None,
        "handover": handover,
        "facade_ar": facade,
        "property_age_text": age_text,
        "rega_ad_license_number": rega_no,
        "rega_license_issue_date": rega_issue.group(1) if rega_issue else None,
        "rega_license_expiry_date": rega_expiry.group(1) if rega_expiry else None,
        "latitude": lat,
        "longitude": lng,
        "street_width": street_w_text,
        "address_line_ar": addr_line,
    }
    info = {k: v for k, v in info.items() if v not in (None, "", "—")}

    row: dict[str, Any] = {
        "ad_number": f"TR{pid}",
        "listing_url": f"https://toor.ooo/Platform?PageId=Details&PropertyId={pid}",
        "source": "Toor",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": round(area) if area else None,
        "bedrooms": beds,
        "bathrooms": baths,
        "property_age": _age_to_int(age_text),
        "direction": facade or None,
        "street_width_m": street_w,
        "price_total": price if is_buy else None,
        "price_annual": price if is_rent else None,
        "price_per_meter": price_per_meter,
        "rent_period": "annual" if is_rent else None,
        "city": city_en,
        "region": region_en,
        "neighborhood": district_ar,
        "zip_code": postal,
        "rega_location_verified": bool(rega_no),
        "title": title,
        "description": description,
        "photo_urls": _images_for(ld.get("image"), body, sitemap_image),
        "additional_info": info,
    }
    row.update(amenities)
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
    # Walk the sitemap once and also collect each listing's main image (the sitemap embeds an
    # <image:loc> sibling for every entry — handy when the detail page's Product JSON-LD ever
    # ships without an image URL).
    sitemap_img_map: dict[str, str] = {}
    try:
        sm_body = s.get(SITEMAP_PROPERTIES, timeout=30).text
        for u, img in re.findall(
                r"<loc>(https://[^<]+?PageId=Details[^<]*)</loc>.*?<image:loc>([^<]+)</image:loc>",
                sm_body, re.S):
            sitemap_img_map[u.replace("&amp;", "&")] = img
    except Exception:
        pass

    if args.limit:
        # take ~3× the limit so a few unrendered shells don't starve the target count
        urls = urls[: max(args.limit * 3, 30)]
    print(f"Toor: {len(urls)} candidate listings ({WORKERS} workers)"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

    run_id = None if args.limit else db.begin_run("toor")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        res_buf: list[dict] = []
        com_buf: list[dict] = []

        def flush() -> None:
            nonlocal res_buf, com_buf
            if res_buf:
                db.upsert_toor_residential_batch(res_buf)
                res_buf = []
            if com_buf:
                db.upsert_toor_commercial_batch(com_buf)
                com_buf = []

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for result in ex.map(fetch_one, urls):
                if not result:
                    continue
                body, u = result
                row, cat = map_listing(body, u, sitemap_img_map.get(u))
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
            print(f"✓ Toor VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            for r in (res + com)[:6]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "bathrooms",
                    "price_total", "price_annual", "rent_period")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:80])
            return 0

        # Full run: prune listings active before this crawl but missing now.
        pruned = 0
        for tbl, rows_seen in (("toor_residential_listings", res),
                               ("toor_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Toor")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Toor: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
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
