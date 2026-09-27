"""سكنة (Sukna) — suknamdn.sa / sukna.app. 597 units, onboarding 2026-09-24.

A developer-inventory marketplace: 31 new-build projects in Riyadh + Jeddah, sold unit by unit.
Every number below was MEASURED on 2026-09-24/25 against the live source; nothing is assumed.

NAME. The roster called this platform «سكنى». The source calls itself «سكنة» — `og:site_name` is
"سكنة | Sukna", `application-name` is «سكنة», and the string «سكنى» appears ZERO times on its home
page (32 occurrences of «سكنة»). SOURCE is the platform's own spelling; the roster line is wrong and
is raised as an open question.

HOST. suknamdn.sa 301s to sukna.app (verified on both apex and www) — sukna.app is canonical for the
BROWSER, and the JSON API lives on suknamdn.sa. Both are used, deliberately:
  · listing_url  = https://sukna.app/unit-details?id=<id>   (what a human opens)
  · data + oracle = https://suknamdn.sa/api/v1/units[/<id>]  (what we read)

TLS: A 403 HERE IS THE HANDSHAKE, NOT THE ADDRESS. Same IP, same second, GET
sukna.app/unit-details?id=437: chrome / chrome116 / chrome120 / chrome124 / chrome131 / edge99 /
edge101 / safari17_0 all returned 403 with an identical 6,192-byte body; safari, firefox and
firefox133 returned 200 with the real 62,771-byte page. The API host answers any profile. So the
session impersonates **firefox** and never "chrome".

ACCEPT-LANGUAGE: ar IS LOAD-BEARING, NOT POLITENESS. The API localises its own payload. Same
`/api/v1/units/726`, two headers:
    (no header) → address {"city": "Riyadh", "state": "AN-NARJIS"}, description in ENGLISH
    ar          → address {"city": "الرياض", "state": "النرجس"},   description in ARABIC
`to_catalog()` resolves Arabic city names, so without the header EVERY row would skip as
city_not_in_catalog and every description would land in the wrong language. (`unit_type` is NOT
localised — its Arabic/English mix is per-row data entry, see below.)

    GET /api/v1/units?per_page=1000 → {"data": {"units": [ … ], "units_count": 597}}
    GET /api/v1/units/<id>          → {"data": { … 69 keys … }}

  COMPLETENESS IS SELF-DECLARING. per_page=1000 served 597 rows with 597 DISTINCT ids and
  `units_count` 597; per_page=500 served exactly 500 of the same 597. The default page size is 10.
  Pruning only runs when `units_count` equals the distinct rows held, so a truncated response can
  never look like a shrunken catalogue.

  DETAIL FETCH = DIRECT EVIDENCE. Each row is built from a fetch of THAT unit's own record, and the
  payload's own `data.id` is checked against the id requested before anything is stored — so
  db.mark_direct_alive() applies (its three conditions: own record, affirmative parseable payload,
  confirmed identity). 597/597 answered 200. Two ids (569, 655) failed a first concurrent pass and
  both answered 200 on retry — a concurrency blip, not a 404; the crawl retries 3×.

THE TRAPS, ALL MEASURED
-----------------------
1. `total_amount` IS STALE — AND IS THE PRICE THE UI SHOWS. This is the site's hardest trap.
   The source publishes three money fields: `unit_price`, `property_tax`, `total_amount`, labelled
   «سعر الوحدة», «ضريبة العقار» and «الإجمالي شاملًا الضريبة» (total including tax). The site's own
   bundle binds the card price to the TOTAL: `price:{total:P(t.total_amount||t.unit_price)}`.
   It is nonetheless NOT storable as this listing's price, because the source does not keep it in
   sync with `unit_price`:
     · total_amount ≠ unit_price + property_tax on 149 of the 496 rows that publish all three;
     · on 17 rows it is LOWER than the unit price ALONE — id 630: unit_price 1,649,000, tax 77,500,
       total_amount 1,627,500. A "price including tax" below the price cannot be this unit's price.
       id 631 (1,439,000 / 70,000 / 1,470,000) reconciles exactly against a unit_price of
       1,400,000 — i.e. total_amount is a denormalised copy of a SUPERSEDED price;
     · it is absent on 101 rows, which is why the client needs its `||` fallback at all.
   `unit_price` is the figure the source publishes as the offer price in its OWN structured,
   machine-readable form: the unit page's schema.org JSON-LD `offers.price` equalled `unit_price`
   — never `total_amount` — on every page checked (726: 1,800,000 vs total 1,890,000; 437:
   1,699,000 vs 1,783,950; 481: 2,399,000 vs 2,518,950; 562: 1,226,869, no total published).
   So: price_total = `unit_price`, VERBATIM. `total_amount` and `property_tax` are kept in
   additional_info as published, and NOTHING is ever computed — not unit_price + property_tax, not
   total_amount − property_tax. Whether the owner wants the VAT-inclusive figure shown instead is a
   commercial question, raised below; it is not a thing this scraper may decide by arithmetic.
   Id 197 publishes NO price at all (unit_price, total_amount and property_tax all null, and its
   page carries no JSON-LD `offers` block) → price_total NULL. It is also case 2, so it skips.

2. NO RENTS EXIST — AND THE SITE IS FULL OF MONTHLY FIGURES ANYWAY. All 31 projects publish
   `purpose: "sale"`; `sale_type` is "direct" on 597/597 units; there is no rent field of any kind
   and no period token («شهري» / «سنوي» / «يومي» / «أسبوعي» / «إيجار») anywhere in any title or
   description (measured: 0 matches across all 597). What the source DOES publish is
   `payment_amount` (700 on 581 of 597 rows) under the label «القسط الشهري» — the monthly instalment —
   and `proposed_payment_plan`, a list of purchase instalments ({percentage: 25, amount: 231000}).
   Those are PURCHASE-plan figures. Reading either as a rent would invent a rental listing, and
   ×12-ing the 700 would publish a 8,400 «annual rent» for a 1.8M flat. So `rent_period` and
   `price_annual` are NEVER set by this mapper, under any input — a sale-only source that states no
   period keeps both NULL — and the instalment fields reach nothing but additional_info.
   sukna is deliberately absent from SINGLE_PERIOD_PLATFORMS: it makes no period statement at all.

3. OFF-PLAN, IN THE SOURCE'S OWN WORDS. The bundle's own delivery label is
       function j(t){return t.enables_payment_plan?"under-construction":"ready"}
       …  "ready"===n ? «جاهز» : o>0 ? «بيع على الخارطة (o%)» : «بيع على الخارطة»
   i.e. a project with `enables_payment_plan` truthy IS «البيع على الخارطة», optionally with its
   `completion_percentage`. 6 of 31 projects are flagged (completion 0%, 0%, 6%, 55%, 65%, 97%).
   The flag is COPIED ONTO THE UNIT, and the copy is exact: all 172 units of those 6 projects carry
   `enables_payment_plan: 1` and all 423 units of the other projects carry 0 — zero counter-examples
   in either direction. So off-plan is decided from the unit's own field, with no second fetch, and
   those rows skip with a counted reason. The phrase «بيع على الخارطة» never appears in the unit
   payloads themselves, so a text heuristic would have found nothing — the flag is the marker.

4. `case` IS THE SOLD/RESERVED STATUS, AND THE SOURCE'S OWN SITEMAP CORROBORATES IT EXACTLY.
   The bundle maps it: `status:({0:"available",1:"reserved",2:"sold"})[t.case]`, against the labels
   «متاحة للبيع» / «محجوزة» / «مباعة». Distribution over all 597: 0 → 335, 1 → 35, 2 → 227. And
   sukna.app/sitemap.xml carries 370 `/unit-details?id=` locs which are EXACTLY the case 0 + case 1
   ids — set equality, verified as such; 0 of the 227 case-2 ids appear, and no case 0/1 id is
   missing. A perfect partition over 597/597, with zero counter-examples in either direction.
     case 2 → SKIPPED, counted. «مباعة» is the source saying it stopped selling this unit, and
              dropping it from its own sitemap is the source saying it stopped publishing the ad.
     case 1 → KEPT. «محجوزة» is reserved, not sold; the source still publishes it and still lists
              it in its sitemap. Whether a reserved unit should surface in search is a product
              question, raised below — it is recorded in additional_info either way.

5. THREE AREAS, INDEPENDENTLY PUBLISHED. `total_area` ≠ `internal_area` + `external_area` on 137 of
   the 393 rows publishing all three (id 240: 323.00 vs 231.36 + 91.00). Each is stored verbatim in its
   own column (area_m2 / interior_space_m2 / outdoor_area_m2) and none is derived from the others.

6. TWO KEYS HAVE A TRAILING SPACE IN THE SOURCE'S OWN JSON: `"street_width "` and
   `"deed_location_description "`. `rec.get("street_width")` returns None on all 597 rows and the
   street width would have been silently lost fleet-wide-looking-fine. The space is in the constants.

7. `unit_type` IS BILINGUAL, PLURALISED AND PADDED. 12 distinct values across 597 rows:
   «شقق» 91, «ادوار» 90, "apartment" 89, «دور» 74, «فلل» 64, «تاون هاوس» 59, "villa" 44,
   «بنتهاوس » 31, «فيلا» 16, «شقة» 16, "penthouse" 14, «أدوار » 9. Only 4 of the 12 resolve through
   the shared TYPE_MAP_AR unaided. Every override below is an EXISTING fleet mapping, not a new
   judgment: «بنتهاوس»→Apartment (dwelleo, rakez, dealapp, justsa, azure, rightcompound),
   «تاون هاوس»→Villa (dwelleo, eilmalriyada, aqalemhajer; TYPE_MAP_EN already folds "townhouse"),
   «فلل»→Villa and «أدوار»/«ادوار»→Floor (souq24, alkhaas). The English slugs go through the
   shared TYPE_MAP_EN, with "penthouse" overridden to match its Arabic twin. Values are stripped
   before lookup because the source pads them.

8. `floor` NAMES MORE THAN ONE FLOOR. 12 distinct values: bare numbers ("1", "2", "3"), the fleet's
   ordinal words («الأرضي »→0, «الأول »→1, «الثاني »→2 — same vocabulary as aqaralriyadh), the
   unnumberable «الملحق » (the roof annex, 30 rows), and MULTI-FLOOR strings — «الأول - الملحق »
   (25), «الأرضي  - الأول » (19, note the double space), «الأرضي - الأول » (6). A duplex spanning
   two floors has no single floor_number, so anything naming two stays NULL rather than picking one;
   the raw string is kept in additional_info. 286 rows publish no floor at all.

9. PDPL. `responsible_employee_name` carries a REAL PERSON'S NAME (measured: «عبدالعزيز علي محمد
   الحربي»), `responsible_employee_phone` a mobile, `sales_phone_number` another, and
   `developer.phone` a company line. None of them, and no key added upstream tomorrow, can reach a
   column, additional_info or source_capture: both JSONB payloads are built from an explicit key
   ALLOWLIST, then passed through strip_pii_fields() as a second barrier, and every free-text value
   goes through redact_pii(). No description in the current snapshot contains a phone or a
   WhatsApp link (0 of 597) — the redaction is there because the field is advertiser-written prose
   and tomorrow's snapshot is not today's.

REMOVAL ORACLE (measured — and THE RENDERED PAGE CANNOT BE IT)
--------------------------------------------------------------
sukna.app/unit-details?id=<anything> answers 200. Fabricated ids 0 and 999999 both returned 200 with
the full app shell, because the route is client-rendered and fetches its data afterwards. It is a
SOFT-404: a page-status oracle here would resurrect every dead row forever. The API is decisive:

    API 404 «resource not found»            → gone   (ids 0, 99999, 999999)
    API 200 + case == 2                     → gone   (the source's own «مباعة», and the id is
                                                      absent from the source's own sitemap —
                                                      227/227 with zero counter-examples)
    API 200 + case in (0, 1)                → live   (self-heal: «متاحة»/«محجوزة» are both still
                                                      published and still in the sitemap)
    API 200 + no readable case              → UNKNOWN
    anything else                           → UNKNOWN — and note id 1 answers HTTP **500**
        ({"errors":["Attempt to read property \\"payment_amount\\" on null"]}), which is a missing
        unit wearing a server error. The shared law already refuses to kill on 5xx, and this signal
        deliberately does not try to special-case it: a Laravel 500 is the source being broken, and
        one unit's absence is not worth a rule that could mistake an outage for 597 deaths.

`availability` IS NOT THE ORACLE, THOUGH IT LOOKS LIKE ONE. The unit page's JSON-LD carries
`offers.availability`, and the onboarding brief proposed it as the removal signal. It is a
HARDCODED CONSTANT: it reads "https://schema.org/InStock" on every page measured, including case-2
units the source itself calls «مباعة» and excludes from its own sitemap (checked on 4 units of each
case — 12 pages, 12 InStock, 0 counter-examples). Trusting it would have produced an oracle that can
never retire anything. `case` is the field that actually varies.

Removals are additionally gated by an in-run positive control that fails CLOSED.

COVERAGE (FULL walk against the live API, 2026-09-25 — 1 list call + 597 detail calls)
-------------------------------------------------------------------------------------
    سكنة: 597 unit record(s) of 597 listed; units_count=597 missing=0 complete=True
    mapped: 290 residential + 0 commercial
    skipped (not guessed): off_planx172, sold_case_2x135          (172 + 135 + 290 = 597)

  The two skip counts are disjoint by evaluation order, not by accident: 227 units are case 2 and
  172 are off-plan, and 92 rows are BOTH — off-plan is tested first, so `sold_case_2` counts the
  135 sold rows that are not also off-plan. 227 − 92 = 135 and 597 − 172 − 135 = 290, exactly.

  ALL 290 ARE IN RIYADH, and that is the source's state rather than a scraper failure: every one of
  the 42 Jeddah units belongs to «اوتوجراف 21» or «اوتوجراف 22», and both of those projects carry
  `enables_payment_plan` (55% and 65% complete), so the whole Jeddah inventory is off-plan today.

  Types: Apartment 121 · Villa 100 · Floor 69 (no commercial type occurs, so the commercial table
  stays empty). Status of the mapped rows: «متاحة للبيع» 256 · «محجوزة» 34.
  transaction_type Buy 290/290 · rent_period 0 · price_annual 0 — both by construction (trap 2)
  price_total 290 · city_id 290 (all الرياض/3) · district_ar 290/290 · project_name 290
  area_m2 284 · interior_space_m2 288 · outdoor_area_m2 188 · bedrooms 290 · bathrooms 290
  halls 290 · kitchen 285 · property_age 290 («جديد» → 0) · title 290 · description 290
  license_number 290 · license_expiry 290 · plan_parcel 290 · building_number 290
  street_width_m 135 · floor_number 138 · direction 124 · photo_urls 210
  parking 152 · maid_room 129 · private_entrance 35 · air_conditioner 27 · driver_room 20
  balcony_terrace 17 · elevator 14

OPEN QUESTIONS FOR ONBOARDING (none of these is guessed in code)
----------------------------------------------------------------
  · NAME: the roster says «سكنى», the platform says «سكنة». SOURCE uses the platform's spelling.
  · PRICE BASIS: we store «سعر الوحدة» (unit_price), the figure the source's own JSON-LD publishes
    as `offers.price`. Its cards show «الإجمالي شاملًا الضريبة» (total_amount), which is
    VAT-inclusive AND measurably stale on 149 rows. If the owner wants parity with the card rather
    than with the offer, that is a decision to take explicitly — not something to derive.
  · «محجوزة» (case 1, 34 of the 290 mapped rows): should a RESERVED unit appear in search? Currently
    yes, because the source still publishes it and still lists it in its own sitemap. Flipping it is
    a one-line change to _SKIP_CASES.
  · `status` (0 on 393, 1 on 204) is a second, undocumented flag. It does not correlate with `case`
    (all six combinations occur) or with off-plan, and the site's own bundle ignores it entirely.
    Meaning UNKNOWN → recorded in additional_info, interpreted nowhere. Worth asking the platform.
  · Four `project_id`s that units reference (6, 40, 42, 44) are absent from /api/v1/projects. Those
    units' off-plan flag comes from their own record, so nothing is guessed — but a unit pointing at
    a project the platform no longer lists is worth asking about.
  · `additional_features` is published on only 31 of 597 units. «حديقة»/Garden, «حوش خاص»/Private
    yard, «دخول ذكي»/Smart entry, «منزل ذكي»/Smart home and «جلسات خارجية»/Outdoor seating have no
    fleet column and are kept as raw words in additional_info.
  · `after_sales_services` includes «تأجير الوحدة» ("unit letting", 30 rows) — a post-sale service
    the developer offers, NOT a rent listing. It is recorded and read as nothing.

DETAIL, MEASURED
----------------
  · Photos: `images[]` carries `{image_path, type}` and the source's own split is honoured —
    `type == "floor_plan"` is an engineering drawing («المخطط الهندسي»), not a photo of the
    property, so it goes to additional_info and the rest to photo_urls. Both verified served:
    HTTP 200, Content-Type image/jpeg and image/png, and NO cross-origin-resource-policy header,
    so they embed.
  · `property_age` is «جديد» on 499 and null on 98 — the shared parse_property_age() reads «جديد»
    as 0 (new construction). No other value exists.
  · LOCATION resolves 100%: `address.city` is «الرياض» (555) or «جدة» (42), both in
    loc_catalog_city; all 16 distinct `address.state` values resolve against loc_catalog_district
    for their own city (verified row-by-row against production: «النرجس»→«حي النرجس», …). The raw
    state is kept in `neighborhood` regardless, and `address.street` («الرياض - النرجس ») is a
    fallback for find_district_in_text.
  · `obligations_on_the_property` is the same sentence on all 597 («لا يوجد التزامات على العقار»)
    and `guarantees_and_their_duration`, `property_usage`, `project_ownership`, `threedurl` and
    `user_id` are empty on all 597 — none is read.
  · `latitude`/`longitude` are published on 515 rows; the listing tables carry no coordinate
    columns, so they are not stored.
  · LISTING URLS VERIFIED: 6 of the 290 mapped rows were re-opened on sukna.app after the walk, and
    each answered 200 with its OWN content — the page's JSON-LD `url` equals the stored listing_url,
    its `name` is this row's unit number, and its `offers.price` equals the stored price_total to the
    riyal (SKN437 1,699,000 · SKN438 1,549,000 · SKN439 1,469,000 · SKN440 1,999,000 ·
    SKN441 1,949,000 · SKN442 1,699,000). Earlier spot checks added ids 726, 481, 562 and 197.
  · `title` is only the unit number ("201", "1435 B"), which is also what the page's JSON-LD `name`
    and its breadcrumb show. The stored title joins the source's own `project_name` to it
    («أدوار W2 – 201») — the same composition azure and rightcompound use for unit-grain rows.
    Every character is source text; nothing is invented.
  · No «مزاد» anywhere (0 occurrences across all 597 payloads). The auction guard is kept anyway,
    costs one substring test, and is counted if it ever fires.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http import TRANSIENT_STATUSES  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

# The BROWSER host (suknamdn.sa 301s here) and the API host. Both measured — see the docstring.
SITE = "https://sukna.app"
API_BASE = "https://suknamdn.sa"
LIST_API = f"{API_BASE}/api/v1/units"
SOURCE = "سكنة"            # the platform's OWN spelling (og:site_name "سكنة | Sukna"), not «سكنى»
PREFIX = "SKN"
SLUG = "sukna"
PAGE_SIZE = 1000           # serves the whole catalogue in one response (597 rows, measured)

# The source's own case→status map, lifted from its own bundle:
#   status:({0:"available",1:"reserved",2:"sold"})[t.case]
_CASE_STATUS = {0: "available", 1: "reserved", 2: "sold"}
# Cases that are NOT for sale. «مباعة» is the source's own word and the case-2 ids are exactly the
# ones missing from its own sitemap (227/227). «محجوزة» (1) is still published, so it is kept —
# see the open question; moving 1 into this set is the whole change.
_SKIP_CASES = {2}

# Every entry is an EXISTING fleet mapping (see trap 7) — no new judgment is made here.
# Keyed on the stripped value; the source pads «بنتهاوس » and «أدوار ».
_TYPE_OVERRIDES = {
    # Arabic plurals the shared TYPE_MAP_AR does not carry (souq24, alkhaas).
    "فلل": "Villa",
    "ادوار": "Floor",
    "أدوار": "Floor",
    # Fleet-settled folds.
    "بنتهاوس": "Apartment",     # a penthouse is sold as an apartment (dwelleo, rakez, dealapp, …)
    "تاون هاوس": "Villa",        # TYPE_MAP_EN already folds "townhouse" → Villa
    # The English slugs this source mixes in. apartment/villa/duplex/townhouse already resolve via
    # the shared TYPE_MAP_EN; "penthouse" is in neither shared map, so it is folded like its twin.
    "penthouse": "Apartment",
}

# additional_features[].ar_title → the column the source's own word states. Positive-only: a feature
# the source names is True, one it omits is UNKNOWN (never False). Keyed on the stripped title —
# the source pads every one of them («موقف خاص »). Names with no fleet column («حديقة», «حوش خاص»,
# «دخول ذكي», «منزل ذكي», «جلسات خارجية») are deliberately absent and kept as raw words instead.
_FEATURE_COLS = {
    "موقف خاص": "parking",
    "غرفة خادمة": "maid_room",
    "غرفة سائق": "driver_room",
    "مدخل خاص": "private_entrance",
    "تكيف مخفي": "air_conditioner",
    "التكيف راكب": "air_conditioner",
    "بلكونة": "balcony_terrace",
    "مصعد": "elevator",
}

# The fleet's ordinal-floor vocabulary (identical to aqaralriyadh's _FLOOR). «الملحق» is the roof
# annex and has no number, so it is absent — an unnumberable floor stays NULL.
_FLOOR_WORDS = {"الأرضي": 0, "الارضي": 0, "الأول": 1, "الاول": 1, "الثاني": 2, "الثاني ": 2,
                "الثالث": 3, "الرابع": 4, "الخامس": 5, "السادس": 6}

# THE SOURCE'S OWN KEYS HAVE A TRAILING SPACE. Named constants so the space cannot be "tidied away"
# by a later edit — `rec.get("street_width")` is None on all 597 rows (trap 6).
_K_STREET_WIDTH = "street_width "
_K_DEED_LOCATION = "deed_location_description "

# Keys copied into additional_info / source_capture. An ALLOWLIST, so a PII key added upstream
# tomorrow cannot arrive by default (PDPL, trap 9). responsible_employee_name/-_phone,
# sales_phone_number and the developer's phone are absent BY CONSTRUCTION, not by filtering.
_CAPTURE_KEYS = (
    "id", "slug", "title", "unit_number", "building_number", "unit_type", "sale_type", "case",
    "status", "floor", "total_area", "internal_area", "external_area", "total_rooms", "bedrooms",
    "living_rooms", "bathrooms", "kitchens", "unit_price", "property_tax", "total_amount",
    "payment_amount", "enables_payment_plan", "proposed_payment_plan", "AdLicense",
    "license_end_date", "license_url", "plan_number", "land_number", "property_age",
    "property_facade", "property_usage", "obligations_on_the_property", "project_id",
    "project_name", "project_ownership", "address", "description", _K_STREET_WIDTH,
    _K_DEED_LOCATION, "additional_features", "after_sales_services", "created_at", "updated_at",
)
# Of those, the keys that carry PROSE — where an advertiser's own phone or WhatsApp link would hide.
_CAPTURE_FREE_TEXT = frozenset({"title", "description", _K_DEED_LOCATION,
                                "obligations_on_the_property"})


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def session() -> cc.Session:
    """impersonate OWNS the User-Agent — never set one here.

    `firefox`, not `chrome`: sukna.app answers every chrome/edge fingerprint with an identical
    6,192-byte 403 and answers firefox/safari with the real page (measured, same IP — see docstring).
    Accept-Language: ar is load-bearing, not politeness: it is what makes the API return Arabic
    city/district names, without which every row would skip as city_not_in_catalog.
    """
    s = cc.Session(impersonate="firefox")
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar"})
    return s


def _clean(v) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


def _pos(v) -> Optional[int]:
    """A positive measure, or None. This source writes 0 for "not set" in these fields — measured:
    `street_width ` is "0" on 311 of 597 rows, and no unit sits on a 0-metre street."""
    n = normalize.to_int_numeric(v)
    return n if n and n > 0 else None


def _num(v) -> Optional[int]:
    """A source-published count, 0 INCLUDED — `living_rooms` is genuinely 0 on units with no hall
    and the site renders «الصالات 0», so 0 is the source's answer rather than an unset field."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    n = normalize.to_int_numeric(v)
    return n if n is not None else (0 if str(v).strip() in ("0", "0.0", "0.00") else None)


