"""مكتب السدرة العقارية — alsidra.com.sa. WordPress 6.9.8 + Houzez. 46 posts, 26 sellable.

SOURCE SHAPE (probed live 2026-09-20 before any code; every number below is measured, not assumed):
  · TRANSPORT. The pretty REST path /wp-json/... 404s on this install; only the query form works:
        /?rest_route=/wp/v2/<rest_base>&per_page=100
    and the post type's rest_base is the ARABIC word «عقارات», so it must be percent-encoded.
    X-WP-Total = 46, one page.
  · WHERE THE VALUES ACTUALLY ARE. `meta` is null (Houzez registers fave_* as protected), which
    reads like "the API carries no price". It is not: this install ALSO exposes `property_meta`,
    the raw post-meta map, on every one of the 46 rows. That is where fave_property_price,
    fave_property_images, fave_property_location and the geo pair live. Parsing only the prose
    would have thrown away the platform's own structured price on 19 rows.
    NOT present anywhere: fave_property_size / fave_property_bedrooms / fave_property_bathrooms —
    this office never fills them, so AREA is prose-only while PRICE is the structured field
    CROSS-CHECKED against the prose (see PRICE below).
  · TAXONOMIES are fetched, never hardcoded (ids are install-local). property_status has three
    terms and 20 of the 46 posts are «مزاد» = auctions → skipped, leaving 26 sellable, ALL «للبيع»
    («للايجار» count is 0 today, so the Rent branch below is correct-but-unexercised in production).
  · CITY. property_city is set on 37/46 but its 15 terms MIX REGIONS («القصيم», «الجوف»,
    «الحدود الشمالية», «الباحة») with real cities, and on the region rows the actual city is only
    in the prose/title («الذيبية -رياض الخبراء – القصيم» → the city is رياض الخبراء, the taxonomy
    says القصيم). to_catalog() arbitrates: a region label comes back as (None, region_id), which is
    then reused as the region_hint for the next candidate, so the region still disambiguates the
    city instead of being published as one.
  · DISTRICT. property_area exists (19 terms) but it too contains cities and regions («الرياض»,
    «القصيم», «حائل», «مكة المكرمة»), so it is fed to find_district_in_text as ONE candidate text
    among the property_area term, the «الموقع» line and the title — the catalog decides, never this
    source's label. The DESCRIPTION is deliberately not searched: the boilerplate
    «مكتب السدرة العقارية» in every ad matched «حي السدرة», a real الرياض district, on two rows.
    Measured 3/24 — this office states districts rarely, and mostly as plan or locality names that
    loc_catalog_district does not attest.
  · PHOTOS. featured_media is set on 46/46 and fave_property_images on 41/46, but both are
    ATTACHMENT IDS, not URLs. They are resolved in bulk through /wp/v2/media&include=...
  · PRICE — the measured trap, and why the guard here is textual, not a plausibility threshold:
      - 21243: fave_property_price = 1100 for a 420 m² plot in حي الأمواج بالخبر. The prose says
        «سعر البيع للمتر: 1,100 ريال فقط» — 1100 is the PER-METRE figure. Published as-is it would
        be a 420× understatement and would answer an "under 50k" price filter.
      - 21191: fave_property_price = 1700 for 555.62 m²; prose «سعر المتر للأرض السكنية: 1,700».
        Same shape. (It also quotes a SECOND per-metre price, 2,000, for the commercial strip at
        the back of the plot; the post's own type is ارض سكنية, so the residential one is the
        listing's price and both are kept in additional_info.)
      - 21229: fave_property_price = 350,000 for 22,237.95 m² of farm land = 15.74 ﷼/m². A ratio
        guard with any floor above that would "fix" this into 7.8 BILLION riyals — yet the prose
        states «سعر البيع النهائي: 350,000 ريال سعودي (ثلاثمائة وخمسون ألف ريال)». It is a TOTAL.
        Cheap-per-metre farm land and a per-metre figure are indistinguishable by magnitude, so no
        threshold can separate 21229 from 21243. The discriminator used here is EXACT EQUALITY
        between the source's own two numbers: when fave_property_price == the per-metre price the
        prose states, the meta field IS the per-metre figure. Verified both ways on all 26 rows —
        where the office computed the total itself the two differ and agree with ppm × area
        (21164: 1000 × 469 = 469,000; 21153: 50 × 325,000 = 16,250,000; 21156: 1300 × 660 = 858,000,
        all equal to fave_property_price).
      - «السوم» lines are BIDS, not asks («أعلى سوم واصل: 800,000» under an ask of 900,000;
        «وصل السوم : 1200 للمتر» under an ask of 1300) and are excluded from both parses. Five of
        the 24 are priced «على السوم» — offers invited, no figure published → price stays NULL.
      - 21171 states BOTH a total («ثمانية واربعون الف ريال (48000 ريال)», = its meta) and a stale
        per-metre («78 ريال», which × 483 m² is 37,674). A stated total outranks the rate.
      - NOTHING IS MULTIPLIED HERE. A per-metre figure lands in `price_per_meter` with price_total
        NULL; the ≈ total is derived in the search/display layer only (owner rule 2026-09-03 —
        price_total keeps meaning "the source stated this total").
  · AREA: the body outranks the title. 21153's TITLE says «بمساحة 660 متر مربع» while its body
    states 325,000 m² four times with plot and plan numbers — the title is a copy-paste leftover.
  · BEDROOMS are deliberately NOT extracted. Only 2 of 26 state a count and the two disagree on
    what the count includes: 21253 says «غرفة نوم ماستر» AND «4 غرف نوم إضافية» (= 5), while 21177
    says «4 غرف نوم (منها غرفة ماستر)» (= 4). Recovering either number needs arithmetic over prose
    that the source did not do, so the room lines are preserved verbatim in additional_info and
    bedrooms/bathrooms stay NULL rather than shipping a count that answers a bedroom filter wrongly.

MEASURED RESULT (live, 2026-09-20, real production loc_catalog_*): 46 enumerated → 20 auctions
skipped → 26 sellable → 24 mapped. The 2 remaining skips are honest: 21249 states «وادي الفرع –
ريع ملح (التابعة لمنطقة المدينة المنورة)» and 21226 states only a subdivision-plan name
(«مخطط العدل السليمي»); neither locality is in loc_catalog_city, and publishing the region capital
instead would fabricate 100+ km of precision. Coverage of the 24: price 19, area 24, district 3,
photos 24, city_id 24, region_id 24. Categories 20 residential / 4 commercial, all Buy.
"""
from __future__ import annotations

