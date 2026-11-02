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
from functools import lru_cache
from typing import Any, Optional

from curl_cffi import requests as cc

from scrapers.common import arabic_location as AL
from scrapers.common import db
from scrapers.common.http import retry_smarter_session
from scrapers.common.http_liveness import LivenessProbe
from scrapers.common import normalize as N
from scrapers.common.pii import redact_capture, redact_pii
from scrapers.common.page_pin import pin_from_html, pin_from_short_link, resolve_redirect, short_maps_link

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
# المبرز is Al-Ahsa's second city (catalog city 2748), and the office sells there too. Before
# 2026-10-09 every such ad fell to office_default and was served under الهفوف: a customer searching
# المبرز could not find ~330 of them, and their districts never resolved (QA 2026-10-09, backlog 206).
#   ad_text           → the ad's own title/description names «المبرز» and never «الهفوف»
#                       («بيت عربي في المبرز حي الحزم», «حي الغسانية ٢، المبرز – الأحساء»).
#   district_mubarraz → the district is one ≥2 independent pages place in المبرز: the ads' own text
#                       and amlakalahsa (an Al-Ahsa office whose geocoded city is المبرز), measured
#                       2026-10-09. A name with one confirmation (المصطفى, محاسن, الرضا, جوهرة النزهة)
#                       is NOT here; it keeps office_default until a second page confirms it.
MUBARRAZ_CITY = "Mubarraz"   # loc_city_map «mubarraz» → المبرز (migration 20261009172136)
MUBARRAZ_REGION = "Eastern Province"
MUBARRAZ_DISTRICTS = frozenset({
    "جوهرة الهادي", "الغسانية", "الجابرية", "الراجحي", "بوسحبل", "دانة الراشدية",
    "بستان المطيرفي", "الحزم", "درة الشمال",
})
_DISTRICT_SUFFIX = re.compile(r"\s*[0-9٠-٩]+\s*$")  # «الغسانية ٢» → «الغسانية»
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
    # 2026-10-13 (Scraping Engineer, backlog 488/63): one pinned profile, no retry route. The 10-13
    # nightly read /node?page=0 as nothing on chrome124 and logged an empty catalogue (pages=0).
    # 3 browser profiles DIRECT, then the residential proxy when the job has it.
    s, tried = retry_smarter_session(f"{BASE}/node?page=0", timeout=40)
    print(f"  route: {' · '.join(tried)}", flush=True)
    return s


def _fetch(s: cc.Session, url: str, tries: int = 3) -> tuple[Optional[int], Optional[str]]:
    """(status, body). The status survives, so a page that said 404/410 (gone) is told apart from
    one we could not read (None — UNKNOWN, LISTING_LIVENESS.md §1)."""
    for attempt in range(tries):
        try:
            r = s.get(url)
            if r.status_code == 200:
                return 200, r.text
            if r.status_code in GONE_STATUSES:
                return r.status_code, None
        except Exception:
            pass
        time.sleep(1.5 * (attempt + 1))
    return None, None


GONE_STATUSES = (404, 410)


def _why_unreadable(s: cc.Session, url: str) -> str:
    """One more read whose only job is to NAME the failure for the run's notes. 2026-10-13: every
    route failed with CertificateVerifyError and the notes could not tell an expired certificate
    from a wrong host or a missing intermediate, which need different fixes."""
    try:
        r = s.get(url)
        return f"HTTP {r.status_code}"
    except Exception as e:  # noqa: BLE001 — the reason is the point
        return f"{type(e).__name__}: {str(e)[:220]}"


class IndexUnreadable(RuntimeError):
    """The catalogue's first index page could not be read: a failed fetch, never «0 listings»."""


def _get(s: cc.Session, url: str, tries: int = 3) -> Optional[str]:
    return _fetch(s, url, tries)[1]


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
    # «على السوم» with no figure (~10% of the catalog) → NULL, never 0. A NEGATIVE figure is the same placeholder:
    # nid 7132 prints «على السوم | -2 ريال» and to_int drops the sign, so it was served as a 2 SAR plot (2026-10-18).
    if re.match(r"\s*[-−–]\s*\d", txt):
        amount = None
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


