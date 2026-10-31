"""عقارات السعودية / KSA Aqar — ksaaqar.com (WordPress, custom `ad_post` type).

SOURCE SHAPE (probed live 2026-09-19, before a line of this was written):
  · /wp-json/wp/v2/ad_post returns the catalogue as JSON — X-WP-Total 1809. Paginated 100/page.
  · The REST record carries NO meta and NO taxonomy arrays. `class_list` holds raw term IDs
    (ad_cats-1100, ad_country-1073, ad_condition-1351, ad_type-1082) and this site exposes NO
    taxonomy endpoint that resolves them (only category/post_tag/nav_menu/product_* exist), so the
    ids are kept for audit and are never the source of a stored value.
  · Everything structured is rendered into the DETAIL PAGE as a labelled spec block. Measured
    across 30 real listings:
        الحالة 29/30 · النوع 28/30 · عدد الغرف 26/30 · عدد الصالات 26/30 · دورة المياه 26/30
        عدد الأدوار 26/30 · عرض الشارع 22/30 · التأثيث 22/30 · عمر العقار 20/30 · التكييف 19/30
        واجهة العقار 17/30 · نوع العقار 17/30 · رقم رخصة فال 16/30 · المساحة 10/30
    Every one of those is read below. Bathrooms («دورة المياه») are captured from the first
    version of this file — the عقاريون launch shipped with 0% bathroom coverage because the parser
    was written before anyone counted what the source actually published.

PRICE IS THE SOURCE'S OWN FIGURE, AND «0.00» IS NOT A PRICE. The page renders
«50,000.00SAR (قابل للتفاوض)». Some listings render «0.00SAR» — that is the theme printing an
absent value, not a free property, so it is stored NULL. A zero price would otherwise sort to the
top of every cheapest-first search (PRICE = SOURCE: never invent, and never dress an absence as a
number).

STREET WIDTH IS «عرض الشارع», AND ONLY THAT. It is often written in Arabic-Indic digits
(«عرض الشارع : ١٥»). This scraper reads the labelled field and nothing else — the عقاريون launch
stored the site's own ad-FORM default («الشارع 3») as 272 properties' street width because the
parser fell back to a bare «شارع N» match anywhere on the page. Page chrome is not the listing.

RENTAL PERIOD = SOURCE. «النوع: للإيجار» states the deal but never the period; the period is only
taken from the listing's own words via normalize.rent_period_and_annual(). No token → NULL, never
a defaulted 'annual' (a monthly figure stored as yearly is a 12x error on the card).
"""
from __future__ import annotations

import argparse
from decimal import Decimal, InvalidOperation
import hashlib
import html as ihtml
import os
import re
import sys
from pathlib import Path
from urllib.parse import unquote
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize, sold_pin  # noqa: E402
from scrapers.common.arabic_location import (  # noqa: E402
    find_district_in_text, known_district_keys, title_hayy_district, to_catalog,
)
from scrapers.common.http_liveness import LivenessProbe, stored_listing_url  # noqa: E402
from scrapers.common.source_pin import pin_dict  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://ksaaqar.com"
REST = f"{BASE}/wp-json/wp/v2"
SOURCE = "KSA Aqar"
PREFIX = "KSA"

_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({"Accept": "application/json,text/html;q=0.9",
                      "Accept-Language": "ar,en-US;q=0.7,en;q=0.6"})
    purl = os.environ.get("WASALT_PROXY_URL", "").strip()
    if purl:
        s.proxies = {"http": purl, "https": purl}
    return s


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", ihtml.unescape(s or ""))).strip()


def _txt(h: str) -> str:
    b = re.sub(r"<(script|style|nav|header|footer).*?</\1>", " ", h, flags=re.S)
    return re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", b))).strip()


def _classes(p: dict, prefix: str) -> list[str]:
    return [c[len(prefix):] for c in (p.get("class_list") or []) if c.startswith(prefix)]


# ── the spec block ───────────────────────────────────────────────────────────────────────────────
# Every label the source prints, so a value can be captured up to the NEXT label and never bleed
# into it. An unanchored capture is how «رسالة على واتساب النوع» and «مؤجرة رقم رخصة فال» appeared
# as field names in the first probe — that is two labels read as one, not a new field.
_LABELS = [
    "رقم رخصة فال", "عدد الغرف", "عدد الصالات", "دورة المياه", "دورات المياه", "عدد الأدوار",
    "عرض الشارع", "واجهة العقار", "عمر العقار", "نوع العقار", "التأثيث", "التكييف", "الحالة",
    "النوع", "المساحة", "الموقع", "الوصف", "السعر", "الحي", "المدينة", "رقم القطعة", "الواجهة",
    # «حدود وأطوال العقار : 100» sits between «عمر العقار» and «نوع العقار». Missing it let the age
    # value run past its own field and pick up that 100: two live listings whose own text says
    # «سنتين» (2) and «سنة» (1) were stored as 100-year-old properties. A label absent from this
    # list is not a harmless omission — it is the next field's value leaking into this one.
    "حدود وأطوال العقار", "حدود العقار", "أطوال العقار", "المزايا", "الخدمات",
]
_STOP = "|".join(re.escape(x) for x in sorted(_LABELS, key=len, reverse=True))


def spec(text: str, label: str) -> Optional[str]:
    """The value printed after `label`, stopping at the next known label. None when absent."""
    m = re.search(re.escape(label) + r"\s*:\s*(.{1,80}?)(?=\s*(?:" + _STOP + r")\s*:|$)", text)
    if not m:
        return None
    v = m.group(1).strip(" .،-")
    return v or None


def spec_int(text: str, label: str, lo: int = 0, hi: int = 200) -> Optional[int]:
    v = spec(text, label)
    if not v:
        return None
    m = re.search(r"\d+", v.translate(_AR_DIGITS))
    if not m:
        return None
    n = int(m.group(0))
    return n if lo <= n <= hi else None


# PRICE — read from the ad's OWN card, never from the page.
#
# THE BUG THIS REPLACES (found 2026-09-19 by checking stored data, not by running the tests). The
# old parser searched the WHOLE flattened page for the first «…SAR» string. Every ksaaqar detail
# page also renders a STATIC sidebar of five unrelated ads in `.price-box` — byte-identical on
# every page of the site — and those are the only «SAR» strings there, because the ad's own price
# renders in Arabic as «…ريال». So the parser could never read a real price: it stamped one
# neighbour's figure onto 685 of 720 priced rows (159 listings all "13,370", 231 all "250,000"),
# including ads whose own card says «السعر عند الطلب» and have NO published price at all.
#
# The ad's own price lives in the share-modal summary card, which carries the ad's own href. We
# anchor on that href: a figure is only accepted from the card that links to THIS listing, so a
# neighbour's price can never be borrowed again. No matching card → NULL, never a guess.
_OWN_CARD_RE = re.compile(
    r'class="recent-ads-list-title"\s*>\s*<a\s+href="([^"]+)"[^>]*>.*?'
    r'class="recent-ads-list-price"\s*>(.*?)</div>',
    re.S,
)
# The theme always prints 2 decimals, in SAR or ريال. «0.00» is the theme rendering nothing. The decimals are real
# when the advertiser typed them: /ad/‏فيلا-بالهدا-المربع-الرابع-…/ prints «1.20ريال», which int() stored as 1 (2026-10-18).
# Arabic digits and the Arabic separators («١٫٢٠», «٥٠٬٠٠٠») are the same figure.
_MONEY_RE = re.compile(r"([\d٠-٩][\d٠-٩,٬]*[.٫][\d٠-٩]{2})\s*(?:SAR|ريال|ر\.س)")


