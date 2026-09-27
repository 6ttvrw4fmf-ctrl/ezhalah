"""دار يوسف العقارية — daryusuf.com. 290 WordPress posts = 242 listings, onboarding 2026-09-24.

SOURCE SHAPE (probed live before any code — every number below is measured, not estimated):
  · A stock WordPress (Elementor + Codevz «Xtra» theme + Yoast) with an OPEN REST API and no
    challenge. Listings are NOT posts — /wp/v2/posts shows 1 — they are the theme's `portfolio`
    custom post type (the site's «أعمال» archive):
      GET /wp-json/wp/v2/portfolio?per_page=100&page=N  → x-wp-total: 290, x-wp-totalpages: 3
      GET /wp-json/wp/v2/portfolio_cat?per_page=100     → 31 terms: the deal AND the type live here
    The run compares distinct ids with x-wp-total and treats a shortfall as INCOMPLETE (rows are
    still upserted; nothing is pruned from an incomplete walk).

  · TWO LANGUAGES, TWO POSTS. 212 posts link under /en/portfolio/… (English) and 78 under
    /portfolio/… (Arabic); an Arabic listing usually also exists as a separate English post
    (9338 «شقة للإيجار في حي الإسكان» ↔ 9355 «Apartment for Rent, Al Iskan District»), sharing the
    featured image and the source's own ad number «(463)» printed at the top of the body. The two
    are ONE listing: posts are grouped by that ad number, else by featured_media; the Arabic post
    is the row (ARABIC FIRST) and its English twin is tallied `translation_twin`. MEASURED on the
    full walk: 290 posts → 242 listings (48 twins dropped; ad number 386 is one flat published as
    two English posts plus the Arabic one). 164 listings exist ONLY in English and keep their
    English text (types/cities still map to the Arabic canon); 78 rows are Arabic.

  · LISTING URL = the post's own `link` (both languages verified 200 with the listing's price
    heading; a bogus slug → real HTTP 404 «Page not found»).

  · CONTENT SHAPE (content.rendered, Elementor):
      <h2>…title…</h2> then <h2>30,000 ريال سنوي</h2> — the PRICE is the heading that carries a
      currency word. 13 spellings: «N ريال» 42, «N SAR» 94, «N SAR/ Year» 11, «N ريال سنوي» 6,
      «N ريال/سنوي» 6, «N SAR Per Year» 6, «N SAR per year» 6, «N riyals/per year» 2, «SAR N per
      year» 1 … The period is read ONLY from that heading's own words (سنوي / year → annual,
      شهري / month → monthly ×12); a heading with none («220,000 SAR» on a rent) falls back to a
      prose token bound to the rent word AND adjacent to that same figure («Annual Rent: 220,000
      SAR»); «Monthly rent: 4,000 SAR / Annual rent: 48,000 SAR» beside a 75,000 heading binds
      neither → NULL, unconverted. 109 posts have a single heading — it IS the price (the title
      sits elsewhere). A post with no currency heading stores no price; the one bare-figure
      heading («2800», id 8168) is stored as printed.
      «ue-txt» (Unfold widget) — the description. Starts with «(463)» / «(Off-408)»: the source's
      ad number → additional_info.source_ad_number (and the pairing key).
      «cz_working_hours» widget — label/value pairs, the structured facts, in either language
      and with drift: المساحة/Area/ِArea (a kasra prefix!)/Total Area/Plot Area; غرف النوم/Bedrooms/
      Total bedrooms; دورات المياه/Bathrooms/Restrooms; عمر العقار/Property Age/Building Age;
      عرض الشارع/Street Width/«Street width:»; الواجهة/Facade/Frontage/Front/Facing; الدور/Floor;
      الصالات/Living rooms/Halls; سعر المتر/Price per m²/Price per meter; Reception / Majlis rooms;
      Driver’s Room; نظام التكييف/Air conditioning system. Values: «190م», «400 m²», «20m», «+10
      Years»/«Over 10 years»/«More than 10 years» (open bounds → NULL), «Wast» (a typo → NULL),
      «Northwest» (two bearings → NULL), «Ground floor»/«ارضي» → 0.
      «cz_gallery» — full-size upload hrefs (Arabic filenames → percent-encoded; fetched one:
      200 image/jpeg).

  · CITY is stated in the TITLE («…، المدينة المنورة», «…, Madinah»/«Al Madinah»/«Medina»):
    closed-set recognition in both languages → the Arabic canon → to_catalog (المدينة المنورة 14,
    جدة 18, الرياض 3, مكة المكرمة 6, الطائف 5, مدينة الملك عبدالله الاقتصادية 3666 — all placed).
    A title naming no city → SKIP. The district is the title's own «حي X» phrase (find_district_in_
    text needs the phrase, not the comma-ridden title); an English «X District» keeps the text as
    the card's neighbourhood with district_ar NULL.

  · RESULT of the full walk (2026-09-24): 242 listings, 242 mapped (208 residential + 34
    commercial), 0 skipped besides the 48 twins; 112 rents → 103 annual, 2 monthly (8168's bare
    «2800» heading + «2800 SAR / Monthly» in prose), 3 no period; 4 warehouses print no price.

  · TRAPS met: «Furniture Auction» is a LANDMARK on 4354 (auction is judged on the title only);
    «مؤجرة بالكامل» on 3422 describes a building's tenants (closed deals are judged on the title
    only); «تقريباً» contains «قريباً» (off-plan is a whole-word match); 4 bodies carry a phone
    number → redact_pii; «Monthly rent: 4,000 SAR / Annual rent: 48,000 SAR» in one body is why
    the period comes from the price heading and never from prose.

REMOVAL ORACLE (measured 2026-09-24 on GET /wp-json/wp/v2/portfolio/<id>):
  gone — ids 9300, 9200, 9000 (not portfolio posts): HTTP 404 {"code":"rest_post_invalid_id"}.
  live — 9338, 9355, 9329: HTTP 200 {"id": <same>, "status": "publish"}.
  So: 404 + rest_post_invalid_id → GONE; 200 echoing our id with status publish → LIVE; a 200 with
  another status → GONE; anything else → no opinion. Prune runs only after a COMPLETE walk AND
  three rows parsed live this run answer LIVE through the same route (fails CLOSED).
"""
from __future__ import annotations

