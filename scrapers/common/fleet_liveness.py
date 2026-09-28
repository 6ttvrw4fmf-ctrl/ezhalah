"""Daily DIRECT liveness for the small sites — the same job aqar gets (owner, 2026-09-28: «Aqar is
doing a good job; we need the same job for all those websites, urgently»).

Aqar works because every day its live listings are re-read at their own URL, three "gone" answers
in a row hide one, and a live answer clears the strikes and stamps last_verified_alive_at. A small
site's crawl only tells us an ad is still in its index; this job asks each ad's own page.

PER SITE, EVERY RUN (each site on its own run label, fleet_liveness:<site>, LISTING_LIVENESS.md §9):
  1. Worklist: EVERY active row, every day — aqar's own window (owner, 2026-09-28: «every website
     must be as strong as Aqar»: aqar is DIRECT_REVISIT/48h, swept daily, 93.7% in time). Struck
     rows first, then the longest since we last looked, so a run cut short still reads the rows
     that matter. One read per PACE_S per site, at most MAX_READS per site per run (the safe rate).
  2. Opening controls: MIN_CANARIES ads its crawl saw most recently must come back 'live' through the
     site's own oracle, or the site is skipped this run (liveness_trust.canary_environment_ok).
  3. Each ad is read by THE SITE'S OWN measured oracle — the same `verify_gone` its scraper hands
     to db.prune_unseen(), never a copy — and the answer goes through liveness_contract.decide():
     'gone' → a DIRECT strike, the 3rd hides it; 'live' → strikes cleared + last_verified_alive_at;
     anything else → UNKNOWN, nothing written but "we looked".
  4. Closing controls, and a per-site cap: more hides than max(KILL_FLOOR, KILL_FRAC × active) in
     one run is a broken checker or a block, not a mass delisting. Either failing, no strike and no
     hide is written (ALIVE stamps stand: a block cannot fabricate a live page, §5.4).
  5. Every hide first writes its evidence row (ops_stale_inactivation_probe, verdict GONE, the
     oracle's own reason) so mon_detect_prune_kill_without_source_verdict can account for it.

SHADOW FIRST. A site outside APPLY decides everything and writes nothing (LIFECYCLE_ENGINEER.md,
protection 2). A site joins APPLY only after its shadow run was read and every control was right.

  python -m scrapers.common.fleet_liveness                 # every site (sites outside APPLY: shadow)
  python -m scrapers.common.fleet_liveness --site raghdan --shadow
"""
from __future__ import annotations

import argparse
import importlib
import math
import sys
import time
from datetime import datetime, timedelta, timezone

from scrapers.common.db import begin_run, end_run, sb
from scrapers.common.liveness_contract import ALIVE, DEAD, UNKNOWN, EvidenceKind, decide, verification_patch
from scrapers.common.liveness_policies import policy_for
from scrapers.common.liveness_trust import MIN_CANARIES, canary_environment_ok

# platform → (its tables, "module:attr" of its measured verify_gone(ad_number) -> (verdict, reason)).
# Each oracle was control-validated when it was written (see its own comment) and re-measured from
# GitHub Actions on 2026-09-28 (lifecycle-spot-check.yml: hidden ads 404, live ads 200, 5/5 controls).
SITES: dict[str, tuple[tuple[str, ...], str]] = {
    "jazwtn":    (("jazwtn_residential_listings", "jazwtn_commercial_listings"), "scrapers.jazwtn.run:_probe.verify_gone"),
    "mizlaj":    (("mizlaj_residential_listings", "mizlaj_commercial_listings"), "scrapers.mizlaj.run:_probe.verify_gone"),
    "nowaisiry": (("nowaisiry_residential_listings", "nowaisiry_commercial_listings"), "scrapers.nowaisiry.run:_probe.verify_gone"),
    "raghdan":   (("raghdan_residential_listings", "raghdan_commercial_listings"), "scrapers.raghdan.run:_verify_gone"),
}

# Sites whose shadow run was read and found right. Everything else only decides.
APPLY: frozenset[str] = frozenset()

PACE_S = 1.0            # one read a second per site: a small WordPress site's safe rate
MAX_READS = 3000        # × PACE_S + fetch time stays inside the workflow's 120-minute ceiling
CONTROL_HOURS = 48
KILL_FLOOR, KILL_FRAC = 3, 0.10
_VERDICT = {"gone": DEAD, "live": ALIVE}


def oracle_for(spec: str):
    module, attr = spec.split(":")
    obj = importlib.import_module(module)
    for part in attr.split("."):
        obj = getattr(obj, part)
    return obj


def read(oracle, ad_number: str) -> tuple[str, str]:
    """The site's own answer mapped onto the contract's three values. A raising oracle is UNKNOWN."""
    try:
        out = oracle(ad_number)
    except Exception as e:  # noqa: BLE001 — a broken read is never evidence of death
        return UNKNOWN, f"oracle raised {type(e).__name__}: {e}"
    said, why = out if isinstance(out, tuple) else (out, "")
    return _VERDICT.get(said, UNKNOWN), why


def kill_cap(active: int) -> int:
    return max(KILL_FLOOR, math.ceil(KILL_FRAC * active))


def _rows(client, table: str, cols: str, *, order: list[tuple[str, bool]], limit: int, since=None) -> list[dict]:
    q = client.table(table).select(cols).eq("active", True)
    if since:
        q = q.gte("last_seen_at", since)
    for col, desc in order:
        q = q.order(col, desc=desc, nullsfirst=not desc)
    return [dict(r, _table=table) for r in (q.limit(limit).execute().data or []) if r.get("ad_number")]