def _same_ad(href: str, link: str) -> bool:
    """Same listing, comparing percent-decoded paths — the href is encoded, the REST link may not be."""
    return unquote(href or "").rstrip("/") == unquote(link or "").rstrip("/")


def own_price_figure(page_html: str, link: str) -> Optional[Decimal]:
    """This listing's published figure EXACTLY («1.20» stays 1.20), or None. Never another ad's, never a guess."""
    for href, price_html in _OWN_CARD_RE.findall(page_html or ""):
        if not _same_ad(href, link):
            continue
        m = _MONEY_RE.search(price_html)          # «السعر عند الطلب» has no figure -> None
        if not m:
            return None
        try:
            v = Decimal(m.group(1).translate(_AR_DIGITS).replace(",", "").replace("٬", "").replace("٫", "."))
        except InvalidOperation:
            return None
        return v if v > 0 else None
    return None


def own_price(page_html: str, link: str) -> Optional[int]:
    """The published figure as whole riyals — only when it IS whole («6,400.00»). A fraction («1.20») is never cut to
    1: the price columns hold whole riyals, so such a figure is not stored as a price at all (map_listing)."""
    v = own_price_figure(page_html, link)
    return int(v) if v is not None and v == v.to_integral_value() else None


# PHOTOS — the ad's own gallery only. This theme puts the listing's own photos in `.img-box`
# anchors (the <a href> is the FULL-SIZE image; the <img> inside is a -WxH thumbnail). Related and
# recent ads use a DIFFERENT class, `.category-img-box`, so anchoring on `img-box"` excludes them by
# construction — the same page-chrome trap that made every price wrong (see own_price above). Land
# ads with no gallery yield nothing, which is a correct NULL.
_PHOTO_RE = re.compile(r'class="img-box"[^>]*>\s*<a[^>]+href="([^"]+)"', re.S)


_AD_LAT = re.compile(r'id="ad_lat"\s+value="(-?\d+\.\d+)"')
_AD_LNG = re.compile(r'id="ad_lon"\s+value="(-?\d+\.\d+)"')
# The map's «not set» centre: every ad whose owner placed no pin prints it (9 of 10 sampled, across Jeddah,
# Taif and Makkah ads — owner 2026-10-20 night). It is never an ad's location.
_DEFAULT_PIN = ("24.633333", "46.716667")


def own_pin(page_html: str) -> dict:
    """The pin the ad page draws (`<input id="ad_lat" value="21.2817249">` + ad_lon). {} for the map's
    default centre or when absent."""
    la, lo = _AD_LAT.search(page_html or ""), _AD_LNG.search(page_html or "")
    if not (la and lo):
        return {}
    if (la.group(1)[:9], lo.group(1)[:9]) == _DEFAULT_PIN:
        return {}
    return pin_dict(la.group(1), lo.group(1))


def own_photos(page_html: str) -> Optional[list[str]]:
    urls =[ihtml.unescape(u) for u in _PHOTO_RE.findall(page_html or "")]
    urls = [u for u in dict.fromkeys(urls)
            if u.startswith("http") and re.search(r"\.(?:jpe?g|png|webp)$", u, re.I)]
    return urls or None


_DEAL_RENT = ("للإيجار", "للايجار", "ايجار", "إيجار")
_DEAL_BUY = ("للبيع", "بيع")


# THE DEAL WHEN «النوع» IS ABSENT (81 pages had no such field on 2026-09-28, most of them real
# ads: «جدة حي الفضيلة فيلا للبيع», «شقة للإيجار في حي الحمراء», «ارض للبيع ف جازان» …). The ad's
# OWN title then states it, so it is read from there — never from the price, never from a
# neighbour. Whole words only: the bare «بيع» must
# never fire inside «الربيع» (a district) nor «المبيعات». Tatweel is stripped first («للبيــــع»). A
# title stating BOTH deals says neither. «تمليك» is the sale word this source uses («شقق تمليك»),
# as on alrifai. Wanted/contractor/maintenance ads are not listings, whatever else the title says.
_TITLE_RENT_RE = re.compile(r"(?<![ء-ي])و?(?:لل|ل|ال)?[إاأ]يجار(?![ء-ي])")
_TITLE_SALE_RE = re.compile(r"(?<![ء-ي])و?(?:لل|ال)?(?:بيع|تمليك)(?![ء-ي])")
_NOT_A_LISTING_RE = re.compile(r"مطلوب|مقاول|ترميم|صيان[ةه]")


def deal_from_title(title: str) -> Optional[str]:
    t = (title or "").replace("\u0640", "")
    if _NOT_A_LISTING_RE.search(t):
        return None
    sale, rent = bool(_TITLE_SALE_RE.search(t)), bool(_TITLE_RENT_RE.search(t))
    return "Buy" if sale and not rent else "Rent" if rent and not sale else None


def parse_deal(text: str, title: str = "") -> Optional[str]:
    """Rent/Buy from the listing's OWN «النوع:» field; when the page has NO such field, from the ad's
    own title. A field that says something else («مطلوب», «للبدل») is an answer, not an absence, so
    the title is never consulted over it. Nothing stated -> None (never defaulted)."""
    v = spec(text, "النوع")
    if not v:
        return deal_from_title(title)
    if any(w in v for w in _DEAL_RENT):
        return "Rent"
    if any(w in v for w in _DEAL_BUY):
        return "Buy"
    return None


_YES = ("نعم", "متوفر", "يوجد")
_NO = ("لا", "غير متوفر", "لا يوجد")


def parse_tristate(text: str, label: str) -> Optional[bool]:
    """True/False/None. SOURCE IS TRUTH — an unstated attribute is NULL, never False."""
    v = spec(text, label)
    if not v:
        return None
    if any(v.startswith(w) for w in _YES):
        return True
    if any(v.startswith(w) for w in _NO):
        return False
    return None


_FURNISHED_YES = ("مفروشة", "مفروش")
_FURNISHED_NO = ("غير مفروشة", "غير مفروش", "بدون فرش")


def parse_furnished(text: str) -> Optional[bool]:
    v = spec(text, "التأثيث")
    if not v:
        return None
    if any(v.startswith(w) for w in _FURNISHED_NO):
        return False
    if any(v.startswith(w) for w in _FURNISHED_YES):
        return True
    return None


