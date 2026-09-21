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

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402

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


def spec_measure(text: str, label: str, lo: int = 0, hi: int = 200):
    """spec_int's measurement sibling: the SAME first number, its decimals kept («12.5 م» stays
    12.5 where spec_int stopped at the dot and kept 12)."""
    v = spec(text, label)
    if not v:
        return None
    m = re.search(r"\d+(?:[.٫]\d+)?", v.translate(_AR_DIGITS))
    if not m:
        return None
    n = normalize.to_measure(m.group(0))
    return n if n is not None and lo <= n <= hi else None


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
# The theme always prints 2 decimals, in SAR or ريال. «0.00» is the theme rendering nothing.
_MONEY_RE = re.compile(r"([\d٠-٩][\d٠-٩,]*\.\d{2})\s*(?:SAR|ريال|ر\.س)")


def _same_ad(href: str, link: str) -> bool:
    """Same listing, comparing percent-decoded paths — the href is encoded, the REST link may not be."""
    return unquote(href or "").rstrip("/") == unquote(link or "").rstrip("/")


def own_price(page_html: str, link: str) -> Optional[int]:
    """This listing's published price, or None. Never another ad's, never a guess."""
    for href, price_html in _OWN_CARD_RE.findall(page_html or ""):
        if not _same_ad(href, link):
            continue
        m = _MONEY_RE.search(price_html)          # «السعر عند الطلب» has no figure -> None
        if not m:
            return None
        try:
            v = float(m.group(1).translate(_AR_DIGITS).replace(",", ""))
        except ValueError:
            return None
        return int(v) if v > 0 else None
    return None


# PHOTOS — the ad's own gallery only. This theme puts the listing's own photos in `.img-box`
# anchors (the <a href> is the FULL-SIZE image; the <img> inside is a -WxH thumbnail). Related and
# recent ads use a DIFFERENT class, `.category-img-box`, so anchoring on `img-box"` excludes them by
# construction — the same page-chrome trap that made every price wrong (see own_price above). Land
# ads with no gallery yield nothing, which is a correct NULL.
_PHOTO_RE = re.compile(r'class="img-box"[^>]*>\s*<a[^>]+href="([^"]+)"', re.S)


def own_photos(page_html: str) -> Optional[list[str]]:
    urls = [ihtml.unescape(u) for u in _PHOTO_RE.findall(page_html or "")]
    urls = [u for u in dict.fromkeys(urls)
            if u.startswith("http") and re.search(r"\.(?:jpe?g|png|webp)$", u, re.I)]
    return urls or None


_DEAL_RENT = ("للإيجار", "للايجار", "ايجار", "إيجار")
_DEAL_BUY = ("للبيع", "بيع")


def parse_deal(text: str) -> Optional[str]:
    """Rent/Buy from the listing's OWN «النوع:» field. No field -> None (never defaulted)."""
    v = spec(text, "النوع")
    if not v:
        return None
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


def parse_area(text: str):
    """Square metres, or None. A number without a unit is not an area and is never stored."""
    if not text:
        return None
    for m in _AREA_RE.finditer(text.translate(_AR_DIGITS)):
        raw = m.group(1).replace(",", "").rstrip(".")
        n = normalize.measure_num(raw)   # exact: «163.27 متر مربع» stays 163.27 (int(float()) kept 163)
        if n is None:
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
_CITY_FALLBACK_RE = re.compile("|".join(re.escape(c) for c in sorted(_CITIES, key=len, reverse=True)))


def parse_city(text: str, title: str = "") -> Optional[str]:
    """The city the source stated, or None. Never guessed — the fallback RECOGNISES a name from the
    closed Saudi city set; it does not infer one from a district or a landmark."""
    m = _CITY_RE.search(text)
    if m:
        return m.group(1).strip()
    m = _CITY_FALLBACK_RE.search(f"{title} {text[:600]}")
    return m.group(0) if m else None


# DISTRICT candidate — the map line, «… الملقا، الرياض السعودية … انظر الخريطة». It is only a
# CANDIDATE: on some listings that same slot holds the agent's own reference code («RFRA3688,
# 3688»), so the string is never stored as-is. It is handed to find_district_in_text(), which keeps
# it only when this city's curated catalog recognises it — a code can never survive that.
_MAP_RE = re.compile(r"([^:]{3,70}?)\s*\.{2,}\s*انظر\s*الخريطة")
_STATUS_LEAD = re.compile(r"^(?:غير\s+مؤجرة|مؤجرة|جديدة|جديد|أخرى|مستعملة)\s+")


