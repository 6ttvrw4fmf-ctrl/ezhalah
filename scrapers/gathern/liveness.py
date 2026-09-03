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
  • EVIDENCE: every decision writes one row to `gathern_liveness_detail` (listing, raw HTTP status,
    verdict, missing_count before/after, applied), on EVERY run including dry-runs, so "was that
    kill correct?" is answerable from our own data instead of an expiring Actions log. `applied` is
    false for a dry run and for a kill batch the anomaly cap quarantined. Best-effort: a failed
    evidence write never blocks or rolls back a sweep, and it never drives inactivation.

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
from scrapers.common.liveness_contract import direct_alive_patch
from scrapers.common.liveness_trust import (
    MIN_ALIVE_RATE_FOR_TRUST,
    MIN_CANARIES,
    MIN_CANARY_ALIVE_RATE,
    MIN_PROBES_FOR_TRUST,
    canary_environment_ok,
    environment_is_trustworthy,
)
from scrapers.gathern.run import SOURCE, detail_session

TABLE = "gathern_residential_listings"

# Scheduled/CI runs use the plain label; a run routed through the SHARED Saudi residential proxy
# reports under its own so mon_detect_proxy_contention() can see it. That monitor's predicate is
# the pool's only guard, and its comment is explicit: "Adding a proxy consumer means adding it to
# THIS predicate in the same change." Migration 20260903_gathern_liveness_proxy_consumer does that.
RUN_NAME = "gathern_liveness"
RUN_NAME_PROXY = "gathern_liveness_proxy"
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


def proxied_session(use_proxy: bool):
    """gathern's own detail session, optionally routed through the shared Saudi residential proxy.

    EXPLICIT OPT-IN ONLY. `scrapers/jazwtn/run.py` records the standing rule for this secret: "do
    NOT silently inherit WASALT_PROXY_URL. That secret is provisioned for Wasalt, is metered." So
    the env var is read ONLY when --proxy was passed, and an empty value with the flag set is a
    hard failure rather than a silent fall-back to the datacenter IP that caused this incident.
    """
    s = detail_session()
    if not use_proxy:
        return s
    purl = os.environ.get("WASALT_PROXY_URL", "").strip()
    if not purl:
        raise SystemExit("REFUSING TO RUN: --proxy was requested but WASALT_PROXY_URL is empty. "
                         "Falling back to the datacenter IP would reproduce the 2026-09-01 "
                         "false-death window, where gathern answered our egress with 404.")
    s.proxies = {"http": purl, "https": purl}
    return s


def _collect_canaries(client, limit: int) -> list[dict]:
    """Control set: rows the SOURCE ITSELF has most recently proven alive.

    Drawn from `last_verified_alive_at`, which only the liveness contract writes and only on a
    literal 200 — so a canary is a row we know existed, on the source's own word, not ours. Newest
    first, because the freshest proof is the least likely to have died of natural causes since."""
    r = (client.table(TABLE).select("id, ad_number, listing_url, last_verified_alive_at")
         .eq("source", SOURCE).eq("active", True)
         .not_.is_("last_verified_alive_at", "null")
         .not_.is_("listing_url", "null")
         .order("last_verified_alive_at", desc=True).limit(limit).execute())
    return r.data or []


def _run_canary(s, client, n: int) -> tuple[bool, int, int, str]:
    """Probe the controls BEFORE the real worklist. Returns (ok, alive, probed, status_histogram).

    This is the whole point of the pass: it costs ~n requests and answers "is the source telling us
    the truth today?" before a single real listing's fate is decided. On 2026-09-01 the aggregate
    rate only condemned the run after all 1,500 probes; this condemns it after 5.

    THE HISTOGRAM IS NOT DECORATION. A canary that reports only "0/10" cannot distinguish the three
    failures that matter and that need completely different responses:
      404 -> the SOURCE is refusing this egress (a different route might work)
      407 -> the PROXY rejected us (credentials/plan, nothing to do with the source)
        0 -> no verdict after retries: connect timeout / CONNECT tunnel failure (the layer
             scrapers/wasalt/diagnose_proxy.py exists to isolate)
    Measured 2026-09-03: without this, a failed proxied run said "0/10" and the next question —
    is gathern blocking the proxy, or is the proxy broken? — could not be answered from our own
    logs at all."""
    canaries = _collect_canaries(client, n)
    alive = 0
    statuses: dict[int, int] = {}
    for row in canaries:
        url = (row.get("listing_url") or "").strip()
        if not url:
            continue
        st = probe(s, url)
        statuses[st] = statuses.get(st, 0) + 1
        if st == 200:
            alive += 1
    probed = sum(statuses.values())
    hist = ",".join(f"{k}x{v}" for k, v in sorted(statuses.items())) or "none"
    ok = canary_environment_ok(alive, probed)
    verdict = "PASS" if ok else "FAIL"
    print(f"CANARY {verdict}: {alive}/{probed} known-alive controls returned 200 "
          f"(need >={MIN_CANARY_ALIVE_RATE:.0%} of >={MIN_CANARIES}) statuses[{hist}]"
          + ("" if ok else f" — {canary_diagnosis(statuses)}"), flush=True)
    return ok, alive, probed, hist