def _case(rec: dict[str, Any]) -> Optional[int]:
    """The source's `case` (0 available / 1 reserved / 2 sold), or None when it is not readable.

    A dedicated reader because `to_int_numeric` maps 0 and "0" to None — the fleet convention that
    0 means "not set" — and here 0 is the source's most common ANSWER («متاحة للبيع», 333 rows). An
    ABSENT or unreadable `case`, by contrast, must stay None: defaulting it to 0 would silently
    publish a unit whose status the source never stated, and would let the liveness signal read
    "available" out of a payload that said nothing.
    """
    if "case" not in rec:
        return None
    raw = rec.get("case")
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    n = normalize.to_int_numeric(raw)
    return n if n is not None else (0 if str(raw).strip() in ("0", "0.0") else None)


def _floor_number(raw) -> Optional[int]:
    """The single floor this unit is on, or None.

    A value naming TWO floors («الأول - الملحق », «الأرضي  - الأول ») is not one floor and must not
    be collapsed to either of them, so it returns None and the raw string is archived instead. The
    unnumberable «الملحق » (roof annex) likewise. Arabic-Indic digits are handled by to_int().
    """
    s = _clean(raw)
    if not s:
        return None
    s = re.sub(r"\s+", " ", s)
    words = [w for w in _FLOOR_WORDS if w in s]
    if words:
        # Two different ordinals named, or an ordinal plus something else joined by a separator →
        # this row spans floors. One floor, named once, is the only case that yields a number.
        if len({_FLOOR_WORDS[w] for w in words}) > 1 or re.search(r"[-–,/]", s):
            return None
        return _FLOOR_WORDS[words[0]]
    if re.search(r"[-–,/]", s):
        return None                       # "1 - 2" style range: no single floor
    return normalize.to_int(s) if re.search(r"[\d٠-٩]", s) else None


