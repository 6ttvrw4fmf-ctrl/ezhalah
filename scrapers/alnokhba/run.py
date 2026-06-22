"""Al Nokhba (alnokhba-services.com / النخبة للخدمات العقارية) scraper — static-HTML Saudi site.

النخبة للخدمات العقارية is a small Makkah-region real-estate / brokerage office (وساطة وتسويق
عقاري). Saudi-operated, Makkah-only catalog → passes the Saudi-only rule. Tiny inventory
(~7 live listings). No auth, no proxy, no API — plain server-rendered HTML.

Data path (auth-free, static HTML):
  (1) GET https://alnokhba-services.com/properties  → the index page. Each listing is a
      `<div class="property-card …">` whose detail link is `/property/<id>` and whose Swiper
      gallery carries the FULL set of `<img … class="property-image">` photos for that listing
      (the detail page only renders one `media-item` image, so the index card is the richer
      photo source — we map id → gallery here).
  (2) For each `/property/<id>`, GET the detail page and parse four clean content divs:
        property-details-name        → title
        property-details-address     → "City - District - Sub"  → city/region/neighborhood
        property-details-description  → description (area / beds / baths mined from here)
        property-details-price        → price text  ("20000 دفعات أو شهري", "٢ مليون و٥٠٠ …")

TYPE: from the title/description Arabic words (فيلا/شقة/عمارة/أرض/محل …) → canonical English.
DEAL: rent vs buy from للإيجار/للبيع/شهري/دفعات/مليون cues (defaults to Rent — this office is
  overwhelmingly residential rentals; "للبيع"/"مليون"/"بيع" flips to Buy).

⛔⛔ PDPL ABSOLUTE — every listing's only contact path is a WhatsApp CTA
  (`api.whatsapp.com/send/?phone=+9665…` / wa.me) plus a floating WhatsApp FAB. We DROP all of
  it: we never store the phone, the wa.me link, the agent/owner name, or any 05x/+9665/9200/920
  number. The four content divs are listing facts (type/area/price/location), never a person —
  but we still run _redact() over title + description as a defense-in-depth phone battery before
  storing, in case a future card inlines a mobile number into the free text.

Photos: index-card gallery first (full set), then the detail page's media-item, deduped; logos /
  icons / placeholders / "Screenshot-WhatsApp" chat-screenshots excluded.

Usage:  python -m scrapers.alnokhba.run [--limit N] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
import hashlib
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

BASE = "https://alnokhba-services.com"
INDEX = f"{BASE}/properties"
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.4"))

# Arabic property-type word → canonical English. Scanned in priority order against the
# title (then description); "عمارة" = Building, lone "أرض"/"قطعة" with no building word = land.
TYPE_RULES = [
    ("أرض تجارية", "Commercial Land"),
    ("ارض تجارية", "Commercial Land"),
    ("عمارة تجارية", "Commercial Building"),
    ("عماره تجارية", "Commercial Building"),
    ("محل", "Shop"),
    ("معرض", "Showroom"),
    ("مكتب", "Office"),
    ("مستودع", "Warehouse"),
    ("ورشة", "Workshop"),
    ("ورشه", "Workshop"),
    ("مصنع", "Factory"),
    ("عمارة", "Building"),
    ("عماره", "Building"),
    ("عمائر", "Building"),
    ("بناية", "Building"),
    ("برج", "Building"),
    ("استراحة", "Rest House"),
    ("استراحه", "Rest House"),
    ("شاليه", "Chalet"),
    ("مزرعة", "Farm"),
    ("مزرعه", "Farm"),
    ("روف", "Floor"),
    ("دور", "Floor"),
    ("شقق", "Apartment"),
    ("شقة", "Apartment"),
    ("شقه", "Apartment"),
    ("استوديو", "Apartment"),
    ("فيلا", "Villa"),
    ("فلة", "Villa"),
    ("فلل", "Villa"),
    ("دوبلكس", "Villa"),
    ("قصر", "Villa"),
    ("بيت", "House"),
    ("منزل", "House"),
    ("أرض", "Residential Land"),
    ("ارض", "Residential Land"),
    ("أراضي", "Residential Land"),
    ("اراضي", "Residential Land"),
    ("قطعة", "Residential Land"),
    ("قطعه", "Residential Land"),
]
COMMERCIAL_TYPES = {
    "Shop", "Showroom", "Office", "Warehouse", "Workshop", "Factory",
    "Commercial Land", "Commercial Building",
}
LAND_TYPES = {"Residential Land", "Commercial Land", "Farm"}

# Arabic city label (from property-details-address) → canonical English city. This office is
# Makkah-only; map_city covers anything unexpected. "مكة" / "مكة المكرمة" → Mecca.
CITY_AR = {
    "مكة المكرمة": "Mecca", "مكة": "Mecca", "جدة": "Jeddah", "الطائف": "Taif",
    "رابغ": "Rabigh", "القنفذة": "Al Qunfudhah", "الجموم": "Al Jumum", "الليث": "Al Lith",
}

# Phone / contact patterns to REDACT (PDPL). The site's only contact channel is WhatsApp, so we
# cover every shape: +966/00966/bare-966, 05x (separators allowed), 9200/920 unified, 800
# toll-free, wa.me / api.whatsapp.com links, and "واتساب 05…" lines.
_PHONE_RE = re.compile(
    r"(?:\+?00?966\d{8,9}"                  # +966xxxxxxxx / 00966xxxxxxxxx
    r"|\b966\d{8,9}\b"                      # bare 966xxxxxxxx(x)
    r"|0?5\d(?:[\s\.\-]?\d){7}"             # 05xxxxxxxx / 5xxxxxxxx, separators allowed
    r"|\b9200\d{4}\b"                       # 9200xxxx short-codes
    r"|\b920\d{6}\b"                        # 920xxxxxx unified numbers
    r"|\b800\d{7}\b"                        # 800xxxxxxx toll-free
    r"|(?:api\.)?wa(?:\.me|tsapp)\S*"       # wa.me / api.whatsapp / whatsapp links
    r"|واتس\S*\s*\d[\d\s\-]{6,})"           # "واتساب 05…"
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")

NAME_RE = re.compile(r'property-details-name">(.*?)</div>', re.S)
ADDR_RE = re.compile(r'property-details-address">(.*?)</div>', re.S)
DESC_RE = re.compile(r'property-details-description">(.*?)</div>', re.S)
PRICE_RE = re.compile(r'property-details-price">(.*?)</div>', re.S)

# area "المساحة ٢١٥م٢" / "٩٣٧م٢" / "215 م2"
AREA_RE = re.compile(r"(?:المساحة|مساحة)\s*[:\-]?\s*([\d٠-٩][\d٠-٩.,]*)\s*(?:م²|م2|م٢|متر|م\b)")
AREA_RE2 = re.compile(r"([\d٠-٩][\d٠-٩.,]{1,})\s*(?:م²|م2|م٢)")
# bedrooms "٣ غرف" / "5 غرف" / "غرفتين"
BEDS_RE = re.compile(r"([\d٠-٩]{1,2})\s*(?:غرف|غرفة|غرفه)")
# bathrooms "ثلاث دورات مياه" handled separately; numeric "٣ دورات مياه" / "دورتين مياه"
BATHS_RE = re.compile(r"([\d٠-٩]{1,2})\s*(?:دورات?|دورة|حمامات?|حمام)\s*(?:مياه|مياة|المياه)?")
AR_WORD_NUM = {
    "دورتين": 2, "غرفتين": 2, "ثلاث": 3, "ثلاثة": 3, "أربع": 4, "اربع": 4, "أربعة": 4,
    "خمس": 5, "خمسة": 5, "ست": 6, "ستة": 6,
}
# price magnitude words
PRICE_NUM_RE = re.compile(r"([\d٠-٩][\d٠-٩.,]*)\s*(مليون|ألف|الف)?")

# image junk to exclude (logos, icons, chat screenshots, placeholders).
_BAD_IMG = ("logo", "icon", "placeholder", "no-image", "no_image", "favicon", "whatsapp.png",
            "location.png", "twitter.png", "screenshot-whats", "screenshot_whats", "/public/")

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


def _strip_tags(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


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


def _redact(text: Optional[str]) -> Optional[str]:
    """Strip phone numbers / wa.me / WhatsApp contact lines from free text (PDPL)."""
    if not text:
        return text
    t = _PHONE_LOOSE.sub(" ", text)
    t = _PHONE_RE.sub(" ", t)
    t = re.sub(r"_?للاتصال[^_\n]*", " ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t or None


def _magnitude(num: Optional[float], unit: Optional[str]) -> Optional[int]:
    """'٢' + 'مليون' → 2000000 ; '550' + 'الف' → 550000."""
    if num is None:
        return None
    if unit == "مليون":
        return int(round(num * 1_000_000))
    if unit in ("ألف", "الف"):
        return int(round(num * 1000))
    return int(round(num))


# ── Index: id → (detail_url, gallery images) ─────────────────────────────────────
def index_cards(s: cc.Session) -> dict[str, list[str]]:
    """Return {property_id: [gallery image urls]} from the /properties index. Each
    `property-card` div carries the listing's detail link + full Swiper gallery."""
    _throttle()
    body = s.get(INDEX, timeout=30).text
    out: dict[str, list[str]] = {}
    # split on the start of each property card so images stay attached to their own listing
    for chunk in re.split(r"(?=<div class=\"property-card)", body):
        m = re.search(r"/property/(\d+)", chunk)
        if not m:
            continue
        pid = m.group(1)
        imgs = re.findall(r'<img src="(https?://[^"]+)"[^>]*class="property-image"', chunk)
        out.setdefault(pid, [])
        for u in imgs:
            if u not in out[pid]:
                out[pid].append(u)
    return out


