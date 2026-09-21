"""مؤسسة المتمكنة للعقارات — almotmkenah.com. 361 ads indexed, 22 LIVE. Onboarding 2026-09-20.

SOURCE SHAPE (probed live over all 361 detail pages before any code was written):

  · A hand-rolled Laravel site, server-rendered. No sitemap, no wp-json, no API: `/sitemap.xml`,
    `/wp-sitemap.xml` and `/wp-json/wp/v2/types` all 404 into the site's own 200-shaped HTML shell.

  · THE INDEX IS `/search/`, NOT the category pages. `/category/<name>` renders only the ads that
    are still LIVE — 22 of them, 1 page, no paginator, and `?page=2` on a category returns 200 with
    zero cards. `/search/?category=0&city=0&page=N` paginates the WHOLE catalogue 12 per page and
    runs out at page 31: 361 distinct `/annonce/…` URLs, byte-identical to the union of the eight
    per-category searches (`category=6|19|21|22|23|25|27|28`). Crawling the category pages instead
    would have shipped a platform that looked complete at 22 rows and could never notice the other
    339. `/page/N` is the FEATURED-ads carousel (1 ad per page, 404 at 6) — not an index.

  · THE SLUG'S TRAILING NUMBER IS NOT THE AD ID. `/annonce/<title>-<n>` repeats n across different
    ads: `…منفوحة_الجديدة-35` and `…المساحة_483-35` are two unrelated listings, and `-17` collides
    the same way. Keying on it would have merged live ads into one row. The real id is the contact
    modal's hidden field, `<input type="hidden" name="d" value="409">` — measured unique and
    present on 361/361 pages (361 distinct values, 0 missing, 0 duplicated).

  · 339 OF 361 ARE ARCHIVED. The detail page carries the source's own verdict as
    `<p class="bg-danger text-danger">هذا الاعلان لم يعد صالح تم نقله للأرشيف.</p>` — "no longer
    valid, moved to the archive". Those are skipped. That banner is the ONLY status oracle used:
    prose sold-words are NOT one. Live ad MTM390 («مشروع اربع فلل») says «الدور الأول في كل الفلل
    مباع بالكامل» — only the first floors of a four-villa project are sold, five units remain and
    the ad publishes 890,000 for one of them. A «مباع»/«تم بيع» keyword skip would have deleted a
    live listing, which is the mistake [[feedback_completed-projects-are-real-listings]] records.

  · EVERY VALUE COMES FROM ONE OF TWO PLACES, and both are scoped to the ad's OWN block. The page
    continues into «اعلانات مماتلة» (6 related ads, each with its own city, price and thumbnail) and a
    footer «الإعلانات المتميزة» with a seventh. Measured honestly: those blocks use `<div
    class="price">` and CSS `background-image`, so parsing the WHOLE page changes nothing on any of
    the 361 pages today — the scoping is a boundary held in advance, not a bug being fixed, and one
    `<b>` in that template is all it would take. Every parse runs on the slice from
    `annonce_header_info` to the first of those two markers.
      - the header strip: «المدينة: الرياض», «تاريخ الادخال», «آخر تحديث», «المشاهدات»
      - a `<b>label</b> value` grid of 24 optional labels, measured across all 361 ads:
        السعر 270 · السومة 90 · المساحة 50 · عرض الشارع 45 · حدود وأطوال العقار 43 ·
        رقم المخطط 38 · نوع العقار 36 · واجهة العقار 34 · نوع إستخدام العقار 30 · رقم الأرض 26 ·
        موقع العقار 15 · إسم الحي 12 · إسم المنطقة 11 · سعر متر البيع 6 · تاريخ البناء 4 ·
        عدد الوحدات 3 · رقم الدور 3 · عدد الغرف 3 · مؤثث 3 · المطبخ 3 · نوع الغرف 2 ·
        سعر الإيجار 1 · رقم الوحدة 1 · مرافق 1

  · PRICE. The money figure is whichever of السعر / السومة / سعر الإيجار the ad sets, and it is the
    same figure the site prints on its own search card — verified card-by-card against
    `/search/?page=1..3`, including the odd ones («0 ر.س», «2,000 ر.س», «335,225,000 ر.س»). So it
    is stored EXACTLY, at any magnitude ([[feedback_no-hiding-source-published-prices-rule]]: a
    plausibility gate is a regression). Two shapes are not prices:
      - `0` is an unset field, not a published figure → NULL (2 of the 22 live ads are like this).
      - a figure the source ITSELF labels per-metre. MTM202 prints «السعر : 3,690 ر.س» and
        «سعر متر البيع : 3690» — the same number, and the label says متر. Storing 3,690 as a total
        for a 1,247 m² plot is not fidelity, it is a unit error. When the two agree, the rate goes
        to `price_per_meter`, `price_total` stays NULL, and the search layer derives the shown total
        ([[feedback_ppm-times-area-becomes-a-shown-searchable-total]] — the derivation lives in
        `search_listings_ar.price_total_effective`, NOT here; `price_total` still means "the source
        said this"). No arithmetic is done in this scraper.
    Prose prices are deliberately NOT parsed. The bodies carry «السوم», «الحد», «البيع» and
    «٢٦.٥٠٠ ريال للمتر» side by side — bids, ceilings, asks and per-metre rates — and MTM403 shows
    why the field is enough: the body says «السوم ٢٦.٥٠٠ ريال للمتر» over «مساحة البلك ١٢٦٥٠ متر»
    and the site has already published the product, 335,225,000, in the السومة field.

  · RENT. One ad in 361 has «سعر الإيجار» and it states no period, so `rent_period` is NULL and the
    figure is stored as published. The period is only ever read from the source's own token via
    normalize.rent_period_and_annual().

  · ARABIC-INDIC NUMERALS are everywhere in the prose (87 of 361 pages) — «مساحة البلك ١٢٦٥٠ متر»,
    «المساحه :٢٤٢٦». normalize.to_int() already folds ٠-٩, so every number this module reads goes
    through it rather than through int().

  · CITY. The header city is a closed 9-value list and «غير محدد» (unspecified) is one of them —
    19 ads, including one live ad whose own title says «الخبر». `_city_from_title()` recovers that
    case and ONLY that case, by requiring exactly one catalog city name in the TITLE; two matches
    («… شرق الرياض (مخططات طريق الدمام القديمة)») is an ambiguity and skips. The body is never used:
    «طريق الدمام» appears in Riyadh ads constantly.

  · PROPERTY TYPE is in the title for 325 of 361 ads (the نوع العقار field is set on only 36), so
    `_type_from_text()` scans an ordered token table. It cannot be normalize.map_type()'s substring
    pass: that map is insertion-ordered with «دور» ahead of «معرض», so «معرض سيارات دورين جاهز
    للبيع» maps to Floor. Here «دور» is matched last and only as a whole word.
"""
from __future__ import annotations

