"""سكني — sakani.sa, the government housing marketplace, RENT purpose only. Onboarding 2026-09-23.

SOURCE SHAPE (probed live before any code; every count below is one I measured, not the manifest's)
==================================================================================================
The site is an Angular SPA behind Cloudflare. Nothing is scraped from HTML — the page's own JSON
calls answer without a login, and those are the only three routes this scraper reads:

ENUMERATION  GET /marketplaceApi/search/v2/location?filter[marketplace_purpose]=rent&page[size]=20&page[number]=N
  JSON:API. `data` holds the search rows (type "searches", resource_type "market_units", id
  "market_unit_<id>", unit_types, auction_status, marketplace_price, version). `meta.first_page.data`
  holds THE SAME PAGE's rows in their rich shape (type "marketing_rentals": annual_unit_price, area,
  bedrooms, bathrooms, city_text, region_text, media_images, main_building_face, status, publish,
  tags) — the name says "first page" but it is filled on every page (measured: page 2 of size 20
  carried rows 21-40). Walk measured 2026-09-23: 15 pages = 14×20 + 2 = 282 search rows, 282 rich
  rows, 282 unique ids, all status "published" / publish true. page[size]=1000 answers the same 282
  in one page and page[number]=2 answers 0, so 282 is the whole catalogue, not a cap — but
  its rich side stays at 20 rows (measured 2026-09-23: 282 search rows, 20 rich), so the walk MUST
  page at 20 or enumerate_rent raises «search row has no rich row».
  filter[id] is IGNORED (asked for market_unit_24798, got the top of the catalogue back) and
  filter[resource_ids] draws a Cloudflare challenge — neither is an oracle for anything.

DETAIL       GET /marketUnitsApi/v6/market_units/<id>     (the page's own call; no auth for reads)
  status/publish, description, district_id, amenities{furnished, kitchen, elevator, parking, …}
  booleans, rega_ad_license{ad_license_number, advertisement_type rent|sale, property_utilities[],
  property_age, end_date}, number_of_living_rooms / number_of_reception_rooms / floor_number /
  building_year / unit_age / main_street_width, unit_price "32400.0", unit_area "197.1".
  The amenities dict is the advertiser's CHECKBOX form: true = the advertiser named it; false =
  left unchecked, which is silence, not a negation (24800 is false on all 30 keys). So true → True
  and false → the key is left out (NULL); nothing here can ever produce False.
  PDPL: the same record carries owner_name / broker_name / advertiser_name / advertiser_mobile /
  cellphone_number / published_by / owner_id / requester_id / beneficiary_national_id_number /
  responsible_employee_name+phone / company_name — and company_name is usually a PERSON (company_cr_number
  is blank on 211 of 282 index rows). None of those keys is ever read: additional_info and
  source_capture are built from an allow-list, and `_public()` drops every identity/contact key
  before a capture is stored. The unit page itself shows the advertiser's name under «المسؤول عن
  الإعلان» — that is the site's business; it is never ours.

DISTRICT     GET /marketplaceApi/search/v1/districts?filter[city_id]=<sakani city id>  → {id, name_ar}
  Cached per source city (21 cities in the catalogue). The search rows publish district_id 0 and a
  blank district_obj on 282/282; only the detail's district_id names the district (24858 →
  500001063 → «الشعلة», which is what the page renders: «منطقة المنطقة الشرقية , الدمام , الشعلة»).

PAGE         https://sakani.sa/app/market-unit/<id>
  Verified in a real browser 2026-09-23 on 24858: renders «شقة · SAR 32,400 · 1 · 1 · 197.1 م² ·
  الدمام , الشعلة», the description, the amenities and ad licence 7201147133, and the SPA's only
  data call is the DETAIL route above. /app/marketing-rental-unit/<id> is a DIFFERENT resource
  (marketUnitsApi/v4/beneficiary/marketing_rental_units) that answers 404 for these ids and bounces
  the user to the home page with «الرجاء المحاولة لاحقا» — never link it.

ID SPACE     market_unit ids are shared with the SALE marketplace: 24798 / 24799 / 24800 sit in the
  gaps of the rent catalogue and are live SALE units (rega_ad_license.advertisement_type "sale",
  «SAR 700,000» on the page). Absence from the rent catalogue is therefore NOT death, and the purpose
  is re-read from the detail record (a sale record skips as purpose_sale — a defensive check, since
  the walk is already filtered to rent).

PRICE / PERIOD  `annual_unit_price` is the figure the card prints as «SAR 32,400 / كل سنة» and the
  detail repeats as unit_price "32400.0"; the ad licence says advertisement_type "rent". The period
  is the site's own label, so rent_period = 'annual' with the figure unconverted. 5 of 282 are
  fractional, all land (23577: 1555.56005859375, 23711: 18138.16015625, 23266: 1400554.25,
  21704/21705: 150459.75 — float32 renderings of the source's own decimals): the exact figure goes
  to additional_info.price_exact and price_evidence.raw, and the value is passed through unchanged
  (the shared batch layer, not this scraper, decides how a bigint column takes it). Never rounded,
  never hidden, never derived from a per-metre figure (the source has none).

AREA         `area` is a float on 64/282 (197.10000610351562 = the source's 197.1). area_m2 takes the
  whole metres; the exact string (unit_area "197.1") goes to additional_info.area_exact.

TYPES        unit_type is an English key: apartment 172, villa 37, floor_through 18, building 17,
  office 10, land 7, room 6, exhibition 6, rest_house 4, car_parking / warehouse / station / farm /
  factory 1 each (measured over the 282). Mapped by normalize.map_type_en with the overrides below;
  a bare land takes the detail's land_type (commercial → Commercial Land). Anything else skips.
  land_type "residential" is the form's DEFAULT, not a statement: apartments, rooms and showrooms
  carry it too (5/5 fresh details 2026-09-23), so a bare land with commercial prose (23711:
  «أرض تجاريه للايجار») lands as Residential Land through the fleet's default map — structured
  over prose, raised with the owner (skip as type_ambiguous?) rather than guessed from the text.

CITIES       city_text is Arabic (الرياض 150, جدة 51, الخبر 24, الدمام 14, المدينة المنورة 12, …).
  Hyphenated twins («الجموم - بحرة», «بارق - البيضاء», «الدوادمي - الخالديه») are the source's own
  labels; whatever to_catalog() cannot place skips as city_not_in_catalog — never defaulted.

TRANSPORT    Cloudflare. 2026-09-24 first cloud crawl: catalogue page 1 drew the challenge from
  GitHub's datacenter IP («catalogue page 1 unreadable — walk aborted»), so the cloud run goes
  through the Saudi residential proxy (matrix `proxy: true` -> WASALT_PROXY_URL / SCRAPE_PROXY_URL);
  a local run with neither set hits the API directly. The catalogue walk at ~1.5 s per request drew 0 challenges over 15 pages;
  bursts across mixed routes drew intermittent «Just a moment…» pages (HTTP 403 text/html, and once
  an HTTP 500 wrapping an upstream 403). A challenge is a fact about our access, never about a
  listing: fetch_json() backs off and retries, the ENUMERATION fails closed (raises → the run is not
  ok, nothing is pruned), and a DETAIL miss writes an index-only row counted as detail_miss (the
  index alone carries price, area, rooms, type, city and the banner photo; a missing key never
  overwrites a stored value — db._unknown_must_not_overwrite_known).
  A COLD session is what draws the challenge on the DETAIL route: LivenessProbe.fetch() asks for a
  session per attempt, and handing it session() itself (a fresh handshake each time) measured
  2026-09-23 as live controls 24858 live / 24855 unknown / 24852 unknown («HTTP 403 is about our
  access») — safe, but the in-run control failed and the prune was withheld most runs. The walk's
  own session, carrying __cf_bm/_cfuvid from one catalogue call, answered 5/5 (three live, 1000
  gone, sale 24798 gone). So every probe goes through ONE warmed session (_oracle_session: the
  walk's session when main() runs, else a fresh one primed by one catalogue call).

REMOVAL ORACLE (measured 2026-09-23 through the DETAIL route)
  · deleted id  → HTTP 404 {"message":"not found"}: 6 of 6 old ids (1000, 5000, 10000, 15000,
    20000, 20100), and the bogus 99999999.
  · live id     → HTTP 200 status "published" / publish true: 24858 (rent) and 24798 (sale).
  · hidden id   → HTTP 403 text/plain (20250): an existing unit the API will not show. Under the
    shared law a 403 is about OUR access and can never kill.
  verify_gone: 404 not-found → gone; 200 whose status left "published" / publish false → gone; 200
  whose licence says a purpose other than rent → gone (it is no longer a rental); 200 published rent
  → live; anything else → no opinion → UNKNOWN. Pruning runs only after a complete, unlimited
  enumeration, and only when three ids parsed live THIS run answer LIVE through that same oracle
  first — a blocked transport fails that control and nothing is pruned.

PHOTOS       media_images[].image_url (one banner per unit, 282/282) plus the detail's interior /
  exterior file_url with its content-disposition query stripped — the bare object URL serves the
  JPEG (measured: 3,120,156 and 2,887,662 bytes, FF D8 FF E0). Absolute, ASCII, no encoding needed.

MEASURED DRY RUN (2026-09-23, --dry-run, full catalogue, 740 s at PAUSE=1.5 s, 0 challenges)
  282 enumerated → 282 details read (0 detail_miss, 0 detail_not_found) → 280 mapped
  (259 residential + 21 commercial); skipped city_not_in_catalog×2 («الدوادمي - الخالديه»,
  «بارق - البيضاء»). Per field, of 280: price_annual 280 · rent_period 280 · area_m2 280 ·
  license_number 280 (all 10-digit 7-prefixed REGA ad licences) · photo_urls 280 (2-20 each) ·
  description 280 (51 carried a phone number in the prose → redacted) · neighborhood 279 ·
  district_ar 254 (25 site districts are not in the catalogue, e.g. «الأصيل» Jeddah → NULL for
  matching, the card keeps the site's name) · bedrooms 244 · bathrooms 178 · direction 149 ·
  parking 131 · halls 130 · air_conditioner 126 · reception_rooms_majlis 125 · kitchen 118 ·
  street_width_m 76 · maid_room 58 · furnished 52 · driver_room 22 · electricity 275 ·
  water_supply 267 · sanitation 218 · property_age 10 (the detail's unit_age 0, stated beside a
  null default on the other 270) · elevator 0 (no advertiser ticked it) · floor_number 0
  (published null on all 280). Source does not publish: floor number, private entrance,
  rent-now-pay-later, any title (the row's title is the card's own type + location line).
"""
from __future__ import annotations
import os

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii  # noqa: E402