def fetch_detail(s: cc.Session, pid: str) -> Optional[str]:
    url = f"{BASE}/property/{pid}"
    _throttle()
    for attempt in range(3):
        try:
            r = s.get(url, timeout=40, allow_redirects=True)
        except Exception:
            time.sleep(1.2 * (attempt + 1))
            continue
        if r.status_code == 200 and len(r.text) > 1500:
            return r.text
        time.sleep(1.0 * (attempt + 1))
    return None


# ── Parsing ──────────────────────────────────────────────────────────────────────
def _map_type_strict(text: str) -> Optional[str]:
    """First TYPE_RULES hit, or None if the text carries no type word."""
    for word, eng in TYPE_RULES:
        if word in text:
            return eng
    return None


def _map_type(text: str) -> str:
    """Type word with a safe default (this office's catalog is mostly apartments/villas to rent)."""
    return _map_type_strict(text) or "Apartment"


def _beds(text: str) -> Optional[int]:
    m = BEDS_RE.search(text)
    if m:
        n = _to_int(m.group(1))
        if n and 0 < n <= 20:
            return n
    for word, val in AR_WORD_NUM.items():
        if re.search(word + r"\s*غرف", text):
            return val
    return None


def _baths(text: str) -> Optional[int]:
    m = BATHS_RE.search(text)
    if m:
        n = _to_int(m.group(1))
        if n and 0 < n <= 20:
            return n
    for word, val in AR_WORD_NUM.items():
        if re.search(word + r"\s*(?:دورات?|حمامات?)", text):
            return val
    if "دورتين" in text:
        return 2
    return None


