"""عبر الأصول للخدمات العقارية (abralosol.com) — a single-office Al-Ahsa brokerage.

WHAT THE SITE IS. One Drupal 8 site for one brokerage (footer: «الأحساء, المبرز , المشرفة»),
publishing its whole catalog as ONE Views table at /node — 100 rows/page, `?page=` 0-indexed,
2,761 listings (the site prints its own total: «عدد العقارات: 2761»). Detail page = /{nid}.

EXTRACTION MECHANISM. DOM only — there is no structured endpoint: /jsonapi serves the themed HTML
404, /{nid}?_format=json returns HTTP 406, /sitemap.xml is 404, and there is zero JSON-LD anywhere.
The DOM is stable in the way that matters: every index cell carries a Drupal Views `headers`
machine name, so selectors key off names, never positions:
    view-field-als-r-table-column  → price label + amount
    view-nothing-1-table-column    → المساحة + شارع
    view-field-tags-table-column   → district (+ plot no. / letter)
    view-nothing-table-column      → title link (/{nid}), thumbnail, bump date
and the detail page carries `article[data-history-node-id]`, `span[property=schema:name][content]`
and a run of `div.text-right.h1` fact/prose blocks.

REALNESS EVIDENCE (re-verified live 2026-09-02 while writing this). robots.txt is the stock Drupal
list and disallows none of /node, ?page= or /{nid}; no CAPTCHA, no login, no JS rendering, no rate
limiting. Page 0 alone: 100 unique nids, ~90 distinct real Al-Ahsa districts (الحمراء الثاني،
الراجحي، دانة الراشدية، الشروفية، بوسحبل…), a 419-term district taxonomy behind them, bump dates
running to TODAY, and non-templated prose on the detail pages (nid 4687: 12 apartments + 4 shops,
current income 249,500 SAR, per-unit meters, lift, ground tank). Not seeded data.

THE P0 THIS SCRAPER EXISTS TO NOT GET WRONG. ~28% of listings are priced PER SQUARE METRE, and the
machine-readable attribute is basis-FREE: nid 7779 renders `<div content="1500">1,500 ريال</div>`
for a 511 m² plot whose own body says «🟡 المتر 1,500 ريال». Taking that attribute as the price
books the plot at 1,500 SAR. The basis is published ONLY as an Arabic label, so the label decides
the column — السعر/السوم/الحد → price_total, المتر/سوم المتر/حد للمتر → price_per_meter — and area
is NEVER multiplied to synthesise a total. No label at all → both columns NULL (see _price).

    python -m scrapers.abralosol.run --type all --limit 15 --dry-run   # validate, zero DB writes
    python -m scrapers.abralosol.run --type all --limit 60             # upsert first 60, no prune
    python -m scrapers.abralosol.run --type all                        # full crawl + prune
"""
from __future__ import annotations

import argparse
import html as html_mod
import json
import re
import sys
import time
from typing import Any, Optional

from curl_cffi import requests as cc

from scrapers.common import db
from scrapers.common import normalize as N
from scrapers.common.pii import redact_capture, redact_pii

BASE = "https://abralosol.com"
SOURCE = "Abr Alosol"
PLATFORM = "abralosol"

MAX_PAGES = 200          # safety stop; the catalog is ~28 pages
PAGE_PAUSE = 0.6         # between index pages
DETAIL_PAUSE = 0.35      # between detail fetches (site answers in ~0.26s, no rate limiting seen)

# The shared "no photo" placeholder — 46% of listings carry ONLY this. It is not a photo.
PLACEHOLDER_IMG = "IMG-17-WA0004.png"

# Per-platform EXACT overrides (map_type_exact contract: conflicts/spellings only, never a new
# canonical type). This site spells duplex «دبلكس»; the shared map has «دوبلكس»/«دوبليكس».
# The plural land phrases are the site's own wording for a multi-plot listing («a group of
# adjacent plots», «halves of adjacent plots») — land either way, so they resolve to the EXISTING
# land type rather than to nothing. 4 rows measured 2026-09-02.
TYPE_OVERRIDES = {
    "دبلكس": "Duplex",
    "دبلوكس": "Duplex",
    # The site spells agricultural land «ارض زراعيه» (final ه); the shared map's key is «ارض زراعية»
    # (final ة), so neither the exact nor the substring pass reached it and the source's OWN word for
    # a farm plot resolved to Residential Land. Same shape as the دبلكس entry: a spelling variant of
    # an EXISTING canonical type, never a new one. 2 rows in 400 sampled 2026-09-02.
    "ارض زراعيه": "Farm",
    "أرض زراعيه": "Farm",
    "مجموعة اراضي متجاورات": "Residential Land",
    "انصاف اراضي متجاورات": "Residential Land",
}

