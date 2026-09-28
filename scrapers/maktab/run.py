"""منصة مكتب (maktab.sa) — an office-rental marketplace. Onboarding 2026-09-28 (owner: «add maktab too»).

SOURCE SHAPE (measured live 2026-09-28)
=======================================
maktab.sa is a React SPA; its public /all_deals page (no login) loads
`backend.maktab.sa/apiBack/v1/user/offices?page=N` (Laravel paginator: data/last_page/total — 11 offices
today, 1 page). The browser sends the app's public client header `apiKey`, a literal in the public JS
bundle; it is read from that bundle at run time exactly as a visitor's browser does (never committed).
Each record: category_aqar (مكتب مؤثث / مكتب غير مؤثث …), ads_prices[] each with type_res «سنوي/شهري»,
space, street_width, location{city, neighborhood, region}, property_utilities, property_age, ads_files,
license_number + license_end_date + license_data (the REGA ad-licence record). Detail page = /details/<id>.

TRAPS
-----
1. THE AD'S OWN END DATE (owner 2026-09-28, the Shomou lesson): license_end_date is the REGA ad-licence
   expiry. Only normalize.ad_expiry_state() == 'live' becomes a row; a halted licence is skipped too.
2. PERIOD: every price is tagged «سنوي», but 9 of 11 are 750-3,450 SAR for a furnished office. The shared
   rent_period_from_ad decides (owner 2026-09-26 order: the ad's words tied to the price → ≤10,000 looks
   monthly even when the card says yearly → else the card's «سنوي»). The source tag is kept in
   additional_info.price_period_label so nothing is hidden.
3. ONLY offices are listings: coworking desks, meeting/conference rooms (hourly/daily bookings) are
   skipped with a counted reason.
4. PDPL: license_data and viewer_* carry names and phones — never copied; description → redact_pii.
5. space = the figure the site prints as «مساحة» (for a few offices it is the building's deed area,
   e.g. 10,829 m²) — PRICE/AREA = SOURCE, stored as published.
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
from scrapers.common import db, normalize as N  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii  # noqa: E402

SITE = "https://maktab.sa"
API = "https://backend.maktab.sa/apiBack/v1/user/offices"
SOURCE = "Maktab"           # English, slug-bearing: «مكتب» alone would match every office's name
PREFIX = "MKT"
SLUG = "maktab"
RES_TABLE = "maktab_residential_listings"
COM_TABLE = "maktab_commercial_listings"
OFFICE_KINDS = {"مكتب مؤثث": True, "مكتب غير مؤثث": False, "مكتب للبيع": None}   # → furnished
_KEY_RE = re.compile(r'"([A-Za-z0-9]{32})",[\w$]+=[\w$]+\.create\(\{baseURL')
_DEALS = {"إيجار": "Rent", "ايجار": "Rent", "بيع": "Buy"}


def api_headers(s: cc.Session) -> dict[str, str]:
    """The public client header the site's own bundle sends — read from the bundle, never stored."""
    page = s.get(f"{SITE}/all_deals", impersonate="chrome", timeout=40).text
    js = re.search(r'src="(/assets/website/index-[^"]+\.js)"', page)
    key = _KEY_RE.search(s.get(SITE + js.group(1), impersonate="chrome", timeout=60).text) if js else None
    if not key:
        raise RuntimeError("maktab: client header not found in the public bundle — site changed")
    return {"apiKey": key.group(1), "lang": "ar", "Accept": "application/json"}


def fetch_all(s: cc.Session) -> tuple[list[dict], bool]:
    h, out, page, last = api_headers(s), [], 1, 1
    while page <= last:
        d = s.get(f"{API}?page={page}", headers=h, impersonate="chrome", timeout=40).json()
        if not d.get("status"):
            raise RuntimeError(f"maktab API refused page {page}: {d.get('message')}")
        body = d["data"]
        out += body.get("data") or []
        last = int(body.get("last_page") or 1)
        page += 1
        time.sleep(0.5)
    return out, len(out) == int(body.get("total") or -1)


def _price(o: dict) -> tuple[Optional[int], Optional[str]]:
    """(price, «سنوي»|«شهري») — the yearly entry if the office publishes one, else the monthly one."""
    by = {((p.get("type_res") or {}).get("ar_name") or ""): p for p in o.get("ads_prices") or []
          if str(p.get("status")) == "1"}
    for label in ("سنوي", "شهري"):
        if label in by:
            v = N.to_int(str(by[label].get("price") or "").split(".")[0])
            return (v if v and v > 0 else None), label
    return None, (next(iter(by), None) or None)