def _area(text: str) -> Optional[int]:
    m = AREA_RE.search(text) or AREA_RE2.search(text)
    if not m:
        return None
    a = _to_float(m.group(1))
    if a and 10 <= a <= 100000:
        return int(round(a))
    return None


def _price(price_text: str, desc: str) -> tuple[Optional[int], bool]:
    """Best total/rent price + whether it was written with an ألف/مليون magnitude word. Pulls
    from the price div first, then a 'السعر …' figure in the description. Free-text prices
    ('حسب الفئة المطلوبة') yield (None, …) → the listing is skipped as a promo card.

    The magnitude flag is a SALE signal: in this Makkah office's listings a rent is a bare
    "20000 ريال" figure, whereas a "٥٠٠ ألف" / "٢ مليون" price is a sale total — so when the
    deal type is otherwise ambiguous, an ألف/مليون price tips it to Buy."""
    for src in (price_text, desc):
        if not src:
            continue
        m = PRICE_NUM_RE.search(src)
        if not m or not m.group(1):
            continue
        num = _to_float(m.group(1))
        had_magnitude = m.group(2) in ("مليون", "ألف", "الف")
        val = _magnitude(num, m.group(2))
        # "X مليون و Y" → X*1,000,000 + Y*1000 (the addon after مليون is thousands). The bare
        # PRICE_NUM_RE drops the "و٥٠٠" tail, so "٢ مليون و٥٠٠" came out 2,000,000 instead of
        # 2,500,000. (audit: -20% price error.)
        if val and m.group(2) == "مليون":
            mt = re.match(r"\s*و\s*([\d٠-٩][\d٠-٩.,]*)\s*(?!مليون)", src[m.end():])
            if mt:
                y = _to_float(mt.group(1))
                if y and y < 1000:
                    val += int(round(y * 1000))
        if val and val >= 1000:
            return val, had_magnitude
    return None, False


