"""Mobasher (mobasher.sa) — DIRECT-SALE real estate only. Onboarding 2026-09-26 (wave 3, batch 4).

Owner 2026-09-25: «keep it its fine». Mobasher runs two separate products on two separate feeds:
fixed-price DIRECT SALE (listingType DIRECT_SALE) and AUCTIONS (/discovery/auctions, a bid, not a
listed price). Only direct sale is read here — the auction feed is never called, so no auction row
can enter (no-auction rule: an auction is not a listed price).

SOURCE SHAPE (measured live 2026-09-26)
=======================================
  list    https://discovery-api.prod.mobasher.sa/api/v1/discovery/direct-sale
            ?includeTotal=true&pageSize=50&status=ACTIVE&categoryType=RealEstate  (cursor: nextCursor)
  page    https://mobasher.sa/direct/realestate/<slugAr>  (server-rendered; the RSC payload adds
          propertyAge and propertyFacade)
Measured: totalItems 28, all DIRECT_SALE, all priced (propertyPriceUnit WHOLE = a total).

TRAP: the type/area/usage/rooms fields are NOT on the feed row — they are nested in
`searchableAttributes`. A reader of row["propertyType"] gets None on all 28, which a None-dropping
upsert would make look like clean data.
TYPE: «propertyTypeAr» + the structured `propertyUsage` list for land: Residential → Residential Land,
Commercial → Commercial Land, Industrial → Industrial Land, Agricultural → Farm. A plot whose usage
is BOTH residential and commercial (2 of 28) is not resolved here — OWNER QUESTION, skipped until
answered (ambiguous mapping → ask first).
`propertySpace` 0 and the page's `propertyAge` 0 are form defaults → NULL (age sits in an unrendered
block where every amenity is `false` too, so those booleans are not read either).

PDPL: the row names the seller and the deed number; the page's licence block names the advertiser.
None is stored.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

API = ("https://discovery-api.prod.mobasher.sa/api/v1/discovery/direct-sale"
       "?includeTotal=true&pageSize=50&status=ACTIVE&categoryType=RealEstate")
SITE = "https://mobasher.sa/direct/realestate/"
SOURCE = "مباشر"
PREFIX = "MBS"
SLUG = "mobasher"
IMPERSONATE = "chrome"

# owner 2026-09-27: a plot whose usage lists BOTH Residential and Commercial is Commercial Land
_LAND_BY_USAGE = {("Residential",): "ارض", ("Commercial",): "أرض تجارية", ("Commercial", "Residential"): "أرض تجارية",
                  ("Industrial",): "Industrial Land", ("Agricultural",): "أرض زراعية"}
_UTILITIES = {"ELECTRICITY": "electricity", "WATERS": "water_supply", "WATER": "water_supply",
              "SANITATION": "sanitation", "FIBER_OPTICS": "optical_fibers"}
_FACADE_AR = {"NORTH": "شمالية", "SOUTH": "جنوبية", "EAST": "شرقية", "WEST": "غربية",
              "NORTH_EAST": "شمالية شرقية", "NORTH_WEST": "شمالية غربية",
              "SOUTH_EAST": "جنوبية شرقية", "SOUTH_WEST": "جنوبية غربية"}
_NEVER_STORE = {"deedNumber", "sellerName", "sellerNameAr", "sellerOrgId"}


def get(s: cc.Session, url: str) -> cc.Response:
    for attempt in range(3):
        try:
            r = s.get(url, impersonate=IMPERSONATE, timeout=40)
            r.raise_for_status()
            return r
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)
    raise RuntimeError("unreachable")


def walk(s: cc.Session) -> tuple[list[dict], int]:
    rows: list[dict] = []
    total, cursor = 0, None
    for _ in range(50):
        d = get(s, API + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else "")).json()
        total = int(d.get("totalItems") or 0)
        rows += d.get("items") or []
        cursor = d.get("nextCursor")
        if not cursor:
            break
    return rows, total


def page_facts(page: str) -> dict[str, Any]:
    """propertyAge / propertyFacade from the page's RSC payload (escaped JSON inside the HTML)."""
    out: dict[str, Any] = {}
    m = re.search(r'\\?"propertyAge\\?":\s*(\d+)', page)
    if m and int(m.group(1)) > 0:     # 0 sits in a block of all-false form defaults and is never shown
        out["age"] = int(m.group(1))
    m = re.search(r'\\?"propertyFacade\\?":\s*\\?"([A-Z_]+)\\?"', page)
    if m:
        out["facade"] = m.group(1)
    return out


