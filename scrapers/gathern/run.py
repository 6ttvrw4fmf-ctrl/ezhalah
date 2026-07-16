"""Gathern (gathern.co / جاذرإن) scraper — Saudi short-stay marketplace, MONTHLY residential units.

Gathern is a Saudi furnished short-term-rental marketplace (apartments, studios, villas, rooms,
chalets, farms, camps, rest-houses). Ezhalah ingests ONLY its RESIDENTIAL dwelling types offered
for a MONTHLY (30-day) stay — Gathern's own "للإيجار الشهري" long-stay product. Leisure types
(chalets/istrahas/resorts/farms/camps) are skipped; this scraper writes ONLY to
gathern_residential_listings (there is no commercial Gathern inventory).

2026-07-14 price-fidelity re-investigation (GTH212141 / id=725485, reported as "price doesn't match
anything on the page"): re-verified map_listing()'s price extraction below against the live
msapi search-units monthly-mode response for that unit and 6 more sampled rows — final_price/price
IS the correct discounted 30-night monthly figure in every case (e.g. GTH212141: stored monthly=5213
vs live monthly≈5199, a ~0.2% date-of-request drift, not a bug). There was NO parsing bug here. The
actual bug was in the click-through layer (src/lib/openListing.ts appended a `?check_in=&check_out=`
querystring that Gathern's page silently ignores, always rendering an unrelated single-night spot
price — that's what made a CORRECT stored price look unreconcilable) — fixed in
src/lib/gathernUrl.ts / src/lib/openListing.ts, not here. See scripts/ops/repair_gathern_prices_2026-07-14.sql
for the full evidence trail and the separate (larger, still-open) staleness issue this surfaced: a
sharded cron run only upserts a row if its unit resurfaces in that day's has_available candidate
pool (crawl() below), so a unit that falls out of the pool never gets its scraped_at/price refreshed
— 14,048 of 20,413 active rows carry their original 2026-06-23 backfill snapshot untouched. That's a
cron/prune-architecture question (already flagged in .github/workflows/gathern-sync.yml's own header
comment as a follow-up), not a fix to the price-extraction logic below.

──────────────────────────────────────────────────────────────────────────────────────────────
THE REAL MONTHLY PRICE (the whole point of this file) — Option A, list-API-with-monthly-params:
──────────────────────────────────────────────────────────────────────────────────────────────
The search list endpoint, when called in MONTHLY mode, already returns the REAL discounted 30-night
total per unit — we do NOT fetch each unit's booking page, and we do NOT do nightly×30.

Calling search-units with:
    &calendar_type=monthly&check_in=<tomorrow>&check_out=<tomorrow+30d>&has_available=true
prices every card for that 30-day window and returns, per item:
    nights              = 30
    long_stay           = true
    selected_check_in / selected_check_out = the 30-day window we asked for
    final_price / price = the DISCOUNTED 30-night total (e.g. 9,935.40)   ← the real monthly price
    price_before_discount / oldPrice       = the UNdiscounted nightly×30   (e.g. 11,420)
    day_price_format    = the nightly rate (380.67 → ×30 = 11,420 = oldPrice)
    discount_label      = "خصم 13%"  (long-stay discount the host grants for ≥28 nights)
So final_price 9,935.40 = oldPrice 11,420 × 0.87 — i.e. the genuine discounted monthly figure, not
nightly×30. We store monthly = final_price and price_annual = monthly × 12 (the app divides
price_annual by 12 to show the per-month figure). rent_period = "monthly".

──────────────────────────────────────────────────────────────────────────────────────────────
API (axios baseURL "https://msapi.gathern.co/{0}/api/v1" with {0}="search"):
  SEARCH GET https://msapi.gathern.co/search/api/v1/search-units?lang=ar&city={id}&page={n}
             &calendar_type=monthly&check_in=YYYY-MM-DD&check_out=YYYY-MM-DD&has_available=true
         → {items:[…], _meta:{totalCount,pageCount,currentPage,perPage:12}}
  CITIES GET https://api.gathern.co/v1/web/default/filter-config?lang=ar
         → global_data.cities[] (id, name, name_en, name_ar). ~193 entries; drop non-Saudi (Cairo …).
  VIEW   https://gathern.co/view/{chalet_id}/unit/{unit_id}   (the base URL we store; the app appends
         the monthly check-in/out at click-time).

CAVEATS observed (June 2026):
  • _meta.totalCount is the broad catalog count, NOT the count of distinct monthly-available units —
    big cities report ~1300-1450 but actually expose far fewer distinct monthly units before the
    pages run out. We page until the API returns empty pages, dedup by unit id, and trust THAT
    (not totalCount) as the true monthly-only count.
  • items genuinely are per-city (verified: Jeddah pages 1/5/10/40 all return only Jeddah units).
  • Gathern rate-limits hard (it throttled a prior IP), so we pace requests + retry flaky empty/
    non-JSON responses with backoff (pattern copied from scrapers/erapulse/run.py).

Field map (Gathern item → our schema):
  id / unit_id                       → ad_number GTH{id}
  chalet_id + id                     → listing_url /view/{chalet_id}/unit/{id}
  unit_type_id (6,9,11,7,8 = res)    → property_type (TYPE_MAP) ; non-res types skipped
  final_price | price                → DISCOUNTED 30-night total → price_annual = monthly×12
  event_data.city_en | address.city  → city (CITY_EN_MAP / map_city → canonical) ; region from city
  event_data.district_en|address.area→ neighborhood
  space                              → area_m2
  features ("N غرف نوم")             → bedrooms ; ("N سرير ماستر") → master_bedrooms
  boxGalleryAll | coverphoto         → photo_urls
  lat/lng, code, rating, amenities   → additional_info

PDPL: Gathern bookings go through Gathern, so list cards expose NO host name or phone — there is
nothing to redact. We still defensively strip any phone that appears in title/description.

Usage (house convention):
  python -m scrapers.gathern.run --type all                # full crawl + prune
  python -m scrapers.gathern.run --type all --limit 12     # validation: first N, NO prune, samples
  python -m scrapers.gathern.run --dry-run --cities 3,18   # map + print, no DB write (debug)
"""
from __future__ import annotations

