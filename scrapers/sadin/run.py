"""Sadin Real Estate Office (sadin.com.sa / مكتب سدين للعقارات) scraper — Saudi server-rendered HTML.

مكتب سدين للعقارات is a Saudi (Medina-focused) brokerage with REGA per-listing advertising licences
(رقم ترخيص الإعلان) and a single broker FAL licence (رقم رخصة فال 1200042362). Saudi-owned → passes
the Saudi-only rule. ~64 listings. No auth, no proxy, no JSON API / sitemap — everything is in the
initial server-rendered HTML.

Data path (HTML parse, NO API — "v4" redesign live since ~2026-07-26, scraper updated 2026-07-30):
  • GET /properties (+?page=N, rel="next" pagination) → `<article class="property-card">` cards:
    title (h3), href="/property/{ID}" (5-char alnum id), deal badge (للبيع/للإيجار),
    `property-facts` chips as `<b>VALUE</b><span>LABEL</span>` pairs (م² area, غرف, حمامات), and
    the `property-location` line "CITY · DISTRICT" — now the ONLY structured city/district on the
    site (the old detail-page المدينة/الحي rows are gone).
  • GET /properties?purpose=sale and ?purpose=rent (old /properties/forSale|forRent 301 here) →
    sale/rent id sets; the detail page's `<dt>الغرض</dt>` overrides when present.
  • GET /property/{ID} → `<dt>/<dd>` pairs: الغرض (deal), نوع العقار (REAL kind now — pre-redesign
    this label held the deal), المساحة, التوفر, REGA ad-licence number + issue/expiry, رخصة فال;
    plus og:title, description free-text (وصف العقار → best-effort price + street width), photo
    gallery under /media/properties/{ID}/ (was /static/). PDPL: `إدارة العقار` (person name) is
    NEVER read or stored; phone/WhatsApp tokens are redacted as before.

Property TYPE comes from the title/description Arabic words (شقة/فيلا/عمارة/أرض/استراحة/محل/معرض …);
the detail page's "نوع العقار" field actually holds the DEAL type (للبيع/إيجار), not the kind.

PDPL: the detail page exposes the office NAME + several phone/WhatsApp numbers (in the JSON-LD
`seller`, and inline "للتواصل: 05…" in the description). We NEVER store the name/phones and REDACT
every 05x / +9665 / wa.me / 9200 token from the title + description before storing.

Usage:  python -m scrapers.sadin.run [--limit N] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
import html as ihtml
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db, normalize  # noqa: E402

BASE = "https://www.sadin.com.sa"
# 2026-07 site redesign ("v4", found live 2026-07-30 after 4 days of 0-card runs): /properties/all
# 301s to /properties, /properties/forSale|forRent 301 to /properties?purpose=sale|rent, cards moved
# from `deals-block-one` divs to `<article class="property-card">`, and list pages are now
# SERVER-side paginated (?page=N with a rel="next" link) instead of one full catalog page.
LIST_ALL = f"{BASE}/properties"
LIST_SALE = f"{BASE}/properties?purpose=sale"
LIST_RENT = f"{BASE}/properties?purpose=rent"
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))

# Arabic property-kind word (from the card/og title or description) → canonical English type.
# Order matters: more specific multi-word forms are checked first in _map_type().
TYPE_MAP_AR = [
    ("أرض تجارية", "Commercial Land"), ("ارض تجارية", "Commercial Land"),
    ("عمارة تجارية", "Commercial Building"), ("مجمع تجاري", "Commercial Building"),
    ("استراحة", "Rest House"), ("إستراحة", "Rest House"), ("استراحه", "Rest House"),
    ("شقق", "Apartment"), ("شقة", "Apartment"), ("شقه", "Apartment"), ("استوديو", "Studio"),
    ("دوبلكس", "Villa"), ("دبلوكس", "Villa"), ("فيلا", "Villa"), ("فلة", "Villa"), ("قصر", "Villa"),
    ("دور", "Floor"), ("روف", "Floor"),
    ("عمارة", "Building"), ("عماره", "Building"), ("بناية", "Building"), ("مبنى", "Building"),
    ("بيت", "House"), ("منزل", "House"),
    ("مزرعة", "Farm"), ("مزرعه", "Farm"),
    ("أرض", "Residential Land"), ("ارض", "Residential Land"),
    # commercial kinds
    ("محلات", "Shop"), ("محل", "Shop"), ("معرض", "Showroom"), ("معارض", "Showroom"),
    ("مكتب", "Office"), ("مكاتب", "Office"), ("مستودع", "Warehouse"), ("مستودعات", "Warehouse"),
    ("ورشة", "Workshop"), ("مصنع", "Factory"), ("فندق", "Hotel"), ("برج", "Commercial Building"),
]
COMMERCIAL_TYPES = {
    "Shop", "Showroom", "Office", "Warehouse", "Workshop", "Factory", "Hotel",
    "Commercial Land", "Commercial Building",
}

# Arabic city → canonical English (Sadin is Medina-centric but list a few neighbours for safety).
CITY_MAP_AR = {
    "المدينة المنورة": "Medina", "المدينة": "Medina", "مكة المكرمة": "Mecca", "مكة": "Mecca",
    "جدة": "Jeddah", "ينبع": "Yanbu", "تبوك": "Tabuk", "الرياض": "Riyadh", "ينبع البحر": "Yanbu",
}
CITY_TO_REGION = {
    "Medina": "Madinah", "Yanbu": "Madinah", "Mecca": "Makkah", "Jeddah": "Makkah",
    "Tabuk": "Tabuk", "Riyadh": "Riyadh",
}

# خدمات العقار service label → canonical amenity column.
SERVICE_COLS = {
    "عداد كهرباء": "separate_electricity_meter", "كهرباء": "electricity",
    "عداد مياه": "separate_water_meter", "مياه": "water_supply", "ماء": "water_supply",
    "صرف صحي": "sanitation", "مصعد": "elevator", "مصعد كهربائي": "elevator",
    "ألياف ضوئية": "optical_fibers", "موقف": "parking", "موقف سيارة": "parking",
    "موقف سيارات": "parking", "مدخل خاص": "private_entrance", "تكييف": "air_conditioner",
    "مكيف": "air_conditioner", "غرفة غسيل": "laundry_room", "شرفة": "balcony_terrace",
    "بلكونة": "balcony_terrace",
}

# Phone / contact patterns to REDACT from title + description (PDPL).
_PHONE_RE = re.compile(
    r"(?:\+?9665\d{8}"            # +9665XXXXXXXX
    r"|00966\d{8,9}"             # 00966XXXXXXXX
    r"|0?5\d{8}"                 # 05XXXXXXXX / 5XXXXXXXX
    r"|9200\d{4,6}"             # 9200XXXX
    r"|wa\.me/\S+"               # wa.me links
    r"|واتس\S*\s*\d[\d\s\-]{6,})"  # "واتساب 05..."
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")

_last = 0.0


def _throttle() -> None:
    global _last
    wait = _last + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
    })
    return s


def _strip(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", ihtml.unescape(s or ""))).strip()


def _num(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    t = str(s).translate(normalize._TRANS).replace("٬", ",")
    # Prefer a fully thousands-grouped number (comma OR period as separator, 3-digit groups) so
    # "2.600.000" (period-grouped, found live 2026-07-28 on ad SDX3ZNP) parses as 2,600,000, not just
    # its leading "2" — mirrors the grouped-digit fix already applied to aqar's area parser. A plain
    # decimal like "125.5" has only 1 trailing digit, so it never matches this stricter pattern and
    # falls through to the original plain-\d+ behavior unchanged.
    m = re.search(r"\d{1,3}(?:[,.]\d{3})+(?!\d)", t)
    if m:
        return int(m.group(0).replace(",", "").replace(".", ""))
    m = re.search(r"\d+", t.replace(",", ""))
    return int(m.group(0)) if m else None


def _redact(text: Optional[str]) -> Optional[str]:
    """Strip phones / wa.me / contact blocks from free text (PDPL)."""
    if not text:
        return text
    t = _PHONE_LOOSE.sub(" ", text)
    t = _PHONE_RE.sub(" ", t)
    t = re.sub(r"للتواصل[^\n]*", " ", t)
    t = re.sub(r"للاتصال[^\n]*", " ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t or None


def _map_type(*texts: str) -> Optional[str]:
    """Resolve canonical English type. Title-derived texts come first and win immediately. For the
    description (passed last) we DON'T let a passing mention of "أرض" (e.g. "أرض إضافية" beside a
    "معرض قائم") win — a commercial keyword anywhere in the same text outranks the land default."""
    for idx, txt in enumerate(texts):
        if not txt:
            continue
        is_desc = idx == len(texts) - 1 and len(texts) > 1
        hit = None
        for word, eng in TYPE_MAP_AR:
            if word in txt:
                # In the description, defer a bare land match until we've confirmed no
                # commercial/building keyword is present in the same text.
                if is_desc and eng in ("Residential Land", "Commercial Land"):
                    hit = hit or eng
                    continue
                return eng
        if hit:
            return hit
    return None


# ── List pages ────────────────────────────────────────────────────────────────
def _page_url(url: str, page: int) -> str:
    if page <= 1:
        return url
    return f"{url}{'&' if '?' in url else '?'}page={page}"


def _pages(s: cc.Session, url: str, max_pages: int = 12):
    """Yield each list page's HTML, following the redesign's server-side ?page=N pagination.

    Stops when a page contributes no NEW /property/{ID} links or carries no rel="next" hint —
    max_pages is a runaway guard (site has ~3 pages × 24 cards today)."""
    seen: set[str] = set()
    for p in range(1, max_pages + 1):
        _throttle()
        try:
            html = s.get(_page_url(url, p), timeout=40).text
        except Exception:
            return
        ids = set(re.findall(r'href="/property/([A-Za-z0-9]{4,8})"', html))
        if p > 1 and not (ids - seen):
            return
        seen |= ids
        yield html
        if 'rel="next"' not in html:
            return


def _ids(s: cc.Session, url: str) -> list[str]:
    out: list[str] = []
    for html in _pages(s, url):
        for pid in re.findall(r'href="/property/([A-Za-z0-9]{4,8})"', html):
            if pid not in out:
                out.append(pid)
    return out


def parse_catalog_cards(html: str, cards: dict[str, dict]) -> None:
    """Parse one redesigned list page's `<article class="property-card">` blocks into cards.

    cards[ID] = {title, beds, baths, area, city_txt, district_txt}. The redesign's
    `property-facts` chips are `<b>VALUE</b><span>LABEL</span>` pairs, and the card's
    `property-location` line ("المدينة المنورة · حي العريض") is now the ONLY structured
    city/district on the site (the old detail-page المدينة/الحي rows are gone)."""
    for b in re.split(r'(?=<article class="property-card)', html):
        m = re.search(r'href="/property/([A-Za-z0-9]{4,8})"', b)
        if not m or not b.startswith('<article'):
            continue
        pid = m.group(1)
        if pid in cards:
            continue
        tm = re.search(r"<h3>\s*<a[^>]*>(.*?)</a>", b, re.S)
        title = _strip(tm.group(1)) if tm else ""
        beds = baths = area = None
        for val, lab in re.findall(r"<li>.*?<b>([\d,٬\.]+)</b>\s*<span>([^<]*)</span>", b, re.S):
            lab = lab.strip()
            if "م²" in lab or "م2" in lab or "متر" in lab:
                area = _num(val)
            elif "نوم" in lab or "غرف" in lab or "غرفة" in lab:
                beds = _num(val)
            elif "حمام" in lab or "دورات" in lab:
                baths = _num(val)
        city_txt = district_txt = None
        lm = re.search(r'property-location[^>]*>.*?</svg>\s*([^<]+)<', b, re.S)
        if lm:
            parts = [p.strip() for p in lm.group(1).split("·")]
            if parts and parts[0]:
                city_txt = parts[0]
            if len(parts) > 1 and parts[1]:
                district_txt = parts[1]
        cards[pid] = {"title": title, "beds": beds, "baths": baths, "area": area,
                      "city_txt": city_txt, "district_txt": district_txt}


def fetch_catalog(s: cc.Session) -> tuple[dict[str, dict], set[str], set[str]]:
    """Return (cards_by_id, sale_ids, rent_ids) across every paginated /properties page."""
    cards: dict[str, dict] = {}
    for html in _pages(s, LIST_ALL):
        parse_catalog_cards(html, cards)
    sale = set(_ids(s, LIST_SALE))
    rent = set(_ids(s, LIST_RENT))
    return cards, sale, rent


# ── Detail page ───────────────────────────────────────────────────────────────
def _li_field(html: str, label: str) -> Optional[str]:
    """Parse the `<li><span>LABEL: </span> VALUE</li>` (بيانات العقار) rows."""
    m = re.search(re.escape(label) + r"\s*:?\s*</span>\s*([^<]+)<", html)
    return m.group(1).strip() if m else None


def _info_field(html: str, label: str) -> Optional[str]:
    """Parse the `<li>LABEL: <span> VALUE</span></li>` (location/licence) rows."""
    m = re.search(re.escape(label) + r"\s*:?\s*<span>\s*([^<]+)</span>", html)
    return m.group(1).strip() if m else None


def _dd_field(html: str, label: str) -> Optional[str]:
    """Parse the 2026-07 redesign's `<dt>LABEL</dt><dd>VALUE</dd>` rows (بيانات الإعلان والترخيص)."""
    m = re.search(r"<dt>\s*" + re.escape(label) + r"\s*</dt>\s*<dd[^>]*>\s*([^<]+?)\s*</dd>", html)
    return m.group(1).strip() if m else None