def parse_address(addr: str) -> tuple[Optional[str], Optional[str]]:
    """'مكة المكرمة - النواريه - الطيب' → (city='Mecca', neighborhood='النواريه'). The address is
    a ' - '-separated path: first segment = city, second (if any) = district."""
    addr = re.sub(r"\s+", " ", addr or "").strip()
    if not addr:
        return None, None
    parts = [p.strip() for p in re.split(r"\s*[-–]\s*", addr) if p.strip()]
    if not parts:
        return None, None
    city_seg = parts[0]
    # the city label sometimes splits oddly ("مكة  المكرمة- مخطط…") — normalize spaces first.
    city = CITY_AR.get(city_seg) or normalize.map_city(city_seg)
    neigh = parts[1] if len(parts) > 1 else None
    return city, (neigh or None)


def map_listing(pid: str, body: str, gallery: list[str]) -> tuple[Optional[dict], str]:
    nm = NAME_RE.search(body)
    title_raw = _strip_tags(nm.group(1)) if nm else ""
    if not title_raw:
        return None, "residential"

    addr_raw = _strip_tags(ADDR_RE.search(body).group(1)) if ADDR_RE.search(body) else ""
    desc_raw = _strip_tags(DESC_RE.search(body).group(1)) if DESC_RE.search(body) else ""
    price_raw = _strip_tags(PRICE_RE.search(body).group(1)) if PRICE_RE.search(body) else ""

    blob = f"{title_raw} {desc_raw}"

    # Type from the TITLE first (the listing's headline type — "فيلا…", "شقق…", "عمارة…"); only
    # fall back to the description when the title carries NO type word at all. Scanning the whole
    # blob first wrongly matched "الدور"/"الأدوار" inside descriptions → everything became "Floor".
    property_type = _map_type_strict(title_raw) or _map_type(desc_raw)
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"
    is_land = property_type in LAND_TYPES

    # ── price ── (skip promo cards with no real price, e.g. "حسب الفئة المطلوبة")
    price, price_is_magnitude = _price(price_raw, desc_raw)
    if price is None:
        return None, category

    # ── transaction type (default Rent: this office is mostly residential rentals) ──
    has_buy = ("للبيع" in blob or "مليون" in blob or re.search(r"\bبيع\b", title_raw))
    has_rent = ("للإيجار" in blob or "للايجار" in blob or "إيجار" in blob or "ايجار" in blob
                or "شهري" in price_raw or "دفعات" in price_raw or "دفعتين" in price_raw)
    if has_buy and not has_rent:
        is_rent = False
    elif has_rent and not has_buy:
        is_rent = True
    else:
        # ambiguous: an ألف/مليون-magnitude price (e.g. "٥٠٠ ألف", "٢ مليون") is a SALE total;
        # a bare figure ("20000 ريال") is rent. Default to rent otherwise.
        is_rent = not (price_is_magnitude and price >= 100000)

    area = _area(blob)
    bedrooms = _beds(blob) if (category == "residential" and not is_land) else None
    baths = _baths(blob) if (category == "residential" and not is_land) else None

    city, neighborhood = parse_address(addr_raw)
    if not city:
        city = "Mecca"  # Makkah-only office
    region = normalize.region_for_city(city) or "Makkah"

    ppm = None
    if area and not is_rent and price:
        ppm = int(round(price / area))

    title = _redact(title_raw)
    description = _redact(desc_raw)

    # deterministic ad number from the listing URL id (md5, not Python's salted hash()) so the
    # same listing yields the same NK id across runs and upserts cleanly on ad_number.
    ad_id = int(hashlib.md5(f"alnokhba/{pid}".encode("utf-8")).hexdigest()[:12], 16)

    # photos: index-card gallery first (richest), then detail-page media-item, deduped.
    photos: list[str] = []
    seen: set[str] = set()

    def add(u: str) -> None:
        if not u:
            return
        low = u.lower()
        if any(b in low for b in _BAD_IMG):
            return
        if not u.startswith("http"):
            return
        if u not in seen:
            seen.add(u)
            photos.append(u)

    for u in gallery:
        add(u)
    for u in re.findall(r'<img src="(https?://[^"]+)"[^>]*class="media-item"', body):
        add(u)

    info: dict[str, Any] = {
        "city_ar": (addr_raw.split("-")[0].strip() if addr_raw else None),
        "address_ar": addr_raw or None,
        "neighborhood_ar": neighborhood,
        "price_text": _redact(price_raw) or None,
        "bathrooms_count": baths,
        "property_id": pid,
    }
    info = {k: v for k, v in info.items() if v not in (None, "", [], "—")}

    row: dict[str, Any] = {
        "ad_number": f"NK{ad_id}",
        "listing_url": f"{BASE}/property/{pid}",
        "source": "Al Nokhba",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": area,
        "bedrooms": bedrooms,
        "bathrooms": baths,
        "price_total": price if not is_rent else None,
        "price_annual": price if is_rent else None,
        "price_per_meter": ppm,
        "rent_period": "annual" if is_rent else None,
        "city": city,
        "region": region,
        "neighborhood": neighborhood,
        "rega_location_verified": False,
        "title": title,
        "description": description,
        "photo_urls": photos[:25],
        "additional_info": info,
    }
    return row, category


