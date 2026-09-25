"""أبعاد (Abaad) — app.abaadapp.sa. 400 listings, onboarding 2026-09-24.

SOURCE SHAPE (measured live 2026-09-24; every number below was captured, not assumed).
A Laravel web app whose «كل العقارات» grid is backed by its own public JSON API — no auth, no
cookie, no proxy, plain `impersonate="chrome"`:

    GET /api/v1/estate/get-estate/all?limit=<N>&offset=<PAGE>
        → {"total_size": 400, "limit": "...", "offset": "...", "estate": [ … ]}

  `offset` IS A PAGE NUMBER, 1-based — NOT a row offset. VERIFIED: limit=200 offset=1/2/3 returned
  200 + 200 + 5 = 405 rows with 405 DISTINCT ids, and limit=1000 offset=1 returned the whole set in
  one response. A row-offset reading would have re-served page 1 three times.

  COMPLETENESS is self-declaring: `total_size` equalled the rows served on every capture
  (405/405 across three pages, then 400/400 at limit=1000). The crawl only prunes when the two
  agree, so a truncated response can never look like a shrunken catalogue.

  THE CATALOGUE CHURNS BY THE DAY — and that is what gave us the removal oracle (below). Between
  two captures ~25 minutes apart it went 405 → 400. The five that left (ids 392, 393, 779, 815,
  833) were EXACTLY the five whose `end_date` was 24/09/2026, i.e. that day; ZERO of the 405 rows
  carried an `end_date` in the past. `end_date` is the REGA ad-licence expiry — the detail page
  prints it as «تاريخ انتهاء رخصة الإعلان» — so the platform publishes an ad until its licence
  expires and then drops it from the list. Stored verbatim in `license_expiry`.

  DETAIL URL. The grid's own template is `href="/details/${estate.id}"`, so listing_url is
  {BASE}/details/<id>. VERIFIED 200 with THAT listing's own content on ids 1112, 1109 and 765
  (each page carries its own `ad_license_number` and `space`). The page's <title> is the same
  title with the type word in English ("Land-نجران-المسماه" for «ارض-نجران-المسماه»).

  PHOTOS. `images` holds bare filenames. The grid template's own base
  (/storage/app/public/estate/) 404s — it is dead. The RENDERED detail page loads them from a
  Cloudflare R2 public bucket, and that base works: two filenames fetched → HTTP 200,
  Content-Type image/webp, no CORP/embedding header. 379/405 rows carry at least one image.
  `video_url` holds a bare filename too ("video_1789621590.mov") and NO base serves it (tried the
  R2 /estate/ and /video/ prefixes and the dead storage path); the `video_url` COLUMN therefore
  stays NULL and the raw filename is kept in additional_info. A URL we cannot resolve is not a URL.

THE FIVE TRAPS, ALL MEASURED
----------------------------
1. LAND PRICE IS PER SQUARE METRE. For the source's own category «ارض» the detail page prints two
   separate rows and names them itself:
        «سعر المتر»      1746        ← the API's `price`
        «إجمالي السعر»   1099980     ← the API's `total_price`
   (verified verbatim on /details/1109, space 630). A non-land page prints ONE row, «السعر»
   700000, and its `total_price` is empty — checked across all 405: `total_price` is non-empty on
   47 of the 48 «ارض» rows and on 0 of the other 357. So `price` is stored in `price_per_meter`
   and `price_total`/`price_annual` come from the source's OWN `total_price`. Storing `price` as
   the listing price would have understated a land listing by ~600×.

   NOTHING IS EVER MULTIPLIED. Two independent reasons, both measured:
     · The 48th land row (id 884: price 450, space 440) publishes NO total at all. Its total is
       UNKNOWN → NULL. `price_per_meter` is still the figure the source printed.
     · On 4 of the 47 that DO publish one, price × space ≠ total_price — id 932 (463 × 16104.66 =
       7,456,457.6 vs the published 7,456,615), 924, 921, 914. The product is not the price; the
       published total is. Both numbers are source-published and both are stored verbatim.
   Land RENTS work the same way (3 of them): id 765 price 18, total_price 425762.22, space
   23653.49 — the per-metre figure is a RATE, the total is the rent.

2. DEAL TYPE is `advertisement_type`: «بيع» → Buy (284), «إيجار» → Rent (121). `type_add` is null
   on all 405 and is ignored. An `advertisement_type` we do not recognise skips the row with a
   counted reason; it is never guessed into one side.

3. RENT PERIOD = SOURCE. The API has no period field of any kind (all 74 keys checked). No period
   is inferred from the size of the number and nothing defaults to annual: the listing's OWN
   title + short_description + long_description go through the shared audited
   normalize.rent_period_and_annual(), and a listing that states nothing keeps rent_period NULL
   with its price stored unconverted. 23 of the 121 rents carry a period-ish word at all. abaad is
   deliberately absent from SINGLE_PERIOD_PLATFORMS — the platform makes no site-wide statement.

4. PDPL. `phoneNumber`, `responsible_employee_phone_number`, `responsible_employee_name`,
   `advertiserName` and the whole `users` object (id/name/email/phone/image — a real broker record)
   are NEVER read into a column, into additional_info, or into source_capture. Both JSONB payloads
   are built from an explicit ALLOWLIST of keys and then run through strip_pii_fields() as a second
   barrier, and every free-text field goes through redact_pii(). An allowlist is used rather than a
   blocklist because `users` carries `name`, which db.redact_capture() deliberately does not treat
   as a contact channel (it must not eat sellerLicenseNumber-style regulatory keys).

5. TWO FIELDS DO NOT MEAN WHAT THEY LOOK LIKE — read off the rendered detail page, not guessed:
     · `street_width` is null on all 405. The real street width is `street_space` (201/405), which
       the page labels «عرض الشارع» (28 on /details/1112) → street_width_m.
     · `numberOfRooms` (344/405) is labelled «عدد الغرف» — TOTAL rooms, not bedrooms. Bedrooms are
       `property[]`'s «غرف نوم» entry, which the page renders with a bed icon. They disagree on 99
       rows (id 1067: numberOfRooms 6, غرف نوم 4) and 38 rows have the bedroom entry and no
       numberOfRooms. numberOfRooms has no column and goes to additional_info.
   A bedroom count of 0 is KEPT, not nulled: the UI renders «0 غرف نوم» as a chip (verified on
   /details/968), so 0 is the source's published answer — the opposite of tamyaz, where the UI
   HIDES a 0 and it means unset.

REMOVAL ORACLE (measured 2026-09-24 — and a 200 is NOT proof of life here)
-------------------------------------------------------------------------
A de-listed ad KEEPS its detail page. All five ids that dropped out of the catalogue during the
capture window still answered 200 with full content minutes later. So an "is it 200?" oracle would
never retire anything, and a "200 means live" oracle would resurrect every dead row forever.

What IS decisive is the licence expiry the page prints about ITSELF — the same field whose passing
is why the catalogue drops the ad. Validated on 12 randomly sampled ids absent from the catalogue:
4 answered 404 (hard-deleted) and the other 8 answered 200 with an expiry in the PAST (07/12/2025 …
01/07/2026), 12/12, with zero counter-examples among the 400 live rows.

    404                                   → gone   (3/3 fabricated ids 0 / 1113 / 999999, and
                                                    ids 415, 459, 701, 813, 838, 970)
    200 + expiry strictly before today    → gone   (the source's own statement)
    200 + expiry today                    → UNKNOWN. The five same-day drops expired ON the day,
                                            so the boundary is real; holding one extra day costs
                                            nothing and cannot kill a live row.
    200 + expiry today or later           → live   (self-heal: absent from OUR crawl, not from the
                                                    platform — id 431 expires 28/09/2026 and is in
                                                    the catalogue)
    unreachable / no expiry on the page   → UNKNOWN

Removals are additionally gated by an in-run positive control that fails CLOSED, and rows are built
from the LIST endpoint, so mark_direct_alive() is deliberately NOT called — that stamp requires a
fetch of the listing's own record.

COVERAGE (full --dry-run against the live API, 2026-09-24)
----------------------------------------------------------
400 listings served over 3 pages, total_size=400, complete=True → 380 mapped (368 residential +
12 commercial), 20 skipped and counted: city_not_in_catalog 18, «محطة» 1, «مجمع» 1.
Deal split 265 Buy / 115 Rent. Types: Apartment 143, Villa 116, Floor 40, Residential Land 39,
Building 19, Room 6, Rest House 5, Showroom 4, Office 4, Studio 3, Hotel 1.
  price_total 264 · price_annual 115 · price_per_meter 39 (38 with a published total, ABD884 NULL)
  rent_period 14 of 115 rents (13 annual + 1 monthly; 101 UNKNOWN) · area_m2 380 · bedrooms 363
  bathrooms 190 · halls 191 · kitchen 169 · district_ar 323 · neighborhood 380 (raw always kept)
  photos 355 · property_age 163 · street_width_m 186 · direction 222 · views_count 281
  plan_parcel 364 · license_number 380 · license_expiry 380 · date_added 380 · description 380
  elevator 63 · maid_room 46 · driver_room 26 · car_entrance 98 · extension 53
  electricity 374 · water_supply 354 · sanitation 272 · optical_fibers 136

OPEN QUESTIONS FOR ONBOARDING (none of these are guessed in code)
-----------------------------------------------------------------
  · «محطة» (1 row) and «مجمع» (1 row) have no safe fleet mapping — station/compound/complex. Bare
    «محطة» is only mustqr's Gas Station in its own Hail context, so both skip, counted.
  · normalize.category_for_type files Studio (and Duplex) as COMMERCIAL fleet-wide, so the 3 studio
    rows land in abaad_commercial_listings. That is the shared rule applied verbatim (wasalt's
    studios go the same way), not an abaad choice — but a studio flat is a dwelling, so whether the
    split is right is a normalize-level question for every platform at once.
  · المجمعة/المجمعه (7 rows), محائل (2), بيش, الحصاد are real Saudi towns missing from
    loc_catalog_city — a catalog gap worth filling, which would recover most of the 18 skips.
  · «لايوجد خدمات» (14 rows): does the owner read it as an explicit NO for electricity/water/
    sanitation, or as unspecified? Currently it sets nothing.
  · `video_url` filenames resolve on no base we could find — ask the platform for the video host.

DETAIL, MEASURED
----------------
  · `status` is "active" and `isValid` is 1 on all 405 — no other value exists, so neither is a
    death signal and neither is read as one.
  · Types: 13 of the 14 source words map through the shared TYPE_MAP_AR. «شقَّة صغيرة (استوديو)»
    (3 rows) is overridden to Studio — the same fold TYPE_MAP_EN already applies to wasalt's
    "Small apartment (studio)". «محطة» (1) and «مجمع» (1) are NOT guessed: bare «محطة» is only
    mustqr's Gas Station in its own Hail context, and «مجمع» could be a compound or a commercial
    complex. Both skip with a counted reason and are raised as open questions.
  · LOCATION: 387/405 cities resolve through to_catalog (region hint = `zone_name_ar`). The 18 that
    do not are real catalog gaps, not scraper failures — المجمعة/المجمعه (7), محائل (2), بيش,
    الحصاد, and eleven plot/estate labels used in the city field («مخطط ال بلحي», «مزارع القرنه
    الجنوبيه», «امارة منطقة الرياض - الدرعيه»). They skip as city_not_in_catalog rather than being
    filed under a neighbour. 330/387 districts resolve exactly against loc_catalog_district; the
    rest keep their raw text in `neighborhood` and leave district_ar NULL.
  · `age_estate` is Arabic word-numerals («سنتين», «اكثر من عشر سنوات», «جديد٠») — the shared
    parse_property_age() handles the whole measured vocabulary.
  · AMENITIES are taken from the two STRUCTURED lists, positive-only: a name the source states is
    True, a name it omits stays NULL. `other_advantages` misspells maid's room as «عرفة خادمة» on
    25 rows (vs «غرفة خادمة» on 3), so both spellings are mapped — reading the structured name
    rather than the prose is what makes the typo harmless.
    «لايوجد خدمات» (14 rows) is an explicit but BLANKET negative — it does not say which of
    electricity/water/sanitation is absent, so no column is set False from it; the phrase is
    preserved in additional_info and raised as an open question.
  · Not published anywhere: build_space, floors, height, width, street_width (0/405 each).
    `latitude`/`longitude` are present on all 405 but the listing tables carry no coordinate
    columns, so they are not stored.
"""
from __future__ import annotations

