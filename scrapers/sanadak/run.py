"""Sanadak (sanadak.sa / منصة سندك العقارية) scraper — Saudi Next.js/RSC site, REGA-integrated.

سندك is a Saudi-owned, REGA-integrated property platform (FAL license per listing, links to
rega.gov.sa, .sa, Arabic-first). Saudi-only rule: PASS. ~1,164 active listings (931 res + 233 com).
No auth, no proxy, no geo-block (CloudFront).

Data path: NO public JSON API. Enumerate ALL active listings from /sitemap.xml (1,164
/property-details/{slug}-{advertisementNumber} URLs — sitemap carries only published listings), then
fetch each with the `RSC: 1` header → a text/x-component flight payload that embeds the full listing
JSON. Parse the listing object by balanced braces (anchored on "advertisementNumber"); the `media`
field is a lazy RSC ref, so image URLs are pulled from the CloudFront URLs in the body.

Field map (Sanadak → our schema):
  price                              → price_total | price_annual
  lotSize                            → area_m2 (reliable; built area often 0)
  numberBedrooms / numberBathrooms   → bedrooms / bathrooms
  propertyType (EN) + propertyTypeText (AR) → property_type (TYPE_MAP) + res/com routing
  listingType  Sale|Rent             → transaction_type Buy|Rent
  city (AR) + district               → city (map_city) + neighborhood ; region derived from city
  sellerLicenseNumber (FAL) + advertisementNumber (REGA) → rega + ad_number; additional_info
  media / cloudfront URLs            → photo_urls
  isPublished / listingStatusText منشور → keep only published
  NEVER store sellerName/sellerPhonenumber/sellerWhatsAppNumber (PDPL — personal data).

Usage:  python -m scrapers.sanadak.run [--limit-test] [--type residential|commercial|all]
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

from scrapers.common import db, normalize
from scrapers.common.arabic_location import to_catalog

# PDPL: seller identity + contact — never stored. (sellerLicenseNumber is a REGA licence, kept.)
_PII_SANADAK = {"sellerId", "sellerName", "sellerUsername", "sellerPhonenumber",
                "sellerWhatsAppNumber", "sellerProfileUrl"}

BASE = "https://sanadak.sa"
SITEMAP = f"{BASE}/sitemap.xml"
CDN = "dp57m2l5m3m9o.cloudfront.net"
# Each /property-details RSC fetch triggers a server-side re-render (~2s) and Sanadak's origin can't
# take much concurrency — 10 workers degrade it to ~16s each then timeouts. 4 is the gentle sweet spot.
WORKERS = int(os.environ.get("SANADAK_WORKERS", "4"))

TYPE_MAP = {
    "Apartment": "Apartment", "Villa": "Villa", "Floor": "Floor", "Building": "Building",
    "Duplex": "Villa", "Palace": "Villa", "Room": "Room", "RestHouse": "Rest House",
    "Chalet": "Chalet", "Farm": "Farm", "Land": "Residential Land", "House": "House",
    "Townhouse": "Villa", "Studio": "Apartment", "Penthouse": "Apartment",
    # commercial
    "Office": "Office", "Shop": "Shop", "Showroom": "Showroom", "Warehouse": "Warehouse",
    "CommercialLand": "Commercial Land", "CommercialBuilding": "Commercial Building",
    "Workshop": "Workshop", "Hotel": "Hotel", "Station": "Gas Station", "Factory": "Factory",
}
TYPE_MAP_AR = {
    "شقة": "Apartment", "فيلا": "Villa", "دور": "Floor", "عمارة": "Building", "قصر": "Villa",
    "غرفة": "Room", "استراحة": "Rest House", "إستراحة": "Rest House", "شاليه": "Chalet",
    "مزرعة": "Farm", "أرض": "Residential Land", "ارض": "Residential Land", "بيت": "House",
    "دوبلكس": "Villa", "روف": "Floor",
    "مكتب": "Office", "محل": "Shop", "معرض": "Showroom", "مستودع": "Warehouse",
    "ورشة": "Workshop", "فندق": "Hotel", "مصنع": "Factory", "أرض تجارية": "Commercial Land",
}
COMMERCIAL_TYPES = {"Office", "Shop", "Showroom", "Warehouse", "Commercial Land",
                    "Commercial Building", "Workshop", "Hotel", "Gas Station", "Factory"}

# city (Arabic) → canonical English + region.
CITY_AR = {
    "الرياض": "Riyadh", "جدة": "Jeddah", "مكة": "Mecca", "مكة المكرمة": "Mecca", "المدينة": "Medina",
    "المدينة المنورة": "Medina", "الدمام": "Dammam", "الخبر": "Khobar", "الظهران": "Dhahran",
    "الأحساء": "Hofuf", "الهفوف": "Hofuf", "الطائف": "Taif", "بريدة": "Buraidah", "عنيزة": "Unaizah",
    "أبها": "Abha", "خميس مشيط": "Khamis Mushait", "تبوك": "Tabuk", "حائل": "Hail", "جازان": "Jazan",
    "نجران": "Najran", "الباحة": "Al Baha", "عرعر": "Arar", "سكاكا": "Sakaka", "ينبع": "Yanbu",
    "الجبيل": "Jubail", "القطيف": "Qatif", "الخرج": "Al Kharj", "الدرعية": "Diriyah",
}
CITY_TO_REGION = {
    "Riyadh": "Riyadh", "Al Kharj": "Riyadh", "Diriyah": "Riyadh",
    "Jeddah": "Makkah", "Mecca": "Makkah", "Taif": "Makkah",
    "Medina": "Madinah", "Yanbu": "Madinah",
    "Dammam": "Eastern Province", "Khobar": "Eastern Province", "Dhahran": "Eastern Province",
    "Hofuf": "Eastern Province", "Jubail": "Eastern Province", "Qatif": "Eastern Province",
    "Buraidah": "Qassim", "Unaizah": "Qassim", "Abha": "Asir", "Khamis Mushait": "Asir",
    "Tabuk": "Tabuk", "Hail": "Hail", "Jazan": "Jazan", "Najran": "Najran",
    "Al Baha": "Al Bahah", "Arar": "Northern Borders", "Sakaka": "Al Jawf",
}

_local = threading.local()


def _session() -> cc.Session:
    s = getattr(_local, "s", None)
    if s is None:
        s = cc.Session(impersonate="chrome124")
        _local.s = s
    return s


def session() -> cc.Session:
    return cc.Session(impersonate="chrome124")


def fetch_one(url: str) -> Optional[tuple[dict, str, str]]:
    """Fetch + parse one listing. Returns (obj, body, url) or None. Thread-safe (thread-local session)."""
    s = _session()
    for attempt in range(3):
        try:
            body = s.get(url, timeout=45, headers={"RSC": "1"}).text
        except Exception:
            time.sleep(2.0 * (attempt + 1)); continue
        o = _extract_obj_for_url(body, url)
        if o:
            return o, body, url
        return None
    return None


def _int(v: Any) -> Optional[int]:
    try:
        return int(float(v)) if v not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        return None


def sitemap_urls(s: cc.Session) -> list[str]:
    r = s.get(SITEMAP, timeout=30)
    return re.findall(r"<loc>([^<]*property-details[^<]*)</loc>", r.text)


def _url_ad_number(url: str) -> Optional[str]:
    """Sanadak's own URL convention: every /property-details/{slug}-{advertisementNumber} URL ends
    with the page's real advertisementNumber as a trailing digit run (confirmed across every sample
    fetched during the 2026-07-14 price-fidelity audit). Used to pick the RIGHT embedded object out
    of the RSC flight stream (see _extract_obj_for_url) instead of trusting byte-offset ordering."""
    m = re.search(r"(\d+)/?$", url)
    return m.group(1) if m else None


def _object_at(body: str, i: int) -> Optional[dict]:
    """Brace-balance outward from byte offset `i` (which must point at/inside a JSON object) to
    recover that one enclosing object. Pure span extraction — no notion of "the anchor" here."""
    depth = 0
    start = None
    for j in range(i, -1, -1):
        c = body[j]
        if c == "}":
            depth += 1
        elif c == "{":
            if depth == 0:
                start = j
                break
            depth -= 1
    if start is None:
        return None
    depth = 0
    for k in range(start, len(body)):
        c = body[k]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(body[start:k + 1])
                except Exception:
                    return None
    return None


def _extract_obj(body: str, anchor: str = '"advertisementNumber"') -> Optional[dict]:
    """Legacy single-shot extractor: first byte-offset occurrence of `anchor` anywhere in the whole
    flight text. Kept only for callers/tests that want "the first advertisementNumber object" with
    no URL to disambiguate against. DO NOT use this for the live per-request page scrape — every
    Sanadak /property-details RSC response also embeds ~5 "similar listings" carousel cards that
    each carry their own "advertisementNumber" key, and their arrival order in the flight text is a
    per-request race (not a fixed layout), so "first match" can silently return a sibling
    recommendation's object instead of the page's own listing. Use _extract_obj_for_url instead."""
    i = body.find(anchor)
    if i < 0:
        return None
    return _object_at(body, i)


def _iter_candidate_objs(body: str, anchor: str = '"advertisementNumber"'):
    """Yield every object in the flight stream that carries an `advertisementNumber` key — the
    primary listing PLUS every "similar listings" carousel card. Each occurrence's span is skipped
    past after extraction so overlapping candidates aren't re-walked."""
    i = 0
    n = len(body)
    while True:
        i = body.find(anchor, i)
        if i < 0:
            return
        obj = _object_at(body, i)
        if isinstance(obj, dict):
            yield obj
            # advance past this object's own advertisementNumber occurrence(s) — a naive `i += 1`
            # would just re-find the same key from inside the object we already extracted. Since we
            # don't have the object's end offset handy here, just move past the anchor itself; the
            # containing-object re-derivation is idempotent (same object re-yielded) but harmless —
            # duplicates are fine because we only ever pick the FIRST candidate whose own
            # advertisementNumber matches the URL, and re-yielding the same object twice can't change
            # that "first-match" answer since it always agrees with itself on which id it holds.
        i += len(anchor)


