"""Era Pulse (erapulse.sa → api.erapulse.sa) scraper — Saudi Vite/React SPA + JSON API.

نبض العصر / Era Pulse is a FAL-licensed Buraydah / Qassim real-estate brokerage. The site claims
"800+ deals", but the LIVE public catalog served by the API is far smaller — ~50 ACTIVE listings
(measured June 2026), overwhelmingly Buraydah + the rest of Qassim (Unaizah, Al Bassr, …). Saudi-
owned + FAL-licensed → passes the Saudi-only rule. No auth, no proxy, cloud-friendly.

Data path (auth-free JSON, same-origin XHR the SPA itself makes):
  LIST  GET https://api.erapulse.sa/api/v1/properties?page=N&limit=50
        → {success, data:[property…], pagination:{total,page,limit,totalPages,hasNext,hasPrev}}.
  The list item IS already the full record — the detail endpoint /properties/{id} adds only
  features/statistics, nothing we store. So we page the list to hasNext=false and never fetch detail.

Each property (English enums, already-normalized fields):
  id (cuid), refNumber ("REF-…"), slug, urlPath, title, description,
  type RESIDENTIAL|LAND|COMMERCIAL, subType (BUILDING|VILLA|DUPLEX|APARTMENT|LAND|SHOWROOM|HALL|…),
  usage RESIDENTIAL|COMMERCIAL|MIXED|null, status ACTIVE,
  isForSale/isForRent + salePrice / rentPrice + rentPeriod (ANNUAL), currency SAR,
  area, bedrooms, bathrooms, floors, age, streetWidth, parkingSpaces,
  furnished/balcony/garden/pool/gym/security/elevator/hasBasement (booleans),
  location (free-text Arabic: "شارع …, حي <hood>, مدينة <city>, منطقة القصيم"), googleMapsUrl,
  images[{url,thumbnailUrl}] (relative → prefixed with the API origin).

TYPE: subType (English) → canonical via SUBTYPE_MAP. LAND routes Residential vs Commercial by
  `usage` (COMMERCIAL/MIXED → Commercial Land). DEAL: isForRent → Rent else Buy.
LOCATION: parsed out of the free-text `location` — "مدينة <X>" → city, "حي <X>" → neighborhood,
  "منطقة القصيم" → region; default region Qassim (this is a Qassim brokerage). Raw-coordinate or
  bare-neighborhood locations fall back to Buraidah/Qassim only when the hood is a known Qassim one.

⛔⛔ PDPL ABSOLUTE — the API EXPOSES advertiser PII we MUST NEVER persist:
  • metadata.contactInfo.{contactName, contactPhone, whatsappNumber, contactEmail} → NEVER read.
  • user.name ("زائر (Guest)") / userId / moderatedBy → NEVER stored.
  We also REDACT any 05x / +9665 / 9200 / 920 / wa.me / واتساب phone from title + description and
  TRUNCATE the description at any broker/contact marker. Registered company names are allowed.

Usage:  python -m scrapers.erapulse.run [--type residential|commercial|all] [--limit N]
"""
from __future__ import annotations

import argparse
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

SITE = "https://erapulse.sa"
API = "https://api.erapulse.sa"
LIST_URL = f"{API}/api/v1/properties"
PAGE_SIZE = 50
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.25"))
SOURCE = "Era Pulse"

