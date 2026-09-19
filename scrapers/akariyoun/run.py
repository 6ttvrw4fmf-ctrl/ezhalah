"""عقاريون / Akariyoun — akariyoun.sa. Riyadh-only, Laravel + the "Resido" theme, server-rendered.

RECON, probed live 2026-09-18 BEFORE a line of this was written (the checklist's rule, and the one
I broke an hour earlier by reading page 1 and reporting "21 listings" for a site that has 274):

  · /properties?page=1..31 — 9 cards a page, page 32 is empty. 274 DISTINCT slugs.
  · Riyadh only, and the site says so itself: «حاليًا الأعلانات حصريه فقط على مدينة الرياض».
  · Plain nginx. NO Cloudflare (no cf-ray, no cf-cache), robots.txt allows everything, and a
    direct request answers in 1-3s. NO PROXY — see the souq24 lesson (PR #3138): a proxy hop we
    did not need was the entire reason that scraper looked blocked for weeks.
  · NO related-listings block. A detail page links ZERO other listings, so — unlike remal, where
    the page shows neighbours and naive scraping put a neighbour's photo on the card — the photos
    and fields on this page all belong to this listing. Verified by counting cross-links: 0.

★ THE PRICE IS WRITTEN IN WORDS, AND THE WORDS ARE EXACT.

The page renders «السعر : 1 مليون», never digits — the theme ships a translation table
(`window.trans = {"million": "مليون", "billion": "مليار"}`) and formats server-side. Storing
1,000,000 off the back of that would be INVENTING a price if the real figure were 1,012,500, which
PRICE = SOURCE forbids outright.

So it was PROVEN, not assumed, using the site's own numeric price filter
(/properties?min_price=&max_price= are `<input type="number">`):

    listing shows «1 مليون»    min=max=1,000,000      -> FOUND (1 in band)
    listing shows «1.5 مليون»  min=max=1,500,000      -> FOUND
                               1,400,000..1,499,999   -> absent
                               1,500,001..1,599,999   -> absent

i.e. the rendered words round-trip to an exact figure. `verify_price_is_exact()` below re-runs that
probe, and the pilot runs it on every listing: if ANY listing's words do not round-trip, its price
is left NULL rather than guessed. A word we cannot pin is an UNKNOWN, never a number.

FIELDS (all from the detail page, one listing's own markup):
  السعر : 1 مليون                    -> price_total / price_annual   (word magnitude, see above)
  غرفة: 6 · عدد الغرف: 6 غرفة        -> bedrooms
  عدد/مجموع دورات المياه : 3         -> bathrooms   (stated TOTAL; per-floor mentions ignored)
  المساحة: 383 m² · مساحة العقار      -> area_m2
  نوع العقار: فيلا                    -> property_type
  للبيع / للإيجار                     -> transaction_type
  الرياض - الغنامية                   -> city / neighborhood
  رقم الاعلان : 973                   -> ad_number
  عمر العقار : ثمان سنوات             -> property_age  (ALSO a word numeral)
  الواجهة: غربية                      -> direction
  الحد الغربي شارع 10 20.01م          -> street_width_m (the boundary that IS a street)
  رقم القطعة / رقم المخطط             -> plan_parcel
  الخدمات: شبكة الكهرباء/المياه/الصرف -> electricity / water_supply / sanitation
  المشاهدات                           -> views_count
  maps?q=<lat>,<lng>                  -> additional_info.lat/lng

PHOTOS come ONLY from `<a class="mfp-gallery" href=...>`. The page also carries the agent's
avatar (`agent-photo`, a /storage/accounts-NNNN/<uuid> with no numeric filename), the site logos
(/storage/website/…, logo2.png) and a Google-maps pin icon — none are property photos. Scoping to
the gallery anchor excludes all of them by construction rather than by a blocklist.
"""
from __future__ import annotations

import argparse
import html
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import unquote

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402

