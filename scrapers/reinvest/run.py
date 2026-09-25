"""ري إنفست (Reinvest) — reinvest.sa. 813 listings, onboarding 2026-09-24.

SOURCE SHAPE (measured live 2026-09-24; every number below was captured, not assumed).
A Next.js App-Router front end over a public Laravel API. No auth, no cookie, no proxy, plain
`impersonate="chrome"`. The rendered pages are NOT the source — see THE STALE-PAGE TRAP.

    GET  https://api.reinvest.sa/api/v1/real-estate?per_page=<N>&page=<N>   → the roster
         {"data":[…], "links":{"next": …}, "meta":{"current_page","per_page","from","to"}}
    GET  https://api.reinvest.sa/api/v1/real-estate/<slug>                  → one listing
         {"status":200,"message":"تم تحميل البيانات بنجاح","data":{…}}

  `per_page` IS UNCAPPED. VERIFIED: 10/50/100/200/500/3000 all honoured exactly, and per_page=3000
  served the whole catalogue in ONE response (813 rows, 7.3 s, `links.next` null). The walk still
  follows `links.next` rather than trusting one big page, because `meta` carries NO `total`/
  `last_page` (Laravel simplePaginate) — so "the walk ended" is the only thing the roster itself
  says about completeness, and that is not enough to delete on (see COMPLETENESS).

  813 = 577 rent (`the_sub_type_of_ad` 18) + 236 sale (17). Both halves matched the website's own
  counter exactly on the same day.

  A ROSTER PAGINATION RACE IS REAL. Two per_page=500 pages (500 + 313) and one per_page=3000 page
  returned the SAME 813 slugs, so nothing raced on this capture — but the endpoint offers no cursor,
  so rows are deduped by `slug` and a page that repeats itself stops the walk.

  THE KEYS. `slug` ("shk-llaygar-107"), `id` (4786), `ad_number` (REGA «رقم الإعلان», 9463824700)
  and `license_number` (REGA «رقم ترخيص الإعلان», 7201057130) are each unique 813/813. `ad_number`
  is the stored business key because it is the REGA identity and survives the platform re-slugging
  a listing; `slug` is the API's address and is carried in `additional_info` + `listing_url`.
  `authorization_no` is NOT a fourth key: null on 437 rows and equal to `license_number` on the
  other 376, so it is archived, never stored as a licence.

  LISTING URL. Built from the source's OWN slug fields:
      {BASE}/{the_sub_type_of_ad_slug}/{real_state_type_slug}/{usage}/{city_slug}/{district}/{slug}
  where `usage` is «تجاري»→commercial / «سكني»→residential / absent→"explore" read off `main_usage`,
  and `district` falls back to the literal "district" when `district_slug` is empty (33 rows).
  VERIFIED AGAINST THE SITE'S OWN <a href>: of the 763 listings that appeared on a walked
  /for-rent|/for-sale/properties/explore/ksa page, the constructed path equals the site's own link
  763/763, zero mismatches. (The detail payload ALSO has a `usage_slug`, but it is "commercial" on
  all 813 — like `usage`, which is «تجاري» on all 813 — and reproducing the site's link with it
  fails on 282 of the 763. `main_usage` is the field the site itself routes on.)
  Five URLs opened: all 200 and each carried ITS OWN ad_number, license_number AND price
  (msnaa-llbyaa-5, ard-llbyaa-1741, maard-llaygar-323, astrah-llaygar-157, aamar-llaygar-183).
  Only the final segment addresses the listing: /…/wrong-district/shk-llaygar-107 and
  /for-SALE/…/shk-llaygar-107 both still serve 4786, while /…/xxxxx-107 is a hard 404. The
  canonical path is stored anyway — a tolerant variant is not the link the site publishes.

  PHOTOS. `images_info[]` gives {url, type} with absolute Oracle-Cloud (me-riyadh-1) URLs;
  present on 813/813 (median 3, max 10+). Four fetched → HTTP 200, Content-Type image/webp,
  matching each row's own declared `type`, no CORP/embedding header.
  VIDEO. `video` holds an absolute .mp4 on 33 rows; one fetched → 200, video/mp4, 4.2 MB. Unlike
  abaad's bare filenames these resolve, so `video_url` is populated.

THE STALE-PAGE TRAP (why the HTML is not the source, and not the oracle)
-----------------------------------------------------------------------
The public /for-rent|/for-sale pages are ISR-cached by Next.js and SERVE DEAD LISTINGS AT 200 WITH
FULL CONTENT. Measured: of four ads that left the catalogue during the capture window, the API
answers 404 «هذا الاعلان لم يعد متوفر» for all four, while THREE of them still render a complete
200 HTML page (270 KB / 310 KB / 285 KB) and only one 404s. An "is the page 200?" oracle would
therefore never retire anything, and reading listing data off the page can serve a corpse's specs.
Everything below reads the API. The site's counter is used for ONE thing only — see COMPLETENESS.

The rendered page also carries a resolved `info_fields_label` table the API does not expose
(«تاريخ إنتهاء رخصة الإعلان», «رقم القطعة», «رقم المخطط»). Those two real columns — `license_expiry`
and `plan_parcel` — are consequently NULL here. Fetching 813 × ~300 KB of RSC payload per run to
recover two fields, through a regex over an undocumented Next.js flight stream, buys less than it
costs; it is raised as an open question instead. Nothing is guessed in their place.

THE TRAPS, ALL MEASURED
-----------------------
1. `selling_meter_price` IS THE PLATFORM'S OWN ARITHMETIC, NOT A PUBLISHED RATE. It is present on
   813/813 rows — on flats, offices and warehouses, not just land — which is the first clue that it
   is not a seller's per-metre quote. It is exactly

        selling_meter_price == floor(price / int(total_area))        813 of 813, ZERO exceptions

   (checked against four candidate formulas; that one matches every row). So it is `price` divided
   by the area and truncated — lossy in one direction and derived in the other.
   `price_per_meter` IS THEREFORE NEVER SET. This is the aqargate ruling applied in reverse:
   aqargate's `landTotalPrice` equalled rate × area and must not be adopted as a price; reinvest's
   `selling_meter_price` equals price ÷ area and must not be adopted as a rate. Storing it would put
   a truncated quotient into a price column, and on the 142 «أرض» rows it would look authoritative.
   The single source-published figure is `price`, stored verbatim as the total (Buy) or the rent.

   The detail page's own «سعر المتر» cell is the same derivation carried one step further (it prints
   the unrounded quotient: 46.956 on a 54,000 / 1,150 m² flat), and its «سعر الوحدة» cell is just
   `price` on a non-land row and `selling_meter_price` on a land row — a DISPLAY choice, not a
   second published number. Neither cell is read.

2. RENT PERIOD = SOURCE, AND THE PROSE OFTEN DESCRIBES A DIFFERENT NUMBER. There is no period field
   anywhere: all 18 `info_fields` keys, `property_purpose`, `type_purpose` and
   `the_sub_type_of_ad_label` were enumerated over 813 rows and the only statement any of them makes
   is «إيجار». `current_rent_price` (4 rows) is a let property's EXISTING rent and `remaining_month`
   (4 rows) its remaining term; neither is the ad's price and neither is read as a period.
   So the period can only come from the listing's own words, through the shared audited
   normalize.rent_period_and_annual() — and on this platform that token is frequently NOT about the
   stored figure. Of the 577 rents, 128 carry a period token:

     · 48 say «سنوي». Storing 'annual' converts nothing, so no number can move → taken as published.
     · 80 say «شهري», and ×12 would change the stored number on every one of them. Inspected: the
       structured `price` is USUALLY ALREADY THE ANNUAL FIGURE and the prose names the monthly
       instalment — shk-llaygar-107 publishes price 54000 beside «الايجار 4500 ريال شهري»
       (4500 × 12 = 54000); shk-llaygar-87 publishes 48000 beside «4000 ريال شهري». Converting
       those would have stored 648,000 and 576,000. But NOT always: shk-llaygar-103 publishes
       price 3000 beside «الايجار يبدء من 3000 شهري» — there the field really is a monthly rate
       and the source says so.
   A converting period is therefore only honoured when the prose prints THE VERY FIGURE the price
   field holds, beside that period word, and nothing else in that window contradicts it. Result:
   21 monthly (audited one by one — every figure is 1,800–4,500 SAR for a room/studio/floor, a
   plausible monthly rent and an absurd annual one), 48 annual, 508 UNKNOWN with the price stored
   exactly as published. Rejected and counted: 53 «figure not beside the token», 3 «two different
   periods in one ad» («للإيجار الشهري والسنوي»), 3 «payment split, not a lease term»
   (shk-llaygar-190: «قيمة الإيجار: 40,000 ألف دفعة أو دفعتين أو شهري» — one payment, two, or
   monthly instalments of the same 40,000). reinvest is deliberately ABSENT from
   SINGLE_PERIOD_PLATFORMS: the platform makes no site-wide period statement of any kind.

   508 rents with no period stay out of period-scoped rent search. That is the correct behaviour
   (owner rule 2026-09-21, unstated period stays out), not a gap to be filled.

3. «يومية» IS USUALLY NOT A DAILY RATE, AND THE SHARED PARSER WOULD DISCARD THE PRICE. 28 rent rows
   contain a يومي token, and in every one inspected it is a SERVICE description — «ضيافة يومية»
   (daily hospitality), «نظافة يومية» (daily cleaning), «الخدمات … اليومية» — on serviced-office and
   building ads. normalize.rent_period_and_annual() returns (None, None) for يومي/أسبوعي/نصف سنوي/
   ربع سنوي, which is right for a platform whose price field IS labelled with that period, but here
   it would NULL a real source-published price on all 28 rows on the strength of a word about
   cleaning. So an unparsed period keeps the price: (None, price). abaad reasoned its way to this
   rule with no row that hit the branch; reinvest supplies the 28 rows that prove it.
   (Mutation-verified — see test_reinvest_price_and_period.py.)

4. NO AUCTIONS, NO OFF-PLAN, NO CO-WORKING — the source separates them itself, and the code reads
   its separation rather than a heuristic.
     · Auctions are a DIFFERENT ENTITY: /auctions/ksa/explore + `GET /api/v1/auctions`, with their
       own `auctionId`, their own `mzad-*` slug space and their own status ladder. Zero of their
       links appear in the for-rent/for-sale catalogue, and `auctions_count` is 0 on every city.
       Belt and braces anyway: `price_type_label` is «سعر محدد» ("a specific price") on 813/813, and
       the platform's own alternative for a bid-priced ad is «آخر عرض» (last bid), so any row whose
       price is not a specific price is skipped with a counted reason.
     · Off-plan lives under /projects/properties/explore/ksa/<project> — a separate URL space with
       4 projects, zero overlap with the ad catalogue. The ad catalogue is not crawled by type, it
       is taken from the ads endpoint, so a project cannot arrive. Scanned all 813 descriptions and
       titles for «على الخارطة», «تحت الإنشاء», «قيد الإنشاء», «مزاد», «مزايدة»: zero hits.
     · /coworking-spaces/... is likewise its own URL space with zero overlap.
     · `status` is 2 «منشور», `is_active` 1 «معتمد», `is_draft` 0 and `ad_type` 2 «إعلان مرخص» on
       813/813. No other value exists, so none of them is a death signal and none is read as one —
       but a row that stops saying "published / approved / not a draft" is skipped and counted,
       because arriving at a new value is exactly the case worth refusing to guess about.

5. PDPL. `advertiser_name` (813), `advertiser_phone` (813), `contact_number` (813),
   `advertiser_email` (611), `average_rating_creator`, `member_type` and the whole `creator` object
   (id / name / image / mobile / member_type_value — a real broker or owner record) are NEVER read
   into a column, into `additional_info`, or into `source_capture`. Both JSONB payloads are built
   from an explicit key ALLOWLIST and then run through strip_pii_fields() as a second barrier, and
   every free-text field goes through redact_pii(). An allowlist rather than a blocklist because
   `creator` carries `name`, which db.redact_capture() deliberately does not treat as a contact
   channel (it must not eat licence/deed-style regulatory keys). This is not theoretical: 159 of
   813 `description` values carry a phone, WhatsApp handle or email written by the advertiser —
   mstodaa-llaygar-288 ends «للتواصل … 920015243 / 0555434487 / 0541775599 / 0533138777».

6. THREE FIELDS ARE LOOKUP IDS, NOT VALUES. `info_fields.construction_period`, `.street_width` and
   `.real_estate_facade_id` hold row ids of a server-side options table the API never resolves
   (`info_fields_label` comes back null on every request, with or without locale/label params). The
   ids are contiguous and the sets are closed and small, so each one was resolved by PAIRING a JSON
   record against the same listing's rendered page — 30 pairs, one per distinct id, printed below.
   `construction_period` 136…148 turns out to be EXACTLY the shared Saudi age vocabulary in order,
   which parse_property_age() already owns, so nothing new is invented. An id outside the measured
   sets resolves to nothing and the column stays NULL, counted — an id we cannot resolve is not a
   measurement, the same ruling abaad made about a video filename that resolved on no base.

  `land_number` is NOT «رقم القطعة». The API publishes a 12-to-16-digit REGA land identifier
  (1309021985100000) while the page's parcel cell for the same listing reads «117». So it is
  archived and `plan_parcel` stays NULL rather than carrying the wrong number.

REMOVAL ORACLE (measured 2026-09-24)
------------------------------------
The detail API states removal in words, and it is decisive where the HTML is not:

    404 «هذا الاعلان لم يعد متوفر»   → gone  ("this ad is no longer available" — the record is
                                             known, the ad is withdrawn). 4/4 ads that left the
                                             catalogue mid-capture, and 16/16 never-existed slugs.
    404 «لم يتم العثور على البيانات» → gone  ("data not found" — no such record at all).
    200 with a `data` object        → live  (20/20 sampled catalogue rows; self-heal for a row
                                             absent from OUR crawl but not from the platform)
    200 without a `data` object     → UNKNOWN (a shape we have not measured says nothing)
    anything else                   → UNKNOWN (the shared law in http_liveness decides; a 403,
                                             a 5xx or no answer can never kill a row)

Both 404 messages mean gone, so the verdict is taken from the STATUS and the message is only
recorded; a third message would not change a 404 into a life. Removals are additionally gated by an
in-run positive control that fails CLOSED, and `url_for` reads each row's OWN stored `listing_url`
back from the database (http_liveness.stored_listing_url) and takes the slug from its last path
segment — never a slug rebuilt from an ad_number, which would risk probing a different listing. Rows are
built from the roster + a per-slug detail fetch, and that fetch IS this listing's own record, so
mark_direct_alive() is honest here and is called.

COMPLETENESS (what licenses a deletion)
---------------------------------------
The roster endpoint declares no total, so "the walk ended" cannot license a prune: one truncated
response with `links.next` null would look like a shrunken catalogue, and the canary could not tell
(the source IS serving). The independent declared total is the website's OWN counter, read from
page 1 of each explore listing — «عرض 1 إلى 20 من 577 النتائج» / «… من 236 النتائج». Page 1 is
stable (5 consecutive fetches: identical 21 links, identical 577), while pages 3-8 served 566 from a
different ISR cache generation — which is why only page 1 is read, and why the two numbers must
MATCH EXACTLY before anything is pruned. Both directions of a stale counter simply skip the prune,
so the gate fails closed.

  KNOWN HOLE, measured and counted: the explore pages pin ONE promoted ad above the grid on every
  page (mstodaa-llaygar-292, `card_label` «استثنائي», `customer_package_id` 390) and the roster
  endpoint does not return it, while its own detail record answers 200 «منشور»/«معتمد». No
  parameter surfaces it (is_boosted / boosted / featured / with_boosted / customer_package_id all
  return the same 813). So page 1's own links are harvested alongside the counter and any slug the
  roster lacks is fetched individually and counted as `promoted_not_in_roster`. It is excluded from
  the completeness comparison, because the counter does not count it either.

COVERAGE (full --dry-run against the live API, 2026-09-24 — a real walk, nothing sampled)
----------------------------------------------------------------------------------------
813 roster rows + 1 promoted ad = 814 fetched; the site's counter declared 577 + 236 and the roster
served exactly 577 + 236, so complete=True. 782 mapped (512 residential + 270 commercial) and 32
skipped, every one counted: city_not_in_catalog 18, «مجمع» 9, «كشك» 2, «برج» 2, «موقف سيارات» 1.
Types: Apartment 146 · Residential Land 132 · Office 125 · Villa 72 · Warehouse 69 · Building 52 ·
Showroom 48 · Rest House 42 · Room 36 · Floor 32 · Studio 9 · Workshop 8 · Factory 8 · Hotel 1 ·
Farm 1.
  price_total 219 · price_annual 562 · price_per_meter 0 OF 782 — by design (trap 1)
  rent_period 68 of 563 rents (47 annual + 21 monthly; 494 UNKNOWN, with every price stored
    unconverted). Readings counted: period_unknown 437, figure_not_beside_token 52, annual 47,
    monthly_corroborated 21, two_periods_named 3, is_a_payment_split 3.
  area_m2 782 · license_number 782 · date_added 782 · photo_urls 782 (none empty) · description 781
  city 765 · district_ar 752 · property_age 545 · street_width_m 464 · bathrooms 191 · bedrooms 155
  direction 50 · video_url 28 · parking 5
  electricity 720 · water_supply 613 · sanitation 531 · optical_fibers 51 (from the STRUCTURED list)
  kitchen 293 · air_conditioner 182 · furnished 115 · maid_room 54 · elevator 48 · laundry_room 44 ·
    car_entrance 27 · driver_room 26 · balcony_terrace 20 · private_entrance 18 (from the listing's
    own prose, through the shared clause-aware normalize.amenities_from_text)
  Exactly 8 amenity values are stored FALSE, and all 8 are the source saying NO in its own words
  («مكيفات غير راكبة» → air_conditioner False, 6 rows; laundry_room 1; furnished 1). Nothing else is
  ever False: an amenity the source does not mention stays NULL.

Types: 14 of the 19 the platform publishes map through the
shared TYPE_MAP_AR; «شقَّة صغيرة (استوديو)» (9 rows) is overridden to Studio after diacritic
stripping — the source writes shadda BEFORE fatha (U+0651 then U+064E), which renders identically to
a hand-typed fatha-first copy and compares UNEQUAL, the exact trap that made abaad's first build
skip all 3 of its studio rows while its own unit test passed. The canonical taxonomy lists BOTH
orderings for the same reason.
  795/813 cities resolve through to_catalog (region hint = `region`); 765/795 districts resolve
  exactly against loc_catalog_district and the rest keep their raw text in `neighborhood`.
  Amenities come from the STRUCTURED `amenities[]` list, keyed on its stable ASCII `slug` rather
  than the Arabic title, positive-only: 6 distinct values exist fleet-wide on this platform and 4
  have columns (khrbaaa→electricity, myah→water_supply, srf-shy→sanitation,
  alyaf-doyy→optical_fibers). «هاتف» (144 rows) and «تصريف الفيضانات» (38) have no column and are
  archived. An amenity the source omits stays NULL, never False.

OPEN QUESTIONS FOR ONBOARDING (none of these are guessed in code)
----------------------------------------------------------------
  · «مجمع» (9 rows), «برج» (2), «كشك» (2), «موقف سيارات» (1) have no safe fleet mapping and all four
    SKIP with a counted reason. The fleet itself disagrees — 6 scrapers map «مجمع»/«برج» to
    "Commercial Building" while aqargate/dealapp/raghdan use "Compound"/"Building", and the
    canonical taxonomy lists «مجمع» and «برج» under Residential Building's rawTypes instead.
    «كشك» → "Kiosk" is unanimous across 3 scrapers but "Kiosk" is not one of the 35 canonical clean
    types, and «موقف سيارات» is not in Parking's rawTypes (which lists «مواقف»). Four owner
    decisions, worth 14 rows.
  · `license_expiry` and `plan_parcel` are published on the rendered page and not by the API. Ask
    the platform to expose «تاريخ إنتهاء رخصة الإعلان» and «رقم القطعة» in
    /api/v1/real-estate/<slug>, or accept a second ~300 KB fetch per listing to scrape them.
  · The pinned promoted ad is invisible to the roster endpoint (above). Ask for a parameter that
    includes it — a featured slot the catalogue API hides is also a featured-placement-neutrality
    question for Ezhalah, not only a coverage one.
  · 18 unresolved cities are catalog gaps or non-city labels: «قريه ديراب» (6), «مزارع وادى
    العماريه» (2), «هجره النطاش والتراحيب», «مزرعه بن علي والدواجن وماحولها», «فيضه اعبليه
    ومزارعها», «الحزم والبطينه», «السيباني», «مصيقره». «البدائع» (3 rows) is a real Qassim city the
    source files under «منطقة الرياض», so the region hint refuses it rather than filing it under a
    neighbour — an exact-location-only refusal, not a parser failure.
  · `main_usage` is «تجاري» 497 / «سكني» 283 / absent 33 — the platform's own residential-vs-
    commercial reading. It is used ONLY to build the listing URL (it is what the site routes on);
    the table a row lands in is normalize.category_for_type(property_type), the shared fleet rule,
    which disagrees with `main_usage` often (every «أرض» is filed تجاري by the platform and
    Residential Land by the taxonomy). Whether the platform's own usage should influence the split
    is a normalize-level question for every platform at once.
  · `rental_space` («المساحة التأجيرية», 11 rows) may or may not be interior_space_m2, and
    `number_of_units` (8 rows) may or may not be num_apartments. Both are archived rather than
    guessed into a column.

DETAIL, MEASURED
----------------
  · `bed_room_count` (155) is the BEDROOM count; `rooms_count` (240) is TOTAL rooms and has no
    column — aamar-llaygar-183 is a 21-flat building whose `rooms_count` is 50. It is archived.
    NO numeric field is ever published as 0 on any of the 813 rows: the platform omits the key
    instead, so absent → NULL is unambiguous here and needs none of abaad's "a published 0 is the
    answer" handling.
  · `price` is non-zero on 813/813 and `total_area` on 813/813, so no «السعر عند الطلب» shape
    exists yet; a missing or non-numeric price would still store NULL with
    price_evidence.found=false rather than a guess.
  · `usage_id` (2) and `usage` («تجاري») are constant on all 813 and carry no information; only
    `main_usage` varies. `privacy_type` is 0, `payment_amount` 0, `extra_fields`/`street_name`/
    `sub_type_id`/`direction_label`/`city_facade` null on all 813 — none is stored.
  · `latitude`/`longitude` are present on all 813 but the listing tables carry no coordinate
    columns, so they are not stored.
  · The measured lookup tables (30 pairs, JSON id ↔ the same listing's rendered label):
      construction_period 136 جديد · 137 اقل من سنة · 138 سنة · 139 سنتين · 140 ثلاث سنوات ·
        141 اربع سنوات · 142 خمس سنوات · 143 ست سنوات · 144 سبع سنوات · 145 ثمان سنوات ·
        146 تسع سنوات · 147 عشر سنوات · 148 اكثر من عشر سنوات
      street_width 0 «-» (unset) · 185 18 · 186 30 · 187 60 · 194 80 · 195 100
      real_estate_facade_id 154 شرقية · 155 غربية · 156 شمالية · 157 جنوبية · 159 جنوبية شرقية ·
        160 جنوبية غربية · 161 شمالية غربية
    Gaps are real options no current listing uses (facade 158, street widths 188-193); they resolve
    to nothing and are counted, never interpolated.
"""
from __future__ import annotations

