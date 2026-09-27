"""آل سعيدان (Al Saedan) — alsaedan.com. 332 available units, onboarding 2026-09-24.

A DEVELOPER with a real unit portal, not a classifieds board: 29 projects, 2,374 unit cards, of
which the source itself marks 332 «متاحة». Laravel + Livewire, server-rendered HTML, no JSON API
(searched: no `__NEXT_DATA__`, one `/api` reference and it is the Google Maps key). Plain
`impersonate="chrome"`, no proxy, no cookie, no auth.

SOURCE SHAPE (every number below was measured live 2026-09-24, none assumed)
---------------------------------------------------------------------------
DOMAIN. al-saedan.com.sa and alsaedan.com both answer 200; every page's own
`<link rel="canonical">` and `og:url` say alsaedan.com, and the sitemap on the .com.sa host emits
alsaedan.com locs. So alsaedan.com is the platform's own name for itself and is what we store.

THE CATALOGUE IS A LIVEWIRE COMPONENT WITH A QUERY STRING — no message POSTs needed:

    GET /sales?view=units&purpose={sale|rent}&available=1&page={n}   → 12 `asp-ucard`s per page
    GET /sales?view=projects&purpose={sale|rent}&page={n}            → the `asp-card` projects

  `available=1` is the site's own «المتاح فقط» switch. VERIFIED that the filter set is exactly the
  live inventory: available sale (283) ∪ available rent (117) = 332 ids, and sitemap.xml's 332
  `/sales/unit/{id}` locs are THE SAME 332 ids — 0 in the union that the sitemap lacks, 0 in the
  sitemap that the union lacks. Two independent enumerations of the same set.

  COMPLETENESS is self-declaring per purpose: `<div class="asp-count">283 وحدة متاحة</div>`. The
  crawl only prunes when that printed number equals the distinct cards collected, for BOTH purposes.

  A UNIT CAN BE OFFERED BOTH WAYS, and that is per-unit, not per-project: deem-11 serves 69 units
  under purpose=sale and 68 under purpose=rent — the counts differ, so the flags are the unit's own.
  68 of the 332 appear in both lists and become TWO rows, «SDN{id}» (Buy) and «SDN{id}-R» (Rent);
  dropping either would hide an offer the source publishes. Each row names the other in
  additional_info.also_offered_as.

  ROWS ARE BUILT FROM THE LIST CARD, not the detail page, because the card is not a summary — it
  carries every field the detail page does. VERIFIED on all 332: card area/rooms/bathrooms equal the
  detail page's «مساحة البناء»/«غرف النوم»/«دورات المياه» with ZERO disagreements, and the card's
  background image is byte-identical to the detail hero. The detail page adds only a Google-Maps
  lat/lng, and the listing tables carry no coordinate columns. 35 requests instead of 367.
  Because nothing is read from the listing's own URL, `mark_direct_alive()` is deliberately NOT
  called — that stamp requires a direct fetch.

  DETAIL URL. `{BASE}/sales/unit/{id}`, the card's own href and the page's own canonical. All 332
  fetched: 332 × HTTP 200, each carrying THAT unit's own `aup-h1`, unit code and area.

  PHOTOS. One image per unit, `{BASE}/uploads/projects/...`; two fetched → 200 image/jpeg, no
  Cross-Origin-Resource-Policy header (only x-frame-options, which does not block an <img>).
  IT IS THE PROJECT'S COVER, NOT THE UNIT'S: all 90 deem-10 units share /uploads/projects/deem-10/
  17-1.jpg, and the 22 sama-najd land plots have none at all (310 of 332 carry one). It is kept
  because it is the picture a visitor to alsaedan.com sees on that unit's own card and page — the
  same owner ruling as 1000.com.sa (2026-09-24) — and additional_info records that it is the
  project cover, so nobody later mistakes it for a photograph of that unit.

THE TRAPS, ALL MEASURED
-----------------------
1. EVERY PRICE IS «السعر عند الطلب» — AND THE PLATFORM'S OWN FILTER PROVES IT IS HIDING NUMBERS.
   All 332 available cards and all 332 detail pages render `class="asp-uprice none"` /
   `class="aup-price none"` with the words «السعر عند الطلب». Not one unit publishes a figure.
   Yet the price FILTER is backed by real values: `&minPrice=1` returns 1,810 of 1,812,
   `&minPrice=500000` → 1,809, `&minPrice=1000000` → 1,371, `&minPrice=5000000` → 127. The
   platform holds prices and chooses not to publish them.
   THOSE NUMBERS ARE NOT STORED AND MUST NEVER BE. They are not published, and recovering one by
   bisecting the filter would be Ezhalah asserting a price no visitor to the source can see —
   the inverse of the mirror rule. What the source publishes about price is «on request», so
   price_total/price_annual are `db.AUTHORITATIVE_NULL` (the source AFFIRMATIVELY states there is
   no price, so a stale figure must clear) with `authoritative_absent=True` in price_evidence.
   The price TEXT is still read from the page on every run rather than hardcoded: if this platform
   ever starts printing a figure, the row must carry it that same day. Hiding a
   source-published price is the regression that rule exists to prevent.
   NO per-metre price exists anywhere on this source (no «سعر المتر», no «إجمالي السعر»), so
   price_per_meter is never written — not even for the 22 land plots.

2. THE PAGE SHOWS OTHER UNITS' NUMBERS. Every detail page carries a «وحدات مشابهة في المشروع نفسه»
   block (330 of 332) holding sibling units' names, areas and prices, and the list card sits in a
   grid of eleven others. A parser that greps the page for «م²» reads a neighbour: unit 2558's own
   area is 35.00 م² while its sibling block prints 100.00 م², and unit 2886's page prints unit
   2969's name and 255.34 م². So every field is read INSIDE its own `asp-ucard`/`asp-uspecs`
   container, never from the page, and the test pins exactly that (test_alsaedan_...::
   test_a_siblings_area_is_never_read_as_this_units_area).

3. OFF-PLAN IS A PROJECT-LEVEL MARKER THE SOURCE WRITES ITSELF. الليوان السكني (al-liwan) carries
   `<span class="asp-status st-construction">قيد الإنشاء</span>` on its project card, and 74 of the
   283 available sale units belong to it. Those 74 are SKIPPED with a counted reason, on that class
   plus the source's own word — never on a heuristic, and never on the word «مشروع» (a built
   project is a real listing: owner ruling 2026-09-13). The other 28 projects carry st-partial
   (مباع/مؤجّر جزئي) or st-full (مباع/مؤجّر بالكامل); st-full projects have no available units, so
   none of their units reach us anyway. A unit whose project we could not resolve a status for
   skips too (`project_status_unknown`) — that fails CLOSED rather than assuming "built".
   Two further off-plan shapes named in the fleet rule do NOT exist here, checked on all 332 pages:
   no «البيع على الخارطة», no «تحت الإنشاء», and no price RANGE on any unit (the ranges the site
   prints, «127.54 – 342.73 م²», are AREA spans on project cards, which are not listings).

4. STATUS IS THE SOURCE'S OWN PILL, WITH ITS OWN CSS CLASS. Over the whole catalogue (2,374 cards):
   `asp-pill ok` «متاحة» 400, `off` «مباعة» 1,530, `off` «مؤجرة» 443, `warn` «محجوزة» 1. Only `ok`
   is ingested; anything else skips with a counted reason. With `available=1` the source already
   serves only `ok`, so the guard measures 0 — it exists so that a crawl without the filter, or a
   fifth pill the platform invents, cannot turn a sold unit into live inventory.

5. RENT PERIOD DOES NOT EXIST ON THIS SOURCE. No period word, no «شهري»/«سنوي», no «/ سنوياً»
   suffix, nothing — checked across all 332 pages and all 2,374 cards. So `rent_period` is never
   written for any row (absent, so no stored value can be overwritten either), and alsaedan is
   deliberately absent from SINGLE_PERIOD_PLATFORMS: the platform makes no site-wide statement, and
   inventing «سنوي» is exactly the souq24 defect. There is no price to convert in the first place.

6. PDPL. The unit block itself contains the company's sales channels — `wa.me/966920004365` on all
   332 and the number 920004365 on all 332 — and the footer adds tel:, mailto: and @alsaedan
   addresses. NOTHING free-form is stored: the row and both JSONB payloads are built from an
   explicit ALLOWLIST of parsed fields (ids, codes, areas, counts, labels), the raw HTML is never
   kept, every text field goes through redact_pii(), and strip_pii_fields() runs over both payloads
   as a second barrier. No ADVERTISER exists to leak — this is a developer selling its own units,
   and no advertiser/agent/broker/owner/employee field exists on the card, the unit page or the
   project card. That is also the limit of the guarantee, stated plainly: redact_pii() does not
   scrub personal NAMES (a name-shaped scrubber would eat regulatory text), so the protection here
   rests on the source carrying no identity field at all, plus the allowlist.
   THE PDPL TEST FOUND TWO REAL LEAKS while it was being written, both fixed before this shipped:
   `neighborhood` stored the card's location line verbatim (a number appended to the district went
   straight into a column), and `price_evidence.raw` archived the price text verbatim. Both are now
   redacted; the district LOOKUP still runs on the raw string, because redaction is about what we
   store.

REMOVAL ORACLE (measured 2026-09-24 — a 200 is NOT proof of life, and neither is a 302's 200)
--------------------------------------------------------------------------------------------
A unit that stops being available STOPS HAVING A PAGE: `/sales/unit/{id}` answers 302 to its
PROJECT page, which then answers 200. Following redirects, an "is it 200?" oracle would call every
sold unit alive forever — so the signal is the PATH CHANGE, which `LivenessProbe` already reports.

    302 → another path (its project)     → gone   (14/14 unavailable ids: 69→/sales/deem-01,
                                                   158→/sales/deem-06, 3270→/sales/deem-11,
                                                   3454/3471/3480/3481/3498/3499/3589/3592/3593/
                                                   3594/3595/3596 → /sales/sama-najd)
    404                                  → gone   (3/3 ids that never existed: 0, 999999, 1113-ish)
    200 on the unit's OWN path, with its
      own `aup-h1` unit block            → live   (6/6 available controls answered 200 with no
                                                   redirect; self-heals a row absent from OUR crawl)
    anything else                        → UNKNOWN

Zero counter-examples in either direction. Removals are additionally gated by an in-run positive
control that fails CLOSED, and `prune_unseen` runs only when both purposes enumerated COMPLETE.

COVERAGE (full live walk, `--dry-run`, 2026-09-24)
-------------------------------------------------
29 project cards; off-plan: ['al-liwan']. 332 available unit cards over 24 + 10 pages
(asp-count 283 + 117, complete=True for both) → 326 rows from 258 units, 74 skipped and counted:
project_under_construction_قيد_الإنشاء 74 (all al-liwan). 0 auctions, 0 unmapped types, 0
unresolved cities, 0 unavailable pills (the `available=1` list serves only `ok`).
  313 residential + 13 commercial (the 12 محل + 1 مكتب, all rent-side).
  Deal split 209 Buy / 117 Rent — 68 units contribute one row on each side (also_offered_as on 136).
  Types: Apartment 275, Residential Land 22, Villa 12 (all «تاون هاوس»), Shop 12, Floor 4, Office 1.
  Cities: الخبر 227, الرياض 99. Projects: ديم 11 137, ديم 10 90, نخبة النبلاء – الرحاب 27,
  سما نجد 22, ديم 12 18, أورو سكوير 9, ديم 13 — عمارة B 9, ديم 2 6, ديم 13 — عمارة A 3,
  آصال بلازا 2, الوادي بلازا 2, ديم 14 1.
  title 326 · project_name 326 · area_m2 326 · bedrooms 263 · bathrooms 263 · photo_urls 304
  district_ar 266 · neighborhood 266 (the raw text whenever printed; 60 cards print no district)
  price_total AUTHORITATIVE_NULL 209 · price_annual AUTHORITATIVE_NULL 117 · numeric prices 0
  rent_period: the key is written on 0 rows · price_per_meter 0 · license_number 0 (none exists)
  property_age 0 · floor_number 0 (available cards print none; «الدور N» exists on 75 SOLD cards
  and is parsed by content, so a unit that returns to the market brings its floor with it)
Removal oracle re-exercised through the shipping `_make_verify_gone` at the same time:
SDN69/SDN158/SDN3454/SDN3270-R → gone (302→project, HTTP 200 after the redirect),
SDN999999 → gone (404), SDN3120/SDN3229-R → live, a malformed ad_number → unknown.

OPEN QUESTIONS FOR ONBOARDING (none of these are guessed in code)
----------------------------------------------------------------
  · NO REGA AD LICENCE NUMBER ANYWHERE. «ترخيص» and «رخصة» appear on NONE of the 332 unit pages
    (the only «فال» hits are the word «فالزائر»/«فالجدول» inside the page's own JS comments), so
    license_number and license_expiry are always NULL. A licensed advertiser normally prints the
    FAL/ad licence on each ad; ask آل سعيدان for it (it is also the field abaad's removal oracle
    is built on). Compliance question, not a scraper one.
  · THE PLATFORM HOLDS PRICES IT DOES NOT PUBLISH (trap 1). Worth asking for a feed, or for
    permission to show them; until then every row is price-less and will rank poorly in any
    price-scoped search. This is a commercial conversation, not something code can fix.
  · THE ROSTER CALLS THIS PLATFORM «العيسى السعيدان»; the site calls itself «شركة آل سعيدان
    للعقارات» on every page. `source` is stored as the site's own name, «آل سعيدان», so a user
    comparing our card with the source sees the same brand. Confirm which name the app should show.
  · 1,283 of the 1,812 sale units are أرض سكنية plots and 1,261 of them are «مباعة» — sama-najd is
    a sold-out subdivision. Only 22 plots are live. Nothing to do; noted so the tiny land count is
    not read as a parse failure.
  · «محجوزة» (reserved, 1 unit fleet-wide) is treated as NOT available, matching the source's own
    `warn` pill and its exclusion from «المتاح فقط». Confirm that a reserved unit should stay out.
"""
from __future__ import annotations

