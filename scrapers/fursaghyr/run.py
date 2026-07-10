"""Fursa Ghyr (fursaghyr.com) scraper — فرصة غير العقارية, small Saudi WP-based brokerage.

Tiny catalog (~20 active listings) exposed through a custom WP REST endpoint that already
bundles the entire REGA/FAL payload per item — no detail-page round-trip, no proxy, no auth.

API:
  GET https://fursaghyr.com/wp-json/fgh/v1/properties?per_page=50
      → {items: [...]}   (each item = title, permalink, images[], rea{...})

The `rea` block is the REGA disclosure: advertiser id, property_type/purpose, land_area,
meter_price / total_price, address parts (region/city/district/street/postal_code/...),
geo lat/lng, deed, utilities, FAL license + dates + license_url. We map the structured
parts onto canonical columns and store the rest in `additional_info`.

⛔ PDPL: rea.advertiser_name and rea.advertiser_phone are NEVER stored (or surfaced anywhere).
   broker_license is a corporate/company FAL license — kept as compliance metadata.

Routing: مكتب → Office (commercial); everything else (فيلا/شقة/أرض/مزرعة/عمارة) → residential.

Usage:  python -m scrapers.fursaghyr.run [--type residential|commercial|all] [--limit N]
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

from scrapers.common import db, normalize

BASE = "https://fursaghyr.com"
LIST = f"{BASE}/wp-json/fgh/v1/properties"
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "0.3"))

# Fursaghyr rea.property_type (Arabic) → our canonical English taxonomy.
TYPE_MAP_AR = {
    "فيلا": "Villa",
    "شقة": "Apartment",
    "أرض": "Residential Land",
    "ارض": "Residential Land",
    "مزرعة": "Farm",
    "عمارة": "Building",
    "دور": "Floor",
    "استراحة": "Rest House",
    "شاليه": "Chalet",
    "بيت": "House",
    "دوبلكس": "Duplex",
    "ستوديو": "Studio",
    # commercial
    "مكتب": "Office",
    "محل": "Shop",
    "معرض": "Showroom",
    "مستودع": "Warehouse",
    "ورشة": "Workshop",
    "مصنع": "Factory",
    "فندق": "Hotel",
    "محطة": "Gas Station",
    "تجاري": "Commercial Building",
}
COMMERCIAL_TYPES = {
    "Office", "Shop", "Showroom", "Warehouse", "Workshop", "Factory",
    "Hotel", "Gas Station", "Commercial Building", "Commercial Land",
}

# Arabic region labels Fursaghyr uses in rea.region → our canonical English region.
REGION_AR = {
    "منطقة الرياض": "Riyadh", "الرياض": "Riyadh",
    "منطقة مكة المكرمة": "Makkah", "مكة المكرمة": "Makkah",
    "المنطقة الشرقية": "Eastern Province",
    "منطقة المدينة المنورة": "Madinah",
    "منطقة القصيم": "Qassim", "القصيم": "Qassim",
    "منطقة عسير": "Asir",
    "منطقة تبوك": "Tabuk",
    "منطقة حائل": "Hail",
    "منطقة جازان": "Jazan",
    "منطقة نجران": "Najran",
    "منطقة الباحة": "Al Bahah",
    "منطقة الجوف": "Al Jawf",
    "منطقة الحدود الشمالية": "Northern Borders",
}

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


def _int(v: Any) -> Optional[int]:
    try:
        n = int(float(v))
        return n if n != 0 else None
    except (TypeError, ValueError):
        return None


def _float(v: Any) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def fetch_all(s: cc.Session) -> list[dict]:
    """Tiny catalog — one request returns everything."""
    _throttle()
    for attempt in range(3):
        try:
            r = s.get(LIST, params={"per_page": 50}, timeout=30)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code != 200:
            time.sleep(2 * (attempt + 1)); continue
        j = r.json()
        items = j.get("items") if isinstance(j, dict) else j
        return items or []
    return []


_FULLRES_RE = re.compile(r"-\d{2,4}x\d{2,4}(\.(?:png|jpe?g|webp))$", re.IGNORECASE)


def _full(url: str) -> str:
    """Strip WP -WxH thumbnail suffix to recover the full-res original."""
    return _FULLRES_RE.sub(r"\1", url)


def _photos(item: dict) -> list[str]:
    out: list[str] = []
    for u in item.get("images") or []:
        if not isinstance(u, str) or not u.startswith("http"):
            continue
        if any(bad in u.lower() for bad in ("placeholder", "no-image", "no_image", "default", "logo")):
            continue
        full = _full(u)
        if full not in out:
            out.append(full)
    return out


def _additional_info(item: dict, rea: dict) -> dict[str, Any]:
    """All rich data that doesn't have a canonical column. Excludes advertiser name/phone (PDPL)."""
    info: dict[str, Any] = {}
    # raw Arabic location parts (REQUIRED — always store)
    if rea.get("city"):
        info["city_ar"] = rea["city"]
    if rea.get("region"):
        info["region_ar"] = rea["region"]
    if rea.get("district"):
        info["district_ar"] = rea["district"]
    # geo
    lat = _float(rea.get("latitude"))
    lng = _float(rea.get("longitude"))
    if lat is not None and lng is not None:
        info["latitude"] = lat
        info["longitude"] = lng
    # REGA/FAL compliance — keep the corporate license + dates + public verification URL
    for k in ("license_number", "broker_license", "license_start", "license_end",
              "license_url", "license_source", "advertiser_id"):
        v = rea.get(k)
        if v:
            info[k] = v
    # deed + parcel + civic numbering
    for k in ("deed_number", "deed_type", "moj_location_desc", "postal_code",
              "building_no", "additional_no", "street", "front", "street_width",
              "ad_channels", "usages", "utilities", "borders", "location_text",
              "meter_price"):
        v = rea.get(k)
        if v not in (None, "", [], {}):
            info[k] = v
    # post timestamps
    if item.get("created_at"):
        info["created_at"] = item["created_at"]
    if item.get("updated_at"):
        info["updated_at"] = item["updated_at"]
    # property_type as raw Arabic, useful for debugging the type map
    if rea.get("property_type"):
        info["property_type_ar"] = rea["property_type"]
    if rea.get("purpose"):
        info["purpose_ar"] = rea["purpose"]
    return info


