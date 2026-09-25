"""إيجو عقار (Ego Aqar) — ego-aqar.com. 33 live listings, onboarding 2026-09-24.

THE HEADLINE CORRECTION. The onboarding brief said «~5,415 ads». IT IS 33. Measured three
independent ways on 2026-09-24, all agreeing:
  · the unfiltered cursor walk of GET /units runs to exhaustion in 4 pages → 33 distinct ids;
  · walking adType=sell and adType=rent separately gives 23 + 10 = 33, the SAME 33 ids, so no ad is
    reachable only through a filter;
  · 9 city filters × 2 adTypes and 15 type filters × 2 adTypes (54 walks) surfaced ZERO id outside
    those 33 — the filters partition the same 33, they do not reveal a hidden tail.
The id space really does reach ~2451, but every id outside the 33 answers the detail endpoint with
HTTP 409 «This unit is inactive» (40/40 sampled) — so 2,400+ EXPIRED ads exist and none is published.
5,415 is plausibly a lifetime ad count; it is not live inventory. A scraper built for 5,415 would
have reported a 99% loss.

SOURCE SHAPE (measured live 2026-09-24; every number below was captured, not assumed)
-------------------------------------------------------------------------------------
A Quasar/Vue SPA whose backend is a plain public JSON API — no auth, no cookie, no proxy, plain
`impersonate="chrome"`. The base and the two endpoints come from the app's OWN bundle
(`index-BpMnrUG8.js`: `apiBaseUrl:"https://egoagar-backend.com/api/v0"`; `unit-CHu4brjb.js`:
`a.get("/units",{params:t})` and `a.get(`/units/${t}`)`):

    GET /units[?adType=sell|rent][&pageToken=<id>]  → {"code":200,"data":[…10…],
                                                       "pagination":{"nextPageToken":"2416"}}
    GET /units/<id>                                 → {"code":200,"data":{…35 keys…}}

  PAGINATION IS A CURSOR, 10 ROWS, AND THERE IS NO `limit`. `limit=2` returned the same 10 rows
  byte-for-byte, so page size cannot be raised; `nextPageToken` is the last id of the page and its
  absence is the platform's own end-of-list statement. There is NO total count anywhere, which is
  why COMPLETENESS is established by the two-enumeration agreement above and nothing prunes unless
  it holds (`fetch_catalogue` performs exactly that cross-check on every run).

  THE LIST IS A SUMMARY. It carries 29 keys; the detail carries those plus `governmentData`,
  `deedNumber`, `licenseNumber`, `licenseStartDate`, `licenseExpiryDate` and `photo0..2Url`. Rows
  are therefore built from the DETAIL record (33 extra requests), because `governmentData` is where
  the Arabic city/district/region, the Arabic property type, the property age, the utilities and the
  street width live. Mapping from the summary alone would have thrown all of that away and forced
  the romanized slugs («aldammam», «al-aqrabyah») through a transliteration table we would have had
  to invent.

  DETAIL URL — VERIFIED IN A REAL BROWSER, BECAUSE curl CANNOT VERIFY IT. The app's own route table
  contains `"/unit-details/:id"`, so listing_url is {BASE}/unit-details/<id>. There is no SSR: that
  path returns the SAME 1,892-byte shell for id 2451, id 1 and id 999999 (and to Googlebot), so an
  HTTP 200 on it proves nothing at all. Rendered in headless Chromium, 4 ids each showed THAT
  listing's own content and its own <title>:
      2451 «إيجو عقار - شقة للبيع … الدمام حي بدر»   750,000.00 ر.س   licence 7100320423
      2377 «إيجو عقار - فيلا للايجار … الرياض الرمال» 950,000.00 ر.س   licence 7201029513
      2415 «إيجو عقار - ارض للبيع … جدة حي الياقوت»  42,949,672.95 ر.س licence 7100308894
      2409 «إيجو عقار - ارض للبيع … تبوك حي النظيم»  560,000.00 ر.س    licence 7201068567

  PHOTOS ARE PRESIGNED AND THE PRESIGNATURE MUST NOT BE STORED. `mainPhotoUrl` / `photo0..2Url` are
  S3 GetObject URLs carrying `X-Amz-Signature`, `X-Amz-Date`, an `X-Amz-Credential` that embeds the
  account's AWS access-key id, and `X-Amz-Expires=43200` — TWELVE HOURS. Stored verbatim they would
  be dead links by the next morning and would park an AWS key id in our database. The bucket objects
  are PUBLIC: the same URL with the whole query string removed returns HTTP 200 Content-Type
  image/jpeg (18 fetches across 5 listings, every one 200 image/jpeg, no Cross-Origin-Resource-Policy
  header, so embedding is not blocked). So the query string is stripped and only the bare object URL
  is stored. At most four photos exist per listing and that is the platform's own ceiling, not an
  observation: its i18n block is `photos:{main,photo0,photo1,photo2}`. Coverage 31/33 main
  (ids 2409 and 2417 publish none), 30 photo-0, 25 photo-1, 23 photo-2.

THE TRAPS, ALL MEASURED
-----------------------
1. THE PRICE FIELD CAN SATURATE A 32-BIT INTEGER, AND WE STILL STORE WHAT THE SOURCE SHOWS.
   Id 2415 publishes `price` "42949672.95" and, in the SAME record's government block,
   `propertyPrice` 656250000. 42,949,672.95 is not a coincidence: it is exactly 4,294,967,295 / 100,
   i.e. the unsigned-32-bit ceiling in halalas. On the other 32 listings the two figures are
   IDENTICAL to the riyal (checked all 33), so this one row is the platform's own storage overflow.

   IT IS STILL STORED VERBATIM, because the rendered page ITSELF shows «42,949,672.95 ر.س» as the
   headline price (browser-verified above). A real user on ego-aqar.com sees that number, so our
   card showing the same number is parity with the source, not our error — «we are plumbers». Three
   things this deliberately refuses to do:
     · substitute `propertyPrice` — swapping to a DIFFERENT field on the one row whose value looks
       wrong is a plausibility gate wearing a fidelity costume, and picking fields per-row is how a
       scraper starts choosing prices;
     · null it — hiding a source-published price is the regression the standing rule names;
     · repair it (×100, ÷100, 2**32 arithmetic) — that is calculation, which is banned outright.
   The REGA figure is kept in additional_info as `rega_unit_price`, and `price_disagrees_with_rega`
   is set on exactly the rows where the two published numbers differ (1 of 33) so monitoring can see
   OUR claim beside the source's other number without a re-fetch. Raised as an open question.

2. NOTHING IS PER SQUARE METRE HERE, AND NOTHING MAY BE DIVIDED. ego publishes ONE price per ad —
   no per-metre field exists in the 35 detail keys or the 27 government keys, and the page prints a
   single «سعر الوحدة». Two land rents look like a rate because price/area comes out at exactly
   200.0 (ids 2357 and 2380), which is precisely the coincidence that would tempt a `price_per_meter`
   division. `price_per_meter` is therefore NEVER written by this scraper — for ANY type, land
   included. The 4 land sales price plausibly as totals (896, 660, 81,809 and 1,250,000 per m²) and
   all four agree with the REGA `propertyPrice` figure, which the page labels «سعر الوحدة» — a UNIT
   price, i.e. the whole ad's price.

3. RENT PERIOD: THE PROSE'S PERIOD USUALLY DESCRIBES A DIFFERENT NUMBER. There is no period field
   anywhere (all 35 detail keys and all 27 government keys checked; `priceDisplay` is a bare
   "42,000.00 SAR"). Of the 10 rents, 4 carry a period word — and on THREE of those four the figure
   the prose itself prints is NOT the figure the price field holds:
        2357  price 51,150   prose «قيمة الإيجار السنوي: 70،635ريال»
        2377  price 950,000  prose «للايجار السنوي … الايجار 100 الف بالسنه»
        2392  price 18,000   prose «الإيجار: سنوي [19000]»
   So on this platform a period word is 3-for-4 evidence about some OTHER number. A period whose
   storage conversion would MULTIPLY the stored figure is therefore refused unless the prose prints
   that very figure beside the period word (see `_rent_fields`). 'annual' converts nothing, so it is
   honoured and the price is stored exactly as published.

   AND «سنوى» IS SPELLED WITH ALEF MAQSURA. Id 2420 says «شقق مجهزة للايجار شهري وسنوى» — two
   periods in one breath, which is no statement about one price. The shared
   `_RENT_PERIOD_TOKEN_RE` cannot see «سنوى» (it matches «سنوي», final yeh), so the shared parser
   sees only «شهري» and returns monthly ×12: **504,000 stored for a 42,000 listing**. Measured, not
   hypothetical — that is the exact output of normalize.rent_period_and_annual() on the live record.
   `_rent_fields` normalises ى→ي BEFORE counting period tokens, sees two distinct periods, and keeps
   rent_period NULL with the price unconverted. The shared regex is left alone (it is not this
   platform's file to change); the normalisation is local and the defect is now a test.

   «يومي»/«أسبوعي»/«نصف سنوي»/«ربع سنوي» deliberately do NOT adopt the shared parser's (None, None):
   that contract is for platforms whose price field IS labelled with that period, and here it is
   not, so discarding the figure would hide a source-published price on the strength of a word that
   may describe another number. rent_period NULL already keeps the row out of period-scoped search.

4. PDPL: THE CONTACT DETAILS HIDE INSIDE A LABEL/VALUE LIST, WHERE THE SHARED KEY FILTER CANNOT SEE
   THEM. `governmentData` is a list of sections of `{"key","label","value"}` triples, and two of
   those triples are `{"key":"advertiserName","value":"عبير عبدالله صالح العطاوي"}` and
   `{"key":"phoneNumber","value":"0557731494"}` — present on ALL 33. `strip_pii_fields()` matches
   dict KEY NAMES, and the dict keys here are literally "key"/"label"/"value", so it would pass the
   whole broker record through untouched. The government block is therefore flattened through an
   explicit ALLOWLIST of `key` values (`_GOV_KEEP`) and nothing else is ever read from it. `userId`
   (the advertiser's account id) is not stored either, and neither is the presigned photo query
   string. `/units/<id>/owner-info` exists in the bundle and is never called.
   Two of the 33 descriptions contain the advertiser's own name VERBATIM (ids 2439 and 2445,
   «مؤسسة عبدالعزيز احمد حسن المالكي للتطوير العقاري») — the source hands us that exact string in
   `advertiserName`, so it is removed from the free text as a literal before redact_pii() runs.
   Only the full literal is removed: id 2416 shares one token («العقارية») with its advertiser name
   and partial-token matching would mangle prose.

5. THE BACKEND SERIALISES `None` INTO THE FOUR-CHARACTER STRING "None". `propertyUsages` is the
   string "None" on all 33, `rerConstraints` on all 33, `propertyAge` on 4. Stored verbatim that
   becomes the literal text "None" in a column and a property aged "None". `_clean()` maps it to
   None, and the rendered page agrees: it prints those rows blank.

6. `numberOfRooms` IS TOTAL ROOMS, NOT BEDROOMS. The page labels it «عدد الغرف» and the government
   block repeats it under the same label; 2349 (a 1,600 m² building) says 32 and 2420 (an apartment)
   says 18. ego publishes NO bedroom, bathroom or hall count, so those columns stay NULL and
   `numberOfRooms` goes to additional_info as `total_rooms`. It is never guessed from the prose.

REMOVAL ORACLE (measured 2026-09-24 — and it is the API, NOT the web page)
-------------------------------------------------------------------------
The web URL cannot be the oracle: `/unit-details/<anything>` serves the same shell with HTTP 200,
so a 200 there is worth nothing (verified on a fabricated id 999999). The API detail endpoint gives a
clean three-way answer, and it was validated on 73 ids with zero counter-examples:

    200 + `data.id` == this id          → live   (33/33 of the catalogue)
    409 + «This unit is inactive»       → gone   (40/40 sampled ids absent from the catalogue:
                                                  25 interleaved among the live block 2340-2460,
                                                  15 random from 1-2339)
    404                                 → gone   (ids past the id space: 2500, 9999)
    anything else / unreadable          → UNKNOWN (the shared law in http_liveness decides; 401/403/
                                                  408/429/5xx/no-answer can never carry a death)

409 is a believable read under the law (it is not in BLOCKED_OR_THROTTLED and the body is non-empty),
and it is a statement about the UNIT — the body says so in words — which is why the signal requires
that wording and not merely the status code. Removals are additionally gated by an in-run positive
control that fails CLOSED. Rows are built from a LIST+DETAIL walk, so `mark_direct_alive()` is
deliberately NOT called: that stamp is for a fetch of the listing's own record inside the crawl.

COVERAGE (full live walk, 2026-09-24 — every listing, not a sample)
------------------------------------------------------------------
33 listings over 4 pages (sell 23 + rent 10 = the same 33, complete=True) → 33 mapped, 0 SKIPPED.
Every type ego currently publishes is a residential one, so the split is 33 residential + 0
commercial and the commercial table is created empty.
  Deal split 23 Buy / 10 Rent.  Types: Apartment 12, Villa 10, Residential Land 4, Building 4,
  Floor 2, Rest House 1.
  Cities: الرياض 11, جدة 5, الطائف 5, أبها 4, الدمام 2, مكة المكرمة 2, تبوك 1, الخبر 1, البصر 1,
  رياض الخبراء 1 — 33/33 resolve through to_catalog.
  price_total 23 · price_annual 10 · price_per_meter 0 (never derived — trap 2)
  rent_period 3 of 10 rents (all 'annual'; 7 UNKNOWN, including the 42,000 that a ×12 would have
  inflated to 504,000) · area_m2 33 · property_age 29 · street_width_m 19 (14 published 0)
  direction 16 (7 publish a MULTI-facing string → no single direction; 10 publish '')
  photos 31 (2409, 2417 publish none) · license_number 33 · license_expiry 33 · date_added 33
  description 32 (2415 has none) · plan_parcel 31 · street_name 32 · zip_code 33
  building_number 33 · additional_number 33
  electricity 32 · water_supply 27 · sanitation 26 · optical_fibers 16
  kitchen 23 · parking 11 · air_conditioner 11 · laundry_room 8 · maid_room 7 · elevator 5
  furnished 3 · private_entrance 3 · car_entrance 1
  0 auctions, 0 reserved rows, 0 non-active rows, 0 unmapped types, 0 unmapped cities.

  district_ar 26/33, and the 7 misses are CATALOG GAPS, not parse failures — the raw Arabic district
  is always kept in `neighborhood`:
    الطائف (4): السر, بدر, القهيب, القدس — none of الطائف's 76 catalog districts;
    أبها: الغدير (63 catalog districts, not among them);  رياض الخبراء: الجزيرة (10, has «حي القدس»);
    البصر: 34ج — loc_catalog_district holds ZERO districts for البصر (city_id 939).
  `city` (the English canonical label) is NULL on 1 row: `normalize.map_city` has no entry for
  البصر. city_id/region_id/city_ar are correct on all 33, so search is unaffected; the English label
  is a CITY_MAP gap worth filling.

OPEN QUESTIONS FOR ONBOARDING (none of these is guessed in code)
----------------------------------------------------------------
  · Id 2415's price. We store the platform's own displayed 42,949,672.95 and record its REGA
    656,250,000 beside it. Does the owner want the 1-row disagreement surfaced as an alarm (it is
    flagged in additional_info today), and does ego want telling that its price column overflows?
  · `title` is generic ENGLISH on every ad — "Apartment for sale", "Villa for rent". The Arabic
    heading a user sees («شقة للبيع الدمام - بدر») is composed CLIENT-SIDE by the SPA from
    type+adType+city+district; there is no Arabic title in the data. We store the English literal
    rather than compose one. Whether our card should compose the same way is a UX decision.
  · `streetWidth` is 0 on 14 of 33 and the page PRINTS «عرض الشارع 0». A 0-metre street is not a
    width, so street_width_m stays NULL and the raw 0 is kept in the capture — but if the owner
    reads a printed 0 as the source's published answer, `_pos` becomes `_num` for this one field.
  · 12 of the platform's own 28 types have no fleet mapping. Six are given the mapping the fleet
    ALREADY made for the same word elsewhere (see `_TYPE_OVERRIDES`); the other six —
    «محطة» (bare station: fuel? ego lists «محطة كهرباء» separately), «سينما», «صراف», «مدرسة»,
    «مستشفى / مركز صحي», «برج اتصالات» — would skip with a counted reason. 0 live rows today.
  · SOURCE is «إيجو عقار» — the platform's own name for itself, from its i18n
    (`seo.titlePrefix:"إيجو عقار - "`, «منصة إيجو عقار»). The onboarding roster said "Ego Real
    Estate إيجو"; the registry entry should use the platform's own words, confirm before onboarding.
  · `isReserved` and `status` are False/"active" on all 33, so their other values were never
    observed. Both are skipped-with-a-reason if they ever change, which is the fail-closed reading,
    but the meaning of a reserved-but-published ad is unverified.
  · ego publishes no off-plan signal of any kind: no field in the 35 detail or 27 government keys,
    no off-plan type among its 28, no price RANGE (price is one scalar), no %-sold bar, and zero
    occurrences of «على الخارطة» / «تحت الإنشاء» / «قيد الإنشاء» in the 33 descriptions. So NO
    off-plan skip exists here and none is invented from prose. If ego later adds one, it is a field
    to read, not a phrase to guess.

DETAIL, MEASURED
----------------
  · Type comes from the `type` SLUG (a closed 28-value vocabulary) translated through the
    PLATFORM'S OWN Arabic table, lifted verbatim from its i18n bundle, and then through the shared
    audited TYPE_MAP_AR — so ego's words are judged by the fleet's taxonomy rather than by a
    slug table this file invented. The government block's `propertyType` is the same Arabic word on
    all 33 (شقة/ارض/فيلا/دور/عمارة/إستراحة) and is kept in additional_info as a cross-check.
  · TASHKEEL: ego's studio type is «شقَّة صغيرة (استوديو)» with shadda BEFORE fatha — the identical
    byte-order trap abaad documented. Marks are stripped before the lookup, so a hand-typed copy of
    the literal cannot silently miss.
  · `propertyUtilities` is a comma-joined structured list, positive-only: a named utility is True, an
    absent one stays NULL, never False. Universe across 33: كهرباء 32, مياه 27, صرف صحي 26,
    ألياف ضوئية 16, تصريف الفيضانات 13, هاتف 11. The last two have no column and go to
    additional_info — a telephone LINE is infrastructure, not a contact number.
  · `propertyFace` is often a MULTI-facing string («شرقية - غربية - جنوبية - شمالية», 12 rows).
    `one_direction` returns None for those, which is right: a property facing four ways has no one
    direction. 10 rows publish '' → NULL.
  · Amenities from prose use the shared audited `amenities_from_text` (negation-aware), so «غير
    مفروش» inverts. 3 rows state «مؤثث/مؤثثة» → furnished True; no negated furnishing exists today.
  · `area` is the exact decimal ("344.55"); area_m2 is INTEGER so it rounds, and the exact string is
    preserved in additional_info as `source_area_raw`.
  · `coordinates` are [lat, lng] and real (26.417/50.024 for a Dammam flat, not a Riyadh
    placeholder), but the listing tables carry no coordinate columns, so they live in
    additional_info only.
  · `deedNumber`, `landNumber`, `planNumber`, `licenseNumber` are regulatory identifiers and are
    preserved untouched — redact_pii() is applied to PROSE only, never to these.
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

BASE = "https://ego-aqar.com"
API = "https://egoagar-backend.com/api/v0"      # from the app bundle's own `apiBaseUrl`
SOURCE = "إيجو عقار"                             # the platform's own name for itself (i18n)
PREFIX = "EGO"
SLUG = "ego"

# Tashkeel is invisible and its byte order is not semantic (abaad's lesson, 2026-09-24): ego writes
# its studio type «شقَّة صغيرة (استوديو)» with shadda BEFORE fatha, and a hand-typed copy compares
# UNEQUAL while rendering identically. Marks are stripped before every type lookup.
_MARKS = dict.fromkeys(list(range(0x064B, 0x0653)) + [0x0640, 0x0670])

# The platform's OWN slug → Arabic type table, verbatim from its i18n bundle (`unit.types`). Those
# Arabic words then go through the shared audited TYPE_MAP_AR, so ego is judged by the fleet's
# taxonomy and not by a table this file invented.
_TYPE_AR = {
    "land": "ارض", "apartment": "شقة", "villa": "فيلا", "shop": "محل", "floor": "دور",
    "building": "عمارة", "office": "مكتب", "rest-house": "إستراحة", "chalet": "شالية",
    "warehouses": "مستودع", "studio": "شقَّة صغيرة (استوديو)", "room": "غرفة", "compound": "مجمع",
    "tower": "برج", "exhibition": "معرض", "booth": "كشك", "cinema": "سينما", "hotel": "فندق",
    "car-parking": "موقف سيارات", "repair-shop": "ورشة", "teller": "صراف", "factory": "مصنع",
    "school": "مدرسة", "hospital-or-health-center": "مستشفى / مركز صحي",
    "electricity-station": "محطة كهرباء", "telecom-tower": "برج اتصالات", "station": "محطة",
    "farm": "مزرعة",
}

# Words TYPE_MAP_AR does not carry but the fleet has ALREADY decided elsewhere, quoted rather than
# invented. Keyed on the mark-free form. None of the six occurs in a live ego row today.
#   شالية  — TYPE_MAP_AR spells it «شاليه»; same word, ego's spelling.
#   شقة صغيرة (استوديو) — the fold TYPE_MAP_EN applies to wasalt's "Small apartment (studio)".
#   برج / كشك / موقف سيارات / مجمع — TYPE_MAP_EN's 'Tower' / 'Booth' / 'Car parking' / 'compound'.
# «محطة» is deliberately ABSENT: ego lists «محطة كهرباء» separately, so a bare «محطة» is not proven
# to be a fuel station and is not guessed into one (abaad reached the same verdict on the same word).
_TYPE_OVERRIDES = {
    "شالية": "Chalet",
    "شقة صغيرة (استوديو)": "Studio",
    "برج": "Commercial Building",
    "كشك": "Kiosk",
    "موقف سيارات": "Parking",
    "مجمع": "Compound",
}

_DEAL = {"sell": "Buy", "rent": "Rent"}

# `governmentData[].value[].key` → what we may read. AN ALLOWLIST, because the REGA block also
# carries `advertiserName` and `phoneNumber` on every single ad and the shared key-name filter cannot
# see them (they are VALUES of a "key" field, not dict keys). PDPL, trap 4.
_GOV_KEEP = frozenset({
    "advertisementType", "adLicenseNumber", "endDate",
    "propertyType", "propertyFace", "propertyPrice", "numberOfRooms", "propertyArea",
    "propertyAge", "propertyUsages", "propertyUtilities", "streetWidth", "rerConstraints",
    "obligationsOnTheProperty", "guaranteesAndTheirDuration",
    "region", "city", "district", "street", "postalCode", "buildingNumber", "additionalNumber",
    "landNumber", "planNumber", "locationDescriptionOnMOJDeed",
})
# Of those, the ones that carry PROSE a human wrote — where a phone or a WhatsApp link hides.
_GOV_FREE_TEXT = frozenset({"obligationsOnTheProperty", "guaranteesAndTheirDuration",
                            "locationDescriptionOnMOJDeed"})

# Top-level detail keys copied into source_capture. An ALLOWLIST, so a PII key added upstream
# tomorrow cannot arrive by default. `userId` (the advertiser's account) and the presigned photo URLs
# (they embed an AWS access-key id and a 12-hour signature) are deliberately excluded.
_CAPTURE_KEYS = (
    "id", "adType", "adTypeDisplay", "type", "typeDisplay", "area", "areaDisplay",
    "price", "priceDisplay", "region", "regionDisplay", "city", "cityDisplay",
    "district", "districtDisplay", "country", "coordinates", "numberOfRooms",
    "status", "statusDisplay", "statusReason", "isActive", "isReserved",
    "createdAt", "licenseNumber", "licenseStartDate", "licenseExpiryDate", "deedNumber",
    "adTitle", "adDescription",
)
_CAPTURE_FREE_TEXT = frozenset({"adTitle", "adDescription"})

# `propertyUtilities` word → column. Positive-only: a named utility is True, an absent one is
# UNKNOWN, never False. «هاتف» (a telephone LINE — infrastructure, not a contact number) and
# «تصريف الفيضانات» have no column and are kept in additional_info.
_UTILITY_COLS = {
    "كهرباء": "electricity",
    "مياه": "water_supply",
    "صرف صحي": "sanitation",
    "ألياف ضوئية": "optical_fibers",
}

_AUCTION_RE = re.compile(r"مزاد")

# «سنوى» with alef maqsura is «سنوي». The shared token regex matches only the final-yeh spelling, so
# the ى→ي fold happens BEFORE any period counting — without it id 2420's «شهري وسنوى» reads as a
# lone «شهري» and its 42,000 becomes 504,000 (trap 3).
_YA = str.maketrans("ى", "ي")
_WESTERN = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")     # impersonate OWNS the User-Agent
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7",
                      "Origin": BASE, "Referer": f"{BASE}/"})
    return s


def _clean(v) -> Optional[str]:
    """A source string, or None. The backend serialises Python None into the four-character string
    "None" (`propertyUsages` on all 33 rows, `propertyAge` on 4), and the rendered page prints those
    rows BLANK — so "None" is an absent value, not the text "None" (trap 5)."""
    s = str(v).strip() if v is not None else ""
    return None if s in ("", "None", "null") else s


def _pos(v) -> Optional[int]:
    """A positive measure, or None. 0 means "not set" for area and street width — a 0-metre street
    is not a width (14/33 publish 0; the raw value is kept in the capture)."""
    n = normalize.to_int_numeric(v)
    return n if n and n > 0 else None


def _gov(rec: dict[str, Any]) -> dict[str, Any]:
    """The government block flattened to `{key: value}` — ALLOWLISTED (PDPL, trap 4).

    `advertiserName` and `phoneNumber` sit in this list on all 33 ads as the VALUE of a "key" field,
    which `strip_pii_fields()` cannot match, so nothing outside `_GOV_KEEP` is ever read out of it.
    """
    out: dict[str, Any] = {}
    for sec in rec.get("governmentData") or []:
        for item in (sec or {}).get("value") or []:
            if not isinstance(item, dict):
                continue
            k = item.get("key")
            if k in _GOV_KEEP:
                v = item.get("value")
                out[k] = redact_pii(v) if k in _GOV_FREE_TEXT else v
    return out


def _photos(rec: dict[str, Any]) -> Optional[list[str]]:
    """The four possible photos as DURABLE urls — the presigned query string stripped.

    The published URLs are S3 GetObject presignatures valid for 43,200 seconds that embed an AWS
    access-key id. The bucket objects are public, so the bare object URL serves the same image
    (verified: 18 fetches, all 200 image/jpeg, no CORP header). Storing the signature would give us
    dead links within 12 hours and park a key id in the database.
    """
    urls: list[str] = []
    for key in ("mainPhotoUrl", "photo0Url", "photo1Url", "photo2Url"):
        v = rec.get(key)
        if isinstance(v, str) and v.strip():
            bare = v.split("?", 1)[0]
            if bare not in urls:
                urls.append(bare)
    return urls or None


def _states_figure_beside(text: str, price: int, at: int) -> bool:
    r"""Does the prose print `price` ITSELF within ±90 chars of the period token at `at`?

    Arabic-Indic digits and thousands separators (including the Arabic comma «٬»/«،» ego's
    advertisers use — id 2357 writes «70،635») are normalised first. Deliberately an EXACT digit
    match: «٦٠ الف» approximates 60,000, it does not state it, and this gate exists to refuse
    approximations.

    THE SEPARATOR LOOKAHEAD IS `(?!\d)`, NOT `\b`, AND THAT IS NOT A STYLE CHOICE. Arabic letters are
    word characters, so in «70،635ريال» — exactly how id 2357's advertiser writes it, with no space
    before the currency word — there is NO word boundary after «635», and a `\b` lookahead therefore
    leaves the thousands comma in place and the figure unreadable. Measured on that live row.
    """
    window = text.translate(_WESTERN)[max(0, at - 90):at + 90]
    return re.search(rf"(?<!\d){re.escape(str(price))}(?!\d)",
                     re.sub(r"[,٬،_\s](?=\d{3}(?!\d))", "", window)) is not None


def _rent_fields(price: Optional[int], text: Optional[str]) -> tuple[Optional[str], Optional[int]]:
    """(rent_period, price_annual) for an ego rent — the platform's hardest trap (trap 3).

    ego publishes NO period field, so the only possible period is one the listing's own prose
    states. Two gates stand between that prose and a stored number, both from measurement:

    1. ONE PERIOD OR NONE. Id 2420 says «للايجار شهري وسنوى» — monthly AND yearly in one phrase,
       which is no statement about one price. Counting is done on the ى→ي-folded text, because the
       shared token regex cannot see «سنوى» and would otherwise read a lone «شهري» and store
       42,000 × 12 = 504,000. Id 2380 («اليومي والشهري») is the same shape.
    2. A CONVERTING PERIOD MUST BE CORROBORATED. On 3 of the 4 rents that name a period, the figure
       the prose prints is NOT the one the price field holds (2357, 2377, 2392 — see the module
       docstring). So a period is only trusted to MULTIPLY the stored figure when the prose prints
       that very figure beside the period word. 'annual' converts nothing, so it needs nothing.
       EVERY occurrence of the token is checked, not just the first: id 2392 says «للإيجار السنوي»
       in its opening line and prints its figure beside a SECOND «سنوي» 300 characters later, so a
       first-occurrence-only reading would call a genuinely corroborated listing uncorroborated. The
       exact-digit match is what does the protecting; which occurrence carries it is not evidence.

    In every refusal the price is still stored EXACTLY as published — the same state as the 6 rents
    that say nothing at all. Never inflated, never defaulted, never discarded.
    """
    t = (text or "").translate(_YA)
    tokens = {re.sub(r"\s+", " ", m.group(1))
              for m in normalize._RENT_PERIOD_TOKEN_RE.finditer(t)}
    if len(tokens) != 1:
        return None, price              # silence, or two periods at once — no statement either way
    period, annual = normalize.rent_period_and_annual(price, t)
    if not period:
        # يومي/أسبوعي/نصف سنوي/ربع سنوي. The shared parser returns (None, None) for these because
        # on ITS platforms the price field is labelled with that period; ego's is not, so throwing
        # the figure away would hide a source-published price on the strength of a word that may
        # describe a different number. Period UNKNOWN, price verbatim.
        return None, price
    if annual == price:
        return period, annual           # identity conversion — no number can have moved
    if price is not None and any(_states_figure_beside(t, price, m.start())
                                 for m in normalize._RENT_PERIOD_TOKEN_RE.finditer(t)):
        return period, annual           # the prose states THAT period for THIS very figure
    return None, price                  # uncorroborated multiplication → UNKNOWN, price verbatim


def map_listing(rec: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) for ONE /units/<id> detail object.

    `row` is None exactly when a reason is set. `rec` is the response's `data`, not the envelope.
    """
    pid = _clean(rec.get("id"))
    if not pid:
        return None, "residential", "no_id"

    deal = _DEAL.get((_clean(rec.get("adType")) or "").lower() or "")
    if not deal:
        return None, "residential", f"deal_unknown_{_clean(rec.get('adType')) or 'blank'}"

    # The source's own availability words. Both are "active"/False on all 33, so neither other value
    # was ever observed — which is exactly why an unexpected one skips with a counted reason instead
    # of being mapped anyway. Fails closed and stays visible in the run notes.
    status = (_clean(rec.get("status")) or "").lower()
    if status and status != "active":
        return None, "residential", f"status_{status}"
    if rec.get("isReserved") is True:
        return None, "residential", "reserved"

    gov = _gov(rec)
    title = _clean(rec.get("adTitle"))
    if _AUCTION_RE.search(f"{title or ''} {rec.get('adDescription') or ''}"):
        return None, "residential", "auction"

    type_slug = (_clean(rec.get("type")) or "").lower()
    type_ar = _TYPE_AR.get(type_slug)
    if not type_ar:
        return None, "residential", f"type_slug_unknown_{type_slug or 'blank'}"
    property_type = normalize.map_type_exact(type_ar.translate(_MARKS), _TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", f"type_unmapped_{type_slug}"
    category = normalize.category_for_type(property_type).lower()

    # LOCATION comes from the REGA block's ARABIC city/district, not from the romanized slugs
    # («aldammam», «al-aqrabyah») the list endpoint carries — those would need a transliteration
    # table we would have to invent, and the Arabic is what the fleet's catalog speaks.
    city_ar = _clean(gov.get("city"))
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar, _clean(gov.get("region")))
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_raw = _clean(gov.get("district"))
    district_ar = find_district_in_text(district_raw, city_id)

    # PDPL: the source hands us the advertiser's own name, and 2 of the 33 descriptions print that
    # exact literal. Remove it before redact_pii() runs. FULL literal only — partial-token matching
    # would mangle prose (id 2416 shares one token with its advertiser's name).
    advertiser = ""
    for sec in rec.get("governmentData") or []:
        for item in (sec or {}).get("value") or []:
            if isinstance(item, dict) and item.get("key") == "advertiserName":
                advertiser = str(item.get("value") or "").strip()
    def _prose(v) -> Optional[str]:
        s = _clean(v)
        if s and advertiser:
            s = s.replace(advertiser, " ")
        return redact_pii(s)

    title = _prose(rec.get("adTitle"))
    desc = _prose(rec.get("adDescription"))
    utilities = [w.strip() for w in str(gov.get("propertyUtilities") or "").split(",") if w.strip()]

    # ── PRICE. ONE published figure, stored verbatim. Nothing is multiplied, divided or swapped. ──
    price_raw = rec.get("price")
    price = normalize.to_int_numeric(price_raw)
    rega_price = normalize.to_int_numeric(gov.get("propertyPrice"))

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": f"{BASE}/unit-details/{pid}",
        "source": SOURCE,
        "active": True,
        "title": title,
        "description": desc,
        **normalize.amenities_from_text(f"{'، '.join(utilities)}\n{desc or ''}"),
        **{_UTILITY_COLS[w]: True for w in utilities if w in _UTILITY_COLS},
        "property_type": property_type,
        # `deal` is already provably "sell"→Buy or "rent"→Rent; anything else skipped above with a
        # counted reason. Written as a two-literal expression so the value can never be anything
        # else even in principle.
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _pos(rec.get("area")),
        "property_age": normalize.parse_property_age(gov.get("propertyAge")),
        "street_width_m": _pos(gov.get("streetWidth")),      # 0 on 14/33 → not a width
        "direction": normalize.one_direction(gov.get("propertyFace"), diagonal=True),
        "plan_parcel": _clean(gov.get("landNumber")),        # «رقم القطعة»
        "street_name": _clean(gov.get("street")),
        "zip_code": _clean(gov.get("postalCode")),
        "building_number": _clean(gov.get("buildingNumber")),
        "additional_number": _clean(gov.get("additionalNumber")),
        "license_number": _clean(rec.get("licenseNumber")),
        "license_expiry": _clean(rec.get("licenseExpiryDate")),
        "date_added": _clean(rec.get("createdAt")),
        "photo_urls": _photos(rec),
    }
    if deal == "Rent":
        # Period from THIS listing's own words only, and a multiplying period must be corroborated
        # against the very figure the price field holds. Silence → (None, price unconverted).
        period, row["price_annual"] = _rent_fields(price, f"{title or ''} {desc or ''}")
        if period:
            row["rent_period"] = period
    else:
        row["price_total"] = price
    row["price_evidence"] = normalize.price_evidence(
        field="price", raw=price_raw,
        stored=row.get("price_total") if deal == "Buy" else row.get("price_annual"),
        kind="total" if deal == "Buy" else (row.get("rent_period") or "annual"),
        unit="total", origin="api", authoritative_absent=False)
    row["images_evidence"] = {"observed": True, "container_present": "mainPhotoUrl" in rec,
                              "key_present": bool(rec.get("mainPhotoUrl")),
                              "count": len(row["photo_urls"] or [])}

    coords = rec.get("coordinates")
    info = {
        "source_id": pid,
        "type_slug": type_slug,
        "type_ar": type_ar,
        "rega_property_type": _clean(gov.get("propertyType")),   # cross-check on the slug
        "region_ar": _clean(gov.get("region")),
        "source_price_raw": price_raw,
        "source_price_display": _clean(rec.get("priceDisplay")),
        "rega_unit_price": rega_price,                            # «سعر الوحدة»
        # The ONE row where the platform's two published prices disagree (id 2415: a uint32
        # saturation at 4294967295 halalas). We store what the source SHOWS; this makes the other
        # published number auditable from the row alone. Trap 1.
        "price_disagrees_with_rega": (
            True if (price is not None and rega_price is not None and price != rega_price) else None),
        "source_area_raw": _clean(rec.get("area")),               # exact m², before the INTEGER round
        "rega_area_raw": gov.get("propertyArea"),
        "total_rooms": normalize.to_int_numeric(rec.get("numberOfRooms")),  # «عدد الغرف», NOT bedrooms
        "utility_words": utilities or None,
        "street_width_raw": gov.get("streetWidth"),               # keeps the printed 0
        "property_face_raw": _clean(gov.get("propertyFace")),     # multi-facing strings, unparsed
        "property_usages": _clean(gov.get("propertyUsages")),
        "rer_constraints": _clean(gov.get("rerConstraints")),
        "obligations": _clean(gov.get("obligationsOnTheProperty")),
        "guarantees": _clean(gov.get("guaranteesAndTheirDuration")),
        "deed_number": _clean(rec.get("deedNumber")),
        "plan_number": _clean(gov.get("planNumber")),
        "deed_location_description": _clean(gov.get("locationDescriptionOnMOJDeed")),
        "license_start_date": _clean(rec.get("licenseStartDate")),
        "source_status": _clean(rec.get("status")),
        "coordinates": coords if isinstance(coords, list) and coords else None,
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v is not None})
    # The capture is PRIVATE, but "private" is not "may accumulate contact details". Redact the
    # free-text keys HERE rather than leaning on db.redact_capture(): a barrier after the row has
    # left this mapper is not this mapper's guarantee. Numbers, licences, deeds and ids are
    # untouched, and `governmentData` is rebuilt from `_GOV_KEEP` — never copied.
    row["source_capture"] = strip_pii_fields({
        "schema": "ego.units-detail.v1",
        **{k: (_prose(rec[k]) if k in _CAPTURE_FREE_TEXT else rec[k])
           for k in _CAPTURE_KEYS if k in rec},
        "government_data": gov,
    })
    return row, category, ""


