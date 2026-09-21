"""مكتب بوصبيح العقاري (bossbihoffice.com.sa) — a single-office Al-Ahsa brokerage on Drupal 8.

Everything below was MEASURED live on 2026-09-20 over the WHOLE catalog (1,485 listings), not
sampled and not assumed.

WHAT THE SITE IS. One Drupal 8 Views index at `/` — 150 cards/page, `?page=` 0-indexed, 10 pages.
The site prints its own total («عدد العقارات: 1485») and the crawl matched it exactly: pages 0-9
yielded 1,485 distinct ad ids, page 10 is empty. Detail page = the BARE numeric path `/{nid}`.
There is no structured endpoint: /jsonapi and ?_format=json are not served, /sitemap.xml is 404,
and there is no JSON-LD. DOM only, keyed off Drupal FIELD MACHINE NAMES (never positions):

    field-almsaha            «المساحة 500 م»          area
    field-als-r2             «السعر» / «المتر» / …    the price BASIS LABEL  ← decides the column
    field-als-r              content="1600000"        the price NUMBER (machine attribute)
    field-wsf-al-qar         prose                    description
    field-al-mr              «العمر 7 سنة»            property age
    field-shar-rd            «شارع 15 شرق» / «25*12»  street width + facade: ONE number → street_width_m,
                                                       two streets («25*12») → NULL, raw always kept
    field-rgm / field-alhrf  «رقم الأرض 1/29» / «حرف ج»  plot no. / block letter
    field-hdwd-watwal-al-qar «الحدود والأطوال: 20*27» plot dimensions
    field-image              a run of `a.lightbox[data-imagelightbox=g]` full-size photo hrefs

THE FIVE THINGS THIS SOURCE WILL GET WRONG IF YOU TRUST THE OBVIOUS THING:

1. THE PRICE ATTRIBUTE IS BASIS-FREE. `field-als-r` renders `content="1400"` identically whether
   the listing costs 1,400 ﷼ in total or 1,400 ﷼ PER SQUARE METRE. The basis is published ONLY as
   the Arabic label in `field-als-r2`, and per-metre pricing is not an edge case here — 364 of the
   1,485 listings are priced per square metre (313 of them under the bare «المتر»). Taking the
   attribute as a total books a 540 m² plot at 1,400 ﷼. So the LABEL decides the column (see PRICE_LABELS), area is NEVER
   multiplied to synthesise a total (that derivation lives in the search/display layer under the
   owner's 2026-09-03 reversal; `scrapers/` and the base tables stay PRICE = SOURCE), and a number
   with NO label anywhere leaves BOTH price columns NULL.
   The office writes FOUR per-metre labels — «المتر», «حد المتر», «السوم للمتر», «سوم المتر» — and
   that is what makes a BARE «السوم» / «الحد» a total-basis label rather than an ambiguous one; it is
   mapped as a total even where the figure is tiny for the area («السوم 1,200» on 375 m²; 7 of the
   785 total-basis rows that publish an area come out under 5 ﷼/m²), because the owner ruled on
   exactly that shape on 2026-08-03: if the platform publishes it, we publish it and keep it
   searchable. There is no plausibility gate anywhere in this file — and a magnitude rule would do
   real damage here beyond breaking that rule: the sub-60-﷼/m² band is mostly LEGITIMATE farmland
   («السعر 2,000,000» on 1,000,000 m² = 2 ﷼/m², «السعر 1,600,000» on 200,000 m²), so the filter
   would hide correct prices to catch a handful of sloppy labels.
   For the bare «المتر» label — and only that one — the site ALSO prints its own computed total in a
   separate Views block («الإجمالي 556,400 ريال» = 1,300 × 428, exact). That is a source-published
   total, so it is stored in price_total beside the rate; area is never multiplied here.

2. THE PAGE HREFS FLIP BETWEEN TWO FRONT-CONTROLLER FORMS. The same index page is served
   sometimes with `href="/9694"` and sometimes with `href="/index.php/9694"` — same bytes count,
   HTTP 200, same printed total, so a scraper keyed on the first form silently reports "0 rows" on
   a perfectly healthy page (measured: pages 0, 2 and 9 in one pass, repeatably). Enumeration
   therefore keys off the card's own «إعلان&nbsp;{id}» badge, which is form-independent.

3. NO LISTING PUBLISHES A CITY. Al-Ahsa is a GOVERNORATE containing several real, DIFFERENT towns
   (الهفوف / المبرز / العيون / الجفر / العمران …), so the office's «الأحساء» address may NOT be
   read as any one of them. Under the owner's 2026-09-13 instruction for exactly this shape
   (amlakalahsa: "under city districts, we guess we don't know, we just leave it") the row carries
   the honest broad-but-true governorate city «الاحساء», resolved through to_catalog() like every
   other platform — never a specific town. `additional_info.city_basis` records that it is derived.

4. THE DISTRICT IS IN THE TITLE, AND NOTHING IN THAT TITLE MAY BE READ AS A CITY. The title reads
   «<type> للبيع في <district>», e.g. «منزل عظم للبيع في النزهه (335/4) ج»; 1,465 of 1,485 titles
   carry that shape. The text goes to find_district_in_text(), which accepts ONLY a
   catalog-attested district and already skips any window containing «مخطط» — this catalog needs
   that: «مخطط الرياض (474/19)» is an Al-Ahsa subdivision plan on 47 listings, and reading it as a
   city would move them 400 km to Riyadh. Scanning these tails against the city catalog is worse
   still: «النخيل» (31), «الزهراء» (28), «الصفا» (22), «النزهة» (15), «الحمراء» (13), «الريان»,
   «الفيصلية», «العزيزية» are ALL both real Saudi city names and Al-Ahsa district names here, so a
   substring city scan mislabels 150+ listings. No city is ever read from the title.
   The pool the district name is matched against is NOT the stored city_id: the governorate-level
   «الاحساء» (3677) carries ZERO districts in the catalog, so matching against it alone would leave
   district_ar NULL on all 1,485 rows. Each Al-Ahsa town's pool is asked and a name is taken only
   when they agree (see resolve_district). The raw title text is always kept verbatim in
   `neighborhood`, so the card shows the office's own «النزهه (335/4) ج» either way.

5. «ثلاث غرف» IS NOT THREE BEDROOMS. The site's own room facet writes «ثلاث غرف» into titles for
   a flat whose description says «▫️غرفتين نوم ▫️مجلس ▫️صاله» — two bedrooms plus reception rooms
   (measured: nid 12644). Bedrooms are therefore read ONLY from an explicit «… غرف نوم» phrase in
   the description, ONLY for a single-dwelling type, and ONLY when every such phrase in the body
   agrees — a multi-unit body («3 غرف نوم» for the ground floor, «غرفتين نوم» for the two flats
   above, nid 9694) is ambiguous and stays NULL. Bathrooms are never counted: this source states
   them per-section («مجلس مع دورة مياه» … «غرفة نوم مع دورة مياه»), so any single number would be
   either a fragment or a prose-derived sum.

ALSO MEASURED, so nothing here is guessed:
  · Deal: 1,382 «للبيع» + 83 «للايجار» in titles; the site's own `field_nw_al_qd_value` facet
    agrees exactly (1,382 / 84), and 19 listings carry no deal value in EITHER place. Those are
    SKIPPED, never defaulted — 18 of them reach the deal check here (the other is skipped one step
    earlier for an unmappable type).
  · Rent period: NOT ONE of the 84 rent listings states a period — all 84 labels are «السعر» (70),
    «السعر شامل الماء» (6) or «السعر على السوم» (4, and those 4 publish no figure at all).
    PERIOD = SOURCE: `rent_period` stays NULL and the figure goes to `price_annual` unconverted.
    A period is read only when the label itself states one. KNOWN CONSEQUENCE, raised in the
    onboarding report: 66 of the 77 priced rents are 12,000-25,000 ﷼ (annual-looking) but 2 are
    under 6,000 (nid 12997 «السعر 1,200»; nid 14510 «السعر 3,600» for a three-storey house), which
    read as monthly. Without a stated period neither the scraper nor the card can tell, and the
    owner's PERIOD = SOURCE rule forbids deciding it from the magnitude.
  · The `field_altsnyf_value` (تجارية/سكنية/زراعية) facet is populated on only 132/1,485 listings
    and on ZERO of the 777 bare-«أرض» ones, so it adds nothing the title does not already carry.
  · Photos: 754 of 1,485 listings carry at least one; the other 731 carry none — and exactly those
    731 index cards show `logo.png`, the office's own logo placeholder, so the thumbnail fallback
    adds nothing and must never publish the logo as a listing photo.
  · A description exists on only 510 of 1,485 (34%) and an «العمر» age on 79 (5%) — the ceiling on
    every amenity and bedroom number this source can ever yield.
  · No listing in the whole catalog carries «مزاد» / «تم البيع» / «مباع» / «محجوز» today. The
    guard is kept anyway — it costs three lines and an ad the office retires in place must never
    stay published on our cards.

MEASURED COVERAGE (every one of the 1,485 detail pages fetched 2026-09-20; the two catalog helpers
stubbed from this repo's own committed mirror src/data/sa-locations.json, since there is no
SUPABASE_SERVICE_ROLE_KEY outside production). 1,448 rows map; 37 are skipped and counted
(18 no deal stated, 15 outside the governorate, 3 unmappable type, 1 unmapped type):
    price in some column 1,219/1,448 (84%)   price_total 1,094 (76%)   price_per_meter 355 (25%)
    area_m2 1,331 (92%)   district_ar 612 (42%)   photo_urls 735 (51%)   bedrooms 140 (10%)
    property_age 77 (5%)  ≥1 Advanced-Filter amenity 350 (24%)   rent_period 0 (the source never
    states one)     residential 1,144 / commercial 304

    python -m scrapers.bossbih.run --type all --limit 15 --dry-run   # validate, zero DB writes
    python -m scrapers.bossbih.run --type all                        # full crawl + prune
"""
from __future__ import annotations