def _extract_obj_for_url(body: str, url: str) -> Optional[dict]:
    """THE fix for the 2026-07-14 price-fidelity bug: derive the page's own ad number from its URL
    (Sanadak's convention: URL always ends in the real advertisementNumber), then scan every
    candidate object in the flight stream (primary listing + every similar-listings carousel card)
    and return the one candidate whose own advertisementNumber equals the URL's. If no candidate
    matches — parse failure, site anomaly, URL convention broken — return None so the caller skips
    the row (fail loud) rather than silently keeping whichever object happened to stream first."""
    target = _url_ad_number(url)
    if target is None:
        return None
    for obj in _iter_candidate_objs(body):
        cand = obj.get("advertisementNumber")
        if cand is not None and str(cand) == target:
            return obj
    return None


# The two ad-responsible-person fields are PERSONAL DATA (PDPL) — never store them.
PDPL_INFO_NAMES = {"مسؤول الاعلان", "رقم مسؤول الاعلان", "اسم المعلن", "جوال المعلن"}
# Amenity boolean fields → Arabic label (only stored when True/available).
AMENITY_BOOLS = {
    "isFurnished": "مفروشة", "isDriverRoomAvailable": "غرفة سائق", "isGardenAvailable": "حديقة",
    "isGymAvailable": "صالة رياضية", "isSwimmingPoolAvailable": "بركة سباحة",
    "isElevatorAvailable": "مصعد", "isMaidRoomAvailable": "غرفة خادمة",
    "isStorageRoomAvailable": "غرفة خزين", "isPrivateParkingAvailable": "موقف خاص",
}
_EMPTY_VALS = {None, "", "false", False, "لا", "لا ", "غير متوفر", "0", 0}