def canary_diagnosis_from_hist(hist: str) -> str:
    """Same diagnosis, from the histogram string the run already carries."""
    counts: dict[int, int] = {}
    for part in (hist or "").split(","):
        if "x" in part:
            k, _, v = part.partition("x")
            try:
                counts[int(k)] = int(v)
            except ValueError:
                continue
    return canary_diagnosis(counts)


def canary_diagnosis(statuses: dict[int, int]) -> str:
    """Name the failing LAYER from the statuses, because the three cases need different people.

    Saying "the source is refusing us" when the proxy rejected our credentials sends the next
    engineer to the wrong system entirely, and a quarantine note is read precisely when nobody has
    context. The dominant status decides:
      404/410 -> the SOURCE answered and refused this egress
      401/403/407 -> the PROXY or an auth layer rejected us; the source never saw the request
      0       -> no verdict after retries: connect timeout / CONNECT tunnel failure
    """
    if not statuses:
        return "no controls could be probed (empty control set)"
    top = max(statuses.items(), key=lambda kv: kv[1])[0]
    if top in (404, 410):
        return ("the SOURCE answered and refused this egress — a different route may work, but "
                "these 404s are UNKNOWN, never death")
    if top in (401, 403, 407):
        return ("the PROXY/auth layer rejected us — the source never saw these requests; check "
                "credentials and plan, not the listings")
    if top == 0:
        return ("no verdict after retries — connect timeout or CONNECT tunnel failure; isolate "
                "with scrapers/wasalt/diagnose_proxy.py before blaming the source")
    return f"unexpected dominant status {top} — investigate before trusting any verdict"


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