def controls_ok(client, tables, oracle) -> tuple[bool, str]:
    since = (datetime.now(timezone.utc) - timedelta(hours=CONTROL_HOURS)).isoformat()
    ctl = []
    for t in tables:
        ctl += _rows(client, t, "ad_number, last_seen_at", order=[("last_seen_at", True)],
                     limit=MIN_CANARIES, since=since)
    ctl = sorted(ctl, key=lambda r: r.get("last_seen_at") or "", reverse=True)[:MIN_CANARIES]
    alive = sum(read(oracle, r["ad_number"])[0] == ALIVE for r in ctl)
    return canary_environment_ok(alive, len(ctl)), f"controls {alive}/{len(ctl)} live"


def run_site(site: str, *, shadow: bool) -> dict:
    tables, spec = SITES[site]
    shadow = shadow or site not in APPLY
    client = sb()
    policy = policy_for(site)
    now = datetime.now(timezone.utc).isoformat()
    run_id = begin_run(f"fleet_liveness:{site}")
    st = {"site": site, "shadow": shadow, "active": 0, "probed": 0, ALIVE: 0, DEAD: 0, UNKNOWN: 0,
          "verified": 0, "struck": 0, "hidden": 0, "would_hide": [], "quarantined": None}
    try:
        oracle = oracle_for(spec)
        for t in tables:
            st["active"] += client.table(t).select("id", count="exact").eq("active", True).limit(1).execute().count or 0
        ok, why = controls_ok(client, tables, oracle)
        if not ok:
            st["quarantined"] = f"opening {why}: the site is not answering truthfully, nothing read"
        else:
            size = min(st["active"], MAX_READS)
            if st["active"] > MAX_READS:
                print(f"{site}: {st['active']} active > {MAX_READS} reads/run — cannot reach aqar's "
                      f"daily window at {PACE_S}s/read", flush=True)
            order = [("missing_count", True), ("last_liveness_probe_at", False)]
            work = []
            for t in tables:
                work += _rows(client, t, "id, ad_number, listing_url, missing_count, last_liveness_probe_at",
                              order=order, limit=size)
            work = sorted(work, key=lambda r: (-(r.get("missing_count") or 0), r.get("last_liveness_probe_at") or ""))[:size]
            alive, looked, dead_side = [], [], []
            for r in work:
                time.sleep(PACE_S)
                v, why = read(oracle, r["ad_number"])
                st["probed"] += 1
                st[v] += 1
                d = decide(v, strikes=int(r.get("missing_count") or 0), policy=policy, evidence=EvidenceKind.DIRECT)
                if d.action == "reset":
                    alive.append((r, d))
                elif d.action in ("strike", "deactivate"):
                    dead_side.append((r, d, why))
                else:
                    looked.append(r)
            kills = [x for x in dead_side if x[1].action == "deactivate"]
            st["would_hide"] = [f"{r['_table']}:{r['id']} {r.get('listing_url')} — {why}" for r, _, why in kills]
            ok, why = controls_ok(client, tables, oracle)
            if not ok:
                st["quarantined"] = f"closing {why}: no strike or hide written"
            elif len(kills) > kill_cap(st["active"]):
                st["quarantined"] = f"{len(kills)} hides > cap {kill_cap(st['active'])}: no strike or hide written"
            if not shadow:
                for r, d in alive:
                    client.table(r["_table"]).update({"missing_count": 0, "last_liveness_probe_at": now,
                                                      **verification_patch(d, now_iso=now)}).eq("id", r["id"]).execute()
                    st["verified"] += 1
                for r in looked + ([x[0] for x in dead_side] if st["quarantined"] else []):
                    client.table(r["_table"]).update({"last_liveness_probe_at": now}).eq("id", r["id"]).execute()
                if not st["quarantined"]:
                    for r, d, why in dead_side:
                        patch = {"missing_count": d.strikes, "last_liveness_probe_at": now}
                        if d.action == "deactivate":
                            client.table("ops_stale_inactivation_probe").insert({
                                "source_table": r["_table"], "listing_id": r["id"], "ad_number": r["ad_number"],
                                "listing_url": r.get("listing_url") or "", "verdict": "GONE",
                                "oracle": f"fleet_liveness.{site}", "note": f"{d.reason} · {why}"}).execute()
                            patch["active"] = False
                            st["hidden"] += 1
                        else:
                            st["struck"] += 1
                        client.table(r["_table"]).update(patch).eq("id", r["id"]).execute()
        note = (f"{'SHADOW' if shadow else 'APPLY'} active={st['active']} probed={st['probed']} "
                f"alive={st[ALIVE]} dead={st[DEAD]} unknown={st[UNKNOWN]} verified={st['verified']} "
                f"struck={st['struck']} hidden={st['hidden']} would_hide={len(st['would_hide'])}"
                + (f" | QUARANTINED: {st['quarantined']}" if st["quarantined"] else ""))
        print(f"{site}: {note}", flush=True)
        for line in st["would_hide"][:20]:
            print(f"  would hide: {line}", flush=True)
        end_run(run_id, ok=True, rows_seen=st["probed"], rows_upserted=st["verified"] + st["hidden"],
                notes=note, allow_empty=True)
        return st
    except Exception as e:
        end_run(run_id, ok=False, rows_seen=st["probed"], rows_upserted=0, notes=f"error: {e}")
        raise


def main() -> int:
    ap = argparse.ArgumentParser(description="Daily DIRECT liveness for the small sites")
    ap.add_argument("--site", action="append", choices=sorted(SITES), help="default: every site")
    ap.add_argument("--shadow", action="store_true", help="decide and report, write nothing")
    a = ap.parse_args()
    failed = 0
    for site in a.site or sorted(SITES):
        try:
            run_site(site, shadow=a.shadow)
        except Exception as e:  # noqa: BLE001 — one site failing never stops the rest
            print(f"✗ {site}: {e}", flush=True)
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
