"""أحمد المحيسني العقارية — aqaralmuhaysini.com. 2,827 listings, onboarding 2026-09-24.

SOURCE SHAPE (measured live 2026-09-24; every number below was captured, not assumed).
A Vue SPA whose data comes from its own unauthenticated JSON API — no auth, no cookie, no proxy,
plain `impersonate="chrome"`:

    GET https://backend.aqaralmuhaysini.com/api/properties/list?page=N
        → {"status":"success","properties":[ …30… ],"statusChoices":{…},"countedIcons":{…}}
    GET https://backend.aqaralmuhaysini.com/api/properties/retrieve/<id>
        → {"status":"success","property":{…},"rentalUnits":{…},"mayBeLikes":[…]}

  THE WALK. 30 rows per page, 95 pages, 2,827 DISTINCT ids, in 33 s. There is NO total field, so
  completeness is the walk's own terminal condition: page 95 served 7 rows (< 30) and page 96 served
  an empty `properties` — measured, not assumed. Anything that ends the walk EARLY (a non-200, a
  page that repeats itself) leaves `complete=False` and nothing may be pruned.

  EVERY ROW CARRIES ITS FULL REGA LICENCE RECORD, `AdValidator.advertisement` — 2,827/2,827, all 44
  keys present on all of them. That block, not the platform's own columns, is where the prices are
  decided (trap 1). `AdValidator.isValid` is true and `property.status` is "available" on all 2,827:
  the list serves nothing else, so neither is read as a death signal.

  THE DETAIL FETCH IS NOT OPTIONAL. The list row has no `description`, no `halls`, no `furnished`,
  no `floorNumber`, no `meterPrice` and only a thumbnail. `description` is the ONLY place this
  platform can state a rent period (trap 3), so a list-only build would make rent_period NULL by
  construction rather than by the source's silence. Each row is therefore built from its own
  `retrieve/<id>` record merged over its list row. A detail fetch that FAILS degrades that one row
  to its list fields and is counted — it can never corrupt one, because every field the detail adds
  is absent-means-NULL.
  Because that fetch IS a direct read of this listing's own record, and the payload's own `id` is
  checked against the ad_number, the row carries db.mark_direct_alive().

  AND THAT ENDPOINT RATE-LIMITS — measured the hard way. A first pass at ~3.6 req/s with an
  immediate-retry loop drew HTTP 429 on 987 of the 2,827 calls (the SPA surfaces the same limiter as
  «The queue is busy now, please try again later», its error 1581). Yet 40 back-to-back requests for
  a single id drew ZERO 429s, so this is a sustained quota and not a per-request spacing rule: only
  waiting clears it. A second pass over exactly those 987, spaced REQUEST_GAP apart with a growing
  backoff, recovered them. So the retry sleeps (`_get_json`) and the loop spaces its calls; a
  retry loop without them burns its attempts inside the same throttled window and then reports a
  healthy source as broken. `Retry-After` is honoured when sent.

THE SEVEN TRAPS, ALL MEASURED
-----------------------------
1. THE PRICE FIELD MEANS DIFFERENT THINGS AND THE PLATFORM ITSELF GETS IT WRONG. This is the
   site's own hardest trap and it is worth ~10,000× on a real row.

   The REGA block publishes THREE price numbers: `propertyPrice`, `landTotalPrice` (sales) and
   `landTotalAnnualRent` (rents). For a REGA *land* ad `propertyPrice` is «سعر المتر» — a RATE.
   The site says so itself, in its own REGA-import code:

        this.price = t.landTotalPrice ? t.landTotalPrice : t.propertyPrice
        t.landTotalPrice && (this.propertyAdd.meterPrice = t.propertyPrice)

   i.e. WHEN a land total is published, `propertyPrice` IS the per-metre figure. That is the
   source's own marker, so `_land_total()` keys on it and never on a type word or a ratio.
   Measured over all 2,827: `landTotalPrice` on 925 rows (ALL for_sale, 917 «ارض» + 8 «ارض تجاري»),
   `landTotalAnnualRent` on 30 (ALL for_rent, 29 «ارض» + 1 «ارض تجاري»), never both, never on any
   other purpose — so the two are one clean signal, not a heuristic.

   THE PLATFORM'S OWN BUG, AND WHY IT MATTERS. That import checks `landTotalPrice` only, never
   `landTotalAnnualRent`. So on all 30 land RENTS the platform's own `price` column ends up holding
   the per-metre rate, and its card and its detail page both print it as the price:
        id 3590  price "51"    area 9,958 m²      landTotalAnnualRent 507,858
        id 3839  price "5.94"  area 84,252.99 m²  landTotalAnnualRent 500,462.76
   The listing's own description settles it — id 3590 writes «السعر: 507,858 ريال سعودي». Storing
   the platform's `price` as the rent would have published 51 riyals a year for a 9,958 m² plot.
   Both figures are source-published, so BOTH are stored verbatim: `price_per_meter` = 51,
   `price_annual` = 507,858. NOTHING is multiplied — `landTotalAnnualRent` equals propertyPrice ×
   area on 30/30, but the stored number is the published field, never the product.

   THE HEADLINE IS THE FIGURE THE DESTINATION PAGE PRINTS. On a non-land row the detail page's one
   «السعر الاجمالى» row renders `landTotalPrice || propertyPrice` — the REGA figure, NOT the
   platform's `price` column. The two disagree on 24 of 2,827 (0.85%): id 2379 (platform 900,000,
   REGA 1,150,000), id 24 (33,350 vs 35,000), the eight «عقار35» offices (32,500 vs 25,000). We
   store what the page the user opens actually shows, so a price we publish is never contradicted by
   the page we send them to. The platform's own string is kept verbatim in additional_info
   (`platform_price_raw`) and in source_capture, so the divergence is never lost, and it is raised
   as an open question.

   NOTHING IS EVER COMPUTED. No ×12, no ×365, no PPM×area, no rounding, no magnitude guess. An
   absent or non-numeric price is NULL. (Measured today: `propertyPrice` is present and non-zero on
   2,827/2,827 and no row publishes «السعر عند الطلب», so the NULL branch is guard, not path.)

2. RENT PERIOD = SOURCE, and the ONE period this platform states is a FIELD NAME.
   There is no period column anywhere: `rentalUnits` ({day,month,year}) is byte-identical on every
   record — a form enum, not a per-listing statement — and no `retrieve` key names a period.
     · A land rent's total is published in a field literally called `landTotalAnnualRent`. The
       source names the period; rent_period='annual' and the figure is stored unconverted.
     · Every other rent gets its period ONLY from its own title+description, through the shared
       audited normalize.rent_period_and_annual(). A period whose storage conversion would CHANGE the
       number must be corroborated, and the corroboration rule is NEAREST, not NEARBY: the figure we
       store has to be the CLOSEST number to the period word. 116 of the 600 rents carry a period
       token at all (سنوي 62, شهري 30, يومي 24 as the first token); 153 end up 'annual', 7 'monthly'
       and 440 UNKNOWN. Three measured reasons the loose version is not enough — the first draft used
       abaad's ±90-character window and got two of nine monthly rows WRONG by 12×:
           id 246   «خيارات تأجير : شهري - سنوي … شهريا 3000 … سنويا 36 ألف»  stored 25,000
                    two periods at once and neither printed figure is ours → UNKNOWN
           id 2403  «الايجار دفعتين : 35,000 الايجار الشهري : 3,300»          stored 35,000
                    35,000 is the ANNUAL rent in two instalments; the loose rule stored 420,000
           id 1834  «اجار شهري 5500 السنوي 65000»                             stored 65,000
                    5,500 is the monthly; the loose rule stored 780,000
       In all three the nearest number to «شهري» is the OTHER figure, so the period is UNKNOWN and
       the price stays exactly as published. The 7 genuine monthly rows have their stored figure 1-6
       characters from the token («الإيجار الشهري: 4000», «الايجار شهري ٤٠٠٠», «الإيجار: 3,000 ريال
       شهريًا»), including Arabic-Indic digits.
     · «يومي»/«أسبوعي» (24 rows' first token) never convert: the shared parser's (None, None) is
       deliberately NOT adopted, because this platform's price field is not labelled with a period —
       discarding the figure would hide a source-published price. rent_period NULL keeps those rows
       out of period-scoped rent search, which is what the NULL is for.
     · Silence → rent_period NULL and the price stored unconverted. Never annual by default.
       muhaysini is deliberately absent from SINGLE_PERIOD_PLATFORMS — the platform makes no
       site-wide statement, and its own UI prints no period beside a price at all.

3. `PropertyType.propertyFields` IS THE SOURCE'S OWN FIELD-APPLICABILITY DECLARATION — and without
   it every land row lies. The create form drives its inputs off exactly that list
   (`propertyFields.indexOf("roomsCount") != -1 && (this.showRoomsCount = true)`), so a field the
   list omits is one this type never asks and whose value in the payload is a table default, not an
   answer. Land id 3730 ships `bathrooms: 0, halls: 1, furnished: false` while its propertyFields
   are only ["plotNumber","meterPrice"]. Every count/flag is therefore gated on the type's own
   declaration, and a declared 0 is still read as unset because the card hides it
   (`t.roomsCount && t.bathrooms ? …`).

   THE GATE IS NOT ENOUGH ON ITS OWN — two fields are defaults even where the type DECLARES them,
   and both were caught by looking at the distribution rather than at one row:
     · `halls` is DECLARED on 1,039 of the 1,840 records fetched and holds 1 on 1,017 of them, 2 on
       four, 4 on one, 0 on two — and **-1** on one. A 97.9% constant with a negative outlier is a
       column default, and the detail page renders no halls row at all. So `halls` IS NOT STORED;
       the raw value is kept in additional_info as `source_halls_raw`.
     · `furnished` is DECLARED on 1,162 and is false on 1,018, true on 7, null on 137. 1,018:7 is
       not a market. Positive-only: true → True, and a declared false is NOT stored as False
       (ops_incident #154's fabricated-negative class, exactly). Raw value kept the same way.
   `bathrooms` needs no such exception: declared on 1,033 and 0 on 1,000 of them, which the 0-means-
   unset reading already nulls, leaving the 32 rows that state a real count.

4. THE TOP-LEVEL `age` IS A FOREIGN KEY, NOT A NUMBER OF YEARS — and reading it is silent. `age: 13`
   means «جديد» (brand new, age 0) and `age: 3` means «سنتان» (two years); the ids are an ORDER, not
   a magnitude. `normalize.parse_property_age(13)` dutifully returns 13, so a scraper that passes the
   int publishes "13 years old" for all 564 brand-new properties and nothing ever raises. The age is
   therefore read from the WORD — REGA's `propertyAge` («سنتين»), falling back to the detail record's
   own `Age.name` («سنتان») — both of which the shared parser covers (verified across all 14 values
   the platform publishes, including both dual forms).

5. `roomsCount` IS NOT BEDROOMS. Its label is «عدد الغرف» (total rooms) in both locales and on the
   rendered page, it is the REGA `numberOfRooms` verbatim (`this.roomsCount = t.numberOfRooms ?? 0`),
   and the string «غرف النوم» does not occur ANYWHERE in the application bundle — this platform
   publishes no bedroom count at all. `bedrooms` is therefore left NULL (aqarcity's owner decision,
   verbatim) and the figure is kept as `total_rooms` in additional_info.

6. PDPL. `advertisement.phoneNumber`, `responsibleEmployeePhoneNumber`, `responsibleEmployeeName`,
   `advertiserName`, `advertiserId`, `brokerageAndMarketingLicenseNumber`, the whole `adCreator`
   object (`{ownerType, User:{name, mobile, avatar}}` — a real broker record), `Agent`, `ownerId`
   and `AdValidator.qrLink` are NEVER read into a column, into additional_info, or into
   source_capture. Both JSONB payloads are built from explicit key ALLOWLISTS and then run through
   strip_pii_fields() as a second barrier, and every free-text field goes through redact_pii() HERE
   rather than leaning on db.redact_capture() — advertisers write their own numbers into the prose
   (id 132: «ارقام التواصل 0593477777 0558925557»). An allowlist rather than a blocklist because
   `adCreator.User` carries `name`, which redact_capture() deliberately does not treat as a contact
   channel (it must not eat licence-number-style regulatory keys).

7. AUCTIONS: NONE, and the guard stays. «مزاد» matches 0 of 2,827 titles and 0 of 2,827 descriptions.
   An ad that ever says it is skipped with a counted reason.

   OFF-PLAN: THIS SOURCE DOES NOT DISTINGUISH IT, SO THERE IS NO OFF-PLAN SKIP — and the reason is
   measured, not assumed. Nothing in the payload names a construction stage: `status` is a
   nine-value enum (available / sold / rented / reserved / stopped / under_review / rejected /
   waiting_payment / payment_issue) with no off-plan member, there is no completion percentage, no
   «البيع على الخارطة» flag, and no price RANGE anywhere (`price` is one figure on 2,827/2,827).

   A PROSE REGEX WAS WRITTEN, RUN OVER ALL 2,827 DESCRIPTIONS, AND THEN DELETED. «على الخارطة/الخريطة»,
   «تحت/قيد الإنشاء», a %-figure, «محجوز» and «مباع» matched 20 rows between them. Reading all twenty:
   SEVENTEEN are about something that is not this property, or not a construction stage at all.
       «نأمل مطابقة الموقع على الخريطة مع الموقع حسب الصك»    ← the platform's OWN boilerplate
       «الموقع على الخريطة: https://maps.app.goo.gl/…»        ← a Google Maps link (3 more rows)
       «مقابل مسجد تحت الإنشاء», «بجوار مسجد تحت الإنشاء»     ← a mosque opposite / next door
       «مقابل مشروع فرع جامعة طيبة (تحت الإنشاء)»             ← the university opposite
       «مدرسة قيد الإنشاء بالقرب من المشروع»                  ← a school nearby
       «بحيرة قيد الانشاء»                                    ← a lake being dug on a farm
       «3,100,000 ريال + 2.5% سعي»                            ← a commission, not a %-sold bar
       «البيع مع تقريبا 80 % من الأثاث»                       ← 80% of the FURNITURE
       «مكتمل بنسبة 70%», «من المالك مباشرة 100%»             ← finishing / ownership, not sold
       «الدور الأرضي *مباع* … الدور العلوي مساحة ١٨٥م»        ← one FLOOR of a multi-unit ad sold;
                                                                the ad itself is live (4 rows)
   THREE genuinely describe themselves as under construction — id 3220 («للبيع فيلا تحت الانشاء»),
   id 3697 («تحت الإنشاء – غير مكتملة») and id 2231 («من أول ما بدأنا نحفر.. بدأ الحجز … فلل تحت
   الانشاء») — and all three are published as ordinary `available` sales with full REGA licences.
   Even on its best pattern the regex is 3 right out of 9: shipping it would silently drop six ready
   properties to catch three, which is what "the SOURCE'S OWN marker, never a heuristic" forbids.
   All three ids are raised as an open question instead, so the owner decides with the evidence.

   DEAL TYPE is never guessed. `purpose` is for_sale on 2,226 / for_rent on 600 / `for_investment`
   on exactly one — an investment deal states neither sale nor lease, so it is skipped, never parked
   as a Buy. And one row publishes `purpose:"for_sale"` with the licence's `advertisementType:"إيجار"`:
   two source fields that contradict each other are not a deal type, so that row is skipped too
   rather than filed under either side.

REMOVAL ORACLE (measured 2026-09-24 — and the LISTING PAGE is worthless as one)
------------------------------------------------------------------------------
The site is a client-rendered SPA: /propertydetails/<id>, /robots.txt and /anything-at-all all
return the SAME 200 with the same 3,399-byte shell. An HTTP oracle on the listing URL would read
'live' for every id that has ever existed, including fabricated ones. So the oracle is the API
record the page itself loads.

    ids 10…4,071 exist; 2,827 are live and 1,235 ids inside that range are gone.
    14 of those gone ids, sampled at random, plus fabricated 0 / 4,200 / 999,999:
        17/17 → HTTP 400 {"status":"fail","error_number":229,"msg":"لم يتم العثور على العقار"}
    every live id → HTTP 200 with a `property` object whose own `id` matches.

    HTTP 400 AND error_number == 229          → gone   (17/17, zero counter-examples)
    HTTP 200 + property.id == the probed id   → live   (self-heal: absent from OUR crawl, not from
                                                        the platform)
    HTTP 200 + a DIFFERENT id, or no property → UNKNOWN (never someone else's evidence — the
                                                        sanadak lesson)
    anything else, incl. a bare 400          → UNKNOWN

The signal is keyed on the platform's OWN `error_number` 229, never on the bare status: a 400 from a
future schema change, a WAF or a query-shape rejection carries no opinion and must not kill a row.
The shared law in http_liveness handles the rest (a 403/429/5xx/empty body can never be a death) and
removals are additionally gated by an in-run positive control that fails CLOSED.

`advertisement.endDate` (the REGA ad-licence expiry, «06/11/2026») is NOT used as an oracle: all
2,827 parse and ZERO are in the past, so unlike abaad this platform gives no evidence that an
expired licence is what removes an ad. An unmeasured signal is not a signal.

PHOTOS. `mediaFiles[]` carries `thumbnail` (list + detail) and `filePath` (detail only), both
relative to https://backend.aqaralmuhaysini.com/uploads/. Three fetched → HTTP 200,
Content-Type image/jpeg, no CORP header, so they embed. 2,823/2,827 rows carry ≥1, max 3.
The full-size `filePath` is preferred and the thumbnail is the fallback.

COVERAGE (full live walk + all 2,827 detail records, 2026-09-24; reproduce with --dry-run)
------------------------------------------------------------------------------------------
2,827 served over 95 pages, complete=True → 2,819 MAPPED (2,621 residential + 198 commercial).
8 skipped and counted, every one a real source fact rather than a parser failure:
    city_not_in_catalog 6  (وادي الفرع 3, طلعه التمياط 2, الخبراء والسحابين 1 — catalog gaps)
    purpose_not_a_deal_for_investment 1   (id 695, «للبيع عمارة استثمارية مؤجرة بالكامل»)
    purpose_contradicts_licence 1         (id 554, for_sale + «إيجار»)
Deal split 2,219 Buy / 600 Rent. Types: Residential Land 940, Apartment 592, Villa 580, Floor 242,
Building 135, Rest House 128, Showroom 88, Office 35, Farm 18, Warehouse 16, Commercial Building 11,
Commercial Land 9, Gas Station 6, Room 4, Workshop 4, Studio 4, Hotel 2, Factory 2, Shop 1, Duplex 1,
Health Center 1.
  price_total 2,219 · price_annual 600 · price_per_meter 949 · rent_period 160 of 600 rents
  (153 annual incl. all 30 land rents + 7 monthly; 440 UNKNOWN) · area_m2 2,817
  license_number/license_expiry/ad_source/date_added/last_update/description/neighborhood 2,819
  photo_urls 2,816 · plan_parcel 2,761 · zip_code 2,684 · street_name 2,718 · additional_number 2,522
  district_ar 2,316 · direction 2,006 · street_width_m 1,965 · property_age 1,879
  building_number 1,817 · views_count 1,753 · furnished 210 (positive only) · bathrooms 34
  floor_number 22 · tenant_category 4
  electricity 2,608 · water_supply 2,161 · sanitation 1,448 · kitchen 1,108 · air_conditioner 344
  parking 334 · optical_fibers 322 · car_entrance 279 · elevator 253 · laundry_room 246
  maid_room 244 · driver_room 115 · private_entrance 102 · balcony_terrace 87 · extension 6
DELIBERATELY ZERO: bedrooms (trap 5), halls (trap 3), video_url and project_name (not published).

All 2,819 rows were also pushed through the REAL upsert guards (_sanitize_price,
_unknown_must_not_overwrite_known, _redact_user_visible_text, _sanitize_ints, _ensure_capture,
_reject_placeholder_location, _reject_unusable_listing_url, _apply_direct_alive) with zero errors and
zero fields nulled by the int sanitizer. ONE OPERATIONAL NOTE: because amenity columns are
positive-only, the batch is heterogeneous — 1,081 distinct key-sets across the 2,819 rows — and
`_wasalt_batch` deliberately upserts each key-set separately so PostgREST cannot NULL a column a row
never observed (the aqaratikom defect its docstring records). So a full run issues ~1,081 upsert
requests rather than two. That is the shared funnel's own trade and this scraper cannot reduce it
without emitting fabricated negatives, which is the thing the contract exists to prevent.

OPEN QUESTIONS FOR ONBOARDING (none of these are guessed in code)
-----------------------------------------------------------------
  · The 24 rows where the platform's `price` column disagrees with the REGA figure its own detail
    page prints. We publish the page's figure. Which does the owner consider the asking price — the
    broker's edited platform value, or the licensed REGA one?
  · The 30 land rents: the platform's own card and detail page print the per-metre RATE as the
    price. We publish the source's `landTotalAnnualRent` as the rent and the rate as
    price_per_meter, which is right but means our card and theirs show different numbers.
  · «غرف عزاب» (4 rows) → Room + tenant_category «عزاب» (alshawaf's «شقة عزاب» precedent). Confirm
    a bachelor-rooms unit is a Room and not a Building of rooms.
  · The eight «عقار35» office rows share `area` 1,837.7 (the whole building) while each description
    says «مساحته 100م2». area = SOURCE, so 1,837.7 is stored; prose never overrules a structured
    field. Worth raising with the platform.
  · «لايوجد خدمات» (231 rows) is a BLANKET negative naming no specific utility, so it sets no
    column False. Does the owner read it as an explicit NO for electricity/water/sanitation?
  · `latitude`/`longitude` are published on all 2,827 (and are real, not placeholders) but the
    listing tables carry no coordinate columns, so they are not stored.
  · ids 3220, 3697 and 2231 describe THEMSELVES as under construction in their own prose, and the
    platform publishes all three as ordinary `available` sales with full REGA licences. There is no
    source field to key an off-plan skip on (trap 7), so we publish them. If the owner wants such
    rows out, the platform has to be asked for a construction-stage field — a prose regex was
    measured at 3 right out of 9 on its best pattern and is not a substitute.
  · ids 2403 and 1834 print BOTH a monthly and an annual figure in their own prose while the
    structured field holds the annual («الايجار دفعتين : 35,000 … الشهري : 3,300»,
    «اجار شهري 5500 السنوي 65000»). We store the published figure with rent_period NULL. The
    listings ARE annual by their own words; confirming that reading would recover 2 periods.
  · 440 of 600 rents end with rent_period NULL because the source states nothing. muhaysini is
    deliberately NOT in SINGLE_PERIOD_PLATFORMS — if the owner can attest the platform is
    yearly-unless-stated (as they did for tamyaz), that registration is the one-line change.
  · «هاتف» (292 rows) and «تصريف الفيضانات» (240) are published utilities with no column of their
    own; they are kept as raw words in additional_info. Worth columns, or not?
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import city_ar_for, find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http import TRANSIENT_STATUSES  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://aqaralmuhaysini.com"
API = "https://backend.aqaralmuhaysini.com/api/properties"
PHOTO_BASE = "https://backend.aqaralmuhaysini.com/uploads/"
SOURCE = "أحمد المحيسني العقارية"
PREFIX = "MHS"
SLUG = "muhaysini"
PAGE_SIZE = 30
# 95 pages today. A bound is load-bearing because this API publishes NO total to stop against — see
# fetch_catalogue. Hitting it leaves complete=False, so a runaway can never prune.
MAX_PAGES = 400
# Spacing between `retrieve` calls. The endpoint rate-limits under sustained load (987/2,827 got
# HTTP 429 at ~3.6 req/s); override with MUHAYSINI_REQUEST_GAP.
REQUEST_GAP = float(os.environ.get("MUHAYSINI_REQUEST_GAP", "0.35"))

# The platform's own error_number for "this property does not exist" (17/17 on absent + fabricated
# ids). Keyed on the code, never on the bare 400 — see the removal-oracle section.
NOT_FOUND_ERRNO = 229

# `purpose` → our deal side. Anything else (today: `for_investment`, 1 row) is NOT a deal type and
# is skipped with a counted reason rather than guessed into Buy.
_DEAL = {"for_sale": "Buy", "for_rent": "Rent"}
# The REGA block's own word for the same thing. When the two source fields CONTRADICT each other the
# row is skipped: two disagreeing sources are not a deal type.
_DEAL_AR = {"بيع": "Buy", "إيجار": "Rent"}

# Trailing/embedded spaces are the platform's own («مجمع تجاري », «ورشة ») — stripped before lookup.
# Every value is an existing canonical fleet type, and every key that is not already in the shared
# TYPE_MAP_AR reuses another live scraper's decision rather than inventing one.
_TYPE_OVERRIDES = {
    "عمارة سكنية": "Building",              # aalbarrak / amaall / nufouth
    "مجمع تجاري": "Commercial Building",    # aqaratikom / dealapp / sadin / eilmalriyada
    "ارض تجاري": "Commercial Land",         # the platform's masculine-adjective spelling of
                                            # TYPE_MAP_AR's «أرض تجارية» (souq24: «ارض تجارية»)
    "محطة وقود": "Gas Station",             # amaall / dealapp / rawasidark / souq24
    "محل تجاري": "Shop",                    # aalbarrak
    "تاون هاوس": "Villa",                   # fleet fold Townhouse→Villa (justsa / aqalemhajer)
    "مستشفى - مركز صحي": "Health Center",   # aqargate's «مستشفى، مركز صحي»
    "غرف عزاب": "Room",                     # bachelor ROOMS: «غرف»→Room, «عزاب»→tenant_category
}
# The type words above whose own wording is also the source's tenant category. The column accepts
# exactly عوائل/عزاب (sync_search_listings_ar), same as moftah/alshawaf.
_TENANT_FROM_TYPE = {"غرف عزاب": "عزاب"}

# advertisement.propertyUtilities[] → the column the source's own word states. Positive-only: a
# utility the source omits is UNKNOWN, never False.
_UTILITY_COLS = {
    "كهرباء": "electricity",
    "مياه": "water_supply",
    "صرف صحي": "sanitation",
    "ألياف ضوئية": "optical_fibers",
}
# Published utilities with no column of their own; kept as raw words in additional_info.
# «لايوجد خدمات» (231 rows) is an explicit but BLANKET negative — it names no specific utility, so
# it sets nothing False (the abaad reading).

# `propertyFields` names the source declares for a type → the payload key it gates. A field the
# type's own list omits is never read: its value in the payload is a table default (trap 3).
_GATED = {
    "roomsCount": "roomsCount", "bathrooms": "bathrooms", "halls": "halls",
    "age": "age", "furnished": "furnished", "floorNumber": "floorNumber",
    "floorsCount": "floorsCount", "plotNumber": "plotNumber", "meterPrice": "meterPrice",
    "apartmentNumber": "apartmentNumber", "buildNumber": "buildNumber",
}

# Keys copied into additional_info / source_capture — an ALLOWLIST, so a PII key added upstream
# tomorrow cannot arrive by default (PDPL, trap 5). Deliberately EXCLUDES phoneNumber,
# advertiserName, advertiserId, responsibleEmployeeName, responsibleEmployeePhoneNumber,
# brokerageAndMarketingLicenseNumber, adCreator, Agent, ownerId and qrLink.
_CAPTURE_TOP = (
    "id", "purpose", "title", "price", "area", "status", "statusReason", "createdAt", "updatedAt",
    "views", "isFeatured", "roomsCount", "bathrooms", "halls", "furnished", "floorNumber",
    "floorsCount", "apartmentNumber", "buildNumber", "plotNumber", "meterPrice", "street", "age",
    "category", "saudiBuildingCode", "hasLawsuit", "hasObligations", "archivedAt", "deletedAt",
    "adDuration", "adDurationExpire", "description", "latitude", "longitude",
)
_CAPTURE_REGA = (
    "adLicenseNumber", "adLicenseUrl", "adSource", "advertisementType", "borders", "channels",
    "complianceWithTheSaudiBuildingCode", "creationDate", "deedNumber", "endDate",
    "guaranteesAndTheirDuration", "isConstrained", "isHalted", "isPawned", "isTestment",
    "landNumber", "landTotalAnnualRent", "landTotalPrice", "location",
    "locationDescriptionOnMOJDeed", "mainLandUseTypeName", "notes", "numberOfRooms",
    "obligationsOnTheProperty", "ownershipTransferFeeType", "planNumber", "propertyAge",
    "propertyArea", "propertyFace", "propertyPrice", "propertyType", "propertyUsages",
    "propertyUtilities", "redZoneTypeName", "rerBorders", "rerConstraints", "streetWidth",
    "titleDeedTypeName",
)
# Of those, the keys that carry PROSE — where an advertiser's own phone or WhatsApp link hides.
_FREE_TEXT = frozenset({"title", "description", "notes", "locationDescriptionOnMOJDeed",
                        "guaranteesAndTheirDuration"})

# «مزاد» is unambiguous in Saudi listing prose and the task's own hard rule, so the guard stays even
# though it matches 0 of 2,827 titles and 0 of 1,840 descriptions today.
#
# THERE IS DELIBERATELY NO OFF-PLAN REGEX HERE — see trap 6. A prose scan was MEASURED and is 90%
# false positives on this platform's own text, and the source publishes no construction-stage field
# to key on instead.
_AUCTION_RE = re.compile(r"مزاد")

# PropertyFeatures[].name → the column the source's own chip states. Positive-only. Only names whose
# meaning maps to exactly one column are listed; «صالة»/«مجلس» are COUNT columns and a chip is not a
# count, so they stay raw in additional_info.
_FEATURE_COLS = {
    "مصاعد": "elevator", "مصعد": "elevator",
    "مطبخ": "kitchen",
    "مكيف": "air_conditioner", "مكيف مركزي": "air_conditioner",
    "مواقف سيارات": "parking", "مواقف في القبو": "parking", "كراج خاص": "parking",
    "غرفة خادمة": "maid_room",
    "غرفة سائق": "driver_room",
    "مدخل خاص": "private_entrance",
    "ملحق": "extension",
    "كهرباء": "electricity", "مياه": "water_supply", "صرف صحي": "sanitation",
}

_WESTERN = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")     # impersonate OWNS the User-Agent
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7"})
    return s


def _clean(v) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


def _pos(v) -> Optional[int]:
    """A positive count/measure, or None. 0 and "" mean "not set" for every gated field here: the
    card hides the chip at 0 (`t.roomsCount && t.bathrooms ? …`), so 0 is not the source's answer."""
    n = normalize.to_int_numeric(v)
    return n if n and n > 0 else None