BASE = "https://sakani.sa"
SOURCE = "سكني"
PREFIX = "SKI"
SEARCH = f"{BASE}/marketplaceApi/search/v2/location"
DETAIL = f"{BASE}/marketUnitsApi/v6/market_units/"
DISTRICTS = f"{BASE}/marketplaceApi/search/v1/districts"
PAGE_SIZE = 20
PAUSE = 1.5            # seconds between requests — the pace that drew no challenge

_CHALLENGE = re.compile(r"Just a moment|cf-chl|challenge-platform|cf_chl", re.I)

# The site's English unit_type keys that the shared TYPE_MAP_EN does not spell this way.
_TYPE_OVERRIDES = {
    "floor_through": "Floor", "exhibition": "Showroom", "car_parking": "Parking",
    "station": "Gas Station", "rest_house": "Rest House", "room": "Room",
    "warehouse": "Warehouse", "factory": "Factory",
}
# The site's own Arabic labels for those keys (the page renders «شقة» for apartment); used only
# to compose a title, since the source publishes no title of its own.
_TYPE_AR = {
    "apartment": "شقة", "villa": "فيلا", "floor_through": "دور", "building": "عمارة",
    "office": "مكتب", "land": "أرض", "room": "غرفة", "exhibition": "معرض",
    "rest_house": "استراحة", "car_parking": "موقف سيارات", "warehouse": "مستودع",
    "station": "محطة", "farm": "مزرعة", "factory": "مصنع",
}
_DWELLINGS = {"apartment", "villa", "floor_through", "building", "room", "rest_house", "farm"}
# main_building_face → the fleet's canonical facade (normalize.one_direction's own vocabulary).
# three_streets is a corner plot, not one facade → NULL (kept raw in additional_info).
_FACE = {
    "eastern": "شرق", "northern": "شمال", "western": "غرب", "southern": "جنوب",
    "north_east": "شمال شرق", "south_east": "جنوب شرق",
    "north_west": "شمال غرب", "south_west": "جنوب غرب",
}
# Checkbox amenities → real columns. true → True; false is an unticked box → key left out.
_AMENITY_COLS = (("furnished", "furnished"), ("kitchen", "kitchen"), ("elevator", "elevator"),
                 ("parking", "parking"), ("maid_room", "maid_room"), ("driver_room", "driver_room"))