import argparse
import html as ihtml
import json
import re
import sys
import urllib.parse
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.arabic_location import (  # noqa: E402
    city_ar_for,
    find_district_in_text,
    to_catalog,
)

BASE = "https://alsidra.com.sa"
SOURCE = "Al Sidra"
PREFIX = "SDR"

# The post type's rest_base is the Arabic word itself.
REST_BASE = urllib.parse.quote("عقارات")

RES_TABLE = "alsidra_residential_listings"
COM_TABLE = "alsidra_commercial_listings"

# map_type_exact() is EXACT-match with no alif/hamza normalization, so this source's bare-alif
# spellings need naming even where the shared map holds the hamza form. Per the map_type_exact
# contract these are spelling shadows of canonical values only — no new type, no judgment call.
#   «ارض سكنية»  → the shared map has no entry at all (only the bare «ارض» → Residential Land).
#   «ارض تجارية» → shared map has «أرض تجارية» (hamza) → Commercial Land.
#   «دبلكس»      → shared map has «دوبلكس»/«دوبليكس» → Duplex.
#   «مبنى»       → building, same canonical value the shared «عمارة» already carries.
# NOT mapped on purpose (both currently count 0, and both are genuine ask-first questions rather
# than spellings): «بيت شعبي» (a folk/traditional house — Villa is a guess) and «ارض مرفق تعليمي»
# (educational-facility land — no canonical type exists). Either one appearing is counted as
# type_unmapped in the skip tally so it surfaces instead of being folded into a neighbour.
TYPE_OVERRIDES = {
    "ارض سكنية": "Residential Land",
    "ارض تجارية": "Commercial Land",
    "دبلكس": "Duplex",
    "مبنى": "Building",
}

STATUS_DEAL = {"للبيع": "Buy", "للايجار": "Rent", "للإيجار": "Rent"}
AUCTION_STATUS = "مزاد"

# property_feature terms → amenity columns. A NAMED term is the source stating the fact (True);
# an absent term stays NULL. The full live taxonomy (2026-09-21) is these five terms.
FEATURE_COL = {"مصعد": "elevator", "مكيف": "air_conditioner", "كهرباء": "electricity",
               "مياه": "water_supply", "صرف صحي": "sanitation"}

# The ad's own LABELLED facade/street lines — «الواجهة: غربية», «عرض الشارع: 15 مترًا»,
# «الواجهة والشوارع: تقع الأرض على شارع شمالي بعرض 15 متر». Only a «label:» line whose label names
# the facade or the street is read; marketing prose («على شارع رئيسي يربط بين أحياء جنوب الرياض»)
# never is. ONE width / ONE facade across those lines, or NULL (normalize.one_street_width/one_direction).
_FACADE_LINE = re.compile(r"^\s*([^:\n]{2,30}):(.+)$", re.M)

# An ad that says it already sold/rented is not an offer we may publish.
CLOSED_RE = re.compile(r"تم\s*البيع|تم\s*الإيجار|تم\s*الايجار|تم\s*التأجير|مباع|محجوز")