def _money(v) -> Optional[int]:
    """A source-published price figure → whole riyals, or None. Handles the platform's
    comma-formatted strings ("400,000"), JSON floats (507858.76 → 507858, truncated, never rounded
    up) and Arabic-Indic digits. NEVER computes: this only parses what the source printed.

    A parsed ZERO is None. `to_int(0)` returns 0, and 0 riyals is not a price — it is the shape a
    blank field takes in a numeric column. (0 of 2,827 rows publish one today, so this is a guard.)
    """
    if v is None:
        return None
    s = str(v).strip().translate(_WESTERN)
    return (normalize.to_int(s) or None) if s else None


_NUMBER_RE = re.compile(r"\d[\d,٬،.]*\d|\d")


def _nearest_number(text: str, at: int, end: int) -> tuple[Optional[int], Optional[int]]:
    """(the number NEAREST the period token occupying text[at:end), its distance in chars).

    Digits are already Western here, so offsets are intact; thousands separators are stripped only
    when a match is PARSED, never from the string, so nothing shifts.
    """
    best: Optional[int] = None
    best_d: Optional[int] = None
    for m in _NUMBER_RE.finditer(text):
        if m.start() >= at and m.end() <= end:
            continue                                  # digits inside the token itself
        d = at - m.end() if m.end() <= at else (m.start() - end if m.start() >= end else 0)
        if best_d is None or d < best_d:
            best, best_d = normalize.to_int(m.group(0)), d
    return best, best_d