import argparse
import html as _html
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote, unquote

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii  # noqa: E402

BASE = "https://daryusuf.com"
REST = f"{BASE}/wp-json/wp/v2"
SOURCE = "دار يوسف العقارية"
PREFIX = "DYS"
PAUSE = 1.0
FIELDS = "id,link,slug,status,title,content,excerpt,date_gmt,modified_gmt,portfolio_cat,featured_media"


# ── transport ─────────────────────────────────────────────────────────────────────────────────────
def session() -> cc.Session:
    # impersonate OWNS the User-Agent — only Accept-* are ours.
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7"})
    return s


def fetch_terms(s: cc.Session) -> dict[int, str]:
    """portfolio_cat id → decoded slug («apartments-for-rent», «شقق-للإيجار»)."""
    r = s.get(f"{REST}/portfolio_cat", params={"per_page": 100, "_fields": "id,slug"}, timeout=60)
    if r.status_code != 200:
        raise RuntimeError(f"portfolio_cat: HTTP {r.status_code}")
    return {int(t["id"]): unquote(t["slug"]) for t in r.json() if isinstance(t, dict)}


def fetch_posts(s: cc.Session, limit: int = 0) -> tuple[list[dict], int]:
    """Every portfolio post. Returns (posts, x-wp-total). A non-JSON page raises."""
    out: dict[int, dict] = {}
    expected = 0
    for page in range(1, 100):
        r = s.get(f"{REST}/portfolio", params={"per_page": 100, "page": page, "_fields": FIELDS}, timeout=90)
        if r.status_code == 400 and page > 1:
            break                                   # rest_post_invalid_page_number past the end
        if r.status_code != 200:
            raise RuntimeError(f"portfolio page {page}: HTTP {r.status_code}")
        try:
            batch = r.json()
        except ValueError:
            raise RuntimeError(f"portfolio page {page}: not JSON") from None
        if page == 1:
            expected = int(r.headers.get("x-wp-total") or 0)
        if not isinstance(batch, list) or not batch:
            break
        for p in batch:
            if isinstance(p, dict) and p.get("id") is not None:
                out.setdefault(int(p["id"]), p)
        if limit and len(out) >= limit:
            return list(out.values())[:limit], expected
        if len(batch) < 100:
            break
        time.sleep(PAUSE)
    return list(out.values()), expected