import argparse
import html as _html
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402

BASE = "https://almotmkenah.com"
SOURCE = "Almotmkenah"
PREFIX = "MTM"
INDEX = f"{BASE}/search/"

# The source's own "no longer valid" banner. This is the ONLY retirement oracle (see docstring).
ARCHIVE_MARK = "تم نقله للأرشيف"
# The ad's own block ends at the first of these; everything after belongs to OTHER ads.
FOREIGN_BLOCK_MARKS = ("اعلانات مماتلة", "الإعلانات المتميزة")

# Per-run id → (verdict, evidence) for prune_unseen's oracle. Filled by the crawl; see _verify_gone.
_STATUS: dict[str, tuple[str, str]] = {}


def session() -> cc.Session:
    # impersonate OWNS the User-Agent — setting one contradicts the TLS fingerprint
    # ([[feedback_impersonate_owns_the_user_agent]]), so only language is set here.
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


# ── parsing ───────────────────────────────────────────────────────────────────────────────────────

def _strip(raw: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", raw)).strip()


def _own_block(page: str) -> str:
    """The slice of the page that belongs to THIS ad. Empty string if the marker is missing."""
    start = page.find("annonce_header_info")
    if start < 0:
        return ""
    end = min([i for i in (page.find(m) for m in FOREIGN_BLOCK_MARKS) if i > start] or [len(page)])
    return page[start:end]


def parse_detail(page: str) -> Optional[dict]:
    """Every raw fact of one ad, read only from the ad's own block. Pure — the barrier feeds it
    saved HTML. Returns None when the page is not an ad page at all."""
    block = _own_block(page)
    if not block:
        return None
    ad_id = re.search(r'name="d"\s+value="(\d+)"', page)
    if not ad_id:
        return None

    fields: dict[str, str] = {}
    for m in re.finditer(r"(?s)<b>(.*?)</b>\s*([^<]*)", block):
        label = _strip(m.group(1)).strip(":").strip()
        value = re.sub(r"\s+", " ", m.group(2)).strip()
        if label and value:
            fields[label] = value

    # <br>-separated prose: keep the line breaks so a label regex can't run across two lines.
    body = re.search(r'(?s)<div class="details"[^>]*>\s*<p>(.*?)</p>', block)
    description = _strip(re.sub(r"<br\s*/?>", "\n", body.group(1)).replace("\n", "\v")) \
        .replace("\v", "\n") if body else None

    title = re.search(r"(?s)<h1>(.*?)</h1>", page)
    city = re.search(r"المدينة:\s*([^<\n]+)", block)
    # The gallery's own <a href> links, and nothing else. The card thumbnails that appear elsewhere on
    # the page are CSS `background-image` on a NEIGHBOUR's card («…_annonce_841_small.jpeg»), and the
    # site's fallback frame is `/img/image_default.png` — neither is under /storage/image/ inside an
    # href, so neither can enter this list. Measured: 69 of the site's own cards show that fallback
    # and every one of those ads really has an empty gallery.
    photos, seen = [], set()
    for m in re.finditer(r'href="([^"]*?/storage/image/[^"]+)"', block):
        u = _html.unescape(m.group(1))
        if u in seen:
            continue
        seen.add(u)
        photos.append(u)

    return {
        "ad_id": ad_id.group(1),
        "archived": ARCHIVE_MARK in block,
        "title": _strip(title.group(1)) if title else None,
        "city_raw": city.group(1).strip() if city else None,
        "description": (description or None),
        "fields": fields,
        "photo_urls": photos[:20],
        "date_added": (fields_date := re.search(r"تاريخ الادخال:\s*([\d/\-]+)", block)) and
        fields_date.group(1),
        "last_update": (lu := re.search(r"آخر تحديث:\s*([^<\n]+)", block)) and lu.group(1).strip(),
    }


# Ordered longest/most-specific first; «دور» is LAST and whole-word only (see docstring).
_TYPE_TOKENS: tuple[tuple[str, str], ...] = (
    # «بلك» FIRST: on this source a بلك is always a block of land, and its ads advertise what could
    # be BUILT on it. MTM404 — «راس بلك … مساحته 4000م عدد 4 قطع مناسبه 8 فلل» — is four raw plots,
    # and reading «فلل» as the type made a 4,000 m² land block a Villa.
    (r"(?<![\u0621-\u064A])(?:ال)?بلك(?![\u0621-\u064A])", "__LAND__"),
    (r"استراح(?:ه|ة)|إستراح(?:ه|ة)", "استراحة"),
    (r"شاليه(?:ات)?", "شاليه"),
    (r"محطة\s*بنزين", "محطة بنزين"),
    (r"مزرع(?:ه|ة)|أرض\s*زراعية|ارض\s*زراعية|زراعي(?:ة|ه)?", "مزرعة"),
    (r"مستودع", "مستودع"),
    (r"مصنع", "مصنع"),
    (r"ورش(?:ه|ة)", "ورشة"),
    # «فندقي» is an ADJECTIVE — «شقة استوديو فندقي قرب الحرم» is a hotel-style studio, not a hotel.
    (r"فندق(?![يى])", "فندق"),
    (r"مع(?:ا)?رض", "معرض"),   # «معارض» must match here: the bare «ارض» below is INSIDE it
    (r"مكتب", "مكتب"),
    (r"محل(?:ات)?", "محل"),
    (r"عمار(?:ه|ة)|عمائر", "عمارة"),
    (r"د(?:و)?بل(?:و|ي)?كس", "دوبلكس"),   # measured spellings: دوبلكس · دوبليكس · دبلوكس
    (r"ا?ستوديو", "استوديو"),
    (r"قصر", "قصر"),
    (r"ف(?:يلا|يلتين|ل(?:ه|ة)|لل|لتين)", "فيلا"),
    (r"بيت|منزل|حوش", "بيت"),
    (r"شق(?:ة|ه|تين|ق)", "شقة"),
    (r"مخيم", "مخيم"),
    (r"غرف(?:ه|ة)", "غرفة"),
    # No bare «بلك» here — it is matched above, with the word boundary that keeps it out of «دوبلكس».
    (r"أرض|ارض|أراضي|اراضي|قطع(?:ة|ه)?", "__LAND__"),
    (r"(?<![\u0621-\u064A])دور(?![\u0621-\u064A])", "دور"),
)
_COMMERCIAL_USE_RE = re.compile(r"تجاري(?:ة|ه)?")
_RESIDENTIAL_USE_RE = re.compile(r"سكني(?:ة|ه)?")

# A structure the ad mentions as a NEIGHBOUR or as something standing ON a plot is not the thing
# being sold. Measured: «ارض … مقام عليها استراحة» typed as Rest House, «ارض مجزأه … وعليها غرفه»
# as Room, «شقه … بجوار فندق الجوهرة» as Hotel. Same distinction amenities_from_text draws when it
# refuses «قريب من حديقة» — the neighbourhood's park is not this unit's garden.
_FOREIGN_MENTION_RE = re.compile(
    r"(?:مقام\s*علي(?:ها|ه)|و?علي(?:ها|ه)|بجوار|مقابل|قريب(?:ة|ه)?\s*من|قرب|خلف|[أا]مام|بين)"
    r"\s+\S+")


def _type_from_text(*texts: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """(canonical type, the Arabic token it was read from). First token wins, in table order."""
    joined = _FOREIGN_MENTION_RE.sub(" ", " ".join(t for t in texts if t))
    if not joined:
        return None, None
    for pattern, token in _TYPE_TOKENS:
        m = re.search(pattern, joined)
        if not m:
            continue
        if token == "__LAND__":
            # A plot's category is the USE the source states, never the plot word.
            if _COMMERCIAL_USE_RE.search(joined) and not _RESIDENTIAL_USE_RE.search(joined):
                token = "أرض تجارية"
            else:
                token = "أرض"
        return normalize.map_type_exact(token), token
    return None, None


# OFFER FORMS ONLY. «مؤجر / موجر / الدخل السنوي / ايجارها ٢٢ الف» are a SALE ad quoting the rental
# income it already earns, and «الايجار» appears inside «للبيع أو الايجار». Measured: matching those
# flipped MTM408 — «للبيع عمارة مميزة … 1,430,000» — to Rent, which would have put a 1.43m sale price
# into price_annual and shown it as a yearly rent. A deal is read only from the لـ offer form.
# «البيع» («الحد البيع / 1,150,000», «السوم … البيع ٣٢٠») is the source stating a sale and is the only
# deal signal MTM405 carries. It is safe where the rent words were not: a rent ad says «للايجار», and
# «السعر» is NOT a sale marker on this source — measured, two archived rent ads price under «السعر».
_BUY_RE = re.compile(r"للبيع|البيع|للتنازل")
_RENT_RE = re.compile(r"لل[إأا]?يجار|للتأجير|للتاجير|للأجار")
_AUCTION_RE = re.compile(r"مزاد")


def _first_deal(text: str) -> Optional[str]:
    """Whichever offer form the source states FIRST. «للبيع أو الايجار شقة» is offered as both, and
    the ad leads with the one it means; picking Rent because the rent test ran first is a coin toss
    dressed up as a rule."""
    b = _BUY_RE.search(text)
    r = _RENT_RE.search(text)
    if b and r:
        return "Buy" if b.start() <= r.start() else "Rent"
    return "Buy" if b else ("Rent" if r else None)


def _deal_from(fields: dict, title: Optional[str], description: Optional[str]) -> Optional[str]:
    """Buy/Rent only when the source says so. Never defaulted — a wrong deal hides the ad from
    every search on the other side of the toggle."""
    if "سعر الإيجار" in fields:
        return "Rent"
    use = fields.get("نوع إستخدام العقار") or ""
    # «السومة» is the current BID on a sale, so its presence is the source stating a sale. It is
    # what carries MTM404 («الارض على السوم», no offer word anywhere in the ad).
    return (_first_deal(f"{title or ''}\n{use}")
            # The title may be a bare description («ارض زاوية مخطط 3217 منح شرق الرياض»); the body's
            # own opening clause then carries it («للبيع ارض في منح شرق الرياض»).
            or _first_deal(description or "")
            or ("Buy" if "السومة" in fields else None))


def _money(raw: Optional[str]) -> Optional[int]:
    """A published figure, or None. 0 is an unset field, not a price."""
    n = normalize.to_int(raw)
    return n if n else None


def _price_from_fields(fields: dict) -> tuple[Optional[int], Optional[int], Optional[str]]:
    """(total, per-metre rate, why the price slot held a rate) — from the ad's own money fields only.

    The three money labels are mutually exclusive on this source (measured: 0 of 361 ads set more
    than one), and whichever one is set is the figure the site prints on its own search card. So it
    is passed through at whatever magnitude the source published
    ([[feedback_no-hiding-source-published-prices-rule]]).

    The one figure that is NOT a total is one the source ITSELF labels per-metre: MTM202 prints
    «السعر : 3,690 ر.س» and «سعر متر البيع : 3690» — the same number under a متر label, on a
    1,247 m² plot. That is a unit read from the source, not a plausibility judgement about the
    number's size. The rate goes to price_per_meter and the total stays NULL; the ×area derivation
    belongs to `search_listings_ar.price_total_effective`, never to a scraper
    ([[feedback_ppm-times-area-becomes-a-shown-searchable-total]]).
    """
    ppm = _money(fields.get("سعر متر البيع"))
    figure = (_money(fields.get("السعر")) or _money(fields.get("السومة"))
              or _money(fields.get("سعر الإيجار")))
    if ppm and figure == ppm:
        return None, ppm, f"the source labels this same figure per-metre: سعر متر البيع = {ppm}"
    return figure, ppm, None


# «المساحة 96 ألف م²» — the word numeral is part of the figure, not noise. Dropping it stored 96 for
# a 96,000 m² plot ([[feedback_arabic-notation-parity-in-deterministic-parsers]]).
_WORD_SCALE = {"ألف": 1000, "الف": 1000, "آلاف": 1000, "الاف": 1000, "مليون": 1_000_000}
_AREA_RE = re.compile(
    r"(?:المساحة|المساحه|مساحة|مساحه|مساحت(?:ه|ها))"
    r"\s*(?:الارض|الأرض|البلك|العقار|الكلية|الكليه|الاجمالية|الإجمالية)?"
    r"\s*:?\s*[-–—]?\s*([\d٠-٩][\d٠-٩.,]*)\s*(ألف|الف|آلاف|الاف|مليون)?")


def _area(fields: dict, description: Optional[str]) -> Optional[int]:
    """The المساحة field; else the body's own «المساحة: N» statement. Both are the source stating an
    area — neither is derived from the dimensions («25*36»), which would be arithmetic.

    A body that states SEVERAL different areas is not stating this ad's area: MTM407 offers four raw
    plots («96 ألف», «43 ألف», «59 ألف», «37 الف») under one price field, so any one of them on the
    card would be a fabrication. More than one distinct figure → NULL.
    """
    n = _money(fields.get("المساحة"))
    if n:
        return n
    found = set()
    for m in _AREA_RE.finditer(description or ""):
        n = normalize.to_int(m.group(1))
        if n:
            found.add(n * _WORD_SCALE.get(m.group(2) or "", 1))
    return found.pop() if len(found) == 1 else None


_CITY_TOKENS = sorted(normalize.CITY_MAP_AR, key=len, reverse=True)


def _city_from_title(title: Optional[str]) -> Optional[str]:
    """Used ONLY when the source's city field is «غير محدد». Exactly one catalog city named in the
    TITLE, or nothing — two names is an ambiguity, and the body is never read (see docstring)."""
    if not title:
        return None
    hits = {normalize.CITY_MAP_AR[c] for c in _CITY_TOKENS if c in title}
    if len(hits) != 1:
        return None
    en = hits.pop()
    return next(c for c in _CITY_TOKENS if normalize.CITY_MAP_AR[c] == en and c in title)


# «عدد الغرف» is bedrooms only in a dwelling. On an عمارة it is the building's room count
# (measured: 36) and on a محل it is units — writing either into bedrooms would answer a bedroom
# filter with a building. Same lesson as wslnaa's `rooms`.
_DWELLING_TYPES = {"Apartment", "Villa", "Duplex", "Studio", "Floor", "Chalet", "Rest House",
                   "Room"}
_AGELESS_TYPES = {"Residential Land", "Commercial Land", "Farm"}


def map_listing(raw: dict) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason). Anything unprovable is a skip or a NULL, never a guess."""
    fields = raw["fields"]
    title = raw.get("title")
    description = raw.get("description")
    if raw.get("archived"):
        return None, "residential", "archived_at_source"
    if _AUCTION_RE.search(title or ""):
        return None, "residential", "auction"

    property_type, type_ar = _type_from_text(fields.get("نوع العقار"), title,
                                             fields.get("نوع إستخدام العقار"))
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    deal = _deal_from(fields, title, description)
    if not deal:
        return None, category, "no_deal_stated"

    city_ar = raw.get("city_raw")
    if not city_ar or city_ar == "غير محدد":
        city_ar = _city_from_title(title)
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"

    district_raw = fields.get("إسم الحي")
    district_ar = (find_district_in_text(district_raw, city_id) if district_raw else None) \
        or find_district_in_text(title, city_id) \
        or find_district_in_text(description, city_id)

    area_m2 = _area(fields, description)
    figure, ppm, rate_note = _price_from_fields(fields)

    # The field grid states «مؤثث / المطبخ / مرافق» and the body states the rest. Both are this
    # unit's own prose, so both are read; amenities_from_text keeps silence NULL, «غير مؤثثة»
    # False, «مصعد مؤسس» NULL and «قريب من حديقة» NULL.
    amenity_text = "\n".join(t for t in (
        description,
        *(f"{k}: {v}" for k, v in fields.items()
          if k in ("مؤثث", "المطبخ", "مرافق", "نوع الغرف")),
    ) if t)

    rooms = normalize.to_int(fields.get("عدد الغرف"))
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{raw['ad_id']}",
        "listing_url": raw["listing_url"],
        "source": SOURCE,
        "active": True,
        "title": title,
        "description": description,
        **normalize.amenities_from_text(amenity_text),
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw or district_ar,
        "area_m2": area_m2,
        "bedrooms": rooms if (rooms and property_type in _DWELLING_TYPES) else None,
        "bathrooms": None,                     # never published by this source, never inferred
        "floor_number": normalize.to_int(fields.get("رقم الدور")),
        "property_age": (None if property_type in _AGELESS_TYPES
                         else normalize.parse_property_age(fields.get("تاريخ البناء"))),
        "photo_urls": raw["photo_urls"] or None,
        "price_per_meter": ppm,
    }
    if deal == "Rent":
        rent_price = figure
        rent_text = f"{fields.get('سعر الإيجار', '')} {title or ''} {description or ''}"
        if "شهري" in rent_text and "سنوي" in rent_text:
            # «شقق مفروشة للايجار السنوي والشهري» quotes ONE figure for two periods. Taking the first
            # token would read 5,500 as a year's rent — a 12x error on the card. Two stated periods
            # are no stated period.
            row["rent_period"] = None
            row["price_annual"] = rent_price
        else:
            # Period from the source's OWN token or nothing — never defaulted.
            row["rent_period"], row["price_annual"] = normalize.rent_period_and_annual(
                rent_price, rent_text)
    else:
        row["price_total"] = figure

    row["additional_info"] = {k: v for k, v in {
        "type_ar": type_ar,
        "source_fields": {k: v for k, v in fields.items()
                          if k not in ("السعر", "السومة", "سعر الإيجار")} or None,
        "price_label": ("السعر" if fields.get("السعر") else
                        ("السومة" if fields.get("السومة") else
                         ("سعر الإيجار" if fields.get("سعر الإيجار") else None))),
        "price_field_raw": fields.get("السعر") or fields.get("السومة")
        or fields.get("سعر الإيجار"),
        "price_is_per_meter": rate_note,
        "slug": raw["listing_url"].rsplit("/", 1)[-1],
        "date_added": raw.get("date_added"),
        "last_update": raw.get("last_update"),
    }.items() if v not in (None, "", [], {})}
    return row, category, ""


# ── fetching ──────────────────────────────────────────────────────────────────────────────────────

def fetch_index(s: cc.Session, limit: int = 0) -> list[str]:
    """Every /annonce/ URL, from the only complete index the site has (see docstring). Stops when a
    page adds nothing new, so a repeating paginator can't loop forever."""
    urls: list[str] = []
    seen: set[str] = set()
    page = 1
    while page < 200:
        r = s.get(INDEX, params={"category": 0, "city": 0, "page": page}, timeout=45)
        if r.status_code != 200:
            break
        body = r.text[max(r.text.find("main-wrapper"), 0):]
        # &amp; in an href 404s every fetch if it is not unescaped ([[rule 7]]).
        found = [_html.unescape(u) for u in re.findall(r'href="([^"]*?/annonce/[^"]+)"', body)]
        fresh = [u for u in found if u not in seen]
        if not fresh:
            break
        for u in fresh:
            seen.add(u)
            urls.append(u)
            if limit and len(urls) >= limit:
                return urls
        page += 1
    return urls


def fetch_detail(s: cc.Session, url: str) -> Optional[dict]:
    r = s.get(url, timeout=45)
    if r.status_code != 200:
        return None
    raw = parse_detail(r.text)
    if raw:
        raw["listing_url"] = url
    return raw


def _verify_gone(ad_number: str) -> tuple[str, str]:
    """Absence from the crawl never deactivates on its own — the source must say the ad is gone.

    This run already read every one of the 361 ads the index publishes, so the verdict is a lookup
    rather than a second probe: an ad whose own page carried «هذا الاعلان لم يعد صالح تم نقله
    للأرشيف» is 'gone', an ad that parsed without it is 'live', and an ad this run never reached (or
    could not parse) is 'unknown' and holds the strike. UNKNOWN NEVER KILLS.
    """
    return _STATUS.get(ad_number, ("unknown", "not reached or not parsed by this run"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("almotmkenah")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    seen = 0
    try:
        urls = fetch_index(s, limit=args.limit)
        if not urls:
            raise RuntimeError(f"{INDEX} returned no /annonce/ URLs — blocked or markup changed")
        print(f"{SOURCE}: {len(urls)} ads in the index", flush=True)
        for url in urls:
            raw = fetch_detail(s, url)
            time.sleep(0.2)          # pace EVERY request, not only the ones that produce a row
            if not raw:
                skipped["page_unreadable"] = skipped.get("page_unreadable", 0) + 1
                continue
            seen += 1
            row, cat, why = map_listing(raw)
            _STATUS[f"{PREFIX}{raw['ad_id']}"] = (
                ("gone", "source banner: هذا الاعلان لم يعد صالح تم نقله للأرشيف")
                if raw["archived"] else
                ("live", "the ad's own page parsed with no archive banner"))
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)

        notes = ", ".join(f"{k}={v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}")
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>8} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):17} {str(r0['city_ar']):7} "
                      f"d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>6} "
                      f"pt={r0.get('price_total')} pa={r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} ppm={r0.get('price_per_meter')} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0

        # NOTE (onboarding): db.py has no upsert_almotmkenah_*_batch yet — adding one is the central
        # engineer's call, not this scraper's, so the shared writer is called by table name here.
        if res:
            db._wasalt_batch("almotmkenah_residential_listings", res)
        if com:
            db._wasalt_batch("almotmkenah_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="almotmkenah_residential_listings",
            com_table="almotmkenah_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        pruned = 0
        degraded = False
        for tbl, rows, kind in (("almotmkenah_residential_listings", res, "residential"),
                                ("almotmkenah_commercial_listings", com, "commercial")):
            if args.type not in ("all", kind):
                continue     # --type deliberately withheld this half; an empty seen-set is not news
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                verify_gone=_verify_gone)
            if n < 0:
                degraded = True
                print(f"⚠ {tbl}: prune guard tripped — kept existing active")
            else:
                pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=seen,
                             rows_upserted=len(res) + len(com), degraded=degraded,
                             # 361 ads are in the index and only ~22 are ever live, so rows_upserted
                             # is a useless health signal here — rows_seen is the one that collapses
                             # when the paginator breaks. Measured 361; the floor is well below it.
                             floor=200,
                             notes=f"pruned={pruned} superseded={superseded} skips: {notes}"[:300],
                             check_tables=["almotmkenah_residential_listings",
                                           "almotmkenah_commercial_listings"])
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted, "
              f"{pruned} pruned, {superseded} superseded")
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
