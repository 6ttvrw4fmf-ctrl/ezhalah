"""Sirdab Marketplace («سرداب», marketplace.sirdab.co) — Onboarding 2026-09-27 (batch 7).

Warehouses, shops, workshops and factories for rent or sale, all Saudi Arabia.

SOURCE SHAPE (measured live 2026-09-27)
=======================================
A Next.js App Router site: every list page embeds its ads in the RSC flight payload
(`self.__next_f.push([1,"…"])`) as `"ads":[{…}]` — 24 per page, `?page=N`, `"totalCount":564`.
Each ad carries its whole property record, so no detail fetch is needed:
  id, slug (the public url), listing_type rent|sale, price_in_cents, title_ar, description_ar,
  status, property{property_type, area_in_m2, cities.name_ar, district_name, lat, lng, facade,
  street_width, street_name, property_age, has_water, has_sewage, has_electricity, images[]}.
Measured: 564 active (528 rent, 36 sale) — warehouse 356 · storefront 157 · workshop 24 · factory 12
· storage_yard 9 · storage 6.

TYPE: warehouse → مستودع, storefront → محل, workshop → ورشة, factory → مصنع. «storage_yard» and
«storage» (self-storage units) have no honest mapping in the taxonomy (حوش maps to Villa) → skipped,
never guessed.
PRICE: price_in_cents / 100, verbatim. Below 1 riyal (0.1 SAR placeholders measured) is no price.
PERIOD: the site prints a constant «/سنة» after EVERY rent — a card label, not the ad's own words —
so the period goes through the shared normalize.rent_period_from_ad (the ad's own text first).
PDPL: owner_phone, user_id, created_by and building/secondary numbers are never stored.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

LIST = "https://marketplace.sirdab.co/ar/ads"
SITE = "https://marketplace.sirdab.co/ar/ads/"
SOURCE = "سرداب"
PREFIX = "SRD"
SLUG = "sirdab"
IMPERSONATE = "chrome"

_TYPE_AR = {"warehouse": "مستودع", "storefront": "محل", "workshop": "ورشة", "factory": "مصنع"}
_DEAL = {"rent": "Rent", "sale": "Buy"}
_FACADE_AR = {"north": "شمالية", "south": "جنوبية", "east": "شرقية", "west": "غربية",
              "north_east": "شمالية شرقية", "north_west": "شمالية غربية",
              "south_east": "جنوبية شرقية", "south_west": "جنوبية غربية"}
_UTILITIES = {"has_water": "water_supply", "has_sewage": "sanitation", "has_electricity": "electricity"}
_NEVER_STORE = {"owner_phone", "user_id", "created_by", "building_number", "secondary_number", "zip_code",
                "short_code"}


def get(s: cc.Session, url: str) -> str:
    for attempt in range(3):
        try:
            r = s.get(url, impersonate=IMPERSONATE, timeout=40)
            r.raise_for_status()
            return r.text
        except Exception:  # noqa: BLE001
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)
    return ""


def page_ads(page: str) -> tuple[list[dict], Optional[int]]:
    """The `"ads":[…]` array and `"totalCount"` out of one list page's RSC flight payload."""
    blob = "".join(json.loads('"' + c + '"') for c in re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', page, re.S))
    total = re.search(r'"totalCount":(\d+)', blob)
    i = blob.find('"ads":[')
    if i < 0:
        return [], int(total.group(1)) if total else None
    j, depth = i + len('"ads":'), 0
    for k in range(j, len(blob)):
        if blob[k] == "[":
            depth += 1
        elif blob[k] == "]":
            depth -= 1
            if depth == 0:
                return json.loads(blob[j:k + 1]), int(total.group(1)) if total else None
    return [], None


def walk(s: cc.Session) -> tuple[list[dict], Optional[int]]:
    ads: dict[str, dict] = {}
    declared = None
    for p in range(1, 200):
        got, total = page_ads(get(s, f"{LIST}?page={p}"))
        declared = declared or total
        new = [a for a in got if a.get("id") and a["id"] not in ads]
        if not new:
            break
        ads.update({a["id"]: a for a in new})
        time.sleep(0.3)
    return list(ads.values()), declared


def map_ad(a: dict) -> tuple[Optional[tuple[dict, str]], str]:
    if a.get("status") != "active" or a.get("deleted_at"):
        return None, f"status_{a.get('status')}"
    deal = _DEAL.get(a.get("listing_type") or "")
    if not deal:
        return None, f"deal_unmapped_{a.get('listing_type')}"
    p = a.get("property") or {}
    ptype = normalize.map_type_exact(_TYPE_AR.get(p.get("property_type") or ""))
    if not ptype:
        return None, f"type_unmapped_{p.get('property_type')}"
    category = normalize.category_for_type(ptype).lower()

    cents = a.get("price_in_cents")
    price = int(cents // 100) if isinstance(cents, (int, float)) and cents >= 100 else None
    title = a.get("title_ar") or a.get("title_en") or ""
    desc = a.get("description_ar") or ""
    row_price: dict[str, Any] = {}
    if deal == "Buy":
        row_price["price_total"] = price
    else:
        row_price["rent_period"], row_price["price_annual"] = normalize.rent_period_from_ad(
            price, f"{title} {desc}", "annual", title)

    city = p.get("cities") or {}
    city_ar = city.get("name_ar") or p.get("city_name_ar")
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)
    district_raw = (p.get("district_name") or "").strip() or None
    district_ar = find_district_in_text("حي " + district_raw, city_id) if (city_id and district_raw) else None
    area = p.get("area_in_m2")
    photos = [i["url"] for i in sorted(p.get("images") or [], key=lambda i: not i.get("isPrimary")) if i.get("url")]
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{a['id']}",
        "listing_url": SITE + (a.get("slug") or a["id"]),
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii(desc[:4000]) or None,
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",   # deal is validated above
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "street_name": (p.get("street_name") or "").strip() or None,
        "area_m2": float(area) if isinstance(area, (int, float)) and area > 0 else None,
        "property_age": normalize.exact_age(p.get("property_age")) if p.get("property_age") is not None else None,
        "direction": normalize.one_direction(_FACADE_AR.get(p.get("facade") or ""), diagonal=True),
        "street_width_m": p.get("street_width") if isinstance(p.get("street_width"), (int, float)) and p["street_width"] > 0 else None,
        "photo_urls": photos,
        **row_price,
    }
    for flag, col in _UTILITIES.items():
        if p.get(flag) is True:
            row[col] = True
    stored = row.get("price_total") if deal == "Buy" else row.get("price_annual")
    row["price_evidence"] = normalize.price_evidence(
        field="price_in_cents", raw=cents, stored=stored, kind="total" if deal == "Buy" else "annual",
        unit="total", origin="structured", authoritative_absent=False)
    info = {
        "source_id": a.get("id"),
        "property_id": a.get("property_id"),
        "property_type_en": p.get("property_type"),
        "facade": p.get("facade"),
        "flooring": p.get("flooring"),
        "temperature_setting": p.get("temperature_setting"),
        "hazard_level": p.get("hazard_level"),
        "number_of_doors": p.get("number_of_doors"),
        "available_from": a.get("available_from"),
        "latitude": p.get("lat"),
        "longitude": p.get("lng"),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [])})
    cap_prop = {k: v for k, v in p.items() if k not in _NEVER_STORE}
    cap = {k: v for k, v in a.items() if k not in _NEVER_STORE and k != "property"}
    row["source_capture"] = strip_pii_fields({"schema": "sirdab.ad.v1", "ad": cap, "property": cap_prop})
    return (row, category), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = cc.Session()
    ads, declared = walk(s)
    print(f"{SOURCE}: {len(ads)} ad(s) (site declares totalCount={declared})", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        for x in ads:
            got, why = map_ad(x)
            if not got:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            row, cat = got
            (com if cat == "commercial" else res).append(row)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial")
            for row in (res + com)[:40]:
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "transaction_type", "price_total", "price_annual", "rent_period",
                       "area_m2", "city_id", "district_ar")}, ensure_ascii=False)[:240])
            return 0

        db.upsert_sirdab_residential_batch(res)
        db.upsert_sirdab_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="sirdab_residential_listings", com_table="sirdab_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = declared is not None and len(ads) >= declared > 0
        for tbl, rr in (("sirdab_residential_listings", res), ("sirdab_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: walked {len(ads)} of a declared {declared}", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(ads), rows_upserted=len(res) + len(com),
                             check_tables=["sirdab_residential_listings", "sirdab_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(ads), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
