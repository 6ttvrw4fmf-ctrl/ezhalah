"""1000 العقارية (1000.com.sa) — a Riyadh property-management company letting its OWN managed units
(apartments + a few offices), monthly or annual. Everything below was MEASURED live on 2026-09-23
over the whole catalogue (105 units).

WHAT THE SITE IS. A Next.js app whose /offers page is fully SERVER-RENDERED: one plain GET returns
all 105 `<article class="card">` cards (no pagination — `?page=2` returns the same 105; the page's
own counter «<b class="num">105</b> وحدة متاحة» is the completeness check and matched the card
count exactly). Each card carries: href `/property/{cuid}` · badges «للإيجار» + the type («شقة» 101,
«مكتب» 4) · `<h3>` title «مشروع: S247 - وحدة 102» · a location line · a price `<b class="num">` +
unit «ريال / شهرياً» (30) | «ريال / سنوياً» (62) | «السعر عند الطلب» (13) · feature chips
(«N غرف», «N دورات مياه», «صالة», «مطبخ», «مدخل», «تراس», once «N م²») · a cover image.
The detail page /property/{cuid} (200 without the card's `?source=estate`) adds: «رقم ترخيص
الإعلان» (the AD licence, `<p class="adlic">`), a `<div class="specs">` block with labelled «غرف نوم» /
«دورات مياه» counts, a «المواصفات» list of «label: value» rows («الدور: 2», «صالة: 1», «المداخل: 1»,
«المطبخ: نعم», «تراس: 1»), a gallery of `/uploads/*.webp`, and `<h3>` description sections
(«تفاصيل الوحدة», sometimes «نبذة عن المشروع», «الموقع والخدمات القريبة», «مميزات المبنى»,
«الخدمات المشمولة»). sitemap.xml lists no property URLs. No JSON API was found; the RSC stream
carries the same React trees as the HTML.

THE TRAPS, EACH MEASURED:
1. STOCK PHOTOS. 86 of 105 cards (and their detail galleries) show ONE Unsplash stock photo
   (photo-1545324418-cc1a3fa10c00) as the cover; only `/uploads/` paths on the site's own host are
   the unit's own photos (19 cards; one fetched: 200 image/webp 25,904 B). OWNER DECISION
   2026-09-24: the cover the site shows IS the listing photo we show — a visitor to 1000.com.sa sees
   exactly that picture on the card — so it is kept, never excluded (it was excluded at build).
2. PERIOD IS IN THE UNIT TEXT, NOT THE NUMBER. «6500 ريال / شهرياً» → monthly, ×12 through the
   shared rent_period_and_annual; «75,000 ريال / سنوياً» → annual verbatim. «السعر عند الطلب» is
   the source's own "on request": both price columns NULL, the phrase kept in additional_info.
   No per-metre price exists on this source.
3. TWO LOCATION SHAPES. «الرياض، القيروان، الشيخ عبدالله بن جبرين» = city، district، street (68
   cards) and «الرياض - الازدهار» = city - district (28 cards; also «الدمام - الشهداء», «احد رفيده -
   الورود»). The first part is the city and must be accepted by to_catalog() or the row is skipped;
   the second is the district (raw → neighborhood, canonical → district_ar via
   find_district_in_text); the third is the street (additional_info.street).
4. «N غرف» ON THE CARD IS «N غرف نوم» ON THE DETAIL. Bedrooms/bathrooms are read from the detail's
   labelled specs block, for dwellings only: the office detail prints «0 غرف نوم / 0 دورات مياه» —
   a form default, never a fact about an office. Three of the 101 apartments (cmnh40o6b004410i81ldl02p4,
   cmnh40o6a004210i8x65oob12, cmnh40o64003q10i8j6etd0n1) print the same «0 / 0» while their unit
   text names no room at all — a dwelling with zero bathrooms is the unfilled form, so BOTH stay
   NULL (the printed zeros survive in additional_info.specs). A lone 0 beside a real count is kept.
5. THE PROJECT BLURB CARRIES AGENT NAMES. «نبذة عن المشروع» is shared marketing copy ending in a
   contact block («0538241000 (أسامه)» …) — phones AND personal names. It is not stored at all
   (PDPL); the description is the unit's own «تفاصيل الوحدة» plus the building-features and
   included-services lines, then redact_pii. That blurb also says «وحدات سكنية مؤثثة» about the
   PROJECT, not this unit, so furnished stays NULL unless the unit's own text says it.
6. «المطبخ» IS SOMETIMES «نعم». Spec values are integers or نعم/لا; a count ≥1 or نعم → True,
   0/لا → False, absent → NULL. «المداخل» (entrances) is NOT private_entrance — an entrance count
   says nothing about it being private — so it stays in additional_info only.
7. NO SALE, NO SOLD MARKER TODAY: all 105 are «للإيجار». The retired/auction guard is kept: a card
   whose badge or title says مؤجر/مباع/مزاد must never be published.
8. A DETAIL STALL MUST NOT KILL THE WHOLE CRAWL (reviewer-caught 2026-09-24, reproduced live on
   the first try: a bare `s.get(/property/{id})` raised `curl_cffi…Timeout` after 0 bytes). This
   is the SAME host flake fetch_offers already retries — fetch_detail now retries it the same way
   (3 attempts, 2s·n backoff) and, if it never recovers, falls through to the ordinary
   detail_fetch_failed tally instead of raising out of crawl()'s loop and discarding every row the
   run had already mapped.

REMOVAL ORACLE (measured 2026-09-23): the site answers a REAL HTTP 404 (a themed 23 KB page) for an
id it does not serve — 3/3 mutated cuids (…ezr2z, …ezr2a, «doesnotexist») — and HTTP 200 carrying
`data-listing-id="{cuid}"` for 6/6 distinct live controls in the probe and 105/105 detail pages in
the full crawl (0 detail_fetch_failed). Signal: 404 → gone; 200 whose body echoes THIS
listing's own data-listing-id → live; anything else → no opinion (the shared law refuses a death on
403/429/5xx/timeout/empty). Removals are canary-gated on one live control re-fetched in-run (fails
CLOSED) and prune runs only after a COMPLETE enumeration (cards == the page's printed counter).

MEASURED COVERAGE 2026-09-23 (all 105 cards + 105 detail pages, 383 s at a 0.5 s pause; the
location catalog read through the public anon key, read-only). 105 mapped (101 residential + 4
commercial offices), 0 skipped. All Rent: annual 62, monthly 30, «السعر عند الطلب» 13 (NULL price,
NULL period). Cities: الرياض 96, الدمام 8, احد رفيده 1.
    title 105  description 105  city_id 105  district_ar 97  neighborhood 105  license_number 42
    bedrooms 100  bathrooms 100 (101 apartments; the 4 offices carry none)  floor_number 98
    halls 88  kitchen 65  parking 42  elevator 41  balcony_terrace 12  air_conditioner 7
    price_annual 92  rent_period 92  photo_urls 19 (the other 86 show only the Unsplash stock photo)
    area_m2 1  source-does-not-publish: property_age, street width, direction, furnished (only the
    project blurb says «مؤثثة»), maid/driver room, electricity/water/sanitation, price_total,
    price_per_meter, latitude (a Google-Maps iframe only)
    PII: 0 free-text hits over every stored field; 0 agent names (the blurb is never stored).

    python -m scrapers.thousand.run --type all --limit 10 --dry-run   # validate, zero DB writes
    python -m scrapers.thousand.run --type all                        # full crawl + prune
"""
from __future__ import annotations