def map_listing(x: dict, facts: dict) -> tuple[Optional[tuple[dict, str]], str]:
    if x.get("listingType") != "DIRECT_SALE":
        return None, f"not_direct_sale_{x.get('listingType')}"
    a = x.get("searchableAttributes") or {}
    type_ar = (a.get("propertyTypeAr") or "").strip()
    if type_ar == "أرض":
        usage = tuple(sorted(a.get("propertyUsage") or []))
        type_ar = _LAND_BY_USAGE.get(usage)
        if not type_ar:
            return None, f"land_usage_{'+'.join(usage) or 'unstated'}_owner_question"
    ptype = type_ar if type_ar == "Industrial Land" else normalize.map_type_exact(type_ar)
    if not ptype:
        return None, f"type_unmapped_{a.get('propertyTypeAr')}"
    category = normalize.category_for_type(ptype).lower()

    price = normalize.to_int(str(x.get("askingPrice"))) if x.get("askingPrice") else None
    if a.get("propertyPriceUnit") not in (None, "WHOLE"):
        return None, f"price_unit_{a.get('propertyPriceUnit')}"
    city_ar = x.get("cityNameAr")
    city_id, region_id = to_catalog(city_ar, region_hint=x.get("regionNameAr")) if city_ar else (None, None)
    district_raw = x.get("neighborhoodNameAr")
    district_ar = find_district_in_text(district_raw, city_id) if (city_id and district_raw) else None

    title = a.get("titleAr") or x.get("title") or ""
    desc = re.sub(r"<[^>]+>", " ", a.get("summaryAr") or x.get("summary") or "")
    desc = re.sub(r"[ \t]+", " ", desc).strip()
    space = a.get("propertySpace")
    street = normalize.to_int(str(a.get("streetWidth"))) if a.get("streetWidth") else None
    geo = x.get("geoLocation") or {}
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{x.get('documentId') or x.get('sourceEntityId')}",
        "listing_url": SITE + urllib.parse.quote(x.get("slugAr") or ""),
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii(desc) or None,
        "property_type": ptype,
        "transaction_type": "Buy",
        "price_total": price,
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": float(space) if space and float(space) > 0 else None,
        "bathrooms": a.get("bathrooms") or None,
        "property_age": facts.get("age"),
        "direction": normalize.one_direction(_FACADE_AR.get(facts.get("facade") or ""), diagonal=True),
        "street_width_m": street or None,
        "plan_parcel": a.get("planNo") or None,
        "license_number": (x.get("advertisementId") or a.get("advertisementId") or "").strip() or None,
        "photo_urls": [x["mainImageUrl"]] if x.get("mainImageUrl") else None,
    }
    for u in a.get("propertyUtilities") or []:
        col = _UTILITIES.get(u)
        if col:
            row[col] = True
    row["price_evidence"] = normalize.price_evidence(
        field="askingPrice", raw=x.get("askingPrice"), stored=price, kind="total", unit="total",
        origin="api", authoritative_absent=False)
    info = {
        "source_id": x.get("documentId") or x.get("sourceEntityId"),
        "type_ar": a.get("propertyTypeAr"),
        "usage": a.get("propertyUsage") or None,
        "source_rooms": a.get("rooms") or None,          # «rooms» is never labelled as bedrooms
        "utilities": a.get("propertyUtilities") or None,
        "facade": facts.get("facade"),
        "allow_offer": a.get("allowOffer"),
        "latitude": geo.get("lat"),
        "longitude": geo.get("lon"),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [])})
    cap = {k: v for k, v in a.items() if k not in _NEVER_STORE and k not in ("summaryAr",)}
    row["source_capture"] = strip_pii_fields({"schema": "mobasher.direct-sale.v1", "attributes": cap,
                                              "page": facts})
    return (row, category), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = cc.Session()
    listings, declared = walk(s)
    print(f"{SOURCE}: {len(listings)} direct-sale listing(s) (API declares total={declared})", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unreadable = 0
    try:
        for x in listings:
            try:
                facts = page_facts(get(s, SITE + urllib.parse.quote(x.get("slugAr") or "")).text)
            except Exception:  # noqa: BLE001
                unreadable += 1
                facts = {}
            got, why = map_listing(x, facts)
            if not got:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            row, cat = got
            (com if cat == "commercial" else res).append(row)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial ({unreadable} pages unreadable)")
            for row in res + com:
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "price_total", "area_m2", "property_age",
                       "direction", "city_id", "district_ar")}, ensure_ascii=False)[:240])
            return 0

        db.upsert_mobasher_residential_batch(res)
        db.upsert_mobasher_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="mobasher_residential_listings", com_table="mobasher_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        # an unreadable PAGE costs only age/facade, never the listing — the feed is the inventory
        complete = len(listings) >= declared > 0
        for tbl, rr in (("mobasher_residential_listings", res), ("mobasher_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print("  NOT pruning: the walk fell short of the declared total", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(listings), rows_upserted=len(res) + len(com),
                             check_tables=["mobasher_residential_listings", "mobasher_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(listings), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
