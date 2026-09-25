"""صفا للاستثمار (Safa Investment) — safainv.sa. 41 ready units, onboarding 2026-09-24.

SOURCE SHAPE (measured live 2026-09-24; every number below was captured, not assumed).
A Laravel site in front of an Odoo ERP (images come from safa-erp.odoo.com). It is a DEVELOPER's own
inventory, not a classifieds board: there is NO public JSON list API and NO standalone page per unit.
Four server-rendered surfaces, all plain `impersonate="chrome"`, no auth, no proxy:

    GET  /projects?page=N              3 pages  ┐ 55 projects, each carrying TWO badges
    GET  /projects/commercial?page=N   1 page   ┘ (see READY ONLY below)
    GET  /project/<id>                          the project's LABELLED city + «الموقع» district
    GET  /project/units/<id>?page=N             that project's AVAILABLE sale units, 21 per page
    GET  /units/rental?page=N                   the rent surface, 21 per page (22 units over 2)
    POST /unit/details  {_token, unit_id}       → {"status":true,"data":{"html": <the unit sheet>}}

  A unit is published as a CARD inside a list; «عرض المزيد» POSTs the card's `data-id` to
  /unit/details and renders the returned HTML as a popup. The CSRF token the POST needs is printed
  in the list page's own `csrfToken: "…"`. Both halves are per-unit and both are read: the card is
  the only place the deal label, the type chip and the furnishing chip appear; the sheet is the only
  place the price block, the area breakdown, the room counts and the gallery appear.

  PAGINATION ends on an empty page, verified on both shapes: /units/rental served 21, 1, 0 and
  /project/units/60 served 21, 21, 21, 9, 0. A page repeating the previous page's ids also stops the
  walk, so a pagination bug cannot spin.

  MEASURED INVENTORY. 55 projects; only SIX list a single available unit; 162 unit cards in total
  (22 rent + 140 sale). The other 49 projects — every «مباع» and every «قريباً» — serve
  «لا توجد نتائج بحث مطابقة» and zero cards, so the roster's sold-out state and the unit lists agree.

READY ONLY — AND THE PERCENTAGE IS NOT THE ORACLE
-------------------------------------------------
Each /projects card prints two badges in its `.label` div, and they are different statements:

    availability : «متاح للبيع» (9)  ·  «مباع» (41)  ·  «قريباً» (5)
    build state  : «وحدات جاهزة» (44 — READY)  ·  «على الخارطة» (10 — OFF-PLAN)  ·  absent (1)

«على الخارطة» is the Saudi term for selling off the plan, and beside it the card renders a
«نسبة الإنجاز» completion bar. THE BAR IS NOT THE SIGNAL: صفا 80 (project 57) reads «على الخارطة»
AT 100% نسبة الإنجاز, while projects 64, 87 and 42 publish NO bar at all and read «وحدات جاهزة».
Measured bars: 57=100%, 44=65.66%, 108=55.75%, 61=47.5%, 60=42.5%, 82=20.8%, 129=2.7%. So readiness
is taken from the BADGE only — the code never reads a percentage — and a project with no build badge
(144, «صفا 99») is readiness UNSTATED and skips too, because an unstated readiness is not a ready
unit. Live effect: 117 of the 162 cards sit behind «على الخارطة» (57→31, 60→72, 61→14) and are
skipped with a counted reason; 1 more (project 77, a project absent from both indexes) skips unstated.

  THE SALES BADGE MUST NOT GATE RENT. «مباع» is the SALE state of a delivered building: 17 of the 18
  mapped rentals live inside «مباع» + «وحدات جاهزة» projects (28, 32, 35, 45, 50, 56, 58, 74, 128).
  Reading it as a removal would empty the whole rent surface. It gates only a Buy card, where a
  sold-out project offering a unit for sale would be a contradiction — which is counted, not guessed
  (0 live occurrences).

THE PRICE BLOCK: THREE `<h3>`s, AND TWO OF THEM ARE THE WRONG NUMBER
--------------------------------------------------------------------
Every unit sheet renders the price as

    <h3 id="total_price">75,000</h3>
    <h3 class="d-none" id="property_sale_price_without_tax">1,179,844</h3>
    <h3 class="d-none" id="property_sale_price_with_tax">1,129,844</h3>
    <span class="total_amount_text">المبلغ الإجمالي</span>

Only `#total_price` is visible and only `#total_price` is stored. The two `d-none` siblings are the
unit's SALE valuation, so on a RENT sheet they are a different number about a different transaction:
unit 12827 publishes a rent of 75,000 next to a hidden 1,179,844 — storing either would publish that
listing at ~15x its price. They are also internally inconsistent (the "without_tax" node is the
LARGER on all 140 sale sheets, so at least one of the two names is wrong) and sometimes junk (0 on
unit 12476, 14,921 on 19221). On the sale side `#total_price` equalled `with_tax` on 32 of 140 sheets
and neither node on the other 108, so there is no rule that would let a hidden node substitute.
Both raws are kept in additional_info under names that say what they are, never near a price column.
«المبلغ التأميني» (2,000 on unit 12827) is a security DEPOSIT and is kept raw for the same reason.

NOTHING IS EVER COMPUTED. No x12, no rate x area, no deposit arithmetic — there is no per-metre
figure on this site at all. And the choice of field provably moved no number: the CARD prints its own
copy of the price and the area, and card and sheet AGREED on all 162 units for both. Both card raws
are stored so that agreement stays auditable from the row.

RENT PERIOD = SOURCE, AND THE DESCRIPTION IS NOT THE SOURCE
-----------------------------------------------------------
The price label is the only place this site could attach a period to that figure, and it does not:
all 22 rent sheets read «المبلغ الإجمالي» ("Total Amount" in the EN locale) with no qualifier, and
the whole rent surface — 22 sheets plus both list pages, in both locales — contains ZERO occurrences
of سنوي / شهري / يومي / أسبوعي. So rent_period is NULL on 18 of 18 mapped rentals and the figure is
stored exactly as published. safa is deliberately absent from SINGLE_PERIOD_PLATFORMS: the platform
makes no site-wide statement either.

The period is deliberately NOT read from the description. 157 of the 162 sheets carry the same
marketing blurb verbatim («تبدأ تجربة الحياة المثالية…»), so a period word in it would be a fact
about Safa's copywriting, not about this unit's price — the shape that turned a 9,600 listing into
115,200 on abaad. The LABEL is different: it is attached to the very number stored, so the shared
audited normalize.rent_period_and_annual() is run on it and nothing else. If Safa ever labels the
figure «الإيجار سنوي» it stores verbatim; «شهري» takes the schema's documented x12; يومي/أسبوعي/
نصف سنوي/ربع سنوي yield (None, None) — a rate this schema has no bucket for is not inflated into one.

listing_url — THE PLATFORM'S OWN SHARE LINK IS BROKEN, SO IT IS NOT USED
------------------------------------------------------------------------
A unit's sheet is opened by the list page's own script: `?property_id=<id>` makes it click
`.unitCard[data-id=<id>]`. So the real per-listing URL is the LIST PAGE THAT CONTAINS THAT CARD, and
the page NUMBER is part of it. All three facts measured:

    /units/rental?property_id=12827              card present  → the sheet opens
    /units/rental?property_id=19221              card ABSENT   → nothing ever opens (it is on page 2)
    /units/rental?page=2&property_id=19221       card present  → the sheet opens
    /project/units/45?property_id=12827          card ABSENT   → the site's OWN copy button for that
                                                  rental, pointing at a page its card is not on

The sheet's `copyURL(...)` is therefore kept in additional_info.source_canonical_url as evidence and
never used as the URL. VERIFIED 200 carrying THAT listing's own content — its unit code and its
price, inside its own card block — on SAF12235, SAF13213, SAF12301 and SAF12867 (a browser render was
not available in this run; the check is that the card's own HTML is on the page the script reads).

REMOVAL ORACLE (measured 2026-09-24 — the sheet endpoint is NOT an oracle)
--------------------------------------------------------------------------
/unit/details answers 200 with a complete sheet for units the site does not publish anywhere: 12828
(SF050-B01-F01-010-APT, 762,000 — a SOLD unit of a «مباع» project), 12236, 12237, 13208, 14149 and
19222 all rendered in full. So "the sheet still loads" would resurrect sold inventory forever. A unit
id the ERP has never held answers HTTP 500 (0, 1, 100, 5000, 12000, 19220, 999999) — and a 5xx can
never kill a row under the shared law anyway.

What IS decisive is the surface's own roster: a unit is published iff its card is on the list. The
probe therefore performs a DIRECT read that walks every page of the surface named by the row's own
stored listing_url:

    card present on the surface        → live
    card absent, whole surface walked  → gone
    any page non-200 / empty body      → UNKNOWN (an incomplete walk returns an EMPTY body, which
                                         read_is_unbelievable() turns into a retry and then UNKNOWN)

Walking the whole surface rather than the one stored `?page=N` is not caution, it is required:
removing one card shifts every later unit a page earlier, so a live row would read as absent. The
law in http_liveness is untouched — `_SafaProbe` overrides only `fetch`, the platform's own read.
Removals are additionally gated by an in-run positive control that fails CLOSED, and rows are built
from LIST pages, so mark_direct_alive() is deliberately NOT called.

WHAT THE SOURCE PUBLISHES, AND WHAT IS NEVER GUESSED
----------------------------------------------------
  · TYPE comes from the card's own chip: شقة (119 cards), تاون هاوس (35), فيلا (4), دوبلكس (1).
    «تاون هاوس» → Villa is the fleet fold (TYPE_MAP_EN 'Townhouse' → 'Villa'; taxonomy.source.json
    lists «تاون هاوس» among Villa's rawTypes; justsa/rawasidark already do exactly this). «الدور» →
    Floor covers the unit filter's own definite-article spelling. 3 rent cards publish NO chip at
    all: they skip as type_missing. The unit code's «-APT» suffix is an identifier component, not a
    published type, and nothing is read from it. The filter also offers «مساحة عمل مشتركه» and
    «Mixed Use Tower», which have no safe fleet mapping — unmapped, counted, raised below.
  · «N غرف» IS the bedroom count, and the site has no «غرف نوم» field to compare it with. Read off
    its own numbers rather than its label: project 64 advertises «عدد الغرف 2 - 3» for 166 m² flats
    and for 241.87 m² roof units that carry 2 bathrooms. Two TOTAL rooms in 241 m² with two separate
    bathrooms is not a floor plan; two bedrooms is. The icon beside the count draws a bed. The raw
    count is kept in additional_info.total_rooms_raw either way.
  · AREA. The sheet's headline figure equalled «إجمالي المساحة» on all 162 units, so area_m2 is that
    total. «مساحة الوحدة» and «المساحة الإضافية» (non-zero on 113 units) are kept RAW rather than
    guessed into interior_space_m2 / outdoor_area_m2 — «الإضافية» does not say what it is.
  · COUNT TRI-STATES through the shared count_flag: «0 مكيفات» is rendered as a chip on 143 sheets,
    so 0 is the source's own NO (air_conditioner False on 25 mapped rows); an absent box is UNKNOWN.
    Parking is published as a positive count on every unit (1 or 2, never 0).
  · KITCHEN. The same «نوع المطبخ : X» label carries two independent facts, layout (مفتوح 123 /
    مغلق 1) and fit-out (مؤسس 16 / غير مؤسس 4), and a unit can print both boxes. A named layout or a
    fitted kitchen sets kitchen True; «غير مؤسس» is the source NEGATING the fit-out and is never read
    as a positive; an empty «نوع المطبخ :» (40) sets nothing.
  · FURNISHED comes from the card's own chip «مفروشة بالكامل» (8 cards), matched by EQUALITY on the
    whole chip — a substring test on «مفروش» also fires on «غير مفروش». No negative chip exists on
    this site, so a missing chip is SILENCE → NULL.
  · FLOOR. The slot holds «الأول»/«الأرضي»/… AND «GF», «FF», «SF», «RF», «سَطح» and multi-level
    combos («GF FF», «GF FF SF» — a townhouse's own floors). Only the unambiguous Arabic ordinals
    become floor_number (19 of 41); everything else stays in additional_info.floor_raw rather than
    being decoded.
  · LOCATION comes from /project/<id>, which LABELS both fields (`div.city` and a box titled
    «الموقع»). The CARD's location slot is unusable for this: across the 162 cards it holds an
    English city on 148 ("Riyadh" 116, "Jeddah" 18, "Qassim" 14) and an Arabic DISTRICT on 11
    («الملقا», «الياسمين», «ظهرة لبن», «عرقة» …) — one slot, two kinds of place. It is kept raw and
    also used as a district fallback WITHIN the already-resolved city. All 41 mapped rows resolve
    both city and district.
  · PHOTOS are the sheet gallery's own product.image URLs. Verified: HTTP 200, Content-Type
    image/jpeg, no cross-origin-resource-policy and no x-frame-options. 24 of 41 rows carry photos
    (234 URLs); the sheet OMITS the gallery element entirely for a unit with none, so 0 is the
    source's own state. The card's `property.property&field=main_image` URL is NOT used as a photo:
    the same URL shape answers 200 with a 6,078-byte placeholder PNG when the ERP holds no image
    (unit 13365) while serving a real 357 KB jpeg for another (12715), and 12 cards render the site's
    own /front/assets/images/default.jpg instead. A 200 there is not proof anything renders. The URL
    is kept in additional_info.card_main_image_url for the archive.
  · THE PROJECT FEATURE LIST IS BOILERPLATE AND SETS NO AMENITY. «مميزات المشروع» («مصاعد»,
    «مداخل خاصة», «موقف خارجي وداخلي», «كاميرات مراقبة» …) is byte-identical on all 13 project pages
    opened, including projects in different cities. It is marketing copy about the brand, not a fact
    about a unit, so elevator/private_entrance/etc. are never set from it. The sheet's own
    internal/external feature lists (`#internal`, `#external`) are EMPTY on all 162 units.
  · NOT PUBLISHED ANYWHERE on this site: an auction («مزاد» 0 occurrences — no auction path exists),
    a REGA ad licence («رخصة»/«فال» 0), a price RANGE or «يبدأ من» (0), «تحت الإنشاء» (0), a property
    age, a street width, a direction, a deed or plan number, a view count, a publication date.

PDPL
----
Every page carries the sales office's phone (920001912), info@safainv.sa, a WhatsApp link and a lead
form with a live CSRF token. NO fetched HTML is ever stored: both JSONB payloads are built from an
explicit ALLOWLIST of parsed scalars and then run through redact_capture() (free text redacted,
URLs/ids/numbers byte-identical) and strip_pii_fields(). The title, the description, the district and
the project name go through redact_pii() on their way into their columns. An allowlist rather than a
blocklist because the markup we never named is exactly where a future contact widget would appear.

COVERAGE (full --dry-run against the live site, 2026-09-24)
-----------------------------------------------------------
55 projects → 162 unit cards → 41 mapped (40 residential + 1 commercial), 121 skipped and counted:
«على الخارطة» 117, type_missing 3, readiness unstated 1.
Deal split 23 Buy / 18 Rent. Types: Apartment 36, Villa 4, Duplex 1.
Cities: الرياض 23, جدة 18. Projects represented: 28, 32, 35, 42, 45, 50, 56, 58, 64, 74, 87, 128.
  price_total 23 (644,492 … 4,166,311) · price_annual 18 (55,000 … 130,000) · rent_period 0 of 18
  area_m2 41 · bedrooms 41 · bathrooms 41 · parking 41 (all True) · air_conditioner 41 (16 True /
  25 False) · kitchen 38 · furnished 6 · floor_number 19 · photo_urls 24 (234 URLs) · district_ar 41
  · project_name 41 · description 40 · title 41

OPEN QUESTIONS FOR ONBOARDING (none of these are guessed in code)
-----------------------------------------------------------------
  · «مساحة عمل مشتركه» (co-working space) and «Mixed Use Tower» appear in the unit filter's own type
    list with no safe fleet mapping. No card carries either today; when one does it will skip as
    type_unmapped with the word in the reason.
  · The 3 rent cards with no type chip (12881, 13024, 13099 — all real, priced, ready flats) are lost
    inventory. Ask Safa to publish the type, or get an owner decision on whether the unit code's
    «-APT»/«-VIL»/«-DPX» suffix may be read as the type.
  · Project 77 («SAFA 57») is absent from both /projects indexes and publishes no city, no district
    and no build badge, yet owns a live rental (19221, 120,000). Is it unpublished on purpose?
  · normalize.category_for_type files Duplex as COMMERCIAL fleet-wide, so the one duplex
    (SAF12867, SF052-A01-F02-011-DPX) lands in safa_commercial_listings. That is the shared rule
    applied verbatim, not a safa choice — but a duplex is a dwelling, so whether the split is right
    is a normalize-level question for every platform at once.
  · «القصيم» is used in one project's city field; it is a REGION and resolves to no city (that
    project is off-plan today, so nothing is lost yet). Which Qassim city is صفا 86 - إليت in?
  · The hidden `property_sale_price_without_tax` is LARGER than `property_sale_price_with_tax` on
    every sheet. One of the two names is wrong in the ERP. Worth telling Safa, and worth remembering
    if anyone is ever tempted to read them.
  · «المساحة الإضافية» (non-zero on 113 units, up to 62 m²) — is it a terrace, a roof, or a share of
    common area? The answer decides whether it belongs in outdoor_area_m2.
  · The card's main_image sometimes holds a real photo the sheet's gallery does not list (unit
    12715). Ask for the per-unit image list, or accept the gallery as the whole truth.
"""
from __future__ import annotations

