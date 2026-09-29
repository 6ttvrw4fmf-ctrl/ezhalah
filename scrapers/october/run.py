"""1 October Real Estate (www.1october.com.sa / 1 أكتوبر العقارية) — Jeddah/Makkah brokerage.

A Nuzul SaaS tenant (tenant 6269), the same product as jawher/m3tmd/senan. The platform reading —
catalogue walk, detail record, the `available` gate, the removal oracle — lives ONCE in
scrapers/jawher/run.py and is imported here; this file adds only october's identity, the columns
its OLDER tables lack, and its main().

WHY THIS WAS REWRITTEN (coverage audit 2026-09-28). The old reader walked the JSON-LD ItemList on
the /properties HTML page. Nuzul ignores ?page= on that route, so it only ever saw the first 9 of
the API's meta.total = 18, and it never read availability_status. Result, that day: 8 of 12 active
rows were rented/sold/reserved at the source (44240 sold; 46582 46362 46338 46023 45996 44471
rented; 45830 reserved), and the available 44236 was never seen. The API lists sold/rented units
with their status (18 = 5 available + 11 rented + 1 reserved + 1 sold), so:
  · a status other than `available` is SKIPPED (the shared gate), and
  · because this run just fetched THAT unit's own record and read the status, the row is pinned
    inactive through the shared sold-pin law (positive source evidence, not absence), and
  · prune_unseen gets make_verify_gone() for anything that leaves the catalogue altogether.

IDENTITY IS UNCHANGED: ad_number = OCT<id>, listing_url = BASE/properties/<id>, source «1 October»,
same tables — every existing row keeps its key.

OCTOBER-ONLY DIFFERENCES FROM THE PLATFORM READING
  · Types «كشك» → Kiosk and «صراف آلي» → ATM Site (the 2026-09-28 decision that took 52959/52960
    off «غير معروف»); every other Nuzul tenant still skips them ask-first.
  · bedrooms stays NULL (owner decision 2026-07-28 for this platform). Measured on the API
    2026-09-28: 45056 carries bedrooms=5 while its own description says «3 غرف نوم», and the page
    labels that counter «غرفة» / «عدد الغرف» — a total-room count, not bedrooms.
  · october_*_listings predate the fleet's Arabic/location columns: city_ar, city_id, region_id,
    district_ar, floor_number, license_number, furnished (and 11 more) do not exist there
    (information_schema, 2026-09-28). A key PostgREST cannot place kills the whole upsert
    (PGRST204), so those keys are dropped here; the raw record stays in source_capture.
    `region` (which these tables DO have) is filled from the city, as before.
  · No mark_direct_alive(): october is registered CRAWL_PRESENCE_ONLY (ops_liveness_registry), and
    a verified-alive stamp on that tier is a false claim. Re-tiering it to CANDIDATE_PLUS_DIRECT
    like m3tmd is a registry migration, then this call can be added.

  python -m scrapers.october.run --dry-run     # fetch + map, nothing written
  python -m scrapers.october.run --type all    # full run: upsert, pin, prune
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize, sold_pin  # noqa: E402
from scrapers.jawher.run import (  # noqa: E402
    API_PATH, fetch_detail, fetch_ids, make_verify_gone, nuzul_fields, session,
)

BASE = "https://www.1october.com.sa"
SOURCE = "1 October"
PREFIX = "OCT"
SLUG = "october"

_TYPE_OVERRIDES = {"كشك": "Kiosk", "صراف آلي": "ATM Site"}
# LISTING_COLUMNS (test_scraper_rows_only_use_real_columns) minus october's real columns.
_NOT_ON_OCTOBER_TABLES = frozenset({
    "ad_source", "city_ar", "city_id", "deed_area_m2", "discount_pct", "district_ar",
    "floor_number", "fullparse_done", "furnished", "license_expiry", "license_number",
    "num_apartments", "plan_parcel", "price_original", "region_id", "reparsed_v2",
    "tenant_category", "views_count",
})


def map_listing(d: dict[str, Any]) -> tuple[Optional[dict[str, Any]], str, str]:
    """(row, category, skip_reason). row is None exactly when skip_reason is set."""
    fields, category, why = nuzul_fields(d, _TYPE_OVERRIDES)
    if not fields:
        return None, category, why
    row = {
        "ad_number": f"{PREFIX}{d['id']}",
        "listing_url": f"{BASE}/properties/{d['id']}",
        "source": SOURCE,
        "transaction_type": "Rent" if d.get("purpose") == "rent" else "Buy",
        **{k: v for k, v in fields.items() if k not in _NOT_ON_OCTOBER_TABLES},
        "region": normalize.region_for_city(fields["city"]),
        "bedrooms": None,
    }
    return row, category, ""


def _pin_sold_inactive(table: str, gone: dict[str, str], seen_ad_numbers: list[str]) -> None:
    """Pin rows whose OWN record this run read as not `available` (rented/sold/reserved/…).

    Only ids still ACTIVE in this table are pinned: a unit is enumerated every run while it stays
    listed as rented, and re-pinning an inactive row would file a fresh GONE evidence row each time.
    The table is looked up rather than derived from the type because legacy rows sit where the old
    reader put them (46023 Duplex in commercial, 45830 Warehouse in residential)."""
    active = set()
    if gone:
        q = db.sb().table(table).select("ad_number").eq("active", True).in_("ad_number", sorted(gone))
        active = {r["ad_number"] for r in (db._execute(q, what=table + ".sold_pin_select").data or [])}
    sold_pin.pin_source_confirmed_gone(
        table, sorted(active), oracle="october.sold_pin.availability_status",
        notes={a: gone[a] for a in active}, seen_ad_numbers=seen_ad_numbers)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--delay", type=float, default=0.4)
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    gone: dict[str, str] = {}          # ad_number → the status its own record stated this run
    skipped: dict[str, int] = {}
    try:
        ids, complete = fetch_ids(s, BASE, limit=args.limit)
        if not ids:
            raise RuntimeError(f"{BASE}{API_PATH} returned no properties")
        print(f"{SOURCE}: {len(ids)} listings discovered (complete={complete})", flush=True)
        for pid in ids:
            d, verdict = fetch_detail(s, BASE, pid)
            if d is None:
                skipped[f"fetch_{verdict}"] = skipped.get(f"fetch_{verdict}", 0) + 1
                continue
            row, cat, why = map_listing(d)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                if why.startswith("status_"):
                    gone[f"{PREFIX}{pid}"] = f"availability_status={why[len('status_'):]}"
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
            if args.delay:
                time.sleep(args.delay)

        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}")
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in res + com:
                print(f"   {r0['ad_number']:>9} {r0['transaction_type']:4} {str(r0['property_type']):12} "
                      f"{str(r0['city']):8} {str(r0['neighborhood'])[:14]:14} a={str(r0['area_m2']):>6} "
                      f"pt={r0.get('price_total')} pa={r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} ph={len(r0.get('photo_urls') or [])}")
            if gone:
                print(f"   would pin inactive (own record not available): {sorted(gone)}")
            return 0
        db.upsert_october_residential_batch(res)
        db.upsert_october_commercial_batch(com)
        # An ad whose category flipped this run is superseded in the table it LEFT. BEFORE the
        # prune: it reasons from positive evidence, and prune's guards would protect the orphan.
        superseded = db.retire_superseded_siblings(
            res_table="october_residential_listings", com_table="october_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        for tbl, rows in (("october_residential_listings", res), ("october_commercial_listings", com)):
            _pin_sold_inactive(tbl, gone, [r["ad_number"] for r in rows])
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = make_verify_gone(BASE, PREFIX, SLUG, (res + com)[0] if (res or com) else None)
            for tbl, rows in (("october_residential_listings", res), ("october_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=len(ids),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} {notes}"[:300],
                             check_tables=["october_residential_listings", "october_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted, {pruned} pruned")
        return 0
    except Exception as e:
        if run_id:
            tally = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=f"{e} | skips: {tally}"[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