# ── PRICE LABELS ────────────────────────────────────────────────────────────────────────────────
# label → (basis, kind). Longest first: «سوم المتر» must never match as «السوم», «حد للمتر» never
# as «الحد». basis decides the COLUMN; kind is recorded but never changes the column.
PRICE_LABELS: tuple[tuple[str, str, str], ...] = (
    ("سوم المتر", "per_sqm", "offer"),
    ("حد للمتر", "per_sqm", "reserve"),
    ("على السوم", "total", "offer"),
    ("المتر", "per_sqm", "asking"),
    ("السعر", "total", "asking"),
    ("السوم", "total", "offer"),
    ("الحد", "total", "reserve"),
)

# ── CITY ────────────────────────────────────────────────────────────────────────────────────────
# City is NOT published per listing. It is DERIVED, and the derivation is recorded in
# additional_info["city_basis"] so nothing downstream can mistake it for a source field.
#   district_token → the district term itself names a city (only the tokens below, all Eastern
#                    Province, all attested in the 419-term taxonomy).
#   office_default → the office's own published city (footer: الأحساء / المبرز → canonical "Hofuf").
# Deliberately NOT in this table: الرياض / مكة / المدينة / الظهران / الطريفي. In THIS catalog those
# are Al-Ahsa street and district names — «الرياض بالهفوف», «شارع مكة», «شارع الظهران» — so a
# substring city match on them is a false positive, not a city.
OTHER_CITY_TOKENS: tuple[tuple[str, str], ...] = (
    ("الدمام", "Dammam"),
    ("الخبر", "Khobar"),
    ("الجبيل", "Jubail"),
    ("أبقيق", "Abqaiq"),
    ("بقيق", "Abqaiq"),
)
OFFICE_CITY = "Hofuf"        # canonical English for الأحساء / الهفوف (N.map_city("الأحساء"))
_STREETY = ("شارع", "طريق")  # «شارع الظهران» is a street in Hofuf, not the city of Dhahran

# PDPL: redact_pii() removes numbers/handles; this truncates the contact CTA prose that precedes
# them (same cut-list shape as october's _CUT).
# «للمهتمين أرقامنا» / «📞 …» are this office's own sign-off and survived the october cut-list —
# measured on 4 of 70 live bodies 2026-09-02. «أرقام» BARE is deliberately absent: «ارقام القطع 213
# - 215 - 217» is listing content, not a contact CTA.
_CUT = re.compile(r"(للتواصل|للاستفسار|للإستفسار|للحجز|اتصل|تواصل|واتساب|واتس|جوال|الجوال|"
                  r"المعلن|الوسيط|المسوق|للمهتمين|أرقامنا|ارقامنا|📞|☎|📱|whatsapp|call us)", re.I)

