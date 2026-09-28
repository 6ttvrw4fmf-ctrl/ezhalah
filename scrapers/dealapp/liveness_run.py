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
    OriginBudget, classify_dealapp, environment_is_trustworthy, from_edge, sitemap_candidate_rank,
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


_ORIGIN = OriginBudget()
_DEADLINE = time.monotonic() + 50 * 60   # pacing must never outlast the 60-min job


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
    """Active rows, least-recently LOOKED AT first (LISTING_LIFECYCLE_ENGINEER.md §4.1d).

    This used to order by last_verified_alive_at NULLS FIRST. A row dealapp answers with a shell
    never gets that stamp, so it stayed at the head forever: over 2026-09-21..28, 312 rows were
    probed on all 8 runs and 159 on 7, every one UNKNOWN, and from an ordinary network all 16
    sampled render the same listing-less page as bogus id 999999999. The run re-read the same
    unresolvable rows daily and reported "560 of 600 UNKNOWN". last_liveness_probe_at moves on
    every verdict, so a probed row goes to the back for a full cycle."""
    rows = (client.table(TABLE)
            .select("id, ad_number, listing_url, missing_count, last_verified_alive_at")
            .eq("active", True)
            .order("last_liveness_probe_at", desc=False, nullsfirst=True)
            .limit(max(limit * 4, limit) if limit else 20000)
            .execute().data or [])
    return [r for r in rows if (r.get("listing_url") or "").strip()]


BOGUS_ADID = "999999999"


def _canaries(client, s, budget: Optional[RequestBudget]) -> dict:
    """Positive: the 3 rows most recently proved alive; at least one must still read ALIVE.
    Negative: an id that cannot exist must NOT read ALIVE. Charged to the request budget."""
    rows = (client.table(TABLE).select("listing_url, last_verified_alive_at")
            .eq("active", True).not_.is_("last_verified_alive_at", "null")
            .order("last_verified_alive_at", desc=True).limit(3).execute().data or [])
    live = sum(probe_listing(s, r["listing_url"], budget)[0] == ALIVE for r in rows)
    bogus_alive = probe_listing(s, f"{BASE}/ar/ad-details/{BOGUS_ADID}", budget)[0] == ALIVE
    return {"live": live, "live_n": len(rows), "live_ok": live > 0, "bogus_alive": bogus_alive}


# ── A CDN copy is not the source's answer (2026-09-28) ─────────────────────────────────────────
# dealapp.sa sits behind CloudFront, which caches the rendered ad page for DAYS and keys it on the
# path only (a query string is ignored). Measured from one POP: the bare /ar/ad-details/{id} of a
# live ad came back as dealapp's registration wall (the view-quota page, see liveness.py) with
# `Age: 130553` (36 h), while /ar/ad-details/{id}/ (a different cache key, so a fresh origin render)
# carried that ad's schema. CloudFront freezes whichever page the origin gave — which is why retrying
# the bare URL never recovered (dealapp-fetch-diagnostic retry mode: 0/49 up to 120 s). So: never
# read an old cached copy as an answer; when the copy we got is stale, ask the next cache key (an
# edge hit is refunded to the quota). A fresh render is final.
FRESH_MAX_AGE_S = 3600


def _variants(listing_url: str) -> list[str]:
    base = listing_url.rstrip("/")
    en = base.replace("/ar/ad-details/", "/en/ad-details/", 1)
    return [base + "/", en + "/", en]


def probe_listing(s: cc.Session, listing_url: str, budget: Optional[RequestBudget] = None
                  ) -> tuple[str, Optional[int]]:
    """(verdict, http_status) for one ad: the first variant that is not UNKNOWN, else UNKNOWN."""
    adid = _adid(listing_url)
    for url in _variants(listing_url):
        status, body, final = probe(s, url, budget)
        if status is None:
            continue          # a stale CDN copy (or no answer): ask the next cache key
        # A fresh render is final — every extra key is one more render against dealapp's
        # per-visitor quota (liveness.OriginBudget). requested_url without the trailing slash: a
        # slash-stripping redirect must not read as "moved off the ad path" (DEAD).
        return classify_dealapp(status, body=body, adid=adid, final_url=final,
                                requested_url=url.rstrip("/")), status
    return UNKNOWN, None


