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
from collections import Counter
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
    # Duplex + Studio are their OWN clean types since the 2-macro filter split — no longer folded
    # into Villa/Apartment. Townhouse/Palace/House stay Villa-folds per the locked canon rule.
    # (canon unification, audit item 7d, 2026-07-27.)
    "Duplex": "Duplex", "Palace": "Villa", "Room": "Room", "RestHouse": "Rest House",
    "Chalet": "Chalet", "Farm": "Farm", "Land": "Residential Land", "House": "House",
    "Townhouse": "Villa", "Studio": "Studio", "Penthouse": "Apartment",
    # commercial
    "Office": "Office", "Shop": "Shop", "Showroom": "Showroom", "Warehouse": "Warehouse",
    "CommercialLand": "Commercial Land", "CommercialBuilding": "Commercial Building",
    "Workshop": "Workshop", "Hotel": "Hotel", "Station": "Gas Station", "Factory": "Factory",
}
TYPE_MAP_AR = {
    "شقة": "Apartment", "فيلا": "Villa", "دور": "Floor", "عمارة": "Building", "قصر": "Villa",
    "غرفة": "Room", "استراحة": "Rest House", "إستراحة": "Rest House", "شاليه": "Chalet",
    "مزرعة": "Farm", "أرض": "Residential Land", "ارض": "Residential Land", "بيت": "House",
    "دوبلكس": "Duplex", "روف": "Floor",
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


# Detail-fetch failure tally. Same reasoning as the sitemap reason capture (PR #1420) and the
# dealapp breakdown: a 0-row run must say WHY, and "why" has to be recorded where it happens.
# 2026-08-31: sanadak's sitemap recovered (200, 1,093 URLs) while EVERY listing page stayed down —
# property-details answered HTTP 500 under RSC:1 and 504 plain, ~30s each, 3/3 on random listings.
# fetch_one() read `.text` without ever looking at `.status_code`, so a 500 with an empty body was
# indistinguishable from "page loaded, no listing object in it", and the run ended on the generic
# RC-B note "0-row run (blocked/empty source?)" — the same question mark #1420 removed one layer up.
_fetch_fail_reasons: "Counter[str]" = Counter()
_fetch_fail_lock = threading.Lock()


def _record_fetch_failure(reason: str) -> None:
    with _fetch_fail_lock:
        _fetch_fail_reasons[reason] += 1


def fetch_failure_summary() -> str:
    """Compact 'reason=count' breakdown, most common first. '' when nothing failed."""
    with _fetch_fail_lock:
        if not _fetch_fail_reasons:
            return ""
        return ", ".join(f"{r}={n}" for r, n in _fetch_fail_reasons.most_common(6))


# Fast fail-closed circuit breaker (2026-09-01, daily engineer). The 2026-08-31 fix above made a
# whole-source 5xx outage NAMEABLE; it did not make the run stop causing one. 2026-09-01 confirmed
# the SAME outage still live (3/3 property-details pages 500 from an independent egress) and the
# scraper still had no way to notice short of exhausting all ~1,164 URLs x 3 retries each — which
# guarantees the CI job blows its 90-minute timeout, gets SIGINT-killed before end_run(), and lands
# as exactly the dangling/0-row run docs/ops/DATA_INTEGRITY_ENGINEER.md and
# mon_detect_run_duration_explosion / mon_detect_run_killed_by_timeout warn about. A source that is
# down for every listing announces itself in the first handful of fetches; there is no reason to
# keep paying the retry ladder 1,164 more times to learn the same fact.
_SOURCE_DOWN_SAMPLE = 8  # yesterday's incident hit 3/3 sampled listings — 8 is a cheap, safe margin


def _source_looks_down(attempted: int, captured: int) -> bool:
    """True once there is enough evidence the SOURCE is answering every fetch with a 5xx, not
    that a handful of individual listings happen to be gone or unparseable. Requires: (1) a
    minimum sample so one or two stray 500s can't trip it, (2) zero rows captured so far, and
    (3) every DISTINCT failure reason seen so far is 5xx-class — a mix that also includes
    transport errors or unparseable-200s is a less certain signal and must not fast-abort."""
    if attempted < _SOURCE_DOWN_SAMPLE or captured > 0:
        return False
    with _fetch_fail_lock:
        reasons = list(_fetch_fail_reasons)
    return bool(reasons) and all(r.startswith("http_5") for r in reasons)


def fetch_one(url: str) -> Optional[tuple[dict, str, str]]:
    """Fetch + parse one listing. Returns (obj, body, url) or None. Thread-safe (thread-local session).

    Every None return now records a CONCRETE reason in `_fetch_fail_reasons` first, so a run that
    captures nothing can name the cause instead of guessing at it.
    """
    s = _session()
    last: str = "no_attempt"
    for attempt in range(3):
        try:
            r = s.get(url, timeout=45, headers={"RSC": "1"})
        except Exception as e:
            last = f"transport_{type(e).__name__}"
            time.sleep(2.0 * (attempt + 1)); continue
        if r.status_code != 200:
            # A non-200 is the source refusing/failing — retry, but never let it look like an
            # empty page. This is the branch that was invisible before.
            last = f"http_{r.status_code}"
            time.sleep(2.0 * (attempt + 1)); continue
        o = _extract_obj_for_url(r.text, url)
        if o:
            return o, r.text, url
        # A real 200 we could not parse is a DIFFERENT fact from a 500 — keep them apart.
        _record_fetch_failure("http_200_no_listing_object")
        return None
    _record_fetch_failure(last)
    return None


def _int(v: Any) -> Optional[int]:
    try:
        return int(float(v)) if v not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        return None


def _age_years(v: Any) -> Optional[int]:
    """Building age in literal years, PRESERVING 0.

    `_int` above treats 0 as empty, which is right for an area or a bedroom count and wrong for an
    age: Sanadak renders buildingAge 0 as «أقل من سنة» (verified against the source 2026-09-03), a
    published fact. Only a missing/blank key is UNKNOWN. Anything not a plain non-negative integer
    within smallint range is refused rather than coerced — a shape we have never seen is not
    something to guess at, and property_age is a smallint the AF predicate filters on.
    """
    if v is None or v == "" or isinstance(v, bool):  # bool is an int subclass: True would become "1 year"
        return None
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if 0 <= n <= 200 else None


def sitemap_urls(s: cc.Session) -> tuple[list[str], Optional[str]]:
    """Return (urls, failure_reason). `failure_reason` is None only when the sitemap answered a
    parseable 200; otherwise it is the CONCRETE reason, never a guess.

    Why this returns a reason at all (senior run 2026-08-31): this function used to read `r.text`
    and drop `r.status_code` on the floor, so an HTTP 500 with an empty body produced exactly the
    same `[]` as a healthy 200 whose sitemap listed nothing. main() then wrote the generic
    RC-B note "0-row run (blocked/empty source?)" — a QUESTION MARK persisted as our only record.
    Measured that morning: sanadak.sa/sitemap.xml returned 500 with a 0-byte body 3/3 from an
    independent egress while the homepage served 200, i.e. the source's own endpoint was down and
    nothing about it was ours. Monitoring could not say so, because the status was never captured.
    Same defect class as the erapulse fetch-reason fix (PR #1398) and the verify_deletions
    "0-row run (blocked/empty source?)" fix in run #71: rows_seen alone can never separate
    "the source served nothing" from "we never got an answer we can believe".
    """
    try:
        r = s.get(SITEMAP, timeout=30)
    except Exception as e:                      # transport: never reached the source at all
        return [], f"{type(e).__name__}: {e}"[:200]
    if r.status_code != 200:
        return [], f"sitemap HTTP {r.status_code} ({len(r.content)} byte body)"
    urls = re.findall(r"<loc>([^<]*property-details[^<]*)</loc>", r.text)
    if not urls:
        # A 200 we cannot interpret is still not evidence the catalogue is empty.
        return [], f"sitemap HTTP 200 but 0 property-details <loc> entries ({len(r.content)} bytes)"
    return urls, None


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
        # SOURCE-PUBLISHED building age, in literal years (2026-09-03, alert af_mapping_unplumbed
        # #1285). Sanadak's own RSC payload has carried `buildingAge` all along — it was captured
        # into source_capture and then dropped on the floor, so property_age was NULL on 100% of
        # 1,707 stored rows while 1,236 of them had a published age. That is the TRAPPING failure
        # mode of ADVANCED_FILTER_SOURCE_TRUTH.md §1: the AF property_age predicate is strict and
        # NULL-excluding, so every Sanadak listing was silently unreachable the moment a user
        # answered «كم عمر العقار؟» — and every count-based barrier stayed green, because a
        # uniformly-NULL column is indistinguishable from "the source never said".
        #
        # ADJUDICATED AGAINST THE SOURCE, not inferred from the number's shape (two live probes of
        # sanadak.sa on 2026-09-03): buildingAge 11 → the detail page renders «عمر البناء: 11 سنين»,
        # and buildingAge 0 → «أقل من سنة». So it is a literal year count and 0 is a PUBLISHED
        # value, not a blank. (One of those listings has a broker-written description saying
        # «العمر: 15 سنة تقريباً» while the structured field says 11 — a disagreement INSIDE the
        # source. The structured field is what the platform publishes as the age, so it is what we
        # carry; we do not adjudicate a broker's prose against a platform's own field.)
        #
        # NOT _int(): that helper maps 0 → None (it treats 0 as empty), which would erase «أقل من
        # سنة» on 285 rows — turning a published fact into UNKNOWN, exactly what P2 forbids. A
        # missing/blank key stays None, and only that means UNKNOWN.
        "property_age": _age_years(o.get("buildingAge")),
        "bedrooms": _int(o.get("numberBedrooms")),
        "bathrooms": _int(o.get("numberBathrooms")),
        # Rent-period truth (2026-07-27 audit): Sanadak's own RSC payload carries rentTypeText
        # ('شهر'/'سنة') for every rental — it was already captured into source_capture but the
        # stored row hardcoded 'annual', so a 2,500/شهر listing displayed as 2,500/YEAR (47+ live
        # rows). Map it: 'شهر' → rent_period='monthly' (flows to payment_monthly=true via sync) and
        # price_annual = price*12 — the established annualization convention (gathern/aqarmonthly),
        # so the app's price_annual/12 display shows the source's monthly price EXACTLY. Anything
        # else (سنة, absent) stays annual with the price as published. A never-seen 'يوم' would stay
        # annual + trip the sub-12k price audit rather than being silently guessed at.
        "price_total": price if not is_rent else None,
        "price_annual": (price * 12 if (o.get("rentTypeText") or "").strip() == "شهر" and price else price) if is_rent else None,
        "rent_period": ("monthly" if (o.get("rentTypeText") or "").strip() == "شهر" else "annual") if is_rent else None,
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
    # begin_run() BEFORE the first source call, deliberately (same reasoning the erapulse leg
    # carries): if the sitemap fetch is the thing that fails, the row has to already exist for the
    # concrete reason to have somewhere to land. Otherwise "the source stopped answering" and "the
    # job never ran" are the same observation to every count/ok-based barrier.
    run_id = None if args.limit_test else db.begin_run("sanadak")
    urls, sitemap_err = sitemap_urls(s)
    if sitemap_err:
        # SOURCE-SIDE / UNREACHED, not an empty catalogue. Report the reason verbatim and stop
        # WITHOUT touching listing state — prune_unseen is never reached, so nothing is
        # deactivated on an answer we could not believe (docs/ops/LISTING_LIVENESS.md §1: a
        # non-answer is UNKNOWN, and UNKNOWN never deactivates anything).
        msg = f"sitemap returned no listings — {sitemap_err}"
        print(f"✗ Sanadak: {msg}")
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=msg[:300])
        return 1
    if args.limit_test:
        urls = urls[:max(args.limit_test * 2, 12)]
    print(f"Sanadak: {len(urls)} listings from sitemap ({WORKERS} workers)")
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

        source_down = False
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for result in ex.map(fetch_one, urls):
                done += 1
                if not result:
                    if _source_looks_down(done, seen):
                        # Stop feeding the executor more guaranteed-failing work; cancel_futures
                        # drops whatever hasn't started yet instead of waiting out their full
                        # retry ladders on __exit__.
                        source_down = True
                        ex.shutdown(wait=False, cancel_futures=True)
                        break
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

        if source_down:
            # Never touch listing state on an unreachable source — same contract as sitemap_err
            # above, one layer down (docs/ops/LISTING_LIVENESS.md §1: a non-answer is UNKNOWN, and
            # UNKNOWN never deactivates anything). prune_unseen is never reached.
            msg = (f"aborted after {done}/{len(urls)} detail fetches — every one failed with a "
                   f"5xx (source is down, not us): {fetch_failure_summary()}")
            print(f"✗ Sanadak: {msg}", flush=True)
            if run_id:
                db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=msg[:300])
            return 1

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
        # Carry the detail-fetch breakdown into the run row. Without it a run where the sitemap
        # listed 1,093 URLs and every single page 500'd is recorded identically to a run where the
        # catalogue was genuinely empty — RC-B demotes both with "0-row run (blocked/empty source?)".
        fail_summary = fetch_failure_summary()
        if fail_summary:
            print(f"  detail-fetch failures: {fail_summary}", flush=True)
        notes = f"pruned={pruned}"
        if fail_summary:
            notes += f" | detail-fetch failures ({len(urls) - seen}/{len(urls)}): {fail_summary}"
        healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=notes[:300], check_tables=["sanadak_residential_listings", "sanadak_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI instead of a silent success.", flush=True)
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