import argparse
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http import TRANSIENT_STATUSES  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe, stored_listing_url  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://reinvest.sa"
API = "https://api.reinvest.sa/api/v1/real-estate"
SOURCE = "ري إنفست"          # the site's own spelling, from its og:title
PREFIX = "RNV"
SLUG = "reinvest"
# Spelled out rather than f-string-built: test_check_tables_wiring requires end_run's
# check_tables to be string literals that provably belong to THIS platform.
RES_TABLE = "reinvest_residential_listings"
COM_TABLE = "reinvest_commercial_listings"
PAGE_SIZE = 1000
# The roster does not carry the resolved per-listing fields, so every slug needs its own record
# (measured: 813 of them in 41 s at 10 workers, 813/813 answering 200).
WORKERS = 8

# TASHKEEL IS INVISIBLE AND ITS ORDER IS NOT SEMANTIC. The source's studio type is
# «شقَّة صغيرة (استوديو)» written U+0634 U+0642 **U+0651 U+064E** U+0629 … — shadda BEFORE fatha.
# Typing that literal by hand produces fatha-before-shadda, which renders identically and compares
# UNEQUAL, so an override keyed on a hand-typed copy silently never fires (abaad's first build
# skipped all 3 of its studio rows as type_unmapped while its own unit test passed). Marks are
# stripped before the lookup, which also protects the shared TYPE_MAP_AR keys (all mark-free) from a
# stray diacritic on any future row.
_MARKS = dict.fromkeys(list(range(0x064B, 0x0653)) + [0x0640, 0x0670])