_TBODY = re.compile(r"<tbody[^>]*>(.*?)</tbody>", re.S)
_TR = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
_TD = re.compile(r'<td[^>]*headers="([^"]+)"[^>]*>(.*?)</td>', re.S)
# Some rows link the title as /index.php/{nid} instead of /{nid} (164 of 2,761 measured
# 2026-09-02). Both forms must match or those rows arrive with an EMPTY title — i.e. no type and
# no deal — and get dropped as unmappable.
_NID = re.compile(r'href="/(?:index\.php/)?(\d+)"')
_TITLE_A = re.compile(r'<a\s+href="/(?:index\.php/)?\d+"[^>]*hreflang[^>]*>(.*?)</a>', re.S)
_IMG = re.compile(r'<img[^>]*src="([^"]+)"')
_DATE = re.compile(r"\b(\d{2}/\d{2}/\d{4})\b")
_AREA = re.compile(r"المساحة\s*([\d,.]+)\s*م")
_STREET = re.compile(r"شارع\s*([\d\+\.]+)")
_ARTICLE = re.compile(r'<article[^>]*data-history-node-id="(\d+)".*?</article>', re.S)
_SCHEMA_NAME = re.compile(r'<span[^>]*property="schema:name"[^>]*content="([^"]*)"')
_BLOCK = re.compile(r'<div([^>]*)class="text-right h1"[^>]*>', re.S)
_BLOCK_END = re.compile(r'<span class="a2a_kit|<ul class="links inline')
_CONTENT_ATTR = re.compile(r'content="([^"]*)"')
_LIGHTBOX = re.compile(r'<a[^>]*class="lightbox"[^>]*href="([^"]+)"')
_AGE_BLOCK = re.compile(r"^\W*العمر\s*(.+)$")
_FILE_IMG = re.compile(r'<img[^>]*src="([^"]*/sites/default/files/[^"]+)"')


def _text(fragment: str) -> str:
    """Tag-stripped, entity-decoded text with <br> → newline."""
    t = re.sub(r"<br\s*/?>", "\n", fragment or "")
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


def _session() -> cc.Session:
    return cc.Session(impersonate="chrome124", timeout=30)


def _get(s: cc.Session, url: str, tries: int = 3) -> Optional[str]:
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


# ── index row parsing ───────────────────────────────────────────────────────────────────────────
def _price(cell_html: str) -> dict:
    """{label, basis, kind, amount, raw} from the price cell.

    The cell reads «LABEL\\nAMOUNT<br><i class=fa-eye></i>\\nVIEWS<a wa.me…>». Everything after the
    first <br> is a VIEW COUNTER — a bare integer that would parse as a perfectly plausible price —
    so the cut happens BEFORE any number is read, not after.
    """
    head = re.split(r"<br", cell_html, maxsplit=1)[0]
    txt = re.sub(r"\s+", " ", " ".join(_lines(head))).strip()
    out: dict[str, Any] = {"raw": txt, "label": None, "basis": None, "kind": None, "amount": None}
    for label, basis, kind in PRICE_LABELS:
        if txt.startswith(label):
            out.update(label=label, basis=basis, kind=kind)
            txt = txt[len(label):]
            break
    amount = N.to_int(txt)
    # «على السوم» with no figure (~10% of the catalog) → NULL, never 0.
    if amount is not None and amount > 0:
        out["amount"] = amount
    return out


def _index_rows(page_html: str) -> list[dict]:
    body = _TBODY.search(page_html or "")
    if not body:
        return []
    rows = []
    for tr in _TR.findall(body.group(1)):
        cells = {k: v for k, v in _TD.findall(tr)}
        title_cell = cells.get("view-nothing-table-column", "")
        nid = _NID.search(title_cell) or _NID.search(tr)
        if not nid:
            continue
        rows.append({"nid": nid.group(1), "cells": cells})
    return rows


def _parse_index(rec: dict) -> dict:
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

    return {
        "nid": rec["nid"],
        "price": _price(price_cell),
        "area_raw": a.group(1) if a else None,
        "street_width": st.group(1) if st else None,
        "district": tags[0] if tags else None,
        "plot": " ".join(tags[1:]) or None,
        "title_lines": title_lines,
        "thumb": thumb.group(1) if thumb else None,
        "bump_date": date.group(1) if date else None,
        "capture": {
            "price_cell": _flat(price_cell),
            "area_cell": area_txt,
            "district_cell": _flat(tags_cell),
            "title_cell": _flat(title_cell),
        },
    }