# ٫ (U+066B) is the ARABIC DECIMAL separator and ٬ (U+066C) the Arabic thousands separator; both
# belong to the number. Leaving ٫ out did not merely truncate «٥٥٥٫٦٢» — the area regex's lazy gap
# swallowed «٥٥٥٫٦» as filler and captured the trailing «٢», reading 555.62 m² as 2 m².
_NUM = r"[\d٠-٩][\d٠-٩,.٬٫]*"
# ٠-٩ are real digits; float() is not. normalize.to_int() translates them for the int column,
# this table does the same for the exact (fractional) area a per-metre total must multiply.
_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩٫", "0123456789.")

# Body only (title fallback is applied separately): «المساحة: 580 متر مربع»,
# «المساحة الإجمالية: 672.3», «إجمالي المساحة: 22,237.95 متر مربع», «مساحة الأرض الإجمالية: 367.5»,
# «بمساحة 469م²», and the source's own typo «المساحة الإجلية: 630». The unit is REQUIRED so that
# «الواجهة: شارع بعرض 16 متر» (a street width, no مساحة) can never be read as an area.
AREA_RE = re.compile(
    r"مساح[ةه]((?:\s*\S{1,14}){0,3}?)\s*:?\s*(" + _NUM + r")\s*(?:م²|م2|م\b|متر)"
)
# The gap between «مساحة» and the number may not cross a street-width phrase or name a ROOM. Without
# this the lazy gap bridges «بمساحة واسعة على شارع بعرض 30 متر» (road width) or «مساحة المجلس 30 متر»
# (a room) and publishes it as the plot — which a per-metre price then multiplies.
_NOT_AREA_GAP = re.compile(r"شارع|عرض|واجه|مجلس|غرف|صال|مطبخ|حوش|دور|ملحق")

# A «سوم» line is a BID, never the asking price — checked before either price parse.
BID_RE = re.compile(r"سوم")

# «سعر المتر: 1,700» / «سعر البيع للمتر: 1,100» / «سعر المتر للأرض السكنية: 1,700», and the
# phrasings with no «سعر»: «قيمة المتر 1100 ريال», «المتر بـ 1100 ريال». Missing one of those lets the
# meta per-metre figure publish as the TOTAL (1,100 for a 420 m² plot).
PPM_LABEL_RE = re.compile(
    r"(?:(?:سعر|قيمة)\s*(?:البيع\s*)?(?:لل|ال)متر|المتر\s*بـ?)([^\n\d٠-٩]{0,40})(" + _NUM + r")")
# «سعر البيع: 1300 للمتر» / «سعر البيع: 50 ريال للمتر» — the unit trails the number instead.
PPM_TRAIL_RE = re.compile(r"سعر[^\n\d٠-٩]{0,24}(" + _NUM + r")\s*(?:ريال\s*)?للمتر")
# «السعر: 1,500,000 ريال», «سعر البيع النهائي: 350,000», «سعر البيع المطلوب: 40,000»,
# «سعر البيع : ثمانية واربعون الف ريال (48000 ريال)» — the gap absorbs a word-numeral restatement
# while staying inside the line, so a bare label line («💰 تفاصيل سعر البيع:») matches nothing.
TOTAL_RE = re.compile(
    r"(?:إجمالي\s*سعر|اجمالي\s*سعر|سعر\s*البيع|السعر)([^\n\d٠-٩]{0,40})(" + _NUM + r")"
)
# A label's gap may not reach a DIFFERENT number on the same line: «سعر البيع: يحدد بعد المعاينة،
# رقم القطعة 123» / «قابل للتفاوض - عمر العقار 5 سنوات» / «حسب الطلب، رقم المخطط 1532».
# Only words that INTRODUCE another number: «القطعة»/«المخطط»/«الدور» alone also label real prices
# («سعر المتر للأرض التجارية (في ظهر القطعة): 2,000» on 21191), so they are not in the list.
_NOT_PRICE_GAP = re.compile(r"رقم|عمر|\bسن[ةه]\b|\bسنوات\b|شارع|عرض")


def session() -> cc.Session:
    # impersonate owns the User-Agent — setting one here would contradict the TLS fingerprint.
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7"})
    return s


def _api(s: cc.Session, route: str, **params: Any) -> Any:
    """GET one WP REST route through the ?rest_route= form (the only one this install serves)."""
    q = urllib.parse.urlencode(params)
    url = f"{BASE}/?rest_route={route}" + (f"&{q}" if q else "")
    r = s.get(url, timeout=60)
    if r.status_code != 200:
        raise RuntimeError(f"{route} → HTTP {r.status_code}")
    return r.json()


def html_text(raw: Optional[str]) -> str:
    """HTML → plain text, PRESERVING line breaks. The line structure is load-bearing: every price
    parse below is scoped to one line so an asking price can never pick up the digits of the bid
    line under it, so the usual one-line `sub(r"<[^>]+>", " ")` helper is not enough here."""
    if not raw:
        return ""
    t = re.sub(r"(?is)<(script|style).*?</\1>", " ", raw)
    t = re.sub(r"(?s)<!--.*?-->", " ", t)                      # Houzez/Docs paste markers
    t = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h[1-6]|tr|table)>", "\n", t)
    t = re.sub(r"(?s)<[^>]+>", " ", t)
    t = ihtml.unescape(t)                                      # &amp; etc. — rule 7
    t = re.sub(r"[ \t\xa0‏‎]+", " ", t)
    return re.sub(r"\n\s*\n+", "\n", t).strip()


