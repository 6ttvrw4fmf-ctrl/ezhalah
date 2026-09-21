"""نفوذ — nufouth.com. 270 properties / 324 units, onboarding 2026-09-20.

SOURCE SHAPE (probed live before any code was written; every count below is measured)
====================================================================================
The site is a Frappe app. Its listing pages (`/B/<code>`) are JS-rendered, and the probe that
preceded this scraper measured only 2 of 5 detail pages yielding any field text at all. Parsing
that HTML would have shipped a platform that silently captured ~40%.

NO BROWSER IS NEEDED. The page's own JS calls a whitelisted, guest-readable JSON endpoint that
returns the WHOLE record:

    /api/method/website_nufouth.www.api.get_property_data?property_code=<CODE>

and it answered for 270/270 codes with price, area, city, district, photos, rooms, amenities and
the REGA ad licence. That endpoint is this scraper's source of truth. Three things about it are
load-bearing and none of them are guessable from the HTML:

1. `Accept-Language: ar` IS MANDATORY. Without it the SAME endpoint localizes to English and
   `city` comes back "Riyadh" / "Jeddah" / "Dammam" instead of «الرياض» / «جدة» / «الدمام».
   to_catalog() would then place nothing, every listing would skip as city_not_in_catalog, and
   the run would finalize green with 0 rows. Measured both ways on N4685: no header → "Riyadh",
   `Accept-Language: ar` → «الرياض». session() sets it; test_nufouth_traps asserts it is set.
2. THE CODE NEEDS ITS LETTER PREFIX. Codes are H…/N…/R… . The front page links them as
   `/B/code1630`, `/B/code 4075`, `/B/Code R101` — spaces, mixed case, and the digits stripped of
   their prefix. Asking the API for `1630` returns Frappe's PermissionError 403 («No permission
   for Property»), which is what this app returns for a code it cannot find — it does NOT mean we
   are blocked. Asking for `N1630` returns the full record. Enumeration therefore never reads
   those hrefs; it reads the prefixed codes off the index pages (below).
3. `/B/<code>` IS NOT A USABLE listing_url. Measured: /B/N1630 and /B/R101 serve 200, while
   /B/H626, /B/H133, /B/R10045 and /B/N5175 serve HTTP 500 — persistently, on retry. A card
   pointing there would be a dead link. The URL this scraper stores is the deep link the site
   itself uses, `/latest-offers/<category>?ads-<CODE>=1`, whose `detailsModal-<CODE>` handler
   opens the listing; the category page is the one the code was actually discovered on.

ENUMERATION IS COMPLETE, and «عرض المزيد» is a red herring. The four category pages under
/latest-offers each ship EVERY card in the served HTML; their "load more" button only removes
`d-none` from already-rendered `.card-item` nodes (no fetch, no pagination). Scanning
`detailsModal-<CODE>` over the four pages yields 149 + 46 + 55 + 22 = 272 ids, 270 distinct —
exactly the 270 the API answers for. The root /latest-offers page is a 22-card subset of them.

RECORD SHAPE: property (a building) → ads → units. The unit is the listing: it carries its own
type, area, price, rooms, photos and amenities. An ad with `custom_sell_property = 1` (11 ads,
all with zero units) offers the WHOLE property instead, and becomes one listing.

FIELDS WORTH NAMING (the traps)
-------------------------------
· PRICE IS UNIT-LEVEL, NEVER THE AD-LEVEL FIGURE. `ad.annual_rent` == `annual_rent_sum` == the
  SUM over the ad's units. N4990's ad carries 1,645,000 across seven معارض: unit 1 is 470 m² at
  1,645,000 and units 2-7 are 65 m² each with `annual_rent` "0". Reading the ad-level number for
  those six would print 1,645,000 on a 65 m² shop — a ~25× error on six cards. A unit whose own
  figure is 0 has NO PUBLISHED PRICE and is stored NULL (14 units, measured).
· ON A SALE AD, `unit.annual_rent` HOLDS THE SALE PRICE, NOT RENT. Measured on all 18 sale units:
  R10005 has ad.annual_rent 0, ad.selling_price 2,100,000 and unit.annual_rent "2,100,000";
  N5011 has a real rent of 110,000 in ad.annual_rent but unit.annual_rent "1,900,000" = the sale
  price. So the field READ is chosen by `ad_type`, never by which field happens to be non-zero.
· `custom_price_meter` IS DERIVED سعر المتر, NOT A PRICE. ppm × area reproduced the published
  total exactly in 228 of 232 units that carry one, so it is the site's own division, not an
  independent fact. The published total is always used and ppm is kept in additional_info. The
  4 outliers confirm it is derived against a different area (N5011: ppm 504.59 × 218 m² built =
  110,001, while the villa sells for 1,900,000 — ppm is against the LAND). The owner's
  2026-09-03 ppm × area rule is therefore never exercised here: every one of the 14 priceless
  units also has ppm 0 or None, so there is nothing to multiply and the price stays NULL.
· PERIOD IS STATED, NOT DEFAULTED. The field is literally `annual_rent` and the site labels it
  «الإيجار السنوي» / "Annual Rent", so rent_period is "annual" on the source's own word.
· «مؤجر» IS A SELLING POINT, NOT A SOLD BADGE. All 4 occurrences sit in SALE prose —
  «العقار مؤجر بالكامل», «عمارة تجارية للبيع (مؤجرة بالكامل)» — advertising a tenanted
  investment. A naive sold/rented filter on that word would drop a live 53,000,000 listing
  (N4470). There is no auction («مزاد» 0 hits) and no sold/rented marker anywhere in the 270
  payloads; `ad.status` is «نشط» on all 319 ads and is still asserted rather than assumed.
· `air_contioning` IS A STRUCTURED TRI-STATE, and 58 units say «بدون» — WITHOUT air
  conditioning. That is a source-stated FALSE, and it would be lost if the value were only swept
  for tokens («بدون» alone matches no amenity token, so the column would sit NULL). It is read
  as its own field, and a «مؤسس»/prepared value would stay NULL.
· AMENITIES COME FROM LISTS, AND THE LISTS OUTRANK THE PROSE. `services` / `faclities` (the
  API's own typo) / `features` on the property and `service` / `facility` / `feature` on the unit
  are lists of NAMED facts, some English ("Elevators", "Private parking"). They are scanned
  separately from the description and merged on top of it, because amenities_from_text stops at a
  token's FIRST occurrence: with one blob, a description's «قريب من مواقف» (the neighbourhood's —
  correctly suppressed to NULL) would win over the facility list's «مواقف خاصة» (this building's,
  a real True) and silently erase a structured fact. Prose fills gaps; the lists decide.
  This source also writes the lift as the BROKEN PLURAL «مصاعد» (111×, 62 of the 270
  properties), which the shared token list — singular «مصعد» only — cannot substring-match:
  measured, `elevator` was True on 2 of 292 rows before the local rewrite and 94 after. See
  _PLURAL_TO_SINGULAR; it is a normalize.py gap this scraper may not edit, so it is flagged
  in the handoff rather than fixed centrally here.
· `no_of_rooms` IS NOT BEDROOMS OUTSIDE A DWELLING. It is the room count of an office, a showroom
  or a warehouse; only the residential dwelling types below read it as bedrooms (the wslnaa
  lesson). The unread value is kept in additional_info either way.
· `unit.space` / `unit.area` are 0 on 53 of 324 units → area NULL, never 0 m².
· `city` arrives with trailing spaces on some rows («البكيرية », «الشماسية ») and is stripped.
  `district` is already Arabic («حي قرطبة»), so there is no transliteration question here.
· `images` / `images_units` are lists of HTML SNIPPET strings («<div class='swiper-slide'><img
  src='…'/></div>»), not URLs; `images_prop_main` / `images_unit_main` are plain paths. Paths
  contain SPACES and Arabic and must be percent-encoded (verified: the quoted URL returns 200
  image/jpeg). Photos measured on 324/324 units, median 8.

NOT WRITTEN HERE, ON PURPOSE: db.py has no `upsert_nufouth_*_batch` wrapper and this scraper may
not edit it, so main() calls db._wasalt_batch() — the shared batched upsert every platform's
one-line wrapper delegates to — with the two nufouth table names, keeping every guard
(_sanitize_price, _unknown_must_not_overwrite_known, _reject_unusable_listing_url, the
per-key-set grouping). The central engineer still needs to create the two tables and add the two
thin wrappers; see the handoff note in the report.
"""
from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402