# ── detail page ─────────────────────────────────────────────────────────────────────────────────
def _detail(s: cc.Session, nid: str) -> dict:
    """{title, blocks, description, photo_urls, label} from /{nid}. Empty dict if unfetchable."""
    page = _get(s, f"{BASE}/{nid}")
    if not page:
        return {}
    art = _ARTICLE.search(page)
    if not art or art.group(1) != nid:
        return {}
    body = art.group(0)

    starts = list(_BLOCK.finditer(body))
    blocks: list[tuple[str, str]] = []          # (attrs, text)
    for i, m in enumerate(starts):
        end = starts[i + 1].start() if i + 1 < len(starts) else len(body)
        chunk = body[m.end():end]
        stop = _BLOCK_END.search(chunk)
        if stop:
            chunk = chunk[:stop.start()]
        blocks.append((m.group(1), re.sub(r"[ \t]+", " ", _text(chunk)).strip()))

    # The basis label is the block immediately BEFORE the content="…" amount block.
    label = None
    for i, (attrs, txt) in enumerate(blocks):
        if _CONTENT_ATTR.search(attrs) and i:
            prev = re.sub(r"[^؀-ۿ\s]", "", blocks[i - 1][1]).strip()
            prev = re.sub(r"\s+", " ", prev)
            if any(prev == lab for lab, _, _ in PRICE_LABELS):
                label = prev
            break

    # Full-size originals; the thumbnail styles/…/public/ + ?itok= variants are the same files.
    photos = [u for u in _LIGHTBOX.findall(body) if PLACEHOLDER_IMG not in u]
    if not photos:
        for u in _FILE_IMG.findall(body):
            if PLACEHOLDER_IMG in u or "/files/js/" in u:
                continue
            u = re.sub(r"/styles/[^/]+/public/", "/", u).split("?")[0]
            photos.append(u if u.startswith("http") else BASE + u)
    photos = list(dict.fromkeys(photos))

    prose = [txt for attrs, txt in blocks
             if txt and not _CONTENT_ATTR.search(attrs)
             and not txt.startswith("ملاحظة")
             and re.sub(r"[^؀-ۿ\s]", "", txt).strip() != (label or "\0")]
    # Age comes ONLY from the emoji-labelled «العمر» fact block («🟡 العمر8 سنة»), never from the
    # prose — a sentence like «العمارة عمرها ...» in seller narrative is not a structured field.
    age_raw = None
    for _, txt in blocks:
        m = _AGE_BLOCK.match(txt)
        if m:
            age_raw = m.group(1).strip()
            break

    name = _SCHEMA_NAME.search(body)
    return {
        "title": re.sub(r"\s+", " ", html_mod.unescape(name.group(1))).strip() if name else None,
        "blocks": [t for _, t in blocks],
        "description": _clean("\n".join(prose)),
        "photo_urls": photos,
        "label": label,
        "age_raw": age_raw,
    }


# ── mapping ─────────────────────────────────────────────────────────────────────────────────────
def _city(district: Optional[str]) -> tuple[Optional[str], Optional[str], str]:
    """(city, region, basis). See OTHER_CITY_TOKENS for why the table is small and explicit."""
    d = (district or "").strip()
    if d and not d.startswith(_STREETY):
        for token, city in OTHER_CITY_TOKENS:
            if token in d:
                return city, N.region_for_city(city), "district_token"
    return OFFICE_CITY, N.region_for_city(OFFICE_CITY), "office_default"


# The ad body's own explicit per-metre statement, e.g. «... وسعر المتر 1,600 ريال». It overrides a
# TOTAL-basis label ONLY when it names the SAME figure the label carries, so it can never pick up a
# neighbouring plot's rate or a comparison price. Live proof (nid 7729, 2026-09-02): the index cell
# says «السوم 1,600» — a total-basis label — for a 500 m² plot, while the body says «وسعر المتر
# 1,600 ريال». Two source statements about one number; the explicit one (label + amount + currency
# adjacent, the same adjacency rule aqar/october already use) is the one that actually states a
# basis, so it wins. Without this the row books a 500 m² plot at 1,600 SAR.
# `\d` is Unicode-aware in Python, so «١,٦٠٠» matches here and N.to_int folds it to 1600 — Arabic
# notation parity needs no separate transliteration pass (pinned by a test).
_PER_METRE_PROSE = re.compile(r"(?:سعر\s*المتر|المتر)\s*[:：]?\s*([\d,٬.]+)\s*ريال")


def _per_metre_in_body(amount: Optional[int], blocks: list[str]) -> bool:
    if amount is None:
        return False
    for block in blocks or []:
        for m in _PER_METRE_PROSE.finditer(block):
            if N.to_int(m.group(1)) == amount:
                return True
    return False