import argparse
import html as html_mod
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

BASE = "https://alsaedan.com"
SOURCE = "آل سعيدان"
PREFIX = "SDN"
SLUG = "alsaedan"
PAGE_SIZE = 12                      # measured: every units page serves exactly 12 cards
MAX_PAGES = 400                     # 151 sale pages unfiltered today; a stop, not an expectation

# purpose → transaction_type. The source's own two switches (`setPurpose('sale'|'rent')`).
_DEAL = {"sale": "Buy", "rent": "Rent"}

# The source's own type words, all 11 measured across the whole catalogue. Only the ones the shared
# TYPE_MAP_AR does not carry EXACTLY are listed (contract: map_type_exact, exact match only).
# «تاون هاوس» → Villa is the fleet's existing decision (dwelleo, goldendeal, rakez …).
_TYPE_OVERRIDES = {
    "أرض سكنية": "Residential Land",      # the shared map's own value for «أرض»
    "تاون هاوس": "Villa",
    "عمارة سكنية": "Building",            # shared «عمارة» → Building
    "عمارة تجارية": "Commercial Building",
}

# The source's own availability pill. `ok` is «متاحة»; `off` is مباعة/مؤجرة and `warn` is محجوزة.
_STATUS_AVAILABLE_CLASS = "ok"
# The source's own project-status class for not-yet-built inventory («قيد الإنشاء»).
_OFF_PLAN_CLASS = "st-construction"

