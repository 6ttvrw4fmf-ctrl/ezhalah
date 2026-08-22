"""Unified, config-driven retention cleanup for EVERY platform (owner-approved 2026-07-26).

Lifecycle, identical for all platforms: active → inactive → eligible → source-reverified-gone →
permanently deleted. A row is ONLY hard-deleted when ALL hold:
  1. active = false
  2. missing_count >= policy.min_missing_count   (historical liveness signal)
  3. last_seen_at < now - policy.min_inactive_days
  4. the run is NOT an anomaly (candidate count <= max(anomaly_floor, anomaly_factor × trailing median))
  5. a FRESH re-fetch of the real listing_url confirms it is genuinely gone (404/410 or the platform's
     dead-marker). Anything ambiguous — a live page, a 403/429/5xx, a proxy block, a network error —
     is treated as NOT-dead and the row is SKIPPED (never deleted). A page that comes back LIVE
     reactivates the row (self-heal), it is never deleted.

Everything is default-DENY: a platform with no `platform_retention_policy` row, or enabled=false, or
no registered dead-check, deletes NOTHING. That is how new platforms "inherit the lifecycle" safely
and how we guarantee we can't accidentally mass-delete a platform we haven't vetted.

Usage:
  python -m scrapers.common.cleanup --platform gathern              # honor policy.enabled
  python -m scrapers.common.cleanup --platform gathern --dry-run    # probe + classify, delete nothing
  python -m scrapers.common.cleanup --platform aqar --force         # run even if enabled=false (still all guards)
"""
from __future__ import annotations

import argparse
import math
import os
import sys
from datetime import datetime, timezone

from scrapers.common import http
from scrapers.common.db import begin_run, end_run, sb
from scrapers.aqar.liveness import DEAD_MARKERS as AQAR_DEAD_MARKERS

# ── Per-platform "is this URL genuinely dead?" registry. A platform absent here CANNOT be deleted
# with require_source_recheck=true (fail-safe). Each entry: (tables, dead_marker_predicate).
# aqar & wasalt share Aqar's marker/404 semantics (wasalt dead = 404). Add a platform here only after
# proving its dead-detection is liveness-grade — that is the gate for enabling deletion on it.
def _aqar_wasalt_markers(body: str) -> bool:
    return any(m in body for m in AQAR_DEAD_MARKERS)

def _never(body: str) -> bool:
    return False  # 404-only platforms: a delisted unit returns a real HTTP 404; every 200 is treated LIVE

def _aqarcity_expired(body: str) -> bool:
    # aqarcity SOFT-expires: an expired listing serves HTTP 200 with the banner «الإعلان منتهي ...»
    # ("this ad is expired and no longer available"). Live listings (200) never carry it. Verified
    # 2026-07-27: 8/8 inactive pages had it, 12/12 active pages did NOT.
    return "الإعلان منتهي" in body

PLATFORMS: dict[str, dict] = {
    "aqar":   {"tables": ["aqar_residential_listings", "aqar_commercial_listings"],     "dead_marker": _aqar_wasalt_markers},
    "wasalt": {"tables": ["wasalt_residential_listings", "wasalt_commercial_listings"], "dead_marker": _aqar_wasalt_markers},
    # gathern (monthly rentals): a delisted unit serves a server 404; a live OR merely-booked unit
    # serves 200. So delete ONLY on a hard 404 — a booked-but-listed 200 is never deleted, and a
    # relisted unit that comes back 200 is self-healed. Verified on 8 inactive+2 active URLs 2026-07-27.
    "gathern": {"tables": ["gathern_residential_listings"], "dead_marker": _never},
    # aqarcity: soft-expire (200 + «الإعلان منتهي» banner). Delete only when that banner is present;
    # every other 200 is live → self-heal.
    "aqarcity": {"tables": ["aqarcity_residential_listings", "aqarcity_commercial_listings"], "dead_marker": _aqarcity_expired},
}