import argparse
import datetime
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

from scrapers.common import db, normalize as N  # noqa: E402
from scrapers.common import arabic_location as AL  # noqa: E402

BASE_WEB = "https://gathern.co"
SEARCH = "https://msapi.gathern.co/search/api/v1/search-units"
FILTER_CONFIG = "https://api.gathern.co/v1/web/default/filter-config?lang=ar"
PAGE_SIZE = 12  # the API's fixed perPage
SOURCE = "Gathern"
# Gathern throttles aggressively — pace gently (override via env on a friendlier IP).
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.6"))
RETRIES = 5
STAY_NIGHTS = 30  # a "monthly" stay

# Gathern unit_type_id → canonical English type. The catalog splits into:
#   RESIDENTIAL dwellings (ingested):  6 شقة, 9 استديو, 11 شقق مخدومة, 7 فيلا, 8 غرفة
#   LEISURE / holiday    (SKIPPED):    1 منتجع, 2 شاليه, 3 استراحة, 4 مزرعة, 5 مخيم, …
# Studio + serviced-apartment fold into Apartment (Ezhalah's taxonomy has no Studio bucket); فيلا →
# Villa; غرفة → Room. Anything outside this set is leisure → not a residential monthly rental.
TYPE_MAP = {
    6: "Apartment",   # شقة
    9: "Apartment",   # استديو (studio → apartment bucket)
    11: "Apartment",  # شقق مخدومة (serviced apartments)
    7: "Villa",       # فيلا
    8: "Room",        # غرفة
}

