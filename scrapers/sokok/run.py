"""صكوك العقارية (Sokok) — sokok.sa. 398 land parcels for sale, onboarding 2026-09-24.

A single-seller LAND developer: every piece («قطعة») belongs to a surveyed subdivision («مخطط»)
owned by «صكوك العقارية», sold outright. No rents anywhere on the platform — see RENT, below.

SOURCE SHAPE (measured live 2026-09-24/25; every number here was captured, none assumed).
A Laravel + Inertia app. Three reads, all public, no auth/cookie/proxy, plain impersonate="chrome":

    GET /api/v1/plots?page=<N>      → the plot ROSTER (11 plots over 2 pages)
    GET /plot/<plot_id>/show        → Inertia HTML; props.pieces_features = EVERY piece of that
                                      plot, with its buyable_id and its map `color`
    GET /piece/<piece_id>/show      → Inertia HTML; props.piece = THAT piece's whole record

  RATE LIMIT IS REAL AND MEASURED: `x-ratelimit-limit: 60` per minute. An unthrottled walk got a
  hard 429 at request ~50. The crawl paces itself at MIN_INTERVAL and backs off on 429, and 429 can
  never become a death (the shared law in http_liveness forbids it).

WHY THE PIECES API IS NOT USED (the enumeration trap, measured)
--------------------------------------------------------------
There IS a `GET /api/v1/pieces` list endpoint carrying the same per-piece record, and the first
build used it. It cannot enumerate:

  · `per_page` is hard-capped at 20 and ignores per_page/limit/page_size (all four tried).
  · PAGES OVERLAP. The global order has ties («sort» is 0/1 for most rows) so the same row is
    served on several pages. A full 194-page walk yielded 3,712 DISTINCT pieces where the plot
    maps declare 3,824 — 112 pieces were NEVER served, 101 of them from plot 16 alone. A crawl
    that silently misses 3% of the catalogue must not be what "absent" is measured against.
  · `?plot_id=19` is SILENTLY IGNORED — it answered with a piece belonging to plot 5. So is
    `status_id=1` (answers contain both متاحة and مباعة). A filter that lies is worse than none.

The plot MAP is exact instead: props.pieces_features held 396 / 122 / 381 / 1262 / 461 / 279 / 360 /
237 / 109 / 57 / 160 features for the eleven plots — 3,824 total, equal to the roster's own
`pieces_count` on every plot, plot by plot. So the map is the enumeration and the completeness
oracle at once, and each piece's own detail page is the record. 12 + 398 reads, provably complete.

  COLOR IS THE AVAILABILITY SIGNAL, and it was validated against the roster's own counts, not
  guessed from the palette: #93c572 green totalled 72 / 89 / 4 / 233 on the four selling plots,
  which is EXACTLY each plot's published `pieces_available_count` (398 in total), and #ffa500
  orange totalled 1,024 across all plots, which is EXACTLY the number of pieces the API reports as
  «قريباً». Green is still only used to pick which pieces to FETCH — the listing decision is made
  from the piece's own published `status`, never from a colour.

THE TRAPS, ALL MEASURED
-----------------------
1. PRICE: BOTH FIGURES ARE PUBLISHED AND NEITHER CAN BE DERIVED FROM THE OTHER. A piece publishes
        meter_price "1,000.00"   ← «سعر المتر», a RATE
        price      "593,887.50"  ← the whole asking price, and `raw_price` 593887.5
   and the two do not multiply. Over ALL 280 available pieces captured:
        price == meter_price × area   on  0 / 280
        price ÷ area == meter_price   on  0 / 280
   so the arithmetic fails in BOTH directions, and the quotient price ÷ (meter_price × area) takes
   124 DISTINCT values between 1.079038 and 1.088286 — not a constant, so not VAT and not any fee
   we could name. The sharpest single case: ids 234328899 (meter_price 1,000.00, area 550.00) and
   234328919 (meter_price 1,100.00, area 500.00) publish the very SAME total 593,887.50 from two
   different per-metre rates, and 593,887.50 ÷ their areas gives 1,079.79 and 1,187.78 — neither of
   the rates the source printed.
     So `price_per_meter` = meter_price and `price_total` = price, BOTH VERBATIM, NEITHER DERIVED.
   Multiplying would have understated id 234329078 (mp 2,200.00 × area 660.00) by 114,920 SAR
   against its published 1,566,920.00; dividing the total by the area would have published a
   per-metre rate of 2,374 that the source never printed.
     WHY they differ, as far as the source lets us see: within ONE block the effective rate is
   constant while the printed rate is something else. Parcels 132/134/136/138 of block 12 all print
   meter_price 2,200.00 over areas 660.41 / 660.08 / 660.17 / 660.28, and their published totals
   divided by those areas give 2374.1207 / 2374.1211 / 2374.1210 / 2374.1208 — the same effective
   rate to four decimals, and it is NOT 2,200. So `meter_price` and `price ÷ area` are two DIFFERENT
   quantities the platform publishes side by side, not a rounding artifact of one. What the ~7.9%
   difference IS (VAT, development fees, something else) the source never says, so the code names
   neither and invents neither. It stores the two published figures and stops.
     `raw_price` equalled `price` on 280/280, so the native number is preferred and the formatted
   string is the fallback — never a reconciliation, since they never disagree.
     meter_price always ends «.00» (280/280), so price_per_meter loses nothing. `price` carries
   REAL halalas (.02 … .98 all present) and the column is bigint, so the stored total is the
   floored riyal the source itself displays and the exact published string is kept in
   additional_info.source_price_raw and in price_evidence.raw. Nothing is rounded up, ever.

2. ONLY «متاحة» HAS A PRICE — and that is the source stating which pieces are on the market.
   Across 3,712 captured pieces: 280 متاحة, ALL 280 with meter_price+price+raw_price; and 2,336
   مباعة + 1,024 قريباً + 63 محجوزة + 9 «موقفة من الشركة» — 3,432 rows, ZERO with any price key at
   all. So a piece that is not available does not merely lack a price, it is not an offer. Each of
   the four non-available words is the SOURCE'S OWN marker and each skips with its own count:
     · «مباعة» sold          · «محجوزة» reserved
     · «قريباً» coming soon — the off-plan/not-yet-selling marker. All 160 pieces of مخطط ضراس
       (plot 6, roster status «قريباً») carry it, and so do 864 pieces inside plots whose selling
       has otherwise finished. NOT READY → skipped, on the source's word, never on a heuristic.
     · «موقفة من الشركة» withdrawn by the company
   A row is mapped only when the source says «متاحة» AND publishes a price; either alone skips.

3. THE PLOT-LEVEL STATUS IS STALE AND MUST NOT GATE ANYTHING. Plot 16 (مخطط التوفيق) publishes
   status «تم البيع» (sold out) and pieces_sales_percent "100.00" while publishing
   pieces_available_count 233 — and its map really does show 233 green pieces, each with its own
   price. Three independent reads agree on 233 and only the plot's status/percent disagree, so the
   PER-PIECE status is the truth and the plot's own summary is ignored (it is kept in
   additional_info so the contradiction stays auditable). Gating on the plot would have thrown away
   132 of the 280 available pieces this crawl could see — the single largest selling plot.

4. `system` IS NOT THE PROPERTY TYPE. It is the building system the plot permits: «فلة» (villa,
   2,220 pieces), «وحدة» (unit, 1,360), «تجاري» (132). Reading «فلة» as a type would file a bare
   surveyed LAND parcel as a built Villa. The type comes from `purpose` only — «سكني» → «أرض» →
   Residential Land, «تجاري» → «أرض تجارية» → Commercial Land, both through the shared TYPE_MAP_AR
   canon rather than a local English literal. `system` goes to additional_info. A `purpose` word we
   do not recognise skips with a counted reason; it is never guessed into a side.

5. `street` IS A COUNT OF FRONTAGES, NOT A WIDTH: «على شارع» (3,126), «على شارعين» (567),
   «على ثلاث شوارع» (18), «على أربع شوارع» (1). There is no digit in it to read and no structured
   street width anywhere on the platform, so `street_width_m` comes ONLY from the shared audited
   street_from_prose() over the piece's own `description` — which 4 of the 398 available pieces
   have, in the shape «شارع 15م غرب» / «غرب شارع 15م». Every other row leaves street_width_m NULL
   rather than turning a frontage count into a measurement (a naive read of «على شارعين» as "2"
   would publish a 2-metre street). The count itself is kept in additional_info.

6. PHOTOS ARE PRESIGNED AND EXPIRE IN ONE HOUR, so none is stored. `images[].url` points at an
   Oracle object-storage bucket with `X-Amz-Expires=3600` and a signature. MEASURED: the signed URL
   answers 200 `image/jpeg`, 88,795 bytes, no CORP header — it really renders — and the same path
   WITHOUT the query answers 404 «Either the bucket named 'Web-Images' does not exist … or you are
   not authorized», i.e. the bucket is private and there is no stable public URL to keep. Storing
   the signed one would fill photo_urls with links that are dead within the hour, so `photo_urls`
   stays NULL, the stable object KEYS go to additional_info, and images_evidence records that the
   images were observed but are not storable. A URL we cannot serve tomorrow is not a URL. (The
   abaad `video_url` precedent.) `image_storage_keys` is deliberately untouched — that column
   belongs to the gated object-storage mirror, not to a scraper.

7. PDPL. The payloads carry real contact channels — `contact` {whatsapp «wa.me/966…», mobile «tel:
   966…», email}, and on the plot `advertiser_mobile` («+966599992887» on plot 19, a DIFFERENT
   «+966537113231» on plot 5, so it is per-plot and not one constant), plus `owner`,
   `owner_identity`, `owner_logo`, `owner_logo_url`. None of them reaches a column,
   additional_info or source_capture: both JSONB payloads are built from an explicit key ALLOWLIST
   and then passed through strip_pii_fields(), and every free-text field goes through redact_pii().
   An allowlist, not a blocklist, so a contact key added upstream tomorrow cannot arrive by default.

     AND THE ONE HOLE redact_pii() DOES NOT COVER IS CLOSED HERE. The shared redactor removes
   contact CHANNELS (phones, emails, wa.me/t.me handles) but does not claim to remove a person's
   NAME from prose — names are dropped at the KEY level by strip_pii_fields(), which cannot reach a
   name typed inside a text field. A poisoned «… الأستاذ محمد العتيبي …» therefore survives
   redaction and would land in the `description` column. See trap 9: on this platform that field is
   not prose at all, which is what lets it be gated by shape instead of scrubbed.

9. `description` IS A STREET-GEOMETRY NOTE FIELD, NOT PROSE. Measured over every description the
   platform publishes — 574 of 3,712 pieces, 153 distinct values, longest 58 characters — all 574
   consist only of direction words, «شارع»/«ممر»/«ميدان», «عرض»/«بطول»/«هيكلي», digits, «م» and the
   separators «&»/«و» («جنوبا شارع عرض 15م & شمالا ممر بطول 45م & غربا ممر عرض 10م»). There is no
   marketing copy, no name and no contact detail anywhere in the field, on any row.
     So the value is accepted against the field's OWN measured vocabulary and anything else is
   dropped whole and recorded in additional_info, which closes trap 7's name hole by construction
   rather than by trying to detect names. All 574 real notes pass; every poisoned shape tried is
   refused. redact_pii() still runs first, so the two barriers compose.

8. NO DISTRICT IS PUBLISHED, so none is invented. The only location text is the plot's `location`
   — «الطائف», «وسط بريدة», «شمال بريدة» on the four selling plots: a city or a compass sector of
   one, never a district. It is passed to the shared city-scoped find_district_in_text() and
   resolves to nothing, so district_ar is NULL on all 398 and the raw text is kept in
   `neighborhood`. The plot NAME is deliberately NOT searched for a district: «مخطط الملقا» is in
   بريدة while «حي الملقا» is a RIYADH district (verified against loc_catalog_district — بريدة has
   no الملقا), so matching a marketing name would file Buridah land under a Riyadh district. A
   brand is not a location.

RENT: THERE IS NONE, AND NOTHING DEFAULTS TO ANNUAL
---------------------------------------------------
Every piece is a sale. The platform publishes no rent, no deal-type field, no period field of any
kind (all 26 piece keys and all 30 plot keys checked), and no per-listing period statement. So
`transaction_type` is the literal "Buy", and `rent_period` / `price_annual` are NEVER written —
not NULL-by-accident but never reached, because the price goes to `price_total`. sokok is
deliberately absent from SINGLE_PERIOD_PLATFORMS: the platform makes no period statement to honour.
Should sokok ever publish a rent, `purpose`/`status` would be unchanged and the row would still be
mapped as a Buy — so the mapper REFUSES any deal word it does not know instead, and there is a test
that a rent-ish record cannot silently become an annual price.

REMOVAL ORACLE (measured 2026-09-25 — the status the page prints about ITSELF)
-----------------------------------------------------------------------------
Every one of the five statuses was fetched on a real piece and the detail page printed it back,
agreeing with the list endpoint every time:

    404                                  → gone   (ids 99999 and 999999999 both answered 404 with
                                                   Laravel's own 6,603-byte error page; id 1 is a
                                                   REAL piece and answered 200, so the 404 is about
                                                   the id and not about the route)
    200 + status «متاحة»                 → live   (id 234328899; self-heal for a row absent from
                                                   our crawl but still on the market)
    200 + status «مباعة» / «محجوزة» /     → gone   (ids 1522 / 1581 / 1757 / 234327981 — the source
            «قريباً» / «موقفة من الشركة»          itself says it is not on the market, and none of
                                                   the four publishes a price)
    200 + no status in the props          → UNKNOWN
    unreachable / 403 / 429 / 5xx         → UNKNOWN (the shared law, which cannot be relaxed here)

A 200 is therefore NOT read as life: a sold piece keeps its page forever (id 1522 serves 397KB of
its own content). Removals are additionally gated by an in-run positive control that fails CLOSED,
and pruning only runs when every plot was served complete AND every available piece was fetched —
so the pieces-API incompleteness described above can never present itself as a removal.

COVERAGE (full live crawl of the whole catalogue, 2026-09-25; nothing written)
-----------------------------------------------------------------------------
11 plots in the roster → 3,824 pieces on their maps (equal to the roster's own per-plot
`pieces_count`, plot by plot) → 398 «متاحة» fetched → 398 mapped, 0 of the fetched rows skipped.
complete=True. Four plots are selling: بوابة الطائف 72, مخطط الصفوة 89, مخطط الملقا 4,
مخطط التوفيق 233 — which is each plot's published `pieces_available_count`, exactly.
  368 Residential Land + 30 Commercial Land · 100% Buy · بريدة 326, الطائف 72
Not fetched, counted from the map's own colours: coming_soon_qaribaan 1,024 (#ffa500, equal to the
API's «قريباً» count) and sold_or_withdrawn 2,402 (#f93a2f). 1,024 + 2,402 + 398 = 3,824.
  price_total 398 (165,740 … 2,241,322) · price_per_meter 398 (400 … 3,000) · both verbatim
  price_annual 0 · rent_period 0 — the platform has no rents, so neither key is ever written
  area_m2 398 · plan_parcel 398 · license_number 398 (4 distinct REGA numbers) · project_name 398
  neighborhood 398 · district_ar 0 (none published — trap 8) · title 398
  direction 396 — the 2 NULLs are the two multi-frontage parcels («شمالية جنوبية شرقية غربية» and
    «شرقية غربية»), which are not ONE direction and are correctly refused
  street_width_m 4, from the 4 available pieces that publish a street note (all «شارع 15م غرب»-
    shaped, all 15 m) · description 4 (the same 4)
  electricity 398 · water_supply 398 — all four selling plots publish «كهرباء» and «ماء»
  sanitation 0 · optical_fibers 0 (trap: «تصريف سيول» is not sewage, «إنترنت» is not fibre)
  photo_urls 0 (presigned, trap 6) · property_age 0 · bedrooms/bathrooms/halls 0 (bare land)

COMPLETENESS IS RELATIVE TO THE PLATFORM'S OWN PUBLISHED ROSTER. complete=True means every plot in
/api/v1/plots was served with its full map AND every available-coloured piece was read. Plot 18 is
absent from that roster and is therefore outside the claim, not silently inside it — see the open
question below.

OPEN QUESTIONS FOR ONBOARDING (none of these is guessed in code)
----------------------------------------------------------------
  · PLOT 18 «قطع أقل من 100 ألف» is skipped whole, and its 3 available pieces (ids 234328347,
    234328348, 234328349, priced 67,026.00 / 67,026.00 / 65,623.62) are the only source-published
    available pieces this build does not map. It is absent from /api/v1/plots (both pages), its
    map has ZERO features, its `location` is «متفرق» (assorted) and its `license_number` is 0 —
    no REGA advertising licence, which CLAUDE.md makes a hard requirement. Listing them would also
    require keeping the unreliable pieces API, since no plot map reaches them. Owner decision:
    publish them under some other licence, or leave them out?
  · «تصريف سيول» (storm-water drainage, on 9 of 11 plots) is deliberately NOT mapped to
    `sanitation` — that column means «صرف صحي» (sewage), which this platform never mentions. So
    sanitation stays NULL on all 398. Is storm drainage meant to answer the sanitation filter?
  · «إنترنت» (8 plots) is not mapped to `optical_fibers`: internet service is not «ألياف ضوئية».
    «إنارة» (street lighting, 4 plots) has no column at all. Both are kept in additional_info.
  · The services/facilities lists are published on the PLOT, so electricity/water are the
    developer's statement about the subdivision, attributed to each piece inside it. Correct, or
    should a plot-level utility stay out of a per-piece column?
  · PER-METRE SEARCH WILL NOT MEAN WHAT A USER THINKS on this platform, and that is a product
    decision, not a scraper one. `price_per_meter` stores the «سعر المتر» the source prints (2,200
    on block 12), while the total the buyer actually pays works out to 2,374.12 per m² (trap 1). A
    user filtering on price-per-metre therefore matches the printed rate, not the effective one.
    Both numbers are recoverable from the row (source_price_raw ÷ source_area_raw gives the
    effective rate), so whichever the owner wants shown or searched is available — but the choice
    has to be theirs. Storing the derived one instead would violate PRICE = SOURCE.
  · Photos need either a public bucket base or a mirror before any sokok image can be shown
    (trap 6).
  · `pieces_sales_percent` and the plot `status` contradict `pieces_available_count` on plot 16
    (trap 3) — worth telling the platform, since their own site shows a sold-out badge over 233
    pieces they are still selling.

DETAIL, MEASURED
----------------
  · `type` is "piece" and `buyable_type` "App\\Models\\Piece" on all 3,712 — no other kind of
    buyable exists, and a row that is neither skips rather than being mapped as land.
  · `front` is a frontage compass word, 15 distinct values across the catalogue. 12 are one
    direction or a diagonal and go through the shared one_direction(diagonal=True). The
    multi-frontage forms («شمالية جنوبية», «شرقية غربية», «شمالية جنوبية شرقية غربية» …) are NOT one
    direction and the helper already returns None for them, which is the right answer — and they DO
    occur among the listings: 2 of the 398 (SKK234328923 «شمالية جنوبية شرقية غربية» and
    SKK234329025 «شرقية غربية») store direction NULL and keep the raw word in additional_info.
  · CITY comes from the plot's own `city.name`, which is ENGLISH ("Taif", "Buridah", "Riyadh") and
    does NOT survive the shared map_city_en (Buridah → None). It is therefore translated by an
    explicit 3-entry measured map to Arabic and then resolved by the shared to_catalog(): الطائف
    → city 5, بريدة → 11, الرياض → 3, all three verified present in loc_catalog_city. A fourth
    English city would skip as city_untranslated rather than be transliterated by guesswork.
  · `number` is «رقم القطعة» → plan_parcel. The PLOT's `number` («2530», «0400/0401/003453») is the
    plan number and has no column; it goes to additional_info with `block_number`.
  · `area` is a formatted string with thousands commas AND real decimals ("1,298.89"), so it is
    parsed by to_int() and never to_int_numeric() — float("1,298.89") raises and would have left
    area_m2 NULL on the largest pieces. area_m2 is INTEGER, so the exact published string is kept
    in additional_info.source_area_raw.
  · `license_number` is per PLOT (10 distinct REGA numbers) and shared by its pieces; plot 7 and
    plot 1 share 7200000364. A `0` is not a licence and is stored as NULL.
  · `coordinates` (a GeoJSON polygon per piece) and `map` (lat/long) are published on every row,
    but the listing tables carry no geometry column, so neither is stored.
  · `description` is null on 3,138 of 3,712 and is a short street note when present. It is NEVER
    read for a price (prose prices are banned fleet-wide) — only street_from_prose() touches it.
  · Not published anywhere: any bedroom/bathroom/hall count, age, furnishing, floor. Bare land.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http import TRANSIENT_STATUSES  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://sokok.sa"
PLOTS_API = f"{BASE}/api/v1/plots"
SOURCE = "صكوك العقارية"
PREFIX = "SKK"
SLUG = "sokok"

# `x-ratelimit-limit: 60` per minute, read off the response. 1.15s keeps us under it with headroom;
# an unpaced walk took a hard 429 at request ~50.
MIN_INTERVAL = 1.15

# props.pieces_features[].properties.color → what the map paints. Used ONLY to choose which pieces
# to FETCH and to COUNT what was not fetched; the listing decision is always the piece's own
# published `status`. Every one of the three was validated against the platform's own totals rather
# than read off the palette: green summed to 72/89/4/233 = 398 = each plot's published
# `pieces_available_count`, and orange summed to 1,024 = exactly the number of pieces the API
# reports as «قريباً». Red is the remainder, 2,402 (sold + reserved + withdrawn).
AVAILABLE_COLOR = "#93c572"
_COLOR_EXCLUSION = {"#ffa500": "coming_soon_qaribaan_not_fetched",
                    "#f93a2f": "sold_or_withdrawn_not_fetched"}

# The source's own `status.name` that means "on the market". Every other published word is a skip
# with its own count, and none of the others carries a price on any of 3,432 captured rows.
AVAILABLE = "متاحة"
_SKIP_FOR_STATUS = {
    "مباعة": "sold_mabaa",
    "محجوزة": "reserved_mahjooza",
    "قريباً": "coming_soon_qaribaan",          # the off-plan / not-yet-selling marker
    "موقفة من الشركة": "withdrawn_by_company",
}

# `purpose` → the source's own Arabic LAND phrase, so the shared TYPE_MAP_AR canon decides the
# fleet type rather than a local English literal. NOT `system` — that is the permitted building
# system («فلة»/«وحدة»/«تجاري») and reading it as a type would file bare land as a built villa.
_PURPOSE_LAND_AR = {"سكني": "أرض", "تجاري": "أرض تجارية"}

# plot.city.name is ENGLISH and map_city_en("Buridah") is None, so the three measured values are
# translated explicitly. A fourth city skips as city_untranslated rather than being transliterated.
_CITY_EN_AR = {"Taif": "الطائف", "Buridah": "بريدة", "Riyadh": "الرياض"}

# plot.services[].name → the column the source's own word states. Positive-only: a service the
# source omits is UNKNOWN, never False. «تصريف سيول» (storm drainage) is NOT sanitation («صرف
# صحي»), «إنترنت» is NOT optical fibres, «إنارة» has no column — all three are open questions and
# are kept as raw words instead of being forced into a column.
_SERVICE_COLS = {"كهرباء": "electricity", "ماء": "water_supply"}

# `description` IS A STREET-GEOMETRY NOTE FIELD, NOT PROSE — and that is what makes it storable
# under PDPL. Measured over every description the platform publishes (574 of 3,712 pieces, 153
# distinct values, longest 58 characters): all 574 consist only of direction words, «شارع»/«ممر»/
# «ميدان», «عرض»/«بطول»/«هيكلي», digits, «م» and the separators «&»/«و». There is no marketing
# prose, no name and no contact detail anywhere in the field.
#
# So the field is accepted on its OWN measured vocabulary rather than scrubbed for PII. That
# matters because the shared redact_pii() removes contact CHANNELS (phones, emails, wa.me/t.me
# handles) but does not claim to remove a person's NAME from prose — names are dropped at the KEY
# level by strip_pii_fields(), which cannot reach a name typed inside a text field. A poisoned
# «... الأستاذ محمد العتيبي ...» would therefore survive redact_pii() and land in the `description`
# column, which PDPL forbids. A shape whitelist closes that by construction: anything that is not
# the street note this field has only ever contained is dropped entirely and counted in
# additional_info, so no amount of injected prose can reach a column. All 574 real notes pass and
# every poisoned shape tried fails (see the test). Contact channels are still redacted first, so
# the two barriers compose rather than replace each other.
_NOTE_VOCAB = (r"شارع|ممر|ميدان|عرض|بطول|هيكلي"
               r"|شمالا|جنوبا|شرقا|غربا|شمال|جنوب|شرق|غرب"
               r"|شمالي|جنوبي|شرقي|غربي|شماليه|جنوبيه|شرقيه|غربيه|و|م")
_STREET_NOTE_RE = re.compile(rf"^(?:\s|&|,|\.|\d|[٠-٩]|{_NOTE_VOCAB})+$")

# Keys copied into additional_info / source_capture. An ALLOWLIST, so a contact key added upstream
# tomorrow cannot arrive by default (PDPL, trap 7). `contact`, `advertiser_mobile`, `owner`,
# `owner_identity`, `owner_logo*` are absent from it on purpose.
_PIECE_CAPTURE_KEYS = (
    "id", "type", "buyable_type", "plot_id", "number", "block_number", "area", "front", "purpose",
    "system", "street", "status", "meter_price", "price", "raw_price", "sort", "description",
    "virtual_tour_url",
)
_PLOT_CAPTURE_KEYS = (
    "id", "name", "number", "license_number", "city_id", "location", "area", "status_id",
    "pieces_count", "pieces_available_count", "pieces_sales_percent", "show_list",
)
# Of those, the keys that carry PROSE — where an advertiser's own phone or WhatsApp link hides.
_FREE_TEXT = frozenset({"description", "name", "location"})


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")     # impersonate OWNS the User-Agent
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


def _clean(v) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


def _pos(v) -> Optional[int]:
    """A positive measure, or None. Parsed with to_int(): `area` is "1,298.89" — a thousands comma
    AND real decimals — and to_int_numeric() would raise inside float() and return None."""
    n = normalize.to_int(v)
    return n if n and n > 0 else None


def _licence(v) -> Optional[str]:
    """The plot's REGA advertising licence. A `0` is not a licence number (plot 18) → NULL."""
    s = _clean(v)
    return None if s in (None, "0") else s


