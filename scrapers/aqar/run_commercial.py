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

# Make the scrapers/ folder importable when running with `python -m`.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from scrapers.aqar import discover as D
from scrapers.aqar.enrich_residential import enrich_residential  # generic page enricher (shared)
from scrapers.common import db


WORKERS = int(os.environ.get("SCRAPE_WORKERS", "6"))


def scrape_slice(type_key: str, deal_key: str, city_key: str, *, max_pages: int, start_page: int = 1, max_listings: int) -> tuple[int, int]:
    print(f"\n── {type_key.upper():<14} {deal_key.upper():<4} {city_key.upper():<8} "
          f"(pages {start_page}–{max_pages}, limit≤{max_listings}, workers={WORKERS})")
    try:
        urls = list(D.discover(type_key, deal_key, city_key, max_pages=max_pages, start_page=start_page, max_listings=max_listings))
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

    return seen, counter["upserted"]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--type",  default="shop", choices=sorted(D.COMMERCIAL_TYPES))
    p.add_argument("--deal",  default="rent", choices=["rent", "buy"])
    p.add_argument("--city",  default="riyadh", choices=sorted(D.CITY_AR.keys()))
    p.add_argument("--pages", type=int, default=1, help="LAST paginated search page per slice (inclusive)")
    p.add_argument("--start-page", type=int, default=1, help="FIRST page per slice (inclusive) — batched deep scraping, e.g. --start-page 26 --pages 50 = pages 26–50")
    p.add_argument("--limit", type=int, default=10, help="max listings per slice")
    p.add_argument("--all-commercial", action="store_true",
                   help="ignore --type/--deal; sweep all commercial types × rent+buy")
    args = p.parse_args()

    run_id = db.begin_run("aqar_commercial")
    total_seen = 0
    total_upserted = 0

    try:
        if args.all_commercial:
            for t in D.COMMERCIAL_TYPES:
                for d in ("rent", "buy"):
                    if (t, d) not in D.CATEGORIES:
                        continue
                    s, u = scrape_slice(t, d, args.city, max_pages=args.pages, start_page=args.start_page, max_listings=args.limit)
                    total_seen += s
                    total_upserted += u
        else:
            s, u = scrape_slice(args.type, args.deal, args.city, max_pages=args.pages, start_page=args.start_page, max_listings=args.limit)
            total_seen, total_upserted = s, u
        ok = True
        notes = None
    except Exception as e:
        ok = False
        notes = str(e)[:500]
        print(f"\n✗ FATAL: {e}")
    finally:
        db.end_run(run_id, ok=ok, rows_seen=total_seen, rows_upserted=total_upserted, notes=notes, check_tables=["aqar_commercial_listings"])

    print(f"\n📊 Done. {total_upserted}/{total_seen} upserted across all slices. (run_id={run_id})")
    # Exit 0 when the run COMPLETED cleanly, even if it upserted nothing — a small town with zero
    # commercial inventory is a valid result, not a failure. Only a real crash (ok=False) → exit 1.
    # (was `0 if total_upserted else 1`, which falsely marked empty-town shards as "failure".)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