BASE = "https://nufouth.com"
SOURCE = "نفوذ"
PREFIX = "NFZ"
API = f"{BASE}/api/method/website_nufouth.www.api.get_property_data"

# The four server-rendered index pages. Every card ships in the HTML (see docstring: the
# «عرض المزيد» button only unhides `.card-item` nodes), so these four fetches are the whole
# catalogue. The path is kept per code because it is also the code's working listing_url.
INDEX_PATHS = (
    "/latest-offers/buildings-and-lands-for-rent",
    "/latest-offers/commercial-for-rent",
    "/latest-offers/residential-for-rent",
    "/latest-offers/sales-offers",
)

# `detailsModal-<CODE>` is the id of the modal the site's own `?ads-<CODE>=1` deep link opens, so
# scanning for it finds exactly the codes that have a working URL — and it carries the letter
# prefix the /B/ hrefs drop.
_MODAL_RE = re.compile(r"detailsModal-([HNR]\d{2,6})\b")
_IMG_SRC_RE = re.compile(r"""src=['"]([^'"]+)['"]""")

# Per-platform EXACT-match type overrides (map_type_exact's documented escape hatch). Only literal
# readings the shared map happens not to key: «أرض سكنية» is word-for-word "residential land"
# (the bare «أرض» already maps to Residential Land), and «دور علوي» / «دور أرضي» are an upper and
# a ground FLOOR (the bare «دور» already maps to Floor). «عمارة سكنية» is a residential building
# and «عمارة تجارية» a commercial one, matching Building/Commercial Building's own categories.
#
# DELIBERATELY ABSENT — these are genuine ambiguities and are left to SKIP rather than guessed,
# per the ask-first mapping rule: «ارض سكنية تجارية» and «عمارة سكنية تجارية» (mixed-use: the
# category must be exactly one and the source does not say which), «فيلا دوبلكس» (Villa or
# Duplex?), «مجمع تجاري» / «برج» / «مبنى» (complex / tower / bare "building" — no canonical
# equivalent), «كمباوند» (the canonical Compound is categorised Commercial, which contradicts
# Saudi usage), «محطة» (mustqr maps the bare word to Gas Station, a judgment its docstring marks
# as safe only in ITS brokerage context), and the single-unit trades «صراف» / «بنشر» / «مغسله» /
# «فيلا مكتبية».
_TYPE_OVERRIDES = {
    "أرض سكنية": "Residential Land",
    "دور علوي": "Floor",
    "دور أرضي": "Floor",
    "عمارة سكنية": "Building",
    "عمارة تجارية": "Commercial Building",
}

