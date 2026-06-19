"""Aqar discovery sweep — the "grocery shopper" that runs across every city we care about.

This is the LIGHT recurring scrape: instead of a deep cold-start (hundreds of pages per
city), it walks the first N pages of every (city × category) combo to pick up anything
NEW since the last sweep. New listings get enriched and inserted; existing ones get their
`last_seen_at` refreshed via the upsert.

The actual scraping work is delegated to the same code path `run_residential.py` uses —
this script just iterates cities and configures the limits. Schedule it every 4 hours on
the cron and you'll never miss a fresh Aqar listing for more than ~4h.

Cron entry (every 4 hours, on the hour):
  0 */4 * * *  cd /srv/ezhalah && .venv/bin/python -m scrapers.aqar.sweep

Run locally for testing:
  python -m scrapers.aqar.sweep --cities riyadh,jeddah --pages 3
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timezone

from scrapers.aqar.discover import CATEGORIES, CITY_AR, discover, RESIDENTIAL_TYPES
from scrapers.aqar.enrich_residential import enrich_residential
from scrapers.common.db import begin_run, end_run, upsert_aqar_residential


# Major Saudi cities we have data ingestion for. Order = sweep order; first cities get
# priority if the sweep is interrupted before finishing.
DEFAULT_CITIES = ("riyadh", "jeddah", "khobar", "dammam", "mecca", "medina", "taif")


def main() -> None:
    ap = argparse.ArgumentParser(description="Aqar light discovery sweep")
    ap.add_argument("--cities", default=",".join(DEFAULT_CITIES),
                    help="Comma-separated city keys (e.g. riyadh,jeddah).")
    ap.add_argument("--pages", type=int, default=3,
                    help="Pages per (city × category) — keep low (1-3) for a fast recurring sweep.")
    ap.add_argument("--limit-per-slice", type=int, default=120,
                    help="Cap listings enriched per (city × category) per sweep.")
    args = ap.parse_args()

    cities = [c.strip() for c in args.cities.split(",") if c.strip()]
    bad = [c for c in cities if c not in CITY_AR]
    if bad:
        print(f"Unknown city key(s): {bad}. Known: {sorted(CITY_AR.keys())}")
        sys.exit(2)

    # Every (residential type × deal) we know how to scrape. Skip combos that don't exist
    # (e.g. land doesn't have a rent variant — CATEGORIES decides.)
    slices = [
        (t, d) for t in RESIDENTIAL_TYPES for d in ("rent", "buy")
        if (t, d) in CATEGORIES
    ]

    run_id = begin_run("aqar_sweep")
    seen_total = 0
    upserted_total = 0
    started = time.time()

    try:
        for city in cities:
            for type_key, deal_key in slices:
                slice_label = f"{type_key.upper():12s} {deal_key.upper():4s} {city.upper()}"
                print(f"\n— {slice_label}  (pages≤{args.pages}, limit≤{args.limit_per_slice})")
                count = 0
                for listing_url in discover(
                    type_key, deal_key, city,
                    max_pages=args.pages,
                    max_listings=args.limit_per_slice,
                ):
                    seen_total += 1
                    count += 1
                    try:
                        row = enrich_residential(listing_url, type_slug=type_key, deal_slug=deal_key)
                    except Exception as e:
                        print(f"    [{count}] ✗ enrich failed: {e}")
                        continue
                    if not row or not row.get("ad_number"):
                        continue
                    try:
                        upsert_aqar_residential(row)
                        upserted_total += 1
                    except Exception as e:
                        print(f"    [{count}] ✗ upsert failed for ad {row.get('ad_number')}: {e}")
                        continue
                    if count % 20 == 0:
                        print(f"    [{count}] upserted so far in slice: {count}")

    except KeyboardInterrupt:
        print("\nInterrupted — finalizing run row.")

    elapsed = int(time.time() - started)
    notes = f"upserted={upserted_total} cities={','.join(cities)} pages={args.pages} elapsed_s={elapsed}"
    print(f"\n✓ Sweep done. seen={seen_total} upserted={upserted_total} elapsed={elapsed}s")
    end_run(run_id, ok=True, rows_seen=seen_total, rows_upserted=upserted_total, notes=notes)


if __name__ == "__main__":
    sys.exit(main())