# ── content readers ───────────────────────────────────────────────────────────────────────────────
def _strip_tags(h: Optional[str]) -> str:
    if not h:
        return ""
    t = re.sub(r"<style[^>]*>.*?</style>", " ", h, flags=re.S)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", _html.unescape(t).replace("\xa0", " ")).strip()


_HEAD_RE = re.compile(r"<h[12][^>]*>(.*?)</h[12]>", re.S)
_PRICE_HEAD_RE = re.compile(r"^(?:SAR\s*)?([\d][\d,\.]*)\s*(.*)$")
# «SAR» is case-SENSITIVE on purpose: «Al-Ansari», «Al-Sarkhasi» sit in title headings.
_CCY_RE = re.compile(r"ريال|SAR|﷼|(?i:riyal|per\s*year)")


def parse_price_heading(content: str) -> tuple[Optional[int], Optional[str], Optional[str]]:
    """(amount, period_token, heading_text) from the h1/h2 that starts with a figure and carries a
    currency word, else (None, None, None). The period is the HEADING's own word: سنوي / year →
    «سنوي», شهري / month → «شهري» (handed to the shared converter), anything else → None.
    ONE heading on the source (8168) is the bare figure «2800» — a bare number with no unit is
    stored as printed (owner rule 1); it is accepted only when no currency heading exists."""
    bare: tuple[Optional[int], Optional[str], Optional[str]] = (None, None, None)
    for h in _HEAD_RE.findall(content):
        text = _strip_tags(h)
        m = _PRICE_HEAD_RE.match(text)
        if not m:
            continue
        amount = normalize.to_int(m.group(1))
        if amount is None:
            continue
        if not _CCY_RE.search(text):
            if bare[0] is None and not m.group(2).strip():
                bare = (amount, None, text)
            continue
        tail = m.group(2).lower()
        period = "سنوي" if re.search(r"سنوي|year", tail) else "شهري" if re.search(r"شهري|month", tail) else None
        return amount, period, text
    return bare


# ── rent period from prose, bound to the rent word / the figure (only when the heading has none) ──
_PERIOD_TOKEN_RE = re.compile(
    r"(نصف\s*سنوي|ربع\s*سنوي|سنوي|شهري|يومي|أسبوعي|اسبوعي|semi[\s\-]*annual|annual|yearly|per\s*year|/\s*year"
    r"|monthly|per\s*month|/\s*month|daily|nightly|weekly)", re.I)
_ANCHOR_RE = re.compile(r"يجار|اجار|إجار|ريال|﷼|سعر|SAR|(?i:rent|riyal|price)")


def _canon_token(tok: str) -> str:
    t = re.sub(r"\s+", " ", tok.strip().lower())
    if re.search(r"semi", t):
        return "نصف سنوي"
    if re.search(r"annual|yearly|year", t):
        return "سنوي"
    if re.search(r"month", t):
        return "شهري"
    if re.search(r"daily|nightly", t):
        return "يومي"
    if re.search(r"weekly", t):
        return "أسبوعي"
    return t


def _figure_forms(price: Optional[int]) -> list[str]:
    if not price:
        return []
    forms = [f"{price:,}", str(price)]
    if price % 1000 == 0:
        k = price // 1000
        forms += [f"{k} الف", f"{k} ألف", f"{k}الف", f"{k}ألف", f"{k}k", f"{k} k"]
    return forms