def _meta1(meta: dict, key: str) -> Optional[str]:
    """property_meta values are single-element lists."""
    v = (meta or {}).get(key)
    if isinstance(v, list):
        v = v[0] if v else None
    v = (str(v).strip() if v is not None else "")
    return v or None


def parse_area(body: str, title: str) -> tuple[Optional[int], Optional[float]]:
    """(area_m2_for_the_column, exact_area_as_published). Body first, title only as a fallback:
    21153's title contradicts its own body (660 vs a four-times-stated 325,000).

    Both are returned because the column is an integer while the published figure often is not
    (555.62, 786.58, 22,237.95); the exact figure is kept in additional_info.area_m2_exact."""
    for text in (body, title):
        for m in AREA_RE.finditer(text or ""):
            if _NOT_AREA_GAP.search(m.group(1)):
                continue
            n = normalize.to_int(m.group(2))
            if n and n > 0:
                raw = m.group(2).translate(_AR_DIGITS).replace(",", "").replace("٬", "")
                try:
                    exact = float(raw)
                except ValueError:
                    exact = float(n)
                return n, (exact if exact > 0 else float(n))
    return None, None


def parse_prices(body: str) -> tuple[Optional[int], list[int]]:
    """(stated_total, per_metre_prices_in_document_order) — bids excluded, nothing derived here."""
    total: Optional[int] = None
    ppms: list[int] = []
    for line in (body or "").split("\n"):
        if BID_RE.search(line):
            continue                                  # a «سوم» figure is a bid, not an ask
        for rx in (PPM_LABEL_RE, PPM_TRAIL_RE):
            for m in rx.finditer(line):
                if rx is PPM_LABEL_RE and _NOT_PRICE_GAP.search(m.group(1)):
                    continue
                n = normalize.to_int(m.group(m.lastindex))
                if n and n not in ppms:
                    ppms.append(n)
        if "متر" in line:
            continue                                  # a per-metre line is never a total
        if total is None:
            m = TOTAL_RE.search(line)
            if m and not _NOT_PRICE_GAP.search(m.group(1)):
                total = normalize.to_int(m.group(2))
    return (total or None), ppms


def resolve_price(
    stated_total: Optional[int], ppms: list[int], meta_price: Optional[int],
) -> tuple[Optional[int], Optional[int], str]:
    """(total, per_metre_rate, provenance). PRICE = SOURCE — nothing is estimated, rounded or
    multiplied; ppm × area is the search/display layer's (owner rule 2026-09-03).
      1. A total the source WROTE outranks everything (21171: 48,000 vs its own rate × area 37,674).
      2. meta_price EQUAL to a stated per-metre price IS that rate, not a total (21243, 21191).
         Equality, not magnitude: 21229's 350,000 on 22,237 m² is a real total at 15.74 ﷼/m².
      3. Otherwise meta_price is the total (21164 / 21153 / 21156).
      4. A per-metre price alone → the rate, and no total.
    """
    rate = ppms[0] if ppms else None
    if stated_total:
        return stated_total, rate, "stated_total"
    if meta_price and meta_price in ppms:
        return None, meta_price, "per_metre"
    if meta_price:
        return meta_price, rate, "meta_total"
    if rate:
        return None, rate, "per_metre"
    return None, None, "no_price_published"


# The label must OPEN the line (after any emoji/bullet) and carry a colon. Matching «الموقع»
# anywhere instead picked up 21181's marketing sentence «مميزات الموقع والخدمات: تتميز الأرض
# بوقوعها في منطقة مأهولة…» as that ad's location, feeding whole clauses to to_catalog and losing a
# listing that resolves fine without it.
_LOC_LABEL_RE = re.compile(r"[\s\W]{0,4}(?:الموقع|المنطقة)[^:\n]{0,16}:")


def _location_line(body: str) -> Optional[str]:
    """The ad's own location statement, WITHOUT its label. Both labels occur: «الموقع
    (الجغرافي/الاستراتيجي):» and, on 21257, «المنطقة:».

    Only the label (and any emoji/bullet before it) is cut: this string is published verbatim as the
    card's `neighborhood`, and on 2026-09-21 every one of the 20 live cards that carried one read
    «الموقع: حي الورود – الأحساء» instead of the source's own «حي الورود – الأحساء». The dash, the
    city and the source's punctuation are kept exactly as written. The label words never reach the
    district lookup either. A bare label with nothing after it states no location → None."""
    for line in (body or "").split("\n"):
        m = _LOC_LABEL_RE.match(line)
        if m:
            return line[m.end():].strip() or None
    return None


