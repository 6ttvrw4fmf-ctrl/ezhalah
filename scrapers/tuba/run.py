"""طوبة العقارية (Tuba) — tuba.com.sa. 4,424 listings, onboarding 2026-09-24.

SOURCE SHAPE (measured live 2026-09-24/25; every number below was captured, not assumed).
A Laravel marketplace whose «عقارات» grid loads over AJAX. No auth, no cookie, no proxy, plain
`impersonate="chrome"`:

    GET /test/properties?page=N
        → {"mapProperties": [ …50 full records… ], "listProperties": "<html …20 cards…>",
           "mapPropertiesCount": 50, "listPropertiesCount": 4424, "presentCityIds": [...],
           "presentDistrictIds": [...], "bounds": null}

  THE `/test/` PATH IS THE PRODUCTION ENDPOINT, verified rather than assumed: the site's own
  landing page (https://tuba.com.sa/ → 302 → /properties/listing) contains exactly one ajax url,
  `url: 'https://tuba.com.sa/test/properties'`. The grid the public sees is served from here.

  `page` ADVANCES THE LIST BY 20, NOT THE RECORDS BY 50. Measured: every page carries 20
  `data-id` cards and 50 `mapProperties`, and consecutive pages' mapProperties overlap by exactly
  30 — a 50-row window sliding 20 rows at a time. Page 222 served the last 4 cards
  (221 × 20 + 4 = 4424, the declared count exactly) and page 223 served none. So the crawl walks
  pages while they serve cards and takes the records from mapProperties; the window's overlap is
  what makes the 20-stride safe.

  COMPLETENESS IS SELF-DECLARING. A full walk (223 requests, ~2.5 min) collected 4,424 DISTINCT
  ids against `listPropertiesCount` = 4424 and 4,424 cards — 4424/4424/4424. Pruning only runs
  when the platform's own count equals the rows we hold, so a truncated response can never look
  like a shrunken catalogue.

  DO NOT "CORRECT" THE COUNT AGAINST WHAT A BROWSER SHOWS. Called with no parameters this endpoint
  serves the WHOLE catalogue, 4424. A real browser on /properties/listing prints «1672 عقارات»
  instead, because the page geolocates the visitor and filters to their city (its own `convertUrl`
  ajax call) — measured from Phoenix, which resolved to Riyadh's 1,672. The smaller number is a
  per-visitor filter, not the catalogue.

  DETAIL URL. The card's own onclick is
  `window.open('https://tuba.com.sa/property/<slug>')`, so listing_url is {BASE}/property/<slug>.
  VERIFIED 200 with THAT listing's own content on 4 ids — 8449, 8493, 8379, 8462 — each page
  carrying its own title AND its own REGA `adLicenseNumber` (7200707974 / 7201114975 / 7201060262 /
  7200707996). A fabricated slug 404s (2/2). The slug is Arabic on many rows
  («شقق-فاخرة-مؤثثة-للإيجار-في-برج-حي-الصحافة») and cannot be derived from an ad_number, which is
  why the removal oracle uses the shared `stored_listing_url` reader rather than rebuilding a URL.

  PHOTOS. `gallery[].path` is already an absolute URL. 4424/4424 rows carry at least one. Two
  fetched → HTTP 200, real WebP bytes (`RIFF….WEBPVP8`, content-length == the row's own
  `media[].size`) and NO cross-origin-resource-policy header. NOTE, honestly: the responses carry
  NO Content-Type header at all (Laravel storage route behind Cloudflare), so a header-based
  "image/*" check would FAIL on this source. A 200 is not proof an image renders, so it was
  checked the only way that settles it — in a real browser on /property/office-for-rent-in-riyadh-173,
  all 35 <img> elements reported naturalWidth 898 × naturalHeight 599 and complete=true. They
  render. `video_url` and `virtual_tour` are null on all 4424, so both columns stay NULL.

THE TRAPS, ALL MEASURED
-----------------------
1. `rent_type` IS SET ON SALES AND MEANS NOTHING THERE. It is 'mo' on 3,205 rows but only 1,345
   rows are «للإيجار» — 2,233 of 2,234 measured BUY rows carry 'mo' as a column default. The
   platform never renders it for a sale: three BUY detail pages print «450k» / «900k» / «820k»
   with no period at all, while rent pages print «1k /شهري» (rent_type 'mo') and «250k /سنة»
   (rent_type 'yr'). So rent_type is read ONLY when property_status is «للإيجار», and a sale's
   value is ignored entirely. Rents: yr 1,187 · mo 127 · key absent 31.

   For a rent the period and the figure are rendered by the source in ONE element beside each
   other («1k /شهري» is `property_price` 1000 + rent_type 'mo'), which is the corroboration the
   ×12 storage conversion needs: 'mo' → rent_period 'monthly' + price_annual = price × 12 (the
   schema's documented annualisation contract — the card divides by 12, so the displayed figure is
   the source's own). 'yr' → 'annual', price verbatim. The 31 rows whose payload has NO rent_type
   key at all keep rent_period NULL and their price UNCONVERTED. Nothing defaults to annual, and
   tuba is deliberately absent from SINGLE_PERIOD_PLATFORMS — it sells both.

   The page's SIDEBAR is a decoy: the related-listing cards hardcode «/شهري» in their template
   (the villa whose own headline reads «250k /سنة» is offered in the sidebar as «250k/شهري»). Only
   the listing's own `.single_property_social_share` headline states its period.

2. LAND IS PRICED PER SQUARE METRE, AND THE ONLY TOTAL TUBA HAS IS ITS OWN ARITHMETIC. For «ارض»
   the detail page prints «السعر : 415.80k ( 660 /m²)» — the source labels the /m² figure itself
   (verified verbatim on /property/…-8489, area 630). `property_price` is that rate;
   `land_total_price` is the total it prints.

   BUT THAT TOTAL IS DERIVED, and this was measured before it was believed: on 69 of the 71 rows
   that publish one, land_total_price == property_price × property_area EXACTLY (Decimal, not
   float), and the 2 "exceptions" differ only in the fourth decimal of the same product
   (id 7789: 1400 × 823.03997802734 = 1152255.96923827600 vs the published 1152255.97). It is the
   platform's multiplication, not an independently published price — the aqargate shape, which
   `test_aqargate_does_not_adopt_the_platforms_own_rate_times_area` bans, and NOT the abaad shape
   (where 4 of 47 totals disagreed with the product and so proved themselves independent).

   So a rate-priced row stores `price_per_meter` = the source's own rate and leaves the TOTAL
   UNKNOWN. Deriving a shown total from ppm × area is the SEARCH/DISPLAY layer's job
   (search_listings_ar.price_total_effective), never a scraper's — owner reversal 2026-09-03 kept
   `scrapers/` and the base tables under PRICE = SOURCE. The platform's own product is preserved
   verbatim in additional_info so nothing is lost.

   THE MARKER IS THE SOURCE'S OWN, and it is exact: a row is rate-priced when the source publishes
   its own land total — `land_total_price` (71 rows, all sales) or REGA's `landTotalAnnualRent`
   (3 rows, all rents). 71 + 3 = 74 = every «ارض» row in the catalogue, and 0 of the other 4,350
   rows carries either. No type heuristic is needed and none is used.

   THE LAND RENTS ARE THE HARDEST CASE AND THE FLEET HAS ALREADY RULED ON IT. tuba's own page
   prints «167 /سنة» for id 7657 — a bare annual badge with no /m² marker — while REGA's payload
   for the same row publishes propertyPrice 167 AND landTotalAnnualRent 125250 (= 167 × 750, its
   own product again). Storing 167 as price_annual would make a 750 m² commercial plot searchable
   at 167 SAR/yr: the exact class of
   `test_no_writer_assigns_the_same_expression_to_total_and_per_metre`, whose own words are "the
   platform's own badge renders the rate under a bare «السعر» label. The badge is not the
   contract: the REGA table says «سعر الوحدة»". So those 3 rows store price_per_meter and leave
   price_annual UNKNOWN. They lose budget searchability; that is raised as an open question rather
   than fixed by guessing which of the source's two statements to believe.

3. `property_rooms` IS **TOTAL ROOMS**, NOT BEDROOMS — even though tuba's own UI labels it
   «غرف النوم». Proof, not inference: it equals REGA's `numberOfRooms` on 4,341 of 4,424 rows (the
   83 differences are all rows where REGA says null and tuba stores 0), REGA has NO bedroom field
   of any kind (44 response_data keys, checked), and tuba's own `bedrooms` column is null on all
   4,424. An office row carries 150 of them. abaad measured the same REGA field against a real
   «غرف نوم» entry and they disagreed on 99 rows, which settled that numberOfRooms is «عدد الغرف»;
   that precedent applies here, where there is no second field to compare against. So `bedrooms`
   stays NULL fleet-wide for tuba and the count goes to additional_info as `total_rooms`. Confirmed
   as a real user sees it: the live grid card for that office prints «150 غرف نوم 10 حمامات
   3000 متر مربع». This is
   the single biggest open question in this build (see below) — it is deliberately not guessed.

4. PDPL, AND THIS SOURCE IS A MINEFIELD. Every record carries an `agent` object with
   `mobile_number`, `email`, `whatsapp_number`, `id_number` (a Saudi national ID), `father_name`,
   `grand_father_name`, `tmp_token_nafath` (a live auth token) and `profile_picture`; a
   `user_location` object holding the advertiser's IP address and geolocation; and
   `advalidatorinfo.response_data`, a JSON STRING whose 44 keys include `advertiserName`,
   `phoneNumber`, `responsibleEmployeeName` and `responsibleEmployeePhoneNumber`. The rendered
   detail page prints «رقم جوال مسؤول الإعلان 0508870478» beside a broker's full name.
   NONE of it reaches a column, additional_info or source_capture: both JSONB payloads are built
   from explicit key ALLOWLISTS (`_CAPTURE_KEYS`, `_REGA_KEYS`), every free-text value goes through
   `_scrub()`, and strip_pii_fields() runs over the finished payloads as a second barrier.
   Allowlists rather than blocklists, because `agent` carries `name`, which db.redact_capture()
   deliberately does not treat as a contact channel, and because a PII key added upstream tomorrow
   must not arrive by default.

   AND THE ALLOWLIST ALONE WAS NOT ENOUGH — a sweep over all 4,417 mapped rows caught the leak that
   an allowlist cannot: the advertisers write their OWN name into their own ad body, so REGA's
   `advertiserName` (a natural person on 13 of its 35 distinct values) reached the `description`
   column on 11 rows and `responsibleEmployeeName` on 1. `_scrub()` removes both, and the sweep is
   now clean: 0 phones, 0 emails, 0 WhatsApp links, 0 advertiser/employee names and none of the 18
   forbidden KEYS in any stored row. The sweep's only remaining matches were false positives worth
   recording so nobody re-files them as leaks: a REGA `adLicenseUrl` UUID and photo filenames that
   happen to contain a «05…» digit run, and advertiser-uploaded screenshots literally named
   «WhatsApp-Image-2026-04-27-….webp» (141 of them) — a filename, not a contact link.

5. `year_built` IS AN AGE, NOT A YEAR. Its whole measured vocabulary is Arabic words — «جديد»
   (1,733), «عشر سنوات» (277), «اكثر من عشر سنوات» (201), «ثمان سنوات» (138), «سنة», «سنتين»,
   «اقل من سنة», … — 14 distinct values, every one of them already in the shared audited
   `parse_property_age()` table, including the open-ended «اكثر من عشر سنوات» → 10 (bucket FLOOR,
   never a fabricated midpoint). Reading it as a build year would have produced nothing at all.

6. THE STUDIO TYPE CARRIES INVISIBLE TASHKEEL IN A NON-OBVIOUS ORDER — the same defect abaad hit.
   The source's «شقَّة صغيرة (استوديو)» (4 rows) is written with shadda BEFORE fatha; a hand-typed
   copy renders identically and compares UNEQUAL, so an override keyed on a typed string silently
   never fires. Marks are stripped before the lookup, which also protects the shared TYPE_MAP_AR
   keys from a stray diacritic on a future row. All 12 source type words then map: شقة 2504,
   فيلا 1109, دور 574, مكتب 143, ارض 74, إستراحة 4, عمارة 4, معرض 4, استوديو 4, غرفة 2,
   مستودع 1, مصنع 1 — zero type skips.

7. `bathrooms` PUBLISHES A REAL 0. 246 rows hold 0 and the source RENDERS it — the card prints
   «0 حمامات» and the detail table «الحمامات : 0» (verified on /property/villa-for-rent-in-riyadh-23,
   a 7-room villa). So 0 is kept as the source's published answer rather than nulled, the abaad
   reading of a rendered zero. Whether a rendered 0 on a LAND row means "none" or "not entered" is
   an open question below; nothing is inverted either way.

AUCTIONS AND OFF-PLAN
---------------------
Neither is present, and neither is guessed. Scanned all 4,424 titles + Arabic titles + descriptions:
«مزاد» 0 · «على الخارطة» 0 · «البيع على الخارطة» 0 · «بيع على الخريطة» 0 · «تحت الإنشاء» 0 ·
«تحت الانشاء» 0 · «قيد الإنشاء» 0. `property_status` has exactly two values in the whole catalogue
(«للبيع» 3,079, «للإيجار» 1,345) — there is no off-plan status, no %-sold bar and no price range
anywhere (`property_price` is an int on 4,423 rows and null on 1). The auction guard is
nevertheless SHIPPED and counted, because an exclusion that is never re-evaluated fails silently
the day the marketplace adds one; it currently reports 0. No off-plan skip exists because the
source publishes no off-plan marker, and a heuristic is not a marker.

REMOVAL ORACLE (measured 2026-09-25 — the source says it in its own words)
-------------------------------------------------------------------------
A de-listed ad KEEPS its detail page and answers 200 with full content, so "is it 200?" would
retire nothing and "200 means live" would resurrect the dead forever. What IS decisive is a banner
the page prints about ITSELF:

    «هذا العقار لم يعد متاحًا.»  +  «منتهي الصلاحية»        ← no longer available / expired

HOW THE GONE SAMPLE WAS BUILT (no fabricated ids — the slug is not derivable). Slugs come in
sequential families («apartment-for-rent-in-jeddah-N», «Floor-For-Sale-الرياض-N»); a family's
numeric GAPS are slugs the platform once assigned and no longer lists. 55 gap slugs were probed
against 40 interleaved known-live controls from the same crawl:

    55/55 absent slugs       → 200 + the banner, reason «منتهي الصلاحية» (25/25 where the reason
                               was extracted), 0 counter-examples
    40/40 live controls      → 200, banner ABSENT
    2/2 fabricated slugs     → 404
    0 of the 4,424 live rows carry a lapsed REGA licence (`advalidatorinfo.endDate` is in the
      FUTURE on all 4,424), which is consistent with expiry being what drives the removal.

    404                                → gone (hard delete)
    200 + «لم يعد متاح»                → gone (the source's own statement)
    200, listing page, no banner       → live (self-heal: absent from OUR crawl, not the platform's)
    200 but not a listing page         → UNKNOWN (no «تفاصيل العقار» anchor — we read no answer)
    anything else                      → UNKNOWN, and the shared law in http_liveness overrides
                                         any 'gone' on a blocked/5xx/empty read

The live branch deliberately requires the page's own «تفاصيل العقار» anchor as well as the absent
banner, so a shell or a redirect landing page cannot manufacture a verification. Removals are
additionally gated by an in-run positive control that fails CLOSED, and rows are built from the
LIST endpoint, so mark_direct_alive() is NOT called — that stamp requires a fetch of the listing's
own record.

COVERAGE (full --dry-run against the live endpoint, 2026-09-25)
--------------------------------------------------------------
4,424 listings over 222 pages, 4,424 cards, listPropertiesCount=4424, complete=True → 4,417 mapped
(4,264 residential + 153 commercial), 7 skipped and counted: city_not_in_catalog 7 — محائل 5,
قصرابن عقيل 1, خبت سعيد 1. Zero type skips, zero auction skips, zero deal-unknown skips.
Deal split 3,072 Buy / 1,345 Rent. Types: Apartment 2501 · Villa 1107 · Floor 572 · Office 143 ·
Residential Land 74 · Rest House 4 · Building 4 · Showroom 4 · Studio 4 · Room 2 · Warehouse 1 ·
Factory 1.
  price_total 3,001 · price_annual 1,342 · price_per_meter 74 (73 real + TBA1055 AUTHORITATIVE_NULL)
  rent_period 1,187 annual + 127 monthly, 31 UNKNOWN · area_m2 4,417 · bathrooms 4,417
  bedrooms 0 (see trap 3) · parking 29 · property_age 4,311 · street_width_m 1,221 · direction 1,213
  district_ar 4,169 · neighborhood 4,417 · photos 4,417 · license_number 4,417 ·
  license_expiry 4,417 · ad_source 4,417 · plan_parcel 3,259 · street_name 4,227 ·
  building_number 4,384 · additional_number 4,416 · zip_code 4,384 · date_added 4,385 ·
  description 4,385 · title 4,417
  electricity 4,366 · water_supply 4,278 · sanitation 3,201 · optical_fibers 1,243 ·
  elevator 1,255 · furnished 1,002 · kitchen 947 · maid_room 571 · balcony_terrace 241 ·
  air_conditioner 178 · driver_room 118 · private_entrance 15
A PDPL sweep over all 4,417 finished rows (18 forbidden keys + every PII VALUE the record itself
carries + phone/email/WhatsApp patterns) reports zero findings.

OPEN QUESTIONS FOR ONBOARDING (none of these are guessed in code)
-----------------------------------------------------------------
  · `property_rooms` / REGA `numberOfRooms` is TOTAL rooms and tuba's UI calls it «غرف النوم».
    bedrooms is therefore NULL on all 4,424 rows and tuba ships with no bedroom filter coverage.
    Does the owner want the total-room count surfaced as bedrooms (matching the source's own
    label, and wrong for the 150-room office), or a bedroom column that stays honestly empty?
    This is a normalize/product decision, not a scraper one.
  · The 3 land RENTS store a per-metre rate and no annual total, so they cannot match a rent
    budget. The only total the source has is its own propertyPrice × area. Accept the gap, or let
    the search layer derive a rent total the way it already derives a sale total?
  · «لايوجد خدمات» (47 rows) is an explicit but BLANKET negative: it names no specific utility, so
    no column is set False from it. Does the owner read it as an explicit NO for
    electricity/water/sanitation?
  · A rendered `bathrooms` 0 on a LAND row (0 bathrooms on a plot) — the source's answer, or an
    inapplicable form default? Currently kept as 0.
  · REGA encumbrances are published and have no column: `isConstrained` true on 182 rows,
    `isPawned` on 128, `redZoneTypeName` «حظر تجاري» on 3,217. They sit in additional_info. Should
    a constrained or pawned property be flagged to the user?
  · `popularity` (an integer on every row) is NOT stored as views_count — nothing on the site
    labels it a view count, and guessing would fabricate a metric. Confirm what it is.

DETAIL, MEASURED
----------------
  · `status` is 2 and `is_paid` "2" on 4,392 rows and both keys are ABSENT on the other 32 (a
    leaner record shape that also omits rent_type, created_at, year_built and
    property_description). No other value exists anywhere, so neither is a death signal and
    neither is read as one; `cancelled_at` and `deleted_at` are null on all 4,424.
  · LOCATION comes from the record's own `city`/`district` objects (present on 4,424/4,424), with
    REGA's `location.region` as the region hint for to_catalog(). 51 distinct city names.
  · `street_width_m` reads REGA's `streetWidth`, which is 0 on 3,201 rows — one_street_width()
    returns None for 0, so no zero is stored as a width. `direction` reads `propertyFace` through
    one_direction(diagonal=True): «شمالية شرقية» → «شمال شرق», and a dashed two-bearing cell
    («شمالية - جنوبية», 7 rows) stays None because a corner is not one facade.
  · AMENITIES are positive-only. The structured REGA `propertyUtilities` (كهرباء 4,373 · مياه
    4,285 · صرف صحي 3,206 · ألياف ضوئية 1,245) set their columns True; a name the source omits
    stays NULL, never False. «هاتف» (1,892) and «تصريف الفيضانات» (929) have no column and are
    kept as raw words. `parking` comes from the `garages` COUNT through count_flag(), which keeps
    a published 0 as False and a silent field as None (29 rows publish a count).
  · `land_area`, `size_prefix`, `land_area_size_postfix`, `virtual_tour`, `video_url` and
    `bedrooms` are null on all 4,424 and are not read.
  · Coordinates are published (`address_latitude`/`address_longitude` on every row) but the
    listing tables carry no coordinate columns, so they are not stored.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http import TRANSIENT_STATUSES  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe, stored_listing_url  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://tuba.com.sa"
API = f"{BASE}/test/properties"          # the site's own ajax url — see the docstring
SOURCE = "طوبة العقارية"
PREFIX = "TBA"
SLUG = "tuba"
RES_TABLE = "tuba_residential_listings"
COM_TABLE = "tuba_commercial_listings"

# The page's own removal banner and the anchor that proves we are looking at a listing page at all.
GONE_MARK = "لم يعد متاح"
LISTING_ANCHOR = "تفاصيل العقار"

# TASHKEEL IS INVISIBLE AND ITS ORDER IS NOT SEMANTIC (trap 6). The source's studio type is written
# shadda-before-fatha; a hand-typed copy renders identically and compares UNEQUAL, so marks are
# stripped before every type lookup.
_MARKS = dict.fromkeys(list(range(0x064B, 0x0653)) + [0x0640, 0x0670])


def _strip_marks(s: Optional[str]) -> Optional[str]:
    return s.translate(_MARKS) if s else s


# Keyed on the mark-free form. The value is the fold TYPE_MAP_EN already applies to wasalt's
# "Small apartment (studio)" and abaad's «شقة صغيرة (استوديو)».
# Written across three lines ON PURPOSE. verify-scraper-type-tokens-mapped finds a type map by its
# opening `= {` and ends the block at a `}` in column 0; collapsed onto one line the scan runs past
# it and swallows the NEXT dict, so _DEAL's "Buy"/"Rent" were read as PROPERTY TYPES and reported as
# unmapped. Same defect abaad shipped and fixed the same way (2026-09-25).
_TYPE_OVERRIDES = {
    "شقة صغيرة (استوديو)": "Studio",
}

_DEAL = {"للبيع": "Buy", "للإيجار": "Rent"}

# `rent_type` → the fleet's period vocabulary. A DICT, not a ternary on a constant: there is no
# default branch to fall into, so a value the source does not publish yields None (UNKNOWN).
# Read ONLY for a «للإيجار» row — on a sale the column holds a meaningless 'mo' default (trap 1).
_RENT_PERIOD = {"yr": "annual", "mo": "monthly"}

# REGA propertyUtilities → the column the source's own word states. Positive-only: an absent name
# is UNKNOWN, never False. «لايوجد خدمات» is a BLANKET negative and is deliberately NOT here.
_UTILITY_COLS = {
    "كهرباء": "electricity",
    "مياه": "water_supply",
    "صرف صحي": "sanitation",
    "ألياف ضوئية": "optical_fibers",
}

# «مزاد» anywhere in the listing's own words. Zero rows today; shipped so the exclusion is
# re-evaluated on every run instead of being assumed away (measured 0/4424, and counted as 0).
_AUCTION_RE = re.compile(r"مزاد")

# ── PDPL ALLOWLISTS (trap 4) ─────────────────────────────────────────────────────────────────────
# Keys copied from the OUTER record. Everything not named here is dropped, including `agent`,
# `user_location` (the advertiser's IP), `media`, `user_id`, `created_by`, `cancelled_by`,
# `status_updated_by` and `agent_ad_validator_information_id`.
_CAPTURE_KEYS = (
    "id", "slug", "property_title", "property_title_arabic", "property_description",
    "property_type", "property_category", "property_status", "rent_type", "property_price",
    "land_total_price", "property_area", "land_area", "property_rooms", "bathrooms", "garages",
    "garages_size", "year_built", "national_address", "address", "city_id", "district_id",
    "region_id", "postal_code", "building_number", "created_at", "updated_at", "ad_type",
    "is_featured", "status", "popularity", "street_view", "video_url", "virtual_tour",
)
# Keys read out of `advalidatorinfo.response_data` (a JSON STRING). `advertiserId`,
# `advertiserName`, `phoneNumber`, `responsibleEmployeeName` and `responsibleEmployeePhoneNumber`
# are ABSENT from this tuple on purpose — that is the whole point of an allowlist.
_REGA_KEYS = (
    "adLicenseNumber", "brokerageAndMarketingLicenseNumber", "adLicenseUrl", "adSource",
    "advertisementType", "propertyType", "propertyAge", "propertyArea", "propertyPrice",
    "landTotalPrice", "landTotalAnnualRent", "numberOfRooms", "streetWidth", "propertyFace",
    "propertyUsages", "propertyUtilities", "mainLandUseTypeName", "redZoneTypeName",
    "titleDeedTypeName", "deedNumber", "planNumber", "landNumber", "isConstrained", "isPawned",
    "isHalted", "isTestment", "obligationsOnTheProperty", "guaranteesAndTheirDuration",
    "complianceWithTheSaudiBuildingCode", "ownershipTransferFeeType",
    "locationDescriptionOnMOJDeed", "notes", "channels", "borders", "rerBorders", "rerConstraints",
    "creationDate", "endDate", "location",
)
# Of those, the keys that carry PROSE — where an advertiser's own phone or WhatsApp link hides.
_FREE_TEXT = frozenset({
    "property_title", "property_title_arabic", "property_description", "national_address",
    "address", "notes", "obligationsOnTheProperty", "guaranteesAndTheirDuration",
    "locationDescriptionOnMOJDeed",
})


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")     # impersonate OWNS the User-Agent
    s.headers.update({"Accept": "application/json, text/html", "Accept-Language": "ar,en;q=0.7"})
    return s


def _clean(v) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


def _pos(v) -> Optional[int]:
    """A positive count/measure, or None. 0/"" mean "not set" for these fields."""
    n = normalize.to_int_numeric(v)
    return n if n and n > 0 else None


def _num(v) -> Optional[int]:
    """A source-published number, 0 INCLUDED. Used for `bathrooms`, which the source RENDERS at 0
    («0 حمامات» on the card, «الحمامات : 0» in the detail table) — so 0 is its published answer."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    return normalize.to_int_numeric(v) or (0 if str(v).strip() in ("0", "0.0") else None)