# ── PRICE ────────────────────────────────────────────────────────────────────────────────────────
def piece_prices(piece: dict[str, Any]) -> tuple[Optional[int], Optional[int]]:
    """(price_per_meter, price_total) — BOTH source-published, NEITHER derived from the other.

    THE TRAP THIS EXISTS TO REFUSE (trap 1, measured on 162 available pieces): `price` is never
    meter_price × area. It matched the product on ZERO of 162; id 234329078 publishes
    meter_price 2,200.00 and area 660.00 — a product of 1,452,000 — against a published price of
    1,566,920.00, and two pieces with different (mp, area) publish the same total. So there is no
    arithmetic between the two figures to be had, in either direction:

      · price_total is `price`/`raw_price` and is NEVER computed from meter_price × area;
      · price_per_meter is `meter_price` and is NEVER computed from price ÷ area.

    Whichever figure the source omits stays NULL. `raw_price` is preferred over `price` only
    because it needs no parsing — the two agreed on 280/280, so this can never be a
    reconciliation. The bigint column takes the floored riyal the source itself displays; the exact
    published string with its halalas is kept in additional_info and in price_evidence.raw.
    """
    ppm = _pos(piece.get("meter_price"))
    raw = piece.get("raw_price")
    total = normalize.to_int_numeric(raw) if raw is not None else normalize.to_int(piece.get("price"))
    return ppm, (total if total and total > 0 else None)


