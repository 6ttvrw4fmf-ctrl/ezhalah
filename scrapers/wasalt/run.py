"""Wasalt scraper → writes into the SAME tables as Aqar, tagged source='Wasalt'.

Wasalt (wasalt.sa) is a Next.js app: every search page embeds a `__NEXT_DATA__` JSON blob whose
`searchResult.properties` is a list of 32 fully-structured listings (price, city, district, type,
beds, area, photos). So unlike Aqar (discover URLs → enrich each page), here ONE search-page fetch
yields 32 complete listings — fast and clean.

Search endpoint (paginated, 1-indexed, 32/page):
  https://wasalt.sa/en/{sale|rent}/search?propertyFor={sale|rent}&countryId=1&type={residential|commercial}&propertyTypeData={SLUG}&page={N}

Each listing is mapped onto the aqar_*_listings schema and upserted with a namespaced ad_number
("WST<id>") so it never collides with an Aqar ad number, and source='Wasalt' so the app shows
"Hosted on Wasalt" and opens the wasalt.sa listing on click.

Usage (from ezhalah-app/ with the venv active):
    python -m scrapers.wasalt.run --deal sale --type residential --slug apartment --pages 3
    python -m scrapers.wasalt.run --all --pages 200          # full sweep, all types × sale+rent
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db, normalize

BASE = "https://wasalt.sa"
NEXT_RE = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.4"))
PAGE_SIZE = 32

# STARTUP JITTER (2026-08-23, production degradation investigation). wasalt-residential-sweep.yml
# (20 jobs) and wasalt-commercial-sweep.yml (14 jobs) dispatch fully parallel with no `max-parallel`,
# all sharing ONE WASALT_PROXY_URL secret (Webshare Saudi-residential proxy). PR#824 (merged
# 2026-08-21) proved every failing attempt hung the full 30s timeout and added session rotation on
# retry — verified NOT to have fixed the regression: the platform's daily scrape_runs failure rate
# was 65.7% the day #824 merged and is still 60-69% three days later (re-measured 2026-08-23), because
# rotating a session changes WHICH connection a retry uses, not HOW MANY of our own jobs open a
# connection through the shared pool in the same instant. PR#824's own evidence: 34 jobs' first
# requests landed inside a ~4s window. A `max-parallel` cap (PR#827) is the other half of the fix but
# needs owner tuning against the account's real concurrency ceiling, which no session here can see,
# so it stays a proposed workflow-YAML change pending that decision.
# This jitter is the scraper-side half that needs no such tuning: spreading the SAME 34 jobs' first
# connection attempts across up to a minute (instead of a 4s burst) can only lower peak simultaneous
# demand on the shared proxy, regardless of what its true ceiling turns out to be — it is a strict
# improvement, not a guess at a number. Scoped to GITHUB_ACTIONS (set by every Actions job
# automatically, no workflow-YAML change required to enable it) so a local/manual single-slug run
# never waits — only the cloud matrix, where the contention actually happens, jitters.
def _jitter_max_s() -> float:
    raw = os.environ.get(
        "WASALT_STARTUP_JITTER_MAX_S",
        "60" if os.environ.get("GITHUB_ACTIONS", "").strip().lower() == "true" else "0",
    )
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0.0  # a bad env value degrades to "no jitter", never a crash


# Search-page retry ladder (retuned 2026-08-23, after PR #827's concurrency cap).
#
# Capping the sweeps cut the failure rate hard but did not eliminate it: a residual slice of runs
# still fails at a near-constant 204.2-204.7s. That constant is OURS, not the proxy's — it is
# exactly 2 x (3 attempts x 30s + 2+4+6s backoff), because every failing attempt hangs the FULL
# timeout. A route that accepts the connection and never answers is DEAD; waiting 30s on it buys
# nothing, and spending three 30s waits buys only three draws from the exit-IP pool.
#
# So spend the same kind of budget on MORE DRAWS instead of longer waits: 5 attempts at 15s each
# gives five chances to land on a working route where the old ladder gave three, and still costs
# less wall-clock (5x15 + 1+2+3+4 = 85s vs 102s). 15s is ~2-4x the observed healthy page latency
# (successful slices average ~20s for the probe plus up to 3 pages plus detail fetches), so this
# cannot abort a merely-slow-but-working request.
#
# This does NOT touch wasalt.sa's anti-bot protection. It changes only how long we wait on our own
# dead proxy routes before trying a different one.
_FETCH_ATTEMPTS = 5
_FETCH_TIMEOUT_S = 15
_FETCH_BACKOFF_S = 1


def startup_jitter() -> float:
    """Sleep a random [0, cap) seconds before the first request, cap = _jitter_max_s(). Returns the
    delay actually slept (0 when jitter is disabled/misconfigured), so callers/tests can observe it
    without re-reading the env var."""
    cap = _jitter_max_s()
    if cap <= 0:
        return 0.0
    delay = random.uniform(0, cap)
    time.sleep(delay)
    return delay

# Detail-page fetch is EXPENSIVE: one extra ~400KB HTML request PER listing. Through the Saudi
# residential PROXY (cloud sweeps) that would burn the metered proxy bandwidth fast, so it's OFF by
# default. Run LOCALLY (user's own Saudi IP, free bandwidth) with WASALT_FETCH_DETAIL=1 to backfill
# the deep "Additional Information" fields (street / ad source / plan number / land number). Without
# it, the card still shows the base panel built from the FREE search-list data. (cost guard.)
FETCH_DETAIL = os.environ.get("WASALT_FETCH_DETAIL", "").strip().lower() not in ("", "0", "false", "no")

# Wasalt's property-type slugs per category (the search's propertyTypeData). Each listing still
# carries its REAL subtype in propertyInfo.propertySubType — these just drive query coverage.
SLUGS = {
    "residential": ["apartment", "villa-townhouse", "floor", "building", "land", "rest-house", "chalet", "farm", "room", "duplex"],
    "commercial":  ["shop", "office", "warehouse", "commercial-land", "showroom", "building", "land"],
}

# Wasalt propertySubType → canonical taxonomy type, and Wasalt city spelling → canonical DB city
# label, both UNIFIED into the shared canonical maps 2026-07-16 (fix/normalize-unification): every
# key/value that used to live in this file's private TYPE_MAP/CITY_MAP moved VERBATIM to
# scrapers/common/normalize.py TYPE_MAP_EN / CITY_MAP_EN, so shared fixes now propagate here (Wasalt
# is the #2 platform by volume and was bypassing every shared helper). Lookups below go through
# normalize.map_type_en()/map_city_en() — EXACT, case-sensitive, no substring pass, so behaviour for
# every previously-mapped input is byte-identical (golden proof:
# scrapers/common/tests/test_normalize_unification_golden.py). Wasalt currently needs NO per-platform
# overrides — if a future Wasalt-only mapping conflict appears, define
# WASALT_TYPE_OVERRIDES/WASALT_CITY_OVERRIDES here and pass overrides= (contract:
# normalize.map_type_exact docstring); never fork a private copy of the maps again.

_last = 0.0


def _throttle() -> None:
    global _last
    wait = _last + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()


def _build_session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({"Accept-Language": "en,ar;q=0.8"})
    # Route through a Saudi residential proxy when WASALT_PROXY_URL is set in the env.
    # This is how the GitHub Actions cloud workflows reach wasalt.sa — Wasalt geo-blocks bare
    # datacenter IPs but accepts a Saudi residential proxy. Local runs leave the var unset and
    # use the user's own Saudi home IP directly. (user request: 24/7 cloud parity with Aqar.)
    proxy = os.environ.get("WASALT_PROXY_URL", "").strip()
    if proxy:
        s.proxies = {"http": proxy, "https": proxy}
    return s


class RotatingSession:
    """Wraps one curl_cffi Session but lets a caller force a fresh TCP/proxy connection
    (rotate()) between retries, while every existing call site keeps calling `.get(...)` on
    the same object — no refactor needed anywhere `s` is passed around (map_property,
    _fetch_additional_attributes, scrape_slice, ...).

    2026-08-21 incident fix: the OLD code created ONE curl_cffi session per process and
    reused it (and its underlying connection pool / proxy tunnel) across all 3 retry attempts
    of every fetch_page() call. Through the shared Webshare Saudi-residential proxy, once an
    attempt landed on a bad/overloaded exit route, all 3 retries stayed pinned to that exact
    same route and were guaranteed to hang the full 30s timeout again — 59/103 wasalt runs/24h
    failed this way (204.2-204.7s each), while runs in the SAME dispatch batch that happened to
    get a healthy route succeeded in 5-37s (evidence: scrape_runs timing query, 2026-08-21).
    rotate() opens a brand-new session (new TCP handshake, new proxy-gateway negotiation) so a
    retry after a failure gets a real chance at a different route instead of 3 guaranteed-
    identical failures."""

    def __init__(self) -> None:
        self._s = _build_session()

    def rotate(self) -> None:
        self._s = _build_session()

    def get(self, *a, **kw):
        return self._s.get(*a, **kw)


def session() -> RotatingSession:
    return RotatingSession()


def fetch_page(s: RotatingSession, deal: str, cat: str, slug: str, page: int) -> tuple[int, int, list[dict], bool]:
    """Return (count, total_pages, properties[], valid) for one search page.

    `valid` is True only when the response carried a parseable __NEXT_DATA__ searchResult —
    the signal that Wasalt's app actually answered. A bot-wall/consent shell or an exhausted
    proxy never produces that structure, so (0, 0, [], False) from those stays distinguishable
    from a genuine "this category has zero listings" answer (0, 0, [], True)."""
    seg = "sale" if deal == "sale" else "rent"
    url = (f"{BASE}/en/{seg}/search?propertyFor={deal}&countryId=1&type={cat}"
           f"&propertyTypeData={slug}&page={page}")
    _throttle()
    for attempt in range(_FETCH_ATTEMPTS):
        try:
            r = s.get(url, timeout=_FETCH_TIMEOUT_S)
        except Exception as e:
            print(f"   ⚠ wasalt fetch attempt {attempt + 1}/{_FETCH_ATTEMPTS} ({slug}/{deal} "
                  f"p{page}) raised {type(e).__name__}: {str(e)[:160]}")
            if attempt < _FETCH_ATTEMPTS - 1:
                s.rotate()  # fresh TCP/proxy route on the next attempt
            time.sleep(_FETCH_BACKOFF_S * (attempt + 1)); continue
        if r.status_code != 200:
            print(f"   ⚠ wasalt fetch attempt {attempt + 1}/{_FETCH_ATTEMPTS} ({slug}/{deal} "
                  f"p{page}) got HTTP {r.status_code}")
            if attempt < _FETCH_ATTEMPTS - 1:
                s.rotate()
            time.sleep(_FETCH_BACKOFF_S * (attempt + 1)); continue
        m = NEXT_RE.search(r.text)
        if not m:
            return 0, 0, [], False
        sr = (json.loads(m.group(1)).get("props", {}).get("pageProps", {}).get("searchResult") or {})
        props = [p for p in (sr.get("properties") or []) if isinstance(p, dict)]
        return int(sr.get("count") or 0), int(sr.get("totalPages") or 0), props, True
    return 0, 0, [], False


def _attr(prop: dict, key: str) -> Any:
    for a in prop.get("attributes") or []:
        if a.get("key") == key:
            return a.get("value")
    return None


# Wasalt's `additionalAttributes` LIVES ON THE DETAIL PAGE (not the search-list page). Fetching
# every detail is expensive, so we batch the slug → additional_info during a sweep IF the slug is
# new. This module-local LRU avoids re-fetching the same slug within one run.
_DETAIL_CACHE: dict[str, list[dict[str, Any]]] = {}


def _fetch_additional_attributes(s: "RotatingSession", slug: str) -> list[dict[str, Any]]:
    """Fetch the listing's detail page and return its additionalAttributes list (or [] on failure).
    Wasalt's detail page __NEXT_DATA__ exposes propertyDetailsV3.additionalAttributes — 20-30
    label/value rows that populate the on-site 'Additional Information' panel."""
    if slug in _DETAIL_CACHE:
        return _DETAIL_CACHE[slug]
    _throttle()  # detail fetches count toward the same politeness budget as search pages
    try:
        r = s.get(f"{BASE}/en/property/{slug}", timeout=25)
        if r.status_code != 200:
            _DETAIL_CACHE[slug] = []
            return []
        m = NEXT_RE.search(r.text)
        if not m:
            _DETAIL_CACHE[slug] = []
            return []
        pdv = (json.loads(m.group(1)).get("props", {}).get("pageProps", {})
               .get("propertyDetailsV3") or {})
        raw = pdv.get("additionalAttributes") or []
        # Keep only rows with a non-empty value the user would care about.
        keep_keys = {
            "propertyMainType", "completionYear", "propertyFacade", "street", "adSource",
            "planNumber", "landNumber", "obligations", "zipCode", "regaAdvLicDate",
            "additionalNumber", "buildingNumber", "electricityMeter", "waterMeter",
            "noOfFloors", "floorNumber", "furnishingType", "noOfParkings",
        }
        rows = []
        for a in raw:
            if not isinstance(a, dict): continue
            k = a.get("key"); lbl = a.get("label"); v = a.get("value")
            if k in keep_keys and v not in (None, "", "None"):
                rows.append({"key": k, "label": lbl, "value": v})
        _DETAIL_CACHE[slug] = rows
        return rows
    except Exception:
        _DETAIL_CACHE[slug] = []
        return []


def _base_additional_info(prop: dict, info: dict) -> list[dict[str, Any]]:
    """Build the 'Additional Information' panel from the FREE search-list data (no detail fetch).
    Covers the fields Wasalt exposes on the list page: Property usage, Age, Furniture, Facade. The
    deeper fields (Street / Ad source / Plan / Land number) only exist on the detail page and are
    added by _fetch_additional_attributes when WASALT_FETCH_DETAIL is enabled."""
    out: list[dict[str, Any]] = []
    def add(key, label, value):
        if value not in (None, "", "None"):
            out.append({"key": key, "label": label, "value": str(value)})
    add("propertyMainType", "Property usage", info.get("possessionType") or info.get("propertyMainType"))
    add("completionYear", "Age", _attr(prop, "completionYear"))
    add("furnishingType", "Furniture", info.get("furnishingType"))
    add("propertyFacade", "Facade", info.get("facingType") or _attr(prop, "facing"))
    return out


def map_property(prop: dict, deal: str, s: Optional["RotatingSession"] = None) -> Optional[dict[str, Any]]:
    info = prop.get("propertyInfo") or {}
    pid = prop.get("id")
    slug = info.get("slug")
    if not pid or not slug:
        return None
    sub = info.get("propertySubType") or ""
    # Unmapped subtype → RAW preserved (never a guessed default; Batch 2 type-truth contract) —
    # byte-identical to the old `TYPE_MAP.get(sub, sub or None)`.
    property_type = normalize.map_type_en(sub) or (sub or None)
    # Resolve the "Additional Information" panel ONCE so we can also set the detail_enriched flag.
    if FETCH_DETAIL and s is not None:
        deep = _fetch_additional_attributes(s, slug)
        addl_info = deep or _base_additional_info(prop, info)
        detail_enriched = bool(deep)  # True only when the detail page actually yielded deep rows
    else:
        addl_info = _base_additional_info(prop, info)
        detail_enriched = False
    raw_city = (info.get("city") or info.get("state") or "").strip()
    # Forward-fix (2026-07-10 location-data-quality audit): an honest None beats the literal "Other"
    # sentinel this used to fall back to — it survived to the frontend and rendered as the bare
    # English word "Other" on Arabic-UI cards. High-volume cities are all covered in CITY_MAP; the
    # separate city_ar/district_ar columns (unaffected by this line) remain the real recoverable
    # signal for existing junk rows.
    city = normalize.map_city_en(raw_city)
    is_rent = deal == "rent"
    # Numeric parsing DELIBERATELY kept local (2026-07-16 normalize-unification audit): Wasalt's
    # prices/areas/counts arrive as JSON-native numbers from __NEXT_DATA__, not display text.
    # normalize.to_int() is for human-formatted strings and is NOT behaviour-identical on these
    # shapes (a float with 3+ decimals would be read as European digit grouping and inflated —
    # the mirror image of the 2026-07-13 price-fidelity bug — and scientific-notation floats would
    # be mangled), and normalize.to_int_numeric() maps 0→None where this code keeps 0. Bare
    # int()/int(float()) on JSON numbers is the provably-correct parse here; do not "unify" it
    # without a golden old-vs-new comparison over real Wasalt payloads.
    area = _attr(prop, "builtUpArea") or info.get("builtUpArea") or prop.get("floorSize")
    try:
        area_m2 = int(float(area)) if area not in (None, "", "0") else None
    except (TypeError, ValueError):
        area_m2 = None
    def _i(v):
        try: return int(v) if v not in (None, "") else None
        except (TypeError, ValueError): return None
    bedrooms = _i(_attr(prop, "noOfBedrooms"))
    bathrooms = _i(_attr(prop, "noOfBathrooms"))
    halls_or_majlis = _i(_attr(prop, "noOfLivingRooms") or _attr(prop, "livingRooms") or _attr(prop, "noOfHalls"))
    # ⚠ UNVERIFIED FALLBACK (flagged 2026-08-22, not yet fixed — do not "clean this up" blindly).
    # `conversionPrice` is used here as a SAR sale total, but nothing in this repo documents what
    # wasalt means by it, and it appears nowhere else. Suspected in the standing P1
    # field_integrity_phone_price:wasalt_residential_listings: 8 ACTIVE, searchable rows carry a
    # sale price ~100x too high, and dividing by 100 yields a consistent, realistic band —
    #   560000000/700m²→8,000  561700000/561→10,012  594000000/900→6,600
    #   585000000/900→6,500    562140000/810→6,940   (SAR/m², ids 446386/448556/456656/457706/4002193)
    # Random values would scatter; a tight realistic band after ÷100 points at a minor-unit
    # (halala) or converted-currency figure reaching this line, NOT a phone-as-price artifact.
    # NOT repriced and NOT changed: that needs the source, and wasalt is unreachable from CI/agent
    # containers (Cloudflare challenges a plain fetch; curl_cffi impersonation is reset by the
    # egress proxy). Confirm what conversionPrice is against a live payload BEFORE touching either
    # this line or those rows — a source-published price stays searchable at any magnitude.
    sale_price = info.get("salePrice") or info.get("conversionPrice")
    rent_price = info.get("expectedRent")
    # Rent-period truth (2026-07-27 audit): Wasalt publishes per-frequency pricing in
    # propertyInfo.rentFreq {monthly:{amount,default_freq}, yearly:{amount,default_freq}} on BOTH
    # the search-list and detail payloads (live-verified). The old mapping hardcoded
    # rent_period='annual' and took expectedRent as-is, which (a) mislabeled source-default-MONTHLY
    # rentals as yearly and (b) for monthly-ONLY listings stored the per-month amount as a per-YEAR
    # price (live-proven: 5807133 renders only "3,000 /Month" yet was stored price_annual=3000 with
    # payment_monthly=false). New truth follows the source's DEFAULT product:
    #   - default_freq monthly → rent_period='monthly' (flows to payment_monthly=true via the
    #     existing sync, no DB change), price_annual = monthly_amount*12 — the established
    #     annualization convention (gathern/aqarmonthly), so the app's price_annual/12 display
    #     shows the source's monthly headline EXACTLY (price fidelity at the card).
    #   - otherwise → rent_period='annual', price_annual = the source's yearly amount as published
    #     (falls back to legacy expectedRent when rentFreq is absent — byte-identical behaviour).
    # EVIDENCE (2026-08-15 senior audit, run #21). Until now this payload was read and thrown away:
    # run.py stored the DERIVED price_annual but never the rentFreq it came from, so "does the LIST
    # endpoint publish its own yearly amount when monthly is the default?" was unanswerable from the
    # database, and the standing `rent_period_source_mismatch` P1 was formally blocked on it. The
    # only other copy of rentFreq is `ar_data`, written ONCE by enrich_ar and never refreshed —
    # measured 42.1 days stale on average (max 50.7), so it cannot adjudicate a current price.
    # We now preserve the raw block verbatim. No parsing, no derivation, no behaviour change.
    rent_freq_evidence = None
    rent_is_monthly = False
    if is_rent:
        rent_freq = info.get("rentFreq") or {}
        rf_monthly = rent_freq.get("monthly") or {}
        rf_yearly = rent_freq.get("yearly") or {}
        rent_freq_evidence = rent_freq or None
        if rf_monthly.get("default_freq") and rf_monthly.get("amount"):
            rent_is_monthly = True
            # DELIBERATELY still x12, and deliberately NOT switched to rf_yearly["amount"].
            # Measured on contemporaneous rows (ar snapshot <=48h old, so both endpoints describe the
            # same moment): of 14 rows publishing BOTH amounts, 13 have yearly != monthly*12, and 9
            # are stored here as monthly*12 while wasalt publishes a different yearly. So the x12
            # result IS a fabricated annual figure. But storing rf_yearly instead only moves the
            # error: the card renders price_annual/12 as the monthly headline, so a published yearly
            # that is not exactly 12x would then misstate the monthly price the source advertises.
            # ONE column cannot carry both published figures, and choosing which one the card shows
            # is a product decision (AGENTS.md RED: product meaning), not a scraper fix. Escalated
            # 2026-08-15 with this evidence; until it is decided, the long-standing behaviour stands
            # and `mon_detect_wasalt_annualisation_fabricated` measures the exposure every hour.
            rent_price = int(rf_monthly["amount"]) * 12
        elif rf_yearly.get("amount"):
            rent_price = rf_yearly["amount"]
    # Property photos are served by Cloudflare Images, keyed by listing id + image filename. The
    # bare cdn.wasalt.sa/<uuid> guess 404s — the real path is imagedelivery.net/<acct>/production/
    # properties/<id>/images/<uuid>.jpg/<transform>. (verified against the live <img src>.)
    imgs = (prop.get("propertyFiles") or {}).get("images") or []
    photo_urls = [
        f"https://imagedelivery.net/1DNKFJPRaeUdy_j8F7HT3w/production/properties/{pid}/images/{i}/width=800,quality=70,format=auto"
        for i in imgs[:30] if isinstance(i, str)
    ]

    # Aqar-parity rich fields (user request: same feature row + features grid as Aqar). Wasalt
    # exposes them on prop.attributes (key/value), propertyInfo.*, and prop.featureAmenities.
    # property_age is NOT derived here. The search-LIST API's `completionYear` attribute is a
    # 1-based-ish ENUM offset from true years (measured 2026-07-17: "New" -> 1 not 0, "10+ years" -> 12),
    # which silently corrupted the canonical column for ~21k rows. The AUTHORITATIVE value is the
    # human string on the DETAIL page, resolved in enrich.py via normalize.parse_property_age(). Until a
    # listing is detail-enriched its age is honestly unknown (NULL) — better than a wrong enum. We still
    # carry the list-page completionYear into additional_info (below) so enrichment/audit can see it.
    property_age = None

    # Direction / facade — Wasalt sometimes carries it on streetInfo[].en.facing or attributes.facing.
    direction = None
    for si in prop.get("streetInfo") or []:
        en = (si.get("en") or {}) if isinstance(si, dict) else {}
        if en.get("facing"):
            direction = en["facing"]; break
    if not direction:
        direction = _attr(prop, "facing") or _attr(prop, "direction")

    street_name = None
    for si in prop.get("streetInfo") or []:
        if isinstance(si, dict):
            street_name = si.get("streetName") or street_name
    if not street_name:
        street_name = info.get("streetName")

    # Wasalt's `furnishingType` → matches Aqar's "Furnished/Un-Furnished" tag; "possessionType"
    # is the property usage (Residential/Commercial). We carry both via residence_type.
    residence_type = info.get("possessionType") or None
    project_name = info.get("project") or info.get("managedBy") or None

    # Feature amenities (Wasalt's curated list of nearby amenities — Parking, Mosque, etc.). We map
    # each into the closest Aqar feature-grid boolean so the card UI lights up the same icons.
    # SOURCE FIDELITY (owner rule): an ABSENT amenity list is UNKNOWN, not "no amenities".
    # `featureAmenities` is Wasalt's curated list and it is frequently missing entirely — measured
    # 2026-08-05: 0 of 9,247 active Wasalt rent apartments have the key in their stored capture. The
    # old `has()` returned a bare False in that case, so every one of those rows recorded a confident
    # "this flat has NO lift / NO parking / NO kitchen" that Wasalt never published (elevator was
    # false on 9,247/9,247 — a column that can only say "no" is not reading anything). When the list
    # IS present, absence of a keyword genuinely means Wasalt did not list that amenity, so False is
    # the honest answer there. Hence: no list -> None (unknown); list present -> True/False.
    _raw_amenities = prop.get("featureAmenities")
    _has_amenity_list = isinstance(_raw_amenities, list) and len(_raw_amenities) > 0
    amenities = [(a or {}).get("name", "").lower() for a in (_raw_amenities or []) if isinstance(a, dict)]
    has = lambda *kws: (any(kw in a for a in amenities for kw in kws) if _has_amenity_list else None)
    return {
        "ad_number": f"WST{pid}",
        "listing_url": f"{BASE}/en/property/{slug}",
        "source": "Wasalt",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": area_m2,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "halls": halls_or_majlis,
        "reception_rooms_majlis": halls_or_majlis,  # Wasalt doesn't separate; same number
        "property_age": property_age,
        "direction": direction,
        "street_name": street_name,
        "residence_type": residence_type,
        "project_name": project_name,
        # Raw per-frequency pricing exactly as the search-list published it, so the annualisation
        # question is answerable from the DB forever. Written only when the source sent one.
        **({"source_capture": {"schema": "wasalt.list.v1", "rent_freq": rent_freq_evidence}}
           if rent_freq_evidence else {}),
        "price_annual": int(rent_price) if (is_rent and rent_price) else None,
        "price_total": int(sale_price) if (not is_rent and sale_price) else None,
        "rent_period": ("monthly" if rent_is_monthly else "annual") if is_rent else None,
        "city": city,
        "neighborhood": info.get("zone") or info.get("address"),
        "title": info.get("title"),
        "photo_urls": photo_urls,
        "rega_location_verified": bool(prop.get("isRegaProp")),
        # "Additional Information" panel + the enriched flag (resolved above). Base rows come FREE
        # from the search-list; deep rows only when WASALT_FETCH_DETAIL=1. detail_enriched lets the
        # cloud "new-only" enricher skip rows that already have the deep fields. (cost guard.)
        "additional_info": addl_info,
        # SOURCE IS TRUTH (owner rule 2026-08-09, docs/ops/EZHALAH_DATA_ARCHITECTURE_GOAL.md).
        # wasalt states these two explicitly as "Yes"/"No" in its additionalAttributes panel, on
        # ~100% of listings. They were NEVER written here, so PostgreSQL's `DEFAULT false` invented a
        # negative on all 52,892 active rows — contradicting wasalt's own "Yes" on 45,723 (water) and
        # 51,801 (electricity) of them. The defaults are now dropped fleet-wide; these must be
        # written explicitly, tri-state, or the fact is lost instead of merely wrong.
        "separate_water_meter":       _yes_no(addl_info, "waterMeter"),
        "separate_electricity_meter": _yes_no(addl_info, "electricityMeter"),
        "detail_enriched": detail_enriched,
        # Feature-grid booleans the card already renders. Wasalt amenities map roughly.
        #
        # ONLY THE KEYWORDS WASALT'S VOCABULARY ACTUALLY USES (2026-08-11). The rule above — "list
        # present -> absence of a keyword means Wasalt did not list that amenity, so False is
        # honest" — holds ONLY for a keyword the curated list is capable of containing. For a
        # keyword it never uses, `False` does not mean "the property lacks it", it means "this
        # vocabulary cannot express it", and writing that is manufacturing a negative.
        #
        # Measured over the ENTIRE wasalt corpus (62,745 rows, active + inactive, all time):
        #
        #     parking  2,258 true / 11,023 false      elevator          0 true /   203 false
        #     maid       1,285 / 11,996               air_conditioner   0 / 203
        #     laundry      828 / 12,453               private_entrance  0 / 203
        #     driver       739 / 12,542               optical_fibers    0 / 203
        #     balcony      658 / 12,623               water_supply      0 / 203
        #     kitchen       80 / 13,201               electricity       0 / 203
        #                                             sanitation        0 / 203
        #
        # Two different populations. The six on the left are read: even `kitchen`, the rarest,
        # says "yes" 80 times. The seven on the right have NEVER been true once in 62,745 rows —
        # and only 203 rows carry any value at all, because the 2026-08-05 repair NULLed them
        # fleet-wide and every crawl since has re-manufactured the same negative on whatever it
        # touched. That is the signature the safety barrier exists to catch, and on 2026-08-11 it
        # caught it (mon_safety_barrier_state, 7 wasalt pairs × 199 active rows) and turned
        # `npm test` red on every open PR.
        #
        # So the seven are NOT mapped: the column stays NULL (honest unknown) rather than a
        # confident "no" Wasalt never published. Water and electricity are not lost — Wasalt states
        # those explicitly in its additionalAttributes panel and they are captured above as
        # separate_water_meter / separate_electricity_meter via the tri-state `_yes_no()`.
        #
        # Re-adding any of the seven requires evidence that the keyword can appear at all, i.e. at
        # least one true. scripts/verify-wasalt-amenity-vocabulary.ts fails the build otherwise.
        "parking":          has("parking", "garage"),
        "kitchen":          has("kitchen"),
        "maid_room":        has("maid"),
        "driver_room":      has("driver"),
        "laundry_room":     has("laundry"),
        "balcony_terrace":  has("balcony", "terrace"),
    }


def _yes_no(addl_info, key: str):
    """A wasalt additionalAttributes flag as a TRI-STATE: Yes -> True, No -> False, absent -> None.

    `None` means wasalt did not state it and is the only honest answer — never False. See
    docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md.
    """
    for a in addl_info or []:
        if isinstance(a, dict) and a.get("key") == key:
            v = str(a.get("value") or "").strip().lower()
            if v == "yes":
                return True
            if v == "no":
                return False
            return None
    return None


def upsert(row: dict, main_type: str) -> None:
    # Residential → its own Wasalt table. Commercial Wasalt is a later milestone (separate table);
    # skip commercial rows for now so a residential sweep that bumps into one doesn't error.
    if main_type == "Commercial":
        return
    db.upsert_wasalt_residential(row)


def scrape_slice(s, deal: str, cat: str, slug: str, *, max_pages: int) -> tuple[int, int, bool]:
    """Sweep one type-slug × deal. Returns (upserted, source_count, page1_valid)."""
    count, total_pages, _, page1_valid = fetch_page(s, deal, cat, slug, 1)
    pages = min(max_pages, total_pages or max_pages)
    print(f"\n── WASALT {slug.upper():<16} {deal.upper():<4} {cat.upper():<11} count={count} pages≤{pages}")
    if not page1_valid:
        # The probe above already spent the WHOLE retry ladder on this route and never got a
        # parseable answer. The loop below would then re-fetch page 1 and spend the ENTIRE ladder
        # again on the same dead route — which is exactly the 204.2-204.7s plateau seen on every
        # failing wasalt run since 2026-08-17 (2 x 102s: 3 attempts x 30s plus 2+4+6s backoff).
        # A second identical fetch cannot succeed where the first exhausted every retry, so bail:
        # it halves the cost of a failure and stops us hammering a bad exit route twice over.
        # valid=False still propagates, so the fail-visibly guard reports a block, never an empty
        # category.
        print(f"   ✗ page 1 unanswerable after the full retry ladder — abandoning {slug}/{deal} "
              f"rather than re-running the same ladder on the same route")
        return 0, count, False
    is_commercial = cat == "commercial"
    upserter = db.upsert_wasalt_commercial_batch if is_commercial else db.upsert_wasalt_residential_batch
    upserted = 0
    for page in range(1, pages + 1):
        _, _, props, _ = fetch_page(s, deal, cat, slug, page)
        if not props:
            break
        batch = []
        for prop in props:
            # Pass the session so map_property can fetch the detail page's additionalAttributes
            # (only on first sight of the slug — cached after that).
            row = map_property(prop, deal, s)
            if not row or not row.get("property_type"):
                continue
            batch.append(row)
        if batch:
            try:
                upserter(batch)  # one round-trip per page
                upserted += len(batch)
            except Exception as e:
                print(f"   ✗ batch upsert failed (page {page}): {str(e)[:90]}")
        if page % 20 == 0:
            print(f"   [{page}/{pages}] upserted so far: {upserted}")
    print(f"   ✓ {slug}/{deal}: {upserted} upserted")
    return upserted, count, page1_valid


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--deal", choices=["sale", "rent"], default="sale")
    p.add_argument("--type", choices=["residential", "commercial"], default="residential")
    p.add_argument("--slug", default="apartment")
    p.add_argument("--pages", type=int, default=3)
    p.add_argument("--all", action="store_true", help="sweep every type × sale+rent")
    args = p.parse_args()

    # Spread this job's first proxy connection out over the cloud matrix's burst window (see the
    # module-level note on WASALT_STARTUP_JITTER_MAX_S) — a no-op locally/manually.
    jittered = startup_jitter()
    if jittered:
        print(f"   (startup jitter: waited {jittered:.1f}s to spread cloud-matrix load on the shared proxy)")

    s = session()
    run_id = db.begin_run("wasalt")
    total = 0
    legit_empty = False
    try:
        if args.all:
            for cat, slugs in SLUGS.items():
                for slug in slugs:
                    for deal in ("sale", "rent"):
                        up, _count, _valid = scrape_slice(s, deal, cat, slug, max_pages=args.pages)
                        total += up
        else:
            total, src_count, page1_valid = scrape_slice(s, args.deal, args.type, args.slug, max_pages=args.pages)
            # A single-category run may legitimately be empty: Wasalt itself can carry zero
            # listings for a slug (farm has zero, always has). That is only believable when the
            # app actually answered (page1_valid: parsed __NEXT_DATA__) AND its own count said 0 —
            # a bot-wall/proxy failure produces an unparseable shell (valid=False) and still fails.
            # A valid page claiming count>0 while we upserted 0 is a parse/mapping break: still fails.
            legit_empty = total == 0 and page1_valid and src_count == 0
        # Fail-visibly guard (owner 2026-07-07): a Wasalt sweep that fetched/upserted ZERO rows is a
        # failure, NOT a healthy empty result — Wasalt has ~59k live listings, so a working sweep always
        # re-sees thousands (upsert refreshes existing rows too). 0 rows means the Saudi residential
        # proxy is down / IP-blocked and the site served an empty/bot-wall shell. Never report ok=true
        # on 0 rows, or the run looks green in scrape_runs while nothing flows into search. Mirrors the
        # toor guard (PR #30). The one exception is the verified-empty single category above (2026-07-21).
        ok = total > 0 or legit_empty
        if legit_empty:
            notes = f"source reports 0 listings for {args.slug}/{args.deal} (valid page, empty category)"
        elif ok:
            notes = f"upserted={total}"
        else:
            notes = "FETCHED 0 ROWS — proxy/network block (fail-visibly guard)"
    except Exception as e:
        ok = False
        notes = str(e)[:400]
        print(f"\n✗ FATAL: {e}")
    finally:
        healthy = db.end_run(run_id, ok=ok, rows_seen=total, rows_upserted=total, notes=notes, allow_empty=legit_empty, check_tables=["wasalt_residential_listings", "wasalt_commercial_listings"])
    print(f"\n📊 Wasalt done. {total} upserted. (run_id={run_id})")
    if ok and not healthy:
        print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI instead of a silent success.", flush=True)
    return 0 if (ok and healthy) else 1


if __name__ == "__main__":
    raise SystemExit(main())