import argparse
import re
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http import TRANSIENT_STATUSES  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://app.abaadapp.sa"
API = f"{BASE}/api/v1/estate/get-estate/all"
# The base the RENDERED detail page uses. The grid template's /storage/app/public/estate/ 404s.
PHOTO_BASE = "https://pub-4ce088f208944decb4e9cf11054558ea.r2.dev/estate/"
SOURCE = "أبعاد"
PREFIX = "ABD"
SLUG = "abaad"
PAGE_SIZE = 200

# TASHKEEL IS INVISIBLE AND ITS ORDER IS NOT SEMANTIC. The source's studio type is
# «شقَّة صغيرة (استوديو)» written U+0634 U+0642 **U+0651 U+064E** U+0629 … — shadda BEFORE fatha.
# Typing that literal by hand produces fatha-before-shadda, which renders identically and compares
# UNEQUAL, so an override keyed on a hand-typed copy silently never fires (measured: the first build
# skipped all 3 rows as type_unmapped while its own unit test passed on the hand-typed string).
# Marks are therefore stripped before the lookup, which also protects the shared TYPE_MAP_AR keys
# («شقة», «فيلا» …, all mark-free) from a stray diacritic on any future row.
_MARKS = dict.fromkeys(list(range(0x064B, 0x0653)) + [0x0640, 0x0670])


