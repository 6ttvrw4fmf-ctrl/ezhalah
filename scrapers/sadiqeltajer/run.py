"""صادق التاجر — sadiq-eltajer.sa. 1,779 listings, onboarding 2026-09-19.

SOURCE SHAPE (probed live before a line of this was written):
  · The sitemap enumerates the whole catalogue: 1,779 URLs under /ads/. No REST API, no JSON.
  · Each listing page is 233 KB, but the LISTING'S OWN content is the first ~600-1,600 chars of
    visible text. Everything after «اعلانات مشابهة» is a block of OTHER listings, each with its
    own price and area.

THE PAGE CARRIES OTHER LISTINGS' PRICES. Measured on a real page: the «اعلانات مشابهة» block
renders «5415 478 م² 285,000 ريال», «7020 17800 م² 2,000,000 ريال» and two more — all belonging to
DIFFERENT properties. A whole-page price regex picks a neighbour's figure and puts it on this card.
That is the remal image incident one field over, and the alta price breach it nearly became. So
every value here is read from `own_section()`, which truncates at «اعلانات مشابهة» BY CONSTRUCTION
rather than by a blocklist.

THE PRICE IS IN THE HEADER, NEVER THE DESCRIPTION. The header reads
    «… كود الاعلان : 5106 (حد) <title> 235,000 ريال 480 م² اللوكيشن …»
and the description separately states «الدخل السنوي 23 الف» — the property's annual RENTAL INCOME,
not its sale price. A naive «(\\d+) ريال» over the same section returns 36,000 for a listing whose
header says «على السوم». So the price is taken only from the span between «كود الاعلان» and the
area, and «على السوم» / «حد» (by offer / reserve) yield NULL — an absence, never a number.

LOCATION is stated as «القصيم - بريدة - الغدير» = region - city - district, on every listing
sampled (10/10). The district is still offered to the catalog rather than trusted verbatim.
"""
from __future__ import annotations

import argparse
import hashlib
import html as ihtml
import os
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402

BASE = "https://sadiq-eltajer.sa"
SOURCE = "Sadiq Eltajer"
PREFIX = "SDQ"

_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

# Everything from here on belongs to OTHER listings.
_SIMILAR = "اعلانات مشابهة"


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({"Accept": "text/html,application/xhtml+xml",
                      "Accept-Language": "ar,en-US;q=0.7,en;q=0.6"})
    purl = os.environ.get("WASALT_PROXY_URL", "").strip()
    if purl:
        s.proxies = {"http": purl, "https": purl}
    return s


def own_section(page_html: str) -> str:
    """The listing's OWN visible text. Truncated at «اعلانات مشابهة» so a neighbour's price, area
    or title can never be read — the whole point of this scraper's design."""
    i = page_html.find(_SIMILAR)
    own = page_html[:i] if i > 0 else page_html
    b = re.sub(r"<(script|style|nav|header|footer).*?</\1>", " ", own, flags=re.S)
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", b))).strip()


# ── header: code, price, area ────────────────────────────────────────────────────────────────────
_CODE_RE = re.compile(r"كود\s*الاعلان\s*:?\s*([\d٠-٩]+)")
# The header span: from the ad code up to the area, which always closes it («… 480 م² اللوكيشن»).
_HEADER_RE = re.compile(r"كود\s*الاعلان\s*:?\s*[\d٠-٩]+(.{0,200}?)([\d٠-٩][\d٠-٩,\.]*)\s*م²")
_SOUM = re.compile(r"على\s*السوم|على\s*السـوم")


def ad_code(text: str) -> Optional[str]:
    m = _CODE_RE.search(text)
    return m.group(1).translate(_AR_DIGITS) if m else None


def parse_area(text: str) -> Optional[int]:
    m = _HEADER_RE.search(text)
    if not m:
        return None
    try:
        n = int(float(m.group(2).replace(",", "")))
    except ValueError:
        return None
    return n if 1 <= n <= 5_000_000 else None


