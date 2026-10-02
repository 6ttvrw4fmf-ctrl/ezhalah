"""Aqar COMMERCIAL scraper orchestrator → writes to `aqar_commercial_listings`.

Mirrors run_residential.py but sweeps the 10 commercial types (shop, office, warehouse,
workshop, factory, hotel, gas_station, health_center, farm, commercial_building) × rent+buy.
The page enricher is shared with residential (it extracts generic fields — price, area, city,
photos, etc.); commercial-only differences (no bedrooms) just come back as None, which is fine.

Usage (from ezhalah-app/ with the venv active):
    # One slice — shops for rent in Riyadh, 10 listings (sanity check)
    python -m scrapers.aqar.run_commercial --type shop --deal rent --city riyadh --limit 10

    # All commercial types × rent+buy for one city
    python -m scrapers.aqar.run_commercial --all-commercial --city riyadh --pages 30
"""
from __future__ import annotations

import argparse
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

# Make the scrapers/ folder importable when running with `python -m`.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.aqar import discover as D
from scrapers.aqar.enrich_residential import enrich_residential  # generic page enricher (shared)
from scrapers.aqar.paced_fill import PacedFill, run_key
from scrapers.common import db
from scrapers.common.emptiness import SliceOutcome, run_may_allow_empty


WORKERS = int(os.environ.get("SCRAPE_WORKERS", "6"))


