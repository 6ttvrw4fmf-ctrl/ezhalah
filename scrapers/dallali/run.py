"""Dallali (dallali.com) — a Saudi property-management / brokerage SaaS with a public storefront.
Onboarding 2026-09-26 (wave 3, batch 4).

SOURCE SHAPE (measured live 2026-09-26)
=======================================
The site is an empty Vite/React shell; the storefront reads an open JSON API:
  list    https://p1.dallali.com/listings/public?purpose=all&page=N   → {listings[], total}
  detail  https://p1.dallali.com/listings/public/<uuid>                 (404 for an unknown id)
  page    https://dallali.com/advertisements/property/<uuid>
Measured: total 7 — 3 rent (2 offices, 1 apartment), 4 residential plots in KAEC. Each carries its
REGA licence as `rega_display_data` (the 21 mandatory fields).

WHAT THE PAGE SHOWS IS THE UNIT, NOT THE LICENCE. Ad fa37876f: the licence says «مجمع», 3,658.11 m²
(the whole office complex); the page's own headline says «مكتب», 81.14 m², 178,508 ريال / سنة — the
unit being let. So TYPE and AREA come from `unit` (unit_type, area), falling back to the licence only
when the unit has none (ad 65bd233d's unit has no area; the page prints the licence's 94.93). The
licence's own type/area are kept in additional_info.

PRICE = SOURCE: `listings.price` — the figure the page prints. For land the licence's propertyPrice is
PER m² (950, 1,500, 5,400) and its landTotalPrice equals listings.price; nothing is multiplied here.
RENT PERIOD: the page renders «/ سنة» for every rent (a UI constant, no per-listing field), so the
shared owner rule decides (normalize.rent_period_from_ad): the ad's own text tied to its price first,
then a monthly-looking price (≤ 10,000), else the page's yearly.

AVAILABILITY IS THE STOREFRONT'S OWN RULE (measured 2026-10-02). Its bundle (assets/index-*.js) hides
a listing with `e.is_active ? !!e.expires_at && new Date(e.expires_at) <= now : true` and queries
`expires_at.is.null,expires_at.gt.<now>`; expired() below is that test. Feed today: is_active true on
7 of 7, expires_at null on 7 of 7 (the record's other timestamps are ISO). The REGA licence's own
endDate is dd/mm/yyyy (creationDate «02/09/2026» on the ad created 2026-09-02; «04/08/2027» on 7 of
7) and goes through the fleet's ad-end-date gate.

PDPL: the licence names the responsible employee and his mobile, a phone number, the advertiser, the
advertiser id and the deed number — none is stored.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http import retry_smarter_session  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

API = "https://p1.dallali.com/listings/public"
SITE = "https://dallali.com/advertisements/property"
SOURCE = "دلّالي"
PREFIX = "DLL"
SLUG = "dallali"

# unit_type → the Arabic word the fleet's type map already knows.
_UNIT_TYPE_AR = {"office": "مكتب", "apartment": "شقة", "villa": "فيلا", "residential_land": "ارض",
                 "commercial_land": "أرض تجارية", "shop": "محل", "warehouse": "مستودع", "building": "عمارة",
                 "floor": "دور", "studio": "استوديو", "rest_house": "استراحة"}
_UTILITIES = {"كهرباء": "electricity", "مياه": "water_supply", "صرف صحي": "sanitation",
              "ألياف ضوئية": "optical_fibers"}
_NEVER_STORE = {"phoneNumber", "responsibleEmployeeName", "responsibleEmployeePhoneNumber",
                "advertiserName", "advertiserId", "deedNumber", "borders", "locationDescriptionOnMOJDeed"}


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
    seen: set[str] = set()
    total = 0
    for page in range(1, 50):
        d = get_json(s, f"{API}?purpose=all&page={page}")
        total = int(d.get("total") or 0)
        fresh = [x for x in d.get("listings") or [] if x.get("id") not in seen]
        if not fresh:
            break
        seen.update(x["id"] for x in fresh)
        rows += fresh
        if len(rows) >= total:
            break
    return rows, total


def _num(v: Any) -> Optional[float]:
    try:
        f = float(str(v).replace(",", ""))
        return f if f > 0 else None
    except (TypeError, ValueError):
        return None


def expired(x: dict) -> str:
    """Why the listing's own dates say it is over — '' when they do not."""
    raw = x.get("expires_at")
    if raw:
        try:
            end = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            return "status_unreadable"
        if (end if end.tzinfo else end.replace(tzinfo=timezone.utc)) <= datetime.now(timezone.utc):
            return "expired_at_source"
    if normalize.ad_expiry_state((x.get("rega_display_data") or {}).get("endDate")) == "expired":
        return "ad_licence_expired"
    return ""