# Identity / contact keys that must never reach a stored capture (PDPL). Matched on key names,
# recursively; company_name is included because the site fills it with a person's name.
_PRIVATE_KEY = re.compile(
    r"owner|broker|advertiser|phone|mobile|email|contact|responsible|employee|company|"
    r"published_by|requester|national_id|filename|anonymity|preferred_communication|delegated",
    re.I)


_PROXY = (os.environ.get("SCRAPE_PROXY_URL") or os.environ.get("WASALT_PROXY_URL") or "").strip()
_PROXIES = {"http": _PROXY, "https": _PROXY} if _PROXY else None


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome", proxies=_PROXIES)   # impersonate OWNS the User-Agent — never set one
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar"})
    return s


def fetch_json(s: cc.Session, url: str, params: Optional[dict] = None, *,
               tries: int = 4) -> Optional[tuple[int, Any]]:
    """(status, parsed-or-None) for a real answer; None when every try drew a Cloudflare challenge
    or a transport error. A challenge is never a verdict about a listing, so it is retried with a
    growing pause and reported, never interpreted."""
    last = "no attempt"
    for attempt in range(tries):
        try:
            r = s.get(url, params=params, timeout=45)
        except Exception as e:  # noqa: BLE001 — transport errors are retried, never read
            last = type(e).__name__
        else:
            ct = r.headers.get("content-type", "") or ""
            text = r.text or ""
            if "json" in ct:
                try:
                    return r.status_code, r.json()
                except ValueError:
                    last = f"HTTP {r.status_code} unparseable JSON"
            elif _CHALLENGE.search(text) or r.status_code in (403, 429, 503):
                last = f"HTTP {r.status_code} challenge"
            else:
                return r.status_code, None        # a real non-JSON answer (an upstream 500)
        time.sleep(PAUSE * 4 * (attempt + 1))
    print(f"   ⚠ {url.replace(BASE, '')}: {last} after {tries} tries", flush=True)
    return None