def district_candidate(text: str) -> Optional[str]:
    m = _MAP_RE.search(text)
    if not m:
        return None
    v = _STATUS_LEAD.sub("", m.group(1).strip())
    v = v.split("،")[0].split(",")[0].strip()
    # an agent reference code is latin/digits, never a Saudi district name
    if not v or re.fullmatch(r"[A-Za-z0-9\s\-_]+", v):
        return None
    return v


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
_TITLE_TYPE_RE = re.compile(
    r"(شقق\s*سكنية|شقه|شقة|شقق|فلل|فيلا|فله|أراضي|اراضي|أرض|ارض|عمائر|عمارة|عماره|"
    r"محلات\s*تجارية|محلات|محل|مكاتب|مكتب|مستودعات|مستودع|استراحات|استراحة|استراحه|"
    r"مزارع|مزرعة|مزرعه|أدوار|دور|غرف|غرفه|غرفة|شاليهات|شاليه|بيوت|بيت|دبلكس|روف|برج)")

_TITLE_TYPE_AR = dict(_TYPE_AR, **{
    "شقه": "شقة", "فله": "فيلا", "عماره": "عمارة", "محل": "محل", "مكتب": "مكتب",
    "استراحه": "استراحة", "مزرعه": "مزرعة", "غرفه": "غرفة", "دبلكس": "دبلكس",
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
        return _TITLE_TYPE_AR.get(re.sub(r"\s+", " ", m.group(1)).strip())
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


def fetch_listings(s: cc.Session, limit: int = 0) -> list[dict]:
    """Every ad_post via REST. Pages until a short page, so the catalogue size is the source's."""
    out: list[dict] = []
    for page in range(1, 60):
        r = _get(s, f"{REST}/ad_post?per_page=100&page={page}"
                    f"&_fields=id,link,slug,title,content,class_list,date,modified")
        if r is None:
            if page == 1:
                return []
            break
        try:
            batch = r.json()
        except Exception:
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


# ── map ──────────────────────────────────────────────────────────────────────────────────────────
def map_listing(post: dict, page_text: str, page_html: str = "") -> tuple[Optional[dict], str]:
    link = post.get("link")
    if not link or not page_text:
        return None, "residential"

    title_early = _clean((post.get("title") or {}).get("rendered", ""))
    type_ar = parse_type_ar(page_text, title_early)
    if not type_ar:
        return None, "residential"          # unknown type is SKIPPED, never guessed
    property_type = normalize.map_type_exact(type_ar)
    if not property_type:
        return None, "residential"
    category = normalize.category_for_type(property_type).lower()

    deal = parse_deal(page_text)
    if not deal:
        return None, category               # no stated deal -> UNKNOWN, never defaulted to Buy

    city_ar = parse_city(page_text, title_early)
    if not city_ar:
        return None, category               # unlocatable rows cannot be searched honestly
    city = normalize.map_city(city_ar)
    city_id, region_id = to_catalog(city_ar)

    # The district is PROPOSED from the page and kept only if this city's curated catalog knows it.
    cand = district_candidate(page_text)
    title = _clean((post.get("title") or {}).get("rendered", ""))
    body = _clean((post.get("content") or {}).get("rendered", ""))
    district_ar = None
    if city_id:
        district_ar = (find_district_in_text(cand, city_id) if cand else None) \
            or find_district_in_text(f"{title} {body}", city_id)

    price = own_price(page_html, link)
    rent_period, price_annual = (None, None)
    if deal == "Rent":
        rent_period, price_annual = rent_period_and_annual(price, f"{title} {body} {page_text}")

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{int(hashlib.md5((post.get('slug') or str(post.get('id'))).encode()).hexdigest()[:12], 16)}",
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
        "neighborhood": cand,
        "area_m2": parse_area(page_text),
        "bedrooms": spec_int(page_text, "عدد الغرف", 0, 50),
        "bathrooms": spec_int(page_text, "دورة المياه", 0, 50)
                     or spec_int(page_text, "دورات المياه", 0, 50),
        "halls": spec_int(page_text, "عدد الصالات", 0, 20),
        "property_age": parse_age(page_text),
        "direction": parse_direction(page_text),
        "street_width_m": spec_measure(page_text, "عرض الشارع", 1, 120),
        "furnished": parse_furnished(page_text),
        "title": title or None,
        "photo_urls": own_photos(page_html),
    }
    if deal == "Rent":
        row["price_annual"] = price_annual
        if rent_period:
            row["rent_period"] = rent_period
    else:
        row["price_total"] = price

    extra: dict[str, Any] = {
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
        "price_published": price is not None,
    }
    row["additional_info"] = {k: v for k, v in extra.items() if v is not None}
    return row, category


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
        for i, p in enumerate(posts, 1):
            page_html = fetch_detail(s, p["link"])
            if not page_html:
                skipped["detail_unreachable"] = skipped.get("detail_unreachable", 0) + 1
                continue
            text = _txt(page_html)
            row, cat = map_listing(p, text, page_html)
            if not row:
                key = parse_type_ar(text) or "no_type_or_deal_or_city"
                skipped[key] = skipped.get(key, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            if i % 200 == 0:
                print(f"   … {i}/{len(posts)} pages read", flush=True)

        if skipped:
            # Printed EVERY run: a listing we refuse to guess at stays visible, or the platform
            # quietly shrinks and nobody knows why.
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1])))

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

        n = len(res) + len(com)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(posts), rows_upserted=n,
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


if __name__ == "__main__":
    raise SystemExit(main())
