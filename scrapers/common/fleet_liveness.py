"""Daily DIRECT liveness for every site with a measured oracle — the same job aqar gets (owner,
2026-09-28: «Aqar is doing a good job; we need the same job for all those websites, urgently», and
«every website must be as strong as Aqar, not weaker»).

Aqar works because every day its live listings are re-read at their own URL, three "gone" answers
in a row hide one, and a live answer clears the strikes and stamps last_verified_alive_at. A small
site's crawl only tells us an ad is still in its index; this job asks each ad's own page.

PER SITE, EVERY RUN (one matrix job per site, its own run label fleet_liveness:<site>, §9):
  1. Worklist: EVERY active row, every day — aqar's window (DIRECT_REVISIT/48h, swept daily). Struck
     rows first, then the longest since we last looked, so a run cut short reads the rows that
     matter first. One read per PACE_S; a site stops reading at BUDGET_S and says how much of its
     active set it covered, so a site too big for aqar's window is visible, never quietly partial.
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
protection 2). A site joins APPLY only after its shadow run was read: controls right, would-hides
under the cap and confirmed gone by a second transport (lifecycle-spot-check.yml).

  python -m scrapers.common.fleet_liveness --site raghdan            # outside APPLY: shadow
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
from scrapers.common.liveness_policies import FLEET_DAILY_DIRECT, policy_for
from scrapers.common.liveness_trust import MIN_CANARIES, canary_environment_ok

# platform → its scraper's own measured oracle, exactly what it hands to db.prune_unseen():
#   "module:attr"      a verify_gone(ad_number) -> (verdict, reason)
#   "module:factory()" a factory that takes a positive-control row and returns that callable
#                      (`_make_verify_gone(control)`, the canary-gated shape 30 scrapers share)
# A site starts in shadow and joins APPLY only after its shadow run was read.
SITES: dict[str, str] = {
    **{p: f"scrapers.{p}.run:_probe.verify_gone" for p in (
        "aldarim", "aqaralriyadh", "hajer", "jazwtn", "souq24")},
    **{p: f"scrapers.{p}.run:_verify_gone" for p in (
        "akariyoun", "aljassim", "almotmkenah", "alshawaf", "aqaralsaudia", "aqargate", "bossbih",
        "daryusuf", "eaqartabuk", "ebriza", "eilmalriyada", "hasaad", "moftah", "nufouth", "raghdan",
        "rakez", "sakani", "sanadak", "snam", "suwar")},
    **{p: f"scrapers.{p}.run:verify_gone" for p in ("wadod",)},
    **{p: f"scrapers.{p}.run:_make_verify_gone()" for p in (
        "abaad", "albdah", "alsaedan", "azure", "dwelleo", "ego", "expattrusted", "flow",
        "gomenassat", "hazim", "ialqarawi", "ibaax", "justsa", "livingcompound", "marksa",
        "muhaysini", "nofodh", "qmra", "razre", "reinvest", "remaxsa", "rightcompound", "safa",
        "sakan", "sodasyat", "sokok", "sukna", "tamyaz", "tuba", "villassa")},
}

# NOT here, and why (shadow run 36490769167, 2026-09-28): mizlaj, nowaisiry, eastabha and muktamel —
# their oracles have no "live" answer by design (a 200 is UNKNOWN), so no control can ever pass and
# nothing could be verified; alrifai — its "live" needs the crawl's own catalogue of that run;
# mustqr — its API refuses GitHub Actions egress; masar — one listing, and the control gate needs five.

# Sites whose shadow run was read and found right (liveness_policies.FLEET_DAILY_DIRECT — the same
# list makes them DIRECT_REVISIT). Everything else only decides.
APPLY: frozenset[str] = frozenset(FLEET_DAILY_DIRECT)

PACE_S = 1.0            # one read a second per site
BUDGET_S = 95 * 60      # per site per run, inside the job's 120-minute ceiling
CONTROL_HOURS = 48
KILL_FLOOR, KILL_FRAC = 3, 0.10
PAGE = 1000             # PostgREST's max rows per request
_VERDICT = {"gone": DEAD, "live": ALIVE}


def oracle_for(spec: str, control: dict | None):
    module, attr = spec.split(":")
    obj = importlib.import_module(module)
    for part in attr.removesuffix("()").split("."):
        obj = getattr(obj, part)
    return obj(control) if attr.endswith("()") else obj


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


def tables_for(client, site: str) -> dict[str, int]:
    """{table: active rows} for the site's tables that exist."""
    out = {}
    for t in (f"{site}_residential_listings", f"{site}_commercial_listings"):
        try:
            out[t] = client.table(t).select("id", count="exact").eq("active", True).limit(1).execute().count or 0
        except Exception:  # noqa: BLE001 — a site with one vertical has one table
            continue
    return out


