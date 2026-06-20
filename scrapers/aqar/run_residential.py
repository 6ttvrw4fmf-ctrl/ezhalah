"""Aqar RESIDENTIAL scraper orchestrator → writes to `aqar_residential_listings`.

Usage examples (from the ezhalah-app/ folder with the venv active):

    # Single slice — apartments for rent in Riyadh, 10 listings (sanity check)
    python -m scrapers.aqar.run_residential --type apartment --deal rent --city riyadh --limit 10

    # All 10 residential types × rent+buy × one city (the big sweep)
    python -m scrapers.aqar.run_residential --all-residential --city riyadh --pages 30

    # Everything we can reach for ONE city
    python -m scrapers.aqar.run_residential --all-residential --city riyadh --pages 50
"""
from __future__ import annotations

import argparse
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Make the scrapers/ folder importable when running with `python -m`.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.aqar import discover as D
from scrapers.aqar.enrich_residential import enrich_residential
from scrapers.common import db


# How many listing pages to enrich CONCURRENTLY. 6 workers + the 0.3s per-host start-spacing in
# http.py gives ~3 listings/sec (~6–8× the old sequential 2s-per-listing pace). Dial with the
# SCRAPE_WORKERS env var; pair a higher value with a smaller SCRAPE_MIN_INTERVAL to push harder, or
# lower both if Aqar starts rate-limiting (429s).
WORKERS = int(os.environ.get("SCRAPE_WORKERS", "6"))


def scrape_slice(type_key: str, deal_key: str, city_key: str, *, max_pages: int, max_listings: int) -> tuple[int, int]:
    print(f"\n── {type_key.upper():<10} {deal_key.upper():<4} {city_key.upper():<8} "
          f"(pages≤{max_pages}, limit≤{max_listings}, workers={WORKERS})")
    # Discovery is cheap (paginated search HTML) — collect the listing URLs first, then enrich them
    # in parallel. Discover is a generator with its own throttle, so this part stays polite too.
    try:
        urls = list(D.discover(type_key, deal_key, city_key, max_pages=max_pages, max_listings=max_listings))
    except KeyError:
        print(f"   (no Aqar slug for {type_key}/{deal_key} — skipping)")
        return 0, 0

    seen = len(urls)
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
            db.upsert_aqar_residential(row)
            with lock:
                counter["done"] += 1
                counter["upserted"] += 1
                print(f"   [{counter['done']}/{seen}] ✓ ad={row['ad_number']} | {row.get('property_type')} | "
                      f"{row.get('city')} | price_y={row.get('price_annual')} price_t={row.get('price_total')} "
                      f"area={row.get('area_m2')}m² beds={row.get('bedrooms')}")
        except Exception as e:
            with lock:
                counter["done"] += 1
                print(f"   [{counter['done']}/{seen}] ✗ upsert failed: {str(e)[:120]}")

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(work, enumerate(urls)))

    return seen, counter["upserted"]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--type",  default="apartment", choices=sorted({k[0] for k in D.CATEGORIES}))
    p.add_argument("--deal",  default="rent",      choices=sorted({k[1] for k in D.CATEGORIES}))
    p.add_argument("--city",  default="riyadh",    choices=sorted(D.CITY_AR.keys()))
    p.add_argument("--pages", type=int, default=1, help="max paginated search pages per slice")
    p.add_argument("--limit", type=int, default=10, help="max listings per slice")
    p.add_argument("--all-residential", action="store_true",
                   help="ignore --type/--deal; sweep all 10 residential types × rent+buy")
    p.add_argument("--types", default="",
                   help="comma-separated subset of residential types to sweep (× rent+buy), e.g. "
                        "'apartment,villa'. Use 'all' for every type. Lets the deep-fill SHARD a big "
                        "city across machines by type so no single job does all 10 types.")
    args = p.parse_args()

    run_id = db.begin_run("aqar_residential")
    total_seen = 0
    total_upserted = 0

    # Resolve which types to sweep. --types (subset/all) and --all-residential both mean "this type
    # set × rent+buy"; a bare --type/--deal is the single-slice path.
    type_list = None
    if args.types:
        type_list = list(D.RESIDENTIAL_TYPES) if args.types.strip() == "all" \
            else [t.strip() for t in args.types.split(",") if t.strip()]
    elif args.all_residential:
        type_list = list(D.RESIDENTIAL_TYPES)

    try:
        if type_list is not None:
            for t in type_list:
                for d in ("rent", "buy"):
                    if (t, d) not in D.CATEGORIES:
                        continue
                    s, u = scrape_slice(t, d, args.city, max_pages=args.pages, max_listings=args.limit)
                    total_seen += s
                    total_upserted += u
        else:
            s, u = scrape_slice(args.type, args.deal, args.city, max_pages=args.pages, max_listings=args.limit)
            total_seen, total_upserted = s, u
        ok = True
        notes = None
    except Exception as e:
        ok = False
        notes = str(e)[:500]
        print(f"\n✗ FATAL: {e}")
    finally:
        db.end_run(run_id, ok=ok, rows_seen=total_seen, rows_upserted=total_upserted, notes=notes)

    print(f"\n📊 Done. {total_upserted}/{total_seen} upserted across all slices. (run_id={run_id})")
    return 0 if total_upserted else 1


if __name__ == "__main__":
    raise SystemExit(main())