_AGE_OPEN = re.compile(r"أكثر\s*من|اكثر\s*من|فوق\s")
_AGE_WORDS = {"جديد": 0, "جديدة": 0, "سنة": 1, "سنه": 1, "سنتين": 2}


def parse_age(text: str) -> Optional[int]:
    """Years, or None. «أكثر من N» is an OPEN BOUND and stores NULL — storing N invents a
    precision the source withheld (the عقاريون repair of 2026-09-19)."""
    v = spec(text, "عمر العقار")
    if not v:
        return None
    if _AGE_OPEN.search(v):
        return None
    # A WORD NUMERAL AT THE START WINS over any digit later in the row. «سنتين» is two years; a
    # digit further along belongs to whatever field follows, not to the age.
    for w, n in _AGE_WORDS.items():
        if v.startswith(w):
            return n
    d = v.translate(_AR_DIGITS)
    m = re.search(r"\d+", d)
    if m:
        n = int(m.group(0))
        return n if 0 <= n <= 100 else None
    for w, n in _AGE_WORDS.items():
        if w in v:
            return n
    return None


# AREA. The source writes it at least six ways, and reading only the labelled «المساحة:» spec cell
# found it on 3 of 24 pages that plainly state one:
#     «المساحة: 163.27 متر مربع»   «مساحة الأرض: 525م²»   «المساحة / 620 م»
#     «مساحة ٢٠٠م²»                «مساحة الأرض الإجمالية: 1,200 م²»
# What makes a match an AREA is a NUMBER followed by a unit — never the word alone, so prose like
# «نوفر لكم مساحة عمل» (workspace) and «بمساحة مريحة» (roomy) cannot become a measurement.
_AREA_RE = re.compile(
    r"مساح[ةه](?:\s+(?:الأرض|الارض|العقار|الإجمالية|الاجمالية|الكلية))*"
    r"\s*[:：/\-]?\s*"
    r"([\d٠-٩][\d٠-٩,\.]*)\s*(?:م2|م²|متر\s*مربع|متر|م)")


def parse_area(text: str) -> Optional[int]:
    """Square metres, or None. A number without a unit is not an area and is never stored."""
    if not text:
        return None
    for m in _AREA_RE.finditer(text.translate(_AR_DIGITS)):
        raw = m.group(1).replace(",", "").rstrip(".")
        try:
            n = int(float(raw))
        except ValueError:
            continue
        if 1 <= n <= 5_000_000:
            return n
    return None


_DIRECTIONS = ("شمال", "جنوب", "شرق", "غرب", "شمالية", "جنوبية", "شرقية", "غربية",
               "شمال شرقي", "شمال غربي", "جنوب شرقي", "جنوب غربي")


def parse_direction(text: str) -> Optional[str]:
    v = spec(text, "واجهة العقار") or spec(text, "الواجهة")
    if not v:
        return None
    for d in sorted(_DIRECTIONS, key=len, reverse=True):
        if v.startswith(d):
            return d
    return None


_FAL_RE = re.compile(r"\b(\d{8,12})\b")


def parse_licence(text: str) -> Optional[str]:
    v = spec(text, "رقم رخصة فال")
    if not v:
        return None
    m = _FAL_RE.search(v.translate(_AR_DIGITS))
    return m.group(1) if m else None


# RENT PERIOD — the shared normalize.rent_period_and_annual() owns this, and its token set
# (نصف سنوي|ربع سنوي|شهري|سنوي|يومي|أسبوعي) is deliberate and shared by 49 platforms, so it is NOT
# widened from here. But this source also writes the period as «الشهر بـ ( 250 ريال )» — a plain
# noun, not the adjective شهري — and the shared function correctly reports "no token", which leaves
# a MONTHLY figure stored as the annual one. That is a 12x understatement on the card.
#
# So this augments, never contradicts: it runs ONLY when the shared function found no token at all,
# and only on phrases that can mean nothing else. An ambiguous text keeps the shared answer.
_MONTHLY_LOCAL = re.compile(r"(?:بال|ال)شهر\b|شهريا|شهرياً|/\s*شهر\b|في\s*الشهر")


def rent_period_and_annual(price: Optional[int], text: str) -> tuple[Optional[str], Optional[int]]:
    period, annual = normalize.rent_period_and_annual(price, text)
    if period is None and price is not None and _MONTHLY_LOCAL.search(text or ""):
        return "monthly", normalize.annualize_rent(price, "monthly")
    return period, annual


# ── location ─────────────────────────────────────────────────────────────────────────────────────
# CITY is the one field this source states for every listing: «الدولة : عقارات الرياض». Measured
# 12/12 on the live sample. The label reads "country" but the value is always a Saudi city.
_CITY_RE = re.compile(r"الدولة\s*:\s*عقارات\s+([\u0621-\u064a][\u0621-\u064a\s]{1,24}?)"
                      r"\s*(?=الحالة|النوع|رقم|انظر|تم\s*النشر|$)")

# FALLBACK when «الدولة» is absent entirely (measured on 15% of listings). Saudi cities are a
# CLOSED set, so a name found in the listing's own title or text is matched against that set and
# nothing else — a city cannot be invented here, only recognised. Longest first so
# «المدينة المنورة» never substring-matches as «المدينة», nor «رأس تنورة» as «تنورة».
_CITIES = (
    "المدينة المنورة", "مكة المكرمة", "الخرج", "الرياض", "جدة", "الدمام", "الخبر", "الظهران",
    "الطائف", "بريدة", "عنيزة", "الرس", "حائل", "تبوك", "أبها", "خميس مشيط", "نجران", "جازان",
    "الباحة", "سكاكا", "عرعر", "القطيف", "الأحساء", "الهفوف", "المبرز", "ينبع", "رابغ",
    "الجبيل", "رأس تنورة", "حفر الباطن", "القريات", "بيشة", "وادي الدواسر", "الزلفي", "المجمعة",
    "شقراء", "الدوادمي", "عفيف", "القويعية", "الأفلاج", "السليل", "ضرماء",
    "بيش", "صبيا", "أبو عريش", "محايل عسير", "النماص", "بلجرشي", "المذنب", "البكيرية",
)
# The name must END where the word ends: «#رياض_الخبراء» (a Qassim town) is not «الخبر».
_CITY_FALLBACK_RE = re.compile(
    "(?:" + "|".join(re.escape(c) for c in sorted(_CITIES, key=len, reverse=True)) + ")(?![ء-ي])")


# The category link itself: «<strong>الدولة: </strong><a … class="ctg-tag" …>عقارات جدة</a>».
_COUNTRY_TAG_RE = re.compile(r"الدولة\s*:\s*</strong>\s*<a\b[^>]*>\s*عقارات\s+([^<]{2,40}?)\s*</a>")


