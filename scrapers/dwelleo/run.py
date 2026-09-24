"""دويليو — dwelleo.sa. 11,480 catalogue rows on 575 API pages (walked twice 2026-09-24), onboarding 2026-09-24.

OWNERSHIP + REVIVAL — resolved 2026-09-24, evidence and chain of custody below (a prior draft of
this note both overclaimed a settled override AND, in fixing that, overcorrected into calling the
underlying fact "unconfirmed" — neither was quite right; here is what is actually verifiable).

WHAT THE COMMIT SAYS (re-verified fresh against origin/main, 2026-09-24 — this is real, not
invented): commit 63e8695209165ec694c4d7cd503bde0a26581588 ("Remove Dwelleo + Semsar —
foreign-owned (ownership audit)", 2026-06-23, reachable from origin/main today) states in full:
"Ownership audit found both are foreign companies running Saudi-facing portals (banned, same as
Bayut): Dwelleo is a subsidiary of York Holding Group (multinational — Georgia/UAE/Qatar)... Roster
33 -> 31, all confirmed Saudi-owned." That sentence is the ONLY place in this repo's entire history
this claim appears — grepped 2026-09-24, zero other hits for "foreign-owner"/"York Holding" anywhere
in scrapers/, docs/, or supabase/. Two later, independent sessions did not find or cite it:
docs/ARCHITECTURE.md's 2026-07-15 investigation says "No commit message, PR, or doc entry explaining
the removal was found"; the 2026-08-10 formal-retirement migration
(20260810124110_retire_dwelleo_semsar_formalize.sql) calls reviving it "a product/cost decision"
and names no compliance ban. So: the foreign-ownership claim is REAL (one prior session's commit
message, not fabricated), but it was never independently corroborated (no second source verified
York Holding Group actually owns Dwelleo) and was effectively forgotten by the two sessions that
came after it.

THE OWNER'S DECISION (2026-09-24, this onboarding conversation, their own words): told exactly the
above — that the commit attributes the 2026-06-23 removal to a foreign-ownership audit citing York
Holding Group, with no independent corroboration found — the owner replied: "lets trying adding it
fuck that rule." That is an explicit, informed override: proceed regardless of whether the
foreign-ownership characterization is accurate. It is recorded here because the reviewing/fixing
passes that hardened everything else in this file could not see that conversation and correctly
treated the question as open from where THEY stood; it is not open. Onboarding still needs
platform_cadence.is_active flipped back to true (migration 20260810124110 set it false) — a
database step, not a code one.

SOURCE SHAPE (measured live 2026-09-24 over the WHOLE catalogue — every number below is counted)
=================================================================================================
Public JSON API, no auth, no challenge, one fingerprint served (curl_cffi chrome):

    GET https://api.dwelleo.sa/api/v1/properties?page=N          20/page, `per_page` IGNORED
        -> {"data": {"properties": [...], "pagination": {"total": 11472, "total_pages": 574,
                                                        "current_page": N, "count": n}}}
        page 575 answers 200 with count 0 — the walk stops at total_pages. Pagination drifts
        while the site inserts (one id, 18015, arrived on two pages) → rows are keyed by id.
    GET https://api.dwelleo.sa/api/v1/properties/<slug|id>        the full record (accepts BOTH)
        adds what the list omits: images[] (the list carries ONE cover `image`), amenities[],
        street_width, livings, region, land_area, master_bedroom_count. 58/58 sampled details
        carried the same id and the same price as their list card.

Accept-Language: ar is sent; city/area/type names come back Arabic («الرياض», «حي المهدية»,
«شقة»). The public page https://www.dwelleo.sa/ar/properties/<slug> renders the listing
(verified: title, «السعر 1,400,000», «227 م²», the ad licence «7200899466» all on the page).
/ar/properties itself client-redirects to the homepage, so listing_url is ALWAYS the detail page.

Catalogue on 2026-09-24 (second walk, 479 s): 11,480 rows / 11,480 ids, site total 11,481.
listing_type.key: for-sale + re-sale → Buy, for-rent → Rent, short-term-rental 1 (→ skipped,
nightly-only is out of scope).
THE SITE'S OWN QA ROWS: 9 rows (ids 15671-15679) are dwelleo's test listings — slug «test-…»,
title «[تجربة دويليو] …», owner «Test Indiv Broker/Agent/Developer/Broker (Production)» — with
status publish, availability available, a real-looking price and a FAL-shaped licence, so every
other gate passes them. All three markers agree on the same 9 (measured); any ONE of them is a
site_test_row skip (placeholders are never listings).
status is «publish» on all 11,472; availability: available 10,945, off-plan 288, later 237,
sold 1, rented 1 — only «available» is published, the rest are tallied skips (off-plan/later are
the site's own «قريباً/على الخارطة» flags; sold/rented are its closed-deal status).
property_type.name: شقة 5,581 · فيلا 2,815 · ارض 1,159 · دور 736 · مبني 287 · استوديو 202 ·
غير محدد 186 · تاون هاوس 182 · سطح 130 · مكتب 63 · بنتهاوس 53 · محل 52 · مزرعة 13 · شاليه 13.
  · «مبني» is the site's spelling of مبنى (titles: «مبنى تجاري», «عمارة 12 شقة») → Building.
  · «تاون هاوس» → Villa and «بنتهاوس» → Apartment follow the fleet's existing overrides.
  · «ارض» is split by the site's own land_type: residential/blank → Residential Land,
    commercial → Commercial Land, agricultural → Farm (the canon's «أرض زراعية»); raw_land,
    industrial, shovel_ready, institutional, touristic (23 rows) have no honest bucket → skipped.
  · «غير محدد» (mixed استراحات/مستودعات) and «سطح» (roof units; no fleet canon) → type_unmapped.
Cities: 48 distinct; 9 of them (48 rows: الهفوف 29, الدوادمي, بقعا, ابوعريش, المجمعه, الباحة,
رفحا, البدائع, العقيق) are not placed by to_catalog() → city_not_in_catalog. area.name («حي X»)
is the site's district; find_district_in_text canonicalizes 11,277 / 11,424 (98.7%).

PRICE = SOURCE. `price` is an integer riyal figure on 11,423 rows and a decimal on 49 (e.g.
2958861.4); to_int keeps whole riyals and the decimal string is kept in additional_info.price_raw.
Never 0 or null on this site. The public page prints a derived «ر.س لكل م²» beside the price —
that is price ÷ area computed by the site, NOT a published per-metre rate: never stored.
`rental_prediction`, `rental_yield`, `price_prediction`, `investment_score*` are the site's own
AI estimates — ignored entirely.

RENT PERIOD = SOURCE. RENT PRICES CARRY NO PERIOD FIELD and the page shows only «السعر 60,000».
The only period words are in the title/description. Measured over all 2,576 rentals with the
tokens rent_terms() uses: silent 1,537 (59.7%) → rent_period NULL, figure unconverted in
price_annual · annual 702 (27.3%) · monthly 142 (5.5%) → ×12 through rent_period_and_annual ·
BOTH annual and monthly for one figure 147 (5.7%) → NULL, figure unconverted · a sub-monthly
period as the ONLY period (nightly/daily/weekly/نصف سنوي/ربع سنوي) → (None, None) — 0 rows live
(the 48 loose hits were «نظافة أسبوعية», «إطلالة ليلية», «يحتاجها يومياً» and payment-plan
«ربع سنوي» beside a stated annual rent, so the sub-monthly tokens require rent context).

ADVANCED-FILTER FACTS come from the record's labelled fields, prose only fills what the fields
leave silent: bedrooms/bathrooms (dwellings only; a building's «30 bedrooms» is its room stock),
area_sqm → area_m2, building_year → property_age (age_from_completion_year), direction (English
enum: northern/…/southeastern → شمال/…/جنوب شرق; 6 rows spell «شرقي»), detail street_width
("15.00") → street_width_m, livings → halls, floor_number (not for land), furnishing_status
(furnished → True, unfurnished → False, partially_/semi-furnished → NULL, raw kept),
ad_license_number → license_number ONLY in the REGA AD-licence shape 7 + 9 digits (7,085 of
11,480 rows; the other 4,358 are FAL broker licences «12xxxxxxxx» 571, «45…» 116, and 1-20-char
placeholders «1234», «0», «23131313» — they stay in additional_info.ad_license_raw, never in the
AD column), utility_availability (water/electricity/fiber_optics → water_supply/electricity/
optical_fibers True; an empty list is silence). ac_type (detail only; None on 66/66 details
sampled) is the TYPED AC value — the fleet registry's Split/Central/Duct/Window → air_conditioner
True, «None» → False, anything else → silence, the raw value always in additional_info.ac_type.
floor_number is the UNIT floor for dwellings; on a Building it is the building's floor COUNT (167
of 287 buildings carry floor_number, 112 carry number_of_floors, 0 carry both) → floor_number NULL
and the figure in additional_info.building_floor_number.
TRI-STATE: maid_room / driver_room / parking_space are zero-filled by the site's form (maid 0 on
6,112, None on 2,132) and the public page renders NOTHING for a zero, so 0 is silence → NULL; only
a positive count is a «yes». amenities[] + tags[] («جراج», «مصعد», «موقف سيارات», «مفروش»,
«شرفة») and the description prose go through normalize.amenities_from_text (named → True,
negated → False, proximity/prepared → NULL). surrounding_streets is a COUNT (0-4), not a width.

PDPL: `owner` (name/phone/whatsapp/email), `additional_contact` (1,067 rows) are dropped whole;
title/description are redact_pii'd here and again by db (0 of 11,480 titles and 82 descriptions
carry a 05/966-shaped mobile; after redaction 0 descriptions still carry a spaced, Arabic-Indic or
966-92x number — the shared redactor's known blind spots do not occur on this site today).

IDENTITY. ad_number = "DWL" + the record's own numeric id; listing grain = one record.

REMOVAL ORACLE (re-measured 2026-09-24 against ids PROVEN ABSENT from the completed 11,480-row
walk: the range 308-19713 has 7,926 gaps; 30 of them drawn at random, seed 20260924): GET
/api/v1/properties/<id> → 28 × HTTP 422 {"message":"The selected id is invalid."} and 2 × HTTP 404
{"message":"العقار غير موجود"}, 0 × 200 — the detail endpoint served NO record the list omits;
4 live controls drawn from the same walk → 200 with the same id, status «publish», availability
«available». (Ids 309 and 10001 answer 200 available because they ARE catalogue members — the
earlier 8-id sample was drawn from an id range, not from a completed walk.) Slug-family gaps
(…-riyadh-9999) → 422 too. Both non-200 shapes are GONE; a 200 whose record
is this id with availability «sold»/«rented» (or any non-«available») is GONE by status; a 200
with this id available is LIVE; anything else has no opinion, and the shared law turns 403/429/
5xx/timeouts into UNKNOWN. Every removal is canary-gated on a row THIS run mapped still answering
«live» — fails CLOSED. prune_unseen runs only after a COMPLETE walk (every page answered with rows
up to total_pages — an early empty page flags the walk incomplete) that collected ≥ 98% of the
site's own `pagination.total`, never on --limit/--type.

WRITES go through db._wasalt_batch("dwelleo_*_listings", rows) — the public
db.upsert_dwelleo_{residential,commercial}_batch wrappers are added centrally later.
RUNTIME: one detail request per listing (~11.5k, sequential, SCRAPE_MIN_INTERVAL pause). The
detail endpoint answers in ~0.8 s (60 listings in 72 s measured) → a full detailed walk ≈ 3.7 h;
--no-detail maps from the 574 list pages alone in ~5 min (one cover photo, no halls/amenity
chips, no direct-alive stamp) and is the fallback if the workflow budget is shorter.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://www.dwelleo.sa"
API = "https://api.dwelleo.sa/api/v1/properties"
SOURCE = "دويليو"
PREFIX = "DWL"
_PAUSE = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))

_DEAL = {"for-sale": "Buy", "re-sale": "Buy", "for-rent": "Rent"}
# The site's exact spellings where they differ from the shared map (contract: map_type_exact).
_TYPE_OVERRIDES = {"مبني": "Building", "تاون هاوس": "Villa", "بنتهاوس": "Apartment"}
_LAND_BY_USE = {None: "Residential Land", "": "Residential Land", "residential": "Residential Land",
                "commercial": "Commercial Land", "agricultural": "Farm"}
# Types whose bedrooms/bathrooms are the UNIT's; a Building's counts are its whole room stock.
_DWELLINGS = {"Apartment", "Villa", "Floor", "Studio", "Chalet", "Rest House", "Room", "Duplex"}
_FURNISHED = {"furnished": True, "unfurnished": False}       # partially_/semi- → NULL, raw kept
_UTILITY = {"electricity": "electricity", "water": "water_supply", "fiber_optics": "optical_fibers"}
# ac_type is the TYPED value (fleet registry: Split/Central/Duct/Window, «None» = no AC); it sets
# the availability column tri-state and the raw value stays in additional_info. Unknown → silence.
_AC_TYPE = {"split": True, "central": True, "duct": True, "ducted": True, "window": True,
            "concealed": True, "both": True, "none": False}
_AD_LICENCE_SHAPE = re.compile(r"7\d{9}")     # REGA AD licence; FAL broker licences start with 1
# The site's own QA rows (9 in the catalogue, ids 15671-15679, 2026-09-24): slug test-…, title «[تجربة دويليو]», owner
# «Test … (Production)». Placeholders are a skip, never a listing.
_TEST_TITLE = "[تجربة دويليو]"
_TEST_OWNER_RE = re.compile(r"^\s*test\b", re.I)
_DIRECTION_EN = {"north": "شمال", "south": "جنوب", "east": "شرق", "west": "غرب",
                 "northeast": "شمال شرق", "northwest": "شمال غرب",
                 "southeast": "جنوب شرق", "southwest": "جنوب غرب"}

# Rent-period words. Sub-monthly tokens need RENT CONTEXT: bare «أسبوعية»/«يومياً»/«ليلية» on this
# site are «نظافة أسبوعية», «تحتاجها يومياً», «إطلالة ليلية» (measured, 48 of 48 loose hits).
_ANNUAL_RE = re.compile(r"سنوي|بالسنة|في السنة|للسنة|كل سنة")
_MONTHLY_RE = re.compile(r"شهري(?!ن)|بالشهر|في الشهر|للشهر|كل شهر")
_SUB_MONTHLY_RE = re.compile(
    r"(?:إيجار|ايجار|الإيجار|الايجار|سعر|السعر|تأجير|التأجير|أجرة|الأجرة)\s*(?:ال)?"
    r"(?:يومي|يومية|أسبوعي|اسبوعي|أسبوعية|اسبوعية|ليلي|ليلية)"
    r"|ريال\s*(?:سعودي\s*)?(?:يومي|يوميا|يوميًا|يومياً|أسبوعي|اسبوعي|أسبوعيا|أسبوعيًا|أسبوعياً)"
    r"|لليلة|بالليلة|الليلة الواحدة|باليوم|لليوم|/\s*(?:يوم|ليلة)|نصف\s*سنوي|ربع\s*سنوي")


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")   # impersonate OWNS the User-Agent; never set one
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7"})
    return s


def _get_json(s: cc.Session, url: str, *, params: Optional[dict] = None) -> tuple[Optional[int], Any]:
    """(status, parsed json | None) with 3 attempts on transport errors / 5xx / 429."""
    status, data = None, None
    for attempt in range(3):
        try:
            r = s.get(url, params=params, timeout=40)
            status = r.status_code
            if status == 200:
                return status, r.json()
            if status < 500 and status != 429:
                return status, None
        except Exception:  # noqa: BLE001 — retried below
            status = None
        time.sleep(1.5 * (attempt + 1))
    return status, data


def fetch_catalogue(s: cc.Session, limit: int = 0) -> tuple[dict[int, dict], int, bool]:
    """Walk ?page=1..total_pages. Returns ({id: list item}, site_total, complete) where `complete`
    is True only when the walk reached total_pages with rows on every page (an early empty page →
    False; never True under --limit). A page with no data raises."""
    items: dict[int, dict] = {}
    total, page, complete = 0, 1, True
    while True:
        status, payload = _get_json(s, API, params={"page": page})
        data = (payload or {}).get("data") if isinstance(payload, dict) else None
        if not isinstance(data, dict):
            raise RuntimeError(f"catalogue page {page} answered HTTP {status} with no data")
        pg, rows = data.get("pagination") or {}, data.get("properties") or []
        total = int(pg.get("total") or total or 0)
        for it in rows:
            if isinstance(it, dict) and it.get("id") is not None:
                items[int(it["id"])] = it
        if limit and len(items) >= limit:
            return dict(list(items.items())[:limit]), total, False
        total_pages = int(pg.get("total_pages") or page)
        if not rows or page >= total_pages:
            complete = page >= total_pages      # an early empty page is an INCOMPLETE walk
            break
        page += 1
        time.sleep(_PAUSE)
    return items, total, complete


def fetch_detail(s: cc.Session, key: Any) -> Optional[dict]:
    """The full record for a slug or id, or None (a miss is never an empty record)."""
    _status, payload = _get_json(s, f"{API}/{quote(str(key))}")
    data = (payload or {}).get("data") if isinstance(payload, dict) else None
    return data if isinstance(data, dict) and data.get("id") is not None else None


def rent_terms(text: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """(rent_period, note) from the source's OWN words for this listing:
    exactly one of annual/monthly → that period; more than one period word, or none → None with
    the figure kept unconverted; a sub-monthly period as the ONLY one → 'sub_monthly' (the figure
    is then withheld: never parked as annual)."""
    t = text or ""
    found = {name for name, rx in (("annual", _ANNUAL_RE), ("monthly", _MONTHLY_RE),
                                   ("sub_monthly", _SUB_MONTHLY_RE)) if rx.search(t)}
    if found == {"sub_monthly"}:
        return None, "sub_monthly"
    if len(found) == 1:
        return found.pop(), "stated"
    return None, "mixed" if found else "silent"


def _pos(v: Any) -> Optional[int]:
    n = normalize.to_int(v)
    return n if n and n > 0 else None


def _direction(raw: Any) -> Optional[str]:
    if not raw:
        return None
    ar = _DIRECTION_EN.get(str(raw).strip().lower().removesuffix("ern"), str(raw))
    return normalize.one_direction(ar, diagonal=True)


def _photo_urls(rec: dict) -> list[str]:
    out: list[str] = []
    for img in (rec.get("images") or []) + [rec.get("image")]:
        p = (img or {}).get("path") if isinstance(img, dict) else None
        if p and p.startswith("http"):
            p = quote(p, safe=":/?=&%")
            if p not in out:
                out.append(p)
    return out


def _amenities(rec: dict, description: Optional[str]) -> dict[str, Any]:
    """Prose < the site's named amenity/tag chips < its labelled fields."""
    out: dict[str, Any] = dict(normalize.amenities_from_text(description))
    names = [a.get("name") for a in (rec.get("amenities") or []) + (rec.get("tags") or [])
             if isinstance(a, dict) and a.get("name")]
    out.update(normalize.amenities_from_text("، ".join(names)))
    for col in ("maid_room", "driver_room"):
        if _pos(rec.get(col)):
            out[col] = True
    if _pos(rec.get("parking_space")):
        out["parking"] = True
    if rec.get("furnishing_status") in _FURNISHED:
        out["furnished"] = _FURNISHED[rec["furnishing_status"]]
    for key in rec.get("utility_availability") or []:
        if key in _UTILITY:
            out[_UTILITY[key]] = True
    ac = str(rec.get("ac_type") or "").strip().lower()
    if ac in _AC_TYPE:
        out["air_conditioner"] = _AC_TYPE[ac]
    return out