def enumerate_rent(s: cc.Session) -> list[tuple[dict, dict]]:
    """Every (search_row, rich_row) attribute pair of the rent marketplace, in catalogue order.
    Raises on a blocked walk or a changed shape — a blocked transport must never read as an empty
    catalogue (that would be the prune-everything shape)."""
    out: list[tuple[dict, dict]] = []
    seen: set[str] = set()
    page = 1
    while True:
        got = fetch_json(s, SEARCH, {"filter[marketplace_purpose]": "rent",
                                     "page[size]": PAGE_SIZE, "page[number]": page})
        if not got or got[0] != 200 or not isinstance(got[1], dict):
            raise RuntimeError(f"catalogue page {page} unreadable "
                               f"({'HTTP %s' % got[0] if got else 'challenge/transport'}) — walk aborted")
        data = got[1].get("data") or []
        rich = {d.get("id"): (d.get("attributes") or {})
                for d in (((got[1].get("meta") or {}).get("first_page") or {}).get("data") or [])}
        for d in data:
            sid = d.get("id")
            if not sid or sid in seen:
                continue
            if sid not in rich:
                raise RuntimeError(f"page {page}: search row {sid} has no rich row — API shape changed")
            seen.add(sid)
            out.append((d.get("attributes") or {}, rich[sid]))
        if len(data) < PAGE_SIZE:
            return out
        page += 1
        time.sleep(PAUSE)


