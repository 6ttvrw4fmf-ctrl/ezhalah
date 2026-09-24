"""Adjudicate muktamel ids against the SHIPPED removal oracle, from an egress that can reach the site.

WHY THIS EXISTS (2026-09-22, routine-3 daily inventory audit).
`scrapers/oracle-never-observed.txt` calls muktamel "THE LARGEST UNPROVEN CHAIN ... canary-gated from
ids the same run read LIVE, failing closed — the host answers 403 CONNECT from cloud egress, so it
was never pre-validated against a dead cohort." Two separate things are missing there and only one of
them is about the network:

  1. NO EGRESS. An agent container gets `curl (7) CONNECT tunnel failed, response 403` from
     muktamel.com, so no session that runs there can adjudicate anything. CI can reach it
     (commit dd870d5 re-measured 13 "EGRESS BLOCKED" platforms from CI and found unreachable=0).
  2. NO DEAD COHORT. The in-run canary only ever validates the oracle against ids the same run read
     LIVE. That proves the oracle does not cry death over a live page. It does NOT prove the oracle
     can RECOGNISE a dead one — the other direction, and the one a kill actually rests on.

This script closes both. It runs from CI, and it takes BOTH cohorts explicitly, so a run reports the
two error rates a liveness oracle can have rather than one:

    --dead-ids   ids believed removed  -> every 'gone' is a TRUE POSITIVE, every non-gone a MISS
    --live-ids   ids known served      -> every 'gone' is a FALSE POSITIVE (the dangerous direction)

THE PREDICATE IS LIFTED, NEVER RETYPED. `_liveness_signal` and `_session` are pulled out of
`scrapers/muktamel/run.py` by AST at runtime, so this tool cannot drift from the function that
actually decides production kills — and it needs no Supabase env to do it, because it lifts those
symbols instead of importing the module. A copy of the predicate here would measure a copy.

IT WRITES NOTHING. No Supabase secret is needed or granted; the output is the CI log. Deciding what
to do with a verdict (restore, void tainted strikes, keep inactive) is a separate, evidenced act —
`ops_liveness_tainted_strike_void` is the precedent, set for gathern on 2026-09-03.

FAILS CLOSED. If the live controls do not come back alive, the source is not testifying correctly
this run and EVERY verdict is reported as UNKNOWN rather than death — the same law
`run.py::_canary()` enforces in production and `LISTING_LIVENESS.md` §1-§3 states: absence, a block
and an unanswered fetch are UNKNOWN, and only a DIRECT fetch of the listing's own URL may kill.

Usage:
  python -m scrapers.muktamel.adjudicate_killed --dead-ids 25798,25806 --live-ids 31700,31701
"""
from __future__ import annotations

import argparse
import ast
import sys
import time
from pathlib import Path
from typing import Any, Callable, Optional

from curl_cffi import requests as cc

_RUN_PY = Path(__file__).resolve().parent / "run.py"

# Space request starts apart; this is a diagnostic against someone else's origin, not a crawl.
MIN_INTERVAL = 0.8


def _lift(path: Path, wanted: set[str]) -> dict[str, Any]:
    """Execute ONLY the named top-level defs (plus UPPERCASE constants) out of a module.

    Importing run.py would pull in supabase/db and require credentials this job is deliberately not
    granted. Lifting gives the real shipped function bodies with none of that.
    """
    tree = ast.parse(path.read_text())
    keep: list[ast.stmt] = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in wanted:
            keep.append(node)
        elif isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):
            # Literal UPPERCASE constants only (BASE). A computed module-level constant can reach
            # for imports this lift deliberately does not provide, and none of them is the oracle.
            names = [t.id for t in node.targets if isinstance(t, ast.Name)]
            if names and names[0].isupper():
                keep.append(node)
    ns: dict[str, Any] = {"cc": cc, "Optional": Optional, "Any": Any}

    class _TL:  # stands in for run.py's threading.local() session cache
        pass

    ns["_local"] = _TL()
    exec(compile(ast.Module(body=keep, type_ignores=[]), f"<lift:{path.name}>", "exec"), ns)
    missing = sorted(w for w in wanted if w not in ns)
    if missing:
        raise SystemExit(f"REFUSING TO RUN: could not lift {missing} from {path}. The oracle this "
                         "tool is supposed to measure is not the one it would have used.")
    return ns