# Keyed on the mark-free form. The value is the fold the canonical taxonomy already applies, which
# lists BOTH diacritic orderings of this very string under Studio's rawTypes.
_TYPE_OVERRIDES = {
    "شقة صغيرة (استوديو)": "Studio",
}

# `the_sub_type_of_ad` — 18 «إيجار» (577) / 17 «بيع» (236). Nothing else exists on the 813.
_DEAL = {18: "Rent", 17: "Buy"}

# The source's own statements about a row being a live, licensed, specifically-priced ad. Constant
# across all 813, so none is a death signal — but a row that stops saying one of these has arrived
# at a value we have never measured, and is skipped rather than guessed about. «آخر عرض» (last bid)
# is the platform's own alternative to «سعر محدد», which is why the price-type check is the auction
# backstop even though auctions are a separate entity with their own endpoint.
_PUBLISHED_STATUS = 2
_APPROVED = 1
_LICENSED_AD_TYPE = 2
_SPECIFIC_PRICE = "سعر محدد"

# `main_usage` → the segment the SITE puts in a listing URL. Verified: reproduces the site's own
# <a href> on 763/763 walked listings. Absent → the site uses the literal "explore" (31 of the 763).
_URL_USAGE = {"تجاري": "commercial", "سكني": "residential"}
_URL_USAGE_FALLBACK = "explore"
_URL_DISTRICT_FALLBACK = "district"

