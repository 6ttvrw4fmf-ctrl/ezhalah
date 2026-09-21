"""مكتب الجاسم للخدمات العقارية (aljassimaqar.com) — a single-office Al-Ahsa brokerage, 90 listings.

WHAT THE SITE IS. The SAME Drupal 8 brokerage theme abralosol.com runs (down to the Views machine
names and the `wa.me` share button — aljassim's share links still point at bossbihoffice.com.sa, a
sibling clone). The whole catalog is ONE Views table on `/` (no pager: 90 `<tr>` = 90 unique nids,
matching the count the site itself prints). Detail page = /{nid}. This scraper therefore mirrors
scrapers/abralosol/run.py deliberately — same cell selectors, same PRICE_LABELS taxonomy, same
"the label decides the column" rule — and every place it DIVERGES is named below.

MEASURED SOURCE SHAPE (probed live 2026-09-20/21 before any code was written):

  · ENUMERATION IS THE INDEX TABLE, **NOT** rss.xml. The handoff brief said "Has rss.xml — use it,
    it is the clean enumeration". VERIFIED FALSE: /rss.xml serves exactly 10 items and `?page=1`
    returns the same 10, so the feed is a latest-10 teaser. Shipping it would have published 10 of
    90 listings and looked healthy by row count. The index table carries strictly MORE than the
    feed per listing (area, street width, plot number, thumbnail, bump date), so the feed is not
    read at all.

  · EVERY FIELD IS IN THE INDEX ROW, keyed by the Drupal Views `headers` machine name — never by
    column position:
        view-field-als-r-table-column  → price LABEL + amount, then a <br>, then a VIEW COUNTER
        view-nothing-1-table-column    → «المساحة N م» and/or the room prose and/or «الدور …»
        view-field-tags-table-column   → district, then a Google-Maps pin, then the plot number
        view-nothing-table-column      → «TYPE\\nDEAL» link to /{nid}, thumbnail, bump date
    Some rows link the title as /index.php/{nid} instead of /{nid} (1 of 90) — both forms must
    match or that row arrives with no type and no deal and is dropped as unmappable. Same quirk,
    same fix, as abralosol (164 of its 2,761).

  · A JS CHALLENGE SITS IN FRONT OF EVERYTHING. `server: hcdn` answers the first request of a
    session with an identical-size HTTP 403 (6,192 bytes, «Checking your browser…») on EVERY path,
    for every curl_cffi impersonation profile — the shape that reads exactly like an IP block and
    is not one. It is a plain SHA-256 proof of work and `_solve_challenge` below does it in ~9
    lines: GET /hcdn-cgi/jschallenge (needs a Referer) → `const cjs = '<nonce>'` →
    POST /hcdn-cgi/jschallenge-validate with `challenge=sha256(nonce)` → the `hcdn` cookie lands
    and the whole session is clear. No browser, no proxy, no Playwright. Written INSIDE this file
    because scrapers/common/http.py has no challenge step (see the report).

  · PRICE BASIS IS PUBLISHED ONLY AS AN ARABIC LABEL, and 5 of 90 listings are priced PER SQUARE
    METRE: nid 4912 renders «المتر 850» for a 540 m² plot, 4595 «المتر سوم 1,700» for 490.64 m².
    Booking that as a total files a plot at 850 SAR. The label decides the column:
        السعر / قابل للتفاوض / السوم / الحد / على السوم → price_total
        المتر / المتر سوم                              → price_per_meter
    MEASURED label census over all 90 rows: السعر 37, «على السوم» (bare, no figure) 23, السوم 9,
    الحد 7, «قابل للتفاوض» 6, المتر 4, «المتر سوم» 1, «على السوم N» 1, and 2 bare labels with no
    figure. Longest label first, so «المتر سوم» can never match as «السوم».
    AREA IS NEVER MULTIPLIED HERE. The searchable total is derived DOWNSTREAM by the database —
    `price_total_effective()` (migration 20260903230451) returns price_per_meter × area_m2 for a
    Buy row that publishes no total, from two real source values. Doing it in the scraper too
    would write a computed number into a SOURCE column and hide which one the office published.
    «السوم» (the asking/bid figure) and «الحد» (the floor the seller will accept) ARE published
    prices — all 17 of them are plausible against their own area (700,000 for 204 m², 5,000,000
    for a 650 m² mixed-use building) — so they go in price_total with `price_kind` recorded.
    A bare «على السوم» / «السعر» / «قابل للتفاوض» with no figure → price NULL, never 0.

  · THE RENT PERIOD IS PUBLISHED ON EXACTLY ONE LISTING, AND IT IS MONTHLY. The handoff brief said
    "No rent period stated anywhere -> NULL". 21 of the 22 rent rows do carry a bare «السعر N» with
    no period on the label and a room list rather than lease terms in the body — but nid 5208's body
    reads «ايجاره بالشهر 1800 ريال شامل الكهرباء والماء», adjacent to the exact figure its price cell
    carries. Defaulting that to a year books 1,800 as the ANNUAL rent for a flat that costs 21,600 a
    year: the 12x card error PERIOD=SOURCE exists to prevent. `rent_period_and_annual` decides, from
    the label plus the body text adjacent to THIS figure (abralosol's adjacency rule), over a
    per-platform spelling fold for «بالشهر»/«في السنه» — see _PERIOD_FOLD. No token → NULL.
    DIVERGENCE FROM abralosol: when the period is unknown the figure is still written to
    price_annual. abralosol NULLs the price instead; on THIS catalog that would erase 21 of the 22
    rent prices the office publishes, which is the exact regression the
    no-hiding-source-published-prices rule names. The period is honestly NULL; the money is honestly
    the office's own number, and additional_info.price_amount_raw always keeps it verbatim.

  · CITY IS NOT PUBLISHED PER LISTING — not on the index, not on the detail page. The office
    publishes its own: footer «الأحساء, الهفوف, حي الفيصلية». Every district in the catalog is an
    Al-Ahsa one (النخيل، الضاحية الحي التاسع، الشهابية، المباركية، الدانة بالهفوف، البطالية، الجفر).
    city_ar is «الهفوف» with the office's own region as the twin-disambiguating hint, NOT «الأحساء»
    — the reason is measured and load-bearing, see OFFICE_CITY_AR — and
    additional_info["city_basis"] = "office_default" records that it was DERIVED and not read.
    Same derivation, same resolved city, as abralosol — deliberately, so two offices in one market
    do not split into two cities. «المبرز» is NOT promoted to its own city for the same reason,
    even though it is a distinct catalog city (1 listing names it; flagged, not decided here).

  · BEDROOMS/BATHROOMS ARE A STRUCTURED FIELD HERE (divergence from abralosol, which correctly
    leaves them NULL because on its catalog they live in narrative prose). The `nothing-1` cell IS
    the room field: «غرفتين + مجلس + صاله + مطبخ مفتوح + دورتين مياه». 81 of 90 rows carry that cell
    and 23 of them state a room count in it (the rest carry only «المساحة N م» and «شارع N»).
    THE TRAPS THAT KEEP IT HONEST (all three measured in this catalog):
      - «4 شقق كل شقه اربع غرف» (nid 4709) and «بيت مكون من 4 شقق» (3656) — four rooms EACH in a
        four-flat house. «البيت مكون من دورين … وخمس غرف …» (5103) — five rooms on ONE of two
        floors. A multi-unit or multi-floor description states a count for a PART, so bedrooms is
        NULL, never the part's number (wslnaa's rooms≠bedrooms lesson, same shape).
      - «مجلس», «صالة», «مطبخ», «غرفة غسيل» are not bedrooms and carry no number, so the
        number-adjacency requirement excludes them on its own.
      - Arabic word numerals are the site's normal spelling — «غرفتين» (dual = 2), «ثلاث/أربع/خمس
        غرف» — and «4غرف» appears with no space. Both are parsed; a bare «غرفة» is 1.
      - Bathrooms only from «دورتين مياه» (2) / «N دورات مياه» / «دورة مياه» (1).

  · PHOTOS: 1-2 per listing, and the page also renders TWO things that are not photos of the
    property — the «مخطط <district>» plan image (a per-DISTRICT banner uploaded once in 2018-12
    and reused by every listing in that district, sitting in its own
    `block-views-blockrelated-pdf-block-1`) and a WhatsApp .mp4 walkthrough. Only
    `a.lightbox[href]` INSIDE the node article is read, which excludes both by construction
    rather than by a filename heuristic.

  · «رقم المعلن: 1181321» is on every detail page and is the SAME number on all of them — it is
    the OFFICE's advertiser licence, not a per-listing REGA ad number. It is recorded once per row
    in additional_info as `office_advertiser_number` and is NEVER used as ad_number (ad_number is
    JSM+nid). Measured on 4 unrelated nids (4600/5182/4912 identical, 2706 identical).

  · NO auction («مزاد») and no sold/rented («تم البيع»/«تم الإيجار») wording appears anywhere in
    the catalog — 0 occurrences measured. The skip rules are implemented anyway: a broker site
    marks its own stock sold eventually, and an unimplemented rule is the one that silently
    publishes a sold ad the day the office starts writing it.

    python -m scrapers.aljassim.run --dry-run --limit 15     # validate, zero DB writes
    python -m scrapers.aljassim.run --limit 30               # upsert first 30, no prune
    python -m scrapers.aljassim.run                          # full crawl + prune
"""
from __future__ import annotations