def _strip_marks(s: Optional[str]) -> Optional[str]:
    return s.translate(_MARKS) if s else s


# Keyed on the mark-free form. The value is the fold TYPE_MAP_EN already applies to wasalt's
# "Small apartment (studio)".
_TYPE_OVERRIDES = {
    "شقة صغيرة (استوديو)": "Studio",
}

# The source's OWN category word whose detail page labels `price` «سعر المتر» and `total_price`
# «إجمالي السعر». Keyed on the category rather than on "total_price is present" because the one
# land row that publishes no total is still priced per metre (see trap 1).
_PER_METRE_CATEGORIES = {"ارض"}

_DEAL = {"بيع": "Buy", "إيجار": "Rent"}

# other_advantages[].name / propertyUtilities[] → the column the source's own word states.
# Positive-only: a name that is absent is UNKNOWN, never False.
_AMENITY_COLS = {
    "مصعد": "elevator",
    "مدخل سيارة": "car_entrance",
    "غرفة سائق": "driver_room",
    "غرفة خادمة": "maid_room",
    "عرفة خادمة": "maid_room",      # the platform's own typo, 25 rows (vs 3 spelled correctly)
    "ملحق": "extension",
    "توفر كهرباء": "electricity",
    "كهرباء": "electricity",
    "توفر ماء": "water_supply",
    "مياه": "water_supply",
    "صرف صحي": "sanitation",
    "ألياف ضوئية": "optical_fibers",
}
# property[].name → column. «غرف نوم» is the BEDROOM count; `numberOfRooms` is total rooms.
_ROOM_COUNTS = {"غرف نوم": "bedrooms", "حمام": "bathrooms", "صالات": "halls"}