# ── FETCH ────────────────────────────────────────────────────────────────────────────────────────
def _get_json(s: cc.Session, url: str, params: Optional[dict] = None) -> dict:
    r = None
    for attempt in range(3):
        r = s.get(url, params=params, timeout=45)
        if r.status_code not in TRANSIENT_STATUSES:
            break
    if r is None or r.status_code != 200:
        raise RuntimeError(f"{url} returned {getattr(r, 'status_code', 'no response')}")
    try:
        body = r.json()
    except ValueError as exc:
        raise RuntimeError(f"{url} is no longer JSON: {exc}") from exc
    if not isinstance(body, dict):
        raise RuntimeError(f"{url} is {type(body).__name__}, not the expected object")
    return body


def _walk(s: cc.Session, ad_type: Optional[str], limit: int = 0) -> dict[str, dict]:
    """Every summary object the cursor serves for one (or no) adType, keyed by id.

    `nextPageToken` is the last id of the page and its ABSENCE is the platform's own end-of-list
    statement — there is no total anywhere. A token that fails to advance the id set stops the walk
    rather than looping forever.
    """
    rows: dict[str, dict] = {}
    token: Optional[str] = None
    pages = 0
    while True:
        params: dict[str, str] = {}
        if ad_type:
            params["adType"] = ad_type
        if token:
            params["pageToken"] = token
        body = _get_json(s, f"{API}/units", params)
        batch = [x for x in (body.get("data") or []) if isinstance(x, dict)]
        pages += 1
        before = len(rows)
        for x in batch:
            key = _clean(x.get("id"))
            if key:
                rows[key] = x
        token = _clean((body.get("pagination") or {}).get("nextPageToken"))
        if not batch or len(rows) == before or not token:
            break
        if limit and len(rows) >= limit:
            break
    print(f"  {SOURCE}: adType={ad_type or 'any'} → {len(rows)} ids over {pages} page(s)", flush=True)
    return rows


