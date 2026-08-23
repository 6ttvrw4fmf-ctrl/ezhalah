"""Post-delete spot-check: re-probe a sample of recently hard-deleted listings and confirm the
source agrees they are actually gone (barrier 11, owner-directed safety audit 2026-08-22).

cleanup.py's final pre-delete recheck is the primary defense against a false deletion, but it is
only as good as that SAME code path. This is a SECOND, INDEPENDENT verification, run some time
after the fact, reusing the same dead-marker registry — built to catch a systematic bug in the
recheck logic itself (a URL-construction error, a dead-marker regex that stopped matching after a
site redesign) that a single delete-time check could not see, since it would fool both checks
identically if they were the same code path at the same moment. Running this DAYS after the delete,
against the SAME dead_marker function, is a real second opinion, not a rerun of the first one.

NEVER restores anything automatically: a 'live' verdict means an already-deleted row's OWN
listing_url now serves live content again. The original row is gone — manufacturing one back from
a re-probe would itself be a guess (the row's other fields are lost), so this raises a P0
(mon_detect_deleted_but_source_live) for a human to investigate and decide the repair, per the
same source-truth rules as any other data restoration.

Usage:
  python -m scrapers.common.verify_deletions --platform gathern --sample 40 --days 30
"""
from __future__ import annotations

import argparse
import random
import sys
from datetime import datetime, timedelta, timezone

from scrapers.common.cleanup import PLATFORMS, _probe, verdict
from scrapers.common.db import begin_run, end_run, sb


def sample_recent_deletions(client, platform: str, days: int, sample: int) -> list[dict]:
    """Pulls the full deletion-log window for this platform, then samples in Python — kept
    separate from the network loop so the sampling logic is unit-testable without a real DB or
    network, and so a future stratified-sampling change (e.g. weight toward older deletions,
    where a systematic bug would have had the most time to matter) only touches this function."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = (client.table("cleanup_deletion_log")
            .select("id, platform, source_table, listing_id, listing_url, deleted_at")
            .eq("platform", platform).gte("deleted_at", since).execute().data or [])
    rows = [r for r in rows if (r.get("listing_url") or "").strip()]
    if len(rows) <= sample:
        return rows
    return random.sample(rows, sample)


def classify(rows: list[dict], dead_marker, probe=None) -> list[dict]:
    """Pure-ish function (network isolated behind `probe`, injectable for tests): re-fetches each
    row's own listing_url and classifies it with the SAME verdict() function cleanup.py's delete
    step uses. 'dead' = still gone, correctly deleted. 'live' = FALSE DELETION, the finding this
    whole script exists to catch. 'unknown' = inconclusive (403/429/5xx/timeout/network error) —
    reported, never treated as either verdict; a block does not vindicate or condemn a past delete.

    `probe` resolves to the module-level `_probe` at CALL time via the `probe or _probe` line
    below, not at import time — deliberately, so a test (or future caller) that monkeypatches this
    module's `_probe` name is honored even though `run()` never passes `probe=` explicitly. A
    `probe=_probe` default argument would bind the real network function once, at import, and
    silently ignore any later monkeypatch."""
    probe = probe or _probe
    out = []
    for r in rows:
        status, body = probe(r["listing_url"])
        v = verdict(status, body, dead_marker)
        out.append({**r, "http_status": status, "verify_verdict": v})
    return out


def run(platform: str, *, days: int = 30, sample: int = 40) -> dict:
    client = sb()
    reg = PLATFORMS.get(platform)
    dead_marker = (reg or {}).get("dead_marker")
    run_id = begin_run(f"verify_deletions:{platform}")
    stats = {"platform": platform, "sampled": 0, "still_dead": 0, "live": 0, "unknown": 0}
    try:
        if dead_marker is None:
            end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                     notes="no dead-check registered for this platform — nothing to verify")
            return stats

        rows = sample_recent_deletions(client, platform, days, sample)
        stats["sampled"] = len(rows)
        results = classify(rows, dead_marker)

        log_rows = []
        for r in results:
            v = r["verify_verdict"]
            if v == "dead":
                stats["still_dead"] += 1
            elif v == "live":
                stats["live"] += 1
            else:
                stats["unknown"] += 1
            log_rows.append({
                "deletion_log_id": r["id"], "platform": platform, "source_table": r["source_table"],
                "listing_id": r["listing_id"], "listing_url": r["listing_url"],
                "deleted_at": r["deleted_at"], "http_status": r["http_status"], "verdict": v,
            })
        if log_rows:
            for i in range(0, len(log_rows), 200):
                client.table("cleanup_deletion_verification").insert(log_rows[i:i + 200]).execute()

        end_run(run_id, ok=True, rows_seen=stats["sampled"], rows_upserted=stats["live"],
                 notes=(f"sampled={stats['sampled']} still_dead={stats['still_dead']} "
                        f"live={stats['live']} unknown={stats['unknown']}"))
        print(f"✓ verify_deletions {platform}: sampled={stats['sampled']} "
              f"still_dead={stats['still_dead']} live={stats['live']} unknown={stats['unknown']}",
              flush=True)
        if stats["live"]:
            print(f"  ⚠ {stats['live']} deleted row(s) now serve LIVE content on their own "
                  f"original URL — a false deletion. Logged to cleanup_deletion_verification; "
                  f"mon_detect_deleted_but_source_live raises a P0 from it.", flush=True)
        return stats
    except Exception as e:
        end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=f"error: {e}")
        raise


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Post-delete spot-check: re-probe a sample of recently hard-deleted listings")
    ap.add_argument("--platform", required=True)
    ap.add_argument("--days", type=int, default=30, help="lookback window over cleanup_deletion_log")
    ap.add_argument("--sample", type=int, default=40, help="max rows to re-probe per run")
    args = ap.parse_args()
    run(args.platform, days=args.days, sample=args.sample)
    return 0


if __name__ == "__main__":
    sys.exit(main())