def fetch_detail(s: cc.Session, uid: str) -> tuple[str, Optional[dict]]:
    """('ok', attributes) | ('not_found', None) — the source's own 404 | ('miss', None) — unread."""
    got = fetch_json(s, f"{DETAIL}{uid}")
    if not got:
        return "miss", None
    status, body = got
    if status == 200 and isinstance(body, dict):
        return "ok", ((body.get("data") or {}).get("attributes") or {})
    if status == 404 and isinstance(body, dict) and "not found" in str(body.get("message", "")).lower():
        return "not_found", None
    return "miss", None


def district_names(s: cc.Session, src_city_id: Any, cache: dict) -> dict[str, str]:
    """{sakani district id: name_ar} for one source city, fetched once per run."""
    key = str(src_city_id)
    if key not in cache:
        got = fetch_json(s, DISTRICTS, {"filter[city_id]": key})
        rows = (got[1].get("data") or []) if got and got[0] == 200 and isinstance(got[1], dict) else []
        cache[key] = {str(d.get("id")): ((d.get("attributes") or {}).get("name_ar") or "").strip()
                      for d in rows}
        time.sleep(PAUSE)
    return cache[key]


def _pos(v: Any) -> Optional[int]:
    """A positive whole count, or None. The source's 0 is a blank form field, not a fact."""
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return int(n) if n > 0 and n == int(n) else None


def _public(o: Any) -> Any:
    """A capture with every identity/contact key removed, recursively."""
    if isinstance(o, dict):
        return {k: _public(v) for k, v in o.items() if not _PRIVATE_KEY.search(str(k))}
    if isinstance(o, list):
        return [_public(v) for v in o]
    if isinstance(o, str) and "?response-content" in o:
        return o.split("?")[0]           # the object URL without its upload-filename query
    return o


def _photos(rich: dict, d: dict) -> list[str]:
    urls: list[str] = []
    for m in rich.get("media_images") or []:
        u = (m or {}).get("image_url")
        if u and u.startswith("http") and u not in urls:
            urls.append(u)
    for key in ("exterior_photos", "interior_photos"):
        for p in d.get(key) or []:
            u = ((p or {}).get("file_url") or "").split("?")[0]
            if u.startswith("http") and u not in urls:
                urls.append(u)
    return urls[:20]


def _amenities(d: dict) -> dict[str, bool]:
    am = d.get("amenities") or {}
    util = {str(u).upper() for u in ((d.get("rega_ad_license") or {}).get("property_utilities") or [])}
    out: dict[str, bool] = {}
    for src, col in _AMENITY_COLS:
        if am.get(src) is True:
            out[col] = True
    if am.get("air_conditioning") is True or am.get("ducted_split_ac_concealed") is True:
        out["air_conditioner"] = True
    if am.get("electricity") is True or "ELECTRICITY" in util:
        out["electricity"] = True
    if am.get("water") is True or "WATER" in util:
        out["water_supply"] = True
    if am.get("sewerage_system") is True or "SANITATION" in util:
        out["sanitation"] = True
    return out