def fetch_catalogue(s: cc.Session, limit: int = 0) -> tuple[list[dict], bool]:
    """Every DETAIL record, plus whether the catalogue was served COMPLETE.

    COMPLETENESS WITHOUT A TOTAL. A cursor API that publishes no count cannot self-declare
    completeness, so this asks the platform the same question two independent ways and requires the
    answers to match: the unfiltered walk, and the union of the adType=sell and adType=rent walks.
    Measured 2026-09-24: 33 == 23 + 10, same 33 ids. If they ever disagree, `complete` is False and
    nothing is pruned — a truncated enumeration can then never look like a shrunken catalogue.
    """
    summaries = _walk(s, None, limit=limit)
    complete = False
    if not limit:
        split: dict[str, dict] = {}
        for ad_type in ("sell", "rent"):
            split.update(_walk(s, ad_type))
        complete = set(split) == set(summaries)
        if not complete:
            print(f"  ⚠ enumerations disagree: unfiltered {len(summaries)} vs "
                  f"sell+rent {len(split)} — catalogue treated as INCOMPLETE", flush=True)
    ids = list(summaries)[:limit] if limit else list(summaries)
    records: list[dict] = []
    for pid in ids:
        body = _get_json(s, f"{API}/units/{pid}")
        rec = body.get("data")
        if isinstance(rec, dict) and _clean(rec.get("id")) == pid:
            records.append(rec)
        else:
            print(f"  ⚠ /units/{pid} did not return that unit — skipped this run", flush=True)
    print(f"{SOURCE}: {len(records)} detail records of {len(ids)} listed; complete={complete}",
          flush=True)
    return records, complete