import argparse
import html as _html
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
from scrapers.common.pii import redact_capture, redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://safainv.sa"
DETAIL_API = f"{BASE}/unit/details"
RENT_SURFACE = f"{BASE}/units/rental"
SOURCE = "صفا للاستثمار"
PREFIX = "SAF"
SLUG = "safa"

# The project roster's own badges, read verbatim off the /projects cards. The availability badge's
# third value, «متاح للبيع», needs no constant: nothing keys on it, only «مباع» gates anything.
READY = "وحدات جاهزة"          # the source's own READY marker
OFF_PLAN = "على الخارطة"        # the source's own OFF-PLAN marker ("sold on the map")
SOLD_OUT = "مباع"

# «تاون هاوس» is not in the shared TYPE_MAP_AR; the fleet fold is TYPE_MAP_EN 'Townhouse' → 'Villa'
# and src/data/taxonomy.source.json lists «تاون هاوس» among Villa's own rawTypes. justsa/rawasidark
# already apply exactly this override. «الدور» is the filter's own definite-article spelling of دور.
_TYPE_OVERRIDES = {"تاون هاوس": "Villa", "الدور": "Floor"}

_DEAL = {"للبيع": "Buy", "للإيجار": "Rent"}

# The source's own furnishing chip, matched by EQUALITY on the whole chip. A substring test on
# «مفروش» would also fire on «غير مفروش» and store an explicitly UNfurnished flat as furnished
# (the 2026-08-05 fleet defect). No negative chip exists on this site (0 occurrences), so a missing
# chip is SILENCE → NULL, never False.
_FURNISH_CHIPS = {"مفروشة بالكامل": True}

