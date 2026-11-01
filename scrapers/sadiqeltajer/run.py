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
from scrapers.common.arabic_location import find_district_in_text, norm_district_tok, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe, stored_listing_url  # noqa: E402
from scrapers.common.page_pin import pin_from_html  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

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

# The ad's own description box («تفاصيل الإعلان»: `<div class="all-desc">…</div>`), cut before «اعلانات مشابهة»
# like own_section(), so a neighbour's words never answer for this ad. 12218852 says «البيع شامل الاثاث (المكيفات)»
# before its «المكونات» row and AC stayed NULL (🔬 backlog 794, CI re-read 39948473496).
#
# Read ONLY for a built unit, and never a clause that names a NEIGHBOUR. 10-23's first attempt read the box on
# every ad and stamped parking on plots: 12218009 «يليه مواقف» (a car park next to the plot), and four more land
# ads (reverted the same run, migration 20261023123442). A plot has no AC / kitchen / parking of its own, and
# «يليه / مقابل / بجوار / قريب من …» describes what is AROUND the property, not what it has.
_ALL_DESC = re.compile(r'class="all-desc"[^>]*>(.*?)</div>', re.S)
# Amenities the shared reader can name that neither sadiqeltajer table has a column for (information_schema,
# 2026-10-24): writing one would fail the whole batch with PGRST204 (the raghdan crawl, 2026-10-09).
_NO_COLUMN = ("balcony_terrace", "optical_fibers")
_NOT_A_UNIT = {"Residential Land", "Commercial Land", "Raw Land", "Agricultural Land", "Farm"}
_NEARBY = re.compile(r"يلي|مقابل|بجوار|بجانب|جنب|قريب|بالقرب|مجاور|يجاور|امام|أمام|خلف|على شارع|علي شارع")
_CLAUSE = re.compile(r"[\n\r،,.;؛|()\-]+")


def ad_description(page_html: str) -> Optional[str]:
    i = page_html.find(_SIMILAR)
    m = _ALL_DESC.search(page_html[:i] if i > 0 else page_html)
    if not m:
        return None
    return normalize.html_block_lines(m.group(1)) or None


def unit_description_text(page_html: str, property_type: Optional[str]) -> Optional[str]:
    """The description box's own clauses, one per line, for a built unit; None for land and every clause
    that names what is near the property."""
    if not property_type or property_type in _NOT_A_UNIT:
        return None
    box = ad_description(page_html)
    if not box:
        return None
    keep = [c.strip() for c in _CLAUSE.split(box) if c.strip() and not _NEARBY.search(c)]
    return "\n".join(keep) or None


# PHOTOS — the ad's own gallery, and ONLY the own gallery. own_section() has already dropped the
# «اعلانات مشابهة» block, so a similar ad's slides cannot leak in; we still exclude the site's
# chrome (settings icons, /assets/ logos) by path. The slide markup is
# `<div class="slide-img"><img src="https://sadiq-eltajer.sa/storage/webp/<hash>.webp">`.
_PHOTO_RE = re.compile(r'class="slide-img"[^>]*>\s*<img[^>]+src="([^"]+)"', re.S)


def photos(page_html: str) -> Optional[list[str]]:
    """This listing's photo URLs, in page order, deduped. None when the ad has no gallery.

    Reads the RAW html (own_section() strips tags, and the gallery is markup), but slices at
    «اعلانات مشابهة» itself so a similar ad's slides can never be captured — the same construction
    that keeps a neighbour's price out."""
    i = page_html.find(_SIMILAR)
    own = page_html[:i] if i > 0 else page_html
    urls = [u for u in dict.fromkeys(_PHOTO_RE.findall(own))
            if u.startswith("http") and "/storage/" in u
            and "/settings/" not in u and "/assets/" not in u]
    return urls or None


