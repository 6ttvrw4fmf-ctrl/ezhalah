"""فهد الشهري العقارية — fahadalshahri.com. Onboarding 2026-09-19.

SOURCE SHAPE (probed live before any code):
  · A WordPress site that sells properties as WooCommerce PRODUCTS. The Store API is open and
    returns the whole catalogue in one call: /wp-json/wc/store/products (x-wp-total: 25), with
    name, prices.price (integer SAR), images[] and the full description.
  · TRANSPORT: the Store API answers a plain browser session but returns HTTP 403 to curl_cffi's
    `impersonate="chrome124"` TLS fingerprint. This is the amlakalahsa shape — the bare session is
    the working one, and a 403 here means the fingerprint, NOT a block on us. Do not "fix" it by
    adding impersonation.
  · The city is USUALLY ABSENT. Measured across all 25 products: only 7 mention any city token at
    all. Districts alone do not identify a city and the shared resolver correctly refuses to guess
    from one (resolve_slug('حي الزمرد') → unresolved), so most of this catalogue is cityless and
    is SKIPPED rather than assumed to be Jeddah because the office is in Jeddah.
  · THE TRAP THIS SCRAPER EXISTS TO AVOID: «مخطط شرق الرياض» appears in a Jeddah office's listing,
    and «حي الرياض» is itself a district of Jeddah. A bare search for a city name files a Jeddah
    villa under الرياض. So a city token is accepted ONLY when it is not preceded by حي / مخطط /
    شرق / غرب / شمال / جنوب — i.e. only when the source is naming the CITY, not a place whose name
    contains a city's name. Anything else keeps the listing cityless, which skips it.
"""
from __future__ import annotations

import argparse
import html as ihtml
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe, stored_listing_url  # noqa: E402

BASE = "https://fahadalshahri.com"
SOURCE = "Fahad Alshahri"
PREFIX = "FAS"
_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def session() -> cc.Session:
    """BARE session — no impersonate(), and NO User-Agent of our own.

    See the transport note in the module header for why impersonate is wrong here. The UA is left
    to curl_cffi for the reason the rakez incident taught: it sets a UA consistent with the TLS
    fingerprint it presents, and overriding it makes the two disagree. Verified live 2026-09-20 —
    a bare session with no UA override returns HTTP 200 (87,360 bytes) on the Store API, while
    impersonate="chrome124" returns 403, so the header was never load-bearing here."""
    s = cc.Session()
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7"})
    return s