# Era Pulse subType (English enum) → our canonical taxonomy.
SUBTYPE_MAP = {
    "VILLA": "Villa", "DUPLEX": "Villa", "PALACE": "Villa",
    "APARTMENT": "Apartment", "STUDIO": "Apartment",
    "FLOOR": "Floor", "ROOF": "Floor",
    "BUILDING": "Building", "RESIDENTIAL_BUILDING": "Building",
    "HOUSE": "House", "FOLK_HOUSE": "House",
    "ROOM": "Room",
    "REST_HOUSE": "Rest House", "RESTHOUSE": "Rest House",
    "CHALET": "Chalet", "FARM": "Farm", "CAMP": "Camp",
    "LAND": "Residential Land", "RAW_LAND": "Residential Land", "RESIDENTIAL_LAND": "Residential Land",
    "RESIDENTIAL": "Apartment", "OTHER_RESIDENTIAL": "Apartment",
    # commercial subtypes
    "OFFICE": "Office", "SHOP": "Shop", "STORE": "Shop", "SHOWROOM": "Showroom",
    "WAREHOUSE": "Warehouse", "WORKSHOP": "Workshop", "FACTORY": "Factory",
    "HOTEL": "Hotel", "GAS_STATION": "Gas Station", "STATION": "Gas Station",
    "COMMERCIAL_BUILDING": "Commercial Building", "TOWER": "Commercial Building",
    "MALL": "Commercial Building", "COMPLEX": "Commercial Building",
    "HALL": "Hall", "COMMERCIAL_LAND": "Commercial Land",
    "COMMERCIAL": "Office", "OTHER_COMMERCIAL": "Office",
}
COMMERCIAL_TYPES = {
    "Office", "Shop", "Showroom", "Warehouse", "Workshop", "Factory", "Hotel",
    "Gas Station", "Commercial Building", "Commercial Land", "Hall",
}

# Free-text location words → canonical Qassim cities (the brokerage is Qassim-only). Used when the
# location has no "مدينة <X>" token but names a known Qassim place. map_city handles the rest.
QASSIM_CITY_WORDS = {
    "بريدة": "Buraidah", "بريده": "Buraidah", "عنيزة": "Unaizah", "عنيزه": "Unaizah",
    "الرس": "Ar Rass", "البكيرية": "Al Bukayriyah", "المذنب": "Al Mithnab", "البدائع": "Al Badai",
    "رياض الخبراء": "Riyadh Al Khabra", "النبهانية": "An Nabhaniyah", "النبهانبة": "An Nabhaniyah",
    "الشماسية": "Ash Shamasiyah", "البصر": "Buraidah", "القوارة": "Buraidah",
}

# PDPL phone / contact battery (copied + hardened from aqaratikom / semsar).
_PHONE_RE = re.compile(
    r"(?:\+?00?966\d{8,9}"
    r"|\b966\d{8,9}\b"
    r"|0?5\d(?:[\s\.\-]?\d){7}"
    r"|\b9200\d{4,6}\b"
    r"|\b920\d{6}\b"
    r"|\b800\d{7}\b"
    r"|wa\.me/\S+"
    r"|واتس\S*\s*\d[\d\s\-]{6,})"
)
_PHONE_LOOSE = re.compile(r"[\(\[\{«]{1,3}\s*0?5[\d\s\.\-]{7,}\s*[\)\]\}»]{1,3}")
# Leetspeak o5o / O5O → digit run, so the phone regexes then catch it.
_OBFUSC_RUN_RE = re.compile(r"[oO0-9٠-٩][oO0-9٠-٩\s.\-]{6,}[oO0-9٠-٩]")
_COMPANY_RE = re.compile(r"^\s*(شركة|مؤسسة|مكتب|مجموعة|company|est\.?|corp)\b", re.I)
# Broker / owner / contact markers — truncate the description at the first one (PDPL).
_CUT_MARKERS = (
    "الوسيط العقاري", "المسوق العقاري", "اسم المعلن", "اسم المالك", "المالك", "المعلن",
    "للتواصل", "للحجز", "للاستفسار", "للاتصال", "التواصل", "تواصل معنا", "اتصل", "جوال",
    "واتساب", "واتس اب", "الواتس", "whatsapp", "ادارة التأجير", "إدارة التأجير", "للبيع والتواصل",
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
        "Origin": SITE,
        "Referer": f"{SITE}/",
    })
    return s


def _int(v: Any) -> Optional[int]:
    n = N.to_int(v)
    return n if n else None


