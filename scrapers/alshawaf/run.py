"""مكتب الشواف العقاري (alshawaf.com.sa) — a single-office Al-Ahsa brokerage on Drupal 10.

WHAT THE SITE IS (probed live 2026-09-20 before any code was written). One Drupal 10 site for one
office. Its own footer prints the catalogue size — «عدد العقارات 987» — and the SAME 987 nodes are
served three ways: `/` and `/grid` as cards, `/table` as a Drupal Views TABLE. This scraper reads
`/table?page=N` (0-indexed, 38 rows/page, 26 pages) because every cell there carries a Views
`headers` machine name, so selectors key off NAMES and never column positions:

    view-changed-table-column      → title link (/{nid}), type + تصنيف + deal, thumbnail, bump date
    view-field-tags-table-column   → district TERM on its own line, then «رقم N», «/ ح», «بلك N»
    view-nothing-3-table-column    → المساحة / شارع / العمر / الأطوال
    view-nothing-1-table-column    → price LABEL + amount, then a <br> and a VIEW COUNTER

Detail page = /{nid} (bare numeric path). Its own facts are a `<th>label</th><td>value</td>` table
inside `#block-edux-views-block-duplicate-of-node-block-1`, and the labels are the source's own:
التاريخ · العقار · الحي · المساحة · شارع عرض · الواجهة والإتجاه · الحدود والأطوال · العمر ·
الغرف · الدور · التركيز · وصف العقار · سعر البيع | سعر السوم | السوم | سعر المتر | سعر الإيجار ·
الموقع (a google.com/maps/place/LAT,LNG link). Enumerated live: 987 unique nids, 26 pages, zero
duplicates, and the index total the site prints itself.

── THE FOUR TRAPS THIS FILE EXISTS TO NOT FALL INTO ───────────────────────────────────────────────
1. A DETAIL PAGE CARRIES MORE THAN ONE LISTING. After the node's own block the page renders a
   «related listings» Views table (`…duplicate-of-frontpage-block-1`) with other properties' areas,
   districts, prices and THUMBNAILS — on /22273 (المساحة 395) the next figures on the page are 600 /
   252 / 550 and the only <img> under /sites/default/files/ belongs to node 21635. Parsing "the page"
   mixes two properties into one row. So `_detail()` reads ONLY the node block, and it PROVES the
   block is this listing before returning anything: that block's own التاريخ row carries
   `wa.me/?text=https://alshawaf.com.sa/<nid>`, and unless that nid equals the one we asked for the
   detail is discarded (not silently mis-attributed). The photo gallery is read from the node's own
   `#block-edux-views-block-view-block-1`, bounded to that block — never a page-wide <img> scan.
2. THE PRICE CELL ENDS IN A VIEW COUNTER. «البيع\n1,400,000<br><i class=fa-eye> 1,251</i>…» — the
   trailing integer is a page-view count that parses as a perfectly plausible price (1,251 SAR, or
   worse, as the SECOND number in a cell whose real price is absent). The cut happens BEFORE any
   digit is read, not after.
3. 21% OF THE CATALOGUE IS PRICED PER SQUARE METRE. Measured over all 987 rows: البيع 415 · المتر
   210 · السوم 161 · «على السوم» 157 (an invitation to bid, NO figure) · no label at all 23 ·
   الإيجار 21. The basis is published ONLY as that Arabic label, so the LABEL decides the column:
   المتر/سعر المتر → `price_per_meter`, البيع/السوم/الإيجار → total, and area is NEVER multiplied
   into a total here (deriving a searchable total from ppm × area is the SEARCH/DISPLAY layer's job —
   `price_total_effective` + `derivedTotalFromPerMeter`; scripts/verify-ppm-searchable-and-filter-safe
   .ts bans that derivation inside scrapers/, where `price_total` keeps meaning "the SOURCE said
   this"). A 1,550 figure on a 550 m² plot is a RATE, not a 1,550 SAR plot.
3b. A TOTAL-LABELLED FIGURE IS STORED AS A TOTAL, AT ANY SIZE. 28 «السوم»/«البيع» sale rows carry
   800–4,000 against 250–1,338 m² (20281: «سعر السوم 1,850» on 487.5 m²). The page states no unit,
   so the card shows 1,850 exactly as the site does — choosing «per metre» by a size threshold is
   the scraper inventing a basis, and the ppm × area total it produces is a number the site never
   showed (owner rule 2026-08-03: no plausibility judgement on a source price, high or low).
4. THE SITE NEVER STATES A RENT PERIOD. Measured across every one of the 987 index rows and 45
   detail pages: the strings شهري / سنوي / يومي appear ZERO times, and the rent label is a bare «سعر
   الإيجار». So `rent_period` stays NULL — unknown, never defaulted — while the figure itself is
   stored unconverted in `price_annual` (the wslnaa contract). A manufactured «سنوي» would be a 12×
   error on 25 cards.

── CITY (derived, and labelled as derived) ────────────────────────────────────────────────────────
The source publishes NO city on any listing — only a district term from its own 243-term taxonomy,
and that taxonomy is Al-Ahsa end to end (الهفوف، المبرز، البطالية، الجفر، ضاحية هجر، العيون…). Three
steps, each one evidence, never a guess, and the step that fired is recorded in
`additional_info["city_basis"]` so nothing downstream can mistake it for a source field:
  a) `source_states_town` — the term itself names its town after a comma («الامراء ، المبرز»,
     «الرابية ، العيون», «النخيل ، الحليلة»). to_catalog() must confirm that town, with the Eastern
     Province as the region hint: الهفوف is a same-name twin (catalog city 12 in region 5 AND 501 in
     region 1) and to_catalog REFUSES to guess between twins without a hint. «جنوب الهفوف» / «خلف
     سكيكو» / «جنوب منسوب» fail this step closed, which is correct — they are not towns.
  b) `district_unique_to_town` — the district term is an EXACT, catalog-attested district of exactly
     ONE Al-Ahsa town (via find_district_in_text, the same city-scoped loc_catalog_district match
     resolve() trusts). Two or more towns claim it → ambiguous → fall through. This is inference
     FILLING a gap the source left, never overruling it: step (a) runs first and wins.
  c) `governorate_fallback` — «الاحساء», the governorate-level catalog city (owner instruction
     2026-09-13, the identical honest-broad-but-true fallback amlakalahsa uses for districts whose
     finer town cannot be proven). Never a specific town by office default.
`district_ar` is the CATALOG's canonical spelling (match truth); `neighborhood` keeps the source's
own text including its plot reference, per the standing district_ar=match / neighborhood=source rule.

    python -m scrapers.alshawaf.run --dry-run --limit 15     # validate, zero DB writes
    python -m scrapers.alshawaf.run --limit 60               # upsert 60, no prune
    python -m scrapers.alshawaf.run --type all               # full crawl + prune
"""
from __future__ import annotations