def rent_period_stated(price: Optional[int], text: Optional[str]) -> tuple[Optional[str], Optional[int]]:
    """(rent_period, price_annual) from a period token the ad binds to its RENT or its CURRENCY,
    preferring the token adjacent to THIS row's figure («2800 SAR / Monthly», «Annual Rent:
    220,000 SAR»). Two different periods at the same rank («Monthly rent: 4,000 SAR Annual rent:
    48,000 SAR» with neither figure ours) → NULL, figure unconverted. The shared helper converts."""
    t = re.sub(r"\s+", " ", text or "")
    figs = _figure_forms(price)
    bound: list[tuple[str, bool]] = []
    for m in _PERIOD_TOKEN_RE.finditer(t):
        before, after = t[max(0, m.start() - 24):m.start()], t[m.end():m.end() + 16]
        if not (_ANCHOR_RE.search(before) or _ANCHOR_RE.search(after)):
            continue
        near = any(f in before or f in after for f in figs)
        bound.append((_canon_token(m.group(1)), near))
    if not bound:
        return None, price
    near = {tok for tok, n in bound if n}
    chosen = near or {tok for tok, _ in bound}
    if len(chosen) != 1:
        return None, price
    return normalize.rent_period_and_annual(price, chosen.pop())


_FACT_RE = re.compile(r'cz_wh_left"><b>(.*?)</b></span>(?:<span class="cz_wh_right">(.*?)</span>)?', re.S)
# label spellings actually seen (lower-cased, diacritics/colons stripped) → fact key
_LABELS = {
    "المساحة": "area", "area": "area", "total area": "area", "plot area": "area", "land area": "area",
    "غرف النوم": "bedrooms", "bedrooms": "bedrooms", "number of bedrooms": "bedrooms", "total bedrooms": "bedrooms",
    "دورات المياه": "bathrooms", "bathrooms": "bathrooms", "restrooms": "bathrooms",
    "عمر العقار": "age", "property age": "age", "building age": "age",
    "عرض الشارع": "street_width", "street width": "street_width",
    "الواجهة": "direction", "facade": "direction", "frontage": "direction", "front": "direction",
    "facing": "direction", "street frontage": "direction",
    "الدور": "floor", "floor": "floor",
    "الصالات": "halls", "living rooms": "halls", "halls": "halls",
    "سعر المتر": "ppm", "price per m²": "ppm", "price per square meter": "ppm", "price per meter": "ppm",
    "reception / majlis rooms": "majlis", "reception / majlis": "majlis", "reception/majlis": "majlis",
    "majlis rooms": "majlis",
    "driver’s room": "driver_room", "driver's room": "driver_room",
    "نظام التكييف": "ac", "air conditioning system": "ac", "air conditioning": "ac", "air conditioning type": "ac",
    "نوع العقار": "usage", "property type": "usage",
    "الفئة": "tenants", "category": "tenants",
    "عدد الشقق": "apartments", "number of apartments": "apartments",
    "عدد الغرف": "rooms_total", "number of rooms": "rooms_total", "total rooms": "rooms_total",
    "master bedrooms": "master_bedrooms",
}


def parse_facts(content: str) -> dict[str, str]:
    """{fact_key: value} from the theme's label/value widget; unknown labels land under their own
    (normalised) label so nothing the source states is dropped."""
    out: dict[str, str] = {}
    for label, value in _FACT_RE.findall(content):
        lab = re.sub(r"[ً-ْ:]", "", _strip_tags(label)).strip().lower()
        val = _strip_tags(value)
        if not lab or not val or val.lower() == lab:
            continue
        out.setdefault(_LABELS.get(lab, f"raw:{lab}"), val)
    return out


_AD_NO_RE = re.compile(r"\(\s*(?:Off[\s\-]*)?(\d{2,5})\s*\)")


def parse_description(content: str) -> tuple[Optional[str], Optional[str]]:
    """(description, source_ad_number) from the Unfold widget's text block."""
    m = re.search(r'class="ue-txt">(.*?)</div>\s*</div>\s*<div class="ue-btn-wrap"', content, re.S)
    text = _strip_tags(m.group(1)) if m else ""
    ad = _AD_NO_RE.search(text)
    return redact_pii(text) or None, ad.group(1) if ad else None