import argparse
import html as html_mod
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize as N  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii  # noqa: E402

BASE = "https://bossbihoffice.com.sa"
SOURCE = "مكتب بوصبيح"
PREFIX = "BSB"
PLATFORM = "bossbih"

MAX_PAGES = 40           # safety stop; the catalog is 10 pages
PAGE_PAUSE = 0.4
DETAIL_PAUSE = 0.25      # the site answers in ~0.3s and applies no rate limiting

# The office's own published city (footer: «الأحساء - حي الملك فهد بالهفوف»). Governorate grain on
# purpose — see docstring §3. region_hint disambiguates the الهفوف/الاحساء same-name twins.
OFFICE_CITY_AR = "الاحساء"
REGION_HINT = "Eastern Province"

# Places OUTSIDE the office's governorate that its titles explicitly name (measured: 14 listings —
# «مدينة بقعاء في حائل», «قرية الشحية في حائل», «مركز الصداوى بمدينة حفر الباطن», «طابه بمدينة
# الشنان», «الفوارة بالقصيم», «حي عدل في الدمام», «الجبيل»). For these the office HAS stated a city
# and it is not Al-Ahsa, so stamping the governorate default on them would write a city the source
# contradicts. SKIPPED and counted — 14 honest absences beat 14 confident errors.
# Deliberately NOT in this list: «الرياض». In this catalog «مخطط الرياض (474/19)» is an Al-Ahsa
# SUBDIVISION PLAN, on 47 listings — the exact false positive abralosol documented for this city.
# MEASURED TOKENS ONLY — every entry below matches at least one real 2026-09-20 title (15 rows in
# total) and none of them matches anything else in the 1,464 tails. Adding a plausible-looking city
# name "for safety" is how a guard starts deleting live inventory: «الظهران» would kill a Hofuf
# listing on «شارع الظهران», and «الخبر» is a prefix of «الخبراء».
OUTSIDE_AREA_TOKENS = ("حائل", "حفر الباطن", "الشنان", "بقعاء", "القصيم", "الدمام", "الجبيل")

