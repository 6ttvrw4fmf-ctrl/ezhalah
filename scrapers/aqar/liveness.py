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
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

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


def shard_row_window(total_rows: int, shards: int, shard: int) -> tuple[int, int]:
    """This shard's window [start, end) of ROW OFFSETS into the active rows ordered by id — a
    COUNT-balanced split (fix 2026-07-16, bug B1).

    History: the split used to be geometric over the ID RANGE (bucket = (max_id-min_id)//shards+1,
    anchored at min_id since the morning fix for high-start tables). But aqar ids are dense at the
    low end and sparse above: on 2026-07-16 shard 0's geometric window [1, ~193k) held 70,427 of
    the 86,464 active aqar_residential rows (81%) — a ~16h sweep against the workflow's
    timeout-minutes: 120, so shard 0 was SIGKILLed every day (live proof: run 13176 started 01:00,
    finished_at NULL, rows_seen 0) and those ~70k rows were never liveness-checked — the 44.6%
    stale-active backlog. Splitting by ROW COUNT instead gives every shard ~total/shards rows
    (~5.4k at 16 shards, ~60-80 min at the observed 1.2-3 rows/s) regardless of how ids cluster.

    floor(shard*N/S) arithmetic ⇒ windows are contiguous, disjoint, jointly cover [0, N), and any
    two shards' row counts differ by at most 1. A shard's window is empty only when N < S (fewer
    active rows than shards) — for these tables that means the source is effectively dead, and the
    empty shard's 0-row run is honestly demoted by end_run's RC-B rule, same as before.
    """
    shards = max(1, shards)
    total_rows = max(0, total_rows)
    start = (shard * total_rows) // shards
    end = ((shard + 1) * total_rows) // shards
    return start, end


def shard_id_window(
    id_at: Callable[[int], Optional[int]],
    total_rows: int,
    shards: int,
    shard: int,
) -> Optional[tuple[int, Optional[int]]]:
    """Translate this shard's row-offset window into a keyset ID window [lo, hi).

    `id_at(offset)` returns the id of the offset-th active row ordered by id ascending (None if
    the active set shrank below that offset since `total_rows` was counted — concurrent shards
    deactivate rows while we compute). Returns None when this shard owns no rows; hi is None for
    the tail shard = sweep unbounded to the top of the table.

    Boundary tolerance (documented, deliberate): each parallel shard counts + probes at its OWN
    start time, so if rows are deactivated in between, adjacent windows can gap/overlap by a few
    rows. An overlap double-checks a row (idempotent — same alive/dead verdict); a gap skips a row
    for ONE daily run, and the grace=3 consecutive-miss rule means a skip can never kill or revive
    anything by itself. Exact partition of a moving set isn't achievable without a lock and isn't
    needed here.
    """
    start, end = shard_row_window(total_rows, shards, shard)
    if start >= end:
        return None
    lo = id_at(start)
    if lo is None:  # active set shrank below our window's start — nothing left for this shard
        return None
    hi = id_at(end) if end < total_rows else None  # None ⇒ unbounded tail
    return lo, hi


# A begin_run() stub whose process was SIGKILLed (the exact fate of shard 0 above: GitHub Actions
# timeout-minutes kills the job, end_run never runs) sits finished_at=NULL/ok=NULL forever —
# invisible to the failure detectors, which key on ok=false. Must comfortably exceed the workflow
# timeout (120 min) so a live concurrent run can never be finalized out from under itself.
ORPHAN_STUB_HOURS = 6


def reconcile_orphaned_stubs(client, platform: str, *, older_than_hours: int = ORPHAN_STUB_HOURS) -> int:
    """Finalize THIS platform-string's abandoned scrape_runs stubs as ok=false (fix 2026-07-16).

    Scoped to our exact platform string ('aqar_liveness:<table>:<shard>/<shards>') so parallel
    shards never race each other, and to stubs older than `older_than_hours` so a legitimately
    running sweep (bounded by the 120-min workflow timeout) is never touched. rows_seen is left
    as-is — the killed process's true progress is unknown, and inventing a number would be worse
    than the honest stub value.
    """
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(hours=older_than_hours)).isoformat()
    res = _run_with_retry(
        lambda: client.table("scrape_runs")
        .update({
            "finished_at": now.isoformat(),
            "ok": False,
            "notes": "orphaned — presumed timeout-killed; finalized by the next run's "
                     "startup reconciliation",
        })
        .eq("platform", platform)
        .is_("finished_at", "null")
        .lt("started_at", cutoff)
        .execute()
    )
    n = len(res.data or [])
    if n:
        print(f"reconciled {n} orphaned run stub(s) for {platform} → ok=false", flush=True)
    return n


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
                    help="Split the active rows into this many ROW-COUNT-balanced buckets so the "
                         "sweep can run as N parallel jobs (each its own IP + throttle). Balanced "
                         "by count — not by id range — because ids cluster: a geometric split gave "
                         "shard 0 81%% of aqar_residential and it was timeout-killed daily.")
    ap.add_argument("--shard", type=int, default=0,
                    help="Which 0-indexed bucket THIS job handles (0 .. shards-1).")
    args = ap.parse_args()

    table = args.table
    platform = f"aqar_liveness:{table}:{args.shard}/{args.shards}"
    client = sb()
    # Before opening our own run row: finalize any stub WE left behind on a previous day —
    # a timeout-killed job never reaches end_run, so its ok=NULL stub would sit silent forever.
    reconcile_orphaned_stubs(client, platform)
    run_id = begin_run(platform)
    now_iso = datetime.now(timezone.utc).isoformat()

    # ── Row-count-balanced shard window (fix 2026-07-16, bug B1 — see shard_row_window) ─────────
    # One count + at most two single-row offset probes. The probes run on the same
    # (active, id) access path the keyset loop below uses — live-verified as an Index Only Scan
    # on idx_aqar_active_id, ~40 ms at the worst-case mid-table offset.
    count_res = _run_with_retry(
        lambda: client.table(table).select("id", count="exact").eq("active", True).limit(1).execute())
    total_rows = int(count_res.count or 0)

    def _id_at(offset: int) -> Optional[int]:
        res = _run_with_retry(
            lambda: client.table(table).select("id").eq("active", True)
            .order("id", desc=False).range(offset, offset).execute())
        return int(res.data[0]["id"]) if res.data else None

    window = shard_id_window(_id_at, total_rows, args.shards, args.shard)
    if window is None:
        lo, hi = 0, 0  # empty shard (total_rows < shards): sweep nothing, finalize honestly below
    else:
        lo, hi = window
    row_lo, row_hi = shard_row_window(total_rows, args.shards, args.shard)
    print(f"shard {args.shard}/{args.shards} → rows [{row_lo}, {row_hi}) of {total_rows} active "
          f"→ id window [{lo}, {'∞' if hi is None else hi})", flush=True)

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
        while window is not None:
            q = (
                client.table(table)
                .select("id, ad_number, listing_url, missing_count")
                .eq("active", True)
                .gt("id", last_id)
                .order("id", desc=False)
                .limit(page_size)
            )
            if hi is not None:
                q = q.lt("id", hi)  # stay within this shard's window (tail shard is unbounded)
            res = q.execute()
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