DEFAULT_POLICY = {
    "min_inactive_days": 30, "min_missing_count": 3, "require_source_recheck": True,
    "max_delete_per_run": 500, "anomaly_floor": 300, "anomaly_factor": 4, "enabled": False,
    # Scale-relative mass-deletion guard (2026-08-09). The absolute anomaly_floor cannot notice
    # that a SMALL platform has gone catastrophically wrong: with floor=1000, a 3,000-row platform
    # could have 600 rows (20%) suddenly eligible and still sail through. This guard scales with
    # the platform, so a source outage / partial crawl / sitemap collapse that falsely inactivates
    # a large FRACTION is caught regardless of how the floor is tuned. It can never deadlock: it
    # moves with the platform's own size instead of being pinned to a fixed row count.
    "max_eligible_frac": 0.10,
}

# The fraction guard is meaningless on a tiny table (10% of 9 rows is 0.9), and every such platform
# is enabled=false anyway. Apply it only where the percentage means something.
FRAC_GUARD_MIN_ROWS = 500


def _probe(url: str) -> tuple[int | None, str]:
    """Fetch the real listing page and return (status_code, body). Unlike common.http.get (which
    collapses every non-200 to None), this PRESERVES the status so we can tell a 404 (gone) apart
    from a 403/timeout (block) — critical, because we must never delete on a block. Returns
    (None, '') on a network error. Routes wasalt through the Saudi proxy, same as liveness."""
    s = http.session()
    proxies = None
    if "wasalt.sa" in url or "wasalt.com" in url:
        purl = os.environ.get("WASALT_PROXY_URL", "").strip()
        if purl:
            proxies = {"http": purl, "https": purl}
    try:
        r = s.get(url, timeout=25, allow_redirects=True, proxies=proxies)
        return r.status_code, (r.text or "")
    except Exception:
        return None, ""


def verdict(status: int | None, body: str, dead_marker) -> str:
    """'dead' → safe to delete; 'live' → reactivate; 'unknown' → skip (never delete)."""
    if status is None:
        return "unknown"          # network error / proxy failure
    if status in (404, 410):
        return "dead"
    if status != 200:
        return "unknown"          # 403 / 429 / 5xx / unfollowed redirect → transient or block
    return "dead" if dead_marker(body) else "live"


# Alert kinds that mean this platform's scraper/liveness signal cannot currently be trusted for
# the irreversible delete step (owner-directed safety audit, 2026-08-22). This is a PROACTIVE
# precondition, checked BEFORE any candidate is even measured — distinct from the anomaly/fraction
# gates below, which are reactive: they catch the SYMPTOM (a spike in eligible rows) only after a
# degraded platform has already poisoned the candidate population. Wasalt's open
# scraper_failure_step_change (alert 686, standing since 2026-08-18: run-failure rate stepped to
# 60%+ above its own 15-day baseline) is the exact real-world case this exists for — that alert's
# own text already says "partial capture loss degrades freshness and enrichment while every
# count-based check stays green", which is precisely the blind spot a delete step must not inherit.
_HEALTH_GATE_ALERT_KINDS = ("scraper_failure_step_change", "silent_scraper_death")


def _platform_health_ok(client, platform: str) -> tuple[bool, str | None]:
    """(ok, reason). False iff an unresolved alert says this platform's scraper/liveness signal
    cannot currently be trusted. Deliberately narrow to alert KINDS that speak directly to capture
    health (not e.g. a data-fidelity alert unrelated to whether the crawl itself is working) — a
    broader net would freeze deletion on unrelated noise and teach operators to ignore the freeze."""
    rows = (client.table("alert_event").select("id, kind, severity")
            .eq("platform", platform).is_("resolved_at", "null")
            .in_("kind", list(_HEALTH_GATE_ALERT_KINDS)).limit(5).execute().data or [])
    if rows:
        kinds = ", ".join(sorted({r["kind"] for r in rows}))
        ids = ", ".join(str(r["id"]) for r in rows)
        return False, (f"platform health degraded: open alert(s) {kinds} (id {ids}) say this "
                        f"platform's scraper/liveness signal cannot currently be trusted — "
                        f"freezing hard-delete for this platform until resolved.")
    return True, None