# PIN — the ad's own «موقع العقار» map link in its title row (owner 2026-10-24: every pin the source has).
# Measured on 5 live ads (source-reread 40072817782): the title row carries
# `<a href="https://www.google.com/maps?q=26.30,44.02" class="ad-map-wrap">`, and each «اعلانات مشابهة»
# card carries its OWN `class="ad-map-icon"` link with a different pair. So only the ad-map-wrap link, and
# only above «اعلانات مشابهة» — a neighbour's pin can never be read, the same construction as the price.
_OWN_MAP_LINK = re.compile(r'<a\s+href="([^"]*maps\?q=[^"]*)"\s+class="ad-map-wrap"')


def own_pin(page_html: str) -> dict:
    """{"latitude","longitude"} from the ad's own title-row map link, else {} (no link = the ad has no pin)."""
    i = (page_html or "").find(_SIMILAR)
    own = page_html[:i] if i > 0 else (page_html or "")
    m = _OWN_MAP_LINK.search(own)
    return pin_from_html(ihtml.unescape(m.group(1))) if m else {}


# ── header: code, price, area ────────────────────────────────────────────────────────────────────
_CODE_RE = re.compile(r"كود\s*الاعلان\s*:?\s*([\d٠-٩]+)")
# The header span: from the ad code up to the area, which always closes it («… 480 م² اللوكيشن»).
_HEADER_RE = re.compile(r"كود\s*الاعلان\s*:?\s*[\d٠-٩]+(.{0,200}?)([\d٠-٩][\d٠-٩,\.]*)\s*م²")
# The PRICE span ends at the area OR, on an ad that states no area, at «اللوكيشن». Keyed on the area
# alone, all 81 area-less ads stored NULL although 60 print a price («… دبلكس بحي الرابية 38,000
# ريال ( للإيجار ) اللوكيشن …», SDQ7896 — 2026-09-28). With an area the span is unchanged: the area
# always comes before «اللوكيشن», and the lazy match stops at whichever comes first.
_PRICE_SPAN_RE = re.compile(
    r"كود\s*الاعلان\s*:?\s*[\d٠-٩]+(.{0,300}?)(?:[\d٠-٩][\d٠-٩,\.]*\s*م²|اللوكيشن)")
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


def _stated_per_metre(text: str, n: int) -> bool:
    """The ad's own text states THIS figure per metre — the shared reader (normalize.stated_per_metre): the marker
    right after the figure (SDQ5562 «الحد ( 550 ريال للمتر )», SDQ6107 «الســــوم ( 1060 ريـــال للمتر )» with
    tatweel) or right before it (SDQ6985 «البيع للمتر 460», SDQ7097 «السوم للمتر 700»). Read 2026-10-18 for the
    under-the-city-floor alarm: 10 of 14 sadiqeltajer rows state their rate one of these two ways."""
    return normalize.stated_per_metre(text, n)


def parse_price(text: str) -> tuple[Optional[int], Optional[int]]:
    """(price_total, price_per_meter). «على السوم» (by offer) is an ABSENCE — never a number, and
    never the «الدخل السنوي» rental income the description states further down."""
    m = _PRICE_SPAN_RE.search(text)
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
    if _stated_per_metre(text, n):
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


# The district group above stops at the FIRST space — the line runs straight on into the page's next
# words («القصيم - بريدة - الغدير اعلانات مشابهة»), so it cannot be greedy. But a two-word district
# lost its second word: «القصيم - بريدة - القاع البارد» stored «القاع», which no catalog knows in
# بريدة (49 searchable ads with no district on 2026-10-09; the ad URLs read «بحي-القاع-البارد»).
# district_window() gives the district word plus the next two words; resolve_district() accepts a
# 3-, then 2-word window only when it STARTS at the district word and the catalog has exactly that
# name, then falls back to the one word as before. Never a window that starts later: «بحي المطار»
# (not in the catalog) followed by the page word «الربيع» must stay unknown, not become حي الربيع.
def district_window(text: str) -> Optional[str]:
    m = _LOC_RE.search(text)
    if not m:
        return None
    tail = re.findall(r"[؀-ۿ]+", text[m.end(3):])[:2]
    return " ".join([m.group(3).strip(), *tail])