def _deobfusc(text: str) -> str:
    """Turn 'o5o 298 1000' style runs into digits so _PHONE_RE can redact them."""
    def repl(m: "re.Match[str]") -> str:
        run = m.group(0)
        digits = run.replace("o", "0").replace("O", "0")
        return digits if sum(c.isdigit() for c in digits) >= 8 else run
    return _OBFUSC_RUN_RE.sub(repl, text)


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    t = _deobfusc(text)
    t = _PHONE_LOOSE.sub(" ", t)
    t = _PHONE_RE.sub(" ", t)
    # Truncate at the first broker/owner/contact marker — everything after is attribution that can
    # carry an individual person's name or phone.
    cut = len(t)
    for m in _CUT_MARKERS:
        i = t.find(m)
        if i != -1:
            cut = min(cut, i)
    t = t[:cut]
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    t = re.sub(r"[\s*_\-]+$", "", t)
    return t.strip() or None


def _company_or_none(name: Optional[str]) -> Optional[str]:
    if not name or not isinstance(name, str):
        return None
    name = name.strip()
    return name if _COMPANY_RE.match(name) else None


# ── Location parsing ────────────────────────────────────────────────────────────
_HOOD_RE = re.compile(r"حي\s+([^,،]+)")
_CITY_RE = re.compile(r"مدينة\s+([^,،]+)")
_REGION_RE = re.compile(r"منطقة\s+([^,،]+)")