# Keys copied into additional_info / source_capture. An ALLOWLIST, so a PII key added upstream
# tomorrow cannot arrive by default (PDPL, trap 4).
_CAPTURE_KEYS = (
    "id", "estate_id", "ad_number", "advertisement_type", "category_name_ar", "property_type",
    "price", "total_price", "space", "city", "districts", "zone_name_ar", "status", "isValid",
    "ad_license_number", "end_date", "creation_date", "age_estate", "numberOfRooms", "property",
    "street_space", "property_face", "propertyUtilities", "propertyUsages", "other_advantages",
    "mainLandUseTypeName", "deed_number", "plan_number", "landNumber", "titleDeedTypeName",
    "ownership_type", "view", "video_url", "title", "short_description", "long_description",
)
# Of those, the keys that carry PROSE — where an advertiser's own phone/WhatsApp link hides.
_CAPTURE_FREE_TEXT = frozenset({"title", "short_description", "long_description"})


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")     # impersonate OWNS the User-Agent
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7"})
    return s


def _pos(v) -> Optional[int]:
    """A positive count/measure, or None. 0/"" mean "not set" for these fields."""
    n = normalize.to_int_numeric(v)
    return n if n and n > 0 else None


def _num(v) -> Optional[int]:
    """A source-published number, 0 INCLUDED. Used for bedroom/bathroom/hall counts, which the UI
    renders at 0 («0 غرف نوم» on /details/968) — so 0 is the source's answer, not an unset field."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    return normalize.to_int_numeric(v) or (0 if str(v).strip() in ("0", "0.0") else None)


def _clean(v) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


_WESTERN = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def _states_figure_beside(text: str, price: int, at: int) -> bool:
    """Does the prose print `price` itself within ±90 chars of the period token at `at`?

    Arabic-Indic digits and thousands separators are normalised first, so «٢٣٬٠٠٠» and «23,000» both
    count. Deliberately an EXACT digit match: «٦٠ الف» is an approximation of 60000, not a statement
    of it, and this gate exists to refuse approximations.
    """
    window = text.translate(_WESTERN)[max(0, at - 90):at + 90]
    return re.search(rf"(?<!\d){re.escape(str(price))}(?!\d)",
                     re.sub(r"[,٬،_\s](?=\d{3}\b)", "", window)) is not None


def _rent_fields(price: Optional[int], text: str) -> tuple[Optional[str], Optional[int]]:
    """(rent_period, price_annual) for an abaad rent — the platform's own hardest trap.

    The structured `price` carries NO period: the detail page prints it under a bare «السعر» with no
    qualifier (checked on 7 rent pages). So the only possible period is one the listing's own prose
    states, read by the shared audited parser.

    BUT THE PROSE PERIOD DOES NOT ALWAYS DESCRIBE THAT FIELD, and the mismatch is measured, not
    hypothetical. Across the 22 rents whose text carries a period token:
      · all «سنوي» rows print the SAME figure the structured field holds (23,000 / 20,000 / 26,000 /
        75,000 / 110,000 / 1,300,000 …) — the token is about that price, and 'annual' stores it
        verbatim, so no number can move;
      · the «شهري» rows do NOT. Id 875 publishes `price` 9600 while its prose says «السعر ٨٠٠ ريال
        شهري» — 9600 IS 800×12, i.e. the field is already annual and the prose names the monthly
        instalment. Ids 583 («للايجار الشهري واليومي») and 601 («للإيجار شهري وسنوي») name two
        periods at once, which is no statement about one price at all.
    Handing 875 to the ×12 storage conversion would store 115,200 for a 9,600 listing.

    So a period whose storage conversion CHANGES the number must be corroborated: the prose has to
    print the very figure the structured field holds, beside that period word. Otherwise the period
    is UNKNOWN and the price is stored exactly as published — never inflated, never defaulted.
    'annual' needs no corroboration because it converts nothing.
    """
    period, annual = normalize.rent_period_and_annual(price, text)
    if not period:
        # UNKNOWN period. The price is still the source's own published figure and is stored as
        # such — the same state as the 98 rents that state nothing at all. Note this deliberately
        # does NOT adopt the shared parser's (None, None) for يومي/أسبوعي/نصف سنوي/ربع سنوي: that
        # contract exists for platforms whose price field IS labelled with that period, and here it
        # is not, so discarding the figure would hide a source-published price on the strength of a
        # word that may describe a different number (the 875 lesson). rent_period NULL already keeps
        # the row out of period-scoped rent search. No abaad row currently hits this branch.
        return None, price
    if annual == price:
        return period, annual           # no conversion happened — nothing can have been distorted
    m = normalize._RENT_PERIOD_TOKEN_RE.search(text or "")
    if m and price is not None and _states_figure_beside(text, price, m.start()):
        return period, annual           # the prose states THAT period for THIS very figure
    return None, price                  # uncorroborated conversion → UNKNOWN period, price verbatim


def _amenities(rec: dict[str, Any]) -> tuple[dict[str, bool], list[str]]:
    """The two structured lists → real columns, plus the raw words for the archive."""
    words: list[str] = []
    for a in rec.get("other_advantages") or []:
        w = _clean((a or {}).get("name") if isinstance(a, dict) else a)
        if w:
            words.append(w)
    for u in rec.get("propertyUtilities") or []:
        w = _clean(u if isinstance(u, str) else (u or {}).get("name"))
        if w:
            words.append(w)
    # Positive-only. «لايوجد خدمات» is a BLANKET negative that names no specific utility, so it
    # sets nothing False — it is kept as a raw word and raised as an open question instead.
    return {_AMENITY_COLS[w]: True for w in words if w in _AMENITY_COLS}, words


def map_listing(rec: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) for ONE estate object. row is None exactly when a reason is set."""
    pid = _clean(rec.get("id")) or _clean(rec.get("estate_id"))
    if not pid:
        return None, "residential", "no_id"

    deal = _DEAL.get(_clean(rec.get("advertisement_type")) or "")
    if not deal:
        return None, "residential", f"deal_unknown_{_clean(rec.get('advertisement_type')) or 'blank'}"

    type_ar = _clean(rec.get("property_type")) or _clean(rec.get("category_name_ar"))
    property_type = normalize.map_type_exact(_strip_marks(type_ar), _TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", f"type_unmapped_{type_ar or 'blank'}"
    category = normalize.category_for_type(property_type).lower()

    city_ar = _clean(rec.get("city"))
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar, _clean(rec.get("zone_name_ar")))
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_raw = _clean(rec.get("districts"))
    district_ar = (find_district_in_text(district_raw, city_id)
                   or find_district_in_text(_clean(rec.get("title")), city_id))

    title = _clean(rec.get("title"))
    desc = redact_pii(_clean(rec.get("long_description")) or _clean(rec.get("short_description")))
    amen_cols, amen_words = _amenities(rec)

    rooms: dict[str, Any] = {}
    kitchen = None
    for p in rec.get("property") or []:
        name, number = _clean((p or {}).get("name")), (p or {}).get("number")
        if name in _ROOM_COUNTS:
            rooms[_ROOM_COUNTS[name]] = _num(number)
        elif name == "مطبخ" and _pos(number):
            kitchen = True

    photos = [PHOTO_BASE + f for f in (rec.get("images") or [])
              if isinstance(f, str) and f.strip()] or None

    # ── PRICE. Both figures are source-published; neither is ever derived from the other. ───────
    per_metre = (_clean(rec.get("category_name_ar")) or "") in _PER_METRE_CATEGORIES
    price_raw = rec.get("price")
    total_raw = rec.get("total_price")
    if per_metre:
        ppm = normalize.to_int_numeric(price_raw)           # «سعر المتر» — a RATE
        headline = normalize.to_int_numeric(total_raw)      # «إجمالي السعر» — the published total
        ev_field, ev_raw = "total_price", total_raw
    else:
        ppm = None
        headline = normalize.to_int_numeric(price_raw)      # «السعر» — the whole asking price
        ev_field, ev_raw = "price", price_raw

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": f"{BASE}/details/{pid}",
        "source": SOURCE,
        "active": True,
        "title": title,
        "description": desc,
        **normalize.amenities_from_text(f"{'، '.join(amen_words)}\n{desc or ''}"),
        **amen_cols,
        **rooms,
        "property_type": property_type,
        # `deal` is already provably «بيع»→Buy or «إيجار»→Rent — anything else skipped above with a
        # counted reason. Written as a two-literal expression so the value can never be anything
        # else even in principle (test_deal_mapping_total: a null deal is quarantined out of search).
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _pos(rec.get("space")),
        "property_age": normalize.parse_property_age(rec.get("age_estate")),
        "street_width_m": _pos(rec.get("street_space")),        # «عرض الشارع», NOT `street_width`
        "direction": normalize.one_direction(rec.get("property_face"), diagonal=True),
        "views_count": _pos(rec.get("view")),
        "plan_parcel": _clean(rec.get("landNumber")),            # «رقم القطعة»
        "license_number": _clean(rec.get("ad_license_number")),
        "license_expiry": _clean(rec.get("end_date")),           # «تاريخ انتهاء رخصة الإعلان»
        "date_added": _clean(rec.get("creation_date")),
        "price_per_meter": ppm,
        "photo_urls": photos,
    }
    if kitchen:
        row["kitchen"] = True
    if deal == "Rent":
        # Period from THIS listing's own words only, and a converting period must be corroborated
        # against the very figure the price field holds. Silent → (None, price unconverted).
        period, row["price_annual"] = _rent_fields(
            headline, " ".join(filter(None, (title, _clean(rec.get("short_description")), desc))))
        if period:
            row["rent_period"] = period
    else:
        row["price_total"] = headline
    row["price_evidence"] = normalize.price_evidence(
        field=ev_field, raw=ev_raw,
        stored=row.get("price_total") if deal == "Buy" else row.get("price_annual"),
        kind="total" if deal == "Buy" else (row.get("rent_period") or "annual"),
        unit="total", origin="api", authoritative_absent=False)
    row["images_evidence"] = {"observed": True, "container_present": "images" in rec,
                              "key_present": bool(rec.get("images")),
                              "count": len(photos or [])}

    info = {
        "source_id": pid, "type_ar": type_ar,
        "category_name_ar": _clean(rec.get("category_name_ar")),
        "region_ar": _clean(rec.get("zone_name_ar")),
        "address_ar": redact_pii(_clean(rec.get("address"))),
        "source_price_raw": price_raw,
        "source_total_price_raw": total_raw,
        "price_is_per_meter": per_metre or None,
        "source_space_raw": _clean(rec.get("space")),      # exact m², before area_m2's INTEGER round
        "total_rooms": _clean(rec.get("numberOfRooms")),   # «عدد الغرف», not bedrooms
        "amenity_words": amen_words or None,
        "property_usages": _clean(rec.get("propertyUsages")),
        "main_land_use": _clean(rec.get("mainLandUseTypeName")),
        "title_deed_type": _clean(rec.get("titleDeedTypeName")),
        "deed_number": _clean(rec.get("deed_number")),
        "plan_number": _clean(rec.get("plan_number")),
        "source_status": _clean(rec.get("status")),
        "video_filename": _clean(rec.get("video_url")),    # no base resolves it; column stays NULL
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v is not None})
    # The capture is PRIVATE but "private" is not "may accumulate contact details" — the advertisers
    # write their own phone and WhatsApp link into the prose (id 968: «… : 0555754441» +
    # «wa.me/966…»). Redact the free-text keys HERE rather than leaning on db.redact_capture(): a
    # barrier after the row has left the mapper is not this mapper's guarantee. Numbers, licences,
    # deeds and ids are untouched.
    row["source_capture"] = strip_pii_fields(
        {"schema": "abaad.get-estate-all.v1",
         **{k: (redact_pii(rec[k]) if k in _CAPTURE_FREE_TEXT else rec[k])
            for k in _CAPTURE_KEYS if k in rec}})
    return row, category, ""