def scrape_slice(type_key: str, deal_key: str, city_key: str, *, max_pages: int, start_page: int = 1,
                 max_listings: int, fill: Optional[PacedFill] = None) -> tuple[int, int, Optional[SliceOutcome]]:
    print(f"\n── {type_key.upper():<14} {deal_key.upper():<4} {city_key.upper():<8} "
          f"(pages {start_page}–{max_pages}, limit≤{max_listings}, workers={WORKERS})")
    outcome = SliceOutcome()
    try:
        urls = list(D.discover(type_key, deal_key, city_key, max_pages=max_pages, start_page=start_page,
                               max_listings=max_listings, outcome=outcome))
    except KeyError:
        print(f"   (no Aqar slug for {type_key}/{deal_key} — skipping)")
        return 0, 0, None

    seen = len(urls)
    if fill is not None and fill.active:
        fill.note_walk(outcome, start_page, max_pages)
        urls = fill.select(urls)
        print(f"   paced fill: {seen} on the source's pages → enriching {len(urls)} {fill.stats}")
    counter = {"done": 0, "upserted": 0}
    lock = threading.Lock()

    def work(idx_url: tuple[int, str]) -> None:
        i, url = idx_url
        row = enrich_residential(url, type_slug=type_key, deal_slug=deal_key)
        if not row:
            with lock:
                counter["done"] += 1
                print(f"   [{counter['done']}/{seen}] ✗ skipped — {url[-50:]}")
            return
        try:
            db.upsert_aqar_commercial(row)
            with lock:
                counter["done"] += 1
                counter["upserted"] += 1
                print(f"   [{counter['done']}/{seen}] ✓ ad={row['ad_number']} | {row.get('property_type')} | "
                      f"{row.get('city')} | price_y={row.get('price_annual')} price_t={row.get('price_total')} "
                      f"area={row.get('area_m2')}m²")
        except Exception as e:
            with lock:
                counter["done"] += 1
                print(f"   [{counter['done']}/{seen}] ✗ upsert failed: {str(e)[:120]}")

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(work, enumerate(urls)))

    return seen, counter["upserted"], outcome


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--type",  default="shop", choices=sorted(D.COMMERCIAL_TYPES))
    p.add_argument("--deal",  default="rent", choices=["rent", "buy"])
    p.add_argument("--city",  default="riyadh", choices=sorted(D.CITY_AR.keys()))
    p.add_argument("--pages", type=int, default=1,
                   help="LAST paginated search page per slice (inclusive); 0 = every page the source has")
    p.add_argument("--start-page", type=int, default=1, help="FIRST page per slice (inclusive) — batched deep scraping, e.g. --start-page 26 --pages 50 = pages 26–50")
    p.add_argument("--limit", type=int, default=10, help="max listings per slice (0 = no cap)")
    p.add_argument("--all-commercial", action="store_true",
                   help="ignore --type/--deal; sweep all commercial types × rent+buy")
    p.add_argument("--new-budget", type=int, default=-1,
                   help="max NEW rows this whole workflow run may add (shared, see run_residential.py); "
                        "-1 = unlimited (the sweeps)")
    p.add_argument("--refresh-after-days", type=int, default=0,
                   help="re-enrich a held active ad only once its last capture is this old; 0 = always")
    args = p.parse_args()

    run_id = db.begin_run("aqar_commercial")
    fill = PacedFill("aqar_commercial_listings", new_budget=args.new_budget,
                     refresh_after_days=args.refresh_after_days, key=run_key("aqar_commercial"))
    total_seen = 0
    total_upserted = 0
    outcomes: list[SliceOutcome] = []

    try:
        if args.all_commercial:
            for t in D.COMMERCIAL_TYPES:
                for d in ("rent", "buy"):
                    if (t, d) not in D.CATEGORIES:
                        continue
                    s, u, o = scrape_slice(t, d, args.city, max_pages=args.pages, start_page=args.start_page,
                                           max_listings=args.limit, fill=fill)
                    total_seen += s
                    total_upserted += u
                    if o is not None:
                        outcomes.append(o)
        else:
            s, u, o = scrape_slice(args.type, args.deal, args.city, max_pages=args.pages,
                                   start_page=args.start_page, max_listings=args.limit, fill=fill)
            total_seen, total_upserted = s, u
            if o is not None:
                outcomes.append(o)
        ok = True
        notes = None
    except Exception as e:
        ok = False
        notes = str(e)[:500]
        print(f"\n✗ FATAL: {e}")
    finally:
        # Capture end_run()'s EFFECTIVE ok (see scrapers/common/db.py's RC-B guard docstring) —
        # a bare `db.end_run(...)` call here would discard a demotion (0-row shard, a tripped
        # floor, a check_tables integrity trip) and this process would still exit 0, exactly the
        # dealapp #343 incident (fixed in PR #363) reproduced fleet-wide minus this file and
        # run_residential.py, which used `ok=ok` (a variable, not the `ok=True` literal
        # test_scraper_fleet_end_run_return_captured.py's AST check was matching) and slipped
        # through that pass undetected.
        # Same emptiness rule as run_residential.py: a town with no commercial ads at all is healthy
        # ONLY when every slice rendered aqar's own «لا توجد نتائج». Needed now that the commercial
        # fill runs on a schedule over all 95 towns, many of which publish no commercial ads.
        allow_empty = ok and run_may_allow_empty(outcomes)
        if allow_empty:
            notes = ((notes + " | ") if notes else "") + "source-published empty (all slices proven)"
        n_ignored = sum(1 for o in outcomes if o.city_filter_ignored)
        if n_ignored:
            notes = ((notes + " | ") if notes else "") + f"city_filter_ignored={n_ignored}"
        if fill.notes():
            notes = ((notes + " | ") if notes else "") + fill.notes()
        healthy = db.end_run(run_id, ok=ok, rows_seen=total_seen, rows_upserted=total_upserted, notes=notes,
                             allow_empty=allow_empty, check_tables=["aqar_commercial_listings"])

    print(f"\n📊 Done. {total_upserted}/{total_seen} upserted across all slices. (run_id={run_id})")
    if ok and not healthy:
        print("✗ run demoted to unhealthy by end_run()'s RC-B guard — failing CI instead of a silent success.", flush=True)
    # Exit 0 only when the run COMPLETED cleanly AND end_run() did not demote it. A small town
    # with zero commercial inventory is a valid result, not a failure — but a demotion (0-row/
    # dead-source, tripped floor, degraded integrity check) must redden CI.
    # (was `0 if total_upserted else 1`, which falsely marked empty-town shards as "failure".)
    return 0 if (ok and healthy) else 1


if __name__ == "__main__":
    raise SystemExit(main())
