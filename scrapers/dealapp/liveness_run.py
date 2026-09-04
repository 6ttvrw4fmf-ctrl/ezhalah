"""Dealapp liveness runner — CANDIDATE_PLUS_DIRECT, the first verification this platform has had.

Dealapp shipped with no liveness mechanism at all: 15,899 active listings, 65% unseen by any crawl
in 48h, nothing that could tell a live ad from a dead one. This is that mechanism.

SHAPE OF A RUN.
  1. Harvest dealapp's OWN sitemap (sitemap-5..16, ~56.5k /ad-details ids, refreshed daily).
     This is a CANDIDATE signal and nothing else — see sitemap_candidate_rank().
  2. Order active rows: sitemap-absent first, then oldest last_verified_alive_at (NULLs first,
     i.e. never-verified rows lead).
  3. Probe each candidate's own URL and classify with classify_dealapp() — the merged, unit-proven
     mapping where a schema-less 200 is UNKNOWN, never DEAD.
  4. Feed every verdict through liveness_contract.decide(). That is the only place a deactivation
     can originate, and it enforces the grace window and the auditable reason.
  5. Write: last_verified_alive_at on ALIVE (via verification_patch), strikes on DEAD, nothing at
     all on UNKNOWN.

THREE THINGS THIS RUNNER REFUSES TO DO.

  · It will not deactivate on a run it cannot trust. environment_is_trustworthy() gates every
    write of active=false on the run having positively verified a real share of its probes. If
    dealapp is serving us shells — which it does to some environments, measured 2026-08-30 — then
    that run's 404s and redirects are degraded too, and none of its deaths are believable.
  · It will not deactivate from sitemap absence. Absence only decides probe ORDER.
  · It defaults to DRY RUN. --apply is explicit, and the first production run must be a dry run
    whose report is read before anything is written.

Usage:
  python -m scrapers.dealapp.liveness_run --limit 300              # dry-run report
  python -m scrapers.dealapp.liveness_run --limit 300 --apply      # write strikes/verifications
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time
from datetime import datetime, timezone
from typing import Optional

from curl_cffi import requests as cc

from scrapers.common.db import begin_run, end_run, sb
from scrapers.common.liveness_contract import (
    ALIVE, DEAD, UNKNOWN, EvidenceKind, decide, verification_patch,
)
from scrapers.common.liveness_policies import policy_for
from scrapers.dealapp.liveness import (
    classify_dealapp, environment_is_trustworthy, sitemap_candidate_rank,
)

BASE = "https://dealapp.sa"
TABLE = "dealapp_residential_listings"
SITEMAP_INDEX = f"{BASE}/sitemap.xml"
MIN_INTERVAL = 0.35

# The shared Saudi residential proxy is ONE capacity-limited pool (ARCHITECTURE.md §20 rule 14).
# When this runner uses it, it records itself under a DIFFERENT platform label so
# mon_detect_proxy_contention() can see it. A proxy consumer that the contention detector cannot
# count is exactly the blind spot that detector's own text warns about, and the 2026-08-17 wasalt
# incident (failure 0.1% -> 66.7%) is what it costs.
RUN_NAME_CI = "dealapp_liveness"
RUN_NAME_PROXY = "dealapp_liveness_proxy"


class RequestBudget:
    """A hard ceiling on requests, counted across sitemap AND probes.

    The proxy is shared, so a bounded experiment has to be bounded by the thing the pool actually
    feels — requests — not by `--limit`, which counts only listings and ignores the 16 sitemap
    fetches. spend() returns False once the budget is gone; callers stop cleanly rather than
    truncating mid-write.
    """

    def __init__(self, cap: int = 0):
        self.cap, self.used = cap, 0

    def spend(self) -> bool:
        if self.cap and self.used >= self.cap:
            return False
        self.used += 1
        return True

    @property
    def exhausted(self) -> bool:
        return bool(self.cap) and self.used >= self.cap


def _session(proxy_url: str = "") -> cc.Session:
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept-Language": "ar,en;q=0.8"})
    if proxy_url:
        # Single session, sequential loop, MIN_INTERVAL throttle => exactly ONE concurrent proxy
        # session. That is the smallest consumer the pool can have, and it is deliberate.
        s.proxies = {"http": proxy_url, "https": proxy_url}
    return s


def _throttle(_last: list[float] = [0.0]) -> None:
    delta = time.time() - _last[0]
    if delta < MIN_INTERVAL:
        time.sleep(MIN_INTERVAL - delta)
    _last[0] = time.time()


def harvest_sitemap_ids(s: cc.Session, budget: Optional[RequestBudget] = None) -> frozenset[str]:
    """Every /ad-details/{id} dealapp currently publishes. Empty set on failure — and an empty set
    is handled by the caller as 'no candidate signal', never as 'everything is absent/dead'."""
    ids: set[str] = set()
    if budget is not None and not budget.spend():
        return frozenset()
    try:
        idx = s.get(SITEMAP_INDEX, timeout=45).text or ""
    except Exception:
        return frozenset()
    for loc in re.findall(r"<loc>([^<]+)</loc>", idx):
        if not loc.endswith(".xml"):
            continue
        if budget is not None and not budget.spend():
            break   # budget gone: a PARTIAL sitemap is a weaker candidate signal, never a verdict
        try:
            _throttle()
            body = s.get(loc, timeout=90).text or ""
        except Exception:
            continue  # one unreadable sitemap file must not look like a mass delisting
        ids.update(re.findall(r"/ad-details/(\d+)", body))
    return frozenset(ids)


def _adid(listing_url: str) -> str:
    m = re.search(r"/ad-details/(\d+)", listing_url or "")
    return m.group(1) if m else ""


def _collect_candidates(client, limit: int) -> list[dict]:
    """Active rows, never-verified first. Ordering by last_verified_alive_at NULLS FIRST is the
    point of the column: rows nobody has ever proved alive are exactly the ones to probe first."""
    rows = (client.table(TABLE)
            .select("id, ad_number, listing_url, missing_count, last_verified_alive_at")
            .eq("active", True)
            .order("last_verified_alive_at", desc=False, nullsfirst=True)
            .limit(max(limit * 4, limit) if limit else 20000)
            .execute().data or [])
    return [r for r in rows if (r.get("listing_url") or "").strip()]


def probe(s: cc.Session, url: str, budget: Optional[RequestBudget] = None
          ) -> tuple[Optional[int], str, str]:
    """(status, body, final_url). An exception is (None, '', '') → UNKNOWN, never a death.

    A retry costs the pool another request, so retries are charged to the budget too.
    """
    for attempt in range(3):
        if budget is not None and not budget.spend():
            return None, "", ""      # out of budget => UNKNOWN, which writes nothing
        try:
            _throttle()
            r = s.get(url, timeout=45, allow_redirects=True)
            return r.status_code, (r.text or ""), str(getattr(r, "url", "") or "")
        except Exception:
            time.sleep(1.0 * (attempt + 1))
    return None, "", ""


def main() -> int:
    ap = argparse.ArgumentParser(description="Dealapp liveness sweep (candidate + direct confirm)")
    ap.add_argument("--limit", type=int, default=300, help="probe at most N candidates")
    ap.add_argument("--apply", action="store_true",
                    help="write strikes/verifications/deactivations (default: dry run, writes nothing)")
    ap.add_argument("--proxy", action="store_true",
                    help="route through the shared Saudi residential proxy (WASALT_PROXY_URL). "
                         "OPT-IN ONLY. That pool is capacity-limited and shared with wasalt "
                         "(ARCHITECTURE.md §20 rule 14) — pair it with --max-requests.")
    ap.add_argument("--max-requests", type=int, default=0,
                    help="hard ceiling on TOTAL requests (sitemap + probes + retries). "
                         "0 = unlimited. Required in practice for any proxy run.")
    args = ap.parse_args()

    proxy_url = os.environ.get("WASALT_PROXY_URL", "").strip() if args.proxy else ""
    if args.proxy and not proxy_url:
        # Fail loudly rather than silently falling back to CI egress and reporting the result as
        # if it came from the proxy — that would make the experiment unreadable.
        print("✗ --proxy requested but WASALT_PROXY_URL is empty", flush=True)
        return 2

    budget = RequestBudget(args.max_requests)
    policy = policy_for("dealapp")
    client = sb()
    run_id = begin_run(RUN_NAME_PROXY if proxy_url else RUN_NAME_CI)
    s = _session(proxy_url)
    now_iso = datetime.now(timezone.utc).isoformat()

    stats = {"scanned": 0, "alive": 0, "dead": 0, "unknown": 0,
             "verified": 0, "struck": 0, "deactivated": 0, "sitemap_ids": 0, "quarantined": False}
    try:
        sitemap = harvest_sitemap_ids(s, budget)
        stats["sitemap_ids"] = len(sitemap)

        cands = _collect_candidates(client, args.limit)
        # Sitemap-absent first — probe order only, never a verdict.
        cands.sort(key=lambda r: sitemap_candidate_rank(_adid(r["listing_url"]), sitemap)
                   if sitemap else 1)
        cands = cands[:args.limit] if args.limit else cands

        pending: list[tuple[dict, str, int]] = []   # (row, action, strikes)
        for row in cands:
            adid = _adid(row["listing_url"])
            if budget.exhausted:
                break        # stop cleanly on the boundary; a partial sweep is a normal outcome
            status, body, final_url = probe(s, row["listing_url"], budget)
            verdict = classify_dealapp(status, body=body, adid=adid,
                                       final_url=final_url, requested_url=row["listing_url"])
            stats["scanned"] += 1
            stats[{ALIVE: "alive", DEAD: "dead", UNKNOWN: "unknown"}[verdict]] += 1

            d = decide(verdict, strikes=int(row.get("missing_count") or 0),
                       policy=policy, evidence=EvidenceKind.DIRECT)
            pending.append((row, d.action, d.strikes))

            if args.apply and d.action == "reset":
                patch = {"missing_count": 0, **verification_patch(d, now_iso=now_iso)}
                client.table(TABLE).update(patch).eq("id", row["id"]).execute()
                stats["verified"] += 1

        # A run that verified almost nothing is being served shells; its deaths are not evidence.
        trusted = environment_is_trustworthy(stats["alive"], stats["scanned"])
        if not trusted:
            stats["quarantined"] = True

        if args.apply and trusted:
            for row, action, strikes in pending:
                if action == "strike":
                    client.table(TABLE).update({"missing_count": strikes}).eq("id", row["id"]).execute()
                    stats["struck"] += 1
                elif action == "deactivate":
                    client.table(TABLE).update(
                        {"missing_count": strikes, "active": False}).eq("id", row["id"]).execute()
                    stats["deactivated"] += 1

        note = (f"{'APPLY' if args.apply else 'DRY-RUN'} "
                f"egress={'proxy' if proxy_url else 'ci'} "
                f"requests={budget.used}{f'/{budget.cap}' if budget.cap else ''} "
                f"scanned={stats['scanned']} "
                f"alive={stats['alive']} dead={stats['dead']} unknown={stats['unknown']} "
                f"verified={stats['verified']} strike={stats['struck']} "
                f"inactivated={stats['deactivated']} sitemap_ids={stats['sitemap_ids']}"
                + ("" if trusted else " | QUARANTINED: verified-rate too low, no deactivation written"))
        print(note, flush=True)
        end_run(run_id, ok=True, rows_seen=stats["scanned"],
                rows_upserted=stats["verified"] + stats["deactivated"],
                notes=note, allow_empty=stats["scanned"] == 0)
        return 0
    except Exception as e:
        end_run(run_id, ok=False, rows_seen=stats["scanned"], rows_upserted=0, notes=f"error: {e}")
        raise


if __name__ == "__main__":
    sys.exit(main())