# THIS SOURCE PRICES LAND PER SQUARE METRE, OFTEN WITHOUT SAYING SO. Measured over 117 listings:
# 14 of the 60 that state a figure are per-metre, and only 5 carry the explicit «( للمتر )» marker.
# The other 9 are unmarked — «220 ريال» on a 4,412 m² plot, «600 ريال» on 1,329 m². Stored as a
# TOTAL those are 0.05 and 0.45 SAR/m², which no Saudi property has ever sold for; stored as
# price_per_meter they are ordinary بريدة land prices and the shown total comes out right
# (PPM x area is a shown, searchable total — owner 2026-09-03).
#
# The unmarked case is NOT an inference about what the seller meant: a total below one riyal per
# square metre is physically impossible, so per-metre is the only reading the figure can carry.
# Anything above that threshold is taken as the total exactly as printed, never re-interpreted.
_PER_METRE = re.compile(r"للمتر|لل?متر\s*المربع|/\s*م²|/\s*متر")


def parse_price(text: str) -> tuple[Optional[int], Optional[int]]:
    """(price_total, price_per_meter). «على السوم» (by offer) is an ABSENCE — never a number, and
    never the «الدخل السنوي» rental income the description states further down."""
    m = _HEADER_RE.search(text)
    if not m:
        return None, None
    head = m.group(1)
    if _SOUM.search(head):
        return None, None
    p = re.search(r"([\d٠-٩][\d٠-٩,]{2,})\s*ريال", head.translate(_AR_DIGITS))
    if not p:
        return None, None
    try:
        n = int(p.group(1).replace(",", ""))
    except ValueError:
        return None, None
    if n <= 0:
        return None, None
    if _PER_METRE.search(head):
        return None, n
    area = parse_area(text)
    if area and n < area:                 # a total under 1 SAR/m² cannot be a total
        return None, n
    return n, None


# ── location: «القصيم - بريدة - الغدير» = region - city - district ────────────────────────────────
_LOC_RE = re.compile(
    r"(القصيم|الرياض|مكة\s*المكرمة|المدينة\s*المنورة|الشرقية|عسير|حائل|تبوك|جازان|نجران|"
    r"الجوف|الباحة|الحدود\s*الشمالية)\s*-\s*([^\-\s][^\-]{1,24}?)\s*-\s*([^\-\s][^\-]{1,26}?)(?=\s|$)")


