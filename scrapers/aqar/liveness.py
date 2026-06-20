"""Aqar liveness sweep — detect dead listings and mark them inactive.

For every row in `aqar_residential_listings` where active=true, this fetches the listing
URL on Aqar.sa and decides what to do:

  - Confirmed dead (404, 410, or HTML body says "ad removed / not available") →
    increment `missing_count`. Once it hits the grace threshold (default 3 consecutive
    sweeps), flip `active = false`. The row stays in the DB (we keep historical
    listings) — the app filter (`active=true`) just hides it.
  - Alive (200 OK with content) → reset `missing_count` to 0 and refresh
    `last_seen_at`.
  - Transient failure (timeout, 5xx, no response) → leave the row untouched. We
    NEVER kill a listing because of a single network hiccup.

The grace period is what keeps us correct even when Aqar's site has a brief outage,
their pagination glitches, or a single curl request randomly times out: a real removed
listing fails THREE runs in a row; a temporary blip recovers on the next run.

Designed to be cron-driven from the VPS — once a day at 04:00 KSA time.

Run it locally for testing:
  python -m scrapers.aqar.liveness --limit 50

On the server:
  0 1 * * *  cd /srv/ezhalah && .venv/bin/python -m scrapers.aqar.liveness
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timezone

from scrapers.common.db import begin_run, end_run, sb
from scrapers.common.http import get


# Phrases Aqar puts on a removed/expired listing page (both languages).
DEAD_MARKERS = (
    "تم حذف الإعلان",
    "الإعلان غير متوفر",
    "الإعلان غير نشط",
    "الإعلان منتهي",
    "Ad has been removed",
    "Ad not available",
    "Listing not available",
    "Listing has been removed",
)


def looks_dead(status: int, body: str) -> bool:
    """True iff the response confirms this listing is gone (vs a transient hiccup)."""
    if status in (404, 410):
        return True
    if status != 200:
        # Anything else (timeouts, 5xx, redirects we didn't follow) is treated as transient.
        return False
    for marker in DEAD_MARKERS:
        if marker in body:
            return True
    return False


def main() -> None:
    ap = argparse.ArgumentParser(description="Aqar liveness sweep")
    ap.add_argument("--limit", type=int, default=0,
                    help="Stop after checking N rows (0 = all active rows). Useful for testing.")
    ap.add_argument("--grace", type=int, default=3,
                    help="Consecutive sweeps a listing must be missing before we kill it.")
    args = ap.parse_args()

    run_id = begin_run("aqar_liveness")
    now_iso = datetime.now(timezone.utc).isoformat()
    client = sb()

    seen = 0
    killed = 0
    refreshed = 0
    transient = 0
    pending_kill = 0  # missing this run but not yet past grace
    started = time.time()

    try:
        # Pull active rows in pages of 1000 via KEYSET pagination (walk forward by id) — NOT offset.
        # Offset pagination on a 77k+ row table re-scans and skips `offset` rows every page, getting
        # slower the deeper it goes until it hits the DB statement timeout (error 57014). Keyset is
        # O(page_size) per page regardless of depth, AND it's more correct here: the sweep flips rows
        # to active=false as it runs, which would shift an offset window and skip rows — a forward id
        # cursor never does. (fix: liveness statement-timeout failure as the table grew.)
        page_size = 1000
        last_id = 0
        while True:
            res = (
                client.table("aqar_residential_listings")
                .select("id, ad_number, listing_url, missing_count")
                .eq("active", True)
                .gt("id", last_id)
                .order("id", desc=False)
                .limit(page_size)
                .execute()
            )
            rows = res.data or []
            if not rows:
                break

            for row in rows:
                last_id = row["id"]  # advance the cursor (rows are id-ascending)
                seen += 1
                url = (row.get("listing_url") or "").strip()
                if not url:
                    continue  # no URL → can't check, skip

                r = get(url, max_retries=2)
                status = r.status_code if r is not None else 0
                body = r.text if r is not None else ""

                if r is not None and looks_dead(status, body):
                    new_missing = (row.get("missing_count") or 0) + 1
                    if new_missing >= args.grace:
                        client.table("aqar_residential_listings").update({
                            "active": False,
                            "missing_count": new_missing,
                        }).eq("id", row["id"]).execute()
                        killed += 1
                    else:
                        client.table("aqar_residential_listings").update({
                            "missing_count": new_missing,
                        }).eq("id", row["id"]).execute()
                        pending_kill += 1
                elif r is not None and status == 200:
                    # Alive — reset the missing counter and refresh last_seen_at.
                    client.table("aqar_residential_listings").update({
                        "last_seen_at": now_iso,
                        "missing_count": 0,
                    }).eq("id", row["id"]).execute()
                    refreshed += 1
                else:
                    transient += 1

                if seen % 50 == 0:
                    elapsed = time.time() - started
                    rate = seen / elapsed if elapsed > 0 else 0
                    print(
                        f"  [{seen}] refreshed={refreshed} killed={killed} "
                        f"pending_kill={pending_kill} transient={transient} "
                        f"({rate:.1f}/s)",
                        flush=True,
                    )

                if args.limit and seen >= args.limit:
                    raise StopIteration

    except StopIteration:
        pass
    except KeyboardInterrupt:
        print("\nInterrupted — finalizing run row.")

    notes = (
        f"refreshed={refreshed} killed={killed} "
        f"pending_kill={pending_kill} transient={transient}"
    )
    print(f"\n✓ Liveness sweep done. scanned={seen} {notes}")
    end_run(run_id, ok=True, rows_seen=seen, rows_upserted=killed, notes=notes)


if __name__ == "__main__":
    sys.exit(main())