# «نوع المطبخ : X» — the source renders TWO independent kitchen facts under the same label: the
# layout (مفتوح/مغلق) and the fit-out (مؤسس/غير مؤسس). A named layout or a fitted kitchen is a
# kitchen; «غير مؤسس» is the source NEGATING the fit-out and is never read as a positive.
_KITCHEN_POSITIVE = {"مفتوح", "مغلق", "مؤسس"}

# Only the unambiguous Arabic ordinals. GF/FF/SF/RF and the multi-floor combos («GF FF», «GF FF SF»
# — a townhouse's own levels) and «سَطح» are NOT guessed into a number; they stay raw in
# additional_info.floor_raw. Same shape as aqaralriyadh's _FLOOR.
_FLOOR_AR = {"الأرضي": 0, "الارضي": 0, "الأول": 1, "الاول": 1, "الثاني": 2, "الثالث": 3,
             "الرابع": 4, "الخامس": 5, "السادس": 6, "السابع": 7, "الثامن": 8}

# One card's body: from its own `data-id` marker to the start of the NEXT card, or to the pagination
# block that closes the grid. Without the pagination alternative the LAST card on a page would absorb
# the whole rest of the document (39 KB of footer on /units/rental?page=2) — harmless today, since
# nothing after the grid repeats a card selector, but only by luck.
_CARD_RE = re.compile(r'<div class="overlay unitCard" data-id="(\d+)"></div>'
                      r'(.*?)(?=<div class="col-lg-4 mb-3|<div class="col-12" id="custom-pagination"'
                      r'|\Z)', re.S)