def _period_describes_the_stored_figure(text: str, price: int, at: int, end: int) -> bool:
    """Is `price` the number the period token at [at:end) is actually ATTACHED to?

    THE RULE IS "NEAREST", NOT "NEARBY", and that distinction is measured. The first version asked
    whether `price` appeared anywhere within ±90 characters of the token — the abaad guard's shape —
    and on this platform's prose it corroborated the WRONG number twice out of nine:

        MHS2403  «الايجار دفعتين : 35,000 الايجار الشهري : 3,300»   stored 35,000
                 35,000 is the ANNUAL rent paid in two instalments; 3,300 is the monthly. Both sit
                 inside ±90 chars, so the loose rule accepted it and stored 420,000 — a 12×
                 OVERSTATEMENT of a 35,000-a-year listing.
        MHS1834  «اجار شهري 5500 السنوي 65000»                      stored 65,000
                 5,500 is the monthly, 65,000 is the annual the structured field already holds.
                 The loose rule stored 780,000.

    The number the period word is attached to is the CLOSEST one. Checked against all nine rows whose
    prose carries a converting period: the seven genuine monthly statements have the stored figure at
    distance 1-6 characters («الإيجار الشهري: 4000», «الايجار شهري ٤٠٠٠», «الإيجار: 3,000 ريال
    شهريًا»), and in both wrong rows the nearest number is the OTHER figure (3,300 and 5,500). The
    outer ±90 bound is kept as well, so a lone number far down the ad cannot corroborate anything.

    Still an EXACT integer match: «٣٦ ألف» is an approximation of 36,000, not a statement of it.
    """
    near, dist = _nearest_number(text, at, end)
    return near == price and dist is not None and dist <= 90