def map_listing(piece: dict[str, Any], plot: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) for ONE piece. row is None exactly when a reason is set."""
    pid = _clean(piece.get("id"))
    if not pid:
        return None, "residential", "no_id"
    if _clean(piece.get("type")) != "piece":
        return None, "residential", f"not_a_piece_{_clean(piece.get('type')) or 'blank'}"

    # The source's own word for "is this on the market". Anything but «متاحة» is skipped under the
    # source's own marker — never a heuristic, never a guess from the map colour.
    status_ar = _clean((piece.get("status") or {}).get("name"))
    if status_ar != AVAILABLE:
        return None, "residential", _SKIP_FOR_STATUS.get(status_ar or "",
                                                         f"status_unknown_{status_ar or 'blank'}")

    # `purpose` is the only type statement. `system` («فلة») is the permitted BUILDING system and is
    # never read as a type — that would file a bare surveyed parcel as a built villa (trap 4).
    purpose = _clean(piece.get("purpose"))
    land_ar = _PURPOSE_LAND_AR.get(purpose or "")
    if not land_ar:
        return None, "residential", f"purpose_unmapped_{purpose or 'blank'}"
    property_type = normalize.map_type_exact(land_ar)
    if not property_type:
        return None, "residential", f"type_unmapped_{land_ar}"
    category = normalize.category_for_type(property_type).lower()

    city_en = _clean((plot.get("city") or {}).get("name"))
    city_ar = _CITY_EN_AR.get(city_en or "")
    if not city_ar:
        return None, category, f"city_untranslated_{city_en or 'blank'}"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"

    # The plot's `location` is the only location text — a city or a compass sector of one. It is
    # searched for a district by the shared city-scoped helper and resolves to nothing on all four
    # selling plots. The plot NAME is deliberately NOT searched: «مخطط الملقا» is in بريدة while
    # «حي الملقا» is a RIYADH district, so a brand would become a location (trap 8).
    location_raw = _clean(plot.get("location"))
    district_ar = find_district_in_text(location_raw, city_id)

    # Contact channels first, then the field's own measured shape: a value that is not the street
    # note this field has only ever held is dropped rather than stored (see _STREET_NOTE_RE).
    raw_note = redact_pii(_clean(piece.get("description")))
    is_note = bool(raw_note and _STREET_NOTE_RE.match(raw_note))
    desc = raw_note if is_note else None
    # The ONLY thing the note is read for. There is no structured street width on the platform, and
    # `street` is a COUNT of frontages with no digit in it (trap 5). A price is NEVER read here.
    street_w, _street_dir = normalize.street_from_prose(desc)

    services = [_clean((s or {}).get("name")) for s in (plot.get("services") or [])]
    facilities = [_clean((f or {}).get("name")) for f in (plot.get("facilities") or [])]
    # Positive-only: a service the source names is True, one it omits stays NULL.
    service_cols = {_SERVICE_COLS[w]: True for w in services if w in _SERVICE_COLS}

    ppm, total = piece_prices(piece)
    number = _clean(piece.get("number"))
    block = _clean(piece.get("block_number"))
    plot_name = _clean(plot.get("name"))

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": f"{BASE}/piece/{pid}/show",
        "source": SOURCE,
        "active": True,
        # Composed from source-published facts only — the fleet's sodasyat/villassa precedent. No
        # number in it is invented: the type word, the parcel number, the block and the plot name.
        "title": " - ".join(filter(None, (
            f"{land_ar} رقم {number}" if number else land_ar,
            f"بلوك {block}" if block else None, plot_name))),
        "description": desc,
        **service_cols,
        "property_type": property_type,
        # Every piece is a SALE. The platform publishes no rent, no deal field and no period field
        # anywhere (trap: RENT, above), so this is a literal and `rent_period`/`price_annual` are
        # never written — not defaulted to annual, never reached.
        "transaction_type": "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": location_raw,
        "project_name": plot_name,                       # the «مخطط» this parcel belongs to
        "area_m2": _pos(piece.get("area")),
        "direction": normalize.one_direction(piece.get("front"), diagonal=True),
        "street_width_m": street_w,
        "plan_parcel": number,                           # «رقم القطعة»
        "license_number": _licence(plot.get("license_number")),
        "price_per_meter": ppm,                          # «سعر المتر» — a RATE, published as such
        "price_total": total,                            # the published total — NOT ppm × area
        # Presigned and dead within the hour, so nothing is stored (trap 6).
        "photo_urls": None,
    }
    row["price_evidence"] = normalize.price_evidence(
        field="piece.price", raw=piece.get("price"), stored=total, kind="total",
        unit="total", origin="api",
        # The source AFFIRMATIVELY publishes no price for a non-available piece — but this mapper
        # only ever reaches here for «متاحة», and all 280 captured متاحة rows carried one. So a
        # missing price here is a READ failure, not an authoritative absence.
        authoritative_absent=False)
    images = [i for i in (piece.get("images") or []) if isinstance(i, dict)]
    row["images_evidence"] = {
        "observed": True, "container_present": "images" in piece, "key_present": bool(images),
        "count": 0,                       # stored count: presigned URLs are never kept (trap 6)
        "source_count": len(images), "not_stored_reason": "presigned_url_expires_3600s"}

    info = {
        "source_id": pid,
        "purpose_ar": purpose,
        "system_ar": _clean(piece.get("system")),        # the permitted BUILDING system, NOT a type
        "street_frontage_ar": _clean(piece.get("street")),   # a COUNT of frontages, not a width
        "front_ar": _clean(piece.get("front")),
        "block_number": block,
        "source_area_raw": _clean(piece.get("area")),    # exact m², before area_m2's INTEGER round
        "source_price_raw": _clean(piece.get("price")),  # exact riyals+halalas, before the bigint
        "source_meter_price_raw": _clean(piece.get("meter_price")),
        "source_status_ar": status_ar,
        # Counted rather than silent: the source published something in `description` that is not
        # the street note the field has only ever held, so it was dropped instead of stored.
        "description_dropped_not_a_street_note": True if (raw_note and not is_note) else None,
        "plot_id": _clean(plot.get("id")),
        "plot_name_ar": plot_name,
        "plot_plan_number": _clean(plot.get("number")),  # the «مخطط» plan number — no column
        "plot_location_ar": location_raw,
        "plot_area_m2": _pos(plot.get("area")),
        # Kept so trap 3's contradiction stays auditable from the row alone: plot 16 publishes
        # «تم البيع» / 100% over 233 pieces it is still selling.
        "plot_status_id": _clean(plot.get("status_id")),
        "plot_sales_percent": _clean(plot.get("pieces_sales_percent")),
        "plot_services_ar": [s for s in services if s] or None,
        "plot_facilities_ar": [f for f in facilities if f] or None,
        # The stable half of the presigned photo URLs — the object keys, so a future mirror can
        # resolve them without re-crawling (trap 6).
        "image_object_paths": [p for p in (_object_path(i.get("url")) for i in images) if p] or None,
        "virtual_tour_url": _clean(piece.get("virtual_tour_url")),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v is not None})
    # Redact the free-text keys HERE rather than leaning on db.redact_capture(): a barrier after the
    # row has left the mapper is not this mapper's guarantee. Numbers, licences and ids are
    # untouched. `contact` / `advertiser_mobile` / `owner*` are simply not in either allowlist.
    # `description` is the shape-gated value, NOT the raw one: the capture is private but "private"
    # is not "may accumulate names an advertiser typed into a text field".
    row["source_capture"] = strip_pii_fields({
        "schema": "sokok.piece.show.v1",
        **{k: (desc if k == "description" else redact_pii(piece[k]) if k in _FREE_TEXT
               else piece[k])
           for k in _PIECE_CAPTURE_KEYS if k in piece},
        "plot": {k: (redact_pii(plot[k]) if k in _FREE_TEXT else plot[k])
                 for k in _PLOT_CAPTURE_KEYS if k in plot},
    })
    return row, category, ""


def _object_path(url) -> Optional[str]:
    """The stable object key out of a presigned URL — the path, with the signature dropped."""
    s = _clean(url)
    return s.split("?", 1)[0].rsplit("/", 1)[-1] if s else None


# ── FETCH ────────────────────────────────────────────────────────────────────────────────────────
_INERTIA_RE = re.compile(r'data-page="([^"]+)"')


class Crawl:
    """Paced reads. 60 req/min is published in `x-ratelimit-limit` and enforced; an unpaced walk
    took a hard 429 at request ~50, so every read goes through here."""

    def __init__(self, s: cc.Session) -> None:
        self.s = s
        self.last = 0.0

    def get(self, url: str, timeout: int = 60):
        for attempt in range(4):
            wait = MIN_INTERVAL - (time.monotonic() - self.last)
            if wait > 0:
                time.sleep(wait)
            r = self.s.get(url, timeout=timeout)
            self.last = time.monotonic()
            if r.status_code == 429:
                time.sleep(20 * (attempt + 1))      # published limit is per MINUTE
                continue
            if r.status_code not in TRANSIENT_STATUSES:
                return r
            time.sleep(2 * (attempt + 1))
        return r

    def inertia(self, url: str) -> tuple[Optional[int], Optional[dict]]:
        """(status, props) for an Inertia page. A 200 we cannot parse returns props None, which
        every caller treats as "no answer" — never as an empty catalogue."""
        r = self.get(url)
        if r.status_code != 200:
            return r.status_code, None
        m = _INERTIA_RE.search(r.text or "")
        if not m:
            return r.status_code, None
        try:
            page = json.loads(html.unescape(m.group(1)))
        except ValueError:
            return r.status_code, None
        props = page.get("props")
        return r.status_code, props if isinstance(props, dict) else None


def fetch_plot_roster(c: Crawl) -> list[dict]:
    """Every plot the platform publishes, over the roster's own `links.next` chain."""
    plots: dict[str, dict] = {}
    url = PLOTS_API
    while url and len(plots) < 500:
        r = c.get(url)
        if r.status_code != 200:
            raise RuntimeError(f"{url} returned {r.status_code}")
        try:
            body = r.json()
        except ValueError as exc:
            raise RuntimeError(f"{url} is no longer JSON: {exc}") from exc
        batch = [p for p in (body.get("data") or []) if isinstance(p, dict)]
        if not batch:
            break
        for p in batch:
            key = _clean(p.get("id"))
            if key:
                plots[key] = p
        url = (body.get("links") or {}).get("next")
    return list(plots.values())