def _features(rec: dict[str, Any]) -> tuple[dict[str, bool], list[str]]:
    """The structured `additional_features` list → real columns, plus the raw words for the archive.

    Positive-only and read from the STRUCTURED name, never from prose: a feature the source names is
    True, one it omits stays NULL. The source publishes no negations here, so nothing is ever False.
    """
    words: list[str] = []
    for f in rec.get("additional_features") or []:
        w = _clean((f or {}).get("ar_title") if isinstance(f, dict) else f)
        if w:
            words.append(w)
    return {_FEATURE_COLS[w]: True for w in words if w in _FEATURE_COLS}, words


def map_listing(rec: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) for ONE unit record. row is None exactly when a reason is set."""
    pid = _clean(rec.get("id"))
    if not pid:
        return None, "residential", "no_id"

    title_raw = _clean(rec.get("title")) or _clean(rec.get("unit_number"))
    project = _clean(rec.get("project_name"))
    if "مزاد" in f"{title_raw or ''} {_clean(rec.get('description')) or ''}":
        return None, "residential", "auction"

    # OFF-PLAN, in the source's own words: enables_payment_plan is the very field its bundle turns
    # into «بيع على الخارطة» (trap 3). Checked before the type/city work so a skipped row costs
    # nothing, and counted so the number is never silently zero.
    if normalize.to_int_numeric(rec.get("enables_payment_plan")):
        return None, "residential", "off_plan"

    case = _case(rec)
    if case is None:
        # The source states a status on 597/597 rows. One that does not is a shape we have not
        # measured, so it is skipped and counted rather than assumed available.
        return None, "residential", "case_unreadable"
    if case in _SKIP_CASES:
        return None, "residential", f"sold_case_{case}"

    # The source mixes ARABIC and ENGLISH type words in the same field (trap 7), so both shared
    # exact-match entry points are consulted — the Arabic one first, then the English one. Both take
    # the same per-platform overrides dict, matched exactly, never substring-expanded.
    type_raw = _clean(rec.get("unit_type"))
    property_type = (normalize.map_type_exact(type_raw, _TYPE_OVERRIDES)
                     or normalize.map_type_en(type_raw, _TYPE_OVERRIDES))
    if not property_type:
        return None, "residential", f"type_unmapped_{type_raw or 'blank'}"
    category = normalize.category_for_type(property_type).lower()

    addr = rec.get("address") if isinstance(rec.get("address"), dict) else {}
    city_ar = _clean(addr.get("city"))
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"
    state_raw = _clean(addr.get("state"))
    district_ar = (find_district_in_text(state_raw, city_id)
                   or find_district_in_text(_clean(addr.get("street")), city_id))

    desc = redact_pii(_clean(rec.get("description")))
    feat_cols, feat_words = _features(rec)

    images = [i for i in (rec.get("images") or []) if isinstance(i, dict) and i.get("image_path")]
    # The source's OWN split: `type == "floor_plan"` is the engineering drawing («المخطط الهندسي»),
    # not a photograph of the property, so it is archived rather than shown as a listing photo.
    photos = [i["image_path"] for i in images if _clean(i.get("type")) != "floor_plan"] or None
    plans = [i["image_path"] for i in images if _clean(i.get("type")) == "floor_plan"] or None

    # ── PRICE. `unit_price` verbatim, and nothing else is a price (trap 1). ──────────────────────
    # NOT total_amount: stale (≠ unit_price + property_tax on 149 of the 496 rows publishing all
    # three, and LOWER than unit_price alone on 17). NOT unit_price + property_tax either: that is
    # arithmetic on source data, which is banned. The source's own JSON-LD offer price IS unit_price.
    price_raw = rec.get("unit_price")
    price_total = normalize.to_int_numeric(price_raw)

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": f"{SITE}/unit-details?id={pid}",
        "source": SOURCE,
        "active": True,
        # The source's own title is the bare unit number ("201"); joining its own project_name is
        # the unit-grain composition azure/rightcompound use. Every character is source text.
        "title": " – ".join(x for x in (project, title_raw) if x) or None,
        "description": desc,
        **normalize.amenities_from_text(f"{'، '.join(feat_words)}\n{desc or ''}"),
        **feat_cols,
        "property_type": property_type,
        # Sale-only source: `purpose` is "sale" on all 31 projects and `sale_type` is "direct" on
        # all 597 units. There is no rent field and no period token anywhere, so rent_period and
        # price_annual are never set — not here, not below, not from the monthly instalment.
        "transaction_type": "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": state_raw,
        "project_name": project,
        "area_m2": _pos(rec.get("total_area")),
        "interior_space_m2": _pos(rec.get("internal_area")),
        "outdoor_area_m2": _pos(rec.get("external_area")),
        "bedrooms": _num(rec.get("bedrooms")),
        "bathrooms": _num(rec.get("bathrooms")),
        "halls": _num(rec.get("living_rooms")),      # the column is `halls`, NOT `living_rooms`
        "floor_number": _floor_number(rec.get("floor")),
        "building_number": _clean(rec.get("building_number")),
        "property_age": normalize.parse_property_age(rec.get("property_age")),
        "street_width_m": _pos(rec.get(_K_STREET_WIDTH)),      # the key's trailing space is real
        "direction": normalize.one_direction(rec.get("property_facade"), diagonal=True),
        "plan_parcel": _clean(rec.get("land_number")),
        "license_number": _clean(rec.get("AdLicense")),
        "license_expiry": _clean(rec.get("license_end_date")),
        "date_added": _clean(rec.get("created_at")),
        "price_total": price_total,
        "photo_urls": photos,
    }
    if _num(rec.get("kitchens")):
        row["kitchen"] = True
    row["price_evidence"] = normalize.price_evidence(
        field="unit_price", raw=price_raw, stored=price_total, kind="total", unit="total",
        origin="api", authoritative_absent=False)
    row["images_evidence"] = {"observed": True, "container_present": "images" in rec,
                              "key_present": bool(rec.get("images")),
                              "count": len(photos or [])}

    info = {
        "source_id": pid,
        "unit_number": _clean(rec.get("unit_number")),
        "unit_type_raw": type_raw,
        "source_case": case,
        "source_case_status": _CASE_STATUS.get(case),      # the site's own word for this `case`
        "source_status": normalize.to_int_numeric(rec.get("status")),   # meaning UNKNOWN — see docs
        "sale_type": _clean(rec.get("sale_type")),
        "floor_raw": _clean(rec.get("floor")),             # may name TWO floors; see _floor_number
        "total_rooms": _num(rec.get("total_rooms")),        # «عدد الغرف», not bedrooms
        "source_total_area_raw": _clean(rec.get("total_area")),   # exact m², pre INTEGER round
        "source_internal_area_raw": _clean(rec.get("internal_area")),
        "source_external_area_raw": _clean(rec.get("external_area")),
        # The other two money figures the source publishes, kept verbatim and computed from never.
        "source_unit_price_raw": price_raw,
        "source_property_tax_raw": rec.get("property_tax"),
        "source_total_amount_raw": rec.get("total_amount"),   # «الإجمالي شاملًا الضريبة» — stale
        # PURCHASE-plan figures. «القسط الشهري» is an instalment, never a rent (trap 2).
        "monthly_instalment_raw": rec.get("payment_amount"),
        "proposed_payment_plan": rec.get("proposed_payment_plan") or None,
        "feature_words": feat_words or None,
        "floor_plan_images": plans,
        "license_url": _clean(rec.get("license_url")),      # the REGA ad-licence page
        "plan_number": _clean(rec.get("plan_number")),
        "deed_location": redact_pii(_clean(rec.get(_K_DEED_LOCATION))),
        "obligations": _clean(rec.get("obligations_on_the_property")),
        "project_id": normalize.to_int_numeric(rec.get("project_id")),
        "address_street_ar": _clean(addr.get("street")),
        # A post-sale service the DEVELOPER offers («تأجير الوحدة»), not a rent listing.
        "after_sales_services": [_clean((s or {}).get("ar_title")) for s in
                                 (rec.get("after_sales_services") or [])
                                 if isinstance(s, dict) and _clean(s.get("ar_title"))] or None,
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v is not None})
    # The capture is PRIVATE, but "private" is not "may accumulate contact details". Redact the
    # free-text keys HERE rather than leaning on db.redact_capture(): a barrier after the row has
    # left the mapper is not this mapper's guarantee. Licences, deeds, plans and ids are untouched.
    row["source_capture"] = strip_pii_fields(
        {"schema": "sukna.api.v1.units.detail.v1",
         **{k: (redact_pii(rec[k]) if k in _CAPTURE_FREE_TEXT else rec[k])
            for k in _CAPTURE_KEYS if k in rec}})
    # DIRECT evidence: this row was built from a fetch of THIS unit's own record, whose own
    # `data.id` was checked against the id requested (see fetch_units). Costs zero requests.
    db.mark_direct_alive(row, oracle="sukna.api.v1.units.detail.unit_payload")
    return row, category, ""


# ── FETCH ────────────────────────────────────────────────────────────────────────────────────────
def _get_json(s: cc.Session, url: str, *, tries: int = 3) -> tuple[Optional[int], Any]:
    r = None
    for _ in range(tries):
        try:
            r = s.get(url, timeout=45)
        except Exception:                 # noqa: BLE001 — a transport error is not an answer
            r = None
            continue
        if r.status_code not in TRANSIENT_STATUSES:
            break
    if r is None:
        return None, None
    if r.status_code != 200:
        return r.status_code, None
    try:
        return 200, r.json()
    except ValueError:
        return 200, None


def fetch_units(s: cc.Session, limit: int = 0) -> tuple[list[dict], bool]:
    """Every unit's OWN detail record, plus whether the catalogue was served COMPLETE.

    The list endpoint declares `units_count`; complete means it equals the number of distinct ids
    held AND every one of them yielded a detail record. Only then may anything be pruned — a
    half-fetched catalogue must never look like a shrunken one.
    """
    status, body = _get_json(s, f"{LIST_API}?per_page={PAGE_SIZE}")
    if status != 200 or not isinstance(body, dict):
        raise RuntimeError(f"{LIST_API} returned {status} / {type(body).__name__}, not the list object")
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    declared = normalize.to_int_numeric(data.get("units_count"))
    ids: list[str] = []
    for u in data.get("units") or []:
        key = _clean((u or {}).get("id")) if isinstance(u, dict) else None
        if key and key not in ids:
            ids.append(key)
    if not ids:
        raise RuntimeError(f"{LIST_API} served no units")
    wanted = ids[:limit] if limit else ids

    recs: list[dict] = []
    missing = 0
    for pid in wanted:
        st, b = _get_json(s, f"{LIST_API}/{pid}")
        rec = (b or {}).get("data") if isinstance(b, dict) else None
        # CONFIRM IDENTITY before trusting the payload — this is what licenses mark_direct_alive.
        if not isinstance(rec, dict) or _clean(rec.get("id")) != pid:
            missing += 1
            print(f"  ⚠ unit {pid}: detail fetch returned {st} / no matching record", flush=True)
            continue
        recs.append(rec)
    complete = bool(declared) and len(ids) == declared and missing == 0 and not limit
    print(f"{SOURCE}: {len(recs)} unit record(s) of {len(ids)} listed; units_count={declared} "
          f"missing={missing} complete={complete}", flush=True)
    return recs, complete


# ── LIVENESS (measured 2026-09-25 — the RENDERED page is a soft-404; see the docstring) ──────────
def _signal_for(pid: str):
    """'live' | 'gone' | None from THIS unit's own API record. The law does the rest.

    404 is the API's own «resource not found». A 200 is read only through `case`, the field whose
    value 2 the source itself calls «مباعة» and whose ids are exactly the ones missing from its own
    sitemap. A 500 (measured on id 1) yields nothing: the shared law refuses to kill on 5xx, and a
    broken Laravel response is the source being broken, not this unit being gone.
    """
    def signal(status, body, _moved) -> Optional[str]:
        if status == 404:
            return "gone"
        if status != 200 or not body:
            return None
        try:
            import json as _json
            rec = (_json.loads(body) or {}).get("data")
        except Exception:                 # noqa: BLE001 — unparseable is no opinion, never a kill
            return None
        if not isinstance(rec, dict) or _clean(rec.get("id")) != pid:
            return None                   # someone else's record proves nothing about this one
        case = _case(rec)
        if case is None:
            return None                   # 200 but no readable `case` — no opinion
        return "gone" if case in _SKIP_CASES else "live"
    return signal


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None):
        pid = ad_number[len(PREFIX):] if ad_number.startswith(PREFIX) else ""
        if not pid:
            return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
        return LivenessProbe(platform=SLUG, signal=_signal_for(pid), session=session,
                             url_for=lambda _ad: f"{LIST_API}/{pid}",
                             canary=canary).verify_gone(ad_number)

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
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    # begin_run BEFORE the fetch: a source that goes dark must still leave a scrape_runs row.
    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        items, complete = fetch_units(s, limit=args.limit)
        if not items:
            raise RuntimeError(f"{LIST_API} yielded no unit records")
        for rec in items:
            row, cat, why = map_listing(rec)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        notes = _tally(skipped)
        if skipped:
            print("  skipped (not guessed): " + notes)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:20]:
                print(f"   {r0['ad_number']:>8} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):10} {str(r0['city_ar']):8} "
                      f"d={str(r0['district_ar'])[:11]:11} a={str(r0['area_m2']):>6} "
                      f"bd={str(r0.get('bedrooms')):>3} pt={r0.get('price_total')} "
                      f"pa={r0.get('price_annual')} rp={r0.get('rent_period')} "
                      f"fl={r0.get('floor_number')} sw={r0.get('street_width_m')} "
                      f"ag={r0.get('property_age')} ph={len(r0.get('photo_urls') or [])}")
            return 0
        # The public upsert_sukna_*_batch wrappers are added centrally at onboarding; same funnel.
        db._wasalt_batch("sukna_residential_listings", res)
        db._wasalt_batch("sukna_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="sukna_residential_listings", com_table="sukna_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in (("sukna_residential_listings", res),
                              ("sukna_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        elif args.type == "all":
            print("  prune skipped: the catalogue was not served complete")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(items),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} complete={complete} {notes}"[:300],
                             check_tables=["sukna_residential_listings",
                                           "sukna_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=(f"{e}"[:250] + " | skips: " + (_tally(skipped) or "none"))[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
