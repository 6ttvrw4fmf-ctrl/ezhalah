"""Gathern liveness sweep — detect delisted units and mark them inactive. OWNER-GATED.

Gathern has NO working inactivation path (verified 2026-07-25: missing_count = 0 for all ~25.6k
active rows; the >7-day-stale bands are 80–90% HTTP-404 yet still active=true):
  • prune_unseen() is never called — the crawl only ever runs sharded and every shard skips prune;
  • mark_stale_listings_inactive can't fire — its coverage gate needs one run to see ≥50% of the
    catalog, which the sharded monthly crawl never does;
  • and last_seen_at staleness is not a valid delisting signal anyway: a fully-booked LIVE unit drops
    out of the has_available monthly feed and goes stale exactly like a delisted one.

So this checks the DETAIL PAGE directly — the only valid Gathern liveness signal:
  • 404 / 410 → increment missing_count; at `grace` consecutive misses flip active=false.
  • 200 OK    → alive: reset missing_count=0 and refresh last_seen_at (this also RESCUES a live-but-
                fully-booked unit that mark_stale would wrongly kill on staleness alone).
  • anything else (429 / 5xx / timeout / no response) → leave the row untouched (never kill on a blip).

NOTE: we must read the raw status ourselves — scrapers.common.http.get() and gathern.run.fetch_detail()
both collapse a 404 into None/{}, indistinguishable from a transient failure, which would make every
dead unit look merely "transient". We reuse gathern's impersonated detail_session() and inspect the
status code.

EFFICIENCY + SIGNAL: only rows whose last_seen_at is already stale (default >3 days) are probed. A row
seen in the monthly feed within the freshness window was just served as bookable by the live API, so
it is alive by construction (probe 2026-07-25: 20/20 such rows → HTTP 200) — re-fetching it only burns
Gathern's tight global detail-page budget. Oldest-stale first, bounded per run by --limit.

SAFETY (deletion-safety + resurrection pins — see reference_scraper-repo-and-inactivation-mechanisms):
  • DRY-RUN BY DEFAULT. Writes NOTHING unless --apply is passed. The workflow is workflow_dispatch
    only (no cron) with apply=false default, so a flag can only ever flip after an explicit owner run.
  • 3-strike grace: every active row starts at missing_count=0, so the FIRST --apply run kills nothing
    (0→1); a unit must 404 on THREE separate --apply runs before it goes inactive.
  • Killed rows are pinned at missing_count=grace (≥3), so the guarded auto_recover_false_inactive()
    (revives only missing_count<3) can't spuriously resurrect them; a genuine return to the monthly
    feed still reactivates the row via the crawl upsert (active=True, missing_count=0).
  • Gathern rate-limits detail pages GLOBALLY (429 above ~2 req/s across ALL IPs), so this runs as a
    SINGLE runner at SCRAPE_MIN_INTERVAL≈1.0 — never a shard matrix.

  python -m scrapers.gathern.liveness --limit 50                # dry-run report on 50 oldest-stale
  python -m scrapers.gathern.liveness --limit 3000 --apply      # actually strike (owner-gated)
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from scrapers.common.db import begin_run, end_run, sb
from scrapers.gathern.run import SOURCE, detail_session

TABLE = "gathern_residential_listings"
MIN_INTERVAL = float(os.environ.get("SCRAPE_MIN_INTERVAL", "1.0"))  # ~1 req/s: Gathern 429s above ~2


def looks_dead(status: int) -> bool:
    """True iff the detail page confirms the unit is gone. Gathern serves a hard 404 (occasionally
    410) for a delisted unit — unlike Aqar, there is no 200-with-dead-marker page."""
    return status in (404, 410)


def classify(status: int, missing_count: Optional[int], grace: int) -> tuple[str, int]:
    """Pure decision for one probe → (action, new_missing_count).
      404/410 → 'strike' (bump) or 'kill' (bump reached grace); 200 → 'alive' (reset);
      anything else → 'transient' (leave missing_count as-is, touch nothing)."""
    mc = missing_count or 0
    if looks_dead(status):
        nm = mc + 1
        return ("kill" if nm >= grace else "strike"), nm
    if status == 200:
        return "alive", 0
    return "transient", mc


def resolve_kill_cap(active_now: int, override: int = 0) -> int:
    """Max rows ONE run may inactivate. An explicit override>0 wins; otherwise auto =
    max(150, 2% of currently-active). This is the partial-crawl / site-wide-404 backstop: a real
    delisting wave is small and gradual, so a batch above this cap is treated as an anomaly."""
    if override > 0:
        return override
    return max(150, active_now * 2 // 100)


def is_anomaly(kill_count: int, kill_cap: int) -> bool:
    """True iff this run's kill batch exceeds the cap → QUARANTINE (record strikes, inactivate NOTHING).
    This is what stops a partial/blocked/site-wide-404 event from wiping live inventory: on
    2026-07-27 a 776-row batch drained all three grace strikes within an hour; with this gate that
    batch (>> max(150, 2%)) inactivates 0 rows and flags the run for owner review instead."""
    return kill_count > kill_cap


def _throttle(_last: list[float] = [0.0]) -> None:
    """Space request STARTS ≥ MIN_INTERVAL apart (single-threaded, so a plain sleep is enough)."""
    wait = _last[0] + MIN_INTERVAL - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.monotonic()


def probe(s, url: str, retries: int = 3) -> int:
    """Return the real HTTP status (200/404/410/…), retrying only transient 429/5xx; 0 = no verdict."""
    for attempt in range(retries):
        _throttle()
        try:
            r = s.get(url, timeout=25, allow_redirects=True)
        except Exception:
            time.sleep(2 * (attempt + 1)); continue
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(3 * (attempt + 1)); continue
        return r.status_code
    return 0


def _collect_stale(client, cutoff_iso: str, limit: int) -> list[dict]:
    """Read-only worklist: active rows whose last_seen_at is already stale, oldest first. Collected in
    full BEFORE any write so flipping active=false mid-sweep can't shift an offset window and skip rows."""
    work: list[dict] = []
    offset = 0
    page = 1000
    while True:
        q = (client.table(TABLE).select("id, ad_number, listing_url, missing_count")
             .eq("source", SOURCE).eq("active", True).lt("last_seen_at", cutoff_iso)
             .order("last_seen_at", desc=False).order("id", desc=False)
             .range(offset, offset + page - 1))
        batch = q.execute().data or []
        work.extend(batch)
        if limit and len(work) >= limit:
            return work[:limit]
        if len(batch) < page:
            return work
        offset += page