def parse_location(text: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    m = _LOC_RE.search(text)
    if not m:
        return None, None, None
    return (re.sub(r"\s+", " ", m.group(1)).strip(),
            m.group(2).strip(),
            m.group(3).strip())


# ── the description's own labelled rows ──────────────────────────────────────────────────────────
# The description's own rows. A label ENDS the previous value whether or not it carries a colon —
# this source writes «العمر : جديد الدخل 42الف المكونات : …», so a stop that required a colon let
# «الدخل» run on and read 42 as the property's AGE for a listing whose own text says «جديد» (new).
# It also let «المكونات» fail entirely, because its value contains an inner colon
# («المكونات : مكونات كل استراحه : غرفتين . دورة مياة»). Both are the same defect: a value must
# stop at the next LABEL, not at the next colon.
_DESC_LABELS = ["المساحة", "العمر", "الواجهة", "المكونات", "الدخل السنوى", "الدخل السنوي",
                "الدخل", "الحد", "المزايا", "مزايا العقار", "الموقع", "الجولة الافتراضية",
                "حسب الصك"]
_DESC_STOP = "|".join(re.escape(x) for x in sorted(_DESC_LABELS, key=len, reverse=True))


def desc(text: str, label: str) -> Optional[str]:
    """The value printed after `label`, stopping at the next known label (colon or not)."""
    m = re.search(re.escape(label) + r"\s*:\s*(.{1,300}?)(?=\s*(?:" + _DESC_STOP + r")\b|$)", text)
    if not m:
        return None
    return m.group(1).strip(" .،-:") or None


_AGE_OPEN = re.compile(r"أكثر\s*من|اكثر\s*من|فوق\s")


# The annual rental income is written WITHOUT a colon — «الدخل السنوى 36000 ريال», «الدخل السنوي
# 23 الف» — so desc() cannot read it. It is captured separately, and only ever as income: it is
# what the property EARNS, never what it costs.
_INCOME_RE = re.compile(r"الدخل\s*السنو[ىي]\s*:?\s*([\d٠-٩][\d٠-٩,\.]*\s*(?:الف|ألف|مليون)?\s*(?:ريال)?)")


def annual_income(text: str) -> Optional[str]:
    m = _INCOME_RE.search(text)
    return m.group(1).strip() if m else None


def parse_age(text: str) -> Optional[int]:
    v = desc(text, "العمر")
    if not v or _AGE_OPEN.search(v):
        return None
    if "جديد" in v:
        return 0                     # a lexical identity: «جديد» IS new construction
    m = re.search(r"\d+", v.translate(_AR_DIGITS))
    if not m:
        return None
    n = int(m.group(0))
    return n if 0 <= n <= 100 else None


# «المكونات : غرفتين . دورة مياة . دكه» — the room list. Bathrooms are counted from the words the
# source used, including the DUAL («دورتين») and the two spellings of مياه/مياة.
_BATH_RE = re.compile(r"(?:^|[^ء-ي])([\d٠-٩]{1,2}|دورتين|[ء-ي]{2,8})?\s*"
                      r"دور(?:ة|تين|ات)\s*(?:ال)?ميا[هة]")
_BATH_WORDS = {"دورتين": 2, "واحده": 1, "واحدة": 1, "ثنتين": 2, "اثنتين": 2, "ثلاث": 3,
               "اربع": 4, "أربع": 4, "خمس": 5, "ست": 6, "سبع": 7}


def parse_bathrooms(text: str) -> Optional[int]:
    v = desc(text, "المكونات")
    if not v:
        return None
    vals = set()
    for tok, in [(m.group(1),) for m in _BATH_RE.finditer(v)]:
        if tok is None:
            vals.add(1)                      # «دورة مياه» with no count word = one
            continue
        d = tok.translate(_AR_DIGITS)
        if d.isdigit() and 0 < int(d) <= 50:
            vals.add(int(d))
        elif tok in _BATH_WORDS:
            vals.add(_BATH_WORDS[tok])
        else:
            vals.add(1)
    if len(vals) != 1:
        return None                          # disagreeing counts -> UNKNOWN, never a pick
    return vals.pop()


# «غرفتين» is the Arabic DUAL — it IS "two rooms" on its own, with no numeral and no following
# «غرف» to anchor on. A pattern that only reads «<number> غرف» returns nothing for it.
_ROOM_COUNT_RE = re.compile(r"([\d٠-٩]{1,2}|ثلاث|اربع|أربع|خمس|ست|سبع)\s*غرف")
_ROOM_DUAL_RE = re.compile(r"غرفتين")
_ROOM_SINGLE_RE = re.compile(r"غرف[ةه]")
_ROOM_WORDS = {"ثلاث": 3, "اربع": 4, "أربع": 4, "خمس": 5, "ست": 6, "سبع": 7}


def parse_bedrooms(text: str) -> Optional[int]:
    """Bedrooms from «المكونات». The list may name rooms singly («غرفة ماستر . غرفة . صالة»), in
    which case each «غرفة» is counted — that is what the source wrote, not an estimate."""
    v = desc(text, "المكونات")
    if not v:
        return None
    m = _ROOM_COUNT_RE.search(v)
    if m:
        tok = m.group(1)
        d = tok.translate(_AR_DIGITS)
        if d.isdigit():
            n = int(d)
            return n if 0 < n <= 50 else None
        return _ROOM_WORDS.get(tok)
    if _ROOM_DUAL_RE.search(v):
        return 2
    n = len(_ROOM_SINGLE_RE.findall(v))
    return n if 0 < n <= 50 else None


_STREET_RE = re.compile(r"شارع\s*[ء-ي]*\s*([\d٠-٩]{1,3})\s*م")


def parse_street_width(text: str) -> Optional[int]:
    """From «الواجهة : شارع شرقى 25م» — the listing's OWN frontage row, never the page at large."""
    v = desc(text, "الواجهة")
    if not v:
        return None
    m = _STREET_RE.search(v.translate(_AR_DIGITS))
    if not m:
        return None
    n = int(m.group(1))
    return n if 1 <= n <= 200 else None


_DIRECTIONS = ("شمالى", "شمالي", "جنوبى", "جنوبي", "شرقى", "شرقي", "غربى", "غربي",
               "شمال", "جنوب", "شرق", "غرب")


def parse_direction(text: str) -> Optional[str]:
    v = desc(text, "الواجهة")
    if not v:
        return None
    for d in sorted(_DIRECTIONS, key=len, reverse=True):
        if d in v:
            return d
    return None


_DEAL_RE = re.compile(r"(للبيع|للإيجار|للايجار|بيع|إيجار|ايجار)")


def parse_deal(text: str) -> Optional[str]:
    m = _DEAL_RE.search(text[:200])
    if not m:
        return None
    return "Rent" if m.group(1) in ("للإيجار", "للايجار", "إيجار", "ايجار") else "Buy"


# The header's category sits between the deal word and «كود الاعلان», and it is written with
# parentheses and conjunctions — «بيع تجاري عمائر و شقق ( تجارية و سكني )». A capture limited to
# Arabic letters and spaces matched none of those (18 of 40 sampled pages), so the span is taken
# whole and normalised, then mapped through a CLOSED map.
_TYPE_RE = re.compile(r"-->\s*(?:بيع|إيجار|ايجار)\s+(.{1,60}?)\s*كود\s*الاعلان")

_TYPE_AR = {
    "ارض": "أرض", "أرض": "أرض", "اراضي": "أرض", "أراضي": "أرض",
    "استراحات واحواش": "استراحة", "استراحات": "استراحة", "استراحة": "استراحة",
    "شاليهات ومنتجعات": "شاليه", "شاليهات": "شاليه", "شاليه": "شاليه",
    "فلل": "فيلا", "فيلا": "فيلا", "فلل ودبلكسات": "فيلا", "فلل و دبلكسات": "فيلا",
    "شقق": "شقة", "شقة": "شقة", "عمائر": "عمارة", "عمارة": "عمارة",
    "محلات": "محل", "محل": "محل", "مستودعات": "مستودع", "مستودع": "مستودع",
    "مزارع": "مزرعة", "مزرعة": "مزرعة", "بيوت": "بيت", "بيت": "بيت",
    "مكاتب": "مكتب", "مكتب": "مكتب", "دور": "دور", "أدوار": "دور",
    # the compound families this source actually prints
    "تجاري عمائر و شقق ( تجارية و سكني )": "عمارة",
    "تجاري عمائر و شقق": "عمارة",
    "تجاري محلات و صالات تجارية": "محل",
    "تجاري محلات": "محل",
    "وحدات": "شقة",
}

# «مخططات» is a SUBDIVISION PLAN — a whole layout of many plots, not one property with one price.
# It is skipped rather than filed as land: the schema has no bucket for it and guessing one would
# put a plan's headline figure on a card as if it were a single plot (AMBIGUOUS-MAPPING ASK-FIRST).
_TYPE_SKIP = {"مخططات", "مخطط"}


def parse_type_ar(text: str) -> Optional[str]:
    """The source's own category from the header, mapped through a CLOSED map. Anything outside it
    yields None and the listing is skipped — never bucketed into a nearest guess."""
    m = _TYPE_RE.search(text)
    if not m:
        return None
    raw = re.sub(r"\s+", " ", m.group(1).strip(" .،-|"))
    if raw in _TYPE_SKIP:
        return None
    return _TYPE_AR.get(raw)


def map_listing(url: str, page_html: str) -> tuple[Optional[dict], str]:
    text = own_section(page_html)
    if not text:
        return None, "residential"

    code = ad_code(text)
    if not code:
        return None, "residential"

    type_ar = parse_type_ar(text)
    if not type_ar:
        return None, "residential"
    property_type = normalize.map_type_exact(type_ar)
    if not property_type:
        return None, "residential"
    category = normalize.category_for_type(property_type).lower()

    deal = parse_deal(text)
    if not deal:
        return None, category

    region_ar, city_ar, district_raw = parse_location(text)
    if not city_ar:
        return None, category
    city = normalize.map_city(city_ar)
    city_id, region_id = to_catalog(city_ar, region_ar)
    district_ar = find_district_in_text(district_raw, city_id) if (district_raw and city_id) else None

    price_total, price_per_meter = parse_price(text)
    rent_period, price_annual = (None, None)
    if deal == "Rent":
        rent_period, price_annual = normalize.rent_period_and_annual(price_total, text)

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{code}",
        "listing_url": url,
        "source": SOURCE,
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": city,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": parse_area(text),
        "bedrooms": parse_bedrooms(text),
        "bathrooms": parse_bathrooms(text),
        "property_age": parse_age(text),
        "direction": parse_direction(text),
        "street_width_m": parse_street_width(text),
    }
    if deal == "Rent":
        row["price_annual"] = price_annual
        if rent_period:
            row["rent_period"] = rent_period
    else:
        row["price_total"] = price_total
    if price_per_meter is not None:
        row["price_per_meter"] = price_per_meter

    extra = {
        "ad_code": code,
        "type_ar": type_ar,
        "region_ar": region_ar,
        "components": desc(text, "المكونات"),
        "annual_income": annual_income(text),
        "price_is_per_metre": price_per_meter is not None,
        "price_published": (price_total is not None) or (price_per_meter is not None),
    }
    row["additional_info"] = {k: v for k, v in extra.items() if v is not None}
    return row, category