_PROJ_CARD_SPLIT = '<div class="item project-card-item">'


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")     # impersonate OWNS the User-Agent
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


def _text(fragment: str) -> str:
    """Visible text of an HTML fragment: SVG paths out first (they are full of letters), then tags."""
    t = re.sub(r"<svg.*?</svg>", " ", fragment or "", flags=re.S)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", _html.unescape(t)).strip()


def _clean(v) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


def _one(pattern: str, body: str, *, text: bool = True) -> Optional[str]:
    m = re.search(pattern, body or "", re.S)
    if not m:
        return None
    return _clean(_text(m.group(1))) if text else _clean(m.group(1))


def _lead_int(s: Optional[str]) -> Optional[int]:
    """The leading count of «3 غرف» / «٣ غرف». Arabic-Indic digits parse through normalize.to_int."""
    m = re.match(r"\s*([\d٠-٩]+)", s or "")
    return normalize.to_int(m.group(1)) if m else None


def _price(raw: Optional[str]) -> Optional[int]:
    """A displayed riyal figure → int, or None. «0» / «» is the ABSENCE of a published price, not a
    price of zero — this platform publishes a formatted total on every unit, and a blank or 0 would
    mean the ERP has none to show."""
    n = normalize.to_int(raw)
    return n or None


# ── PROJECT ROSTER — where READY vs OFF-PLAN is stated, in the source's own words ────────────────
def fetch_project_roster(s: cc.Session) -> dict[str, dict[str, Any]]:
    """{project_id: {availability, readiness}} from the two /projects indexes' own badges.

    Both badges live in the card's `.label` div: the first `<a>` is the sales state
    («متاح للبيع» / «قريباً» / «مباع») and the second is the build state («وحدات جاهزة» /
    «على الخارطة»). A project may carry only the first (project 144), which is readiness UNSTATED.
    """
    roster: dict[str, dict[str, Any]] = {}
    for path in ("/projects", "/projects/commercial"):
        page = 1
        while True:
            body = _get(s, f"{BASE}{path}?page={page}")
            cards = body.split(_PROJ_CARD_SPLIT)[1:]
            if not cards:
                break
            before = len(roster)
            for card in cards:
                m = re.search(rf'href="{re.escape(BASE)}/project/(\d+)"', card)
                lab = re.search(r'<div class="label">(.*?)</div>', card, re.S)
                if not m:
                    continue
                labels = [_text(a) for a in re.findall(r"<a [^>]*>(.*?)</a>", lab.group(1), re.S)] \
                    if lab else []
                labels = [x for x in labels if x]
                roster.setdefault(m.group(1), {
                    "availability": labels[0] if labels else None,
                    "readiness": labels[1] if len(labels) > 1 else None,
                })
            if len(roster) == before:
                break                       # the index repeated itself — stop rather than loop
            page += 1
    if not roster:
        raise RuntimeError(f"{BASE}/projects served no project cards — the roster is the readiness "
                           f"oracle, so nothing may be mapped without it")
    return roster