# ── FETCH ────────────────────────────────────────────────────────────────────────────────────────
def fetch_catalogue(s: cc.Session, limit: int = 0) -> tuple[list[dict], bool]:
    """Every estate object, plus whether the catalogue was served COMPLETE.

    `offset` is a 1-based PAGE number (verified — see the docstring). Complete means the platform's
    own `total_size` equals the number of distinct rows we hold; only then may anything be pruned.
    """
    rows: dict[str, dict] = {}
    declared: Optional[int] = None
    page = 1
    while True:
        r = None
        for attempt in range(3):
            r = s.get(f"{API}?limit={PAGE_SIZE}&offset={page}", timeout=45)
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
        declared = normalize.to_int_numeric(body.get("total_size")) if declared is None else declared
        batch = [e for e in (body.get("estate") or []) if isinstance(e, dict)]
        if not batch:
            break
        before = len(rows)
        for e in batch:
            key = _clean(e.get("id")) or _clean(e.get("estate_id"))
            if key:
                rows[key] = e
        if len(rows) == before:
            break                       # page repeated itself — stop rather than loop forever
        if limit and len(rows) >= limit:
            return list(rows.values())[:limit], False
        if len(batch) < PAGE_SIZE:
            break
        page += 1
    items = list(rows.values())
    complete = bool(declared) and len(items) == declared
    print(f"{SOURCE}: {len(items)} listings over {page} page(s); total_size={declared} "
          f"complete={complete}", flush=True)
    return items, complete