def resolve_district_words(text: str, city_id: Optional[int]) -> tuple[Optional[str], Optional[str]]:
    """(catalog district, the ad's OWN words it matched). The words are what the card prints as the
    neighbourhood: 2026-10-10 a «حي القاع البارد» card still read «القاع, بريدة» because
    `neighborhood` kept the one-word read after the district resolved from the two-word window."""
    words = (district_window(text) or "").split()
    if not words or not city_id:
        return None, None
    for size in (3, 2):
        if len(words) >= size:
            cand = " ".join(words[:size])
            hit = find_district_in_text(cand, city_id)
            if hit and norm_district_tok(hit) == norm_district_tok(cand):
                return hit, cand
    hit = find_district_in_text(words[0], city_id)
    if hit is None:
        # A spelling of a catalogued district (ops_district_name_decision 'variant', 20261018073107): mapped
        # here, never added to the catalog. «الوسيطي» / «الوسيطى» is بريدة's «حي الوسيطا» (39 ads, 10-18).
        alt = _DISTRICT_SPELLING.get((city_id, norm_district_tok(words[0])))
        if alt:
            hit = find_district_in_text(alt, city_id)
    return hit, words[0]   # the one-word read, exactly as before


_DISTRICT_SPELLING = {(11, norm_district_tok("الوسيطي")): "حي الوسيطا",
                      # 2026-10-19 (#657): «المريدسية» is بريدة's «حي المريديسية» (sadiqeltajer 3 + ashab 9).
                      (11, norm_district_tok("المريدسية")): "حي المريديسية"}


def resolve_district(text: str, city_id: Optional[int]) -> Optional[str]:
    return resolve_district_words(text, city_id)[0]


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


# ONE street or nothing (the fleet rule, normalize.one_street_width / one_direction). This source
# writes a corner plot as two streets in one frontage row — «الواجهة : شارع تجارى غربي 40م شارع
# جنوبي 15م» (12217842, re-read 2026-10-13). The old reader allowed ONE word between «شارع» and the
# number, so it skipped the 40 m commercial street and stored 15, and took «جنوبي» because it came
# first in a word list: a confident value the ad never stated. Two streets or two bearings → NULL.
_STREET_RE = re.compile(r"شارع((?:\s*[ء-ي]+){0,3})\s*:?\s*([\d٠-٩]{1,3})\s*(?:م|متر)(?![ء-ي])")
# What follows the street(s) in the same row and is NOT a street: an alley («وممر جنوبي 8م», «ومر شرقي»),
# the plot's side lengths («الاطــوال : شمالي 41م جنوبي 51م …», every bearing in it is a SIDE, not a
# facade), the plan number, or a «قريبة من …» note. Measured on the 117 re-read rows (2026-10-13).
_FACADE_TAIL = re.compile(r"(?:\s|^)(?:و\s*)?(?:ممر|مر(?=\s)|الا?[ـ]*ط[ـ]*و[ـ]*ا?[ـ]*ل|الأطوال|رقم المخطط|المخطط|قريب)")
_MANY_STREETS = re.compile(r"شارعين|شوارع")


def facade_row(text: str) -> Optional[str]:
    """The listing's OWN frontage row, verbatim (kept in additional_info so it can be re-judged)."""
    return desc(text, "الواجهة")


def _street_part(text: str) -> Optional[str]:
    """The frontage row up to the first thing that is not a street; None when it names two streets."""
    v = facade_row(text)
    if not v:
        return None
    v = _FACADE_TAIL.split(v, maxsplit=1)[0]
    if _MANY_STREETS.search(v) or v.count("شارع") > 1:
        return None
    return v


def parse_street_width(text: str) -> Optional[int]:
    """From «الواجهة : شارع شرقى 25م» — the listing's OWN frontage row, never the page at large."""
    v = _street_part(text)
    if not v:
        return None
    m = _STREET_RE.findall(v.translate(_AR_DIGITS))
    if len(m) != 1:
        return None
    n = int(m[0][1])
    return n if 1 <= n <= 200 else None