def fetch_plot_map(c: Crawl, plot_id: str
                   ) -> tuple[Optional[list[str]], list[str], dict, dict[str, int]]:
    """(every piece id on the map, the AVAILABLE-coloured ones, the rich plot record, the tally of
    what the other colours were).

    The map is the enumeration AND the completeness oracle: its feature count equalled the
    roster's own `pieces_count` on all eleven plots, and its green count equalled
    `pieces_available_count` on all four selling plots. `None` for the id list means the page did
    not parse — an unknown, never an empty plot.
    """
    _st, props = c.inertia(f"{BASE}/plot/{plot_id}/show")
    if props is None:
        return None, [], {}, {}
    feats = props.get("pieces_features")
    if not isinstance(feats, list):
        return None, [], (props.get("plot") or {}), {}
    every: list[str] = []
    green: list[str] = []
    other: dict[str, int] = {}
    for f in feats:
        pr = (f or {}).get("properties") or {}
        pid = _clean(pr.get("buyable_id"))
        if not pid:
            continue
        every.append(pid)
        color = _clean(pr.get("color"))
        if color == AVAILABLE_COLOR:
            green.append(pid)
        else:
            # Counted by the map's OWN colour so the run reports «قريباً» separately from sold,
            # instead of lumping every unfetched piece into one opaque number.
            why = _COLOR_EXCLUSION.get(color or "", f"map_colour_{color or 'blank'}_not_fetched")
            other[why] = other.get(why, 0) + 1
    return every, green, (props.get("plot") or {}), other


