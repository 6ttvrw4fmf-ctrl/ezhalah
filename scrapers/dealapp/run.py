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
visible مباع/مؤجر badge → active=False (kept but flagged), otherwise active=True.

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
    "ارض زراعية": "Residential Land", "مزرعة": "Farm", "مزرعه": "Farm",
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
def _sitemap_filter_urls(s: cc.Session) -> list[str]:
    """All AR filter-page URLs from the sitemap index (the pages that SSR-render listing links).
    We skip the EN children — they reference the same listing ids."""
    out: list[str] = []
    seen: set[str] = set()
    try:
        idx = s.get(SITEMAP_INDEX, timeout=40).text
    except Exception:
        return out
    children = re.findall(r"<loc>([^<]+)</loc>", idx)
    for child in children:
        try:
            body = s.get(child, timeout=60).text
        except Exception:
            continue
        for u in re.findall(r"<loc>([^<]+)</loc>", body):
            u = u.replace("&amp;", "&")
            # AR marketplace/category pages only (these embed /ad-details links)
            if "/ad-details/" in u:
                continue
            if ("/ar/" not in u):
                continue
            if u in seen:
                continue
            seen.add(u)
            out.append(u)
    # Prioritise the deep district/type filter pages (sitemap-2: they carry the long tail) before
    # the broad city landing pages, so a capped run still reaches many distinct listings.
    out.sort(key=lambda u: (u.count("/"), u), reverse=True)
    return out


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
    """Harvest the union of distinct /ad-details ids by crawling the filter pages."""
    urls = _sitemap_filter_urls(s)
    if cap_pages and len(urls) > cap_pages:
        urls = urls[:cap_pages]
    print(f"Deal App: {len(urls)} filter pages to harvest ids from ({WORKERS} workers)", flush=True)
    ids: list[str] = []
    seen: set[str] = set()
    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for batch in ex.map(_ids_from_page, urls):
            done += 1
            for i in batch:
                if i not in seen:
                    seen.add(i)
                    ids.append(i)
            if done % 200 == 0:
                print(f"  …{done}/{len(urls)} pages, {len(ids)} distinct ids", flush=True)
    print(f"Deal App: {len(ids)} distinct listing ids enumerated", flush=True)
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


def _spec_value(html: str, label: str) -> Optional[str]:
    """Value rendered next to a visible spec label (المساحة / عدد الغرف / …). Window-scan + strip
    tags, take the first short non-markup segment after the label."""
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


def map_listing(html: str, adid: str) -> tuple[Optional[dict], str]:
    schema = _listing_schema(html)
    if not schema:
        return None, "residential"
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
    if not property_type:
        property_type = "Residential Land" if "ارض" in type_ar or "أرض" in type_ar else (type_ar or "Other")

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

    # ── area / rooms / baths / price-per-meter from the visible spec table ──
    area = _num((_spec_value(html, "المساحة") or "").replace("م²", ""))
    area_m2 = round(area) if area else None
    beds = _int(io.get("numberOfRooms")) or _spec_int(html, "عدد الغرف")
    baths = _spec_int(html, "عدد الحمامات") or _spec_int(html, "دورات المياه")
    # For land/commercial AND whole-buildings, "rooms" is not a bedroom count (it's units/total) —
    # null it so it never pollutes the bedroom filter (the site reports e.g. 30 for عمارة).
    if (category == "commercial"
            or property_type in ("Residential Land", "Commercial Land", "Building")):
        beds = None
        baths = None
    if beds is not None and (beds <= 0 or beds > 30):
        beds = None
    if baths is not None and (baths <= 0 or baths > 30):
        baths = None
    ppm = _num((_spec_value(html, "سعر المتر") or "").replace("ريال", ""))
    price_per_meter = round(ppm) if ppm else (round(price / area) if (price and area and not is_rent) else None)

    # Advertiser data-entry errors on Deal App produce billion-riyal prices (e.g. a land ad with
    # سعر المتر = 800,000 ﷼/m² × 57,500 m² = 46,000,000,000). A per-meter price above 300k SAR/m² or a
    # total above 1B is not a real market price. We HIDE these (active=False below) rather than show a
    # priceless card — the dealapp.sa page still shows the bogus number, so a "Price on request" card
    # would contradict the page. Hiding keeps card price === the price the user sees after clicking.
    price_bad = bool((price_per_meter and price_per_meter > 300_000) or (price and price > 1_000_000_000))
    if price_bad:
        price = None
        price_per_meter = None

    # ── location: breadcrumb Arabic city is the best map_city input; addressRegion is the DISTRICT ──
    city_ar = _breadcrumb_city_ar(schema)
    city = normalize.map_city(city_ar) if city_ar else None
    if not city and city_ar:
        city = normalize.map_city(CITY_FALLBACK_AR.get(city_ar, "")) or None
    if not city:
        # last resort: try the English locality through the AR map (it won't match) — leave None
        city = None
    region = normalize.region_for_city(city)
    district = (addr.get("addressRegion") or "").strip() or None
    postal = (addr.get("postalCode") or "").strip() or None

    # ── active / sold ──
    availability = (offers.get("availability") or "").lower()
    sold = ("soldout" in availability) or ("outofstock" in availability)
    # visible status badge (only the pre-schema chrome carries the listing's own مباع/مؤجر badge;
    # the description prose can mention مؤجر about the unit without the listing being closed).
    head = html[: html.find("real-estate")] if "real-estate" in html else ""
    if "تم البيع" in head or "تم التأجير" in head:
        sold = True
    active = not sold and not price_bad

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
        "price_annual": price if is_rent else None,
        "price_per_meter": price_per_meter,
        "rent_period": "annual" if is_rent else None,
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
    return row, category


# ── main ─────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="VALIDATION run: upsert only the first N parsed listings, NO prune, print samples")
    args = ap.parse_args()

    s = session()

    if args.limit:
        # Validation: harvest a small set of ids from a handful of filter pages, parse the first N.
        filter_urls = _sitemap_filter_urls(s)
        ids: list[str] = []
        seen: set[str] = set()
        for u in filter_urls[:60]:
            for i in _ids_from_page(u):
                if i not in seen:
                    seen.add(i)
                    ids.append(i)
            if len(ids) >= args.limit * 4:
                break
        ids = ids[: max(args.limit * 4, 24)]
    else:
        ids = enumerate_ids(s, MAX_FILTER_PAGES)

    print(f"Deal App: parsing up to {len(ids)} listings"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}", flush=True)

    run_id = None if args.limit else db.begin_run("dealapp")
    res: list[dict] = []
    com: list[dict] = []
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
                row, cat = map_listing(html, adid)
                if not row:
                    continue
                if args.type != "all" and cat != args.type:
                    continue
                (com_buf if cat == "commercial" else res_buf).append(row)
                (com if cat == "commercial" else res).append(row)
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

        if args.limit:
            print(f"✓ Deal App VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            for r in (res + com)[:6]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "bathrooms",
                    "price_total", "price_annual", "price_per_meter", "rent_period")})
                print("     title:", (r.get("title") or "")[:70])
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:80], f"({len(r['photo_urls'])} imgs)")
            return 0

        pruned = 0
        for tbl, rows_seen in (("dealapp_residential_listings", res),
                               ("dealapp_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source=SOURCE)
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Deal App: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen_n, rows_upserted=seen_n, notes=f"pruned={pruned}")
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