def _probe_one(session: cc.Session, signal: Callable[..., Optional[str]], base: str,
               listing_id: int) -> tuple[str, Optional[int], str]:
    """Return (verdict, status, landed_url). verdict is 'gone' | 'live' | 'unknown'.

    'unknown' covers every shape LISTING_LIVENESS forbids killing on: a transport error, a 5xx, a
    block. It is never death and never proof of life.
    """
    url = f"{base}/real-estates/{listing_id}"
    try:
        r = session.get(url, timeout=45, allow_redirects=True)
    except Exception as exc:  # noqa: BLE001 — an unreachable page proves nothing either way
        return "unknown", None, f"transport:{type(exc).__name__}"
    landed = str(getattr(r, "url", url) or url)
    verdict = signal(r.status_code, r.text or "", landed.rstrip("/") != url.rstrip("/"))
    if verdict == "gone":
        return "gone", r.status_code, landed
    if r.status_code == 200:
        return "live", r.status_code, landed
    return "unknown", r.status_code, landed


def _parse_ids(raw: str) -> list[int]:
    return [int(p) for p in (raw or "").replace(" ", "").split(",") if p]


def main() -> int:
    ap = argparse.ArgumentParser(description="Adjudicate muktamel ids against the shipped oracle")
    ap.add_argument("--dead-ids", default="", help="ids believed REMOVED (comma-separated)")
    ap.add_argument("--live-ids", default="", help="ids known SERVED, used as positive controls")
    args = ap.parse_args()

    dead_ids, live_ids = _parse_ids(args.dead_ids), _parse_ids(args.live_ids)
    if not live_ids:
        raise SystemExit("REFUSING TO RUN: --live-ids is required. Without a positive control a "
                         "'gone' verdict cannot be told apart from the source refusing this egress "
                         "(LISTING_LIVENESS.md §1-§3, run.py::_canary).")

    ns = _lift(_RUN_PY, {"_liveness_signal", "_session"})
    signal, base = ns["_liveness_signal"], ns["BASE"]
    session = ns["_session"]()
    print(f"oracle lifted from {_RUN_PY} | base={base}", flush=True)

    results: dict[str, list[tuple[int, str, Optional[int], str]]] = {"live": [], "dead": []}
    for cohort, ids in (("live", live_ids), ("dead", dead_ids)):
        for listing_id in ids:
            time.sleep(MIN_INTERVAL)
            verdict, status, landed = _probe_one(session, signal, base, listing_id)
            results[cohort].append((listing_id, verdict, status, landed))
            print(f"{cohort.upper():5} id={listing_id} verdict={verdict} status={status} "
                  f"landed={landed}", flush=True)

    ctrl = results["live"]
    ctrl_live = sum(1 for _, v, _, _ in ctrl if v == "live")
    ctrl_gone = sum(1 for _, v, _, _ in ctrl if v == "gone")
    print(f"\nCONTROLS: {ctrl_live}/{len(ctrl)} read live, {ctrl_gone} read GONE", flush=True)

    if ctrl_live == 0:
        print("CANARY FAIL: not one known-live control read as live. The source is not testifying "
              "correctly from this egress, so EVERY verdict below is UNKNOWN, never death.")
        return 1
    if ctrl_gone:
        print(f"CANARY FAIL: {ctrl_gone} known-live control(s) read as GONE — the removal signal "
              "misfires on live pages this run. Every 'gone' verdict is UNTRUSTWORTHY.")
        return 1

    d = results["dead"]
    gone = sum(1 for _, v, _, _ in d if v == "gone")
    live = sum(1 for _, v, _, _ in d if v == "live")
    unknown = sum(1 for _, v, _, _ in d if v == "unknown")
    print(f"RESULT dead_cohort n={len(d)} gone={gone} live={live} unknown={unknown}")
    if live:
        print(f"FALSE INACTIVATION: {live} id(s) the database holds inactive are STILL SERVED. "
              "These are restore candidates (LISTING_LIVENESS.md §4; routine-3 §15).")
        for listing_id, v, _, _ in d:
            if v == "live":
                print(f"  RESTORE_CANDIDATE id={listing_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
