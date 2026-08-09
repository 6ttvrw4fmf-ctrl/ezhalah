"""Deal App (dealapp.sa / تطبيق ديل العقاري) scraper — Saudi Arabia's biggest property platform.

Deal App is a REGA-licensed, Dhahran-HQ'd Saudi property marketplace (Saudi-only rule: PASS —
.sa domain, Arabic-first, REGA ad licenses per listing). It is the BIGGEST target onboarded so
far (~10,000+ active listings). The site is an Angular Universal SSR app: api.dealapp.sa returns
JSON only behind auth, so we DO NOT use it — every field we need is server-rendered into the
/ad-details/{id} HTML, both as a RealEstateListing JSON-LD block (inside the `<script id="ng-state">`
TransferState payload) and as a visible spec table.

Data path — TWO STEPS, no auth / no proxy / no captcha (CloudFront origin):
  1. ENUMERATE ids. The multi-file sitemap index (sitemap-1..4.xml, ~13.9k AR+EN URLs, refreshed
     daily) holds city / district / type / deal-category FILTER pages, NOT individual listing URLs.
     Each filter page SSR-renders ~12 /ad-details/{id} links (a handful unique to that district +
     a recycled promoted set). So we crawl the filter pages and harvest the union of distinct
     /ad-details/{id} ids. (We crawl the AR sitemaps; the EN ones point at the same listing ids.)
  2. FETCH each /ad-details/{id} page and parse:
     • JSON-LD `real-estate-listing-schema-{id}` (in ng-state.schemaMarkupScripts):
         name (title; carries للبيع/للإيجار), description, image[] (gallery), datePosted,
         itemOffered.address (addressLocality=city EN, addressRegion=DISTRICT not region!,
         postalCode), itemOffered.geo (lat/lng), itemOffered.numberOfRooms (bedrooms),
         itemOffered.additionalProperty[] (propertyType AR, facing, streetWidth, propertyAge,
         utilities, licenseNumber=REGA, listingStatus), offers.price + priceCurrency.
       breadcrumb-list-schema position-2 name = the ARABIC city (best input for map_city).
     • visible spec table (rendered HTML): المساحة (area m²), عدد الغرف (rooms),
       عدد الحمامات/دورات المياه (baths), استخدامات العقار (usage سكني|تجاري|زراعي → res/com router
       for land), سعر المتر (price/m²), واجهة العقار (facade), عرض الشارع (street width),
       عمر العقار (age). The `purpose=SALE|RENT` query param on the category link = Buy/Rent signal.

Buy/Rent: purpose=SALE→Buy, purpose=RENT→Rent; fallback to للبيع/بيع vs للإيجار/ايجار in the name.
Land residential-vs-commercial routing follows the usage chip (تجاري→commercial), like Toor.

PDPL — HARD: offers.seller.name is a NATURAL-PERSON / agent name and the description embeds phones
+ "للتواصل/للحجز" blocks. We NEVER store seller name/phone, and we redact every 05x / +9665 /
9200 / 920 / 800 / wa.me / واتساب pattern from title + description and TRUNCATE the description at
the first contact/broker marker (copied from scrapers/aqaratikom + scrapers/semsar). Registered
COMPANY names (شركة/مؤسسة …) are allowed but we don't surface seller text at all here.

Sold/rented listings: the page sets offers.availability; a SoldOut/OutOfStock availability or a
visible مباع/مؤجر badge → active=False (kept but flagged) + a post-upsert missing_count=3 pin
(see _pin_sold_inactive) so the nightly auto_recover_false_inactive() sweep can't resurrect them,
otherwise active=True.

Usage:  python -m scrapers.dealapp.run [--type residential|commercial|all] [--limit N]
"""
from __future__ import annotations

import argparse
import json
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

SOURCE = "Deal App"
BASE = "https://dealapp.sa"
SITEMAP_INDEX = f"{BASE}/sitemap.xml"
# CloudFront origin; SSR re-render per page is cheap but be a polite neighbour to the biggest site.
WORKERS = int(os.environ.get("DEALAPP_WORKERS", "6"))
# Cap filter pages crawled for id-enumeration (full run). Each yields ~4-5 new ids; ~7k AR filter
# pages cover the catalog with overlap. Override via env to push toward the full ~10k on a long run.
MAX_FILTER_PAGES = int(os.environ.get("DEALAPP_MAX_FILTER_PAGES", "7000"))