def _annual_price(rich: dict) -> tuple[Optional[str], Any]:
    """(rent_period, price) READ from the source's own priced key. The rich row prices itself under
    exactly one key, `annual_unit_price`, and the card prints that figure as «SAR N / كل سنة» — the
    key is the source's period statement, so it is read, never assumed. A row priced under any
    other key (or unpriced) answers (None, None): unknown, never a default. The figure is kept as
    published (an integral float becomes its int; a fractional one passes through unchanged)."""
    if "annual_unit_price" not in rich:
        return None, None
    price = rich["annual_unit_price"]
    if isinstance(price, bool) or not isinstance(price, (int, float)) or price <= 0:
        return None, None
    return "annual", (int(price) if float(price).is_integer() else price)


def _age(d: dict, lic: dict) -> Optional[int]:
    for raw in (d.get("unit_age"), lic.get("property_age")):
        if raw not in (None, ""):
            return normalize.exact_age(raw)
    return normalize.age_from_completion_year(d.get("building_year"),
                                              this_year=datetime.now(timezone.utc).year)


def map_listing(idx: dict, rich: dict, detail: Optional[dict],
                district_raw: Optional[str] = None) -> tuple[Optional[dict], str, str]:
    """One catalogue unit → a row. `detail` is None when its own record could not be read this run
    (index-only row). Returns (row|None, category, skip_reason)."""
    uid = rich.get("resource_id") or idx.get("resource_id")
    if not uid:
        return None, "residential", "no_id"
    uid = str(uid)
    if (rich.get("status") or "") != "published" or rich.get("publish") is not True:
        return None, "residential", f"status_{rich.get('status') or 'blank'}"
    tags = rich.get("tags") or {}
    if str(idx.get("auction_status") or "").strip():
        return None, "residential", "auction"
    if tags.get("sold_out") or tags.get("fully_booked"):
        return None, "residential", "sold_out"
    if tags.get("units_available_soon") or tags.get("registering_interest") \
            or tags.get("registering_waiting_list"):
        return None, "residential", "coming_soon"
    d = detail or {}
    lic = d.get("rega_ad_license") or {}
    if detail is not None and ((d.get("status") or "") != "published" or d.get("publish") is not True):
        return None, "residential", f"detail_status_{d.get('status') or 'blank'}"
    adv = str(lic.get("advertisement_type") or "").strip().lower()
    if adv and adv != "rent":
        return None, "residential", f"purpose_{adv}"

    type_key = str(rich.get("unit_type") or "").strip().lower()
    property_type = normalize.map_type_en(type_key, overrides=_TYPE_OVERRIDES)
    if property_type == "Residential Land" and str(d.get("land_type") or "").lower() == "commercial":
        property_type = "Commercial Land"
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    city_ar = str(rich.get("city_text") or "").strip() or None
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar, str(rich.get("region_text") or "").strip() or None)
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_raw = (district_raw or "").strip() or None
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None

    # PRICE = SOURCE: the card's «SAR N / كل سنة» figure, unchanged, with the period read from the
    # source's own key (see _annual_price). 0/absent is "no price", never a number.
    period, price = _annual_price(rich)
    price_raw = d.get("unit_price") if d.get("unit_price") not in (None, "") else rich.get("annual_unit_price")

    area_raw = d.get("unit_area") if d.get("unit_area") not in (None, "") else rich.get("area")
    try:
        area_f = float(area_raw)
    except (TypeError, ValueError):
        area_f = 0.0
    area = int(area_f) if area_f > 0 else None

    face = ((rich.get("main_building_face") or [None])[0] or d.get("main_building_face") or "")
    face = str(face).strip().lower()
    dwelling = type_key in _DWELLINGS
    description = redact_pii(str(d.get("description") or "").strip()) or None

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{uid}",
        "listing_url": f"{BASE}/app/market-unit/{uid}",
        "source": SOURCE,
        "active": True,
        # No title on the source — the card's own heading (type) and location line, joined.
        "title": " - ".join(x for x in (_TYPE_AR.get(type_key, type_key), city_ar, district_raw) if x),
        "description": description,
        "property_type": property_type,
        "transaction_type": "Rent",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": area,
        "bedrooms": _pos(rich.get("bedrooms")) if dwelling else None,
        "bathrooms": _pos(rich.get("bathrooms")) if dwelling else None,
        "halls": _pos(d.get("number_of_living_rooms")),
        "reception_rooms_majlis": _pos(d.get("number_of_reception_rooms")),
        "floor_number": normalize.to_int(d.get("floor_number")) if d.get("floor_number") not in (None, "") else None,
        "street_width_m": normalize.one_street_width(d.get("main_street_width") or rich.get("main_street_width") or None),
        "direction": _FACE.get(face),
        "property_age": _age(d, lic),
        "license_number": str(lic.get("ad_license_number") or "").strip() or None,   # the AD licence
        "photo_urls": _photos(rich, d) or None,
        "price_annual": price,
        "rent_period": period,        # from the source's own key — see _annual_price
        **_amenities(d),
        "price_evidence": normalize.price_evidence(
            field="marketing_rentals.annual_unit_price", raw=price_raw, stored=price,
            kind="annual", unit="total", origin="api"),
    }
    loc = rich.get("location") or {}
    am = d.get("amenities") or {}
    row["additional_info"] = {
        "source_id": uid,
        "site_ad_number": d.get("ad_number"),
        "unit_type": type_key,
        "region_ar": rich.get("region_text") or None,
        "src_city_id": rich.get("city_id"),
        "src_district_id": d.get("district_id") or None,
        "lat": loc.get("lat"),
        "lng": loc.get("lon"),
        "price_exact": price_raw,
        "period_source": "annual_unit_price / «كل سنة»",
        "area_exact": area_raw,
        "main_building_face": face or None,
        "main_street_width": d.get("main_street_width") or None,
        "floor_number": d.get("floor_number"),
        "number_of_floors": d.get("number_of_floors"),
        "number_of_rooms": d.get("number_of_rooms"),
        "building_year": d.get("building_year"),
        "unit_age": d.get("unit_age"),
        "plan_number": d.get("plan_number") or None,
        "land_number": lic.get("land_number") or None,
        "unit_number": d.get("unit_number") or None,
        "land_type": d.get("land_type") or None,
        "publish_date": d.get("publish_date") or rich.get("publish_date") or None,
        "ad_license_end_date": lic.get("end_date") or None,
        "ad_license_url": lic.get("ad_license_url") or None,
        "property_utilities": lic.get("property_utilities") or None,
        "obligations": lic.get("obligations_on_the_property") or None,
        "amenities_named": sorted(k for k, v in am.items() if v is True) or None,
        "published_actor": d.get("published_actor") or None,      # a role (broker/owner), not a name
        "from_broker": tags.get("from_broker"),
        "price_is_negotiable": rich.get("price_is_negotiable"),
        "detail_captured": detail is not None,
    }
    row["source_capture"] = {
        "schema": "sakani.market_units_v6.v1",
        # _public drops identity/contact KEYS; redact_capture then scrubs any prose value
        # (a phone typed into the description) and keeps numbers, ids and URLs byte-identical.
        "index": redact_capture(_public(rich)),
        "detail": redact_capture(_public(detail)) if detail is not None else None,
    }
    return row, category, ""


