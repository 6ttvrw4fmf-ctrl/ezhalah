"""Awal (awaalun.com / أوال العقارية) scraper — Saudi WordPress + RTCL classified-listings site.

أوال العقارية ("Awaal Real Estate") is a Saudi property-marketing / electronic-auctions office
operating in Al Jouf + the Northern Borders (Arar, Sakaka, Dumat Al Jandal, Al Qurayyat). Saudi-
owned → passes the Saudi-only rule. ~128 listings under the RTCL (`rtcl_listing`) post type. No
auth, no proxy, cloud-friendly (WordPress + All-in-One-SEO sitemaps).

Data path (auth-free): the plugin's own REST (/wp-json/rtcl/v1/*) is 403-gated, but the DEFAULT
WordPress REST exposes the listings cleanly:
    GET /wp-json/wp/v2/rtcl_listing?per_page=100&page=N
      → [{ id, link, slug, title.rendered, content.rendered, class_list[] }, …]
`class_list` carries the taxonomy slugs we route on:
    rtcl_category-<cat>   (lands | villa | building | apartments | resort | farm | commercial)
    rtcl_location-<loc>   (arar | jouf)
`content.rendered` carries the listing's free-text Arabic spec in two shapes:
  • Jouf (structured):  "المدينة : سكاكا  الحي : الزهور  المساحة م² : 600  رقم المخطط : …  رقم القطعة : …"
  • Arar (free-text):   "أرض سكنية للبيع حي غرناطه رقم 244 مساحة 630م شارع 18 + ممر"
We parse city / district / area / plan / lot / bedrooms / bathrooms from that text and the title.
Images + the is-sold flag are NOT in the REST payload, so we ALSO fetch each detail page
(/property/<slug>/) for the gallery (one WhatsApp photo each) and the `is-sold` status class.

PRICE: this is an auctions/listing office — most ads carry NO explicit price (the deal happens by
سوم/مزايدة). A few free-text ads mention "البيع N صافي" / "السوم N" but the figure is ambiguous
(thousands vs raw, net-vs-gross), so we DO NOT guess a price — price stays NULL rather than wrong.
area_m2 is reliable and always parsed.

TYPE: rtcl_category → canonical English, with a title/usage override (أرض تجارية → Commercial Land,
عمارة تجارية / محل / مكتب / معرض / مستودع → commercial). DEAL: للإيجار/إيجار in title|content → Rent,
else Buy (the catalog is overwhelmingly sale/auction).

⛔⛔ PDPL ABSOLUTE — we NEVER store a person's name or ANY phone number. The free-text ads sometimes
end with "للتواصل 05…" / a wa.me link; we REDACT every 05x / +9665 / 9200 / 920 / wa.me / واتساب
pattern from title + description before storing, and never persist any advertiser/owner identity. A
registered COMPANY name (شركة … / مؤسسة …) would be allowed, but Awal listings carry none.

Usage:  python -m scrapers.awal.run [--limit N] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
import hashlib
import html as ihtml
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

BASE = "https://awaalun.com"
LIST_API = f"{BASE}/wp-json/wp/v2/rtcl_listing"
WORKERS = int(os.environ.get("AWAL_WORKERS", "5"))

# RTCL category slug → canonical English property type. lands/building flip to a commercial variant
# below when the title/usage says تجاري; resort splits Chalet (شالية) vs Rest House (استراحة).
CATEGORY_TYPE = {
    "lands": "Residential Land",
    "villa": "Villa",
    "building": "Building",
    "apartments": "Apartment",
    "resort": "Rest House",
    "farm": "Farm",
    "commercial": "Shop",
}
# Arabic type words in the title that override the coarse category (priority order).
TITLE_TYPE_RULES = [
    ("أرض تجارية", "Commercial Land"),
    ("ارض تجارية", "Commercial Land"),
    ("عمارة تجارية", "Commercial Building"),
    ("عماره تجارية", "Commercial Building"),
    ("محل", "Shop"),
    ("معرض", "Showroom"),
    ("مكتب", "Office"),
    ("مستودع", "Warehouse"),
    ("مصنع", "Factory"),
    ("ورشة", "Workshop"),
    ("ورشه", "Workshop"),
    ("شالية", "Chalet"),
    ("شاليه", "Chalet"),
    ("استراحة", "Rest House"),
    ("استراحه", "Rest House"),
    ("إستراحة", "Rest House"),
    ("إستراحه", "Rest House"),
    ("مزرعة", "Farm"),
    ("مزرعه", "Farm"),
    ("عمارة", "Building"),
    ("عماره", "Building"),
    ("فيلا", "Villa"),
    ("فلة", "Villa"),
    ("قصر", "Villa"),
    ("دوبلكس", "Villa"),
    ("دور", "Floor"),
    ("روف", "Floor"),
    ("شقة", "Apartment"),
    ("شقه", "Apartment"),
    ("بيت", "House"),
    ("منزل", "House"),
]
COMMERCIAL_TYPES = {
    "Shop", "Office", "Showroom", "Warehouse", "Workshop", "Factory",
    "Commercial Land", "Commercial Building",
}
LAND_TYPES = {"Residential Land", "Commercial Land", "Farm"}

# Arabic city → canonical English. Awal operates in Al Jouf + Northern Borders; the structured
# Jouf ads name the city explicitly ("المدينة : سكاكا"). normalize.map_city covers the rest.
CITY_AR = {
    "عرعر": "Arar", "سكاكا": "Sakaka", "دومة الجندل": "Dawmat Al Jandal",
    "القريات": "Qurayyat", "طريف": "Turaif", "رفحاء": "Rafha",
}
# RTCL location taxonomy slug → default city when the text doesn't name one. "arar" listings are
# all in Arar; "jouf" listings name their own city in the text (default Sakaka = Al Jouf capital).
LOC_DEFAULT_CITY = {"arar": "Arar", "jouf": "Sakaka"}

# Gallery image junk to exclude.
_BAD_IMG = ("logo", "icon", "placeholder", "no-image", "no_image", "spinner", "avatar",
            "favicon", "/svg/", "cropped-awaal")

# Phone / contact patterns to REDACT (PDPL). Hardened battery (defense-in-depth): +966/00966/bare
# 966, 05x (incl. space/dash separated), 9200/920 unified numbers, 800 toll-free, wa.me / واتساب.
_PHONE_RE = re.compile(
    r"(?:\+?00?966\d{8,9}"                 # +966xxxxxxxx / 00966xxxxxxxxx
    r"|\b966\d{8,9}\b"                     # bare 966xxxxxxxx(x)
    r"|0?5\d(?:[\s\.\-]?\d){7}"            # 05xxxxxxxx / 5xxxxxxxx, separators allowed
    r"|\b9200\d{4}\b"                      # 9200xxxx short-codes
    r"|\b920\d{6}\b"                       # 920xxxxxx unified numbers
    r"|\b800\d{7}\b"                       # 800xxxxxxx toll-free
    r"|wa\.me/\S+"
    r"|واتس\S*\s*\d[\d\s\-]{6,})"
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")

# ── content/title field regexes ──
# Structured (Jouf): "المدينة : سكاكا" · "الحي : الزهور" · "المساحة م² : 600" · "رقم المخطط : …"
CITY_FIELD_RE = re.compile(r"المدين[ةه]\s*:\s*([^:|]+?)(?:\s+(?:الحي|المساحة|رقم|نوع)\b|$)")
DIST_FIELD_RE = re.compile(r"الحي\s*:\s*([^:|]+?)(?:\s+(?:المدينة|المساحة|رقم|نوع|الشارع|مساحة)\b|$)")
PLAN_FIELD_RE = re.compile(r"رقم\s*المخطط\s*:\s*([^\n:]+?)(?:\s+(?:رقم|المساحة|الحي)\b|$)")
LOT_FIELD_RE = re.compile(r"رقم\s*القطع[ةه]\s*:\s*([^\s\n:]+)")
# Area: "المساحة م² : 600" | "المساحة الإجمالية 1183م" | "مساحة الأرض : 792م" | "مساحة 630م"
AREA_RE = re.compile(
    r"(?:المساح[ةه]\s*(?:م²|م2)?\s*:?|مساح[ةه]\s*(?:الأرض|الارض|الإجمالي[ةه]|الاجمالي[ةه])?\s*:?)\s*"
    r"([\d٠-٩][\d٠-٩.,]*)\s*(?:م²|م2|م\b|متر)?"
)
# District from free-text Arar ads: "حي غرناطه" / "بحي القدس" — stop at structural connectors.
_DIST_STOP = ("رقم", "مساحة", "المساحة", "شارع", "ممر", "مسطح", "هـ", "ح", "ب", "أ", "ج",
              "نوع", "البيع", "السوم", "للبيع", "للايجار", "للإيجار", "عرض")
DISTRICT_FREE_RE = re.compile(r"ب?حي\s+(.+?)(?:\s+(?:" + "|".join(_DIST_STOP) + r")\b|[\(\)،–\-]|$)")
# bedrooms: "4غرف نوم" / "3 غرف" / "ثلاث غرف نوم"
BEDS_RE = re.compile(r"([\d٠-٩]{1,2})\s*غرف")
# bathrooms: "2 دورات مياه" / "دورتين مياه"
BATHS_RE = re.compile(r"([\d٠-٩]{1,2})\s*دور[ةه]?\s*(?:مياه|مياة|المياه)|([\d٠-٩]{1,2})\s*دورات")

CLASS_LIST_RE = re.compile(r'class="([^"]*\brtcl-listing-item\b[^"]*)"')

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


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return text
    t = _PHONE_LOOSE.sub(" ", text)
    t = _PHONE_RE.sub(" ", t)
    t = re.sub(r"_?للتواصل[^_\n]*", " ", t)
    t = re.sub(r"_?للاتصال[^_\n]*", " ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t or None


# ── REST listing enumeration ──────────────────────────────────────────────────
def fetch_listings(s: cc.Session) -> list[dict]:
    """Every rtcl_listing via the default WP REST. Returns the raw post dicts."""
    out: list[dict] = []
    page = 1
    while True:
        for attempt in range(3):
            try:
                r = s.get(f"{LIST_API}?per_page=50&page={page}", timeout=60,
                          headers={"Accept": "application/json"})
                break
            except Exception:
                time.sleep(2 * (attempt + 1))
        else:
            break
        if r.status_code != 200:
            break
        arr = r.json() or []
        # WP can answer 200 with an ERROR OBJECT (e.g. rest_post_invalid_page_number) instead of a
        # list; `out += dict` would extend with its string KEYS and crash `.get()` later (CI 2026-07-01).
        # A non-list payload means "no more real pages" — stop and keep what we have.
        if not isinstance(arr, list):
            break
        arr = [p for p in arr if isinstance(p, dict)]
        out += arr
        if len(arr) < 50:
            break
        page += 1
    return out


def fetch_detail(link: str) -> tuple[Optional[str], str]:
    """Fetch the detail page for gallery images + the is-sold class. Returns (html|None, link)."""
    s = _session()
    for attempt in range(3):
        try:
            r = s.get(link, timeout=45, allow_redirects=True)
        except Exception:
            time.sleep(1.2 * (attempt + 1))
            continue
        if r.status_code == 200 and len(r.text) > 2000:
            return r.text, link
        time.sleep(1.0 * (attempt + 1))
    return None, link


# ── Parsing ─────────────────────────────────────────────────────────────────────
def _slug_or_id(p: dict) -> str:
    """Stable identity for the deterministic ad_number. Prefer the numeric WP id; fall back to the
    decoded URL slug. Either way it's hashed (md5) so the same listing → same AWL id across runs."""
    if p.get("id"):
        return f"id{p['id']}"
    slug = (p.get("slug") or "").strip()
    return slug or (p.get("link") or "")