def plain(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


_TYPE_AR = {
    "أرض تجارية": "أرض تجارية", "ارض تجارية": "أرض تجارية", "أرض": "أرض", "ارض": "أرض",
    "فيلا": "فيلا", "فله": "فيلا", "فلة": "فيلا", "فلل": "فيلا", "قصر": "قصر",
    "دبلوكس": "دوبلكس", "دوبلكس": "دوبلكس", "دبلكس": "دوبلكس",
    "شقة": "شقة", "شقه": "شقة", "شقق": "شقة", "دور": "دور", "عمارة": "عمارة", "عماره": "عمارة",
    "استراحة": "استراحة", "استراحه": "استراحة", "مزرعة": "مزرعة", "محل": "محل", "مكتب": "مكتب",
    "مستودع": "مستودع", "بيت": "بيت", "روف": "شقة", "ملحق": "دور",
}
_TYPE_TOKENS = sorted(_TYPE_AR, key=len, reverse=True)

# A city token is only a CITY when nothing turns it into a place-name. «مخطط شرق الرياض» in a
# Jeddah office's listing, and «حي الرياض» (a Jeddah district), are both caught by this.
# A city token is a CITY only when the word before it is not turning it into something else:
#   place-name parts  — «مخطط شرق الرياض», «حي الرياض» (a JEDDAH district)
#   SEO keyword runs  — «شقتين متجاورتين للايجار الرياض» inside a Jeddah listing whose property is
#                       in «مخطط شرق الرياض». A deal word immediately before a city name is a
#                       search-term stuffing pattern, not a statement of where the property is.
# Either way the listing keeps NO city and is skipped. Ambiguous → skip, never pick a side.
_NOT_A_CITY_PREFIX = ("حي", "مخطط", "شرق", "غرب", "شمال", "جنوب", "طريق", "شارع", "ضاحية",
                      "للايجار", "للإيجار", "للبيع", "تمليك", "ايجار", "إيجار", "بيع")
_CITY_TOKENS = ("جدة", "مكة المكرمة", "مكة", "الرياض", "الطائف", "المدينة المنورة",
                "الدمام", "الخبر", "أبها", "بريدة")


def parse_city(text: str) -> Optional[str]:
    for c in _CITY_TOKENS:
        for m in re.finditer(r"(?<![ء-ي])" + re.escape(c) + r"(?![ء-ي])", text):
            before = text[:m.start()].rstrip()
            last = re.split(r"[\s،.,–—-]+", before)[-1] if before else ""
            if last in _NOT_A_CITY_PREFIX:
                continue
            if to_catalog(c)[0]:
                return c
    return None


def parse_type_ar(name: str) -> Optional[str]:
    for tok in _TYPE_TOKENS:
        if re.search(r"(?<![ء-ي0-9])" + re.escape(tok) + r"(?![ء-ي])", name):
            return _TYPE_AR[tok]
    return None


# The «مساحة» anchor is REQUIRED, never optional. Without it this matched «الفلة على شارع ٣٢ متر»
# — a STREET WIDTH — and filed a 262.5 m² duplex as 32 m². Any "N متر" in free text is far more
# often a street, a frontage or a distance than the area.
_AREA_RE = re.compile(
    r"مساحة(?:\s*(?:الأرض|الفله|الفلة|البناء|العقار))?\s*:?\s*"
    r"([\d٠-٩][\d٠-٩,\.]*)\s*(?:مترًا\s*مربعًا|متر\s*مربع|م²|م2|متر)?")
# Street width is its own field — captured so it is not mistaken for anything else later.
_STREET_W_RE = re.compile(r"شارع\s*([\d٠-٩][\d٠-٩,\.]*)\s*(?:متر|م)(?![\u0621-\u064A])")
_DISTRICT_RE = re.compile(r"(حي\s+[ء-ي][ء-ي\s]{2,30}?)(?=\s*[,،.\-–—]|\s+(?:على|مساحة|قريب|تتكون|إذا|فلة|مكونة)|$)")


def _num(m: Optional[re.Match]) -> Optional[int]:
    if not m:
        return None
    try:
        n = int(float(m.group(1).translate(_AR_DIGITS).replace(",", "")))
        return n if n > 0 else None
    except ValueError:
        return None


def map_listing(p: dict) -> tuple[Optional[dict], str, str]:
    name = plain(p.get("name"))
    desc = plain(p.get("description"))
    blob = f"{name} {desc}"
    if not name:
        return None, "residential", "no_name"

    type_ar = parse_type_ar(name) or parse_type_ar(desc[:200])
    if not type_ar:
        return None, "residential", "type_unmapped"
    property_type = normalize.map_type_exact(type_ar)
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    deal = "Rent" if re.search(r"للإيجار|للايجار", blob) else ("Buy" if re.search(r"للبيع|تمليك", blob) else None)
    if not deal:
        deal = "Buy"  # WooCommerce products are priced for SALE; the store has no rental flow.

    city_ar = parse_city(blob)
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"

    dm = _DISTRICT_RE.search(blob)
    district_raw = dm.group(1).strip() if dm else None
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None

    try:
        price = int(p.get("prices", {}).get("price") or 0) or None
    except (TypeError, ValueError):
        price = None

    imgs = [i.get("src") for i in (p.get("images") or []) if i.get("src")]

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{p['id']}",
        "listing_url": p.get("permalink"),
        "source": SOURCE,
        "active": True,
        "title": name,
        "property_type": property_type,
        # Written as a total expression, not the bare `deal`: a transaction_type that is
        # not provably Buy/Rent can reach the index as NULL, and a null deal is
        # quarantined out of search entirely (the 2026-07-16 null-deal recovery).
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _num(_AREA_RE.search(blob)),
        "street_width_m": _num(_STREET_W_RE.search(blob)),
        "photo_urls": imgs[:20] or None,
        # This template has no labelled spec rows at all — every fact lives in the marketing prose
        # («مواقف سيارات، بلكونة ومطبخ أمريكي، مع غرفتي ماستر»), which is why all 5 listings carried
        # NULL for every Advanced-Filter column. Only amenities the text NAMES are written, negations
        # are honoured, and a fixture the source says is merely PREPARED («مصعد مؤسس») stays NULL.
        # Room COUNTS are deliberately not read from this prose: it describes them per floor
        # («الدور الأول يضم … 3 غرف نوم» + «الملحق … 3 غرف نوم»), so any single number would be a
        # guess about the whole property (ambiguous-mapping ask-first).
        **normalize.amenities_from_text(blob),
    }
    if deal == "Rent":
        rent_period, price_annual = normalize.rent_period_and_annual(price, blob)
        row["price_annual"] = price_annual
        if rent_period:
            row["rent_period"] = rent_period
    else:
        row["price_total"] = price
    row["additional_info"] = {k: v for k, v in {
        "type_ar": type_ar, "slug": p.get("slug"),
    }.items() if v is not None}
    return row, category, ""


# Why a Store API walk may not be the whole catalogue. Non-empty → no prune this run.
INCOMPLETE: list[str] = []