def parse_photos(content: str) -> list[str]:
    out: list[str] = []
    for u in re.findall(r'class="cz_grid_link[^"]*"[^>]*href="(https://daryusuf\.com/wp-content/uploads/[^"]+)"', content):
        u = quote(_html.unescape(u), safe=":/%?=&")
        if u not in out:
            out.append(u)
    return out


# ── value readers ─────────────────────────────────────────────────────────────────────────────────
_EN_OPEN_BOUND = re.compile(r"more\s*than|over|\+|أكثر\s*من", re.I)


def parse_age(raw: Optional[str]) -> Optional[int]:
    if not raw or _EN_OPEN_BOUND.search(raw) or re.search(r"شهر|أشهر|ونصف|month", raw, re.I):
        return None
    return normalize.exact_age(raw)


_EN_DIR = {"north": "شمال", "south": "جنوب", "east": "شرق", "west": "غرب"}
_FLOOR_WORDS = {"ارضي": 0, "أرضي": 0, "الارضي": 0, "الأرضي": 0, "ground": 0, "ground floor": 0,
                "first": 1, "second": 2, "third": 3, "اول": 1, "أول": 1, "ثاني": 2, "ثالث": 3}


def parse_direction(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    return normalize.one_direction(_EN_DIR.get(raw.strip().lower(), raw))


def parse_floor(raw: Optional[str]) -> Optional[int]:
    if not raw:
        return None
    t = raw.strip().lower()
    if t in _FLOOR_WORDS:
        return _FLOOR_WORDS[t]
    return normalize.to_int(t) if re.fullmatch(r"[\d٠-٩]{1,2}", t) else None


def parse_area(raw: Optional[str]) -> Optional[int]:
    """«190م», «400 m²», «2500» → int. «49,69م²» (id 9157) is a DECIMAL comma — exactly two digits
    after it and nothing before the unit — and reads 49, not the 4,969 m² a thousands reading would
    publish for a flat. Any other comma is a thousands separator, as everywhere in this source."""
    if not raw or not re.search(r"\d", raw):
        return None
    m = re.fullmatch(r"\s*(\d{1,3}),(\d{2})\s*[^\d,]*", raw)
    n = int(m.group(1)) if m else normalize.to_int(raw)
    return n if n and n > 0 else None


def _count(raw: Optional[str]) -> Optional[int]:
    if not raw or "+" in raw:
        return None
    return normalize.to_int(raw) if re.fullmatch(r"\s*[\d٠-٩]{1,3}\s*", raw) else None


# ── deal / type from the taxonomy slug ────────────────────────────────────────────────────────────
_TYPE_BY_HEAD = {
    "apartments": "Apartment", "buildings": "Building", "farms": "Farm", "floor": "Floor", "house": "Villa",
    "land": "Residential Land", "rest-house": "Rest House", "shops": "Shop", "villas": "Villa",
    "warehouse": "Warehouse", "offices": "Office",
    "أراضي": "Residential Land", "استراحة": "Rest House", "دور": "Floor", "شقق": "Apartment",
    "عمائر": "Building", "فلل": "Villa", "محلات": "Shop", "مزارع": "Farm", "مستودع": "Warehouse", "مكاتب": "Office",
}


def deal_and_type(slug: str) -> tuple[Optional[str], Optional[str]]:
    deal = "Rent" if re.search(r"-for-rent$|-للإيجار$|-للايجار$", slug) else \
           "Buy" if re.search(r"-for-sale$|-للبيع$", slug) else None
    head = re.sub(r"-for-(rent|sale)$|-لل(إيجار|ايجار|بيع)$", "", slug)
    return deal, _TYPE_BY_HEAD.get(head)


# Six posts carry NO category at all (3788…3823); their titles still state both facts the way
# every other title does («Building for sale in …», «شقة للإيجار في …»). Exact head words only.
_TITLE_DEAL_RE = re.compile(r"^(?P<head>.+?)\s+(?P<deal>for\s+sale|for\s+rent|للبيع|للإيجار|للايجار)\b", re.I)
_TITLE_TYPE_EN = {"residential land": "Residential Land", "commercial land": "Commercial Land",
                  "rest house": "Rest House", "offices": "Office", "office": "Office"}


def deal_and_type_from_title(title: str) -> tuple[Optional[str], Optional[str]]:
    m = _TITLE_DEAL_RE.match(title.strip())
    if not m:
        return None, None
    deal = "Buy" if re.search(r"sale|بيع", m.group("deal"), re.I) else "Rent"
    head = m.group("head").strip()
    t = _TITLE_TYPE_EN.get(head.lower()) or normalize.map_type_en(head) or normalize.map_type_exact(head)
    return deal, t


# ── city from the title ───────────────────────────────────────────────────────────────────────────
_CITY_WORDS = {
    "المدينة المنورة": "المدينة المنورة", "المدينة": "المدينة المنورة", "Madinah": "المدينة المنورة",
    "Al-Madinah": "المدينة المنورة", "Al Madinah": "المدينة المنورة", "Medina": "المدينة المنورة",
    "Medinah": "المدينة المنورة",
    "جدة": "جدة", "Jeddah": "جدة", "الرياض": "الرياض", "Riyadh": "الرياض",
    "مكة المكرمة": "مكة المكرمة", "مكة": "مكة المكرمة", "Makkah": "مكة المكرمة", "Mecca": "مكة المكرمة",
    "الطائف": "الطائف", "Taif": "الطائف", "ينبع": "ينبع", "Yanbu": "ينبع", "رابغ": "رابغ", "Rabigh": "رابغ",
    "مدينة الملك عبدالله الاقتصادية": "مدينة الملك عبدالله الاقتصادية",
    "King Abdullah Economic City": "مدينة الملك عبدالله الاقتصادية",
}
_CITY_RE = re.compile("|".join(re.escape(w) for w in sorted(_CITY_WORDS, key=len, reverse=True)))
_DISTRICT_AR_RE = re.compile(r"حي\s+([ء-ي]+(?:\s+[ء-ي]+){0,2})")
_DISTRICT_EN_RE = re.compile(r"((?:Al[\s\-]?)?[A-Z][A-Za-z\-']+(?:\s+[A-Z][A-Za-z\-']+){0,2})\s+[Dd]istrict")


def city_in_title(title: str) -> Optional[str]:
    m = _CITY_RE.search(title)
    return _CITY_WORDS[m.group(0)] if m else None


# ── mapping ───────────────────────────────────────────────────────────────────────────────────────
_AUCTION_TITLE_RE = re.compile(r"مزاد|\bauction\b", re.I)
_CLOSED_TITLE_RE = re.compile(r"تم\s*البيع|تم\s*الإيجار|تم\s*الايجار|مباع(?![ء-ي])|مؤجر(?![ء-ي])|\bsold\b|\brented\b", re.I)
_OFFPLAN_TITLE_RE = re.compile(r"على\s*الخارطة|(?<![ء-ي])قريب[اً]+(?![ء-ي])|off[\s\-]plan|coming\s*soon", re.I)


def map_listing(post: dict, terms: dict[int, str]) -> tuple[Optional[dict], str, str]:
    if post.get("id") is None:
        return None, "residential", "no_id"
    if (post.get("status") or "").lower() != "publish":
        return None, "residential", f"status_{post.get('status')}"
    title = _strip_tags((post.get("title") or {}).get("rendered"))
    if _AUCTION_TITLE_RE.search(title):
        return None, "residential", "auction"
    if _CLOSED_TITLE_RE.search(title):
        return None, "residential", "sold_or_rented"
    if _OFFPLAN_TITLE_RE.search(title):
        return None, "residential", "off_plan"

    slugs = [terms.get(int(t), "") for t in (post.get("portfolio_cat") or [])]
    deal, property_type = None, None
    for sl in slugs:
        d, t = deal_and_type(sl)
        deal, property_type = deal or d, property_type or t
    if not slugs:
        deal, property_type = deal_and_type_from_title(title)
    if not deal:
        return None, "residential", "deal_unknown"
    content = (post.get("content") or {}).get("rendered") or ""
    facts = parse_facts(content)
    if property_type == "Residential Land" and (re.search(r"تجاري|commercial", title, re.I)
                                                or "تجاري" in facts.get("usage", "").lower()
                                                or "commercial" in facts.get("usage", "").lower()):
        property_type = "Commercial Land"
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()
    is_land = property_type in ("Residential Land", "Commercial Land")

    city_ar = city_in_title(title)
    if not city_ar:
        return None, category, "city_not_stated"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"
    is_en = "/en/" in (post.get("link") or "")
    dm = _DISTRICT_AR_RE.search(title) or _DISTRICT_EN_RE.search(title)
    hood = dm.group(0).strip() if dm else None
    district_ar = find_district_in_text(dm.group(0), city_id) if dm and not is_en else None

    amount, period_tok, price_text = parse_price_heading(content)
    description, source_ad = parse_description(content)
    photos = parse_photos(content)
    ac = facts.get("ac")

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{int(post['id'])}",
        "listing_url": post["link"],
        "source": SOURCE,
        "active": True,
        "title": title or None,
        "description": description,
        **normalize.amenities_from_text(description),
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": hood,
        "area_m2": parse_area(facts.get("area")),
        "bedrooms": None if is_land else _count(facts.get("bedrooms")),
        "bathrooms": None if is_land else _count(facts.get("bathrooms")),
        "halls": None if is_land else _count(facts.get("halls")),
        "reception_rooms_majlis": None if is_land else _count(facts.get("majlis")),
        "floor_number": None if is_land else parse_floor(facts.get("floor")),
        "property_age": parse_age(facts.get("age")),
        "street_width_m": normalize.one_street_width(facts.get("street_width")),
        "direction": parse_direction(facts.get("direction")),
        "price_per_meter": normalize.to_int(facts["ppm"]) if facts.get("ppm") and re.search(r"\d", facts["ppm"]) else None,
        "license_number": normalize.ad_licence_from_prose(description),
        "photo_urls": photos[:20] or None,
    }
    if ac:
        # A stated negation ("بدون تكييف") must land False, not NULL — an if-only True assignment
        # can structurally never produce False (reviewer-confirmed 2026-09-24).
        row["air_conditioner"] = not re.search(r"بدون|لا يوجد|none|without", ac, re.I)
    driver_room_count = _count(facts.get("driver_room"))
    if driver_room_count is not None:
        row["driver_room"] = driver_room_count > 0  # a stated "0" is a fact, not silence

    if deal == "Buy":
        row["price_total"] = amount
    else:
        # PERIOD = SOURCE: the price heading's own word first; else a prose token bound to the rent
        # word and adjacent to this figure; else NULL with the figure unconverted.
        if period_tok:
            row["rent_period"], row["price_annual"] = normalize.rent_period_and_annual(amount, period_tok)
        else:
            row["rent_period"], row["price_annual"] = rent_period_stated(amount, description)
    ev = normalize.price_evidence(field="price heading (h2)", raw=price_text, stored=amount,
                                  kind=(row.get("rent_period") or "total") if deal == "Rent" else "total",
                                  unit="total", origin="structured")

    row["additional_info"] = {k: v for k, v in {
        "language": "en" if is_en else "ar",
        "source_ad_number": source_ad,
        "category_slugs": slugs or None,
        "price_evidence": ev,
        "facts": {k: v for k, v in facts.items()} or None,
        "published_at": post.get("date_gmt"),
        "modified_at": post.get("modified_gmt"),
        "featured_media": post.get("featured_media") or None,
        "photo_count": len(photos) or None,
    }.items() if v is not None}
    return row, category, ""