def _photos(html: str, pid: str) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    # 2026-07 redesign moved the gallery from /static/properties/ to /media/properties/ — accept both.
    for u in re.findall(r'(?:src|href)="(/(?:static|media)/properties/[^"]+\.(?:png|jpe?g|webp))"', html, re.I):
        if u in seen:
            continue
        seen.add(u)
        low = u.lower()
        if any(b in low for b in ("logo", "placeholder", "no-image", "noimage", "default")):
            continue
        urls.append(BASE + u)
    # main.png first, then gallery
    urls.sort(key=lambda u: 0 if u.lower().endswith("main.png") else 1)
    return urls[:30]


def _description(html: str) -> Optional[str]:
    i = html.find("وصف العقار")
    if i < 0:
        return None
    sub = html[i: i + 6000]
    # sadin.com.sa's markup moved from class="text" to class="property-description" (found live
    # 2026-07-28: the old selector matched 0/3 sampled live pages, so a fresh crawl today would get
    # desc_raw=None and silently store no price at all — a coverage outage, not a wrong-value bug).
    # Try the current class first, keep the old one as a fallback in case an older cached/mirrored
    # page still uses it.
    m = re.search(r'<div class="property-description">(.*?)</div>', sub, re.S) \
        or re.search(r'<div class="text">(.*?)</div>', sub, re.S)
    return _strip(m.group(1)) if m else None