# PERIOD = SOURCE, in the direction that actually bites. The price LABEL never carries a period on
# this site — but the ad BODY does, and "our captured field is empty" is not evidence the source is
# silent (owner rule 2026-08-13; the aqaratikom run that assumed it was wrong on 13/13 rows).
# Measured live 2026-09-02 over the rent facet's FULL 25-row set: 4 ads publish the period next to
# their own price — 7580/7579/7504 «الإيجار السنوي 12,000 ريال» and 7776 «العقد سنوي، والإيجار
# 22,000 ريال سنويًا». Reading only the label NULLs a period the source states outright.
#
# What keeps the body eligible without reviving the 2026-08-11 manufactured-سنوي defect: the token
# must sit ADJACENT TO THE SAME FIGURE the price cell carries — the identical adjacency rule
# _per_metre_in_body already uses. A sale ad's «عقود سنويه» about its tenants names no price figure
# (and never reaches here: only a Rent row asks), and a neighbouring unit's terms would have to
# repeat this listing's exact amount to be picked up. Magnitude, type and platform set nothing.
_PERIOD_WINDOW = 40                      # chars either side of the figure
_FIGURE = re.compile(r"\d[\d,٬.]*")      # `\d` is Unicode-aware → «١٢,٠٠٠» matches too


def _period_text(amount: Optional[int], blocks: list[str]) -> str:
    """The body text stating something ABOUT this exact figure — the only body text allowed to set a
    period. Empty when the source never names the amount."""
    if amount is None:
        return ""
    out = []
    for block in blocks or []:
        for m in _FIGURE.finditer(block):
            if N.to_int(m.group(0)) == amount:
                out.append(block[max(0, m.start() - _PERIOD_WINDOW):m.end() + _PERIOD_WINDOW])
    return " ".join(out)


def _deal(title_text: str) -> Optional[str]:
    if "يجار" in title_text:            # للايجار / للإيجار
        return "Rent"
    if "بيع" in title_text:             # للبيع
        return "Buy"
    return None                          # 3.4% state neither → deal UNKNOWN, never defaulted


def _property_type(title_lines: list[str]) -> tuple[Optional[str], Optional[str]]:
    """(canonical type, the title's middle qualifier as published). That qualifier is whatever the
    h1 puts between type and deal — usually the tsnyf («سكنية»/«تجارية»/«تجاري سكني»), but just as
    often a condition or deed word («جاهز», «عظم», «صك الكتروني», «وقف»). It is stored under its own
    honest name, NOT as `tsnyf`. «تجارية»/«زراعيه» on a land are the source's own words for a
    commercial/agricultural plot and both «أرض تجارية» and «أرض زراعية» are EXISTING keys in the
    shared map — so this refines the lookup from source, it does not invent a type."""
    tok = title_lines[0] if title_lines else ""
    middle = [ln for ln in title_lines[1:] if "بيع" not in ln and "يجار" not in ln and not _DATE.match(ln)]
    tsnyf = middle[0] if middle else None
    t = N.map_type(tok, TYPE_OVERRIDES) or N.map_type(" ".join(title_lines), TYPE_OVERRIDES)
    if t == "Residential Land" and tsnyf:
        if "زراعي" in tsnyf:                       # «أرض … ارض زراعيه» — an EXISTING shared key
            t = N.map_type_exact("أرض زراعية")
        elif "تجاري" in tsnyf and "سكني" not in tsnyf:
            t = N.map_type_exact("أرض تجارية")
    return t, tsnyf