def fetch_piece(c: Crawl, piece_id: str) -> Optional[dict]:
    """THAT piece's own record, off its own page. None means we did not read an answer."""
    _st, props = c.inertia(f"{BASE}/piece/{piece_id}/show")
    if props is None:
        return None
    piece = props.get("piece")
    return piece if isinstance(piece, dict) else None


# ── LIVENESS (measured 2026-09-25; see the docstring — a 200 is NOT proof of life) ───────────────
_STATUS_RE = re.compile(r'"status":\s*\{"id":\s*\d+,\s*"name":\s*"([^"]*)"')


def _status_in_page(body: str) -> Optional[str]:
    """The status the page prints about ITSELF. Read off the raw Inertia payload, where the piece's
    own `status` is the FIRST such object — the plot carries `status_id`, not a `status` object."""
    m = _INERTIA_RE.search(body or "")
    if not m:
        return None
    try:
        props = (json.loads(html.unescape(m.group(1))).get("props") or {})
    except ValueError:
        return None
    piece = props.get("piece")
    if isinstance(piece, dict):
        return _clean((piece.get("status") or {}).get("name"))
    m2 = _STATUS_RE.search(body or "")
    return _clean(m2.group(1)) if m2 else None


def _signal(status, body, _moved) -> Optional[str]:
    """'live' | 'gone' | None — this platform's AFFIRMATIVE signals only; the law does the rest.

    A 200 is deliberately NOT life on its own: a sold piece keeps serving its full page forever
    (measured on id 1522). Only the status the page prints about itself decides, and every one of
    the five published words was fetched and confirmed on a real piece.
    """
    if status == 404:
        return "gone"                   # ids 99999 / 999999999; id 1 is real and answers 200
    if status != 200:
        return None
    said = _status_in_page(body)
    if said is None:
        return None                     # 200 but no status in the props — no opinion
    if said == AVAILABLE:
        return "live"
    if said in _SKIP_FOR_STATUS:
        return "gone"                   # the source itself says it is not on the market
    return None                         # a word we have never measured — no opinion


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None):
        pid = ad_number[len(PREFIX):] if ad_number.startswith(PREFIX) else ""
        if not pid:
            return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
        return LivenessProbe(platform=SLUG, signal=_signal, session=session,
                             url_for=lambda _ad: f"{BASE}/piece/{pid}/show",
                             canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = probe(control["ad_number"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


def crawl(c: Crawl, limit: int = 0) -> tuple[list[dict], dict[str, int], bool]:
    """(rows-as-(piece, plot) pairs, counts of what the source's markers excluded, complete).

    Complete means every plot's map matched the roster's own `pieces_count` AND every
    available-coloured piece was actually read. Only then may anything be pruned — the
    pieces-API incompleteness in the docstring is exactly what this refuses to launder.
    """
    roster = fetch_plot_roster(c)
    if not roster:
        raise RuntimeError(f"{PLOTS_API} published no plots")
    pairs: list[tuple[dict, dict]] = []
    counts: dict[str, int] = {}
    complete = True
    mapped_total = 0
    for p in roster:
        plot_id = _clean(p.get("id"))
        if not plot_id:
            complete = False
            continue
        every, green, rich, excluded = fetch_plot_map(c, plot_id)
        if every is None:
            print(f"  ⚠ plot {plot_id}: map did not parse — plot skipped, run marked incomplete")
            complete = False
            continue
        declared = normalize.to_int_numeric(p.get("pieces_count"))
        if declared and declared != len(every):
            print(f"  ⚠ plot {plot_id}: map has {len(every)} features, roster declares {declared}")
            complete = False
        declared_av = normalize.to_int_numeric(p.get("pieces_available_count"))
        if declared_av and declared_av != len(green):
            print(f"  ⚠ plot {plot_id}: {len(green)} available on the map, roster declares "
                  f"{declared_av}")
            complete = False
        mapped_total += len(every)
        for why, n in excluded.items():
            counts[why] = counts.get(why, 0) + n
        # The roster row wins where it publishes a value; the map page's own `plot` fills the rest —
        # `city` (the object with the city NAME) is published only on the map page, `pieces_count`
        # only on the roster row.
        plot = {**rich, **{k: v for k, v in p.items() if v is not None}}
        for piece_id in green:
            piece = fetch_piece(c, piece_id)
            if piece is None:
                print(f"  ⚠ piece {piece_id}: page did not parse — not mapped, run incomplete")
                complete = False
                counts["piece_unreadable"] = counts.get("piece_unreadable", 0) + 1
                continue
            pairs.append((piece, plot))
            if limit and len(pairs) >= limit:
                return pairs, counts, False
    print(f"{SOURCE}: {len(roster)} plots, {mapped_total} pieces on their maps, "
          f"{len(pairs)} available pieces read; complete={complete}", flush=True)
    return pairs, counts, complete


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    dry = args.dry_run or bool(args.limit)
    # begin_run BEFORE the fetch: a source that goes dark must still leave a scrape_runs row.
    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        pairs, skipped, complete = crawl(Crawl(session()), limit=args.limit)
        if not pairs:
            raise RuntimeError("no available pieces were read")
        for piece, plot in pairs:
            row, cat, why = map_listing(piece, plot)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        notes = _tally(skipped)
        if skipped:
            print("  excluded (source's own markers, not guessed): " + notes)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:20]:
                print(f"   {r0['ad_number']:>12} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):17} {str(r0['city_ar']):8} "
                      f"a={str(r0['area_m2']):>6} ppm={str(r0.get('price_per_meter')):>5} "
                      f"pt={str(r0.get('price_total')):>9} pa={r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} par={str(r0.get('plan_parcel')):>6} "
                      f"sw={str(r0.get('street_width_m')):>4} dir={r0.get('direction')} "
                      f"lic={r0.get('license_number')} ph={len(r0.get('photo_urls') or [])}")
            return 0
        # The public upsert_sokok_*_batch wrappers are added centrally at onboarding; same funnel.
        db._wasalt_batch("sokok_residential_listings", res)
        db._wasalt_batch("sokok_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="sokok_residential_listings", com_table="sokok_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in (("sokok_residential_listings", res),
                              ("sokok_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        elif args.type == "all":
            print("  prune skipped: the crawl was not complete (a plot map or a piece page did "
                  "not match/parse) — absence is never a removal")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(pairs),
                            rows_upserted=len(res) + len(com),
                            notes=f"pruned={pruned} complete={complete} {notes}"[:300],
                            check_tables=["sokok_residential_listings",
                                          "sokok_commercial_listings"])
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