def _category(p: dict) -> tuple[Optional[str], Optional[str]]:
    """(category_slug, location_slug) from class_list."""
    cl = " ".join(p.get("class_list") or [])
    cat = re.search(r"rtcl_category-(\S+)", cl)
    loc = re.search(r"rtcl_location-(\S+)", cl)
    return (cat.group(1) if cat else None, loc.group(1) if loc else None)


def _map_type(cat_slug: Optional[str], title: str, own_text: Optional[str] = None) -> str:
    # Commercial qualifier may live in the DESCRIPTION, not the title: a listing titled "عمارة للبيع"
    # can be commercial ("عمارة تجارية") in its body, and "أرض سكنية تجارية" / "أرض تجاري سكني"
    # match no bare title rule. Check the whole text for the عمارة/أرض + تجاري compound first so they
    # route to Commercial Building / Commercial Land instead of falling back to residential. (audit)
    text = own_text or title
    if re.search(r"عمار[ةه]\s+\S{0,3}\s*تجاري", text) or re.search(r"عمار[ةه]\s+تجاري", text):
        return "Commercial Building"
    if re.search(r"(?:أرض|ارض)\s+(?:\S+\s+){0,2}تجاري", text):
        return "Commercial Land"
    for word, eng in TITLE_TYPE_RULES:
        if word in title:
            return eng
    return CATEGORY_TYPE.get(cat_slug or "", "Residential Land")