# The ad's own administrative prefix says how BROAD a segment is, so it decides which segment is
# tried as the city first. Neither reading order works on its own: «حي النور – مدينة الدمام» runs
# specific→general while «منطقة القصيم – محافظة الأسياح – مركز البعيثة» runs general→specific, and
# taking the first resolvable segment there published الأسياح (the governorate seat) for a listing
# whose own line names مركز البعيثة, ~30 km away and itself a catalog city. `None` = region-level:
# hint only, NEVER a city — that is exactly the region-upgraded-to-its-capital fabrication that
# to_catalog()'s docstring documents and refuses to perform.
_ADMIN_TIER = {"قرية": 0, "هجرة": 0, "مركز": 0, "مدينة": 1, "محافظة": 2, "منطقة": None}


def _is_region_name(name: str) -> bool:
    """True when `name` is one of the 13 region names. Asked through to_catalog's public API:
    «منطقة <region>» resolves to (None, region_id) while «منطقة <city>» resolves to (None, None)."""
    return to_catalog("منطقة " + name)[1] is not None


def _loc_segments(loc_line: str) -> tuple[list[str], list[str]]:
    """(city_candidates_most_specific_first, region_level_segments).

    «التابعة لـ» is a separator too: «لبخة التابعة للرياض» is the town لبخة with the parent الرياض.
    A «منطقة X» segment keeps its word so to_catalog can recognise it as a region and return
    (None, region_id); it is used only as a region_hint.
    """
    # _location_line already cut the label; only a caller passing the raw line still carries one,
    # and a colon INSIDE the value («… (رقم المخطط: 123)») must not cut the value itself.
    seg = loc_line.split(":", 1)[-1] if _LOC_LABEL_RE.match(loc_line) else loc_line
    seg = re.sub(r"التابع(?:ة|ه)?\s*ل|تابع(?:ة|ه)?\s*ل", "|", seg)
    tiered: list[tuple[int, int, str]] = []
    regions: list[str] = []
    for order, part in enumerate(re.split(r"[–\-|,،()]", seg)):
        part = part.strip(" .،:*")
        if not part:
            continue
        m = re.match(r"(قرية|هجرة|مركز|مدينة|محافظة|منطقة)\s+(.+)", part)
        tier = _ADMIN_TIER.get(m.group(1)) if m else 1      # bare name ranks with «مدينة»
        if m and tier is None:
            regions.append(part)
            continue
        name = m.group(2).strip() if m else part
        # A BARE region name is the parent, not the listing's city: «حائل – بقعاء (الشيحية)» is the
        # town بقعاء (a catalog city, ~100 km from حائل city) inside the Hail region, and «الذيبية -
        # رياض الخبراء – القصيم» is رياض الخبراء. Ranked last rather than dropped, so an ad whose
        # ONLY placeable name is the region capital still resolves to it.
        if not m and _is_region_name(name):
            tier = 3
            # Also a hint source. 21257's line is «المنطقة: القصيم – الفويلق»: the «منطقة» is the
            # LABEL, so the segment «القصيم» arrives bare — and «الفويلق» is an ambiguous twin name
            # that resolves to nothing without its region_hint. Without this the whole listing was
            # lost the moment the label became parseable.
            regions.append(name)
        if name and all(name != t[2] for t in tiered):
            tiered.append((tier if tier is not None else 1, order, name))
    tiered.sort(key=lambda t: (t[0], t[1]))
    return [t[2] for t in tiered], regions


def resolve_city(city_term: Optional[str], loc_line: Optional[str], title: str
                 ) -> tuple[Optional[int], Optional[int], Optional[str]]:
    """(city_id, region_id, city_ar). Never guesses: unplaceable → (None, region, None) and the
    caller skips the listing.

    A region label resolves to (None, region_id), which is then reused as the region_hint for the
    following candidate — that is how 21257's «الفويلق» resolves at all (the bare name is an
    ambiguous twin across regions; its own «القصيم» label disambiguates it).

    THE AD'S LOCATION LINE IS AUTHORITATIVE WHEN IT EXISTS. Measured on 21210: the location line
    says «القويعية – منطقة الرياض» and property_area says «القويعية», but property_city says the
    bare «الرياض» — which to_catalog accepts as a real city. القويعية is not in loc_catalog_city,
    so consulting the taxonomy term (or the title, which likewise reads «في القويعية بالرياض»)
    would publish a القويعية plot as being in الرياض CITY, ~250 km away, and put it in front of
    every Riyadh-city search. When the ad states a specific locality we cannot place, the honest
    answer is to skip it, not to fall back to the region's capital — so the taxonomy term and the
    title are consulted ONLY when there is no location line at all (4 of 26 rows).
    """
    hint: Optional[int] = None
    if loc_line:
        cands, regions = _loc_segments(loc_line)
        # Region-level segments are resolved FIRST, for their hint only — 21257's «الفويلق» is an
        # ambiguous twin name that resolves to nothing without its region.
        for r in regions:
            rid = to_catalog(r)[1]
            if rid:
                hint = rid
                break
    else:
        cands = ([city_term] if city_term else [])
        for w in re.findall(r"[؀-ۿ]{3,}", title or ""):
            # بالقصيم → القصيم, بحائل → حائل (ب/ل attach with no space)
            w = w[1:] if w[0] in "بل" and len(w) > 3 else w
            if w not in cands:
                cands.append(w)
    for cand in cands:
        cid, rid = to_catalog(cand, hint)
        if cid:
            return cid, rid, (city_ar_for(cid) or cand)
        if rid and hint is None:
            hint = rid
    return None, hint, None