def parse_city(text: str, title: str = "", page_html: str = "") -> Optional[str]:
    """The city the source stated, or None. Never guessed — the fallback RECOGNISES a name from the
    closed Saudi city set; it does not infer one from a district or a landmark."""
    m = _CITY_RE.search(text)
    if m:
        v = m.group(1).strip()
        # A SHORT pin label prints with no «...», so «الدولة: عقارات جدة» runs straight into «جدة حي المروه انظر
        # الخريطة» and the capture swallowed the label: «جدة جدة حي المروه», «الرياض حي المهدية» (52 live rows with no
        # city_id, so no district either; 2026-10-18). The category link ends where the city does.
        tag = _COUNTRY_TAG_RE.search(page_html or "")
        if tag and len(v) > len(_clean(tag.group(1))) and v.startswith(_clean(tag.group(1))):
            v = _clean(tag.group(1))
        return v
    m = _CITY_FALLBACK_RE.search(f"{title} {text[:600]}")
    return m.group(0) if m else None


# DISTRICT candidate — the map line, «… الملقا، الرياض السعودية … انظر الخريطة». It is only a
# CANDIDATE: on some listings that same slot holds the agent's own reference code («RFRA3688,
# 3688»), so the string is never stored as-is. It is handed to find_district_in_text(), which keeps
# it only when this city's curated catalog recognises it — a code can never survive that.
_MAP_RE = re.compile(r"([^:]{3,70}?)\s*\.{2,}\s*انظر\s*الخريطة")
_STATUS_LEAD = re.compile(r"^(?:غير\s+مؤجرة|مؤجرة|جديدة|جديد|أخرى|مستعملة)\s+")


# The page's OWN «الموقع:» field (2026-10-18). On many ads it holds a Google-formatted address —
# «AHAA8868، 8868 خليفة ابن عبدالله ابن الحارث، 4816، حي الحيلة الغربي، محايل 63312, Saudi Arabia» —
# whose «حي X» segment is the district the source states. The map line beneath it is TRUNCATED by the
# theme («AHAA8868، 8868 ... انظر الخريطة»), so reading the map line gave a plus-code, a street, or
# nothing (287 live rows with no district; rendered 2026-10-18). The field's prose («تقع خلف نادي …»)
# is never a district; two «حي» segments are a conflict, not a choice.
_LOC_FIELD_RE = re.compile(r"(?<![\u0600-\u06ff])الموقع\s*:\s*(.{3,300})", re.S)
_ADDRESS_SIGNAL_RE = re.compile(r"\b\d{5}\b|Saudi Arabia|السعودية|المملكة العربية السعودية")
_HAYY_SEG_RE = re.compile(r"^حي\s+\S")
_PLUS_CODE_RE = re.compile(r"^[A-Z0-9]{4,8}\+[A-Z0-9]{2,3}\b")   # «QQWW+5XH», Google's plus code
# A plus code ANYWHERE on the map line («عقارات الدمام 8Q9H+JHH», «6JJ6+25 ابو ال») marks it as the pin's label,
# not an address: a short code with no locality resolves wherever Google guesses (8Q9H+JHH → Kirkuk, Iraq).
_PLUS_CODE_ANY = re.compile(r"(?<![A-Z0-9])[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{0,3}(?![A-Z0-9])")
# A map line that names ITSELF a district: «حي » + Arabic words only (no digits, latin, or a second clause).
_HAYY_SELF = re.compile(r"حي\s+[\u0621-\u064A][\u0621-\u064A\s]{1,30}")
_HAYY_TAIL = re.compile(r"(?<![\u0621-\u064A])حي\s+[\u0621-\u064A][\u0621-\u064A\s]{1,30}$")
# «… خميس مشيط», «… شمال الرياض», «… بالرياض»: the city (with its direction or «ب») a label appends to a district
_CITY_TAIL = re.compile(r"(?<=\S)\s+(?:(?:شمال|جنوب|شرق|غرب|وسط)\s+)?ب?(?:"
                        + "|".join(re.escape(c) for c in sorted(_CITIES, key=len, reverse=True)) + r")$")


def location_field_district(text: str) -> Optional[str]:
    """The «حي X» segment of the page's «الموقع:» field, as written — only when that field is a
    structured address (a postal code or the country among its comma segments) and holds exactly one
    «حي …» segment. A prose field («تقع خلف نادي …») has no address signal and yields nothing."""
    for m in _LOC_FIELD_RE.finditer(text or ""):
        segs: list[str] = []
        # «_» separates segments too: «حي النهضه _ صبيا _ جازان _ المملكة العربية السعودية» (2026-10-18) was read as ONE
        # segment and stored 300 chars of page — the reviews box, the advertiser's handle — as the district.
        for seg in re.split(r"[،,_]", m.group(1)):
            seg = seg.strip()
            if not seg:
                continue
            segs.append(seg)
            if _ADDRESS_SIGNAL_RE.search(seg):            # the address ends at its postal code / country
                break
        else:
            continue                                       # no address signal anywhere: not an address
        hay = [x for x in segs if _HAYY_SEG_RE.match(x)]
        if len(hay) == 1 and _HAYY_SELF.fullmatch(hay[0]):     # a district name, never a run of page text
            return hay[0]
    return None


# The «الموقع:» box under the gallery holds the pin label IN FULL; the map line above it is the theme's copy of that
# label — CUT when long («خميس مشيط حي دره المو... انظر الخريطة» for «خميس مشيط حي دره الموسي»), and printed with no
# «...» when short («حي التسامح انظر الخريطة»), which _MAP_RE never matched. Rendered 2026-10-18: the cut words «حي دره
# المو», «حي العزيز», «حي الصحاف» were live, and short labels gave no district at all.
_BOX_RE = re.compile(r"<h4>\s*الموقع\s*:?\s*</h4>\s*<p>(.*?)</p>", re.S)


def location_box_label(page_html: str) -> Optional[str]:
    m = _BOX_RE.search(page_html or "")
    return (_clean(m.group(1)) or None) if m else None


# A label that names ANOTHER Saudi city is that city's place: «خميس مشيط حي الاسكان» on an ad filed under «عقارات أبها»,
# «امارة منطقة الرياض» under جدة, «الخبر العزيزية حي الشراع» under الهفوف. Its district is not this city's district.
# «حي الرياض» (a district of جدة) and «طريق الدمام» (a road in الرياض) name a district and a road, not a city.
_NOT_A_CITY_MENTION = re.compile(r"(?:حي|طريق|شارع)\s+\S+")


def label_cities(text: Optional[str]) -> dict[str, str]:
    """{English city: the Arabic as written} for every Saudi city a label or title names (not «حي X»/«طريق X»)."""
    rest = _NOT_A_CITY_MENTION.sub(" ", text or "")
    return {normalize.map_city(c) or c: c for c in _CITY_FALLBACK_RE.findall(rest)}


def names_other_city(label: Optional[str], city: Optional[str]) -> bool:
    return any(en != city for en in label_cities(label))