# ── The server-side options table the API never resolves (trap 6). Measured by pairing each
# distinct id against the same listing's rendered page; 30 pairs, one per id. An id outside these
# sets resolves to nothing and its column stays NULL, counted — never interpolated from a neighbour.
_AGE_BY_ID = {
    136: "جديد", 137: "اقل من سنة", 138: "سنة", 139: "سنتين", 140: "ثلاث سنوات",
    141: "اربع سنوات", 142: "خمس سنوات", 143: "ست سنوات", 144: "سبع سنوات",
    145: "ثمان سنوات", 146: "تسع سنوات", 147: "عشر سنوات", 148: "اكثر من عشر سنوات",
}
# id 0 is the page's «-» — the field is UNSET, not a zero-metre street.
_STREET_WIDTH_BY_ID = {185: 18, 186: 30, 187: 60, 194: 80, 195: 100}
_FACADE_BY_ID = {
    154: "شرقية", 155: "غربية", 156: "شمالية", 157: "جنوبية",
    159: "جنوبية شرقية", 160: "جنوبية غربية", 161: "شمالية غربية",
}

# `amenities[].amenity.slug` → the column the source's own word states. The ASCII slug is the key
# rather than the Arabic `title`, so a spelling change upstream («الياف ضوئية» vs «ألياف ضوئية»)
# cannot silently drop an amenity. Positive-only: an amenity the source omits is UNKNOWN, never
# False. «هاتف» (hatf, 144 rows) and «تصريف الفيضانات» (tsryf-alfydanat, 38) have no column and are
# archived in additional_info instead of being forced into a neighbouring one.
_AMENITY_COLS = {
    "khrbaaa": "electricity",
    "myah": "water_supply",
    "srf-shy": "sanitation",
    "alyaf-doyy": "optical_fibers",
}