def _rent_fields(price: Optional[int], text: str) -> tuple[Optional[str], Optional[int]]:
    """(rent_period, price_annual) for a NON-land muhaysini rent — the platform's own hardest trap
    after the land rate.

    The stored figure carries NO period: the detail page prints it under a bare «السعر الاجمالى»
    with no qualifier, and the API has no period field at all (`rentalUnits` is byte-identical on
    every record). So the only possible period is one the listing's own prose states, read by the
    shared audited parser.

    BUT THE PROSE PERIOD DOES NOT ALWAYS DESCRIBE THAT FIGURE, and the mismatch is measured. id 246
    publishes 25,000 while its own description says «خيارات تأجير : شهري - سنوي … شهريا 3000 ألف
    ريال سنويا 36 ألف ريال»: it names TWO periods and neither of the two figures it prints is the
    one we store. The shared token regex finds «شهري» first, so handing that to the ×12 storage
    conversion would have stored 300,000 for a 25,000 listing.

    So a period whose storage conversion CHANGES the number must be corroborated: the period word has
    to be ATTACHED to the very figure we store — i.e. that figure is the NEAREST number to it, not
    merely one that appears nearby (see _period_describes_the_stored_figure, where the loose version
    of this rule was measured storing 420,000 for a 35,000 listing). Otherwise the period is UNKNOWN
    and the price is stored exactly as published — never inflated, never defaulted. 'annual' needs no
    corroboration because it converts nothing.
    """
    text = (text or "").translate(_WESTERN)     # offset-safe: the digit map is 1:1
    period, annual = normalize.rent_period_and_annual(price, text)
    if not period:
        # UNKNOWN period. The price is still the source's own published figure and is stored as
        # such. This deliberately does NOT adopt the shared parser's (None, None) for
        # يومي/أسبوعي/نصف سنوي/ربع سنوي: that contract exists for platforms whose price field IS
        # labelled with that period, and here it is not — so discarding the figure would hide a
        # source-published price on the strength of a word that may describe a different number.
        # rent_period NULL already keeps the row out of period-scoped rent search.
        return None, price
    if annual == price:
        return period, annual           # no conversion happened — nothing can have been distorted
    m = normalize._RENT_PERIOD_TOKEN_RE.search(text)
    if m and price is not None and _period_describes_the_stored_figure(
            text, price, m.start(), m.end()):
        return period, annual           # the prose attaches THAT period to THIS very figure
    return None, price                  # uncorroborated conversion → UNKNOWN period, price verbatim