# ── Arabic property type → canonical English (normalize.map_type covers the common ones; this map
# adds Deal-specific compound labels + the commercial set). map_type is tried first, this is the
# fallback/override. ───────────────────────────────────────────────────────────────────────────
TYPE_MAP_AR = {
    "شقة": "Apartment", "شقه": "Apartment", "دور": "Floor", "فيلا": "Villa", "فلة": "Villa",
    "بيت": "House", "منزل": "House", "غرفة": "Room", "استراحة": "Rest House", "استراحه": "Rest House",
    "شاليه": "Chalet", "مخيم": "Camp", "عمارة": "Building", "عماره": "Building", "برج": "Building",
    "مبنى شقق مفروشة": "Building", "مبنى": "Building", "عمائر": "Building",
    "ارض": "Residential Land", "أرض": "Residential Land", "ارض سكنية": "Residential Land",
    # أرض زراعية is its OWN clean type since the 2026-07-21 Farm/Agriculture-Plot split — never
    # folded into Residential Land. (canon unification, audit item 7d, 2026-07-27.)
    "ارض زراعية": "Agriculture Plot", "أرض زراعية": "Agriculture Plot",
    "مزرعة": "Farm", "مزرعه": "Farm",
    "دوبلكس": "Villa", "روف": "Floor", "بنتهاوس": "Apartment", "استوديو": "Apartment",
    # commercial
    "مكتب": "Office", "محل": "Shop", "معرض": "Showroom", "مستودع": "Warehouse",
    "ورشة": "Workshop", "ورشه": "Workshop", "مصنع": "Factory", "فندق": "Hotel",
    "ارض تجارية": "Commercial Land", "أرض تجارية": "Commercial Land",
    "عمارة تجارية": "Commercial Building", "مجمع تجاري": "Commercial Building",
    "محطة": "Gas Station", "محطة وقود": "Gas Station", "مغسلة": "Shop", "كشك": "Kiosk",
}
COMMERCIAL_TYPES = {
    "Office", "Shop", "Showroom", "Warehouse", "Workshop", "Factory", "Hotel",
    "Commercial Land", "Commercial Building", "Gas Station", "Kiosk",
}

# Small towns Deal lists that the shared CITY catalog doesn't carry → canonical city (region follows).
CITY_FALLBACK_AR = {
    "عسفان": "Jeddah", "ثول": "Thuwal", "الجموم": "Al Jumum", "بحرة": "Jeddah",
    "ذهبان": "Jeddah", "خليص": "Rabigh", "حريملاء": "Riyadh", "تمير": "Riyadh",
    "رويضة السهول": "Riyadh", "قرية العليا": "Hafar Al Batin", "ضرما": "Riyadh",
    "العيينة": "Diriyah", "ريمان": "Riyadh", "احد رفيده": "Khamis Mushait",
}

