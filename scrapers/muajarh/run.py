"""Muajarh (muajarh.com) — Riyadh rental platform. Onboarding 2026-09-26 (wave 3, batch 4).

SOURCE SHAPE (measured live 2026-09-26)
=======================================
The public site renders listings client-side from an open JSON API:
  list    https://admin.muajarh.com/api/v1/properties?limit=50&page=N  → {data[], total, meta}
  detail  https://admin.muajarh.com/api/v1/properties/by-slug/<slug>   (+ description, images, licence)
  page    https://muajarh.com/properties/<slug>
Measured: total 18 — but 7 are the platform's own demo/test records («Store Review Demo Property …»,
«اعلان تجريبي»), served in the same public feed. Every one of the 7 has NO REGA ad licence and every
one of the 11 real listings has one, so a row without `adv_license` is skipped: a Saudi property ad
cannot run without a licence. (The site's own /localization/cities/home counter prints 7 — it counts
the demo rows only. Never wire a count check to it.)

TYPE: the licence's «propertyType» when present, else the category the listing is filed under
(plural nav names: فلل / شقق / أدوار / غرف → mapped by their English key, never from the title).
AREA: `parameters` «المساحة» (11 of 11). The licence's propertyArea exists on only 6 and disagrees
in decimals on 3 — mixing the two would put licensed and rounded values in one column.
PRICE = SOURCE: `price`; the record's own `rent_duration_label_ar` («سنوي» on all 11) is the card
period, and the shared owner rule applies on top (normalize.rent_period_from_ad).
AMENITIES: `parameters` dropdowns mix TEXT labels («متوفر», «غير متوفر», «نعم», «مؤثث») with bare
index numbers («1», «0») whose option nothing names. Only the text labels are read; an index stays
NULL (unknown), and every raw value is kept in additional_info.source_params.
PHOTOS: gallery `property_images`, else the listing's own cover `title_image` (5 of 11 have no gallery).

AVAILABILITY (measured 2026-10-02, list AND all 11 by-slug records): status True on 18 of 18,
request_status «approved» on 18 of 18, state null on 18 of 18 — the 7 demo rows included, so none of
them tells a live ad from a dead one, and the site's own pages apply no status test of their own
(they render whatever the API returns). No other value has ever been seen, so one is KEPT and
COUNTED in the run log, never guessed to mean unavailable. The ad licence's own end date
(`adv_license_expire_date`, ISO, 11 of 11 in 2027) goes through the fleet's ad-end-date gate.

PDPL: the licence names the advertiser and his mobile, the deed number; the detail carries
`customer` / `publisher` / `client_address` / `brokerage_contracts`. None is stored.
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
from scrapers.common.http import retry_smarter_session  # noqa: E402

API = "https://admin.muajarh.com/api/v1/properties"
MEDIA = "https://admin.muajarh.com/"
SITE = "https://muajarh.com/properties"
SOURCE = "مؤاجرة"
PREFIX = "MJR"
SLUG = "muajarh"

_CATEGORY_AR = {"villas": "فيلا", "apartments": "شقة", "floor": "دور", "floors": "دور", "rooms": "غرفة",
                "studios": "استوديو", "warehouses": "مستودع", "shops": "محل", "offices": "مكتب"}
# text label → True/False; anything else (incl. a bare index) → unknown
_YES = {"متوفر", "متوفرة", "نعم", "خاص", "مؤثث", "true"}
_NO = {"غير متوفر", "غير متوفرة", "لا", "لا يوجد", "غير مؤثث"}
_BOOL_PARAMS = {"المصعد": "elevator", "مواقف خاصة": "parking", "غرفة سائق": "driver_room",
                "المدخل": "private_entrance", "الأثاث": "furnished", "غرفة غسيل": "laundry_room"}
_STATUS_MEASURED = {"status": True, "request_status": "approved", "state": None}
_NEVER_STORE = {"advertiserName", "advertiserMobile", "deedNumber", "locationDescription"}


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
        d = get_json(s, f"{API}?limit=50&page={page}")
        total = int(d.get("total") or 0)
        rows += d.get("data") or []
        if page >= int((d.get("meta") or {}).get("totalPages") or 1):
            break
    return rows, total


def _params(rec: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for p in rec.get("parameters") or []:
        name = ((p.get("facility") or {}).get("name_ar") or "").strip()
        if name and name not in out:
            out[name] = str(p.get("value") or "").strip()
    return out


def _tri(v: Optional[str]) -> Optional[bool]:
    return True if v in _YES else (False if v in _NO else None)


def map_listing(x: dict, d: dict) -> tuple[Optional[tuple[dict, str]], str]:
    if not x.get("adv_license"):
        return None, "no_rega_licence_demo_row"
    if x.get("listing_type") != "rent":
        return None, f"deal_unstated_{x.get('listing_type')}"
    if normalize.ad_expiry_state(x.get("adv_license_expire_date") or d.get("adv_license_expire_date")) == "expired":
        return None, "ad_licence_expired"
    comp = ((d.get("rega_license_data") or {}).get("compliance") or {})
    cat = x.get("category") or {}
    type_ar = comp.get("propertyType") or _CATEGORY_AR.get((cat.get("nameEn") or "").strip().lower())
    ptype = normalize.map_type_exact(type_ar)
    if not ptype:
        return None, f"type_unmapped_{cat.get('nameAr')}"
    category = normalize.category_for_type(ptype).lower()

    params = _params(x)
    title, desc = x.get("title") or "", d.get("description") or ""
    price = normalize.to_int(str(x.get("price"))) if x.get("price") else None
    card = {"سنوي": "annual", "شهري": "monthly"}.get((x.get("rent_duration_label_ar") or "").strip())
    rent_period, price_annual = normalize.rent_period_from_ad(price, f"{title} {desc}", card)

    city_ar = x.get("city")
    city_id, region_id = to_catalog(city_ar, region_hint=x.get("region")) if city_ar else (None, None)
    district_raw = x.get("district")
    district_ar = find_district_in_text(district_raw, city_id) if (city_id and district_raw) else None

    gallery = [MEDIA + i["image"] for i in (d.get("property_images") or []) if i.get("image")]
    photos = gallery or ([MEDIA + x["title_image"]] if x.get("title_image") else [])
    street = normalize.to_int(comp.get("streetWidth"))
    area = params.get("المساحة")
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{x['id']}",
        "listing_url": f"{SITE}/{x['slug']}",
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii(desc) or None,
        "property_type": ptype,
        "transaction_type": "Rent",
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": float(area) if area and area.replace(".", "", 1).isdigit() and float(area) > 0 else None,
        "bathrooms": normalize.to_int(params.get("دورة المياة")) or None,
        "property_age": normalize.exact_age(comp.get("propertyAge")),
        "direction": normalize.one_direction(comp.get("propertyFacade"), diagonal=True),
        "street_width_m": street or None,
        "license_number": x.get("adv_license"),
        "license_expiry": x.get("adv_license_expire_date"),
        "photo_urls": photos or None,
        "rent_period": rent_period,
        "price_annual": price_annual,
    }
    for pname, col in _BOOL_PARAMS.items():
        v = _tri(params.get(pname))
        if v is not None:
            row[col] = v
    row["price_evidence"] = normalize.price_evidence(
        field="price", raw=x.get("price"), stored=price_annual, kind="annual", unit="total",
        origin="api", authoritative_absent=False)
    info = {
        "source_id": x["id"],
        "category_ar": cat.get("nameAr"),
        "source_rooms": params.get("الغرف"),          # «الغرف» is never labelled as bedrooms
        "rent_duration_ar": x.get("rent_duration_label_ar"),
        "payment_plan_ar": x.get("payment_plan_label_ar"),
        "licence_area_m2": comp.get("propertyArea"),
        "plan_number": comp.get("planNumber"),
        "age_ar": comp.get("propertyAge"),
        "source_params": params or None,
        "latitude": x.get("latitude"),
        "longitude": x.get("longitude"),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [], {})})
    cap = {k: v for k, v in comp.items() if k not in _NEVER_STORE}
    row["source_capture"] = strip_pii_fields({"schema": "muajarh.properties.v1", "licence": cap,
                                              "params": params, "price": x.get("price")})
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
    listings, declared = walk(s)
    print(f"{SOURCE}: {len(listings)} record(s) (API declares total={declared})", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    kept: dict[str, int] = {}
    unreadable = 0
    try:
        for x in listings:
            if not x.get("adv_license"):
                skipped["no_rega_licence_demo_row"] = skipped.get("no_rega_licence_demo_row", 0) + 1
                continue
            try:
                d = get_json(s, f"{API}/by-slug/{x['slug']}")
                d = d.get("data") or d
            except Exception:  # noqa: BLE001
                unreadable += 1
                continue
            got, why = map_listing(x, d)
            if not got:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            row, cat = got
            (com if cat == "commercial" else res).append(row)
            if normalize.ad_expiry_state(x.get("adv_license_expire_date") or d.get("adv_license_expire_date")) == "unknown":
                # no readable licence end date (measured 2026-10-02: a readable ISO date on 11 of 11
                # licensed rows): kept, and counted out loud — never silently taken as «still licensed»
                kept["adv_license_expire_date_unread"] = kept.get("adv_license_expire_date_unread", 0) + 1
            for field, measured in _STATUS_MEASURED.items():
                value = d.get(field, x.get(field))
                if value != measured:
                    kept[f"{field}_{value}"] = kept.get(f"{field}_{value}", 0) + 1
                    db.mark_presence_unproven(row)         # kept as before, never stamped as checked
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if kept:
            print("  kept, status value never measured or end date unread (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(kept.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial ({unreadable} unreadable)")
            for row in res + com:
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "price_annual", "rent_period", "area_m2",
                       "city_id", "district_ar", "elevator", "furnished")}, ensure_ascii=False)[:240])
            return 0

        db.upsert_muajarh_residential_batch(res)
        db.upsert_muajarh_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="muajarh_residential_listings", com_table="muajarh_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = unreadable == 0 and len(listings) >= declared > 0
        for tbl, rr in (("muajarh_residential_listings", res), ("muajarh_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print(f"  NOT pruning: {unreadable} unreadable detail(s) or a short walk", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(listings), rows_upserted=len(res) + len(com),
                             check_tables=["muajarh_residential_listings", "muajarh_commercial_listings"])
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
