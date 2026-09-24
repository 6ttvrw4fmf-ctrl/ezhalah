"""يمين العقارية (yameen.sa) — a Riyadh brokerage on the Nuzul SaaS platform (tenant 4561).

SAME ENGINE AS scrapers/goldendeal/run.py — read that docstring for the API shape, the ten traps and
the removal-oracle law; only the Tenant constants and this main() live here. Everything below was
MEASURED live on 2026-09-23 over the whole catalogue (27 items).

TENANT HOST IS NOT THE SITE NAME. The page's own RSC payload prints «tenantUrl: meteen.nzl-backend.com»
— not yameen.* — and that host serves the catalogue: one page of 27 (meta.total 27 = the page
footer's «عرض 9 من 27 العقارات»). The site's page titles read «يمين الركيزة العقارية»; SOURCE is the
manifest's official name «يمين العقارية» (REPORTED in open_issues for the owner to confirm).

MEASURED 2026-09-23 (27 items):
    availability   13 available · 12 rented · 2 unavailable   → only 13 are publishable; the 14
                   retired-in-place items are skipped as status_rented / status_unavailable and
                   read as GONE by the oracle (3/3 rented ids answer HTTP 200 with status rented).
    types          villa_apartment 8 · floor 5 · land 5 · villa 4 · building_apartment 2 ·
                   townhouse 2 · duplex 1        purpose: rent 21 · sell 6     category: residential 27
    cities         الرياض 23 · القويعية 1 · الدرعية 1 · مكة المكرمة 1 · شقراء 1
    rent shapes    semi-annual+annual 8 · monthly-only 7 · monthly+semi+annual 3 · all four 1 ·
                   annual-only 1 · quarterly+semi+annual 1 · (6 selling)  — docstring trap 2 of the
                   engine: an annual figure is stored verbatim, monthly-only ×12 tagged monthly.
    fields         description_ar 27/27 · area 15 · bedrooms 22 · photos 27 · rega_ad_number 27 ·
                   district 27 · amenities[] 0 · year_built: null 5 / "0" 4 / a year 18
    oracle         live 3/3 → 200 available · cross-tenant (goldendeal ids) 3/3 → 404
                   «No query results…» · web page for a rented id → 200 full listing (never gone)
    listing_url    https://www.yameen.sa/properties/{id} — fetched 43065: 200, the listing's own
                   RealEstate JSON-LD and title («شقة في فيلا للإيجار في حي النظيم, الرياض»).
    sitemap.xml    9 ids, all in the API — stale/partial, not the catalogue.

MEASURED COVERAGE 2026-09-24 (re-measured after the trap-11 test was added, against the REAL
catalog — not a stub): 11 mapped (10 residential + 1 commercial: the duplex); skipped 16 =
status_rented 12, status_unavailable 2, city_not_in_catalog 1 («القويعية» is a same-name twin
across regions in the catalog and the API publishes no region — an honest skip, never a guess;
REPORTED), deal_conflict 1 (id 48429: purpose=rent, name_ar «فيلا للبيع» — trap 11). Rent 6
(annual 4, monthly 2) / Buy 5.
    title 11  description 11  city_id 11  district_ar 10  photo_urls 11  license_number 4 (the
    other 7 carry «.» in rega_ad_number → NULL)  price_total 5  price_annual 6  rent_period 6
    area_m2 7  bedrooms 7  bathrooms 7  halls 7  reception_rooms_majlis 6  floor_number 2
    property_age 4  direction 5  street_width_m 0  latitude 11  electricity/water/sanitation 11
    furnished/elevator/parking/kitchen/AC/maid/driver/balcony 7 (4 land rows carry none)
    PII: 0 free-text hits; 8 of 11 descriptions carry a «[redacted]» marker (phones typed in prose).

    python -m scrapers.yameen.run --type all --limit 10 --dry-run   # validate, zero DB writes
    python -m scrapers.yameen.run --type all                        # full crawl + prune
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db  # noqa: E402
from scrapers.goldendeal.run import (  # noqa: E402
    Tenant, crawl, make_canary, map_listing as _map_listing, print_dry, session as _session,
    tally_str, verify_gone_for)

TENANT = Tenant("yameen", "يمين العقارية", "YMN", "https://www.yameen.sa", "meteen.nzl-backend.com")
BASE = TENANT.base
SOURCE = TENANT.source
PREFIX = TENANT.prefix
PLATFORM = TENANT.platform
RES_TABLE = "yameen_residential_listings"
COM_TABLE = "yameen_commercial_listings"


def session():
    return _session(TENANT)


def map_listing(L: dict, tenant: Tenant = TENANT, **kw):
    row, cat, why = _map_listing(L, tenant, **kw)
    if row:
        # The engine already wrote "Buy"/"Rent"; it is RESTATED here as a total expression because
        # the fleet's null-deal lint (test_deal_mapping_total) proves totality per writer FILE, and
        # this file is the writer for yameen's tables. Same value, provable where it is scanned.
        row = {**row, "transaction_type": "Rent" if row["transaction_type"] == "Rent" else "Buy"}
    return row, cat, why


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run(PLATFORM)
    skipped: dict[str, int] = {}
    try:
        items, total, res, com, skipped = crawl(s, TENANT, limit=args.limit, mapper=map_listing)
        if not items:
            raise RuntimeError("API returned no items (0 of an expected ~27)")
        complete = not args.limit and total is not None and len(items) == total
        note = f"{len(items)} items, api total {total}"
        print(f"{SOURCE}: {note}", flush=True)
        if not args.limit and not complete:
            print(f"  ! crawl/total mismatch: enumerated {len(items)} vs api total {total}")
        if args.type != "all":
            res, com = (res if args.type == "residential" else []), (com if args.type == "commercial" else [])
        tally = tally_str(skipped)
        if tally:
            print(f"  skipped (not guessed): {tally}")
        if dry:
            print_dry(SOURCE, res, com)
            return 0
        # The public upsert_yameen_*_batch wrappers are added centrally later; the private batch
        # writer is the same code path every wrapper delegates to.
        db._wasalt_batch(RES_TABLE, res)
        db._wasalt_batch(COM_TABLE, com)
        superseded = db.retire_superseded_siblings(
            res_table=RES_TABLE, com_table=COM_TABLE,
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        degraded = False
        if args.type == "all" and complete:
            control = next((int(r["ad_number"][len(PREFIX):]) for r in res + com), None)
            verify = verify_gone_for(TENANT, make_canary(TENANT, control))
            for table, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                pruned = db.prune_unseen(table, {r["ad_number"] for r in rows}, SOURCE,
                                         verify_gone=verify)
                degraded = degraded or pruned < 0
                print(f"  {table}: pruned {pruned}")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(items),
                             rows_upserted=len(res) + len(com), degraded=degraded,
                             notes=f"{note}; skipped: {tally or 'none'}"[:300],
                             check_tables=["yameen_residential_listings",
                                           "yameen_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=f"{e}; skipped: {tally_str(skipped) or 'none'}"[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