# ── REMOVAL (measured 2026-10-02). Until then this crawler had NO removal step at all: a deleted
# product stayed active here for good.
#
# There is no dead cohort to measure on: all 5 active rows were re-seen that day. What the product's
# OWN url answers through the bare session: 26 of 26 catalogue products → 200 whose <body> carries
# the «single-product» class; a slug that never existed, a real slug with a mangled tail and a wrong
# ?p= id → 404 (3 of 3) with no such class. Each of the 26 pages carries exactly one
# <div id="product-N" class="…"> — the product's own block — and its class list says «instock» on
# 26 of 26, «outofstock» on 0. So a hard 404/410 is GONE, a 200 product page whose own block says
# «instock» is LIVE, and everything else — a 403 above all (the fingerprint, see the header) — is
# UNKNOWN.
#
# FURNITURE, not signals: «غير متوفر» is in the markup of all 26 live pages, and is_purchasable is
# false on a live villa that simply prints no price. is_in_stock was true on 26 of 26, so what an
# out-of-stock record means HERE is unmeasured: such a product is kept exactly as before and COUNTED
# in the run notes, never guessed into "sold" — and its page is never certified LIVE either (a
# 'live' verdict would stamp it verified-alive): it reads UNKNOWN, so it stays active, keeps its
# strike and leaves an evidence row.
_PRODUCT_PAGE_RE = re.compile(r'<body[^>]*class="[^"]*\bsingle-product\b')
_PRODUCT_BLOCK_RE = re.compile(r'<div[^>]*\bid="product-\d+"[^>]*\bclass="([^"]*)"')
RES_TABLE, COM_TABLE = "fahadalshahri_residential_listings", "fahadalshahri_commercial_listings"


def _signal(status, body, moved) -> Optional[str]:
    """'live' | 'gone' | None — only what this product's own URL affirmatively answers."""
    if status in (404, 410):
        return "gone"
    if status != 200 or moved or not _PRODUCT_PAGE_RE.search(body):
        return None
    block = _PRODUCT_BLOCK_RE.search(body)
    return "live" if block and "instock" in block.group(1).split() else None


def _make_verify_gone(control: Optional[dict]):
    """The removal oracle for db.prune_unseen. A 404 is believed only while a known-live ad from
    this run (`control`) still reads live through the same session."""
    url_for = stored_listing_url((RES_TABLE, COM_TABLE))
    s = session()

    def probe(ad_number: str, canary=None):
        return LivenessProbe(platform="fahadalshahri", signal=_signal, session=lambda: s,
                             url_for=url_for, canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = probe(control["ad_number"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


def fetch_products(s: cc.Session, limit: int = 0) -> list[dict]:
    INCOMPLETE.clear()
    out: list[dict] = []
    page = 1
    total = None        # the source's own count of its catalogue (x-wp-total: 26 on 2026-10-02)
    while True:
        r = s.get(f"{BASE}/wp-json/wc/store/products",
                  params={"per_page": 100, "page": page}, timeout=45)
        if r.status_code != 200:
            break
        total = r.headers.get("x-wp-total")
        batch = r.json()
        if not batch:
            break
        out.extend(batch)
        if limit and len(out) >= limit:
            return out[:limit]
        if len(batch) < 100:
            break
        page += 1
    if str(len(out)) != str(total):     # a missing header is "cannot tell", never "complete"
        INCOMPLETE.append(f"read {len(out)} products, x-wp-total says {total}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("fahadalshahri")
    res: list[dict] = []
    com: list[dict] = []
    try:
        prods = fetch_products(s, limit=args.limit)
        if not prods:
            raise RuntimeError("store api returned no products")
        print(f"{SOURCE}: {len(prods)} products discovered", flush=True)
        skipped: dict[str, int] = {}
        unmeasured: dict[str, int] = {}
        for p in prods:
            row, cat, why = map_listing(p)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            if p.get("is_in_stock") is not True:    # unmeasured here: kept as before, and counted
                k = f"kept_active_is_in_stock={p.get('is_in_stock')}"
                unmeasured[k] = unmeasured.get(k, 0) + 1
            (com if cat == "commercial" else res).append(row)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1])))
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>10} {r0['transaction_type']:4} {str(r0['property_type']):12} "
                      f"{str(r0['city_ar']):8} d={str(r0['district_ar'])[:16]:16} "
                      f"a={str(r0['area_m2']):>6} "
                      f"px={r0.get('price_total')} ph={len(r0.get('photo_urls') or [])}")
            return 0
        if res:
            db.upsert_fahadalshahri_residential_batch(res)
        if com:
            db.upsert_fahadalshahri_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="fahadalshahri_residential_listings",
            com_table="fahadalshahri_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")

        # REMOVAL. An ad missing from this run is only a CANDIDATE: at three misses its own URL is
        # re-read, and it is hidden only on a 404 (_signal). An ad that still renders heals the row
        # — including one the crawler skips on purpose, which is not gone. No prune on a partial
        # walk or a single-vertical run (--limit never gets here: it is a dry run).
        pruned = 0
        if INCOMPLETE:
            print(f"  ⚠ Store API walk incomplete — no prune: {'; '.join(INCOMPLETE)}")
        elif args.type == "all":
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                k = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if k < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += k
        tally = ", ".join(f"{k}x{v}" for k, v in sorted({**skipped, **unmeasured}.items(),
                                                        key=lambda x: -x[1]))
        healthy = db.end_run(run_id, ok=True, rows_seen=len(prods), rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} skipped: {tally or 'none'}"[:300],
                             check_tables=["fahadalshahri_residential_listings",
                                           "fahadalshahri_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