# ── LIVENESS (measured 2026-09-24 — the API, never the web page; see the docstring) ──────────────
def _signal(status, body, _moved) -> Optional[str]:
    """'live' | 'gone' | None — ego's AFFIRMATIVE signals only; the shared law does the rest.

    The web URL is useless as an oracle (the SPA shell answers 200 for every id, fabricated ones
    included), so this probes the API detail endpoint. 409 is required to SAY it is about the unit,
    not merely to be a 409 — a status code alone is not a statement.
    """
    if status == 404:
        return "gone"
    if status == 409:
        return "gone" if "inactive" in (body or "").lower() else None
    if status == 200:
        return "live" if '"data"' in (body or "") and '"id"' in (body or "") else None
    return None


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None):
        pid = ad_number[len(PREFIX):] if ad_number.startswith(PREFIX) else ""
        if not pid.isdigit():
            return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
        return LivenessProbe(platform=SLUG, signal=_signal, session=session,
                             url_for=lambda _ad: f"{API}/units/{pid}",
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
        items, complete = fetch_catalogue(s, limit=args.limit)
        if not items:
            raise RuntimeError(f"{API}/units returned no unit objects")
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
            for r0 in (res + com)[:40]:
                print(f"   {r0['ad_number']:>9} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):16} {str(r0['city_ar']):14} "
                      f"d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>6} "
                      f"pt={r0.get('price_total')} pa={r0.get('price_annual')} "
                      f"ppm={r0.get('price_per_meter')} rp={r0.get('rent_period')} "
                      f"sw={r0.get('street_width_m')} ag={r0.get('property_age')} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0
        # The public upsert_ego_*_batch wrappers are added centrally at onboarding; same funnel.
        db._wasalt_batch("ego_residential_listings", res)
        db._wasalt_batch("ego_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="ego_residential_listings", com_table="ego_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in (("ego_residential_listings", res),
                              ("ego_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        elif args.type == "all":
            print("  prune skipped: the two enumerations disagreed (incomplete catalogue)")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(items),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} complete={complete} {notes}"[:300],
                             check_tables=["ego_residential_listings",
                                           "ego_commercial_listings"])
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