# ── LIVENESS ORACLE (wired 2026-10-07, ♻️) ─────────────────────────────────────────────────────
# prune_unseen ran WITHOUT a verify_gone here, so an ad missing from three crawls was hidden with no
# reading of its own page (P1 unknown_treated_as_dead, 1 hide on 2026-10-07 05:00 UTC). The crawl
# itself already reads a removed ad's own page as 404/410 (`_detail` → {"gone": status}, crawler
# audit 2026-10-02), so the same reading now decides the kill: 404/410 → gone; 200 on the ad's own
# /{nid} whose <article> carries this nid → live; anything else → no answer. Same shape as arkaan
# (2026-10-06, proven in production 2026-10-07: 7 of 7 hides carried a GONE row).
def _oracle_signal(status, body, moved) -> Optional[str]:
    if status in GONE_STATUSES:
        return "gone"
    return "live" if status == 200 and not moved and _ARTICLE.search(body or "") else None


def _oracle_url_for(ad_number: str) -> Optional[str]:
    m = re.fullmatch(r"ABR(\d+)", ad_number or "")
    return f"{BASE}/{m.group(1)}" if m else None


def _make_verify_gone(control: Optional[dict]):
    """verify_gone for db.prune_unseen. A 404/410 is believed only while a known-live ad from this
    run (`control`) still reads live through the same session."""
    s = _session()

    def probe(ad_number: str, canary=None):
        return LivenessProbe(platform="abralosol", signal=_oracle_signal, session=lambda: s,
                             url_for=_oracle_url_for, canary=canary).verify_gone(ad_number)

    def canary() -> tuple[bool, str]:
        if not control:
            return False, "no row from this run to use as a positive control"
        verdict, why = probe(control["ad_number"])
        return verdict == "live", f"positive control {control['ad_number']}: {why}"

    return lambda ad_number: probe(ad_number, canary=canary)


# ── detail page ─────────────────────────────────────────────────────────────────────────────────
def _detail(s: cc.Session, nid: str) -> dict:
    """{title, blocks, description, photo_urls, label} from /{nid}. Empty dict if unfetchable;
    {"gone": status} when the ad's own page answered 404/410."""
    status, page = _fetch(s, f"{BASE}/{nid}")
    if status in GONE_STATUSES:
        return {"gone": status}
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
        # The «الموقع» link: google.com/maps/place/LAT,LNG, or a maps.app.goo.gl short link that is
        # followed by redirect (measured 2026-10-19: ad 7890 carries only the short form).
        # The ad's OWN article only (audit 2026-10-21): the page below it lists other ads, each with its own
        # maps/place link, and reading the whole page stored a NEIGHBOUR's pin — 95 «الراشدية» ads shared one.
        "pin": pin_from_html(body) or pin_from_short_link(short_maps_link(body), lambda u: resolve_redirect(s, u)),
    }


# ── mapping ─────────────────────────────────────────────────────────────────────────────────────
def _city(district: Optional[str], text: Optional[str] = None) -> tuple[Optional[str], Optional[str], str]:
    """(city, region, basis). See OTHER_CITY_TOKENS for why the table is small and explicit, and
    MUBARRAZ_DISTRICTS for the two المبرز bases."""
    d = (district or "").strip()
    if d and not d.startswith(_STREETY):
        for token, city in OTHER_CITY_TOKENS:
            if token in d:
                return city, N.region_for_city(city), "district_token"
    t = text or ""
    if "المبرز" in t and "الهفوف" not in t:
        return MUBARRAZ_CITY, MUBARRAZ_REGION, "ad_text"
    if d and _DISTRICT_SUFFIX.sub("", d).removeprefix("حي ").strip() in MUBARRAZ_DISTRICTS:
        return MUBARRAZ_CITY, MUBARRAZ_REGION, "district_mubarraz"
    if _OTHER_REGION.search(d + " " + t):
        # The ad places itself outside Al-Ahsa: the office default would file it in the WRONG city.
        return None, None, "names_other_region"
    return OFFICE_CITY, N.region_for_city(OFFICE_CITY), "office_default"