# District-NAME pools: the Al-Ahsa towns whose districts the location catalog actually carries
# (city_ids from this repo's own committed catalog mirror, src/data/sa-locations.json — الهفوف has
# 100 districts, المبرز 53, الجفر 61, العمران 32, العيون 31, and the governorate-level «الاحساء»
# (3677) has ZERO, so resolving against the stored city_id alone would return NULL for all 1,485).
# These pools decide the district NAME only. The CITY is never taken from them: a name attested in
# one town's catalog is still the name this office printed, but the TOWN is a claim the source
# never made (docstring §3).
AHSA_DISTRICT_POOLS = ((12, "الهفوف"), (2748, "المبرز"), (2038, "العيون"), (2764, "الجفر"),
                       (2653, "العمران"), (243, "بقيق"), (3700, "جواثا"), (2643, "يبرين"))

# An administrative prefix names a SETTLEMENT, never a district, and «مدينة» in particular collides
# with a real catalog district called «حي المدينة» — leaving it in matched «طابه بمدينة الشنان» to
# that district. Stripped before the text reaches the matcher, which cannot be changed from here.
# The optional leading ب/ل ATTACHES with no space («بمدينة الشنان» is one token), so a \b-anchored
# pattern never sees the word at all — the same attached-prefix shape find_district_in_text() has to
# handle for «بالشوقية».
_ADMIN_PREFIX_RE = re.compile(
    r"(?<![ء-ي])[بل]?(?:مدينة|مدينه|محافظة|محافظه|قرية|قريه|مركز|هجرة|هجره)(?![ء-ي])")

# «الحي <ordinal>» is a SUB-DIVISION of a district on this source, never a district. All 94 tails
# that contain it read «الضاحية الحي الرابع (640/4)» — the fourth slice of ضاحية هجر — or
# «محاسن الحي الثاني». Left in, the matcher returns the catalog's own generic «الحي الأول» / «الحي
# الثاني» (both real districts of الهفوف), so those 94 rows lost their actual place name, and
# «الضاحية الحي الثاني عشر» (the TWELFTH) came back as «الحي الثاني» (the SECOND) because the
# 2-word window matched and stopped. Stripped, so the real name is what gets matched — and when the
# catalog has no entry for it («الضاحية» has none), district_ar is honestly NULL and `neighborhood`
# still shows the office's full text. The owner's 2026-09-13 ruling for the same ضاحية هجر shape on
# amlakalahsa (collapse the numbered slices to ONE match district) is the fix to revisit here once
# «الضاحية» exists in loc_catalog_district for an Al-Ahsa town — see REPORT.
_SUBDIVISION_RE = re.compile(
    r"ال(?:حي|حى)\s+(?:ال)?(?:أول|اول|ثاني|ثانى|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع|عاشر|"
    r"حادي|حادى|عشر)\S*(?:\s+عشر)?")

# The index card's placeholder image: the office logo, served when a listing has no photo at all.
PLACEHOLDER_IMG = "logo.png"

# Per-platform EXACT overrides (map_type_exact contract: spellings/conflicts only, never a new
# canonical type — every value below already exists in the shared taxonomy).
TYPE_OVERRIDES = {
    # This site spells duplex «دبلكس»; the shared map carries «دوبلكس»/«دوبليكس». 134 rows.
    "دبلكس": "Duplex",
    # «نص أرض» is the office's own wording for HALF of a subdivided plot (its own facet value
    # `half`) — land either way, so it resolves to the EXISTING land type. 182 rows. Listed
    # explicitly even though the substring pass would also reach «أرض», so the intent is readable.
    "نص أرض": "Residential Land",
    "نص ارض": "Residential Land",
    # A commercially-zoned apartment block. «عمارة» alone maps to the residential Building, which
    # would route these into the wrong table; Commercial Building is an existing canonical type
    # (normalize.SLUG_TO_TYPE). 6 rows.
    "عمارة تجارية": "Commercial Building",
    "عماره تجارية": "Commercial Building",
    # «ملحق» = the annexe/roof unit let as its own dwelling. Folded to Floor, matching the two
    # platforms that already ship that mapping (eaqartabuk, fahadalshahri). 4 rows.
    "ملحق": "Floor",
    # A maisonette INSIDE a building — the site's own facet keeps it separate from both `flat` and
    # `duplex`. Ezhalah has no "duplex apartment", so the HEAD NOUN decides (شقة) and the source's
    # own phrase survives verbatim in additional_info.type_ar. 13 rows. FLAGGED FOR THE OWNER: the
    # only judgement call in this mapping; both candidates are residential, so the category and the
    # table it lands in are unaffected either way.
    "شقة دبلكسية": "Apartment",
    "شقه دبلكسية": "Apartment",
}

# Types this source publishes that Ezhalah's taxonomy has no honest home for. Precedent:
# scrapers/shmoualshmal/run.py — «محطة» is not necessarily a petrol station (it is also a water or
# a transport station) and «منتجع» sits between Rest House and Hotel. SKIPPED and counted, never
# forced into a neighbouring type. 3 rows today.
TYPE_UNMAPPABLE = ("منتجع", "محطة", "مشغل", "حلاق")

# The ONE spelling the shared map is missing. `overrides` are exact-match by contract, so the
# override row above resolves «دبلكس» but NOT «دبلكس شبه منفصل» / «دبلكس عظم» / «دبلكس متصل» — the
# office appends its condition word to the type and 5 rows resolved to nothing at all. One local
# substring rule for that spelling beats an override row per condition word it may append next.
# REPORT: the clean fix is «دبلكس» in normalize.TYPE_MAP_AR (abralosol needs the same override).
LOCAL_SUBSTRING_TYPES = (("دبلكس", "Duplex"),)

