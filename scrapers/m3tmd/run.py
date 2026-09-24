"""مقر المعتمد — www.m3tmd.com. Onboarding 2026-09-24. Nuzul tenant #2 (see scrapers/jawher/run.py
for the platform reading, which this file imports: same build, same JSON API, same traps).

MEASURED 2026-09-24 (live API, every id fetched):
  · Catalogue: GET /api/public/v2/properties → meta.total = 46 (footer «عرض 9 من 46»); the sitemap
    and the HTML list stop at the first 9 — the manifest's «9» is that first page. 46/46 detail
    records fetched. All 46 purpose=sell, product=office, availability_status=available.
  · Types: land 30, villa 10, building 4, floor 1, townhouse 1. Land-use flags: 21 residential-only,
    19 commercial-only (→ «أرض تجارية»/«عمارة تجارية»), 6 both (base type kept).
  · PRICE: selling_price on 25/46; the other 21 sale rows publish NO price (the page shows no
    figure; 37109's description says «سعر المتر 2000 ريال» — prose, never read as a price) →
    price_total AUTHORITATIVE_NULL with authoritative_absent evidence. ONE of the 21 is a stored
    ZERO, not a null: 37096 carries selling_price 0 / price 0 / price_label "0.00" — the
    platform's not-set sentinel (the page prints no price, no «ريال», measured 2026-09-24), so it
    is the same authoritative NULL; the raw 0 stays auditable in price_evidence.raw and
    additional_info.price_label. It is never a skip and never a 0-riyal price.
  · LOCATION: city «الخرج» on 38/46; 8 records carry no city → skipped `no_city`. Districts are
    catalogued (الهدا/الورود/الجامعة/العزيزية/مشرف all resolve for الخرج).
  · LICENCE: rega_ad_number 0/46 (the page prints «رقم الاعلان … لا يوجد»); the office's FAL
    licence 1200019707 is in every record → additional_info.fal_licence_number, never
    license_number. unit_number == id on this tenant.
  · is_wafi_ad on 1/46 (37993) → `off_plan_wafi`. Photos: cover only (images[] empty on 46/46).
  · Removal oracle (this host): gone 37985 / 1 / 99999999 → 404 JSON 3/3; live 37993 / 37767 /
    37614 → 200 with data.id + available 3/3; the HTML route soft-404s with 200 «Property Not
    Found». 46/46 are available today, but the platform keeps sold/reserved/unavailable rows
    served with a badge (jawher: 94/145), so the shared oracle reads availability_status: a 200
    for THIS id that is not «available» is GONE (fix 2026-09-24, see scrapers/jawher/run.py).
  · COVERAGE (full --dry-run): mapped 37 = 29 residential + 8 commercial (the office filed 8 lands
    «تجاري»); skipped 9: no_city 8, off_plan_wafi 1. price_total 20 + 17 authoritative NULL ·
    area 37/37 · district 37/37 · photos 37/37 · direction 31 · street_width 25 · bedrooms 7/7
    dwellings · elevator 2 · parking 4 · kitchen 7 · maid 3 · driver 1 · electricity 15 · water 7
    sanitation 10 · lat/long 36 · description 19. Not published: ad licence, property_age, floor.
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

BASE = "https://www.m3tmd.com"
SOURCE = "مقر المعتمد"
PREFIX = "MQR"
SLUG = "m3tmd"


def map_listing(d: dict[str, Any]) -> tuple[Optional[dict[str, Any]], str, str]:
    """(row, category, skip_reason). row is None exactly when skip_reason is set."""
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
        print(f"{SOURCE}: {len(ids)} listings discovered (complete={complete})", flush=True)
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
                      f"rp={r0.get('rent_period')} ph={len(r0.get('photo_urls') or [])}")
            return 0
        # The public upsert_m3tmd_{residential,commercial}_batch wrappers are added centrally later.
        db._wasalt_batch("m3tmd_residential_listings", res)
        db._wasalt_batch("m3tmd_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table="m3tmd_residential_listings", com_table="m3tmd_commercial_listings",
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = make_verify_gone(BASE, PREFIX, SLUG, (res + com)[0] if (res or com) else None)
            for tbl, rows in (("m3tmd_residential_listings", res), ("m3tmd_commercial_listings", com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        healthy = db.end_run(run_id, ok=True, rows_seen=len(ids),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} {notes}"[:300],
                             check_tables=["m3tmd_residential_listings",
                                           "m3tmd_commercial_listings"])
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
