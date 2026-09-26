"""آي باكس (iBaax) — ibaax.sa. 160 listings, onboarding 2026-09-25.

SOURCE SHAPE (measured live 2026-09-25/26; every number below was captured, not assumed).
The public site (ibaax.sa) is a Nuxt SPA with NO server-rendered pages at all
(`data-ssr="false"`); everything is drawn from its own public JSON API at a DIFFERENT origin,
`https://api.ibaax.sa/api`. No auth, no cookie, no proxy, plain `impersonate="chrome"`:

    GET /api/advertisements?pageNumber=<N>
        → {"status": "success", "data": {"advertisements": [ …10 full records… ],
             "links": {"total": 160, "per_page": 10, "current_page": N, "last_page": 16, …}}}

  `?page=<N>` IS SILENTLY IGNORED — MEASURED, not assumed. `?page=2`, `?page=16`, `?page=200` all
  returned `current_page: 1` with the BYTE-IDENTICAL first 10 rows (verified across all 16
  attempted values). The real parameter is `pageNumber` (verified: `?pageNumber=2` advances to
  `current_page: 2` with 10 DISTINCT rows, and so on through `pageNumber=16`, `last_page: 16`,
  `pageNumber=17` served 0 rows). A crawl that trusted the more obvious `page` name would have
  re-served the same 10 listings forever — `fetch_catalogue`'s own "the page repeated itself, stop"
  guard would have caught the infinite loop, but the CRAWL RESULT would have been 10 of 160 rows,
  parsed as a "complete" 10-row catalogue only by looking small rather than looking wrong, and 150
  live, government-registered ads would never have been written. `per_page`/`perPage`/`limit`/
  `size`/`page_size` were also tried and every one of them is ignored too (still 10 rows/page).

  COMPLETENESS is self-declaring: a full walk (16 pageNumber requests) collected 160 DISTINCT ids
  against `links.total` = 160, and `pageNumber=17` (one past `last_page`) served zero rows. The
  crawl only prunes when the two agree, so a truncated response can never look like a shrunken
  catalogue.

  DETAIL / LISTING URL. There is no addressable per-ad web page. Measured, not assumed:
    · Direct navigation to `https://ibaax.sa/ad-details/<id>` (the shape used inside the app) is a
      hard client-side 404 — the SPA does client-side MODAL routing that never touches the URL bar
      (clicking a card in the live app leaves the address bar at bare `https://ibaax.sa`).
    · The API's own `share_link` (`https://api.ibaax.sa/ad-details/<id>`) is NOT id-aware: fetched
      directly it returns a generic "Save My Place in iBaax" app-install interstitial — BYTE-FOR-BYTE
      the same 3,472-byte page for id 774 (a real, live ad), id 999999 (fabricated) and id 1 (a low
      id no longer in the catalogue). A 200 there proves nothing about any specific listing, so it
      cannot serve as `listing_url` — a link that looks like it points at one ad actually points at
      none of them.
    · The JSON detail endpoint (below) IS id-aware and distinguishing, so it is what `listing_url`
      points at and what the removal oracle probes directly. This is a real, if inelegant, trade
      raised as an open question below — there is no prettier URL to give a human end-user yet.

    GET /api/advertisements/<numeric id>
        → 200 {"status": "success", "data": {…the same shape as one list-page row…}}   (live)
        → 422 {"status": "error", "message": "some thing went wrong"}                  (gone)

  Every field the mapper reads (including the REGA `features`/`utilities` arrays) is ALREADY present
  on the list endpoint's own rows — verified key-for-key identical against the detail endpoint for
  id 774 — so `fetch_catalogue` needs no per-row detail fetch; the detail endpoint exists solely for
  the removal oracle.

THE TRAPS, ALL MEASURED
------------------------
1. THE TOP-LEVEL "SPEC" FIELDS ARE A DEAD FORM. `sizeArea` is 0 on ALL 160 rows — including rows
   whose own REGA `features` state a real, non-zero "Property Area" (id 774: `sizeArea` 0 but
   feature "Property Area" 450) — so `sizeArea` is never read. `bedrooms`/`bathrooms`/`livingRooms`
   are a NEWER form the poster sometimes fills in: 43/160 rows have at least one of the three
   non-zero ("touched"), and on those 43 the REGA "Number of Rooms" feature (a TOTAL room count,
   proven independent — id 513: "Number of Rooms" 3 vs `bedrooms` 1; id 505: 7 vs 4 — same class as
   abaad/tuba's own numberOfRooms trap) frequently disagrees, which is what proves `bedrooms` is a
   REAL, independently-entered bedroom count on those rows and not a copy of the total. The other
   117 rows have ALL THREE fields at exactly 0, with no REGA "Number of Rooms" corroboration
   available to tell "the poster said zero" from "the poster skipped this section" — so the reading
   here is: 0 across all three together means the form was never touched (bedrooms/bathrooms/halls
   all stay UNKNOWN); any of the three being non-zero means the poster used the section, and its OWN
   zeros are then trusted (measured: ids 505/504/298/293/251/230/204, all "Floor" listings, have a
   real non-zero bedrooms+bathrooms alongside a genuine `livingRooms` 0 — the source's own rendered
   answer, not a default). `sizeArea` never participates in this "touched" gate; it is simply dead.

2. LAND: TWO INDEPENDENT PUBLISHED FIGURES, AND A THIRD THAT IS PURE ARITHMETIC. For the source's
   own type «ارض» the REGA features carry "Price per sqm" (a rate) ALONGSIDE "Total Land Price" (a
   sale) or "Total Annual Land Rent" (a rent) — and the latter is measurably `Price per sqm ×
   Property Area`, EXACTLY, on every one of the 19 land rows that publish it (id 755: 23377 × 577.5 =
   13,500,217.5 = the published "Total Land Price" to the decimal; id 607: 8572 × 525 = 4,500,300,
   also exact) — the aqargate/tuba shape (`land_total_price`/`landTotalAnnualRent`), platform
   ARITHMETIC, never an independent statement, and never adopted as our own total.
   The listing's real, independent total is the top-level `price` field — which sometimes agrees
   with rate×area and sometimes does NOT (id 747: `price` 370,000 vs rate×area 368,480; id 746:
   399,000 vs 398,825) — proving `price` is its own published figure, not derived from the rate. Two
   land rows (603) have NO "Total Land Price" at all and their "Price per sqm" feature is IDENTICAL
   to `price` (both 1,400,000) — the poster priced the parcel as a flat total and the per-metre field
   just mirrors it; correctly, `price_per_meter` is only ever stored for the source's own «ارض» type
   (see trap 5), so this row gets no per-metre figure at all (its Property Type is actually «ورشة»,
   see trap 5). So: `price_total`/`price_annual` = the top-level `price`, ALWAYS, verbatim, for every
   category. `price_per_meter` = the "Price per sqm" feature, ALWAYS verbatim, ONLY for «ارض» rows.
   "Total Land Price"/"Total Annual Land Rent" are kept in `additional_info` for audit and NEVER
   written to a price column — storing platform arithmetic as our own total is the exact defect
   `test_no_writer_assigns_the_same_expression_to_total_and_per_metre`-class tests exist to ban.
   "Price per sqm" is ALSO published (non-null) on all 138 non-land rows, and MISMATCHES `price` on 2
   of them (id 753 Istraha: price 3,150,000 vs "Price per sqm" 3,500,000; id 676 Building: 5,600,000
   vs 6,000,000) — proof it is a genuinely separate REGA field there too, not an echo, and exactly
   why it is read ONLY for «ارض»: reading it as a rate for a whole building would be a category error
   the fleet has already ruled out (abaad's own `_PER_METRE_CATEGORIES` gate, applied verbatim here).

3. RENT PERIOD IS A REAL STRUCTURED FIELD, JUST NOT WHERE THE APP's OWN UI SUGGESTS. The top-level
   `rentType` field is the EMPTY STRING on all 160 rows (sale and rent alike) — a dead field, never
   read. The REGA feature "Rent contract duration" IS the real period: "Yearly" (28 rows) or
   "Monthly" (12 rows), present ONLY on rent rows (0/56 sale rows carry it) and absent on the other
   64 of 104 rents. `Yearly` → 'annual', price verbatim (nothing converts). `Monthly` → 'monthly',
   price ×12 (the standard storage conversion). Absent → rent_period stays NULL and the price is
   stored exactly as published — never defaulted, and unlike abaad's silent-rent shape there is no
   owner attestation to fall back on here, because THIS platform states a real period on a real
   fraction of its rows, so silence is genuinely silence rather than a platform-wide omission.
   THE RENDERED PAGE'S OWN <title> IS A DECOY, and this was checked in a real browser, not assumed:
   id 774 has NO "Rent contract duration" feature at all (confirmed on both the list AND detail
   payload), yet the live page's <title> reads "iBaax - 57,000 SAR / **Monthly**" — a client-side
   UI DEFAULT, not a source statement (nothing in the API response says "Monthly" for this ad). The
   period is read from the "Rent contract duration" feature name/value pair alone; the page title
   (and by extension any other UI-only label) is never treated as evidence — the exact same caution
   tuba's own "the sidebar is a decoy" trap teaches.

4. PDPL, AND THIS SOURCE IS A MINEFIELD — WORSE THAN TUBA's. Every record carries a `user` object
   (the poster's full profile: `phone`, `national_id` — a real Saudi national ID, e.g. "1018344034"
   — `name`, `business_name`, `address`, `about`, `avatar`) which is NEVER read into anything, full
   stop. On top of that, the REGA `features` array carries "Phone Number", "Advertiser ID",
   "Advertiser Name" and "responsibleEmployeeName"/"responsibleEmployeePhoneNumber" as ordinary
   name/value pairs on EVERY SINGLE ROW that carries them (160/160, 160/160, 160/160, 149/160,
   149/160) — confirmed rendered on the live page too, beside a "Call me"/"Whatsapp" button. None of
   these five names is ever in the capture allowlist (`_FEATURE_ALLOW` below), so they cannot arrive
   even if the source adds a sixth PII-shaped feature tomorrow.
   AND THE ALLOWLIST ALONE IS NOT ENOUGH, measured exactly like tuba: id 551's own free-text
   `description` embeds "مؤسسة عبدالعزيز عبدالله الجنيدل" (the REGA "Advertiser Name" for that row)
   AND "عبدالعزيز عبدالله عبد العزيز الجنيدل" (the "responsibleEmployeeName", a natural person) —
   the advertiser wrote their own business + personal name into their own ad body. `redact_pii()`
   strips phone/WhatsApp/email patterns but deliberately never strips a bare name, so `_scrub()`
   additionally removes the two REGA-stated names from every free-text value, exactly as tuba does.
   ONE MORE WRINKLE, measured on the SAME row: the responsible-employee name's middle two words are
   spelled "عبدالعزيز" (no space) in the REGA feature but "عبد العزيز" (WITH a space) in the free
   description — the same Arabic compound name written two ways by the same source in the same ad.
   A byte-exact substring removal would have MISSED that occurrence entirely and left a person's name
   sitting in a stored description. `_scrub()` therefore builds its removal pattern with an optional
   space after every "عبد" (see `_name_pattern`), which catches both spellings without touching
   anything else — a narrow, measured fix for the one variation class actually observed, not a
   general Arabic name-fuzzer.
   82/160 descriptions ALSO carry a raw phone number typed by the poster ("… تواصل واتس : 0568288007")
   and 69/160 mention واتس/wa.me — both are exactly what `redact_pii()` exists for.

5. THE APP's OWN CATEGORY DISAGREES WITH REGA's VERIFIED TYPE, AND REGA WINS. `category.name` (an
   English label the poster's own dropdown assigned) is NOT what `property_type` is mapped from.
   Measured: id 603 carries `category.name` "Land" while its REGA "Property Type" feature says
   «ورشة» (Workshop) — a poster mis-filing a workshop under the "Land" tab. Mapping from
   `category.name` would have filed a workshop as Residential Land; mapping from the REGA "Property
   Type" feature (as abaad/tuba both do) gets it right and, not coincidentally, also means this row
   correctly gets NO `price_per_meter` even though its category briefly looked like a land row.
   Every OTHER REGA "Property Type" word in the 160-row corpus is already in the shared
   `normalize.TYPE_MAP_AR` — including the one Studio row (id 726, «شقَّة صغيرة (استوديو)»), whose
   tashkeel is written shadda-before-fatha exactly like abaad's and tuba's own studio rows, so the
   same mark-stripping `_TYPE_OVERRIDES` override (copied verbatim from both) is required and
   sufficient. ZERO type skips over the whole corpus; no new taxonomy word is needed for this
   platform (see the onboarding report for the full word-by-word accounting).

6. A DUPLICATE FEATURE NAME MEANS THE SOURCE DISAGREES WITH ITSELF. 32 of 160 rows carry the
   "Street Width" feature name TWICE in the same `features` array, with genuinely different values
   every time (e.g. id 513: "0" and "1"; id 506: "0" and "15") — never the same value repeated. There
   is no way to tell which of the two the source "really means", so `_feat()` (the single shared
   reader every column pull goes through) returns a value only when a name appears with exactly ONE
   distinct value; on a disagreement it returns None, the same "two conflicting facts are not one
   fact" rule `normalize.one_direction()`/`one_street_width()` already apply to a single cell that
   names two numbers. Both raw values still reach `source_capture` (as a list) for audit.

7. THE FLEET'S OWN DEFAULT HEADER SILENTLY BREAKS THIS SOURCE — CAUGHT ONLY BY A LIVE END-TO-END
   RUN, not by the offline unit tests. Every other scraper in this fleet sends
   `Accept-Language: ar,en;q=0.7` (abaad's and tuba's own `session()`, copied verbatim as the
   starting point here). On iBaax that header FLIPS THE WHOLE VOCABULARY THIS MAPPER IS KEYED ON:
   `features[].name`, `utilities[].name`, `category.name` and `title` are ALL served in whichever
   language `Accept-Language` prefers first — verified by fetching the SAME live id with five
   different header values: "en", "en,ar;q=0.5" and no header at all all serve "Property Type"/
   "City"/"End Date"/…; "ar,en;q=0.7" and "ar" serve «نوع العقار»/«المدينة»/«تاريخ الانتهاء»/… for the
   IDENTICAL row. A first offline pass built entirely against curl captures taken with NO
   Accept-Language header (which happens to default to English) never surfaced this — it was only
   caught by running `fetch_catalogue()` against the live API with the fleet's usual header and
   watching all 160 rows come back `type_unmapped_blank`, because `_feat(rec, "Property Type")`
   was looking for a name the server had stopped sending. `session()` here sends `"en,ar;q=0.5"`
   on purpose — a one-line, easy-to-miss difference from every sibling scraper's `session()`, called
   out explicitly so a future refactor that "cleans up" the header back to the fleet default does not
   silently reintroduce a 100% skip rate.

AUCTIONS AND OFF-PLAN
----------------------
AUCTION: scanned all 160 titles + descriptions for «مزاد» — 0 hits. The guard is shipped anyway
(`_AUCTION_RE`) and counted on every run, because an exclusion that is never re-evaluated fails
silently the day the marketplace adds one (the same reasoning tuba's own auction guard ships on).
OFF-PLAN: NO structured signal for it exists anywhere in this source — no completion/handover date,
no "% sold", no development-stage field among the ~70 distinct REGA feature names this platform
uses, and the ABSOLUTE RULE is to judge readiness from the detail data or a structured field, NEVER
from a title word. Since there is no structured field to read, NO off-plan filter is implemented —
building one from title text would be exactly the guessing the rule forbids. All 160 rows are REGA
ad-licensed listings of existing property posted by individuals/brokerages (iBaax is an ad
marketplace, not a developer sales portal), consistent with zero off-plan vocabulary anywhere in
the corpus.

REMOVAL ORACLE (measured 2026-09-25/26)
----------------------------------------
The detail endpoint answers plainly, in its own status code — no page content to interpret:

    GET /api/advertisements/<id>
        200 {"status": "success", "data": {…}}   → live
        422 {"status": "error", …}                → gone

Validated: 40 ids sampled from the 411 numeric GAPS inside the live catalogue's own id range
(204-774) — ids the platform has clearly issued at some point (they sit inside the live range) but
that are NOT among the 160 currently served — ALL 40 answered 422, 0 counter-examples. 25
interleaved KNOWN-LIVE ids were probed the same way: 19 answered 200 + `"status":"success"`; 6 hit a
connection timeout under the probe's own request rate (status=None) — the shared `http_liveness` law
already treats a timeout as UNKNOWN/retry, never as a kill, so this cost no false removals, only a
retry budget. 0 of the 40 gap ids and 0 of the 19 responsive live ids crossed into the other's
verdict. A completely fabricated id (0, 1, 999999) gets the identical 422 the real gap ids get.
Removals are additionally gated by an in-run positive control that fails CLOSED (`_make_verify_gone`
below), and rows are built entirely from the LIST endpoint, so `mark_direct_alive()` is deliberately
NOT called — that stamp requires a fetch of the listing's own record.

COVERAGE (full walk against the live API, RE-MEASURED 2026-09-26 with the corrected header — trap 7)
------------------------------------------------------------------------------------------------------
160 listings over 16 pageNumber requests, links.total=160, complete=True → 160/160 mapped (150
residential + 10 commercial), ZERO skipped for any reason (re-run end to end against the live API
right before commit, with `to_catalog`/`find_district_in_text` stubbed permissive since this build
environment has no reachable `loc_catalog_*`; real district/city coverage against the production
catalog will differ from "every city resolves" and should be re-measured once this lands where the
DB is reachable). Every one of the 160 REGA "Property Type" words maps through the shared taxonomy
(zero type skips); Deal split 104 Rent / 56 Buy (`isRent`, corroborated 160/160 against the REGA
"Advertisement Type" feature «إيجار»/«بيع»). price_total 56 · price_annual 104 (28 annual + 12
monthly stated, 64 UNKNOWN — never defaulted) · price_per_meter 21 (the 22nd «ارض» row, id 603, is
actually a mis-filed «ورشة» — see trap 5, so it correctly gets none) · area_m2 160 (Property Area) ·
bedrooms/bathrooms/halls 43 (the "touched" rows, trap 1) · license_number 160 · license_expiry 160 ·
date_added 160. Raw (unresolved) city labels observed: 144 «الرياض», 4 «مكة المكرمة», 2 each of
«جدة»/«ضرما»/«قريه ديراب»/«مزارع وادى العماريه»/«حوطه سدير», 1 each of «الدمام»/«المجمعة» — actual
catalog-resolution coverage can only be measured where `loc_catalog_*` is reachable.

OPEN QUESTIONS FOR ONBOARDING (none of these are guessed in code)
--------------------------------------------------------------------
  · There is NO stable, human-browsable per-ad web page (trap "DETAIL / LISTING URL" above) — the
    in-app browser path (PRD's core loop) has nothing to open for this platform yet. `listing_url`
    points at the JSON API endpoint, which is correct for the removal oracle and dead wrong as
    something to hand a user's browser. Does product want a different in-app treatment for iBaax
    (e.g. deep-linking into the iBaax app itself) until/unless the platform ships an addressable page?
  · «ارض» rows whose Main Land Use Type is «تجاري»/«زراعة»/«استعمال مختلط» (commercial/farm/mixed use)
    still carry the bare REGA Property Type «ارض» and so map to Residential Land like every other
    plot in this corpus (abaad precedent: the type word is never second-guessed by a sibling field).
    Should a land parcel whose OWN Main Land Use Type says commercial/agricultural be filed as
    Commercial Land / Farm instead of Residential Land? Raised, not guessed — same shape abaad raised
    for «محطة»/«مجمع».
  · The bedroom/bathroom/hall "touched-form" reading in trap 1 is a measured, principled compromise,
    not a certainty: it cannot distinguish "the poster entered zero" from "the poster skipped this
    entirely" on the 117 rows where all three fields are 0 together. Confirm with the owner that
    treating an all-zero row as UNKNOWN (rather than a real zero-bedroom count) is the right read.
  · «لايوجد خدمات»-class blanket negatives were not observed in this corpus's utilities data (every
    utility entry names a specific amenity), so no blanket-negative handling was needed — flagged in
    case a future capture finds one.

DETAIL, MEASURED
-----------------
  · `status` (top-level) is "active" on all 160 rows; `isFeatured`/`isFavorite` are always False;
    `stc_validated` is always null. None of these carry any information and none is read as a
    liveness signal (the removal oracle is the detail endpoint's own HTTP verdict, trap above).
  · `IsFollowing`/`isFavorite` are PER-VIEWER personalisation echoed back even to an unauthenticated
    request (measured `"IsFollowing": true` on a cold, cookie-less GET) — never listing data, never
    read.
  · Coordinates (`latitude`/`longitude`, and the REGA "Latitude"/"Longitude" features) are published
    on every row but the listing tables carry no coordinate columns, so — same as abaad/tuba — they
    are not stored as columns; the REGA features are kept in `source_capture` only.
  · "Level" (8 rows, plain small integers "1"/"2") maps to `floor_number`. "Number of apartments"
    (3 rows) maps to `num_apartments`. Both are direct 1:1 REGA-feature-to-column matches with no
    surrounding trap.
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
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://api.ibaax.sa/api"
API = f"{BASE}/advertisements"
SOURCE = "آي باكس"
PREFIX = "IBX"
SLUG = "ibaax"

# TASHKEEL IS INVISIBLE AND ITS ORDER IS NOT SEMANTIC — the same defect abaad and tuba both hit. The
# source's studio type «شقَّة صغيرة (استوديو)» is written shadda (U+0651) BEFORE fatha (U+064E); a
# hand-typed copy renders identically and compares UNEQUAL, so marks are stripped before every type
# lookup, protecting the shared TYPE_MAP_AR keys (all mark-free) from a stray diacritic too.
_MARKS = dict.fromkeys(list(range(0x064B, 0x0653)) + [0x0640, 0x0670])


def _strip_marks(s: Optional[str]) -> Optional[str]:
    return s.translate(_MARKS) if s else s


# Keyed on the mark-free form. The value is the fold TYPE_MAP_EN already applies to wasalt's
# "Small apartment (studio)", abaad's, and tuba's own studio rows.
_TYPE_OVERRIDES = {
    "شقة صغيرة (استوديو)": "Studio",
}

# The REGA "Property Type" word whose two land-only price features exist (trap 2). Checked against
# the raw Arabic feature value, never against the app's own `category.name` (trap 5).
_PER_METRE_TYPES_AR = {"ارض"}

# REGA "Rent contract duration" → the fleet's period vocabulary. A DICT, not a ternary on a constant,
# so a value the source does not publish (or does not publish at all) yields None (UNKNOWN) with no
# default branch to fall into.
_RENT_PERIOD = {"Yearly": "annual", "Monthly": "monthly"}

# `utilities[].name` (English, structured) → the column the source's own word states. Positive-only:
# a name the source omits stays UNKNOWN, never False. Names are matched .strip()'d — the source spells
# "Furnished" two ways in the same corpus ("Furnished" and "Furnished ", trailing space).
_UTIL_COLS = {
    "Electrical availability": "electricity",
    "Water availability": "water_supply",
    "Drainage availability": "sanitation",
    "Kitchen": "kitchen",
    "Air conditioner": "air_conditioner",
    "Lift": "elevator",
    "Car entrance": "car_entrance",
    "Maid room": "maid_room",
    "Driver room": "driver_room",
    "Special entrance": "private_entrance",
    "Furnished": "furnished",
}

# «مزاد» anywhere in the listing's own words. Zero rows today; shipped so the exclusion is
# re-evaluated on every run instead of being assumed away (measured 0/160, and counted as 0).
_AUCTION_RE = re.compile(r"مزاد")

# ── PDPL: the feature-NAME allowlist (trap 4) ───────────────────────────────────────────────────
# `features[].name` values allowed into `source_capture`/`additional_info`. "Phone Number",
# "Advertiser ID", "Advertiser Name", "responsibleEmployeeName" and "responsibleEmployeePhoneNumber"
# are ABSENT from this set ON PURPOSE — that is the whole point of an allowlist: a sixth PII-shaped
# feature the source adds tomorrow cannot arrive by default. The top-level `user` object (the
# poster's full profile incl. `national_id`, `phone`, `name`) is simply never read anywhere below.
_FEATURE_ALLOW = frozenset({
    "End Date", "Advertisement Source", "Channels", "Is Halted", "Is Pawned", "City", "City ID",
    "Region", "City Code", "District", "Region ID", "District ID", "Postal Code", "Region Code",
    "District Code", "Building Number", "Additional Number", "Deed Number", "Is Testament",
    "Ad License URL", "Creation Date", "Property Area", "Property Type", "Is Constrained",
    "Price per sqm", "Ad License Number", "Red Zone Type", "Advertisement Type",
    "Property Utilities", "Title Deed Type", "Main Land Use Type", "Obligations on the Property",
    "Brokerage & Marketing License Number", "Street", "Land Number", "Plan Number", "Property Age",
    "Number of Rooms", "Property Facing", "MOJ Deed Location Description", "East Border Name",
    "West Border Name", "North Border Name", "South Border Name", "East Border Description",
    "West Border Description", "North Border Description", "South Border Description",
    "East Border Length (Words)", "West Border Length (Words)", "North Border Length (Words)",
    "South Border Length (Words)", "Rent contract duration", "Total Land Price", "Street direction",
    "Age (Year)", "Street width", "Street Width", "Level", "Living rooms",
    "ownershipTransferFeeType", "Number of apartments", "Total Annual Land Rent",
    "Compliance with Saudi Building Code", "Purpose", "Stores", "Rooms", "Notes",
    "Latitude", "Longitude",
})

# Top-level API keys allowed into `source_capture`. `user` (the whole poster profile) is deliberately
# absent — see trap 4.
_CAPTURE_KEYS = (
    "id", "adNumber", "title", "description", "slug", "countOfViews", "address", "license",
    "price", "isRent", "rentType", "createdAt", "updatedAt", "status",
)
_CAPTURE_FREE_TEXT = frozenset({"title", "description", "address"})


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")     # impersonate OWNS the User-Agent
    # MEASURED, not the fleet's usual default: this API's `features[].name` / `utilities[].name` /
    # `category.name` / `title` are ALL served in whichever language `Accept-Language` prefers FIRST
    # — "ar,en;q=0.7" (the header every other scraper in this fleet uses) flips every one of them to
    # Arabic ("Property Type" → "نوع العقار", "City" → …), which would silently type_unmapped/
    # city_not_in_catalog every single row, since every lookup in this file is keyed on the English
    # name. "en" first keeps them in English, which is what `_FEATURE_ALLOW`/`_UTIL_COLS` are built
    # against.
    s.headers.update({"Accept": "application/json", "Accept-Language": "en,ar;q=0.5"})
    return s


def _clean(v) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


def _pos(v) -> Optional[int]:
    """A positive count/measure, or None. 0/"" mean "not set" for these fields."""
    n = normalize.to_int_numeric(v)
    return n if n and n > 0 else None


def _num(v) -> Optional[int]:
    """A source-published number, 0 INCLUDED — for the "touched" room fields (trap 1), where a
    genuine 0 is the source's own rendered answer once the poster has used that form section at all."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    return normalize.to_int_numeric(v) or (0 if str(v).strip() in ("0", "0.0") else None)