import argparse
import hashlib
import html as html_mod
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db  # noqa: E402
from scrapers.common import normalize as N  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii  # noqa: E402

BASE = "https://aljassimaqar.com"
SOURCE = "Al Jassim"
PLATFORM = "aljassim"
PREFIX = "JSM"

# The office's own city, published in its footer («الأحساء, الهفوف, حي الفيصلية»). Not a per-listing
# field — see the docstring's CITY note and additional_info["city_basis"].
#
# «الهفوف», NOT «الأحساء», AND THE HINT IS NOT OPTIONAL. Measured against the live catalog:
#   to_catalog("الأحساء")                     → city_id 3677, which has **0** rows in
#                                               loc_catalog_district — so every district_ar would
#                                               come back NULL and the listings would land on a
#                                               city with no district taxonomy at all.
#   to_catalog("الهفوف")                      → (None, None): «الهفوف» is a name twin (city 12 in
#                                               the Eastern Province, city 501 in Riyadh) and
#                                               to_catalog correctly refuses to guess between them.
#   to_catalog("الهفوف", "Eastern Province")  → (12, 5), a city with 110 real districts, and
#                                               find_district_in_text then resolves النخيل →
#                                               «حي النخيل», الشهابية، المباركية ٢ → «حي المباركية»,
#                                               «الدانة بالهفوف» → «حي الدانة», …
# The hint is the office's OWN published region (its footer city الأحساء is in the Eastern Province;
# there is no Riyadh reading of this catalog), so it disambiguates from source rather than guessing.
# Canonical English is "Hofuf" — the same city abralosol's Al-Ahsa office resolves to, deliberately,
# so two brokerages in one market do not split into two cities in the results.
OFFICE_CITY_AR = "الهفوف"
OFFICE_REGION_HINT = "Eastern Province"
OFFICE_CITY_FOOTER = "الأحساء, الهفوف, حي الفيصلية"

DETAIL_PAUSE = 0.35      # site answers in ~0.3s; no rate limiting observed over ~100 fetches

# Per-platform EXACT overrides (map_type_exact contract: spellings/conflicts only, never a new
# canonical type). Identical دبلكس entry to abralosol's — this theme family spells duplex without
# the واو while the shared map's key is «دوبلكس». «استراحات» is the plural of an EXISTING canonical
# type, used by the source's own «مجموعه استراحات للبيع» (a compound of rest houses) — plural→
# singular is morphology, not a semantic guess, and the source's exact wording survives in
# additional_info["type_raw"].
TYPE_OVERRIDES = {
    "دبلكس": "Duplex",
    "دبلوكس": "Duplex",
    "استراحات": "Rest House",
}