# Unit types whose `no_of_rooms` genuinely means BEDROOMS. Everything else keeps the count out of
# that column — an office's "3 rooms" must never answer a bedroom filter.
_DWELLING_TYPES = {"شقة", "فيلا", "دور", "دور علوي", "دور أرضي", "غرفة", "استراحة", "عمارة",
                   "عمارة سكنية"}

# «بدون» = WITHOUT air conditioning: a source-stated False. «مؤسس»/«مجهز» = merely PREPARED for
# one, which is not one — that stays NULL (the four-outcome amenity rule).
_AC_NEGATED = ("بدون", "لا يوجد", "غير")
_AC_PREPARED = ("مؤسس", "مجهز", "تأسيس")

# A SHARED-HELPER GAP, fixed here because this scraper may not edit normalize.py (report it).
# This source writes the Arabic BROKEN PLURAL «مصاعد» — 111 times, across 62 of the 270 properties
# — and normalize's elevator tokens are only the singular «مصعد»/«المصعد». A broken plural does not
# substring-match its singular, so `elevator` sat NULL on every one of those. The word is REWRITTEN
# IN PLACE rather than special-cased, which leaves amenities_from_text's negation / proximity /
# prepared-only windows measuring the same distances: «بدون مصاعد» still reads False and
# «قريب من مصاعد» still stays NULL. Verified below in test_nufouth_traps.
_PLURAL_TO_SINGULAR = (("مصاعد", "مصعد"),)