# ── LIVENESS ────────────────────────────────────────────────────────────────────────────────────
_AD_RE = re.compile(rf"^{PREFIX}(\d+)$")
_oracle_sess: Any = None


def _oracle_session() -> cc.Session:
    """ONE warmed session for every probe (see TRANSPORT in the docstring): a cold handshake to the
    DETAIL route draws a Cloudflare challenge about half the time and the control fails closed on
    our own cold start. main() hands over the walk's session; a standalone caller gets a fresh one
    primed by a single catalogue call. A challenge still answers UNKNOWN — this never relaxes that."""
    global _oracle_sess
    if _oracle_sess is None:
        _oracle_sess = session()
        fetch_json(_oracle_sess, SEARCH, {"filter[marketplace_purpose]": "rent",
                                          "page[size]": 1, "page[number]": 1})
    return _oracle_sess


def _signal(status, body, _moved):
    """The measured death/life shapes of the DETAIL route (see docstring). Any other read → None."""
    try:
        j = json.loads(body) if body else None
    except ValueError:
        return None
    if not isinstance(j, dict):
        return None
    if status == 404:
        return "gone" if "not found" in str(j.get("message", "")).lower() else None
    if status != 200:
        return None
    a = (j.get("data") or {}).get("attributes") or {}
    if not a:
        return None
    if (a.get("status") or "") != "published" or a.get("publish") is not True:
        return "gone"
    adv = str((a.get("rega_ad_license") or {}).get("advertisement_type") or "").lower()
    if adv and adv != "rent":
        return "gone"                        # the unit lives on, the RENTAL listing does not
    return "live"