# Gathern city label (English, from event_data.city_en / cities[].name_en) → canonical Ezhalah city.
# Gathern's labels differ from Aqar's slugs, so we map the ones map_city() can't already resolve.
CITY_EN_MAP = {
    "Riyadh": "Riyadh", "Jeddah": "Jeddah", "Makkah Al Mukarramah": "Mecca", "Makkah": "Mecca",
    "Al Madinah Al Munawwarah": "Medina", "Al Madinah": "Medina", "At Taif": "Taif", "Taif": "Taif",
    "Al Khobar": "Khobar", "Dammam": "Dammam", "Aldhahran": "Dhahran", "Ad Dhahran": "Dhahran",
    "Alhafuf and alahsa": "Hofuf", "Al Hufuf": "Hofuf", "Al Mubarraz": "Hofuf",
    "Abha": "Abha", "Khamis Mushayt": "Khamis Mushait", "Ahad Rifaydah": "Ahad Rafidah",
    "Tabuk": "Tabuk", "Hail": "Hail", "Buraydah": "Buraidah", "Unayzah": "Unaizah",
    "Al Bukayriyah": "Al Bukayriyah", "Al Baha": "Al Baha", "Sakaka": "Sakaka",
    "King Abdullah Economic City": "KAEC", "Bishah": "Bisha", "Al Kharj": "Al Kharj",
    "Umluj": "Umluj", "Yanbu": "Yanbu", "Al Wajh": "Al Wajh", "Ar Rayis": "Badr",
    "Al Qatif": "Qatif", "Al Jubail": "Jubail", "Haql": "Tabuk", "Ad Dilam": "Al Dalam",
    "Al Majma'ah": "Al Majmaah", "Al Quwayiyah": "Al Quwayiyah", "Ar'ar": "Arar",
    "Mahd Adh Dhahab": "Mahd adh Dhahab", "Thadiq": "Thadiq", "Al Hinakiyah": "Al Hanakiyah",
    "Duba": "Duba", "Najran": "Najran", "Shaqra": "Shaqra", "Rabigh": "Rabigh",
    "AlUla": "Al Ula", "Al Ula": "Al Ula",
}

# Non-Saudi cities Gathern lists (e.g. Cairo) are dropped — Saudi-only rule.
NON_SAUDI_EN = {"Cairo", "Alexandria", "Hurghada", "Sharm El Sheikh", "Dubai", "Abu Dhabi",
                "Doha", "Manama", "Kuwait", "Muscat", "Amman", "Beirut", "Istanbul"}
NON_SAUDI_AR = {"القاهرة", "الإسكندرية", "الاسكندرية", "الغردقة", "شرم الشيخ", "دبي", "أبوظبي",
                "الدوحة", "المنامة", "الكويت", "مسقط", "عمان", "بيروت", "اسطنبول", "إسطنبول"}

_BEDS_RE = re.compile(r"(\d+)\s*غرف")          # "1 غرف نوم"
_MASTER_RE = re.compile(r"(\d+)\s*سرير\s*ماستر")  # "1 سرير ماستر"

# PDPL: list cards carry no PII, but defensively strip any phone that surfaces in title/desc.
_PHONE_RE = re.compile(
    r"(?:\+?00?966\d{8,9}|\b966\d{8,9}\b|0?5\d(?:[\s\.\-]?\d){7}"
    r"|\b9200\d{4,6}\b|\b920\d{6}\b|\b800\d{7}\b|wa\.me/\S+)"
)

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
        "Accept": "application/json",
        "Accept-Language": "ar,en-US;q=0.7,en;q=0.6",
        "source": "web",
        "Origin": BASE_WEB,
        "Referer": f"{BASE_WEB}/",
    })
    return s


def _monthly_window() -> tuple[str, str]:
    """check_in = tomorrow, check_out = tomorrow + 30 days (a monthly stay)."""
    today = datetime.date.today()
    ci = today + datetime.timedelta(days=1)
    co = ci + datetime.timedelta(days=STAY_NIGHTS)
    return ci.isoformat(), co.isoformat()


def _num(v: Any) -> Optional[int]:
    """Parse '9,935.40' / '14915' / 9935.4 → rounded int. None if not numeric/zero."""
    if v in (None, "", 0, "0"):
        return None
    try:
        s = re.sub(r"[^\d.]", "", str(v))
        n = round(float(s)) if s else None
        return n if n else None
    except (TypeError, ValueError):
        return None


def _redact(text: Optional[str]) -> Optional[str]:
    """Strip any phone from a card title/description (PDPL belt-and-braces)."""
    if not text:
        return None
    t = _PHONE_RE.sub(" ", str(text))
    t = re.sub(r"\s{2,}", " ", t)
    return t.strip() or None