# «مداخل …» (PLURAL "entrances") describes the BUILDING's shared lobby, not this unit: «مداخل
# مكيفة» (19×) means the entrances are air-conditioned, which is not a claim that the unit has air
# conditioning — the same reason «قريب من حديقة» may not become this unit's garden. Dropped from the
# scan so it cannot fabricate a True. Nothing is lost: the singular «مدخل خاص» / «مدخل سياره» (the
# unit's OWN entrance) is untouched, and the other «مداخل …» tokens map to no column at all.
_SHARED_SPACE_PREFIX = "مداخل"


def _vocab(text: str) -> str:
    """Normalize this source's amenity vocabulary to the shared token list's spelling."""
    for plural, singular in _PLURAL_TO_SINGULAR:
        text = text.replace(plural, singular)
    return text


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")
    # `impersonate` owns the User-Agent — setting one here would contradict the TLS fingerprint.
    # Accept-Language MUST be Arabic or the API localizes `city` to English and every listing is
    # skipped as city_not_in_catalog (see docstring §1).
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7"})
    return s


def _pos(v: Any) -> Optional[int]:
    """A positive integer, or None. Runs through normalize.to_int so Arabic-Indic digits ٠-٩,
    thousands commas and float strings ("228,344", "134.32") all parse; 0 means "not stated" on
    this source (price, area and room counts are all zero-filled) and is never stored as 0."""
    n = normalize.to_int(v)
    return n if n and n > 0 else None


def _evidence(d: dict[str, Any]) -> dict[str, Any]:
    """Drop the unstated keys from the additional_info blob. 0 is this source's "not stated" for
    every number it publishes — price, area, rooms, floors, ppm — so a zero is dropped rather than
    archived as evidence: `price_meter: 0.0` reads as "the source published a per-metre rate of
    zero", which it did not. Booleans are kept (False is a real answer, 0 is not)."""
    out = {}
    for k, v in d.items():
        if v is None or v == "" or v == [] or v == {}:
            continue
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v == 0:
            continue
        out[k] = v
    return out


def _photo_urls(*fields: Any) -> list[str]:
    """Absolute, percent-encoded photo URLs, de-duplicated, order preserved. Each field is either
    a list of plain `/files/...` paths or a list of HTML snippets carrying the path in src=."""
    out: list[str] = []
    for f in fields:
        if not isinstance(f, list):
            continue
        for item in f:
            if not isinstance(item, str):
                continue
            for p in (_IMG_SRC_RE.findall(item) or ([item] if item.startswith("/") else [])):
                # Paths carry spaces and Arabic; unencoded they break an <img> in the app.
                url = BASE + quote(p) if p.startswith("/") else p
                if url not in out:
                    out.append(url)
    return out


def _amenities(msg: dict, unit: Optional[dict], description: Optional[str]) -> dict[str, Any]:
    """Tri-state amenity columns. The NAMED lists are scanned separately from the prose and merged
    on top of it, so a proximity phrase in the description cannot erase a structured fact (see
    docstring). Silence stays absent from the dict — absent is NULL, which is not False."""
    out: dict[str, Any] = dict(normalize.amenities_from_text(_vocab(description or "")))

    tokens: list[str] = []
    for key in ("services", "faclities", "features"):          # the API's own spelling of facilities
        tokens += [str(x) for x in (msg.get(key) or []) if x]
    for key in ("service", "facility", "feature"):
        tokens += [str(x) for x in ((unit or {}).get(key) or []) if x]
    tokens = [t for t in tokens if not t.strip().startswith(_SHARED_SPACE_PREFIX)]
    # Joined on «، » so one item's text never falls inside the negation/proximity window that
    # amenities_from_text inspects around the next item's token.
    out.update(normalize.amenities_from_text(_vocab("، ".join(tokens))))

    ac = str((unit or {}).get("air_contioning") or "").strip()
    if ac:
        if any(w in ac for w in _AC_PREPARED):
            out.pop("air_conditioner", None)                   # prepared-only → NULL, not True
        elif any(w in ac for w in _AC_NEGATED):
            out["air_conditioner"] = False                     # «بدون» → source-stated False
        else:
            out["air_conditioner"] = True
    return out