def _feat(rec: dict[str, Any], name: str) -> Optional[str]:
    """The single value a `features[]` entry named `name` states, or None.

    Returns None both when the name is absent AND when it appears more than once with DISAGREEING
    values (trap 6: "Street Width" is duplicated with different numbers on 32/160 rows) — a
    disagreement is not a fact, exactly like `normalize.one_direction()`'s two-bearings-in-one-cell
    rule. Names are read pre-`.strip()`'d: the source trails a space on some ("Furnished ").
    """
    vals = {f.get("value") for f in (rec.get("features") or [])
            if isinstance(f, dict) and (f.get("name") or "").strip() == name}
    return next(iter(vals)) if len(vals) == 1 else None


def _all_feat_values(rec: dict[str, Any], name: str) -> list:
    return [f.get("value") for f in (rec.get("features") or [])
            if isinstance(f, dict) and (f.get("name") or "").strip() == name]


def _utility_words(rec: dict[str, Any]) -> list[str]:
    return [w for u in (rec.get("utilities") or []) if isinstance(u, dict)
            and (w := _clean(u.get("name")))]


# ── PDPL free-text scrub (trap 4) ────────────────────────────────────────────────────────────────
def _name_pattern(name: str) -> re.Pattern:
    """A regex that matches `name` OR the same name with a stray space after any "عبد" run.

    MEASURED, not speculative (id 551): the source's own REGA "responsibleEmployeeName" feature
    spells a compound name "عبدالعزيز" (no internal space) while the SAME source's free-text
    `description`, for the SAME ad, spells the identical name "عبد العزيز" (with a space) — a byte-
    exact `.replace()` (tuba's own `_scrub`) would silently miss that second spelling and leave a
    natural person's name sitting in a stored column. This targets ONLY that one observed variation
    class (an optional space after "عبد"), not a general Arabic name normaliser.
    # ponytail: covers the one measured spacing variant; extend the split set if a future capture
    # shows another compound (e.g. "أبو"/"ابن") splitting the same way.
    """
    parts = re.split(r"(عبدال)", name)
    pattern = "".join(r"عبد\s?ال" if p == "عبدال" else re.escape(p) for p in parts)
    return re.compile(pattern)