def fetch_cities(s: cc.Session) -> list[dict]:
    """The ~193-city catalog from filter-config (id, name, name_en, name_ar)."""
    _throttle()
    for attempt in range(RETRIES):
        try:
            r = s.get(FILTER_CONFIG, timeout=40)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code != 200:
            time.sleep(2 * (attempt + 1)); continue
        try:
            return (r.json().get("global_data") or {}).get("cities") or []
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
    return []


def fetch_page(s: cc.Session, city_id: int, page: int, ci: str, co: str) -> tuple[list[dict], dict]:
    """One MONTHLY-mode search page. Retries flaky empty/non-JSON bodies (Gathern rate-limits)."""
    _throttle()
    params = {
        "lang": "ar", "city": city_id, "page": page,
        "calendar_type": "monthly", "check_in": ci, "check_out": co, "has_available": "true",
    }
    for attempt in range(RETRIES):
        try:
            r = s.get(SEARCH, params=params, timeout=40)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(3 * (attempt + 1)); continue
        if r.status_code != 200:
            return [], {}  # a hard 4xx (not throttle) → no point retrying this page
        try:
            j = r.json()
        except Exception:
            time.sleep(2 * (attempt + 1)); continue   # empty/non-JSON body → retry
        return j.get("items") or [], (j.get("_meta") or {})
    return [], {}


def _beds(features: Optional[list]) -> tuple[Optional[int], Optional[int]]:
    beds = masters = None
    for f in features or []:
        if not isinstance(f, str):
            continue
        if beds is None:
            m = _BEDS_RE.search(f)
            if m:
                beds = int(m.group(1))
        if masters is None:
            m = _MASTER_RE.search(f)
            if m:
                masters = int(m.group(1))
    return (beds if beds and 0 < beds <= 20 else None,
            masters if masters and 0 < masters <= 20 else None)


def _photos(it: dict) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()

    def add(u: Any) -> None:
        if isinstance(u, str) and u.startswith("http") and u not in seen:
            seen.add(u); urls.append(u)

    for u in (it.get("boxGalleryAll") or it.get("boxGallery") or []):
        add(u)
    cover = it.get("coverphoto")
    if isinstance(cover, dict):
        thumb = cover.get("thumb")
        if isinstance(thumb, str) and thumb.startswith("http"):
            add(thumb)
        elif cover.get("base_url") and cover.get("path"):
            add(f"{cover['base_url']}/{cover['path']}")
    elif isinstance(cover, str):
        add(cover)
    return urls[:25]


def _is_monthly_available(it: dict) -> bool:
    """True only if the API priced this unit for our 30-night window (the long-stay signal).

    In monthly mode the card carries nights=30 + long_stay + selected_check_in/out. We require the
    long-stay signal so we never store a unit the host doesn't actually offer monthly."""
    nights = _num(it.get("nights"))
    if nights == STAY_NIGHTS:
        return True
    if it.get("long_stay") is True:
        return True
    # Fallback: trust the 30-day window the API echoed back.
    return bool(it.get("selected_check_in") and it.get("selected_check_out"))