def fetch_project_meta(s: cc.Session, pid: str, cache: dict[str, dict]) -> dict[str, Any]:
    """{name, city_ar, district_raw} from /project/<id>, which LABELS both location fields.

    The unit CARD's own location span is not usable for this: measured across all 162 cards it holds
    an English city ("Riyadh", "Jeddah", "Qassim") on 148 and an Arabic DISTRICT («الياسمين»,
    «ظهرة لبن») on 11 — the same slot, two different kinds of place. The project page instead prints
    `div.city` and a box labelled «الموقع», so each value is read from the field the source named.
    """
    if pid in cache:
        return cache[pid]
    body = _get(s, f"{BASE}/project/{pid}")
    meta = {
        "name": _one(r"<h1[^>]*>(.*?)</h1>", body),
        "city_ar": _one(r'<div class="city">(.*?)</div>', body),
        "district_raw": _one(r'<span class="Grey-700 fs-18">الموقع</span>\s*<h4>(.*?)</h4>', body),
    }
    cache[pid] = meta
    return meta


# ── UNIT CARDS ───────────────────────────────────────────────────────────────────────────────────
def walk_cards(s: cc.Session, surface: str) -> list[dict[str, Any]]:
    """Every unit card on a paginated surface, each carrying the page URL it was found on.

    21 cards per page; an empty page ends the walk (measured on /units/rental — 21 then 1 then 0 —
    and on /project/units/60 — 21,21,21,9,0). A page that repeats the previous page's ids also ends
    it, so a pagination bug cannot spin forever.
    """
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    page = 1
    while True:
        url = f"{surface}?page={page}"
        body = _get(s, url)
        found = _CARD_RE.findall(body)
        ids = {uid for uid, _ in found}
        if not found or ids <= seen:
            break
        for uid, card in found:
            if uid in seen:
                continue
            seen.add(uid)
            out.append({"unit_id": uid, "page_url": url, **parse_card(card)})
        page += 1
    return out


def parse_card(card: str) -> dict[str, Any]:
    """The four facts only the CARD publishes, plus its own copies of area/price for the archive."""
    chips = [_text(x) for x in
             re.findall(r'<span class="category mb-1 justify-content-center">(.*?)</span>', card, re.S)]
    return {
        "deal_ar": _one(r'fa fa-key mainColor mx-1"></i>\s*([^<]{1,40})', card),
        "type_ar": _one(r'<span class="type mx-1 justify-content-center">(.*?)</span>', card),
        "project_code": _one(r'class="mx-1 projectName"[^>]*>(.*?)</a>', card),
        "unit_code": _one(r'<span class="unit-title"[^>]*>(.*?)</span>', card),
        "card_location": _one(r'class="location d-flex align-items-center">(.*?)</div>', card),
        "card_area_raw": _one(r'class="space d-flex align-items-center mx-3">(.*?)</div>', card),
        "card_price_raw": _one(r'<div class="price" dir="ltr">(.*?)<div class="icons', card),
        # NOT a photo. The same URL shape serves a 6,078-byte placeholder PNG for a unit the ERP has
        # no image for (measured: unit 13365 → image/png 6,078; unit 12715 → image/jpeg 357,754), so
        # a 200 here is not proof that anything renders. Kept for the archive, never in photo_urls.
        "card_main_image_url": _html.unescape(
            _one(r'<img src="(https://safa-erp\.odoo\.com/web/image[^"]+)"', card, text=False)
            or "") or None,
        "furnishing_chips": [c for c in chips if c] or None,
    }


def fetch_unit(s: cc.Session, unit_id: str, token: str) -> Optional[str]:
    """The unit's own detail sheet: the exact POST the page's «عرض المزيد» handler makes.

    There is no standalone unit page on this platform — the sheet is a popup rendered from this
    endpoint's `data.html`. A unit id the ERP does not hold answers HTTP 500 (measured on 0, 1, 100,
    5000, 12000, 19220, 999999), which is why an unreadable sheet is counted and never guessed.
    """
    r = None
    for attempt in range(3):
        r = s.post(DETAIL_API, data={"_token": token, "unit_id": unit_id},
                   headers={"X-CSRF-TOKEN": token, "X-Requested-With": "XMLHttpRequest"},
                   timeout=45)
        if r.status_code not in TRANSIENT_STATUSES:
            break
    if r is None or r.status_code != 200:
        return None
    try:
        body = r.json()
    except ValueError:
        return None
    if not isinstance(body, dict) or not body.get("status"):
        return None
    return ((body.get("data") or {}).get("html")) or None