# ── PRICE LABELS ────────────────────────────────────────────────────────────────────────────────
# label → (basis, kind). LONGEST FIRST: «المتر سوم» must never match as «السوم», and «على السوم»
# must be tried before «السوم». basis decides the COLUMN; kind is recorded and never changes it.
PRICE_LABELS: tuple[tuple[str, str, str], ...] = (
    ("قابل للتفاوض", "total", "negotiable"),
    ("المتر سوم", "per_sqm", "offer"),
    ("سوم المتر", "per_sqm", "offer"),
    ("على السوم", "total", "offer"),
    ("المتر", "per_sqm", "asking"),
    ("السعر", "total", "asking"),
    ("السوم", "total", "offer"),
    ("الحد", "total", "reserve"),
)

# SKIP, DON'T FAKE (rule 5) — AND THE SCOPE IS AS LOAD-BEARING AS THE PATTERN.
#
# The first version of this guard scanned the whole detail body and included «مؤجر». It dropped two
# perfectly live FOR-SALE listings, both caught by re-reading what it matched:
#   nid 5025 «بيت للبيع … السوم 700,000 … يوجد كراج ( محل ) مؤجر ب ٢٠٠٠ في السنه»
#   nid 4513 «عمارة … للبيع … الحد 5,000,000 … 12 شقة ومحلين … مؤجرة بالكامل»
# On a SALE ad «مؤجر» describes the TENANTS — the rental income is the selling point, the exact
# opposite of "this ad is closed". So «مؤجر» is gone from the pattern, and the status scan is
# scoped to where an office actually marks status — the title and the price cell — not to narrative
# prose about the property. Re-measured over all 90 rows after the change: 0 matches, i.e. 0 false
# positives and nothing marked sold today, which is also what a plain text search of the catalog
# says («تم البيع»/«تم الإيجار»/«مزاد» = 0 occurrences site-wide).
_AUCTION = re.compile(r"مزاد")
_GONE = re.compile(r"تم\s*(?:ال)?(?:بيع|إيجار|ايجار|تأجير|تاجير|حجز|تصرف)|مباع(?:ة|ه)?")

_TR = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
_TD = re.compile(r'<td[^>]*headers="([^"]+)"[^>]*>(.*?)</td>', re.S)
_NID = re.compile(r'href="/(?:index\.php/)?(\d+)"')
_TITLE_A = re.compile(r'<a\s+href="/(?:index\.php/)?\d+"[^>]*hreflang[^>]*>(.*?)</a>', re.S)
_IMG = re.compile(r'<img[^>]*src="([^"]+)"')
_DATE = re.compile(r"\b(\d{2}/\d{2}/\d{4})\b")
_AREA = re.compile(r"المساحة\s*([\d,.]+)\s*م")
_STREET = re.compile(r"شارع\s*([\d\+\.\*/\s]*\d)(?:\s*/\s*([^\s\d/]+))?")   # «شارع 50 / شرق»
_MAPS = re.compile(r'href="(https://www\.google\.com/maps/[^"]+)"')
_ARTICLE = re.compile(r'<article[^>]*data-history-node-id="(\d+)".*?</article>', re.S)
_SCHEMA_NAME = re.compile(r'<span[^>]*property="schema:name"[^>]*content="([^"]*)"')
_OG_TITLE = re.compile(r'<meta property="og:title" content="([^"]*)"')
_BLOCK = re.compile(r'<div([^>]*)class="text-right[^"]*"[^>]*>', re.S)
_BLOCK_END = re.compile(r'<span class="a2a_kit|<ul class="links inline')
_CONTENT_ATTR = re.compile(r'content="([^"]*)"')
_LIGHTBOX = re.compile(r'<a[^>]*class="lightbox"[^>]*href="([^"]+)"')
_ADVERTISER = re.compile(r"رقم\s*المعلن\s*[:：]?\s*([0-9٠-٩]+)")
# Age comes ONLY from the labelled «العمر» fact block («العمر 35 سنة» — 16 of 90 rows state it),
# never from narrative prose: a sentence like «العمارة عمرها …» is seller narrative, not a field.
_AGE_BLOCK = re.compile(r"^\W*العمر\s*(.+)$")
# A detail block that IS a structured column (area / street width / age / any price label) is not
# description prose. Every one of these is already captured in its own field.
_STRUCTURED_BLOCK = re.compile(
    r"^\W*(?:المساحة|شارع|العمر|" + "|".join(lab for lab, _, _ in PRICE_LABELS) + r")\b")
# «المساحة N م» and «شارع N» are the area and street-width columns; whatever else shares that index
# cell (the room list, the floor) is prose. Both are removed from the description piece so the
# street width is not restated as the ad's only words (nid 5025/4912 were exactly that).
_INDEX_FIELDS = re.compile(r"المساحة\s*[\d,.]+\s*م|شارع\s*[\d\+\.\*/\s]*\d")
# A block that is ENTIRELY a figure (+ «ريال») is the price amount, not prose. Testing `to_int(txt)
# is not None` instead would drop every sentence that contains a digit — which silently deleted the
# real narrative on nid 5025 («٥ غرف و٣ دورات مياه …») and emptied 4513's description completely.
_AMOUNT_ONLY = re.compile(r"^[\s\d,.٠-٩٬]+(?:ريال|ريالا|ر\.س)?\s*$")

# PDPL: redact_pii() strips numbers/handles; this cuts the contact CTA prose in front of them.
_CUT = re.compile(r"(للتواصل|للاستفسار|للإستفسار|للحجز|اتصل|تواصل|واتساب|واتس|جوال|الجوال|"
                  r"المعلن|الوسيط|المسوق|📞|☎|📱|whatsapp|call us)", re.I)