# ── PRICE LABELS ────────────────────────────────────────────────────────────────────────────────
# label → (basis, kind). LONGEST FIRST: «سوم المتر» must never match as «السوم», «حد للمتر» never
# as «الحد». `basis` decides the COLUMN; `kind` is recorded and never changes the column. Same
# table as scrapers/abralosol/run.py — the sister Al-Ahsa Drupal brokerage that uses this exact
# vocabulary — so one office's «الحد» cannot mean something different from another's.
PRICE_LABELS: tuple[tuple[str, str, str], ...] = (
    # ALL EIGHT per-metre forms come before ANY total form. That ordering is the invariant, not a
    # style choice: these are the 17 distinct labels measured across all 1,485 listings, and the
    # only thing every per-metre one has in common is the word «المتر» — «المتر على السوم» (nid
    # 12673: 2,500 on 548 m²) matched «على السوم» and booked a 2,500 ﷼ plot until this was reordered.
    # No total label in the whole catalogue contains «المتر»; test_no_label_containing_almitr_is_ever_
    # a_total pins that over the measured list, so a new label the office invents fails loudly.
    ("سوم المتر", "per_sqm", "offer"),          # 32
    ("السوم للمتر", "per_sqm", "offer"),        # 8
    ("حد المتر", "per_sqm", "reserve"),         # 5
    ("حد للمتر", "per_sqm", "reserve"),         # 2
    ("المتر على السوم", "per_sqm", "offer"),    # 1
    ("المتر قابل للتفاوض", "per_sqm", "negotiable"),   # 2
    ("السعر المتر", "per_sqm", "asking"),       # 2
    ("المتر", "per_sqm", "asking"),             # 313
    ("على السوم", "total", "offer"),            # 158 «السعر على السوم» + 25 bare
    ("السعر", "total", "asking"),               # 692 (+ «شامل الماء» 6, «شامل الرهن» 1)
    ("السوم", "total", "offer"),                # 119
    ("الحد", "total", "reserve"),               # 61
    # NOT mapped, on purpose: the bare «قابل للتفاوض» (1) names a negotiation stance and no basis at
    # all, so it falls through to "no basis anywhere" and both price columns stay NULL.
)
# Every per-metre label must sort before every total label — asserted at import so a future edit
# that appends a new «… المتر» label to the END cannot silently turn a rate into a total.
assert ([b for _l, b, _k in PRICE_LABELS] ==
        sorted((b for _l, b, _k in PRICE_LABELS), key=lambda b: b != "per_sqm")), \
    "PRICE_LABELS: every per_sqm label must precede every total label"

# NO PLAUSIBILITY GATE ANYWHERE BELOW. A bare «السوم» / «الحد» is a total-basis label (this office
# writes «السوم للمتر» / «حد المتر» when it means a rate), and 3 of 119 sampled rows carry a
# total-labelled figure that is tiny for the published area — «السوم 1,200» on a 375 m² plot.
# Owner ruling 2026-08-03, on exactly this shape: «look for this because the platform itself have
# it like this then leave it … make it searchable». The figure is stored as the total the label says
# it is and stays searchable; re-adding a magnitude filter here is a named regression
# (feedback_no-hiding-source-published-prices-rule). test_bossbih_price_basis_and_traps.py pins it.

# An ad the office has retired IN PLACE rather than unpublishing. Never shown.
RETIRED_TOKENS = ("مزاد", "تم البيع", "تم البيع ", "مباع", "تم الإيجار", "تم الايجار",
                  "تم التأجير", "تم التاجير", "محجوز", "ملغي")

_DEAL_RE = re.compile(r"\s(للبيع|للايجار|للإيجار)\s")
# Arabic word numerals, plus the dual forms that carry their own count. Rule
# feedback_arabic-notation-parity-in-deterministic-parsers: a deterministic parser must read
# ٠-٩ AND word numerals, not just ASCII digits. (N.to_int() already handles ٠-٩.)
_WORD_NUM = {
    "غرفة": 1, "غرفه": 1, "غرفتين": 2, "غرفتان": 2, "غرفتي": 2,
    "واحدة": 1, "واحده": 1, "اثنتين": 2, "ثنتين": 2,
    "ثلاث": 3, "ثلاثة": 3, "ثلاثه": 3, "اربع": 4, "أربع": 4, "اربعة": 4, "أربعة": 4,
    "خمس": 5, "خمسة": 5, "خمسه": 5, "ست": 6, "ستة": 6, "سته": 6,
    "سبع": 7, "سبعة": 7, "سبعه": 7, "ثمان": 8, "ثماني": 8, "ثمانية": 8,
    "تسع": 9, "تسعة": 9, "تسعه": 9, "عشر": 10, "عشرة": 10, "عشره": 10,
}
# «3 غرف نوم» · «غرفتين نوم» · «ثلاث غرف نوم» · «غرفة نوم». The «نوم» is REQUIRED: a bare
# «ثلاث غرف» is this site's total-rooms wording, not a bedroom count (docstring §5).
_BED_RE = re.compile(r"(?:([0-9٠-٩]{1,2}|[ء-ي]{2,7})\s+)?(غرفتين|غرفتان|غرفتي|غرفة|غرفه|غرف)\s*"
                     r"(?:ال)?نوم")
# Types whose bedroom count is a fact about ONE dwelling. A Building/Land/Farm/commercial unit's
# room phrases describe units inside it (the wslnaa rooms-are-not-bedrooms rule).
DWELLING_TYPES = {"Apartment", "Villa", "Duplex", "Studio", "Floor", "Room", "Rest House",
                  "Chalet"}


def session() -> cc.Session:
    # impersonate OWNS the User-Agent — setting one contradicts the TLS fingerprint and reads
    # exactly like a block (feedback_impersonate_owns_the_user_agent).
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