import argparse
import html as html_mod
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize as N  # noqa: E402
from scrapers.common.arabic_location import (  # noqa: E402
    find_district_in_text, norm_district_tok, to_catalog,
)
from scrapers.common.pii import redact_capture, redact_pii  # noqa: E402

BASE = "https://alshawaf.com.sa"
# The DB `source` string is also what the app's SourceBadge/sourceHost matcher greps for a platform
# slug (it tests `source.toLowerCase()` and a space-stripped copy against 'alshawaf'). An Arabic-only
# label would match NO branch and fall through to the Aqar fallback — Aqar's name, Aqar's logo and a
# click-through to another company's site on 987 listings (the 2026-09-04 defect, 3,165 rows). The
# office's own Arabic name «مكتب الشواف العقاري» belongs in platform_registry, not here.
SOURCE = "Al Shawaf"
PLATFORM = "alshawaf"
PREFIX = "SHW"

MAX_PAGES = 60          # safety stop; the catalogue is 26 pages
PAGE_PAUSE = 0.4
DETAIL_PAUSE = 0.3     # the site answers in ~0.3s and rate-limits nothing observed

# Catalog city ids for the Al-Ahsa governorate's towns, region 5 (Eastern Province) — the same fixed
# catalog facts amlakalahsa pins. Used ONLY to ask find_district_in_text() which town a district
# belongs to; a term claimed by two of them is ambiguous and resolves to no town at all.
EASTERN_PROVINCE_REGION_ID = 5
AHSA_TOWNS: tuple[tuple[int, str], ...] = (
    (12, "الهفوف"), (2748, "المبرز"), (2764, "الجفر"), (2038, "العيون"),
    (2653, "العمران"), (2762, "الحليلة"), (2750, "المطيرفي"), (2746, "الجشة"), (2763, "الطرف"),
)
GOVERNORATE_CITY_AR = "الاحساء"     # catalog city 3677, region 5 — the broad-but-true fallback

# Per-platform EXACT type overrides. Every value is an EXISTING canonical type — this maps the
# office's own vocabulary onto the shared taxonomy, it never invents a type. Counts are live
# measurements over all 987 rows (2026-09-20).
TYPE_OVERRIDES = {
    "نص أرض": "Residential Land",   # 162 — half of a plot; land either way (refined by تصنيف below)
    "شقة عوائل": "Apartment",       # 15 — a family apartment; «عوائل» is the tenant category
    "شقة عزاب": "Apartment",        # 0 live today, in the site's own type list
    "شقة مكتبية": "Apartment",      # 2 — the site itself files this under «شقق» in its own nav
    "منزل بيت": "Villa",            # 67 — بيت/منزل both → Villa in the shared map (House folded 07-20)
    "بيت دور": "Villa",             # 2
    "بيت دور وشقق": "Villa",        # 15
    "بيت من شقق": "Villa",          # 1
    "فيلا وشقق": "Villa",           # 12
    "دبلكس": "Duplex",              # 29 — this office spells it دبلكس; shared map has دوبلكس
    "دبلكس فيلا": "Duplex",         # 1
    "دبلكس وشقة": "Duplex",         # 2
}

# label → (basis, kind). LONGEST FIRST: «سعر المتر» must never match as «المتر»-after-«سعر», and
# «سعر الإيجار» must never be read as the total-basis «الإيجار» with a stray «سعر». Verbatim labels,
# index and detail page both.
PRICE_LABELS: tuple[tuple[str, str, str], ...] = (
    ("سعر المتر", "per_sqm", "asking"),
    ("سعر البيع", "total", "asking"),
    ("سعر السوم", "total", "offer"),
    ("سعر الإيجار", "total", "asking"),
    ("على السوم", "total", "offer"),
    ("المتر", "per_sqm", "asking"),
    ("البيع", "total", "asking"),
    ("السوم", "total", "offer"),
    ("الإيجار", "total", "asking"),
)

# The office's shared "no photo yet" logo. 515 of 987 index rows carry ONLY this. It is not a photo.
PLACEHOLDER_IMG = "logos.png"

_TBODY = re.compile(r"<tbody[^>]*>(.*?)</tbody>", re.S)
_TR = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
_TD = re.compile(r'<td[^>]*headers="([^"]+)"[^>]*>(.*?)</td>', re.S)
_NID = re.compile(r'href="/(?:index\.php/)?(\d+)"')
_TITLE_A = re.compile(r'<a href="/(?:index\.php/)?\d+">(.*?)</a>', re.S)
_IMG = re.compile(r'<img[^>]*src="([^"]+)"')
_DATE = re.compile(r'<time datetime="([\d-]{10})')
_AREA = re.compile(r"المساحة\s*([\d,٠-٩.]+)\s*م")
_AGE = re.compile(r"العمر\s*([^\n]+)")
_STREET = re.compile(r"شارع\s*([^\n]+)")
_DIMS = re.compile(r"الأطوال\s*([^\n]+)")
_NODE_BLOCK = re.compile(
    r'id="block-edux-views-block-duplicate-of-node-block-1".*?<table>(.*?)</table>', re.S)
