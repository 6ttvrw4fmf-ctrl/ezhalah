"""Satel (satel.sa / شركة ساتل العقارية) scraper — Saudi real-estate company, public JSON API.

Satel is a Riyadh-focused, rent-heavy property company (boutique catalog ~196 listings, almost
entirely Riyadh; a handful of Sale units). Saudi company, REGA-compliant → passes the Saudi-only
rule. No auth, no proxy, cloud-friendly (open JSON API on apiv2.satel.sa).

API (no auth, no key):
  GET https://apiv2.satel.sa/categories/all                     → taxonomy (Residential/Commercial)
  GET https://apiv2.satel.sa/property/filter?ver=2&limit=1000   → {data:[...], totalCount}
       (the list item IS the full record — there's no richer detail endpoint we need.)

Field map (Satel item → our schema):
  propertyNumber               → listing_url  https://listings.satel.sa/property/<propertyNumber>
                                  (NOT slug — see the price-fidelity note below; falls back to <_id>)
  propertyNumber               → ad_number  (ST<propertyNumber>; falls back to ST<_id>)
  type  Rent|Buy(Sale)         → transaction_type Rent|Buy
  catName Residential|Commercial → table routing (+ subCatName for the canonical type)
  subCatName                   → property_type (TYPE_MAP)
  price + priceGroup           → annual rent | monthly rent (rent_period) | Buy total (onetime)
  floorArea (sqm)              → area_m2 ; beds/baths → bedrooms/bathrooms
  address.{cityEn/Ar, subCityEn/Ar(district), postalCode, lat, lng} → city/region/neighborhood + geo
  featuredImage / imageList[]  → photo_urls (filepath = public unsigned Spaces URL)
  furnishing/kitchen/acType/parking*/status/createdAt/title* → additional_info
  status "Rented out"          → active=false + post-upsert missing_count=3 pin (leased units
                                 stay in the API feed forever, so the seen-based prune can never
                                 catch them; see GONE_STATUSES + _pin_sold_inactive)

PDPL: the Satel API returns NO advertiser/agent name or phone — but we still defensively redact
any phone-like token from title/description and never store contact fields.

Price fidelity (2026-07-14, re-verification of the "BUG2" audit): map_listing()'s price fields
(price, priceGroup → price_total/price_annual/rent_period) were re-checked against the LIVE
listings.satel.sa page for 7 distinct properties (STA0212/id=598777, A0177, C0052, C0072, C0075,
V0044, C0055) and matched exactly in all 7 cases — there is no price-parsing bug. The ORIGINAL
"price mismatch" finding for id=598777 was a false positive caused by verifying against the wrong
URL: `listing_url` used to be built from `slug`, and listings.satel.sa does not route on slug — it
silently 200s to a hardcoded decoy listing (title "Luxury Apartment in Riyadh", ad "SAT-001",
Monthly SAR 4,500 / Annual SAR 48,000) for ANY slug, including ones that don't exist. That decoy
page is what produced the apparent mismatch. `listing_url` is now built from `propertyNumber`,
which routes correctly. See scripts/verify-satel-listing-url.ts (regression test) and
scripts/ops/repair_satel_prices_2026-07-14.sql (DB backfill of the 203 pre-existing rows built with
the old slug-based URL — a pure listing_url string repair; no price fields are touched because none
were found to be wrong).

Usage:  python -m scrapers.satel.run [--type residential|commercial|all] [--limit N] [--dry]
        --limit N  → small validation run (first N mapped rows, REAL upsert, NO prune)
        (full run = no --limit: whole catalog + prune of unseen on full runs only)
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.common import db, normalize  # noqa: E402

SOURCE = "Satel"
AD_PREFIX = "ST"
DEFAULT_REGION = "Riyadh"  # Satel is a Riyadh company; almost everything is Riyadh.

BASE = "https://apiv2.satel.sa"
LISTING_BASE = "https://listings.satel.sa/property"
FILTER_URL = f"{BASE}/property/filter?ver=2&limit=1000"
CATEGORIES_URL = f"{BASE}/categories/all"
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))

# Satel subCatName → our canonical ENGLISH taxonomy.
TYPE_MAP = {
    "Villas": "Villa",
    "Apartments": "Apartment",
    "Compounds": "Building",        # residential compound → Building (closest canonical residential)
    "Studio": "Studio",
    "Duplex": "Duplex",
    "Floor": "Floor",
    # commercial
    "Office Space": "Office",
    "Office": "Office",
    "Showroom": "Showroom",
    "Shop": "Shop",
    "Warehouse": "Warehouse",
}
COMMERCIAL_TYPES = {"Office", "Showroom", "Shop", "Warehouse"}

# Source `status` values that mean the unit is GONE from the market. Satel keeps leased units in
# the API feed with status "Rented out" instead of removing them, so the seen-based prune can
# never deactivate them. Live-DB audit (2026-07-09) shows exactly two distinct statuses across
# both Satel tables: 'Available' and 'Rented out'. Gate ONLY on the confirmed gone-value,
# compared case-insensitively on the trimmed string; ANY unknown/new status stays ACTIVE
# (neutrality rule: never over-hide a listing on a value we haven't confirmed means off-market).
GONE_STATUSES = {"rented out"}

# Phone / WhatsApp patterns to REDACT from any free text (PDPL).
_PHONE_RE = re.compile(
    r"(?:\+?9665\d{8}|\b05\d{8}\b|\b9200\d{4,6}\b|\b966\d{8,9}\b|wa\.me/\S+|(?:whatsapp|واتس\S*)\s*[:：]?\s*\+?\d[\d ]{6,})",
    re.IGNORECASE,
)


def _redact(text: Optional[str]) -> Optional[str]:
    if not text:
        return text
    cleaned = _PHONE_RE.sub("", str(text)).strip()
    return cleaned or None


_last = 0.0


def _throttle() -> None:
    global _last
    wait = _last + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({"Accept": "application/json"})
    return s


def _num(v: Any) -> Optional[float]:
    try:
        if v in (None, "", "0"):
            return None
        f = float(v)
        return f if f != 0 else None
    except (TypeError, ValueError):
        return None


def _int(v: Any) -> Optional[int]:
    f = _num(v)
    return int(f) if f is not None else None


def fetch_all(s: cc.Session) -> tuple[list[dict], int]:
    _throttle()
    for attempt in range(3):
        try:
            r = s.get(FILTER_URL, timeout=60)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code != 200:
            time.sleep(2 * (attempt + 1)); continue
        j = r.json()
        data = j.get("data") if isinstance(j, dict) else j
        total = (j.get("totalCount") if isinstance(j, dict) else None) or len(data or [])
        return (data or []), int(total)
    return [], 0


def _photo_urls(p: dict) -> list[str]:
    """Full-size public Spaces URLs. Use `filepath` (unsigned, no AWS query string), NOT
    `fileAccessPath` (presigned + expiring). Dedupe, keep order, drop empties."""
    urls: list[str] = []
    seen: set[str] = set()
    imgs = p.get("imageList") or []
    if not imgs:
        fi = p.get("featuredImage")
        if isinstance(fi, dict):
            imgs = [fi]
    for img in imgs:
        if not isinstance(img, dict):
            continue
        fp = img.get("filepath")
        if isinstance(fp, str) and fp.startswith("http") and fp not in seen:
            # strip an accidental presign query if present; keep the clean object URL.
            clean = fp.split("?", 1)[0]
            if clean not in seen:
                seen.add(clean); seen.add(fp)
                urls.append(clean)
    return urls


def _additional_info(p: dict, addr: dict) -> dict[str, Any]:
    info: dict[str, Any] = {}
    # raw Arabic location (ALWAYS stored per the cross-scraper convention).
    city_ar = p.get("cityAr") or addr.get("cityAr")
    dist_ar = p.get("subCityAr") or addr.get("subCityAr")
    if city_ar:
        info["city_ar"] = city_ar
    info["region_ar"] = "الرياض"  # Satel = Riyadh region
    if dist_ar:
        info["district_ar"] = dist_ar

    lat, lng = _num(p.get("lat") or addr.get("lat")), _num(p.get("lng") or addr.get("lng"))
    if lat is not None and lng is not None:
        info["geo"] = {"lat": lat, "lng": lng}

    for src_key, dst_key in (
        ("furnishing", "furnishing"),
        ("kitchen", "kitchen"),
        ("acType", "air_conditioning_type"),
        ("parkingType", "parking_type"),
        ("status", "availability_status"),
        ("priceGroup", "price_group"),
        ("subCatName", "sub_category"),
        ("catName", "category"),
        ("propertyNumber", "property_number"),
    ):
        v = p.get(src_key)
        if v not in (None, "", []):
            info[dst_key] = v

    if _int(p.get("parkingSpots")):
        info["parking_spots"] = _int(p.get("parkingSpots"))

    pc = addr.get("postalCode")
    if pc:
        info["postal_code"] = pc

    ca = p.get("createdAt")
    if ca:
        info["created_at"] = ca

    vt = p.get("virtualTour")
    if vt:
        info["virtual_tour"] = vt

    # bilingual titles (redacted), useful for search/display
    t_en = _redact(p.get("titleEn"))
    t_ar = _redact(p.get("titleAr"))
    if t_en:
        info["title_en"] = t_en
    if t_ar:
        info["title_ar"] = t_ar
    return info


def map_listing(p: dict) -> tuple[Optional[dict], str, bool]:
    """Map one Satel API item to a canonical row. Returns (row, category, gone)."""
    addr = p.get("address") or {}

    pnum = (p.get("propertyNumber") or "").strip()
    ad_id = pnum or str(p.get("_id") or "").strip()
    if not ad_id:
        return None, "residential", False

    sub = (p.get("subCatName") or "").strip()
    property_type = TYPE_MAP.get(sub)
    cat_name = (p.get("catName") or "").strip().lower()
    if not property_type:
        # fall back on category so we never silently drop a known unit
        property_type = "Office" if cat_name == "commercial" else "Apartment"
    category = "commercial" if (property_type in COMMERCIAL_TYPES or cat_name == "commercial") else "residential"

    raw_type = (p.get("type") or "").strip().lower()
    is_rent = raw_type == "rent"
    transaction_type = "Rent" if is_rent else "Buy"

    price_group = (p.get("priceGroup") or "").strip().lower()
    price = _int(p.get("price"))
    if price is not None and price < 1000:  # SANITY: reject absurdly-low prices
        price = None

    price_total = price_annual = None
    rent_period = None
    if is_rent:
        rent_period = "monthly" if price_group == "monthly" else "annual"
        # Monthly rentals must store the ANNUALIZED figure (monthly×12); the app displays
        # round(price_annual/12), so storing the raw monthly showed 1/12 of the real rent.
        # (price-fidelity fix 2026-07-13)
        price_annual = normalize.annualize_rent(price, "monthly") if rent_period == "monthly" else price
    else:
        price_total = price

    area = _num(p.get("floorArea"))
    if area is not None and (area < 5 or area > 1_000_000):  # SANITY guard
        area = None
    area_m2 = int(area) if area is not None else None

    # bedrooms: null for commercial/land or absurd counts
    beds = _int(p.get("beds"))
    if category == "commercial" or (beds is not None and beds > 20):
        beds = None
    baths = _int(p.get("baths"))
    if baths is not None and baths > 20:
        baths = None

    price_per_meter = None
    if price_total and area_m2:
        price_per_meter = round(price_total / area_m2)

    # city / region / neighborhood — Satel is overwhelmingly Riyadh; normalize messy cityEn values.
    raw_city_en = (p.get("cityEn") or addr.get("cityEn") or "").strip()
    raw_city_ar = (p.get("cityAr") or addr.get("cityAr") or "").strip()
    city = normalize.map_city(raw_city_ar) or normalize.map_city(raw_city_en)
    if not city:
        # cityEn is noisy ("Al Riyadh", "RIYADH", Arabic) → default to Riyadh.
        city = "Riyadh" if (not raw_city_en or "riyadh" in raw_city_en.lower() or raw_city_ar) else (raw_city_en or "Riyadh")
    region = DEFAULT_REGION
    neighborhood = (p.get("subCityEn") or addr.get("subCityEn") or "").strip() or None

    # IMPORTANT: keyed by propertyNumber (`pnum`, e.g. "A0212"), NOT `slug`. Satel's frontend
    # (listings.satel.sa) only routes correctly on propertyNumber — a slug-only URL 200s but
    # silently renders an unrelated hardcoded decoy listing (same fake "SAT-001" unit for ANY
    # slug, including nonexistent ones) instead of 404ing. Live-verified 2026-07-14 across 7
    # distinct properties (A0212/A0177/C0052/C0072/C0075/V0044/C0055): the propertyNumber-keyed
    # URL renders the true page and its price matches our stored price_annual exactly; the
    # slug-keyed URL always renders the same decoy "Luxury Apartment in Riyadh" / SAR 4,500-48,000
    # regardless of which listing it's supposed to be. This is a clickthrough/verifiability bug,
    # NOT a price bug — map_listing()'s price fields (below) were independently confirmed correct
    # against the live source. See scripts/verify-satel-listing-url.ts and
    # scripts/ops/repair_satel_prices_2026-07-14.sql for the regression test and DB backfill.
    listing_url = f"{LISTING_BASE}/{pnum}" if pnum else f"{LISTING_BASE}/{p.get('_id')}"

    title = _redact(p.get("titleAr")) or _redact(p.get("titleEn")) or _redact(p.get("nameEn"))

    # ── availability: "Rented out" means the unit is off the market (owner decision). Trimmed +
    # case-insensitive match against the confirmed GONE_STATUSES only; anything else stays active.
    status = (p.get("status") or "").strip()
    gone = status.lower() in GONE_STATUSES

    row: dict[str, Any] = {
        "ad_number": f"{AD_PREFIX}{ad_id}",
        "listing_url": listing_url,
        "source": SOURCE,
        "active": not gone,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "property_type": property_type,
        "transaction_type": transaction_type,
        "area_m2": area_m2,
        "bedrooms": beds,
        "bathrooms": baths,
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": price_per_meter,
        "rent_period": rent_period,
        "city": city,
        "region": region,
        "neighborhood": neighborhood,
        "zip_code": (addr.get("postalCode") or None) or None,
        "parking": bool(p.get("parking")),
        "kitchen": bool(p.get("kitchen")),
        "title": title,
        "photo_urls": _photo_urls(p),
        "additional_info": _additional_info(p, addr),
    }
    return row, category, gone


def _pin_sold_inactive(table: str, ad_numbers: list[str]) -> None:
    """Make source-confirmed RENTED-OUT rows survive the nightly auto_recover_false_inactive() sweep.

    That pg_cron job (05:20 UTC) re-activates any active=false row with
    coalesce(missing_count, 0) = 0 and a fresh last_seen_at — and the shared batch upsert
    (db._wasalt_batch) unconditionally writes missing_count=0 for every row it touches, which is
    exactly what would let rented-out listings resurrect every morning. So AFTER the batch upsert
    we pin the gone rows to missing_count=3 (the existing prune 3-strike threshold) + active=false.
    prune_unseen() never undoes this: it only selects active=true rows and only updates ids NOT
    in its seen set. When a unit becomes available again, its next upsert carries active=true
    and the upsert's own missing_count=0 reset applies — the pin is only written for ids that
    are rented out THIS crawl."""
    for i in range(0, len(ad_numbers), 200):
        db._execute(
            db.sb().table(table).update({"active": False, "missing_count": 3})
            .in_("ad_number", ad_numbers[i:i + 200]),
            what=table + ".sold_pin",
        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=None,
                    help="small validation run: map+upsert only the first N rows, NO prune")
    ap.add_argument("--dry", action="store_true", help="map only, no DB write")
    args = ap.parse_args()

    s = session()
    data, total = fetch_all(s)
    print(f"Satel: fetched {len(data)} of {total} listings")
    if not data:
        print("✗ no data returned")
        return 1

    is_small = args.limit is not None
    run_id = None if (args.dry or is_small) else db.begin_run("satel")

    res: list[dict] = []
    com: list[dict] = []
    sold_res: list[str] = []
    sold_com: list[str] = []
    gone_ct = 0
    seen = 0
    try:
        for p in data:
            row, cat, gone = map_listing(p)
            if not row:
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            if gone:
                gone_ct += 1
                (sold_com if cat == "commercial" else sold_res).append(row["ad_number"])
            seen += 1
            if is_small and seen >= args.limit:
                break

        print(f"Mapped {len(res)} residential + {len(com)} commercial ({gone_ct} rented out)")

        if args.dry:
            for r in (res + com)[:8]:
                print("  ", {k: r[k] for k in ("ad_number", "property_type", "transaction_type",
                                                "city", "region", "neighborhood", "area_m2",
                                                "bedrooms", "price_total", "price_annual", "rent_period",
                                                "active")})
                print("     url:", r["listing_url"])
                print("     photo:", (r["photo_urls"] or ["(none)"])[0][:90], f"({len(r['photo_urls'])} total)")
            return 0

        if res:
            db.upsert_satel_residential_batch(res)
        if com:
            db.upsert_satel_commercial_batch(com)
        # Pin rented-out rows immediately after the upsert (which reset their missing_count to 0),
        # so the 05:20 auto-recover job can never flip them back to active. See _pin_sold_inactive.
        if sold_res:
            _pin_sold_inactive("satel_residential_listings", sold_res)
        if sold_com:
            _pin_sold_inactive("satel_commercial_listings", sold_com)

        pruned = 0
        if not is_small:
            # FULL run only: we fetched the COMPLETE catalog → mark unseen active rows inactive.
            # Rented-out rows were upserted with active=False + pinned missing_count=3 above;
            # prune_unseen never touches them (it only reads active=true rows and only updates ids
            # ABSENT from the seen set), so passing their ad_numbers in rows_seen is harmless.
            for tbl, rows_seen in (("satel_residential_listings", res), ("satel_commercial_listings", com)):
                if args.type != "all":
                    want = "commercial" if "commercial" in tbl else "residential"
                    if args.type != want:
                        continue
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source=SOURCE)
                if n < 0:
                    print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
                else:
                    pruned += n
            print(f"✓ Satel: {len(res)} residential + {len(com)} commercial upserted, "
                  f"{gone_ct} rented out (inactive), {pruned} stale pruned")
        else:
            print(f"✓ Satel VALIDATION: {len(res)} residential + {len(com)} commercial upserted "
                  f"({gone_ct} rented out) (no prune)")

        if run_id:
            db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen,
                       notes=f"rented_out={gone_ct} pruned={pruned}")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        import traceback; traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