def map_listing(it: dict) -> Optional[dict]:
    """Gathern monthly-mode item → gathern_residential row, or None if not an eligible monthly unit."""
    type_id = it.get("unit_type_id")
    property_type = TYPE_MAP.get(type_id)
    if not property_type:
        return None  # leisure type (resort/chalet/istraha/farm/camp) → not residential

    if not _is_monthly_available(it):
        return None  # the host doesn't offer this unit for a 30-day stay

    uid = it.get("id") or it.get("unit_id")
    if not uid:
        return None

    # THE REAL DISCOUNTED MONTHLY PRICE — final_price/price is the 30-night total for our window
    # (already discounted by the host's long-stay rate). NOT nightly×30. Skip the undiscounted
    # oldPrice/price_before_discount intentionally.
    monthly = _num(it.get("final_price")) or _num(it.get("price")) or _num(it.get("avg_price"))
    if not monthly:
        return None
    if monthly < 300:  # implausibly low for a furnished 30-night stay → skip
        return None
    price_annual = monthly * 12  # app shows price_annual / 12 = the monthly figure

    # ── location (Saudi-only) ──
    addr = it.get("address") or {}
    ev = it.get("event_data") or {}
    city_en = (ev.get("city_en") or "").strip()
    city_ar = (addr.get("city") or ev.get("city_ar") or "").strip()
    if city_en in NON_SAUDI_EN or city_ar in NON_SAUDI_AR:
        return None
    # Forward-fix (2026-07-10 location-data-quality audit): an honest None beats the literal "Other"
    # sentinel this used to fall back to — it survived all the way to the frontend and rendered as
    # the bare English word "Other" on Arabic-UI cards. N.region_for_city(None) already returns None
    # safely. The raw Arabic signal below (city_ar/district_ar in `info`) is unchanged.
    city = (CITY_EN_MAP.get(city_en)
            or N.map_city(city_ar)
            or N.map_city(city_en))
    region = N.region_for_city(city)
    neighborhood = (ev.get("district_en") or addr.get("area") or ev.get("district_ar") or "").strip() or None

    # Centralized resolution (2026-07-10 architecture redesign — see docs/LOCATION_RESOLUTION.md):
    # ADDITIVE, not a replacement for `city`/`region` above (those columns are English-label TEXT,
    # a different shape than this resolver's Arabic-canonical city_id/region_id output — a full
    # column cutover is a separate, larger migration decision). Every future consumer (a backfill,
    # or a next-phase SQL overlay) can read these straight off additional_info instead of re-deriving
    # them; `region` (already computed above, possibly via the narrower legacy dict) is passed as a
    # disambiguation hint — an already-derived, trusted signal, not a guess.
    resolved = AL.resolve(city_ar, district_ar=neighborhood, region_hint=region)

    beds, masters = _beds(it.get("features"))

    chalet_id = it.get("chalet_id")
    # Base unit URL — the app appends the monthly dates at click-time.
    listing_url = (f"{BASE_WEB}/view/{chalet_id}/unit/{uid}" if chalet_id
                   else f"{BASE_WEB}/view/unit/{uid}")

    raw_title = (it.get("unit_custom_title") or ev.get("unit_name_ar")
                 or it.get("chalet_title") or it.get("title") or "").strip()
    title = _redact(raw_title)
    # Tag the title as furnished/monthly so search snippets read correctly.
    type_ar = ev.get("unit_type_ar") or it.get("chalet_category_text") or ""
    if title:
        title = f"{title} — {type_ar} مفروشة للإيجار الشهري".strip(" —") if type_ar else title

    amenities = it.get("amenities") or []
    info: dict[str, Any] = {
        "furnished": True,
        "rental_basis": "monthly",
        "city_ar": city_ar or None,
        "district_ar": (ev.get("district_ar") or addr.get("area") or "").strip() or None,
        "unit_code": it.get("code"),
        "unit_type_ar": type_ar or None,
        "chalet_id": chalet_id,
        "monthly_price": monthly,
        "monthly_price_before_discount": _num(it.get("price_before_discount")) or _num(it.get("oldPrice")),
        "nightly_price": _num(it.get("day_price_format")),
        "discount_label": it.get("discount_label") or None,
        "stay_nights": _num(it.get("nights")) or STAY_NIGHTS,
        "rating": it.get("total_present"),
        "reviews_count": _num(it.get("total_reviews")),
        "capacity": (it.get("quickOptions") or {}).get("persons_count") or None,
        "latitude": it.get("lat"),
        "longitude": it.get("lng"),
        "amenities": [a.get("title") for a in amenities if isinstance(a, dict) and a.get("title")][:30],
        "resolved_city_ar": resolved["city_ar"],
        "resolved_city_id": resolved["city_id"],
        "resolved_region_id": resolved["region_id"],
        "resolved_district_ar": resolved["district_ar"],
        "resolved_confidence": resolved["confidence"] if resolved["confidence"] != "unresolved" else None,
    }
    info = {k: v for k, v in info.items() if v not in (None, "", [], 0)}

    return {
        "ad_number": f"GTH{uid}",
        "listing_url": listing_url,
        "source": SOURCE,
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent",
        "area_m2": _num(it.get("space")),
        "bedrooms": beds,
        "master_bedrooms": masters,
        "price_annual": price_annual,
        "price_total": None,
        "rent_period": "monthly",
        "city": city,
        "region": region,
        "neighborhood": neighborhood,
        "title": title,
        "description": None,
        "photo_urls": _photos(it),
        "rega_location_verified": False,
        "additional_info": info,
    }