def map_listing(x: dict) -> tuple[Optional[tuple[dict, str]], str]:
    if x.get("is_active") is False:
        return None, "inactive"
    if x.get("is_active") is not True:
        return None, "status_unreadable"    # not read ≠ available and ≠ dead: main() does not prune
    why = expired(x)
    if why:
        return None, why
    rega = x.get("rega_display_data") or {}
    unit = x.get("unit") or {}
    loc = rega.get("location") or {}
    deal = {"rent": "Rent", "sale": "Buy"}.get(x.get("listing_type") or "")
    if not deal:
        return None, f"deal_unstated_{x.get('listing_type')}"
    lic_deal = {"إيجار": "Rent", "بيع": "Buy"}.get(rega.get("advertisementType") or "")
    if lic_deal and lic_deal != deal:
        return None, f"deal_conflict_{deal}_vs_{lic_deal}"

    type_ar = _UNIT_TYPE_AR.get(unit.get("unit_type") or "") or rega.get("propertyType")
    ptype = normalize.map_type_exact(type_ar)
    if not ptype:
        return None, f"type_unmapped_{unit.get('unit_type') or rega.get('propertyType')}"
    category = normalize.category_for_type(ptype).lower()

    title, desc = x.get("title") or "", x.get("description") or ""
    price = normalize.to_int(str(x.get("price"))) if _num(x.get("price")) else None
    row_price: dict[str, Any] = {}
    if deal == "Buy":
        row_price["price_total"] = price
    else:
        row_price["rent_period"], row_price["price_annual"] = normalize.rent_period_from_ad(
            price, f"{title} {desc}", "annual")

    city_ar = loc.get("city") or (x.get("property") or {}).get("city")
    city_id, region_id = to_catalog(city_ar, region_hint=loc.get("region")) if city_ar else (None, None)
    district_raw = loc.get("district") or (x.get("property") or {}).get("district")
    district_ar = find_district_in_text(district_raw, city_id) if (city_id and district_raw) else None

    street = _num(rega.get("streetWidth"))
    utilities = rega.get("propertyUtilities") or []
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{x['id']}",
        "listing_url": f"{SITE}/{x['id']}",
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
        "street_name": loc.get("street"),
        "area_m2": _num(unit.get("area")) or _num(rega.get("propertyArea")),
        "bedrooms": unit.get("bedrooms") or None,
        "bathrooms": unit.get("bathrooms") or None,
        "property_age": normalize.exact_age(rega.get("propertyAge")),
        "direction": normalize.one_direction(rega.get("propertyFace"), diagonal=True),
        "street_width_m": int(street) if street else None,
        "license_number": x.get("ad_license_number") or rega.get("adLicenseNumber"),
        "license_expiry": rega.get("endDate"),
        "photo_urls": x.get("image_urls") or None,
        **row_price,
    }
    for word, col in _UTILITIES.items():
        if any(word in (u or "") for u in utilities):
            row[col] = True
    stored = row.get("price_total") if deal == "Buy" else row.get("price_annual")
    row["price_evidence"] = normalize.price_evidence(
        field="listings.price", raw=x.get("price"), stored=stored,
        kind="total" if deal == "Buy" else "annual", unit="total", origin="api", authoritative_absent=False)
    info = {
        "source_id": x["id"],
        "unit_type": unit.get("unit_type"),
        "licence_property_type": rega.get("propertyType"),
        "licence_area_m2": rega.get("propertyArea"),
        "licence_price": rega.get("propertyPrice"),
        "land_total_price": rega.get("landTotalPrice"),
        "age_ar": rega.get("propertyAge"),
        "utilities_ar": utilities or None,
        "plan_number": rega.get("planNumber"),
        "land_number": rega.get("landNumber"),
        "negotiable": x.get("is_negotiable"),
        "latitude": loc.get("latitude"),
        "longitude": loc.get("longitude"),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v not in (None, "", [])})
    cap = {k: v for k, v in rega.items() if k not in _NEVER_STORE}
    row["source_capture"] = strip_pii_fields({"schema": "dallali.listings.public.v1", "rega": cap,
                                              "listing_type": x.get("listing_type"), "price": x.get("price")})
    return (row, category), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dry = a.dry_run

    # 3 browser profiles DIRECT, then the residential proxy when the job has it (owner 10-05:
    # every crawler on the shared resilient path; backlog 63). The session owns the profile.
    s, tried = retry_smarter_session(f"{API}?purpose=all&page=1", timeout=40)
    print(f"  route: {' · '.join(tried)}", flush=True)
    listings, declared = walk(s)
    print(f"{SOURCE}: {len(listings)} listing(s) (API declares total={declared})", flush=True)

    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    kept: dict[str, int] = {}
    try:
        for x in listings:
            got, why = map_listing(x)
            if not got:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            row, cat = got
            (com if cat == "commercial" else res).append(row)
            if normalize.ad_expiry_state((x.get("rega_display_data") or {}).get("endDate")) == "unknown":
                # the licence end date is absent or not a readable date (measured 2026-10-02: readable
                # dd/mm/yyyy on 7 of 7). The storefront's own rule (is_active, expires_at) passed, so the
                # listing stays — counted out loud, never silently taken as «still licensed»
                kept["licence_end_date_unread"] = kept.get("licence_end_date_unread", 0) + 1
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if kept:
            print("  kept, end date unread (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(kept.items())), flush=True)
        if dry:
            print(f"DRY: {len(res)} residential + {len(com)} commercial")
            for row in res + com:
                print("   ", json.dumps({k: row.get(k) for k in
                      ("ad_number", "property_type", "transaction_type", "price_total", "price_annual",
                       "rent_period", "area_m2", "city_id", "district_ar")}, ensure_ascii=False)[:240])
            return 0

        db.upsert_dallali_residential_batch(res)
        db.upsert_dallali_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table="dallali_residential_listings", com_table="dallali_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com}, source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip", flush=True)
        complete = len(listings) >= declared > 0 and "status_unreadable" not in skipped
        for tbl, rr in (("dallali_residential_listings", res), ("dallali_commercial_listings", com)):
            if rr and complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print("  NOT pruning: the walk fell short of the declared total, or a listing's status was unreadable",
                  flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(listings), rows_upserted=len(res) + len(com),
                             check_tables=["dallali_residential_listings", "dallali_commercial_listings"])
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