def _resolve_additional_infos(body: str, o: dict) -> list[dict[str, Any]]:
    """Resolve Sanadak's `additionalInfos` lazy RSC ref → its full list of {name, value} rows.
    The flight stream embeds it as `$<id>` → row `<id>:["$..","$.."]` → each ref a {name,value}
    object. Skip empty/'no' values, the boundaries array, and the PDPL person fields."""
    ref = o.get("additionalInfos")
    if not isinstance(ref, str) or not ref.startswith("$"):
        return []
    dec = json.JSONDecoder()

    def _row(rid: str):
        m = re.search(rf'(?:^|\n){re.escape(rid)}:(.+)', body)
        if not m:
            return None
        try:
            return dec.raw_decode(m.group(1))[0]
        except Exception:
            return None

    lst = _row(ref[1:])
    out: list[dict[str, Any]] = []
    if isinstance(lst, list):
        for item in lst:
            if not (isinstance(item, str) and item.startswith("$")):
                continue
            obj = _row(item[1:])
            if not isinstance(obj, dict):
                continue
            name = (obj.get("name") or "").strip()
            val = obj.get("value")
            if not name or name in PDPL_INFO_NAMES or isinstance(val, list) or val in _EMPTY_VALS:
                continue
            sval = str(val).strip()
            if not sval or sval.startswith(("[", "{")):  # skip the empty boundaries array
                continue
            out.append({"key": name, "label": name, "value": sval})
    return out