def parse_popup(popup: str) -> dict[str, Any]:
    """The unit sheet's own structured facts.

    THE PRICE BLOCK IS THE SITE'S HARDEST TRAP and it is read here, deliberately narrowly. The block
    holds THREE `<h3>`s: the visible `#total_price` and two `d-none` siblings named
    `property_sale_price_without_tax` / `property_sale_price_with_tax`. On a RENT sheet those hidden
    two hold the unit's SALE valuation — unit 12827 shows a rent of 75,000 beside a hidden
    1,179,844 — so reading either one would store a rent at ~15× its published figure. They are also
    internally inconsistent (the "without_tax" figure is the LARGER on all 140 sale sheets) and
    sometimes junk (0 on unit 12476, 14,921 on 19221). `#total_price` is the only published price;
    the hidden pair is kept raw in additional_info under names that say what it is, and never near a
    price column. «المبلغ التأميني» is a security DEPOSIT and is kept raw for the same reason.
    """
    areas = {label: value for label, value in (
        (_text(a), _clean(b)) for a, b in re.findall(
            r'class="ar-label">(.*?)</span>\s*<span class="ar-value">([^<]*)<', popup, re.S))}
    infos = [_text(x) for x in re.findall(r'<div class="info">(.*?)</div>', popup, re.S)]
    boxes = [_text(x) for x in re.findall(r'class="feature_box">(.*?)</div>', popup, re.S)]

    rooms = bathrooms = ac = parking = None
    parking_kind: Optional[str] = None
    kitchen_words: list[str] = []
    for box in boxes:
        if re.fullmatch(r"[\d٠-٩]+\s*غرف", box):
            rooms = _lead_int(box)
        elif "دورة المياه" in box:
            bathrooms = _lead_int(box)
        elif "مكيفات" in box:
            ac = _lead_int(box)
        elif "موقف سيارات" in box:
            parking = _lead_int(box)
            parking_kind = box
        elif box.startswith("نوع المطبخ"):
            w = _clean(box.split(":", 1)[1]) if ":" in box else None
            if w:
                kitchen_words.append(w)

    photos: list[str] = []
    for u in re.findall(r'<img [^>]*src="(https://safa-erp\.odoo\.com/web/image[^"]+)"', popup):
        u = _html.unescape(u)
        if u not in photos:
            photos.append(u)

    return {
        "unit_title": _one(r'<h3 class="unit_title">(.*?)</h3>', popup),
        "description": _one(r'<div class="desc">\s*<span>(.*?)</span>', popup),
        "canonical_url": _one(r"copyURL\('([^']+)'\)", popup, text=False),
        "price_raw": _one(r'id="total_price">([^<]*)<', popup),
        "hidden_sale_without_tax_raw": _one(r'id="property_sale_price_without_tax">([^<]*)<', popup),
        "hidden_sale_with_tax_raw": _one(r'id="property_sale_price_with_tax">([^<]*)<', popup),
        # Scoped to the `.total` block: the SECOND total_amount_text is the deposit's label.
        "price_label": _one(r'<div class="total">.*?<span class="total_amount_text">(.*?)</span>',
                            popup),
        "insurance_raw": _one(r'class="insurance">.*?<h3>([^<]*)</h3>', popup),
        "area_unit_raw": areas.get("مساحة الوحدة"),
        "area_extra_raw": areas.get("المساحة الإضافية"),
        "area_total_raw": areas.get("إجمالي المساحة") or (infos[0] if infos else None),
        "floor_raw": infos[1] if len(infos) > 1 else None,
        "rooms": rooms,
        "bathrooms": bathrooms,
        "ac_count": ac,
        "parking_count": parking,
        "parking_kind": parking_kind,
        "kitchen_words": kitchen_words or None,
        "photos": photos or None,
    }


def _rent_fields(price: Optional[int], label: Optional[str]) -> tuple[Optional[str], Optional[int]]:
    """(rent_period, price_annual) for a safa rent — read from the PRICE LABEL and nowhere else.

    The label is the only place this source could state a period, and it does not: on every one of
    the 22 rent sheets it reads «المبلغ الإجمالي» ("Total Amount" in the EN locale) with no
    qualifier, and the whole rent surface — 22 sheets plus both list pages, in both languages —
    contains ZERO occurrences of سنوي/شهري/يومي/أسبوعي. So rent_period is NULL and the price is
    stored exactly as published, unconverted.

    THE PERIOD IS DELIBERATELY NOT READ FROM THE DESCRIPTION. 157 of the 162 sheets carry the same
    marketing blurb verbatim («تبدأ تجربة الحياة المثالية…»), so a period word appearing in it would
    be a statement about Safa's copywriting, not about this unit's price — exactly the shape that
    turned a 9,600 listing into 115,200 on abaad. The label, by contrast, is attached to the very
    number stored, so the shared audited parser may act on it: «سنوي» stores the figure verbatim,
    «شهري» takes the schema's documented ×12 annualisation, and يومي/أسبوعي/نصف/ربع yield
    (None, None) — a rate this schema has no bucket for is not inflated into one.
    """
    return normalize.rent_period_and_annual(price, label or "")