def _utility_flags(utilities: Any) -> dict[str, bool]:
    """rea.utilities is a list of Arabic labels — map to our boolean columns."""
    flags: dict[str, bool] = {}
    if not isinstance(utilities, list):
        return flags
    s = " ".join(str(u) for u in utilities)
    if "كهرباء" in s:
        flags["electricity"] = True
    if "مياه" in s or "ماء" in s:
        flags["water_supply"] = True
    if "صرف" in s:
        flags["sanitation"] = True
    if "ألياف" in s or "الياف" in s:
        flags["optical_fibers"] = True
    return flags


def map_listing(item: dict) -> tuple[Optional[dict], str]:
    rea = item.get("rea") or {}
    item_id = item.get("id")
    if not item_id:
        return None, "residential"
    type_ar = (rea.get("property_type") or "").strip()
    property_type = TYPE_MAP_AR.get(type_ar)
    if not property_type:
        # try substring (e.g. "أرضي")
        for k, v in TYPE_MAP_AR.items():
            if k and k in type_ar:
                property_type = v; break
    if not property_type:
        return None, "residential"
    category = "commercial" if property_type in COMMERCIAL_TYPES else "residential"

    purpose = (rea.get("purpose") or "").strip()
    is_rent = purpose.startswith("إيجار") or "إيجار" in purpose or "ايجار" in purpose

    area = _int(rea.get("land_area"))
    meter = _int(rea.get("meter_price"))
    total = _int(rea.get("total_price"))

    # Many listings only carry meter_price + land_area → derive total_price = meter * area
    # ONLY when meter is in a plausible per-m² range (< 50k SAR/m²). Above that the field is
    # almost certainly the total price mis-labeled by the publisher (e.g. villa with
    # meter_price=750000), in which case we leave price columns null and keep the raw value
    # in additional_info.meter_price for forensic inspection.
    if total is None and meter and area and meter < 50000:
        total = meter * area

    # SANITY: reject implausible micro-prices
    price_for_check = total if total else meter
    if price_for_check is not None and price_for_check < 1000:
        return None, category

    # region: Arabic label first, else map city → region
    raw_region = (rea.get("region") or "").strip()
    raw_city = (rea.get("city") or "").strip()
    region = REGION_AR.get(raw_region)
    # Forward-fix (2026-07-10 location-data-quality audit): removed the "Other" fallback AND the
    # subsequent "if region and city == 'Other': city = region" block below it — that block used to
    # silently surface a REGION NAME as the city label (e.g. "Riyadh" for a rural town nowhere near
    # Riyadh city, confirmed live on ad FG24914) whenever city resolution failed but region resolution
    # succeeded. A region name is not a city; an honest None is correct, and the raw Arabic signal
    # this scraper captures elsewhere is unchanged for a DB-side resolver to use.
    city = normalize.map_city(raw_city)
    if region is None:
        # try mapping the raw city via the region label table too (some payloads put the region in `city`)
        region = REGION_AR.get(raw_city)

    photos = _photos(item)

    title = _redact(item.get("title"))
    listing_url = item.get("permalink")

    # bedrooms/bathrooms are not exposed in the rea payload — leave null (we never guess).
    bedrooms = None
    bathrooms = None

    row: dict[str, Any] = {
        "ad_number": f"FG{item_id}",
        "listing_url": listing_url,
        "source": "Fursaghyr",
        "active": True,
        "property_type": property_type,
        "transaction_type": "Rent" if is_rent else "Buy",
        "area_m2": area,
        "bedrooms": bedrooms if (category == "residential" and property_type not in {"Residential Land", "Farm"}) else None,
        "bathrooms": bathrooms,
        "price_total": total if not is_rent else None,
        "price_annual": total if is_rent else None,
        "rent_period": "annual" if is_rent else None,
        # Trust meter_price as a per-m² figure only when it's in a plausible range.
        "price_per_meter": meter if (meter and meter < 50000) else None,
        "city": city,
        "region": region,
        "neighborhood": rea.get("district") or None,
        "street_name": rea.get("street") or None,
        "building_number": rea.get("building_no") or None,
        "zip_code": rea.get("postal_code") or None,
        "additional_number": rea.get("additional_no") or None,
        "direction": rea.get("front") or None,
        "street_width_m": _int(rea.get("street_width")),
        "rega_location_verified": bool(rea.get("license_number")),
        "title": title,
        "photo_urls": photos,
        "additional_info": _additional_info(item, rea),
    }
    row.update(_utility_flags(rea.get("utilities")))
    return row, category


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=None,
                    help="Validation run: cap items processed and SKIP unseen-prune.")
    args = ap.parse_args()

    s = session()
    items = fetch_all(s)
    print(f"Fursaghyr: fetched {len(items)} items")
    if args.limit:
        items = items[: args.limit]
        print(f"Validation cap: processing {len(items)} items, prune disabled")

    res: list[dict] = []
    com: list[dict] = []
    seen = 0

    is_validation = bool(args.limit)
    run_id = db.begin_run("fursaghyr") if not is_validation else None

    try:
        for it in items:
            row, cat = map_listing(it)
            if not row:
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            seen += 1

        if res:
            db.upsert_fursaghyr_residential_batch(res)
        if com:
            db.upsert_fursaghyr_commercial_batch(com)

        pruned = 0
        if not is_validation:
            # FULL-REFRESH prune: we fetched the COMPLETE catalog → anything not seen is gone.
            for tbl, rows_seen in (("fursaghyr_residential_listings", res),
                                   ("fursaghyr_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows_seen}, source="Fursaghyr")
                if n < 0:
                    print(f"⚠ {tbl}: prune guard tripped (0 scraped or collapse) — kept existing active")
                else:
                    pruned += n

        print(f"✓ Fursaghyr: {len(res)} residential + {len(com)} commercial upserted"
              + (f", {pruned} stale pruned" if not is_validation else " (validation, no prune)"))
        if run_id is not None:
            db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen, notes=f"pruned={pruned}")
        return 0
    except Exception as e:
        if run_id is not None:
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {e}")
        raise


if __name__ == "__main__":
    raise SystemExit(main())
