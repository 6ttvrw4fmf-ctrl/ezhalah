"""24 Souq (24.com.sa / سوق العقار ٢٤ — operated by "مدار 24") scraper — Saudi Laravel site,
server-rendered HTML detail-page parse.

24 Souq is a Saudi-registered (السجل التجاري 5951130273), REGA/FAL-integrated property platform
(Arabic-first, .sa, links to rega.gov.sa licensing). Saudi-owned → passes the Saudi-only rule.
Asir/Khamis/Abha + nationwide. Small, mostly fresh catalog: listing ids run 1..~1278 but only the
currently-active ones (~30-40 at a time; sold/deleted ids fall back to the homepage) render a real
detail page. No auth, no captcha, no proxy needed (Cloudflare, datacenter-IP friendly).

Data path: NO public JSON API and NO per-listing JSON-LD (the only ld+json blocks are the
site-level WebSite/Organization). Two complementary enumeration sources:
  (1) The faceted browse pages (/properties, /properties/for-sell|for-rent/<type>, and the
      /view/<slug> pages listed in /sitemap.xml) link out to active detail URLs /{id}/{slug}.
  (2) Because those facets only surface the newest ~31 and can hide older-but-active ads, we ALSO
      sweep the full numeric id range 1..MAX (MAX auto-discovered from the browse set, padded) and
      keep only ids whose page is a REAL listing. A real listing is identified by a non-empty
      `realestate_name = "<type>"` JS var; a deleted/sold/expired id silently returns the homepage
      shell (HTTP 200, ~242 KB, empty realestate_name, generic title) — those are skipped, so the
      crawl naturally contains only live ads.

Each /{id}/{slug} detail page (server-rendered Blade HTML) carries:
  • JS  `realestate_name = "<arabic type>"`           → property_type (TYPE_MAP_AR) + res/com routing
  • share <p> "<type> <deal> في <city> حي <district> شارع <street>"  → transaction_type (deal word)
  • <title> "<type> في <city>  حي <district>"          → city + district (fallback / cross-check)
  • price div (font-size:25px … icon-Saudi_Riyal_Symbol-2) "58,000"  → price_total | price_annual
  • spec <th>/<td> table: المساحة(area), عدد الغرف(beds), سعر المتر(ppm), الواجهة(facade),
        عمر العقار(age), الاستخدامات, رسوم نقل الملكية
  • "معلومات الإعلان" block: مدينة / حي / شارع / رقم المبنى / الرمز البريدي / رقم المخطط / رقم القطعة
  • المرافق services chips: كهرباء/مياه/صرف صحي/هاتف/ألياف ضوئية
  • REGA panel: رقم رخصة الاعلان, تاريخ إصدار الإعلان, تاريخ انتهاء الترخيص
  • gallery images at https://24.com.sa/images/imagesPosts/<...>.jpg
  • رقم الإعلان #<id>

LOCATION: city (Arabic) from the معلومات-الإعلان block (مدينة :) → normalize.map_city; the title is a
  cross-check. region is DERIVED from the canonical city via normalize.region_for_city (NOT scraped).
  district = حي value.

DEAL: the deal word in the share line / heading. للبيع → Buy. للإيجار/للايجار → Rent.
  للتقبيل (leasehold-transfer of a commercial shop) → treated as Buy (a one-off key-money sale).

⛔⛔ PDPL ABSOLUTE — we NEVER store an advertiser/agent/owner PERSON name or ANY phone number.
  The detail page renders a "معلومات المعلن" / "مسؤول الإعلان" block with the agent's personal name,
  rating, FAL number and a 05x mobile + a WhatsApp click-to-call. We NEVER read or persist that
  block. We also REDACT any 05x / +9665 / 9200 / 920 / 800 / wa.me / واتساب phone shape (incl.
  o5o-style leetspeak) from title + description before storing, and truncate at any contact marker.
  The registered COMPANY operator ("مدار 24") is allowed but we don't persist it either.

Usage:  python -m scrapers.souq24.run [--limit N] [--type residential|commercial|all]
"""
from __future__ import annotations

import argparse
import html as ihtml
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db, normalize  # noqa: E402

BASE = "https://24.com.sa"
SITEMAP = f"{BASE}/sitemap.xml"
# Cloudflare-fronted Laravel origin; gentle concurrency. The full id sweep is ~1.3k cheap GETs.
WORKERS = int(os.environ.get("SOUQ24_WORKERS", "8"))
# Hard cap on the id sweep so a future catalog growth can't run unbounded; auto-raised from browse.
ID_CAP = int(os.environ.get("SOUQ24_ID_CAP", "1400"))