_DIRECTIONS = ("شمالى", "شمالي", "جنوبى", "جنوبي", "شرقى", "شرقي", "غربى", "غربي",
               "شمال", "جنوب", "شرق", "غرب")
_ALEF_MAQSURA = str.maketrans("ى", "ي")


def parse_direction(text: str) -> Optional[str]:
    v = _street_part(text)
    if not v:
        return None
    # «شارع شرقي12م»: a bearing glued to its number is still that bearing.
    v = re.sub(r"(?<=[ء-ي])(?=[\d٠-٩])|(?<=[\d٠-٩])(?=[ء-ي])", " ", v)
    if normalize.one_direction(v.translate(_ALEF_MAQSURA)) is None:
        return None                     # no bearing, or two (a corner plot) → unknown
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
#
# A FEATURED ad carries the site's «مميز» badge in front of the deal word — «--> مميز بيع فلل كود
# الاعلان : 8134». Anchoring the deal word directly on «-->» skipped every featured ad on the site
# (8 on 2026-09-28) as if it had no category at all. The badge is page chrome, not a category.
_TYPE_RE = re.compile(r"-->\s*(?:مميز\s+)?(?:بيع|إيجار|ايجار)\s+(.{1,60}?)\s*كود\s*الاعلان")
# Rent ads sometimes restate the deal after the category — «فلل ودبلكسات (ايجار)». That is the
# same category with the deal repeated, never a different one.
_DEAL_SUFFIX = re.compile(r"\s*\(\s*(?:ايجار|إيجار|بيع)\s*\)$")

_TYPE_AR = {
    "ارض": "أرض", "أرض": "أرض", "اراضي": "أرض", "أراضي": "أرض",
    "استراحات واحواش": "استراحة", "استراحات": "استراحة", "استراحة": "استراحة",
    "شاليهات ومنتجعات": "شاليه", "شاليهات": "شاليه", "شاليه": "شاليه",
    "فلل": "فيلا", "فيلا": "فيلا", "فلل ودبلكسات": "فيلا", "فلل و دبلكسات": "فيلا",
    "شقق": "شقة", "شقة": "شقة", "عمائر": "عمارة", "عمارة": "عمارة",
    "محلات": "محل", "محل": "محل", "مستودعات": "مستودع", "مستودع": "مستودع",
    "مزارع": "مزرعة", "مزرعة": "مزرعة", "بيوت": "بيت", "بيت": "بيت",
    "مكاتب": "مكتب", "مكتب": "مكتب", "دور": "دور", "أدوار": "دور", "ادوار": "دور",
    # the compound families this source actually prints
    "تجاري عمائر و شقق ( تجارية و سكني )": "عمارة",
    "تجاري عمائر و شقق": "عمارة",
    "تجاري محلات و صالات تجارية": "محل",
    "تجاري محلات": "محل",
    "وحدات": "شقة",
    # Categories the 2026-09-28 coverage audit found skipped as if unknown (count on that day's
    # sitemap). Each is ONE property type in the source's own words, mapped to a type the shared
    # map already has — never a new one:
    "دبلكسات": "دوبلكس",                  # 48 + 1 featured → Duplex
    "تجاري ارض": "أرض تجارية",           # 63 + 1 featured → Commercial Land
    "محلات و صالات تجارية": "محل",        # 33 — the RENT spelling of «تجاري محلات و صالات تجارية»
    "ورش صناعية": "ورشة",                 # 5 → Workshop
    "تجاري فندق": "فندق",                 # 1 → Hotel
}

# «مخططات» is a SUBDIVISION PLAN — a whole layout of many plots, not one property with one price.
# It is skipped rather than filed as land: the schema has no bucket for it and guessing one would
# put a plan's headline figure on a card as if it were a single plot (AMBIGUOUS-MAPPING ASK-FIRST).
_TYPE_SKIP = {"مخططات", "مخطط"}