# Keys copied into additional_info / source_capture. An ALLOWLIST, so a PII key added upstream
# tomorrow cannot arrive by default (PDPL, trap 5). Deliberately excluded: advertiser_name,
# advertiser_phone, advertiser_email, contact_number, creator, member_type, average_rating*.
_CAPTURE_KEYS = (
    "id", "slug", "ad_number", "license_number", "authorization_no", "the_sub_type_of_ad",
    "the_sub_type_of_ad_label", "the_sub_type_of_ad_slug", "type", "type_id", "sub_type_id",
    "usage", "usage_id", "main_usage", "main_usage_id", "sub_usages", "usage_slug",
    "real_state_type_slug", "city", "city_id", "city_slug", "district", "district_id",
    "district_slug", "region", "region_id", "price", "price_type", "price_type_label",
    "selling_meter_price", "current_rent_price", "is_negotiable", "is_rented", "remaining_month",
    "area", "total_area", "land_number", "info_fields", "amenities", "status", "status_value",
    "is_active", "is_active_label", "is_draft", "ad_type", "ad_type_value", "privacy_type",
    "map_type", "card_label", "customer_package_id", "created_at", "published_at", "updated_at",
    "title", "description", "property_purpose", "type_purpose", "country_property",
    "location_description_on_mojdeed", "video",
)
# Of those, the keys that carry PROSE — where an advertiser's own phone/WhatsApp link hides.
_CAPTURE_FREE_TEXT = frozenset({"title", "description", "location_description_on_mojdeed"})

# The website's own result counter, page 1 of an explore listing: «عرض 1 إلى 20  من 577 النتائج».
_COUNTER_RE = re.compile(r'<p class="text-\[#3E3E3E\] text-xs">(.{0,200}?)</p>', re.S)
# A per-listing link on an explore page: six segments, the last ending in -<id>.
_EXPLORE_LINK_RE = re.compile(r'href="(/for-(?:rent|sale)/[^"]+-\d+)"')


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")     # impersonate OWNS the User-Agent
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7"})
    return s


_LOCAL = threading.local()


def _worker_session() -> cc.Session:
    """One session per worker thread — a curl_cffi Session is not shared across threads."""
    s = getattr(_LOCAL, "s", None)
    if s is None:
        s = _LOCAL.s = session()
    return s


def _strip_marks(s: Optional[str]) -> Optional[str]:
    return s.translate(_MARKS) if s else s


def _clean(v) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


def _pos(v) -> Optional[int]:
    """A positive count/measure, or None. No field on this platform is ever published as 0."""
    n = normalize.to_int_numeric(v)
    return n if n and n > 0 else None


_WESTERN = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

# «دفعة / دفعتين / دفعات» — a PAYMENT SPLIT, not a lease term. shk-llaygar-190 publishes
# «قيمة الإيجار: 40,000 ألف دفعة أو دفعتين أو شهري»: one payment, two, or monthly instalments of the
# same 40,000, so «شهري» beside the figure 40000 is not a statement that 40000 is a monthly rent.
# Same reading as wadod's «دفعة واحدة»/«دفعتين».
_PAYMENT_SPLIT_RE = re.compile(r"دفع(?:ة|ه|تين|تان|ات)")
_PERIOD_WINDOW = 90


def _states_figure_beside(text: str, price: int, at: int) -> bool:
    """Does the prose print `price` itself within ±90 chars of the period token at `at`?

    Arabic-Indic digits and thousands separators are normalised first, so «٢٣٬٠٠٠» and «23,000» both
    count. Deliberately an EXACT digit match: «٦٠ الف» is an approximation of 60000, not a statement
    of it, and this gate exists to refuse approximations.
    """
    window = text.translate(_WESTERN)[max(0, at - _PERIOD_WINDOW):at + _PERIOD_WINDOW]
    return re.search(rf"(?<!\d){re.escape(str(price))}(?!\d)",
                     re.sub(r"[,٬،_\s](?=\d{3}\b)", "", window)) is not None


def _rent_fields(price: Optional[int], text: str) -> tuple[Optional[str], Optional[int], str]:
    """(rent_period, price_annual, why) for a reinvest rent — the platform's hardest trap (trap 2).

    The structured `price` carries NO period: no field anywhere on the record states one (all 18
    `info_fields` keys plus property_purpose/type_purpose/the_sub_type_of_ad_label checked over 813
    rows). So the only possible period is one the listing's own prose states, read by the shared
    audited parser — and on this platform that token frequently describes a DIFFERENT number than
    the price field holds. `why` names the outcome so the run can count it.

    'annual' is taken as published because storing it converts nothing, so no number can move. A
    period whose storage conversion CHANGES the number must be corroborated three ways, all
    measured: the ad must name exactly ONE period (3 rows name two: «للإيجار الشهري والسنوي»), the
    window must not be about a payment split (3 rows), and the prose must print the very figure the
    price field holds (53 rows do not — shk-llaygar-107 publishes 54000 beside «4500 ريال شهري»,
    which is 54000 ÷ 12, so ×12 would have stored 648,000).
    """
    period, annual = normalize.rent_period_and_annual(price, text)
    if not period:
        # UNKNOWN period. The price is still the source's own published figure and is stored as
        # such. This deliberately does NOT adopt the shared parser's (None, None) for
        # يومي/أسبوعي/نصف سنوي/ربع سنوي: that contract exists for platforms whose price field IS
        # labelled with that period, and here it is not. 28 rent rows carry a يومي token that is
        # «ضيافة يومية» / «نظافة يومية» — daily SERVICE on a serviced office — and discarding their
        # price would hide a source-published figure on the strength of a word about cleaning.
        # rent_period NULL already keeps the row out of period-scoped rent search. (trap 3)
        return None, price, "period_unknown"
    if annual == price:
        return period, annual, f"period_{period}"   # no conversion — nothing can have been distorted
    tokens = {re.sub(r"\s+", " ", m.group(1))
              for m in normalize._RENT_PERIOD_TOKEN_RE.finditer(text or "")}
    if len(tokens) > 1:
        return None, price, "period_two_periods_named"
    m = normalize._RENT_PERIOD_TOKEN_RE.search(text or "")
    window = (text or "")[max(0, m.start() - _PERIOD_WINDOW):m.start() + _PERIOD_WINDOW]
    if _PAYMENT_SPLIT_RE.search(window):
        return None, price, "period_is_a_payment_split"
    if price is not None and _states_figure_beside(text, price, m.start()):
        return period, annual, f"period_{period}_corroborated"
    return None, price, "period_figure_not_beside_token"


