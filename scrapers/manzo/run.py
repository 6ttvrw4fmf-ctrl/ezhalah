"""Manzo (manzo.com.sa, «شركة مانزو بروبتك») — Onboarding 2026-09-27 (wave 3, batch 5).

manzoproptech.com.sa redirects to manzo.com.sa. Owner 2026-09-27: include it — one real listing is still
a real listing.

SOURCE SHAPE (measured live 2026-09-27)
=======================================
Open JSON API (no key):
  list    https://api.manzo.com.sa/property/v1/properties/search/?page=N   {results[], pagination{total_count, has_next}}
  detail  https://api.manzo.com.sa/property/v1/properties/details/s/<slug>/
  page    https://manzo.com.sa/ar/property/<slug>
Measured: total_count 1 — an apartment for rent in الظهران, 48,000 / year (pricing_options period
«annual», rent_duration «annual»), REGA ad licence 7201141490 (status active).

AGE: `property_age` is a BUILD YEAR (2019) → normalize.age_from_completion_year.
PHOTOS: served from media-stg.manzo.com.sa; verified 200 image/jpeg (the same bytes as media.manzo.com.sa).
PDPL: `lister_info` (name, profile picture) and the parcel `borders` are never stored.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import to_catalog  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

API = "https://api.manzo.com.sa/property/v1/properties"
SITE = "https://manzo.com.sa/ar/property/"
SOURCE = "مانزو"
PREFIX = "MNZ"
SLUG = "manzo"
IMPERSONATE = "chrome"

_TYPE_AR = {"Apartment": "شقة", "Villa": "فيلا", "Floor": "دور", "Land": "ارض", "Office": "مكتب",
            "Shop": "محل", "Building": "عمارة", "Warehouse": "مستودع", "Studio": "استوديو"}
_DEAL = {"long_term_rent": "Rent", "sale": "Buy", "sell": "Buy"}
_NEVER_STORE = {"lister_info", "borders", "commission", "deep_link", "share_image", "share_title",
                "share_description", "connectivity", "nearby_pois"}


def get_json(s: cc.Session, url: str) -> Any:
    for attempt in range(3):
        try:
            r = s.get(url, impersonate=IMPERSONATE, timeout=40)
            r.raise_for_status()
            return r.json()
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)


def walk(s: cc.Session) -> tuple[list[dict], int]:
    rows: list[dict] = []
    total = 0
    for page in range(1, 50):
        d = get_json(s, f"{API}/search/?page={page}")
        pg = d.get("pagination") or {}
        total = int(pg.get("total_count") or 0)
        rows += d.get("results") or []
        if not pg.get("has_next"):
            break
    return rows, total


def _f(v: Any) -> Optional[float]:
    try:
        f = float(v)
        return f if f > 0 else None
    except (TypeError, ValueError):
        return None


def map_property(d: dict) -> tuple[Optional[tuple[dict, str]], str]:
    if d.get("display_status") != "active":
        return None, f"status_{d.get('display_status')}"
    deal = _DEAL.get(d.get("property_type") or "")
    if not deal:
        return None, f"deal_unmapped_{d.get('property_type')}"
    ptype = normalize.map_type_exact(_TYPE_AR.get(d.get("property_category") or ""))
    if not ptype:
        return None, f"type_unmapped_{d.get('property_category')}"
    category = normalize.category_for_type(ptype).lower()

    title = d.get("title_ar") or d.get("title") or ""
    price = normalize.to_int(str(d.get("price"))) if _f(d.get("price")) else None
    row_price: dict[str, Any] = {}
    if deal == "Buy":
        row_price["price_total"] = price
    else:
        primary = next((o for o in d.get("pricing_options") or [] if o.get("primary")), {})
        card = {"annual": "annual", "monthly": "monthly"}.get(primary.get("period") or d.get("rent_duration") or "")
        row_price["rent_period"], row_price["price_annual"] = normalize.rent_period_from_ad(price, title, card, title)

    city_ar = d.get("city")
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)
    lng, lat = ((d.get("coordinates") or {}).get("coordinates") or [None, None])[:2]
    apt = d.get("apartment") or {}
    photos = list(dict.fromkeys(d.get("property_images") or ([d["main_image_url"]] if d.get("main_image_url") else [])))
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{d.get('property_id') or d['slug']}",
        "listing_url": SITE + d["slug"],
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",   # deal is validated above
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "area_m2": _f(d.get("area")),
        "bedrooms": apt.get("bedrooms") or None,
        "bathrooms": apt.get("bathrooms") or None,
        "property_age": normalize.age_from_completion_year(d.get("property_age"), this_year=dt.date.today().year),
        "license_number": d.get("ad_licence_number"),
        "photo_urls": photos or None,
        **row_price,
    }
    for flag, col in (("electricity_access", "electricity"), ("water_access", "water_supply"), ("sewage_system", "sanitation")):
        if d.get(flag) is True:
            row[col] = True
    stored = row.get("price_total") if deal == "Buy" else row.get("price_annual")
    row["price_evidence"] = normalize.price_evidence(
        field="price", raw=d.get("price"), stored=stored, kind="total" if deal == "Buy" else "annual",
        unit="total", origin="api", authoritative_absent=False)
    info = {
        "source_id": d.get("property_id"),
        "slug": d.get("slug"),
        "build_year": d.get("property_age"),
        "rent_duration": d.get("rent_duration"),
        "apartment_features": {k: v for k, v in (apt.get("features") or {}).items() if v is True} or None,
        "living_rooms": apt.get("living_rooms"),
        "ad_licence_status": d.get("ad_licence_status"),
        "latitude": lat,
        "longitude": lng,
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [], {})})
    cap = {k: v for k, v in d.items() if k not in _NEVER_STORE}
    row["source_capture"] = strip_pii_fields({"schema": "manzo.property.v1", "record": cap})
    return (row, category), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = cc.Session()
    listing, declared = walk(s)
    print(f"{SOURCE}: {len(listing)} propert(ies) (API declares total_count={declared})", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unreadable = 0
    try:
        for p in listing:
            try:
                d = get_json(s, f"{API}/details/s/{p['slug']}/")
                d = d.get("data") or d
            except Exception:  # noqa: BLE001
                unreadable += 1
                continue
            got, why = map_property(d)
            if not got:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            row, cat = got
            (com if cat == "commercial" else res).append(row)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial ({unreadable} unreadable)")
            for row in res + com:
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "price_annual", "rent_period", "area_m2", "bedrooms",
                       "property_age", "city_id", "license_number")}, ensure_ascii=False)[:230])
            return 0

        db.upsert_manzo_residential_batch(res)
        db.upsert_manzo_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="manzo_residential_listings", com_table="manzo_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = unreadable == 0 and len(listing) >= declared > 0
        for tbl, rr in (("manzo_residential_listings", res), ("manzo_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: {unreadable} unreadable detail(s) or a short walk", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(listing), rows_upserted=len(res) + len(com),
                             check_tables=["manzo_residential_listings", "manzo_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(listing), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