def _images(body: str) -> list[str]:
    urls = re.findall(rf"https://{re.escape(CDN)}/[^\s\"\\]+\.(?:jpe?g|png|webp)", body)
    seen, out = set(), []
    for u in urls:
        base = re.sub(r"-\d+x\d+(?=\.)", "", u)  # collapse size variants
        if base not in seen:
            seen.add(base)
            out.append(u)
        if len(out) >= 8:
            break
    return out


def _all_images(body: str) -> list[str]:
    """ALL listing photo URLs (uncapped, deduped by base) for the complete-source capture. The live
    photo_urls stays capped at 8; this keeps the full gallery in source_capture (no binary re-host)."""
    seen, out = set(), []
    for u in re.findall(rf"https://{re.escape(CDN)}/[^\s\"\\]+\.(?:jpe?g|png|webp)", body):
        base = re.sub(r"-\d+x\d+(?=\.)", "", u)
        if base not in seen:
            seen.add(base)
            out.append(u)
    return out


def map_listing(o: dict, body: str, url: str) -> tuple[Optional[dict], str]:
    if not o.get("isPublished", True):
        return None, "residential"
    ad = o.get("advertisementNumber") or o.get("adNumber") or o.get("id")
    type_en = (o.get("propertyType") or "").strip()
    type_ar = (o.get("propertyTypeText") or "").strip()
    mapped_type = TYPE_MAP.get(type_en) or TYPE_MAP_AR.get(type_ar)
    # Unmapped type → STORE the raw source type text (Arabic first), never a guessed default (owner
    # directive 2026-07-16: never confidently misclassify — the raw value trips the DB novel-type
    # detector, which quarantines + alerts). The legacy value below feeds ONLY the routing/sanity rules.
    property_type = mapped_type or "Residential Land"  # type-truth: routing-legacy only — never stored
    stored_property_type = mapped_type or type_ar or type_en or "unknown"
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"
    is_rent = (o.get("listingType") or "").strip().lower() == "rent" or "إيجار" in (o.get("listingTypeText") or "")

    raw_city = (o.get("city") or "").strip()
    # Forward-fix (2026-07-10 location-data-quality audit): an honest None beats the literal "Other"
    # sentinel on this legacy column — the additive city_ar/city_id columns below already resolve
    # most rows independently; this just closes the remaining leak on the raw-column read path.
    city = CITY_AR.get(raw_city) or normalize.map_city(raw_city)
    region = CITY_TO_REGION.get(city)

    # Native STRUCTURED Arabic (ADDITIVE — live city/region/neighborhood above untouched). Sanadak's
    # RSC object carries Arabic city + district directly; the scraper's region is the twin-disambiguation
    # hint. source_capture = the full listing object MINUS PDPL seller fields + ALL photo URLs (the live
    # photo_urls stays capped at 8). The Arabic description is already inside the object. Numbers unchanged.
    city_ar = raw_city or None
    district_ar = (o.get("district") or "").strip() or None
    cid, rid = to_catalog(city_ar, region_hint=region)
    cap = {k: v for k, v in o.items() if k not in _PII_SANADAK}
    cap["_photo_urls_all"] = _all_images(body)

    price = _int(o.get("price"))

    # Rich data: core extras + the FULL additionalInfos REGA panel (license/plan/services/deed…,
    # minus PDPL) + available amenities. Capture everything valuable now; standardize/filter later.
    extra: list[dict[str, Any]] = []
    for key, label in (("streetWidth", "Street width"), ("propertyFacingDirection", "Facade"),
                       ("sellerLicenseNumber", "Ad license number")):
        v = o.get(key)
        if v not in (None, "", 0, "0"):
            extra.append({"key": key, "label": label, "value": str(v)})
    extra.extend(_resolve_additional_infos(body, o))
    for bkey, blabel in AMENITY_BOOLS.items():
        if o.get(bkey) is True:
            extra.append({"key": bkey, "label": blabel, "value": "متوفر"})
    # de-dup by label (additionalInfos can overlap the core extras)
    seen_labels: set[str] = set()
    extra = [r for r in extra if not (r["label"] in seen_labels or seen_labels.add(r["label"]))]

    row = {
        "ad_number": f"SN{ad}",
        "listing_url": url,
        "source": "Sanadak",
        "active": True,
        "property_type": stored_property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": _int(o.get("lotSize")),
        "bedrooms": _int(o.get("numberBedrooms")),
        "bathrooms": _int(o.get("numberBathrooms")),
        "price_total": price if not is_rent else None,
        "price_annual": price if is_rent else None,
        "rent_period": "annual" if is_rent else None,
        "city": city,
        "region": region,
        "neighborhood": o.get("district") or None,
        "title": o.get("title") or None,
        "photo_urls": _images(body),
        "rega_location_verified": bool(o.get("sellerLicenseNumber")),
        "additional_info": extra,
        # ── Arabic-native structured (additive, shadow) + complete-source capture ──
        "city_ar": city_ar,
        "district_ar": district_ar,
        "city_id": cid,
        "region_id": rid,
        "source_capture": cap,
    }
    return row, category


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit-test", type=int, default=0, help="dry-run: process N listings, no DB write")
    args = ap.parse_args()

    s = session()
    urls = sitemap_urls(s)
    if args.limit_test:
        urls = urls[:max(args.limit_test * 2, 12)]
    print(f"Sanadak: {len(urls)} listings from sitemap ({WORKERS} workers)")
    run_id = None if args.limit_test else db.begin_run("sanadak")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        # Concurrent RSC fetches (workers), map+collect on the main thread, and FLUSH incrementally
        # so cards appear progressively (the site is slow to serve, so a 1-shot end-upsert hides
        # everything until 100% done). all_res/all_com track what was seen this run for the prune.
        done = 0
        res_buf: list[dict] = []
        com_buf: list[dict] = []
        all_res_ads: set[str] = set()
        all_com_ads: set[str] = set()

        def flush() -> None:
            nonlocal res_buf, com_buf
            if res_buf and not args.limit_test:
                db.upsert_sanadak_residential_batch(res_buf)
                all_res_ads.update(r["ad_number"] for r in res_buf)
                res_buf = []
            if com_buf and not args.limit_test:
                db.upsert_sanadak_commercial_batch(com_buf)
                all_com_ads.update(r["ad_number"] for r in com_buf)
                com_buf = []

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for result in ex.map(fetch_one, urls):
                done += 1
                if not result:
                    continue
                o, body, u = result
                row, cat = map_listing(o, body, u)
                if not row:
                    continue
                if args.type != "all" and cat != args.type:
                    continue
                (com_buf if cat == "commercial" else res_buf).append(row)
                (com if cat == "commercial" else res).append(row)
                seen += 1
                if args.limit_test and seen >= args.limit_test:
                    break
                if len(res_buf) + len(com_buf) >= 100:
                    flush()
                    print(f"  …{seen}/{len(urls)} upserted", flush=True)
        flush()

        if args.limit_test:
            print(f"DRY RUN — {len(res)} residential + {len(com)} commercial")
            for r in (res + com)[:6]:
                print("  ", {k: r[k] for k in ("ad_number", "property_type", "transaction_type", "city", "region", "neighborhood", "area_m2", "bedrooms", "price_total", "price_annual")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:70])
            return 0

        # (rows already upserted incrementally via flush())
        pruned = 0
        for tbl, rows_seen in (("sanadak_residential_listings", res), ("sanadak_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Sanadak")
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Sanadak: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"pruned={pruned}", check_tables=["sanadak_residential_listings", "sanadak_commercial_listings"])
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
