"""Muktamel (muktamel.com / مكتمل) scraper — Saudi Nuxt 2 SSR site, sequential-ID sweep.

مكتمل is a REGA-integrated Saudi property marketplace. There is NO usable public JSON API and the
sitemap is stale, so we enumerate listings by sequential ID: GET /real-estates/<id> for every id in
a range and parse the server-rendered page. Active ids span ~100..31000 at ~48% density (~15k live).

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
import tempfile
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


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    t = _PHONE_LOOSE.sub(" ", text)
    t = _PHONE_RE.sub(" ", t)
    t = re.sub(r"للاتصال[^\n]*", " ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t or None


# ── NUXT IIFE → JSON via Node subprocess (with pure-Python fallback) ──────────────
# ONE long-lived Node worker parses EVERY payload over a pipe — we do NOT fork node per listing.
# The old per-listing `node helper payload.js` approach spawned thousands of processes at 8-way
# concurrency, piled up orphan node procs, and crashed the full crawl (exit 144). This worker reads
# length-prefixed NUXT sources from stdin and writes length-prefixed JSON back; the Python side
# serialises the (microsecond) parse step behind a lock while fetches stay fully concurrent.
_NODE_WORKER_JS = r"""
const fs = require('fs');
function readN(n){
  const buf = Buffer.alloc(n); let off = 0;
  while (off < n){
    let r;
    try { r = fs.readSync(0, buf, off, n - off, null); }
    catch (e){ if (e.code === 'EAGAIN') { continue; } if (e.code === 'EOF') return null; throw e; }
    if (r === 0) return null;
    off += r;
  }
  return buf;
}
function readLine(){
  const bytes = [];
  while (true){
    const b = readN(1);
    if (b === null) return null;
    if (b[0] === 10) break;
    bytes.push(b[0]);
  }
  return Buffer.from(bytes).toString('utf8');
}
function emit(s){
  const ob = Buffer.from(s, 'utf8');
  process.stdout.write(ob.length + "\n");
  if (ob.length) process.stdout.write(ob);
}
while (true){
  const header = readLine();
  if (header === null) break;
  const len = parseInt(header, 10);
  if (!(len > 0)){ emit(""); continue; }
  const body = readN(len);
  if (body === null) break;
  let outStr = "";
  try {
    let src = body.toString('utf8').replace(/^window\.__NUXT__=/, 'globalThis.__N=');
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
  emit(outStr);
}
"""
_HELPER_PATH: Optional[str] = None
_NODE_OK: Optional[bool] = None
_helper_lock = threading.Lock()


def _ensure_helper() -> Optional[str]:
    global _HELPER_PATH, _NODE_OK
    with _helper_lock:
        if _NODE_OK is False:
            return None
        if _HELPER_PATH:
            return _HELPER_PATH
        try:
            subprocess.run(["node", "--version"], capture_output=True, timeout=15, check=True)
        except Exception:
            _NODE_OK = False
            print("⚠ node not found — muktamel needs node to parse the NUXT payload")
            return None
        fd, path = tempfile.mkstemp(suffix=".js", prefix="muktamel_worker_")
        with os.fdopen(fd, "w") as f:
            f.write(_NODE_WORKER_JS)
        _HELPER_PATH = path
        _NODE_OK = True
        return path


class _NodeWorker:
    """A single persistent `node worker.js` process. parse() is thread-safe (one lock-guarded
    request/response per call) and self-heals: if the worker dies it is respawned on the next call."""

    def __init__(self, helper_path: str):
        self.helper = helper_path
        self.lock = threading.Lock()
        self.proc: Optional[subprocess.Popen] = None
        self._spawn()

    def _spawn(self) -> None:
        self.proc = subprocess.Popen(
            ["node", self.helper], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, bufsize=0)

    def _write_all(self, b: bytes) -> None:
        # bufsize=0 → raw FileIO.write() can do a PARTIAL write (returns bytes written) for payloads
        # larger than the OS pipe buffer (~64KB). NUXT sources are 50-150KB, so we MUST loop or the
        # node worker waits forever for bytes that were never sent → deadlock on the first big listing.
        mv = memoryview(b)
        while mv:
            n = self.proc.stdin.write(mv)
            if not n:
                continue
            mv = mv[n:]

    def _read_line(self) -> Optional[bytes]:
        out = bytearray()
        while True:
            ch = self.proc.stdout.read(1)
            if not ch:
                return None
            if ch == b"\n":
                return bytes(out)
            out += ch

    def _read_exact(self, n: int) -> Optional[bytes]:
        buf = bytearray()
        while len(buf) < n:
            chunk = self.proc.stdout.read(n - len(buf))
            if not chunk:
                return None
            buf.extend(chunk)
        return bytes(buf)

    def parse(self, nuxt_src: str) -> Optional[dict]:
        data = nuxt_src.encode("utf-8")
        with self.lock:
            for _ in range(2):  # one retry: respawn a dead worker and try again
                if self.proc is None or self.proc.poll() is not None:
                    self._spawn()
                try:
                    self._write_all(f"{len(data)}\n".encode("ascii"))
                    self._write_all(data)
                    self.proc.stdin.flush()
                    header = self._read_line()
                    if header is None:
                        raise IOError("worker closed")
                    n = int(header.strip() or b"0")
                    if n <= 0:
                        return None
                    out = self._read_exact(n)
                    return json.loads(out.decode("utf-8", "replace")) if out else None
                except Exception:
                    try:
                        self.proc.kill()
                    except Exception:
                        pass
                    self.proc = None
            return None

    def close(self) -> None:
        try:
            self.proc.stdin.close()
            self.proc.terminate()
        except Exception:
            pass


_node_singleton: Optional[_NodeWorker] = None
_node_init_lock = threading.Lock()


def _get_worker() -> Optional[_NodeWorker]:
    global _node_singleton
    if _node_singleton is not None:
        return _node_singleton
    with _node_init_lock:
        if _node_singleton is not None:
            return _node_singleton
        helper = _ensure_helper()
        if not helper:
            return None
        import atexit
        _node_singleton = _NodeWorker(helper)
        atexit.register(_node_singleton.close)
        return _node_singleton


def _nuxt_via_node(nuxt_src: str) -> Optional[dict]:
    w = _get_worker()
    return w.parse(nuxt_src) if w else None


def _extract_nuxt(html: str) -> Optional[str]:
    m = _NUXT_RE.search(html)
    if not m:
        return None
    sub = html[m.start():]
    end = sub.find("</script>")
    return sub[:end] if end > 0 else None


# ── Fetch ─────────────────────────────────────────────────────────────────────────
def fetch_one(listing_id: int) -> Optional[tuple[int, dict]]:
    """Fetch + eval one listing id. Returns (id, parsed_nuxt) for LIVE listings, else None.
    Live == final URL not /404 AND offer.isAvailable truthy."""
    url = f"{BASE}/real-estates/{listing_id}"
    s = _session()
    html = None
    for attempt in range(3):
        try:
            r = s.get(url, timeout=45, allow_redirects=True)
        except Exception:
            time.sleep(1.0 * (attempt + 1))
            continue
        if r.status_code != 200:
            if r.status_code in (404, 410):
                return None
            time.sleep(1.0 * (attempt + 1))
            continue
        if "/404" in str(r.url):
            return None
        html = r.text
        break
    if not html:
        return None
    nuxt_src = _extract_nuxt(html)
    if not nuxt_src:
        return None
    parsed = _nuxt_via_node(nuxt_src)
    if not parsed or not parsed.get("offer"):
        return None
    offer = parsed["offer"]
    # Liveness gate: only fully-hydrated, available listings carry real data.
    if not offer.get("isAvailable") or offer.get("price") in (None, 0):
        return None
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

    property_type = TYPE_MAP.get(offer.get("type")) or "Residential Land"
    is_rent = deal in RENT_DEAL_TYPES
    # Commercial routing: explicit commercial deal type (3/4) OR a commercial property type.
    is_com_deal = deal in (3, 4)
    category = "commercial" if (property_type in COMMERCIAL_TYPES or (is_com_deal and property_type == "Residential Land")) else "residential"
    if is_com_deal and property_type == "Residential Land":
        property_type = "Commercial Land"

    # ── area ──
    area = _float(offer.get("landArea")) or _float(offer.get("buildingArea"))

    # ── price ──
    price = _int(offer.get("price"))
    rent_period = None
    price_total = price_annual = price_per_meter = None
    if is_rent:
        # isRentPerYear True → annual; otherwise the per-listing price is the period price. Muktamel
        # stores rent as a single figure; treat per-year as annual, else flag monthly.
        rent_period = "annual" if offer.get("isRentPerYear") else "monthly"
        price_annual = price
    elif property_type in LAND_TYPES and price and area and price <= 100_000:
        # LAND: offer.price is the SAR-per-m² RATE, not the total — compute total = rate × area.
        # The ≤100k guard skips the rare land row that already carries an absolute total (no real
        # per-m² land rate exceeds 100k), so we never multiply a total by the area. (PDPL/price audit.)
        price_per_meter = price
        price_total = round(price * area)
    else:
        price_total = price
        if price and area:
            price_per_meter = round(price / area)

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
        "property_type": property_type,
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


# ── Main ────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: upsert only the first N LIVE listings, NO prune")
    ap.add_argument("--min-id", type=int, default=MIN_ID_DEFAULT)
    ap.add_argument("--max-id", type=int, default=MAX_ID_DEFAULT)
    args = ap.parse_args()

    ids = list(range(args.min_id, args.max_id + 1))
    print(f"Muktamel: sweeping ids {args.min_id}..{args.max_id} ({len(ids)} candidates, {WORKERS} workers)"
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

        # Full run: prune ids that were active before but weren't seen this crawl.
        pruned = 0
        c = db.sb()
        for tbl, rows_seen in (("muktamel_residential_listings", res),
                               ("muktamel_commercial_listings", com)):
            seen_ads = {r["ad_number"] for r in rows_seen}
            existing = (c.table(tbl).select("ad_number").eq("source", "Muktamel")
                        .eq("active", True).execute().data) or []
            gone = [r["ad_number"] for r in existing if r["ad_number"] not in seen_ads]
            for i in range(0, len(gone), 200):
                c.table(tbl).update({"active": False}).in_("ad_number", gone[i:i + 200]).execute()
            pruned += len(gone)
        print(f"✓ Muktamel: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"pruned={pruned}")
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