def _pii_names(rec: dict[str, Any]) -> tuple[str, ...]:
    """The advertiser / responsible-employee names THIS ad's own REGA features state."""
    return tuple(n for n in (_feat(rec, "Advertiser Name"), _feat(rec, "responsibleEmployeeName"))
                 if n and len(_clean(n) or "") >= 6)


def _scrub(v, names: tuple[str, ...]):
    out = redact_pii(v)
    if isinstance(out, str):
        for n in names:
            out = _name_pattern(n).sub("[redacted]", out)
    return out


def map_listing(rec: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) for ONE advertisement object. row is None exactly when a reason
    is set."""
    pid = _clean(rec.get("id"))
    if not pid:
        return None, "residential", "no_id"

    is_rent = rec.get("isRent")
    if not isinstance(is_rent, bool):
        return None, "residential", f"deal_unknown_{_clean(rec.get('isRent')) or 'blank'}"
    # Written as a two-literal expression so the value can never be anything else even in
    # principle (test_deal_mapping_total: a null deal is quarantined out of search).
    deal = "Rent" if is_rent else "Buy"

    type_ar = _feat(rec, "Property Type")
    property_type = normalize.map_type_exact(_strip_marks(type_ar), _TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", f"type_unmapped_{type_ar or 'blank'}"
    category = normalize.category_for_type(property_type).lower()

    title = _clean(rec.get("title"))
    desc_raw = _clean(rec.get("description"))
    if _AUCTION_RE.search(f"{title or ''} {desc_raw or ''}"):
        return None, category, "auction"

    names = _pii_names(rec)
    desc = _scrub(desc_raw, names)

    city_ar = _feat(rec, "City")
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar, _feat(rec, "Region"))
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_raw = _feat(rec, "District")
    district_ar = (find_district_in_text(district_raw, city_id)
                   or find_district_in_text(title, city_id))

    utility_words = _utility_words(rec)

    # ── ROOMS: the "touched form" reading (trap 1) ────────────────────────────────────────────────
    touched = bool(rec.get("bedrooms") or rec.get("bathrooms") or rec.get("livingRooms"))
    rooms: dict[str, Any] = {}
    if touched:
        rooms["bedrooms"] = _num(rec.get("bedrooms"))
        rooms["bathrooms"] = _num(rec.get("bathrooms"))
        rooms["halls"] = _num(rec.get("livingRooms"))

    photos = [p for m in (rec.get("media") or []) if isinstance(m, dict)
              and m.get("isVideo") is not True and (p := _clean(m.get("previewUrl")))] or None

    # ── PRICE (trap 2). `price` is ALWAYS the listing's own independent total/rent, verbatim, for
    # every category. `price_per_meter` is read ONLY for the source's own «ارض» type, and never
    # derived from — or used to derive — `price`. ─────────────────────────────────────────────────
    price_raw = rec.get("price")
    price_val = normalize.to_int_numeric(price_raw)
    per_metre = type_ar in _PER_METRE_TYPES_AR
    ppm_raw = _feat(rec, "Price per sqm") if per_metre else None
    ppm = normalize.to_int_numeric(ppm_raw) if per_metre else None

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": f"{API}/{pid}",
        "source": SOURCE,
        "active": True,
        "title": _scrub(title, names),
        "description": desc,
        **normalize.amenities_from_text(f"{'، '.join(utility_words)}\n{desc or ''}"),
        **{_UTIL_COLS[w]: True for w in utility_words if w in _UTIL_COLS},
        **rooms,
        "property_type": property_type,
        # `deal` is already provably Buy/Rent from a plain bool — anything else skipped above with a
        # counted reason.
        "transaction_type": deal,
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _pos(_feat(rec, "Property Area")),
        "property_age": normalize.parse_property_age(_feat(rec, "Property Age")),
        "street_width_m": normalize.one_street_width(_feat(rec, "Street Width")),
        "direction": normalize.one_direction(_feat(rec, "Property Facing"), diagonal=True),
        "plan_parcel": _clean(_feat(rec, "Land Number")),
        "street_name": _clean(_feat(rec, "Street")),
        "building_number": _clean(_feat(rec, "Building Number")),
        "additional_number": _clean(_feat(rec, "Additional Number")),
        "zip_code": _clean(_feat(rec, "Postal Code")),
        "license_number": _clean(_feat(rec, "Ad License Number")) or _clean(rec.get("license")),
        "license_expiry": _clean(_feat(rec, "End Date")),
        "ad_source": _clean(_feat(rec, "Advertisement Source")),
        "date_added": _clean(_feat(rec, "Creation Date")),
        "floor_number": _pos(_feat(rec, "Level")),
        "num_apartments": _pos(_feat(rec, "Number of apartments")),
        "price_per_meter": ppm,
        "photo_urls": photos,
    }
    if deal == "Rent":
        period = _RENT_PERIOD.get(_feat(rec, "Rent contract duration") or "")
        row["price_annual"] = (normalize.annualize_rent(price_val, period)
                                if period else price_val)
        if period:
            row["rent_period"] = period
    else:
        row["price_total"] = price_val
    row["price_evidence"] = normalize.price_evidence(
        field="price", raw=price_raw, stored=price_val,
        kind="total" if deal == "Buy" else (row.get("rent_period") or "unconverted"),
        unit="total", origin="api", authoritative_absent=False)
    row["images_evidence"] = {"observed": True, "container_present": "media" in rec,
                              "key_present": bool(rec.get("media")),
                              "count": len(photos or [])}

    info = {
        "source_id": pid,
        "source_ad_number": _clean(rec.get("adNumber")),
        "category_name": (rec.get("category") or {}).get("name"),
        "type_ar": type_ar,
        "advertisement_type_ar": _clean(_feat(rec, "Advertisement Type")),
        "region_ar": _clean(_feat(rec, "Region")),
        "main_land_use": _clean(_feat(rec, "Main Land Use Type")),
        "red_zone": _clean(_feat(rec, "Red Zone Type")),
        "title_deed_type": _clean(_feat(rec, "Title Deed Type")),
        "deed_number": _clean(_feat(rec, "Deed Number")),
        "plan_number": _clean(_feat(rec, "Plan Number")),
        "fal_license_number": _clean(_feat(rec, "Brokerage & Marketing License Number")),
        "is_constrained": _clean(_feat(rec, "Is Constrained")),
        "is_pawned": _clean(_feat(rec, "Is Pawned")),
        "is_halted": _clean(_feat(rec, "Is Halted")),
        "is_testament": _clean(_feat(rec, "Is Testament")),
        "ad_license_url": _clean(_feat(rec, "Ad License URL")),
        "total_rooms": _clean(_feat(rec, "Number of Rooms")),      # a TOTAL, never bedrooms
        "price_is_per_meter": per_metre or None,
        "source_price_per_sqm_raw": ppm_raw,
        # The platform's OWN arithmetic (ppm × area) — kept verbatim for audit, never a price column.
        "platform_land_total_derived": (_feat(rec, "Total Land Price")
                                        or _feat(rec, "Total Annual Land Rent")),
        "rent_contract_duration_raw": _feat(rec, "Rent contract duration"),
        "amenity_words": utility_words or None,
        "channels": _clean(_feat(rec, "Channels")),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v is not None})
    # The capture is PRIVATE but "private" is not "may accumulate contact details" — see trap 4.
    # Built from the two ALLOWLISTS (`_CAPTURE_KEYS`, `_FEATURE_ALLOW`); free-text values are scrubbed
    # HERE rather than leaning on db.redact_capture(): a barrier after the row has left the mapper is
    # not this mapper's guarantee.
    feat_capture: dict[str, Any] = {}
    for f in rec.get("features") or []:
        if not isinstance(f, dict):
            continue
        name = (f.get("name") or "").strip()
        if name not in _FEATURE_ALLOW:
            continue
        vals = _all_feat_values(rec, name)
        feat_capture[name] = vals[0] if len(vals) == 1 else vals
    # redact_capture(), NOT _scrub(): most feature values are bare structured numbers (coordinates,
    # deed numbers, postal/plan codes) that must survive byte-identical. A blanket `_scrub()` here
    # was measured to CORRUPT them — id 774's own "Latitude" (24.845876576604557) and "Deed Number"
    # (5782650508200000) each contain a digit run that coincidentally matches the phone pattern, and
    # a plain regex scrub redacted a chunk out of both, exactly the category error pii.py's own
    # docstring warns about. redact_capture() gates on is_free_text() first, so only genuine prose
    # gets the phone/email/WhatsApp scrub and every structured number passes through untouched. None
    # of the allowed feature NAMES carry a person's name as a value (those names are excluded from
    # `_FEATURE_ALLOW` entirely), so no separate `_scrub()` pass is needed here.
    feat_capture = redact_capture(feat_capture)
    row["source_capture"] = strip_pii_fields({
        "schema": "ibaax.advertisements.v1",
        **{k: (_scrub(rec[k], names) if k in _CAPTURE_FREE_TEXT else rec[k])
           for k in _CAPTURE_KEYS if k in rec},
        "features": feat_capture,
        "utilities": utility_words,
    })
    return row, category, ""


# ── FETCH ────────────────────────────────────────────────────────────────────────────────────────
def fetch_catalogue(s: cc.Session, limit: int = 0) -> tuple[list[dict], bool]:
    """Every advertisement object, plus whether the catalogue was served COMPLETE.

    `pageNumber` is the real page parameter — `page` is silently ignored (see the docstring).
    Completeness means the platform's own `links.total` equals the number of distinct rows we hold;
    only then may anything be pruned.
    """
    rows: dict[str, dict] = {}
    declared: Optional[int] = None
    page = 1
    while True:
        r = None
        for _attempt in range(3):
            r = s.get(f"{API}?pageNumber={page}", timeout=45)
            if r.status_code not in TRANSIENT_STATUSES:
                break
        if r is None or r.status_code != 200:
            raise RuntimeError(f"{API} page {page} returned {getattr(r, 'status_code', 'no response')}")
        try:
            body = r.json()
        except ValueError as exc:
            raise RuntimeError(f"{API} page {page} is no longer JSON: {exc}") from exc
        if not isinstance(body, dict) or not isinstance(body.get("data"), dict):
            raise RuntimeError(f"{API} page {page} is not the expected {{data: {{…}}}} shape")
        data = body["data"]
        links = data.get("links") or {}
        if declared is None:
            declared = normalize.to_int_numeric(links.get("total"))
        batch = [a for a in (data.get("advertisements") or []) if isinstance(a, dict)]
        if not batch:
            break
        before = len(rows)
        for a in batch:
            key = _clean(a.get("id"))
            if key:
                rows[key] = a
        if len(rows) == before:
            break                       # the page repeated itself — stop rather than loop forever
        if limit and len(rows) >= limit:
            return list(rows.values())[:limit], False
        last_page = normalize.to_int_numeric(links.get("last_page"))
        if last_page and page >= last_page:
            break
        page += 1
        if page > 2000:                 # a pagination that never ends is a bug, not a catalogue
            raise RuntimeError(f"{API} still served rows at page {page} — refusing to loop")
    items = list(rows.values())
    complete = bool(declared) and len(items) == declared
    print(f"{SOURCE}: {len(items)} listings over {page} page(s); total={declared} "
          f"complete={complete}", flush=True)
    return items, complete


# ── LIVENESS (measured 2026-09-25/26; see the docstring — the detail endpoint states its own verdict)
def _signal(status, body, _moved) -> Optional[str]:
    """'live' | 'gone' | None — the platform's AFFIRMATIVE signals only; the shared law does the rest.

    A hard 422 is the platform's own "not found" for this resource (measured 40/40 on ids the live
    catalogue no longer serves, 0 counter-examples against 19 responsive known-live controls). A 200
    with a real payload is the same shape the list endpoint itself already trusts.
    """
    if status == 422:
        return "gone"
    if status != 200:
        return None
    try:
        d = json.loads(body)
    except (TypeError, ValueError):
        return None                     # unparseable 200 — no opinion, never a guessed verdict
    if isinstance(d, dict) and d.get("status") == "success" and d.get("data"):
        return "live"
    return None


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None):
        pid = ad_number[len(PREFIX):] if ad_number.startswith(PREFIX) else ""
        if not pid:
            return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
        return LivenessProbe(platform=SLUG, signal=_signal, session=session,
                             url_for=lambda _ad: f"{API}/{pid}",
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
            raise RuntimeError(f"{API} returned no advertisement objects")
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
                      f"{str(r0['property_type']):16} {str(r0['city_ar']):14} "
                      f"d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>6} "
                      f"bd={str(r0.get('bedrooms')):>4} pt={r0.get('price_total')} "
                      f"pa={r0.get('price_annual')} ppm={r0.get('price_per_meter')} "
                      f"rp={r0.get('rent_period')} ph={len(r0.get('photo_urls') or [])}")
            return 0
        db.upsert_ibaax_residential_batch(res)
        db.upsert_ibaax_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="ibaax_residential_listings", com_table="ibaax_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in (("ibaax_residential_listings", res),
                              ("ibaax_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        elif args.type == "all":
            print("  prune skipped: links.total did not match the rows served (incomplete catalogue)")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(items),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} complete={complete} {notes}"[:300],
                             check_tables=["ibaax_residential_listings",
                                           "ibaax_commercial_listings"])
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