def map_listing(card: dict[str, Any], popup: dict[str, Any], project: dict[str, Any],
                project_id: Optional[str]) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) for ONE unit. row is None exactly when a reason is set."""
    if not project_id:
        return None, "residential", "no_project_link"

    # READY ONLY, on the source's OWN badge. «على الخارطة» is the Saudi term for an off-plan sale and
    # the /projects card prints it beside a «نسبة الإنجاز» completion bar (2.7% … 100%); «وحدات
    # جاهزة» is the source saying the units are ready. Neither is inferred from the percentage: صفا 80
    # reads «على الخارطة» AT 100% completion, so the badge and the bar are different statements and
    # only the badge is read. A project carrying no build badge at all is readiness UNSTATED and also
    # skips — an unstated readiness is not a ready unit.
    readiness = project.get("readiness")
    if readiness != READY:
        return None, "residential", f"not_ready_{readiness or 'unstated'}"

    deal = _DEAL.get(card.get("deal_ar") or "")
    if not deal:
        return None, "residential", f"deal_unknown_{card.get('deal_ar') or 'blank'}"
    # A project the roster calls SOLD OUT cannot also be offering a unit for sale. Today no «مباع»
    # project lists a single sale card (measured: 0 across all 49 of them), so this only ever fires
    # on a future contradiction — and a contradiction is counted, not resolved by guessing.
    if deal == "Buy" and project.get("availability") == SOLD_OUT:
        return None, "residential", "project_sold_out"

    type_ar = card.get("type_ar")
    if not type_ar:
        # 3 of the 22 rent cards publish no type chip at all. The unit code's «-APT» suffix is an
        # identifier component, not a published type, so nothing is inferred from it.
        return None, "residential", "type_missing"
    property_type = normalize.map_type_exact(type_ar, _TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", f"type_unmapped_{type_ar}"
    category = normalize.category_for_type(property_type).lower()

    city_ar = project.get("city_ar")
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        # «القصيم» is a REGION, not a city — the source uses it in the city field on one project.
        return None, category, "city_not_in_catalog"
    district_raw = project.get("district_raw")
    district_ar = find_district_in_text(district_raw, city_id) \
        or find_district_in_text(card.get("card_location"), city_id)

    price = _price(popup.get("price_raw"))
    area_total = normalize.to_int(popup.get("area_total_raw"))
    desc = redact_pii(popup.get("description"))

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{card['unit_id']}",
        # The page that actually renders this unit: its own card lives in this HTML, and the page's
        # auto-open script opens THAT unit's sheet from `?property_id=`. The platform's own copy
        # button is broken for rentals — it points at the unit's project page, where the card is
        # absent (measured: /project/units/45?property_id=12827 has no data-id 12827) — and the page
        # number matters, so the harvested page URL is used rather than the site's link.
        "listing_url": f"{card['page_url']}&property_id={card['unit_id']}",
        "source": SOURCE,
        "active": True,
        "title": redact_pii(card.get("unit_code") or popup.get("unit_title")),
        "description": desc,
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": redact_pii(district_raw),
        "project_name": redact_pii(project.get("name")),
        "area_m2": area_total,
        # «N غرف» with a bed-and-door icon. There is no «غرف نوم» field anywhere on this site, and a
        # TOTAL-rooms reading is refuted by the source's own numbers: project 64 advertises «عدد
        # الغرف 2 - 3» for 166 m² flats and 241 m² roof units — 2 rooms in 241 m², with 2 separate
        # bathrooms, is not a floor plan. The raw count is kept in additional_info either way.
        "bedrooms": popup.get("rooms"),
        "bathrooms": popup.get("bathrooms"),
        # Counts → tri-state via the shared count_flag: a published 0 is the source's own NO (the UI
        # renders «0 مكيفات» as a chip on 143 sheets), a missing box is UNKNOWN. Never (n or 0) > 0.
        "air_conditioner": normalize.count_flag(popup.get("ac_count")),
        "parking": normalize.count_flag(popup.get("parking_count")),
        "floor_number": _FLOOR_AR.get(popup.get("floor_raw") or ""),
        "photo_urls": popup.get("photos"),
    }
    kitchen = [w for w in (popup.get("kitchen_words") or []) if w in _KITCHEN_POSITIVE]
    if kitchen:
        row["kitchen"] = True
    furnished = {_FURNISH_CHIPS[c] for c in (card.get("furnishing_chips") or [])
                 if c in _FURNISH_CHIPS}
    if furnished == {True}:
        row["furnished"] = True

    if deal == "Rent":
        period, row["price_annual"] = _rent_fields(price, popup.get("price_label"))
        if period:
            row["rent_period"] = period
    else:
        row["price_total"] = price
    row["price_evidence"] = normalize.price_evidence(
        field="unit sheet #total_price", raw=popup.get("price_raw"),
        stored=row.get("price_total") if deal == "Buy" else row.get("price_annual"),
        kind="total" if deal == "Buy" else (row.get("rent_period") or "annual"),
        unit="total", origin="structured", authoritative_absent=False)
    # Every sheet renders a gallery container, so "observed" is always true; the ERP serves a 6 KB
    # placeholder PNG for an id it does not hold, so a count is the only honest claim here.
    row["images_evidence"] = {"observed": True, "container_present": True,
                              "key_present": bool(popup.get("photos")),
                              "count": len(popup.get("photos") or [])}

    info = {
        "source_unit_id": card["unit_id"],
        "unit_code": card.get("unit_code"),
        "project_code": card.get("project_code"),
        "project_id": project_id,
        "project_readiness": readiness,
        "project_availability": project.get("availability"),
        "type_ar": type_ar,
        "deal_ar": card.get("deal_ar"),
        "card_location_raw": card.get("card_location"),
        "card_main_image_url": card.get("card_main_image_url"),
        # The card's own copies of the two numbers that matter. They agreed with the sheet on ALL 162
        # units (price and area alike), so keeping both makes the choice of field auditable from the
        # row instead of from a re-fetch.
        "card_price_raw": card.get("card_price_raw"),
        "card_area_raw": card.get("card_area_raw"),
        "source_area_total_raw": popup.get("area_total_raw"),   # exact m², before area_m2's round
        "source_area_unit_raw": popup.get("area_unit_raw"),     # «مساحة الوحدة»
        "source_area_extra_raw": popup.get("area_extra_raw"),   # «المساحة الإضافية»
        "source_price_raw": popup.get("price_raw"),
        "source_price_label": popup.get("price_label"),
        # The two `d-none` siblings of the published price. Named for what they are so nothing
        # downstream can mistake them for this listing's price: on a rent sheet they are the unit's
        # SALE valuation, and they disagree with each other and with #total_price.
        "hidden_sale_price_node_without_tax_raw": popup.get("hidden_sale_without_tax_raw"),
        "hidden_sale_price_node_with_tax_raw": popup.get("hidden_sale_with_tax_raw"),
        "insurance_deposit_raw": popup.get("insurance_raw"),    # «المبلغ التأميني» — a deposit
        "total_rooms_raw": popup.get("rooms"),
        "air_conditioner_count": popup.get("ac_count"),
        "parking_raw": popup.get("parking_kind"),
        "kitchen_words": popup.get("kitchen_words"),
        "floor_raw": popup.get("floor_raw"),
        "furnishing_chips": card.get("furnishing_chips"),
        "source_canonical_url": popup.get("canonical_url"),
    }
    row["additional_info"] = strip_pii_fields(
        redact_capture({k: v for k, v in info.items() if v is not None}))
    # PDPL. The stored payload is built from THESE keys only — never from the fetched HTML, which
    # carries the sales office's phone (920001912), info@safainv.sa, a WhatsApp link and a lead form
    # with a CSRF token on every page. An allowlist of parsed scalars cannot leak a contact channel
    # that appears in markup we did not name, and redact_pii runs over the two free-text values.
    row["source_capture"] = strip_pii_fields(redact_capture({
        "schema": "safa.unit-details.v1",
        **{k: v for k, v in info.items() if v is not None},
        "unit_title": popup.get("unit_title"),
        "description": desc,
    }))
    return row, category, ""


# ── FETCH ────────────────────────────────────────────────────────────────────────────────────────
def _get(s: cc.Session, url: str) -> str:
    r = None
    for attempt in range(3):
        r = s.get(url, timeout=45)
        if r.status_code not in TRANSIENT_STATUSES:
            break
    if r is None or r.status_code != 200:
        raise RuntimeError(f"{url} returned {getattr(r, 'status_code', 'no response')}")
    return r.text or ""


def _csrf(body: str) -> Optional[str]:
    return _one(r'csrfToken: "([^"]+)"', body, text=False)


def crawl(s: cc.Session, limit: int = 0) -> tuple[list[dict], dict[str, dict], bool, dict[str, int]]:
    """Every card on every surface + the project roster + whether the walk was COMPLETE.

    Complete means: the project roster was served, every project's unit list walked without an HTTP
    error, and every card's own sheet read. Only then may anything be pruned — a surface that half
    failed must never look like a shrunken catalogue.
    """
    roster = fetch_project_roster(s)
    cards = walk_cards(s, RENT_SURFACE)
    for pid in roster:
        cards += walk_cards(s, f"{BASE}/project/units/{pid}")
    print(f"{SOURCE}: {len(roster)} projects, {len(cards)} unit cards", flush=True)
    complete = True
    if limit:
        cards, complete = cards[:limit], False
    token = _csrf(_get(s, RENT_SURFACE))
    if not token:
        raise RuntimeError(f"{RENT_SURFACE} no longer carries the CSRF token the unit sheet needs")
    unreadable: dict[str, int] = {}
    out: list[dict] = []
    for card in cards:
        popup = fetch_unit(s, card["unit_id"], token)
        if not popup:
            unreadable["sheet_unreadable"] = unreadable.get("sheet_unreadable", 0) + 1
            complete = False
            continue
        out.append({"card": card, "popup": parse_popup(popup)})
    return out, roster, complete, unreadable


def _project_id_of(popup: dict[str, Any], card: dict[str, Any]) -> Optional[str]:
    """The unit's own project, from the sheet's own copy link; else the surface it was harvested on.

    Measured agreement on all 162 units: the copy link's project id equals the walked project for
    every sale unit, and it is the ONLY place a rental's project is published at all.
    """
    for src in (popup.get("canonical_url"), card.get("page_url")):
        m = re.search(r"/project/units/(\d+)", src or "")
        if m:
            return m.group(1)
    return None


# ── LIVENESS (measured 2026-09-24 — this platform has no standalone listing page) ────────────────
class _SafaProbe(LivenessProbe):
    """A DIRECT read on safa means walking the SURFACE the listing lives on, not one URL.

    There is no per-unit page: a unit is published as a card inside a paginated list, and the sheet
    endpoint is not an oracle — it answered 200 with full content for every unlisted id we tried
    (12828, a sold SF050 unit; 12236; 13208; 14149; 19222), so "the sheet still renders" would
    resurrect sold inventory forever. Only the list says what is published.

    Reading the stored `?page=N` URL alone is not enough either: removing one card shifts every
    later unit a page earlier, so a live row could read as absent. So this overrides `fetch` to walk
    every page of that surface and hands the LAW one joined body. A walk that could not be completed
    returns an EMPTY body, which `read_is_unbelievable()` turns into a retry and then UNKNOWN — the
    law is untouched and a broken walk can never kill a row.
    """

    def fetch(self, url: str) -> tuple[Optional[int], str, bool]:
        surface = re.sub(r"\?.*$", "", url or "")
        if not surface:
            return None, "", False
        try:
            s = self.session()
            pages: list[str] = []
            status = None
            page = 1
            while page <= 40:
                r = s.get(f"{surface}?page={page}", timeout=self.timeout)
                status = r.status_code
                if status != 200 or not (r.text or ""):
                    return status, "", False        # incomplete walk → never a death
                found = _CARD_RE.findall(r.text)
                if not found:
                    break
                pages.append(r.text)
                page += 1
            return status, "".join(pages), False
        except Exception:  # noqa: BLE001 — an unreachable source is never proof of death
            return None, "", False


def _signal_for(unit_id: str):
    def signal(status, body, _moved) -> Optional[str]:
        """The surface's own roster is the whole opinion: the card is there, or the unit is gone."""
        if status != 200:
            return None
        return "live" if f'data-id="{unit_id}"' in (body or "") else "gone"
    return signal