def _rega(rec: dict[str, Any]) -> dict[str, Any]:
    v = rec.get("AdValidator") or {}
    return (v.get("advertisement") if isinstance(v, dict) else None) or {}


def _land_total(rega: dict[str, Any], deal: str) -> Any:
    """The REGA land total for this deal side, or None — the SOURCE'S OWN marker that its
    `propertyPrice` is «سعر المتر» rather than the whole price (trap 1). Measured: landTotalPrice
    only ever on for_sale (925 rows), landTotalAnnualRent only ever on for_rent (30), never both."""
    return rega.get("landTotalPrice") if deal == "Buy" else rega.get("landTotalAnnualRent")


def map_listing(rec: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) for ONE merged property record (its detail record over its list
    row). row is None exactly when a reason is set."""
    pid = _clean(rec.get("id"))
    if not pid:
        return None, "residential", "no_id"

    rega = _rega(rec)
    deal = _DEAL.get(_clean(rec.get("purpose")) or "")
    if not deal:
        return None, "residential", f"purpose_not_a_deal_{_clean(rec.get('purpose')) or 'blank'}"
    said_ar = _DEAL_AR.get(_clean(rega.get("advertisementType")) or "")
    if said_ar and said_ar != deal:
        # `purpose` and the REGA licence's own «بيع»/«إيجار» disagree (1 row). Two contradicting
        # source fields are not a deal type — never filed under either side.
        return None, "residential", "purpose_contradicts_licence"

    type_ar = _clean((rec.get("PropertyType") or {}).get("name"))
    key = re.sub(r"\s+", " ", type_ar).strip() if type_ar else None
    property_type = normalize.map_type_exact(key, _TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", f"type_unmapped_{type_ar or 'blank'}"
    category = normalize.category_for_type(property_type).lower()

    # BOTH free-text columns go through the redactor. The TITLE is not decoration: it is advertiser-
    # written prose on this platform («معرض رقم (2) للإيجار», «كود284 …»), so it can carry a phone
    # just as the description can. Redacting only the description is the exact leak the PDPL test
    # caught on the first draft — a poisoned «أرض للبيع - للتواصل 0542037990» reached row["title"].
    title = redact_pii(_clean(rec.get("title")))
    desc = redact_pii(_clean(rec.get("description")))
    prose = " ".join(filter(None, (title, desc)))
    if _AUCTION_RE.search(prose):
        return None, category, "auction"

    loc = rega.get("location") if isinstance(rega.get("location"), dict) else {}
    # The platform's own City relation first. When it is NULL the REGA licence's own `location.city`
    # is used — that is the source stating the city in a different field, not an inference: id 575
    # ships `City: null, Neighborhood: null` while its licence publishes city «الرياض», district
    # «الصفاء» and a districtCode. Skipping it as no_city would discard a listing whose location the
    # government record fully specifies. (1 of 2,827 today; 1 of 1 such rows is recoverable.)
    city_ar = _clean((rec.get("City") or {}).get("name")) or _clean(loc.get("city"))
    if not city_ar:
        return None, category, "no_city"
    # A region HINT, used ONLY to disambiguate same-named cities across regions. The REGA block's
    # spelling comes FIRST and that ordering is the whole point: it writes «منطقة القصيم», which is
    # what loc_catalog_region stores, while the platform's own `Region.name` is the BARE «القصيم»,
    # which `_hint_to_id` cannot resolve (it strips a «منطقة » prefix, it never adds one). Passing
    # the bare form first left 30 real rows unresolved as city_not_in_catalog — البدائع and المجمعة
    # are genuine twins (Hail/Qassim and Riyadh/Makkah/Asir) that only a hint can separate.
    hint = _clean(((rega.get("location") or {}) if isinstance(rega.get("location"), dict) else {})
                  .get("region")) or _clean((rec.get("Region") or {}).get("name"))
    city_id, region_id = to_catalog(city_ar, hint)
    if not city_id:
        return None, category, "city_not_in_catalog"
    # NEVER from the title: id 3730's title says «المدينة المنورة» while its City, its REGA
    # location and its own description all say «أحد رفيدة» (Asir). The structured field wins and the
    # title is not consulted for location at all.
    district_raw = (_clean((rec.get("Neighborhood") or {}).get("name"))
                    or _clean(loc.get("district")))       # same fallback, same reason as the city
    district_ar = find_district_in_text(district_raw, city_id)

    # ── The source's own field-applicability declaration (trap 3) ────────────────────────────────
    declared = {str(f) for f in ((rec.get("PropertyType") or {}).get("propertyFields") or [])}

    def gated(field: str):
        return rec.get(_GATED[field]) if field in declared else None

    # ── PRICE. Both figures are source-published; neither is ever derived from the other. ────────
    land_total = _land_total(rega, deal)
    if land_total is not None:
        ppm = _money(rega.get("propertyPrice"))          # «سعر المتر» — a RATE
        headline = _money(land_total)                    # the source's own published total
        ev_field = "AdValidator.advertisement." + ("landTotalPrice" if deal == "Buy"
                                                   else "landTotalAnnualRent")
        ev_raw = land_total
    else:
        # Exactly what the detail page's one «السعر الاجمالى» row renders for a non-land ad.
        headline = _money(rega.get("propertyPrice"))
        ev_field, ev_raw = "AdValidator.advertisement.propertyPrice", rega.get("propertyPrice")
        if headline is None:
            # The licence published no readable price. The platform's own column is the other
            # source-published figure and is what its card shows; price_evidence names which was
            # read, so the two can never be confused. (0/2,827 rows take this branch today.)
            headline = _money(rec.get("price"))
            ev_field, ev_raw = "property.price", rec.get("price")
        ppm = _money(gated("meterPrice"))                # the platform's own «سعر المتر» field

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": f"{BASE}/propertydetails/{pid}",
        "source": SOURCE,
        "active": True,
        "title": title,
        "description": desc,
        **normalize.amenities_from_text(desc),
        "property_type": property_type,
        # `deal` is already provably 'Buy' or 'Rent' — anything else was skipped above with a
        # counted reason. Written as a two-literal expression so the value can never be anything
        # else even in principle.
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar) or normalize.map_city(city_ar_for(city_id) or ""),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _pos(rec.get("area")),
        # `bedrooms` is DELIBERATELY ABSENT — «عدد الغرف» is a total-room count and this platform
        # publishes no bedroom figure at all (trap 4).
        "bathrooms": _pos(gated("bathrooms")),
        # `halls` is DELIBERATELY ABSENT — it is a table default, not an answer (trap 3).
        "floor_number": _pos(gated("floorNumber")),
        "building_number": _clean(gated("buildNumber")),
        "street_name": _clean(rec.get("street")),
        # NEVER the top-level `age`: it is a FOREIGN KEY, not a year count (trap 7).
        "property_age": normalize.parse_property_age(
            _clean(rega.get("propertyAge")) or _clean((rec.get("Age") or {}).get("name"))),
        "street_width_m": normalize.one_street_width(_pos(rega.get("streetWidth"))),
        # REGA's «شرقية»-style cell first (it also carries the diagonals); the platform's own
        # single-choice ExchangeFront («شرق») covers the 21% where REGA's cell is blank.
        "direction": (normalize.one_direction(rega.get("propertyFace"), diagonal=True)
                      or normalize.one_direction((rec.get("ExchangeFront") or {}).get("name"),
                                                 diagonal=True)),
        "views_count": _pos(rec.get("views")),
        "plan_parcel": _clean(gated("plotNumber")) or _clean(rega.get("landNumber")),
        "license_number": _clean(rega.get("adLicenseNumber")),
        "license_expiry": _clean(rega.get("endDate")),
        "ad_source": _clean(rega.get("adSource")),
        "rega_location_verified": bool(_clean(rega.get("adLicenseNumber"))),
        "date_added": _clean(rec.get("createdAt")),
        "last_update": _clean(rec.get("updatedAt")),
        "price_per_meter": ppm,
        "photo_urls": _photos(rec),
    }
    if _clean(loc.get("postalCode")) and _clean(loc.get("postalCode")) != "00000":
        row["zip_code"] = _clean(loc.get("postalCode"))
    if _clean(loc.get("additionalNumber")) and _clean(loc.get("additionalNumber")) != "0000":
        row["additional_number"] = _clean(loc.get("additionalNumber"))
    if key in _TENANT_FROM_TYPE:
        row["tenant_category"] = _TENANT_FROM_TYPE[key]
    # POSITIVE ONLY. A declared `furnished: false` is NOT stored as False: among the types that DO
    # declare the field it is false on 1,018 rows, true on 7 and null on 137 — a 1,018:7 split is a
    # table default being submitted, not a market, and the detail page renders no furnished row at
    # all. Manufacturing 1,018 confident "not furnished" is exactly ops_incident #154.
    if "furnished" in declared and rec.get("furnished") is True:
        row["furnished"] = True
    # Positive-only: a utility the source names is True, one it omits stays NULL. «لايوجد خدمات» is
    # a BLANKET negative naming no utility, so it sets nothing.
    utilities = [w for u in (rega.get("propertyUtilities") or [])
                 if (w := _clean(u if isinstance(u, str) else (u or {}).get("name")))]
    features = [w for f in (rec.get("PropertyFeatures") or [])
                if (w := _clean(f if isinstance(f, str) else (f or {}).get("name")))]
    for w in utilities:
        if w in _UTILITY_COLS:
            row[_UTILITY_COLS[w]] = True
    for w in features:
        if w in _FEATURE_COLS:
            row[_FEATURE_COLS[w]] = True

    # THE OPPOSITE DEAL SIDE IS AUTHORITATIVELY EMPTY, not merely unread. `purpose` is the source
    # stating which side this ad is on, so a sale HAS no annual rent and a rent HAS no sale total.
    # Plain None would be DROPPED by db._unknown_must_not_overwrite_known(), so a listing the broker
    # re-published on the other side would keep its old figure and end up carrying both prices at
    # once. The sentinel is the house mechanism for "the source settled this" (arkaan's «السعر عند
    # الطلب» rows use it the same way).
    if deal == "Rent":
        row["price_total"] = db.AUTHORITATIVE_NULL
        if land_total is not None:
            # The SOURCE names the period: the field is `landTotalAnnualRent`. Stored unconverted.
            row["rent_period"], row["price_annual"] = "annual", headline
        else:
            period, row["price_annual"] = _rent_fields(headline, prose)
            if period:
                row["rent_period"] = period
    else:
        row["price_total"] = headline
        row["price_annual"] = db.AUTHORITATIVE_NULL
        row["rent_period"] = db.AUTHORITATIVE_NULL
    row["price_evidence"] = normalize.price_evidence(
        field=ev_field, raw=ev_raw,
        stored=row.get("price_total") if deal == "Buy" else row.get("price_annual"),
        kind="total" if deal == "Buy" else (row.get("rent_period") or "annual"),
        unit="total", origin="api", authoritative_absent=False)
    row["images_evidence"] = {"observed": True, "container_present": "mediaFiles" in rec,
                              "key_present": bool(rec.get("mediaFiles")),
                              "count": len(row["photo_urls"] or [])}

    info = {
        "source_id": pid, "type_ar": type_ar,
        "source_category": _clean((rec.get("PropertyType") or {}).get("category")),
        "property_fields_declared": sorted(declared) or None,
        "region_ar": hint,
        # The platform's own price column, verbatim — it disagrees with the REGA figure the detail
        # page prints on 24 rows, and on all 30 land rents it holds the per-metre rate (trap 1).
        "platform_price_raw": _clean(rec.get("price")),
        "source_property_price_raw": rega.get("propertyPrice"),
        "source_land_total_price_raw": rega.get("landTotalPrice"),
        "source_land_total_annual_rent_raw": rega.get("landTotalAnnualRent"),
        "source_meter_price_raw": rec.get("meterPrice"),
        "price_is_per_meter": (land_total is not None) or None,
        "source_area_raw": _clean(rec.get("area")),        # exact m², before area_m2's INTEGER round
        "total_rooms": _pos(gated("roomsCount")) or _pos(rega.get("numberOfRooms")),  # «عدد الغرف»
        "floors_count": _pos(gated("floorsCount")),
        "apartment_number": _clean(gated("apartmentNumber")),
        "source_halls_raw": gated("halls"),     # a table default, not a count — see trap 3
        "source_furnished_raw": rec.get("furnished") if "furnished" in declared else None,
        "utility_words": utilities or None,
        "feature_words": features or None,
        "deed_number": _clean(rega.get("deedNumber")),
        "plan_number": _clean(rega.get("planNumber")),
        "title_deed_type": _clean(rega.get("titleDeedTypeName")),
        "main_land_use": _clean(rega.get("mainLandUseTypeName")),
        "red_zone_type": _clean(rega.get("redZoneTypeName")),
        "ad_licence_url": _clean(rega.get("adLicenseUrl")),
        "ad_channels": rega.get("channels") or None,
        "is_pawned": rega.get("isPawned"),
        "is_constrained": rega.get("isConstrained"),
        "is_halted": rega.get("isHalted"),
        "saudi_building_code": rega.get("complianceWithTheSaudiBuildingCode"),
        "borders": rega.get("borders") or None,
        "source_status": _clean(rec.get("status")),
        "ad_duration_expire": _clean(rec.get("adDurationExpire")),
        "mode_deed_location": redact_pii(_clean(rega.get("locationDescriptionOnMOJDeed"))),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v is not None})
    row["source_capture"] = strip_pii_fields({
        "schema": "muhaysini.retrieve+list.v1",
        **{k: (redact_pii(rec[k]) if k in _FREE_TEXT else rec[k])
           for k in _CAPTURE_TOP if k in rec},
        "advertisement": {k: (redact_pii(rega[k]) if k in _FREE_TEXT else rega[k])
                          for k in _CAPTURE_REGA if k in rega},
    })
    return row, category, ""


def _photos(rec: dict[str, Any]) -> Optional[list[str]]:
    """Full-size `filePath` when the record carries one, else the `thumbnail` the list serves.
    Verified: 3 fetched → HTTP 200, image/jpeg, no CORP header."""
    out = []
    for m in rec.get("mediaFiles") or []:
        if not isinstance(m, dict):
            continue
        p = _clean(m.get("filePath")) or _clean(m.get("thumbnail"))
        if p:
            out.append(PHOTO_BASE + p.lstrip("/"))
    return out or None


# ── FETCH ────────────────────────────────────────────────────────────────────────────────────────
def _get_json(s: cc.Session, url: str, *, what: str, tries: int = 4) -> Any:
    """One JSON GET with BACKOFF — measured, not decorative.

    THE DETAIL ENDPOINT RATE-LIMITS. A first full walk at ~3.6 req/s drew HTTP 429 on 987 of 2,827
    `retrieve` calls (the SPA shows the same limiter as «The queue is busy now, please try again
    later», error 1581), while 40 back-to-back requests for one id drew none — so it is a sustained
    quota, not a per-request spacing rule, and only waiting clears it. A retry loop with no sleep
    (the first version of this function) burns its attempts inside the same throttled window and
    reports the source as broken. Hence REQUEST_GAP between calls and a growing sleep between
    attempts.
    """
    r = None
    for attempt in range(tries):
        r = s.get(url, timeout=45)
        if r.status_code not in TRANSIENT_STATUSES:
            break
        # Honour the server's own Retry-After when it sends one, else back off progressively.
        wait = normalize.to_int_numeric(r.headers.get("Retry-After")) or 0
        time.sleep(min(max(wait, 3 * (attempt + 1)), 30))
    if r is None or r.status_code != 200:
        raise RuntimeError(f"{what} returned {getattr(r, 'status_code', 'no response')}")
    try:
        body = r.json()
    except ValueError as exc:
        raise RuntimeError(f"{what} is no longer JSON: {exc}") from exc
    if not isinstance(body, dict):
        raise RuntimeError(f"{what} is {type(body).__name__}, not the expected object")
    return body


def fetch_catalogue(s: cc.Session, limit: int = 0) -> tuple[list[dict], bool]:
    """Every list row, plus whether the walk ran to its own natural END.

    There is no total field, so completeness IS the terminal condition: a page that serves fewer
    than PAGE_SIZE rows, or none at all, is the last one. Only a walk that got there may prune —
    an early stop (a page that repeats itself, MAX_PAGES, a --limit) returns complete=False.

    THE CAP MATTERS HERE PRECISELY BECAUSE THERE IS NO `total`. abaad can stop when its own
    total_size is satisfied; this source cannot, so the only things that end the walk are a short
    page, an empty page, and an exact repeat. A rolling or cycling window would add ids forever and
    a nightly job would never return. MAX_PAGES is ~4x today's 95 pages and fails CLOSED: hitting it
    leaves complete=False, so nothing is pruned on a runaway.
    """
    rows: dict[str, dict] = {}
    page = 1
    complete = False
    while page <= MAX_PAGES:
        body = _get_json(s, f"{API}/list?page={page}", what=f"{API}/list page {page}")
        batch = [p for p in (body.get("properties") or []) if isinstance(p, dict)]
        if not batch:
            complete = True                 # ran off the end of the catalogue
            break
        before = len(rows)
        for p in batch:
            if key := _clean(p.get("id")):
                rows[key] = p
        if len(rows) == before:
            break                           # page repeated itself — stop, and do NOT claim complete
        if limit and len(rows) >= limit:
            return list(rows.values())[:limit], False
        if len(batch) < PAGE_SIZE:
            complete = True                 # a short page is the last page
            break
        page += 1
    items = list(rows.values())
    if not complete and page > MAX_PAGES:
        print(f"  ⚠ walk stopped at the {MAX_PAGES}-page cap without reaching the end of the "
              f"catalogue — nothing will be pruned", flush=True)
    print(f"{SOURCE}: {len(items)} listings over {min(page, MAX_PAGES)} page(s); "
          f"complete={complete}", flush=True)
    return items, complete


def fetch_detail(s: cc.Session, pid: str) -> Optional[dict]:
    """This listing's OWN record, or None. None degrades the row to its list fields (and is
    counted) — every field the detail adds is absent-means-NULL, so it can never corrupt one."""
    try:
        body = _get_json(s, f"{API}/retrieve/{pid}", what=f"{API}/retrieve/{pid}")
    except RuntimeError:
        return None
    p = body.get("property")
    # The payload must be THIS listing (the sanadak lesson): another listing's record is not
    # evidence about this one, and it must never become this row's content or its alive stamp.
    return p if isinstance(p, dict) and _clean(p.get("id")) == pid else None


# ── LIVENESS (measured 2026-09-24; the SPA page is 200 for every id, so the API is the oracle) ────
def _signal(status, body, _moved) -> Optional[str]:
    """'live' | 'gone' | None — the platform's AFFIRMATIVE signals only; the law does the rest.

    Keyed on the source's OWN `error_number` 229 «لم يتم العثور على العقار» (17/17 on absent and
    fabricated ids), never on the bare 400: a 400 from a future schema change, a WAF or a rejected
    query shape says nothing about the listing.
    """
    import json as _json
    try:
        parsed = _json.loads(body or "")
    except (ValueError, TypeError):
        return None
    if not isinstance(parsed, dict):
        return None
    if status == 400:
        return "gone" if parsed.get("error_number") == NOT_FOUND_ERRNO else None
    if status != 200:
        return None
    p = parsed.get("property")
    # A 200 is only life when the record it carries is THIS listing's.
    return "live" if isinstance(p, dict) and p.get("id") is not None else None


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None):
        pid = ad_number[len(PREFIX):] if ad_number.startswith(PREFIX) else ""
        if not pid:
            return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"

        def signal(status, body, moved):
            said = _signal(status, body, moved)
            if said != "live":
                return said
            # Someone else's record is not this row's evidence.
            try:
                import json as _json
                return "live" if str((_json.loads(body).get("property") or {}).get("id")) == pid else None
            except Exception:  # noqa: BLE001 — an unparseable body is no opinion
                return None

        return LivenessProbe(platform=SLUG, signal=signal, session=session,
                             url_for=lambda _ad: f"{API}/retrieve/{pid}",
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
    detail_misses = 0
    try:
        items, complete = fetch_catalogue(s, limit=args.limit)
        if not items:
            raise RuntimeError(f"{API}/list returned no properties")
        for n, listed in enumerate(items, 1):
            pid = _clean(listed.get("id"))
            if n > 1:
                time.sleep(REQUEST_GAP)     # the retrieve endpoint's measured sustained quota
            detail = fetch_detail(s, pid) if pid else None
            if detail is None:
                detail_misses += 1
            rec = {**listed, **(detail or {})}
            row, cat, why = map_listing(rec)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if detail is not None:
                # A DIRECT read of this listing's own record, confirmed to be THIS ad_number.
                db.mark_direct_alive(row, oracle="muhaysini.api.properties.retrieve")
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            if n % 500 == 0:
                print(f"  … {n}/{len(items)} mapped={len(res) + len(com)}", flush=True)
        notes = _tally(skipped)
        if skipped:
            print("  skipped (not guessed): " + notes)
        if detail_misses:
            print(f"  ⚠ {detail_misses} row(s) built from the list alone (detail fetch failed)")
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            def _p(v):      # the opposite deal side is AUTHORITATIVE_NULL; print it as a dash
                return "-" if v is None or isinstance(v, type(db.AUTHORITATIVE_NULL)) else v

            for r0 in (res + com)[:20]:
                print(f"   {r0['ad_number']:>9} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):18} {str(r0['city_ar']):14} "
                      f"d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>8} "
                      f"ba={str(r0.get('bathrooms')):>4} pt={_p(r0.get('price_total'))} "
                      f"pa={_p(r0.get('price_annual'))} ppm={_p(r0.get('price_per_meter'))} "
                      f"rp={_p(r0.get('rent_period'))} sw={r0.get('street_width_m')} "
                      f"ag={r0.get('property_age')} ph={len(r0.get('photo_urls') or [])}")
            return 0
        # The public upsert_muhaysini_*_batch wrappers are added centrally at onboarding; same funnel.
        db._wasalt_batch("muhaysini_residential_listings", res)
        db._wasalt_batch("muhaysini_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="muhaysini_residential_listings", com_table="muhaysini_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in (("muhaysini_residential_listings", res),
                              ("muhaysini_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        elif args.type == "all":
            print("  prune skipped: the walk did not reach the end of the catalogue")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(items),
                             rows_upserted=len(res) + len(com),
                             notes=(f"pruned={pruned} complete={complete} "
                                    f"detail_misses={detail_misses} {notes}")[:300],
                             check_tables=["muhaysini_residential_listings",
                                           "muhaysini_commercial_listings"])
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