def _txt(fragment: Optional[str]) -> str:
    """De-tag one HTML fragment, keeping <br> as a line break. Unescapes entities — a raw `&amp;`
    left in an href 404s every fetch, and left in prose it reaches the card as literal text."""
    if not fragment:
        return ""
    s = re.sub(r"<br\s*/?>", "\n", fragment)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html_mod.unescape(s)
    s = re.sub(r"[ \t ]+", " ", s)
    return "\n".join(ln.strip() for ln in s.split("\n")).strip()


def _label_after(text: str, label: str) -> str:
    """Drop a leading field label («المساحة 500 م» → «500 م»)."""
    t = text.strip()
    return t[len(label):].strip() if t.startswith(label) else t


def _area(raw: str) -> Optional[int]:
    """Area from «المساحة 500 م». A value carrying × or / is a DIMENSION («20*27») or a plot
    reference, not an area — N.to_int() would concatenate its digits into 2027, so it is refused."""
    v = _label_after(raw, "المساحة").rstrip("م").strip()
    if not v or re.search(r"[*x×/]", v):
        return None
    n = N.to_int(v)
    return n if n and n > 0 else None


def _counts(text: Optional[str], pattern: re.Pattern, dual: dict[str, int]) -> Optional[int]:
    """One count from free text, or None. Returns a number ONLY when every occurrence agrees:
    a body that says 3 in one section and 2 in another is describing several units, and either
    figure would be wrong for the listing as a whole."""
    if not text:
        return None
    found: set[int] = set()
    for lead, noun in pattern.findall(text):
        n = None
        if lead:
            n = N.to_int(lead) if re.match(r"^[0-9٠-٩]+$", lead) else _WORD_NUM.get(lead)
        if n is None:
            n = dual.get(noun)
        if n is None:          # «غرف نوم» with no count at all → the source did not say
            return None
        found.add(n)
    if len(found) != 1:
        return None
    n = found.pop()
    return n if 1 <= n <= 20 else None


def _amenities(text: Optional[str]) -> dict[str, bool]:
    """N.amenities_from_text() run per BULLET LINE, then merged.

    The shared matcher decides "negated" from the ~12 characters BEFORE a token and "prepared only"
    from the ~14 AFTER. This office writes exactly one fact per bullet, so those windows cross the
    line break: «▫️الشقة غير مؤثثة\n▫️مطبخ مغلق» came back with kitchen=False — a stated amenity
    turned into an explicit NO, the one direction the tri-state rule forbids (silence is NULL, a
    stated feature is never False). Splitting on the source's OWN line breaks hands the matcher the
    clause it was written for, byte-unchanged; nothing about its four outcomes is reimplemented here.
    Columns whose lines disagree are dropped to NULL rather than letting line order decide.
    """
    if not text:
        return {}
    seen: dict[str, set[bool]] = {}
    for line in re.split(r"[\n\r]+", text):
        for col, val in N.amenities_from_text(line).items():
            seen.setdefault(col, set()).add(val)
    return {col: next(iter(vals)) for col, vals in seen.items() if len(vals) == 1}