def label_city(label: Optional[str], title: Optional[str], city: Optional[str]) -> Optional[str]:
    """The city the ad's OWN pin label names when it is not the category's (owner 2026-10-18): «عقارات أبها» is the
    site's regional bucket, «خميس مشيط حي الاسكان» is the ad's own claim, so the ad is filed under خميس مشيط. Only when
    the label names exactly ONE city, and the title does not name a different one (12226684: a Riyadh pin on an ad
    whose title says صبيا is a conflict, not a claim) — otherwise None."""
    named = label_cities(label)
    if len(named) != 1:
        return None
    en, ar = next(iter(named.items()))
    in_title = label_cities(title)
    if en == city or (in_title and en not in in_title):
        return None
    return ar


def district_candidate(text: str, box: Optional[str] = None) -> Optional[str]:
    field = location_field_district(text)
    if field:
        return field
    m = _MAP_RE.search(text)
    if box:
        v = box             # the label whole; the map line is its copy, cut («…المو...») or, when short, unmatched
    elif m:
        v = _STATUS_LEAD.sub("", m.group(1).strip())
    else:
        return None
    v = v.split("،")[0].split(",")[0].strip()
    # an agent reference code is latin/digits, and a plus code a grid cell — never a Saudi district name
    if not v or re.fullmatch(r"[A-Za-z0-9\s\-_]+", v) or _PLUS_CODE_RE.match(v) or _PLUS_CODE_ANY.search(v):
        return None
    return v


def neighborhood_word(cand: Optional[str], field: Optional[str], cand_hit: Optional[str]) -> Optional[str]:
    """The SOURCE's own district word for `neighborhood`. When the catalog has no match, the index carries
    this word to the card and to the Filter's district list exactly as written (district_recovery «carries
    the source word», 2026-10-18), so it must be a district the page STATES. Only the «الموقع:» field states
    one. The map line is the pin's label — the ad's title («فلل فاخرة للبيع بدون دفعه مق»), the site's
    category («عقارات جدة JIJB»), the country («المملكة العربية السعودية») — so it counts only when this
    city's catalog recognised it or it names itself «حي X». Anything else stays in additional_info.map_line."""
    if field:
        return field
    if cand and cand_hit:
        return cand
    if cand and _HAYY_SELF.fullmatch(cand):
        return _without_city_tail(cand)
    # «الرياض حي النضيم», «خميس مشيط حي الاسكان»: the line ENDS in a district it names — that segment, as written.
    tail = _HAYY_TAIL.search(cand or "")
    if tail and _HAYY_SELF.fullmatch(tail.group(0).strip()):
        return _without_city_tail(tail.group(0).strip())
    return None


def _without_city_tail(word: str) -> str:
    """«حي طيب الاسم خميس مشيط» → «حي طيب الاسم»: the district, without the city the label appends to it.
    «حي الرياض» stays whole — there the city's name IS the district's."""
    v = _CITY_TAIL.sub("", word).strip()
    return v if _HAYY_SELF.fullmatch(v) else word


# TYPE comes from the breadcrumb the theme prints above the title: «شقق سكنية > شقق سكنية للإيجار»,
# «فلل > فلل للبيع», «محلات تجارية > مكاتب». The FIRST crumb is the family; it is mapped through the
# shared Arabic type map so this platform cannot invent a type of its own.
_CRUMB_RE = re.compile(
    r"(شقق\s*سكنية|شقق|فلل|فيلا|أراضي|اراضي|أرض|ارض|عمائر|عمارة|محلات\s*تجارية|محلات|مكاتب|"
    r"مستودعات|مستودع|استراحات|استراحة|مزارع|مزرعة|أدوار|دور|غرف|شاليهات|شاليه|بيوت|بيت)\s*>")

_TYPE_AR = {
    "شقق سكنية": "شقة", "شقق": "شقة", "فلل": "فيلا", "فيلا": "فيلا",
    "أراضي": "أرض", "اراضي": "أرض", "أرض": "أرض", "ارض": "أرض",
    "عمائر": "عمارة", "عمارة": "عمارة", "محلات تجارية": "محل", "محلات": "محل",
    "مكاتب": "مكتب", "مستودعات": "مستودع", "مستودع": "مستودع",
    "استراحات": "استراحة", "استراحة": "استراحة", "مزارع": "مزرعة", "مزرعة": "مزرعة",
    "أدوار": "دور", "دور": "دور", "غرف": "غرفة", "شاليهات": "شاليه", "شاليه": "شاليه",
    "بيوت": "بيت", "بيت": "بيت",
}


# The breadcrumb is absent on some listings (7 of 40 sampled). The TITLE then carries the same word
# — «شقه ايجار», «ارض للبيع في بيش», «استراحه للايجار» — so it is read as a fallback through the
# SAME closed map. A word outside that map still yields None and the listing is still skipped: the
# fallback widens where we look, never what counts as a type.
#
# «وحدة علوية» / «وحدة أرضية» (an upper / ground UNIT) map to شقة (Apartment) — the source's OWN
# breadcrumb files its «وحدة أرضية للبيع في بريدة» ad under «شقق سكنية», and «شقة علوية/أرضية» is
# Apartment on bossbih/aqalemhajer/ashab. The leftmost match wins, so the unit phrase must be an
# alternative of its own: without it the alternation reads «أرض» inside «أرضية» — LAND.
_TITLE_TYPE_RE = re.compile(
    r"(وحد[ةه]\s*(?:علوي[ةه]|[أا]رضي[ةه])|[أا]رض\s*تجاري[ةه]|"
    r"شقق\s*سكنية|شقه|شقة|شقق|فلل|فيلا|فله|أراضي|اراضي|أرض|ارض|عمائر|عمارة|عماره|"
    r"محلات\s*تجارية|محلات|محل|مكاتب|مكتب|مستودعات|مستودع|استراحات|استراحة|استراحه|"
    r"مزارع|مزرعة|مزرعه|أدوار|دور|غرف|غرفه|غرفة|شاليهات|شاليه|بيوت|بيت|دوبلكس|دبلكسات|دبلكس|"
    r"فندق|مصنع|روف|برج)")
_UNIT_RE = re.compile(r"وحد[ةه]\s*(?:علوي[ةه]|[أا]رضي[ةه])")

# LAND IS QUALIFIED BEFORE IT IS BARE: «ارض تجارية للبيع» is Commercial Land, not the bare «ارض»
# (Residential Land) the old alternation stopped at.
#
# Every VALUE here must be a key normalize.map_type_exact() knows — a value it does not know is a
# silent skip. «شقة» (the commonest title word: 238 titles) and «دبلكس» (mapped to itself) were
# exactly that until 2026-09-28. «برج» stays unmapped on purpose: on this source it is the start of
# «برجولات» (pergolas) in contractor ads.
_TITLE_TYPE_AR = dict(_TYPE_AR, **{
    "شقة": "شقة", "شقه": "شقة", "فله": "فيلا", "عماره": "عمارة", "محل": "محل", "مكتب": "مكتب",
    "أرض تجارية": "أرض تجارية", "ارض تجارية": "أرض تجارية", "ارض تجاريه": "أرض تجارية",
    "أرض تجاريه": "أرض تجارية",
    "استراحه": "استراحة", "مزرعه": "مزرعة", "غرفه": "غرفة",
    "دوبلكس": "دوبلكس", "دبلكس": "دوبلكس", "دبلكسات": "دوبلكس", "فندق": "فندق",
    "مصنع": "مصنع",
    "روف": "شقة", "برج": "برج",
})