def _verify_gone(ad_number: str) -> tuple[str, str]:
    m = _AD_RE.match(ad_number)
    if not m:
        return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
    return LivenessProbe(platform="sakani", signal=_signal, session=_oracle_session,
                         url_for=lambda _a: f"{DETAIL}{m.group(1)}").verify_gone(ad_number)


def _controls_live(ad_numbers: list[str]) -> bool:
    """In-run positive control: three units parsed live THIS run must answer LIVE through the same
    oracle, else the transport is not trusted to testify about anyone's absence. Fails closed."""
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

    global _oracle_sess
    _oracle_sess = s = session()     # the walk warms it; the oracle reuses it (never a cold probe)
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("sakani")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    seen = 0
    try:
        units = enumerate_rent(s)
        if not units:
            raise RuntimeError("the rent catalogue answered 0 units — treated as blocked, not empty")
        if args.limit:
            units = units[:args.limit]
        print(f"{SOURCE}: {len(units)} rent units in the catalogue", flush=True)

        districts: dict = {}
        for idx, rich in units:
            seen += 1
            uid = str(rich.get("resource_id") or idx.get("resource_id") or "")
            detail: Optional[dict] = None
            if uid:
                time.sleep(PAUSE)
                state, detail = fetch_detail(s, uid)
                if state == "not_found":
                    # The index still lists it but its own page would bounce the user home.
                    skipped["detail_not_found"] = skipped.get("detail_not_found", 0) + 1
                    continue
                if state == "miss":
                    skipped["detail_miss"] = skipped.get("detail_miss", 0) + 1   # index-only row
            district_raw = None
            if detail and detail.get("district_id") and rich.get("city_id"):
                district_raw = district_names(s, rich["city_id"], districts).get(str(detail["district_id"]))
            row, cat, why = map_listing(idx, rich, detail, district_raw)
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
                print(f"   {r0['ad_number']:>10} {str(r0['property_type']):14} {str(r0['city_ar']):10} "
                      f"d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>6} "
                      f"bd={str(r0['bedrooms']):>4} pa={r0.get('price_annual')} rp={r0.get('rent_period')} "
                      f"lic={r0.get('license_number')} ph={len(r0.get('photo_urls') or [])}")
            return 0

        # The public upsert_sakani_*_batch wrappers are added centrally later; the shared batch
        # writer is the same code path they wrap.
        db._wasalt_batch("sakani_residential_listings", res)
        db._wasalt_batch("sakani_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="sakani_residential_listings", com_table="sakani_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        # PRUNE — only after a complete, unlimited enumeration (--limit never reaches here; a --type
        # run leaves the other table's seen-set empty by construction), and only once the in-run
        # positive control has passed. prune_unseen's own breakers sit on top.
        pruned = 0
        detail_misses = skipped.get("detail_miss", 0)
        if args.type == "all" and _controls_live([r["ad_number"] for r in res + com]):
            for tbl, rows in (("sakani_residential_listings", res),
                              ("sakani_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=_verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} {notes}"[:300],
                             degraded=detail_misses * 5 > seen,      # >20 % index-only rows
                             check_tables=["sakani_residential_listings",
                                           "sakani_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
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