import argparse
import html as html_mod
import re
import sys
import time
from pathlib import Path
from typing import Any, Callable, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize as N  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii  # noqa: E402

BASE = "https://1000.com.sa"
SOURCE = "1000 العقارية"
PREFIX = "ALF"
PLATFORM = "thousand"
RES_TABLE = "thousand_residential_listings"
COM_TABLE = "thousand_commercial_listings"
OFFERS_URL = f"{BASE}/offers"
DETAIL_PAUSE = 0.5

TYPE_OVERRIDES: dict[str, str] = {}          # «شقة»/«مكتب» resolve through the shared map as-is
DWELLING_TYPES = {"Apartment", "Villa", "Duplex", "Studio", "Floor", "Room", "Rest House", "Chalet"}
RETIRED_TOKENS = ("مزاد", "مباع", "تم البيع", "مؤجر", "تم التأجير", "تم الإيجار", "تم الايجار", "محجوز")
_YES = ("نعم", "يوجد", "متوفر")
_NO = ("لا", "لايوجد", "لا يوجد", "غير متوفر")

# Description sections kept (trap 5). «نبذة عن المشروع» and «الموقع والخدمات القريبة» are project
# copy, the first with agent names — never stored.
DESC_SECTIONS = ("تفاصيل الوحدة", "مميزات المبنى", "الخدمات المشمولة")


