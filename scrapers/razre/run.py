"""راز العقارية (razre) — www.razre.sa. A Jeddah developer's own site, onboarding 2026-09-24.

Every number below was MEASURED on 2026-09-24 against the live site. Nothing here is inferred from
the site's marketing, from a sibling platform, or from an earlier probe's notes — an earlier probe
reported a collection called `Depart` holding 506 unit records with a `price` of '840,000' and "549
ready + 23 off-plan of 572"; `Depart` is real but it is ONE of two unit collections, 506 is its size
alone, and 572 matches nothing this site publishes. The counts below replace those.

SOURCE SHAPE
------------
A Wix site. Nothing is scraped out of HTML: the CMS collections are queried directly, the way the
page's own JavaScript does.

  AUTH, in the page's own order (all three steps are REQUIRED — measured):
    1. GET /  → the SSR HTML carries `"signedAppRenderInfo":"<sig>.<base64 payload>"`, whose payload
       decodes to {"gridAppId", "htmlSiteId", "demoId", "signDate"}. That string IS the value the
       page sends as its `authorization` header.
    2. GET /_api/v1/access-tokens  → issues the `svSession` cookie (plus client/server-session-bind).
    3. POST /_api/cloud-data/v1/wix-data/collections/query
            {"collectionName": …, "query": {"paging": {"offset": …, "limit": …}}}
       with that `authorization` header, those cookies, and a Referer on the site.
  STEP 2 IS NOT OPTIONAL AND ITS ABSENCE DOES NOT LOOK LIKE AN AUTH FAILURE. With the token but
  without the session cookie the query answers HTTP 400 «WDE0117: MetaSite not found» — a message
  about the SITE, not about us, which reads like a dead endpoint. Measured both ways in one session:
  token-only → 400 WDE0117, then the same token after /_api/v1/access-tokens → 200 with items.
  /_api/wix-data/v2/items/query and /_api/data/v2/items/query both answer 403 and are not used.

  FIVE COLLECTIONS EXIST; FOUR ARE READ. Sizes are the API's own `totalCount`, and the crawl only
  prunes when the rows it holds equal it:
    Properties  "MyPro"   —  29 buildings,  page /onepro-1/<noid>   (dynamic sitemap: 29 locs)
    Depart      "Depart"  — 506 units belonging to those buildings
    Import872   "Compound"—   6 compounds,  page /com/<no_id>       (dynamic sitemap: 6 locs)
    Import726   "Con_Dep" — 418 units belonging to those compounds
    Import950   "Con_build" — 24 per-building rows inside compounds. NOT READ; see the open
                  questions: it is not rendered anywhere and it CONTRADICTS the compound it belongs
                  to (all four buildings of compound 1 say «نفذت الوحدات» — units sold out — while
                  the compound says «بدأ البيع» and its 68 units are 34 sold / 22 available / 12
                  reserved). An unrendered field that disagrees with the rendered one decides nothing.
  924 unit records in total. The two (parent, unit) families are structurally the same listing and
  go through ONE mapper, so a guard cannot hold on one family and not the other.

  ROW GRAIN IS THE UNIT; listing_url IS THE BUILDING/COMPOUND PAGE (the azure/rightcompound
  precedent for developer-site compounds). The page a user lands on is the project page, and it
  renders every unit as its own card: «حالة الوحدة» + «رقم الوحدة» + «السعر: … ريال» + «النوع» +
  «الدور» + «الجهة» + «المساحة» + «الغرف» + «دورات المياه». The URL is not constructed — it is the
  parent record's OWN pagelink field (`link-copy-of-onepro-1-title` / `link-compound-title`, e.g.
  "/onepro-1/57", "/com/1"). VERIFIED 200 with that project's own units on /onepro-1/55 (47 unit
  cards, prices 395,000 / 445,000), /onepro-1/34 (40 cards, 665,000 / 980,000), /com/1 (C5 مباع
  780,000, A1 متاح 840,000) and /com/5; all 29 + 6 pages answered 200.

THE TRAPS, ALL MEASURED
-----------------------
1. THE UNIT'S PRICE IS A TEXT FIELD, AND THE NUMERIC FIELD BESIDE IT IS A TRAP. `Depart.price` and
   `Import726.price1` are both TEXT holding thousands-separated digits ("840,000", "1,280,000" —
   the only two shapes across all 468 Depart values). `Import726` ALSO has a numeric column `price`
   whose schema displayName is literally "price", present on 350 of its 418 rows, and `price1`
   ("Price") is present on 410. Where both exist they agree on 350 of 350; there is no row with the
   number and not the text. So the TEXT field is the one to read — it is the superset, and it is the
   figure the card prints under «السعر:» beside «ريال».
   Reading the numeric field instead would have blanked 60 priced units on the com side; reading the
   text field with the wrong helper blanks ALL of them, because normalize.to_int_numeric("840,000")
   is None (float() raises on the comma) while to_int("840,000") is 840000. Both raws are kept in
   additional_info so a future divergence between the two fields is auditable from the row alone.
   NOTHING IS EVER COMPUTED. No ×12, no per-metre × area: the site publishes one figure per unit and
   that figure is stored. 8 of 418 com units and 38 of 506 onepro units publish no price at all —
   those store db.AUTHORITATIVE_NULL with authoritative_absent=True, because the field exists in the
   collection schema and the record leaves it empty (a settled blank read from a COMPLETE API
   response, not a failed read), so a price the developer later removes actually clears.

2. THERE IS NO RENT ON THIS SITE, AND THAT IS MEASURED, NOT ASSUMED. Across all 924 unit records
   and all 35 parent records: «إيجار»/«ايجار» 0, «شهري» 0, «سنوي» 0, «يومي» 0. Every status word the
   site uses is about selling («بدأ البيع», «تم البيع بالكامل», «مباع»), and the card prints one
   «السعر:» with no period qualifier. transaction_type is therefore Buy for every row, price_total
   carries the figure, and `rent_period` / `price_annual` are NEVER written — not defaulted to
   annual, not derived, not present as keys. If the site ever adds a period field this scraper must
   be changed rather than silently annualising (the tests guard that the
   keys stay absent, and a period word planted in a record is proven not to create one).

3. READY vs OFF-PLAN IS THE PROJECT'S OWN RENDERED BADGE. The project grid on the homepage is
   faceted by «حالة المشروع» and prints each project's status on its card — 9 «بدأ البيع» and 1
   «قريباً» visible on the first page of the grid. The badge is the parent record's `status`:
        بدأ البيع          sales started   → BUILD                 (19 Properties + 2 Import872)
        قريباً             coming soon     → SKIP off_plan_project  ( 8 Properties + 4 Import872)
        تم البيع بالكامل   sold out        → SKIP project_sold_out  ( 2 Properties)
   Those are the only three values that exist; a fourth would skip with its own counted reason
   rather than being read as ready. This is the SOURCE'S OWN marker, not a heuristic — the project
   DETAIL page never prints it (visible-text count 0 on /com/1, /com/5, /onepro-1/34), so it was
   read off the grid that does.

4. THE UNIT'S OWN STATUS. The card prints «حالة الوحدة» and the page carries the legend
   «متاح محجوز مباع»:
        متاح    available → BUILD
        مباع    sold      → SKIP unit_sold      (246 + 34 inside selling projects)
        محجوز   reserved  → SKIP unit_reserved  ( 12 + 12 inside selling projects)
   A sold unit KEEPS its card on the page with a «مباع» badge, so the page is not a removal signal;
   it is the status field that is. Skipping rather than storing-inactive matches rightcompound,
   whose oracle reads a not-available unit as gone. محجوز is raised as an owner question.

5. THREE FIELD NAMES ARE LIES, AND ONE OF THEM LOOKS LIKE PII. Read off the rendered card and the
   collection schema's Arabic displayNames, never off the English key:
     · `Properties.agentEmail` is displayName «الحي» and holds the DISTRICT («السلامة», «الروضة»,
       «المنار-الياسمين مول»). 29/29 values are district labels; there is no e-mail anywhere in any
       collection (regex scan over all 924 + 35 records: 0 e-mails, 0 phone numbers, 0 wa.me links).
       It is still treated as untrusted free text: it is redacted and it never leaves the allowlist.
     · `Properties.bedrooms` is displayName «عدد الشقق» — how many FLATS the building has (18, 45,
       12) — and `Properties.bathrooms` is «ملاحق», its annex count. Neither is a per-unit count.
       They are BUILDING attributes on a UNIT row, so they go to additional_info and the `bedrooms`
       column stays NULL. The unit's own counts are `rooms` and `bath`.
     · `rooms` is printed under «الغرف» — TOTAL rooms, not «غرف نوم». Same distinction abaad
       measured («عدد الغرف» ≠ bedrooms), so it goes to additional_info.total_rooms and `bedrooms`
       is left NULL rather than overstated. `bath` is printed under «دورات المياه» → bathrooms.

6. «الجهة» IS NOT A COMPASS BEARING. Its values are أمامية / داخلية / لاند سكيب / شارع / شارعين /
   شارع ولاند سكيب / شارعين ولاند سكيب — front, internal, landscape, one street, two streets. Not
   one of them is a direction, so the `direction` column stays NULL and the word is kept verbatim in
   additional_info. (normalize.one_direction would return None for all of them anyway; the column is
   never touched, so nothing can leak in if the vocabulary grows.)

7. «رقم الوحدة» IS A UNIT MODEL, NOT A UNIT NUMBER — so the natural key is NOT unique. `depno` /
   `dep_no` is a letter-plus-digit model code that REPEATS down the building: building 34 has seven
   units all labelled «A», one per floor (areas 140.35 / 144.7 / 145.83 / 144.05 / 140.35…).
   (parent, depno) has 15 colliding groups in Depart; (compound, b_name, dep_no) has 38 in
   Import726. Adding the floor leaves 1 collision still. The only identity that is unique by
   construction is the CMS record's own primary key `_id`, and all 924 are distinct — so
   ad_number = "RAZ" + that _id, verbatim, hyphens and all. The unit's own human identity
   (model + block + floor) is carried in the title and in additional_info, which is what makes a
   shared project URL legitimate here (the azure/rightcompound precedent).

8. TYPE. Two values: «شقة» (821) → Apartment through the shared TYPE_MAP_AR, and «ملحق» (91) — a
   roof annex the shared map does not key. It is NOT guessed: `ملحق` → Floor is the mapping three
   platforms already ship (eaqartabuk, fahadalshahri, and bossbih, whose own comment records it as
   "the annexe/roof unit let as its own dwelling… folded to Floor, matching the two platforms that
   already ship that mapping"). Applied here verbatim as that fleet decision, and raised as an open
   question only because marksa chose to skip the same word. Both types are residential, so
   razre_commercial_listings stays empty unless the vocabulary grows.

9. CITY IS IN THE PARENT'S ADDRESS, IN TWO PLACES AND TWO SHAPES — AND READING ONLY ONE OF THEM
   THREW A LISTING AWAY. `address` is normally the Wix address OBJECT, whose `city` sub-field says
   "Jeddah" on 30 of the 35 parents (always Jeddah, never any other value) and whose `subdivisions`
   name «Makkah Province» as the region hint. But on Import872/6 `address` is a bare STRING, and the
   structured `city` is missing on 5 parents — of which THREE still name the city in `formatted`:
   "G68H+2X An Naseem, Jeddah" (Properties/15), "J46C+P6 An Nahdah, Jeddah" (Import872/6) and
   «JERA2837، 8124 ابن الكوفي، الروضة، 2837، جدة 23435» (Properties/40). The first build read
   `address.city` alone and skipped Properties/15's one available unit as city_unstated — dropping a
   city the source does publish, which is the same fidelity failure as inventing one, facing the
   other way. So: the structured field first, then the city the formatted string itself names.
   Both reads are an explicit NAMED-VALUE match on whole TOKENS against _CITY_AR ("Jeddah"/«جدة»/
   «جده»), never a parse — a plus-code or a district cannot place a listing, and a value outside the
   map skips as city_unmapped_<value> rather than being filed somewhere plausible.
   ONE parent still states no city at all: Import872/1 (HAVEN 1) has no `address` key, and its page
   /com/1 does not contain "Jeddah" or «جدة» anywhere (both counts 0 in the full HTML). Its 22
   available units are therefore skipped city_unstated, not placed in Jeddah because its five
   siblings are. The district cannot supply the city either — السلامة, الروضة and النهضة all exist
   in several Saudi cities — so nothing is inferred from it. Raised as an open question.

PDPL
----
Both stored payloads are built from an explicit KEY ALLOWLIST, never from the record, and every
free-text value in them goes through redact_pii(); strip_pii_fields() runs over the finished dicts
as a second barrier. `_owner` (a Wix account GUID) and `_manualSort_*` are outside the allowlist.
A poisoned record — a phone in the title, an e-mail in `agentEmail`, a wa.me link in a gallery
caption, an extra `advertiserPhone` key — is proven to leak nothing into any column, into
additional_info or into source_capture by
test_a_poisoned_record_leaks_no_contact_detail_anywhere — which is how a phone written into
«رقم الوحدة» reaching the `title` column was caught and fixed at the read.

PHOTOS
------
The unit's own `status_image` / `statuscolor` are the BADGE graphics (مباع.png / متاح.png), not
property photos, and are never stored. The project's `gallery` is, converted from Wix's
`wix:image://v1/<slug>/<name>#originWidth=…` to https://static.wixstatic.com/media/<slug>.
VERIFIED: 6 fetched → HTTP 200 with content-type image/jpeg or image/png, JPEG magic ff d8 ff on a
full GET, `access-control-allow-origin: *` and NO cross-origin-resource-policy header, so they embed
(a 200 alone is not proof an image renders). 19 of the 21 selling projects publish a gallery; RAZ 16
publishes none and RAZ 17 one, so `image`/`image2` (the grid card artwork the site itself shows for
that project) is the documented fallback. `scheme` is floor PLANS, not photos, and is counted only.

REMOVAL ORACLE (measured — and absence from a page is a death signal on ONE family only)
---------------------------------------------------------------------------------------
A unit's own page is its project page, read back from the row's stored listing_url (the _id alone
does not name the project). The probe goes through the shared law in http_liveness, so a 403/429/5xx
/timeout/empty body can never read as a death, and every removal is additionally gated by an in-run
positive control that fails CLOSED.

    404 / 410 on the project page              → gone. 4 of 4 fabricated ids answered 404
                                                 (/onepro-1/9999, /onepro-1/58, /com/99, /com/7);
                                                 0 of 35 real pages did.
    200, the unit IS in the page's own data
         and its status is متاح                → live
    200, the unit IS in the page's own data
         and its status is مباع or محجوز       → gone (the source's own statement)
    200, the unit is ABSENT from the page's
         data, and the page is /onepro-1/…     → gone. MEASURED COMPLETE: on all 29 building pages
                                                 the SSR `wix-warmup-data` carried EXACTLY as many
                                                 Depart records as the collection holds for that
                                                 building (14/14, 18/18, 47/47, 40/40, 0/0 …), so
                                                 absence there is absence, not paging.
    200, the unit is ABSENT, and the page
         is /com/…                             → UNKNOWN. MEASURED PAGINATED: every com page capped
                                                 at exactly 20 warmup records against 68 / 78 / 88 /
                                                 86 / 98 in the collection, and the page renders a
                                                 «...تحميل المزيد» control. Absence there would be a
                                                 false kill, so this family gets no opinion.
    anything else                              → UNKNOWN
Rows are built from the collection query, not from a fetch of each unit's own record, so
mark_direct_alive() is deliberately not called.

COVERAGE (full --dry-run against the live site, 2026-09-24)
-----------------------------------------------------------
924 unit records over 4 collections, all four served COMPLETE against their own totalCount
(29/29, 506/506, 6/6, 418/418) → 57 mapped (57 residential + 0 commercial), 867 skipped and counted:
    off_plan_project 486 · unit_sold 280 · unit_reserved 24 · project_sold_out 36 ·
    city_unstated 22 (all HAVEN 1, trap 9) · unit_orphaned 19
All 57 are Buy. Apartment 52 · Floor 5. city جدة 57 → city_id 18 / region_id 2.
    price_total 56 of 57 + 1 db.AUTHORITATIVE_NULL · area_m2 56 · bathrooms 57 · floor_number 57
    district_ar 57 (حي السلامة 51 · حي المنار 3 · حي النخيل 2 · حي النسيم 1) · neighborhood 57
    project_name 57 (RAZ 55 ×47 · RAZ 10 ×3 · RAZ 18/19/4 ×2 · RAZ 15 ×1) · photo_urls 57 (3–8 each)
    bedrooms 0 (trap 5) · rent_period 0 · price_annual 0 (trap 2) · direction 0 (trap 6)
    license_number 0 · license_expiry 0 (the site publishes no ad licence — open question)
REAL-USER SPOT CHECK, row against the rendered card: RAZ 10's «A5 … متاح … 560,000 … ملحق الخامس
داخلية … 144 3 2» is stored as Floor / price_total 560000 / area_m2 144 / bathrooms 2 /
floor_number 5 / total_rooms 3 / facing_ar داخلية. RAZ 15's «B1 … متاح … ريال ​ السعر:» prints an
EMPTY price and an empty area, and that row stores AUTHORITATIVE_NULL with authoritative_absent=True
and no area — the source publishes no figure, so none is manufactured.
The 867 skips are not scraper failures: 486 are projects the site itself badges «قريباً» and 280 are
units it badges «مباع». The prices that do land run 395,000 – 980,000 SAR.

OPEN QUESTIONS FOR ONBOARDING (none of these is guessed in code)
---------------------------------------------------------------
  · HAVEN 1 (Import872/1) is a selling compound with 22 available units and it names NO city — no
    `address` key, and «جدة»/"Jeddah" appears nowhere on /com/1. They are the single biggest block of
    held-back inventory (22 of a possible 79). Ask the developer to fill the compound's address; one
    field recovers all 22. Nothing is inferred from its النهضة district in the meantime.
  · محجوز (reserved, 24 units). Skipped as unavailable. Should a reserved unit appear in results?
    The schema has no "reserved" state, so showing one would present it as available.
  · «ملحق» → Floor is the fleet's shipped mapping (3 platforms), but marksa skips the same word as
    type_unmapped pending an owner call. One of the two should become the fleet rule.
  · `hide` (boolean, 22 Properties True / 7 False, 2 Import872 True / 4 False) is NOT acted on. It
    does not gate the page — every hide=True page answers 200 with its full unit list — and it does
    not track status either (all 7 hide=False Properties are «قريباً», but so is one hide=True one).
    Kept in additional_info. What does it hide?
  · Import950's per-building status contradicts its own compound (see SOURCE SHAPE). Which one does
    the developer maintain?
  · Two HAVEN 2 records exist: Import872/6 («بدأ البيع», 0 units, /com/6 serves an empty unit list)
    and Import872/2 («قريباً», 78 units). One of them is probably a staging row.
  · 19 Depart units have no parent reference at all (`title` null) and are skipped unit_orphaned.
  · `Depart.bath` holds "23" on one row (a 3-room 140 m² flat). Source is truth, so it would be
    stored verbatim — that row happens to skip on its unit status today, so nothing lands. Confirm
    it is a typo before it becomes visible.
  · SOURCE is stored as «راز العقارية», which is what the site calls itself everywhere (<title>,
    og:site_name, siteDisplayName, page header). The target roster says «راز الماسية العقارية»; the
    string «الماسية» appears nowhere on the site. Which name should a card show?
  · The site names no REGA advertisement licence on any project or unit, so license_number /
    license_expiry stay NULL for all 57. A developer selling its own units still needs FAL
    disclosure — worth raising with the platform.
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

BASE = "https://www.razre.sa"
QUERY_API = f"{BASE}/_api/cloud-data/v1/wix-data/collections/query"
TOKEN_API = f"{BASE}/_api/v1/access-tokens"
PHOTO_BASE = "https://static.wixstatic.com/media/"
SOURCE = "راز العقارية"
PREFIX = "RAZ"
SLUG = "razre"
PAGE_SIZE = 1000

# «ملحق» = the roof annex let/sold as its own dwelling. Folded to Floor, which is the mapping
# eaqartabuk, fahadalshahri and bossbih already ship (see trap 8) — not a razre invention.
_TYPE_OVERRIDES = {"ملحق": "Floor"}

# The PROJECT's own rendered badge (trap 3). An unlisted value skips with its own counted reason.
_PROJECT_READY = "بدأ البيع"
_PROJECT_SKIP = {"قريباً": "off_plan_project", "تم البيع بالكامل": "project_sold_out"}

# The UNIT's own rendered badge (trap 4).
_UNIT_AVAILABLE = "متاح"
_UNIT_SKIP = {"مباع": "unit_sold", "محجوز": "unit_reserved"}

# The source's OWN city label → the Arabic the catalog keys on. One entry, because one city exists
# in the data; anything else skips as city_unmapped rather than being placed somewhere plausible.
# The keys are the names the site itself writes, in either script; the match is on whole TOKENS of
# the address, never a substring, so a street called "Jeddah Road" cannot place a listing.
_CITY_AR = {"jeddah": "جدة", "جدة": "جدة", "جده": "جدة"}
_WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)

# «الدور» — the collections' own ordinal vocabulary, both spellings of the definite article seen.
_FLOOR_AR = {
    "الأرضي": 0, "الارضي": 0, "الأول": 1, "الاول": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4,
    "الخامس": 5, "السادس": 6, "السابع": 7, "الثامن": 8, "التاسع": 9, "العاشر": 10,
}

# The two (parent, unit) families. Same listing shape, ONE mapper — a guard cannot hold on one
# family and not the other. Keys are the collections' real field names, measured from their schemas.
_FAMILIES = {
    "onepro": {
        "parent_coll": "Properties", "unit_coll": "Depart",
        "parent_id": "noid", "unit_parent_ref": "title", "link": "link-copy-of-onepro-1-title",
        # NAMED agentEmail, displayName «الحي», HOLDS the district (trap 5). Still treated as
        # untrusted free text everywhere it is read.
        "district": "agentEmail", "flats": "bedrooms", "annexes": "bathrooms", "floors": "floors",
        "unit": {"type": "type", "floor": "flour", "model": "depno", "rooms": "rooms",
                 "bath": "bath", "face": "direction", "price_text": "price", "price_num": None,
                 "block": None},
    },
    "com": {
        "parent_coll": "Import872", "unit_coll": "Import726",
        "parent_id": "no_id", "unit_parent_ref": "no_id", "link": "link-compound-title",
        "district": "dist", "flats": "no_dep", "annexes": "extension", "floors": "floor",
        "unit": {"type": "kind", "floor": "floor", "model": "dep_no", "rooms": "rooms",
                 "bath": "bath", "face": "face", "price_text": "price1", "price_num": "price",
                 "block": "b_name"},
    },
}

# Keys copied into additional_info / source_capture — an ALLOWLIST, so a contact field added to
# either collection tomorrow cannot arrive by default (PDPL).
_UNIT_CAPTURE = ("_id", "no_id", "title", "b_name", "dep_no", "depno", "form", "kind", "type",
                 "floor", "flour", "area", "rooms", "bath", "face", "direction", "status",
                 "price", "price1", "sortNum", "_createdDate", "_updatedDate")
_PARENT_CAPTURE = ("noid", "no_id", "title", "status", "hide", "dist", "agentEmail", "floors",
                   "floor", "bedrooms", "bathrooms", "no_dep", "no_building", "extension",
                   "propertieType", "link-compound-title", "link-copy-of-onepro-1-title")
# Of those, the ones that carry FREE TEXT — where a phone, an e-mail or a WhatsApp link would hide.
_FREE_TEXT = frozenset({"title", "dist", "agentEmail", "propertieType", "form", "dep_no", "depno"})


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def _clean(v) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


def _pos(v) -> Optional[int]:
    """A positive source-published count/measure, or None. `to_int` (not to_int_numeric) because
    these collections mix text and float for the SAME field: Depart.bath is "4" and Import726.bath
    is 2.0. No razre row publishes a 0 for any of them (measured), so 0 reads as unset."""
    n = normalize.to_int(v)
    return n if n and n > 0 else None


def _join_key(v) -> Optional[str]:
    """The parent-reference key. Properties.noid / Depart.title are strings ('01', '55'); Import872
    / Import726 no_id are floats (1.0). Both sides of a family go through this same function, so a
    number joins a number and a string joins a string — '01' is never folded onto '1'."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    return str(int(v)) if isinstance(v, (int, float)) and not isinstance(v, bool) else str(v).strip()