_GALLERY_BLOCK = re.compile(
    r'id="block-edux-views-block-view-block-1"(.*?)(?=<div class="views-element-container block")',
    re.S)
_FIELD_ROW = re.compile(r"<tr>\s*<th>(.*?)</th>\s*<td>(.*?)</td>", re.S)
_WA_NID = re.compile(r"wa\.me/\?text=https://alshawaf\.com\.sa/(\d+)")
_ARTICLE_NID = re.compile(r'<article[^>]*data-history-node-id="(\d+)"')
_FILE_IMG = re.compile(r'<img[^>]*src="([^"]*/sites/default/files/[^"]+)"')
_LATLNG = re.compile(r"maps/place/(-?[\d.]+),(-?[\d.]+)")
_ONE_NUMBER = re.compile(r"^\s*([\d,٠-٩.]+)\s*م?\s*$")
# Facade tokens → the canonical short form the DB's canon_direction_ar() keeps. That function folds
# «شمالية»/«شمالي» → «شمال» but NOT the ه-final spelling this office actually writes in its index
# cells («شماليه», «شرقيه», «جنوبيه») — an unfolded token canonicalizes to NULL downstream, so the
# fold happens here and the stored value is always one of the four canonical words.
_DIRECTION_CANON = {
    "شمال": "شمال", "شمالي": "شمال", "شمالية": "شمال", "شماليه": "شمال",
    "جنوب": "جنوب", "جنوبي": "جنوب", "جنوبية": "جنوب", "جنوبيه": "جنوب",
    "شرق": "شرق", "شرقي": "شرق", "شرقية": "شرق", "شرقيه": "شرق",
    "غرب": "غرب", "غربي": "غرب", "غربية": "غرب", "غربيه": "غرب",
}
_DIRECTIONS = tuple(_DIRECTION_CANON)

# Arabic WORD numerals. The site writes room and floor counts as words («ثلاث غرف نوم», «غرفتين»,
# «الدور الثاني») as often as digits, and a parser that only reads digits silently drops them
# (Arabic-notation parity is required of every deterministic parser in this repo — ٠-٩ AND words).
# Folding them to digits lets the SHARED, already-tested normalize.rooms_from_phrase() do the actual
# reading instead of a second private bedroom regex.
_WORD_NUM: tuple[tuple[str, str], ...] = (
    ("غرفتين", "2 غرف"), ("غرفتان", "2 غرف"), ("دورتين", "2 دورات"), ("دورتان", "2 دورات"),
    ("احدى عشر", "11"), ("أحد عشر", "11"), ("اثنى عشر", "12"), ("اربعة عشر", "14"),
    ("واحدة", "1"), ("واحده", "1"), ("اثنتين", "2"), ("ثلاثة", "3"), ("ثلاث", "3"),
    ("أربعة", "4"), ("اربعة", "4"), ("أربع", "4"), ("اربع", "4"), ("خمسة", "5"), ("خمس", "5"),
    ("ستة", "6"), ("ست ", "6 "), ("سبعة", "7"), ("سبع", "7"), ("ثمانية", "8"), ("ثماني", "8"),
    ("ثمان", "8"), ("تسعة", "9"), ("تسع", "9"), ("عشرة", "10"), ("عشر", "10"),
)
_ORDINAL_FLOOR: tuple[tuple[str, int], ...] = (
    ("ارضي", 0), ("أرضي", 0), ("الاول", 1), ("الأول", 1), ("الثاني", 2), ("الثالث", 3),
    ("الرابع", 4), ("الخامس", 5), ("السادس", 6), ("السابع", 7), ("الثامن", 8), ("التاسع", 9),
    ("العاشر", 10),
)
_BATH = re.compile(r"([\d٠-٩]{1,2})\s*دور(?:ات|ة|ه)\s*مياه")
_BATH_ONE = re.compile(r"(?<![\d٠-٩]\s)دور(?:ة|ه)\s*مياه")
# A description that itemises MULTIPLE units («كل شقة تتكون من غرفتين», «اربع شقق», «25 سويت») is
# describing the units, not this listing — its first room phrase is one flat's layout, not the
# property's. Same class as wslnaa's rooms≠bedrooms on a building. Rooms stay NULL there.
_MULTI_UNIT = re.compile(r"كل\s*شق|شقق|سويت|فتحات|فتحتين|وحدات|أدوار|ادوار|عمارة|مستودعات")
# Types whose room count is genuinely THIS unit's bedroom count.
_SINGLE_DWELLING = {"Apartment", "Villa", "Duplex", "Floor", "Studio", "Room"}

# The office's own contact sign-off, cut before the shared PDPL redactor runs (same cut-list shape as
# abralosol/october). «الموقع -» is a LOCATION lead-in, not a contact CTA, and is deliberately absent.
_CUT = re.compile(r"(للتواصل|للاستفسار|للإستفسار|للحجز|اتصل|تواصل|واتساب|واتس|جوال|الجوال|"
                  r"المعلن|الوسيط|المسوق|للمهتمين|أرقامنا|ارقامنا|📞|☎|📱|whatsapp|call us)", re.I)


# ── text helpers ────────────────────────────────────────────────────────────────────────────────
def _text(fragment: str) -> str:
    t = re.sub(r"<br\s*/?>", "\n", fragment or "")
    t = re.sub(r"</p>|</div>", "\n", t)
    t = re.sub(r"<[^>]+>", "\n", t)
    return html_mod.unescape(t)


def _lines(fragment: str) -> list[str]:
    return [ln.strip() for ln in _text(fragment).split("\n") if ln.strip()]


def _flat(fragment: str) -> str:
    return re.sub(r"\s+", " ", _text(fragment)).strip()


def _clean(text: Optional[str]) -> Optional[str]:
    """User-visible text: cut the contact CTA, then run the shared PDPL redactor."""
    if not text:
        return None
    m = _CUT.search(text)
    if m:
        text = text[:m.start()]
    return redact_pii(re.sub(r"\s+", " ", text).strip()) or None