def _load_policy(client, platform: str) -> dict:
    row = (client.table("platform_retention_policy").select("*").eq("platform", platform).limit(1).execute().data or [])
    p = dict(DEFAULT_POLICY)
    if row:
        p.update({k: v for k, v in row[0].items() if v is not None})
    return p


def _count_of(res) -> int:
    """Exact row count from a count="exact" response — or FAIL, never guess.

    An earlier draft fell back to len(data) when `.count` was absent. That silently returned 0 for
    the whole eligible population on the 2026-08-09 dry run, which disabled BOTH the anomaly gate
    and the fraction guard at once (0 is under every threshold) while the work-set query still
    happily returned 300 rows to delete. A destructive path must never run on an unmeasured
    population, so an absent count is now a hard error: fail closed, loudly.
    """
    n = getattr(res, "count", None)
    if n is None:
        raise RuntimeError(
            "PostgREST returned no exact count — refusing to run a destructive cleanup against an "
            "unmeasured population. Check the count=\"exact\" query.")
    return int(n)

def _trailing_median_deleted(client, platform: str) -> float:
    rows = (client.table("cleanup_runs").select("deleted")
            .eq("platform", platform).eq("dry_run", False).eq("aborted", False)
            .order("ran_at", desc=True).limit(8).execute().data or [])
    vals = sorted(r["deleted"] for r in rows)
    if not vals:
        return 0.0
    n = len(vals)
    return float(vals[n // 2]) if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) / 2.0


def _bounded_candidates(client, tables, pol, cutoff, safe_cap):
    """GLOBAL oldest-first candidate selection across ALL of a platform's tables, capped at
    safe_cap. Used ONLY by bounded one-time runs (`run(..., bounded_cap=...)`) — the standing
    scheduled path below keeps its existing per-table-then-concat selection completely
    unchanged, so this never alters production behaviour for a normal automated run."""
    cands: list[tuple[str, dict]] = []
    for t in tables:
        rows = (client.table(t).select("id, ad_number, listing_url, missing_count, last_seen_at")
                .eq("active", False).gte("missing_count", pol["min_missing_count"])
                .lt("last_seen_at", cutoff).order("last_seen_at")
                .limit(safe_cap).execute().data or [])
        cands.extend((t, r) for r in rows)
    cands.sort(key=lambda tr: tr[1].get("last_seen_at") or "")
    return cands[:safe_cap]


def run(platform: str, *, dry_run: bool = False, force: bool = False, bounded_cap: int | None = None) -> dict:
    """bounded_cap: manual one-time escape from the anomaly/fraction ABORT-EVERYTHING behaviour,
    for a backlog already proven (by a fresh source-truth audit) to be genuine attrition rather
    than a scraper regression — e.g. a platform whose deletion-eligible population has grown past
    BOTH the anomaly_floor and max_eligible_frac gates at once, so raising anomaly_floor alone
    would not unblock it (aqarcity, 2026-08-16). It is NOT a bypass: the actual work-set is
    hard-capped at min(bounded_cap, max_delete_per_run, the fraction guard's own cap, the anomaly
    threshold) — see the `safe_cap` computation below — so this can never touch more rows than an
    UNBOUNDED run would already be permitted to touch; it only avoids the coarse all-or-nothing
    abort when a smaller in-bounds batch exists. platform_retention_policy is never written by
    this path. Every other guard is unchanged: individual live re-verification per row, the
    30-day/missing-count eligibility rule, dead-marker confirmation, self-heal-on-live for
    anything the recheck finds still live, unknown/403/429/5xx/network-error rows are preserved
    (never deleted), and the full audit trail (cleanup_deletion_log + cleanup_runs) is written
    exactly as for a normal run, with a `note` explaining the cap. Never wired to cron — only
    reachable via an explicit `--bounded-cap` CLI/workflow-dispatch invocation."""
    client = sb()
    reg = PLATFORMS.get(platform)
    pol = _load_policy(client, platform)
    tables = (reg or {}).get("tables") or []
    dead_marker = (reg or {}).get("dead_marker")
    run_id = begin_run(f"cleanup:{platform}")
    stats = {"platform": platform, "dry_run": dry_run, "candidates": 0, "rechecked": 0,
             "deleted": 0, "reactivated": 0, "skipped": 0, "aborted": False, "abort_reason": None,
             # eligible_total = the TRUE unclamped population the anomaly gate judges;
             # work_set = how many of them this run actually touches (<= max_delete_per_run).
             "eligible_total": 0, "work_set": 0, "platform_rows": 0, "note": None}

    def _abort(reason: str):
        stats["aborted"] = True
        stats["abort_reason"] = reason
        print(f"✗ cleanup {platform}: ABORT — {reason}", flush=True)

    try:
        health_ok, health_reason = (True, None)
        if not force and not pol["enabled"]:
            _abort("policy disabled (enabled=false)")
        elif not tables:
            _abort("no tables registered for platform (default-deny)")
        elif pol["require_source_recheck"] and dead_marker is None:
            _abort("require_source_recheck but no dead-check registered — cannot verify, refusing to delete")
        else:
            # Platform-health precondition — NOT bypassed by --force. force exists to override
            # enabled=false (a policy toggle); it was never meant to override a live signal that
            # this platform's capture is currently degraded. Checked here, before ANY candidate is
            # measured, so a degraded platform can never even build an eligible population.
            health_ok, health_reason = _platform_health_ok(client, platform)
            if not health_ok:
                _abort(health_reason)

        if not stats["aborted"]:
            cutoff = (datetime.now(timezone.utc) - _days(pol["min_inactive_days"])).isoformat()

            # ── measure the TRUE eligible population, unclamped by the delete cap ────────────────
            # This count drives the anomaly gate, so the gate sees reality. Previously the same
            # capped SELECT served both roles, which pinned the measurement at cap+1 and caused
            # the deadlock above. Measurement and work-set are now separate concerns.
            eligible_total = 0
            platform_rows = 0
            for t in tables:
                eligible_total += _count_of(
                    client.table(t).select("id", count="exact")
                    .eq("active", False).gte("missing_count", pol["min_missing_count"])
                    .lt("last_seen_at", cutoff).limit(1).execute())
                platform_rows += _count_of(
                    client.table(t).select("id", count="exact").limit(1).execute())
            stats["eligible_total"] = eligible_total
            stats["candidates"] = eligible_total          # what the gate and the audit log see
            stats["platform_rows"] = platform_rows

            median = _trailing_median_deleted(client, platform)
            thresh = max(pol["anomaly_floor"], pol["anomaly_factor"] * median)
            frac_cap = pol["max_eligible_frac"] * platform_rows

            frac_applies = platform_rows >= FRAC_GUARD_MIN_ROWS
            cands = None

            if bounded_cap is not None:
                # Bounded one-time mode — see the `run()` docstring. NEVER aborts on the aggregate
                # gates; instead the work-set is hard-capped at the SAFE number those same gates
                # already permit, so it can never exceed what an unbounded run would allow anyway.
                caps = [bounded_cap, pol["max_delete_per_run"], math.floor(thresh)]
                if frac_applies:
                    caps.append(math.floor(frac_cap))
                safe_cap = max(0, min(caps))
                stats["note"] = (
                    f"bounded one-time run: requested_cap={bounded_cap} -> safe_cap={safe_cap} "
                    f"(bounded by max_delete_per_run={pol['max_delete_per_run']}"
                    + (f", frac_cap={math.floor(frac_cap)}" if frac_applies else "")
                    + f", anomaly_thresh={math.floor(thresh)}); true eligible_total={eligible_total} "
                    + (f"({100.0 * eligible_total / platform_rows:.1f}% of {platform_rows} rows); "
                       if platform_rows else "; ")
                    + f"remaining_after_this_run={max(0, eligible_total - safe_cap)} returns to the "
                      f"normal scheduled cycle. platform_retention_policy untouched.")
                print(f"ℹ cleanup {platform}: BOUNDED — {stats['note']}", flush=True)
                cands = _bounded_candidates(client, tables, pol, cutoff, safe_cap) if safe_cap > 0 else []
            elif eligible_total > thresh:
                # Report the OTHER gate's verdict in the same breath. The two gates are independent
                # and are evaluated in sequence, so an operator who reads only "raise anomaly_floor"
                # can raise it, re-run, and abort a second time on the fraction guard with a message
                # that then blames "a partial crawl or source outage" — a misleading conclusion when
                # the backlog has already been proven to be genuine delistings. aqarcity 2026-08-16
                # is exactly that case: 419 eligible clears neither the floor (408) nor the 10% cap
                # (261 of 2,611 rows). Naming both here makes it ONE owner decision, not two.
                if frac_applies and eligible_total > frac_cap:
                    also = (f" ALSO NOTE: raising anomaly_floor alone would NOT unblock this run — "
                            f"{eligible_total} is {100.0 * eligible_total / platform_rows:.1f}% of "
                            f"{platform_rows} rows and the mass-inactivation guard caps it at "
                            f"{100.0 * pol['max_eligible_frac']:.0f}%, so the next run would abort "
                            f"on that guard instead. Both gates need an owner decision together.")
                else:
                    also = ""
                _abort(f"anomaly: {eligible_total} eligible > threshold {thresh:.0f} "
                       f"(floor {pol['anomaly_floor']}, {pol['anomaly_factor']}× median {median:.0f}). "
                       f"Human review required. NOTE: a STANDING backlog above the floor aborts "
                       f"every run and can never drain — if {eligible_total} is legitimate "
                       f"accumulation rather than a spike, raise anomaly_floor above it; do not "
                       f"force.{also}")
            elif frac_applies and eligible_total > frac_cap:
                # Scale guard: a partial crawl, source outage or sitemap collapse shows up as a
                # large FRACTION of the platform going eligible at once, even when the absolute
                # count is under the floor.
                _abort(f"mass-inactivation guard: {eligible_total} eligible is "
                       f"{100.0 * eligible_total / platform_rows:.1f}% of {platform_rows} rows "
                       f"(cap {100.0 * pol['max_eligible_frac']:.0f}%). Suspect a partial crawl or "
                       f"source outage rather than genuine delistings.")
            else:
                # ── work-set: only now do we pull rows, and only up to the per-run cap ───────────
                cands = []
                for t in tables:
                    rows = (client.table(t).select("id, ad_number, listing_url, missing_count, last_seen_at")
                            .eq("active", False).gte("missing_count", pol["min_missing_count"])
                            .lt("last_seen_at", cutoff).order("last_seen_at")
                            .limit(pol["max_delete_per_run"]).execute().data or [])
                    cands.extend((t, r) for r in rows)
                cands = cands[: pol["max_delete_per_run"]]     # hard cap across ALL tables

            if cands is not None:
                stats["work_set"] = len(cands)
                to_delete: dict[str, list] = {}
                to_reactivate: dict[str, list] = {}
                log_rows: list[dict] = []
                now = datetime.now(timezone.utc)
                for t, r in cands:
                    url = (r.get("listing_url") or "").strip()
                    if pol["require_source_recheck"]:
                        if not url:
                            stats["skipped"] += 1
                            continue
                        status, body = _probe(url)
                        stats["rechecked"] += 1
                        v = verdict(status, body, dead_marker)
                    else:
                        status, v = None, "dead"     # explicit opt-out (not used by default policy)
                    if v == "dead":
                        to_delete.setdefault(t, []).append(r["id"])
                        age_days = _age_days(r.get("last_seen_at"), now)
                        reason = {"inactive_days": age_days, "missing_count": r.get("missing_count"),
                                  "http_status": status, "verdict": "dead"}
                        if bounded_cap is not None:
                            reason["bounded_run"] = True
                            reason["bounded_cap"] = bounded_cap
                        log_rows.append({"run_id": run_id, "platform": platform, "source_table": t,
                                         "listing_id": r["id"], "ad_number": r.get("ad_number"), "listing_url": url,
                                         "reason": reason})
                    elif v == "live":
                        to_reactivate.setdefault(t, []).append(r["id"])
                        stats["reactivated"] += 1
                    else:
                        stats["skipped"] += 1

                if not dry_run:
                    for t, ids in to_reactivate.items():   # self-heal a wrongly-inactive live listing
                        for i in range(0, len(ids), 200):
                            client.table(t).update({"active": True, "missing_count": 0}).in_("id", ids[i:i + 200]).execute()
                    if log_rows:
                        for i in range(0, len(log_rows), 200):
                            client.table("cleanup_deletion_log").insert(log_rows[i:i + 200]).execute()
                    for t, ids in to_delete.items():
                        for i in range(0, len(ids), 200):
                            client.table(t).delete().in_("id", ids[i:i + 200]).execute()
                stats["deleted"] = sum(len(v) for v in to_delete.values())

        client.table("cleanup_runs").insert({k: stats[k] for k in
            ("platform", "dry_run", "candidates", "rechecked", "deleted", "reactivated", "skipped", "aborted", "abort_reason", "note")}).execute()
        ok = not stats["aborted"]
        end_run(run_id, ok=ok, rows_seen=stats["candidates"], rows_upserted=stats["deleted"],
                allow_empty=True, notes=("ABORT: " + stats["abort_reason"]) if stats["aborted"] else
                f"deleted={stats['deleted']} reactivated={stats['reactivated']} skipped={stats['skipped']} dry_run={dry_run}")
        print(f"✓ cleanup {platform}: eligible_total={stats['eligible_total']} "
              f"work_set={stats['work_set']} cap={pol['max_delete_per_run']} "
              f"rechecked={stats['rechecked']} deleted={stats['deleted']} "
              f"reactivated={stats['reactivated']} skipped={stats['skipped']} "
              f"dry_run={dry_run} aborted={stats['aborted']}", flush=True)
        # The headline the owner asked for: reactivated == rows the source proved are still LIVE,
        # i.e. exactly the false-deletions this gate prevented.
        if stats["rechecked"]:
            fp = 100.0 * stats["reactivated"] / stats["rechecked"]
            print(f"  false-positive sample: {stats['reactivated']}/{stats['rechecked']} rechecked "
                  f"came back LIVE ({fp:.1f}%) → reactivated, NOT deleted", flush=True)
        return stats
    except Exception as e:
        end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=f"error: {e}")
        raise


def _days(n):
    from datetime import timedelta
    return timedelta(days=int(n))


def _age_days(last_seen_iso: str | None, now: datetime) -> int | None:
    if not last_seen_iso:
        return None
    try:
        ls = datetime.fromisoformat(last_seen_iso.replace("Z", "+00:00"))
        return (now - ls).days
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Config-driven per-platform retention cleanup")
    ap.add_argument("--platform", required=True)
    ap.add_argument("--dry-run", action="store_true", help="Probe + classify + report; delete nothing.")
    ap.add_argument("--force", action="store_true", help="Run even if policy.enabled=false (all safety guards still apply).")
    ap.add_argument("--bounded-cap", type=int, default=None, metavar="N",
                     help="Manual one-time escape from the anomaly/fraction ABORT-EVERYTHING behaviour for a "
                          "backlog already proven genuine by a fresh source-truth audit. Never lets the work-set "
                          "exceed what an unbounded run would already permit — see run()'s docstring. Never used "
                          "by the scheduled cron path; explicit invocation only.")
    args = ap.parse_args()
    stats = run(args.platform, dry_run=args.dry_run, force=args.force, bounded_cap=args.bounded_cap)
    return 1 if stats["aborted"] and not args.dry_run else 0


if __name__ == "__main__":
    sys.exit(main())