# The office also sells outside Al-Ahsa. 17994690 (2026-10-16) «أرض للبيع في مدينة الروضة – حائل … بمنطقة حائل»
# took office_default and was served to customers searching الهفوف. An ad that names a place in another
# REGION never takes the office's city: unknown is honest, a Hofuf filing is wrong (🆕 backlog #588).
# الرياض / مكة / المدينة are absent for the reason OTHER_CITY_TOKENS gives: here they are Al-Ahsa street
# and district names; «المدينة المنورة» is the unambiguous form.
_OTHER_REGION = re.compile(r"(حائل|القصيم|بريدة|عنيزة|تبوك|جازان|نجران|الباحة|الجوف|عسير|أبها|ابها|"
                           r"المدينة المنورة|جدة|الطائف|خميس مشيط|ينبع)")


# ── DISTRICT FROM THE TITLE (2026-10-18) ────────────────────────────────────────────────────────
# 96 live rows (92 الهفوف + 4 المبرز, both tables) carried an EMPTY tags cell while their own h1 named
# the district («بيت جاهز للبيع في الراشديةأ», «أرض للبيع في الحي الخامس ضاحية هجرج»). The title may fill `neighborhood` ONLY where a whole slice of it keys EXACTLY to
# a district already attested for THAT city: the catalogue (loc_catalog_district) plus the districts
# this office's own tags cell already published for the city. Both sides use norm_district_tok — the
# ONE key district_norm is built with (ة/ه, ى/ي, أإآ/ا, leading «حي »/«ال», end digits folded) — so
# «الغسانيه» finds «الغسانية». The site glues the plot's BLOCK LETTER to the district («الراشديةأ» ×12,
# «ضاحية هجرد» ×6, «الحي الثانيج»): one trailing أ/ب/ج/د is split off the last word before the same
# exact comparison. Nothing else bends: no edit distance («ضاحية هجرة» is nothing), no prefix, no
# fragment, no guess. The stored value is the title's own slice as written («حي الراجحي» keeps its
# «حي »), never the catalogue spelling. Computed AFTER _city() and never fed back into it: the title
# district names the neighbourhood, not the town.
_CITY_AR = {OFFICE_CITY: "الهفوف", MUBARRAZ_CITY: "المبرز", **{city: tok for tok, city in OTHER_CITY_TOKENS}}
_TITLE_WORD = re.compile(r"[\u0621-\u064a]+")   # Arabic letters only: a plot number never joins a name
_BLOCK_LETTERS = "أبجد"                          # a plot's block letter, glued: «الراشديةأ», «ضاحية هجرج»
_MAX_DISTRICT_WORDS = 4                          # «حي» + a three-word name; the taxonomy has nothing longer
_PLAN_WORD = "مخطط"                              # «مخطط الرياض» is a subdivision plan, never the الرياض district
# A town's own name is never its district: «شمال المبرز» (6997) is a direction from a city, and this
# office's tags cell has filed «الهفوف» / «الاحساء» as a neighbourhood before.
_CITY_KEYS = frozenset(AL.norm_district_tok(ar) for ar in (*_CITY_AR.values(), "الأحساء"))