def _digits(text: Optional[str]) -> str:
    """Fold Arabic word numerals to digits so the shared room parser can read them."""
    t = re.sub(r"\s+", " ", str(text or ""))
    for word, num in _WORD_NUM:
        t = t.replace(word, num)
    return t


# ── the amenity text (NOT the stored description) ───────────────────────────────────────────────
# «اصانصير» / «اسانسير» is the Saudi colloquial word for a lift. amenities_from_text's vocabulary has
# مصعد/elevator/lift only, so every one of this office's own lift statements was invisible — measured
# 3 in 150 live descriptions (~20 of 987), and TWO of them are «بدون اصانصير», the source stating
# there is NO lift. Aliasing it to the word the shared vocabulary knows turns those into the False
# they are (the negator sits before the token either way) and «ومصعد» into True.
_AMENITY_ALIAS = (("اصانصير", "مصعد"), ("اسانسير", "مصعد"), ("أصانصير", "مصعد"))
# …and the PREPARED-ONLY case, which this site writes the other way round. «مصعد مؤسس» — the shaft is
# prepared, there is no lift — is suppressed by amenities_from_text by looking AFTER the token; this
# office writes «تم تاسيس مصعد في حال الرغبة في التركيب» (SHW22179, a villa) and «مؤسس ل اصانصير»
# (SHW20788), i.e. the marker comes BEFORE. Unhandled, those publish a lift the property does not
# have. Dropping the noun that follows a prepared marker leaves the source SILENT on it — NULL, which
# is the honest outcome: not a yes, not a no. It can never manufacture a False.
_PREPARED_BEFORE = re.compile(r"(مؤسس(?:ة|ه)?|تاسيس|تأسيس|مهيأ|مهيا)\s*(?:ل\s*)?\S+")


def _amenity_text(description: Optional[str]) -> Optional[str]:
    """The description as the AMENITY reader should see it. The stored `description` stays verbatim —
    this copy exists only so the shared tri-state reader sees this office's own wording."""
    if not description:
        return description
    t = description
    for local, shared in _AMENITY_ALIAS:
        t = t.replace(local, shared)
    return _PREPARED_BEFORE.sub(lambda m: m.group(1), t)


def session() -> cc.Session:
    # impersonate OWNS the User-Agent — setting one contradicts the TLS fingerprint and reads
    # exactly like a block (rakez, 403 on every endpoint). Only Accept-Language is added.
    s = cc.Session(impersonate="chrome", timeout=40)
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


def _upsert(table: str, rows: list[dict]) -> None:
    """Batch upsert through the shared writer.

    `db.upsert_alshawaf_{residential,commercial}_batch` do not exist yet — the platform's tables,
    registry row and those two one-line wrappers are added centrally, and this onboarding pass is
    explicitly not allowed to touch scrapers/common/db.py. So the named wrapper is PREFERRED the
    moment it appears, and until then the same `db._wasalt_batch` it would call is used directly:
    every guard that protects a write (unknown-must-not-overwrite-known, the per-key-set upsert
    grouping, PDPL redaction, the placeholder-location and unusable-URL rejections, raw-capture) runs
    either way, because they all live inside that one function. No write path is bypassed.
    """
    if not rows:
        return
    named = getattr(db, f"upsert_{PLATFORM}_{'residential' if 'residential' in table else 'commercial'}_batch", None)
    if named is not None:
        named(rows)
        return
    db._wasalt_batch(table, rows)


def _get(s: cc.Session, url: str, tries: int = 3) -> Optional[str]:
    """Page text, or None. A 404 is DEFINITIVE (the node is gone); a block/timeout retries."""
    for attempt in range(tries):
        try:
            r = s.get(url)
            if r.status_code == 200:
                return r.text
            if r.status_code == 404:
                return None
        except Exception:
            pass
        time.sleep(1.5 * (attempt + 1))
    return None