def _scrub(v, names: tuple[str, ...]):
    """redact_pii, PLUS the names REGA itself attributes to this ad's advertiser or employee.

    WHY THE SECOND HALF EXISTS (measured over all 4,424 rows). redact_pii() removes contact
    CHANNELS — phones, emails, WhatsApp links — and deliberately does not remove names, because
    db.redact_capture() must not eat regulatory keys. But tuba's advertisers write their own name
    into their own ad body, and REGA's `advertiserName` is a NATURAL PERSON on 13 of its 35 distinct
    values («نها فوزي عبدالله حريري», «سعد محمد خفير القرني», …) — not only companies. Measured
    exposure before this: `advertiserName` reached the `description` column on 11 rows and
    `responsibleEmployeeName` on 1 («… الموظف المسؤول عن الإعلان: طلال هاشم بن حسن الصعب», whose
    phone on the same line redact_pii had already taken).

    So the two names the source itself labels are removed from every stored free-text value. This is
    the one place a stored value deliberately differs from the source's published text: PDPL governs
    a natural person's name, and the fields are named by the source, never guessed.
    """
    out = redact_pii(v)
    if isinstance(out, str):
        for n in names:
            out = out.replace(n, "[redacted]")
    return out


def _pii_names(ar: dict[str, Any]) -> tuple[str, ...]:
    """The advertiser / responsible-employee names this ad's own REGA record states."""
    return tuple(n for k in ("advertiserName", "responsibleEmployeeName")
                 if (n := _clean(ar.get(k))) and len(n) >= 6)


