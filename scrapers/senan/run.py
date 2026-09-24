"""سنان العقارية — www.senanrealestate.sa. Onboarding 2026-09-24. Nuzul tenant #3 (see
scrapers/jawher/run.py for the platform reading, which this file imports).

A DEVELOPER SITE: 77 «مشاريع» (projects), each selling individually priced UNITS. The owner's grain
rule for such sites — EACH PRICED UNIT is one listing, a project with no priced unit is skipped —
is met by enumerating the UNITS directly, because on this platform every unit is itself a property
record with its own /properties/<id> page (the page a user lands on: «ضمن مشروع X», unit price,
area, rooms, REGA licence line). MEASURED 2026-09-24 (live API, every id fetched):
  · /api/public/v2/projects → 77 projects (72 available, 3 unavailable, 2 sold). Opening all 77:
    74 carry property_cards, 77 distinct unit ids, 0 unpriced. /api/public/v2/properties → 82
    records: the 77 project units PLUS 5 standalone properties (41522, 42533, 42543, 42793,
    42852). Units ⊆ properties, so the properties route IS the complete unit catalogue and the
    project walk adds nothing but the name — which every unit record already carries in its own
    `projects` field (77/82) → additional_info.project. The manifest's «77» counted projects.
  · sitemap.xml lists 9 properties + 9 projects (the first list page each) — stale, never used.
  · Apex senanrealestate.sa 301s to www AND drops the path (/projects → /); BASE is the www host.
  · All 82 purpose=sell, product=office. Statuses: 75 available, 3 sold, 4 unavailable (a sold
    unit stays published with a «مباعة» badge → skipped `status_sold`). is_wafi_ad 1/82.
  · Types: building_apartment 47 («شقة في عمارة» → Apartment), townhouse 26 (→ Villa, the fleet's
    Townhouse fold), villa 5, floor 4. bedrooms 81/82, bathrooms 82/82, area 79/82 (+9 built_up_
    area, used as the printed م² when `area` is null — unit 44630 prints 438 م² from it).
  · PRICE: selling_price 82/82 (the unit price the page prints, e.g. 44630 «1,280,000 سعر البيع»).
    Project pages also print a prose price table («فيلا 1 - 10 السعر 1٫280٫000 …») — never read.
  · LOCATION: cities ابها 32 / خميس مشيط 21 / احد رفيده 11 all resolve through to_catalog (hamza-
    and taa-marbuta-insensitive). 18/82 records carry NO city → skipped `no_city`. Each of those
    does carry the site's city TAG («ابها»/«خميس مشيط»/«احد رفيدة») and a project with a city;
    using either is an owner decision (open issue), not a default.
  · LICENCE: rega_ad_number 0/82 («لا يوجد»); the FAL licence 1200017563 on 74/82 → additional_info.
  · Removal oracle (this host): gone 44629 (archived: 404 {"message":""}) / 1 / 99999999 → 404
    JSON 3/3; live 44630 / 45254 / 41522 → 200 with data.id + available 3/3; HTML soft-404s with
    200. STATUS DEATH (measured 2026-09-24): sold 41223 / 41222 / 44628 and unavailable 44610 /
    44591 / 44579 all still answer 200 with data.id and their status (6/6) — the shared oracle
    reads availability_status, so a 200 for THIS unit that is not «available» is GONE (fix
    2026-09-24, see scrapers/jawher/run.py); the first build would have self-healed a sold unit.
  · COVERAGE (full --dry-run): mapped 57 units, all residential (Apartment 31, Villa 23, Floor 3);
    skipped 25: no_city 17, status_unavailable 4, status_sold 3, off_plan_wafi 1. price_total
    57/57 · area 57/57 · district 52/57 (المربع/التضامن/مخطط الموسى not catalogued; raw kept) ·
    photos 57/57 · bedrooms 56 · bathrooms 57 · halls 56 · majlis 56 · elevator 41 · parking 49
    kitchen 55 · maid 39 · driver 7 · electricity 57 · water 54 · sanitation 55 · floor_number 4
    direction 4 · street_width 5 · description 46 · project 52/57. Not published: ad licence,
    property_age, furnished, coordinates (0/82).
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db  # noqa: E402
from scrapers.jawher.run import (  # noqa: E402
    API_PATH, ORACLE, fetch_detail, fetch_ids, make_verify_gone, nuzul_fields, session,
)

BASE = "https://www.senanrealestate.sa"
SOURCE = "سنان العقارية"
PREFIX = "SNN"
SLUG = "senan"


def map_listing(d: dict[str, Any]) -> tuple[Optional[dict[str, Any]], str, str]:
    """(row, category, skip_reason) for ONE UNIT record. row is None exactly when skip_reason is set."""
    fields, category, why = nuzul_fields(d)
    if not fields:
        return None, category, why
    row = {
        "ad_number": f"{PREFIX}{d['id']}",
        "listing_url": f"{BASE}/properties/{d['id']}",
        "source": SOURCE,
        "transaction_type": "Rent" if d.get("purpose") == "rent" else "Buy",
        **fields,
    }
    return row, category, ""


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
    skipped: dict[str, int] = {}
    try:
        ids, complete = fetch_ids(s, BASE, limit=args.limit)
        if not ids:
            raise RuntimeError(f"{BASE}{API_PATH} returned no properties")
        print(f"{SOURCE}: {len(ids)} units discovered (complete={complete})", flush=True)
        for i, pid in enumerate(ids, 1):
            d, verdict = fetch_detail(s, BASE, pid)
            if d is None:
                skipped[f"fetch_{verdict}"] = skipped.get(f"fetch_{verdict}", 0) + 1
                continue
            row, cat, why = map_listing(d)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            db.mark_direct_alive(row, oracle=ORACLE)
            (com if cat == "commercial" else res).append(row)
            if args.delay:
                time.sleep(args.delay)

        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}")
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>9} {r0['transaction_type']:4} {str(r0['property_type']):16} "
                      f"{str(r0['city_ar']):10} d={str(r0['district_ar'])[:12]:12} "
                      f"a={str(r0['area_m2']):>6} bd={str(r0['bedrooms']):>4} "
                      f"pt={r0.get('price_total')} pa={r0.get('price_annual')} "
                      f"rp={r0.get('rent_period')} ph={len(r0.get('photo_urls') or [])} "
                      f"prj={str((r0.get('additional_info') or {}).get('project', {}).get('name_ar'))[:18]}")
            return 0
        # The public upsert_senan_{residential,commercial}_batch wrappers are added centrally later.
        db._wasalt_batch("senan_residential_listings", res)
        db._wasalt_batch("senan_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="senan_residential_listings", com_table="senan_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = make_verify_gone(BASE, PREFIX, SLUG, (res + com)[0] if (res or com) else None)
            for tbl, rows in (("senan_residential_listings", res), ("senan_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=len(ids),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} {notes}"[:300],
                             check_tables=["senan_residential_listings",
                                           "senan_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
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