# ── LIVENESS (measured 2026-09-24; see the docstring — a 200 is NOT proof of life) ───────────────
_EXPIRY_RE = re.compile(r"تاريخ انتهاء رخصة الإعلان\s*</span>\s*<div class=\"v\">\s*([\d/]+)\s*<")


def _expiry_date(body: str) -> Optional[date]:
    m = _EXPIRY_RE.search(body or "")
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1).strip(), "%d/%m/%Y").date()
    except ValueError:
        return None


def _signal(status, body, _moved) -> Optional[str]:
    """'live' | 'gone' | None — the platform's AFFIRMATIVE signals only; the law does the rest.

    404 is a hard delete. A 200 is deliberately NOT treated as life on its own: a de-listed ad keeps
    serving its page (measured on all five ids that left the catalogue mid-capture). Only the ad
    licence expiry the page prints about ITSELF decides, and the boundary day holds.
    """
    if status == 404:
        return "gone"
    if status != 200:
        return None
    exp = _expiry_date(body)
    if exp is None:
        return None                     # 200 but no «تاريخ انتهاء رخصة الإعلان» — no opinion
    today = date.today()
    if exp < today:
        return "gone"                   # the licence lapsed: why the source stopped publishing it
    if exp == today:
        return None                     # expires TODAY — the measured boundary; hold, never kill
    return "live"


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None):
        pid = ad_number[len(PREFIX):] if ad_number.startswith(PREFIX) else ""
        if not pid:
            return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
        return LivenessProbe(platform=SLUG, signal=_signal, session=session,
                             url_for=lambda _ad: f"{BASE}/details/{pid}",
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
            raise RuntimeError(f"{API} returned no estate objects")
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
                      f"rp={r0.get('rent_period')} sw={r0.get('street_width_m')} "
                      f"ag={r0.get('property_age')} ph={len(r0.get('photo_urls') or [])}")
            return 0
        # The public upsert_abaad_*_batch wrappers are added centrally at onboarding; same funnel.
        db._wasalt_batch("abaad_residential_listings", res)
        db._wasalt_batch("abaad_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="abaad_residential_listings", com_table="abaad_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in (("abaad_residential_listings", res),
                              ("abaad_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        elif args.type == "all":
            print("  prune skipped: total_size did not match the rows served (incomplete catalogue)")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(items),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} complete={complete} {notes}"[:300],
                             check_tables=["abaad_residential_listings",
                                           "abaad_commercial_listings"])
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