def rega(rec: dict[str, Any]) -> dict[str, Any]:
    """The REGA ad-licence record the platform stores, as a dict.

    `advalidatorinfo.response_data` is a JSON **string**; an unparseable one is an empty dict, never
    an exception — a broken payload must not cost the whole row.
    """
    raw = (rec.get("advalidatorinfo") or {}).get("response_data")
    if not raw:
        return {}
    try:
        out = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return out if isinstance(out, dict) else {}


def map_listing(rec: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) for ONE property record. row is None exactly when a reason is set."""
    pid = _clean(rec.get("id"))
    if not pid:
        return None, "residential", "no_id"

    deal = _DEAL.get(_clean(rec.get("property_status")) or "")
    if not deal:
        return None, "residential", f"deal_unknown_{_clean(rec.get('property_status')) or 'blank'}"

    type_ar = _clean(rec.get("property_type")) or _clean((rec.get("propertytype") or {}).get("name_ar"))
    property_type = normalize.map_type_exact(_strip_marks(type_ar), _TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", f"type_unmapped_{type_ar or 'blank'}"
    category = normalize.category_for_type(property_type).lower()

    title = _clean(rec.get("property_title_arabic")) or _clean(rec.get("property_title"))
    desc = _clean(rec.get("property_description"))
    if _AUCTION_RE.search(f"{title or ''} {desc or ''}"):
        return None, category, "auction"

    ar = rega(rec)
    names = _pii_names(ar)
    city_ar = _clean((rec.get("city") or {}).get("name_ar")) or _clean((rec.get("city") or {}).get("name"))
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar, _clean((ar.get("location") or {}).get("region")))
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_raw = (_clean((rec.get("district") or {}).get("name_ar"))
                    or _clean((rec.get("district") or {}).get("name")))
    district_ar = (find_district_in_text(district_raw, city_id)
                   or find_district_in_text(title, city_id))

    desc = _scrub(desc, names)
    utilities = [w for u in (ar.get("propertyUtilities") or []) if (w := _clean(u))]

    photos = [p for g in (rec.get("gallery") or [])
              if isinstance(g, dict) and (p := _clean(g.get("path")))] or None

    # ── PRICE. Nothing is ever computed; see trap 2 for why the platform's own total is not one. ──
    # The source's OWN rate marker: it publishes a land total of its own (a sale's
    # `land_total_price`, a rent's REGA `landTotalAnnualRent`) exactly on the rows whose
    # `property_price` is «سعر المتر». Measured: present on 74/74 «ارض» rows, 0/4350 others.
    platform_land_total = rec.get("land_total_price")
    if platform_land_total in (None, ""):
        platform_land_total = ar.get("landTotalAnnualRent")
    rate_only = platform_land_total not in (None, "")

    price_raw = rec.get("property_price")
    figure = normalize.to_int_numeric(price_raw)
    # The key is PRESENT and carries no number (id 1055 publishes null and its page renders
    # «0 /سنة»): the source itself states this listing has no price. That is AUTHORITATIVE_NULL, not
    # a failed read — a plain None is DROPPED by the no-clobber guard and would let a stale figure
    # survive. Checked on BOTH branches: 1055 is a rate-priced land rent, so a check that only
    # covered the non-land branch would have missed the one row in the catalogue that needs it.
    absent = figure is None and "property_price" in rec
    if rate_only:
        # «سعر المتر» — a RATE. The only total tuba has is its own price × area (69/71 exact), so
        # the total stays UNKNOWN and the search layer derives what it shows.
        ppm: Any = db.AUTHORITATIVE_NULL if absent else figure
        headline: Optional[int] = None
    else:
        ppm = None
        headline = figure

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": f"{BASE}/property/{rec.get('slug')}",
        "source": SOURCE,
        "active": True,
        "title": _scrub(title, names),
        "description": desc,
        # Prose amenities FIRST so the structured REGA utilities below always win.
        **normalize.amenities_from_text(f"{'، '.join(utilities)}\n{desc or ''}"),
        # Positive-only: a utility the source omits stays NULL. «لايوجد خدمات» names no specific
        # service, so it sets nothing False (open question).
        **{_UTILITY_COLS[w]: True for w in utilities if w in _UTILITY_COLS},
        "property_type": property_type,
        # `deal` is already provably «للبيع»→Buy or «للإيجار»→Rent — anything else skipped above
        # with a counted reason. Written as a two-literal expression so the value can never be
        # anything else even in principle.
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _pos(rec.get("property_area")),
        # `bedrooms` is DELIBERATELY absent: `property_rooms` is REGA's numberOfRooms — total rooms
        # (trap 3). It is kept in additional_info and raised as an open question.
        "bathrooms": _num(rec.get("bathrooms")),
        "parking": normalize.count_flag(rec.get("garages")),
        "property_age": normalize.parse_property_age(rec.get("year_built")),   # an AGE, not a year
        "street_width_m": normalize.one_street_width(ar.get("streetWidth")),
        "direction": normalize.one_direction(ar.get("propertyFace"), diagonal=True),
        "plan_parcel": _clean(ar.get("landNumber")),             # «رقم القطعة»
        "street_name": _clean((ar.get("location") or {}).get("street")),
        "building_number": _clean(rec.get("building_number")),
        "additional_number": _clean((ar.get("location") or {}).get("additionalNumber")),
        "zip_code": _clean(rec.get("postal_code")),
        "license_number": _clean((rec.get("advalidatorinfo") or {}).get("adLicenseNumber")),
        "license_expiry": _clean((rec.get("advalidatorinfo") or {}).get("endDate")),
        "ad_source": _clean(ar.get("adSource")),                 # «مصدر الإعلان»
        "date_added": _clean(rec.get("created_at")),
        "price_per_meter": ppm,
        "photo_urls": photos,
    }
    # AUTHORITATIVE_NULL belongs on the column the SOURCE addressed. On a rate-priced row that is
    # `price_per_meter` (above); its total is plain None — UNKNOWN because we decline to derive one,
    # which is a different fact from "the source says there is no price".
    total_absent = absent and not rate_only
    if deal == "Rent":
        # The period is the source's own `rent_type`, read ONLY here — on a sale it is a column
        # default (trap 1). Absent/unknown value → None, and the price is stored UNCONVERTED.
        period = _RENT_PERIOD.get(_clean(rec.get("rent_type")) or "")
        row["price_annual"] = (db.AUTHORITATIVE_NULL if total_absent
                               else normalize.annualize_rent(headline, period))
        if period:
            row["rent_period"] = period
    else:
        row["price_total"] = db.AUTHORITATIVE_NULL if total_absent else headline

    stored = None if absent else (figure if rate_only else headline)
    row["price_evidence"] = normalize.price_evidence(
        field="property_price",
        raw=price_raw,
        stored=stored,
        kind=("per_meter" if rate_only
              else ("total" if deal == "Buy" else (row.get("rent_period") or "unconverted"))),
        unit="per_meter" if rate_only else "total",
        origin="api",
        authoritative_absent=absent)
    row["images_evidence"] = {"observed": True, "container_present": "gallery" in rec,
                              "key_present": bool(rec.get("gallery")),
                              "count": len(photos or [])}

    info = {
        "source_id": pid, "type_ar": type_ar,
        "region_ar": _clean((ar.get("location") or {}).get("region")),
        "national_address": _scrub(_clean(rec.get("national_address")), names),
        "address_ar": _scrub(_clean(rec.get("address")), names),
        "source_price_raw": price_raw,
        # The platform's OWN land total: price × area on 69 of 71 rows (the other 2 differ in the
        # 4th decimal of the same product). Kept verbatim, never stored as a price.
        "platform_land_total_derived": platform_land_total,
        "price_is_per_meter": rate_only or None,
        "source_area_raw": _clean(rec.get("property_area")),   # exact m², before area_m2's round
        "total_rooms": _num(rec.get("property_rooms")),        # REGA numberOfRooms, NOT bedrooms
        "utility_words": utilities or None,
        "property_usages": ar.get("propertyUsages") or None,
        "main_land_use": _clean(ar.get("mainLandUseTypeName")),
        "red_zone": _clean(ar.get("redZoneTypeName")),
        "title_deed_type": _clean(ar.get("titleDeedTypeName")),
        "deed_number": _clean(ar.get("deedNumber")),
        "plan_number": _clean(ar.get("planNumber")),
        "fal_license_number": _clean(ar.get("brokerageAndMarketingLicenseNumber")),
        "is_constrained": ar.get("isConstrained"),
        "is_pawned": ar.get("isPawned"),
        "source_rent_type": _clean(rec.get("rent_type")),
        "source_status": _clean(rec.get("status")),
        "popularity": rec.get("popularity"),                   # NOT read as views_count
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v is not None})
    # The capture is PRIVATE, but "private" is not "may accumulate contact details". Both payloads
    # are built from the ALLOWLISTS and the prose keys are redacted HERE rather than leaning on
    # db.redact_capture(): a barrier after the row has left the mapper is not this mapper's
    # guarantee. Numbers, licences, deeds and ids are untouched.
    row["source_capture"] = strip_pii_fields({
        "schema": "tuba.test-properties.mapProperties.v1",
        **{k: (_scrub(rec[k], names) if k in _FREE_TEXT else rec[k])
           for k in _CAPTURE_KEYS if k in rec},
        "rega": {k: (_scrub(ar[k], names) if k in _FREE_TEXT else ar[k])
                 for k in _REGA_KEYS if k in ar},
    })
    return row, category, ""


# ── FETCH ────────────────────────────────────────────────────────────────────────────────────────
_CARD_ID_RE = re.compile(r'data-id="(\d+)"')


def fetch_catalogue(s: cc.Session, limit: int = 0) -> tuple[list[dict], bool]:
    """Every property record, plus whether the catalogue was served COMPLETE.

    `page` advances the LIST by 20 while `mapProperties` is a 50-row window from the same offset
    (verified — see the docstring), so the walk follows the cards and harvests the records. Only a
    page that actually served cards contributes: a cardless page is past the end, and ingesting its
    leftover window could push the distinct count past the platform's own declared total and turn a
    complete crawl into an incomplete one.

    Complete means `listPropertiesCount` equals the number of distinct rows we hold. Only then may
    anything be pruned.
    """
    rows: dict[str, dict] = {}
    declared: Optional[int] = None
    cards = 0
    page = 1
    while True:
        r = None
        for _attempt in range(3):
            r = s.get(f"{API}?page={page}", timeout=60)
            if r.status_code not in TRANSIENT_STATUSES:
                break
        if r is None or r.status_code != 200:
            raise RuntimeError(f"{API} page {page} returned {getattr(r, 'status_code', 'no response')}")
        try:
            body = r.json()
        except ValueError as exc:
            raise RuntimeError(f"{API} page {page} is no longer JSON: {exc}") from exc
        if not isinstance(body, dict):
            raise RuntimeError(f"{API} page {page} is {type(body).__name__}, not the expected object")
        if declared is None:
            declared = normalize.to_int_numeric(body.get("listPropertiesCount"))
        page_cards = _CARD_ID_RE.findall(body.get("listProperties") or "")
        if not page_cards:
            break                       # past the last page of the list
        cards += len(page_cards)
        for e in body.get("mapProperties") or []:
            if isinstance(e, dict) and (key := _clean(e.get("id"))):
                rows.setdefault(key, e)
        if limit and len(rows) >= limit:
            return list(rows.values())[:limit], False
        page += 1
        if page > 2000:                 # a pagination that never ends is a bug, not a catalogue
            raise RuntimeError(f"{API} still served cards at page {page} — refusing to loop")
    items = list(rows.values())
    complete = bool(declared) and len(items) == declared
    print(f"{SOURCE}: {len(items)} listings over {page - 1} page(s); {cards} cards; "
          f"listPropertiesCount={declared} complete={complete}", flush=True)
    return items, complete


# ── LIVENESS (measured 2026-09-25; see the docstring — a 200 is NOT proof of life) ────────────────
def _signal(status, body, _moved) -> Optional[str]:
    """'live' | 'gone' | None — tuba's AFFIRMATIVE signals only; the shared law does the rest.

    A de-listed ad keeps serving its page, so a 200 alone says nothing. The page states its own
    removal («هذا العقار لم يعد متاحًا. منتهي الصلاحية» — 55/55 absent slugs, 0/40 live controls),
    and a 'live' additionally requires the page's own «تفاصيل العقار» anchor so that a shell or a
    redirect landing page cannot manufacture a verification.
    """
    if status == 404:
        return "gone"
    if status != 200:
        return None
    if GONE_MARK in body:
        return "gone"                   # the source's own statement about this listing
    if LISTING_ANCHOR in body:
        return "live"
    return None                         # a 200 that is not a listing page — no opinion


def _make_verify_gone(control: Optional[dict]):
    url_for = stored_listing_url((RES_TABLE, COM_TABLE))

    def probe(ad_number: str, canary=None):
        return LivenessProbe(platform=SLUG, signal=_signal, session=session,
                             url_for=url_for, canary=canary).verify_gone(ad_number)

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
            raise RuntimeError(f"{API} returned no property records")
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
                print(f"   {r0['ad_number']:>9} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):16} {str(r0['city_ar']):12} "
                      f"d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>6} "
                      f"ba={str(r0.get('bathrooms')):>4} pt={r0.get('price_total')} "
                      f"pa={r0.get('price_annual')} ppm={r0.get('price_per_meter')} "
                      f"rp={r0.get('rent_period')} sw={r0.get('street_width_m')} "
                      f"ag={r0.get('property_age')} ph={len(r0.get('photo_urls') or [])}")
            return 0
        # The public upsert_tuba_*_batch wrappers are added centrally at onboarding; same funnel.
        db._wasalt_batch(RES_TABLE, res)
        db._wasalt_batch(COM_TABLE, com)
        superseded = db.retire_superseded_siblings(
            res_table=RES_TABLE, com_table=COM_TABLE,
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        elif args.type == "all":
            print("  prune skipped: listPropertiesCount did not match the rows served "
                  "(incomplete catalogue)")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(items),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} complete={complete} {notes}"[:300],
                             check_tables=["tuba_residential_listings",
                                           "tuba_commercial_listings"])
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