# MIXED BUCKETS — deliberately NOT mapped (AMBIGUOUS-MAPPING ASK-FIRST). Each holds several
# property types, and the category alone cannot say which one a given ad is. Measured 2026-09-28:
#   «دور و شقتين و ادوار» (37): «دور ارضي» (a floor), «دور وشقتين» (a floor + two flats, i.e. a
#       whole building), «بيت قديم», «مجمع سكني», and ad 5965 whose title says «فله» while its own
#       description says «دور مع شاليه».
#   «دورين» (21): «دورين مفصولات» (two separate floors), «فله دورين», «عمارة دورين», «بيت شعبي
#       دورين», «دور علوي نظام دبلوكس».
#   «مستودعات و ورش» (25): warehouse OR workshop — and one is a factory («مصنع»).
#   «تجاري ارض للمستودعات و للورش» (12): commercial OR industrial land.
#   «بيع تجاري» (9, header «بيع بيع تجاري»): no type at all.
# Filing any of these under one type would put the wrong type on the card. They are counted by
# name in the run notes so the owner can decide, and stay out until then.


def type_category(text: str) -> Optional[str]:
    """The source's own header category, normalised, or None when the header has none."""
    m = _TYPE_RE.search(text)
    if not m:
        return None
    return _DEAL_SUFFIX.sub("", re.sub(r"\s+", " ", m.group(1).strip(" .،-|")))


def parse_type_ar(text: str) -> Optional[str]:
    """The source's own category from the header, mapped through a CLOSED map. Anything outside it
    yields None and the listing is skipped — never bucketed into a nearest guess."""
    raw = type_category(text)
    if not raw or raw in _TYPE_SKIP:
        return None
    return _TYPE_AR.get(raw)