def probe(s: cc.Session, url: str, budget: Optional[RequestBudget] = None
          ) -> tuple[Optional[int], str, str]:
    """(status, body, final_url). An exception is (None, '', '') → UNKNOWN, never a death.
    A CloudFront copy older than FRESH_MAX_AGE_S is also (None, '', ''): not a current answer.

    A retry costs the pool another request, so retries are charged to the budget too.
    """
    for attempt in range(3):
        if budget is not None and not budget.spend():
            return None, "", ""      # out of budget => UNKNOWN, which writes nothing
        if time.monotonic() > _DEADLINE:
            return None, "", ""      # out of time => UNKNOWN, which writes nothing
        try:
            # dealapp's anonymous view quota (liveness.py): an unpaced sweep walls itself after
            # ~10 renders and leaves the wall cached under each ad's URL for days.
            slot = _ORIGIN.acquire()
            r = s.get(url, timeout=45, allow_redirects=True)
            if from_edge(r):
                _ORIGIN.refund(slot)
            try:
                age = int((r.headers or {}).get("age") or 0)
            except (TypeError, ValueError):
                age = 0
            if age > FRESH_MAX_AGE_S:
                return None, "", ""
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

        # Canaries first: one row we proved alive most recently must still read ALIVE, and a bogus
        # id must NOT. The second is the one that matters — if a page that cannot exist reads
        # ALIVE, the classifier or the transport is lying and nothing this run sees is written.
        canary = _canaries(client, s, budget)
        stats["canary"] = canary
        if canary["bogus_alive"]:
            print(f"✗ CANARY: bogus id {BOGUS_ADID} read ALIVE — nothing will be written", flush=True)

        cands = _collect_candidates(client, args.limit)
        # Within the least-recently-probed window, sitemap-PRESENT first. dealapp gives no death
        # signal on the ad URL (a removed ad renders the same shell as a bogus id, which is
        # UNKNOWN), so leading with sitemap-absent rows only spent the budget on answers that can
        # never come. Probe order only, never a verdict; the rotation still reaches every row.
        cands.sort(key=lambda r: -sitemap_candidate_rank(_adid(r["listing_url"]), sitemap)
                   if sitemap else 0)
        cands = cands[:args.limit] if args.limit else cands

        writes_ok = args.apply and not canary["bogus_alive"]
        pending: list[tuple[dict, str, int, int]] = []   # (row, action, strikes, http_status)
        for row in cands:
            adid = _adid(row["listing_url"])
            if budget.exhausted:
                break        # stop cleanly on the boundary; a partial sweep is a normal outcome
            verdict, status = probe_listing(s, row["listing_url"], budget)
            stats["scanned"] += 1
            stats[{ALIVE: "alive", DEAD: "dead", UNKNOWN: "unknown"}[verdict]] += 1

            d = decide(verdict, strikes=int(row.get("missing_count") or 0),
                       policy=policy, evidence=EvidenceKind.DIRECT)
            pending.append((row, d.action, d.strikes, status))

            if writes_ok and d.action == "reset":
                # last_liveness_probe_at = "we LOOKED", whatever the verdict. It is what lets
                # this sweep's own worklist rotate fairly instead of re-reading the rows it can
                # never resolve (migration 20260924). Never evidence of life on its own.
                patch = {"missing_count": 0, "last_liveness_probe_at": now_iso,
                         **verification_patch(d, now_iso=now_iso)}
                client.table(TABLE).update(patch).eq("id", row["id"]).execute()
                stats["verified"] += 1

        # A run that verified almost nothing is being served shells; its deaths are not evidence.
        trusted = (environment_is_trustworthy(stats["alive"], stats["scanned"])
                   and canary["live_ok"] and not canary["bogus_alive"])
        if not trusted:
            stats["quarantined"] = True

        if writes_ok:
            # "We LOOKED", for every row this run read that no branch below writes: UNKNOWNs, and
            # strikes/kills the trust gate held back. Never evidence — only the rotation key.
            looked = [row["id"] for row, action, _s, _st in pending
                      if action not in ("reset",) and not (trusted and action in ("strike", "deactivate"))]
            for i in range(0, len(looked), 200):
                client.table(TABLE).update({"last_liveness_probe_at": now_iso}) \
                    .in_("id", looked[i:i + 200]).execute()

        if writes_ok and trusted:
            for row, action, strikes, _status in pending:
                if action == "strike":
                    client.table(TABLE).update({"missing_count": strikes,
                                                "last_liveness_probe_at": now_iso}).eq("id", row["id"]).execute()
                    stats["struck"] += 1
                elif action == "deactivate":
                    client.table(TABLE).update(
                        {"missing_count": strikes, "active": False,
                         "last_liveness_probe_at": now_iso}).eq("id", row["id"]).execute()
                    stats["deactivated"] += 1

        # ── Per-row evidence (dealapp_liveness_detail, migration 20260831004139) ──────────────────
        # Created 2026-08-31 together with four arms of mon_detect_served_despite_direct_404 that
        # read it, and never written: measured 2026-09-12, dealapp_liveness_detail_id_seq.last_value
        # was still NULL and n_tup_ins = 0, so that detector was permanently dark on dealapp.
        #
        # Written AFTER the trust gate on purpose, so `applied` records what actually reached the
        # row rather than what was contemplated. On a quarantined run — dealapp's normal outcome,
        # §5.1 — every row lands with applied=false, which is the honest record: the verdict was
        # reached and deliberately not applied. ALIVE is not logged (last_verified_alive_at carries
        # it); an UNKNOWN lands as 'transient', because the distinction between "the source said
        # gone" and "the source did not answer" is the whole evidence this table exists to keep.
        # Best-effort, evidence-only: it gates nothing and can never deactivate a row.
        detail_rows = [
            {
                "run_at": now_iso,
                "source_table": TABLE,
                "listing_id": row["id"],
                "http_status": st if st else None,   # NULL = the fetch itself failed
                # dealapp_liveness_detail's CHECK allows ('strike','kill','unknown') — NOT
                # 'transient', which is aqar_liveness_detail's word for the same state. Measured the
                # hard way on 2026-09-13: the first real run after PR #2390 emitted 573 'transient'
                # rows, every insert violated the constraint, and the best-effort handler swallowed
                # it — the sequence advanced to 2 while the table stayed empty. An evidence writer
                # whose every write is rejected is indistinguishable from a working one unless
                # something checks the VOCABULARY, which is why
                # scripts/verify-liveness-evidence-tables-have-writers.ts now does.
                "verdict": {"strike": "strike", "deactivate": "kill"}.get(action, "unknown"),
                "missing_count_before": int(row.get("missing_count") or 0),
                "missing_count_after": strikes,
                "applied": bool(writes_ok and trusted and action in ("strike", "deactivate")),
            }
            for row, action, strikes, st in pending
            if action != "reset"
        ]
        for i in range(0, len(detail_rows), 500):
            chunk = detail_rows[i:i + 500]
            try:
                client.table("dealapp_liveness_detail").insert(chunk).execute()
            except Exception as exc:  # noqa: BLE001 — logging must not break the lifecycle
                print(f"⚠ detail-log insert failed (non-fatal, {len(chunk)} rows): "
                      f"{str(exc)[:160]}", flush=True)

        note = (f"{'APPLY' if args.apply else 'DRY-RUN'} "
                f"egress={'proxy' if proxy_url else 'ci'} "
                f"requests={budget.used}{f'/{budget.cap}' if budget.cap else ''} "
                f"scanned={stats['scanned']} "
                f"alive={stats['alive']} dead={stats['dead']} unknown={stats['unknown']} "
                f"verified={stats['verified']} strike={stats['struck']} "
                f"inactivated={stats['deactivated']} sitemap_ids={stats['sitemap_ids']} "
                f"canary_live={canary['live']}/{canary['live_n']} "
                f"canary_bogus={'ALIVE!' if canary['bogus_alive'] else 'not-alive'}"
                + ("" if trusted else " | QUARANTINED: verified-rate or canary failed, no deactivation written"))
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