def parse_type_ar(text: str, title: str = "") -> Optional[str]:
    """The source's own Arabic type word, or None. None means UNKNOWN and the listing is SKIPPED —
    never bucketed into a nearest guess (AMBIGUOUS-MAPPING ASK-FIRST)."""
    m = _CRUMB_RE.search(text)
    if m:
        hit = _TYPE_AR.get(re.sub(r"\s+", " ", m.group(1)).strip())
        if hit:
            return hit
    m = _TITLE_TYPE_RE.search(title or "")
    if m:
        word = re.sub(r"\s+", " ", m.group(1)).strip()
        return "شقة" if _UNIT_RE.fullmatch(word) else _TITLE_TYPE_AR.get(word)
    return None


# ── fetch ────────────────────────────────────────────────────────────────────────────────────────
LIST_ATTEMPTS = 4
LAST_FETCH_NOTE = ""


def _get(s: cc.Session, url: str, attempts: int = LIST_ATTEMPTS) -> Optional[Any]:
    """GET with retries. A timeout, a 403 and a genuinely empty source must never read alike —
    returning None with LAST_FETCH_NOTE set keeps a transport failure from being reported as
    'the source has no listings' (the remal incident, 2026-09-15)."""
    global LAST_FETCH_NOTE
    for attempt in range(1, attempts + 1):
        try:
            r = s.get(url, timeout=45)
        except Exception as e:
            LAST_FETCH_NOTE = f"transport {type(e).__name__}: {e}"
            continue
        if r.status_code == 200:
            return r
        LAST_FETCH_NOTE = f"HTTP {r.status_code}"
        if r.status_code not in (429, 500, 502, 503, 504):
            return None
    return None


# Why a REST walk may not be the whole catalogue. Non-empty → no prune this run.
INCOMPLETE: list[str] = []

# ── REMOVAL (measured 2026-10-02; the signals are the ones registered on 2026-09-19). Until then
# this crawler had NO removal step at all: a deleted ad stayed active here for good.
#
# ksaaqar hard-404s an ad it no longer serves: of 14 active rows the crawl had stopped seeing, 1
# answered 404 (as does a slug that never existed) and 13 answered 200 still rendering their spec
# block — ads the crawler now skips, which are NOT gone and must not be hidden as if they were.
# 10 of 10 random live ads rendered «النوع». A 200 without it, and every block, is UNKNOWN.
_SPEC_LABEL = "النوع"
RES_TABLE, COM_TABLE = "ksaaqar_residential_listings", "ksaaqar_commercial_listings"


def _signal(status, body, moved) -> Optional[str]:
    """'live' | 'gone' | None — only what this ad's own URL affirmatively answers."""
    if status in (404, 410):
        return "gone"
    if status != 200 or moved:
        return None
    return "live" if _SPEC_LABEL in _txt(body) else None