def _images(body: Optional[str]) -> list[str]:
    if not body:
        return []
    out: list[str] = []
    seen: set[str] = set()

    def add(u: str) -> None:
        u = ihtml.unescape(u)
        low = u.lower()
        if any(b in low for b in _BAD_IMG):
            return
        # strip WordPress "-535x650" size suffixes → full-size original
        full = re.sub(r"-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp)$)", "", u, flags=re.I)
        if full not in seen:
            seen.add(full)
            out.append(full)

    # the slider/gallery lives under /uploads/classified-listing/…; restrict to those so we never
    # pick up theme chrome, related-listing thumbs, or the office logo.
    for u in re.findall(
        r"(https://awaalun\.com/wp-content/uploads/classified-listing/[^\s\"'\\)<>]+?\.(?:jpe?g|png|webp))",
        body, re.I,
    ):
        add(u)
    return out[:25]


def map_listing(p: dict, body: Optional[str]) -> tuple[Optional[dict], str, bool]:
    """Combine the REST post `p` with its detail-page `body` (images + sold flag) into a canonical
    row. Returns (row, category, gone)."""
    title_raw = _clean((p.get("title") or {}).get("rendered", ""))
    content = _clean((p.get("content") or {}).get("rendered", ""))
    link = p.get("link")
    if not title_raw and not content:
        return None, "residential", False

    cat_slug, loc_slug = _category(p)
    own_text = f"{title_raw}\n{content}"
    property_type = _map_type(cat_slug, title_raw, own_text)
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"
    is_land = property_type in LAND_TYPES

    # ── transaction type (default Buy: Awal is overwhelmingly sale/auction) ──
    is_rent = (("للإيجار" in own_text or "للايجار" in own_text or "إيجار" in own_text
                or "ايجار" in own_text) and "للبيع" not in own_text)

    # ── area (always try structured field first, then free-text) ──
    am = AREA_RE.search(content) or AREA_RE.search(own_text)
    area = _to_float(am.group(1)) if am else None
    if area and area > 5_000_000:  # guard against a swallowed plan/lot number
        area = None

    # ── bedrooms / bathrooms (units only) ──
    bedrooms = None
    if not is_land and category == "residential":
        bm = BEDS_RE.search(own_text)
        if bm:
            n = _to_int(bm.group(1))
            if n and 0 < n <= 20:
                bedrooms = n
    baths = None
    if category == "residential" and not is_land:
        bm = BATHS_RE.search(own_text)
        if bm:
            baths = _to_int(bm.group(1) or bm.group(2))
            if baths and not (0 < baths <= 20):
                baths = None

    # ── location: structured city field → CITY_AR token in text → location-slug default ──
    # Awal ONLY operates in Al Jouf + the Northern Borders. The RTCL `loc_slug` (arar | jouf) is the
    # authoritative region anchor, so we resolve the city from our small CITY_AR set or the loc-slug
    # default and DO NOT fall through to normalize.map_city(own_text): that loose full-text scan
    # substring-matched a district word ("المنصورية") to a Makkah town (Al Kamil) and leaked one
    # Arar listing into the wrong region. City must stay inside the office's real footprint.
    raw_city = None
    cm = CITY_FIELD_RE.search(content)
    if cm:
        raw_city = _clean(cm.group(1))
    city = CITY_AR.get(raw_city) if raw_city else None
    if not city:
        for ar, eng in CITY_AR.items():
            if ar in own_text:
                city = eng
                raw_city = raw_city or ar
                break
    if not city:
        city = LOC_DEFAULT_CITY.get(loc_slug or "", "Sakaka")
    region = normalize.region_for_city(city) or (
        "Northern Borders" if city in ("Arar", "Turaif", "Rafha") else "Al Jawf")

    # ── district / neighborhood ──
    district = None
    dm = DIST_FIELD_RE.search(content)
    if dm:
        cand = _clean(dm.group(1))
        if cand and cand not in ("–", "-", "—"):
            district = cand
    if not district:
        dm2 = DISTRICT_FREE_RE.search(title_raw) or DISTRICT_FREE_RE.search(content)
        if dm2:
            cand = _clean(dm2.group(1))
            if cand and cand not in ("–", "-", "—"):
                district = cand

    # ── plan / lot numbers (additional_info) ──
    plan_no = None
    pm = PLAN_FIELD_RE.search(content)
    if pm:
        plan_no = _clean(pm.group(1)) or None
    lot_no = None
    lm = LOT_FIELD_RE.search(content)
    if lm:
        lot_no = _clean(lm.group(1)) or None

    # ── PDPL-safe text ──
    title = _redact(title_raw) or title_raw
    description = _redact(content)

    # sold detection: the detail page's listing-item element carries an `is-sold` class.
    gone = False
    if body:
        m = CLASS_LIST_RE.search(body)
        gone = bool(m and "is-sold" in m.group(1))

    # deterministic, globally-unique ad number (md5 of slug/id) — stable across runs, upserts on it.
    key = _slug_or_id(p)
    ad_id = int(hashlib.md5(key.encode("utf-8")).hexdigest()[:12], 16)

    info: dict[str, Any] = {
        "city_ar": raw_city or None,
        "district_ar": district,
        "plan_number": plan_no,
        "lot_number": lot_no,
        "rtcl_category": cat_slug,
        "rtcl_location": loc_slug,
        "wp_id": p.get("id"),
        "slug": (p.get("slug") or None),
    }
    info = {k: v for k, v in info.items() if v not in (None, "", [], "—", "–")}

    row: dict[str, Any] = {
        "ad_number": f"AWL{ad_id}",
        "listing_url": link,
        "source": "Awal",
        "active": not gone,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": int(round(area)) if area else None,
        "bedrooms": bedrooms,
        "bathrooms": baths,
        # auction office: explicit prices are essentially never published → leave NULL, never guess.
        "price_total": None,
        "price_annual": None,
        "price_per_meter": None,
        "rent_period": "annual" if is_rent else None,
        "city": city,
        "region": region,
        "neighborhood": district,
        "rega_location_verified": False,
        "title": title,
        "description": description,
        "photo_urls": _images(body),
        "additional_info": info,
    }
    return row, category, gone


