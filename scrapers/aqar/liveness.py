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


def _run_with_retry(fn, tries: int = 5):
    """Run a DB call, retrying on Postgres statement-timeout (57014) — these come from transient
    lock contention when the 4h sweep is mid-upsert on the same table. Back off and try again."""
    for i in range(tries):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            if "57014" in str(e) and i < tries - 1:
                time.sleep(2.0 * (i + 1))
                continue
            raise


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
    ap.add_argument("--table", default="aqar_residential_listings",
                    choices=["aqar_residential_listings", "aqar_commercial_listings",
                             "wasalt_residential_listings", "wasalt_commercial_listings"],
                    help="Which listings table to sweep. Run once per table to cover both verticals.")
    ap.add_argument("--shards", type=int, default=1,
                    help="Split the active rows into this many ID buckets so the sweep can run as N "
                         "parallel jobs (each its own IP + throttle). A single job can't check 78k "
                         "listings @ ~3/s within the 6h limit; sharding finishes in ~20-30 min.")
    ap.add_argument("--shard", type=int, default=0,
                    help="Which 0-indexed bucket THIS job handles (0 .. shards-1).")
    args = ap.parse_args()

    table = args.table
    run_id = begin_run(f"aqar_liveness:{table}:{args.shard}/{args.shards}")
    now_iso = datetime.now(timezone.utc).isoformat()
    client = sb()

    # Compute this shard's contiguous ID window from the table's max id. Even, gap-tolerant split:
    # bucket size = ceil((maxid+1)/shards); this shard owns [shard*bucket, (shard+1)*bucket).
    maxid_res = client.table(table).select("id").order("id", desc=True).limit(1).execute()
    max_id = (maxid_res.data[0]["id"] if maxid_res.data else 0)
    bucket = (max_id // max(1, args.shards)) + 1
    lo = args.shard * bucket
    hi = lo + bucket  # exclusive upper bound
    print(f"shard {args.shard}/{args.shards} → id range [{lo}, {hi}) of max_id={max_id}", flush=True)

    seen = 0
    killed = 0
    refreshed = 0
    transient = 0
    pending_kill = 0  # missing this run but not yet past grace
    alive_ids: list[int] = []  # batched "still alive" ids → one UPDATE per 200 (see flush below)
    started = time.time()

    try:
        # Pull active rows in pages of 1000 via KEYSET pagination (walk forward by id) — NOT offset.
        # Offset pagination on a 77k+ row table re-scans and skips `offset` rows every page, getting
        # slower the deeper it goes until it hits the DB statement timeout (error 57014). Keyset is
        # O(page_size) per page regardless of depth, AND it's more correct here: the sweep flips rows
        # to active=false as it runs, which would shift an offset window and skip rows — a forward id
        # cursor never does. (fix: liveness statement-timeout failure as the table grew.)
        page_size = 1000
        last_id = lo - 1  # start the cursor at the bottom of this shard's ID window
        while True:
            res = (
                client.table(table)
                .select("id, ad_number, listing_url, missing_count")
                .eq("active", True)
                .gt("id", last_id)
                .lt("id", hi)  # stay within this shard's window
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
                    upd: dict = {"missing_count": new_missing}
                    if new_missing >= args.grace:
                        upd["active"] = False
                        killed += 1
                    else:
                        pending_kill += 1
                    _run_with_retry(lambda u=upd, i=row["id"]:
                                    client.table(table).update(u).eq("id", i).execute())
                elif r is not None and status == 200:
                    # Alive — BATCH the refresh. Every alive row gets the same values, so collect ids
                    # and flush one `UPDATE … WHERE id IN (…)` per 200 rows instead of 84k single-row
                    # writes. Far fewer statements ⇒ far less lock-contention exposure (the per-row
                    # writes were timing out mid-sweep, error 57014). (fix: liveness 57014 failure.)
                    alive_ids.append(row["id"])
                    refreshed += 1
                    if len(alive_ids) >= 200:
                        batch = list(alive_ids)
                        _run_with_retry(lambda ids=batch: client.table(table)
                                        .update({"last_seen_at": now_iso, "missing_count": 0})
                                        .in_("id", ids).execute())
                        alive_ids.clear()
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

    # Flush any remaining batched "alive" refreshes.
    if alive_ids:
        _run_with_retry(lambda ids=list(alive_ids): client.table(table)
                        .update({"last_seen_at": now_iso, "missing_count": 0})
                        .in_("id", ids).execute())

    notes = (
        f"refreshed={refreshed} killed={killed} "
        f"pending_kill={pending_kill} transient={transient}"
    )
    print(f"\n✓ Liveness sweep done. scanned={seen} {notes}")
    end_run(run_id, ok=True, rows_seen=seen, rows_upserted=killed, notes=notes)


if __name__ == "__main__":
    sys.exit(main())