def _make_verify_gone(control: Optional[dict]):
    """The removal oracle for db.prune_unseen and for the daily direct check. A 404 is believed
    only while a known-live ad from this run (`control`) still reads live through the same session."""
    url_for = stored_listing_url((RES_TABLE, COM_TABLE))
    s = session()

    def probe(ad_number: str, canary=None):
        return LivenessProbe(platform="ksaaqar", signal=_signal, session=lambda: s,
                             url_for=url_for, canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = probe(control["ad_number"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


def fetch_listings(s: cc.Session, limit: int = 0) -> list[dict]:
    """Every ad_post via REST. Pages until a short page, so the catalogue size is the source's."""
    INCOMPLETE.clear()
    out: list[dict] = []
    for page in range(1, 60):
        r = _get(s, f"{REST}/ad_post?per_page=100&page={page}"
                    f"&_fields=id,link,slug,title,content,class_list,date,modified")
        if r is None:
            if page == 1:
                return []
            # WordPress answers HTTP 400 past the last page; anything else cut the walk short.
            if not LAST_FETCH_NOTE.startswith("HTTP 400"):
                INCOMPLETE.append(f"page {page}: {LAST_FETCH_NOTE}")
            break
        try:
            batch = r.json()
        except Exception:
            INCOMPLETE.append(f"page {page}: body was not JSON")
            break
        if not isinstance(batch, list) or not batch:
            break
        out.extend(batch)
        if limit and len(out) >= limit:
            break
        if len(batch) < 100:
            break
    return out[:limit] if limit else out


def fetch_detail(s: cc.Session, link: str) -> Optional[str]:
    """RAW html — the price lives in a specific element, and _txt() throws the DOM away."""
    r = _get(s, link, attempts=3)
    return r.text if r is not None else None


# NOT IN SAUDI ARABIA. This source lets a poster file a Cairo flat or a Sharjah hotel under
# «عقارات الرياض», so the «الدولة» field cannot vouch for the country. An ad whose OWN title places it
# abroad is skipped: a Hurghada hotel must never be searchable as a Riyadh listing. Whole words only
# («مصرحة» is "licensed", not Egypt).
_ABROAD_RE = re.compile(
    r"(?<![ء-ي])(?:ب|بال|في|ف)?(?:مصر|القاهر[ةه]|الغردق[ةه]|الامارات|الإمارات|دبي|الشارق[ةه]|"
    r"المغرب|مراكش|الأردن|الاردن|تركيا|اسطنبول|إسطنبول)(?![ء-ي])")


def ad_number(post: dict) -> str:
    return f"{PREFIX}{int(hashlib.md5((post.get('slug') or str(post.get('id'))).encode()).hexdigest()[:12], 16)}"


def _retire_abroad(table: str, abroad: dict[str, str]) -> list[str]:
    """Retire the stored, active rows of ads whose OWN title places them abroad. Skipping them is not
    enough: the removal step below hides only an ad whose own page is gone, and these pages still
    render, so 11 rows filed before the skip existed (Cairo, Dubai, Marrakech, Aqaba, Aswan —
    2026-09-28) would heal and stay searchable. Same evidenced pin as eastabha's country gate. The
    note carries only the place word, never the title: one of these titles is a phone number."""
    if not abroad:
        return []
    got = db._execute(db.sb().table(table).select("ad_number").in_("ad_number", list(abroad)).eq("active", True),
                      what=table + ".abroad")
    stored = sorted({r["ad_number"] for r in (got.data or [])})
    return sold_pin.pin_source_confirmed_gone(
        table, stored, oracle="ksaaqar.abroad_gate.title",
        notes={a: f"outside Saudi Arabia: the ad's own title names «{abroad[a]}». ksaaqar.com still "
                  f"serves the ad; retired as out of scope, not as sold." for a in stored})


# ── map ──────────────────────────────────────────────────────────────────────────────────────────
# The ad's own description box: <div id="adt-ad-description-box"><h4>الوصف:</h4><p>…</p>. ksaaqar's
# structured spec list has «التكييف» and «التأثيث» but no kitchen / lift / parking / maid room (30-page census
# above, re-checked 2026-10-08 on 12226455 and 12226526), so for those the description is the only statement
# and prose is lawful, four outcomes, line by line. AC and furnished stay structured-only.
# EVERY paragraph of the box, not the first (🔬 2026-10-17, backlog 630): 12225735 and 12226520 open with a
# headline paragraph («فيلا مع شقتين. حي المصيف») and name «مطبخ» / «غرفة سائق» in the next ones, so kitchen stayed
# NULL on ads that state it (CI re-read 39026652684). The «الوصف:» heading is dropped, never read as a fact.
_DESC_BOX = re.compile(r'id="adt-ad-description-box"[^>]*>', re.S)
_DIV_EDGE = re.compile(r"<(/?)div\b", re.I)
_DESC_H4 = re.compile(r"<h4[^>]*>.*?</h4>", re.S)
_PROSE_SKIP = ("air_conditioner", "furnished")


def _description_text(page_html: str) -> Optional[str]:
    """The box's own text, however the poster's editor wrapped it. 281 of 1,352 ads stayed NULL after the
    2026-10-31 crawl because their text is «<p><div>line</div><div>line</div>…</p>» and the old cut at the
    first «</div>» ended the box before its first paragraph closed (12 Nov 2020 ad «شقق مفروش إيجار شهري»).
    The box ends where ITS OWN div closes: nested divs are counted, so the sidebar after it is never read."""
    m = _DESC_BOX.search(page_html or "")
    if not m:
        return None
    box = page_html[m.end():m.end() + 20000]
    depth, end = 1, len(box)
    for edge in _DIV_EDGE.finditer(box):
        depth += -1 if edge.group(1) else 1
        if depth == 0:
            end = edge.start()
            break
    inner = _DESC_H4.sub("", box[:end])
    if "<p" not in inner:
        return None
    text = normalize.html_block_lines(inner)
    return text or None


def stated_rate(page_html: str, price: Optional[int]) -> Optional[int]:
    """The card's figure when the ad's own description states THAT figure per metre, else None."""
    return price if price and normalize.stated_per_metre(_description_text(page_html), price) else None


def parse_description_amenities(page_html: str) -> dict[str, bool]:
    text = _description_text(page_html)
    return normalize.prose_amenities(text, skip=_PROSE_SKIP) if text is not None else {}


def map_listing(post: dict, page_text: str, page_html: str = "") -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) — every skip names its own reason for the run notes."""
    link = post.get("link")
    if not link or not page_text:
        return None, "residential", "empty_page"

    title_early = _clean((post.get("title") or {}).get("rendered", ""))
    if _ABROAD_RE.search(title_early):
        return None, "residential", "abroad"
    type_ar = parse_type_ar(page_text, title_early)
    if not type_ar:
        return None, "residential", "no_type"          # unknown type is SKIPPED, never guessed
    property_type = normalize.map_type_exact(type_ar)
    if not property_type:
        return None, "residential", f"type_unmapped:{type_ar}"
    category = normalize.category_for_type(property_type).lower()

    deal = parse_deal(page_text, title_early)
    if not deal:
        # no stated deal -> UNKNOWN, never defaulted to Buy. «مطلوب»/«للبدل» are named, not lumped.
        field = spec(page_text, "النوع")
        return None, category, f"deal_field:{field[:12]}" if field else "no_deal_stated"

    city_ar = parse_city(page_text, title_early, page_html)
    if not city_ar:
        return None, category, "no_city"               # unlocatable rows cannot be searched honestly
    city = normalize.map_city(city_ar)
    city_id, region_id = to_catalog(city_ar)

    # The district is PROPOSED from the page and kept only if this city's curated catalog knows it.
    field = location_field_district(page_text)
    box = location_box_label(page_html)
    cand = district_candidate(page_text, box)
    district_source = ("location_field" if field else "map_line") if cand else None
    title = _clean((post.get("title") or {}).get("rendered", ""))
    body = _clean((post.get("content") or {}).get("rendered", ""))
    district_ar = cand_hit = None
    # The ad's own label names its city and it is not the category's bucket city: file it there (owner 2026-10-18).
    category_city = None
    relabel = label_city(box or cand, title, city) if (cand and not field) else None
    if relabel:
        new_id, new_region = to_catalog(relabel)
        if new_id:
            category_city, city_ar, city, city_id, region_id = city_ar, relabel, normalize.map_city(relabel), new_id, new_region
    # The page itself places the pin in another city: no district of THIS city comes from it, its title or its body,
    # and the stored one clears (the source settled it — AUTHORITATIVE_NULL, not a dropped None).
    elsewhere = bool(cand) and not field and not category_city and names_other_city(box or cand, city)
    if elsewhere:
        district_ar, district_source = db.AUTHORITATIVE_NULL, "label_names_another_city"
    elif city_id:
        cand_hit = find_district_in_text(cand, city_id) if cand else None
        district_ar = cand_hit or find_district_in_text(f"{title} {body}", city_id)
    # The ad's own TITLE names the district («شقق تمليك للبيع بحي المروة», «للبيع فيلا مساحة 338 حي العارض»): its
    # «حي X» in the title's spelling when it is exactly a district the catalogue or the served index knows for this
    # city (2026-10-18: 17 of the 44 titled rows with no district). Never fuzzy.
    title_hayy = (title_hayy_district(title, known_district_keys(city_id))
                  if (city_id and not district_ar and not elsewhere) else None)
    if title_hayy:
        district_ar, district_source = title_hayy, "title"

    figure = own_price_figure(page_html, link)
    price = own_price(page_html, link)
    fractional = figure is not None and price is None      # «1.20ريال»: published, but not a whole-riyal amount
    rent_period, price_annual = (None, None)
    if deal == "Rent":
        rent_period, price_annual = rent_period_and_annual(price, f"{title} {body} {page_text}")

    row: dict[str, Any] = {
        "ad_number": ad_number(post),
        "listing_url": link,
        "source": SOURCE,
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": city,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": (db.AUTHORITATIVE_NULL if elsewhere
                         else neighborhood_word(cand, field, cand_hit) or title_hayy),
        "area_m2": parse_area(page_text),
        "bedrooms": spec_int(page_text, "عدد الغرف", 0, 50),
        "bathrooms": spec_int(page_text, "دورة المياه", 0, 50)
                     or spec_int(page_text, "دورات المياه", 0, 50),
        "halls": spec_int(page_text, "عدد الصالات", 0, 20),
        "property_age": parse_age(page_text),
        "direction": parse_direction(page_text),
        "street_width_m": spec_int(page_text, "عرض الشارع", 1, 120),
        "furnished": parse_furnished(page_text),
        # «التكييف : …» is the site's own structured AC field (19/30 pages). It used to be filed only in
        # additional_info.air_conditioning, so the Advanced Filter's AC chip — which reads the column —
        # never saw 393 published «yes» and 89 published «no» (🔬 AF engineer, 2026-10-05).
        "air_conditioner": parse_tristate(page_text, "التكييف"),
        **parse_description_amenities(page_html),
        # The ad's own description, VERBATIM (owner 2026-10-30: «we read everything»). It was parsed for
        # amenities since 10-08 but never STORED, so all 1,353 active rows had description NULL and the AI
        # facts reader (title+description >= 30 chars) could not read one ksaaqar ad. Silence stays NULL.
        # PDPL: the box carries the broker's phone («0551228113») — redacted here, like every description.
        "description": redact_pii(_description_text(page_html)),
        "title": title or None,
        "photo_urls": own_photos(page_html),
    }
    if deal == "Rent":
        row["price_annual"] = db.AUTHORITATIVE_NULL if fractional else price_annual
        if rent_period:
            row["rent_period"] = rent_period
    else:
        # The card's figure is a RATE when the ad's own description states it per metre (owner 2026-10-18): the
        # card prints «6,400.00 ريال», the description «… 6400 ريال للمتر». No marker: the total as published.
        # A stated rate writes AUTHORITATIVE_NULL as the total so the stored total clears.
        rate = stated_rate(page_html, price)
        row["price_total"] = db.AUTHORITATIVE_NULL if (rate or fractional) else price
        if rate:
            row["price_per_meter"] = rate

    extra: dict[str, Any] = {
        "district_source": district_source,      # the page's «الموقع:» address field, or the map line
        "category_city_ar": category_city,       # the site's bucket city when the ad's own label named another one
        "map_line": cand if cand and not field else None,   # the pin label as read; a district only via neighborhood_word
        "wp_id": post.get("id"),
        "slug": post.get("slug") or None,
        "fal_licence": parse_licence(page_text),
        "air_conditioning": parse_tristate(page_text, "التكييف"),
        "floors": spec_int(page_text, "عدد الأدوار", 0, 60),
        "source_status": spec(page_text, "الحالة"),
        "source_category": spec(page_text, "نوع العقار"),
        "type_ar": type_ar,
        "ad_cats": _classes(post, "ad_cats-") or None,
        "ad_country": _classes(post, "ad_country-") or None,
        "ad_condition": _classes(post, "ad_condition-") or None,
        "price_published": figure is not None,
        "price_published_text": f"{figure} ريال" if fractional else None,   # the card's figure, verbatim
    }
    row["additional_info"] = {**own_pin(page_html), **{k: v for k, v in extra.items() if v is not None}}
    return row, category, ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: map only the first N listings, NO upsert, NO prune")
    ap.add_argument("--dry-run", action="store_true", help="map and print, write nothing")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("ksaaqar")
    res: list[dict] = []
    com: list[dict] = []
    try:
        posts = fetch_listings(s, limit=args.limit)
        if not posts:
            raise RuntimeError(f"REST returned no listings — {LAST_FETCH_NOTE or 'empty response'}")
        print(f"{SOURCE}: {len(posts)} listings discovered"
              f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}", flush=True)

        skipped: dict[str, int] = {}
        abroad: dict[str, str] = {}      # ad_number -> the place word its own title names
        for i, p in enumerate(posts, 1):
            page_html = fetch_detail(s, p["link"])
            if not page_html:
                skipped["detail_unreachable"] = skipped.get("detail_unreachable", 0) + 1
                continue
            text = _txt(page_html)
            row, cat, why = map_listing(p, text, page_html)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                if why == "abroad":
                    abroad[ad_number(p)] = _ABROAD_RE.search(_clean(p["title"]["rendered"])).group(0)
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            if i % 200 == 0:
                print(f"   … {i}/{len(posts)} pages read", flush=True)

        # Printed AND written to scrape_runs.notes EVERY run: a listing we refuse to guess at stays
        # visible, or the platform quietly shrinks and nobody knows why (notes were NULL until
        # 2026-09-28, while 447 of 1,811 ads were being skipped).
        skip_notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print("  skipped (not guessed): " + skip_notes)

        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r in (res + com)[:10]:
                print(f"   {r['ad_number']} {r['transaction_type']:4s} {str(r['property_type']):16s} "
                      f"{str(r['city_ar']):8s} {str(r['district_ar'] or '-'):14s} "
                      f"area={str(r['area_m2']):>6} beds={str(r['bedrooms']):>3} "
                      f"bath={str(r['bathrooms']):>3} px={r.get('price_total') or r.get('price_annual')}")
            return 0

        if res:
            db.upsert_ksaaqar_residential_batch(res)
        if com:
            db.upsert_ksaaqar_commercial_batch(com)

        # An ad whose category flipped this run is SUPERSEDED in the table it left. Both of this
        # platform's verticals are written from one pass, so a listing reclassified from
        # residential to commercial (or back) would otherwise stay active in BOTH tables and show
        # twice. This runs before any prune because it reasons from positive evidence — we parsed
        # and classified the ad this run — rather than from absence, which prune's own guards
        # deliberately protect against. See db.retire_superseded_siblings.
        superseded = db.retire_superseded_siblings(
            res_table="ksaaqar_residential_listings",
            com_table="ksaaqar_commercial_listings",
            res_ads={r["ad_number"] for r in res},
            com_ads={r["ad_number"] for r in com},
            source="KSA Aqar")
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        retired_abroad = sum(len(_retire_abroad(t, abroad))
                             for t in ("ksaaqar_residential_listings", "ksaaqar_commercial_listings"))
        if retired_abroad:
            print(f"  retired {retired_abroad} stored row(s) placed abroad by their own title")

        # REMOVAL. An ad missing from this run is only a CANDIDATE: at three misses its own URL is
        # re-read, and it is hidden only on a 404 (_signal). An ad that still renders heals the row
        # — including one the crawler skips on purpose, which is not gone. No prune on a partial
        # walk or a single-vertical run.
        pruned = 0
        if INCOMPLETE:
            print(f"  ⚠ REST walk incomplete — no prune: {'; '.join(INCOMPLETE)}")
        elif args.type == "all" and not args.limit:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                k = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if k < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += k

        n = len(res) + len(com)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(posts), rows_upserted=n,
                             notes=f"pruned={pruned} skipped: {skip_notes or 'none'}"[:300],
                             check_tables=["ksaaqar_residential_listings",
                                           "ksaaqar_commercial_listings"])
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


# Owner 2026-10-13: every site keeps its COMPLETE source record (PDPL-clean) beside the mapped columns.
from scrapers.common.capture import capture_source_items  # noqa: E402
capture_source_items(globals())


if __name__ == "__main__":
    raise SystemExit(main())