def map_listing(url: str, page_html: str) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason). A skipped ad always says WHY, so the run notes can count each
    reason on its own — a single lumped «no_type_deal_or_city» tally hid which real categories were
    being dropped (the 2026-09-28 coverage audit)."""
    text = own_section(page_html)
    if not text:
        return None, "residential", "empty_page"

    code = ad_code(text)
    if not code:
        return None, "residential", "no_ad_code"

    raw_type = type_category(text)
    if not raw_type:
        return None, "residential", "no_category_header"
    if raw_type in _TYPE_SKIP:
        return None, "residential", "subdivision_plan"
    type_ar = parse_type_ar(text)
    if not type_ar:
        return None, "residential", f"unmapped:{raw_type}"
    property_type = normalize.map_type_exact(type_ar)
    if not property_type:
        return None, "residential", f"type_unmapped:{type_ar}"
    category = normalize.category_for_type(property_type).lower()

    deal = parse_deal(text)
    if not deal:
        return None, category, "no_deal"

    region_ar, city_ar, district_raw = parse_location(text)
    if not city_ar:
        return None, category, "no_city"
    city = normalize.map_city(city_ar)
    city_id, region_id = to_catalog(city_ar, region_ar)
    district_ar, district_words = (resolve_district_words(text, city_id) if (district_raw and city_id)
                                   else (None, None))
    if district_ar and district_words:
        district_raw = district_words      # the ad's own full words («القاع البارد», not «القاع»)

    price_total, price_per_meter = parse_price(text)
    rate_stated = price_per_meter is not None
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
        "photo_urls": photos(page_html),
        # The ad's own «تفاصيل الإعلان» box, whole and verbatim (redacted, PDPL) — «للبيع فله بحي البساتين … المكونات
        # : الدور الاول : مشب . مجلس رجال …». 2026-10-30: 1,740 of 1,740 active rows stored none, so the AI facts
        # reader had nothing to read. This is the text, not a reading of it: the land / «يليه» filtering above
        # (unit_description_text) still decides the amenity columns. No box → NULL, never ''.
        "description": redact_pii(ad_description(page_html)) or None,
    }
    if deal == "Rent":
        row["price_annual"] = price_annual
        if rent_period:
            row["rent_period"] = rent_period
    else:
        # A stated rate with no total is the source settling «no total»: AUTHORITATIVE_NULL clears a total an
        # older read stored (SDQ5562 held 550 as a total), where a plain None would be dropped by the upsert.
        no_total = db.AUTHORITATIVE_NULL if rate_stated else None
        row["price_total"] = price_total if price_total is not None else no_total
    if price_per_meter is not None:
        row["price_per_meter"] = price_per_meter

    extra = {
        "ad_code": code,
        "type_ar": type_ar,
        "region_ar": region_ar,
        "components": desc(text, "المكونات"),
        "facade_raw": facade_row(text),
        "annual_income": annual_income(text),
        "price_is_per_metre": price_per_meter is not None,
        "price_published": (price_total is not None) or (price_per_meter is not None),
    }
    row["additional_info"] = {**own_pin(page_html), **{k: v for k, v in extra.items() if v is not None}}
    # The kitchen / maid room / laundry the ad's OWN room list names («المكونات : … مطبخ . دورة مياة»).
    # The site has no amenity field at all; this labelled list is its statement: yes, an explicit no, or nothing
    # (owner 2026-10-24; ADVANCED_FILTER_SOURCE_TRUTH §2). Kitchen was 0 of 1,512 active while 272 lists name one
    # (🔬 AF engineer 2026-10-09; ops_af_score kitchen we_miss 3/3).
    said = normalize.prose_amenities(extra["components"], skip=_NO_COLUMN)
    # …and the description box's own clauses, for a built unit only (backlog 794, see unit_description_text).
    # The list and the box disagreeing is no answer: unknown, written so a stale value is cleared.
    for col, v in normalize.prose_amenities(unit_description_text(page_html, property_type), skip=_NO_COLUMN).items():
        said[col] = v if said.get(col, v) == v else db.AUTHORITATIVE_NULL
    row.update(said)
    return row, category, ""


# Why a walk of the sitemap may not be the whole catalogue. Non-empty → no prune this run.
INCOMPLETE: list[str] = []

# ── REMOVAL (measured 2026-10-02). Until then this crawler had NO removal step at all: an ad the
# office closed stayed active here for good (24 active rows the sitemap had dropped 3+ days before).
#
# This office does not delete a closed ad. It drops it from the sitemap and KEEPS the page, which
# still renders the full ad and its «كود الاعلان» — so "200 with the code" is not proof of life.
# What changes is the contact block: 10 of 10 dropped ads say «غير متاح» where the call and WhatsApp
# buttons were, and 12 of 12 live ads carry the call button and no «غير متاح». («منتهي» is on every
# page, live or not: furniture.) A slug that never existed answers 200 with a 3,892-byte shell that
# says «غير موجود» and has no ad code. Anything else, including 404 and every block, is UNKNOWN.
_UNAVAILABLE = "غير متاح"
_CALL_BUTTON = "call-btn"
_NOT_FOUND = "غير موجود"
RES_TABLE, COM_TABLE = "sadiqeltajer_residential_listings", "sadiqeltajer_commercial_listings"


def _signal(status, body, moved) -> Optional[str]:
    """'live' | 'gone' | None — only what this page affirmatively says about ITSELF."""
    if status != 200 or moved:
        return None
    i = body.find(_SIMILAR)                       # never read a neighbour's card as this ad's own
    own = body[:i] if i > 0 else body
    offered = _CALL_BUTTON in own
    has_code = bool(ad_code(own_section(body) or ""))
    if offered and has_code and _UNAVAILABLE not in own:
        return "live"
    if not offered and (_UNAVAILABLE in own or (_NOT_FOUND in own and not has_code)):
        return "gone"
    return None


def _make_verify_gone(control: Optional[dict]):
    """The removal oracle for db.prune_unseen and for the daily direct check. A removal is believed
    only while a known-live ad from this run (`control`) still reads live through the same session."""
    url_for = stored_listing_url((RES_TABLE, COM_TABLE))
    s = session()

    def probe(ad_number: str, canary=None):
        return LivenessProbe(platform="sadiqeltajer", signal=_signal, session=lambda: s,
                             url_for=url_for, canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = probe(control["ad_number"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


def fetch_catalogue(s: cc.Session, limit: int = 0) -> list[str]:
    """Every /ads/ URL from the sitemap — the source's own enumeration of its catalogue."""
    INCOMPLETE.clear()
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
            except Exception as e:
                INCOMPLETE.append(f"{sub} raised {type(e).__name__}")
                continue
            if rs.status_code == 200:
                seen |= {l for l in re.findall(r"<loc>([^<]+)</loc>", rs.text) if "/ads/" in l}
            else:
                INCOMPLETE.append(f"{sub} answered HTTP {rs.status_code}")
        if seen:
            break
    out = sorted(u for u in seen if not PLATFORM_TEST_AD.search(u))
    return out[:limit] if limit else out