def fetch_catalogue(s: cc.Session, limit: int = 0) -> list[str]:
    """Every /ads/ URL from the sitemap — the source's own enumeration of its catalogue."""
    seen: set[str] = set()
    roots = [f"{BASE}/sitemap_index.xml", f"{BASE}/sitemap.xml"]
    for root in roots:
        try:
            r = s.get(root, timeout=40)
        except Exception:
            continue
        if r.status_code != 200 or "<loc" not in r.text:
            continue
        locs = re.findall(r"<loc>([^<]+)</loc>", r.text)
        seen |= {l for l in locs if "/ads/" in l}
        for sub in [l for l in locs if l.endswith(".xml")][:20]:
            try:
                rs = s.get(sub, timeout=40)
            except Exception:
                continue
            if rs.status_code == 200:
                seen |= {l for l in re.findall(r"<loc>([^<]+)</loc>", rs.text) if "/ads/" in l}
        if seen:
            break
    out = sorted(seen)
    return out[:limit] if limit else out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("sadiqeltajer")
    res: list[dict] = []
    com: list[dict] = []
    try:
        urls = fetch_catalogue(s, limit=args.limit)
        if not urls:
            raise RuntimeError("sitemap returned no /ads/ urls")
        print(f"{SOURCE}: {len(urls)} listings discovered", flush=True)

        skipped: dict[str, int] = {}
        for i, u in enumerate(urls, 1):
            try:
                r = s.get(u, timeout=40)
            except Exception:
                skipped["unreachable"] = skipped.get("unreachable", 0) + 1
                continue
            if r.status_code != 200:
                skipped[f"http_{r.status_code}"] = skipped.get(f"http_{r.status_code}", 0) + 1
                continue
            row, cat = map_listing(u, r.text)
            if not row:
                skipped["no_type_deal_or_city"] = skipped.get("no_type_deal_or_city", 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            if i % 250 == 0:
                print(f"   … {i}/{len(urls)}", flush=True)

        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1])))

        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in (res + com)[:10]:
                print(f"   {r0['ad_number']:10} {r0['transaction_type']:4} {str(r0['property_type']):14} "
                      f"{str(r0['city_ar']):8} area={str(r0['area_m2']):>6} "
                      f"px={r0.get('price_total')} ppm={r0.get('price_per_meter')}")
            return 0

        if res:
            db.upsert_sadiqeltajer_residential_batch(res)
        if com:
            db.upsert_sadiqeltajer_commercial_batch(com)
        n = len(res) + len(com)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(urls), rows_upserted=n,
                             check_tables=["sadiqeltajer_residential_listings",
                                           "sadiqeltajer_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI "
                  "instead of reporting a silent success.", flush=True)
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
