"""Hard-delete dead Aqar listings older than the safety window.

Runs once a week. Removes any row in `aqar_residential_listings` that:
  • has been marked inactive by the liveness sweep (active = false), AND
  • hasn't been seen on Aqar for more than 30 days (last_seen_at < now - 30d).

The 30-day buffer is a safety net: if liveness ever has a bad day and falsely kills a real
listing, we have a month to notice and flip `active` back to true before the row is gone for
good. Once the window expires we assume the kill was correct and remove the row to keep the
database lean.

Designed to be cron-driven from GitHub Actions — once a week is plenty (a week's worth of dead
listings rarely exceeds a few thousand rows).

Run locally for testing (prints what WOULD be deleted without actually deleting):
  python -m scrapers.aqar.cleanup --dry-run

On the schedule:
  0 2 * * 0   cd /srv/ezhalah && .venv/bin/python -m scrapers.aqar.cleanup
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone

from scrapers.common.db import begin_run, end_run, sb


DEFAULT_AGE_DAYS = 30


def main() -> None:
    ap = argparse.ArgumentParser(description="Hard-delete long-dead Aqar listings")
    ap.add_argument("--age-days", type=int, default=DEFAULT_AGE_DAYS,
                    help="Delete listings inactive for at least this many days. Default 30.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Print what would be deleted, don't actually delete.")
    ap.add_argument("--table", default="aqar_residential_listings",
                    choices=["aqar_residential_listings", "aqar_commercial_listings"],
                    help="Which listings table to clean. Run once per table to cover both verticals.")
    args = ap.parse_args()

    table = args.table
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=args.age_days)).isoformat()
    client = sb()
    run_id = begin_run(f"aqar_cleanup:{table}")

    try:
        # First: count what's about to go (so the run log is meaningful + dry-run can preview).
        head = (
            client.table(table)
            .select("id", count="exact")
            .eq("active", False)
            .lt("last_seen_at", cutoff_iso)
            .limit(1)
            .execute()
        )
        total = head.count or 0
        print(f"Found {total} rows inactive for >{args.age_days} days (cutoff = {cutoff_iso}).")

        if total == 0:
            end_run(run_id, ok=True, rows_seen=0, rows_upserted=0, notes="nothing to delete")
            return

        if args.dry_run:
            print("Dry run — no rows deleted.")
            end_run(run_id, ok=True, rows_seen=total, rows_upserted=0, notes="dry run")
            return

        # Page through in chunks so an enormous backlog doesn't hammer the API in one shot.
        deleted = 0
        PAGE = 1000
        while True:
            picks = (
                client.table(table)
                .select("id")
                .eq("active", False)
                .lt("last_seen_at", cutoff_iso)
                .limit(PAGE)
                .execute()
            )
            ids = [r["id"] for r in (picks.data or [])]
            if not ids:
                break
            client.table(table).delete().in_("id", ids).execute()
            deleted += len(ids)
            print(f"  deleted batch of {len(ids)} (total {deleted}/{total})", flush=True)
            if len(ids) < PAGE:
                break

        print(f"\n✓ Cleanup done. deleted={deleted}")
        end_run(run_id, ok=True, rows_seen=total, rows_upserted=deleted, notes=f"deleted={deleted}")

    except Exception as e:
        end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=f"error: {e}")
        raise


if __name__ == "__main__":
    sys.exit(main())