def parse_location(
    loc: Optional[str], hood_city: Optional[dict[str, str]] = None
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Return (city, region, neighborhood) from Era Pulse's free-text Arabic `location`.

    `hood_city` (built in main() from the crawl's own full-address rows) lets a bare-neighborhood
    entry like "حي الغروب" inherit the city the SAME dataset ties that neighborhood to (e.g. الربوة,
    النهضة, الأخضر … all resolve to بريدة elsewhere in the feed). This is data-driven, not a guess."""
    if not loc or not isinstance(loc, str):
        return None, "Qassim", None
    loc = loc.strip()
    # Raw coordinates / lat-long blobs carry no place name.
    if re.fullmatch(r"[\d°'\".,N E+\-\s]+", loc):
        return None, "Qassim", None

    city = region = neighborhood = None
    m = _CITY_RE.search(loc)
    if m:
        raw_city = m.group(1).strip()
        city = N.map_city(raw_city) or QASSIM_CITY_WORDS.get(raw_city)
    m = _HOOD_RE.search(loc)
    if m:
        neighborhood = m.group(1).strip() or None
    m = _REGION_RE.search(loc)
    if m:
        rr = m.group(1).strip()
        region = {"القصيم": "Qassim"}.get(rr) or N.region_for_city(N.map_city(rr) or "")

    # No explicit "مدينة" — try to recognise a Qassim city anywhere in the string.
    if not city:
        for word, eng in QASSIM_CITY_WORDS.items():
            if word in loc:
                city = eng
                break
    # Still no city but we know this neighborhood from a full-address row in the same crawl.
    if not city and neighborhood and hood_city:
        city = hood_city.get(neighborhood)
    if region is None:
        region = N.region_for_city(city) or "Qassim"
    return city, region, neighborhood


def build_hood_city_index(items: list[dict]) -> dict[str, str]:
    """From the listings that carry an explicit "مدينة <X>", map each "حي <hood>" → canonical city.
    Bare-neighborhood listings later inherit a city from this same-crawl index."""
    idx: dict[str, str] = {}
    for p in items:
        loc = p.get("location")
        if not isinstance(loc, str):
            continue
        cm = _CITY_RE.search(loc)
        hm = _HOOD_RE.search(loc)
        if not (cm and hm):
            continue
        raw_city = cm.group(1).strip()
        city = N.map_city(raw_city) or QASSIM_CITY_WORDS.get(raw_city)
        hood = hm.group(1).strip()
        if city and hood and hood not in idx:
            idx[hood] = city
    return idx


# ── Photos ──────────────────────────────────────────────────────────────────────
def _photos(p: dict) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    BAD = ("placeholder", "no-image", "noimage", "default", "logo", "avatar")
    for im in p.get("images") or []:
        if not isinstance(im, dict):
            continue
        url = im.get("url") or im.get("thumbnailUrl")
        if not isinstance(url, str) or not url:
            continue
        if url.startswith("/"):
            url = API + url
        if not url.startswith("http") or any(b in url.lower() for b in BAD) or url in seen:
            continue
        seen.add(url)
        out.append(url)
    return out[:25]


# ── Mapping ────────────────────────────────────────────────────────────────────
def map_listing(p: dict, hood_city: Optional[dict[str, str]] = None) -> tuple[Optional[dict], str]:
    ref = p.get("refNumber") or p.get("id")
    if not ref:
        return None, "residential"
    if (p.get("status") or "ACTIVE").upper() != "ACTIVE" or p.get("deletedAt"):
        return None, "residential"

    # ── type + category ──
    subtype = (p.get("subType") or "").strip().upper()
    top = (p.get("type") or "").strip().upper()
    usage = (p.get("usage") or "").strip().upper()
    property_type = SUBTYPE_MAP.get(subtype)
    if not property_type:
        # fall back on top-level type
        property_type = {"LAND": "Residential Land", "COMMERCIAL": "Office",
                         "RESIDENTIAL": "Apartment"}.get(top)
    if not property_type:
        return None, "residential"
    # Land usage routing: a commercial/mixed-use plot is a Commercial Land.
    if property_type == "Residential Land" and usage in ("COMMERCIAL", "MIXED"):
        property_type = "Commercial Land"
    elif property_type == "Building" and usage in ("COMMERCIAL", "MIXED"):
        property_type = "Commercial Building"
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"

    # ── deal + price ──
    is_rent = bool(p.get("isForRent")) and not bool(p.get("isForSale"))
    sale = _int(p.get("salePrice")) or _int(p.get("askingPrice"))
    rent = _int(p.get("rentPrice"))
    price = rent if is_rent else sale
    if not price or price < 500:
        return None, category

    area = _int(p.get("area"))
    ppm = None
    if area and not is_rent and sale:
        ppm = round(sale / area) if area else None

    # ── faceted fields ──
    bedrooms = _int(p.get("bedrooms")) if category == "residential" else None
    if bedrooms and not (0 < bedrooms <= 30):
        bedrooms = None
    bathrooms = _int(p.get("bathrooms"))
    age = _int(p.get("age"))
    street_w = _int(p.get("streetWidth"))
    parking = bool(p.get("parkingSpaces")) or None

    # ── location ──
    city, region, neighborhood = parse_location(p.get("location"), hood_city)

    # ── PDPL-safe text ──
    title = _redact(p.get("title")) or None
    description = _redact(p.get("description"))

    # ── extra amenity / spec flags into additional_info (no dedicated columns) ──
    info: dict[str, Any] = {
        "source_id": str(p.get("id")),
        "ref_number": ref,
        "subtype": subtype or None,
        "usage": usage or None,
        "furnished": bool(p.get("furnished")) or None,
        "pool": bool(p.get("pool")) or None,
        "gym": bool(p.get("gym")) or None,
        "garden": bool(p.get("garden")) or None,
        "security": bool(p.get("security")) or None,
        "basement": bool(p.get("hasBasement")) or None,
        "floors": _int(p.get("floors")),
        "bank_finance_accepted": bool(p.get("isBankFinanceAccepted")) or None,
        "is_featured": bool(p.get("isFeatured")) or None,
        "location_text": (p.get("location") or "").strip() or None,
        # company name only (PDPL): user.name is "زائر (Guest)" — never a real person here, but pass
        # it through the company gate so it's only ever stored if it's a registered org.
        "advertiser_company": _company_or_none((p.get("user") or {}).get("name")),
    }
    info = {k: v for k, v in info.items() if v not in (None, "", [], False)}

    ad_number = "ERP" + re.sub(r"[^A-Za-z0-9]", "", str(ref))[:24]
    slug = p.get("slug")
    listing_url = f"{SITE}/property/{slug}" if slug else f"{SITE}/properties/{p.get('id')}"

    row: dict[str, Any] = {
        "ad_number": ad_number,
        "listing_url": listing_url,
        "source": SOURCE,
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": area,
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "property_age": age,
        "street_width_m": street_w,
        "parking": parking,
        "balcony_terrace": bool(p.get("balcony")) or None,
        "elevator": bool(p.get("elevator")) or None,
        "price_total": price if not is_rent else None,
        "price_annual": price if is_rent else None,
        "price_per_meter": ppm,
        "rent_period": "annual" if is_rent else None,
        "city": city,
        "region": region,
        "neighborhood": neighborhood,
        "title": title,
        "description": description,
        "photo_urls": _photos(p),
        "rega_location_verified": False,
        "additional_info": info,
    }
    return row, category


# ── Fetch ────────────────────────────────────────────────────────────────────────
def fetch_page(s: cc.Session, page: int) -> tuple[list[dict], dict]:
    _throttle()
    for attempt in range(3):
        try:
            r = s.get(LIST_URL, params={"page": page, "limit": PAGE_SIZE}, timeout=30)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code != 200:
            time.sleep(2 * (attempt + 1)); continue
        try:
            j = r.json()
        except Exception:
            return [], {}
        return (j.get("data") or []), (j.get("pagination") or {})
    return [], {}


# ── Main ────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0,
                    help="validation run: upsert only the first N parsed listings, NO prune")
    args = ap.parse_args()

    s = session()
    first, pag = fetch_page(s, 1)
    if not first:
        print("✗ Era Pulse: list endpoint returned no properties")
        return 1
    total = pag.get("total")
    pages = pag.get("totalPages") or 1
    print(f"Era Pulse: {total} active listings across {pages} pages"
          f"{' [LIMIT ' + str(args.limit) + ']' if args.limit else ''}")

    # Pull the FULL catalog first (it's tiny) so the hood→city index is complete before mapping —
    # this lets bare-neighborhood entries inherit the right city even on a --limit validation run.
    catalog: list[dict] = list(first)
    page = 1
    while pag.get("hasNext") and page < pages:
        page += 1
        more, pag = fetch_page(s, page)
        if not more:
            break
        catalog += more

    hood_city = build_hood_city_index(catalog)

    run_id = None if args.limit else db.begin_run("erapulse")
    res: list[dict] = []
    com: list[dict] = []
    seen = 0
    try:
        for p in catalog:
            row, cat = map_listing(p, hood_city)
            if not row:
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            seen += 1
            if args.limit and seen >= args.limit:
                break

        # de-dup by ad_number (safety)
        def dedup(rows: list[dict]) -> list[dict]:
            out: dict[str, dict] = {}
            for r in rows:
                out[r["ad_number"]] = r
            return list(out.values())
        res, com = dedup(res), dedup(com)

        if res:
            db.upsert_erapulse_residential_batch(res)
        if com:
            db.upsert_erapulse_commercial_batch(com)

        if args.limit:
            print(f"✓ Era Pulse VALIDATION: {len(res)} residential + {len(com)} commercial upserted (no prune)")
            for r in (res + com)[:6]:
                print("  ", {k: r.get(k) for k in (
                    "ad_number", "property_type", "transaction_type", "city", "region",
                    "neighborhood", "area_m2", "bedrooms", "bathrooms", "price_total",
                    "price_annual", "price_per_meter")})
                print("     url:", r["listing_url"])
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:78])
            return 0

        # Full run: we fetched the COMPLETE catalog → prune anything active-but-unseen.
        pruned = 0
        for tbl, rows_seen in (("erapulse_residential_listings", res),
                               ("erapulse_commercial_listings", com)):
            n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source=SOURCE)
            if n < 0:
                print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
            else:
                pruned += n
        print(f"✓ Era Pulse: {len(res)} residential + {len(com)} commercial upserted, {pruned} stale pruned")
        db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=len(res) + len(com),
                   notes=f"pruned={pruned}")
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