@lru_cache(maxsize=None)
def _known_districts(city: str) -> frozenset[str]:
    """norm_district_tok keys attested for `city`: the catalogue's districts for that town plus every
    district this office's own tags cell already published there (both abralosol tables). Fetched
    lazily, once per city per run. A failed lookup logs once and answers EMPTY — the title then fills
    nothing, exactly as before — never a crash. ponytail: the empty answer is cached for the run too,
    so an outage costs one log line, not one failed query per row."""
    try:
        cid, _ = AL.to_catalog(_CITY_AR.get(city), region_hint=N.region_for_city(city) or MUBARRAZ_REGION)
        keys = set(AL.catalog_district_keys(cid))
        for tbl in ("abralosol_residential_listings", "abralosol_commercial_listings"):
            for lo in range(0, 50_000, 1000):          # PostgREST serves at most 1,000 rows a page
                page = db._execute(db.sb().table(tbl).select("neighborhood").eq("city", city)
                                   .range(lo, lo + 999), what=f"{tbl}.known_districts").data or []
                keys.update(AL.norm_district_tok(r["neighborhood"]) for r in page if r.get("neighborhood"))
                if len(page) < 1000:
                    break
        keys.discard("")
        return frozenset(keys)
    except Exception as e:  # noqa: BLE001 — degrade to «no district», never crash the crawl
        print(f"⚠ known-district lookup failed for {city}: {str(e)[:160]} — titles fill no district this run",
              flush=True)
        return frozenset()


def _title_district(title: Optional[str], known: frozenset[str]) -> Optional[str]:
    """The title's OWN slice whose norm_district_tok key is in `known` — longest window first, so
    «حي الراجحي» beats «الراجحي» and «ضاحية هجر» beats «هجر». Exact key equality only: no edit
    distance, no prefix («الراجحية» ≠ «الراجحي»), no fragment of a longer known name; a plan's name
    («مخطط الرياض») and a town's name («شمال المبرز») are never a district. Else None."""
    if not title or not known:
        return None
    words = list(_TITLE_WORD.finditer(title))
    for size in range(min(_MAX_DISTRICT_WORDS, len(words)), 0, -1):
        for i in range(len(words) - size + 1):
            window = [w.group() for w in words[i:i + size]]
            if _PLAN_WORD in window or (i and words[i - 1].group() == _PLAN_WORD):
                continue                       # a plan's name is the plan's, not a district's
            span = title[words[i].start():words[i + size - 1].end()]
            # As written first, then with a glued block letter split off the last word. Still exact:
            # the de-glued span must itself key to a known name.
            deglued = span[:-1] if len(window[-1]) > 1 and span[-1] in _BLOCK_LETTERS else ""
            for cand in (span, deglued):
                key = AL.norm_district_tok(cand) if cand else ""
                if key and key in known and key not in _CITY_KEYS:
                    return cand
    return None


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
        # the marker AFTER the figure too: nid 7472 «الحد 1,650 ريال» and its body «بسعر 1,650 ريال للمتر» (2026-10-18)
        if N.stated_per_metre(block, amount):
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
        if transaction_type == "Buy":
            price_total = db.AUTHORITATIVE_NULL     # the source settled «a rate, no total»: clears a stored total
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
    elif amount is None and p.get("label") == "على السوم":
        price_total = db.AUTHORITATIVE_NULL         # «على السوم», open to offers: the source states no price
    # amount with NO basis label anywhere (2/100 sampled) stays NULL in BOTH price columns: the
    # source published a number but not what it means, and a total is a different fact from a rate.
    # rent_period is still recorded when the body states it — the period is a fact about the LEASE,
    # not about which column the number lands in.

    city, region, city_basis = _city(
        ix["district"], f"{detail.get('title') or ''} {detail.get('description') or ''}")
    if city_basis == "names_other_region":
        # The ad itself settles that the office city is wrong. A plain None is dropped by
        # db._unknown_must_not_overwrite_known, so a row already filed under الهفوف stayed there
        # (17994690 re-crawled 10-17 05:55: still Hofuf). AUTHORITATIVE_NULL writes the unknown.
        city, region = db.AUTHORITATIVE_NULL, db.AUTHORITATIVE_NULL
    district, district_from = ix["district"], None
    if not district and detail.get("title") and isinstance(city, str):
        # Tags cell empty → the h1, exact match only (see _title_district). AFTER _city(), so the
        # city rules above are untouched; this fills neighborhood/district_ar and nothing else.
        district = _title_district(detail["title"], _known_districts(city))
        district_from = "title" if district else None
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
        "neighborhood": district,
        "area_m2": N.to_int(ix["area_raw"]),
        # The index cell «شارع 40» is the site's structured street width. It was kept only in
        # additional_info, so 1,890 ads (1,526 of 1,653 lands) answered no street-width question
        # (🔬 2026-10-10). One number → metres; «15+15» is two streets → NULL, never a pick.
        "street_width_m": N.one_street_width(ix["street_width"]),
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
            **(detail.get("pin") or {}),
            # The ad's own article WAS read and carries no pin (audit 2026-10-21). keep_stored_pin keeps an old
            # pin only for a write that does not say this, so a failed short-link hop still keeps its pin while a
            # neighbour's pin stored before the article-only fix can finally leave.
            **({"pin_absent": True} if detail and not detail.get("pin") else {}),
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
            "district_ar": district,
            "district_from": district_from,   # "title" only when the h1 filled it
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
    # Amenities: abralosol publishes NO structured amenity field (DOM only, fact blocks carry area /
    # street / age / price), so the ad's own prose is the only source (ADVANCED_FILTER_SOURCE_TRUTH
    # §2): yes or nothing, never no. 535 built ads named a kitchen / parking / maid room while all
    # 2,803 stored NULL (🔬 2026-10-10, ops_af_score abralosol kitchen we_miss). Land and farms are
    # skipped: «شرقا مواقف سيارات» on a plot describes a neighbour, not the property.
    if not property_type.endswith("Land") and property_type != "Farm":
        row.update(N.prose_amenities(detail.get("description"), skip=_PROSE_SKIP))
    return row, N.category_for_type(property_type).lower()