def session() -> cc.Session:
    # impersonate OWNS the User-Agent (feedback_impersonate_owns_the_user_agent).
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


def _txt(fragment: Optional[str]) -> str:
    if not fragment:
        return ""
    s = re.sub(r"<svg.*?</svg>", " ", fragment, flags=re.S)
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"<!--.*?-->", "", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html_mod.unescape(s)
    s = re.sub(r"[ \t ]+", " ", s)
    return "\n".join(ln.strip() for ln in s.split("\n") if ln.strip()).strip()


def _abs(u: str) -> str:
    return u if u.startswith("http") else BASE + u


# ── OFFERS PAGE ─────────────────────────────────────────────────────────────────────────────────
_TOTAL_RE = re.compile(r'<b class="num">([0-9٠-٩,]+)</b>\s*وحدة متاحة')
_HREF_RE = re.compile(r'href="/property/([A-Za-z0-9]+)')
_H3_RE = re.compile(r"<h3>(.*?)</h3>", re.S)
_CHIP_RE = re.compile(r'<span class="chip[^"]*">([^<]*)</span>')
_LOC_RE = re.compile(r'<div class="loc">(.*?)</div>', re.S)
_PRICE_RE = re.compile(r'<div class="price">(.*?)</div>', re.S)
_NUM_RE = re.compile(r'<b class="num"[^>]*>([^<]*)</b>')
_FEAT_RE = re.compile(r'<span class="f">(.*?)</span>', re.S)
_IMG_SRC_RE = re.compile(r'<img[^>]+src="([^"]+)"')


def _price_parts(fragment: str) -> tuple[Optional[str], Optional[str]]:
    """(number text, unit/label text) from a card `.price` or detail `.dprice` block."""
    m = _NUM_RE.search(fragment)
    num = _txt(m.group(1)) if m else None
    rest = _txt(_NUM_RE.sub(" ", fragment, count=1)) if m else _txt(fragment)
    return (num or None), (rest or None)


def parse_offers(page_html: str) -> tuple[list[dict], Optional[int]]:
    """Every card on /offers, verbatim, plus the page's OWN «N وحدة متاحة» counter."""
    m_total = _TOTAL_RE.search(page_html)
    total = N.to_int(m_total.group(1)) if m_total else None
    cards: list[dict] = []
    seen: set[str] = set()
    for block in page_html.split('<article class="card')[1:]:
        block = block.split("</article>")[0]
        m_id = _HREF_RE.search(block)
        if not m_id or m_id.group(1) in seen:
            continue
        seen.add(m_id.group(1))
        m_h3, m_loc, m_price, m_img = (_H3_RE.search(block), _LOC_RE.search(block),
                                       _PRICE_RE.search(block), _IMG_SRC_RE.search(block))
        num, unit = _price_parts(m_price.group(1)) if m_price else (None, None)
        cards.append({
            "pid": m_id.group(1),
            "title": _txt(m_h3.group(1)) if m_h3 else None,
            "chips": [_txt(c) for c in _CHIP_RE.findall(block)],
            "loc": _txt(m_loc.group(1)) if m_loc else None,
            "price_num": num,
            "price_unit": unit,
            "feats": [_txt(f) for f in _FEAT_RE.findall(block)],
            "thumb": html_mod.unescape(m_img.group(1)) if m_img else None,
        })
    return cards, total


