"""نفوذ للاستثمار العقاري (Nofodh) — www.nofodh.sa. A developer selling its OWN units.

Onboarded 2026-09-24. Every number below was MEASURED against the live site on that date; nothing in
this file is assumed. Unrelated to our existing `nufouth` platform (nufouth.com) despite the similar
transliteration — different company, different site, and the slug is `nofodh` everywhere.

SOURCE SHAPE
------------
A Laravel + Livewire app on the `homez` theme, server-rendered, behind CloudFront. No API: the
listing data is in the rendered HTML, plus a few Livewire `wire:snapshot` component states.

  ROSTER = THE SITE'S OWN SITEMAP. robots.txt is `Disallow:` (nothing) and names
  `Sitemap: https://www.nofodh.sa/sitemap.xml`. That sitemap is ONE flat urlset (no sitemapindex)
  carrying 2,601 distinct `/listings/<id>` entries — the platform's own complete index, not a
  pagination we reconstruct from Livewire. `/listings` and `/projects` serve byte-identical pages and
  both print «إظهار 1–7 من 7 نتائج»: only the seven PROJECT containers are browsable, and the ~2.6k
  unit pages are reachable only through the sitemap or a project's own sub-listing cards.

  DETAIL URL = {BASE}/listings/<id>. There is a second route, `/listings/sub/<id>`, which serves the
  SAME content (compared byte-for-byte on id 163694); the sitemap publishes the plain form and that is
  what is stored. PER-LISTING IDENTITY IS PROVEN, not assumed: across all 501 pages fetched for this
  build, the id in the URL equalled the page's own «رقم العقار» 501/501, and the 501 pages carried
  501 DISTINCT (price, area, unit-code) triples. So no two rows share a page and no row shares a
  building page — the azure/rightcompound unit-grain exception is not needed here.

  TITLE. The page has no listing title and NO DESCRIPTION FIELD AT ALL. What it does publish is the
  unit's own code, in its map iframe's `title` and an <h2>: «WAP-BLK54-6» (project-block-plot),
  «B2-14», «304A», «19». That is stored as `title`; `description` stays NULL fleet-wide for this
  platform. (On a PROJECT page the same slot holds the project NAME — «الموسى رزيدنس 2» — which is
  another reason those pages are skipped rather than mapped.)

  PHOTOS. `/listings/<id>_<hash>/<file>`. Verified 200 + `Content-Type: image/jpeg` with no
  cross-origin-resource-policy header, so they embed. Most unit pages carry none.

THE TRAPS, ALL MEASURED
-----------------------
1. «السعر 0» IS NOT A PRICE. The site number_format()s whatever the column holds, so an unpriced unit
   renders a literal «0» and its component state reads `min_price: 0`. Fourteen of a 44-page spread
   were in that state. Storing it publishes a free property. A SOLD unit goes further and omits the
   «السعر» row entirely (id 531729). Both are UNKNOWN → NULL, and deliberately a plain None rather
   than db.AUTHORITATIVE_NULL: a 0 cannot be told apart from "nobody typed a price yet", so it must
   not be licensed to erase a figure an earlier crawl read. See read_price().

2. THE PRINTED PRICE IS ROUNDED AND THE MODEL'S IS NOT. id 432014 prints «530,697» while its
   `homez.booking-component` holds 530696.94; id 314771 prints «40,249» for 40248.74. Two published
   figures, differing by up to a riyal on every fractional row. What is stored is the DISPLAYED one —
   the number the source shows on the listing, and therefore the number a real-user comparison
   against the source checks — with the exact float kept verbatim in
   `additional_info.source_price_exact` and in price_evidence. The two must agree to within the
   rounding that produced them; a wider gap REFUSES the row (`price_mismatch`) instead of picking a
   winner, because neither figure is derived from the other and there is nothing to reconcile.

3. NO PER-METRE PRICE EXISTS HERE, so none is invented. «سعر المتر» appears 0 times across a listing
   page, a project page and every unit page sampled — even though most of the inventory is land plots
   whose per-metre rate would be trivial to divide out. `price_per_meter` is never written, and a
   total is never rebuilt from a rate × area.

4. RENT PERIOD = SOURCE, AND THIS SOURCE NEVER SAYS. There is no period field, the price prints under
   a bare «السعر» with no qualifier, and the platform has no description in which a listing could
   state one. So every rent stores its figure EXACTLY as published with `rent_period` NULL — a 62 m²
   Riyadh flat at 17,000 and a 47 m² one at 6,300 are plausibly annual and plausibly not, and the
   source does not say. nofodh is deliberately ABSENT from SINGLE_PERIOD_PLATFORMS: the platform makes
   no site-wide statement either, so there is nothing to adopt.

5. A PROJECT PAGE IS NOT A LISTING, and it is exactly the shape the READY-ONLY rule names. The seven
   containers publish a price BAND rendered abbreviated («550.0K - 830.0K», «718.4K - 22.6M»), a
   «مباع» percentage bar (0 / 51 / 75 / 78%), and «عدد الوحدات» / «عدد الوحدات المباعة» /
   «عدد الوحدات المتبقية». TWO INDEPENDENT source markers are checked and neither may cover for the
   other: the type word «مشروع», and `max_price` > 0 differing from `min_price`. id 914863 is why —
   it is a project whose eight units are all one price, so min == max and only the type word catches
   it. The abbreviated band text never reaches a price column by any path.

6. THE TYPE VOCABULARY IS HALF UNTRANSLATED. Arabic types resolve through the shared TYPE_MAP_AR
   («أرض», «شقة», «فيلا»); for the types whose Arabic string is missing the platform leaks the bare
   enum constant onto the page — `WAREHOUSE`, `WORKSHOP`, `RETAIL_STORE`, `OFFICE`. Those are mapped
   by an EXPLICIT override dict, not by title-casing a rule, so a constant added upstream tomorrow
   cannot be auto-guessed into a type. «بلوك» (a land block, id 531729) has no fleet meaning and is
   skipped, counted.

7. TWO LABELS FOR ONE FIELD. The «تفاصيل العقار» table and the «نظرة عامة» strip name the same fact
   differently — «الحمامات» vs «حمام», «غرف نوم» vs «غرفة نوم». Both spellings are read; reading only
   the table's would silently drop every overview-only row.

8. «سنة البناء» IS NOT A BUILD YEAR. It prints a DATE, and that date is identical to «تاريخ النشر» on
   every page measured (2026-05-15 on essentially the whole catalogue). It is the import timestamp
   wearing a build-year label, so it NEVER becomes `property_age`; the raw value is kept in
   `additional_info.source_build_year_raw` and raised as an open question.

9. PDPL. Every page carries the developer's own «920029555» and «info@nofodh.sa» in its footer and
   JSON-LD Organization block, and the interested/booking forms embed a full country-code picker.
   Both stored payloads are built from EXPLICIT ALLOWLISTS — a LABEL allowlist (_KNOWN_LABELS /
   _ADDRESS_LABELS) for the capture and a named key list for additional_info — and every stored value
   then goes through redact_pii(). The label allowlist is what carries the NAME guarantee: redact_pii
   deliberately does not strip human names (db.redact_capture must not eat a sellerLicenseNumber-style
   regulatory value), so an advertiser-identity label the platform might add is kept out by never
   being admitted rather than by being scrubbed. The platform publishes no advertiser field today.

THE WAF — AND WHY A 202 IS THE MOST DANGEROUS RESPONSE THIS SITE SENDS
---------------------------------------------------------------------
CloudFront fronts an AWS WAF challenge that answers with **HTTP 202** — a SUCCESS code — and a
2,047-byte `window.gokuProps` / `awsWafCookieDomainList` shim instead of the listing.

MEASURED: a first walk at 8 concurrent workers with no pacing served 351 real pages and then flipped
to 202 for every one of the remaining 2,250 — including ids that had answered 200 minutes earlier.
It is NOT the handshake: once the state was set, ten TLS profiles from the same IP (chrome,
chrome116/120/124/131, safari17_0, safari15_5, firefox133, edge101, edge99) all drew the identical
202, so unlike ialqarawi there is no profile that is served and negotiation is not attempted. The
cooldown is short — a paced probe recovered after 123 s — and a re-walk at 3 workers with ~0.6 s
spacing (0.80 req/s, measured) drew ZERO challenges over 150 of the very ids that had been blocked.

Counted as absence, 2,250 challenges look exactly like 2,250 listings vanishing at once. So:
  · the challenge is recognised by its BODY, not its status, and checked BEFORE the 404 branch in
    both the crawl and the liveness signal — a challenge wrapped in a 404 would otherwise be read as
    this platform's hard delete, turning one block into one deletion;
  · it is retried with growing backoff (to ~24 s) and counted APART from every real skip;
  · any surviving challenge clears the crawl's completeness, so NOTHING is pruned that run;
  · past 5% of the roster the run RAISES, because a fraction of the catalogue must not be recorded as
    a healthy run over the whole of it.
The pacing defaults are that measured ceiling, not a guess. Slow is the only correct speed here.

REMOVAL ORACLE (measured 2026-09-24 — a 200 is NOT proof of life)
-----------------------------------------------------------------
A SOLD unit KEEPS its page. id 531729 answers 200 with full content, «حالة العقار: مباع», and its
«السعر» row simply gone — so an "is it 200?" oracle would never retire anything this developer sells.
What decides is the state the page prints about ITSELF, from the platform's own «حالة البيع» enum
(read off its filter checkboxes, so the list is complete and the platform's, not ours):

    404                                    → gone   (a REAL hard 404, identical 23,648-byte error
                                                     page: 7/7 on ids 999999999 / 0 / 1 / abc /
                                                     111111 and the two ids adjacent to a live one,
                                                     149627 and 149629. No soft-404 shell exists.)
    200 + «للبيع» / «للإيجار»               → live   (the offer is open; this also self-heals a row
                                                     absent from OUR crawl rather than from the site)
    200 + مباع / مؤجر / محجوز / مدفوع /      → gone   (the source's own statement that the unit left
          تحت الصيانة / TRANSFERRED /                 the market)
          MORTGAGED / محجوب
    200 + «قريباً»                          → UNKNOWN. Not-yet-released is not a removal. We never
                                             store such a row, so neither verdict is earned.
    a WAF challenge, any status             → UNKNOWN (about our access, never about the listing)
    200 with no «حالة العقار» row            → UNKNOWN
Removals are additionally gated by an in-run positive control that fails CLOSED, and rows are built
from page fetches of each listing's own URL.

OPEN QUESTIONS FOR ONBOARDING (none of these are guessed in code)
-----------------------------------------------------------------
  · PLATFORM NAME. The roster line reads «نفوذ العقارية للاستثمار»; the site's own <title>, JSON-LD
    `name` and footer all say «نفوذ للاستثمار العقاري». SOURCE uses the site's own wording. If the
    registry/UI label should be the roster wording instead, this constant is the single place to change.
  · «أرض» → «Residential Land» is the shared TYPE_MAP_AR fold, applied verbatim. But one of the seven
    projects is «مخطط طيبة الصناعي» — an INDUSTRIAL land plan — so some of these plots are not
    residential. The source's own «الفئة» (سكني / تجاري / زراعي / استثماري / Hotel / Office) would
    say, and is preserved in `additional_info.source_category_raw`, but it is printed on only a
    handful of pages. Whether a stated «تجاري» should move a land row to the commercial table is a
    normalize-level question for every platform at once, so nothing here overrides the shared rule.
  · «سنة البناء» carries the publish date (trap 8). Is there a real construction year behind it?
  · «الطوابق» is a COUNT of floors; the listing tables carry `floor_number` (which storey) and no
    floors-count column, so it is preserved in additional_info only.
  · NON-SAUDI INVENTORY. The district picker includes Istanbul («حي قولجك», «حي سافكوي»,
    «حي بيليك دوزو», «حي أتاشهير», «حي مالتبه») and «درةالمنسك», so the platform sells abroad. Such a
    row skips as `city_not_in_catalog` rather than being filed under a Saudi neighbour. Whether
    Ezhalah should carry non-Saudi listings at all is an owner/product decision.
  · REGA. No FAL/ad-licence number is printed on any page, so `license_number` and `license_expiry`
    stay NULL — worth asking the platform for, since the fleet stores them where published.
  · A daily cron must budget ~55 minutes for the paced walk of 2.6k pages (see the WAF section), or
    be given a residential-proxy route so the rate ceiling stops being the constraint.

DETAIL, MEASURED
----------------
  · A project's «عدد الوحدات» totals 2,229 across the seven, while the sitemap carries 2,594 unit
    pages — so ~365 unit pages belong to projects the browsable list no longer shows. Those are
    walked like any other and land or skip on their own published state.
  · No amenity is published anywhere on this platform — no features list on a unit page, only the
    filter dialog's site-wide «تشطيب مميز» / «واجهات عصرية ومودرن». So every amenity column stays
    NULL: SOURCE IS TRUTH, absent is not False.
  · `homez.booking-component.showPrice` is `false` even on units that DO print a price (id 149628),
    so it is not a price-presence signal and is not read as one.
  · The 3.6 MB page weight is the country-code picker, repeated per embedded form; the listing's own
    markup is a few kilobytes of it.
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

BASE = "https://www.nofodh.sa"
SITEMAP = f"{BASE}/sitemap.xml"
SOURCE = "نفوذ للاستثمار العقاري"
PREFIX = "NFD"
SLUG = "nofodh"

# ── THE SOURCE'S OWN VOCABULARIES, read off its own «حالة البيع» / «النوع» filter checkboxes ──────
# The filter renders the complete enum, so these lists are the platform's, not ours.

# «حالة العقار» → transaction side. ONLY these two states are an open offer.
_DEAL = {"للبيع": "Buy", "للإيجار": "Rent"}

# The other nine states the filter publishes. Each is a COUNTED skip under the source's own word —
# never a heuristic, and never folded into Buy/Rent.
_OFF_MARKET = {
    "مباع": "sold",
    "مؤجر": "already_rented",
    "محجوز": "reserved",
    "مدفوع": "paid",
    "تحت الصيانة": "under_maintenance",
    "TRANSFERRED": "transferred",
    "MORTGAGED": "mortgaged",
    "محجوب": "hidden_by_source",
}
# «قريباً» is the source's own NOT-YET marker (the READY-ONLY rule's off-plan case). It is kept
# apart from _OFF_MARKET because it is not a removal: a unit that has not launched has not left.
_NOT_YET = {"قريباً": "coming_soon_not_released"}

# «نوع العقار». Arabic words resolve through the shared TYPE_MAP_AR; the platform ALSO leaks
# untranslated enum constants for the types whose Arabic string is missing (measured: WAREHOUSE,
# WORKSHOP, RETAIL_STORE, OFFICE render as bare SCREAMING_SNAKE on the page). Those are listed
# EXPLICITLY rather than title-cased by a rule, so a constant added upstream tomorrow cannot be
# auto-guessed into a type — it lands in type_unmapped and is reported.
_TYPE_OVERRIDES = {
    "WAREHOUSE": "Warehouse",       # TYPE_MAP_EN['Warehouse']
    "WORKSHOP": "Workshop",         # TYPE_MAP_EN['Workshop']
    "OFFICE": "Office",             # TYPE_MAP_EN['Office']
    # The fleet already folds a retail store to Shop from two other vocabularies
    # (TYPE_MAP_EN['Commercial Shop'] and aldarim's 'store'), so this is that same fold, not a new
    # judgement.
    "RETAIL_STORE": "Shop",
    # COMMERCIAL_GALLERY is NOT read as "gallery" — the PLATFORM names these units itself, in their
    # own unit codes: every one of the twelve in حي طيبة is coded «محل -1» … «محل -12», and «محل» is
    # shop. 48-65 m² units with one bathroom agree. So this is the source's own word for them, not an
    # inference from the enum's English.
    "COMMERCIAL_GALLERY": "Shop",
    # STORAGE, likewise confirmed by the source twice over: the unit code is «WH0050-B-4-SN» (WH =
    # warehouse) and the fleet's TYPE_MAP_EN already folds aldarim's 'storage' → 'Warehouse'.
    "STORAGE": "Warehouse",
}
# The source's container type. Its page is a PROJECT, never a listing — see _skip_container.
_CONTAINER_TYPE = "مشروع"

# «تفاصيل العقار» / «نظرة عامة» label → the column it feeds. Read off the labels the pages print.
# The «تفاصيل العقار» table and the «نظرة عامة» strip label the SAME field differently — plural in
# the table, singular in the strip — so both spellings of each are read. Measured over the whole
# roster: details «الحمامات» / overview «حمام» (344 rows), details «غرف نوم» / overview «غرفة نوم»
# (14 rows). Reading only the table's spelling would have dropped every overview-only row.
_BATHROOMS = ("الحمامات", "حمام")
_BEDROOMS = ("غرف نوم", "غرفة نوم", "غرف النوم")
_PARKING = ("مواقف", "المواقف")

# Every label the mapper knowingly reads. Anything else a page prints is tallied as an unknown
# label and reported, so a new field is LOUD instead of silently dropped.
_KNOWN_LABELS = frozenset({
    "رقم العقار", "السعر", "مساحة العقار", "سنة البناء", "نوع العقار", "حالة العقار",
    "رقم البلوك", "الفئة", "تاريخ النشر", "متر مربع", "عدد الوحدات", "عدد الوحدات المباعة",
    "عدد الوحدات المتبقية",
    # A COUNT of floors, not which floor. The listing tables carry `floor_number` (the storey a unit
    # is on) and no floors-count column, so this is preserved raw in additional_info and never
    # written to floor_number — they are different facts.
    "الطوابق",
    *_BATHROOMS, *_BEDROOMS, *_PARKING,
})

# NO AUCTIONS. «مزاد» appears nowhere in this platform's vocabulary — it is a developer selling its
# own units and its «حالة البيع» enum has no auction state — so the guard exists for the day that
# changes, and it reads the LISTING'S OWN FIELDS, never the document.
#
# That distinction is the whole point. Every nofodh page embeds the site-wide filter dialog, which
# renders the FULL district picker (including Istanbul's حي أتاشهير, حي مالتبه …) and the full
# country list. A whole-document scan for «مزاد» would therefore be a scan of the platform's entire
# taxonomy on every single page: one district or country name containing the substring and the
# scraper skips the whole catalogue as auctions, from one page's chrome. The listing's own type,
# status, code and address are where an auction could be declared, and that is what is searched.
_AUCTION_RE = re.compile(r"مزاد")

#: The two labels the «العنوان» block prints. Same allowlist discipline as _KNOWN_LABELS.
_ADDRESS_LABELS = frozenset({"المدينة", "الحي"})

_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def _allowed(block: dict[str, Any], labels=None) -> dict[str, Any]:
    """The allowlisted labels of one parsed block, every value PDPL-redacted. See source_capture."""
    keep = _KNOWN_LABELS if labels is None else labels
    return {k: redact_pii(v) for k, v in block.items() if k in keep}


# ── PARSING ──────────────────────────────────────────────────────────────────────────────────────
# The pages are server-rendered Blade with one rigid shape per field, so each of these is an
# anchored pair rather than a loose text scan.
_PAIR_RE = re.compile(
    r'<p class="fw600 mb-0"[^>]*>(.*?)</p>\s*<p class="text mb-0[^"]*">(.*?)</p>', re.S)
_OVERVIEW_RE = re.compile(r'<h6 class="mb-0">(.*?)</h6>\s*<p class="mb-0 text fz15[^"]*">(.*?)</p>', re.S)
_ADDRESS_RE = re.compile(
    r'<p class="mb-0 fw600 ff-heading dark-color">(.*?)</p>\s*</div>\s*'
    r'<div class="pd-list">\s*<p class="mb-0 text">(.*?)</p>', re.S)
# The unit's own code («WAP-BLK54-6»): the page's <h2> and the map iframe's title carry the same
# string. The iframe is used because the <h2> selector also matches the booking dialogs' headings.
_CODE_RE = re.compile(r'<iframe[^>]*\btitle="([^"]+)"')
#: Media the source stores under a listing's OWN upload folder, `/listings/<id>_<hash>/<file>`.
#: SCOPED TO THE LISTING ID ON PURPOSE. An unscoped pattern harvested the whole document, and on a
#: project page that meant SIX other listings' photos (ids 249005/337474/449638/472243/672729/939967
#: on /listings/844706, which embeds its unit cards) — i.e. one row claiming another row's pictures.
#: The extension allowlist is the second half of the same measurement: the same page served
#: `844706_…/ALMOSA_RISENCE_PAGE_copy.pdf` out of the identical folder, and a brochure is not a photo.
_PHOTO_EXT = r"(?:jpe?g|png|webp|gif|avif)"


def _photo_re(listing_id: str) -> re.Pattern:
    return re.compile(
        rf'https://www\.nofodh\.sa/listings/{re.escape(listing_id)}_[0-9a-zA-Z]+/'
        rf'[^"\'\s<>]+\.{_PHOTO_EXT}\b', re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")


def _clean(v) -> Optional[str]:
    if v is None:
        return None
    s = re.sub(r"\s+", " ", _TAG_RE.sub(" ", str(v))).strip()
    return s or None


def _snapshots(body: str) -> list[dict]:
    """Every Livewire `wire:snapshot` payload on the page, decoded."""
    import html as _html
    import json

    out: list[dict] = []
    for m in re.finditer(r'wire:snapshot="', body):
        start = m.end()
        end = body.find('"', start)
        if end < 0:
            continue
        try:
            out.append(json.loads(_html.unescape(body[start:end])))
        except ValueError:
            continue
    return out


def parse_listing_page(body: str, listing_id: str) -> dict[str, Any]:
    """One /listings/<id> page → the record the mapper reads. No judgement here, only extraction."""
    details = {k: v for k, v in ((_clean(a), _clean(b)) for a, b in _PAIR_RE.findall(body)) if k}
    overview = {k: v for k, v in ((_clean(a), _clean(b)) for a, b in _OVERVIEW_RE.findall(body)) if k}
    address = {k: v for k, v in ((_clean(a), _clean(b)) for a, b in _ADDRESS_RE.findall(body)) if k}
    booking: dict[str, Any] = {}
    for snap in _snapshots(body):
        if snap.get("memo", {}).get("name") == "homez.booking-component":
            booking = snap.get("data") or {}
            break
    codes = _CODE_RE.findall(body)
    return {
        "id": listing_id,
        "details": details,
        "overview": overview,
        "address": address,
        # The model's own price attributes. `max_price` > 0 and != min_price is the source's own
        # RANGE shape (a project); a leaf unit publishes max_price 0.
        "price_exact": booking.get("price"),
        "min_price": booking.get("min_price"),
        "max_price": booking.get("max_price"),
        "code": _clean(codes[0]) if codes else None,
        "photos": sorted(set(_photo_re(listing_id).findall(body))),
        # THIS LISTING's own published words only — never the document. See _AUCTION_RE.
        "has_auction_word": bool(_AUCTION_RE.search(" ".join(
            str(v) for block in (details, overview, address) for v in block.values()
        ) + " " + (codes[0] if codes else ""))),
    }


# ── PRICE ────────────────────────────────────────────────────────────────────────────────────────
def _exact(v) -> Optional[float]:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def read_price(rec: dict[str, Any]) -> tuple[Optional[int], Optional[float], Optional[str]]:
    """(stored_price, exact_source_float, refusal) for ONE unit — the platform's hardest trap.

    NOTHING IS EVER COMPUTED HERE. There is no ×12, no ×area, no magnitude repair: the only
    arithmetic is comparing two figures the source itself published, and disagreement REFUSES the
    row instead of picking a winner.

    TRAP 1 — «السعر» IS ROUTINELY 0, AND 0 IS NOT A PRICE. Measured over a 44-page spread: 14 pages
    printed «السعر 0» with `min_price` 0 in the component state. The site number_format()s whatever
    the column holds, so an unpriced unit renders a literal "0". Storing it would publish a free
    property. A SOLD unit goes further and omits the «السعر» row entirely (id 531729). Both states —
    the 0 and the missing row — are UNKNOWN and store NULL.
      Deliberately NOT db.AUTHORITATIVE_NULL: a 0 cannot be told apart from "nobody typed a price
      yet", so it must not be licensed to erase a figure an earlier crawl read. The sentinel is for a
      source that SAYS a listing has no price; this source says nothing.

    TRAP 2 — THE PRINTED PRICE IS ROUNDED, THE MODEL'S IS NOT, AND THEY ARE DIFFERENT NUMBERS.
    id 432014 prints «530,697» while its booking-component holds 530696.94; id 314771 prints
    «40,249» for 40248.74. So the page and the payload disagree by up to a riyal on every fractional
    row, and picking blind would have meant storing a number the source never displays.
      What is stored is the DISPLAYED figure, because that is the number the source shows on the
      listing and therefore the number a real-user comparison against the source checks. The exact
      float is kept verbatim in `additional_info.source_price_exact` and in price_evidence, so
      nothing is lost and the halalas are still auditable from the row alone.

    THE GUARD. The two published figures must agree to within the rounding that produced them
    (< 1 riyal). They are not derived from each other, so a wider gap means the component state is
    not describing the printed price — a different quantity, a stale morph, a shape change — and the
    row is REFUSED with a counted reason rather than stored on a coin-flip. `price_mismatch` firing
    at all is a signal to re-measure the page, not a number to reconcile in code.

    A refusal is `"<stable key>|<detail>"`. The key is value-FREE on purpose: embedding the figures
    in it would give the run's skip tally one bucket per distinct price, so a hundred mismatches
    would print as a hundred one-count lines and be truncated out of `scrape_runs.notes` — a broken
    price path would become invisible in exactly the run that found it. The detail still travels, and
    crawl() prints a few worked examples WITH their listing ids, which is what makes an alarm
    diagnosable from the record alone.
    """
    shown_raw = rec["details"].get("السعر")
    shown = normalize.to_int(shown_raw) if shown_raw else None
    exact = _exact(rec.get("price_exact"))
    if not shown:
        # No price printed, or the placeholder 0. If the model nevertheless holds a positive figure
        # the page is not showing it, and we do not publish what the source withholds.
        if exact is not None:
            return None, exact, f"price_hidden_by_source|model holds {exact:g}, page prints none"
        return None, None, None
    if exact is None:
        return None, None, f"price_absent_from_model|page prints {shown}"
    if abs(exact - shown) >= 1:
        return None, exact, f"price_mismatch|page {shown} vs model {exact:g}"
    return shown, exact, None


def _int_label(source: dict[str, Any], labels: tuple[str, ...]) -> Optional[int]:
    """A source-published count from the first of `labels` the page prints. Arabic-Indic digits
    included. 0 is NOT kept: these fields are absent when unset and the site has no 0-count UI, so
    a 0 here is the column default and not an answer (the opposite of abaad's «0 غرف نوم» chip)."""
    for key in labels:
        for block in ("details", "overview"):
            raw = source.get(block, {}).get(key)
            if raw:
                n = normalize.to_int(str(raw).translate(_ARABIC_DIGITS))
                if n and n > 0:
                    return n
    return None


def _skip_container(rec: dict[str, Any]) -> Optional[str]:
    """Is this page a PROJECT container rather than a listing? Two INDEPENDENT source markers.

    Both are checked, and neither is allowed to cover for the other, because they say different
    things and a future page could carry one without the other:

      · «نوع العقار: مشروع» — the source's own type word for a container. Its page also prints
        «عدد الوحدات» (14 / 1016 / 404 / 607 / 157 / 23 / 8 across the seven) and a «مباع» percentage
        bar, i.e. exactly the %-sold shape the READY-ONLY rule names.
      · a PRICE RANGE — `max_price` > 0 alongside a different `min_price`, rendered as an
        abbreviated band («550.0K - 830.0K»). A leaf unit publishes `max_price` 0. A range is not a
        price, and the abbreviated text is not a number; neither is ever stored.

    id 914863 is why the range check cannot stand alone: it is a project whose eight units are all
    one price, so min == max and only the type word gives it away.
    """
    if (rec["details"].get("نوع العقار") or rec["overview"].get("نوع العقار")) == _CONTAINER_TYPE:
        return "project_container"
    lo, hi = _exact(rec.get("min_price")), _exact(rec.get("max_price"))
    if hi is not None and lo is not None and hi != lo:
        return "price_range_not_a_listing"
    if rec["details"].get("عدد الوحدات"):
        return "project_container_unit_counts"
    return None


def map_listing(rec: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) for ONE parsed page. row is None exactly when a reason is set."""
    lid = _clean(rec.get("id")) or _clean(rec["details"].get("رقم العقار"))
    if not lid:
        return None, "residential", "no_id"

    if rec.get("has_auction_word"):
        return None, "residential", "auction"

    container = _skip_container(rec)
    if container:
        return None, "residential", container

    status = rec["details"].get("حالة العقار") or rec["overview"].get("حالة العقار")
    if not status:
        return None, "residential", "no_sale_status"
    deal = _DEAL.get(status)
    if not deal:
        why = _OFF_MARKET.get(status) or _NOT_YET.get(status)
        return None, "residential", why or f"status_unknown_{status}"

    type_raw = rec["details"].get("نوع العقار") or rec["overview"].get("نوع العقار")
    property_type = normalize.map_type_exact(type_raw, _TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", f"type_unmapped_{type_raw or 'blank'}"
    category = normalize.category_for_type(property_type).lower()

    city_ar = rec["address"].get("المدينة")
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        # Includes the platform's Istanbul inventory, whose districts sit in the same picker. A
        # non-Saudi or off-catalog city is never filed under a neighbour.
        return None, category, "city_not_in_catalog"
    district_raw = rec["address"].get("الحي")
    district_ar = find_district_in_text(district_raw, city_id)

    price, exact, refused = read_price(rec)
    if refused:
        return None, category, refused

    photos = [p for p in (rec.get("photos") or []) if p] or None
    area_raw = rec["details"].get("مساحة العقار") or rec["overview"].get("متر مربع")

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{lid}",
        "listing_url": f"{BASE}/listings/{lid}",
        "source": SOURCE,
        "active": True,
        # The unit's own code, e.g. «WAP-BLK54-6» (project-block-plot). The site publishes no other
        # title and no description at all, so `description` stays NULL fleet-wide for this platform.
        "title": redact_pii(rec.get("code")),
        "property_type": property_type,
        # `deal` is provably «للبيع»→Buy or «للإيجار»→Rent; every other state of the source's own
        # enum was skipped above with a counted reason. Written as a two-literal expression so it
        # can never carry a third value even in principle.
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,                 # catalog-matched, so already a clean label
        "neighborhood": redact_pii(district_raw),    # raw source text → redacted
        "area_m2": normalize.to_int(area_raw) if area_raw else None,
        "bathrooms": _int_label(rec, _BATHROOMS),
        "bedrooms": _int_label(rec, _BEDROOMS),
        "parking": _int_label(rec, _PARKING),
        "date_added": redact_pii(rec["overview"].get("تاريخ النشر")),
        "photo_urls": photos,
    }
    if deal == "Rent":
        # RENT PERIOD = SOURCE. This platform publishes NO period, anywhere: there is no period
        # field, the price prints under a bare «السعر», and the site has no description in which a
        # listing could state one. So the figure is stored EXACTLY as published and rent_period
        # stays NULL — never annual, never ×12, and nofodh is deliberately absent from
        # SINGLE_PERIOD_PLATFORMS because the platform makes no site-wide statement either.
        row["price_annual"] = price
    else:
        row["price_total"] = price
    # price_per_meter stays NULL: this source prints no «سعر المتر» row on any page (0 occurrences
    # across a listing page, a project page and every unit sampled), and a rate is never derived
    # from a total and an area.
    row["price_evidence"] = normalize.price_evidence(
        field="«السعر» detail row (corroborated against homez.booking-component.price)",
        raw=rec["details"].get("السعر"),
        stored=price,
        kind="total" if deal == "Buy" else "annual",
        unit="total", origin="spec_table", authoritative_absent=False)
    row["images_evidence"] = {"observed": True, "container_present": True,
                              "key_present": bool(photos), "count": len(photos or [])}

    info = {
        "source_id": lid,
        "type_raw": type_raw,
        "sale_status_raw": status,
        "source_category_raw": rec["details"].get("الفئة") or rec["overview"].get("الفئة"),
        "block_number": rec["details"].get("رقم البلوك"),
        "unit_code": rec.get("code"),
        "source_area_raw": area_raw,            # exact m² before area_m2's INTEGER round
        "source_price_shown": rec["details"].get("السعر"),
        "source_price_exact": exact,            # the model's un-rounded figure, halalas included
        # «سنة البناء» is NOT a build year on this platform: it prints a DATE identical to
        # «تاريخ النشر» on every page measured. Kept raw and never mapped to property_age.
        "source_build_year_raw": rec["details"].get("سنة البناء"),
        "floors_count": rec["details"].get("الطوابق"),   # a count; there is no column for it
    }
    # Every one of those is source text, so redaction is applied to the WHOLE dict in one pass
    # rather than per key: the first version redacted `unit_code` only and an advertiser's WhatsApp
    # link typed into «رقم البلوك» still landed in `block_number` (caught by this file's own PDPL
    # test). A barrier you have to remember at each key is a barrier that gets forgotten.
    row["additional_info"] = strip_pii_fields(
        {k: (redact_pii(v) if isinstance(v, str) else v)
         for k, v in info.items() if v is not None})
    # PDPL. Both stored payloads are built from EXPLICIT ALLOWLISTS, never from whatever the page
    # printed: every nofodh page carries the developer's own «920029555» and «info@nofodh.sa» in its
    # footer and JSON-LD Organization block, and the interested/booking forms embed a full
    # country-code picker. None of that is reachable from here.
    #   · The LABEL allowlist (_KNOWN_LABELS) is the outer barrier. It is an allowlist rather than a
    #     blocklist so a label the platform adds tomorrow — «اسم المسوق», «رقم الجوال» — cannot arrive
    #     by default; it is tallied as an unknown label and reported instead.
    #   · redact_pii() over every stored VALUE is the inner barrier, for a contact detail typed into
    #     a field that is otherwise legitimate. Done HERE rather than leaning on db.redact_capture():
    #     a barrier after the row has left the mapper is not this mapper's guarantee.
    row["source_capture"] = strip_pii_fields({
        "schema": "nofodh.listing-page.v1",
        "listing_id": lid,
        "details": _allowed(rec["details"]),
        "overview": _allowed(rec["overview"]),
        "address": _allowed(rec["address"], _ADDRESS_LABELS),
        "price_exact": rec.get("price_exact"),
        "min_price": rec.get("min_price"),
        "max_price": rec.get("max_price"),
        "unit_code": redact_pii(rec.get("code")),
        "photo_count": len(photos or []),
    })
    return row, category, ""


# ── FETCH ────────────────────────────────────────────────────────────────────────────────────────
def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")     # impersonate OWNS the User-Agent
    s.headers.update({"Accept": "text/html,application/xhtml+xml", "Accept-Language": "ar,en;q=0.7"})
    return s


_SITEMAP_LOC_RE = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>")


def fetch_roster(s: cc.Session) -> list[str]:
    """Every listing id the platform itself indexes, from its own robots-advertised sitemap.

    robots.txt is `Disallow:` (nothing) and names `Sitemap: /sitemap.xml`, and that sitemap is a
    single flat urlset (no sitemapindex) — so it is the site's OWN complete roster rather than a
    pagination we reconstruct. It carries both the seven project containers and their unit pages,
    and the containers are dropped later by their own marker (see _skip_container).
    """
    r = _get(s, SITEMAP)
    if r is None or r.status_code != 200:
        raise RuntimeError(f"{SITEMAP} returned {getattr(r, 'status_code', 'no response')}")
    ids: list[str] = []
    seen: set[str] = set()
    for loc in _SITEMAP_LOC_RE.findall(r.text):
        m = re.search(r"/listings/(\d+)/?$", loc)
        if m and m.group(1) not in seen:
            seen.add(m.group(1))
            ids.append(m.group(1))
    if not ids:
        raise RuntimeError(f"{SITEMAP} carried no /listings/<id> entries — the roster shape changed")
    return ids


# ── THE WAF, AND WHY 202 IS NOT AN ANSWER ABOUT A LISTING ────────────────────────────────────────
# www.nofodh.sa sits behind CloudFront with an AWS WAF challenge, and the challenge answers
# **HTTP 202** — a success code — with a 2,047-byte `window.gokuProps` / `awsWafCookieDomainList`
# page instead of the listing. MEASURED 2026-09-24: a first walk at 8 concurrent workers served 351
# real pages and then flipped to 202 at request ~351 and stayed there for every one of the remaining
# 2,250 — including ids that had answered 200 minutes earlier. So the 202 is about OUR REQUEST RATE,
# never about the listing.
#
# IT IS NOT THE HANDSHAKE. Ten TLS profiles were probed from the same IP once the state was set —
# chrome, chrome116/120/124/131, safari17_0, safari15_5, firefox133, edge101, edge99 — and all ten
# drew the identical 202. Unlike ialqarawi (where a profile swap was the whole fix), there is no
# fingerprint here that is served, so profile negotiation is deliberately not attempted.
#
# The consequence that matters is deletion safety: 2,250 challenges look exactly like 2,250 listings
# that vanished. A crawl that counted them as absence would hand prune_unseen an empty catalogue.
# So a challenge is retried with backoff, counted apart from every real skip, and — if any survive —
# it takes the run's completeness away and, past a small tolerance, FAILS the run. Nothing is pruned
# on a challenged crawl, and a thin crawl is never recorded as a healthy one.
WAF_CHALLENGE_STATUS = 202
_WAF_MARKERS = ("awsWafCookieDomainList", "gokuProps")
#: Statuses this scraper retries on top of the shared transient set. 202 is the WAF challenge;
#: 403/429 are the ordinary throttle shapes. All of them are about us.
_RETRY_STATUSES = TRANSIENT_STATUSES | {WAF_CHALLENGE_STATUS, 403, 429}


def is_waf_challenge(body: str) -> bool:
    """Is this response body the AWS WAF challenge shim rather than a page?

    Keyed on the BODY, not on the status, on purpose. 202 is how the challenge arrives today, but the
    status is the WAF's choice and it has already chosen a surprising one once; the `gokuProps`
    payload is what the challenge actually IS. Reading the body also means the answer fails in the
    safe direction — a challenge served under any status is "we were blocked", never "this listing is
    gone" — and it leaves no branch that can never fire.
    """
    return any(m in (body or "") for m in _WAF_MARKERS)


def _get(s: cc.Session, url: str, tries: int = 4, pace: float = 0.0):
    """GET with backoff on everything that is about US. Returns the last response, or None."""
    import random
    import time

    r = None
    for attempt in range(tries):
        if pace:
            time.sleep(pace + random.uniform(0.0, pace / 2))
        try:
            r = s.get(url, timeout=90)
        except Exception:                      # noqa: BLE001 — a transport blip is a retry
            r = None
        else:
            if r.status_code not in _RETRY_STATUSES:
                return r
        # A WAF challenge needs real time, not a tight retry: worse-as-you-retry-harder is exactly
        # how this block behaves, so the backoff grows and the last attempt waits ~24s.
        if attempt < tries - 1:
            time.sleep(3 * (2 ** attempt) + random.uniform(0.0, 1.0))
    return r


def fetch_listing(s: cc.Session, listing_id: str,
                  pace: float = 0.0) -> tuple[Optional[dict], Optional[int]]:
    """(parsed record, status). A 404 is the platform's hard delete and yields (None, 404).

    A surviving WAF challenge yields (None, 202) and the caller MUST treat that as "we were blocked",
    not as "the listing is gone" — see WAF_CHALLENGE_STATUS.
    """
    r = _get(s, f"{BASE}/listings/{listing_id}", pace=pace)
    if r is None:
        return None, None
    # The challenge is checked BEFORE the status, so it can never be read as a 404-style removal.
    if is_waf_challenge(r.text):
        return None, WAF_CHALLENGE_STATUS
    if r.status_code != 200:
        return None, r.status_code
    return parse_listing_page(r.text, listing_id), 200


# ── LIVENESS (measured 2026-09-24 — a 200 is NOT proof of life here) ─────────────────────────────
_STATUS_RE = re.compile(
    r'<p class="fw600 mb-0"[^>]*>\s*حالة العقار\s*</p>\s*<p class="text mb-0[^"]*">(.*?)</p>', re.S)


def _signal(status, body, _moved) -> Optional[str]:
    """'live' | 'gone' | None — this platform's AFFIRMATIVE signals only; the shared law does the rest.

    404 IS A HARD DELETE, measured: seven ids the platform does not have (999999999, 0, 1, abc,
    111111 and the two ids adjacent to a real one, 149627/149629) all answered a real HTTP 404 with
    the same 23,648-byte error page. There is no soft-404 shell to mistake for a listing.

    A 200 IS NOT LIFE BY ITSELF. A sold unit KEEPS its page: id 531729 answers 200 with full content,
    «حالة العقار: مباع», and its «السعر» row simply gone. An "is it 200?" oracle would therefore
    never retire anything this developer sells. What decides is the state the page prints about
    ITSELF, from the platform's own «حالة البيع» enum:

        404                                   → gone  (hard delete, 7/7 fabricated + adjacent ids)
        200 + «للبيع» / «للإيجار»              → live  (the offer is open; also self-heals a row that
                                                       was absent from OUR crawl, not from the site)
        200 + مباع/مؤجر/محجوز/مدفوع/تحت الصيانة → gone  (the source's own statement that it left the
                  /TRANSFERRED/MORTGAGED/محجوب         market)
        200 + «قريباً»                         → UNKNOWN. Not-yet-released is not a removal, and we
                                                never store such a row anyway — so neither verdict
                                                is earned and none is claimed.
        200 + no «حالة العقار» on the page      → UNKNOWN (no opinion)
        anything else                          → UNKNOWN (the law refuses it)
    """
    # FIRST, before the 404 branch: the WAF challenge is about our access, never about the listing.
    # It arrives as a 202 today, but if it ever arrived under a 404 the 404 branch below would read
    # a block as a hard delete — so the challenge is refused ahead of everything else.
    if is_waf_challenge(body):
        return None
    if status == 404:
        return "gone"
    if status != 200:
        return None
    m = _STATUS_RE.search(body or "")
    if not m:
        return None
    state = _clean(m.group(1))
    if state in _DEAL:
        return "live"
    if state in _OFF_MARKET:
        return "gone"
    return None                                # قريباً, or a state the enum gained since


#: Seconds between oracle reads. LivenessProbe.fetch() builds a session per request, so pacing the
#: FACTORY paces the probe exactly once per read — the only seam available without touching the shared
#: law. It matters because a liveness sweep over many rows is the same request pattern that tripped
#: the WAF during the first crawl. A challenge would still be handled correctly (UNKNOWN, and the
#: canary withholds every removal — it fails CLOSED), but a sweep that challenges itself confirms no
#: removals at all, so the safe outcome would also be a useless one.
ORACLE_PACE = 0.6


def _oracle_session() -> cc.Session:
    import time
    time.sleep(ORACLE_PACE)
    return session()


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None):
        lid = ad_number[len(PREFIX):] if ad_number.startswith(PREFIX) else ""
        if not lid:
            return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
        return LivenessProbe(platform=SLUG, signal=_signal, session=_oracle_session,
                             url_for=lambda _ad: f"{BASE}/listings/{lid}",
                             canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = probe(control["ad_number"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


# ── RUN ──────────────────────────────────────────────────────────────────────────────────────────
def _tally(counts: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(counts.items(), key=lambda x: -x[1]))


def crawl(s: cc.Session, ids: list[str], workers: int = 3,
          pace: float = 0.6) -> tuple[list[dict], list[dict], dict, dict, int]:
    """Walk the roster → (residential, commercial, skip counts, unknown labels, blocked count).

    The defaults are the measured ceiling, not a guess: 8 workers with no pacing tripped the WAF
    after ~351 requests in ~45s. 3 workers spaced ~0.6s apart is roughly 1.7 requests/second, which
    walks the 2.6k roster in about half an hour — slow is the only correct speed here.
    """
    from concurrent.futures import ThreadPoolExecutor

    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unknown_labels: dict[str, int] = {}
    examples: dict[str, list[str]] = {}
    blocked = 0

    def one(listing_id: str):
        # One session PER WORKER would be ideal, but curl_cffi sessions are not thread-safe, so each
        # page gets its own. The cost is a TLS handshake per page; correctness beats reuse here.
        return listing_id, fetch_listing(session(), listing_id, pace=pace)

    with ThreadPoolExecutor(workers) as ex:
        for listing_id, (rec, status) in ex.map(one, ids):
            if rec is None:
                # A challenge and a no-answer are about US. They are counted, never mistaken for a
                # listing that is gone, and they are what takes the crawl's completeness away.
                if status == WAF_CHALLENGE_STATUS or status is None:
                    blocked += 1
                why = f"http_{status}" if status else "no_response"
                skipped[why] = skipped.get(why, 0) + 1
                continue
            for label in set(rec["details"]) | set(rec["overview"]):
                if label not in _KNOWN_LABELS:
                    unknown_labels[label] = unknown_labels.get(label, 0) + 1
            row, cat, why = map_listing(rec)
            if not row:
                key, _, detail = why.partition("|")
                skipped[key] = skipped.get(key, 0) + 1
                if detail and len(examples.setdefault(key, [])) < 5:
                    examples[key].append(f"{PREFIX}{listing_id}: {detail}")
                continue
            (com if cat == "commercial" else res).append(row)
    for key, shown in sorted(examples.items()):
        print(f"  {key} e.g. " + "; ".join(shown))
    return res, com, skipped, unknown_labels, blocked


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--pace", type=float, default=0.6,
                    help="minimum seconds before each request (WAF ceiling — see crawl())")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    # begin_run BEFORE the fetch: a source that goes dark (or challenges us away) must still leave a
    # scrape_runs row, or a silent platform looks identical to a healthy one that had nothing to do.
    run_id = None if dry else db.begin_run(SLUG)
    skipped: dict[str, int] = {}
    blocked = 0
    try:
        ids = fetch_roster(s)
        complete = not args.limit
        if args.limit:
            ids = ids[:args.limit]
        print(f"{SOURCE}: {len(ids)} listing id(s) in the sitemap", flush=True)
        res, com, skipped, unknown, blocked = crawl(
            s, ids, workers=args.workers, pace=args.pace)
        if args.type != "all":
            res = res if args.type == "residential" else []
            com = com if args.type == "commercial" else []
        notes = _tally(skipped)
        if skipped:
            print("  skipped (not guessed): " + notes)
        if unknown:
            print("  ⚠ labels the mapper does not read: " + _tally(unknown))
        if not res and not com:
            raise RuntimeError(f"{BASE} yielded no mappable listings from {len(ids)} ids")
        # A CHALLENGED CRAWL IS NOT A CATALOGUE. Any page we never got to read is a page whose
        # absence proves nothing, so completeness goes first and nothing may be pruned; past a small
        # tolerance the run FAILS rather than being recorded healthy on a fraction of the inventory.
        if blocked:
            complete = False
            share = blocked / max(1, len(ids))
            print(f"  ⚠ WAF challenged {blocked}/{len(ids)} pages ({share:.1%}) — "
                  f"no prune this run")
            if share >= 0.05:
                raise RuntimeError(
                    f"the WAF challenged {blocked}/{len(ids)} pages ({share:.1%}); "
                    f"{len(res) + len(com)} mapped rows are a fraction of the catalogue, not the "
                    f"catalogue — lower --workers/raise --pace rather than storing this as a run")
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:20]:
                print(f"   {r0['ad_number']:>10} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):16} {str(r0['city_ar']):10} "
                      f"d={str(r0['district_ar'])[:14]:14} a={str(r0['area_m2']):>7} "
                      f"pt={r0.get('price_total')} pa={r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} ba={r0.get('bathrooms')} "
                      f"pk={r0.get('parking')} ph={len(r0.get('photo_urls') or [])} "
                      f"t={r0.get('title')}")
            return 0
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
        elif args.type == "all" and not blocked:
            print("  prune skipped: the roster was limited, so absence proves nothing")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(ids),
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
            # Carry the skip tally and the block count into the failure note: "why did it fail" and
            # "what had it already seen" are different questions, and a run row that answers only the
            # first is what made an earlier incident unfalsifiable from the record.
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=(f"{e}"[:220] + f" | blocked={blocked}"
                              + " | skips: " + (_tally(skipped) or "none"))[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