def _collect_killed(client, limit: int) -> list[dict]:
    """Worklist for --recheck-dead: rows THIS sweep previously killed (inactive, missing_count ≥
    grace), newest kill first.

    WHY THIS EXISTS (2026-08-22, Data Integrity run #37). The sweep's own rule is "HTTP 200 → alive
    → rescue". It only ever applied that rule to rows that happened to still be ACTIVE, so one
    source fact — a live detail page — produced a rescue for one row and permanent removal for
    another, decided purely by our own prior state. Nothing re-probed a killed row again: the
    docstring's stated recovery path is the crawl upsert, which only fires if the unit re-enters
    gathern's enumeration feed, and a unit can keep a live page while sitting out of that feed
    (e.g. fully booked). Measured that day: of 60 randomly sampled killed rows, 57 were still 404
    but 3 returned a full 200 page, replicated 5/5 each — against a 10/10 200 control, so the probe
    itself was demonstrably healthy.

    This worklist is READ-ONLY and the mode it feeds can only ever restore a row, never inactivate
    one, so it cannot deepen an inactivation mistake — only undo one, and only on a live 200."""
    work: list[dict] = []
    offset = 0
    page = 1000
    while True:
        q = (client.table(TABLE).select("id, ad_number, listing_url, missing_count")
             .eq("source", SOURCE).eq("active", False).gte("missing_count", 3)
             .not_.is_("listing_url", "null")
             .order("deactivated_at", desc=True).order("id", desc=False)
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


def _recheck_dead(client, args, run_id: int, mode: str, now_iso: str,
                  holder: str, holding_lock: bool) -> int:
    """Resurrection pass — restore killed rows the source still serves.

    Structurally NON-DESTRUCTIVE: the only write it can make is a restore (active=true,
    missing_count=0, last_seen_at refreshed, deactivated_at cleared) and only on a literal HTTP 200.
    404/410 and every transient leave the row exactly as it was, so a blocked proxy or a bad day at
    the source degrades this pass to a no-op rather than to damage. That is why it needs no kill cap.

    The restore payload is the SAME one the kill pass's own `alive` branch writes — this mode does
    not invent a rescue rule, it applies the existing one to the rows the kill pass stopped looking
    at. Every decision is recorded in gathern_liveness_detail like any other."""
    work = _collect_killed(client, args.limit)
    print(f"Gathern liveness RECHECK-DEAD [{mode}]: {len(work)} previously-killed rows "
          f"(~{MIN_INTERVAL:.1f}s/req)", flush=True)

    s = proxied_session(args.proxy)

    # The canary matters here for a different reason than in the kill pass. This pass cannot harm a
    # row — it only restores on a literal 200 — but a BLOCKED run restores nothing and then writes
    # `dead_confirmed` evidence for every row it could not reach. That is a lie in the ledger, and
    # the next reader would take it as proof the backlog really is dead. Refuse instead.
    if args.canaries:
        ok, c_alive, c_probed, c_hist = _run_canary(s, client, args.canaries)
        c_diag = canary_diagnosis_from_hist(c_hist)
        if not ok:
            notes = (f"CANARY-QUARANTINED recheck-dead: {c_alive}/{c_probed} controls alive "
                     f"statuses[{c_hist}] "
                     f"(need >={MIN_CANARY_ALIVE_RATE:.0%} of >={MIN_CANARIES}) — {c_diag}. "
                     f"A 404 here would mean 'we were blocked', not 'this listing is gone'. "
                     f"0 restored, 0 evidence rows written.")
            print(f"✗ {notes}", flush=True)
            end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=notes, allow_empty=True)
            if holding_lock:
                _release_apply_lock(client, holder)
            return 1
    seen = restored = still_dead = transient = 0
    detail: list[dict] = []
    started = time.time()

    def _flush() -> None:
        for i in range(0, len(detail), 500):
            chunk = detail[i:i + 500]
            try:
                client.table("gathern_liveness_detail").insert(chunk).execute()
            except Exception as exc:  # noqa: BLE001 — logging must not break the lifecycle
                print(f"⚠ detail-log insert failed (non-fatal, {len(chunk)} rows): "
                      f"{str(exc)[:160]}", flush=True)
        detail.clear()

    try:
        for row in work:
            url = (row.get("listing_url") or "").strip()
            if not url:
                continue
            seen += 1
            status = probe(s, url)
            mc_before = int(row.get("missing_count") or 0)

            if status == 200:
                restored += 1
                verdict, mc_after = "alive", 0
                if args.apply:
                    client.table(TABLE).update({
                        "active": True, "missing_count": 0,
                        "last_seen_at": now_iso, "deactivated_at": None,
                        **direct_alive_patch(now_iso=now_iso),
                    }).eq("id", row["id"]).execute()
            elif looks_dead(status):
                still_dead += 1
                verdict, mc_after = "dead_confirmed", mc_before
            else:
                transient += 1
                verdict, mc_after = "transient", mc_before

            detail.append({
                "listing_id": row["id"],
                "http_status": status or None,
                "verdict": verdict,
                "missing_count_before": mc_before,
                "missing_count_after": mc_after,
                # Only a restore writes anything; a confirmed-dead or transient changes no row.
                "applied": bool(args.apply) and verdict == "alive",
            })
            if len(detail) >= 500:
                _flush()

            if seen % 50 == 0:
                rate = seen / (time.time() - started or 1)
                print(f"  [{seen}] restored={restored} still_dead={still_dead} "
                      f"transient={transient} ({rate:.1f}/s)", flush=True)
    except KeyboardInterrupt:
        print("\nInterrupted — finalizing.", flush=True)
    finally:
        _flush()

    verb = "restored" if args.apply else "WOULD restore"
    notes = (f"RECHECK-DEAD {mode} scanned={seen} {verb}={restored} "
             f"still_dead={still_dead} transient={transient}")
    print(f"\n✓ Gathern liveness recheck done. {notes}", flush=True)
    end_run(run_id, ok=True, rows_seen=seen, rows_upserted=(restored if args.apply else 0),
            notes=notes, allow_empty=(len(work) == 0))
    if holding_lock:
        _release_apply_lock(client, holder)
    return 0


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
    ap.add_argument("--recheck-dead", action="store_true",
                    help="RESURRECTION PASS (2026-08-22). Instead of probing stale ACTIVE rows, "
                         "re-probe rows this sweep previously killed and RESTORE any the source "
                         "still serves (HTTP 200). This mode can only ever set active=true; it "
                         "never inactivates anything, never touches missing_count upward, and "
                         "never consults the kill cap — there is nothing for the cap to guard. "
                         "404/410 leaves the row inactive; a transient leaves it untouched. "
                         "Honours --apply (dry-run by default) and --limit like the kill pass.")
    ap.add_argument("--proxy", action="store_true",
                    help="Route detail probes through the SHARED Saudi residential proxy "
                         "(WASALT_PROXY_URL). Owner-authorised for gathern 2026-09-03 after the "
                         "source began answering our datacenter egress with its own 404 page, "
                         "manufacturing false deaths. EXPLICIT opt-in: the secret is metered and "
                         "shared, so it is never inherited silently, and the run reports under "
                         f"'{RUN_NAME_PROXY}' so mon_detect_proxy_contention() counts it.")
    ap.add_argument("--canaries", type=int, default=MIN_CANARIES * 2,
                    help="How many known-alive control listings to probe BEFORE the worklist. If "
                         "they do not come back alive the whole run is quarantined: 0 strikes, 0 "
                         "inactivations. 0 disables the pass (NOT recommended; the trust gate is "
                         "then the only guard and it only answers after the batch is spent).")
    args = ap.parse_args()

    client = sb()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=args.min_stale_days)).isoformat()
    now_iso = datetime.now(timezone.utc).isoformat()
    mode = "APPLY" if args.apply else "DRY-RUN"
    platform = RUN_NAME_PROXY if args.proxy else RUN_NAME
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

    if args.recheck_dead:
        return _recheck_dead(client, args, run_id, mode, now_iso, holder, holding_lock)

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

    s = proxied_session(args.proxy)

    # ── CANARY: prove the environment BEFORE deciding any real listing's fate ────────────────────
    # Owner rule 2026-09-03. The trust gate is a lagging signal — it can only condemn a run once the
    # whole batch is spent, which on 2026-09-01 meant 302 rows were already inactivated by the time
    # the number existed. This asks the same question first, for the price of ~10 requests.
    c_alive = c_probed = 0
    c_hist = "skipped"
    if args.canaries:
        c_ok, c_alive, c_probed, c_hist = _run_canary(s, client, args.canaries)
        c_diag = canary_diagnosis_from_hist(c_hist)
        if not c_ok:
            notes = (f"CANARY-QUARANTINED {mode}: {c_alive}/{c_probed} known-alive controls "
                     f"returned 200 statuses[{c_hist}] "
                     f"(need >={MIN_CANARY_ALIVE_RATE:.0%} of >={MIN_CANARIES}) — {c_diag}. "
                     f"0 strikes and 0 inactivations written, worklist not probed. These "
                     f"non-200s are UNKNOWN, never death. Owner review required.")
            print(f"✗ {notes}", flush=True)
            end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=notes, allow_empty=True)
            if holding_lock:
                _release_apply_lock(client, holder)
            return 1

    seen = dead = alive = transient = killed = struck = 0
    alive_ids: list[int] = []
    kill_pending: list[tuple[int, int]] = []  # (row id, new_missing) — flipped ONLY after the cap gate
    # Strikes are DEFERRED for the same reason kills are, but against a different failure: the cap
    # asks "is this batch too big?", the trust gate asks "is this run's evidence believable at all?"
    # A strike written inside the loop cannot be taken back once the run turns out to be degraded —
    # which is exactly what happened on 2026-09-01..03 (see scrapers/common/liveness_trust.py).
    strike_pending: list[tuple[int, int]] = []
    started = time.time()

    # ── Per-row evidence (gathern_liveness_detail, migration 20260812113726) ──────────────────────
    # The sweep already KNOWS the raw HTTP status behind every verdict; until now it threw that away
    # and persisted only the aggregate line in scrape_runs.notes, so "was that kill correct?" could
    # not be answered from our own data — it needed the source re-fetched by hand, and the per-row
    # 404s survived only in expiring GitHub Actions logs. Mirrors wasalt_liveness_pilot_detail.
    # Evidence only: this never drives inactivation and touches no safety gate.
    detail_buf: list[dict] = []          # alive/transient — `applied` is known immediately
    strike_detail: list[dict] = []       # strike decisions — `applied` waits on the TRUST gate below
    kill_detail: list[dict] = []         # kill decisions — `applied` waits on trust AND the cap gate

    def _flush_detail(rows: list[dict]) -> None:
        """Best-effort: an audit-log write must never fail or roll back a liveness sweep."""
        for i in range(0, len(rows), 500):
            chunk = rows[i:i + 500]
            try:
                client.table("gathern_liveness_detail").insert(chunk).execute()
            except Exception as exc:  # noqa: BLE001 — logging must not break the lifecycle
                print(f"⚠ detail-log insert failed (non-fatal, {len(chunk)} rows): "
                      f"{str(exc)[:160]}", flush=True)
        rows.clear()

    def _flush_alive() -> None:
        if args.apply and alive_ids:
            for i in range(0, len(alive_ids), 200):
                client.table(TABLE).update({"last_seen_at": now_iso, "missing_count": 0,
                                            **direct_alive_patch(now_iso=now_iso)}) \
                    .in_("id", alive_ids[i:i + 200]).execute()
        alive_ids.clear()

    try:
        for row in work:
            url = (row.get("listing_url") or "").strip()
            if not url:
                continue
            seen += 1
            status = probe(s, url)
            mc_before = int(row.get("missing_count") or 0)
            action, new_missing = classify(status, row.get("missing_count"), args.grace)
            evidence = {
                "listing_id": row["id"],
                "http_status": status or None,   # 0 = no verdict after retries, not a real status
                "verdict": action,
                "missing_count_before": mc_before,
                "missing_count_after": new_missing,
                # A dry run proves what WOULD have happened; a transient never writes anything.
                "applied": bool(args.apply) and action != "transient",
            }
            if action == "kill":
                # `applied` is not knowable yet — the trust gate or the anomaly cap may quarantine
                # the whole batch.
                kill_detail.append(evidence)
            elif action == "strike":
                # Likewise: an untrusted run writes no strikes at all.
                strike_detail.append(evidence)
            else:
                detail_buf.append(evidence)
                # Flush as we go so a SIGINT (CI timeout) keeps the evidence it already earned.
                if len(detail_buf) >= 500:
                    _flush_detail(detail_buf)

            if action in ("kill", "strike"):
                dead += 1
                if action == "kill":
                    killed += 1
                    # Kills are DEFERRED to the end-of-run cap gate below — a mass-kill batch must
                    # never land row-by-row before its size is known (anomaly guard, 2026-07-27).
                    kill_pending.append((row["id"], new_missing))
                else:
                    struck += 1
                    strike_pending.append((row["id"], new_missing))
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
        _flush_detail(detail_buf)

    # ── TRUST GATE (2026-09-03): may this run act on its own DEAD verdicts AT ALL? ────────────────
    # Asked BEFORE the cap, because the two guard different failures. The cap asks "is this BATCH
    # too big to believe?"; the trust gate asks "is this RUN's evidence believable at all?" On
    # 2026-09-02 a 106-row kill batch sat comfortably under the cap and landed — while the source
    # was answering ~99% of probes with 404 because it had begun blocking our egress. A batch-size
    # guard is structurally blind to that. Full incident: scrapers/common/liveness_trust.py.
    #
    # Untrusted => write NOTHING in the destructive direction: no strikes, no inactivations. The
    # rows stay exactly as they were and stay honestly UNKNOWN. Alive (200) writes are deliberately
    # NOT gated — a block cannot manufacture a live page, and restoring a live listing is the
    # fail-safe direction (docs/ops/DELETION_SAFETY.md §2.4).
    trusted = environment_is_trustworthy(alive, seen)
    trust_quarantine = (not trusted) and bool(strike_pending or kill_pending)

    anomaly = False
    applied_kills = 0
    applied_strikes = 0
    if args.apply and trusted:
        # Strikes: the cap does not govern them, only trust does.
        for rid, nm in strike_pending:
            client.table(TABLE).update({"missing_count": nm}).eq("id", rid).execute()
        applied_strikes = len(strike_pending)

        # ── Anomaly cap gate (2026-07-27) — UNCHANGED and still fully enabled. The trust gate is an
        # ADDITIONAL guard in front of it, never a replacement for it.
        anomaly = is_anomaly(len(kill_pending), kill_cap)
        if kill_pending:
            if anomaly:
                # QUARANTINE: record the earned strike (missing_count) so history is truthful, but
                # flip NOTHING inactive. The rows re-classify as kills next run and hit this gate
                # again until the owner reviews and re-runs with an explicit --kill-cap.
                for i in range(0, len(kill_pending), 200):
                    for rid, nm in kill_pending[i:i + 200]:
                        client.table(TABLE).update({"missing_count": nm}).eq("id", rid).execute()
            else:
                for rid, nm in kill_pending:
                    client.table(TABLE).update({"missing_count": nm, "active": False}).eq("id", rid).execute()
                applied_kills = len(kill_pending)

    # `applied` must state whether a row actually changed: false for a dry run, false for a batch the
    # anomaly cap quarantined, and false for EVERY strike and kill of an untrusted run. Written after
    # the gates because that is the first moment the answer is known.
    for e in strike_detail:
        e["applied"] = bool(args.apply) and trusted
    for e in kill_detail:
        e["applied"] = bool(args.apply) and trusted and not anomaly
    _flush_detail(strike_detail)
    _flush_detail(kill_detail)

    verb = "inactivated" if args.apply else "WOULD inactivate"
    # An untrusted run inactivates nothing, so a dry run must not advertise a number it would refuse.
    kill_shown = applied_kills if args.apply else (len(kill_pending) if trusted else 0)
    alive_rate = (alive / seen) if seen else 0.0
    # cap_src makes the cap's PROVENANCE auditable: an explicit --kill-cap override and a computed
    # cap are operationally different decisions and must never read the same in the run log. This is
    # what would have exposed the head=True count bug immediately instead of after ~3 days
    # (2026-08-16): every run logged a bare "kill_cap=150" that looked computed and was not.
    cap_src = (f"override active={active_now_logged}" if args.kill_cap > 0
               else f"auto=max(150,2% of {active_now_logged})")
    notes = (f"{mode} scanned={seen} dead={dead} {verb}={kill_shown} strike={struck} "
             f"applied_strikes={applied_strikes} alive={alive} transient={transient} "
             f"kill_cap={kill_cap} [{cap_src}] alive_rate={alive_rate:.3f} trusted={trusted} "
             f"proxy={bool(args.proxy)} canary={c_alive}/{c_probed} canary_statuses[{c_hist}]")
    if trust_quarantine:
        notes = (f"TRUST-QUARANTINED alive_rate={alive_rate:.1%} below {MIN_ALIVE_RATE_FOR_TRUST:.0%} "
                 f"(min_probes={MIN_PROBES_FOR_TRUST}) — 0 strikes and 0 inactivations written "
                 f"(would_strike={len(strike_pending)} would_inactivate={len(kill_pending)}). The "
                 f"source is not answering this run reliably, so its 404s are UNKNOWN, not death. "
                 f"Owner review required. " + notes)
    elif anomaly:
        notes = (f"ANOMALY-CAPPED would_inactivate={len(kill_pending)} cap={kill_cap} — 0 rows "
                 f"inactivated; owner review required. " + notes)
    print(f"\n✓ Gathern liveness done. {notes}", flush=True)
    # An empty stale worklist is legitimately healthy (everything fresh), not a dead source.
    end_run(run_id, ok=not (anomaly or trust_quarantine), rows_seen=seen,
            rows_upserted=applied_kills, notes=notes, allow_empty=(len(work) == 0))
    if holding_lock:
        _release_apply_lock(client, holder)
    return 0


if __name__ == "__main__":
    sys.exit(main())