# PDPL phone / contact patterns to REDACT from title + description (adapted from aqaratikom/semsar).
_PHONE_RE = re.compile(
    r"(?:\+?00?966\d{8,9}"          # +966 / 00966 …
    r"|\b966\d{8,9}\b"
    r"|0?5\d(?:[\s\.\-]?\d){7}"     # 05XXXXXXXX with spacers
    r"|\b9200\d{4,6}\b"            # unified 9200 numbers
    r"|\b920\d{6}\b"
    r"|\b800\d{7}\b"
    r"|wa\.me/\S+"
    r"|واتس\S*\s*\d[\d\s\-]{6,}"
    r"|[oO0٥]5[oO0٥]\d{6,})"        # leetspeak o5o…
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")
# Truncate the description at the first contact/broker-attribution marker — everything after is
# attribution (can carry a natural-person name + phone).
_CUT_MARKERS = (
    "للتواصل", "للحجز", "للاستفسار", "التواصل", "تواصل معنا", "اتصل", "للبيع والتواصل",
    "واتساب", "واتس", "جوال", "الجوال", "اسم المعلن", "المعلن", "الوسيط", "المسوق",
    "اسم المالك", "للطلب", "للمعاينة", "حياك", "رقم الاعلان للتواصل",
)


_local = threading.local()


def _session() -> cc.Session:
    s = getattr(_local, "s", None)
    if s is None:
        s = cc.Session(impersonate="chrome124")
        s.headers.update({
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
        })
        _local.s = s
    return s


def session() -> cc.Session:
    return cc.Session(impersonate="chrome124")


def _int(v: Any) -> Optional[int]:
    n = normalize.to_int(v)
    return n if n else None


def _num(v: Any) -> Optional[float]:
    if v in (None, "", "—"):
        return None
    try:
        s = str(v).translate(normalize._TRANS)
        s = re.sub(r"[^\d.]", "", s)
        return float(s) if s else None
    except (TypeError, ValueError):
        return None


def _redact(text: Optional[str]) -> Optional[str]:
    """Strip phones / wa.me / contact blocks and truncate at the first broker/contact marker (PDPL)."""
    if not text:
        return text
    t = _PHONE_LOOSE.sub(" ", text)
    t = _PHONE_RE.sub(" ", t)
    cut = len(t)
    for m in _CUT_MARKERS:
        i = t.find(m)
        if i != -1:
            cut = min(cut, i)
    t = t[:cut]
    t = _PHONE_RE.sub(" ", t)          # re-pass in case a number sat before the cut
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    t = re.sub(r"[\s*_\-•·–—]+$", "", t)
    return t.strip() or None


# ── id enumeration ───────────────────────────────────────────────────────────────
def _sitemap_entries(s: cc.Session) -> tuple[list[str], list[str]]:
    """Parse the sitemap index once → (listing_ids, filter_urls).

    Dealapp's sitemap now enumerates every /ad-details/{id} listing DIRECTLY (~58k URLs). Those ids
    ARE the live catalogue and must be scraped directly. This function used to `continue` past every
    /ad-details URL and re-derive ids by crawling only the filter pages — which reached ~7% of the
    catalogue (the rest never got captured). We now harvest the listing ids straight from the sitemap
    and keep the remaining /ar/ city/type/district FILTER pages as a BACKSTOP (they SSR-render links
    to any brand-new id the sitemap hasn't picked up yet). EN children carry the same listing ids, so
    dedup-by-id collapses them."""
    listing_ids: list[str] = []
    filter_urls: list[str] = []
    seen_id: set[str] = set()
    seen_url: set[str] = set()
    try:
        idx = s.get(SITEMAP_INDEX, timeout=40).text
    except Exception:
        return listing_ids, filter_urls
    for child in re.findall(r"<loc>([^<]+)</loc>", idx):
        try:
            body = s.get(child, timeout=60).text
        except Exception:
            continue
        for u in re.findall(r"<loc>([^<]+)</loc>", body):
            u = u.replace("&amp;", "&")
            m = re.search(r"/ad-details/(\d+)", u)
            if m:
                i = m.group(1)
                if i not in seen_id:
                    seen_id.add(i)
                    listing_ids.append(i)
                continue
            if "/ar/" not in u or u in seen_url:
                continue
            seen_url.add(u)
            filter_urls.append(u)
    # Prioritise the deep district/type filter pages (sitemap-2: they carry the long tail) before
    # the broad city landing pages, so a capped backstop run still reaches many distinct listings.
    filter_urls.sort(key=lambda u: (u.count("/"), u), reverse=True)
    return listing_ids, filter_urls


def _active_ids_for_reconfirm() -> set[str]:
    """Every ad_number we currently mark active, as canonical numeric ids, so each crawl RE-FETCHES
    them against source. Coverage alone can't tell a removed listing from one the sitemap merely
    omits (both are absent from it) — but a re-fetch can: a still-live page re-confirms the row, a
    dead page drops it from the seen set and prune_unseen ages it out on its 3-strike guard. This is
    what turns the coverage crawl into an honest liveness signal without any risky bulk delete."""
    ids: set[str] = set()
    for tbl in ("dealapp_residential_listings", "dealapp_commercial_listings"):
        start = 0
        while True:  # PostgREST caps a select at 1000 rows — page explicitly
            rows = db._execute(
                db.sb().table(tbl).select("ad_number").eq("active", True).eq("source", SOURCE)
                  .range(start, start + 999),
                what=tbl + ".active_ids",
            ).data or []
            for r in rows:
                m = re.search(r"\d+", r.get("ad_number") or "")
                if m:
                    ids.add(str(int(m.group())))
            if len(rows) < 1000:
                break
            start += 1000
    return ids


def _ids_from_page(url: str) -> list[str]:
    s = _session()
    for attempt in range(2):
        try:
            r = s.get(url, timeout=40)
            if r.status_code == 200:
                return re.findall(r"/ad-details/(\d+)", r.text)
        except Exception:
            time.sleep(0.6 * (attempt + 1))
    return []


def enumerate_ids(s: cc.Session, cap_pages: int) -> list[str]:
    """Ordered list of /ad-details ids to scrape this run. Sources, in PRIORITY order:
      1. sitemap listing ids we do NOT already hold active  → new coverage (the ~54k we were missing)
      2. sitemap listing ids we already hold active         → re-confirm (liveness)
      3. active ids absent from the sitemap                 → re-fetch (omitted-live vs truly removed)
      4. filter-page harvest                                → backstop for ids not yet in the sitemap

    Why the order matters: dealapp throttles to a few workers with no proxy (its anonymous origin
    trips a login-wall under load), so one job can only fetch a slice of the 58k catalogue. Putting
    NEW listings first means each run spends its budget closing the coverage gap — and because a
    scraped id becomes active, it drops out of bucket 1 next run, so coverage advances run-over-run
    instead of re-fetching the same prefix. DEALAPP_MAX_LISTINGS caps the run so it finishes cleanly
    (prune + end_run run normally) instead of being killed at the job timeout. Ids are canonicalised
    to str(int(...)) so a zero-padded ad_number and its bare form collapse to one fetch."""
    listing_ids, filter_urls = _sitemap_entries(s)
    active = _active_ids_for_reconfirm()
    max_listings = int(os.environ.get("DEALAPP_MAX_LISTINGS", "0"))  # 0 = no cap (full crawl)

    def _norm(raw: str) -> Optional[str]:
        m = re.search(r"\d+", raw or "")
        return str(int(m.group())) if m else None

    seen: set[str] = set()
    new_ids: list[str] = []
    known_ids: list[str] = []
    for raw in listing_ids:
        i = _norm(raw)
        if not i or i in seen:
            continue
        seen.add(i)
        (known_ids if i in active else new_ids).append(i)
    tail = [i for i in active if i not in seen]     # active but not in the current sitemap
    seen.update(tail)
    ids = new_ids + known_ids + tail

    # Filter-page backstop: only worth the extra fetches on an UNCAPPED full crawl; a capped
    # catch-up run should spend every request on the prioritised listing ids above.
    if not max_listings:
        if cap_pages and len(filter_urls) > cap_pages:
            filter_urls = filter_urls[:cap_pages]
        done = 0
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for batch in ex.map(_ids_from_page, filter_urls):
                done += 1
                for raw in batch:
                    i = _norm(raw)
                    if i and i not in seen:
                        seen.add(i)
                        ids.append(i)
                if done % 200 == 0:
                    print(f"  …{done}/{len(filter_urls)} filter pages, {len(ids)} ids", flush=True)

    if max_listings and len(ids) > max_listings:
        ids = ids[:max_listings]
    print(f"Deal App: {len(ids)} ids to scrape "
          f"({len(new_ids)} new-from-sitemap first, {len(known_ids)} re-confirm, {len(tail)} off-sitemap"
          f"{'' if not max_listings else f', capped at {max_listings}'})", flush=True)
    return ids


# ── detail parsing ───────────────────────────────────────────────────────────────
def _listing_schema(html: str) -> Optional[dict]:
    m = re.search(r'<script id="ng-state" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        return None
    try:
        state = json.loads(m.group(1))
    except Exception:
        return None
    sm = state.get("schemaMarkupScripts") or {}
    raw = next((v for k, v in sm.items() if k.startswith("real-estate-listing")), None)
    if raw is None:
        return None
    try:
        out = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return None
    # stash the breadcrumb so we can read the Arabic city name (best map_city input)
    bc = sm.get("breadcrumb-list-schema")
    if bc is not None:
        try:
            out["_breadcrumb"] = json.loads(bc) if isinstance(bc, str) else bc
        except Exception:
            pass
    return out


def _breadcrumb_city_ar(schema: dict) -> Optional[str]:
    bc = schema.get("_breadcrumb") or {}
    items = bc.get("itemListElement") or []
    # position 2 = city (position 1 = الرئيسية/home)
    for it in items:
        if it.get("position") == 2:
            n = (it.get("name") or "").strip()
            return n or None
    return None


def _breadcrumb_district_ar(schema: dict, city_ar: Optional[str]) -> Optional[str]:
    """The listing's OWN title (schema breadcrumb position 3) is "<type/deal> - <district_ar> - <city_ar>",
    e.g. "شقة للإيجار - الراشدية - مكة المكرمة" — the middle segment is dealapp's own ARABIC district for
    THIS listing, and it agrees with the (English) schema addressRegion, just in Arabic. We take THIS.
    NOT schema.org address.addressRegion (English, and frequently the wrong "Riyadh" default). NOT the page's
    `.location` element either — verified unreliable (it can name a different/adjacent district than the
    listing's own title, e.g. .location='حي الشرائع' on a listing titled 'الراشدية'). Returns the Arabic
    district verbatim, or None → honest «الحي غير محدد». Never English.
    (feedback_english-district-to-arabic-mapping-standard)"""
    city = (city_ar or "").strip()
    bc = schema.get("_breadcrumb") or {}
    for it in (bc.get("itemListElement") or []):
        if it.get("position") == 3:
            title = (it.get("name") or "").strip()
            parts = [p.strip() for p in re.split(r"\s+[-–]\s+", title) if p.strip()]
            if len(parts) >= 3:                     # "<type/deal> - <district> - <city>"
                cand = parts[1]                     # the middle segment is the district
                if re.search(r"[ء-ي]", cand) and cand != city:
                    return cand
    return None


def _spec_value(html: str, label: str) -> Optional[str]:
    """Value rendered next to a visible spec label (المساحة / عدد الغرف / …). Window-scan + strip
    tags, take the first short non-markup segment after the label.

    Only searches past `</head>`: the site's OpenGraph/Twitter share-preview <meta> tags embed a
    compact blurb like "...المساحة / 162م\\n💰السعر / 620،000﷼..." with BOTH the area and price on
    one line and no HTML tag between them. The tag-based segment splitter below never fires on that
    (only a newline separates them), so the whole blob came back as one "value" and _num()'s
    digit-stripping fused "162" + "620,000" into area_m2=162620000 (confirmed live, 2026-07-29:
    id 956972/2295991/1846258/1274844). The real spec table only ever renders in <body>.
    (This guard was accidentally dropped in PR#289 — its pinned tests went red within the hour;
    restored 2026-08-03. Do not remove: the district breadcrumb does NOT need head content.)"""
    body_start = html.find("</head>")
    html = html[body_start:] if body_start != -1 else html
    for m in re.finditer(re.escape(label), html):
        win = html[m.end():m.end() + 400]
        txt = re.sub(r"<[^>]+>", " | ", win)
        txt = re.sub(r"\s+", " ", txt)
        for seg in txt.split("|"):
            seg = seg.strip()
            if not seg or seg == label:
                continue
            if seg.startswith(("_ngcontent", "assets", "src", "ng-c", "http")):
                continue
            if len(seg) > 60:
                continue
            return seg
    return None


def _spec_int(html: str, label: str) -> Optional[int]:
    v = _spec_value(html, label)
    return _int(v) if v else None


def _purpose(html: str) -> Optional[str]:
    m = re.search(r"purpose=([A-Z]+)", html)
    return m.group(1) if m else None


# Rent period the page itself declares — dealapp has no structured period field, so `rent_period`
# was previously hardcoded to "annual" unconditionally, silently storing a daily/weekly/monthly rate
# as if it were yearly (found live 2026-07-28: ad DA468049 priced "500 ريال" but the page's own text
# reads "إيجار يومي" — daily — while price_annual was stored as 500, understating the true annual
# cost ~365x; 160 active Rent rows system-wide show the same implausibly-low-for-annual signature).
# Scoped to a window around each "إيجار" occurrence (not the whole page) so an unrelated "شهري"/
# "يومي" elsewhere on the page (a newsletter signup, an unrelated widget) can't false-positive.
# Multiplier annualizes to SAR/year; rent_period keeps this scraper's existing "annual"/"monthly"
# vocabulary (no other scraper in this codebase uses a finer-grained value) — a daily/weekly source
# rate is recorded as "monthly" (not annual) since that's this schema's only non-annual bucket.
# P0 (2026-08-05): the period MUST come from dealapp's own structured price badge, never from prose.
#
# The old scan walked EVERY «إيجار» in the whole document — including <head> (og:description) and the
# broker's free-text description — and returned on the first period token it saw, then DEFAULTED to
# "annual" if it found none. Both halves were wrong, and I reproduced it on live pages with the real
# production function:
#   DA443363 — badge «إيجار سنوي» (ANNUAL), detector said daily -> stored 60,000/yr as 21,900,000
#   DA537587 — badge «إيجار سنوي», description says «إيجار يومي» -> detector said daily -> 12,775,000
#   DA552452 — badge «إيجار يومي», genuinely daily
# Scoping to the body is NOT sufficient: DA443363's description also contains a period token that
# precedes the badge in document order.
#
# dealapp renders exactly one structured badge per hydrated detail page:
#   ...src="assets/imgs/coin.svg"></ion-icon><span class="typographyTextXsLd0Normal"> إيجار {PERIOD}
# That badge is the only published statement of the period (the JSON-LD carries price/currency only),
# so it is the sole anchor. If the badge is absent the page did not hydrate — we return None
# (UNKNOWN) rather than assuming "annual", because a default is a guess and the owner's rule is that
# an unconfident source value is stored as unknown, never invented.
_PERIOD_BADGE_RE = re.compile(
    r"coin\.svg[^>]*>\s*</ion-icon>\s*<span[^>]*>\s*إيجار\s*(يومي|أسبوعي|شهري|سنوي)"
)
_PERIOD_AR_TO_EN = {"يومي": "daily", "أسبوعي": "weekly", "شهري": "monthly", "سنوي": "annual"}


def _rent_period_window(html: str) -> Optional[str]:
    """The period dealapp itself prints on the listing, or None when it does not print one."""
    m = _PERIOD_BADGE_RE.search(html)
    return _PERIOD_AR_TO_EN.get(m.group(1)) if m else None


def _rent_annualize(price: Optional[int], html: str) -> tuple[Optional[int], Optional[str]]:
    """(price_annual, rent_period) — never a magnitude the source did not publish.

    annual  -> stored verbatim.
    monthly -> ×12. This is the schema's annualisation contract, identical on every platform:
               price_annual holds the ANNUAL figure and the app divides by 12 to display a monthly
               price, so ×12 round-trips back to exactly the number dealapp printed. It converts the
               unit of the same stated rent; it does not invent a different one.
    daily / weekly -> UNKNOWN (None, None). The old code stored price×365 / ×52 and labelled it
               "monthly", which both fabricated a magnitude dealapp never published (DA552452:
               350/day became 127,750, and the card then rendered "SAR 10,645/mo") and mislabelled
               the period. This schema has no daily or weekly bucket, so the honest answer is that we
               cannot represent it — the listing keeps its other fields and simply carries no price.
               Inventing an annual figure to fill the column is exactly what the fidelity rule bans.
    no badge -> UNKNOWN, never a default.
    """
    if price is None:
        return None, None
    period = _rent_period_window(html)
    if period == "annual":
        return price, "annual"
    if period == "monthly":
        return price * 12, "monthly"
    return None, None


def _images(schema: dict) -> list[str]:
    imgs = schema.get("image")
    out: list[str] = []
    seen: set[str] = set()
    if isinstance(imgs, list):
        for u in imgs:
            if isinstance(u, str) and u.startswith("http") and u not in seen:
                seen.add(u)
                out.append(u)
    elif isinstance(imgs, str) and imgs.startswith("http"):
        out.append(imgs)
    return out[:25]


def has_priced_schema(html: str) -> bool:
    """True iff the ng-state schema block carries a non-empty offers.price.

    PRICE-FIDELITY FIX (2026-07-14): dealapp's Angular SPA intermittently serves a SKELETON
    response — the "real-estate-listing" schema KEY is present (so the old `"real-estate-listing"
    in r.text` check passed) but its `offers.price` is empty/absent, apparently a server-side-
    render caught before full hydration. fetch_one used to accept that response as final, silently
    producing a priceless row for a listing that genuinely HAS a price. Proven live during the
    2026-07-13/14 price-fidelity repair: retrying up to 3 times recovered a real price for 28 of 37
    listings previously believed unfetchable/removed.
    """
    schema = _listing_schema(html)
    offers = (schema or {}).get("offers") or {}
    return bool(offers.get("price"))


def fetch_one(adid: str) -> Optional[tuple[str, str]]:
    s = _session()
    url = f"{BASE}/ar/ad-details/{adid}"
    last_skeleton_html: Optional[str] = None
    for attempt in range(3):
        try:
            r = s.get(url, timeout=45, allow_redirects=True)
        except Exception:
            time.sleep(1.0 * (attempt + 1))
            continue
        if r.status_code == 200 and "real-estate-listing" in r.text:
            if has_priced_schema(r.text):
                return r.text, adid
            # Skeleton hit: keep the response as a fallback and retry for a fully-hydrated one.
            last_skeleton_html = r.text
        if r.status_code in (404, 410):
            return None
        time.sleep(0.8 * (attempt + 1))
    # Exhausted retries without ever seeing a priced schema. Fall back to the last skeleton
    # response we did get — map_listing's existing `_int(offers.get("price"))` already yields
    # None for an absent price, so the listing still ingests and surfaces as "Price on request"
    # rather than being silently dropped. Never invent a price, never let a genuinely-present
    # listing vanish because of a transient render gap.
    return (last_skeleton_html, adid) if last_skeleton_html else None


def _resolve_city(city_ar: Optional[str]) -> Optional[str]:
    """Arabic breadcrumb city -> canonical English city name. `CITY_FALLBACK_AR` values are
    ALREADY canonical English (Riyadh, Jeddah, ...) — never re-wrap them through map_city(),
    which only matches Arabic and would silently no-op (deep-location-audit 2026-08-04)."""
    if not city_ar:
        return None
    return normalize.map_city(city_ar) or CITY_FALLBACK_AR.get(city_ar) or None


def map_listing(html: str, adid: str) -> tuple[Optional[dict], str, bool]:
    """Parse one /ad-details page into a canonical row. Returns (row, category, sold) —
    `sold` feeds the post-upsert inactive pin in main (see _pin_sold_inactive)."""
    schema = _listing_schema(html)
    if not schema:
        return None, "residential", False
    io = schema.get("itemOffered") or {}
    addr = io.get("address") or {}
    geo = io.get("geo") or {}
    aprops = {p.get("name"): p.get("value") for p in io.get("additionalProperty", []) if isinstance(p, dict)}

    name = schema.get("name") or ""

    # ── transaction type: purpose param first, then name keywords ──
    purpose = _purpose(html)
    if purpose == "RENT":
        is_rent = True
    elif purpose == "SALE":
        is_rent = False
    else:
        is_rent = ("للإيجار" in name) or ("للايجار" in name) or ("إيجار" in name) or ("ايجار" in name)
    transaction_type = "Rent" if is_rent else "Buy"

    # ── property type (Arabic → English) ──
    type_ar = (aprops.get("propertyType") or "").strip()
    property_type = TYPE_MAP_AR.get(type_ar) or normalize.map_type(type_ar)
    # NO substring guessing and NO 'Other' fallback (audit item 7d, 2026-07-27): an unmapped raw
    # type stays as-is → the sentinel/novel-type quarantine reviews it instead of a silent
    # misclassification («ارض …» variants used to be blanket-guessed as Residential Land).
    if not property_type:
        property_type = type_ar or None

    # ── usage chip drives residential/commercial routing (authoritative for land) ──
    usage = _spec_value(html, "استخدامات العقار")
    is_commercial_usage = usage == "تجاري"
    if property_type in ("Residential Land", "Commercial Land"):
        property_type = "Commercial Land" if is_commercial_usage else "Residential Land"
    category = "commercial" if (property_type in COMMERCIAL_TYPES or is_commercial_usage) else "residential"

    # ── price ──
    offers = schema.get("offers") or {}
    price = _int(offers.get("price"))
    if price is not None and price < 100:
        price = None
    price_annual, rent_period = _rent_annualize(price, html) if is_rent else (None, None)

    # ── area / rooms / baths / price-per-meter from the visible spec table ──
    area = _num((_spec_value(html, "المساحة") or "").replace("م²", ""))
    area_m2 = round(area) if area else None
    # numberOfRooms / "عدد الغرف" are generic total-room-count fields, never bedroom-specific — this
    # was already known for land/commercial/Building (the site reports e.g. 30 "rooms" for a whole
    # عمارة), but the SAME ambiguity holds for Apartment/Villa too: live-confirmed 2026-07-28 on ad
    # 558063 — DB stored bedrooms=6 from this field, the listing's own description enumerates only
    # 3 actual bedrooms (majlis/laundry counted alongside them in the "6"). Owner decision: null
    # unconditionally rather than store an unverifiable figure for any category.
    beds = None
    baths = _spec_int(html, "عدد الحمامات") or _spec_int(html, "دورات المياه")
    if category == "commercial" or property_type in ("Residential Land", "Commercial Land", "Building"):
        baths = None
    if baths is not None and (baths <= 0 or baths > 30):
        baths = None
    ppm = _num((_spec_value(html, "سعر المتر") or "").replace("ريال", ""))
    # Source-published «سعر المتر» only. The old price/area fallback fabricated a rate — and
    # because a later gate can null price_total, it left rows showing «سعر المتر ر.س 0» on a
    # price-less card (5 live rows, 2026-07-26). (aqar PR#216, scrapers PR#217.)
    price_per_meter = (round(ppm) or None) if ppm else None  # round(0.25)→0 is not a rate; store honest NULL

    # OWNER RULE (2026-07-30, extreme-price verify-then-preserve — RE-AFFIRMED by the owner
    # 2026-08-03: «whatever is in those platforms keep it how it is, even if small to large we are
    # copy pasting whatever they display»): an unrealistic-looking price is NEVER invalid by
    # assumption. These values come verbatim from the source payload (offers.price / سعر المتر) —
    # dealapp itself publishes them (verified live: ad 548642 carries "price": 3550000000 with
    # سعر المتر 100,000 ﷼/m²; re-verified 2026-08-03 across 127 dealapp extremes, 0 mismatches).
    # Preserve them EXACTLY and keep the listing active; do not cap, null, hide, or deactivate.
    # Only a PROVEN pipeline-introduced error (misplaced decimal, duplicated digits, phone/licence
    # captured as price, unit conversion) may be repaired — none applies here.
    # (The old plausibility hide also caused a daily flap: crawl hid → 05:20 sweep resurrected.
    # A `price_bad` hide re-appeared in PR#289 and was reverted the same day — its pinned tests
    # in test_dealapp_extreme_price_preserved.py went red within the hour. Do not re-add.)

    # ── location: breadcrumb Arabic city is the best map_city input; addressRegion is the DISTRICT ──
    city_ar = _breadcrumb_city_ar(schema)
    city = _resolve_city(city_ar)
    region = normalize.region_for_city(city)
    # District: the SOURCE's own Arabic from the page's .location line ("حي …"). We deliberately do NOT
    # use schema.org address.addressRegion — it is English and frequently a wrong default ("Riyadh"),
    # which was silently storing English/incorrect districts. No Arabic on the page → honest null.
    # (feedback_english-district-to-arabic-mapping-standard: never show English; unsure → «الحي غير محدد».)
    district = _breadcrumb_district_ar(schema, city_ar)
    postal = (addr.get("postalCode") or "").strip() or None

    # ── active / sold ──
    availability = (offers.get("availability") or "").lower()
    sold = ("soldout" in availability) or ("outofstock" in availability)
    # visible status badge (only the pre-schema chrome carries the listing's own مباع/مؤجر badge;
    # the description prose can mention مؤجر about the unit without the listing being closed).
    head = html[: html.find("real-estate")] if "real-estate" in html else ""
    if "تم البيع" in head or "تم التأجير" in head:
        sold = True
    active = not sold
    # Only `sold` (source-confirmed gone) is returned for the post-upsert inactive PIN in main.

    # ── geo / REGA / facade etc → additional_info ──
    lat = geo.get("latitude")
    lng = geo.get("longitude")
    facade = _spec_value(html, "واجهة العقار") or aprops.get("facing")
    street_w_text = _spec_value(html, "عرض الشارع")
    street_w = _int(street_w_text) if street_w_text and re.search(r"\d", street_w_text) else None
    age_text = _spec_value(html, "عمر العقار")
    rega_no = aprops.get("licenseNumber")

    info: dict[str, Any] = {
        "city_ar": city_ar,
        "district_ar": district,
        "category_ar": type_ar or None,
        "usage_ar": usage or None,
        "facade": facade or None,
        "property_age_text": age_text or None,
        "street_width": street_w_text if (street_w_text and re.search(r"\d", street_w_text)) else None,
        "rega_ad_license_number": str(rega_no) if rega_no else None,
        "negotiable": True if "قابل للتفاوض" in html else None,
        "latitude": str(lat) if lat is not None else None,
        "longitude": str(lng) if lng is not None else None,
        "date_posted": schema.get("datePosted"),
    }
    info = {k: v for k, v in info.items() if v not in (None, "", "—")}

    listing_url = f"{BASE}/ar/ad-details/{adid}"
    row: dict[str, Any] = {
        "ad_number": f"DA{adid}",
        "listing_url": listing_url,
        "source": SOURCE,
        "active": active,
        "property_type": property_type,
        "transaction_type": transaction_type,
        "area_m2": area_m2,
        "bedrooms": beds,
        "bathrooms": baths,
        "street_width_m": street_w,
        "price_total": price if not is_rent else None,
        "price_annual": price_annual,
        "price_per_meter": price_per_meter,
        # PRICE = SOURCE evidence (owner invariant 2026-08-04). dealapp publishes a STRUCTURED
        # offers.price; record it verbatim next to what we store, so "is 720M real?" is answerable
        # from the DB alone. The 2026-08-09 forensic on DA545798/DA507447 needed a live-page session
        # for exactly this reason — no evidence had been kept. A witness only: run.py reads
        # offers.price directly (line ~597); this never feeds the stored price.
        "price_evidence": normalize.price_evidence(
            field="offers.price",
            raw=offers.get("price"),
            stored=price,
            kind="total" if not is_rent else (rent_period or "annual"),
            unit="total",
            origin="structured",
        ),
        "rent_period": rent_period,
        "city": city,
        "region": region,
        "neighborhood": district,
        "zip_code": postal,
        "rega_location_verified": bool(rega_no),
        "title": _redact(name) or None,
        "description": _redact(schema.get("description")),
        "photo_urls": _images(schema),
        "additional_info": info,
    }
    return row, category, sold


def _pin_sold_inactive(table: str, ad_numbers: list[str]) -> None:
    """Make source-confirmed SOLD rows survive the nightly auto_recover_false_inactive() sweep.

    That pg_cron job (05:20 UTC) re-activates any active=false row with
    coalesce(missing_count, 0) = 0 and a fresh last_seen_at — and the shared batch upsert
    (db._wasalt_batch) unconditionally writes missing_count=0 for every row it touches, which is
    exactly what let sold listings resurrect every morning (907 dealapp_residential + 5
    dealapp_commercial rows sat in that vulnerable state on 2026-07-16). So AFTER the batch upsert
    we pin the sold rows to missing_count=3 (the existing prune 3-strike threshold) + active=false.
    prune_unseen() never undoes this: it only selects active=true rows and only updates ids NOT
    in its seen set. When a sold listing is later relisted, its next upsert carries active=true
    and the upsert's own missing_count=0 reset applies — the pin is only written for ids that are
    sold THIS crawl.

    Deal App scope: only *sold* ids (SoldOut/OutOfStock availability or a تم البيع/تم التأجير
    badge) are pinned. There is no other deactivation path in this scraper — extreme prices are
    preserved ACTIVE per the owner rule (see the OWNER RULE comment in map_listing)."""
    for i in range(0, len(ad_numbers), 200):
        db._execute(
            db.sb().table(table).update({"active": False, "missing_count": 3})
            .in_("ad_number", ad_numbers[i:i + 200]),
            what=table + ".sold_pin",
        )


# ── main ─────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="VALIDATION run: upsert only the first N parsed listings, NO prune, print samples")
    args = ap.parse_args()

    s = session()

    if args.limit:
        # Validation: take a small set of ids straight from the sitemap (falling back to filter
        # pages only if the sitemap came back empty), parse the first N.
        listing_ids, filter_urls = _sitemap_entries(s)
        want = max(args.limit * 4, 24)
        seen: set[str] = set()
        ids: list[str] = []
        for raw in listing_ids:
            i = str(int(raw))
            if i not in seen:
                seen.add(i)
                ids.append(i)
            if len(ids) >= want:
                break
        for u in filter_urls[:60]:
            if len(ids) >= want:
                break
            for raw in _ids_from_page(u):
                i = str(int(raw))
                if i not in seen:
                    seen.add(i)
                    ids.append(i)
        ids = ids[:want]
    else:
        ids = enumerate_ids(s, MAX_FILTER_PAGES)

    print(f"Deal App: parsing up to {len(ids)} listings"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}", flush=True)

    run_id = None if args.limit else db.begin_run("dealapp")
    res: list[dict] = []
    com: list[dict] = []
    sold_res: list[str] = []
    sold_com: list[str] = []
    seen_n = 0
    try:
        res_buf: list[dict] = []
        com_buf: list[dict] = []

        def flush() -> None:
            nonlocal res_buf, com_buf
            if res_buf:
                if not args.limit:
                    db.upsert_dealapp_residential_batch(res_buf)
                res_buf = []
            if com_buf:
                if not args.limit:
                    db.upsert_dealapp_commercial_batch(com_buf)
                com_buf = []

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for result in ex.map(fetch_one, ids):
                if not result:
                    continue
                html, adid = result
                row, cat, sold = map_listing(html, adid)
                if not row:
                    continue
                if args.type != "all" and cat != args.type:
                    continue
                (com_buf if cat == "commercial" else res_buf).append(row)
                (com if cat == "commercial" else res).append(row)
                if sold:
                    (sold_com if cat == "commercial" else sold_res).append(row["ad_number"])
                seen_n += 1
                if not args.limit and len(res_buf) + len(com_buf) >= 100:
                    flush()
                    print(f"  …{seen_n} parsed/upserted", flush=True)
                if args.limit and seen_n >= args.limit:
                    break
        if args.limit:
            # write exactly the validation rows
            if res:
                db.upsert_dealapp_residential_batch(res)
            if com:
                db.upsert_dealapp_commercial_batch(com)
        else:
            flush()
        # Pin sold rows immediately after the upserts (which reset their missing_count to 0), so
        # the 05:20 auto-recover job can never flip them back to active. See _pin_sold_inactive.
        if sold_res:
            _pin_sold_inactive("dealapp_residential_listings", sold_res)
        if sold_com:
            _pin_sold_inactive("dealapp_commercial_listings", sold_com)
        sold_ct = len(sold_res) + len(sold_com)

        if args.limit:
            print(f"✓ Deal App VALIDATION: {len(res)} residential + {len(com)} commercial upserted "
                  f"({sold_ct} sold) (no prune)")
            for r in (res + com)[:6]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "bathrooms",
                    "price_total", "price_annual", "price_per_meter", "rent_period")})
                print("     title:", (r.get("title") or "")[:70])
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:80], f"({len(r['photo_urls'])} imgs)")
            return 0

        # Sold rows were already upserted with active=False + pinned missing_count=3 above;
        # prune_unseen never touches them (it only reads active=true rows and only updates ids
        # missing from the seen set), so passing their ad_numbers here is harmless.
        pruned = 0
        for tbl, rows_seen in (("dealapp_residential_listings", res),
                               ("dealapp_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source=SOURCE)
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Deal App: {len(res)} residential + {len(com)} commercial upserted, "
              f"{sold_ct} sold (inactive), {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen_n, rows_upserted=seen_n,
                   notes=f"sold={sold_ct} pruned={pruned}",
                   check_tables=["dealapp_residential_listings", "dealapp_commercial_listings"])
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen_n, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