def _clean_info(d: dict[str, Any]) -> dict[str, Any]:
    out = {}
    for k, v in strip_pii_fields(d).items():
        if isinstance(v, str):
            v = redact_pii(v)
        if v is None or v == "" or v == [] or v == {}:
            continue
        out[k] = v
    return out


def map_listing(rec: dict, *, this_year: Optional[int] = None) -> tuple[Optional[dict], str, str]:
    """One API record (list item, or list item merged with its detail) → (row|None, category, why)."""
    this_year = this_year or datetime.now(timezone.utc).year
    dwl_id = _pos(rec.get("id"))
    if not dwl_id:
        return None, "residential", "no_id"
    slug = (rec.get("slug") or "").strip()
    if not slug:
        return None, "residential", "no_slug"
    owner_name = str((rec.get("owner") or {}).get("name") or "") if isinstance(rec.get("owner"), dict) else ""
    if slug.startswith("test-") or _TEST_TITLE in (rec.get("title") or "") or _TEST_OWNER_RE.search(owner_name):
        return None, "residential", "site_test_row"
    if (rec.get("status") or "") != "publish":
        return None, "residential", f"status_{rec.get('status') or 'blank'}"
    avail = (rec.get("availability") or "").strip()
    if avail != "available":
        return None, "residential", f"availability_{avail or 'blank'}"    # off-plan/later/sold/rented

    deal_key = ((rec.get("listing_type") or {}).get("key") or "").strip()
    deal = _DEAL.get(deal_key)
    if not deal:
        return None, "residential", f"deal_{deal_key or 'blank'}"

    type_ar = ((rec.get("property_type") or {}).get("name") or "").strip()
    if type_ar in ("ارض", "أرض"):
        property_type = _LAND_BY_USE.get(rec.get("land_type"))
    else:
        property_type = normalize.map_type_exact(type_ar, overrides=_TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    city_ar = ((rec.get("city") or {}).get("name") or "").strip() or None
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar, (rec.get("region") or {}).get("name"))
    if not city_id:
        return None, category, "city_not_in_catalog"
    # The list card names the district under `area`; the detail record renames it `property_area`
    # and reuses `area` for a NUMBER — merged, the dict must win over the figure.
    area = rec.get("property_area") if isinstance(rec.get("property_area"), dict) else rec.get("area")
    neighborhood = ((area.get("name") if isinstance(area, dict) else None) or "").strip() or None
    district_ar = find_district_in_text(neighborhood, city_id) if neighborhood else None

    title = redact_pii(rec.get("title")) if rec.get("title") else None
    description = redact_pii(rec.get("description")) if rec.get("description") else None
    price = _pos(rec.get("price"))
    is_land = property_type.endswith("Land") or property_type == "Farm"

    licence = str(rec.get("ad_license_number") or "").strip()
    street_width = normalize.one_street_width(rec.get("street_width"))
    direction = _direction(rec.get("direction"))
    if street_width is None and direction is None:
        street_width, direction = normalize.street_from_prose(rec.get("description"))

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{dwl_id}",
        "listing_url": f"{BASE}/ar/properties/{slug}",
        "source": SOURCE,
        "active": True,
        "title": title,
        "description": description,
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": neighborhood,
        "area_m2": _pos(rec.get("area_sqm")),
        "bedrooms": _pos(rec.get("bedrooms")) if property_type in _DWELLINGS else None,
        "bathrooms": _pos(rec.get("bathrooms")) if property_type in _DWELLINGS else None,
        "halls": _pos(rec.get("livings")),
        "master_bedrooms": _pos(rec.get("master_bedroom_count")),
        # a Building's floor_number is its floor COUNT (no unit floor exists) → additional_info only
        "floor_number": None if is_land or property_type == "Building" else normalize.to_int(rec.get("floor_number")),
        "property_age": normalize.age_from_completion_year(rec.get("building_year"), this_year=this_year),
        "street_width_m": street_width,
        "direction": direction,
        "license_number": licence if _AD_LICENCE_SHAPE.fullmatch(licence) else None,
        "photo_urls": _photo_urls(rec)[:30] or None,
        **_amenities(rec, description),
    }
    if deal == "Rent":
        period, note = rent_terms(f"{rec.get('title') or ''}\n{rec.get('description') or ''}")
        if note == "sub_monthly":
            # db.AUTHORITATIVE_NULL, NOT plain None: the source stated a nightly/weekly/etc. period,
            # which settles that this figure is never parked as annual — but a plain None/absent key
            # is DROPPED by db._unknown_must_not_overwrite_known before the upsert (so a FAILED read
            # can never blank a known value), which would leave a stale annual/monthly value from an
            # earlier crawl frozen in place. Same fix aqarcity/jawher/moftah/wasalt already apply.
            row["price_annual"] = db.AUTHORITATIVE_NULL
            row["rent_period"] = db.AUTHORITATIVE_NULL
        elif period:
            row["rent_period"], row["price_annual"] = normalize.rent_period_and_annual(
                price, "سنوي" if period == "annual" else "شهري")
        else:
            row["price_annual"] = price                          # silent/mixed: figure as printed
            # rent_period = AUTHORITATIVE_NULL (not absent): the site publishes no period field at
            # all for rent prices, so "we found no period word" is the source's own settled state,
            # not a read failure — it must overwrite a stale 'monthly'/'annual' from an earlier
            # crawl on re-crawl (RENT PERIOD = SOURCE), matching the sub_monthly fix above.
            row["rent_period"] = db.AUTHORITATIVE_NULL
        kind = {"annual": "annual", "monthly": "monthly"}.get(period, "total")
    else:
        row["price_total"] = price
        kind = "total"
    # AUTHORITATIVE_NULL (sub_monthly branch above) must never reach price_evidence's `stored` —
    # it is not JSON-serializable and this dict is folded into source_capture and written to jsonb.
    # Coerce to plain None and say WHY via authoritative_absent, matching jawher/moftah's own
    # `stored=... if isinstance(...) else None` / `authoritative_absent=... is db.AUTHORITATIVE_NULL`.
    _stored = row.get("price_total", row.get("price_annual"))
    row["price_evidence"] = normalize.price_evidence(
        field="price", raw=rec.get("price"),
        stored=None if _stored is db.AUTHORITATIVE_NULL else _stored,
        kind=kind, origin="api", authoritative_absent=_stored is db.AUTHORITATIVE_NULL)
    row["images_evidence"] = {"observed": True, "container_present": "images" in rec,
                              "key_present": bool(rec.get("images") or rec.get("image")),
                              "count": len(row["photo_urls"] or [])}
    row["additional_info"] = _clean_info({
        "dwelleo_id": dwl_id, "slug": slug,
        "listing_type": deal_key, "listing_type_label": (rec.get("listing_type") or {}).get("label"),
        "type_ar": type_ar, "land_type": rec.get("land_type"),
        "price_raw": str(rec["price"]) if isinstance(rec.get("price"), float) else None,
        "area_sqm": rec.get("area_sqm"), "land_area": rec.get("land_area"),
        "source_bedrooms": rec.get("bedrooms"), "source_bathrooms": rec.get("bathrooms"),
        "livings": rec.get("livings"), "master_bedroom_count": rec.get("master_bedroom_count"),
        "building_year": rec.get("building_year"),
        "direction_raw": rec.get("direction"), "street_width_raw": rec.get("street_width"),
        "surrounding_streets_count": rec.get("surrounding_streets"),
        "furnishing_status": rec.get("furnishing_status"),
        "parking_space": rec.get("parking_space"), "parking_type": rec.get("parking_type"),
        "maid_room_count": rec.get("maid_room"), "driver_room_count": rec.get("driver_room"),
        "utility_availability": rec.get("utility_availability"),
        "amenities": [a.get("name") for a in rec.get("amenities") or [] if isinstance(a, dict)],
        "tags": [t.get("name") for t in rec.get("tags") or [] if isinstance(t, dict)],
        "has_pool": rec.get("has_pool"), "ac_type": rec.get("ac_type"),
        "is_bachelor": rec.get("is_bachelor"), "is_mixed": rec.get("is_mixed"),
        "installments_available": rec.get("installments_available"),
        "utilities_included": rec.get("utilities_included"),
        "number_of_floors": rec.get("number_of_floors"), "number_of_flats": rec.get("number_of_flats"),
        "number_of_entrances": rec.get("number_of_entrances"),
        "compound": (rec.get("compound") or {}).get("name") if isinstance(rec.get("compound"), dict) else None,
        "lat": (rec.get("location") or {}).get("lat"), "lng": (rec.get("location") or {}).get("lng"),
        "ad_license_raw": licence or None,
        "building_floor_number": rec.get("floor_number") if property_type == "Building" else None,
        "rent_period_note": note if deal == "Rent" else None,
        "number_of_images": rec.get("number_of_images"),
        "is_featured": rec.get("is_featured") or None,
    })
    return row, category, ""