# ── Cross-session write lock (2026-07-27) ────────────────────────────────────────────────────────
# Reuses the repo's existing deploy-lock RPCs (supabase/migrations/20260716_deploy_lock.sql) under a
# DISTINCT lock_name so a liveness --apply never blocks (or is blocked by) a frontend deploy.
LOCK_NAME = "gathern_liveness_apply"
_LOCK_TTL_SECONDS = 7200  # 2h — comfortably covers a full sweep; a crashed run self-releases by TTL


def _apply_lock_holder() -> str:
    """Stable-per-run holder id: the GH Actions run id in CI, else host-process id for a local run."""
    run = os.environ.get("GITHUB_RUN_ID")
    return f"gathern_liveness:{('ci:' + run) if run else 'local'}:{os.getpid()}"


def _acquire_apply_lock(client, holder: str, ttl: int) -> Optional[bool]:
    """Try to take the shared apply lock. Returns True (acquired), False (someone else holds an
    unexpired lock), or None on a DB error — the caller MUST fail closed on None (never write unlocked)."""
    try:
        res = client.rpc("acquire_deploy_lock", {
            "p_lock_name": LOCK_NAME, "p_holder": holder,
            "p_ttl_seconds": ttl, "p_note": "gathern liveness --apply sweep",
        }).execute()
    except Exception as e:
        print(f"  lock acquire RPC error: {str(e)[:140]}", flush=True)
        return None
    return bool(res.data)  # a returned row = we hold it; empty = held elsewhere (unexpired)


def _release_apply_lock(client, holder: str) -> None:
    """Best-effort release; the RPC only releases if `holder` still matches (no-op if our TTL lapsed)."""
    try:
        client.rpc("release_deploy_lock", {"p_lock_name": LOCK_NAME, "p_holder": holder}).execute()
    except Exception as e:
        print(f"  lock release RPC error (will self-expire): {str(e)[:140]}", flush=True)


def _apply_lock_holder_info(client) -> str:
    """Current holder, for the 'someone else has it' message (service role bypasses the table's RLS)."""
    try:
        r = (client.table("ops_deploy_lock").select("holder, expires_at, note")
             .eq("lock_name", LOCK_NAME).execute())
        return str(r.data[0]) if r.data else "(unknown — just released?)"
    except Exception:
        return "(unknown)"