def _amenities(rec: dict[str, Any]) -> tuple[dict[str, bool], list[str]]:
    """The structured `amenities[]` list → real columns, plus the raw words for the archive."""
    cols: dict[str, bool] = {}
    words: list[str] = []
    for a in rec.get("amenities") or []:
        am = (a or {}).get("amenity") if isinstance(a, dict) else None
        if not isinstance(am, dict):
            continue
        slug, title = _clean(am.get("slug")), _clean(am.get("title"))
        if title:
            words.append(title)
        # Positive-only: a named amenity is True, an omitted one stays UNKNOWN.
        if slug in _AMENITY_COLS:
            cols[_AMENITY_COLS[slug]] = True
    return cols, words


def listing_path(rec: dict[str, Any]) -> Optional[str]:
    """The site's OWN canonical path for this listing. Verified against 763 real <a href>."""
    parts = [
        _clean(rec.get("the_sub_type_of_ad_slug")),
        _clean(rec.get("real_state_type_slug")),
        _URL_USAGE.get(_clean(rec.get("main_usage")) or "", _URL_USAGE_FALLBACK),
        _clean(rec.get("city_slug")),
        _clean(rec.get("district_slug")) or _URL_DISTRICT_FALLBACK,
        _clean(rec.get("slug")),
    ]
    return "/" + "/".join(parts) if all(parts) else None