def fetch_offers(s: cc.Session, limit: int = 0, attempts: int = 3) -> tuple[list[dict], Optional[int]]:
    """/offers is a 1 MB server-rendered page and the host stalls mid-body now and then (measured:
    one 60 s timeout after 27 KB, then a clean 200). A stalled read is retried, never read as empty."""
    last: Optional[Exception] = None
    for attempt in range(attempts):
        try:
            r = s.get(OFFERS_URL, timeout=120)
        except Exception as e:  # noqa: BLE001 — a transport stall is not an empty catalogue
            last = e
            time.sleep(2.0 * (attempt + 1))
            continue
        if r.status_code != 200:
            raise RuntimeError(f"/offers answered HTTP {r.status_code}")
        cards, total = parse_offers(r.text)
        return (cards[:limit] if limit else cards), total
    raise RuntimeError(f"/offers unreachable after {attempts} attempts: {last}")


# ── DETAIL PAGE ─────────────────────────────────────────────────────────────────────────────────
_H1_RE = re.compile(r"<h1>(.*?)</h1>", re.S)
_BADGE_RE = re.compile(r'<span class="badge[^"]*">([^<]*)</span>')
_LIC_RE = re.compile(r'رقم ترخيص الإعلان</span>\s*<b[^>]*>([^<]*)</b>')
_DPRICE_RE = re.compile(r'<div class="dprice"><div>(.*?)</div>', re.S)
_PTAG_RE = re.compile(r'<div class="ptag">(.*?)</div>', re.S)
_SPEC_RE = re.compile(r'<div class="spec">(.*?)</div>', re.S)
_SPEC_PARTS_RE = re.compile(r'<b class="num">([^<]*)</b>\s*<span>([^<]*)</span>')
_ATTR_RE = re.compile(r'<div class="a">.*?<span>(.*?)</span>\s*</div>', re.S)
_SECTION_RE = re.compile(r"<h3>([^<]*)</h3>\s*<p class=\"desc-body\">(.*?)</p>", re.S)
_GALLERY_RE = re.compile(r'<div class="gallery">(.*?)<div class="dhead">', re.S)
_LISTING_ID_RE = re.compile(r'data-listing-id="([A-Za-z0-9]+)"')


def parse_detail(page_html: str) -> dict:
    """Everything the detail page publishes, verbatim. No interpretation here."""
    m_h1, m_loc, m_lic, m_dprice = (_H1_RE.search(page_html), _LOC_RE.search(page_html),
                                    _LIC_RE.search(page_html), _DPRICE_RE.search(page_html))
    num, unit = _price_parts(m_dprice.group(1)) if m_dprice else (None, None)
    specs: dict[str, str] = {}
    for spec in _SPEC_RE.findall(page_html):
        m = _SPEC_PARTS_RE.search(spec)
        if m:
            specs[_txt(m.group(2))] = _txt(m.group(1))
    attrs: dict[str, str] = {}
    for a in _ATTR_RE.findall(page_html):
        t = _txt(a)
        if ":" in t:
            k, v = t.split(":", 1)
            attrs[k.strip()] = v.strip()
    sections = {_txt(h): _txt(body) for h, body in _SECTION_RE.findall(page_html)}
    photos: list[str] = []
    m_gal = _GALLERY_RE.search(page_html)
    for u in _IMG_SRC_RE.findall(m_gal.group(1) if m_gal else ""):
        u = _abs(html_mod.unescape(u))
        if u not in photos:                                                  # trap 1: kept, as shown
            photos.append(u)
    m_ids = _LISTING_ID_RE.search(page_html)
    return {
        "pid": m_ids.group(1) if m_ids else None,
        "title": _txt(m_h1.group(1)) if m_h1 else None,
        "badges": [_txt(b) for b in _BADGE_RE.findall(page_html)],
        "loc": _txt(m_loc.group(1)) if m_loc else None,
        "license": _txt(m_lic.group(1)) if m_lic else None,
        "price_num": num,
        "price_unit": unit,
        "ptags": [_txt(p) for p in _PTAG_RE.findall(page_html)],
        "specs": specs,
        "attrs": attrs,
        "sections": sections,
        "photos": photos,
    }