# 24.com.sa's Cloudflare serves the homepage SHELL (no realestate_name) to datacenter IPs, so the
# cloud (GitHub Actions) crawl silently saw 0 real listings every run and every ad got stale-marked
# inactive. Route through a Saudi residential proxy (the same secret the Wasalt cloud sweeps use)
# when configured; local runs leave these unset and hit the site directly from the home IP, which
# works. Note: the full id sweep through the proxy is ~1.3k GETs/run of metered bandwidth — bounded
# by ID_CAP; if that ever matters, lower the cron cadence rather than skipping ids (skipping would
# let the 7-day stale-marker wrongly kill older-but-live ads the sweep no longer refreshes).
PROXY = (os.environ.get("SOUQ24_PROXY_URL") or os.environ.get("SCRAPE_PROXY_URL")
         or os.environ.get("WASALT_PROXY_URL") or "").strip()
_PROXIES = {"http": PROXY, "https": PROXY} if PROXY else None

# Arabic property-type word (from realestate_name / heading) → canonical English type.
TYPE_MAP_AR = {
    "شقة": "Apartment", "شقه": "Apartment", "شقق": "Apartment", "استوديو": "Apartment",
    "فيلا": "Villa", "فله": "Villa", "فلة": "Villa", "فلل": "Villa", "دوبلكس": "Villa",
    "دور": "Floor", "أدوار": "Floor", "ادوار": "Floor", "روف": "Floor",
    "عمارة": "Building", "عماره": "Building", "عمائر": "Building", "مبنى": "Building",
    "بيت": "House", "منزل": "House",
    "ارض": "Residential Land", "أرض": "Residential Land", "أراضي": "Residential Land",
    "اراضي": "Residential Land", "ارض سكنية": "Residential Land",
    "استراحة": "Rest House", "استراحه": "Rest House", "استراحات": "Rest House",
    "شاليه": "Chalet", "شالية": "Chalet", "مخيم": "Camp", "غرفة": "Room", "غرفه": "Room",
    "مزرعة": "Farm", "مزرعه": "Farm",
    "مجمع سكني": "Building", "مجمعات سكنية": "Building",
    # commercial
    "مكتب": "Office", "مكاتب": "Office",
    "محل": "Shop", "محلات": "Shop", "معرض": "Showroom", "معارض": "Showroom",
    "مستودع": "Warehouse", "مستودعات": "Warehouse", "ورشة": "Workshop", "ورشه": "Workshop",
    "مصنع": "Factory", "فندق": "Hotel", "برج": "Commercial Building", "مجمع تجاري": "Commercial Building",
    "محطة": "Gas Station", "محطة وقود": "Gas Station", "ارض تجارية": "Commercial Land",
    "أرض تجارية": "Commercial Land",
}
COMMERCIAL_TYPES = {
    "Office", "Shop", "Showroom", "Warehouse", "Workshop", "Factory", "Hotel",
    "Commercial Building", "Gas Station", "Commercial Land",
}

# 24 Souq sometimes writes a small Mecca-area locality into the "مدينة" (city) field instead of the
# parent city — normalize.map_city has no entry for these villages/districts, so they'd fall to a
# null city/region. Resolve the recurring ones UP to their parent city (then region_for_city derives
# the region). اللخبصية (Al-Lakhbasiyah) and العدل (Al-Adl) are within Mecca's jurisdiction.
TOWN_TO_CITY = {
    "اللخبصية": "Mecca", "اللخبصيه": "Mecca", "العدل": "Mecca",
}

# المرافق service chip (Arabic) → canonical amenity column.
SERVICE_COLS = {
    "كهرباء": "electricity", "مياه": "water_supply", "ماء": "water_supply",
    "صرف صحي": "sanitation", "ألياف ضوئية": "optical_fibers", "الياف ضوئية": "optical_fibers",
}