def _is_per_meter(before: str, after: str) -> bool:
    # A per-metre rate can be labeled EITHER after the number ("4,250 ريال للمتر") OR before it
    # ("المتر: 4000 ريال") — found live 2026-07-28 on ad SDX3ZNP: only the `after` side was checked,
    # so "المتر: 4000 ريال" (label BEFORE the number) slipped past this guard and its per-meter rate
    # (4,000) was stored as the total price instead of the real total (2,600,000, a 650x
    # understatement) because the real total lacked a trailing "ريال" token.
    if re.match(r"\s*(?:للمتر|/?\s*م2?|/?\s*م²|للمتر\s*المربع)", after):
        return True
    # «للمتر» (li-l-metr) drops the alif of «المتر», so the plain المتر pattern missed it — found
    # live 2026-08-03 on ad 598978: «المطلوب للمتر 5555 ريال الإجمالي 5,000,000 ريال» stored 5555
    # (the per-metre rate) as the total instead of the explicitly displayed 5,000,000.
    return bool(re.search(r"(?:سعر\s*)?(?:لل|ال)متر\s*(?:المربع)?\s*[:：]?\s*$", before))


def _extract_price(desc_raw: Optional[str]) -> Optional[int]:
    """Best-effort TOTAL price from the description free-text. The lister free-text frequently
    quotes a per-METRE price ("السعر: 4,250 ريال للمتر") right next to the total ("السعر الإجمالي:
    2,647,750 ريال"), so we must (1) prefer an explicit "السعر الإجمالي/السعر الكلي" figure, and
    (2) reject any per-metre figure, labeled either before or after the number (_is_per_meter).
    Returns None if only a per-metre price exists (never store a per-metre number as a total)."""
    if not desc_raw:
        return None
    # 1) explicit total / asking price (المطلوب/الإجمالي/الكلي win over rental-income figures).
    # "ريال" is optional here — found live 2026-07-28: "المطلوب: 2.600.000" (no trailing "ريال" at
    # all) was invisible to a strict "...ريال" requirement, so this labeled total went unmatched
    # while a much smaller unlabeled-but-"ريال"-suffixed per-meter figure elsewhere in the same
    # description won by default. The label itself ("asking"/"total"/"overall") is already a strong
    # enough price signal without also requiring the currency word.
    for pat in (r"(?:السعر\s*)?(?:المطلوب|الإجمالي|الاجمالي|الكلي)[^0-9]{0,20}([\d,٬\.]{4,})(?:\s*ريال)?",
                r"(?:بسعر|السعر|بـ)\s*[:：]?\s*([\d,٬\.]{4,})\s*ريال(?!\s*(?:للمتر|/?\s*م))"):
        for pm in re.finditer(pat, desc_raw):
            if _is_per_meter(desc_raw[max(0, pm.start(1) - 20):pm.start(1)], desc_raw[pm.end():]):
                continue
            return _num(pm.group(1))
    # 2) bare "N ريال" anywhere, but skip per-metre quotes AND rental-income/return figures
    #    (عائد/دخل/إيجار سنوي — these are NOT the sale price).
    INCOME = ("عائد", "الدخل", "دخل", "إيجار", "ايجار", "تأجير")
    for pm in re.finditer(r"([\d,٬\.]{4,})\s*ريال", desc_raw):
        before = desc_raw[max(0, pm.start() - 35): pm.start()]
        if _is_per_meter(desc_raw[max(0, pm.start() - 20):pm.start()], desc_raw[pm.end():]) \
                or any(w in before for w in INCOME):
            continue
        return _num(pm.group(1))
    return None