# ── LIVENESS ────────────────────────────────────────────────────────────────────────────────────
_GONE_404 = "العقار غير موجود"
_GONE_422 = "The selected id is invalid."


def _signal_for(dwl_id: int):
    def _signal(status, body, _moved):
        if status == 404 and _GONE_404 in body:
            return "gone"
        if status == 422 and _GONE_422 in body:
            return "gone"
        if status != 200:
            return None
        try:
            data = (json.loads(body) or {}).get("data")
        except (ValueError, TypeError, AttributeError):
            return None
        if not isinstance(data, dict) or _pos(data.get("id")) != dwl_id:
            return None
        ok = data.get("status") == "publish" and data.get("availability") == "available"
        return "live" if ok else "gone"
    return _signal


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None) -> tuple[str, str]:
        oid = ad_number[len(PREFIX):] if ad_number.startswith(PREFIX) else ""
        if not oid.isdigit():
            return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
        return LivenessProbe(platform="dwelleo", signal=_signal_for(int(oid)), session=session,
                             url_for=lambda _ad: f"{API}/{oid}", canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = probe(control["ad_number"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    # The detail endpoint answers in ~0.8 s; a full detailed walk is ~3.7 h. --no-detail maps from
    # the list cards alone (one cover photo, no halls/amenities chips, no direct-alive stamp).
    ap.add_argument("--no-detail", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("dwelleo")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    seen = 0
    try:
        items, site_total, complete = fetch_catalogue(s, args.limit)
        if not items:
            raise RuntimeError("the catalogue API answered with no properties")
        print(f"{SOURCE}: {len(items)} listings enumerated (site total {site_total})", flush=True)
        for dwl_id, item in items.items():
            seen += 1
            detail = None
            if not args.no_detail:
                time.sleep(_PAUSE)
                detail = fetch_detail(s, item.get("slug") or dwl_id)
                if detail is None or _pos(detail.get("id")) != dwl_id:
                    skipped["detail_miss"] = skipped.get("detail_miss", 0) + 1   # the card still maps
                    detail = None
            row, cat, why = map_listing({**item, **(detail or {})})
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if detail is not None:
                db.mark_direct_alive(row, oracle="dwelleo.api.detail.id_match")
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)

        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}", flush=True)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>9} {r0['transaction_type']:4} {str(r0['property_type']):16} "
                      f"{str(r0['city_ar']):8} d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>6} "
                      f"bd={str(r0['bedrooms']):>4} p={r0.get('price_total') or r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} ph={len(r0.get('photo_urls') or [])}")
            return 0

        db._wasalt_batch("dwelleo_residential_listings", res)
        db._wasalt_batch("dwelleo_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="dwelleo_residential_listings", com_table="dwelleo_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        # PRUNE only after a COMPLETE walk that collected the site's own total (≥ 98%), with the
        # canary-gated oracle above; prune_unseen's own breakers sit on top.
        pruned = 0
        if args.type == "all" and complete and len(items) >= 0.98 * site_total:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in (("dwelleo_residential_listings", res), ("dwelleo_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        else:
            print(f"  prune skipped: walk complete={complete}, {len(items)}/{site_total} collected")
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} {notes}"[:300],
                             check_tables=["dwelleo_residential_listings",
                                           "dwelleo_commercial_listings"])
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
