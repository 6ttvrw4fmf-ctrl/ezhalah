"""Muktamel (muktamel.com / مكتمل) scraper — Saudi Nuxt 2 SSR site, sequential-ID sweep.

مكتمل is a REGA-integrated Saudi property marketplace. There is NO usable public JSON API and the
sitemap is stale, so we enumerate listings by sequential ID: GET /real-estates/<id> for every id in
a range and parse the server-rendered page. The site had no working crawl from 2026-07-15 (a
_NodeWorker IPC deadlock, fixed 2026-09-03) until re-verified live 2026-09-03: the live band has
moved on in the interim -- ids 24000-24300 are now ~0% live (aged out), while 31700-32300 measured
86-88% live, well past the old "~100..31000" estimate. Re-measure before trusting either bound
again; scrapers/muktamel/diag_page_structure.py is the tool for it. MIN_ID_DEFAULT is left at 1
deliberately (never silently narrow the space you enumerate) -- callers (the sharded workflow)
pass the evidenced range explicitly instead.

Data path — the page is Nuxt 2: every field is server-rendered into a `window.__NUXT__=(function(...){
...}(...))` IIFE. That payload is NOT plain JSON (Nuxt 2's minified-arg format), so we evaluate the
IIFE in a tiny Node subprocess (`node` ships on the runners) and read back clean JSON:
  • data[0].offer          → the listing (price, area, rooms, type, dealType, address ids, features…)
  • data[0].offerInitialPhotos / offer.photos → photo uuids (Azure blob)
  • state.addressJson       → {Regions, Cities, Districts} numeric-id → Arabic-name dictionaries
  • state.tr.realEstateType / dealType / features / building_finish / building_age / street_sides
                            → enum-id → Arabic-label dictionaries
A pure-Python regex fallback (offer-only) covers the rare case Node is unavailable.

LIVENESS: an active listing has offer.isAvailable === true (price/photos/adLicense populated). Dead /
expired ids still return HTTP 200 with a hollow shell where isAvailable === false and price === null,
or redirect to /404 — both are skipped. Auctions (dealType 11 / isAuction) are skipped per spec.

⛔ PDPL: the detail page (offer.generalAuthority) carries the advertiser PERSON NAME + a Saudi MOBILE
number, and offer.agency.contact carries phones/whatsApp. We NEVER store the agent name or any phone
— not in a column, not in additional_info, not in title/description. We REDACT 05x/+966/9200/wa.me
patterns out of title+description. The AGENCY company name + its REGA/CR licence numbers ARE allowed
(company, not a person) and are kept in additional_info.

Field map (Muktamel → our schema):
  offer.price + dealType(rent?) + isRentPerYear → price_total | price_annual (+ rent_period)
  offer.landArea / buildingArea                 → area_m2
  offer.type → realEstateType[ar] → TYPE_MAP    → property_type (+ res/com routing)
  offer.dealType 1/3=Buy 2/4=Rent 11=auction    → transaction_type (auction skipped)
  offer.address.{region,city,district} ids      → Arabic names → canonical city/region via normalize
  offer.bedRoomsCount/bathroomsCount/hallsCount/otherRoomsCount/floorsCount
  offer.features[] ids → feature labels          → amenity boolean columns (elevator/maid/…)
  offer.streets[] direction+width                → direction / street_width_m (+ additional_info)
  offer.generalAuthority.adLicenseNumber         → rega ad number (additional_info)
  offer.agency.{name,crNo,publisherNumber}       → agency company + licences (additional_info)
  offer.photos[].path /OffersImages/<uuid>       → Azure blob -md.jpg URLs → photo_urls

Usage:  python -m scrapers.muktamel.run [--type residential|commercial|all] [--limit N]
        [--min-id 1] [--max-id 32000]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
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

BASE = "https://www.muktamel.com"
WORKERS = int(os.environ.get("MUKTAMEL_WORKERS", "8"))
MIN_ID_DEFAULT = 1
MAX_ID_DEFAULT = 32000

BLOB = "https://muktamelstorage.blob.core.windows.net/images/OffersImages"

# offer.type (realEstateType enum) → canonical English property type (matches the app taxonomy).
TYPE_MAP = {
    0: None,            # لايوجد
    1: "Villa",         # فيلا
    2: "Villa",         # دوبلكس
    3: "House",         # بيت شعبي
    4: "Chalet",        # استراحة شاليه
    5: "Villa",         # قصر
    6: "Floor",         # دور مستقل
    7: "Apartment",     # شقة
    8: "Studio",        # غرفة (استوديو)
    9: "Building",      # عمارة
    10: "Building",     # مجمع سكني
    11: "Residential Land",  # أرض
    12: "Residential Land",  # أرض خام
    13: "Office",       # مكتب
    14: "Shop",         # محل
    15: "Showroom",     # صالة عرض
    16: "Warehouse",    # مستودع
    17: "Commercial Building",  # مجمع تجاري
    18: "Hotel",        # فندق
    19: "Factory",      # مصنع
    20: "Farm",         # مزرعة
}
COMMERCIAL_TYPES = {
    "Office", "Shop", "Showroom", "Warehouse", "Commercial Building",
    "Hotel", "Factory", "Commercial Land",
}
# LAND (أرض): Muktamel quotes these at a SAR-per-m² RATE in offer.price, not a total — see the
# price block in map_listing(). Other types (incl. Farm) carry an absolute total.
LAND_TYPES = {"Residential Land", "Commercial Land"}

# offer.dealType: 1 سكني للبيع · 2 سكني للإيجار · 3 تجاري للبيع · 4 تجاري للإيجار · 11 مزادات
RENT_DEAL_TYPES = {2, 4}
AUCTION_DEAL_TYPES = {11}

# Region numeric-id → canonical English region (addressJson.Regions keys 11..23).
REGION_ID_EN = {
    11: "Riyadh", 12: "Makkah", 13: "Eastern Province", 14: "Madinah", 15: "Qassim",
    16: "Asir", 17: "Jazan", 18: "Tabuk", 19: "Hail", 20: "Najran", 21: "Al Jawf",
    22: "Al Bahah", 23: "Northern Borders",
}

# offer.features[] id → canonical boolean amenity column (only ids that map to a real column).
FEATURE_COLS = {
    1: "water_supply",       # مياه حكومية
    23: "electricity",       # كهرباء
    120: "sanitation",       # صرف صحي
    3: "optical_fibers",     # انترنت (best-effort)
    4: "air_conditioner",    # تكييف
    5: "air_conditioner",    # تكييف
    7: "kitchen",            # مطبخ مجهز
    10: None,                # ملحق خارجي (annex) → additional_info only
    11: "maid_room",         # غرفة خادمة
    12: "driver_room",       # غرفة سائق
    13: "laundry_room",      # غرفة غسيل
    15: "elevator",          # مصعد
    19: "balcony_terrace",   # حديقة (garden ~ outdoor) — best-effort
    20: "car_entrance",      # مدخل سيارة
    27: "parking",           # مواقف خاصة
    29: "private_entrance",  # مدخل مستقل
}
# Arabic feature labels for additional_info (full list, recognition-only).
FEATURE_LABELS = {
    1: "مياه حكومية", 2: "هاتف", 3: "انترنت", 4: "تكييف", 5: "تكييف", 6: "غاز مركزي",
    7: "مطبخ مجهز", 8: "ديكور حديث", 9: "مفروشة", 10: "ملحق خارجي", 11: "غرفة خادمة",
    12: "غرفة سائق", 13: "غرفة غسيل", 14: "مخزن", 15: "مصعد", 16: "مسبح", 17: "جاكوزي",
    18: "حوش", 19: "حديقة", 20: "مدخل سيارة", 21: "كاميرات مراقبة", 22: "يصلح سكن عزاب",
    23: "كهرباء", 24: "مسبح مشترك", 25: "نادي رياضي", 26: "حديقة خاصة", 27: "مواقف خاصة",
    28: "حارس أمن", 29: "مدخل مستقل", 30: "غرفة حارس", 31: "مسطح أخضر", 32: "بوفيه",
    33: "سكرتارية", 34: "غرفة اجتماعات", 35: "بهو استقبال", 36: "ميزانين", 37: "نظام حريق",
    38: "يقبل الترخيص", 39: "مطعم", 120: "صرف صحي",
}
# building_finish enum → English finish level (for additional_info).
FINISH_LABELS = {1: "Shell (عظم)", 2: "Commercial", 3: "Standard", 4: "Lux", 5: "Super Lux", 6: "Hi Lux"}
# street_sides direction enum → English.
DIRECTION_EN = {
    1: "North", 2: "South", 3: "East", 4: "West",
    5: "Northeast", 6: "Northwest", 7: "Southeast", 8: "Southwest",
}

# Phone / contact patterns to REDACT from title+description (PDPL).
_PHONE_RE = re.compile(
    r"(?:\+?9665\d{8}"
    r"|00966\d{9}"
    r"|9200\d{5,7}"
    r"|0?5\d{8}"
    r"|wa\.me/\S+"
    r"|واتس\S*\s*\d[\d\s\-]{6,})"
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")

_NUXT_RE = re.compile(r"window\.__NUXT__=", re.S)

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


def _int(v: Any) -> Optional[int]:
    if v in (None, "", "—", 0, "0"):
        return None
    n = normalize.to_int(v)
    return n if n else None


def _float(v: Any) -> Optional[float]:
    if v in (None, "", "—"):
        return None
    try:
        f = float(str(v).translate(normalize._TRANS))
        return f if f > 0 else None
    except (TypeError, ValueError):
        return None


def _select_area(property_type: str, offer: dict) -> Optional[float]:
    """Pick the right size field from the offer payload — BUILT/LIVING size (buildingArea) for
    non-land listings, LAND size (landArea) for land listings. A villa/house page can carry BOTH;
    the field the correct kind isn't in must never win (2026-07-28 audit: the old unconditional
    "landArea or buildingArea" order always stored the plot size for every property type)."""
    if property_type in LAND_TYPES:
        return _float(offer.get("landArea")) or _float(offer.get("buildingArea"))
    return _float(offer.get("buildingArea")) or _float(offer.get("landArea"))


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    t = _PHONE_LOOSE.sub(" ", text)
    t = _PHONE_RE.sub(" ", t)
    t = re.sub(r"للاتصال[^\n]*", " ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t or None


# ── NUXT IIFE → JSON via a one-shot Node subprocess per parse() call ──────────────
# WHY ONE-SHOT, NOT A PERSISTENT WORKER (2026-09-03): the prior design ran ONE persistent
# `node worker.js` process behind a custom length-prefixed stdin/stdout protocol
# (fs.readSync()-based) shared by all 8 fetch threads via a single lock. That was already known
# to be the deadlock root cause (a hung exchange blocked every thread forever — the reason
# muktamel never completed a full crawl since 2026-07-15). A first fix bounded the exchange with a
# watchdog timeout, which stopped the infinite hang — but a live re-test against real
# muktamel.com pages (scrapers/muktamel/diag_page_structure.py, evidence captured 2026-09-03)
# proved the SAME real payload succeeds in <35ms total (eval() 29ms + JSON.stringify() 2ms) when
# run as a plain one-shot `node -e` process reading all of stdin at once — yet the persistent
# worker's custom byte-level readN()/readLine() protocol reliably returned nothing for that exact
# payload. The eval/stringify logic was never the problem; the bespoke IPC protocol was. Rather
# than keep debugging a hand-rolled framing protocol, this replaces it with Python's own
# subprocess.run(..., timeout=...): each parse() spawns its OWN node process, feeds the NUXT
# source on stdin, reads JSON off stdout, and the stdlib reaps the child on exit or on
# TimeoutExpired's kill. This is also strictly safer against the original deadlock than a
# watchdog-timer patch: with no process and no lock SHARED across threads, one thread's slow or
# stuck node call can never block the other 7 — there is nothing left to share.
#
# This is NOT the "thousands of processes crashed the crawl" failure mode the old persistent-
# worker design was built to avoid: that incident came from spawning a fresh node process per
# RETRY inside an unbounded loop with no reaping. Here, concurrency is capped at WORKERS (8) by
# ThreadPoolExecutor, and subprocess.run() always waits() its child — on success, on non-zero
# exit, or on TimeoutExpired — so there is no orphan-process path.
NODE_PARSE_TIMEOUT = 20.0

_NODE_EVAL_JS = r"""
const fs = require('fs');
let outStr = "";
try {
  const body = fs.readFileSync(0, 'utf8');
  let src = body.replace(/^window\.__NUXT__=/, 'globalThis.__N=');
  globalThis.__N = undefined;
  (0, eval)(src);
  const N = globalThis.__N || {};
  const d0 = (N.data && N.data[0]) || {};
  const st = N.state || {};
  const out = {
    offer: d0.offer || null,
    initialPhotos: d0.offerInitialPhotos || [],
    lazyPhotos: d0.offerLazyPhotos || [],
    addressJson: st.addressJson || null,
  };
  outStr = JSON.stringify(out, (k, v) => v === undefined ? null : v);
} catch (e) { outStr = ""; }
process.stdout.write(outStr);
"""

_NODE_OK: Optional[bool] = None
_node_check_lock = threading.Lock()


def _node_available() -> bool:
    global _NODE_OK
    with _node_check_lock:
        if _NODE_OK is None:
            try:
                subprocess.run(["node", "--version"], capture_output=True, timeout=15, check=True)
                _NODE_OK = True
            except Exception:
                _NODE_OK = False
                print("⚠ node not found — muktamel needs node to parse the NUXT payload")
        return _NODE_OK


def _nuxt_via_node(nuxt_src: str) -> Optional[dict]:
    if not _node_available():
        return None
    try:
        r = subprocess.run(
            ["node", "-e", _NODE_EVAL_JS],
            input=nuxt_src.encode("utf-8"), capture_output=True, timeout=NODE_PARSE_TIMEOUT)
    except Exception:
        # Covers TimeoutExpired (subprocess.run already killed + reaped the child) and any other
        # spawn/IO failure — a single bad/slow listing is skipped, never fabricated as data.
        return None
    if not r.stdout:
        return None
    try:
        return json.loads(r.stdout.decode("utf-8", "replace"))
    except Exception:
        return None


def _extract_nuxt(html: str) -> Optional[str]:
    m = _NUXT_RE.search(html)
    if not m:
        return None
    sub = html[m.start():]
    end = sub.find("</script>")
    return sub[:end] if end > 0 else None


# ── Fetch outcome instrumentation ───────────────────────────────────────────────────
# WHY: a silent `return None` cannot tell "genuinely dead id" (fast 404, expected — ~52% of the
# range per the module docstring) apart from "every request is failing at the network layer"
# (the toor/jazwtn IP-block shape: curl_cffi raises on every attempt, never even reaching a status
# code). Reproduced live 2026-09-03: a fixed-and-completing 101-id run (post NODE_PARSE_TIMEOUT)
# still upserted 0 rows and took ~30 minutes — ~143s/id, matching 3×45s-timeout-with-retries
# almost exactly, which a dead-id range (fast 404s) could never produce. Without this counter that
# distinction is a guess; with it, main()'s summary line answers it directly. Same fix shape as
# erapulse (PR #1398): capture the last concrete reason instead of discarding it.
_outcome_lock = threading.Lock()
_outcomes: dict[str, int] = {}


def _note(reason: str) -> None:
    with _outcome_lock:
        _outcomes[reason] = _outcomes.get(reason, 0) + 1


# ── Fetch ─────────────────────────────────────────────────────────────────────────
def fetch_one(listing_id: int) -> Optional[tuple[int, dict]]:
    """Fetch + eval one listing id. Returns (id, parsed_nuxt) for LIVE listings, else None.
    Live == final URL not /404 AND offer.isAvailable truthy."""
    url = f"{BASE}/real-estates/{listing_id}"
    s = _session()
    html = None
    last_exc: Optional[BaseException] = None
    for attempt in range(3):
        try:
            r = s.get(url, timeout=45, allow_redirects=True)
        except Exception as e:
            last_exc = e
            time.sleep(1.0 * (attempt + 1))
            continue
        if r.status_code != 200:
            if r.status_code in (404, 410):
                _note("dead_404")
                return None
            last_exc = None
            _note(f"http_{r.status_code}")
            time.sleep(1.0 * (attempt + 1))
            continue
        if "/404" in str(r.url):
            _note("redirect_404")
            return None
        html = r.text
        break
    if not html:
        # Every attempt failed — record the LAST concrete reason, not just "no html". A network
        # exception (timeout/reset/refused) here on every id is the IP-block signature; an
        # accumulation of http_5xx is a different, source-side problem.
        _note(f"network_{type(last_exc).__name__}" if last_exc is not None else "no_html_after_retries")
        return None
    nuxt_src = _extract_nuxt(html)
    if not nuxt_src:
        _note("no_nuxt_payload")
        return None
    parsed = _nuxt_via_node(nuxt_src)
    if not parsed or not parsed.get("offer"):
        _note("unparseable_or_no_offer")
        return None
    offer = parsed["offer"]
    # Liveness gate: only fully-hydrated, available listings carry real data.
    if not offer.get("isAvailable") or offer.get("price") in (None, 0):
        _note("not_available_or_zero_price")
        return None
    _note("live")
    return listing_id, parsed


# ── Parse ───────────────────────────────────────────────────────────────────────
def _photo_urls(parsed: dict) -> list[str]:
    """Azure blob -md.jpg URLs, deduped by uuid, agency logos excluded."""
    seen: set[str] = set()
    out: list[str] = []
    offer = parsed.get("offer") or {}
    buckets = (parsed.get("initialPhotos") or []) + (offer.get("photos") or []) + (parsed.get("lazyPhotos") or [])
    for p in buckets:
        if not isinstance(p, dict):
            continue
        path = p.get("path") or ""
        uid = p.get("id") or ""
        if "/AgencyLogo/" in path:
            continue
        if not uid:
            m = re.search(r"/OffersImages/([0-9a-fA-F\-]{36})", path)
            uid = m.group(1) if m else ""
        if not uid or uid in seen:
            continue
        seen.add(uid)
        out.append(f"{BLOB}/{uid}-md.jpg")
    return out[:30]


def _resolve_location(offer: dict, addr_json: Optional[dict]) -> tuple[Optional[str], Optional[str], Optional[str], dict]:
    """Return (city_en, region_en, district_ar, raw_names) from the numeric address ids."""
    a = offer.get("address") or {}
    rid, cid, did = a.get("region"), a.get("city"), a.get("district")
    regions = (addr_json or {}).get("Regions") or {}
    cities = (addr_json or {}).get("Cities") or {}
    districts = (addr_json or {}).get("Districts") or {}
    region_ar = regions.get(str(rid)) or regions.get(rid)
    city_ar = cities.get(str(cid)) or cities.get(cid)
    district_ar = districts.get(str(did)) or districts.get(did)

    region_en = REGION_ID_EN.get(rid) if isinstance(rid, int) else None
    # City: the Cities dict mixes real city names with metro-zone labels ("شمال الرياض").
    # Try a direct map first; if that misses, derive from the region's anchor city.
    city_en = normalize.map_city(city_ar) if city_ar else None
    if not city_en and region_en:
        # zone labels like "شمال/غرب/شرق/وسط/جنوب الرياض" → the region's main city
        city_en = normalize.map_city(region_ar.replace("منطقة", "").strip()) if region_ar else None
    if not region_en and city_en:
        region_en = normalize.region_for_city(city_en)
    raw = {"region_ar": region_ar, "city_ar": city_ar, "district_ar": district_ar}
    return city_en or "Other", region_en, district_ar, raw


def map_listing(listing_id: int, parsed: dict) -> tuple[Optional[dict], str]:
    offer = parsed["offer"]
    deal = offer.get("dealType")
    if deal in AUCTION_DEAL_TYPES or offer.get("isAuction"):
        return None, "residential"  # skip auctions

    type_id = offer.get("type")
    mapped_type = TYPE_MAP.get(type_id)
    # Unmapped type → STORE the raw source enum id, never a guessed default (owner directive
    # 2026-07-16: never confidently misclassify — the raw value trips the DB novel-type detector,
    # which quarantines + alerts). The legacy value below feeds ONLY the routing/sanity rules.
    property_type = mapped_type or "Residential Land"  # type-truth: routing-legacy only — never stored
    is_rent = deal in RENT_DEAL_TYPES
    # Commercial routing: explicit commercial deal type (3/4) OR a commercial property type.
    is_com_deal = deal in (3, 4)
    category = "commercial" if (property_type in COMMERCIAL_TYPES or (is_com_deal and property_type == "Residential Land")) else "residential"
    if is_com_deal and property_type == "Residential Land":
        property_type = "Commercial Land"
    stored_property_type = property_type if mapped_type else (str(type_id) if type_id is not None else "unknown")

    # ── area ──
    area = _select_area(property_type, offer)

    # ── price ──
    price = _int(offer.get("price"))
    rent_period = None
    price_total = price_annual = price_per_meter = None
    if is_rent:
        # isRentPerYear True → annual, False → monthly. Muktamel stores rent as a single figure and
        # this flag is what says which period it is.
        # SOURCE IS TRUTH (owner rule, 2026-08-09): an ABSENT flag is not a monthly rental. The old
        # `"annual" if offer.get("isRentPerYear") else "monthly"` could not tell "the source says
        # False" from "the source did not say", so a listing whose payload simply omits the key was
        # labelled MONTHLY — and a monthly label makes the reader divide by 12. Absence is unknown.
        _per_year = offer.get("isRentPerYear")
        rent_period = None if _per_year is None else ("annual" if _per_year else "monthly")
        # ANNUALISE, like every other rent scraper in the fleet. `price_annual` is a CONTRACT: the
        # column holds a YEARLY figure, and src/data/listings.ts divides it by 12 for a row labelled
        # monthly. Storing the raw monthly figure here therefore showed the user 1/12 of the rent the
        # source published — 2,500/month rendered as ~208, a 75,000 showroom as 6,250.
        # This is the SAME defect aqarcity fixed on 2026-07-13 ("storing the raw monthly showed 1/12
        # of the real rent"); muktamel was the one rent scraper that never received it — it labelled
        # the period and skipped the conversion. annualize_rent() is the fleet's single implementation
        # and is period-driven, so it leaves an "annual" row alone and — per the SOURCE IS TRUTH note
        # above — leaves an UNKNOWN period's figure exactly as published, never guessing a period.
        price_annual = normalize.annualize_rent(price, rent_period)
    elif property_type in LAND_TYPES and price and price <= 100_000:
        # LAND: offer.price is the SAR-per-m² RATE, not a total. Store it as the rate and leave
        # price_total NULL — the source publishes no total here. The ≤100k guard only ROUTES the
        # number to the right column (no real per-m² land rate exceeds 100k, so a larger figure is
        # an absolute total); it never alters the value.
        # NOTE the missing `and area`: this branch must NOT depend on landArea. With it, a land row
        # lacking landArea fell through to the else and stored a per-m² RATE in price_total — a
        # worse breach than the one being removed.
        price_per_meter = price
    else:
        # Everything else: offer.price is the TOTAL. Deriving price_per_meter = price / area would
        # fabricate a rate the source never printed (listing-fidelity rule; aqar PR#216).
        price_total = price

    # ── location ──
    addr_json = parsed.get("addressJson")
    city, region, district_ar, raw = _resolve_location(offer, addr_json)

    # ── PDPL-safe text (NO advertiser name / phone) ──
    title = _redact(offer.get("title"))
    description = _redact(offer.get("description"))

    # ── REGA / agency (company only — never the advertiser person or phone) ──
    ga = offer.get("generalAuthority") or {}
    agency = offer.get("agency") or {}
    rega_ad_no = ga.get("adLicenseNumber") or offer.get("adLicenseNumber") or offer.get("authorizationNumber")
    # PDPL: store the agency name ONLY for COMPANIES (offices). For an INDIVIDUAL broker Muktamel
    # puts the broker's NATURAL-PERSON name in agency.name — storing that breaches PDPL — so we drop
    # it. A company is identified by a CR number OR an officialName, AND an /OfficesBroker/ licence
    # URL (individuals use /IndividualBroker/). A "مؤسسة …" establishment has a crNo and is allowed
    # even if its registered name contains a person's name. (PDPL audit: MK27517 leaked a person.)
    ad_license_url = ga.get("adLicenseURL") or ""
    is_company_agency = bool(agency.get("crNo") or agency.get("officialName")) and "/IndividualBroker/" not in ad_license_url
    agency_company_name = (agency.get("officialName") or agency.get("name")) if is_company_agency else None

    # ── streets (frontage) ──
    streets = offer.get("streets") or []
    direction = street_width = None
    streets_info = []
    for st in streets:
        if not isinstance(st, dict):
            continue
        d_en = DIRECTION_EN.get(st.get("direction"))
        w = _int(st.get("width"))
        if direction is None and d_en:
            direction = d_en
        if street_width is None and w:
            street_width = w
        streets_info.append({"direction": d_en, "width_m": w})

    # ── features → amenity columns + label list ──
    feat_ids = [f for f in (offer.get("features") or []) if isinstance(f, int)]
    amenities: dict[str, bool] = {}
    for fid in feat_ids:
        col = FEATURE_COLS.get(fid)
        if col:
            amenities[col] = True
    feature_labels = [FEATURE_LABELS.get(fid) for fid in feat_ids if FEATURE_LABELS.get(fid)]

    age = offer.get("age")
    property_age = 0 if age == 0 else (_int(age) if age not in (None,) else None)

    info: dict[str, Any] = {
        "rega_ad_license_number": rega_ad_no,
        "agency_name": agency_company_name,
        "agency_official_name": agency.get("officialName") if is_company_agency else None,
        "agency_license_number": agency.get("publisherNumber"),
        "agency_cr_number": agency.get("crNo"),
        "rega_plan_number": ga.get("planNumber"),
        "rega_land_number": ga.get("landNumber"),
        "rega_ad_creation_date": ga.get("creationDate"),
        "rega_offer_end_date": ga.get("offerEndDate"),
        "rega_ad_url": ad_license_url or None,
        "deed_location_text": _redact(ga.get("locationDescriptionOnMOJDeed")),
        "obligations": ga.get("obligationsOnTheProperty"),
        "guarantees": ga.get("guaranteesAndTheirDuration") or None,
        "finish_level": FINISH_LABELS.get(offer.get("finishing")),
        "floors_count": _int(offer.get("floorsCount")),
        "floor_no": offer.get("floorNo"),
        "kitchens": None,
        "amenities": feature_labels or None,
        "streets": streets_info or None,
        "category_ar": None,
        "deal_type_id": deal,
        "type_id": offer.get("type"),
        "city_ar": raw["city_ar"],
        "region_ar": raw["region_ar"],
        "district_ar": raw["district_ar"],
        "created_date": offer.get("createDate"),
        "updated_date": offer.get("lastUpdateDate"),
        "publisher_type": offer.get("publisherType"),
        "is_rent_per_year": offer.get("isRentPerYear"),
        "video_link": offer.get("videoLink"),
        "vtour_link": offer.get("vTourLink"),
    }
    info = {k: v for k, v in info.items() if v not in (None, "", [], {})}

    def _date(s: Optional[str]) -> Optional[str]:
        if not s or str(s).startswith("0001"):
            return None
        return s

    row: dict[str, Any] = {
        "ad_number": f"MK{listing_id}",
        "listing_url": f"{BASE}/real-estates/{listing_id}",
        "source": "Muktamel",
        "active": True,
        "property_type": stored_property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": round(area) if area else None,
        "bedrooms": _int(offer.get("bedRoomsCount")) if category == "residential" else None,
        "bathrooms": _int(offer.get("bathroomsCount")),
        "halls": _int(offer.get("hallsCount")),
        "reception_rooms_majlis": _int(offer.get("otherRoomsCount")),
        "property_age": property_age,
        "direction": direction,
        "street_width_m": street_width,
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": price_per_meter,
        "rent_period": rent_period,
        "city": city,
        "region": region,
        "neighborhood": district_ar,
        "rega_location_verified": bool(rega_ad_no),
        "title": title,
        "description": description,
        "photo_urls": _photo_urls(parsed),
        "video_url": offer.get("videoLink") or None,
        "date_added": _date(offer.get("createDate")),
        "last_update": _date(offer.get("lastUpdateDate")),
        "additional_info": info,
    }
    row.update(amenities)
    return row, category


def shard_ids(min_id: int, max_id: int, shards: int, shard: int) -> list[int]:
    """The id slice one shard owns: `id % shards == shard`, inclusive of both ends.

    Pulled out of main() so the partition properties (every id owned by exactly one shard, no id
    owned by two, the union is the complete range) are directly testable without invoking the CLI.
    Must agree with db._ad_shard(f"MK{{id}}", shards) — prune_unseen's shards= guard applies that
    function to ad_number, and a disagreement here would mean a shard prunes ids it never fetched
    or leaves ids it did fetch unprotected. scrapers/common/tests/test_muktamel_shard_partition.py
    pins the agreement directly.
    """
    if shards <= 1:
        return list(range(min_id, max_id + 1))
    return [i for i in range(min_id, max_id + 1) if i % shards == shard]


# ── Main ────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: upsert only the first N LIVE listings, NO prune")
    ap.add_argument("--min-id", type=int, default=MIN_ID_DEFAULT)
    ap.add_argument("--max-id", type=int, default=MAX_ID_DEFAULT)
    ap.add_argument("--shards", type=int, default=1,
                     help="split the id range across N parallel crawls (same convention as dealapp)")
    ap.add_argument("--shard", type=int, default=0,
                     help="which shard this process owns, 0..shards-1")
    args = ap.parse_args()
    if not (0 <= args.shard < max(1, args.shards)):
        ap.error(f"--shard must be in 0..{max(0, args.shards - 1)} for --shards {args.shards}")

    ids = shard_ids(args.min_id, args.max_id, args.shards, args.shard)
    print(f"Muktamel: sweeping ids {args.min_id}..{args.max_id}"
          f"{f' shard {args.shard}/{args.shards}' if args.shards > 1 else ''} "
          f"({len(ids)} candidates, {WORKERS} workers)"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

    run_id = None if args.limit else db.begin_run("muktamel")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        res_buf: list[dict] = []
        com_buf: list[dict] = []

        def flush() -> None:
            nonlocal res_buf, com_buf
            if res_buf:
                db.upsert_muktamel_residential_batch(res_buf)
                res_buf = []
            if com_buf:
                db.upsert_muktamel_commercial_batch(com_buf)
                com_buf = []

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for result in ex.map(fetch_one, ids):
                if not result:
                    continue
                lid, parsed = result
                row, cat = map_listing(lid, parsed)
                if not row:
                    continue
                if args.type != "all" and cat != args.type:
                    continue
                (com_buf if cat == "commercial" else res_buf).append(row)
                (com if cat == "commercial" else res).append(row)
                seen += 1
                if len(res_buf) + len(com_buf) >= 200:
                    flush()
                    print(f"  …{seen} live upserted", flush=True)
                if args.limit and seen >= args.limit:
                    break
        flush()

        if args.limit:
            print(f"✓ Muktamel VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            for r in (res + com)[:8]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "price_total", "price_annual", "rent_period")})
                print("     photo:", (r["photo_urls"] or ["(none)"])[0])
            return 0

        # Full run: prune ids that were active before but weren't seen this crawl. shards/shard are
        # passed through so a shard only ever ages out ids it owns (db._ad_shard applied to
        # ad_number="MK<id>" extracts the same <id> this crawl sharded on, by construction above) --
        # a blocked or slow shard therefore prunes nothing outside its own slice, exactly like dealapp.
        pruned = 0
        for tbl, rows_seen in (("muktamel_residential_listings", res),
                               ("muktamel_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Muktamel",
                                 shards=args.shards, shard=args.shard)
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Muktamel: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        print(f"  fetch outcomes: {dict(sorted(_outcomes.items(), key=lambda kv: -kv[1]))}", flush=True)
        healthy = db.end_run(
            run_id, ok=True, rows_seen=seen, rows_upserted=seen,
            notes=f"pruned={pruned} outcomes={dict(sorted(_outcomes.items(), key=lambda kv: -kv[1]))}"[:300],
            check_tables=["muktamel_residential_listings", "muktamel_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI instead of a silent success.", flush=True)
        return 0 if healthy else 1
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