_CARD_RE = re.compile(r'<article class="asp-ucard">(.*?)</article>', re.S)
_PROJECT_CARD_RE = re.compile(r'<article class="asp-card">(.*?)</article>', re.S)
_COUNT_RE = re.compile(r'class="asp-count">\s*([\d,٠-٩]+)\s*وحدة')
_UNIT_HREF_RE = re.compile(re.escape(BASE) + r"/sales/unit/(\d+)")
_PROJECT_HREF_RE = re.compile(re.escape(BASE) + r'/sales/([^"/]+)"')
_AREA_RE = re.compile(r"^([\d,.٠-٩]+)\s*م²$")
_ROOMS_RE = re.compile(r"^([\d٠-٩]+)\s*غرف$")
_BATHS_RE = re.compile(r"^([\d٠-٩]+)\s*دورة مياه$")
_FLOOR_RE = re.compile(r"^الدور\s*([\d٠-٩]+)$")
# The source's own «price on request» wording, and the CSS class it ships with it.
_ON_REQUEST_TEXT = "السعر عند الطلب"
# An auction never appears on this developer's own portal (0 of 332 pages carry «مزاد»), but the
# fleet rule is absolute, so the word is refused rather than assumed absent forever.
_AUCTION_RE = re.compile(r"مزاد")