def _rows(client, table: str, cols: str, *, order: list[tuple[str, bool]], limit: int, since=None) -> list[dict]:
    out: list[dict] = []
    while len(out) < limit:
        q = client.table(table).select(cols).eq("active", True)
        if since:
            q = q.gte("last_seen_at", since)
        for col, desc in order:
            q = q.order(col, desc=desc, nullsfirst=not desc)
        n = min(PAGE, limit - len(out))
        page = q.range(len(out), len(out) + n - 1).execute().data or []
        out += [dict(r, _table=table) for r in page if r.get("ad_number")]
        if len(page) < n:
            break
    return out


def controls(client, tables) -> list[dict]:
    since = (datetime.now(timezone.utc) - timedelta(hours=CONTROL_HOURS)).isoformat()
    ctl = []
    for t in tables:
        ctl += _rows(client, t, "ad_number, listing_url, last_seen_at", order=[("last_seen_at", True)],
                     limit=MIN_CANARIES, since=since)
    return sorted(ctl, key=lambda r: r.get("last_seen_at") or "", reverse=True)[:MIN_CANARIES]


def controls_ok(ctl, oracle) -> tuple[bool, str]:
    alive = sum(read(oracle, r["ad_number"])[0] == ALIVE for r in ctl)
    return canary_environment_ok(alive, len(ctl)), f"controls {alive}/{len(ctl)} live"


def _update(client, table: str, ids: list, patch: dict) -> None:
    for i in range(0, len(ids), 200):
        client.table(table).update(patch).in_("id", ids[i:i + 200]).execute()


def run_site(site: str, *, shadow: bool) -> dict:
    spec = SITES[site]
    shadow = shadow or site not in APPLY
    client = sb()
    policy = policy_for(site)
    now = datetime.now(timezone.utc).isoformat()
    started = time.monotonic()
    run_id = begin_run(f"fleet_liveness:{site}")
    st = {"site": site, "shadow": shadow, "active": 0, "probed": 0, ALIVE: 0, DEAD: 0, UNKNOWN: 0,
          "verified": 0, "struck": 0, "hidden": 0, "would_hide": [], "quarantined": None, "covered": 0.0}
    try:
        tables = tables_for(client, site)
        st["active"] = sum(tables.values())
        ctl = controls(client, tables)
        oracle = oracle_for(spec, ctl[0] if ctl else None)
        ok, why = controls_ok(ctl, oracle)
        if not ok:
            st["quarantined"] = f"opening {why}: the site is not answering truthfully, nothing read"
        else:
            order = [("missing_count", True), ("last_liveness_probe_at", False)]
            work = []
            for t in tables:
                work += _rows(client, t, "id, ad_number, listing_url, missing_count, last_liveness_probe_at",
                              order=order, limit=st["active"])
            work.sort(key=lambda r: (-(r.get("missing_count") or 0), r.get("last_liveness_probe_at") or ""))
            alive, looked, dead_side = [], [], []
            for r in work:
                if time.monotonic() - started > BUDGET_S:
                    break
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
            st["covered"] = round(100.0 * st["probed"] / st["active"], 1) if st["active"] else 100.0
            kills = [x for x in dead_side if x[1].action == "deactivate"]
            st["would_hide"] = [f"{r['_table']}:{r['id']} {r.get('listing_url')} — {why}" for r, _, why in kills]
            ok, why = controls_ok(ctl, oracle)
            if not ok:
                st["quarantined"] = f"closing {why}: no strike or hide written"
            elif len(kills) > kill_cap(st["active"]):
                st["quarantined"] = f"{len(kills)} hides > cap {kill_cap(st['active'])}: no strike or hide written"
            if not shadow:
                for t in tables:
                    ids = [r["id"] for r, _ in alive if r["_table"] == t]
                    if ids:
                        stamp = verification_patch(alive[0][1], now_iso=now)
                        _update(client, t, ids, {"missing_count": 0, "last_liveness_probe_at": now, **stamp})
                    looked_ids = [r["id"] for r in looked if r["_table"] == t]
                    if st["quarantined"]:
                        looked_ids += [r["id"] for r, _, _ in dead_side if r["_table"] == t]
                    _update(client, t, looked_ids, {"last_liveness_probe_at": now})
                st["verified"] = len(alive)
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
                f"covered={st['covered']}% alive={st[ALIVE]} dead={st[DEAD]} unknown={st[UNKNOWN]} "
                f"verified={st['verified']} struck={st['struck']} hidden={st['hidden']} "
                f"would_hide={len(st['would_hide'])}"
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
    ap = argparse.ArgumentParser(description="Daily DIRECT liveness for every site with a measured oracle")
    ap.add_argument("--site", action="append", choices=sorted(SITES), help="default: every site")
    ap.add_argument("--shadow", action="store_true", help="decide and report, write nothing")
    ap.add_argument("--plan", nargs="?", const="", default=None, metavar="SITE",
                    help="write the matrix (SITE, or every site) as sites=<json> to $GITHUB_OUTPUT and exit")
    a = ap.parse_args()
    if a.plan is not None:
        import json
        import os
        sites = [a.plan] if a.plan else sorted(SITES)
        with open(os.environ.get("GITHUB_OUTPUT", "/dev/stdout"), "a", encoding="utf-8") as f:
            f.write(f"sites={json.dumps(sites)}\n")
        return 0
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