# ── PDPL redaction battery (phones / wa.me / contact CTAs / leetspeak) ──────────
_OBFUSC_RUN_RE = re.compile(r"[oO0-9٠-٩][oO0-9٠-٩\s.\-]{6,}[oO0-9٠-٩]")
_PHONE_RE = re.compile(
    r"(?:\+?00?966\d{8,9}"          # +966xxxxxxxx / 00966xxxxxxxxx
    r"|\b966\d{8,9}\b"              # bare 966xxxxxxxx
    r"|0?5\d(?:[\s\.\-]?\d){7}"     # 05xxxxxxxx / 5xxxxxxxx, separators allowed
    r"|\b9200\d{4}\b"              # 9200xxxx short-codes
    r"|\b920\d{6}\b"               # 920xxxxxx unified
    r"|\b800\d{7}\b"               # 800xxxxxxx toll-free
    r"|wa\.me/\S+"
    r"|واتس\S*\s*\d[\d\s\-]{6,})",
    re.I,
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")
# A contact call-to-action + the ~40 chars after it (phone / WhatsApp / a seller alias).
_CONTACT_LINE_RE = re.compile(
    r"(?:للتواصل|للحجز|للاستفسار|للاتصال|اتصل(?:\s*(?:بنا|على))?|"
    r"رقم\s*(?:الجوال|الجوّال|التواصل|الهاتف|الواتس|المعلن)|جوال|موبايل|المعلن|الوسيط|المسوق|"
    r"مسؤول\s*الإعلان|واتس\S*|whats\s*app|whatsapp)[^\n]{0,40}", re.I)

# ── Per-listing field regexes ──────────────────────────────────────────────────
REALESTATE_NAME_RE = re.compile(r'realestate_name\s*=\s*"([^"]*)"')
TITLE_RE = re.compile(r"<title>\s*(.*?)\s*</title>", re.S)
# title shape: "<type>  في <city>  حي <district>  | تطبيق سوق العقار 24"
TITLE_PARSE_RE = re.compile(
    r"^\s*([^|<\r\n]+?)\s+في\s+([^|<\r\n]+?)(?:\s+(حي[^|<\r\n]*?))?\s*\|", re.S)
# price div carrying the Riyal symbol icon
PRICE_RE = re.compile(
    r"font-size:25px;[^>]*>\s*([\d,]+)\s*<span[^>]*icon-Saudi_Riyal_Symbol", re.S)
# spec table th/td
TH_TD_RE = re.compile(r"<th>\s*(.*?)\s*</th>\s*<td>\s*(.*?)\s*</td>", re.S)
# معلومات الإعلان labelled lines
INFO_CITY_RE = re.compile(r"مدينة\s*:\s*([^\r\n<|]{1,40})")
INFO_DISTRICT_RE = re.compile(r"حي\s*:\s*([^\r\n<|]{1,50})")
INFO_STREET_RE = re.compile(r"شارع\s*:\s*([^\r\n<|]{1,60})")
INFO_POSTAL_RE = re.compile(r"الرمز\s*البريدي\s*:\s*([0-9٠-٩]{4,6})")
INFO_PLAN_RE = re.compile(r"رقم\s*المخطط\s*:\s*([^\r\n<|]{1,40})")
INFO_PARCEL_RE = re.compile(r"رقم\s*القطعة\s*:\s*([^\r\n<|]{1,40})")
REGA_NO_RE = re.compile(r"رقم\s*رخصة\s*الاعلان\s*:?\s*([0-9٠-٩]{6,})")
REGA_ISSUE_RE = re.compile(r"تاريخ\s*إصدار\s*الإعلان\s*:?\s*([0-9٠-٩]{1,4}[/\-][0-9٠-٩]{1,2}[/\-][0-9٠-٩]{2,4})")
REGA_EXPIRY_RE = re.compile(r"تاريخ\s*انتهاء\s*الترخيص\s*:?\s*([0-9٠-٩]{1,4}[/\-][0-9٠-٩]{1,2}[/\-][0-9٠-٩]{2,4})")
IMG_RE = re.compile(r"https://24\.com\.sa/images/imagesPosts/[^\s\"'<>\\)]+?\.(?:jpe?g|png|webp)", re.I)
# the deal/services chips referenced "المرافق" section start
SERVICES_MARK = "المرافق"

_local = threading.local()


def _session() -> cc.Session:
    s = getattr(_local, "s", None)
    if s is None:
        s = cc.Session(impersonate="chrome124")
        s.headers.update({
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
        })
        if _PROXIES:
            s.proxies = _PROXIES  # Saudi residential proxy so datacenter IPs aren't served the shell
        _local.s = s
    return s


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    if _PROXIES:
        s.proxies = _PROXIES  # Saudi residential proxy so datacenter IPs aren't served the shell
    return s


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", ihtml.unescape(s or ""))).strip()


def _to_int(v: Any) -> Optional[int]:
    n = normalize.to_int(v)
    return n if n else None


def _to_float(v: Any) -> Optional[float]:
    if v in (None, "", "—"):
        return None
    s = str(v).translate(normalize._TRANS)
    s = re.sub(r"[^\d.]", "", s)
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _deobfuscate(t: str) -> str:
    def fix(m: "re.Match[str]") -> str:
        d = m.group(0).replace("o", "0").replace("O", "0")
        return d if len(re.sub(r"\D", "", d)) >= 8 else m.group(0)
    return _OBFUSC_RUN_RE.sub(fix, t)


def _redact(text: Optional[str]) -> Optional[str]:
    """Strip phones / wa.me / contact CTAs / seller aliases from free text (PDPL)."""
    if not text:
        return text
    t = ihtml.unescape(text)
    t = _deobfuscate(t)            # o5o… → 050… so the phone patterns below catch it
    t = _CONTACT_LINE_RE.sub(" ", t)
    t = _PHONE_LOOSE.sub(" ", t)
    t = _PHONE_RE.sub(" ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t or None


# ── Enumeration ────────────────────────────────────────────────────────────────
def browse_pages(s: cc.Session) -> list[str]:
    """All faceted browse URLs: /properties + the /view/<slug> pages from the sitemap +
    explicit /properties/for-sell|for-rent/<type-slug> pages."""
    pages: set[str] = {f"{BASE}/properties"}
    try:
        sm = s.get(SITEMAP, timeout=30).text
        for u in re.findall(r"<loc>(https://24\.com\.sa/view/[^<]+)</loc>", sm):
            pages.add(u.strip())
    except Exception:
        pass
    for deal in ("for-sell", "for-rent"):
        for t in ("شقق", "فلل", "أراضي", "أدوار", "عمائر", "استراحات", "مكاتب", "محلات",
                  "مستودعات", "مزارع", "مجمعات-سكنية"):
            pages.add(f"{BASE}/properties/{deal}/{t}")
    return list(pages)


def harvest_ids(s: cc.Session) -> tuple[set[int], int]:
    """Collect active listing ids linked from the browse pages. Returns (ids, max_id_seen)."""
    ids: set[int] = set()
    for u in browse_pages(s):
        try:
            b = s.get(u, timeout=40).text
        except Exception:
            continue
        for x in re.findall(r"24\.com\.sa/(\d+)/", b):
            ids.add(int(x))
    mx = max(ids) if ids else 0
    return ids, mx


def fetch_one(pid: int) -> Optional[tuple[int, str]]:
    """Fetch a detail page by id. Returns (pid, body) only when it is a REAL active listing
    (non-empty realestate_name). Sold/deleted/expired ids fall back to the homepage shell → None."""
    s = _session()
    url = f"{BASE}/{pid}/x"
    for attempt in range(3):
        try:
            r = s.get(url, timeout=40, allow_redirects=True)
        except Exception:
            time.sleep(0.8 * (attempt + 1))
            continue
        if r.status_code == 404:
            return None
        if r.status_code == 200:
            body = r.text
            m = REALESTATE_NAME_RE.search(body)
            if m and m.group(1).strip():
                return pid, body
            return None  # homepage fallback (sold/deleted/expired/out-of-range)
        time.sleep(0.8 * (attempt + 1))
    return None


# ── Parsing ────────────────────────────────────────────────────────────────────
def _spec_table(body: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for m in TH_TD_RE.finditer(body):
        key = _clean(m.group(1))
        val = _clean(m.group(2))
        if key and key not in out:
            out[key] = val
    return out


def _deal(body: str, realestate_name: str) -> str:
    """Return 'Rent' or 'Buy'. Source of truth: the deal word in the share/heading line."""
    m = re.search(r"(للبيع|للإيجار|للايجار|للتقبيل)\s*في", body)
    deal = m.group(1) if m else ""
    if not deal:
        # heading <h2> sometimes splits the word across whitespace; scan the realestate name too
        if any(w in body for w in ("للإيجار", "للايجار")) and "للبيع" not in body:
            deal = "للإيجار"
    if deal in ("للإيجار", "للايجار"):
        return "Rent"
    return "Buy"  # للبيع, للتقبيل (key-money transfer), or unknown → Buy (catalog is sale-heavy)


def _type(realestate_name: str, body: str) -> Optional[str]:
    name = (realestate_name or "").strip()
    if name in TYPE_MAP_AR:
        return TYPE_MAP_AR[name]
    for word, eng in TYPE_MAP_AR.items():
        if word in name:
            return eng
    return normalize.map_type(name)  # None when unmapped — the caller preserves the raw name


def _services(body: str) -> dict[str, bool]:
    amen: dict[str, bool] = {}
    i = body.find(SERVICES_MARK)
    if i < 0:
        return amen
    chunk = body[i:i + 1500]
    chunk = re.sub(r"<[^>]+>", " | ", chunk)
    for ar, col in SERVICE_COLS.items():
        if ar in chunk:
            amen[col] = True
    return amen


def map_listing(pid: int, body: str) -> tuple[Optional[dict], str]:
    """Return (row, category). None row → skip."""
    rn_m = REALESTATE_NAME_RE.search(body)
    realestate_name = rn_m.group(1).strip() if rn_m else ""
    if not realestate_name:
        return None, "residential"

    mapped_type = _type(realestate_name, body)
    # Unmapped type → STORE the raw realestate_name, never a guessed default (owner directive
    # 2026-07-16: never confidently misclassify — the raw value trips the DB novel-type detector,
    # which quarantines + alerts). The legacy value below feeds ONLY the routing/sanity rules.
    property_type = mapped_type or "Residential Land"  # type-truth: routing-legacy only — never stored
    stored_property_type = mapped_type or realestate_name
    transaction_type = _deal(body, realestate_name)
    is_rent = transaction_type == "Rent"

    # ── location: prefer the معلومات-الإعلان block; cross-check with the title ──
    info_city_m = INFO_CITY_RE.search(body)
    info_dist_m = INFO_DISTRICT_RE.search(body)
    info_street_m = INFO_STREET_RE.search(body)
    info_postal_m = INFO_POSTAL_RE.search(body)

    raw_city = _clean(info_city_m.group(1)) if info_city_m else ""
    district = _clean(info_dist_m.group(1)) if info_dist_m else None
    street = _clean(info_street_m.group(1)) if info_street_m else None
    postal = _clean(info_postal_m.group(1)) if info_postal_m else None

    title_city = title_district = None
    tm = TITLE_RE.search(body)
    title_text = _clean(tm.group(1)) if tm else None
    if title_text:
        pm = TITLE_PARSE_RE.search(title_text)
        if pm:
            title_city = _clean(pm.group(2))
            if pm.group(3):
                title_district = _clean(re.sub(r"^حي\s*", "", pm.group(3)))
    if not raw_city:
        raw_city = title_city or ""
    if not district:
        district = title_district

    # City: try normalize first; fall back to the local town→parent-city override; finally try the
    # title's city token (the معلومات block occasionally carries a street where the city should be).
    city = normalize.map_city(raw_city) if raw_city else None
    if not city and raw_city:
        key = raw_city.split("-")[0].strip()
        city = TOWN_TO_CITY.get(raw_city) or TOWN_TO_CITY.get(key)
    if not city and title_city:
        city = normalize.map_city(title_city) or TOWN_TO_CITY.get(title_city)
    region = normalize.region_for_city(city)

    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"
    is_land = property_type in ("Residential Land", "Commercial Land")

    # ── price ──
    pm = PRICE_RE.search(body)
    price = _to_int(pm.group(1)) if pm else None
    if price is not None and price < 1000:
        price = None  # reject display glitches / placeholder zeros

    # ── spec table ──
    specs = _spec_table(body)
    area = _to_float(specs.get("المساحة"))
    area = round(area) if area else None
    beds = _to_int(specs.get("عدد الغرف"))
    if is_land or category == "commercial":
        beds = None
    if beds is not None and (beds <= 0 or beds > 30):
        beds = None
    facade = specs.get("الواجهة") or None
    if facade in ("غير محدد", "", "-"):
        facade = None
    age_text = specs.get("عمر العقار") or None
    if age_text in ("غير محدد", ""):
        age_text = None

    # price_per_meter: the site's "سعر المتر" cell is reliable for land but for some buildings it
    # echoes the TOTAL price (e.g. ppm==price) — drop those and derive from price/area instead.
    ppm = _to_int(specs.get("سعر المتر"))
    if ppm and price and ppm >= price:
        ppm = None
    if not ppm and price and area and not is_rent:
        ppm = round(price / area)
    # Final sanity: a per-meter figure that still exceeds the total (tiny area / bad area) is bogus.
    if ppm and price and ppm > price:
        ppm = None

    # ── REGA license ──
    rega_m = REGA_NO_RE.search(body)
    rega_no = _to_int(rega_m.group(1)) if rega_m else None
    issue_m = REGA_ISSUE_RE.search(body)
    expiry_m = REGA_EXPIRY_RE.search(body)
    plan_m = INFO_PLAN_RE.search(body)
    parcel_m = INFO_PARCEL_RE.search(body)

    # ── PDPL-safe text ── (heading/title only; the listing has no free-text description field —
    # the descriptive copy is the share line, which we redact defensively).
    title = _redact(title_text.split("|")[0]) if title_text else None
    description = None  # 24 Souq detail pages carry no advertiser-written description block

    # ── photos ──
    photos: list[str] = []
    seen: set[str] = set()
    for u in IMG_RE.findall(body):
        if u not in seen:
            seen.add(u)
            photos.append(u)
        if len(photos) >= 25:
            break

    info: dict[str, Any] = {
        "type_ar": realestate_name,
        "city_ar": raw_city or None,
        "district_ar": district,
        "street_ar": street,
        "facade_ar": facade,
        "property_age_text": age_text,
        "plan_number": _clean(plan_m.group(1)) if plan_m else None,
        "parcel_number": _clean(parcel_m.group(1)) if parcel_m else None,
        "rega_ad_license_number": rega_no,
        "rega_license_issue_date": _clean(issue_m.group(1)) if issue_m else None,
        "rega_license_expiry_date": _clean(expiry_m.group(1)) if expiry_m else None,
    }
    info = {k: v for k, v in info.items() if v not in (None, "", "—")}

    row: dict[str, Any] = {
        "ad_number": f"SQ24-{pid}",
        "listing_url": f"{BASE}/{pid}/x",
        "source": "24 Souq",
        "active": True,
        "property_type": stored_property_type,
        "transaction_type": transaction_type,
        "area_m2": area,
        "bedrooms": beds,
        "direction": facade,
        "price_total": price if not is_rent else None,
        "price_annual": price if is_rent else None,
        "price_per_meter": ppm,
        "rent_period": "annual" if is_rent else None,
        "city": city,
        "region": region,
        "neighborhood": district,
        "zip_code": postal,
        "rega_location_verified": bool(rega_no),
        "title": title,
        "description": description,
        "photo_urls": photos,
        "additional_info": info,
    }
    row.update(_services(body))
    return row, category


# ── Main ────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    s = session()
    seed_ids, mx = harvest_ids(s)
    # Sweep the whole numeric range so older-but-active ads the facets hide are still caught.
    # Pad above the highest browse id; cap defensively.
    top = min(max(mx + 30, 1300, max(seed_ids, default=0) + 30), ID_CAP)
    candidate_ids = sorted(set(range(1, top + 1)) | seed_ids, reverse=True)
    if args.limit:
        # newest-first; take a generous slice so inactive ids don't starve the target count
        candidate_ids = candidate_ids[: max(args.limit * 8, 120)]
    print(f"24 Souq: {len(seed_ids)} browse-seeded ids, sweeping ids 1..{top} "
          f"({len(candidate_ids)} candidates, {WORKERS} workers)"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

    run_id = None if args.limit else db.begin_run("souq24")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        res_buf: list[dict] = []
        com_buf: list[dict] = []

        def flush() -> None:
            nonlocal res_buf, com_buf
            if res_buf:
                db.upsert_souq24_residential_batch(res_buf)
                res_buf = []
            if com_buf:
                db.upsert_souq24_commercial_batch(com_buf)
                com_buf = []

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for result in ex.map(fetch_one, candidate_ids):
                if not result:
                    continue
                pid, body = result
                row, cat = map_listing(pid, body)
                if not row:
                    continue
                if args.type != "all" and cat != args.type:
                    continue
                (com_buf if cat == "commercial" else res_buf).append(row)
                (com if cat == "commercial" else res).append(row)
                seen += 1
                if len(res_buf) + len(com_buf) >= 50:
                    flush()
                    print(f"  …{seen} upserted", flush=True)
                if args.limit and seen >= args.limit:
                    break
        flush()

        if args.limit:
            print(f"✓ 24 Souq VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            for r in (res + com)[:6]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "price_total", "price_annual",
                    "price_per_meter")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:80])
            return 0

        # Full run: prune listings that were active before but not seen this crawl.
        pruned = 0
        for tbl, rows_seen in (("souq24_residential_listings", res),
                               ("souq24_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="24 Souq")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ 24 Souq: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"pruned={pruned}", check_tables=["souq24_residential_listings", "souq24_commercial_listings"])
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