def _txt(fragment: Optional[str]) -> Optional[str]:
    """Visible text of an HTML fragment: tags out, entities decoded, whitespace collapsed."""
    if not fragment:
        return None
    s = re.sub(r"\s+", " ", html_mod.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()
    return s or None


def _one(pattern: re.Pattern, text: str, group: int = 1) -> Optional[str]:
    m = pattern.search(text or "")
    return m.group(group) if m else None


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")        # impersonate OWNS the User-Agent
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


# ── PARSERS. Each field is read INSIDE its own card container (trap 2). ───────────────────────────
def parse_projects(page: str) -> dict[str, dict[str, Optional[str]]]:
    """slug → the project card's own name, status class/word and category tag.

    The status class is the platform's own marker; `st-construction` is what makes a project's units
    off-plan (trap 3). Nothing here is inferred from the project's NAME.
    """
    out: dict[str, dict[str, Optional[str]]] = {}
    for card in _PROJECT_CARD_RE.findall(page):
        slug = _one(_PROJECT_HREF_RE, card)
        if not slug:
            continue
        status = re.search(r'class="asp-status ([^"]*)">\s*([^<]*)', card)
        out[slug] = {
            "slug": slug,
            "name": _txt(_one(re.compile(r'class="asp-name"><a[^>]*>(.*?)</a>', re.S), card)),
            "status_class": (status.group(1).strip() if status else None),
            "status": (_txt(status.group(2)) if status else None),
            "tag": _txt(_one(re.compile(r'class="asp-tag2">\s*([^<]*)'), card)),
            "where": _txt(_one(re.compile(r'class="asp-where">(.*?)</div>', re.S), card)),
        }
    return out


def parse_unit_cards(page: str) -> tuple[list[dict[str, Any]], Optional[int]]:
    """(cards, the count the page prints about itself).

    The printed `asp-count` is the completeness oracle; a page that stops printing it yields None
    and the crawl refuses to prune (an unverified enumeration may not delete anything).
    """
    cards: list[dict[str, Any]] = []
    for c in _CARD_RE.findall(page):
        uid = _one(_UNIT_HREF_RE, c)
        if not uid:
            continue
        proj = _one(re.compile(r'class="asp-uproj">(.*?)</div>', re.S), c) or ""
        # Everything after the project's own <a> is its location line — «— حي القادسية، الرياض».
        where = _txt(proj.split("</a>", 1)[1]) if "</a>" in proj else None
        specs = _one(re.compile(r'class="asp-uspecs">(.*?)</div>', re.S), c) or ""
        pill = re.search(r'class="asp-pill ([^"]*)">\s*([^<]*)', specs)
        price = re.search(r'class="asp-uprice([^"]*)">\s*([^<]*)', c)
        cards.append({
            "id": uid,
            "url": f"{BASE}/sales/unit/{uid}",
            "project_slug": _one(_PROJECT_HREF_RE, proj),
            "project_name": _txt(_one(re.compile(r"<a[^>]*>(.*?)</a>", re.S), proj)),
            "where": (where or "").lstrip("—– ").strip() or None,
            "name": _txt(_one(re.compile(r'class="asp-uname">\s*<a[^>]*>(.*?)</a>', re.S), c)),
            # Only the spans of THIS card's own spec row.
            "specs": [t for t in (_txt(s) for s in re.findall(r"<span[^>]*>(.*?)</span>",
                                                              specs, re.S)) if t],
            "status_class": (pill.group(1).strip() if pill else None),
            "status": (_txt(pill.group(2)) if pill else None),
            "price_class": (price.group(1).strip() if price else None),
            "price_text": (_txt(price.group(2)) if price else None),
            "photo": _one(re.compile(r"asp-uphoto[^>]*background-image:url\('([^']*)'\)"), c),
        })
    declared = normalize.to_int(_one(_COUNT_RE, page))
    return cards, declared


def _specs(card: dict[str, Any]) -> dict[str, Any]:
    """The card's own spec spans → (area_raw, bedrooms, bathrooms, floor), by CONTENT not position.

    63 of the 332 cards print area + status only, so a positional read would file a status pill as a
    bathroom count. Arabic-Indic digits are accepted everywhere (normalize.to_int folds ٠-٩).
    """
    got: dict[str, Any] = {}
    for s in card.get("specs") or []:
        for key, pat in (("area_raw", _AREA_RE), ("bedrooms", _ROOMS_RE),
                         ("bathrooms", _BATHS_RE), ("floor_number", _FLOOR_RE)):
            m = pat.match(s)
            if m and key not in got:
                got[key] = m.group(1)
    return got


def _unit_code(name: Optional[str]) -> Optional[str]:
    """«شقة — وحدة KHR-DM10-AP-A87» → 'KHR-DM10-AP-A87'. The unit's own stable identity."""
    if not name or " — " not in name:
        return None
    rest = name.split(" — ", 1)[1].strip()
    return (rest[len("وحدة"):].strip() or None) if rest.startswith("وحدة") else (rest or None)


def _type_word(name: Optional[str]) -> Optional[str]:
    return name.split(" — ", 1)[0].strip() if name and " — " in name else None


def _city_and_district(where: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """«حي الحمراء، الخبر» → ('الخبر', 'حي الحمراء'); «الرياض» → ('الرياض', None).

    The city is the LAST comma-separated part — the platform writes district first, and 60 of the
    332 available cards print no district at all (sama-najd, nobles, deem-13, al-wadi-plaza).
    """
    if not where:
        return None, None
    parts = [p.strip() for p in re.split(r"[،,]", where) if p.strip()]
    if not parts:
        return None, None
    return parts[-1], ("، ".join(parts[:-1]) or None)


def map_listing(card: dict[str, Any], project: Optional[dict[str, Any]],
                purpose: str, also_offered: bool = False) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) for ONE unit card. row is None exactly when a reason is set."""
    uid = card.get("id")
    if not uid:
        return None, "residential", "no_id"

    deal = _DEAL.get(purpose)
    if not deal:
        return None, "residential", f"purpose_unknown_{purpose}"

    # The source's own availability pill, by its own class (trap 4).
    if card.get("status_class") != _STATUS_AVAILABLE_CLASS:
        return None, "residential", f"unit_not_available_{card.get('status') or 'blank'}"

    label = _txt(card.get("name"))
    if _AUCTION_RE.search(f"{label or ''} {card.get('project_name') or ''}"):
        return None, "residential", "auction_مزاد"

    type_ar = _type_word(label)
    property_type = normalize.map_type_exact(type_ar, _TYPE_OVERRIDES)
    if not property_type:
        return None, "residential", f"type_unmapped_{type_ar or 'blank'}"
    category = normalize.category_for_type(property_type).lower()

    # OFF-PLAN, on the project card's own class + word (trap 3). An unresolved project fails CLOSED:
    # "we could not read the project's status" is not "the project is built".
    if not project or not project.get("status_class"):
        return None, category, "project_status_unknown"
    if project["status_class"] == _OFF_PLAN_CLASS:
        word = (project.get("status") or "").replace(" ", "_")
        return None, category, f"project_under_construction_{word}"

    where = card.get("where") or project.get("where")
    city_ar, district_raw = _city_and_district(where)
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_ar = find_district_in_text(district_raw, city_id)

    spec = _specs(card)
    unit_code = _unit_code(label)

    # ── PRICE. The source publishes «السعر عند الطلب» and nothing else (trap 1). ─────────────────
    price_text = card.get("price_text")
    on_request = (card.get("price_class") == "none") or (price_text == _ON_REQUEST_TEXT)
    # Read the printed figure rather than hardcoding the absence: the day this platform starts
    # publishing prices, the row must carry it. Never computed, never taken from prose.
    published = None if on_request else normalize.to_int(price_text)
    # db.AUTHORITATIVE_NULL is deliberately falsy, so it must be chosen by an explicit conditional.
    absent = db.AUTHORITATIVE_NULL if on_request else None

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{uid}" + ("-R" if deal == "Rent" else ""),
        "listing_url": card["url"],
        "source": SOURCE,
        "active": True,
        "title": redact_pii(label),
        "property_type": property_type,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "project_name": redact_pii(_txt(card.get("project_name"))),
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        # REDACTED even though it is "just a district": it is the only free text on the card that
        # the platform composes itself, and free text is where a contact number arrives. The lookup
        # above still runs on the raw string — redaction is about what we STORE.
        "neighborhood": redact_pii(district_raw),
        "area_m2": normalize.to_int(spec.get("area_raw")),
        "bedrooms": normalize.to_int(spec.get("bedrooms")),
        "bathrooms": normalize.to_int(spec.get("bathrooms")),
        "floor_number": normalize.to_int(spec.get("floor_number")),
        "photo_urls": [BASE + card["photo"]] if card.get("photo") else None,
        # price_per_meter is NOT written: this source publishes no per-metre rate for anything,
        # land included, and an absent figure may not be manufactured from area.
        "price_total": (absent if published is None else published) if deal == "Buy" else None,
        "price_annual": (absent if published is None else published) if deal == "Rent" else None,
    }
    # NB: `rent_period` is deliberately NOT a key of this row. This source states no period
    # anywhere (trap 5), and an ABSENT key — unlike a None one — also means a period a future run
    # reads off a page that starts printing one cannot be erased by our silence.
    #
    # `raw` keeps the source's own words as the audit trail — redacted, because PDPL outranks
    # verbatimness and a phone number is not part of a price. Nothing else about it is altered.
    row["price_evidence"] = normalize.price_evidence(
        field="asp-uprice", raw=redact_pii(price_text), stored=published,
        kind="total" if deal == "Buy" else "annual", unit="total",
        origin="structured", authoritative_absent=on_request)
    row["images_evidence"] = {"observed": True, "container_present": "photo" in card,
                              "key_present": bool(card.get("photo")),
                              "count": len(row["photo_urls"] or []),
                              "project_cover": bool(card.get("photo"))}

    info = {
        "source_id": uid,
        "unit_code": redact_pii(unit_code),
        "unit_label": redact_pii(label),
        "project_slug": card.get("project_slug"),
        "project_status": project.get("status"),
        "project_status_class": project.get("status_class"),
        "project_category_ar": project.get("tag"),
        "project_where": redact_pii(_txt(where)),
        "type_ar": type_ar,
        "area_label_ar": "مساحة البناء",           # the source's own label for area_m2
        "source_area_raw": spec.get("area_raw"),    # exact m², before area_m2's INTEGER round
        "unit_status_ar": card.get("status"),
        "price_text": redact_pii(price_text),
        # The same unit is published under BOTH switches — the other row's side, named.
        "also_offered_as": ("Rent" if deal == "Buy" else "Buy") if also_offered else None,
        # The image is the PROJECT's cover, shared by every unit of that project — not a photograph
        # of this unit. Recorded so nobody downstream reads it as one.
        "photo_is_project_cover": True if card.get("photo") else None,
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v is not None})
    # An ALLOWLIST of parsed fields, never the raw HTML: the unit block itself carries the company's
    # WhatsApp link and unified number on all 332 pages (trap 6). Text fields are redacted here
    # rather than leaning on db.redact_capture() — a barrier after the row leaves the mapper is not
    # this mapper's guarantee.
    row["source_capture"] = strip_pii_fields({
        "schema": "alsaedan.units-list-card.v1",
        "purpose": purpose,
        "unit_id": uid,
        "unit_label": redact_pii(label),
        "unit_code": redact_pii(unit_code),
        "project_slug": card.get("project_slug"),
        "project_name": redact_pii(_txt(card.get("project_name"))),
        "project_status_class": project.get("status_class"),
        "project_status_ar": project.get("status"),
        "where": redact_pii(_txt(where)),
        "specs": [redact_pii(s) for s in (card.get("specs") or [])],
        "status_class": card.get("status_class"),
        "price_class": card.get("price_class"),
        "price_text": redact_pii(price_text),
        "photo_path": card.get("photo"),
    })
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


def fetch_projects(s: cc.Session) -> dict[str, dict[str, Any]]:
    """Every project card, from both purpose views (a project is listed under the side it sells)."""
    out: dict[str, dict[str, Any]] = {}
    for purpose in ("sale", "rent"):
        page = 1
        while page <= MAX_PAGES:
            found = parse_projects(
                _get(s, f"{BASE}/sales?view=projects&purpose={purpose}&page={page}"))
            if not found:
                break
            new = [k for k in found if k not in out]
            # A project seen under both purposes keeps its FIRST reading (its two status words
            # differ — «مباع جزئي» vs «مؤجّر جزئي» — while the class is the same), except that an
            # st-construction marker always wins: off-plan is off-plan on both sides.
            for k, v in found.items():
                if k not in out or v.get("status_class") == _OFF_PLAN_CLASS:
                    out[k] = v
            if not new:
                break
            page += 1
    if not out:
        raise RuntimeError(f"{BASE}/sales?view=projects served no project cards")
    return out


def fetch_units(s: cc.Session, purpose: str, limit: int = 0) -> tuple[dict[str, dict], bool]:
    """Every AVAILABLE unit card for one purpose, plus whether the list enumerated COMPLETE.

    Complete means the page's own printed `asp-count` equals the distinct cards we hold. Only then
    may anything be pruned — a truncated crawl must never look like a shrunken catalogue.
    """
    rows: dict[str, dict] = {}
    declared: Optional[int] = None
    page = 1
    while page <= MAX_PAGES:
        body = _get(s, f"{BASE}/sales?view=units&purpose={purpose}&available=1&page={page}")
        cards, printed = parse_unit_cards(body)
        if declared is None:
            declared = printed
        if not cards:
            break
        before = len(rows)
        for c in cards:
            rows[c["id"]] = c
        if len(rows) == before:
            break                       # the page repeated itself — stop rather than loop forever
        if limit and len(rows) >= limit:
            return {k: rows[k] for k in list(rows)[:limit]}, False
        if len(cards) < PAGE_SIZE:
            break
        page += 1
    complete = bool(declared) and len(rows) == declared
    print(f"{SOURCE}: {purpose} {len(rows)} available unit(s) over {page} page(s); "
          f"asp-count={declared} complete={complete}", flush=True)
    return rows, complete


# ── LIVENESS (measured 2026-09-24; see the docstring — a de-listed unit loses its page) ───────────
def _signal(status, body, path_changed) -> Optional[str]:
    """'live' | 'gone' | None — this platform's AFFIRMATIVE signals only; the law does the rest."""
    if status == 404:
        return "gone"                   # never existed / hard-deleted
    if path_changed:
        # 302 off /sales/unit/{id} onto its project page: the unit is no longer available. Measured
        # on 14 of 14 unavailable ids, and on 0 of 6 available controls.
        return "gone"
    if status == 200 and 'class="aup-h1"' in (body or ""):
        return "live"                   # its own unit block, on its own path
    return None


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str, canary=None):
        m = re.fullmatch(rf"{PREFIX}(\d+)(?:-R)?", ad_number or "")
        if not m:
            return "unknown", f"{ad_number!r} is not a {PREFIX}<id>[-R] ad number"
        return LivenessProbe(platform=SLUG, signal=_signal, session=session,
                             url_for=lambda _ad: f"{BASE}/sales/unit/{m.group(1)}",
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
        projects = fetch_projects(s)
        offplan = sorted(k for k, v in projects.items()
                         if v.get("status_class") == _OFF_PLAN_CLASS)
        print(f"{SOURCE}: {len(projects)} project card(s); off-plan: {offplan}", flush=True)
        units: dict[str, dict[str, dict]] = {}
        completes: list[bool] = []
        for purpose in ("sale", "rent"):
            units[purpose], ok = fetch_units(s, purpose, limit=args.limit)
            completes.append(ok)
        complete = all(completes)
        dual = set(units["sale"]) & set(units["rent"])
        if not units["sale"] and not units["rent"]:
            raise RuntimeError(f"{BASE}/sales?view=units served no available unit cards")
        for purpose in ("sale", "rent"):
            for uid, card in units[purpose].items():
                row, cat, why = map_listing(card, projects.get(card.get("project_slug") or ""),
                                            purpose, also_offered=uid in dual)
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
                  f"({len(dual)} unit(s) offered both ways) — nothing written")
            for r0 in (res + com)[:20]:
                print(f"   {r0['ad_number']:>10} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):17} {str(r0['city_ar']):8} "
                      f"d={str(r0['district_ar'])[:14]:14} a={str(r0['area_m2']):>7} "
                      f"bd={str(r0.get('bedrooms')):>4} ba={str(r0.get('bathrooms')):>4} "
                      f"pt={r0.get('price_total')!r} pa={r0.get('price_annual')!r} "
                      f"rp={r0.get('rent_period')} ph={len(r0.get('photo_urls') or [])} "
                      f"prj={str(r0.get('project_name'))[:12]}")
            return 0
        # The public upsert_alsaedan_*_batch wrappers are added centrally at onboarding; same path.
        db._wasalt_batch("alsaedan_residential_listings", res)
        db._wasalt_batch("alsaedan_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="alsaedan_residential_listings", com_table="alsaedan_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in (("alsaedan_residential_listings", res),
                              ("alsaedan_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        elif args.type == "all":
            print("  prune skipped: asp-count did not match the cards served (incomplete list)")
        healthy = db.end_run(run_id, ok=True, rows_seen=sum(len(v) for v in units.values()),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} complete={complete} {notes}"[:300],
                             check_tables=["alsaedan_residential_listings",
                                           "alsaedan_commercial_listings"])
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
