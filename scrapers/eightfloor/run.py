"""8Floor (www.8floor.sa, «مكتب الطابق الثامن للعقارات») — Onboarding 2026-09-27 (wave 3, batch 5).

The bare domain 8floor.sa has NO DNS record; https://www.8floor.sa is the live site (it was wrongly
called dead for two days because only the bare domain was tried).

SOURCE SHAPE (measured live 2026-09-27)
=======================================
A tenant of the Nuzul SaaS platform («بواسطة منصة نزل»), which serves an open public API:
  list    https://www.8floor.sa/api/public/v2/properties?page=N&per_page=50   {data[], meta{total, last_page}}
  detail  https://www.8floor.sa/api/public/v2/properties/<id>
  page    https://www.8floor.sa/properties/<id>
Measured: total 2 — two apartments for rent in Riyadh (#37238 حي النرجس 70,000/yr, #37975 حي الياسمين
80,000/yr). The site's nine «projects» are unbuilt / off-plan — owner 2026-09-27: only the 2 listed
properties, never the projects — so the projects endpoint is never read and a property attached to a
project is skipped.

RENT PERIOD: the record's own price field names the period (`rent_price_annually` / `rent_price_monthly`);
the shared owner rule (normalize.rent_period_from_ad) applies on top.
PDPL: the record carries the office WhatsApp number and the advertiser's FAL number — the phone is never
stored.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http import retry_smarter_session  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

API = "https://www.8floor.sa/api/public/v2/properties"
SITE = "https://www.8floor.sa/properties/"
SOURCE = "الطابق الثامن"
PREFIX = "EFL"
SLUG = "eightfloor"

_TYPE_AR = {"building_apartment": "شقة", "apartment": "شقة", "villa": "فيلا", "floor": "دور",
            "office": "مكتب", "shop": "محل", "land": "ارض", "building": "عمارة", "duplex": "دوبلكس",
            "townhouse": "تاون هاوس", "warehouse": "مستودع", "rest_house": "استراحة"}
_FACADE_AR = {"north": "شمالية", "south": "جنوبية", "east": "شرقية", "west": "غربية",
              "north_east": "شمالية شرقية", "north_west": "شمالية غربية",
              "south_east": "جنوبية شرقية", "south_west": "جنوبية غربية"}
_NEVER_STORE = {"whatsapp_number", "is_whatsapp_number_enabled", "is_member_whatsapp_number_enabled"}


def get_json(s: cc.Session, url: str) -> Any:
    for attempt in range(3):
        try:
            r = s.get(url, timeout=40)
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
        d = get_json(s, f"{API}?page={page}&per_page=50")
        total = int((d.get("meta") or {}).get("total") or 0)
        rows += d.get("data") or []
        if page >= int((d.get("meta") or {}).get("last_page") or 1):
            break
    return rows, total


def _pos(v: Any) -> Optional[int]:
    return v if isinstance(v, int) and v > 0 else None


def map_property(d: dict) -> tuple[Optional[tuple[dict, str]], str]:
    if d.get("availability_status") != "available":
        return None, f"status_{d.get('availability_status')}"
    if d.get("projects"):
        return None, "project_unit_off_plan"
    deal = {"rent": "Rent", "sell": "Buy", "sale": "Buy"}.get(d.get("purpose") or "")
    if not deal:
        return None, f"deal_unstated_{d.get('purpose')}"
    ptype = normalize.map_type_exact(_TYPE_AR.get(d.get("type") or ""))
    if not ptype:
        return None, f"type_unmapped_{d.get('type')}"
    category = normalize.category_for_type(ptype).lower()

    title = d.get("name_ar") or ""
    desc = d.get("description_ar") or ""
    row_price: dict[str, Any] = {}
    if deal == "Buy":
        row_price["price_total"] = normalize.to_int(str(d.get("selling_price"))) if d.get("selling_price") else None
    else:
        if d.get("rent_price_annually"):
            price, card = int(d["rent_price_annually"]), "annual"
        elif d.get("rent_price_monthly"):
            price, card = int(d["rent_price_monthly"]), "monthly"
        else:
            price, card = None, None
        row_price["rent_period"], row_price["price_annual"] = normalize.rent_period_from_ad(
            price, f"{title} {desc}", card, title)

    city_ar = (d.get("city") or {}).get("name_ar") or d.get("city_name_ar")
    district_raw = (d.get("district") or {}).get("name_ar") or d.get("district_name_ar")
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)
    district_ar = find_district_in_text(district_raw, city_id) if (city_id and district_raw) else None
    photos = [i.get("url") for i in (d.get("images") or []) if isinstance(i, dict) and i.get("url")]
    photos = photos or ([d["cover_image_url"]] if d.get("cover_image_url") else [])
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{d['id']}",
        "listing_url": f"{SITE}{d['id']}",
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii(desc) or None,
        "property_type": ptype,
        "transaction_type": "Rent" if deal == "Rent" else "Buy",   # deal is validated above
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": float(d["area"]) if isinstance(d.get("area"), (int, float)) and d["area"] > 0 else None,
        "bedrooms": _pos(d.get("bedrooms")),
        "bathrooms": _pos(d.get("bathrooms")),
        "floor_number": _pos(d.get("unit_floor_number")),
        "direction": normalize.one_direction(_FACADE_AR.get(d.get("facade") or ""), diagonal=True),
        "license_number": d.get("rega_ad_number"),
        "photo_urls": photos or None,
        **row_price,
    }
    # true-only: an absent / false flag on this platform is a form default, not a stated «no»
    for flag, col in (("has_electricity", "electricity"), ("has_water", "water_supply"), ("has_sewage", "sanitation")):
        if d.get(flag) is True:
            row[col] = True
    if _pos(d.get("elevators")):
        row["elevator"] = True
    if _pos(d.get("parking_spots")):
        row["parking"] = True
    stored = row.get("price_total") if deal == "Buy" else row.get("price_annual")
    row["price_evidence"] = normalize.price_evidence(
        field="rent_price_annually" if deal == "Rent" else "selling_price",
        raw=d.get("rent_price_annually") or d.get("rent_price_monthly") or d.get("selling_price"),
        stored=stored, kind="total" if deal == "Buy" else "annual", unit="total", origin="api",
        authoritative_absent=False)
    info = {
        "source_id": d["id"],
        "source_type": d.get("type"),
        "price_label": d.get("price_label"),
        "living_rooms": _pos(d.get("living_rooms")),
        "kitchens": _pos(d.get("kitchens")),
        "parking_spots": _pos(d.get("parking_spots")),
        "facade": d.get("facade"),
        "advertiser_fal_number": d.get("rega_advertiser_number"),
        "latitude": d.get("latitude"),
        "longitude": d.get("longitude"),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [])})
    cap = {k: v for k, v in d.items() if k not in _NEVER_STORE and not k.endswith("_price")
           and k not in ("images", "cover_image", "description_en")}
    row["source_capture"] = strip_pii_fields({"schema": "nuzul.public.v2.property", "record": cap})
    return (row, category), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    # 3 browser profiles DIRECT, then the residential proxy when the job has it (owner 10-05:
    # every crawler on the shared resilient path; backlog 63). The session owns the profile.
    s, tried = retry_smarter_session(API, timeout=40)
    print(f"  route: {' · '.join(tried)}", flush=True)
    listing, declared = walk(s)
    print(f"{SOURCE}: {len(listing)} propert(ies) (API declares total={declared})", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    unreadable = 0
    try:
        for p in listing:
            try:
                d = get_json(s, f"{API}/{p['id']}")
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
                       "city_id", "district_ar", "direction")}, ensure_ascii=False)[:230])
            return 0

        db.upsert_eightfloor_residential_batch(res)
        db.upsert_eightfloor_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="eightfloor_residential_listings", com_table="eightfloor_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = unreadable == 0 and len(listing) >= declared > 0
        for tbl, rr in (("eightfloor_residential_listings", res), ("eightfloor_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: {unreadable} unreadable detail(s) or a short walk", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(listing), rows_upserted=len(res) + len(com),
                             check_tables=["eightfloor_residential_listings", "eightfloor_commercial_listings"])
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