# The platform's own test ad sits in its sitemap: /ads/fake-1001-2 renders «fake - 1002» with no price, no
# title, no description and the default «default-build.png» image, and was served as a 50 m² villa for sale
# in مكة (17956334, 2026-10-16, re-read run 38916270732). It is not a property. It is withdrawn and
# adjudicated by migration (🆕 backlog #589); this keeps the next crawl from re-ingesting it.
PLATFORM_TEST_AD = re.compile(r"/ads/fake-\d")


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
            row, cat, why = map_listing(u, r.text)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            if i % 250 == 0:
                print(f"   … {i}/{len(urls)}", flush=True)

        skip_notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print("  skipped (not guessed): " + skip_notes)

        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in (res + com)[:10]:
                # px and ppm are printed on SEPARATE source lines on purpose. Joined, the line reads
                # `price_total ... = ... price_per_meter` — the exact shape verify-no-derived-price.ts
                # bans (a total fabricated from a per-metre rate). Both are verbatim source captures
                # here, but the guard scans one physical line at a time and cannot know that, and it
                # is a guard we never weaken to make a print statement fit. Keep them split.
                print(f"   {r0['ad_number']:10} {r0['transaction_type']:4} {str(r0['property_type']):14} "
                      f"{str(r0['city_ar']):8} area={str(r0['area_m2']):>6} "
                      f"px={r0.get('price_total')} "
                      f"ppm={r0.get('price_per_meter')}")
            return 0

        if res:
            db.upsert_sadiqeltajer_residential_batch(res)
        if com:
            db.upsert_sadiqeltajer_commercial_batch(com)

        # An ad whose category flipped this run is SUPERSEDED in the table it left. Both of this
        # platform's verticals are written from one pass, so a listing reclassified from
        # residential to commercial (or back) would otherwise stay active in BOTH tables and show
        # twice. This runs before any prune because it reasons from positive evidence — we parsed
        # and classified the ad this run — rather than from absence, which prune's own guards
        # deliberately protect against. See db.retire_superseded_siblings.
        superseded = db.retire_superseded_siblings(
            res_table="sadiqeltajer_residential_listings",
            com_table="sadiqeltajer_commercial_listings",
            res_ads={r["ad_number"] for r in res},
            com_ads={r["ad_number"] for r in com},
            source="Sadiq Eltajer")
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")

        # REMOVAL. An ad missing from this run's sitemap walk is only a CANDIDATE: at three misses
        # its own page is re-read, and it is hidden only if that page says so (_signal). A page that
        # still offers the ad heals the row. No prune on a partial walk or a single-vertical run.
        pruned = 0
        if INCOMPLETE:
            print(f"  ⚠ sitemap walk incomplete — no prune: {'; '.join(INCOMPLETE)}")
        elif args.type == "all":
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                k = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if k < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += k

        n = len(res) + len(com)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(urls), rows_upserted=n,
                             notes=f"pruned={pruned} skipped: {skip_notes or 'none'}"[:300],
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