def map_listing(pid: str, html: str, card: dict, is_rent: bool) -> tuple[Optional[dict], str]:
    og = re.search(r'property="og:title"\s+content="([^"]+)"', html)
    title_raw = (og.group(1).split("|")[0].strip() if og else "") or card.get("title", "")
    # A detail-page fetch can occasionally land on the login wall instead of the real property page
    # (session/bot-gate) — its og:title is literally "Login or Create Account", and every other field
    # (description, price, area) comes back empty too, so this was stored as a fake listing with no
    # real content (found live 2026-07-27, id 4948043/SD4HO6O). Skip it entirely rather than storing a
    # garbage row — a later crawl run picks up the real page once it's reachable again.
    if title_raw.strip() == "الدخول أو إنشاء حساب":
        return None, ""
    desc_raw = _description(html)

    # Redesign detail pages carry the REAL kind in `<dt>نوع العقار</dt>` (the pre-redesign page's
    # "نوع العقار" held the DEAL and is a dead selector now, so this is None on old markup). The
    # deal moved to `<dt>الغرض</dt>` — prefer it over list-membership tagging when present: it is
    # per-listing source truth and immune to a silently-broken purpose-page enumeration.
    dd_type = _dd_field(html, "نوع العقار")
    deal_dd = _dd_field(html, "الغرض")
    if deal_dd:
        is_rent = "جار" in deal_dd  # إيجار/للإيجار; للبيع stays buy
    mapped_type = _map_type(dd_type or "", title_raw, card.get("title", ""), desc_raw or "")
    # Unmapped type → STORE the raw title text, never a guessed default (owner directive
    # 2026-07-16: never confidently misclassify — the raw value trips the DB novel-type detector,
    # which quarantines + alerts). The legacy value below feeds ONLY the routing/sanity rules.
    property_type = mapped_type or "Residential Land"  # type-truth: routing-legacy only — never stored
    stored_property_type = mapped_type or title_raw or card.get("title", "").strip() or "unknown"
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"

    # Redesign: the detail-page المدينة/الحي rows are gone; the catalog card's property-location
    # line ("المدينة المنورة · حي العريض") is now the structured source (exact source text, PR#182
    # fidelity rules apply downstream). Old-page selectors kept first — harmless None on new markup.
    raw_city = _info_field(html, "المدينة") or card.get("city_txt") or ""
    # Forward-fix (2026-07-10 location-data-quality audit): removed the hardcoded "Medina" city
    # default and "Madinah" region default — these silently mislabeled non-Medina listings (confirmed
    # live: a Buraidah/Qassim listing forced to region="Madinah"). Honest None is correct; the
    # region_ar field below (keyed on region=="Madinah") now correctly evaluates false too.
    city = CITY_MAP_AR.get(raw_city) or normalize.map_city(raw_city)
    region = CITY_TO_REGION.get(city)
    raw_district = _info_field(html, "الحي") or card.get("district_txt") or None

    # Structured numbers — baths/area from the card chips (cleanest), the rest from detail li's.
    # `card.get("beds")` is captured from a bare "غرف" chip (no "نوم" qualifier) — a generic
    # total-room count, never bedroom-specific; sadin.com.sa never displays a "غرف النوم" label
    # anywhere (live-confirmed 2026-07-28). Owner decision: null rather than store an unverifiable
    # total-room figure as bedroom count.
    beds = None
    baths = card.get("baths")
    area = card.get("area")
    if area is None:
        area = _num(_dd_field(html, "المساحة"))  # redesign detail dt/dd, e.g. "500 م²"
    floors = _num(_li_field(html, "عدد الطوابق"))
    kitchens = _num(_li_field(html, "عدد المطابخ"))
    halls = _num(_li_field(html, "عدد الصالات"))
    furnishing = _li_field(html, "حالة الأثاث")
    date_added = _li_field(html, "تاريخ الإضافة")

    if baths is not None and baths <= 0:
        baths = None
    if area is not None and (area < 10 or area > 5_000_000):
        area = None

    # Best-effort TOTAL price from the description free-text (see _extract_price for the full logic
    # + fidelity history).
    price = _extract_price(desc_raw)
    if price is not None and price < 1000:
        price = None
    # No source per-m² rate → NULL, never price/area (aqar PR#216, scrapers PR#217).
    price_per_meter = None

    # Street frontage / width from description (e.g. "على شارع … بعرض 16م").
    sw = None
    if desc_raw:
        sm = re.search(r"بعرض\s*([\d]{1,3})\s*م", desc_raw.translate(normalize._TRANS))
        if sm:
            sw = _num(sm.group(1))

    # Licences — old inline rows first, then the redesign's dt/dd labels (رخصة فال / تاريخ الإصدار /
    # تاريخ الانتهاء).
    fal = _info_field(html, "رقم رخصة فال") or _dd_field(html, "رخصة فال")
    rega_no = _info_field(html, "رقم ترخيص الإعلان") or _dd_field(html, "رقم ترخيص الإعلان")
    rega_issue = _info_field(html, "تاريخ إصدار الترخيص") or _dd_field(html, "تاريخ الإصدار")
    rega_expiry = _info_field(html, "تاريخ إنتهاء الترخيص") or _dd_field(html, "تاريخ الانتهاء")

    # Services → amenity columns.
    amenities: dict[str, bool] = {}
    svc_i = html.find("خدمات العقار")
    services_list: list[str] = []
    if svc_i >= 0:
        svc_block = html[svc_i: svc_i + 2500]
        services_list = [_strip(x) for x in re.findall(r"<span>\s*([^<]+?)\s*</span>", svc_block)]
        services_list = [x for x in services_list if x]
        for label, col in SERVICE_COLS.items():
            if any(label in s for s in services_list):
                amenities[col] = True

    title = _redact(title_raw)
    description = _redact(desc_raw)

    info: dict[str, Any] = {
        "city_ar": raw_city or None,
        "region_ar": "منطقة المدينة المنورة" if region == "Madinah" else None,
        "district_ar": raw_district,
        "property_type_ar": _map_type_label(title_raw, desc_raw),
        "deal_ar": "إيجار" if is_rent else "للبيع",
        "floors": floors,
        "kitchens": kitchens,
        "halls": halls,
        "furnishing": furnishing,
        "broker_fal_license": _num(fal) if fal else None,
        "rega_ad_license_number": _num(rega_no) if rega_no else None,
        "rega_license_issue_date": rega_issue,
        "rega_license_expiry_date": rega_expiry,
        "services": services_list or None,
        "sadin_reference": _li_field(html, "رقم سدين المرجعي"),
        "date_added_ar": date_added,
    }
    info = {k: v for k, v in info.items() if v not in (None, "", [])}

    row: dict[str, Any] = {
        "ad_number": f"SD{pid}",
        "listing_url": f"{BASE}/property/{pid}",
        "source": "Sadin",
        "active": True,
        "property_type": stored_property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": area,
        "bedrooms": beds,
        "bathrooms": baths,
        "halls": halls,
        "street_width_m": sw,
        "price_total": price if not is_rent else None,
        "price_annual": price if is_rent else None,
        "price_per_meter": price_per_meter,
        "rent_period": "annual" if is_rent else None,
        "city": city,
        "region": region,
        "neighborhood": raw_district,
        "rega_location_verified": bool(rega_no),
        "title": title,
        "description": description,
        "photo_urls": _photos(html, pid),
        "additional_info": info,
    }
    row.update(amenities)
    return row, category