def _saudi_cities(all_cities: list[dict]) -> list[dict]:
    """Drop the non-Saudi entries (Cairo etc.) up front so we never even query them."""
    out = []
    for c in all_cities:
        ne = (c.get("name_en") or "").strip()
        na = (c.get("name") or c.get("name_ar") or "").strip()
        if ne in NON_SAUDI_EN or na in NON_SAUDI_AR:
            continue
        if c.get("id") is None:
            continue
        out.append(c)
    return out


def crawl(s: cc.Session, cities: list[dict], ci: str, co: str,
          *, limit: int = 0, max_pages: int = 0, verbose: bool = True) -> tuple[dict[str, dict], int, dict[str, int]]:
    """Page each city in MONTHLY mode. Returns (rows_by_ad, cards_scanned, per_city_counts).

    Pagination stops on the FIRST empty page (the API runs out of distinct monthly units well before
    its inflated _meta.totalCount). De-dup is by ad_number across cities — a unit can surface twice."""
    rows_by_ad: dict[str, dict] = {}
    per_city: dict[str, int] = {}
    scanned = 0
    for c in cities:
        cid = c.get("id")
        name = c.get("name_en") or c.get("name") or str(cid)
        items, meta = fetch_page(s, cid, 1, ci, co)
        if not items:
            if verbose:
                print(f"  city={cid:<6} {name:<28} monthlyTotalMeta={meta.get('totalCount', 0):<5} kept=0 (no monthly units)")
            continue
        total_meta = meta.get("totalCount") or 0
        # _meta.pageCount under-reports the real tail (Jeddah: pageCount=121 but units run to ~p129),
        # so we page until empty pages — not to pageCount. Guard with a generous hard cap so a
        # mis-behaving city can't loop forever.
        hard_cap = max_pages or 400
        city_kept = 0
        page = 1
        empties = 0
        while True:
            for it in items:
                scanned += 1
                row = map_listing(it)
                if not row:
                    continue
                if row["ad_number"] not in rows_by_ad:
                    rows_by_ad[row["ad_number"]] = row
                    city_kept += 1
                if limit and len(rows_by_ad) >= limit:
                    break
            if limit and len(rows_by_ad) >= limit:
                break
            if page >= hard_cap:
                break
            page += 1
            items, _ = fetch_page(s, cid, page, ci, co)
            if not items:
                empties += 1
                if empties >= 2:
                    break  # two empty pages in a row → real end of this city's monthly catalog
                continue
            empties = 0
        per_city[name] = per_city.get(name, 0) + city_kept
        if verbose:
            print(f"  city={cid:<6} {name:<28} monthlyTotalMeta={total_meta:<5} pagesRead={page:<4} kept={city_kept}")
        if limit and len(rows_by_ad) >= limit:
            if verbose:
                print(f"  [--limit {limit}] reached after {name}")
            break
    return rows_by_ad, scanned, per_city


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all",
                    help="Gathern is residential-only; 'commercial' yields 0 rows.")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: upsert only the first N parsed listings, NO prune, print samples")
    ap.add_argument("--cities", default="", help="comma-separated city ids (default: all Saudi cities)")
    ap.add_argument("--shard", default="",
                    help="i/N — run only the i-th of N deterministic city shards (parallel matrix); skips prune")
    ap.add_argument("--max-pages", type=int, default=0, help="cap pages per city (0 = until empty)")
    ap.add_argument("--dry-run", action="store_true", help="map + print, no DB write")
    args = ap.parse_args()

    ci, co = _monthly_window()
    s = session()

    all_cities = fetch_cities(s)
    if not all_cities:
        print("✗ Gathern: filter-config returned no cities (throttled/blocked?)")
        return 1
    cities = _saudi_cities(all_cities)
    cities.sort(key=lambda c: c.get("id") or 0)  # deterministic order so parallel shards partition cleanly
    if args.cities:
        wanted = {int(x) for x in args.cities.split(",") if x.strip()}
        cities = [c for c in cities if c.get("id") in wanted]
    if args.shard:
        si, sn = (int(x) for x in args.shard.split("/"))
        cities = cities[si::sn]  # stride partition spreads big + small cities evenly across shards

    # Gathern has no commercial inventory; a commercial-only run is a clean no-op.
    if args.type == "commercial":
        print("Gathern is residential-only — nothing to scrape for --type commercial.")
        if not args.limit and not args.dry_run:
            run_id = db.begin_run("gathern")
            # allow_empty: Gathern genuinely has no commercial inventory, so a 0-row commercial
            # run is correct, not a failure. This is the ONE legitimate empty run in the fleet;
            # every other 0-row run is demoted to ok=False by end_run's RC-B chokepoint.
            db.end_run(run_id, ok=True, rows_seen=0, rows_upserted=0, notes="commercial=noop", allow_empty=True)
        return 0

    print(f"Gathern MONTHLY: {len(cities)} Saudi cities, stay {ci} → {co}"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}"
          f"{' [max ' + str(args.max_pages) + ' pages/city]' if args.max_pages else ''}")

    rows_by_ad, scanned, per_city = crawl(
        s, cities, ci, co,
        limit=args.limit, max_pages=args.max_pages, verbose=True,
    )
    rows = list(rows_by_ad.values())

    # ── dry-run: print, no DB ──
    if args.dry_run:
        print(f"\nDRY RUN — scanned {scanned} cards → {len(rows)} unique monthly residential units")
        for r in rows[:10]:
            print("  ", {k: r.get(k) for k in (
                "ad_number", "property_type", "city", "region", "neighborhood",
                "area_m2", "bedrooms", "price_annual", "rent_period")},
                "| monthly=", r["additional_info"].get("monthly_price"),
                "before=", r["additional_info"].get("monthly_price_before_discount"))
            print("     url:", r["listing_url"], "| photo:", (r["photo_urls"] or ["(none)"])[0][:60])
        return 0

    run_id = None if args.limit else db.begin_run("gathern")
    try:
        if rows:
            for i in range(0, len(rows), 200):
                db.upsert_gathern_residential_batch(rows[i:i + 200])

        # ── validation run (--limit): upsert first N, NO prune, print samples ──
        if args.limit:
            print(f"\n✓ Gathern VALIDATION: {len(rows)} monthly residential units upserted "
                  f"(scanned {scanned} cards, NO prune)")
            for r in rows[:8]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "city", "region", "neighborhood",
                    "area_m2", "bedrooms", "price_annual", "rent_period")})
                ai = r["additional_info"]
                print(f"     monthly={ai.get('monthly_price')} (before={ai.get('monthly_price_before_discount')},"
                      f" {ai.get('discount_label') or 'no discount'}) → price_annual={r['price_annual']}")
                print("     url:", r["listing_url"])
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:78], f"({len(r['photo_urls'])} imgs)")
            return 0

        # ── prune anything active-but-unseen — ONLY on a full all-cities pass ──
        # A --cities shard sees just its slice; pruning by source='Gathern' would deactivate every
        # OTHER city's listings (the collapse guard would usually catch it, but we don't rely on that).
        # The cron's full pass runs with no --cities, so that's the one that prunes. (Workflow contract.)
        if args.cities or args.shard:
            pruned = 0
            slice_label = args.cities and f"cities={args.cities}" or f"shard={args.shard}"
            print(f"✓ Gathern slice ({slice_label}): {len(rows)} monthly residential units upserted "
                  f"(scanned {scanned} cards) — NO prune (partial run)")
        else:
            pruned = db.prune_unseen("gathern_residential_listings",
                                     {r["ad_number"] for r in rows}, source=SOURCE)
            if pruned < 0:
                print("⚠ gathern prune guard tripped (0 scraped or collapse) — kept existing active")
                pruned = 0
            print(f"✓ Gathern: {len(rows)} monthly residential units upserted "
                  f"(scanned {scanned} cards across {len(cities)} cities), {pruned} stale pruned")
        top = sorted(per_city.items(), key=lambda kv: -kv[1])[:10]
        print("  top cities:", ", ".join(f"{n}={c}" for n, c in top))
        db.end_run(run_id, ok=True, rows_seen=scanned, rows_upserted=len(rows),
                   notes=f"cities={len(cities)} pruned={pruned}")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=scanned, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