def fetch_detail(s: cc.Session, pid: str, attempts: int = 3) -> Optional[dict]:
    """Same host, same documented stall as /offers (fetch_offers) — retried the same way. A stall
    that never recovers falls through as a plain miss (detail_fetch_failed), same as a real 404;
    it must NEVER propagate out of crawl() and discard the whole 105-card run's already-mapped
    rows."""
    r = None
    for attempt in range(attempts):
        try:
            r = s.get(f"{BASE}/property/{pid}", timeout=45)
            break
        except Exception:  # noqa: BLE001 — a transport stall is not "gone", it's retried
            if attempt == attempts - 1:
                return None
            time.sleep(2.0 * (attempt + 1))
    # A themed 404 is still a fully parseable page: the STATUS decides, never "did we find fields".
    if r.status_code != 200:
        return None
    d = parse_detail(r.text)
    return d if d["title"] else None


# ── MAPPING ─────────────────────────────────────────────────────────────────────────────────────
def _split_loc(loc: Optional[str]) -> list[str]:
    """«الرياض، الملقا، وادي نوار» → [city, district, street]; «الرياض - الازدهار» → [city, district]."""
    if not loc:
        return []
    return [p.strip() for p in re.split(r"،|,|\s+-\s+", loc) if p.strip()]


def _yes_no_count(v: Optional[str]) -> Optional[bool]:
    """«نعم»/«1»/«2» → True, «لا»/«0» → False, absent → None (trap 6)."""
    if v is None:
        return None
    t = v.strip()
    if t in _YES:
        return True
    if t in _NO:
        return False
    n = N.to_int(t)
    return None if n is None else n > 0


def _int_keep_zero(v: Optional[str]) -> Optional[int]:
    if v is None or not re.fullmatch(r"\s*[0-9٠-٩]+\s*", v):
        return None
    return int(v.strip().translate(N._TRANS))


def _amenities(lines: list[str]) -> dict[str, bool]:
    """Shared matcher per line, merged; a column whose lines disagree is dropped to NULL."""
    seen: dict[str, set[bool]] = {}
    for line in lines:
        for col, val in N.amenities_from_text(line).items():
            seen.setdefault(col, set()).add(val)
    return {col: next(iter(vals)) for col, vals in seen.items() if len(vals) == 1}


_PROJECT_RE = re.compile(r"مشروع\s*:\s*(.+?)\s*-\s*وحدة\s*(\S+)")