def map_listing(rec: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) for ONE listing record. row is None exactly when a reason is set."""
    ad = _clean(rec.get("ad_number"))
    if not ad:
        return None, "residential", "no_ad_number"

    # The source's own statements that this is a live, licensed, specifically-priced ad. All four are
    # constant across the measured catalogue, so a new value is unmeasured territory, not a guess.
    if normalize.to_int_numeric(rec.get("status")) != _PUBLISHED_STATUS:
        return None, "residential", f"status_{_clean(rec.get('status_value')) or rec.get('status')}"
    if normalize.to_int_numeric(rec.get("is_active")) != _APPROVED:
        return None, "residential", f"not_approved_{_clean(rec.get('is_active_label')) or 'blank'}"
    if normalize.to_int_numeric(rec.get("is_draft")):
        return None, "residential", "draft"
    if normalize.to_int_numeric(rec.get("ad_type")) != _LICENSED_AD_TYPE:
        return None, "residential", f"ad_type_{_clean(rec.get('ad_type_value')) or 'blank'}"
    # The auction backstop: the platform's own alternative to «سعر محدد» is «آخر عرض» (last bid).
    if _clean(rec.get("price_type_label")) != _SPECIFIC_PRICE:
        return None, "residential", f"price_type_{_clean(rec.get('price_type_label')) or 'blank'}"

    deal = _DEAL.get(normalize.to_int_numeric(rec.get("the_sub_type_of_ad")))
    if not deal:
        return None, "residential", (
            f"deal_unknown_{_clean(rec.get('the_sub_type_of_ad_label')) or 'blank'}")

    type_ar = _clean(rec.get("type"))
    property_type = normalize.map_type_exact(_strip_marks(type_ar), _TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", f"type_unmapped_{type_ar or 'blank'}"
    category = normalize.category_for_type(property_type).lower()

    path = listing_path(rec)
    if not path:
        return None, category, "no_listing_path"

    city_ar = _clean(rec.get("city"))
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar, _clean(rec.get("region")))
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_raw = _clean(rec.get("district"))
    district_ar = (find_district_in_text(district_raw, city_id)
                   or find_district_in_text(_clean(rec.get("title")), city_id))

    info = rec.get("info_fields") if isinstance(rec.get("info_fields"), dict) else {}
    title = _clean(rec.get("title"))
    desc = redact_pii(_clean(rec.get("description")))
    amen_cols, amen_words = _amenities(rec)

    photos = [u for im in (rec.get("images_info") or [])
              if isinstance(im, dict) and (u := _clean(im.get("url")))] or None

    # ── The three lookup ids the API never resolves. An id outside the measured set resolves to
    #    nothing and its column stays NULL; the raw id is archived so the gap is countable.
    age_id = normalize.to_int_numeric(info.get("construction_period"))
    width_id = normalize.to_int_numeric(info.get("street_width"))
    facade_id = normalize.to_int_numeric(info.get("real_estate_facade_id"))

    # ── PRICE. `price` is the ONLY source-published figure. `selling_meter_price` is the platform's
    #    own floor(price / int(total_area)) on 813/813 rows — derived, so `price_per_meter` is never
    #    written at all. (trap 1; the aqargate landTotalPrice ruling, in reverse.)
    price_raw = rec.get("price")
    headline = normalize.to_int_numeric(price_raw)

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{ad}",
        "listing_url": f"{BASE}{path}",
        "source": SOURCE,
        "active": True,
        "title": title,
        "description": desc,
        **normalize.amenities_from_text(f"{'، '.join(amen_words)}\n{desc or ''}"),
        **amen_cols,                       # the STRUCTURED list wins over anything read from prose
        "property_type": property_type,
        # `deal` is already provably 18→Rent or 17→Buy — anything else skipped above with a counted
        # reason. Written as a two-literal expression so the value can never be anything else even
        # in principle.
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _pos(rec.get("total_area")),
        "bedrooms": _pos(info.get("bed_room_count")),      # «عدد غرف النوم», NOT `rooms_count`
        "bathrooms": _pos(info.get("bathrooms")),
        "parking": normalize.count_flag(info.get("parking_count")),
        "property_age": normalize.parse_property_age(_AGE_BY_ID.get(age_id)),
        "street_width_m": normalize.one_street_width(_STREET_WIDTH_BY_ID.get(width_id)),
        "direction": normalize.one_direction(_FACADE_BY_ID.get(facade_id), diagonal=True),
        "license_number": _clean(rec.get("license_number")),
        "date_added": _clean(rec.get("published_at")) or _clean(rec.get("created_at")),
        "photo_urls": photos,
        "video_url": _clean(rec.get("video")),
    }
    if deal == "Rent":
        # Period from THIS listing's own words only, and a converting period must be corroborated
        # against the very figure the price field holds. Silent → (None, price unconverted).
        period, row["price_annual"], why = _rent_fields(
            headline, " ".join(filter(None, (title, desc))))
        if period:
            row["rent_period"] = period
    else:
        row["price_total"] = headline
        why = "sale"
    row["price_evidence"] = normalize.price_evidence(
        field="price", raw=price_raw,
        stored=row.get("price_total") if deal == "Buy" else row.get("price_annual"),
        kind="total" if deal == "Buy" else (row.get("rent_period") or "annual"),
        unit="total", origin="api", authoritative_absent=False)
    row["images_evidence"] = {"observed": True, "container_present": "images_info" in rec,
                              "key_present": bool(rec.get("images_info")),
                              "count": len(photos or [])}

    extra = {
        "source_id": rec.get("id"), "source_slug": _clean(rec.get("slug")), "type_ar": type_ar,
        "region_ar": _clean(rec.get("region")),
        # exact m², before area_m2's INTEGER round
        "source_total_area_raw": _clean(rec.get("total_area")),
        "source_price_raw": price_raw,
        # DERIVED by the platform: floor(price / int(total_area)) on 813/813. Archived as a
        # provenance record ONLY — it is never a price column. (trap 1)
        "platform_derived_meter_price": rec.get("selling_meter_price"),
        "total_rooms": _clean(info.get("rooms_count")),      # «عدد الغرف», not bedrooms
        "street_count": _clean(info.get("street_count")),
        "floors_count": _clean(info.get("floors_count")),
        "offices_count": _clean(info.get("offices_count")),
        "number_of_units_raw": _clean(info.get("number_of_units")),
        "rental_space_raw": _clean(info.get("rental_space")),
        "has_worker_accommodation_id": info.get("has_worker_accommodation"),
        "finishing_type_id": info.get("finishing_type_id"),
        "age_option_id": age_id, "street_width_option_id": width_id, "facade_option_id": facade_id,
        "age_option_label": _AGE_BY_ID.get(age_id),
        "street_width_option_label": _STREET_WIDTH_BY_ID.get(width_id),
        "facade_option_label": _FACADE_BY_ID.get(facade_id),
        "amenity_words": amen_words or None,
        "main_usage": _clean(rec.get("main_usage")),         # the platform's own res/com reading
        "sub_usages": [_clean(u.get("name")) for u in (rec.get("sub_usages") or [])
                       if isinstance(u, dict)] or None,
        "authorization_no": _clean(rec.get("authorization_no")),
        # a 12-16 digit REGA land identifier — NOT «رقم القطعة» (the page prints «117» for the same
        # listing), so plan_parcel stays NULL rather than carrying the wrong number
        "rega_land_number": _clean(rec.get("land_number")),
        "is_rented": rec.get("is_rented"),
        "is_negotiable": rec.get("is_negotiable"),
        "current_rent_price_raw": rec.get("current_rent_price"),   # an EXISTING let's rent, not the ad
        "remaining_month": rec.get("remaining_month"),
        "card_label": _clean(rec.get("card_label")),
        "rent_period_reading": why,
        "source_status": _clean(rec.get("status_value")),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in extra.items() if v is not None})
    # The capture is PRIVATE but "private" is not "may accumulate contact details" — 159 of 813
    # advertisers write their own phone or WhatsApp link into the description
    # (mstodaa-llaygar-288: «للتواصل … 920015243 / 0555434487 …»). Redact the free-text keys HERE
    # rather than leaning on db.redact_capture(): a barrier after the row has left the mapper is not
    # this mapper's guarantee. Numbers, licences, ids and option ids are untouched.
    row["source_capture"] = strip_pii_fields(
        {"schema": "reinvest.api-v1-real-estate.v1",
         **{k: (redact_pii(rec[k]) if k in _CAPTURE_FREE_TEXT else rec[k])
            for k in _CAPTURE_KEYS if k in rec}})
    return row, category, ""


# ── FETCH ────────────────────────────────────────────────────────────────────────────────────────
def _json(s: cc.Session, url: str, *, what: str) -> dict:
    r = None
    for _ in range(3):
        r = s.get(url, timeout=60)
        if r.status_code not in TRANSIENT_STATUSES:
            break
    if r is None or r.status_code != 200:
        raise RuntimeError(f"{what} returned {getattr(r, 'status_code', 'no response')}")
    try:
        body = r.json()
    except ValueError as exc:
        raise RuntimeError(f"{what} is no longer JSON: {exc}") from exc
    if not isinstance(body, dict):
        raise RuntimeError(f"{what} is {type(body).__name__}, not the expected object")
    return body


def fetch_roster(s: cc.Session, limit: int = 0) -> list[dict]:
    """Every roster row, deduped by `slug`, following the endpoint's own `links.next`.

    `meta` carries no total (Laravel simplePaginate), so this cannot certify completeness on its own
    — that is what the website's counter is for (see declared_totals). A page that repeats itself
    stops the walk rather than looping forever.
    """
    rows: dict[str, dict] = {}
    url: Optional[str] = f"{API}?per_page={PAGE_SIZE}&page=1"
    pages = 0
    while url:
        body = _json(s, url, what=f"{API} page {pages + 1}")
        batch = [x for x in (body.get("data") or []) if isinstance(x, dict)]
        pages += 1
        if not batch:
            break
        before = len(rows)
        for x in batch:
            if key := _clean(x.get("slug")):
                rows[key] = x
        if len(rows) == before:
            break                       # page repeated itself
        if limit and len(rows) >= limit:
            return list(rows.values())[:limit]
        url = _clean((body.get("links") or {}).get("next"))
    print(f"{SOURCE}: roster {len(rows)} listings over {pages} page(s)", flush=True)
    return list(rows.values())


def declared_totals(s: cc.Session) -> tuple[dict[str, Optional[int]], list[str]]:
    """The WEBSITE's own result counter per deal, plus page 1's own listing slugs.

    The counter is the only independent declared total this source offers, and pruning is gated on
    it matching exactly. Page 1 only: it is stable across repeated fetches (5/5 identical), while
    deeper pages are served from other ISR cache generations and reported 566 for the same 577
    catalogue. The harvested slugs recover the ONE promoted ad the roster endpoint omits.
    """
    totals: dict[str, Optional[int]] = {}
    slugs: list[str] = []
    for deal, path in (("Rent", "for-rent"), ("Buy", "for-sale")):
        try:
            r = s.get(f"{BASE}/{path}/properties/explore/ksa?page=1", timeout=60,
                      headers={"Accept": "text/html"})
            html = r.text if r.status_code == 200 else ""
        except Exception as e:                       # noqa: BLE001 — no counter is UNKNOWN, not zero
            print(f"  ⚠ {path} counter unreadable: {type(e).__name__}: {e}")
            totals[deal] = None
            continue
        m = _COUNTER_RE.search(html)
        nums = re.findall(r"\d+", re.sub(r"<!-- -->", "", m.group(1))) if m else []
        totals[deal] = int(nums[-1]) if nums else None
        slugs += [p.rsplit("/", 1)[1] for p in _EXPLORE_LINK_RE.findall(html) if p.count("/") == 6]
        print(f"  {path}: site counter declares {totals[deal]}", flush=True)
    return totals, list(dict.fromkeys(slugs))


def fetch_detail(s: cc.Session, slug: str) -> Optional[dict]:
    """One listing's own record, or None when the source says it is no longer available.

    A 404 here is the source's own «هذا الاعلان لم يعد متوفر» / «لم يتم العثور على البيانات»: the ad
    left the catalogue between the roster read and this fetch. It is returned as None (the row is
    simply not seen this crawl), never as a row with missing fields — and because the roster count
    then falls short of the site's declared total, the prune gate closes for this run.
    """
    r = None
    for _ in range(3):
        r = s.get(f"{API}/{slug}", timeout=60)
        if r.status_code not in TRANSIENT_STATUSES:
            break
    if r is None or r.status_code != 200:
        return None
    try:
        data = (r.json() or {}).get("data")
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def fetch_details(slugs: list[str]) -> dict[str, dict]:
    """Every listing's own record, keyed by slug. Missing keys are ads that are gone or unreadable."""
    out: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for slug, rec in zip(slugs, ex.map(lambda sl: fetch_detail(_worker_session(), sl), slugs)):
            if rec:
                out[slug] = rec
    return out