def fetch_index(s: cc.Session) -> dict[str, str]:
    """{property_code: listing_url}. The URL is the site's own deep link on the very page the code
    was found on, because that page is where the code's `detailsModal-<CODE>` lives."""
    found: dict[str, str] = {}
    for path in INDEX_PATHS:
        r = s.get(BASE + path, headers={"Accept": "text/html"}, timeout=60)
        if r.status_code != 200:
            print(f"  index {path} → HTTP {r.status_code}", flush=True)
            continue
        codes = set(_MODAL_RE.findall(r.text))
        print(f"  {path}: {len(codes)} codes", flush=True)
        for c in codes:
            found.setdefault(c, f"{BASE}{path}?ads-{c}=1")
    return found


def fetch_property(s: cc.Session, code: str) -> Optional[dict]:
    """The whole record for one property code, or None. A 403 here is Frappe's PermissionError for
    a code it cannot find (see docstring §2) — not a block."""
    r = s.get(API, params={"property_code": code}, timeout=40)
    if r.status_code != 200:
        return None
    try:
        return r.json().get("message") or None
    except (ValueError, TypeError):
        return None


def map_listing(msg: dict, ad: dict, unit: Optional[dict],
                listing_url: str) -> tuple[Optional[dict], str, str]:
    """One (ad, unit) pair → a row. `unit` is None for a whole-property ad
    (custom_sell_property=1). Returns (row|None, category, skip_reason)."""
    prop = msg.get("property") or {}
    code = (prop.get("code") or "").strip()
    if not code:
        return None, "residential", "no_code"

    # Asserted, not assumed: every one of the 319 ads measured «نشط», but a future «منتهي» or a
    # sold/reserved state must not publish itself just because it was unseen during onboarding.
    if (ad.get("status") or "").strip() != "نشط":
        return None, "residential", f"status_{(ad.get('status') or 'blank').strip()}"

    type_ar = ((unit or {}).get("unit_type") if unit else prop.get("property_type")) or ""
    type_ar = type_ar.strip()
    property_type = normalize.map_type_exact(type_ar, overrides=_TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    ad_type = (ad.get("ad_type") or "").strip()
    if ad_type == "ايجار":
        deal = "Rent"
    elif ad_type == "بيع":
        deal = "Buy"
    else:
        return None, category, f"deal_unknown_{ad_type or 'blank'}"

    city_ar = (prop.get("city") or "").strip() or None          # trailing spaces do occur
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        # to_catalog, not the source's own label, decides what is a real city. Unplaceable → skip.
        return None, category, "city_not_in_catalog"

    district_raw = (prop.get("district") or "").strip() or None
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None

    # PRICE. The field READ is chosen by the deal, never by whichever field is non-zero: on a sale
    # ad `annual_rent` holds the sale price. The figure is always the UNIT's own — the ad-level one
    # is the sum over the ad's units. A 0 means the source published no price for this unit.
    src = unit if unit is not None else ad
    price = _pos(src.get("selling_price") if deal == "Buy" else src.get("annual_rent"))

    if unit is not None:
        area = _pos(unit.get("space")) or _pos(unit.get("area"))
        description = (unit.get("details") or "").strip() or None
        unit_key = hashlib.sha1((unit.get("name") or "").encode("utf-8")).hexdigest()[:8]
    else:
        area = _pos(ad.get("total_area")) or _pos(prop.get("property_area"))
        description = (ad.get("custom_property_details") or "").strip() or None
        unit_key = "P"                                          # the whole property is the offer
    ad_num = re.sub(r"\D", "", ad.get("name") or "") or "0"

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{code}A{ad_num}U{unit_key}",
        "listing_url": listing_url,
        "source": SOURCE,
        "active": True,
        "title": (unit.get("name") if unit else prop.get("name")) or None,
        "description": description,
        **_amenities(msg, unit, description),
        "property_type": property_type,
        # Spelled as a total expression so transaction_type can never reach the index NULL — a
        # null deal is quarantined out of search entirely (the 2026-07-16 null-deal recovery).
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": area,
        "bedrooms": (_pos((unit or {}).get("no_of_rooms")) if type_ar in _DWELLING_TYPES else None),
        "bathrooms": _pos((unit or {}).get("no_of_bathrooms")),
        "photo_urls": _photo_urls(
            (unit or {}).get("images_unit_main"), (unit or {}).get("images_units"),
            msg.get("images_prop_main"), msg.get("images"))[:20] or None,
    }
    if deal == "Rent":
        # STATED annual: the field is `annual_rent` and the site's label is «الإيجار السنوي».
        row["price_annual"] = price
        if price is not None:
            row["rent_period"] = "annual"
    else:
        row["price_total"] = price

    row["additional_info"] = _evidence({
        "property_code": code,
        "ad_name": ad.get("name"),
        "ad_license_no": ad.get("ad_license_no"),          # REGA advertising licence, 324/324
        "owner_brokerage_contract": ad.get("owner_brokerage_contract"),
        "type_ar": type_ar,
        "source_property_type": prop.get("property_type"),
        "street": prop.get("street"),
        "street_width": prop.get("street_width"),
        "area_information": prop.get("area_information"),  # NEIGHBOURHOOD prose — never the description
        "date_construction_building": prop.get("date_construction_building"),
        "age_property": prop.get("age_property"),
        "lat": prop.get("lat"),
        "long": prop.get("long"),
        "frontage": msg.get("frontage"),
        "units_floors": msg.get("units_floors"),
        # Kept, never promoted to a price: derived سعر المتر (ppm × area reproduces the published
        # total, so it is the site's own division — see docstring).
        "price_meter": (unit or {}).get("custom_price_meter"),
        "unit_no": (unit or {}).get("unit_no"),
        "unit_floor": (unit or {}).get("unit_floor"),
        "finishing": (unit or {}).get("finishing"),
        "view": (unit or {}).get("view"),
        "air_conditioning_raw": (unit or {}).get("air_contioning"),
        "source_rooms": (unit or {}).get("no_of_rooms"),   # kept even when not read as bedrooms
        "halls": (unit or {}).get("no_of_halls"),
        "kitchens": (unit or {}).get("no_of_kitchens"),
        "parkings": (unit or {}).get("no_of_parkings"),
        "whole_property_offer": True if unit is None else None,
        "ad_annual_rent_sum": ad.get("annual_rent"),       # the SUM; never this unit's price
        "marketing_link": prop.get("marketing_link"),
        "virtual_link": prop.get("virtual_link"),
    })
    return row, category, ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("nufouth")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    seen = 0
    try:
        index = fetch_index(s)
        if not index:
            raise RuntimeError("no detailsModal-<CODE> ids on any /latest-offers category page")
        codes = sorted(index)
        if args.limit:
            codes = codes[:args.limit]
        print(f"{SOURCE}: {len(codes)} properties discovered", flush=True)

        for code in codes:
            msg = fetch_property(s, code)
            if not msg:
                skipped["api_miss"] = skipped.get("api_miss", 0) + 1
                continue
            ads = msg.get("ads") or []
            if not ads:
                # «لا يوجد شواغر متوفرة الان» — a building with no live ad has nothing to publish.
                skipped["no_active_ads"] = skipped.get("no_active_ads", 0) + 1
                continue
            for item in ads:
                ad = item.get("ad") or {}
                units = item.get("units") or []
                # No units on a whole-property ad; otherwise one listing per unit.
                for unit in (units or [None]):
                    seen += 1
                    row, cat, why = map_listing(msg, ad, unit, index[code])
                    if not row:
                        skipped[why] = skipped.get(why, 0) + 1
                        continue
                    if args.type != "all" and cat != args.type:
                        continue
                    (com if cat == "commercial" else res).append(row)

        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}", flush=True)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>22} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):18} {str(r0['city_ar']):7} "
                      f"d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>7} "
                      f"bd={str(r0['bedrooms']):>4} p={r0.get('price_total') or r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} ph={len(r0.get('photo_urls') or [])}")
            return 0

        # db.py has no upsert_nufouth_* wrapper and this scraper may not edit it, so the shared
        # batched upsert every wrapper delegates to is called directly — all guards intact.
        if res:
            db._wasalt_batch("nufouth_residential_listings", res)
        if com:
            db._wasalt_batch("nufouth_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="nufouth_residential_listings", com_table="nufouth_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        # The skip tally travels to the database so an empty run says WHY, not just "0 rows".
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             notes=notes or None,
                             check_tables=["nufouth_residential_listings",
                                           "nufouth_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