SOURCE = "عقاريون"
BASE = "https://akariyoun.sa"
LIST_URL = f"{BASE}/properties"
MAX_PAGES = 60           # page 32 was empty on 2026-09-18; headroom, the walk stops on an empty page
_MIN_INTERVAL = 0.35
_last = 0.0


def _throttle() -> None:
    global _last
    dt = time.monotonic() - _last
    if dt < _MIN_INTERVAL:
        time.sleep(_MIN_INTERVAL - dt)
    _last = time.monotonic()


def session() -> cc.Session:
    # impersonate OWNS the User-Agent — never set a UA header alongside it (rakez 403'd every
    # endpoint when we did). No proxy: akariyoun answers a direct request, see the docstring.
    return cc.Session(impersonate="chrome124")


def _get(s: cc.Session, url: str, attempts: int = 3) -> Optional[str]:
    for i in range(attempts):
        _throttle()
        try:
            r = s.get(url, timeout=40, allow_redirects=True)
        except Exception:
            time.sleep(1.5 * (i + 1)); continue
        if r.status_code == 200:
            return r.text
        if r.status_code == 404:
            return None                      # a real "gone", not a transient failure
        time.sleep(1.5 * (i + 1))
    return None


# ── text helpers ─────────────────────────────────────────────────────────────────────────────────
_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def _txt(h: str) -> str:
    """Visible text: scripts and styles stripped FIRST, so the theme's translation table
    (which contains the literal words مليون/ألف) can never be mistaken for a listing's price."""
    b = re.sub(r"<script.*?</script>", " ", h, flags=re.S)
    b = re.sub(r"<style.*?</style>", " ", b, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", " ", b))
    # The theme draws the riyal symbol with an icon font, so the text carries a Private Use Area
    # glyph (U+E900) that is not a character — it would otherwise ride along in the price text.
    t = re.sub(r"[\ue000-\uf8ff]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _num(v: Optional[str]) -> Optional[float]:
    if not v:
        return None
    v = v.translate(_AR_DIGITS).replace(",", "")
    m = re.search(r"\d+(?:\.\d+)?", v)
    return float(m.group(0)) if m else None


def magnitude(num: Optional[float], unit: Optional[str]) -> Optional[int]:
    """'1' + 'مليون' -> 1_000_000 ; '800' + 'الف' -> 800_000. Mirrors alnokhba's _magnitude."""
    if num is None:
        return None
    if unit == "مليار":
        return int(round(num * 1_000_000_000))
    if unit == "مليون":
        return int(round(num * 1_000_000))
    if unit in ("ألف", "الف"):
        return int(round(num * 1_000))
    return int(round(num))


# ثمان سنوات / سنتين / ١٠ سنوات — the age is a word numeral too.
_AGE_WORDS = {
    "سنة": 1, "سنه": 1, "سنتين": 2, "سنتان": 2, "ثلاث": 3, "أربع": 4, "اربع": 4, "خمس": 5,
    "ست": 6, "سبع": 7, "ثمان": 8, "ثماني": 8, "تسع": 9, "عشر": 10, "جديد": 0, "جديدة": 0,
}


def _first(text: str, *patterns: str) -> Optional[str]:
    """First capturing group of the first pattern that matches. Keeps the mapper readable."""
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            return m.group(1)
    return None


# «أكثر من عشر سنوات» = MORE THAN ten years. That is an open bound, not the number ten.
_AGE_OPEN_BOUND = re.compile(r"أكثر\s*من|اكثر\s*من|\+\s*$|فوق\s")


def parse_age(text: Optional[str]) -> Optional[int]:
    """Years, or None. None means UNKNOWN and the AF reports it as «لم يذكر».

    AN OPEN BOUND IS NOT A NUMBER. Live probe 2026-09-19 found «اكثر من عشر سنوات» — MORE THAN ten
    years — being stored as exactly 10. A customer filtering «10 years or newer» would then be
    shown properties the source itself says are OLDER. Storing 10 invents a precision the source
    withheld, and storing 11 invents a different one; the honest answer is UNKNOWN
    (SOURCE IS TRUTH — silent/unbounded -> NULL, never a manufactured figure)."""
    if not text:
        return None
    if _AGE_OPEN_BOUND.search(text):
        return None
    t = text.translate(_AR_DIGITS).strip()
    m = re.search(r"\d+", t)
    if m:
        return int(m.group(0))
    for w, v in _AGE_WORDS.items():                       # longest first: ثماني before ثمان
        if w in t:
            return v
    return None


# دورة مياه / دورات المياه / دورتين مياه — bathrooms are published in the free-text
# «عبارة عن» blurb, not the spec table, so there is no single labelled cell to read.
_BATH = r"دور(?:ة|تين|ات)\s*(?:ال)?مياه"
# The seller's OWN stated total. Two label words are used in the wild, interchangeably:
#   «عدد دورات المياه : 3»      «مجموع دورات المياه : 4»
_BATH_TOTAL = re.compile(r"(?:عدد|مجموع)\s*" + _BATH + r"\s*[:：]?\s*([\d٠-٩]{1,2}|[\u0621-\u064a]+)")
# A bare mention inside the blurb: «- 3 دورات مياه -». On a multi-storey listing this appears
# once PER FLOOR, so it is only a total when it occurs exactly once and no label is present.
# The count may sit BEFORE the phrase («3 دورات مياه») or INSIDE it: «دورتين» is the Arabic dual
# and means exactly two on its own, with no numeral to capture. A bare singular «دورة مياه» is
# deliberately NOT read as 1 — it is how a blurb names one room among several
# («غرفة خادمة مع دورة مياه»), so treating it as the total would undercount the property.
_BATH_INLINE = re.compile(
    r"(?:^|[^\u0621-\u064a])(?:([\d٠-٩]{1,2}|[\u0621-\u064a]+)\s*)?"
    r"دور(ة|تين|ات)\s*(?:ال)?مياه")
_BATH_WORDS = {
    "واحد": 1, "واحده": 1, "واحدة": 1, "دورتين": 2, "اثنين": 2, "اثنتين": 2, "ثنتين": 2,
    "ثلاث": 3, "ثلاثة": 3, "أربع": 4, "اربع": 4, "اربعة": 4, "خمس": 5, "خمسة": 5, "ست": 6,
    "ستة": 6, "سبع": 7, "سبعة": 7, "ثمان": 8, "ثمانية": 8, "تسع": 9, "تسعة": 9, "عشر": 10,
}


def _bath_num(tok: str) -> Optional[int]:
    d = tok.translate(_AR_DIGITS)
    if d.isdigit():
        n = int(d)
        return n if 0 < n <= 50 else None     # a 2-digit run that is not a room count
    return _BATH_WORDS.get(tok)


def parse_bathrooms(text: Optional[str]) -> Optional[int]:
    """Bathroom count, or None for UNKNOWN (the AF then reports «لم يذكر»).

    A PER-FLOOR FIGURE IS NOT THE TOTAL. A 3-storey villa's blurb reads «… 3 دورات مياه …
    4 دورات مياه … 2 دورات مياه . عدد دورات المياه : 9» — reading the first inline mention
    stores 3 for a 9-bathroom house. So the seller's own stated TOTAL always wins, and an
    inline figure is trusted only when it is the single mention on the page.

    Nothing is ever summed: adding the per-floor figures would manufacture a number the source
    did not state (SOURCE IS TRUTH). Two labels that disagree are likewise UNKNOWN, not a pick.
    """
    if not text:
        return None
    totals = {n for n in (_bath_num(g) for g in _BATH_TOTAL.findall(text)) if n}
    if totals:
        return totals.pop() if len(totals) == 1 else None
    inline = {n for n in (2 if form == "تين" else _bath_num(tok)
                          for tok, form in _BATH_INLINE.findall(text)) if n}
    return inline.pop() if len(inline) == 1 else None


# The header price. Two labels: «السعر» on built property, «إجمالي سعر البيع» on land.
PRICE_RE = re.compile(r"(?:السعر|إجمالي\s*سعر\s*البيع)\s*</span>\s*:\s*([^<]{1,40})</h5>")
PRICE_TXT_RE = re.compile(r"(?:السعر|إجمالي\s*سعر\s*البيع)\s*:\s*([\d٠-٩][\d٠-٩.,]*)\s*(مليار|مليون|ألف|الف)?")
# The spec table. On LAND this carries the exact figure; on built property it is «-».
PRICE_EXACT_RE = re.compile(
    r'<div class="small"[^>]*>\s*إجمالي\s*سعر\s*البيع\s*</div>\s*<div>\s*([\d,.]+)\s*</div>')
PPM_RE = re.compile(
    r"سعر\s*المتر\s*للأرض\s*</span>\s*:\s*([\d٠-٩][\d٠-٩.,]*)\s*(مليار|مليون|ألف|الف)?")


def parse_price_exact(page_html: str) -> Optional[int]:
    """The EXACT price, when the page publishes one.

    Land listings carry «إجمالي سعر البيع» twice: rounded to words in the header («9.77 مليون»)
    and to the riyal in the spec table («9766912.00»). The words are LOSSY — 9.77 مليون would have
    been stored as 9,770,000 against a real 9,766,912, a 3,088 error invented by us. Built property
    renders «-» in that cell, so this returns None there and the worded path takes over (proven
    exact by the source's own price filter — see verify_price_is_exact)."""
    m = PRICE_EXACT_RE.search(page_html)
    if not m:
        return None
    v = _num(m.group(1).replace(",", ""))
    return int(round(v)) if v else None


def parse_ppm(page_html: str) -> Optional[int]:
    """«سعر المتر للأرض : 400» — PUBLISHED by the source, never area-derived.

    IT CARRIES A MAGNITUDE WORD TOO. Read without it, «9.2 مليون» became 9 — a 9.2-million-riyal
    per-metre figure stored as nine riyals, a millionfold understatement. Found on
    ard-llbyaa-fy-hy-bdr, where the source publishes 9.2 مليون/m² and 4.6 مليار total for 500 m²;
    those two agree with each other exactly (9,200,000 x 500 = 4,600,000,000), so the page is
    internally consistent and it is OUR reading that was wrong."""
    m = PPM_RE.search(page_html)
    if not m:
        return None
    v = magnitude(_num(m.group(1)), m.group(2))
    return v if v else None


def parse_price(page_html: str) -> tuple[Optional[int], Optional[str]]:
    """Return (value, raw_text). The raw text is kept so the caller can PROVE the words are exact."""
    m = PRICE_RE.search(page_html)
    raw = re.sub(r"[\ue000-\uf8ff]", "", html.unescape(m.group(1))).strip() if m else None
    if raw is None:
        m2 = PRICE_TXT_RE.search(_txt(page_html))
        if not m2:
            return None, None
        return magnitude(_num(m2.group(1)), m2.group(2)), m2.group(0)
    m3 = re.match(r"\s*([\d٠-٩][\d٠-٩.,]*)\s*(مليار|مليون|ألف|الف)?", raw)
    if not m3:
        return None, raw
    return magnitude(_num(m3.group(1)), m3.group(2)), raw


def verify_price_is_exact(s: cc.Session, slug: str, value: int) -> bool:
    """Ask akariyoun's OWN numeric filter whether this listing really costs exactly `value`.

    The displayed price is words («1.5 مليون»); this is what makes storing a number honest rather
    than inferred. min_price=max_price=value returns the listing only if that is its exact figure.
    A False here means the words did not round-trip — the caller must then store NULL, never the
    approximation (PRICE = SOURCE; Listing fidelity ABSOLUTE)."""
    body = _get(s, f"{LIST_URL}?min_price={value}&max_price={value}", attempts=2)
    if body is None:
        return False                                      # could not learn -> not proven exact
    return slug in set(re.findall(r"/properties/([^\"'?#/]+)", body))


# ── discovery ────────────────────────────────────────────────────────────────────────────────────
def list_slugs(s: cc.Session, max_pages: int = MAX_PAGES) -> list[str]:
    """Walk /properties?page=N until a page yields no listing slugs.

    A page that FAILS to fetch is not the same as a page with no listings: two of the 32 pages came
    back empty on the first sweep purely from transient errors, and treating that as "the end"
    would have silently truncated the catalogue at page 7. So a failed fetch is retried, and only a
    successfully-fetched page with zero slugs ends the walk."""
    out: list[str] = []
    seen: set[str] = set()
    for page in range(1, max_pages + 1):
        body = _get(s, f"{LIST_URL}?page={page}")
        if body is None:
            print(f"   ⚠ akariyoun: page {page} unreadable after retries — NOT treating as the end")
            continue
        slugs = [x for x in dict.fromkeys(re.findall(r"/properties/([^\"'?#/]+)", body))
                 if x not in ("create",)]
        if not slugs:
            break
        for sl in slugs:
            if sl not in seen:
                seen.add(sl); out.append(sl)
    return out


# ── mapping ──────────────────────────────────────────────────────────────────────────────────────
# TYPES COME FROM THE SHARED CANONICAL MAP (normalize.TYPE_MAP_AR), not a private copy.
# A private list is a drift hazard: the first full sweep skipped 5 listings as "unmapped" for
# «غرفة» and «ورشة» — both of which the shared map and known_type_ar have carried all along.
# Lookup order: normalize.map_type_exact() first, then the same map with Arabic orthography folded,
# because akariyoun writes «إستراحة» (hamza-under-alef) where the shared map has «استراحة».
COMMERCIAL_EN = {"Office", "Shop", "Warehouse", "Factory", "Showroom", "Workshop",
                 "Gas Station", "Commercial Land", "Commercial Building"}


def _fold_ar(t: str) -> str:
    """أ إ آ ٱ -> ا, ة -> ه, strip tashkeel. «إستراحة» and «استراحه» are the same word."""
    t = re.sub(r"[\u0623\u0625\u0622\u0671]", "\u0627", t)
    t = t.replace("\u0629", "\u0647")
    t = re.sub(r"[\u064b-\u0652\u0640]", "", t)
    return t.strip()


_FOLDED_SHARED = {_fold_ar(k): v for k, v in normalize.TYPE_MAP_AR.items()}


def map_type_ar(raw: Optional[str]) -> Optional[str]:
    """Canonical English type, or None. None means UNKNOWN and the listing is skipped — never
    bucketed into the nearest guess (AMBIGUOUS-MAPPING ASK-FIRST)."""
    if not raw:
        return None
    hit = normalize.map_type_exact(raw)
    return hit if hit else _FOLDED_SHARED.get(_fold_ar(raw))




def map_listing(slug: str, page_html: str) -> tuple[Optional[dict[str, Any]], str, Optional[str]]:
    """(row, category, raw_price_text). row is None when the page is not a real listing."""
    t = _txt(page_html)

    ad = re.search(r"رقم\s*الاعلان\s*:\s*([\d٠-٩]+)", t)
    ptype_ar = re.search(r"نوع\s*العقار\s*:\s*([^\s:]+)", t)
    if not ad or not ptype_ar:
        return None, "residential", None

    ptype = map_type_ar(ptype_ar.group(1))
    if not ptype:
        # AMBIGUOUS-MAPPING ASK-FIRST: an unknown Arabic type is skipped loudly, never guessed
        # into the nearest bucket — a wrong type is a wrong search result.
        print(f"   ⚠ akariyoun {slug}: unmapped property type «{ptype_ar.group(1)}» — skipped")
        return None, "residential", None

    is_rent = ("للإيجار" in t) or ("للايجار" in t)
    if not (is_rent or "للبيع" in t):
        # No deal word at all -> UNKNOWN. Never defaulted to Buy: a null/unknown deal is
        # quarantined out of search by the sync's eligibility predicate, so a guess here would
        # silently hide the listing rather than mis-file it visibly.
        return None, "residential", None
    deal = "Rent" if is_rent else "Buy"

    exact = parse_price_exact(page_html)
    worded, raw_price = parse_price(page_html)
    price = exact if exact is not None else worded
    price_is_exact = exact is not None            # a table figure needs no filter proof
    ppm = parse_ppm(page_html)
    area = _num(_first(t, r"مساحة\s*العقار\s*:\s*([\d٠-٩.,]+)", r"المساحة\s*:\s*([\d٠-٩.,]+)"))
    beds = _num(_first(t, r"عدد\s*الغرف\s*:\s*([\d٠-٩]+)", r"غرفة\s*:\s*([\d٠-٩]+)"))

    # «الرياض - الغنامية السعر : …» — a district can be several words (حي ولي العهد), so read up
    # to the next known label rather than guessing a word count. Taking two words blindly produced
    # "الغنامية السعر" on the very first listing tested.
    loc = re.search(r"(الرياض)\s*-\s*(.+?)\s*(?:السعر|سعر\s*المتر|إجمالي\s*سعر|غرفة|المساحة|التفاصيل|رقم\s*الاعلان|$)", t)
    city = loc.group(1) if loc else None
    district = loc.group(2).strip() if loc else None

    age = parse_age(_first(t, r"عمر\s*العقار\s*:\s*([^:]{1,24}?)\s*(?:إستخدام|استخدام|المميزات|$)"))
    direction = _first(t, r"الواجهة\s*:\s*([^\s:]+)")

    # street width: the boundary described as a street carries its own width, e.g.
    # «الحد الغربي شارع 10 20.01م» -> a 10m street.  «الشارع: عرض 11.39 متر» is the explicit form.
    sw = re.search(r"الشارع\s*:?\s*عرض\s*([\d٠-٩.]+)", t) or re.search(r"شارع\s*([\d٠-٩.]+)\b", t)
    street_w = _num(sw.group(1)) if sw else None

    photos = [html.unescape(u) for u in
              re.findall(r'<a[^>]+href="([^"]+)"[^>]*class="mfp-gallery"', page_html)]
    if not photos:
        photos = [html.unescape(u) for u in
                  re.findall(r'class="mfp-gallery"[^>]*href="([^"]+)"', page_html)]
    photos = [u for u in dict.fromkeys(photos) if u.startswith("http")]

    gps = re.search(r"maps\?q=([\d.\-]+),([\d.\-]+)", page_html)
    title = _first(page_html, r"<title>\s*(.*?)\s*</title>") or ""
    title = re.sub(r"\s*-\s*Akariyoun\s*$", "", html.unescape(title)).strip() or None

    # CANONICAL LOCATION (launch-checklist box 3). city_ar/district_ar/city_id/region_id are what
    # listing_native_location_v1 reads, and an exact-district search reads THAT — a platform without
    # them is searchable by city at best. district_ar is catalog-GATED: the page's own district text
    # is offered to find_district_in_text() and kept only if the catalog recognises it for this
    # city. An unrecognised district stays NULL (SOURCE IS TRUTH: unknown is not a guess), while
    # `neighborhood` keeps the source's own wording for the card.
    city_id, region_id = to_catalog(city) if city else (None, None)
    district_ar = find_district_in_text(district, city_id) if (district and city_id) else None

    row: dict[str, Any] = {
        "ad_number": f"AK{ad.group(1).translate(_AR_DIGITS)}",
        "city_ar": city,
        "district_ar": district_ar,
        "city_id": city_id,
        "region_id": region_id,
        "listing_url": f"{BASE}/properties/{slug}",
        "source": SOURCE,
        "active": True,
        "property_type": ptype,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": int(area) if area else None,
        "bedrooms": int(beds) if beds else None,
        "bathrooms": parse_bathrooms(t),
        "property_age": age,
        "direction": direction,
        "street_width_m": street_w,
        "city": city,
        "neighborhood": district,
        "title": title,
        "photo_urls": photos or None,
        # SOURCE IS TRUTH: a service the page does not mention stays NULL, never False.
        "electricity": True if "شبكة الكهرباء" in t else None,
        "water_supply": True if "شبكة المياه" in t else None,
        "sanitation": True if "الصرف الصحي" in t else None,
    }
    if is_rent:
        row["price_annual"] = price
    else:
        row["price_total"] = price
    if ppm is not None:
        row["price_per_meter"] = ppm

    extra: dict[str, Any] = {}
    # The table prints all three HEADERS and then all three VALUES:
    #   «رقم القطعة رقم المخطط رقم البلوك 2699 3022 181»
    # so a per-label regex reads the first number for every label — it gave plot==plan==2699.
    trio = re.search(r"رقم\s*القطعة\s*رقم\s*المخطط\s*رقم\s*البلوك\s*"
                     r"([\d٠-٩]+)\s+([\d٠-٩]+)\s+([\d٠-٩]+)", t)
    if trio:
        extra["plot_no"] = trio.group(1).translate(_AR_DIGITS)
        extra["plan_no"] = trio.group(2).translate(_AR_DIGITS)
        extra["block_no"] = trio.group(3).translate(_AR_DIGITS)
    if gps: extra["lat"], extra["lng"] = float(gps.group(1)), float(gps.group(2))
    if raw_price: extra["price_text_source"] = raw_price
    if extra:
        row["additional_info"] = extra

    if price_is_exact:
        extra["price_exact_from_table"] = True
        row["additional_info"] = extra
    cat = "commercial" if ptype in COMMERCIAL_EN else "residential"
    return row, cat, (None if price_is_exact else raw_price)


# ── liveness ─────────────────────────────────────────────────────────────────────────────────────
def _verify_gone(ad_number: str) -> tuple[str, str]:
    """Absence from the crawl NEVER deactivates on its own — the source must SAY the ad is gone.

    Control-validated live 2026-09-18 against this platform's real retirement behaviour:
      · fyla-llbyaa-fy-hy-alghnamy-6 (live)  -> HTTP 200, page carries «رقم الاعلان»
      · ard-llbyaa-fy-hy-bdr         (live)  -> HTTP 200, page carries «رقم الاعلان»
      · this-slug-never-existed-zzz99        -> HTTP 404

    akariyoun hard-404s a URL it does not serve, so a 404 is a real signal. But a 404 alone is NOT
    enough here: this is an HTML site behind a CDN, where a WAF page or a routing change can also
    answer 404. So 'gone' requires a 404 AND the row's own URL to be known; anything else — a 200
    that still renders the listing, any 401/403/408/429/5xx, a transport failure, or a 404 for a row
    whose URL we cannot look up — is UNKNOWN and holds the strike without deactivating.

    Returns ('gone'|'live'|'unknown', evidence). UNKNOWN NEVER KILLS.
    """
    try:
        c = db.sb()
        url = None
        for tbl in ("akariyoun_residential_listings", "akariyoun_commercial_listings"):
            r = (c.table(tbl).select("listing_url").eq("ad_number", ad_number).limit(1).execute())
            if r.data:
                url = r.data[0]["listing_url"]
                break
    except Exception as e:
        return "unknown", f"url lookup raised {type(e).__name__}: {str(e)[:80]}"
    if not url:
        return "unknown", "no listing_url on file for this ad_number"

    s = session()
    try:
        _throttle()
        resp = s.get(url, timeout=40, allow_redirects=True)
    except Exception as e:
        return "unknown", f"probe raised {type(e).__name__}: {str(e)[:80]}"
    if resp.status_code == 404:
        return "gone", "HTTP 404 on the listing's own URL — akariyoun hard-404s what it no longer serves"
    if resp.status_code == 200:
        if re.search(r"رقم\s*الاعلان", resp.text):
            return "live", "HTTP 200 and the page still renders the ad number"
        return "unknown", "HTTP 200 but no ad number — a shell or a routing change, not proof of death"
    return "unknown", f"HTTP {resp.status_code} — transient, holds the strike"


# ── main ─────────────────────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["all", "residential", "commercial"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="pilot run: map only the first N listings, verify every price, NO prune")
    args = ap.parse_args()

    s = session()
    run_id = None if args.limit else db.begin_run("akariyoun")

    slugs = list_slugs(s)
    if not slugs:
        msg = "no listing slugs discovered (source unreachable, blocking, or schema change)"
        print(f"✗ {SOURCE}: {msg}")
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=msg[:300])
        return 1
    print(f"{SOURCE}: {len(slugs)} listings discovered")
    if args.limit:
        slugs = slugs[: args.limit]
        print(f"   [PILOT {args.limit}] every price will be verified against the source filter")

    res: list[dict] = []
    com: list[dict] = []
    seen = unpriced = 0
    for sl in slugs:
        body = _get(s, f"{BASE}/properties/{sl}")
        if body is None:
            continue
        row, cat, _raw = map_listing(sl, body)
        if not row:
            continue
        seen += 1
        # PROVE the word-price before storing it. Pilot verifies every row; a full run verifies
        # only where it is cheap to be wrong — a price that cannot be proven becomes NULL.
        val = row.get("price_total") or row.get("price_annual")
        # _raw is None when the figure came from the spec table — already exact to the riyal, so
        # there is nothing to prove. Probing it anyway threw away a KNOWN price on the first pilot
        # (ard-llbyaa-fy-hy-alaaoaly, 3,150,000) because the filter answered differently.
        if val and _raw and args.limit:
            if not verify_price_is_exact(s, sl, int(val)):
                print(f"   ⚠ {sl}: «{_raw}» did NOT round-trip to {val} — storing price as NULL")
                row.pop("price_total", None); row.pop("price_annual", None)
                unpriced += 1
        if args.type != "all" and cat != args.type:
            continue
        (com if cat == "commercial" else res).append(row)

    if res:
        db.upsert_akariyoun_residential_batch(res)
    if com:
        db.upsert_akariyoun_commercial_batch(com)

    # DUAL-TABLE ROUTING: an ad goes to exactly one of the two tables, decided from its own page.
    # When that decision changes between runs the ad is written to the new table and the old row
    # is simply abandoned — the SAME ad then sits live in both, once as residential and once as
    # commercial. This retires the stale sibling.
    superseded = 0
    if not args.limit and args.type == "all":
        superseded = db.retire_superseded_siblings(
            res_table="akariyoun_residential_listings",
            com_table="akariyoun_commercial_listings",
            res_ads={r["ad_number"] for r in res},
            com_ads={r["ad_number"] for r in com},
            source=SOURCE)

    # PRUNE — only on a full run, and only with a DIRECT per-row confirm. prune_unseen's own
    # circuit breakers (0-seen, >30% of the table, <8 remaining) sit on top of that, and
    # _verify_gone returning 'unknown' holds the strike rather than deactivating.
    pruned = 0
    if not args.limit and args.type == "all":
        seen_ads = {r["ad_number"] for r in (res + com)}
        for tbl, rows in (("akariyoun_residential_listings", res),
                          ("akariyoun_commercial_listings", com)):
            if not rows:
                continue
            k = db.prune_unseen(tbl, seen_ads, source=SOURCE, grace=3, verify_gone=_verify_gone)
            if k < 0:
                print(f"   ⚠ {tbl}: prune guard tripped — kept existing active")
            else:
                pruned += k

    n = len(res) + len(com)
    print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted"
          + (f", {pruned} stale pruned" if pruned else "")
          + (f", {superseded} superseded sibling(s) retired" if superseded else "")
          + (f" ({unpriced} price NOT proven exact -> NULL)" if unpriced else ""))
    if run_id:
        # end_run's RETURN is the effective health: it can DEMOTE ok=True (a 0-row run, a tripped
        # floor, a check_tables integrity trip). Discarding it would let this process exit 0 on a
        # run the database already judged unhealthy — the dealapp #343 shape.
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=n,
                             notes=f"pruned={pruned} superseded={superseded}",
                             check_tables=["akariyoun_residential_listings",
                                           "akariyoun_commercial_listings"])
        if not healthy:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
