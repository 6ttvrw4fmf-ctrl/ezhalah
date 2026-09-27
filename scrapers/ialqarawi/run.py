"""مكتب إبراهيم القرعاوي للإستثمارات العقارية — ialqarawi.com. 2,641 listings.
Onboarding 2026-09-20.

SOURCE SHAPE (measured live before a line of this was written; every count below was counted, not
estimated):
  · Custom PHP, server-rendered, no API and no sitemap. Two routes matter:
        index.php?router=cards&catid=<c>&type=<t>   — a WHOLE category, no pagination at all
        index.php?router=card&id=<id>&catid=<c>     — one listing
    hrefs are HTML-escaped (`&amp;`), so they are unescaped before use or every fetch lands on the
    homepage.
  · `type` is the DEAL, stated by the site's own nav: 1 = «عقارات البيع», 2 = «عقارات الإيجار»,
    3 = «عقارات الإستثمار». Investment is neither Buy nor Rent — 13 listings, SKIPPED, never
    coerced into one (their bodies are a mix of long-lease offers and plain sale ads).
  · 22 categories × 3 deals = 66 index pages and that is the ENTIRE catalogue: 2,641 listings,
    2,599 Buy / 29 Rent / 13 Investment. catid=46 alone returns 946 cards on ONE page — there is
    no `page`/`start`/`limit` parameter anywhere, so "paginate to reach them all" is a no-op here;
    the whole category arrives in one response. Counting the `<section class="cards">` block is
    load-bearing: the nav and footer carry ~24 more card links per page.
  · THE ONE PAGE THAT LIES: a listing id that does not exist serves **HTTP 200 with the HOMEPAGE
    body** (134,957 bytes, 62 other listings' cards in it). There is no 404 and no error text. So a
    detail parse that finds no «رقم العقار» is treated as a DEFINITIVE miss, and a «رقم العقار»
    that disagrees with the requested id is a mismatch — both skip. Without that guard this
    scraper would have happily written the homepage as a listing.
  · PHOTOS — the probe's "18-19 photos per listing" is the sibling-card trap. Only the
    `royalSlider` gallery (`data-rsBigImg`) belongs to the listing; the 12-18 other
    `download/products/…` images on the page are OTHER listings' «عقارات مشابهة» cards, which use
    a plain `<img src>`. Measured truth: 1-28 per listing (9,078 across the catalogue,
    stored capped at 20), and `data-rsBigImg` appears nowhere else on the page.
  · PRICE — **the probe's "ZERO prices anywhere" is WRONG** and this file does not rely on it. The
    detail page has two labelled price rows, «سعر السوم» (the price being asked/bid) and «سعر الحد»
    (the seller's floor). Across all 2,641 listings 674 end up with a published price (26.7%
    map); 353 distinct non-plain strings were dumped from both cells before this was written.
    They are free text typed by the office and every trap in the fleet's price rules is present at
    once, so `parse_money` refuses anything it cannot read as ONE unqualified number:
        «850 الف» → 850000        «الف» after a bare <1000 number is a MULTIPLIER
        «1.600.000 الف» → 1600000 «الف» after a grouped/≥1000 number is a REDUNDANT WORD (×1000
                                   here would be a 1000× error on the card)
        «2,100,000» → 2100000     «1.250.000» → 1250000   «3850.000» → 3850000
                                   a dot followed by exactly 3 digits is a thousands SEPARATOR;
                                   a dot followed by 1-2 digits is a DECIMAL («517.5م»)
        «تبدا من 12000الف الى20000الف» → NULL (a RANGE is not a price)
        «60.000 الف لكل مستودع», «حد لكل قطعة 520.000الف», «10.000 للفتحة الواحدة» → NULL
                                   (a PER-UNIT figure is not this listing's total)
        «على السوم» / «ع السوم» / «لا يوجد» → NULL (an invitation to bid is not a price)
        «مليون و500 الف» → 1500000 «مليونين» → 2000000  «ثلاثة مليون» → 3000000
                                   the compound form. Reading its single number as «×مليون» made
                                   «مليون و500 الف» 500,000,000 — a 333× error caught by a
                                   price÷area sweep, not by any test that only fed the parser the
                                   strings it was written for.
        «مليون و100» → NULL       (the second term's unit is unstated: 100 thousand, or 100?)
        «9300 الف» → NULL         («الف» contradicts the digits in the 1,000-9,999 band)
        «1000», «3500», «اخر سومه 6300» → NULL (bare, no separators, no multiplier word, under
                                   10,000: every legitimate sub-20,000 figure on this source is
                                   written «10.000»/«18.000», so a bare one has no stated unit)
        «1500 للمتر», «18 ريال للمتر» → price_per_meter, and price_total = ppm × area_m2 when the
                                   source also published the area (owner rule 2026-09-03, 17 rows)
    Every raw price string is stored in additional_info (`som_price_raw`, `limit_price_raw`,
    `price_basis`, `price_skip_reason`) whether it parsed or not, so no published figure is lost.
  · RENT PERIOD — stated on exactly one measured listing («18.000 سنوي»). Nothing else states a
    period, so `rent_period` stays NULL and the figure goes to `price_annual` unscaled. A default
    would be a 12× error on the card.
  · CITY is NOT a field. It lives in the title («… بحي الصالحية بعنيزة», «… بمدينة حائل»,
    «مزرعة غرب الرس منطقة القصيم»), so the title is scanned RIGHT-TO-LEFT (Arabic titles put the
    city last) and every candidate is handed to `to_catalog()` — the catalog decides what is a
    city, never this file. 2,545 of 2,641 titles place a city against the in-repo city list; the
    rest are typos («بعينزة», «بعنيرة») or towns the catalog must judge, and they SKIP.
  · «الحي» IS a field, and it sometimes holds a CITY instead of a district — three بلك تجاري
    rentals whose titles say عنيزة carry «الحي: الدوادمي» (a town 500 km away). A `الحي` value that
    `to_catalog` recognises as a city is therefore never written to `neighborhood`; it is kept in
    additional_info.district_field_raw instead.
  · «مزاد» IS A SUBSTRING OF A REAL DISTRICT. «حي المزادة» is a عنيزة district (5 listings).
    The auction check uses Arabic-letter boundaries; a substring test would have deleted them.
  · TYPES: all 22 category labels are PLURAL («فلل», «اراضي سكنية»), so none of them hit the shared
    TYPE_MAP_AR — they are mapped through the documented per-platform `overrides` escape hatch.
    Three categories are unreliable containers rather than types («بلك», «بلك تجاري», «محطات» hold
    أرض/إستراحة/مزرعة/فيلا/محطة وقود side by side), so for those the TITLE's own type word decides,
    and what neither places is skipped as type_unmapped rather than guessed.
  · `direction` ONLY from an explicit «واجهة <جهة>» phrase naming one compass point («واجهة شرقية»,
    QRW3090). The per-STREET directions («شارع عرض 15م جنوبأ … وشارع عرض 20م شمالا») are never read
    as the facing: most listings open onto two streets, so "the" facing would be a guess.
  · `property_age` ONLY from the anchored «العمر 13 سنة» / «عمر العقار 9 سنوات» phrase
    (normalize.age_from_labelled_prose); «يتجاوز 30 سنه» is an open bound → NULL.
  · NOT CAPTURED, deliberately: «مسطح البناء» (built-up area — no column means exactly that; the
    raw value is in additional_info).
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, http, normalize  # noqa: E402
from scrapers.common.arabic_location import (  # noqa: E402
    find_district_in_text, is_ambiguous_standalone_word, to_catalog,
)
from scrapers.common.http_liveness import LivenessProbe, stored_listing_url  # noqa: E402

BASE = "https://ialqarawi.com"
SOURCE = "Ibrahim Alqarawi"
PLATFORM = "ialqarawi"
PREFIX = "QRW"

# The site's own nav names the deal for each `type`; investment is left unmapped on purpose.
DEAL_FOR_TYPE = {1: "Buy", 2: "Rent"}
DEAL_WORDS = {"Buy": ("للبيع", "لبيع", "للببع", "للبيغ"), "Rent": ("للإيجار", "للايجار", "لليجار",
                                                                  "للإجار", "للايجا")}

# The 22 category labels, verbatim from the nav. `map_type_exact`'s documented per-platform
# overrides: exact-match only, so none of these can leak into any other input. Plural labels that
# the shared map cannot know; the canonical values are the shared map's own (قصر→Villa is the
# owner's 2026-07 Palace decision, أرض زراعية→Farm its 2026-07-16 one).
CATEGORY_TYPES = {
    "قصور": "Villa", "دبلوكسات": "Duplex", "مستودعات": "Warehouse", "ورش": "Workshop",
    "أدوار": "Floor", "عمائر": "Building", "أبراج": "Commercial Building", "فلل": "Villa",
    "اراضي سكنية": "Residential Land", "أراضي تجارية": "Commercial Land",
    "أراضي خام": "Residential Land",   # bare «أرض» is Residential Land in the shared map; the
                                        # title refines it when it states تجاري/زراعي (below)
    "شاليهات واستراحات": "Chalet",      # two types in one bucket — the title picks which
    "مزارع": "Farm", "شقق": "Apartment", "أراضي زراعية": "Farm", "محلات": "Shop",
    "صالات": "Hall", "حوش": "Villa", "معرض": "Showroom",
    # «بلك» / «بلك تجاري» / «محطات» are deliberately ABSENT: measured, they are mixed containers,
    # not types. The title decides, or the listing is skipped.
}
CATEGORY_IDS = {11: "قصور", 14: "دبلوكسات", 18: "مستودعات", 19: "ورش", 20: "أدوار", 34: "عمائر",
                39: "أبراج", 45: "فلل", 46: "اراضي سكنية", 47: "أراضي تجارية", 48: "أراضي خام",
                50: "شاليهات واستراحات", 51: "مزارع", 52: "شقق", 53: "أراضي زراعية", 54: "محلات",
                55: "صالات", 56: "حوش", 57: "محطات", 59: "بلك", 60: "بلك تجاري", 61: "معرض"}

_DWELLING = {"Apartment", "Villa", "Duplex", "Floor", "Room", "Studio", "Chalet", "Rest House"}

# ٠-٩ are real digits, and ٫ is the Arabic decimal mark (rule: Arabic notation parity in every
# deterministic parser).
_AR_NUM = str.maketrans("٠١٢٣٤٥٦٧٨٩٫٬", "0123456789..")

_FIELD_RE = re.compile(
    r'<dd class="col-sm-3"><strong>([^<]+)</strong></dd>\s*<dd class="col-sm-9[^"]*">(.*?)</dd>',
    re.S)
_CARD_RE = re.compile(
    r'<h5 class="card-title[^"]*">\s*<a href="(index\.php\?router=card&(?:amp;)?id=(\d+)'
    r'&(?:amp;)?catid=(\d+))"[^>]*>(.*?)</a>', re.S)
_BIG_IMG_RE = re.compile(r'data-rsBigImg="([^"]+)"')
# «مزاد» only as a whole Arabic word — «حي المزادة» is a real عنيزة district.
# «المزاد», «بالمزاد», «مزادات» are auctions too; only the ة/ه ending is the district «حي المزادة».
_AUCTION_RE = re.compile(r"مزاد(?![ةه])")
_SOLD_RE = re.compile(r"تم\s+(?:البيع|بيع|الإيجار|الايجار|التأجير)|مبا[عة]\b")
_TOK_SPLIT = re.compile(r"[\s/،,\-–—_()\[\]:؛]+")
# Words that are never the city itself, only its label. The directional/age/position ADJECTIVE
# class (شرقية/جديدة/عليا/...) that caused the 2026-09-25 Makkah/Khobar bug now lives in the
# SHARED, fleet-wide arabic_location.AMBIGUOUS_STANDALONE_WORDS instead of a local copy here — see
# that module for the full reasoning and the SQL backstop that keeps it honest across every
# platform, not just this one. This set keeps only the STRUCTURAL noise words specific to how this
# file's token-window scan works (labels, prepositions, deal words) — never place names at all.
_CITY_STOP = {"مدينه", "محافظه", "منطقه", "مركز", "حي", "مخطط", "شارع", "طريق", "شمال", "جنوب",
              "شرق", "غرب", "وسط", "ال", "على", "في", "قريب", "بجوار", "امام", "طريقه",
              "للبيع", "لبيع", "للايجار", "للاستثمار", "لاستثمار", "ارض", "اراضي", "فيلا", "شقه"}
_PLACEHOLDER = {"", "-", "--", "لا يوجد", "لايوجد", "غير متوفر", "غيرمتوفر", "غير محدد", "لا شيء",
                "لا يوجد سعر", "على السوم", "علي السوم", "ع السوم", "عالسوم", "السوم", "على السوم.",
                "جاري", "قريبا", "لا"}
# SINGULAR per-unit qualifiers: the figure belongs to ONE of several things the ad lists, so it is
# not this listing's total. The DUAL/collective forms («للقطعتين», «للصالتين», «للجميع»,
# «الاجمالي», «بالكامل») are the opposite — they mark the total — and are deliberately absent.
# «لكل» is ambiguous in this office's writing («لكل قطعة» = each, «لكل القطعتين» = for both), so it
# always abstains: never publish a per-unit figure as a total.
_PER_UNIT = ("لكل", "للفتحه", "للفتحة", "للقطعه", "للقطعة", "للوحده", "للوحدة", "للمحل", "للشقه",
             "للشقة", "للدور", "الواحده", "الواحدة", "للمستودع", "للعماره", "للعلوي", "للسفلي",
             "لصالة", "لصاله", "للارض", "لكل ارض")
_RANGE_WORDS = ("تبدا", "تبداء", "يبدا", "الى", "إلى", "حتى", "وحتى")
_NUM_RE = re.compile(r"\d+(?:[.,]\d+)*")
# «سعر المتر» in all the shapes this office writes it. A per-metre rate is NEVER a total; it lands
# in price_per_meter, and the total is ppm × area only when the SOURCE supplied both factors
# (owner rule 2026-09-03).
_PPM_RE = re.compile(r"للمتر|حد\s*المتر|سعر\s*المتر|لي\s*للمتر|/\s*م(?:2|²)?\b")
_MILLION_RE = re.compile(r"ملي(ون|ار)(ين|ان)?")
_THOUSAND_RE = re.compile(r"[أا]لف|ألف|الاف|آلاف")
# Word numerals are real numbers (Arabic-notation parity). Only the unambiguous multipliers of
# مليون are listed; a word numeral in the SECOND term («مليون وخمسمائه») has no stated unit and
# abstains instead.
_WORD_COUNT = {"واحد": 1, "اثنين": 2, "اثنان": 2, "ثلاثة": 3, "ثلاث": 3,
               "ثلاثه": 3, "اربعة": 4, "اربع": 4, "اربعه": 4, "خمسة": 5, "خمس": 5, "خمسه": 5,
               "ستة": 6, "ست": 6, "سته": 6, "سبعة": 7, "سبع": 7, "سبعه": 7, "ثمانية": 8,
               "ثمانيه": 8, "تسعة": 9, "تسعه": 9, "عشرة": 10, "عشره": 10}
_WORD_FRACTION_RE = re.compile(r"نصف|ربع|ثلث|مايه|مائه|مائة|مئه|متين|مئتين|ثمانمايه|خمسمائه|"
                              r"وأربع|واربع|وخمس|وثلاث|وست|وسبع|وثمان|وتسع")


def session() -> cc.Session:
    """A fingerprint this host serves, negotiated once (impersonate OWNS the User-Agent).

    2026-09-23: the site began answering pinned chrome fingerprints with an identical 75,193-byte
    «403 - Forbidden» while serving safari/firefox/edge and the newest chrome from the same IP. Two
    daily runs died at "index returned no cards" — which reads exactly like a dead site. The probe
    below is the catalogue page the run needs anyway, so a profile is only accepted when it answers
    with real cards.
    """
    return http.negotiated_session(
        f"{BASE}/index.php?router=cards&catid={sorted(CATEGORY_IDS)[0]}&type=1",
        headers={"Accept-Language": "ar,en;q=0.7"},
        served=lambda r: r.status_code == 200 and '<section class="cards' in r.text)


def _clean(raw: Optional[str]) -> str:
    """Strip tags/entities/bidi marks out of one table cell."""
    if not raw:
        return ""
    txt = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    return re.sub(r"\s+", " ", txt.replace("‎", "").replace("‏", "")).strip()


def _is_blank(v: Optional[str]) -> bool:
    return not v or v.strip() in _PLACEHOLDER


def _digits(s: str) -> str:
    return s.translate(_AR_NUM)


def _strip_units(s: str) -> str:
    """«30م2» / «991م²» — the squared marker is a UNIT, not a second number. Left in, it makes
    `_one_number` see two numbers and silently NULL the area on every «م2» listing."""
    return re.sub(r"م\s*[2²٢]", "م", _digits(s))


def _one_number(text: str) -> Optional[str]:
    """The single numeric token in `text`, or None when there are none or several.

    Several numbers in a price/area cell means a range or a per-unit breakdown — either way the
    listing's own figure is not stated, so nothing is written (never the first one, never a sum).
    """
    found = _NUM_RE.findall(_strip_units(text))
    uniq = {f.rstrip(".,") for f in found}
    return found[0].rstrip(".,") if len(uniq) == 1 else None


def _to_amount(tok: str) -> tuple[Optional[int], bool]:
    """Read one numeric token. Returns (value, grouped) where `grouped` means the token used
    thousands separators — «60.000» is 60000, «517.5» is 517.5 → 517."""
    if re.fullmatch(r"\d+(?:[.,]\d{3})+", tok):
        return int(re.sub(r"[.,]", "", tok)), True
    if re.fullmatch(r"\d+(?:[.,]\d{1,2})?", tok):
        return int(float(tok.replace(",", "."))), False
    return None, False


def parse_money(raw: Optional[str]) -> tuple[Optional[int], Optional[int], str]:
    """One labelled price cell → (total_riyals, price_per_meter, skip_reason).

    PRICE = SOURCE: the digits are copied. The only arithmetic is a multiplier the office itself
    WROTE («الف», «مليون») and the owner-sanctioned ppm × area. Written against the COMPLETE
    measured vocabulary of both price cells across all 2,641 listings (353 distinct non-plain
    strings), not against a guess at what the field might contain.
    """
    txt = _clean(raw)
    if _is_blank(txt):
        return None, None, ""            # «لا يوجد» / «على السوم»: the office states no figure
    low = _strip_units(txt)
    if any(w in txt for w in _PER_UNIT):
        return None, None, "per_unit"
    if any(w in txt for w in _RANGE_WORDS) and len(_NUM_RE.findall(low)) > 1:
        return None, None, "range"

    if _PPM_RE.search(txt) and _NUM_RE.search(low):
        tok = _one_number(txt)
        if not tok:
            return None, None, "ppm_multiple_numbers"
        ppm, grouped = _to_amount(tok)
        if ppm is None:
            return None, None, "unparseable"
        if _THOUSAND_RE.search(txt) and ppm < 1000 and not grouped:
            ppm *= 1000
        # A rate of a few riyals per metre is a unit this file cannot name (it could be «1 [ألف]
        # حد المتر», QRW2135 — the one live hit of 2,616 on 2026-09-21), so it abstains rather
        # than multiplying a guess by the area. There is NO upper bound: a large figure in a cell
        # the office labelled per-metre is still the office's per-metre figure (owner rule: no
        # plausibility gate on a source-published price; 0 live rows exceed 200,000 today).
        if ppm < 10:
            return None, None, "ppm_unit_unstated"
        return None, ppm, ""

    if _MILLION_RE.search(low):
        # BEFORE the no-digits guard: «مليون», «مليونين», «ثلاثة مليون» state an amount in words.
        return _parse_million(txt, low)
    if not _NUM_RE.search(low):
        return None, None, ""            # «تحت السوم», «ماسيمت» — prose, not a suppressed price

    tok = _one_number(txt)
    if not tok:
        return None, None, "multiple_numbers"
    val, grouped = _to_amount(tok)
    if val is None:
        return None, None, "unparseable"
    if _THOUSAND_RE.search(txt) and not grouped:
        if val < 1000:
            val *= 1000                  # «850 الف» = 850,000 — «الف» IS the unit
        elif val < 10_000:
            val *= 1000                  # «9300 الف» read as written: 9,300 thousand
        # ≥ 10,000 («75000 الف الاجمالي», «220000 الف»): «الف» is the office writing the unit
        # twice; the digits already are the riyals. Multiplying here would be a 1000× card error.
    # A small bare figure («900», «1000» on 10,542 m²) is stored exactly as the page shows it. Owner
    # rule 2026-08-03: no plausibility floor on a source-published price, at any magnitude.
    return val, None, ""


def _parse_million(txt: str, low: str) -> tuple[Optional[int], Optional[int], str]:
    """«مليون», «مليونين», «14 مليون», «مليون و500 الف», «1.350.000 مليون» → riyals.

    The families and their traps, all measured on this source:
      «مليون و500 الف»      → 1,500,000   (naive «one number × 1e6» made this 500,000,000)
      «مليون 280 الف»       → 1,280,000   (the «و» is often missing)
      «مليونين و500 ألف»    → 2,500,000   (dual = two million)
      «ثلاثة مليون»         → 3,000,000   (word numeral)
      «1.350.000 مليون»     → 1,350,000   (a GROUPED number makes «مليون» a redundant word)
      «مليون و100»          → abstain     (the second term's unit is unstated: 100 thousand? 100?)
      «مليون وخمسمائه»      → abstain     (word numeral with no stated unit)
    """
    if _WORD_FRACTION_RE.search(txt):
        return None, None, "million_word_fraction"
    m = _MILLION_RE.search(low)
    head, tail = low[:m.start()], low[m.end():]
    head_nums = _NUM_RE.findall(head)
    if len(head_nums) > 1:
        return None, None, "million_multiple_numbers"
    if head_nums:
        hv, grouped = _to_amount(head_nums[0].rstrip(".,"))
        if hv is None:
            return None, None, "unparseable"
        if grouped or hv >= 1000:
            # «1.000.000 مليون» / «1.350.000 مليون صافي»: the digits already are the full figure.
            return (hv, None, "") if not _NUM_RE.search(tail) else (None, None,
                                                                    "million_multiple_numbers")
        count = hv
    else:
        word = next((w for w in _WORD_COUNT if w in head), None)
        count = _WORD_COUNT.get(word or "", 1)
        if m.group(2):                   # «مليونين» / «مليونان» — the dual IS two
            count = 2
    base = count * (1_000_000_000 if m.group(1) == "ار" else 1_000_000)
    tail_nums = _NUM_RE.findall(tail)
    if not tail_nums:
        return base, None, ""
    if len(tail_nums) > 1:
        return None, None, "million_multiple_numbers"
    tv, tgrouped = _to_amount(tail_nums[0].rstrip(".,"))
    if tv is None:
        return None, None, "unparseable"
    if _THOUSAND_RE.search(tail) and tv < 1000 and not tgrouped:
        return base + tv * 1000, None, ""
    if tgrouped or tv >= 1000:
        return base + tv, None, ""
    return None, None, "million_second_term_unit_unstated"


# An AREA is not a price, and this is the one place the two grammars must part company.
# `_to_amount` reads «X.YYY» as thousands-GROUPED, which is right for this office's price cells
# («3850.000» is 3,850,000 — measured). Applied to an area it silently multiplies by 1000 the one
# shape a surveyed land area actually takes: metre² to the mm², «361788.431م». Listing QRW3566
# (أرض زراعية شمال عنيزة) was served at 361,788,431 m² — 362 km², larger than the governorate —
# because of exactly this, while its own source string says 361788.431 and its own description
# gives frontages of 316.64 m / 245.70 m / 698.97 m / 504 m.
#
# A head of 1-3 digits is canonical grouping; a 4-digit head is this office's «1500.000» = «1500
# thousand» shorthand. Both are unambiguous and stay. At 5+ digits the token reads equally well as
# a plain decimal, the two readings differ by 1000x, and NOTHING in the stored capture can settle
# it (ialqarawi rows carry an auto.v1-fallback source_capture with no raw HTML). So the parser
# ABSTAINS: honest NULL beats a guess, and area_raw keeps the exact string for a future probe.
# Measured over the complete vocabulary — all 2,568 ialqarawi rows, 150 separator strings: heads of
# 1-4 digits are 149 correct rows, and a 5+ digit head has exactly one instance, the defect above.
# parse_money is deliberately NOT touched: a price is never written to three decimals.
_AMBIGUOUS_SEPARATOR_RE = re.compile(r"\d{5,}[.,]\d{3}")


def parse_area(raw: Optional[str]) -> tuple[Optional[int], str]:
    """«526م» / «600 م الاجمالي» / «25.000» → m². A per-unit or range area is not the listing's."""
    txt = _clean(raw)
    if _is_blank(txt):
        return None, ""
    if any(w in txt for w in _PER_UNIT):
        return None, "per_unit"
    tok = _one_number(txt)
    if not tok:
        return None, "multiple_numbers" if _NUM_RE.search(_strip_units(txt)) else "no_digits"
    if _AMBIGUOUS_SEPARATOR_RE.fullmatch(tok):
        return None, "ambiguous_thousands_or_decimal"
    val, _ = _to_amount(tok)
    if val is None or val <= 0:
        return None, "unparseable"
    # area_m2 is int4 — «517.5م» truncates to 517 and the exact string stays in
    # additional_info.area_raw, which is where a fractional metre survives.
    return val, ""


# «3 غرف نوم», «غرفتين نوم», «2دورات مياه» — the layout idiom this office actually types. The
# bedroom word must be ADJACENT to «نوم»: «غرفة حارس» (a warehouse's guard room) is not a bedroom,
# and a vague adjective never becomes a count.
_BEDS_RE = re.compile(r"(\d{1,2})\s*غرف(?:ة|ه)?\s*(?:ال)?نوم|غرفت(?:ين|ان)\s*(?:ال)?نوم")
_BATHS_RE = re.compile(r"(\d{1,2})\s*دور(?:ات|تين|ة|ه|اة|ه)?\s*(?:ال)?مياه?|دورت(?:ين|ان)\s*"
                       r"(?:ال)?مياه?")
_STREET_RE = re.compile(r"شارع\s*(?:عرض|بعرض)\s*(\d+(?:[.,]\d+)?)")


def rooms_from_prose(text: Optional[str]) -> dict[str, Any]:
    """Explicit room counts stated in «تفاصيل العقار». Silence stays silent (no key at all)."""
    t = _digits(_clean(text))
    out: dict[str, Any] = {}
    m = _BEDS_RE.search(t)
    if m:
        n = 2 if m.group(1) is None else int(m.group(1))
        if 1 <= n <= 20:
            out["bedrooms"] = n
    m = _BATHS_RE.search(t)
    if m:
        n = 2 if m.group(1) is None else int(m.group(1))
        if 1 <= n <= 20:
            out["bathrooms"] = n
    widths = {w for w in _STREET_RE.findall(t)}
    if len(widths) == 1:                      # two frontages of different widths → ambiguous
        w = float(widths.pop().replace(",", "."))
        # A fraction («13.5م») stays NULL: the smallint column would truncate it to 13.
        if 2 <= w <= 200 and w == int(w):
            out["street_width_m"] = int(w)
    return out


def city_from_title(title: str) -> tuple[Optional[str], Optional[int], Optional[int]]:
    """Ask the CATALOG which token of the title is a city, scanning right to left (Arabic titles
    put the city last, so «بحي بدر بمدينة الرياض» must not resolve to the town بدر). A region label
    («منطقة القصيم») only becomes a hint for the city scan — never the location itself."""
    toks = [t for t in _TOK_SPLIT.split(title or "") if t]
    hint: Optional[int] = None
    for i in range(len(toks) - 1, -1, -1):
        for size in (2, 1):
            if i + size > len(toks):
                continue
            cand = " ".join(toks[i:i + size])
            forms = [cand]
            if cand[:1] in "بل" and len(cand) > 2:
                forms.append(cand[1:])        # «بعنيزة» → «عنيزة», keeping the raw form too
            for form in forms:
                if normalize._norm_ar(form) in _CITY_STOP or is_ambiguous_standalone_word(form):
                    continue
                cid, rid = to_catalog(form, hint)
                if cid:
                    return form, cid, rid
                if rid and hint is None:
                    hint = rid                # a region label seen on the way: scope the scan
    return None, None, None


def _refine_type(property_type: Optional[str], cat_ar: str, title: str) -> Optional[str]:
    """Let the SOURCE's own words settle the buckets that hold more than one type."""
    t = title or ""
    if cat_ar == "أراضي خام":
        if "زراعي" in t:
            return "Farm"
        if ("تجاري" in t or "صناعي" in t) and "سكن" not in t:
            return "Commercial Land"
    if cat_ar == "شاليهات واستراحات":
        if "استراح" in t or "إستراح" in t:
            return "Rest House"
        if "شاليه" in t or "شالية" in t:
            return "Chalet"
    if property_type:
        return property_type
    # «بلك» / «بلك تجاري» / «محطات»: the category is a container, so the title's own type word is
    # the only stated type. map_type()'s substring pass uses SHARED keys only.
    return normalize.map_type(t)


def parse_detail(page_html: str) -> dict[str, Any]:
    """The detail page → its labelled fields + gallery. Returns {} for the homepage the site serves
    on an unknown id (HTTP 200, no fields) — an empty parse is a MISS, never an empty listing."""
    fields = {_clean(k): _clean(v) for k, v in _FIELD_RE.findall(page_html)}
    if "رقم العقار" not in fields:
        return {}
    title = _clean((re.findall(r"<h3[^>]*>(.*?)</h3>", page_html, re.S) or [""])[0])
    photos = list(dict.fromkeys(html.unescape(u) for u in _BIG_IMG_RE.findall(page_html)))
    return {"fields": fields, "title": title, "photos": photos}


def map_listing(card: dict, detail: dict) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason). `card` is {id, catid, type, title, url} from the index."""
    if not detail:
        return None, "residential", "detail_missing"
    f: dict[str, str] = detail["fields"]
    if _digits(f.get("رقم العقار", "")).strip() != str(card["id"]):
        return None, "residential", "id_mismatch"

    title = detail.get("title") or card["title"]
    desc = f.get("تفاصيل العقار") or ""
    blob = f"{title} {desc}"
    if _AUCTION_RE.search(blob):
        return None, "residential", "auction"
    if _SOLD_RE.search(blob):
        return None, "residential", "sold_or_rented"

    cat_ar = f.get("القسم") or CATEGORY_IDS.get(card["catid"], "")
    property_type = _refine_type(normalize.map_type_exact(cat_ar, overrides=CATEGORY_TYPES),
                                 cat_ar, title)
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    deal = DEAL_FOR_TYPE.get(card["type"])
    if not deal:
        return None, category, "deal_investment_not_buy_or_rent"
    # The index page's `type` and the title's own «للبيع»/«للإيجار» are BOTH the source. When they
    # contradict each other the deal is not known, and a wrong transaction_type puts a for-sale
    # property in rent results — so it skips rather than picking a winner.
    stated = {d for d, words in DEAL_WORDS.items() if any(w in title for w in words)}
    if stated and deal not in stated:
        return None, category, "deal_title_contradicts_index"

    city_raw, city_id, region_id = city_from_title(title)
    district_field = f.get("الحي") or ""
    if _is_blank(district_field):
        district_field = ""

    if not city_id:
        # The free-text title scan found NOTHING. Last resort, before quarantining: try the
        # source's own «الحي» field AS a city — it sometimes holds a city instead of a district
        # (measured: three عنيزة rentals carry «الحي: الدوادمي», 500km away). This branch runs
        # ONLY when the title itself resolved no city, so it can never override a correct
        # title-based answer — it only fills a blank that would otherwise be dropped. Found live
        # 2026-09-25: a «شاطئ نصف القمر» plot whose title has no recognisable city at all, whose
        # «الحي» field plainly says «الدمام» — a real catalog city, and the beach it names really
        # does sit in the Dammam/Khobar area.
        city_id, region_id = to_catalog(district_field) if district_field else (None, None)
        if not city_id:
            return None, category, "city_not_in_catalog"
        city_raw = district_field
        city_ar = city_raw
        # The field WAS the city here, not a district — never also read it as one below.
        field_is_a_city = True
        district_ar = find_district_in_text(title, city_id)
    else:
        # city_ar is the source's own Arabic text for the city — the very token to_catalog accepted.
        city_ar = city_raw
        # A «الحي» the catalog recognises as a CITY is not this listing's district (measured: three
        # عنيزة rentals carry «الحي: الدوادمي»).
        field_is_a_city = bool(district_field) and bool(to_catalog(district_field)[0])
        district_ar = ((find_district_in_text(district_field, city_id) if not field_is_a_city else None)
                       or find_district_in_text(title, city_id))

    area_m2, area_skip = parse_area(f.get("مساحة الأرض"))
    som, som_ppm, som_skip = parse_money(f.get("سعر السوم"))
    lim, lim_ppm, lim_skip = parse_money(f.get("سعر الحد"))
    # «سعر السوم» is the figure being asked/bid, «سعر الحد» the seller's floor — the السوم wins when
    # both are stated, and additional_info always records WHICH one the card is showing.
    price, price_basis = ((som, "سعر السوم") if som is not None
                          else (lim, "سعر الحد") if lim is not None else (None, None))
    ppm = som_ppm if som_ppm is not None else lim_ppm
    # ppm × area is NOT computed here: owner rule 2026-09-03 derives it in the search/display layer
    # only (price_total_effective, shown as ≈ and sale-only). price_total keeps meaning "the source
    # said this"; the rate goes to price_per_meter below.

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{card['id']}",
        "listing_url": f"{BASE}/{card['url']}",
        "source": SOURCE,
        "active": True,
        "title": title or None,
        "description": desc or None,
        # The only place this source states an amenity is the prose body. amenities_from_text keeps
        # the tri-state honest for us: «مؤثث» → True, «غير مؤثثة» → False, «مصعد مؤسس» → NULL,
        # «قريب من حديقة» (the neighbourhood's, not this unit's) → NULL, silence → no key at all.
        **normalize.amenities_from_text(desc),
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_raw),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": (None if field_is_a_city else district_field) or None,
        "area_m2": area_m2,
        "price_per_meter": ppm,
        "photo_urls": detail.get("photos", [])[:20] or None,
    }
    desc_d = _digits(desc or "")
    if (age := normalize.age_from_labelled_prose(desc_d)) is not None:
        row["property_age"] = age
    facades = re.findall(r"(?=واجه[ةه]\s+(\S+(?:\s+\S+)?))", desc_d)     # lookahead: overlapping
    if facades and (d := normalize.one_direction(" ".join(facades))):
        row["direction"] = d
    counts = rooms_from_prose(desc)
    if property_type not in _DWELLING:
        counts.pop("bedrooms", None)     # «غرفتين» in a warehouse ad is not a bedroom count
    row.update(counts)
    if not _is_blank(f.get("رقم القطعة")):
        row["plan_parcel"] = f["رقم القطعة"]
    if (views := normalize.to_int(f.get("عدد الزيارات"))) is not None:
        row["views_count"] = views
    if m := re.search(r"ترخيص\s*(?:ال)?[إا]?علان\s*[:：]?\s*(\d{6,})", _digits(desc)):
        row["license_number"] = m.group(1)

    if deal == "Rent":
        # PERIOD = SOURCE. «18.000 سنوي» states annual; «شهري» would be annualized; anything else
        # leaves rent_period NULL and the figure unscaled — a defaulted period is a 12× error.
        # Only the cell the price came FROM: «18.000» under السوم + «1500 شهري» under الحد is not a
        # monthly 18,000. «بالسنة»/«بالشهر» fold to the shared helper's tokens.
        own_cell = f.get(price_basis) or "" if price_basis else ""
        own_cell = re.sub(r"بالسن[ةه]", "سنوي", own_cell).replace("بالشهر", "شهري")
        period, row["price_annual"] = normalize.rent_period_and_annual(price, own_cell)
        if period:
            row["rent_period"] = period
    else:
        row["price_total"] = price
    row["additional_info"] = {k: v for k, v in {
        "property_number": f.get("رقم العقار"),
        "category_ar": cat_ar,
        "catid": card["catid"],
        "source_deal_type": card["type"],
        "building_surface_raw": None if _is_blank(f.get("مسطح البناء")) else f.get("مسطح البناء"),
        "board_number": None if _is_blank(f.get("رقم اللوحة")) else f.get("رقم اللوحة"),
        "som_price_raw": f.get("سعر السوم") or None,
        "limit_price_raw": f.get("سعر الحد") or None,
        "price_basis": price_basis,
        "price_skip_reason": ";".join(x for x in (som_skip and f"som:{som_skip}",
                                                  lim_skip and f"limit:{lim_skip}") if x) or None,
        "area_skip_reason": area_skip or None,
        "area_raw": f.get("مساحة الأرض") or None,
        "district_field_raw": district_field if field_is_a_city else None,
        "added_ago_raw": None if _is_blank(f.get("مضاف منذ")) else f.get("مضاف منذ"),
    }.items() if v is not None}
    return row, category, ""


def fetch_index(s: cc.Session, deal_types=(1, 2, 3), limit: int = 0,
                outcomes: Optional[dict] = None) -> list[dict]:
    """Every card of every category — 66 pages, no pagination parameter exists. Only the
    `<section class="cards">` block counts; the nav/footer carry other listings' links.

    `outcomes` is filled in with one tally per index request — `http_<code>`, `transport_<Error>`,
    or `ok_cards` / `ok_no_cards` — and it is not an optional nicety. Until 2026-09-23 a non-200
    was `continue`d and the status DISCARDED, so 66 requests that were all BLOCKED produced the
    same run note as 66 that returned HTTP 200 with markup we no longer parse:

        "index returned no cards in <section class=\"cards\"> — blocked or the markup changed"

    That sentence names two causes with opposite fixes and cannot say which. It sat on a P0 for
    two days (2026-09-22 and 2026-09-23, both at the 04:24 cron slot, each failing in 3-4 seconds)
    and two separate engineer runs each had to spend a CI dispatch to answer a question the run
    should have answered itself. This is the repo's own rule — a failed fetch is not an empty
    answer — in the DIAGNOSTIC layer: a transport failure rendered as an ambiguous verdict.

    A transport exception is caught and tallied for the same reason: raising out of the first
    blip used to abort the sweep with a traceback and no tally at all, which reads as a crash
    rather than as the block it usually is.
    """
    tally = outcomes if outcomes is not None else {}
    seen: dict[str, dict] = {}
    for ty in deal_types:
        for catid in CATEGORY_IDS:
            try:
                r = s.get(f"{BASE}/index.php?router=cards&catid={catid}&type={ty}", timeout=60)
            except Exception as e:                      # noqa: BLE001 — tally, never swallow
                tally[f"transport_{type(e).__name__}"] = tally.get(
                    f"transport_{type(e).__name__}", 0) + 1
                continue
            if r.status_code != 200:
                tally[f"http_{r.status_code}"] = tally.get(f"http_{r.status_code}", 0) + 1
                continue
            body = r.text.split('<section class="cards', 1)[-1].split("</section>", 1)[0]
            found = _CARD_RE.findall(body)
            key = "ok_cards" if found else "ok_no_cards"
            tally[key] = tally.get(key, 0) + 1
            for url, lid, cid, title in found:
                seen.setdefault(lid, {"id": lid, "catid": int(cid), "type": ty,
                                      "title": html.unescape(re.sub(r"\s+", " ", _clean(title))),
                                      "url": html.unescape(url)})
            if limit and len(seen) >= limit:
                return list(seen.values())[:limit]
    return list(seen.values())


def index_failure_note(outcomes: dict) -> str:
    """Turn the per-request tally into the one sentence an engineer needs at 04:24.

    The two causes are DISTINGUISHABLE and the tally distinguishes them: if no request reached
    HTTP 200 the site refused us, and the markup is not in question at all; if requests DID
    return 200 and carried no cards, the markup is the suspect. Anything else is mixed and says
    so rather than picking.
    """
    if not outcomes:
        return "index made no requests at all — the category list is empty (a code fault, not the source)"
    detail = ", ".join(f"{k}={v}" for k, v in sorted(outcomes.items(), key=lambda kv: -kv[1]))
    ok = outcomes.get("ok_cards", 0) + outcomes.get("ok_no_cards", 0)
    lost = sum(v for k, v in outcomes.items() if k.startswith(("http_", "transport_")))
    if ok == 0:
        return (f"index BLOCKED — not one of {sum(outcomes.values())} requests reached HTTP 200 "
                f"[{detail}]. The markup is NOT implicated; re-measure from CI egress before "
                f"touching the parser (LISTING_LIVENESS 9.4: a block is a fact about the network "
                f"that observed it)")
    # MARKUP CHANGED requires that NOTHING was lost. `ok_no_cards == ok` is true of a half-blocked
    # sweep too (33 x 403 beside 33 x 200-with-no-cards), and the first draft of this function
    # confidently called that a parser fix — the exact over-claim this whole change exists to stop,
    # reintroduced one line below the paragraph condemning it. Its own barrier caught it.
    if lost == 0 and outcomes.get("ok_no_cards", 0) == ok:
        return (f"index MARKUP CHANGED — all {ok} request(s) returned HTTP 200 and not one "
                f"carried a card in <section class=\"cards\"> [{detail}]. This is a parser fix, "
                f"not a block")
    return (f"index returned no cards from a MIXED sweep [{detail}] — adjudicate before assuming "
            f"either cause")


def fetch_detail(s: cc.Session, card: dict) -> dict:
    r = s.get(f"{BASE}/{card['url']}", timeout=60)
    if r.status_code != 200:
        return {}
    return parse_detail(r.text)


def crawl(limit: int = 0, workers: int = 8) -> tuple[list[dict], list[dict], int, dict]:
    s = session()
    outcomes: dict[str, int] = {}
    cards = fetch_index(s, limit=limit, outcomes=outcomes)
    if not cards:
        raise RuntimeError(index_failure_note(outcomes))
    # A sweep that lost requests captured an UNPROVABLE catalogue, so say so on the run row even
    # when it succeeds. Deliberately NOT an abort: prune_unseen here is oracle-gated
    # (_make_verify_gone, CANDIDATE_PLUS_DIRECT), so a short list cannot falsely kill anything,
    # and there is no measurement yet of how often one of the 66 pages blips. Making a 1-of-66
    # failure fatal is a real availability change and wants that measurement first — this line is
    # what will produce it.
    lost = {k: v for k, v in outcomes.items() if k.startswith(("http_", "transport_"))}
    if lost:
        print(f"⚠ index sweep incomplete: {index_failure_note(outcomes)}", flush=True)
    print(f"{SOURCE}: {len(cards)} listings discovered across {len(CATEGORY_IDS)} categories",
          flush=True)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}

    local = threading.local()      # curl_cffi sessions are not thread-safe; one per worker thread

    def one(card: dict) -> tuple[Optional[dict], str, str]:
        try:
            if not getattr(local, "s", None):
                local.s = session()
            return map_listing(card, fetch_detail(local.s, card))
        except Exception as e:                      # one bad page must not kill the crawl
            return None, "residential", f"fetch_error:{type(e).__name__}"

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for row, cat, why in pool.map(one, cards):
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            # map_listing returns a row only after this listing's own page parsed AND its
            # «رقم العقار» matched the requested id, i.e. a direct, identity-checked read.
            db.mark_direct_alive(row, oracle="ialqarawi.detail_page.raqm_alaqar")
            (com if cat == "commercial" else res).append(row)
    # A per-page `except` keeps one bad page from killing a 2,641-page crawl, but it must not turn a
    # SYSTEMIC failure into a quiet empty run: a missing catalog key raises KeyError on every single
    # listing, and 2,641 swallowed KeyErrors read exactly like a source with nothing in it.
    errors = sum(v for k, v in skipped.items() if k.startswith("fetch_error"))
    if errors >= 3 and errors * 4 > len(cards):
        raise RuntimeError(f"{errors}/{len(cards)} listings failed the same way — "
                           f"{', '.join(k for k in skipped if k.startswith('fetch_error'))}")
    # Carry the lost index requests onto the run row too. stdout is discarded once the CI job ages
    # out; scrape_runs.notes is what the next engineer actually reads.
    for k, v in lost.items():
        skipped[f"index_{k}"] = skipped.get(f"index_{k}", 0) + v
    return res, com, len(cards), skipped


# ── LIVENESS ────────────────────────────────────────────────────────────────────────────────────
# Absence from the 66 index pages only SELECTS candidates; prune_unseen asks this oracle before it
# may deactivate anything, through the shared law (scrapers/common/http_liveness.py), so a
# 403/429/5xx, a timeout or an empty body can never read as a death. That matters here: fetch_index
# SKIPS a category page that does not answer 200, so a single refused page silently drops a whole
# category (catid 46 alone is 946 cards) from `seen`.
#
# THIS SOURCE DOES NOT 404. MEASURED 2026-09-21 with the full 2,641-card index in hand: 1,132 ids
# inside the live range (21-3793) are not in the catalogue, and 21 of 21 sampled (plus 99999999)
# answered HTTP 200 with THE HOMEPAGE — byte-for-byte the size of `/` (134,957), carrying its
# `myCarousel` slider and no «رقم العقار» field. A wider draw of 120 off-index ids found the second
# retirement shape: 111 homepage, and 9 still serving their own page with «القسم» EMPTY — the office
# takes a listing out of every category rather than deleting it, so no index can reach it again.
# 60 of 60 indexed live listings carry «القسم»; 12 of 12 interleaved live ids answered 200 with a
# «رقم العقار» equal to the requested id. So: the homepage on this listing's own URL is GONE; its
# own page with no category is GONE (without that limb the probe would self-heal a delisted row
# forever, since the crawl can never see it again); the page proving this id WITH a category is
# LIVE — unless the crawl's own _AUCTION_RE/_SOLD_RE fire on its own title or «تفاصيل العقار», a
# closed deal the crawl refuses to publish. Anything else — a page that is neither, a challenge, a
# 500 (the site answers 500 when catid is missing) — has no opinion.
# Because the death here is a 200, every removal is also gated by an in-run POSITIVE CONTROL (a row
# this same run mapped must still be served as itself), and it fails CLOSED: no control, no removal.
_HOMEPAGE_MARK = 'id="myCarousel"'


def _signal_for(lid: str):
    def _signal(status, body, _moved):
        if status != 200:
            return None
        d = parse_detail(body)
        if not d:
            return "gone" if _HOMEPAGE_MARK in body else None
        if _digits(d["fields"].get("رقم العقار", "")).strip() != lid:
            return None
        if not d["fields"].get("القسم"):
            return "gone"
        own = f"{d.get('title') or ''} {d['fields'].get('تفاصيل العقار') or ''}"
        return "gone" if (_AUCTION_RE.search(own) or _SOLD_RE.search(own)) else "live"
    return _signal


def _make_verify_gone(control: Optional[dict]):
    url_for = stored_listing_url(("ialqarawi_residential_listings", "ialqarawi_commercial_listings"))

    def probe(ad_number: str, url_for=url_for, canary=None) -> tuple[str, str]:
        lid = ad_number[len(PREFIX):]
        if not lid.isdigit():
            return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
        return LivenessProbe(platform=PLATFORM, signal=_signal_for(lid), session=session,
                             url_for=url_for, canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = probe(control["ad_number"], url_for=lambda _ad: control["listing_url"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    dry = args.dry_run
    run_id = None if (dry or args.limit) else db.begin_run(PLATFORM)
    seen = 0
    try:
        res, com, seen, skipped = crawl(limit=args.limit)
        if args.type != "all":
            res, com = ([] if args.type == "commercial" else res,
                        com if args.type == "commercial" else [])
        notes = "skipped: " + (", ".join(f"{k}x{v}" for k, v in
                                         sorted(skipped.items(), key=lambda x: -x[1])) or "none")
        print(f"  {notes}", flush=True)
        if dry:
            print(json.dumps(res + com, ensure_ascii=False, indent=1))
            print(f"— DRY RUN (nothing written): {len(res)} residential + {len(com)} commercial",
                  file=sys.stderr)
            return 0
        db.upsert_ialqarawi_residential_batch(res)
        db.upsert_ialqarawi_commercial_batch(com)
        if args.limit:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} res + {len(com)} com upserted (no prune)")
            return 0
        superseded = db.retire_superseded_siblings(
            res_table="ialqarawi_residential_listings", com_table="ialqarawi_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
        for tbl, rows in (("ialqarawi_residential_listings", res),
                          ("ialqarawi_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                verify_gone=verify_gone)
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped — kept existing active rows")
            else:
                pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} {notes}"[:300],
                             check_tables=["ialqarawi_residential_listings",
                                           "ialqarawi_commercial_listings"])
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted, "
              f"{pruned} stale pruned")
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