def map_listing(ix: dict, detail: dict) -> Optional[tuple[dict, str]]:
    """Normalized row + category, or None when the source leaves the row unplaceable."""
    title_text = " ".join(ix["title_lines"])
    deal_token = _deal(title_text) or _deal(detail.get("title") or "")
    property_type, tsnyf = _property_type(ix["title_lines"])
    if not deal_token or not property_type:
        return None

    # Provably TOTAL for the null-deal guard (scrapers/common/tests/test_deal_mapping_total.py):
    # a NULL transaction_type is dropped by the search-sync eligibility filter, so that lint
    # requires the written value to be provably "Buy"/"Rent" by AST. The quarantine directly
    # above already returned for every non-canonical deal, so this re-expression cannot change
    # behaviour — it only makes the totality the guard enforces visible to the linter.
    transaction_type = "Rent" if deal_token == "Rent" else "Buy"

    p = ix["price"]
    basis = p["basis"]
    basis_from = "index_label" if basis else None
    if basis is None and detail.get("label"):
        for label, b, kind in PRICE_LABELS:      # index label missing → take the detail page's
            if detail["label"] == label:
                basis, basis_from = b, "detail_label"
                p = {**p, "label": label, "basis": b, "kind": kind}
                break

    amount = p["amount"]
    if basis != "per_sqm" and _per_metre_in_body(amount, detail.get("blocks") or []):
        basis, basis_from = "per_sqm", "body_states_per_metre"

    price_total = price_per_meter = price_annual = rent_period = None
    if amount is not None and basis == "per_sqm":
        # PRICE = SOURCE: a per-m² rate is not a total, and area is never used to make one.
        price_per_meter = amount
    elif transaction_type == "Rent":
        # PERIOD = SOURCE — only an explicit token the source states ABOUT THIS FIGURE, from the
        # price label or the adjacent body text (see _period_text). Nothing is read from magnitude,
        # property type or platform. No token → period UNKNOWN → price_annual stays NULL rather
        # than asserting a year the source never stated; the amount survives in additional_info.
        rent_period, annual = N.rent_period_and_annual(
            amount, f"{p['label'] or ''} {_period_text(amount, detail.get('blocks') or [])}")
        price_annual = annual if rent_period and basis == "total" else None
    elif amount is not None and basis == "total":
        price_total = amount
    # amount with NO basis label anywhere (2/100 sampled) stays NULL in BOTH price columns: the
    # source published a number but not what it means, and a total is a different fact from a rate.
    # rent_period is still recorded when the body states it — the period is a fact about the LEASE,
    # not about which column the number lands in.

    city, region, city_basis = _city(ix["district"])
    photos = detail.get("photo_urls") or []
    if not photos and ix["thumb"] and PLACEHOLDER_IMG not in ix["thumb"]:
        thumb = re.sub(r"/styles/[^/]+/public/", "/", ix["thumb"]).split("?")[0]
        photos = [thumb if thumb.startswith("http") else BASE + thumb]

    row = {
        "ad_number": f"ABR{ix['nid']}",
        "listing_url": f"{BASE}/{ix['nid']}",
        "source": SOURCE,
        "active": True,
        "property_type": property_type,
        "transaction_type": transaction_type,
        "city": city,
        "region": region,
        "neighborhood": ix["district"],
        "area_m2": N.to_int(ix["area_raw"]),
        # Bedrooms/bathrooms: the facet field exists but is populated on ~11 rows site-wide; both
        # otherwise live only in narrative prose («3 غرف ومجلس», «دورتين مياه»). NULL, not parsed.
        "bedrooms": None,
        "bathrooms": None,
        # Only from the «العمر» fact block, through the shared closed vocabulary; silent → NULL.
        "property_age": N.parse_property_age(detail.get("age_raw")),
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": price_per_meter,
        "rent_period": rent_period,
        # A detail fetch that FAILED (or was skipped) is not the source saying "no photos" — send
        # None so db's unknown-must-not-overwrite-known guard drops the key and a stored list
        # survives. An empty list is written only when the page loaded and carried the placeholder.
        "photo_urls": photos if (detail or photos) else None,
        "title": _clean(detail.get("title") or title_text) or None,
        "description": detail.get("description"),
        "additional_info": redact_capture({k: v for k, v in {
            "price_label": p["label"],
            "price_basis": basis,
            "price_basis_from": basis_from,
            "price_kind": p["kind"],
            "price_amount_raw": amount,
            "street_width": ix["street_width"],
            "plot": ix["plot"],
            "title_qualifier": tsnyf,   # tsnyf OR a condition/deed word — see _property_type
            "property_age_raw": detail.get("age_raw"),
            "bump_date": ix["bump_date"],       # a REFRESH date, not created_at
            "city_basis": city_basis,           # derived — see _city()
            "district_ar": ix["district"],
        }.items() if v is not None}),
        # Rule 7: the whole source payload, raw, so a future field never needs a re-scrape.
        "source_capture": redact_capture({
            "nid": ix["nid"],
            "index": ix["capture"],
            "area_raw": ix["area_raw"],
            "thumb": ix["thumb"],
            "title_lines": ix["title_lines"],
            "detail_blocks": detail.get("blocks") or [],
            "detail_photos": detail.get("photo_urls") or [],
        }),
    }
    return row, N.category_for_type(property_type).lower()