# ── Main ──────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="small validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    s = session()
    posts = fetch_listings(s)
    if not posts:
        print("✗ Awal: REST returned no listings")
        return 1
    if args.limit:
        posts = posts[: args.limit]
    print(f"Awal: {len(posts)} listings from WP REST ({WORKERS} workers)"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

    # fetch detail pages (images + sold flag) in parallel, keyed by link
    links = [p.get("link") for p in posts if p.get("link")]
    bodies: dict[str, Optional[str]] = {}
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for body, link in ex.map(fetch_detail, links):
            bodies[link] = body

    run_id = None if args.limit else db.begin_run("awal")
    res: list[dict] = []
    com: list[dict] = []
    gone_ct = 0
    seen = 0
    try:
        for p in posts:
            row, cat, gone = map_listing(p, bodies.get(p.get("link")))
            if not row:
                continue
            if gone:
                gone_ct += 1
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            seen += 1

        if res:
            db.upsert_awal_residential_batch(res)
        if com:
            db.upsert_awal_commercial_batch(com)

        if args.limit:
            print(f"✓ Awal VALIDATION: {len(res)} residential + {len(com)} commercial upserted "
                  f"({gone_ct} sold) (no prune)")
            for r in (res + com)[:8]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "active")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:74])
            if run_id is None:
                return 0

        # Full run: prune listings active before that weren't seen this crawl (we fetched the FULL
        # catalog). Sold rows were already upserted with active=False above.
        pruned = 0
        for tbl, rows_seen in (("awal_residential_listings", res),
                               ("awal_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Awal")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Awal: {len(res)} residential + {len(com)} commercial upserted, "
              f"{gone_ct} sold (inactive), {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen,
                   notes=f"sold={gone_ct} pruned={pruned}")
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