def map_office(o: dict, today: Any = None) -> tuple[Optional[dict], str, str]:
    kind = (o.get("category_aqar") or {}).get("ar_name")
    if kind not in OFFICE_KINDS:
        return None, "commercial", f"kind_{kind or 'none'}"
    if str(o.get("status")) != "1" or str(o.get("active")) != "1" or o.get("deleted_at"):
        return None, "commercial", "inactive_at_source"
    lic = o.get("license_data") or {}
    end_state = N.ad_expiry_state(o.get("license_end_date") or lic.get("endDate"), today)
    if end_state != "live":
        return None, "commercial", f"ad_end_date_{end_state}"
    if lic.get("isHalted"):
        return None, "commercial", "rega_licence_halted"
    deal = _DEALS.get((lic.get("advertisementType") or "").strip())
    if not deal:
        return None, "commercial", "no_deal_stated"
    transaction_type = "Rent" if deal == "Rent" else "Buy"
    ptype = N.map_type_exact("مكتب")

    loc = o.get("location") or {}
    city_ar = (loc.get("city") or (lic.get("location") or {}).get("city") or "").strip()
    city_id, region_id = to_catalog(city_ar, region_hint=loc.get("region")) if city_ar else (None, None)
    if not city_id:
        return None, "commercial", "city_not_in_catalog"
    nb = (loc.get("neighborhood") or (lic.get("location") or {}).get("district") or "").strip() or None
    district_ar = find_district_in_text(nb, city_id) if nb else None

    title, desc = o.get("title") or "", o.get("description") or ""
    price, label = _price(o)
    price_total = price_annual = rent_period = None
    if price and transaction_type == "Rent":
        rent_period, price_annual = N.rent_period_from_ad(
            price, desc, {"سنوي": "annual", "شهري": "monthly"}.get(label or ""), title)
    elif price:
        price_total = price
    utils = {(u.get("code") or "") for u in o.get("property_utilities") or []}
    photos = [f"https://backend.maktab.sa/{p}" for p in dict.fromkeys(
        [o.get("main_image")] + [f.get("path") for f in o.get("ads_files") or [] if f.get("type_file") == "image"]) if p]
    area = N.to_int(str(o.get("space") or "").split(".")[0])
    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{o['id']}",
        "listing_url": f"{SITE}/details/{o['id']}",
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title) or None,
        "description": redact_pii(desc[:4000]) or None,
        "property_type": ptype,
        "transaction_type": transaction_type,
        "city": N.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": nb,
        "area_m2": area if area and area > 0 else None,
        "furnished": OFFICE_KINDS[kind],
        "electricity": True if "Electricity" in utils else None,
        "water_supply": True if "Waters" in utils else None,
        "street_width_m": N.one_street_width(str(o.get("street_width") or "")),
        "property_age": N.exact_age((o.get("property_age") or {}).get("name_ar")),
        "license_number": o.get("license_number") or lic.get("adLicenseNumber"),
        "license_expiry": o.get("license_end_date") or lic.get("endDate"),
        "price_total": price_total,
        "price_annual": price_annual,
        "rent_period": rent_period,
        "photo_urls": photos[:20],
        "additional_info": redact_capture({k: v for k, v in {
            "office_kind_ar": kind, "price_period_label": label, "price_raw": price,
            "ad_licence_url": o.get("ad_license_url"), "licence_created": o.get("license_create_date"),
            "brokerage_licence": lic.get("brokerageAndMarketingLicenseNumber"),
            "advertiser_type": o.get("advertiser_type"), "ref_number": o.get("ref_number"),
            "street": loc.get("street"), "latitude": loc.get("lat"), "longitude": loc.get("lng"),
        }.items() if v not in (None, "", [])}),
        # names/phones in license_data + viewer_* are never copied (PDPL)
        "source_capture": redact_capture({"schema": "maktab.api.v1", "id": o["id"], "category": kind,
                                          "ads_prices": o.get("ads_prices"), "space": o.get("space"),
                                          "license_end_date": o.get("license_end_date"),
                                          "advertisementType": lic.get("advertisementType")}),
    }
    row["price_evidence"] = N.price_evidence(
        field="ads_prices[].price", raw=f"{price} {label or ''}".strip() if price else None,
        stored=price_total or price_annual, kind="annual" if price_annual else "total", unit="total",
        origin="api", authoritative_absent=False)
    return row, N.category_for_type(ptype).lower(), ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="all")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    s = cc.Session()
    offices, complete = fetch_all(s)
    print(f"{SOURCE}: {len(offices)} record(s) from its public feed (complete={complete})", flush=True)
    run_id = None if a.dry_run else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        for o in offices:
            row, cat, why = map_office(o)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
            else:
                (com if cat == "commercial" else res).append(row)
        print("  skipped (never guessed): " + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items())), flush=True)
        if a.dry_run:
            for row in res + com:
                print("   ", json.dumps({k: row.get(k) for k in ("ad_number", "price_annual", "rent_period", "city_ar",
                      "district_ar", "neighborhood", "area_m2", "furnished", "license_expiry")}, ensure_ascii=False))
            return 0
        db.upsert_maktab_residential_batch(res)
        db.upsert_maktab_commercial_batch(com)
        db.retire_superseded_siblings(res_table=RES_TABLE, com_table=COM_TABLE, res_ads={r["ad_number"] for r in res},
                                      com_ads={r["ad_number"] for r in com}, source=SOURCE)
        for tbl, rr in ((RES_TABLE, res), (COM_TABLE, com)):
            if complete:
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows", flush=True)
                elif n:
                    print(f"  pruned {n} from {tbl}", flush=True)
        if not complete:
            print("  NOT pruning: the feed's total did not match what was read", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(offices), rows_upserted=len(res) + len(com),
                             check_tables=[RES_TABLE, COM_TABLE])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted", flush=True)
        return 0
    except Exception as e:  # noqa: BLE001
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=len(offices), rows_upserted=0, notes=str(e)[:300])
        raise


if __name__ == "__main__":
    raise SystemExit(main())