# ── crawl ───────────────────────────────────────────────────────────────────────────────────────
def crawl(limit: int = 0, want_detail: bool = True) -> tuple[list[dict], list[dict], int, dict]:
    s = _session()
    res: list[dict] = []
    com: list[dict] = []
    seen: set[str] = set()
    stats = {"rows": 0, "skipped_no_deal": 0, "skipped_no_type": 0, "no_price": 0,
             "per_sqm": 0, "unlabelled_price": 0, "detail_failed": 0, "pages": 0}

    for page in range(MAX_PAGES):
        html = _get(s, f"{BASE}/node?page={page}")
        recs = _index_rows(html or "")
        if not recs:
            break
        stats["pages"] += 1
        fresh = 0
        for rec in recs:
            if rec["nid"] in seen:
                continue
            seen.add(rec["nid"])
            fresh += 1
            ix = _parse_index(rec)
            detail = _detail(s, ix["nid"]) if want_detail else {}
            if want_detail:
                if not detail:
                    stats["detail_failed"] += 1
                time.sleep(DETAIL_PAUSE)
            mapped = map_listing(ix, detail)
            if not mapped:
                key = "skipped_no_deal" if not (_deal(" ".join(ix["title_lines"]))
                                                or _deal(detail.get("title") or "")) else "skipped_no_type"
                stats[key] += 1
                continue
            row, category = mapped
            if row["price_total"] is None and row["price_annual"] is None and row["price_per_meter"] is None:
                stats["no_price"] += 1
            if row["price_per_meter"] is not None:
                stats["per_sqm"] += 1
            if ix["price"]["amount"] is not None and not row["additional_info"].get("price_basis"):
                stats["unlabelled_price"] += 1
            (com if category == "commercial" else res).append(row)
            stats["rows"] += 1
            if limit and stats["rows"] >= limit:
                return res, com, stats["rows"], stats
        if not fresh:
            break
        time.sleep(PAGE_PAUSE)
    return res, com, stats["rows"], stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: only the first N parsed listings, NO prune")
    ap.add_argument("--dry-run", action="store_true",
                    help="print normalized rows as JSON and write NOTHING to the database")
    args = ap.parse_args()

    if args.dry_run:
        res, com, seen, stats = crawl(limit=args.limit)
        if args.type != "all":
            keep_com = args.type == "commercial"
            res, com = ([] if keep_com else res), (com if keep_com else [])
        print(json.dumps(res + com, ensure_ascii=False, indent=1))
        print(f"— DRY RUN (no DB writes): {len(res)} residential + {len(com)} commercial — {stats}",
              file=sys.stderr)
        return 0

    run_id = None if args.limit else db.begin_run(PLATFORM)
    seen = 0
    try:
        res, com, seen, stats = crawl(limit=args.limit)
        if args.type != "all":
            keep_com = args.type == "commercial"
            res, com = ([] if keep_com else res), (com if keep_com else [])

        if res:
            db.upsert_abralosol_residential_batch(res)
        if com:
            db.upsert_abralosol_commercial_batch(com)

        if args.limit:
            print(f"✓ Abr Alosol VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"upserted (no prune) — {stats}")
            return 0

        pruned = 0
        for tbl, rows_seen in (("abralosol_residential_listings", res),
                               ("abralosol_commercial_listings", com)):
            nn = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source=SOURCE)
            if nn < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += nn
        print(f"✓ Abr Alosol: {len(res)} residential + {len(com)} commercial upserted, "
              f"{pruned} stale pruned — {stats}")
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} {stats}",
                             check_tables=["abralosol_residential_listings",
                                           "abralosol_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard.", flush=True)
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