# ── BEDROOMS / BATHROOMS ────────────────────────────────────────────────────────────────────────
# A count is read ONLY when it is adjacent to the room word, so «مجلس»/«صالة»/«مطبخ»/«غرفة غسيل»
# (all unnumbered) can never contribute. Arabic word numerals are the site's normal spelling.
_WORD_NUM = {"غرفتين": 2, "غرفتان": 2, "دورتين": 2, "دورتان": 2,
             "واحدة": 1, "واحده": 1, "اثنتين": 2, "اثنين": 2, "ثلاث": 3, "ثلاثة": 3, "ثلاثه": 3,
             "أربع": 4, "اربع": 4, "أربعة": 4, "اربعة": 4, "اربعه": 4,
             "خمس": 5, "خمسة": 5, "خمسه": 5, "ست": 6, "ستة": 6, "سته": 6,
             "سبع": 7, "سبعة": 7, "سبعه": 7, "ثمان": 8, "ثمانية": 8, "ثمانيه": 8,
             "تسع": 9, "تسعة": 9, "تسعه": 9, "عشر": 10, "عشرة": 10, "عشره": 10}
# «مكون من دورين», «4 شقق», «كل شقه» — the count that follows describes ONE PART of a multi-unit or
# multi-floor property, so no bedroom count is asserted for the listing at all.
_MULTI_UNIT = re.compile(r"شقق|شقتين|دورين|أدوار|ادوار|مكون\s*من|كل\s*شق|فلل|وحدات")
_BEDS_DIGIT = re.compile(r"(\d+)\s*غرف")
_BEDS_WORD = re.compile(r"(" + "|".join(sorted(_WORD_NUM, key=len, reverse=True)) + r")\s*غرف")
_BATHS_DIGIT = re.compile(r"(\d+)\s*دور(?:ات|تي?ن?|ة|ه)?\s*مياه")
_BATHS_WORD = re.compile(r"(" + "|".join(sorted(_WORD_NUM, key=len, reverse=True)) +
                         r")\s*(?:دورات|دورة|دوره)?\s*مياه")
_BATHS_ONE = re.compile(r"دور[ةه]\s*مياه")      # the numeral-less singular = 1
# Types whose room count genuinely means bedrooms. A محل/أرض/مستودع room count is floor space.
_DWELLINGS = {"Apartment", "Villa", "Duplex", "Studio", "Floor", "Room", "Chalet", "Rest House"}


def session() -> cc.Session:
    """impersonate OWNS the User-Agent — no UA header is set (an overridden UA contradicts the TLS
    fingerprint and, on other platforms, 403'd every endpoint)."""
    return cc.Session(impersonate="chrome", timeout=40)


def _solve_challenge(s: cc.Session, url: str) -> bool:
    """Clear the `hcdn` JS challenge for this session. See the docstring's CHALLENGE note.

    The nonce endpoint needs a Referer or it answers 403 with a themed 404 body. Returns True when
    the validate call succeeded, so the caller can distinguish "challenge solved, retry the URL"
    from "this really is a block or a 404".
    """
    try:
        j = s.get(f"{BASE}/hcdn-cgi/jschallenge", headers={"Referer": url})
        m = re.search(r"cjs\s*=\s*'([^']+)'", j.text or "")
        if not m:
            return False
        proof = hashlib.sha256(m.group(1).encode()).hexdigest()
        v = s.post(f"{BASE}/hcdn-cgi/jschallenge-validate", data=f"challenge={proof}",
                   headers={"Content-Type": "application/x-www-form-urlencoded", "Referer": url})
        return v.status_code == 200
    except Exception:
        return False


def _get(s: cc.Session, url: str, tries: int = 3) -> Optional[str]:
    """Page text, or None. A 403 is a challenge FIRST and a block second: solve, then retry."""
    for attempt in range(tries):
        try:
            r = s.get(url)
            if r.status_code == 200:
                return r.text
            if r.status_code == 404:
                return None
            if r.status_code == 403 and _solve_challenge(s, url):
                r = s.get(url)
                if r.status_code == 200:
                    return r.text
                if r.status_code == 404:
                    return None
        except Exception:
            pass
        time.sleep(1.5 * (attempt + 1))
    return None


def _text(fragment: str) -> str:
    """Tag-stripped, entity-decoded text with <br> → newline."""
    t = re.sub(r"<br\s*/?>", "\n", fragment or "")
    t = re.sub(r"<[^>]+>", "\n", t)
    return html_mod.unescape(t).replace("\xa0", " ")


def _lines(fragment: str) -> list[str]:
    return [ln.strip() for ln in _text(fragment).split("\n") if ln.strip()]


def _flat(fragment: str) -> str:
    return re.sub(r"\s+", " ", _text(fragment)).strip()


