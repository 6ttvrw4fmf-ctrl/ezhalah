"""Aqar scraper orchestrator.

Usage (from the scrapers/ folder, with the venv active):

    python -m aqar.run --type apartment --deal rent --city riyadh --limit 10

Discovers listing URLs from one paginated search page, enriches each into the
canonical schema, upserts to Supabase, and logs a row in `scrape_runs`.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Make the scrapers/ folder importable when running with `python -m aqar.run` OR
# `python aqar/run.py`. Same trick the other scrapers use later.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.aqar import discover as D, enrich as E
from scrapers.common import db


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--type",  default="apartment", choices=sorted({k[0] for k in D.CATEGORIES}))
    p.add_argument("--deal",  default="rent",      choices=sorted({k[1] for k in D.CATEGORIES}))
    p.add_argument("--city",  default="riyadh",    choices=sorted(D.CITY_AR.keys()))
    p.add_argument("--pages", type=int, default=1, help="how many paginated search pages to walk")
    p.add_argument("--limit", type=int, default=10, help="cap on total listings enriched this run")
    args = p.parse_args()

    print(f"▶ Aqar scrape — type={args.type} deal={args.deal} city={args.city} pages={args.pages} limit={args.limit}")
    run_id = db.begin_run("aqar")

    seen = 0
    upserted = 0
    try:
        for url in D.discover(args.type, args.deal, args.city, max_pages=args.pages, max_listings=args.limit):
            seen += 1
            print(f"  [{seen}/{args.limit}] {url[-60:]}")
            row = E.enrich(url)
            if not row:
                print("      ✗ skipped (no usable data)")
                continue
            try:
                db.upsert_listing(row)
                upserted += 1
                print(f"      ✓ upserted (price={row.get('price')}, size={row.get('size_m2')}m², beds={row.get('bedrooms')})")
            except Exception as e:
                print(f"      ✗ upsert failed: {e}")
        ok = True
        notes = None
    except Exception as e:
        ok = False
        notes = str(e)
        print(f"✗ FATAL: {e}")
    finally:
        db.end_run(run_id, ok=ok, rows_seen=seen, rows_upserted=upserted, notes=notes)

    print(f"\n📊 Done. {upserted}/{seen} upserted. (run_id={run_id})")
    return 0 if upserted else 1


if __name__ == "__main__":
    raise SystemExit(main())