def _price_basis(label: Optional[str]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """(matched_label, basis, kind) for a price label, or (None, None, None)."""
    if not label:
        return None, None, None
    for lab, basis, kind in PRICE_LABELS:
        if lab in label:
            return lab, basis, kind
    return None, None, None


# ── INDEX ───────────────────────────────────────────────────────────────────────────────────────
# The card's own «إعلان {id}» badge, NOT the href: the href flips between /{id} and
# /index.php/{id} between otherwise identical responses (docstring §2).
_CARD_ID_RE = re.compile(r"إعلان\s*(\d+)")
_CARD_TITLE_RE = re.compile(r'<h3 class="panel-title[^"]*">\s*<a [^>]*>(.*?)</a>', re.S)
_CARD_DATE_RE = re.compile(r"تاريخ\s*(\d{4}-\d{2}-\d{2})")
_CARD_FACT_RE = re.compile(r'<p class="label label-primary">(.*?)</p>', re.S)
_CARD_PRICE_RE = re.compile(r'<span class="label label-primary">(.*?)</span>', re.S)
_CARD_IMG_RE = re.compile(r'<img class="imgy img-thumbnail" src="([^"]+)"')
_TOTAL_RE = re.compile(r"عدد العقارات\s*:?\s*([0-9٠-٩,]+)")


def parse_index(page_html: str) -> list[dict]:
    """Every card on one index page. Each dict is the card exactly as published."""
    out: list[dict] = []
    for block in page_html.split('<div class="views-row">')[1:]:
        block = block.split('<nav class="pager"')[0]
        m_id = _CARD_ID_RE.search(html_mod.unescape(block))
        m_title = _CARD_TITLE_RE.search(block)
        if not m_id or not m_title:
            continue
        facts = [_txt(f) for f in _CARD_FACT_RE.findall(block)]
        price_txt = ""
        for cand in (_txt(c) for c in _CARD_PRICE_RE.findall(block)):
            _, basis, _k = _price_basis(cand)
            if basis:
                price_txt = cand
                break
        m_img = _CARD_IMG_RE.search(block)
        m_date = _CARD_DATE_RE.search(html_mod.unescape(block))
        out.append({
            "nid": m_id.group(1),
            "title": _txt(m_title.group(1)),
            "bump_date": m_date.group(1) if m_date else None,
            "facts": facts,
            "price_text": price_txt,
            "thumb": m_img.group(1) if m_img else None,
        })
    return out


def fetch_index(s: cc.Session, limit: int = 0) -> tuple[list[dict], Optional[int]]:
    """Walk `?page=` until a page carries no cards. Returns (cards, the site's OWN printed total)
    so the caller can prove the crawl was complete rather than assuming it."""
    cards: list[dict] = []
    seen: set[str] = set()
    printed_total: Optional[int] = None
    for page in range(MAX_PAGES):
        r = s.get(f"{BASE}/?page={page}", timeout=60)
        if r.status_code != 200:
            break
        if printed_total is None:
            m = _TOTAL_RE.search(r.text)
            if m:
                printed_total = N.to_int(m.group(1))
        rows = parse_index(r.text)
        if not rows:
            break
        for c in rows:
            if c["nid"] not in seen:
                seen.add(c["nid"])
                cards.append(c)
        if limit and len(cards) >= limit:
            return cards[:limit], printed_total
        time.sleep(PAGE_PAUSE)
    return cards, printed_total


# ── DETAIL ──────────────────────────────────────────────────────────────────────────────────────
# `field--name-field-als-r` and `field--name-field-als-r2` differ only by the trailing digit, so
# every field name is matched with a (?![0-9-]) guard.
_FIELD_RE = re.compile(r'class="[^"]*field--name-field-([a-z0-9-]+)[^"]*field__item[s]?"[^>]*>'
                       r"(.*?)</div>", re.S)
_ALS_R_ATTR_RE = re.compile(r'content="([0-9.]+)"[^>]*field--name-field-als-r(?![0-9-])')
_PHOTO_RE = re.compile(r'<a class="lightbox"[^>]*href="([^"]+)"')
_FAL_RE = re.compile(r"رخصة فال\s*([0-9٠-٩]+)")
# The site's OWN computed total for a per-metre listing. It lives in a sibling Views block
# (`block-views-block-total-price-block-1`), NOT inside <article>, and it is printed only when the
# label is the bare «المتر» — never for «السعر», and (measured) never for «السوم للمتر» / «حد المتر».
# Where it is printed it equals rate × area to the riyal (1,300 × 428 = «الإجمالي 556,400 ريال»).
# It is read from that block ONLY: the related-ads table further down the page prints OTHER
# listings' prices, and a whole-page search for a figure is how a neighbour's price gets stolen.
_TOTAL_BLOCK = "block-views-block-total-price"
_SITE_TOTAL_RE = re.compile(r"الإجمالي\s*([0-9٠-٩,.]+)")


def parse_detail(page_html: str) -> dict:
    """Everything the detail page publishes, verbatim. No interpretation here."""
    start, end = page_html.find("<article"), page_html.find("</article>")
    art = page_html[start:end] if start >= 0 and end > start else page_html
    fields: dict[str, str] = {}
    for name, frag in _FIELD_RE.findall(art):
        fields.setdefault(name, _txt(frag))
    m_title = re.search(r'<h1 class="page-title">(.*?)</h1>', page_html, re.S)
    m_price = _ALS_R_ATTR_RE.search(art)
    m_fal = _FAL_RE.search(art)
    j = page_html.find(_TOTAL_BLOCK)
    m_site_total = _SITE_TOTAL_RE.search(_txt(page_html[j:j + 800])) if j >= 0 else None
    photos: list[str] = []
    for href in _PHOTO_RE.findall(art):
        u = html_mod.unescape(href)
        u = u if u.startswith("http") else BASE + u
        if u not in photos:
            photos.append(u)
    return {
        "title": _txt(m_title.group(1)) if m_title else None,
        "fields": fields,
        # The machine attribute, not the rendered «1,600,000 ريال» text — one parse instead of two.
        "price_amount": N.to_int(m_price.group(1)) if m_price else None,
        "price_label": fields.get("als-r2") or None,
        "site_total": N.to_int(m_site_total.group(1)) if m_site_total else None,
        "photos": photos,
        "fal_license": m_fal.group(1) if m_fal else None,
    }


def fetch_detail(s: cc.Session, nid: str) -> Optional[dict]:
    r = s.get(f"{BASE}/{nid}", timeout=40)
    # A themed Drupal 404 is still a fully parseable page, so the STATUS is what decides, never
    # "did we find fields" (feedback_a-404-page-is-still-a-parseable-page).
    if r.status_code != 200:
        return None
    d = parse_detail(r.text)
    return d if (d["fields"] or d["title"]) else None


# ── MAPPING ─────────────────────────────────────────────────────────────────────────────────────
def _deal_and_district(title: str) -> tuple[Optional[str], Optional[str]]:
    """«منزل عظم للبيع في النزهه (335/4) ج» → ("Buy", "النزهه (335/4) ج"). No deal word in the
    title → (None, …): the source did not say, and a defaulted deal is a fabricated fact."""
    m = _DEAL_RE.search(f" {title} ")
    if not m:
        return None, None
    deal = "Buy" if m.group(1) == "للبيع" else "Rent"
    tail = f" {title} "[m.end():].strip()
    district = tail[len("في"):].strip() if tail.startswith("في") else None
    return deal, (district or None)


def resolve_district(district_raw: Optional[str]) -> Optional[str]:
    """The catalog's own canonical district name for the office's district text, or None.

    find_district_in_text() is city-scoped and only ever returns a catalog-attested name, so each
    Al-Ahsa town's pool is asked in turn. A name is accepted ONLY when every pool that recognized
    anything recognized the SAME canonical — «مخطط التعاون ( الاسكان )» resolves to «حي التعاون»
    under الهفوف and «حي الاسكان» under العيون/الجفر, and picking one of two different places by
    list order would be a guess, so that case stays NULL and the card keeps the source text.
    """
    if not district_raw:
        return None
    text = _SUBDIVISION_RE.sub(" ", _ADMIN_PREFIX_RE.sub(" ", district_raw))
    found = {d for d in (find_district_in_text(text, cid) for cid, _name in AHSA_DISTRICT_POOLS)
             if d}
    return found.pop() if len(found) == 1 else None


def _type_phrase(title: str) -> str:
    """The words BEFORE the deal word — the source's own type phrase («أرض تجارية», «منزل عظم»)."""
    m = _DEAL_RE.search(f" {title} ")
    return (f" {title} "[:m.start()] if m else title).strip()


def map_listing(ix: dict, detail: Optional[dict]) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason). row is None exactly when the source leaves it unpublishable."""
    detail = detail or {}
    title = detail.get("title") or ix["title"]
    fields: dict[str, str] = detail.get("fields") or {}
    description = fields.get("wsf-al-qar") or None
    haystack = f"{title} {description or ''}"

    if any(tok in haystack for tok in RETIRED_TOKENS):
        return None, "residential", "retired_or_auction"

    type_phrase = _type_phrase(title)
    if any(tok in type_phrase for tok in TYPE_UNMAPPABLE):
        return None, "residential", "type_unmappable_at_source"
    property_type = N.map_type(type_phrase, TYPE_OVERRIDES)
    if not property_type:
        property_type = next((t for tok, t in LOCAL_SUBSTRING_TYPES if tok in type_phrase), None)
    if not property_type:
        return None, "residential", "type_unmapped"
    category = N.category_for_type(property_type).lower()

    deal, district_raw = _deal_and_district(title)
    if not deal:
        return None, category, "no_deal_stated"
    # Written as a total expression so the null-deal lint can prove by AST that the stored value is
    # always "Buy"/"Rent" — a NULL transaction_type is dropped by the search-sync filter.
    transaction_type = "Rent" if deal == "Rent" else "Buy"

    # CITY: derived, at governorate grain, and recorded as derived (docstring §3). A title that
    # names a place OUTSIDE the governorate is the source contradicting that default → skip.
    if district_raw and any(tok in district_raw for tok in OUTSIDE_AREA_TOKENS):
        return None, category, "outside_office_area"
    city_id, region_id = to_catalog(OFFICE_CITY_AR, region_hint=REGION_HINT)
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_ar = resolve_district(district_raw)

    amount = detail.get("price_amount")
    if amount is None:
        amount = N.to_int(re.sub(r"^\D*", "", ix.get("price_text") or "")) or None
    label, basis, kind = _price_basis(detail.get("price_label"))
    basis_from = "detail_label" if basis else None
    if not basis:
        label, basis, kind = _price_basis(ix.get("price_text"))
        basis_from = "index_label" if basis else None

    price_total = price_annual = price_per_meter = rent_period = None
    if amount is not None and basis == "per_sqm":
        # A per-m² rate is not a total, and `area` is NEVER multiplied here to make one. The only
        # total stored for these rows is the one THE SITE ITSELF prints in its «الإجمالي» block —
        # a source-published figure, not our arithmetic. When the site prints none (it does not for
        # «السوم للمتر» / «حد المتر»), price_total stays NULL and the ≈ total is derived in the
        # search/display layer under the owner's 2026-09-03 reversal.
        price_per_meter = amount
        if transaction_type == "Buy":
            price_total = detail.get("site_total")
    elif amount is not None and basis == "total" and transaction_type == "Rent":
        # PERIOD = SOURCE. Only a token in the price LABEL — the field that is ABOUT this figure —
        # may set the period. The description is deliberately NOT searched: it is long prose and a
        # stray «شهري» about something else is a 12x error on the card. No token → NULL period and
        # the figure is stored unconverted.
        # The RAW label, not the matched token: «السعر شهري» carries the period and «السعر» does
        # not, so matching first and then reading the match would throw the period away.
        rp, annual = N.rent_period_and_annual(
            amount, detail.get("price_label") or ix.get("price_text") or "")
        rent_period, price_annual = (rp, annual) if rp else (None, amount)
    elif amount is not None and basis == "total":
        price_total = amount
    # A number with no basis label ANYWHERE stays out of both price columns: the source published a
    # figure but not what it means, and a total is a different fact from a rate. The raw figure
    # survives in additional_info, so nothing published is hidden.

    photos = list(detail.get("photos") or [])
    if not photos and ix.get("thumb") and PLACEHOLDER_IMG not in ix["thumb"]:
        thumb = re.sub(r"/styles/[^/]+/public/", "/", ix["thumb"]).split("?")[0]
        photos = [thumb if thumb.startswith("http") else BASE + thumb]

    bedrooms = (_counts(description, _BED_RE, {"غرفتين": 2, "غرفتان": 2, "غرفتي": 2,
                                               "غرفة": 1, "غرفه": 1})
                if property_type in DWELLING_TYPES else None)

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{ix['nid']}",
        "listing_url": f"{BASE}/{ix['nid']}",
        "source": SOURCE,
        "active": True,
        "title": title or None,
        "description": redact_pii(description),
        # Tri-state, four outcomes: named → True, negated → False, «مؤسس» (prepared-only) → NULL,
        # «قريب من …» (the neighbourhood's, not this unit's) → NULL. Silence is NULL, never False.
        **_amenities(description),
        "property_type": property_type,
        "transaction_type": transaction_type,
        "city": N.map_city(OFFICE_CITY_AR),
        "city_ar": OFFICE_CITY_AR,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _area(fields.get("almsaha") or ""),
        "bedrooms": bedrooms,
        # Stated per-section on this source, so any single number would be a fragment or a sum.
        "bathrooms": None,
        # Only from the «العمر» field, through the shared closed vocabulary; silence → NULL.
        "property_age": N.exact_age(_label_after(fields.get("al-mr") or "", "العمر")),
        # Land is asked ONLY street_width + direction; this labelled field («شارع 15 شرق») answers
        # both. «25*12» (two streets) → NULL width; a compass word only when exactly one is named.
        "street_width_m": N.one_street_width(_label_after(fields.get("shar-rd") or "", "شارع")),
        "direction": N.one_direction(fields.get("shar-rd")),
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": price_per_meter,
        "rent_period": rent_period,
        # A FAILED detail fetch is not the source saying "no photos" — send None so db's
        # unknown-must-not-overwrite-known guard keeps a previously stored list.
        "photo_urls": photos[:20] if (detail or photos) else None,
        "additional_info": redact_capture({k: v for k, v in {
            "price_label": label,
            "price_basis": basis,
            "price_basis_from": basis_from,
            "price_kind": kind,
            "price_amount_raw": amount,
            "site_published_total": detail.get("site_total"),
            "type_ar": type_phrase or None,
            "plot_no": _label_after(fields.get("rgm") or "", "رقم الأرض") or None,
            "block_letter": _label_after(fields.get("alhrf") or "", "حرف") or None,
            "street_width": _label_after(fields.get("shar-rd") or "", "شارع") or None,
            "plot_dimensions": fields.get("hdwd-watwal-al-qar") or None,
            "property_age_raw": fields.get("al-mr") or None,
            "fal_license": detail.get("fal_license"),
            "bump_date": ix.get("bump_date"),      # a REFRESH date, not created_at
            "city_basis": "office_published_city_governorate_grain",
            "district_source": "listing_title" if district_raw else None,
        }.items() if v is not None}),
        # Raw-capture standard: every structured fact the page published, so a field we learn to
        # use tomorrow never needs a re-scrape.
        "source_capture": redact_capture({
            "schema": "bossbih.v1",
            "nid": ix["nid"],
            "index_card": {k: ix.get(k) for k in ("title", "facts", "price_text", "thumb",
                                                  "bump_date")},
            "detail_fields": fields,
            "detail_photos": detail.get("photos") or [],
            "price_amount_attr": detail.get("price_amount"),
            "site_total_block": detail.get("site_total"),
        }),
    }
    return row, category, ""


RES_TABLE = "bossbih_residential_listings"
COM_TABLE = "bossbih_commercial_listings"


# ── LIVENESS ────────────────────────────────────────────────────────────────────────────────────
# Absence from the index only SELECTS candidates; prune_unseen asks this oracle before it may
# deactivate anything, through the shared law (scrapers/common/http_liveness.py), so a 403/429/5xx,
# a timeout or an empty body can never read as a death.
#
# MEASURED 2026-09-21 against the live site, with the full 1,485-card index in hand: the office
# DELETES a node rather than unpublishing it — 5,295 nids inside the live id range (7738-14517) are
# not in the catalogue, and 30 of 30 sampled answered HTTP 404 (the themed 12.5 KB Drupal 404, no
# node id on it; /99999999 the same). 8 of 8 interleaved live nids answered 200 carrying
# data-history-node-id="<nid>" and the price field; through the real _verify_gone, 15 of 15 live
# nids read LIVE and 15 of 15 dead-cohort nids read GONE. A themed 404 is still a parseable page, so the
# STATUS decides a death and the node id decides a life — never "did the page parse".
# An ad retired IN PLACE (RETIRED_TOKENS in its own title/description — the crawl's own predicate)
# is GONE too: without that, the oracle would read a still-served «تم البيع» page as alive and
# self-heal a row the crawl refuses to publish. None carry one today (measured 0/1,485).
def _signal_for(nid: str):
    def _signal(status, body, _moved):
        if status == 404:
            return "gone"
        if status == 200 and f'data-history-node-id="{nid}"' in body:
            d = parse_detail(body)
            own = f"{d.get('title') or ''} {(d.get('fields') or {}).get('wsf-al-qar') or ''}"
            return "gone" if any(tok in own for tok in RETIRED_TOKENS) else "live"
        return None
    return _signal


def _verify_gone(ad_number: str) -> tuple[str, str]:
    nid = ad_number[len(PREFIX):]
    if not nid.isdigit():
        return "unknown", f"{ad_number!r} is not a {PREFIX}<nid> ad number"
    return LivenessProbe(platform=PLATFORM, signal=_signal_for(nid), session=session,
                         url_for=lambda _ad: f"{BASE}/{nid}").verify_gone(ad_number)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run(PLATFORM)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        cards, printed_total = fetch_index(s, limit=args.limit)
        if not cards:
            raise RuntimeError("index returned no cards (0 of an expected ~1,485)")
        note = f"{len(cards)} cards, site printed total {printed_total}"
        print(f"{SOURCE}: {note}", flush=True)
        if printed_total and not args.limit and len(cards) != printed_total:
            # Not fatal — but it must be RECORDED, or a half-crawl looks like a shrinking catalog.
            print(f"  ! crawl/total mismatch: enumerated {len(cards)} vs printed {printed_total}")
        for c in cards:
            detail = fetch_detail(s, c["nid"])
            time.sleep(DETAIL_PAUSE)
            if detail is None:
                skipped["detail_fetch_failed"] = skipped.get("detail_fetch_failed", 0) + 1
                continue
            row, cat, why = map_listing(c, detail)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        tally = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if tally:
            print(f"  skipped (not guessed): {tally}")
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>9} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):18} d={str(r0['district_ar'])[:14]:14} "
                      f"a={str(r0['area_m2']):>6} bd={str(r0['bedrooms']):>4} "
                      f"pt={r0['price_total']} "
                      f"ppm={r0['price_per_meter']} "
                      f"pa={r0['price_annual']} rp={r0['rent_period']} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0
        db.upsert_bossbih_residential_batch(res)
        db.upsert_bossbih_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table=RES_TABLE, com_table=COM_TABLE,
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        degraded = False
        if args.type == "all":
            # A --type run visits only half the catalog, so the other table's "seen" set is empty by
            # construction — not because the source dropped those ads. prune_unseen's own 0-seen
            # breaker would skip it, but it would also report -1 and demote a perfectly good run.
            for table, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                pruned = db.prune_unseen(table, {r["ad_number"] for r in rows}, SOURCE,
                                         verify_gone=_verify_gone)
                degraded = degraded or pruned < 0
                print(f"  {table}: pruned {pruned}")
        # notes carries the skip tally so an empty/thin run says WHY in the database itself.
        healthy = db.end_run(run_id, ok=True, rows_seen=len(cards),
                             rows_upserted=len(res) + len(com), degraded=degraded,
                             notes=f"{note}; skipped: {tally or 'none'}"[:300],
                             check_tables=["bossbih_residential_listings",
                                           "bossbih_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=f"{e}; skipped: "
                             f"{', '.join(f'{k}x{v}' for k, v in skipped.items()) or 'none'}"[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