def main() -> int:
    ap = argparse.ArgumentParser(description="Gathern detail-page liveness sweep (owner-gated)")
    ap.add_argument("--limit", type=int, default=0, help="probe at most N oldest-stale rows (0 = all stale)")
    ap.add_argument("--grace", type=int, default=3, help="consecutive 404 sweeps before active=false")
    ap.add_argument("--min-stale-days", type=int, default=3,
                    help="only probe rows not seen in the feed for this many days (recently-fed rows "
                         "are alive by construction)")
    ap.add_argument("--apply", action="store_true",
                    help="ACTUALLY write missing_count / active=false. Without it this is a DRY RUN "
                         "that changes nothing and only reports what would happen.")
    ap.add_argument("--kill-cap", type=int, default=0,
                    help="ANOMALY GUARD (2026-07-27): max rows one run may inactivate. 0 = auto "
                         "(max(150, 2%% of currently-active rows)). A batch above the cap is "
                         "QUARANTINED: missing_count still records the strikes, but NO row is "
                         "flipped inactive and the run is marked ok=false for owner review. "
                         "Added after a first-ever 776-row kill batch landed with all 3 grace "
                         "strikes consumed within ~1 hour (3 back-to-back apply runs) — a "
                         "transient site-wide 404 event could mass-kill live listings the same "
                         "way, invisibly. Pass an explicit cap to intentionally release a "
                         "reviewed backlog.")
    args = ap.parse_args()

    client = sb()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=args.min_stale_days)).isoformat()
    now_iso = datetime.now(timezone.utc).isoformat()
    mode = "APPLY" if args.apply else "DRY-RUN"
    platform = "gathern_liveness"
    run_id = begin_run(platform)

    # A DRY RUN is read-only and needs no lock (two can run concurrently, harmlessly). But --apply
    # MUST be single-writer: on 2026-07-27 two sessions ran the same liveness --apply within the hour
    # against this shared project. Take the lock, or refuse to run a second concurrent apply.
    # ponytail: the TTL is the only crash backstop (no try/finally) — fine for a rare owner-gated op;
    # a killed run's lock self-expires, or release it by hand:
    #   select release_deploy_lock('gathern_liveness_apply', '<holder printed below>');
    holder = _apply_lock_holder()
    holding_lock = False
    if args.apply:
        acq = _acquire_apply_lock(client, holder, _LOCK_TTL_SECONDS)
        if acq is None:  # DB error acquiring → fail CLOSED, never write unlocked
            print("✗ liveness apply lock: DB error acquiring — refusing to --apply.", flush=True)
            end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes="apply aborted — lock acquire error")
            return 1
        if not acq:  # an unexpired lock is held elsewhere → do not run a second concurrent apply
            held = _apply_lock_holder_info(client)
            print(f"⚠ another session holds the '{LOCK_NAME}' lock — refusing --apply. Holder: {held}", flush=True)
            end_run(run_id, ok=True, rows_seen=0, rows_upserted=0,
                    notes=f"apply skipped — lock held ({held})", allow_empty=True)
            return 0
        holding_lock = True
        print(f"✓ acquired '{LOCK_NAME}' apply lock (holder={holder}, ttl={_LOCK_TTL_SECONDS}s)", flush=True)

    work = _collect_stale(client, cutoff, args.limit)
    print(f"Gathern liveness [{mode}]: {len(work)} active rows stale >{args.min_stale_days}d "
          f"(grace={args.grace}, ~{MIN_INTERVAL:.1f}s/req)", flush=True)

    # Resolve the anomaly cap up front (the count query is cheap).
    #
    # DO NOT reintroduce head=True here. On the pinned client (supabase 2.10.0 / postgrest 0.18.0)
    # a HEAD request returns .count = 0 rather than the real total, so `or 0` fed
    # resolve_kill_cap(0) and the cap silently collapsed to its 150 floor on EVERY run — measured
    # 2026-08-16 against production: head=True -> .count = 0, without head -> .count = 29335,
    # i.e. cap 150 instead of the designed 586 (2% of active). A threshold that quietly degrades to
    # its floor is worse than a wrong threshold: it looks computed. Consequence in production: the
    # 2026-08-16 06:41 sweep refused a 173-row batch as an "anomaly" that the designed cap would
    # have accepted, leaving source-dead units served to users for days (alert
    # served_after_source_gone:gathern_residential_listings).
    kill_cap = args.kill_cap
    # Always read the denominator, even under an explicit override, so the run log can state what
    # the cap WOULD have been. Under a hold that is the whole point: the owner needs to see both.
    active_now_logged = (client.table(TABLE).select("id", count="exact")
                         .eq("source", SOURCE).eq("active", True).limit(1).execute().count)
    if kill_cap <= 0:
        active_now = active_now_logged
        # Fail CLOSED on an unknown denominator. A zero/None count while there is stale work to do
        # means the count query failed, not that the platform is empty -- and a destructive cap must
        # never be resolved from a denominator we could not read.
        if not active_now:
            if work:
                raise SystemExit(
                    f"REFUSING TO SWEEP: active-row count for {SOURCE} came back {active_now!r} "
                    f"while {len(work)} stale rows are pending. The kill cap would silently fall "
                    f"back to its floor. Fix the count query before running liveness.")
            active_now = 0
        kill_cap = resolve_kill_cap(active_now)

    s = detail_session()
    seen = dead = alive = transient = killed = struck = 0
    alive_ids: list[int] = []
    kill_pending: list[tuple[int, int]] = []  # (row id, new_missing) — flipped ONLY after the cap gate
    started = time.time()

    def _flush_alive() -> None:
        if args.apply and alive_ids:
            for i in range(0, len(alive_ids), 200):
                client.table(TABLE).update({"last_seen_at": now_iso, "missing_count": 0}) \
                    .in_("id", alive_ids[i:i + 200]).execute()
        alive_ids.clear()

    try:
        for row in work:
            url = (row.get("listing_url") or "").strip()
            if not url:
                continue
            seen += 1
            action, new_missing = classify(probe(s, url), row.get("missing_count"), args.grace)

            if action in ("kill", "strike"):
                dead += 1
                if action == "kill":
                    killed += 1
                    # Kills are DEFERRED to the end-of-run cap gate below — a mass-kill batch must
                    # never land row-by-row before its size is known (anomaly guard, 2026-07-27).
                    kill_pending.append((row["id"], new_missing))
                else:
                    struck += 1
                    if args.apply:
                        client.table(TABLE).update({"missing_count": new_missing}).eq("id", row["id"]).execute()
            elif action == "alive":
                alive += 1
                alive_ids.append(row["id"])
                if len(alive_ids) >= 200:
                    _flush_alive()
            else:
                transient += 1

            if seen % 50 == 0:
                rate = seen / (time.time() - started or 1)
                print(f"  [{seen}] dead={dead} (kill={killed} strike={struck}) alive={alive} "
                      f"transient={transient} ({rate:.1f}/s)", flush=True)
    except KeyboardInterrupt:
        print("\nInterrupted — finalizing.", flush=True)
    finally:
        _flush_alive()

    # ── Anomaly cap gate (2026-07-27): the kill batch lands as one reviewed decision, not a drip ──
    anomaly = args.apply and is_anomaly(len(kill_pending), kill_cap)
    applied_kills = 0
    if args.apply and kill_pending:
        if anomaly:
            # QUARANTINE: record the earned strike (missing_count) so history is truthful, but flip
            # NOTHING inactive. The rows re-classify as kills next run and hit this gate again until
            # the owner reviews and re-runs with an explicit --kill-cap.
            for i in range(0, len(kill_pending), 200):
                for rid, nm in kill_pending[i:i + 200]:
                    client.table(TABLE).update({"missing_count": nm}).eq("id", rid).execute()
        else:
            for rid, nm in kill_pending:
                client.table(TABLE).update({"missing_count": nm, "active": False}).eq("id", rid).execute()
            applied_kills = len(kill_pending)

    verb = "inactivated" if args.apply else "WOULD inactivate"
    kill_shown = applied_kills if args.apply else len(kill_pending)
    # cap_src makes the cap's PROVENANCE auditable: an explicit --kill-cap override and a computed
    # cap are operationally different decisions and must never read the same in the run log. This is
    # what would have exposed the head=True count bug immediately instead of after ~3 days
    # (2026-08-16): every run logged a bare "kill_cap=150" that looked computed and was not.
    cap_src = (f"override active={active_now_logged}" if args.kill_cap > 0
               else f"auto=max(150,2% of {active_now_logged})")
    notes = (f"{mode} scanned={seen} dead={dead} {verb}={kill_shown} strike={struck} "
             f"alive={alive} transient={transient} kill_cap={kill_cap} [{cap_src}]")
    if anomaly:
        notes = (f"ANOMALY-CAPPED would_inactivate={len(kill_pending)} cap={kill_cap} — 0 rows "
                 f"inactivated; owner review required. " + notes)
    print(f"\n✓ Gathern liveness done. {notes}", flush=True)
    # An empty stale worklist is legitimately healthy (everything fresh), not a dead source.
    end_run(run_id, ok=not anomaly, rows_seen=seen, rows_upserted=applied_kills,
            notes=notes, allow_empty=(len(work) == 0))
    if holding_lock:
        _release_apply_lock(client, holder)
    return 0


if __name__ == "__main__":
    sys.exit(main())