_WIX_IMAGE_RE = re.compile(r"^wix:image://v1/([^/]+)")


def city_from_address(addr) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """(city_ar, region_ar, the label we saw) from a parent's address.

    TWO SHAPES AND TWO PLACES, both measured. `address` is usually the Wix address OBJECT
    ({city, subdivisions, formatted, location, …}) but on Import872/6 it is a bare STRING. And the
    structured `city` sub-field is missing on 5 of the 35 parents — three of which STILL NAME THE
    CITY in `formatted` ("G68H+2X An Naseem, Jeddah", "J46C+P6 An Nahdah, Jeddah",
    «… الروضة، 2837، جدة 23435»). Reading only `address.city` threw away a city the source does
    publish, which is the same defect as inventing one, pointed the other way — so the structured
    field is preferred and the formatted string is read when it is absent.

    The formatted read is still an explicit NAMED-VALUE match on whole tokens against _CITY_AR, not
    a parse: nothing is placed because a district or a plus-code looked Saudi. Import872/1 (HAVEN 1)
    has address null and names no city anywhere — it stays unstated.
    """
    if isinstance(addr, dict):
        city_label = _clean(addr.get("city"))
        region_ar = next((s.get("name") for s in (addr.get("subdivisions") or [])
                          if isinstance(s, dict)
                          and s.get("type") == "ADMINISTRATIVE_AREA_LEVEL_1"), None)
        formatted = _clean(addr.get("formatted"))
    else:
        city_label, region_ar, formatted = None, None, _clean(addr)
    if city_label:
        return _CITY_AR.get(city_label.lower()), _clean(region_ar), city_label
    for tok in _WORD_RE.findall(formatted or ""):
        if (city_ar := _CITY_AR.get(tok.lower())):
            return city_ar, _clean(region_ar), tok
    return None, _clean(region_ar), None