# ── index (/table?page=N) ───────────────────────────────────────────────────────────────────────
def parse_price_cell(cell_html: str) -> dict:
    """{label, basis, kind, amount, raw} from the index price cell.

    The cell reads «LABEL\\nAMOUNT<br><i class=fa-eye> VIEWS</i><a wa.me…>». Everything after the
    first <br> is a page-VIEW COUNTER — a bare integer that parses as a plausible price — so it is
    cut off BEFORE any digit is read.
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
    # «على السوم» carries no figure at all (157 rows) → NULL, never 0, never the view count.
    if amount is not None and amount > 0:
        out["amount"] = amount
    return out


def index_rows(page_html: str) -> list[dict]:
    body = _TBODY.search(page_html or "")
    if not body:
        return []
    out = []
    for tr in _TR.findall(body.group(1)):
        cells = {k: v for k, v in _TD.findall(tr)}
        title_cell = cells.get("view-changed-table-column", "")
        nid = _NID.search(title_cell) or _NID.search(tr)
        if not nid:
            continue
        out.append({"nid": nid.group(1), "cells": cells})
    return out


def parse_index(rec: dict) -> dict:
    """Everything the index publishes for one listing, as read (no normalization yet)."""
    c = rec["cells"]
    title_cell = c.get("view-changed-table-column", "")
    facts = _flat(c.get("view-nothing-3-table-column", ""))
    facts_lines = _lines(c.get("view-nothing-3-table-column", ""))
    tags = _lines(c.get("view-field-tags-table-column", ""))
    ta = _TITLE_A.search(title_cell)
    title_lines = [ln for ln in (_lines(ta.group(1)) if ta else []) if ln != "#"]
    thumb = _IMG.search(title_cell)
    date = _DATE.search(title_cell)
    area = _AREA.search(facts)
    # The index GLUES the facade onto the street token («شارع 15 شرق»); the detail page publishes
    # both separately and cleanly, so street/direction are read from there and this stays raw.
    street = _STREET.search("\n".join(facts_lines))
    age = _AGE.search("\n".join(facts_lines))
    dims = _DIMS.search("\n".join(facts_lines))
    return {
        "nid": rec["nid"],
        "price": parse_price_cell(c.get("view-nothing-1-table-column", "")),
        "area_raw": area.group(1) if area else None,
        "street_raw": street.group(1).strip() if street else None,
        "age_raw": age.group(1).strip() if age else None,
        "dims_raw": dims.group(1).strip() if dims else None,
        # tags[0] is the taxonomy TERM on its own line; «رقم N», «/ ح», «بلك N» follow it.
        "district_term": tags[0] if tags else None,
        "plot": " ".join(tags[1:]).strip() or None,
        "title_lines": title_lines,
        "thumb": thumb.group(1) if thumb else None,
        "bump_date": date.group(1) if date else None,
        "capture": {
            "price_cell": _flat(c.get("view-nothing-1-table-column", "")),
            "facts_cell": facts,
            "district_cell": " / ".join(tags),
            "title_cell": _flat(title_cell),
        },
    }


def fetch_index(s: cc.Session, max_pages: int = MAX_PAGES) -> list[dict]:
    """Every listing the Views table publishes, de-duplicated by nid."""
    seen: set[str] = set()
    out: list[dict] = []
    for page in range(max_pages):
        html = _get(s, f"{BASE}/table?page={page}")
        recs = index_rows(html or "")
        if not recs:
            break
        fresh = 0
        for rec in recs:
            if rec["nid"] in seen:
                continue
            seen.add(rec["nid"])
            fresh += 1
            out.append(parse_index(rec))
        if not fresh:
            break
        time.sleep(PAGE_PAUSE)
    return out


# ── detail (/{nid}) ─────────────────────────────────────────────────────────────────────────────
def parse_detail(page: str, nid: str) -> dict:
    """The NODE's OWN facts from /{nid}, or {} when the page cannot be proved to be this listing.

    Trap 1 in the module docstring: the page also renders a related-listings table with other
    properties' areas, prices and photos. Only `#…duplicate-of-node-block-1` is read, and that
    block's own wa.me share link must name `nid` — otherwise we have someone else's block and
    return nothing at all rather than mis-attributing it.
    """
    if not page:
        return {}
    art = _ARTICLE_NID.search(page)
    if not art or art.group(1) != nid:
        return {}
    block = _NODE_BLOCK.search(page)
    if not block:
        return {}
    table = block.group(1)
    wa = _WA_NID.search(table)
    if not wa or wa.group(1) != nid:
        return {}

    fields: dict[str, str] = {}
    for raw_label, raw_value in _FIELD_ROW.findall(table):
        label = _flat(raw_label)
        if label and label not in fields:
            fields[label] = _flat(raw_value)
    if not fields:
        return {}

    # Photos: the node's OWN gallery block, bounded to it. Drupal serves image-style derivatives
    # (/styles/wide/public/… .webp?itok=…); the ORIGINAL file is what the index thumbnail links and
    # what we store, so one listing's photo has one URL fleet-wide.
    gal = _GALLERY_BLOCK.search(page)
    photos: list[str] = []
    for u in (_FILE_IMG.findall(gal.group(1)) if gal else []):
        if PLACEHOLDER_IMG in u or "/logo." in u or "/files/js/" in u or "/files/css/" in u:
            continue
        u = re.sub(r"/styles/[^/]+/public/", "/", u).split("?")[0]
        u = re.sub(r"\.webp$", "", u)
        photos.append(u if u.startswith("http") else BASE + u)
    photos = list(dict.fromkeys(photos))

    desc_raw = fields.get("وصف العقار")
    ll = _LATLNG.search(fields.get("الموقع") or "")
    price = {"label": None, "basis": None, "kind": None, "amount": None, "raw": None}
    for label, basis, kind in PRICE_LABELS:
        if label in fields:
            price = {"label": label, "basis": basis, "kind": kind,
                     "raw": fields[label], "amount": N.to_int(fields[label])}
            break
    return {
        "nid": nid,
        "fields": fields,
        "photo_urls": photos,
        "description_raw": desc_raw,
        "price": price,
        "lat": ll.group(1) if ll else None,
        "lng": ll.group(2) if ll else None,
    }


def fetch_detail(s: cc.Session, nid: str) -> dict:
    return parse_detail(_get(s, f"{BASE}/{nid}") or "", nid)


# ── mapping ─────────────────────────────────────────────────────────────────────────────────────
def _deal(title_text: str) -> Optional[str]:
    if "يجار" in title_text:          # للإيجار / للايجار
        return "Rent"
    if "بيع" in title_text:           # للبيع
        return "Buy"
    return None                        # never defaulted


def _property_type(title_lines: list[str]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """(canonical type, the source's own Arabic type word, تصنيف). The تصنيف («سكنية»/«تجارية»/
    «زراعية») refines a LAND row onto the shared map's existing أرض تجارية / أرض زراعية keys — it
    reads the source more precisely, it does not invent a type."""
    if not title_lines:
        return None, None, None
    type_ar = title_lines[0]
    middle = [ln for ln in title_lines[1:] if "بيع" not in ln and "يجار" not in ln]
    tsnyf = middle[0] if middle else None
    t = N.map_type_exact(type_ar, TYPE_OVERRIDES)
    if t in ("Residential Land",) and tsnyf:
        if "زراعي" in tsnyf:
            t = N.map_type_exact("أرض زراعية") or t
        elif "تجاري" in tsnyf and "سكني" not in tsnyf:
            t = N.map_type_exact("أرض تجارية") or t
    return t, type_ar, tsnyf


def _fold_num(s: Optional[str]) -> str:
    """norm_district_tok() + the OWNER'S NUMBER FOLD (2026-09-14): «الهاشمية 1» and «الهاشمية» are one
    district for MATCHING; the card keeps the source's own number (it renders `neighborhood`).

    The fold lives in the shared token function — but only in the SQL one. `public.norm_district_tok`
    (migration 20260914204035) strips leading and trailing digit runs; the Python mirror in
    scrapers/common/arabic_location.py still documents step 5 as «so a numbered twin keeps its own
    identity» and returns «هاشميه 1». Since `loc_catalog_district.district_norm` is built by the SQL
    version, the two disagree, so the fold is re-applied here rather than comparing against a stale
    key. (The Python mirror catching up is a shared-helper change this onboarding pass may not make —
    reported, not patched.) Word-numeral twins («الصفا 1» vs «حي الصفا الاول») deliberately stay
    UNFOLDED: the owner still holds that one, so they compare unequal and resolve to no district.
    """
    n = norm_district_tok(s)
    return re.sub(r"\s*[0-9]+$", "", re.sub(r"^[0-9]+\s*", "", n)).strip()


def _district(term: Optional[str], city_id: Optional[int]) -> Optional[str]:
    """The catalog's canonical district for this term under `city_id`, or None.

    find_district_in_text() is built for FREE TEXT: it slides 3-, 2- and 1-word windows over
    whatever it is given. A taxonomy term is not free text, and handing it the whole string lets a
    single WORD of a compound place name win — «ضاحية هجر ،، الحي الخامس» (the fifth neighbourhood of
    the Hajar suburb) matched the catalog's «حي هجر» on the bare word «هجر», i.e. a different place,
    on ~150 listings. So only the term's PRIMARY segment (before its «،» qualifier) is offered, and
    the catalog's answer is accepted only when it is that whole name — norm_district_tok on both
    sides — never a fragment of it. Exact-location-only: a term the catalog does not carry
    («ضاحية هجر», «شرق شرق الحديقة», «منسوب التعليم») stays NULL here and survives verbatim in
    `neighborhood`, which is what the card shows.
    """
    if not term or not city_id:
        return None
    primary = re.split(r"[،,]+", term)[0].strip()
    if not primary:
        return None
    got = find_district_in_text(primary, city_id)
    if got and _fold_num(got) == _fold_num(primary):
        return got
    return None


def _district_and_city(term: Optional[str]) -> tuple[
        Optional[str], Optional[int], Optional[int], Optional[str], str]:
    """(city_ar, city_id, region_id, district_ar, city_basis) — see the CITY section of the module
    docstring. Every branch is catalog-validated; nothing here trusts the source's own labelling of
    what is a city, and nothing invents a town."""
    t = (term or "").strip()

    # (a) the term names its own town after a comma — the SOURCE speaking. Confirmed by the catalog,
    # region-hinted because الهفوف is a same-name twin (city 12 in region 5, city 501 in region 1).
    for part in [p.strip() for p in re.split(r"[،,]+", t)[1:] if p.strip()]:
        cid, rid = to_catalog(part, region_hint=EASTERN_PROVINCE_REGION_ID)
        # to_catalog returns a name's ONLY candidate whatever the hint says, so «الخرس والشهاب ،
        # اليمامة» (a Hofuf district) resolves to Riyadh-region اليمامة 1062. The region must match.
        if cid and rid == EASTERN_PROVINCE_REGION_ID:
            return part, cid, rid or EASTERN_PROVINCE_REGION_ID, \
                _district(t, cid), "source_states_town"

    # (b) the district is an exact, catalog-attested district of exactly ONE Al-Ahsa town.
    hits = [(cid, city_ar, d) for cid, city_ar in AHSA_TOWNS if (d := _district(t, cid))]
    if len(hits) == 1:
        cid, city_ar, district_ar = hits[0]
        return city_ar, cid, EASTERN_PROVINCE_REGION_ID, district_ar, "district_unique_to_town"

    # (c) honest broad-but-true: the governorate itself.
    cid, rid = to_catalog(GOVERNORATE_CITY_AR, region_hint=EASTERN_PROVINCE_REGION_ID)
    return (GOVERNORATE_CITY_AR if cid else None), cid, rid or EASTERN_PROVINCE_REGION_ID, \
        _district(t, cid), "governorate_fallback"


def _street_width(raw: Optional[str]) -> tuple[Optional[int], Optional[str]]:
    """(width_m, facade token found in the same cell). «15م» → 15. «40×15م» / «نافذ» → NULL: a
    corner plot on two streets has no single width, and «نافذ» (through-street) is not a number."""
    if not raw:
        return None, None
    txt = raw.strip()
    facade = next((d for d in _DIRECTIONS if d in txt), None)
    core = re.sub(r"م\s*$", "", txt)
    for d in _DIRECTIONS:
        core = core.replace(d, " ")
    core = core.strip()
    m = _ONE_NUMBER.match(core)
    if not m:
        return None, facade
    w = N.to_int(m.group(1))
    return (w if w and 1 <= w <= 200 else None), facade


def _direction(raw: Optional[str]) -> Optional[str]:
    """A single published facade, in canonical form. TWO of them stays NULL: «شرق غرب» is a plot
    fronting two opposite streets, not a compass point, and «شمال غرب» cannot be told apart from it
    (northwest vs north-and-west) without guessing. Ambiguity → NULL, raw kept in additional_info
    (abeea's rule)."""
    if not raw:
        return None
    toks = [_DIRECTION_CANON[w] for w in re.split(r"[\s/،,\-]+", raw.strip())
            if w in _DIRECTION_CANON]
    uniq = set(toks)
    return toks[0] if len(uniq) == 1 else None


def _floor_number(raw: Optional[str]) -> Optional[int]:
    if not raw:
        return None
    t = re.sub(r"\s+", " ", raw)
    for word, n in _ORDINAL_FLOOR:
        if word in t:
            return n
    m = re.search(r"([\d٠-٩]{1,2})", t)
    return N.to_int(m.group(1)) if m else None


def _rooms(text: Optional[str], property_type: Optional[str]) -> dict[str, Any]:
    """Bedrooms/halls/bathrooms from the source's own room prose — only for a SINGLE dwelling, and
    never from text that itemises several units (that count is one flat's, not this listing's)."""
    if not text or property_type not in _SINGLE_DWELLING:
        return {}
    t = _digits(text)
    if _MULTI_UNIT.search(t):
        return {}
    out: dict[str, Any] = dict(N.rooms_from_phrase(t))       # shared, tested: bedrooms + halls
    m = _BATH.search(t)
    if m:
        n = N.to_int(m.group(1))
        if n is not None and 1 <= n <= 20:
            out["bathrooms"] = n
    elif _BATH_ONE.search(t):
        out["bathrooms"] = 1
    return out


def map_listing(ix: dict, detail: dict) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason). row is None whenever the source leaves it unplaceable."""
    fields = detail.get("fields") or {}
    title_text = " ".join(ix["title_lines"])
    # «مزاد» / «تم البيع» / «تم الإيجار» appear ZERO times in the live catalogue (all 987 index rows
    # scanned 2026-09-20), but the check stays: an auction is not a listed price and a closed deal is
    # not an offer, and the day the office starts publishing either, this must skip rather than
    # publish it. Both the index title and the detail's own العقار line are checked.
    sold_blob = f"{title_text} {fields.get('العقار', '')} {ix['capture']['title_cell']}"
    if "مزاد" in sold_blob:
        return None, "residential", "auction"
    if re.search(r"تم\s*(?:ال)?(?:بيع|إيجار|ايجار|تأجير|تاجير)|مباع|محجوز", sold_blob):
        return None, "residential", "closed_deal"

    property_type, type_ar, tsnyf = _property_type(ix["title_lines"])
    if not property_type:
        return None, "residential", "type_unmapped"
    category = N.category_for_type(property_type).lower()

    deal = _deal(title_text) or _deal(fields.get("العقار") or "")
    if not deal:
        return None, category, "no_deal"
    # Written as a total expression so the null-deal lint can prove by AST that the stored value is
    # always "Buy"/"Rent" — a NULL transaction_type is quarantined out of search entirely.
    transaction_type = "Rent" if deal == "Rent" else "Buy"

    city_ar, city_id, region_id, district_ar, city_basis = _district_and_city(ix["district_term"])
    if not city_id:
        # to_catalog refused every branch (catalog unreachable or the governorate row missing) —
        # a listing we cannot place is skipped, never given a guessed city.
        return None, category, "city_not_in_catalog"

    # ── PRICE: the LABEL decides the column. Index label first; the detail's own label is the
    # fallback for the 23 rows whose index cell carries no label at all.
    p = ix["price"]
    basis_from = "index_label" if p["basis"] else None
    if not p["basis"] and detail.get("price", {}).get("basis"):
        p = detail["price"]
        basis_from = "detail_label"
    amount = p["amount"]
    if amount is None and basis_from == "index_label" and detail.get("price", {}).get("amount"):
        # «على السوم» in the index while the detail publishes a figure under the same basis.
        if detail["price"]["basis"] == p["basis"]:
            amount = detail["price"]["amount"]
            basis_from = "detail_amount"

    area_m2 = N.to_int(fields.get("المساحة") or ix["area_raw"])
    price_total = price_annual = price_per_meter = rent_period = None
    if amount is not None and p["basis"] == "per_sqm":
        # PRICE = SOURCE: a per-m² rate is not a total, and area is NEVER multiplied here. The
        # searchable total is derived in the search/display layer from this column.
        price_per_meter = amount
    elif amount is not None and p["basis"] == "total":
        if transaction_type == "Rent":
            # PERIOD = SOURCE. The site states none anywhere (measured: شهري/سنوي/يومي appear zero
            # times), so rent_period stays NULL — unknown — and the figure is stored unconverted.
            rp, annual = N.rent_period_and_annual(amount, f"{p['label'] or ''} {_flat(p['raw'] or '')}")
            rent_period = rp
            # No token → the helper returns the figure unchanged; (None, None) is a STATED period
            # with no annual bucket (يومي/نصف سنوي) and must not be parked as a year's rent.
            price_annual = annual
        else:
            price_total = amount

    description = _clean(detail.get("description_raw"))
    street_w, street_facade = _street_width(fields.get("شارع عرض") or ix["street_raw"])
    direction = _direction(fields.get("الواجهة والإتجاه")) or (
        street_facade if fields.get("الواجهة والإتجاه") is None else None)
    rooms = _rooms(fields.get("الغرف") or description, property_type)

    photos = list(detail.get("photo_urls") or [])
    if not photos and ix["thumb"] and PLACEHOLDER_IMG not in ix["thumb"]:
        thumb = re.sub(r"/styles/[^/]+/public/", "/", ix["thumb"]).split("?")[0]
        photos = [thumb if thumb.startswith("http") else BASE + thumb]

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{ix['nid']}",
        "listing_url": f"{BASE}/{ix['nid']}",
        "source": SOURCE,
        "active": True,
        "title": _clean(f"{type_ar} {tsnyf or ''} {'للإيجار' if deal == 'Rent' else 'للبيع'} "
                        f"في {ix['district_term'] or city_ar}"),
        "description": description,
        # The description is the ONLY place this office states an amenity. amenities_from_text gives
        # all four outcomes: named → True, «غير مؤثثة» → False, «مصعد مؤسس» (prepared) → NULL, and
        # «قريب من حديقة» (the NEIGHBOURHOOD's) → NULL. Silence produces no key at all, so a source
        # that said nothing never becomes a False.
        **N.amenities_from_text(_amenity_text(description)),
        "property_type": property_type,
        "type_ar": type_ar,
        "transaction_type": transaction_type,
        "city": N.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,            # the CATALOG's canonical spelling (match truth)
        "neighborhood": " ".join(x for x in (ix["district_term"], ix["plot"]) if x) or None,
        "area_m2": area_m2,
        "bedrooms": rooms.get("bedrooms"),
        "bathrooms": rooms.get("bathrooms"),
        "halls": rooms.get("halls"),
        # AF columns the source publishes as its own labelled facts.
        "property_age": N.parse_property_age(fields.get("العمر") or ix["age_raw"]),
        "direction": direction,
        "street_width_m": street_w,
        "floor_number": _floor_number(fields.get("الدور")),
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": price_per_meter,
        "rent_period": rent_period,
        # A detail fetch that FAILED is not the source saying "no photos" — None lets db's
        # unknown-must-not-overwrite-known guard drop the key so a stored list survives.
        "photo_urls": (photos[:20] or None) if (detail or photos) else None,
        "price_evidence": N.price_evidence(
            field=f"table cell «{p['label']}»" if p["label"] else "table price cell (no label)",
            raw=p["raw"], stored=(price_per_meter if price_per_meter is not None
                                  else (price_annual if price_annual is not None else price_total)),
            kind=("per_meter" if price_per_meter is not None
                  else ("annual" if rent_period == "annual" else "total")),
            unit=("per_meter" if p["basis"] == "per_sqm" else "total"),
            origin="structured",
        ),
        "additional_info": redact_capture({k: v for k, v in {
            "price_label": p["label"],
            "price_basis": p["basis"],
            "price_basis_from": basis_from,
            "price_amount_raw": p["raw"],
            "rent_period_stated": False if transaction_type == "Rent" and not rent_period else None,
            "title_qualifier": tsnyf,          # the source's own تصنيف
            "plot_reference": ix["plot"],       # «رقم 544 / د», «بلك 38»
            "dimensions": fields.get("الحدود والأطوال") or ix["dims_raw"],
            "street_raw": fields.get("شارع عرض") or ix["street_raw"],
            "direction_raw": fields.get("الواجهة والإتجاه"),
            # «التركيز» (nid 22239: المساحة 625م, التركيز 900م) is a labelled source fact whose
            # meaning this office never explains. Captured verbatim, never read as an area.
            "tarkeez_raw": fields.get("التركيز"),
            "rooms_raw": fields.get("الغرف"),
            "floor_raw": fields.get("الدور"),
            # «شقة عوائل» / «شقة عزاب» IS the source stating a tenant category, but the
            # tenant_category column's accepted vocabulary is not established anywhere in this repo,
            # so the source's own word is preserved here rather than guessed into the column.
            "tenant_category_raw": ("عوائل" if "عوائل" in (type_ar or "")
                                    else ("عزاب" if "عزاب" in (type_ar or "") else None)),
            "lat": detail.get("lat"),
            "lng": detail.get("lng"),
            "bump_date": ix["bump_date"],        # a REFRESH date, not created_at
            "city_basis": city_basis,            # DERIVED — see the module docstring
            "district_source_text": ix["district_term"],
            "detail_read": bool(detail) or None,
        }.items() if v is not None}),
        "source_capture": redact_capture({
            "schema": "alshawaf.v1",
            "nid": ix["nid"],
            "index": ix["capture"],
            "detail_fields": fields,
            "detail_photos": detail.get("photo_urls") or [],
        }),
    }
    return row, category, ""


# ── crawl ───────────────────────────────────────────────────────────────────────────────────────
def crawl(limit: int = 0, want_detail: bool = True) -> tuple[list[dict], list[dict], int, dict]:
    s = session()
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    stats: dict[str, Any] = {"seen": 0, "no_price": 0, "per_sqm": 0, "detail_failed": 0,
                             "skipped": skipped}

    listings = fetch_index(s)
    if not listings:
        raise RuntimeError("/table?page=0 returned no Views rows (block or markup change)")
    stats["seen"] = len(listings)
    print(f"{SOURCE}: {len(listings)} listings enumerated from /table", flush=True)

    for ix in (listings[:limit] if limit else listings):
        detail = fetch_detail(s, ix["nid"]) if want_detail else {}
        if want_detail:
            if not detail:
                stats["detail_failed"] += 1
            time.sleep(DETAIL_PAUSE)
        row, cat, why = map_listing(ix, detail)
        if not row:
            skipped[why] = skipped.get(why, 0) + 1
            continue
        if row["price_total"] is None and row["price_annual"] is None and row["price_per_meter"] is None:
            stats["no_price"] += 1
        if row["price_per_meter"] is not None:
            stats["per_sqm"] += 1
        (com if cat == "commercial" else res).append(row)
    return res, com, stats["seen"], stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0, help="only the first N listings, NO prune")
    ap.add_argument("--dry-run", action="store_true", help="print rows, write NOTHING")
    args = ap.parse_args()

    def _split(res: list[dict], com: list[dict]) -> tuple[list[dict], list[dict]]:
        if args.type == "all":
            return res, com
        keep_com = args.type == "commercial"
        return ([] if keep_com else res), (com if keep_com else [])

    if args.dry_run:
        res, com, seen, stats = crawl(limit=args.limit)
        res, com = _split(res, com)
        print(json.dumps(res + com, ensure_ascii=False, indent=1))
        print(f"— DRY RUN (no DB writes): {len(res)} residential + {len(com)} commercial "
              f"of {seen} enumerated — {stats}", file=sys.stderr)
        return 0

    run_id = None if args.limit else db.begin_run(PLATFORM)
    seen = 0
    try:
        res, com, seen, stats = crawl(limit=args.limit)
        res, com = _split(res, com)
        _upsert("alshawaf_residential_listings", res)
        _upsert("alshawaf_commercial_listings", com)
        if args.limit:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"upserted (no prune) — {stats}")
            return 0

        superseded = db.retire_superseded_siblings(
            res_table="alshawaf_residential_listings", com_table="alshawaf_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        for tbl, rows in (("alshawaf_residential_listings", res),
                          ("alshawaf_commercial_listings", com)):
            nn = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE)
            if nn < 0:
                print(f"⚠ {tbl}: prune guard tripped — kept existing active rows")
            else:
                pruned += nn
        # An empty or thin run must say WHY in the database, not just how many rows it wrote.
        notes = (f"pruned={pruned} no_price={stats['no_price']} per_sqm={stats['per_sqm']} "
                 f"detail_failed={stats['detail_failed']} skipped="
                 + (",".join(f"{k}x{v}" for k, v in sorted(stats["skipped"].items(),
                                                           key=lambda x: -x[1])) or "none"))
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             notes=notes,
                             check_tables=["alshawaf_residential_listings",
                                           "alshawaf_commercial_listings"])
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted, "
              f"{pruned} stale pruned — {notes}")
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
