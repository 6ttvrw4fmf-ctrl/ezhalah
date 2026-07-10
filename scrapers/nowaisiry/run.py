"""Al Nowaisiry (alnowaisiry.com / مكتب النويصري للعقارات — مخطط الخير) scraper — Saudi
WordPress (WordPress.com / Jetpack + Bricks + JetEngine) site with a custom `lands` post type.

مكتب النويصري للعقارات is a Saudi real-estate office specializing in plots of the مخطط الخير
("Al Khayr") developments in North Riyadh (between King Fahd Rd and King Khalid Rd), plus a set of
agricultural plots in الجلة / الأجفر (Hail region). Saudi-owned → passes the Saudi-only rule. SMALL
but genuine catalog (~23 priced listings: mostly residential land, a couple of finished floors, and
several agricultural lands). No auth, no proxy, cloud-friendly.

Data path (auth-free): the JetEngine `lands` custom post type is exposed cleanly on the DEFAULT
WordPress REST:
    GET /wp-json/wp/v2/lands?per_page=100&_embed=wp:featuredmedia
      → [{ id, link, slug, status, title.rendered, content.rendered,
            _embedded.wp:featuredmedia[0].source_url, meta{offer-land-id}, … }, …]
The plugin's own REST is not needed — every field we want is in `content.rendered`, a clean
bullet-list ("● المساحة : 455 متر  ● البيع : 650 الف صافي  ● مخطط الخير 3312/ب …") plus the
featured image. We parse type / area / price / plot-no / plan-name / city from that text.

TYPE: title/content keyword →
    ارض زراعية → Farm (routes commercial)   ·   دور → Floor   ·   راس بلك / ارض سكنية / ارض → Residential Land.
DEAL: the office is sale-only — every ad is للبيع/البيع → Buy (no rentals in the catalog).
PRICE: Arabic shorthand "650 الف صافي" → 650000, "مليون و 500 الف" → 1500000,
    "2 مليون و 700 الف" → 2700000. We resolve مليون/الف multipliers, never guess when absent.
AREA: "المساحة : 455 متر" / "10,000 متر مربع" / "200,000 متر" / "318.21 متر" / "10532,5 متر"
    → int meters (comma = thousands sep; lone trailing ",5" decimal tolerated).
LOCATION: مخطط الخير / حي الخير → Riyadh (North Riyadh). الجلة / الجله / الأجفر → Hail. region is
    DERIVED from the city via normalize.region_for_city. neighborhood = the مخطط/حي name.
PHOTOS: the featured image (one real WhatsApp-style photo per listing); WordPress -WxH size
    suffixes stripped to full-size. Logos/placeholders excluded.

⛔⛔ PDPL ABSOLUTE — we NEVER store an advertiser/agent/owner PERSON name or ANY phone number. The
finished-floor ads append a "للتواصل : 0552228120 …" contact line and a warranty block; we REDACT
every 05x / +9665 / 9200 / 920 / 800 / wa.me / واتساب shape from title+description AND truncate the
description at the first contact/broker marker (للتواصل / للحجز / للاستفسار / جوال / المعلن / …) so
no phone or natural-person identity is ever persisted. A registered COMPANY name is allowed.

Usage:  python -m scrapers.nowaisiry.run [--limit N] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
import hashlib
import html as ihtml
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

from scrapers.common import db, normalize as N  # noqa: E402

BASE = "https://alnowaisiry.com"
LIST_API = f"{BASE}/wp-json/wp/v2/lands"
SOURCE = "Al Nowaisiry"

# ── Arabic property-type keywords (title/content) → canonical English. Priority order. ──
TYPE_RULES = [
    ("ارض زراعية", "Farm"),
    ("أرض زراعية", "Farm"),
    ("مزرعة", "Farm"),
    ("مزرعه", "Farm"),
    ("استراحة", "Rest House"),
    ("استراحه", "Rest House"),
    ("شاليه", "Chalet"),
    ("دور", "Floor"),
    ("روف", "Floor"),
    ("شقة", "Apartment"),
    ("شقه", "Apartment"),
    ("فيلا", "Villa"),
    ("فلة", "Villa"),
    ("دوبلكس", "Villa"),
    ("عمارة تجارية", "Commercial Building"),
    ("عماره تجارية", "Commercial Building"),
    ("عمارة", "Building"),
    ("عماره", "Building"),
    ("محل", "Shop"),
    ("معرض", "Showroom"),
    ("مكتب", "Office"),
    ("مستودع", "Warehouse"),
    ("ارض تجارية", "Commercial Land"),
    ("أرض تجارية", "Commercial Land"),
    ("راس بلك", "Residential Land"),
    ("ارض سكنية", "Residential Land"),
    ("أرض سكنية", "Residential Land"),
    ("ارض", "Residential Land"),
    ("أرض", "Residential Land"),
]
COMMERCIAL_TYPES = {
    "Shop", "Office", "Showroom", "Warehouse", "Factory", "Workshop",
    "Commercial Land", "Commercial Building", "Farm",
}
LAND_TYPES = {"Residential Land", "Commercial Land", "Farm"}

# Arabic location token (مخطط/حي/town name in title+content) → canonical English city. The office
# trades two areas only: مخطط الخير / حي الخير = North Riyadh; الجلة / الأجفر = Hail-region farms.
CITY_TOKENS = [
    ("مخطط الخير", "Riyadh"),
    ("حي الخير", "Riyadh"),
    ("الخير", "Riyadh"),
    ("الجلة", "Hail"),
    ("الجله", "Hail"),
    ("الأجفر", "Hail"),
    ("الاجفر", "Hail"),
]

# Phone / contact patterns to REDACT (PDPL). Hardened battery (defense-in-depth).
_PHONE_RE = re.compile(
    r"(?:\+?00?966\d{8,9}"                 # +966xxxxxxxx / 00966xxxxxxxxx
    r"|\b966\d{8,9}\b"                     # bare 966xxxxxxxx(x)
    r"|0?5\d(?:[\s\.\-]?\d){7}"            # 05xxxxxxxx / 5xxxxxxxx, separators allowed
    r"|\b9200\d{4,6}\b"                    # 9200xxxx short-codes
    r"|\b920\d{6}\b"                       # 920xxxxxx unified numbers
    r"|\b800\d{7}\b"                       # 800xxxxxxx toll-free
    r"|wa\.me/\S+"
    r"|whatsapp\S*\s*\d[\d\s\-]{6,}"
    r"|واتس\S*\s*\d[\d\s\-]{6,})",
    re.I,
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")
# PDPL: contact/broker markers — TRUNCATE the description here (everything after can carry a phone
# or a natural-person name). The floor ads put "للتواصل : 05…" mid-text before a warranty block.
_CUT_MARKERS = (
    "للتواصل", "للحجز", "للاستفسار", "للأستفسار", "تواصل معنا", "اتصل", "للاتصال",
    "جوال", "الجوال", "واتساب", "واتس", "المعلن", "اسم المعلن", "المالك", "الوسيط",
    "المسوق", "للبيع والتسويق", "يقبل جميع البنوك",
)

# Field regexes (content is a "● label : value" bullet list).
# Primary: structured "المساحة : 455 متر" / "المساحة (64.07 م2)". Fallback: free-text "بمساحة 10,000 متر".
AREA_RE = re.compile(
    r"المساح[ةه]\s*[:：]?\s*\(?\s*([\d٠-٩][\d٠-٩.,]*)\s*"
)
AREA_FALLBACK_RE = re.compile(
    r"ب?مساح[ةه]\s*[:：]?\s*\(?\s*([\d٠-٩][\d٠-٩.,]*)\s*(?:م²|م2|متر|م\b)"
)
# Price line: "البيع : 650 الف صافي" / "السعر : 450 الف" / "مليون و 500 الف".
PRICE_LINE_RE = re.compile(r"(?:البيع|السعر|المطلوب)\s*[:：]?\s*([^\n●]+)")
PLOT_RE = re.compile(r"رقم\s*[:：]?\s*([0-9٠-٩][0-9٠-٩/و\s]*)")
STREET_RE = re.compile(r"الشارع(?:\s*والواجهة)?\s*[:：]?\s*([^\n●]+)")
PLAN_RE = re.compile(r"(?:مخطط|حي)\s+([^\n●:0-9]{2,40})")

_TRANS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({
        "Accept": "application/json",
        "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
    })
    return s


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", ihtml.unescape(s or ""))).strip()


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return text
    t = _PHONE_LOOSE.sub(" ", text)
    t = _PHONE_RE.sub(" ", t)
    # Truncate at the first contact/broker marker — drops phone + any natural-person identity.
    cut = len(t)
    for m in _CUT_MARKERS:
        i = t.find(m)
        if i != -1:
            cut = min(cut, i)
    t = t[:cut]
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r"[\s*_\-●·|]+$", "", t)
    return t.strip() or None


def _map_type(text: str) -> str:
    for word, eng in TYPE_RULES:
        if word in text:
            return eng
    return "Residential Land"  # the catalog is overwhelmingly plots


def _area(text: str) -> Optional[int]:
    """Parse "المساحة : 455 متر" / "10,000 متر مربع" / "318.21 متر" / "10532,5 متر" → int m²."""
    m = AREA_RE.search(text) or AREA_FALLBACK_RE.search(text)
    if not m:
        return None
    raw = m.group(1).translate(_TRANS).strip()
    # Comma = thousands separator EXCEPT a lone trailing ",5" decimal ("10532,5"). Drop "."/","
    # decimals; keep the integer part. Then strip any non-digits left.
    raw = re.sub(r"[.,]\d{1,2}$", "", raw)   # drop a trailing decimal (.21 / ,5)
    digits = re.sub(r"[^\d]", "", raw)        # remove remaining thousands separators
    if not digits:
        return None
    n = int(digits)
    return n if 0 < n < 5_000_000 else None


def _price(text: str) -> Optional[int]:
    """Resolve the Arabic-shorthand sale price → SAR int.
    "650 الف صافي" → 650000 · "مليون و 500 الف" → 1500000 · "2 مليون و 700 الف" → 2700000.
    """
    m = PRICE_LINE_RE.search(text)
    if not m:
        return None
    seg = m.group(1).translate(_TRANS)
    seg = seg.split("صافي")[0]  # cut trailing "صافي للمالك"
    has_m = "مليون" in seg
    has_k = "الف" in seg or "ألف" in seg
    nums = [int(x) for x in re.findall(r"\d+", seg)]
    if not nums and has_m:
        return 1_000_000  # bare "مليون"
    if not nums:
        return None
    total = 0
    if has_m:
        # number(s) before "مليون" are millions; number(s) after "الف" are thousands.
        before_m = seg.split("مليون")[0]
        mill_nums = [int(x) for x in re.findall(r"\d+", before_m)]
        mill = mill_nums[0] if mill_nums else 1   # "مليون و 500 الف" → 1
        total += mill * 1_000_000
        after_m = seg.split("مليون", 1)[1]
        k_nums = [int(x) for x in re.findall(r"\d+", after_m)]
        if k_nums:
            total += k_nums[0] * 1_000
        return total
    if has_k:
        return nums[0] * 1_000
    # raw figure (rare): treat as full SAR only if it looks like a real price
    n = nums[0]
    return n if n >= 10_000 else None


def _city(text: str) -> tuple[Optional[str], Optional[str]]:
    """(canonical English city, neighborhood). City from the مخطط/حي/town token; neighborhood = the
    plan/quarter name (e.g. "الخير الأمراء 3541", "الجلة مخطط 520"). None when no token matches —
    Nowaisiry recognizes BOTH Riyadh-area and Hail-area plan names, so it is not a single-city
    brokerage; guessing "Riyadh" for an unrecognized plan name would silently mislabel a Hail
    listing. An honest unresolved city beats a wrong guess."""
    city = None
    for tok, eng in CITY_TOKENS:
        if tok in text:
            city = eng
            break
    # neighborhood: prefer the مخطط… or حي… phrase; fall back to None.
    nb = None
    pm = re.search(r"مخطط\s+الخير\s+([^\n●:|]{1,30})", text) or re.search(r"حي\s+الخير", text)
    if pm:
        nb = "الخير " + _clean(pm.group(1)) if pm.lastindex else "الخير"
        nb = _clean(nb)
    if not nb:
        gm = re.search(r"(?:في|بـ?)\s*(الجل[ةه]|الأجفر|الاجفر)\b", text) or \
            re.search(r"(الجل[ةه]|الأجفر|الاجفر)\b", text)
        if gm:
            nb = _clean(gm.group(1))
    if not nb and "الخير" in text:
        nb = "الخير"
    return city, nb


def _image(p: dict) -> list[str]:
    emb = (((p.get("_embedded") or {}).get("wp:featuredmedia") or [{}])[0])
    u = emb.get("source_url") if isinstance(emb, dict) else None
    if isinstance(u, str) and u.startswith("http"):
        low = u.lower()
        if not any(b in low for b in ("logo", "placeholder", "icon", "no-image", "/svg/")):
            full = re.sub(r"-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp)$)", "", u, flags=re.I)
            return [full]
    return []


def fetch_lands(s: cc.Session) -> list[dict]:
    out: list[dict] = []
    page = 1
    while True:
        for attempt in range(3):
            try:
                r = s.get(f"{LIST_API}?per_page=100&page={page}&_embed=wp:featuredmedia",
                          timeout=60, headers={"Accept": "application/json"})
                break
            except Exception:
                time.sleep(2 * (attempt + 1))
        else:
            break
        if r.status_code != 200:
            break
        arr = r.json() or []
        out += arr
        if len(arr) < 100:
            break
        page += 1
    return out


def map_listing(p: dict) -> tuple[Optional[dict], str]:
    """Combine the REST `lands` post into a canonical row. Returns (row, category)."""
    if (p.get("status") or "publish") != "publish":
        return None, "residential"
    title_raw = _clean((p.get("title") or {}).get("rendered", ""))
    content = _clean((p.get("content") or {}).get("rendered", ""))
    link = p.get("link")
    if not link or (not title_raw and not content):
        return None, "residential"

    own_text = f"{title_raw}\n{content}"
    property_type = _map_type(own_text)
    category = "commercial" if N.category_for_type(property_type) == "Commercial" else "residential"
    is_land = property_type in LAND_TYPES

    # deal: office is sale-only; honour an explicit rent word if it ever appears.
    is_rent = (("للإيجار" in own_text or "للايجار" in own_text or "إيجار" in own_text
                or "ايجار" in own_text) and "للبيع" not in own_text and "البيع" not in own_text)

    area = _area(own_text)
    price = _price(own_text)
    city, neighborhood = _city(own_text)
    region = N.region_for_city(city)

    # bedrooms / bathrooms only for the finished floors (units), from the free text.
    bedrooms = baths = None
    if not is_land and category == "residential":
        bm = re.search(r"([\d٠-٩]{1,2})\s*غرف", own_text)
        if bm:
            n = N.to_int(bm.group(1))
            bedrooms = n if (n and 0 < n <= 20) else None
        wm = re.search(r"([\d٠-٩]{1,2})\s*دور[ةه]?\s*(?:مياه|مياة)|([\d٠-٩]{1,2})\s*دورات", own_text)
        if wm:
            b = N.to_int(wm.group(1) or wm.group(2))
            baths = b if (b and 0 < b <= 20) else None

    ppm = round(price / area) if (price and area and not is_rent) else None

    # plot number / plan number → additional_info (NOT a person id).
    plot_no = None
    pm = re.search(r"رقم\s*[:：]?\s*([0-9٠-٩][0-9٠-٩/و\s]{0,18})", content)
    if pm:
        cand = _clean(pm.group(1).translate(_TRANS))
        if cand:
            plot_no = cand
    offer_id = ((p.get("meta") or {}).get("offer-land-id") or None)

    # PDPL-safe text.
    title = _redact(title_raw) or title_raw
    description = _redact(content)

    # deterministic ad number — stable WP post id (never random).
    pid = p.get("id")
    ad_number = f"NW{pid}" if pid else "NW" + hashlib.md5((link or "").encode()).hexdigest()[:12]

    info: dict[str, Any] = {
        "wp_id": pid,
        "slug": p.get("slug") or None,
        "plot_number": plot_no,
        "offer_land_id": offer_id,
        "plan_name": neighborhood,
    }
    info = {k: v for k, v in info.items() if v not in (None, "", [], "—", "–")}

    row: dict[str, Any] = {
        "ad_number": ad_number,
        "listing_url": link,
        "source": SOURCE,
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
        "photo_urls": _image(p),
        "additional_info": info,
    }
    return row, category


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    s = session()
    posts = fetch_lands(s)
    if not posts:
        print("✗ Al Nowaisiry: REST /wp/v2/lands returned no listings")
        return 1
    if args.limit:
        posts = posts[: args.limit]
    print(f"Al Nowaisiry: {len(posts)} listings from WP REST (lands)"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

    run_id = None if args.limit else db.begin_run("nowaisiry")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        for p in posts:
            row, cat = map_listing(p)
            if not row:
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            seen += 1

        if res:
            db.upsert_nowaisiry_residential_batch(res)
        if com:
            db.upsert_nowaisiry_commercial_batch(com)

        if args.limit:
            print(f"✓ Al Nowaisiry VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"upserted (no prune)")
            for r in (res + com)[:6]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "price_total", "price_per_meter")})
                print("     url:  ", (r.get("listing_url") or "")[:78])
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:74])
            if run_id is None:
                return 0

        # Full run: prune listings active before that weren't seen this crawl (full catalog fetched).
        pruned = 0
        for tbl, rows_seen in (("nowaisiry_residential_listings", res),
                               ("nowaisiry_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source=SOURCE)
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Al Nowaisiry: {len(res)} residential + {len(com)} commercial upserted, "
              f"{pruned} stale pruned")
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