# The brokerage's own name is «السدرة», and «حي السدرة» is a real catalog district of الرياض — so
# the boilerplate «مكتب السدرة العقارية», present in every single ad, matched as this listing's
# district on two Riyadh-region rows. Removed before any district lookup.
AGENCY_RE = re.compile(r"(?:مكتب\s*)?السدرة(?:\s*العقاري(?:ة|ه))?")



def map_listing(post: dict, terms: dict[str, dict[int, str]], media: dict[int, str]
                ) -> tuple[Optional[dict], str, str]:
    """One WP post → (row, category, skip_reason). Returns (None, cat, why) for anything we refuse
    to publish; the caller tallies `why` so an empty run says what it dropped and why."""
    if (post.get("status") or "") != "publish":
        return None, "residential", f"wp_status_{post.get('status')}"

    def names(tax: str) -> list[str]:
        table = terms.get(tax) or {}
        return [table[t] for t in (post.get(tax) or []) if t in table]

    status_ar = names("property_status")
    if AUCTION_STATUS in status_ar:
        return None, "residential", "auction"

    title = html_text((post.get("title") or {}).get("rendered"))
    body = html_text((post.get("content") or {}).get("rendered"))
    if CLOSED_RE.search(title) or CLOSED_RE.search(body):
        return None, "residential", "sold_or_rented"

    type_ar = next((t for t in names("property_type")
                    if normalize.map_type_exact(t, TYPE_OVERRIDES)), None)
    if not type_ar:
        raw = ", ".join(names("property_type")) or "none"
        return None, "residential", f"type_unmapped[{raw}]"
    property_type = normalize.map_type_exact(type_ar, TYPE_OVERRIDES)
    category = normalize.category_for_type(property_type).lower()

    deal = next((STATUS_DEAL[s] for s in status_ar if s in STATUS_DEAL), None)
    if not deal:
        return None, category, f"status_unmapped[{', '.join(status_ar) or 'none'}]"

    city_term = next(iter(names("property_city")), None)
    loc_line = _location_line(body)
    city_id, region_id, city_ar = resolve_city(city_term, loc_line, title)
    if not city_id:
        return None, category, "city_not_in_catalog"

    # property_area is the source's own (region-polluted) label — one candidate text, not an answer;
    # the catalog decides. The full description is deliberately NOT searched: it is mostly marketing
    # boilerplate, and matching a district anywhere in it produced false districts (see AGENCY_RE).
    area_term = next(iter(names("property_area")), None)
    district_ar = None
    for text in (area_term, loc_line, title):
        district_ar = find_district_in_text(AGENCY_RE.sub(" ", text or ""), city_id)
        if district_ar:
            break

    meta = post.get("property_meta") or {}
    area, area_exact = parse_area(body, title)
    stated_total, ppms = parse_prices(body)
    meta_price = normalize.to_int(_meta1(meta, "fave_property_price"))
    price, rate, provenance = resolve_price(stated_total, ppms, meta_price)

    photo_ids: list[int] = []
    if post.get("featured_media"):
        photo_ids.append(int(post["featured_media"]))
    for key in ("fave_property_images", "fave_attachments"):
        for chunk in (_meta1(meta, key) or "").split(","):
            chunk = chunk.strip()
            if chunk.isdigit() and int(chunk) not in photo_ids:
                photo_ids.append(int(chunk))
    photos = [media[i] for i in photo_ids if media.get(i)]

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{post['id']}",
        "listing_url": ihtml.unescape(post.get("link") or f"{BASE}/?p={post['id']}"),
        "source": SOURCE,
        "active": True,
        "title": title or None,
        "description": body or None,
        # Tri-state, four outcomes, from the source's own prose: named → True, «غير مؤثثة» → False,
        # «مصعد مؤسس» → NULL, «قريب من حديقة» → NULL, silence → absent (never False).
        **normalize.amenities_from_text(body),
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": loc_line,
        "area_m2": area,
        # See the module docstring: the two rows that state a count disagree on what it includes,
        # so no count is published. The prose is preserved in additional_info.
        "bedrooms": None,
        "bathrooms": None,
        "photo_urls": photos[:20] or None,
    }
    # A NAMED structured feature fills a column the prose left silent; it never overrides prose
    # (an explicit «غير ...» negation already in the row wins), and an ABSENT term stays NULL.
    for feat in names("property_feature"):
        col = FEATURE_COL.get(feat)
        if col and col not in row:
            row[col] = True
    facade = " / ".join(m.group(2).strip() for m in _FACADE_LINE.finditer(body)
                        if re.search(r"واجه|شارع", m.group(1)))
    row["street_width_m"] = normalize.one_street_width(facade) if facade else None
    row["direction"] = normalize.one_direction(facade) if facade else None

    if deal == "Rent":
        # RENT PERIOD = SOURCE. This install publishes no period field and no «شهري/سنوي» in any
        # measured ad (property_status «للايجار» count is 0 today), so the period is read from the
        # ad's own words or left NULL — never defaulted, because a wrong one is a 12× card error.
        # `annual` is used verbatim: the helper returns (None, price) when no period token is
        # present (price as published, period NULL) and (None, None) for يومي/أسبوعي, which this
        # schema has no bucket for — re-substituting `price` there would publish a DAILY rate as
        # an annual one.
        period, annual = normalize.rent_period_and_annual(price, body)
        row["price_annual"] = annual
        if period:
            row["rent_period"] = period
    else:
        row["price_total"] = price
    row["price_per_meter"] = rate

    room_lines = [ln.strip() for ln in body.split("\n")
                  if re.search(r"غرف[ةه]?\s*نوم|دور(?:ة|تين|ات)\s*مياه|مجلس", ln)]
    row["additional_info"] = {k: v for k, v in {
        "wp_post_id": post.get("id"),
        "type_ar": type_ar,
        "status_ar": ", ".join(status_ar) or None,
        "source_city_label": city_term,
        "source_area_label": area_term,
        "source_features": ", ".join(names("property_feature")) or None,
        "price_provenance": provenance,
        # Every per-metre figure the ad published, in its own order. On 21191 the second one is the
        # commercial strip at the back of a residential plot — a different offer, kept, not merged.
        "price_per_m2": ppms[0] if ppms else None,
        "price_per_m2_all": ", ".join(str(p) for p in ppms) if len(ppms) > 1 else None,
        "meta_price_raw": _meta1(meta, "fave_property_price"),
        "stated_total_raw": stated_total,
        # The unrounded published area, when it is fractional — the int column cannot hold it and a
        # per-metre total was computed against it.
        "area_m2_exact": (area_exact if area_exact and area_exact != float(area or 0) else None),
        "facade_raw": facade[:300] or None,
        # NOT split into lat/lng: every live post carries the Houzez theme DEFAULT pin
        # (23.8859,45.0792 = the map centre of Saudi Arabia; 25.68654,-80.431345 = the demo's Miami),
        # never a real location. Kept verbatim so a real pin can be recognised if one ever appears.
        "geo": _meta1(meta, "fave_property_location"),
        "video_url": _meta1(meta, "fave_video_url"),
        "rooms_prose": " / ".join(room_lines)[:600] or None,
        "modified": post.get("modified"),
        # Houzez custom fields whose LABELS live in theme options, not in the API. Their meaning is
        # unknown (one reads 3 on 18 rows, one reads 9/7/6/14, one 4917/1200008856, one a date), so
        # they are carried verbatim and NOT mapped to bedrooms/age/anything — an ask-first item.
        "unlabeled_custom_fields": ", ".join(
            f"{k}={_meta1(meta, k)}" for k in sorted(meta)
            if re.fullmatch(r"fave_f[0-9a-f]{14}", k) and _meta1(meta, k)) or None,
    }.items() if v is not None}
    return row, category, ""


