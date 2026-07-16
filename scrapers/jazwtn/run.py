"""Jazwtn (jazwtn.sa / جازان وطن للخدمات العقارية) scraper — Saudi WordPress site, detail-HTML parse.

جذوة وطن العقارية (brand name "جازان وطن للخدمات العقارية") is a Jazan-region brokerage. ~136
listings live under the WordPress `projects` custom-post-type. The CPT has NO public REST endpoint,
so we enumerate /projects/<slug>/ URLs from projects-sitemap.xml (each <url> also carries an
<image:loc> featured image) then fetch + parse each detail page's HTML.

Two listing shapes:
  • LAND PLOTS ("للبيع قطعة رقم … مخطط …" / "أرض سكنية") — total area (إجمالي المساحة) + a
    📌/💰/🔑 bullet description giving plan/block/lot numbers, per-m² price (often tiered:
    "850 ريال للمتر" single-frontage / "1,000 ريال للمتر" corner — we take the LOWEST as the
    base price_per_meter), street frontage, landmarks, features. price_total = per-m² × area.
  • UNITS ("شقة/فيلا/دور/روف … N غرف") — area (مساحة : N م²) + a descriptive paragraph + bedroom
    count from the title ("5 غرف"). Bathrooms ("N دورات مياة") + amenities from the description.
    Total price used only when explicitly stated.

Field map (Jazwtn → our schema):
  og:title (AR)                          → title (deal + type + beds + district + plan + city)
  للبيع | للإيجار                         → transaction_type Buy | Rent
  أرض/قطعة · شقة · فيلا · روف · دور …      → property_type (TYPE rules) + res/com routing
  N غرف (title)                           → bedrooms (units only; null for land/commercial)
  مساحة / إجمالي المساحة                   → area_m2
  "… ريال للمتر" (lowest tier)            → price_per_meter ; × area → price_total (land)
  جيزان / جازان (+ region)                → city / region (Jazan focus)
  حي … (title / description)              → neighborhood
  📌/💰/🔑 bullet block                    → description (Arabic, phone-redacted)
  image:loc (sitemap) + uploads gallery   → photo_urls (logos/icons/placeholders excluded)
No per-listing REGA licence is exposed on the page → rega_location_verified = False.

PDPL: the page embeds a Gravity-Forms lead-capture form (الاسم الكامل / رقم الجوال …) — that is
the VISITOR's input scaffold, NOT listing data, so we ignore it entirely. We also REDACT any 05x /
+9665 / wa.me phone from title + description before storing, and never store any advertiser name.

Usage:  python -m scrapers.jazwtn.run [--limit N] [--type residential|commercial|all]
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

BASE = "https://jazwtn.sa"
SITEMAP = f"{BASE}/projects-sitemap.xml"
WORKERS = int(os.environ.get("JAZWTN_WORKERS", "5"))

# Arabic property-type word (from the title) → canonical English. Order matters: the title is a
# free-text phrase ("للبيع شقة تمليك روف 5 غرف …"), so we scan in priority order and take the
# first hit. "قطعة" (plot) with no building word → Residential Land.
TYPE_RULES = [
    ("أرض تجارية", "Commercial Land"),
    ("ارض تجارية", "Commercial Land"),
    ("محل", "Shop"),
    ("مكتب", "Office"),
    ("معرض", "Showroom"),
    ("مستودع", "Warehouse"),
    ("عمارة", "Building"),
    ("عماره", "Building"),
    ("استراحة", "Rest House"),
    ("استراحه", "Rest House"),
    ("شاليه", "Chalet"),
    ("مزرعة", "Farm"),
    ("مزرعه", "Farm"),
    ("روف", "Floor"),
    ("دور", "Floor"),
    ("شقة", "Apartment"),
    ("شقه", "Apartment"),
    ("فيلا", "Villa"),
    ("فلة", "Villa"),
    ("دوبلكس", "Villa"),
    ("قصر", "Villa"),
    ("بيت", "House"),
    ("منزل", "House"),
    ("أرض", "Residential Land"),
    ("ارض", "Residential Land"),
    ("قطعة", "Residential Land"),
    ("قطعه", "Residential Land"),
    ("قطع", "Residential Land"),
]
COMMERCIAL_TYPES = {
    "Shop", "Office", "Showroom", "Warehouse", "Commercial Land", "Commercial Building",
}
LAND_TYPES = {"Residential Land", "Commercial Land", "Farm"}

# Arabic city → canonical English (Jazan region; map_city covers the rest). Both spellings of the
# city/region name appear (جيزان city label / جازان region label) — both resolve to Jazan.
CITY_AR = {
    "جيزان": "Jazan", "جازان": "Jazan", "أبو عريش": "Abu Arish", "ابو عريش": "Abu Arish",
    "أبوعريش": "Abu Arish", "ابوعريش": "Abu Arish", "صبيا": "Sabya", "صامطة": "Samtah",
    "بيش": "Baysh", "أحد المسارحة": "Ahad Al Masarihah", "احد المسارحة": "Ahad Al Masarihah",
}

# Phone / contact patterns to REDACT (PDPL). Hardened battery (defense-in-depth): the Jazwtn
# pages embed the brokerage's own 9200 short-code + a wa.me link + a lead form, and a future
# template change could inline an agent mobile into the description, so we cover every shape:
# +966/00966/bare-966, 05x (incl. space/dash-separated like "0555 123 456"), 9200/920 unified
# numbers, and wa.me / واتس links.
_PHONE_RE = re.compile(
    r"(?:\+?00?966\d{8,9}"                 # +966xxxxxxxx / 00966xxxxxxxxx
    r"|\b966\d{8,9}\b"                     # bare 966xxxxxxxx(x)
    r"|0?5\d(?:[\s\.\-]?\d){7}"            # 05xxxxxxxx / 5xxxxxxxx, separators allowed
    r"|\b9200\d{4}\b"                      # 9200xxxx short-codes (e.g. 92003185)
    r"|\b920\d{6}\b"                       # 920xxxxxx unified numbers
    r"|\b800\d{7}\b"                       # 800xxxxxxx toll-free
    r"|wa\.me/\S+"
    r"|واتس\S*\s*\d[\d\s\-]{6,})"
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")

OG_TITLE_RE = re.compile(r'<meta property="og:title" content="([^"]+)"')
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
AREA_RE = re.compile(r"مساحة\s*:\s*(?:إجمالي\s+المساحة\s*:\s*)?([\d٠-٩][\d٠-٩.,]*)\s*(?:م²|م2|م\b|متر)")
# fallback: "اجمالي مساحة القطع / 3094 م" — a few Arabic words may sit between مساحة and the number.
AREA_RE2 = re.compile(r"مساح[ةه][^\d٠-٩]{0,25}([\d٠-٩][\d٠-٩.,]{1,})\s*(?:م²|م2|م\b|متر)")
# A per-m² price tier, e.g. "850 ريال للمتر" / "1,000 ريال للمتر".
PER_M_RE = re.compile(r"([\d٠-٩][\d٠-٩.,]*)\s*ريال\s*(?:سعودي\s*)?للمتر")
# explicit total sale price, e.g. "السعر الكلي 850 ألف" / "سعر البيع 1,200,000 ريال"
TOTAL_RE = re.compile(
    r"(?:السعر\s+الكلي|السعر\s+الإجمالي|السعر\s+الاجمالي|سعر\s+البيع|السعر)\s*[:؛]?\s*"
    r"([\d٠-٩][\d٠-٩.,]*)\s*(ألف|الف|مليون)?"
)
# bedrooms from the title, e.g. "5 غرف" / "٦ غرف" / "غرفتين"
BEDS_RE = re.compile(r"([\d٠-٩]{1,2})\s*غرف")
# bathrooms from the description, e.g. "3 دورات مياة" / "دورتين مياه"
BATHS_RE = re.compile(r"([\d٠-٩]{1,2})\s*دورات?\s*(?:مياه|مياة|المياه)")
# plan / lot / block numbers (additional_info)
PLAN_RE = re.compile(r"مخطط\s*(?:رقم\s*)?\(?\s*([\d٠-٩]{1,6})")
LOT_RE = re.compile(r"قطعة\s*(?:رقم\s*)?\(?\s*([\d٠-٩]{1,6})")
BLOCK_RE = re.compile(r"بلك\s*(?:رقم\s*)?\(?\s*([\d٠-٩]{1,6})")
# District after "حي" / "بحي" — capture up to 2 tokens but STOP at structural connectors
# ("ضاحية", "بمدينة", "مخطط", "في", "جيزان"…) so we don't swallow the rest of the title.
_DIST_STOP = ("ضاحية", "بمدينة", "مدينة", "مخطط", "بمخطط", "في", "بجازان", "بجيزان",
              "جيزان", "جازان", "طريق", "بتصميم", "بحي")
DISTRICT_RE = re.compile(r"ب?حي\s+(.+?)(?:\s+(?:" + "|".join(_DIST_STOP) + r")\b|[\(\)،–\-]|$)")

# Gallery image junk to exclude.
_BAD_IMG = ("logo", "icon", "placeholder", "no-image", "no_image", "spinner", "avatar",
            "favicon", "/svg/")

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


def _strip_tags(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return text
    t = _PHONE_LOOSE.sub(" ", text)
    t = _PHONE_RE.sub(" ", t)
    t = re.sub(r"_?للاتصال[^_\n]*", " ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t or None


def _magnitude(num: Optional[int], unit: Optional[str]) -> Optional[int]:
    """'850' + 'ألف' → 850000 ; '1.2' + 'مليون' → 1200000."""
    if num is None:
        return None
    if unit in ("ألف", "الف"):
        return int(num * 1000)
    if unit == "مليون":
        return int(num * 1_000_000)
    return num


# ── Sitemap enumeration ───────────────────────────────────────────────────────
def sitemap_entries(s: cc.Session) -> list[tuple[str, Optional[str]]]:
    """Return [(listing_url, featured_image|None)] for every /projects/<slug>/ except the
    archive-root /projects/ URL."""
    body = s.get(SITEMAP, timeout=30).text
    out: list[tuple[str, Optional[str]]] = []
    seen: set[str] = set()
    for block in re.findall(r"<url>(.*?)</url>", body, re.S):
        m = re.search(r"<loc>([^<]+)</loc>", block)
        if not m:
            continue
        url = m.group(1).strip()
        # skip the archive root (…/projects/ with no slug)
        if url.rstrip("/").rsplit("/", 1)[-1] == "projects":
            continue
        if "/projects/" not in url or url in seen:
            continue
        seen.add(url)
        img_m = re.search(r"<image:loc>([^<]+)</image:loc>", block)
        out.append((url, img_m.group(1).strip() if img_m else None))
    return out


def fetch_one(entry: tuple[str, Optional[str]]) -> Optional[tuple[str, str, Optional[str]]]:
    """Fetch the detail page. Returns (body, url, featured_image) or None."""
    url, img = entry
    s = _session()
    for attempt in range(3):
        try:
            r = s.get(url, timeout=45, allow_redirects=True)
        except Exception:
            time.sleep(1.2 * (attempt + 1))
            continue
        if r.status_code == 200 and len(r.text) > 2000:
            return r.text, url, img
        time.sleep(1.0 * (attempt + 1))
    return None


# ── Parsing ────────────────────────────────────────────────────────────────────
def _title(body: str) -> str:
    m = OG_TITLE_RE.search(body) or TITLE_RE.search(body)
    raw = _strip_tags(m.group(1)) if m else ""
    # strip the site-name suffix "… | جازان وطن للخدمات العقارية"
    return raw.split("|")[0].strip()


def _map_type(title: str) -> str:
    for word, eng in TYPE_RULES:
        if word in title:
            return eng
    return "Residential Land"  # default: most Jazwtn listings are plots


def _description(body: str) -> Optional[str]:
    """The Arabic content block. Prefer the 📌-anchored bullet block (land plots); else the
    descriptive paragraph that follows the 'مساحة : …' line and precedes the lead-capture form
    ('طلب عقار'). The Gravity-Forms scaffold is NEVER included."""
    txt = _strip_tags(body)
    # Land plots: from the first emoji marker up to the lead form.
    start = -1
    for marker in ("📌", "💰", "🔑"):
        i = txt.find(marker)
        if i != -1 and (start == -1 or i < start):
            start = i
    if start == -1:
        # Units: take the paragraph after the area. Prefer the end of "مساحة : N م…"; if the area
        # has no number (some units render "مساحة : <descriptive text>"), start right after the
        # bare "مساحة :" label so the descriptive paragraph is still captured.
        am = AREA_RE.search(txt)
        if am:
            start = am.end()
        else:
            lm = re.search(r"مساحة\s*:\s*", txt)
            if lm:
                start = lm.end()
    if start == -1:
        return None
    end = txt.find("طلب عقار", start)
    if end == -1:
        end = start + 1500
    block = txt[start:end].strip()
    # drop any residual Gravity-Forms / script tokens
    block = re.split(r"&times;|gform|jQuery|gf_global|الاسم الكامل", block)[0].strip()
    return _redact(block) or None


def _images(body: str, featured: Optional[str]) -> list[str]:
    """Featured image (sitemap) first, then the full gallery from the detail HTML. Strip
    WordPress -WxH size suffixes to full-size, exclude logos/icons/placeholders."""
    out: list[str] = []
    seen: set[str] = set()

    def add(u: str) -> None:
        if not u:
            return
        low = u.lower()
        if any(b in low for b in _BAD_IMG):
            return
        # strip "-1024x768" style size suffixes → full-size original
        full = re.sub(r"-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp)$)", "", u, flags=re.I)
        if full not in seen:
            seen.add(full)
            out.append(full)

    if featured:
        add(featured)
    for u in re.findall(
        r"https://jazwtn\.sa/wp-content/uploads/[^\s\"'\\)<>]+?\.(?:jpe?g|png|webp)", body, re.I
    ):
        add(u)
    return out[:25]


def map_listing(body: str, url: str, featured: Optional[str]) -> tuple[Optional[dict], str]:
    title_raw = _title(body)
    if not title_raw:
        return None, "residential"
    txt = _strip_tags(body)

    property_type = _map_type(title_raw)
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"
    is_land = property_type in LAND_TYPES

    # ── transaction type (default Buy: Jazwtn is overwhelmingly sale) ──
    is_rent = (("للإيجار" in title_raw or "للايجار" in title_raw or "إيجار" in title_raw
                or "ايجار" in title_raw) and "للبيع" not in title_raw)

    # the listing's OWN content block (title + description) — never the full page, which carries
    # the office address / related-listings chrome that contaminated district across every row.
    description = _description(body)
    own_text = f"{title_raw}\n{description or ''}"

    # ── area ──
    am = AREA_RE.search(txt)
    area = _to_float(am.group(1)) if am else None
    if area is None:
        am2 = AREA_RE2.search(own_text) or AREA_RE2.search(txt)
        area = _to_float(am2.group(1)) if am2 else None

    # ── per-m² price (lowest tier) + total ──
    per_m_vals = [v for v in (_to_int(m.group(1)) for m in PER_M_RE.finditer(txt)) if v and v >= 50]
    price_per_meter = min(per_m_vals) if per_m_vals else None

    price_total = None
    tm = TOTAL_RE.search(txt)
    if tm:
        cand = _magnitude(_to_int(tm.group(1)), tm.group(2))
        if cand and cand >= 1000:
            price_total = cand
    if price_total is None and price_per_meter and area:
        price_total = int(round(price_per_meter * area))

    # ── bedrooms (units only) / bathrooms ──
    bedrooms = None
    if not is_land and category == "residential":
        bm = BEDS_RE.search(title_raw)
        if bm:
            n = _to_int(bm.group(1))
            if n and 0 < n <= 20:
                bedrooms = n
    baths = None
    if category == "residential" and not is_land:
        bm = BATHS_RE.search(txt)
        if bm:
            baths = _to_int(bm.group(1))

    # ── location ──
    raw_city = None
    for ar in CITY_AR:
        if ar in title_raw:
            raw_city = ar
            break
    if not raw_city:
        for ar in CITY_AR:
            if ar in txt:
                raw_city = ar
                break
    city = CITY_AR.get(raw_city) if raw_city else None
    if not city:
        city = normalize.map_city(title_raw) or "Jazan"
    region = "Jazan"  # the brokerage operates only in the Jazan region

    district = None
    # title first (listing-specific), then the listing's own description — NOT the whole page.
    dm = DISTRICT_RE.search(title_raw) or (DISTRICT_RE.search(description) if description else None)
    if dm:
        district = dm.group(1).strip()

    # ── plan / lot / block ──
    plan_no = (m.group(1) if (m := PLAN_RE.search(title_raw)) else
               (m.group(1) if (m := PLAN_RE.search(txt)) else None))
    lot_no = (m.group(1) if (m := LOT_RE.search(title_raw)) else
              (m.group(1) if (m := LOT_RE.search(txt)) else None))
    block_no = m.group(1) if (m := BLOCK_RE.search(txt)) else None

    title = _redact(title_raw)

    # globally-unique ad number from the slug — DETERMINISTIC (md5, not Python's salted hash())
    # so the same listing yields the same JZ id across runs and upserts cleanly on ad_number.
    slug = url.rstrip("/").rsplit("/", 1)[-1]
    ad_id = int(hashlib.md5(slug.encode("utf-8")).hexdigest()[:12], 16)

    info: dict[str, Any] = {
        "city_ar": raw_city or "جازان",
        "region_ar": "منطقة جازان",
        "district_ar": district,
        "plan_number": normalize.to_int(plan_no) if plan_no else None,
        "lot_number": normalize.to_int(lot_no) if lot_no else None,
        "block_number": normalize.to_int(block_no) if block_no else None,
        "price_per_meter_tiers": per_m_vals if len(per_m_vals) > 1 else None,
        "slug": slug,
    }
    info = {k: v for k, v in info.items() if v not in (None, "", [], "—")}

    row: dict[str, Any] = {
        "ad_number": f"JZ{ad_id}",
        "listing_url": url,
        "source": "Jazwtn",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": int(round(area)) if area else None,
        "bedrooms": bedrooms,
        "bathrooms": baths,
        "price_total": price_total if not is_rent else None,
        "price_annual": price_total if is_rent else None,
        "price_per_meter": price_per_meter,
        "rent_period": "annual" if is_rent else None,
        "city": city,
        "region": region,
        "neighborhood": district,
        "project_name": (f"مخطط {plan_no}" if plan_no else None),
        "rega_location_verified": False,
        "title": title,
        "description": description,
        "photo_urls": _images(body, featured),
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
    entries = sitemap_entries(s)
    if args.limit:
        entries = entries[: max(args.limit * 2, 30)]
    print(f"Jazwtn: {len(entries)} candidate listings ({WORKERS} workers)"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

    run_id = None if args.limit else db.begin_run("jazwtn")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        res_buf: list[dict] = []
        com_buf: list[dict] = []

        def flush() -> None:
            nonlocal res_buf, com_buf
            if res_buf:
                db.upsert_jazwtn_residential_batch(res_buf)
                res_buf = []
            if com_buf:
                db.upsert_jazwtn_commercial_batch(com_buf)
                com_buf = []

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for result in ex.map(fetch_one, entries):
                if not result:
                    continue
                body, u, img = result
                row, cat = map_listing(body, u, img)
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
            print(f"✓ Jazwtn VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            for r in (res + com)[:6]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "price_total", "price_per_meter")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:72])
            return 0

        # Full run: prune listings active before that weren't seen this crawl.
        # db.prune_unseen carries the safety guards (0-scrape / collapse → skip, never wipe).
        pruned = 0
        for tbl, rows_seen in (("jazwtn_residential_listings", res),
                               ("jazwtn_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Jazwtn")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Jazwtn: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"pruned={pruned}", check_tables=["jazwtn_residential_listings", "jazwtn_commercial_listings"])
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