def _map_type_label(*texts: str) -> Optional[str]:
    for txt in texts:
        if not txt:
            continue
        for word, _eng in TYPE_MAP_AR:
            if word in txt:
                return word
    return None


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="small validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    s = session()
    cards, sale_ids, rent_ids = fetch_catalog(s)
    ids = list(cards.keys())
    if args.limit:
        ids = ids[: args.limit]
    print(f"Sadin: {len(cards)} cards ({len(sale_ids)} sale / {len(rent_ids)} rent)"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

    run_id = None if args.limit else db.begin_run("sadin")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        for pid in ids:
            _throttle()
            try:
                html = s.get(f"{BASE}/property/{pid}", timeout=40).text
            except Exception:
                continue
            is_rent = pid in rent_ids and pid not in sale_ids
            row, cat = map_listing(pid, html, cards[pid], is_rent)
            if not row:
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            seen += 1
            if args.limit and seen >= args.limit:
                break

        if res:
            db.upsert_sadin_residential_batch(res)
        if com:
            db.upsert_sadin_commercial_batch(com)

        if args.limit:
            print(f"✓ Sadin VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            for r in (res + com)[:6]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "bathrooms", "price_total",
                    "price_annual", "rent_period")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:74])
            return 0

        # Full run: prune listings active before but not seen this crawl.
        pruned = 0
        for tbl, rows_seen in (("sadin_residential_listings", res),
                               ("sadin_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Sadin")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Sadin: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"pruned={pruned}", check_tables=["sadin_residential_listings", "sadin_commercial_listings"])
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