def dedupe_translations(posts: list[dict]) -> tuple[list[dict], int]:
    """One row per listing: group by the source's own ad number, else by featured image; the
    Arabic post wins. Returns (kept, twins_dropped)."""
    def key(p):
        _, ad = parse_description((p.get("content") or {}).get("rendered") or "")
        return f"ad:{ad}" if ad else (f"media:{p['featured_media']}" if p.get("featured_media") else f"id:{p['id']}")
    groups: dict[str, list[dict]] = {}
    for p in posts:
        groups.setdefault(key(p), []).append(p)
    kept, dropped = [], 0
    for grp in groups.values():
        ar = [p for p in grp if "/en/" not in (p.get("link") or "")]
        chosen = (ar or grp)[0]
        kept.append(chosen)
        dropped += len(grp) - 1
    return kept, dropped


# ── liveness ──────────────────────────────────────────────────────────────────────────────────────
def _signal_for(pid: int):
    def _signal(status, body, _moved):
        try:
            j = json.loads(body)
        except (ValueError, TypeError):
            return None
        if not isinstance(j, dict):
            return None
        if status == 404 and j.get("code") == "rest_post_invalid_id":
            return "gone"
        if status != 200 or j.get("id") != pid:
            return None
        return "live" if (j.get("status") or "").lower() == "publish" else "gone"
    return _signal