def _clean(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    m = _CUT.search(text)
    if m:
        text = text[:m.start()]
    return redact_pii(re.sub(r"\s+", " ", text).strip()) or None


# ── index row parsing ───────────────────────────────────────────────────────────────────────────
def parse_price(cell_html: str) -> dict:
    """{raw, label, basis, kind, amount} from the price cell.

    The cell reads «LABEL\\nAMOUNT<br><i class=fa-eye></i>\\nVIEWS<a wa.me/…?text=…/5259>».
    Everything after the first <br> is a VIEW COUNTER plus a share URL that ends in the node id —
    two bare integers that both parse as a plausible price — so the cut happens BEFORE any number
    is read, not after.
    """
    head = re.split(r"<br", cell_html or "", maxsplit=1)[0]
    txt = re.sub(r"\s+", " ", " ".join(_lines(head))).strip()
    out: dict[str, Any] = {"raw": txt, "label": None, "basis": None, "kind": None, "amount": None}
    rest = txt
    for label, basis, kind in PRICE_LABELS:
        if txt.startswith(label):
            out.update(label=label, basis=basis, kind=kind)
            rest = txt[len(label):]
            break
    amount = N.to_int(rest)
    # A bare «على السوم» / «السعر» with no figure (25 of 90) → NULL, never 0.
    if amount is not None and amount > 0:
        out["amount"] = amount
    return out


def parse_rooms(area_cell_text: str, property_type: Optional[str]) -> tuple[Optional[int], Optional[int]]:
    """(bedrooms, bathrooms) from the room field. See the docstring's BEDROOMS traps."""
    txt = re.sub(r"\s+", " ", (area_cell_text or "")).translate(N._TRANS)
    if _MULTI_UNIT.search(txt):
        # A count stated for one flat or one floor of several is not this listing's total — and that
        # is as true of «دورتين مياه» as it is of «خمس غرف» (nid 5103 states both, for the ground
        # floor of a two-storey house), so BOTH columns stay NULL, not just bedrooms.
        return None, None
    baths = None
    m = _BATHS_DIGIT.search(txt) or _BATHS_WORD.search(txt)
    if m:
        tok = m.group(1)
        baths = int(tok) if tok.isdigit() else _WORD_NUM.get(tok)
    elif _BATHS_ONE.search(txt):
        # The SINGULAR «دورة مياه» / «دورة مياه واحده» carries no numeral at all, so both the digit
        # and the word-numeral patterns miss it and a stated 1 bathroom was silently dropped
        # (caught by the barrier on nid 4995's «4غرف + مطبخ + صاله + دورة مياه»). The dual
        # «دورتين مياه» is matched by _BATHS_WORD first and still yields 2, not 1.
        baths = 1
    if property_type not in _DWELLINGS:
        return None, baths
    beds = None
    m = _BEDS_DIGIT.search(txt) or _BEDS_WORD.search(txt)
    if m:
        tok = m.group(1)
        beds = int(tok) if tok.isdigit() else _WORD_NUM.get(tok)
    elif re.search(r"(?<![ء-ي])غرفتي?[نة]", txt):      # bare dual «غرفتين» = 2
        beds = 2
    elif re.search(r"(?<![ء-ي])غرفة(?!\s*(?:غسيل|خادمة|خادمه|سائق|حارس))", txt):
        beds = 1
    return (beds if beds and beds > 0 else None), baths


def index_rows(page_html: str) -> list[dict]:
    """[{nid, cells}] for every Views row on the index. Keyed by machine name, never position."""
    rows, seen = [], set()
    for tr in _TR.findall(page_html or ""):
        cells = {k: v for k, v in _TD.findall(tr)}
        if not cells:
            continue
        nid = _NID.search(cells.get("view-nothing-table-column", "")) or _NID.search(tr)
        if not nid or nid.group(1) in seen:
            continue
        seen.add(nid.group(1))
        rows.append({"nid": nid.group(1), "cells": cells})
    return rows


def parse_index(rec: dict) -> dict:
    """Everything the index publishes for one listing, as read (no normalization yet)."""
    c = rec["cells"]
    price_cell = c.get("view-field-als-r-table-column", "")
    area_cell = c.get("view-nothing-1-table-column", "")
    tags_cell = c.get("view-field-tags-table-column", "")
    title_cell = c.get("view-nothing-table-column", "")

    tags = _lines(tags_cell)
    ta = _TITLE_A.search(title_cell)
    title_lines = _lines(ta.group(1)) if ta else []
    thumb = _IMG.search(title_cell)
    date = _DATE.search(_text(title_cell))
    area_txt = _flat(area_cell)
    a, st = _AREA.search(area_txt), _STREET.search(area_txt)
    maps = _MAPS.search(tags_cell)

    return {
        "nid": rec["nid"],
        "price": parse_price(price_cell),
        "area_raw": a.group(1) if a else None,
        "street_width": st.group(1).strip() if st else None,
        "street_facade": st.group(2) if st else None,
        "rooms_text": area_txt,
        "district": tags[0] if tags else None,
        "plot": " ".join(tags[1:]).strip() or None,
        "maps_url": maps.group(1) if maps else None,
        "title_lines": title_lines,
        "thumb": thumb.group(1) if thumb else None,
        "bump_date": date.group(1) if date else None,
        "capture": {"price_cell": _flat(price_cell), "area_cell": area_txt,
                    "district_cell": _flat(tags_cell), "title_cell": _flat(title_cell)},
    }


# ── detail page ─────────────────────────────────────────────────────────────────────────────────
def parse_detail(page: Optional[str], nid: str) -> dict:
    """{title, blocks, description, photo_urls, label, advertiser} from /{nid}. {} if unusable."""
    if not page:
        return {}
    art = _ARTICLE.search(page)
    if not art or art.group(1) != nid:
        return {}
    body = art.group(0)

    starts = list(_BLOCK.finditer(body))
    blocks: list[tuple[str, str]] = []
    for i, m in enumerate(starts):
        end = starts[i + 1].start() if i + 1 < len(starts) else len(body)
        chunk = body[m.end():end]
        stop = _BLOCK_END.search(chunk)
        if stop:
            chunk = chunk[:stop.start()]
        blocks.append((m.group(1), re.sub(r"[ \t]+", " ", _text(chunk)).strip()))

    # The basis label is the block immediately BEFORE the content="…" amount block («المتر» then
    # «850 ريال»), which is how a per-metre listing states its basis on the detail page.
    label = None
    for i, (attrs, txt) in enumerate(blocks):
        if _CONTENT_ATTR.search(attrs) and i:
            prev = re.sub(r"\s+", " ", re.sub(r"[^؀-ۿ\s]", "", blocks[i - 1][1])).strip()
            if any(prev == lab for lab, _, _ in PRICE_LABELS):
                label = prev
            break
    if label is None:
        for i, (_, txt) in enumerate(blocks[:-1]):
            t = re.sub(r"\s+", " ", re.sub(r"[^؀-ۿ\s]", "", txt)).strip()
            if any(t == lab for lab, b, _ in PRICE_LABELS if b == "per_sqm") and \
                    N.to_int(blocks[i + 1][1]) is not None:
                label = t
                break

    # ONLY a.lightbox inside the node article. That excludes both non-photos by construction: the
    # reused per-district «مخطط» banner (a separate views block) and the .mp4 walkthrough.
    photos = [u for u in _LIGHTBOX.findall(body) if re.search(r"\.(jpe?g|png|webp)(\?|$)", u, re.I)]
    photos = [u if u.startswith("http") else BASE + u for u in dict.fromkeys(photos)]

    # The detail page's fact blocks and its prose share one CSS class, so the description has to be
    # the prose MINUS every block that is already a structured column. Without this filter nid
    # 5263 — whose only two blocks are «السعر» and «14,000 ريال» — got the literal string «السعر»
    # as its description, and the room list the INDEX publishes for it was thrown away.
    prose = [txt for attrs, txt in blocks
             if txt and not _CONTENT_ATTR.search(attrs)
             and not _STRUCTURED_BLOCK.match(txt)
             and not _AMOUNT_ONLY.match(txt)]
    name = _SCHEMA_NAME.search(body) or _OG_TITLE.search(page)
    title = re.sub(r"\s+", " ", html_mod.unescape(name.group(1))).strip() if name else None
    if title:
        title = re.sub(r"\s*\|\s*مكتب الجاسم.*$", "", title).strip() or None
    age_raw = None
    for _, txt in blocks:
        m = _AGE_BLOCK.match(txt.strip())
        if m:
            age_raw = m.group(1).strip()
            break
    adv = _ADVERTISER.search(page)
    return {
        "title": title,
        "blocks": [t for _, t in blocks],
        "description": _clean("\n".join(prose)),
        "photo_urls": photos,
        "label": label,
        "age_raw": age_raw,
        "advertiser": adv.group(1).translate(N._TRANS) if adv else None,
    }


# ── mapping ─────────────────────────────────────────────────────────────────────────────────────
def _deal(title_text: str) -> Optional[str]:
    if "يجار" in title_text:            # للايجار / للإيجار
        return "Rent"
    if "بيع" in title_text:             # للبيع
        return "Buy"
    return None                          # 2 of 90 state neither → deal UNKNOWN, never defaulted


def _property_type(title_lines: list[str]) -> tuple[Optional[str], Optional[str]]:
    """(canonical type, the source's own type wording). The title cell is «TYPE…\\nDEAL», where TYPE
    may carry a qualifier the shared map has no key for — «عمارة سكني - تجاري», «استراحة وقف»,
    «مجموعه استراحات». Exact match on the whole phrase first, then on each token in order: that
    reaches the real type without the substring pass, which could match a short key (e.g. «دور»)
    inside an unrelated word.
    """
    words = [w for ln in title_lines for w in ln.split()
             if "بيع" not in w and "يجار" not in w and not _DATE.match(w)]
    raw = " ".join(words) or None
    if not raw:
        return None, None
    t = N.map_type_exact(raw, TYPE_OVERRIDES)
    if not t:
        for w in words:
            t = N.map_type_exact(w, TYPE_OVERRIDES)
            if t:
                break
    return t, raw


_FIGURE = re.compile(r"\d[\d,٬.]*")
_PERIOD_WINDOW = 40

# PERIOD SPELLING FOLD — the reason rent_period is not 0/88, and a 12x error avoided.
# The handoff brief said "No rent period stated anywhere -> NULL". MEASURED FALSE on nid 5208,
# whose body reads «ايجاره بالشهر 1800 ريال شامل الكهرباء والماء» — 1,800 **A MONTH**, adjacent to
# the exact figure the price cell carries. The shared closed vocabulary in
# normalize.rent_period_and_annual knows «شهري/شهرياً» and «سنوي/سنوياً» but not the prepositional
# «بالشهر» / «في الشهر», so that stated period came back None and the row would have shipped 1,800
# as a YEAR's rent — the 12x card error the PERIOD=SOURCE rule exists to prevent.
# This folds the source's own spelling onto the token the shared map already knows and nothing more:
# the DECISION still belongs to the shared function's closed vocabulary (same contract as
# TYPE_OVERRIDES). It invents no period — a body with no period phrase at all is untouched, and the
# adjacency requirement in _period_text still gates which text is even eligible.
# Verified over all 88 rows: 1 rent row states a period (5208, monthly); the other three bodies
# containing a period word are SALE rows talking about their tenants' leases («كراج مؤجر ب ٢٠٠٠ في
# السنه» on nid 5025) and are excluded by adjacency, because 2,000 is not this listing's 700,000.
_PERIOD_FOLD = (
    (re.compile(r"(?:ب|في)\s*ال?شهر(?:ي)?\b|/\s*شهر|كل\s*شهر|شهريا?ً?"), " شهري "),
    (re.compile(r"(?:ب|في)\s*ال?سن[ةه]\b|/\s*سن[ةه]|كل\s*سن[ةه]|سنويا?ً?"), " سنوي "),
)


def _fold_period_words(text: str) -> str:
    for rx, token in _PERIOD_FOLD:
        text = rx.sub(token, text)
    return text


def _period_text(amount: Optional[int], blocks: list[str]) -> str:
    """The body text stating something ABOUT this exact figure — the only body text allowed to set a
    period (abralosol's adjacency rule). Empty when the source never names the amount."""
    if amount is None:
        return ""
    out = []
    for block in blocks or []:
        for m in _FIGURE.finditer(block.translate(N._TRANS)):
            if N.to_int(m.group(0)) == amount:
                out.append(block[max(0, m.start() - _PERIOD_WINDOW):m.end() + _PERIOD_WINDOW])
    return " ".join(out)


def map_listing(ix: dict, detail: dict) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason). row is None exactly when skip_reason is set."""
    title_text = " ".join(ix["title_lines"])
    # STATUS SCOPE: title + price cell + detail body. The two live sale ads the first version dropped
    # were «مؤجر» (tenants), which _GONE no longer matches; with it out, a body-wide scan is 0 false
    # positives on the real pages — and an office writing «تم البيع» in the body is still caught.
    status_text = " ".join([title_text, detail.get("title") or "", ix["price"]["raw"] or "",
                            *(detail.get("blocks") or [])])
    if _AUCTION.search(status_text):
        return None, "residential", "auction"
    if _GONE.search(status_text):
        return None, "residential", "sold_or_rented"

    property_type, type_raw = _property_type(ix["title_lines"])
    if not property_type:
        return None, "residential", "type_unmapped"
    category = N.category_for_type(property_type).lower()

    deal_token = _deal(title_text) or _deal(detail.get("title") or "")
    if not deal_token:
        return None, category, "no_deal"
    # Written as a total expression so the null-deal AST guard can prove it is Buy/Rent: a NULL
    # transaction_type is quarantined out of search entirely.
    transaction_type = "Rent" if deal_token == "Rent" else "Buy"

    # CITY is derived, not published — see OFFICE_CITY_AR. to_catalog() decides what is a real city.
    city_id, region_id = to_catalog(OFFICE_CITY_AR, OFFICE_REGION_HINT)
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_raw = (ix["district"] or "").strip() or None
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None

    p = ix["price"]
    basis, basis_from = p["basis"], ("index_label" if p["basis"] else None)
    if basis is None and detail.get("label"):
        for label, b, kind in PRICE_LABELS:
            if detail["label"] == label:
                basis, basis_from = b, "detail_label"
                p = {**p, "label": label, "basis": b, "kind": kind}
                break
    amount = p["amount"]

    price_total = price_per_meter = price_annual = rent_period = None
    if amount is not None and basis == "per_sqm":
        # PRICE = SOURCE: a per-m² rate is not a total, and area is never multiplied here. The
        # database's price_total_effective() derives the searchable total from these two columns.
        price_per_meter = amount
    elif transaction_type == "Rent" and basis == "total":
        # PERIOD = SOURCE. No token → NULL period; the office's own figure still ships (see the
        # docstring's divergence note).
        rent_period, annual = N.rent_period_and_annual(
            amount, _fold_period_words(
                f"{p['label'] or ''} {_period_text(amount, detail.get('blocks') or [])}"))
        # No token → the helper already returns the figure unchanged. (None, None) means a period
        # WAS stated that has no annual bucket (يومي/أسبوعي/نصف سنوي) — never park it as a year's rent.
        price_annual = annual
    elif amount is not None and basis == "total":
        price_total = amount
    # An amount with NO basis label anywhere stays NULL in every price column: the source published
    # a number but not what it means, and a total is a different fact from a rate.

    area_m2 = N.to_int(ix["area_raw"])
    bedrooms, bathrooms = parse_rooms(ix["rooms_text"], property_type)

    photos = list(detail.get("photo_urls") or [])
    if not photos and ix["thumb"]:
        thumb = re.sub(r"/styles/[^/]+/public/", "/", ix["thumb"]).split("?")[0]
        if re.search(r"\.(jpe?g|png|webp)$", thumb, re.I):
            photos = [thumb if thumb.startswith("http") else BASE + thumb]

    # The description is every piece of prose the office publishes about the unit: the index's room
    # field (minus its «المساحة N م» prefix, which is the area column) plus the detail page's
    # narrative. Both, not either — the index states the room list for listings whose detail page
    # carries nothing but the price, and the detail page states the narrative for listings whose
    # index cell is bare. amenities_from_text then reads it tri-state: named→True, negated→False,
    # «مصعد مؤسس» (prepared) and «قريب من حديقة» (the neighbourhood's)→NULL, silence→NULL.
    pieces = [_INDEX_FIELDS.sub(" ", ix["rooms_text"] or "").strip(),
              detail.get("description") or ""]
    description = _clean(" ".join(dict.fromkeys(p for p in pieces if p))) or None

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{ix['nid']}",
        "listing_url": f"{BASE}/{ix['nid']}",
        "source": SOURCE,
        "active": True,
        "title": _clean(detail.get("title") or title_text) or None,
        "description": description,
        **N.amenities_from_text(description),
        "property_type": property_type,
        "transaction_type": transaction_type,
        "city": N.map_city(OFFICE_CITY_AR),
        "city_ar": OFFICE_CITY_AR,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": area_m2,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        # Only from the «العمر» fact block, through the shared closed vocabulary; silent → NULL.
        "property_age": N.exact_age(detail.get("age_raw")),
        # Land (44% of stock) is asked ONLY street_width + direction. «شارع 15» → 15; «15*15»,
        # «12.5 / 21.5» (two streets) and «27.50» (a fraction the int column would truncate) → NULL.
        "street_width_m": N.one_street_width(ix["street_width"]),
        "direction": N.one_direction(ix.get("street_facade")),
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": price_per_meter,
        "rent_period": rent_period,
        # A detail fetch that FAILED is not the source saying "no photos" — None lets db's
        # unknown-must-not-overwrite-known guard drop the key so a stored list survives.
        "photo_urls": (photos[:20] or None) if (detail or photos) else None,
        "additional_info": redact_capture({k: v for k, v in {
            "price_label": p["label"],
            "price_basis": basis,
            "price_basis_from": basis_from,
            "price_kind": p["kind"],
            "price_amount_raw": amount,
            "area_raw": ix["area_raw"],          # area_m2 is an integer column; «423.61» survives here
            "street_width": ix["street_width"],
            "plot": ix["plot"],
            "maps_url": ix["maps_url"],
            "type_raw": type_raw,
            "property_age_raw": detail.get("age_raw"),
            "bump_date": ix["bump_date"],        # a REFRESH date, not created_at
            "city_basis": "office_default",      # DERIVED from the office footer — never a source field
            "city_footer_raw": OFFICE_CITY_FOOTER,   # what the office actually publishes, verbatim
            "office_advertiser_number": detail.get("advertiser"),  # office-wide, NOT a per-ad number
            "rooms_text": ix["rooms_text"] or None,
        }.items() if v is not None}),
        "source_capture": redact_capture({
            "nid": ix["nid"], "index": ix["capture"], "title_lines": ix["title_lines"],
            "thumb": ix["thumb"], "detail_blocks": detail.get("blocks") or [],
            "detail_photos": detail.get("photo_urls") or [],
        }),
    }
    return row, category, ""


# ── crawl ───────────────────────────────────────────────────────────────────────────────────────
def crawl(limit: int = 0, want_detail: bool = True) -> tuple[list[dict], list[dict], int, dict]:
    s = session()
    res: list[dict] = []
    com: list[dict] = []
    skips: dict[str, int] = {}
    stats = {"rows": 0, "seen": 0, "no_price": 0, "per_sqm": 0, "unlabelled_price": 0,
             "detail_failed": 0, "skips": skips}

    page = _get(s, f"{BASE}/")
    recs = index_rows(page or "")
    if not recs:
        raise RuntimeError("index table returned no Views rows (challenge unsolved or theme changed)")
    stats["seen"] = len(recs)
    for rec in recs:
        ix = parse_index(rec)
        detail: dict = {}
        if want_detail:
            detail = parse_detail(_get(s, f"{BASE}/{ix['nid']}"), ix["nid"])
            if not detail:
                stats["detail_failed"] += 1
            time.sleep(DETAIL_PAUSE)
        row, category, why = map_listing(ix, detail)
        if not row:
            skips[why] = skips.get(why, 0) + 1
            continue
        if row["price_total"] is None and row["price_annual"] is None and row["price_per_meter"] is None:
            stats["no_price"] += 1
        if row["price_per_meter"] is not None:
            stats["per_sqm"] += 1
        if ix["price"]["amount"] is not None and not row["additional_info"].get("price_basis"):
            stats["unlabelled_price"] += 1
        (com if category == "commercial" else res).append(row)
        stats["rows"] += 1
        if limit and stats["rows"] >= limit:
            break
    return res, com, stats["seen"], stats


def _notes(stats: dict, pruned: int = 0) -> str:
    """Rule 5: an empty run must say WHY in the database, by reason."""
    skips = ", ".join(f"{k}={v}" for k, v in sorted(stats["skips"].items(), key=lambda x: -x[1]))
    return (f"seen={stats['seen']} rows={stats['rows']} no_price={stats['no_price']} "
            f"per_sqm={stats['per_sqm']} unlabelled={stats['unlabelled_price']} "
            f"detail_failed={stats['detail_failed']} pruned={pruned} skips[{skips}]")[:300]


# ── LIVENESS ────────────────────────────────────────────────────────────────────────────────────
# Absence from the index only SELECTS candidates; prune_unseen asks this oracle before it may
# deactivate anything, through the shared law (scrapers/common/http_liveness.py), so a 403/429/5xx,
# a timeout or an empty body can never read as a death — which matters doubly here, because this
# site's hcdn challenge IS a 403 (a 6,192-byte interstitial). The probe session clears it first.
#
# MEASURED 2026-09-21 with the whole index in hand: the office DELETES a node — 2,468 nids inside
# the live range (2706-5263) are not in the catalogue, and 31 of 31 sampled (plus /99999999)
# answered HTTP 404, the themed 13.7 KB Drupal 404 with no node on it. 12 of 12 interleaved live
# nids answered 200 and passed parse_detail's own proof (the article's data-history-node-id names
# this nid). A themed 404 is still a parseable page, so the STATUS decides a death and
# parse_detail's proof decides a life.
# An ad closed IN PLACE is GONE too, judged by the crawl's OWN _AUCTION/_GONE patterns over the
# node's own title and blocks — without that limb a still-served «تم البيع» page would read as
# alive and self-heal a row the crawl refuses to publish.
def _probe_session() -> cc.Session:
    s = session()
    _solve_challenge(s, f"{BASE}/")
    return s


def _signal_for(nid: str):
    def _signal(status, body, _moved):
        if status == 404:
            return "gone"
        if status == 200:
            d = parse_detail(body, nid)
            if d:
                own = " ".join([d.get("title") or "", *(d.get("blocks") or [])])
                return "gone" if (_AUCTION.search(own) or _GONE.search(own)) else "live"
        return None
    return _signal


def _verify_gone(ad_number: str) -> tuple[str, str]:
    nid = ad_number[len(PREFIX):]
    if not nid.isdigit():
        return "unknown", f"{ad_number!r} is not a {PREFIX}<nid> ad number"
    return LivenessProbe(platform=PLATFORM, signal=_signal_for(nid), session=_probe_session,
                         url_for=lambda _ad: f"{BASE}/{nid}").verify_gone(ad_number)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0, help="only the first N parsed listings, NO prune")
    ap.add_argument("--dry-run", action="store_true", help="print rows as JSON, write NOTHING")
    args = ap.parse_args()

    def split(res: list[dict], com: list[dict]) -> tuple[list[dict], list[dict]]:
        if args.type == "all":
            return res, com
        return ([], com) if args.type == "commercial" else (res, [])

    if args.dry_run:
        res, com, seen, stats = crawl(limit=args.limit)
        res, com = split(res, com)
        print(json.dumps(res + com, ensure_ascii=False, indent=1))
        print(f"— DRY RUN (no DB writes): {len(res)} residential + {len(com)} commercial — "
              f"{_notes(stats)}", file=sys.stderr)
        return 0

    run_id = None if args.limit else db.begin_run(PLATFORM)
    seen = 0
    try:
        res, com, seen, stats = crawl(limit=args.limit)
        res, com = split(res, com)
        if res:
            db.upsert_aljassim_residential_batch(res)
        if com:
            db.upsert_aljassim_commercial_batch(com)
        if args.limit:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"upserted (no prune) — {_notes(stats)}")
            return 0

        superseded = db.retire_superseded_siblings(
            res_table="aljassim_residential_listings", com_table="aljassim_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        for tbl, rows_seen in ((f"{PLATFORM}_residential_listings", res),
                               (f"{PLATFORM}_commercial_listings", com)):
            nn = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source=SOURCE,
                                 verify_gone=_verify_gone)
            if nn < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += nn
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             notes=_notes(stats, pruned),
                             check_tables=["aljassim_residential_listings",
                                           "aljassim_commercial_listings"])
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted, "
              f"{pruned} stale pruned — {_notes(stats, pruned)}")
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard.", flush=True)
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {SOURCE}: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