def fetch_terms(s: cc.Session) -> dict[str, dict[int, str]]:
    """Term ids are install-local, so every taxonomy is fetched, never hardcoded."""
    out: dict[str, dict[int, str]] = {}
    for tax in ("property_type", "property_status", "property_city",
                "property_area", "property_feature"):
        data = _api(s, f"/wp/v2/{tax}", per_page=100)
        out[tax] = {t["id"]: ihtml.unescape((t.get("name") or "").strip())
                    for t in data if isinstance(t, dict) and t.get("id")}
    return out


def fetch_posts(s: cc.Session, limit: int = 0) -> list[dict]:
    posts: list[dict] = []
    page = 1
    while True:
        batch = _api(s, f"/wp/v2/{REST_BASE}", per_page=100, page=page,
                     orderby="date", order="desc")
        if not isinstance(batch, list) or not batch:
            break
        posts.extend(batch)
        if len(batch) < 100 or (limit and len(posts) >= limit):
            break
        page += 1
    return posts[:limit] if limit else posts


def fetch_media(s: cc.Session, ids: list[int]) -> dict[int, str]:
    """Attachment ids → source_url, in bulk. Houzez stores ids, never URLs."""
    out: dict[int, str] = {}
    ids = sorted({i for i in ids if i})
    for i in range(0, len(ids), 50):
        chunk = ids[i:i + 50]
        try:
            data = _api(s, "/wp/v2/media", include=",".join(map(str, chunk)), per_page=100)
        except RuntimeError:
            continue
        for m in data if isinstance(data, list) else []:
            if m.get("id") and m.get("source_url"):
                out[int(m["id"])] = m["source_url"]
    return out