def _make_verify_gone(control: Optional[dict]):
    # The row's OWN stored listing_url names its surface — never rebuilt from the ad_number, which
    # carries only the unit id and cannot say which list published it.
    url_for = stored_listing_url((f"{SLUG}_residential_listings", f"{SLUG}_commercial_listings"))

    def probe(ad_number: str, canary=None):
        uid = ad_number[len(PREFIX):] if ad_number.startswith(PREFIX) else ""
        if not uid.isdigit():
            return "unknown", f"{ad_number!r} is not a {PREFIX}<unit id> ad number"
        return _SafaProbe(platform=SLUG, signal=_signal_for(uid), session=session,
                          url_for=url_for, canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        uid = control["ad_number"][len(PREFIX):]
        verdict, why = _SafaProbe(platform=SLUG, signal=_signal_for(uid), session=session,
                                  url_for=lambda _ad: control["listing_url"]).verify_gone(
            control["ad_number"])
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
    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        units, roster, complete, skipped = crawl(s, limit=args.limit)
        if not units:
            raise RuntimeError(f"{BASE} served no readable unit sheets")
        meta_cache: dict[str, dict] = {}
        for u in units:
            card, popup = u["card"], u["popup"]
            pid = _project_id_of(popup, card)
            project = dict(roster.get(pid or "", {}))
            if pid and project:
                project.update(fetch_project_meta(s, pid, meta_cache))
            row, cat, why = map_listing(card, popup, project, pid)
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
            for r0 in (res + com)[:25]:
                print(f"   {r0['ad_number']:>9} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):10} {str(r0['city_ar']):8} "
                      f"d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>5} "
                      f"bd={str(r0.get('bedrooms')):>4} ba={str(r0.get('bathrooms')):>4} "
                      f"pt={r0.get('price_total')} pa={r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} fl={r0.get('floor_number')} "
                      f"fu={r0.get('furnished')} ac={r0.get('air_conditioner')} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0
        # The public upsert_safa_*_batch wrappers are added centrally at onboarding; same funnel.
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
            print("  prune skipped: the walk was incomplete (a surface or a sheet did not read)")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(units),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} complete={complete} {notes}"[:300],
                             check_tables=["safa_residential_listings",
                                           "safa_commercial_listings"])
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