def map_listing(card: dict, detail: Optional[dict]) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason). row is None exactly when the source leaves it unpublishable."""
    detail = detail or {}
    pid = card.get("pid")
    if not pid:
        return None, "residential", "missing_id"
    title = detail.get("title") or card.get("title")
    badges = detail.get("badges") or card.get("chips") or []
    haystack = " ".join([title or "", *badges])
    if any(tok in haystack for tok in RETIRED_TOKENS):
        return None, "residential", "retired_or_auction"

    type_ar = next((b for b in badges if b not in ("للإيجار", "للبيع")), None)
    property_type = N.map_type_exact(type_ar, TYPE_OVERRIDES) if type_ar else None
    if not property_type:
        return None, "residential", "type_unmapped"
    category = N.category_for_type(property_type).lower()

    if "للإيجار" in badges:
        transaction_type = "Rent"
    elif "للبيع" in badges:
        transaction_type = "Buy"
    else:
        return None, category, "no_deal_stated"

    parts = _split_loc(detail.get("loc") or card.get("loc"))
    if not parts:
        return None, category, "city_missing"
    city_raw, district_raw = parts[0], (parts[1] if len(parts) > 1 else None)
    street = parts[2] if len(parts) > 2 else None
    city_id, region_id = to_catalog(city_raw)
    if not city_id:
        return None, category, "city_not_in_catalog"
    district_ar = find_district_in_text(district_raw, city_id) if district_raw else None

    # PRICE: the detail's own block first, the card second — same number, same unit text.
    num_txt = detail.get("price_num") or card.get("price_num")
    unit_txt = detail.get("price_unit") or card.get("price_unit") or ""
    amount = N.to_int(num_txt) if num_txt and re.search(r"[0-9٠-٩]", num_txt) else None
    price_total = price_annual = rent_period = None
    price_note = None
    if amount is None:
        price_note = (num_txt or unit_txt or "").strip() or None      # «السعر عند الطلب»
    elif transaction_type == "Rent":
        rent_period, price_annual = N.rent_period_and_annual(amount, unit_txt)  # trap 2
    else:
        price_total = amount

    specs: dict[str, str] = detail.get("specs") or {}
    attrs: dict[str, str] = detail.get("attrs") or {}
    sections: dict[str, str] = detail.get("sections") or {}
    dwelling = property_type in DWELLING_TYPES
    desc_lines = [sections[k] for k in DESC_SECTIONS if sections.get(k)]
    description = redact_pii("\n".join(
        (f"{k}: {sections[k]}" if k != "تفاصيل الوحدة" else sections[k])
        for k in DESC_SECTIONS if sections.get(k))) if desc_lines else None
    amen = _amenities(desc_lines)
    for col, key in (("kitchen", "المطبخ"), ("balcony_terrace", "تراس")):
        v = _yes_no_count(attrs.get(key))
        if v is not None:
            amen[col] = v                     # the unit's own labelled row beats prose

    rooms = [N.to_int(specs.get(k)) if dwelling and specs.get(k) else None
             for k in ("غرف نوم", "دورات مياه")]
    if rooms == [0, 0]:
        rooms = [None, None]                                              # trap 4: the unfilled form
    photos = list(detail.get("photos") or [])
    thumb = card.get("thumb")
    if not photos and thumb:
        photos = [_abs(thumb)]

    m_proj = _PROJECT_RE.search(title or "")
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": f"{BASE}/property/{pid}",
        "source": SOURCE,
        "active": True,
        "title": title or None,
        "description": description,
        "property_type": property_type,
        "transaction_type": transaction_type,
        "city": N.map_city(city_raw),
        "city_ar": city_raw,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": next((N.to_int(f) for f in card.get("feats") or [] if "م²" in f), None),
        "bedrooms": rooms[0],
        "bathrooms": rooms[1],
        "floor_number": _int_keep_zero(attrs.get("الدور")),
        "halls": N.to_int(attrs.get("صالة")) if attrs.get("صالة") else None,
        "license_number": detail.get("license") or None,
        **amen,
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": None,
        "rent_period": rent_period,
        # A FAILED detail fetch is not "no photos": send None so the no-clobber guard keeps a list.
        "photo_urls": photos[:20] if detail else None,
        "additional_info": redact_capture({k: v for k, v in {
            "project": m_proj.group(1).strip() if m_proj else None,
            "unit": m_proj.group(2).strip() if m_proj else None,
            "type_ar": type_ar,
            "street": street,
            "price_note": price_note,
            "price_tags": detail.get("ptags") or None,
            "specs": attrs or None,
            "card_features": card.get("feats") or None,
            "building_features": sections.get("مميزات المبنى"),
            "included_services": sections.get("الخدمات المشمولة"),
        }.items() if v is not None}),
        "source_capture": redact_capture({
            "schema": "thousand.v1",
            "pid": pid,
            "card": {k: card.get(k) for k in ("title", "chips", "loc", "price_num", "price_unit",
                                             "feats", "thumb")},
            "detail": {k: detail.get(k) for k in ("title", "badges", "loc", "license", "price_num",
                                                 "price_unit", "ptags", "specs", "attrs", "photos")},
            "detail_sections": {k: v for k, v in sections.items() if k in DESC_SECTIONS},
        }),
    }
    return row, category, ""


def crawl(s: cc.Session, limit: int = 0):
    """(cards, printed_total, res_rows, com_rows, skip_tally)."""
    cards, total = fetch_offers(s, limit=limit)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    for c in cards:
        detail = fetch_detail(s, c["pid"])
        time.sleep(DETAIL_PAUSE)
        if detail is None:
            skipped["detail_fetch_failed"] = skipped.get("detail_fetch_failed", 0) + 1
            continue
        row, cat, why = map_listing(c, detail)
        if not row:
            skipped[why] = skipped.get(why, 0) + 1
            continue
        (com if cat == "commercial" else res).append(row)
    return cards, total, res, com, skipped


def tally_str(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


# ── LIVENESS (docstring: REMOVAL ORACLE) ────────────────────────────────────────────────────────
def _signal_for(pid: str):
    def _signal(status, body, _moved):
        if status == 404:
            return "gone"
        if status == 200 and f'data-listing-id="{pid}"' in (body or ""):
            return "live"
        return None
    return _signal


def make_canary(control_pid: Optional[str],
                session_factory: Callable[[], Any] = session) -> Callable[[], tuple[bool, str]]:
    """In-run positive control; memoised; fails CLOSED (no control / blocked / no echo)."""
    memo: dict[str, tuple[bool, str]] = {}

    def canary() -> tuple[bool, str]:
        if "v" in memo:
            return memo["v"]
        if not control_pid:
            memo["v"] = (False, "no live control id from this run")
            return memo["v"]
        try:
            r = session_factory().get(f"{BASE}/property/{control_pid}", timeout=30)
            echoed = r.status_code == 200 and f'data-listing-id="{control_pid}"' in (r.text or "")
            memo["v"] = (echoed, f"control {control_pid} answered HTTP {r.status_code}"
                                 + ("" if echoed else " without echoing its own id"))
        except Exception as e:  # noqa: BLE001
            memo["v"] = (False, f"control {control_pid} unreachable: {type(e).__name__}")
        return memo["v"]
    return canary


def verify_gone_for(canary: Callable[[], tuple[bool, str]],
                    session_factory: Callable[[], Any] = session):
    def _verify(ad_number: str) -> tuple[str, str]:
        pid = ad_number[len(PREFIX):]
        if not ad_number.startswith(PREFIX) or not re.fullmatch(r"[A-Za-z0-9]+", pid):
            return "unknown", f"{ad_number!r} is not a {PREFIX}<id> ad number"
        return LivenessProbe(platform=PLATFORM, signal=_signal_for(pid), session=session_factory,
                             url_for=lambda _ad: f"{BASE}/property/{pid}",
                             canary=canary).verify_gone(ad_number)
    return _verify


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run(PLATFORM)
    skipped: dict[str, int] = {}
    try:
        cards, total, res, com, skipped = crawl(s, limit=args.limit)
        if not cards:
            raise RuntimeError("/offers returned no cards (0 of an expected ~105)")
        complete = not args.limit and total is not None and len(cards) == total
        note = f"{len(cards)} cards, site counter {total}"
        print(f"{SOURCE}: {note}", flush=True)
        if not args.limit and not complete:
            print(f"  ! crawl/total mismatch: enumerated {len(cards)} vs site counter {total}")
        if args.type != "all":
            res, com = (res if args.type == "residential" else []), (com if args.type == "commercial" else [])
        tally = tally_str(skipped)
        if tally:
            print(f"  skipped (not guessed): {tally}")
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number'][:14]:>14} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):10} c={str(r0['city_ar'])[:8]:8} "
                      f"d={str(r0['district_ar'])[:14]:14} bd={str(r0['bedrooms']):>4} "
                      f"fl={str(r0.get('floor_number')):>4} pa={r0['price_annual']} "
                      f"rp={r0['rent_period']} lic={r0.get('license_number')} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0
        # The public upsert_thousand_*_batch wrappers are added centrally later; the private batch
        # writer is the same code path every wrapper delegates to.
        db._wasalt_batch(RES_TABLE, res)
        db._wasalt_batch(COM_TABLE, com)
        superseded = db.retire_superseded_siblings(
            res_table=RES_TABLE, com_table=COM_TABLE,
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        degraded = False
        if args.type == "all" and complete:
            control = next((r["ad_number"][len(PREFIX):] for r in res + com), None)
            verify = verify_gone_for(make_canary(control))
            for table, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                pruned = db.prune_unseen(table, {r["ad_number"] for r in rows}, SOURCE,
                                         verify_gone=verify)
                degraded = degraded or pruned < 0
                print(f"  {table}: pruned {pruned}")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(cards),
                             rows_upserted=len(res) + len(com), degraded=degraded,
                             notes=f"{note}; skipped: {tally or 'none'}"[:300],
                             check_tables=["thousand_residential_listings",
                                           "thousand_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=f"{e}; skipped: {tally_str(skipped) or 'none'}"[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