def _photo_url(v) -> Optional[str]:
    """`wix:image://v1/<slug>/<name>#originWidth=…` → the static host that serves it (verified 200
    image/*, ACAO *, no CORP). Anything that is not that scheme is not turned into a URL."""
    m = _WIX_IMAGE_RE.match(str(v or ""))
    return PHOTO_BASE + m.group(1) if m else None


def _photos(parent: dict[str, Any]) -> tuple[Optional[list[str]], str]:
    """(urls, which field they came from). The project gallery; failing that the grid card artwork
    the site itself shows for that project. Unit `status_image`/`statuscolor` are BADGES, never
    photos, and are not reachable from here."""
    gallery = [u for g in (parent.get("gallery") or [])
               if isinstance(g, dict) and (u := _photo_url(g.get("src")))]
    if gallery:
        return gallery, "gallery"
    card = [u for k in ("image", "imege", "image2") if (u := _photo_url(parent.get(k)))]
    return (card or None), ("image" if card else "none")


def map_listing(unit: dict[str, Any], parent: Optional[dict[str, Any]],
                fam: str) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) for ONE unit record. row is None exactly when a reason is set."""
    cfg = _FAMILIES[fam]
    uk = cfg["unit"]

    uid = _clean(unit.get("_id"))
    if not uid:
        return None, "residential", "no_id"
    if parent is None:
        return None, "residential", "unit_orphaned"

    # ── the project's own rendered badge, then the unit's own (traps 3 and 4) ────────────────────
    pstatus = _clean(parent.get("status"))
    if pstatus != _PROJECT_READY:
        return None, "residential", _PROJECT_SKIP.get(pstatus or "",
                                                      f"project_status_unknown_{pstatus or 'blank'}")
    ustatus = _clean(unit.get("status"))
    if ustatus != _UNIT_AVAILABLE:
        return None, "residential", _UNIT_SKIP.get(ustatus or "",
                                                   f"unit_status_unknown_{ustatus or 'blank'}")

    type_ar = _clean(unit.get(uk["type"]))
    property_type = normalize.map_type_exact(type_ar, _TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", f"type_unmapped_{type_ar or 'blank'}"
    category = normalize.category_for_type(property_type).lower()

    # ── city: only from the parent's own address, never from the district (trap 9) ────────────────
    city_ar, region_ar, city_label = city_from_address(parent.get("address"))
    if not city_ar:
        return None, category, (f"city_unmapped_{city_label}" if city_label else "city_unstated")
    city_id, region_id = to_catalog(city_ar, region_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"

    district_raw = redact_pii(_clean(parent.get(cfg["district"])))
    district_ar = find_district_in_text(district_raw, city_id)

    link = _clean(parent.get(cfg["link"]))
    if not link or not link.startswith("/"):
        return None, category, "no_project_page_link"

    # ── the unit's own human identity, which is what makes a shared project URL legitimate ───────
    # REDACTED AT THE READ, not at each use. These three are free text the developer types, and they
    # flow into `title` AND into additional_info; the first build redacted only the parent's title
    # and the district, and test_a_poisoned_record_leaks_no_contact_detail_anywhere caught a phone
    # written into «رقم الوحدة» reaching the title column. One guard where all the callers pass.
    # redact_pii is the identity on every real value («الخامس», "A5", "C" — checked).
    model = redact_pii(_clean(unit.get(uk["model"])))
    block = redact_pii(_clean(unit.get(uk["block"]))) if uk["block"] else None
    floor_ar = redact_pii(_clean(unit.get(uk["floor"])))
    project = redact_pii(_clean(parent.get("title")))
    title = " - ".join(p for p in (
        " ".join(x for x in (type_ar, model) if x),
        f"مبنى {block}" if block else None,
        f"الدور {floor_ar}" if floor_ar else None,
        project) if p)

    # ── PRICE: the TEXT field, read with to_int (trap 1). Nothing is computed. ───────────────────
    price_text = unit.get(uk["price_text"])
    price = normalize.to_int(price_text) if _clean(price_text) else None
    photos, photo_field = _photos(parent)

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{uid}",       # the CMS record's own primary key — the only unique one
        "listing_url": BASE + link,          # the parent's OWN pagelink, never constructed
        "source": SOURCE,
        "active": True,
        "title": title,
        "property_type": property_type,
        # Sales-only platform, measured (trap 2): no period field, no rent vocabulary anywhere.
        "transaction_type": "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "project_name": project,
        "area_m2": _pos(unit.get("area")),
        "bathrooms": _pos(unit.get(uk["bath"])),          # «دورات المياه»
        # `rooms` is «الغرف» (TOTAL rooms), not «غرف نوم» — it goes to additional_info and the
        # bedrooms column stays NULL rather than being overstated (trap 5).
        "floor_number": _FLOOR_AR.get(floor_ar or ""),    # «الدور»; الأرضي is 0, a real answer
        "photo_urls": photos,
        # price_total, never price_annual: there is no rent on this site and no period to store.
        "price_total": price if price is not None else db.AUTHORITATIVE_NULL,
    }
    row["price_evidence"] = normalize.price_evidence(
        field=f"{cfg['unit_coll']}.{uk['price_text']}", raw=price_text, stored=price,
        kind="total", unit="total", origin="api", authoritative_absent=price is None)
    row["images_evidence"] = {"observed": True, "container_present": "gallery" in parent,
                              "key_present": photo_field != "none", "count": len(photos or []),
                              "source_field": photo_field}

    info = {
        "family": fam,
        "source_record_id": uid,
        "project_id": _join_key(parent.get(cfg["parent_id"])),
        "project_status": pstatus,
        "project_hide": parent.get("hide"),               # not acted on — see the open questions
        "unit_status": ustatus,
        "unit_model": model,                              # «رقم الوحدة» — a MODEL, repeats per floor
        "unit_block": block,
        "unit_form": redact_pii(_clean(unit.get("form"))),
        "floor_ar": floor_ar,
        "type_ar": type_ar,
        # «الغرف» = total rooms, NOT bedrooms (trap 5).
        "total_rooms": _pos(unit.get(uk["rooms"])),
        # «الجهة» — front/internal/landscape/street, never a compass bearing (trap 6).
        "facing_ar": redact_pii(_clean(unit.get(uk["face"]))),
        "source_area_raw": unit.get("area"),              # exact m², before area_m2's INTEGER round
        "source_price_text_raw": _clean(price_text),
        # The numeric sibling of the price, kept so a future divergence is auditable (trap 1).
        "source_price_numeric_raw": unit.get(uk["price_num"]) if uk["price_num"] else None,
        # BUILDING attributes, deliberately not per-unit columns (trap 5).
        "project_flats_total": _pos(parent.get(cfg["flats"])),
        "project_annexes_total": _pos(parent.get(cfg["annexes"])),
        "project_floors": _pos(parent.get(cfg["floors"])),
        "project_plan_ar": redact_pii(_clean(parent.get("propertieType"))),
        "project_scheme_images": len(parent.get("scheme") or []) or None,
        "photo_source_field": photo_field,
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v is not None})
    row["source_capture"] = strip_pii_fields({
        "schema": "razre.wix-data.collections.query.v1",
        "family": fam,
        "unit": {k: (redact_pii(unit[k]) if k in _FREE_TEXT else unit[k])
                 for k in _UNIT_CAPTURE if k in unit},
        "project": {k: (redact_pii(parent[k]) if k in _FREE_TEXT else parent[k])
                    for k in _PARENT_CAPTURE if k in parent},
    })
    return row, category, ""


# ── FETCH ────────────────────────────────────────────────────────────────────────────────────────
def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")     # impersonate OWNS the User-Agent
    s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7",
                      "Referer": BASE + "/"})
    return s


_TOKEN_RE = re.compile(r'"signedAppRenderInfo":"([^"]+)"')


def authorize(s: cc.Session) -> str:
    """The site's own two-step handshake (see AUTH in the docstring). Both steps are required: with
    the token alone the query answers 400 «WDE0117: MetaSite not found», which reads like a dead
    endpoint rather than a missing session."""
    r = s.get(BASE + "/", timeout=45)
    if r.status_code != 200:
        raise RuntimeError(f"{BASE}/ returned {r.status_code} — cannot read the site's own token")
    m = _TOKEN_RE.search(r.text or "")
    if not m:
        raise RuntimeError("signedAppRenderInfo is gone from the page — the Wix auth shape changed")
    t = s.get(TOKEN_API, timeout=45)          # issues svSession; without it every query is a 400
    if t.status_code != 200:
        raise RuntimeError(f"{TOKEN_API} returned {t.status_code} — no session cookie, no data")
    return m.group(1)


def fetch_collection(s: cc.Session, token: str, name: str) -> tuple[list[dict], bool]:
    """Every record of one collection, plus whether it was served COMPLETE.

    Complete means the platform's own `totalCount` equals the DISTINCT records we hold; only then
    may anything be pruned, so a truncated response can never look like a shrunken catalogue."""
    rows: dict[str, dict] = {}
    declared: Optional[int] = None
    while True:
        r = None
        for _ in range(3):
            r = s.post(QUERY_API, json={"collectionName": name,
                                        "query": {"paging": {"offset": len(rows),
                                                             "limit": PAGE_SIZE}}},
                       headers={"authorization": token}, timeout=60)
            if r.status_code not in TRANSIENT_STATUSES:
                break
        if r is None or r.status_code != 200:
            raise RuntimeError(f"{name} query returned {getattr(r, 'status_code', 'no response')}: "
                               f"{(getattr(r, 'text', '') or '')[:180]}")
        try:
            body = r.json()
        except ValueError as exc:
            raise RuntimeError(f"{name} query is no longer JSON: {exc}") from exc
        if not isinstance(body, dict) or not isinstance(body.get("items"), list):
            raise RuntimeError(f"{name} query answered {str(body)[:180]}, not an items object")
        if declared is None:
            declared = normalize.to_int_numeric(body.get("totalCount"))
        before = len(rows)
        for rec in body["items"]:
            if isinstance(rec, dict) and (k := _clean(rec.get("_id"))):
                rows[k] = rec
        if len(rows) == before:
            break                     # the page repeated itself or was empty — stop, never loop
        if len(body["items"]) < PAGE_SIZE:
            break
    items = list(rows.values())
    complete = bool(declared) and len(items) == declared
    print(f"  {name}: {len(items)} records; totalCount={declared} complete={complete}", flush=True)
    return items, complete


# ── LIVENESS (measured 2026-09-24; absence is a death signal on ONE family only) ─────────────────
_WARMUP_RE = re.compile(r'<script[^>]*id="wix-warmup-data"[^>]*>(.*?)</script>', re.S)


def units_on_page(body: str) -> dict[str, dict]:
    """The unit records the project page's own SSR data carries, keyed by CMS _id.

    COMPLETE for Depart (all 29 building pages carried exactly the collection's count) and CAPPED AT
    20 for Import726 (68/78/86/88/98 in the collection, 20 on the page, plus a «تحميل المزيد»
    control) — which is why _signal only reads absence as death on the /onepro-1/ family.
    """
    m = _WARMUP_RE.search(body or "")
    if not m:
        return {}
    try:
        store = json.loads(m.group(1))["appsWarmupData"]["dataBinding"]["dataStore"]
        by_coll = store["recordsByCollectionId"]
    except (ValueError, KeyError, TypeError):
        return {}
    out: dict[str, dict] = {}
    for coll in ("Depart", "Import726"):
        recs = by_coll.get(coll)
        if isinstance(recs, dict):
            out.update({k: v for k, v in recs.items() if isinstance(v, dict)})
    return out


def _signal(uid: str, page_lists_every_unit: bool):
    def signal(status, body, _moved) -> Optional[str]:
        if status in (404, 410):
            return "gone"                       # 4/4 fabricated ids; 0/35 real pages
        if status != 200:
            return None
        units = units_on_page(body)
        if not units:
            return None                         # not a project page we could read — no opinion
        unit = units.get(uid)
        if unit is not None:
            return "live" if _clean(unit.get("status")) == _UNIT_AVAILABLE else "gone"
        # Absent. Only believable as a removal where the page proved it lists EVERY unit.
        return "gone" if page_lists_every_unit else None
    return signal


def _lists_every_unit(listing_url: Optional[str]) -> bool:
    """True only for the family whose pages were MEASURED complete (see units_on_page)."""
    return "/onepro-1/" in (listing_url or "")


def _make_verify_gone(control: Optional[dict]):
    url_for = stored_listing_url((f"{SLUG}_residential_listings", f"{SLUG}_commercial_listings"))

    def probe(ad_number: str, canary=None):
        uid = ad_number[len(PREFIX):] if ad_number.startswith(PREFIX) else ""
        if not uid:
            return "unknown", f"{ad_number!r} is not a {PREFIX}<record id> ad number"
        url = url_for(ad_number)
        return LivenessProbe(platform=SLUG, signal=_signal(uid, _lists_every_unit(url)),
                             session=session, url_for=lambda _ad: url,
                             canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        uid = control["ad_number"][len(PREFIX):]
        verdict, why = LivenessProbe(
            platform=SLUG, signal=_signal(uid, _lists_every_unit(control["listing_url"])),
            session=session, url_for=lambda _ad: control["listing_url"]).verify_gone(
                control["ad_number"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


def crawl(s: cc.Session, token: str, limit: int = 0) -> tuple[list[dict], list[dict], dict, bool]:
    """(residential, commercial, skip tally, catalogue complete)."""
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    complete = True
    for fam, cfg in _FAMILIES.items():
        parents, p_ok = fetch_collection(s, token, cfg["parent_coll"])
        units, u_ok = fetch_collection(s, token, cfg["unit_coll"])
        complete = complete and p_ok and u_ok
        by_id = {k: p for p in parents if (k := _join_key(p.get(cfg["parent_id"])))}
        for unit in units:
            parent = by_id.get(_join_key(unit.get(cfg["unit_parent_ref"])) or "")
            row, cat, why = map_listing(unit, parent, fam)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            (com if cat == "commercial" else res).append(row)
            if limit and len(res) + len(com) >= limit:
                return res, com, skipped, False
    return res, com, skipped, complete


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
    skipped: dict[str, int] = {}
    try:
        token = authorize(s)
        res, com, skipped, complete = crawl(s, token, limit=args.limit)
        if not (res or com):
            raise RuntimeError("no unit mapped from any collection — skips: " + (_tally(skipped) or "none"))
        if args.type != "all":
            res, com = (res, []) if args.type == "residential" else ([], com)
        notes = _tally(skipped)
        if skipped:
            print("  skipped (not guessed): " + notes)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:20]:
                print(f"   {r0['ad_number'][:12]:>12} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):10} {str(r0['city_ar']):6} "
                      f"d={str(r0['district_ar'])[:10]:10} a={str(r0['area_m2']):>5} "
                      f"ba={str(r0.get('bathrooms')):>3} fl={str(r0.get('floor_number')):>3} "
                      f"pt={r0.get('price_total')} ph={len(r0.get('photo_urls') or [])} "
                      f"| {r0['title'][:44]}")
            return 0
        # The public upsert_razre_*_batch wrappers are added centrally at onboarding; same funnel.
        db._wasalt_batch(f"{SLUG}_residential_listings", res)
        db._wasalt_batch(f"{SLUG}_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table=f"{SLUG}_residential_listings", com_table=f"{SLUG}_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in ((f"{SLUG}_residential_listings", res),
                              (f"{SLUG}_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        elif args.type == "all":
            print("  prune skipped: a collection's totalCount did not match the rows served")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(res) + len(com) + sum(skipped.values()),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} complete={complete} {notes}"[:300],
                             check_tables=[f"{SLUG}_residential_listings",
                                           f"{SLUG}_commercial_listings"])
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
