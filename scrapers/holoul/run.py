"""Holoul (holoul.io) — developer units for sale. Onboarding 2026-09-27 (wave 3, batch 5).

SOURCE SHAPE (measured live 2026-09-27)
=======================================
The public site is a Nuxt app over an anonymous JSON API (same origin, app.holoul.io):
  list  https://app.holoul.io/customer/api/v1/units/?page=N&per_page=100   {pages, total, result[]}
  page  https://app.holoul.io/units/<uuid>   (NOT /ar/units/ — that path is a 404 shell)
`Accept-Language: ar` returns Arabic names (city الرياض, district الرمال, type دور/شقة).

TRAP 1 — every query parameter (?status=, ?project_number=, …) is SILENTLY IGNORED: the feed always
returns the whole table (238 when measured: drafts, unlisted projects, test rows). The filter is applied
here: the PROJECT must be `listed` and the UNIT must be `listed` (44), and the unit must carry a REGA ad
licence — the 4 units of P100069 have placeholder deeds (000000 / 123456) and no licence, the same
demo-row signature as Muajarh's. A unit whose own record states no advertisement type (10 of P100168)
is skipped, not assumed to be a sale. → 30 rows.
TRAP 2 — MONEY IS IN HALALAS: price 78,500,000 → the page prints SAR 785,000; price_per_meter
487,577 → SAR 4,875.77 (published, never computed here).
AREA: the unit's floor-plan design `total_area` (the unit row itself has none).
The 12 units of P100139 «أدوار حي بدر» are genuinely separate floors with their own pages (same price,
two alternating plans) — kept, they are what the source sells.

PDPL: the licence block names the advertiser and his phone, and the deed number — never stored.
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
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

API = "https://app.holoul.io/customer/api/v1/units/"
SITE = "https://app.holoul.io/units/"   # /ar/units/<id> answers 404 (found in the 2026-09-27 real-user click-through)
SOURCE = "حلول"
PREFIX = "HLL"
SLUG = "holoul"
IMPERSONATE = "chrome"
_UTILITIES = {"electricity": "electricity", "water": "water_supply", "sanitation": "sanitation",
              "كهرباء": "electricity", "مياه": "water_supply", "صرف صحي": "sanitation"}
_NEVER_STORE = {"nhc_advertiser_name", "nhc_advertiser_phone", "nhc_advertiser_id", "deed_number",
                "nhc_location_desc_on_moj_deed", "nhc_borders", "nhc_rer_boarders", "agency"}


def walk(s: cc.Session) -> tuple[list[dict], int]:
    rows: list[dict] = []
    total = 0
    for page in range(0, 50):
        for attempt in range(3):
            try:
                r = s.get(f"{API}?page={page}&per_page=100", impersonate=IMPERSONATE, timeout=40,
                          headers={"Accept-Language": "ar"})
                r.raise_for_status()
                d = r.json()
                break
            except Exception:  # noqa: BLE001
                if attempt == 2:
                    raise
                time.sleep(2 + attempt * 3)
        total = int(d.get("total") or 0)
        rows += d.get("result") or []
        if page + 1 >= int(d.get("pages") or 1):
            break
    return rows, total


def _name(v: Any) -> Optional[str]:
    return (v or {}).get("name") if isinstance(v, dict) else None


def _sar(halalas: Any) -> Optional[int]:
    try:
        v = int(halalas)
    except (TypeError, ValueError):
        return None
    # the fleet's price columns are integers; like normalize.to_int everywhere else this keeps whole
    # riyals (4,875.77 → 4,875) and the exact halalas stay in source_capture
    return v // 100 if v > 0 else None


def map_unit(u: dict) -> tuple[Optional[tuple[dict, str]], str]:
    proj = u.get("project") or {}
    if proj.get("status") != "listed" or u.get("status") != "listed":
        return None, f"not_listed_{proj.get('status')}_{u.get('status')}"
    if not u.get("nhc_ad_license_number"):
        return None, "no_rega_licence_demo_row"
    ad_type = _name(u.get("nhc_advertisement_type"))
    if ad_type not in ("Sale", "بيع"):
        return None, f"ad_type_unstated_{ad_type}"
    type_ar = _name(u.get("nhc_property_type"))
    ptype = normalize.map_type_exact(type_ar)
    if not ptype:
        return None, f"type_unmapped_{type_ar}"
    category = normalize.category_for_type(ptype).lower()

    design = u.get("design") or {}
    city_ar, district_raw = _name(proj.get("nhc_city")), _name(proj.get("nhc_district"))
    city_id, region_id = to_catalog(city_ar) if city_ar else (None, None)
    district_ar = find_district_in_text(district_raw, city_id) if (city_id and district_raw) else None
    price = _sar(u.get("price"))
    ppm = _sar(u.get("price_per_meter"))
    pics = [m.get("object_url") or m.get("url") for m in (u.get("media_attachments") or [])
            if isinstance(m, dict) and m.get("type") == "picture"]
    photos = [p for p in ([u.get("main_picture")] + pics) if p]
    area = design.get("total_area")
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{u['id']}",
        "listing_url": SITE + u["id"],
        "source": SOURCE,
        "active": True,
        "title": redact_pii(f"{proj.get('title') or ''} — {u.get('title') or ''}".strip(" —")) or None,
        "property_type": ptype,
        "transaction_type": "Buy",
        "price_total": price,
        "price_per_meter": ppm,
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": float(area) if area else None,
        "bedrooms": u.get("bedrooms") or design.get("bedrooms") or None,
        "bathrooms": u.get("bathrooms") or design.get("bathrooms") or None,
        "property_age": normalize.exact_age({"new": "جديد"}.get(_name(u.get("nhc_age")) or "", _name(u.get("nhc_age")))),
        "floor_number": u.get("floor") if isinstance(u.get("floor"), int) else None,
        "license_number": u.get("nhc_ad_license_number"),
        "license_expiry": u.get("nhc_end_at"),
        "photo_urls": list(dict.fromkeys(photos)) or None,
    }
    for util in u.get("nhc_utilities") or []:
        col = _UTILITIES.get((_name(util) or "").strip().lower()) or _UTILITIES.get((_name(util) or "").strip())
        if col:
            row[col] = True
    row["price_evidence"] = normalize.price_evidence(
        field="price (halalas)", raw=u.get("price"), stored=price, kind="total", unit="total",
        origin="api", authoritative_absent=False)
    info = {
        "source_id": u["id"],
        "project_number": proj.get("number"),
        "project_title": proj.get("title"),
        "unit_number": u.get("number"),
        "design_title": design.get("title"),
        "living_rooms": u.get("living_rooms") or design.get("living_rooms"),
        "usage": [_name(x) for x in (u.get("nhc_usage") or [])] or None,
        "project_features": [_name(x) for x in (proj.get("features") or [])] or None,
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [])})
    cap = {k: v for k, v in u.items() if k.startswith("nhc_") and k not in _NEVER_STORE}
    row["source_capture"] = strip_pii_fields({"schema": "holoul.units.v1", "licence": cap,
                                              "price_halalas": u.get("price"),
                                              "price_per_meter_halalas": u.get("price_per_meter")})
    return (row, category), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    s = cc.Session()
    units, declared = walk(s)
    print(f"{SOURCE}: {len(units)} unit record(s) (API declares total={declared})", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        for u in units:
            got, why = map_unit(u)
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
                      ("ad_number", "property_type", "price_total", "price_per_meter", "area_m2",
                       "bedrooms", "property_age", "city_id", "district_ar")}, ensure_ascii=False)[:230])
            return 0

        db.upsert_holoul_residential_batch(res)
        db.upsert_holoul_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="holoul_residential_listings", com_table="holoul_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = len(units) >= declared > 0
        for tbl, rr in (("holoul_residential_listings", res), ("holoul_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print("  NOT pruning: the walk fell short of the declared total", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(units), rows_upserted=len(res) + len(com),
                             check_tables=["holoul_residential_listings", "holoul_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(units), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