def _photo_ids(post: dict) -> list[int]:
    ids: list[int] = []
    if post.get("featured_media"):
        ids.append(int(post["featured_media"]))
    meta = post.get("property_meta") or {}
    for key in ("fave_property_images", "fave_attachments"):
        for chunk in (_meta1(meta, key) or "").split(","):
            if chunk.strip().isdigit():
                ids.append(int(chunk.strip()))
    return ids


# ── LIVENESS ────────────────────────────────────────────────────────────────────────────────────
# Absence from the posts listing only SELECTS candidates; prune_unseen asks this oracle before it
# may deactivate anything, through the shared law (scrapers/common/http_liveness.py), so a
# 401/403/429/5xx, a timeout or an empty body can never read as a death.
# The probe re-reads the post's OWN REST record (the ?rest_route= form — the only one this install
# serves). MEASURED 2026-09-21: a live post answers 200 with its own id and status «publish»; an id
# the route does not hold answers HTTP 404 with code `rest_post_invalid_id` (153 bytes). So:
#   · 404 carrying rest_post_invalid_id                            → GONE (deleted at source)
#   · 200 for THIS id whose status is not «publish», whose property_status is «مزاد», or whose own
#     title/body says it closed (CLOSED_RE) — the crawl's first three skips, same constants → GONE
#   · 200 for this id otherwise                                    → LIVE
#   · a 404 without that code, a 401 (WordPress answers a trashed/draft post with 401 to a guest —
#     the law cannot read it as death, and WordPress empties its trash to a real 404 within 30
#     days), anything unparseable                                   → no opinion
def _signal_for(pid: int, status_names: dict[int, str]):
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
        if (j.get("status") or "") != "publish":
            return "gone"
        if AUCTION_STATUS in [status_names.get(t) for t in (j.get("property_status") or [])]:
            return "gone"
        title = html_text((j.get("title") or {}).get("rendered"))
        body_txt = html_text((j.get("content") or {}).get("rendered"))
        return "gone" if (CLOSED_RE.search(title) or CLOSED_RE.search(body_txt)) else "live"
    return _signal


def _make_verify_gone(terms: dict[str, dict[int, str]]):
    status_names = terms.get("property_status") or {}

    def verify_gone(ad_number: str) -> tuple[str, str]:
        pid = ad_number[len(PREFIX):]
        if not pid.isdigit():
            return "unknown", f"{ad_number!r} is not a {PREFIX}<post id> ad number"
        return LivenessProbe(platform="alsidra", signal=_signal_for(int(pid), status_names),
                             session=session,
                             url_for=lambda _ad: f"{BASE}/?rest_route=/wp/v2/{REST_BASE}/{pid}"
                             ).verify_gone(ad_number)
    return verify_gone


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("alsidra")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    # Bound before the try: the except handler reads it, and an exception raised mid-loop (after
    # skips have accumulated but before the tally is built) would otherwise raise NameError inside
    # the handler and replace the real failure in end_run's notes with a masking error.
    notes = ""
    try:
        terms = fetch_terms(s)
        posts = fetch_posts(s, limit=args.limit)
        if not posts:
            raise RuntimeError(f"/wp/v2/{REST_BASE} returned no posts")
        print(f"{SOURCE}: {len(posts)} posts discovered", flush=True)
        media = fetch_media(s, [i for p in posts for i in _photo_ids(p)])
        for p in posts:
            row, cat, why = map_listing(p, terms, media)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}")
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:30]:
                print(f"   {r0['ad_number']:>9} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):17} {str(r0['city_ar']):14} "
                      f"d={str(r0['district_ar'])[:14]:14} a={str(r0['area_m2']):>7} "
                      f"p={str(r0.get('price_total') or r0.get('price_annual')):>10} "
                      f"[{r0['additional_info'].get('price_provenance')}] "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0
        db.upsert_alsidra_residential_batch(res)
        db.upsert_alsidra_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table=RES_TABLE, com_table=COM_TABLE,
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        # PRUNE — only after a COMPLETE enumeration (a --type run holds the other table's seen-set
        # empty by construction; --limit never reaches here), and only with the direct confirm
        # above. prune_unseen's own breakers (0 seen, >30% vanished, <80% re-seen) sit on top.
        pruned = 0
        if args.type == "all":
            verify_gone = _make_verify_gone(terms)
            for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=len(posts),
                            rows_upserted=len(res) + len(com),
                            check_tables=["alsidra_residential_listings",
                                          "alsidra_commercial_listings"],
                            notes=f"pruned={pruned} {notes}"[:300])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=(f"{e} | skips: " + ", ".join(
                           f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
                           if skipped else str(e))[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