# Read from prose never: fibre is a neighbourhood service line, furnished is a rent-time fact.
_PROSE_SKIP = ("optical_fibers", "furnished")


# ── crawl ───────────────────────────────────────────────────────────────────────────────────────
def crawl(limit: int = 0, want_detail: bool = True) -> tuple[list[dict], list[dict], int, dict]:
    s = _session()
    res: list[dict] = []
    com: list[dict] = []
    seen: set[str] = set()
    stats = {"rows": 0, "skipped_no_deal": 0, "skipped_no_type": 0, "no_price": 0,
             "per_sqm": 0, "unlabelled_price": 0, "detail_failed": 0, "detail_gone": 0, "pages": 0}

    for page in range(MAX_PAGES):
        html = _get(s, f"{BASE}/node?page={page}")
        if html is None:
            # An index page we could not READ is not the end of the catalogue (A FAILED FETCH IS
            # NOT AN EMPTY ANSWER). Page 0 unreadable = the run failed, said so in its notes; a
            # later page = keep what was read and mark the crawl incomplete so nothing is pruned.
            if page == 0:
                raise IndexUnreadable(f"index page 0 unreadable ({BASE}/node?page=0): {_why_unreadable(s, f'{BASE}/node?page=0')}")
            stats["incomplete"] = f"index page {page} unreadable"
            break
        recs = _index_rows(html)
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
            if detail.get("gone"):
                # Its OWN page said gone in this very run: never write it active from the index row
                # (crawler audit 2026-10-02). Left out of the seen set, prune_unseen's 3-strike guard
                # ages it out; one reading hides nothing.
                stats["detail_gone"] += 1
                time.sleep(DETAIL_PAUSE)
                continue
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
            if want_detail and not detail:
                db.mark_presence_unproven(row)      # its own page was not read this run: no stamp
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
        # An ad whose category flipped this run is superseded in the table it LEFT. Runs BEFORE
        # prune_unseen: that helper reasons from ABSENCE one table at a time and its circuit
        # breakers protect the orphan rather than age it out, after which verify_gone asks "is
        # this URL live?" — it is, in the sibling table — so the orphan never dies and the same
        # ad renders as TWO cards on one URL. No-ops unless a flip actually happened this run.
        superseded = db.retire_superseded_siblings(
            res_table="abralosol_residential_listings", com_table="abralosol_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")

        verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
        for tbl, rows_seen in (() if stats.get("incomplete") else
                               (("abralosol_residential_listings", res),
                                ("abralosol_commercial_listings", com))):
            nn = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source=SOURCE,
                                 verify_gone=verify_gone)
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