# ── Main ─────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    s = session()
    cards = index_cards(s)
    ids = list(cards.keys())
    if args.limit:
        ids = ids[: max(args.limit, 1)]
    print(f"Al Nokhba: {len(ids)} listings from index"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

    run_id = None if args.limit else db.begin_run("alnokhba")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        for pid in ids:
            body = fetch_detail(s, pid)
            if not body:
                continue
            row, cat = map_listing(pid, body, cards.get(pid, []))
            if not row:
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            seen += 1

        if res:
            db.upsert_alnokhba_residential_batch(res)
        if com:
            db.upsert_alnokhba_commercial_batch(com)

        if args.limit:
            print(f"✓ Al Nokhba VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            for r in (res + com)[:10]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "bathrooms", "price_total",
                    "price_annual", "price_per_meter")})
                print("     title:", (r["title"] or "")[:70])
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:74], f"(+{max(len(r['photo_urls'])-1,0)})")
            if run_id is None:
                return 0

        # Full run: prune listings active before but not seen this crawl (we fetched the FULL catalog).
        pruned = 0
        c = db.sb()
        for tbl, rows_seen in (("alnokhba_residential_listings", res),
                               ("alnokhba_commercial_listings", com)):
            seen_ads = {r["ad_number"] for r in rows_seen}
            existing = (c.table(tbl).select("ad_number").eq("source", "Al Nokhba")
                        .eq("active", True).execute().data) or []
            gone = [r["ad_number"] for r in existing if r["ad_number"] not in seen_ads]
            for i in range(0, len(gone), 200):
                c.table(tbl).update({"active": False}).in_("ad_number", gone[i:i + 200]).execute()
            pruned += len(gone)
        print(f"✓ Al Nokhba: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
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