def _verify_gone(ad_number: str) -> tuple[str, str]:
    pid = ad_number[len(PREFIX):]
    if not pid.isdigit():
        return "unknown", f"{ad_number!r} is not a {PREFIX}<post id> ad number"
    return LivenessProbe(platform="daryusuf", signal=_signal_for(int(pid)), session=session,
                         url_for=lambda _a: f"{REST}/portfolio/{pid}?_fields=id,status").verify_gone(ad_number)


def _controls_live(ad_numbers: list[str]) -> bool:
    """In-run positive control: three rows parsed live THIS run must answer LIVE through the same
    oracle, else the transport may not testify about anyone's absence. Fails closed."""
    if len(ad_numbers) < 3:
        return False
    for ad in ad_numbers[:3]:
        verdict, why = _verify_gone(ad)
        if verdict != "live":
            print(f"  ⚠ oracle control {ad} answered {verdict} ({why}) — prune withheld", flush=True)
            return False
        time.sleep(PAUSE)
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("daryusuf")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    posts: list[dict] = []
    try:
        terms = fetch_terms(s)
        posts, expected = fetch_posts(s, limit=args.limit)
        if not posts:
            raise RuntimeError("/wp/v2/portfolio answered 0 posts — treated as blocked, not empty")
        complete = not args.limit and len(posts) == expected
        kept, twins = dedupe_translations(posts)
        if twins:
            skipped["translation_twin"] = twins
        print(f"{SOURCE}: {len(posts)} posts (x-wp-total {expected}) → {len(kept)} listings"
              f"{'' if complete else ' — INCOMPLETE walk, prune withheld'}", flush=True)
        for p in kept:
            row, cat, why = map_listing(p, terms)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print("  skipped (not guessed): " + notes)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>8} {r0['transaction_type']:4} {str(r0['property_type']):16} "
                      f"{str(r0['city_ar']):14} d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>6} "
                      f"bd={str(r0['bedrooms']):>4} pt={r0.get('price_total')} pa={r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} ppm={r0.get('price_per_meter')} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0

        # The public upsert_daryusuf_*_batch wrappers are added centrally later; this is the same
        # shared batch writer they will wrap.
        db._wasalt_batch("daryusuf_residential_listings", res)
        db._wasalt_batch("daryusuf_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="daryusuf_residential_listings", com_table="daryusuf_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        # PRUNE — only after a COMPLETE walk (distinct ids == x-wp-total; --limit never reaches
        # here; a --type run leaves the other table's seen-set empty by construction) and only once
        # the in-run positive control passed. prune_unseen's own breakers sit on top.
        pruned = 0
        if args.type == "all" and complete and _controls_live([r["ad_number"] for r in res + com]):
            for tbl, rows in (("daryusuf_residential_listings", res), ("daryusuf_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=_verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=len(posts), rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned}; walk={len(posts)}/{expected}; {notes}"[:300],
                             degraded=not complete,
                             check_tables=["daryusuf_residential_listings", "daryusuf_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            tally = ";".join(f"{k}={v}" for k, v in skipped.items())
            db.end_run(run_id, ok=False, rows_seen=len(posts), rows_upserted=0,
                       notes=f"{e}"[:200] + (f" | skips: {tally}" if tally else ""))
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