# ── LIVENESS (measured 2026-09-24; the HTML page serves dead ads at 200 — the API does not) ───────
def _signal(status, body, _moved) -> Optional[str]:
    """'live' | 'gone' | None — the platform's AFFIRMATIVE signals only; the law does the rest.

    A 404 from /api/v1/real-estate/<slug> is the source stating the ad is gone, in words: either
    «هذا الاعلان لم يعد متوفر» (4/4 ads that left the catalogue, 16/16 never-existed slugs) or
    «لم يتم العثور على البيانات». Both mean gone, so the verdict comes from the STATUS and the
    message is not parsed — a third message would not turn a 404 into a life.

    A 200 counts as life only when it actually carries a listing object (20/20 sampled catalogue
    rows do). The rendered HTML page is deliberately NOT consulted: it serves de-listed ads at 200
    with full content from Next.js's ISR cache, measured on 3 of 4 confirmed-gone ads.
    """
    if status == 404:
        return "gone"
    if status != 200:
        return None
    if '"data":null' in (body or "").replace(" ", ""):
        return None                     # a 200 shell with no listing says nothing
    return "live" if '"data"' in (body or "") else None


def _slug_from_url(url: Optional[str]) -> Optional[str]:
    """The API's address for a listing, taken from the row's OWN stored listing_url."""
    last = urlparse(url or "").path.rstrip("/").rsplit("/", 1)[-1]
    return last or None


def _make_verify_gone(control: Optional[dict]):
    stored = stored_listing_url((RES_TABLE, COM_TABLE))

    def url_for(ad_number: str) -> Optional[str]:
        slug = _slug_from_url(stored(ad_number))
        return f"{API}/{slug}" if slug else None

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
    periods: dict[str, int] = {}
    try:
        roster = fetch_roster(s, limit=args.limit)
        if not roster:
            raise RuntimeError(f"{API} returned no listing rows")
        roster_slugs = [sl for x in roster if (sl := _clean(x.get("slug")))]
        totals, page1 = ({}, []) if args.limit else declared_totals(s)

        # The pinned promoted ad the roster endpoint omits (measured: exactly one). It is KEPT, and
        # tracked separately so it cannot skew the completeness comparison in either direction —
        # the site's own counter does not count it either.
        promoted_slugs = [] if args.limit else [sl for sl in page1 if sl not in set(roster_slugs)]

        # The roster row carries no `price_type_label`, `is_active`, `license_number`, `ad_number`,
        # `main_usage`, `amenities`, `images_info` or `video`; the per-slug record does. So every
        # slug is fetched, and the roster is used only as the address list.
        details = fetch_details(roster_slugs + promoted_slugs)
        gone = len(roster_slugs) - sum(1 for sl in roster_slugs if sl in details)
        if gone:
            skipped["detail_gone_or_unreadable"] = gone
        promoted = [sl for sl in promoted_slugs if sl in details]
        if promoted:
            print(f"  +{len(promoted)} promoted ad(s) the roster endpoint omits: {promoted}")

        by_deal: dict[str, int] = {}
        for slug in roster_slugs + promoted:
            rec = details.get(slug)
            if not rec:
                continue
            if slug not in promoted:       # the counter counts only the roster
                label = _clean(rec.get("the_sub_type_of_ad_label")) or "?"
                by_deal[label] = by_deal.get(label, 0) + 1
            row, cat, why = map_listing(rec)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            reading = (row.get("additional_info") or {}).get("rent_period_reading")
            if reading:
                periods[reading] = periods.get(reading, 0) + 1
            if args.type != "all" and cat != args.type:
                continue
            # The row was built from a fetch of THIS listing's own record, so the stamp is honest.
            (com if cat == "commercial" else res).append(db.mark_direct_alive(row, oracle="reinvest.api.real-estate.slug_detail"))

        # COMPLETENESS: the website's own counter must match the roster, per deal, EXACTLY. The
        # roster endpoint declares no total of its own, so without this a truncated response with
        # `links.next` null would look like a shrunken catalogue and license deletions. Both
        # directions of a stale counter skip the prune, so the gate fails closed.
        declared = {"Rent": totals.get("Rent"), "Buy": totals.get("Buy")}
        got = {"Rent": by_deal.get("إيجار", 0), "Buy": by_deal.get("بيع", 0)}
        complete = all(declared[d] is not None and declared[d] == got[d] for d in ("Rent", "Buy"))

        notes = _tally(skipped)
        if skipped:
            print("  skipped (not guessed): " + notes)
        if periods:
            print("  rent-period readings: " + _tally(periods))
        print(f"  declared {declared} vs mapped-source {got} → complete={complete}")
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:20]:
                print(f"   {r0['ad_number']:>14} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):17} {str(r0['city_ar']):14} "
                      f"d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>7} "
                      f"bd={str(r0.get('bedrooms')):>4} pt={r0.get('price_total')} "
                      f"pa={r0.get('price_annual')} rp={r0.get('rent_period')} "
                      f"ppm={r0.get('price_per_meter')} sw={r0.get('street_width_m')} "
                      f"ag={r0.get('property_age')} dir={r0.get('direction')} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0
        # The public upsert_reinvest_*_batch wrappers are added centrally at onboarding; same funnel.
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
            print("  prune skipped: the site's own counter did not match the roster")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(roster),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} complete={complete} {notes}"[:300],
                             check_tables=["reinvest_residential_listings",
                                           "reinvest_commercial_listings"])
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
