"""The hourly robot customer — the 🔬 engineer's night-2 safety net (docs/ops/ADVANCED_FILTER_ENGINEER.md).

No AI, no page reads. Every hour it takes 10 rotating real listings that STORE a yes for an Advanced
Filter answer (elevator, parking, kitchen, AC, furnished, maid/driver room, private entrance), sends the
request a customer would send for it — deal, city, district, type, rent period and that one answer —
through the PUBLIC anon RPC the app uses (location_search_candidates_ar), and checks the listing comes
back. A stored yes that the customer's request cannot find is a machinery bug: a mapping, a slug, the
eligibility clause, a policy. Each miss raises a P2 alert (kind af_robot_miss) and a work-queue row.

It reuses af_score's request builder (rpc_params, offered) so the robot and the nightly score ask
exactly the same question. Every run writes an 'advanced_filter:robot' heartbeat row — a robot that
stopped running must read as silence, never as health.

  python -m scrapers.common.af_robot --dry-run
"""
from __future__ import annotations

import argparse
import random
import sys
from datetime import datetime, timedelta, timezone

from scrapers.common.af_score import FURNISHED, MIN_AGE_H, anon_client, ask, findable, offered, rpc_params
from scrapers.common.db import sb
from scrapers.common.new_listings_score import STORED

# Stored column → the answer name rpc_params() understands (same names af_score uses).
ANSWERS = ("elevator", "parking", "kitchen", "air_conditioner", FURNISHED, "maid_room", "driver_room",
           "private_entrance")
N_PICKS = 10
KIND = "af_robot_miss"


def rotation(hour: int, n: int = N_PICKS) -> list[str]:
    """Which answer each pick tests this hour: every answer gets its turn, starting somewhere new."""
    return [ANSWERS[(hour + i) % len(ANSWERS)] for i in range(n)]


def pick(client, answer: str, rng: random.Random, hours: int = MIN_AGE_H) -> dict | None:
    """One random production-ready listing older than `hours` that stores a yes for `answer`."""
    before = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    q = (client.table("search_listings_ar").select(STORED, count="exact")
         .eq(answer, True).eq("production_ready", True).lt("first_seen_at", before))
    n = q.limit(1).execute().count or 0
    if not n:
        return None
    off = rng.randrange(n)
    rows = q.order("listing_id").range(off, off).execute().data or []
    return rows[0] if rows else None


def check(anon, stored: dict, answer: str) -> bool | None:
    """True found / False the customer cannot find it / None undecided (not askable, failed, row-capped)."""
    if not offered([answer], stored):
        return None
    params = rpc_params(stored, [answer])
    if not params:
        return None
    return findable(ask(anon, params), stored["source_table"], stored["listing_id"])


def run(client, anon, hour: int, rng: random.Random) -> dict:
    out = {"tried": 0, "found": 0, "undecided": 0, "missed": []}
    for answer in rotation(hour):
        stored = pick(client, answer, rng)
        if not stored:
            out["undecided"] += 1
            continue
        verdict = check(anon, stored, answer)
        if verdict is None:
            out["undecided"] += 1
            continue
        out["tried"] += 1
        if verdict:
            out["found"] += 1
        else:
            out["missed"].append({"key": f"{stored['source_table']}:{stored['listing_id']}", "answer": answer,
                                  "platform": stored.get("platform")})
    return out


def report(client, res: dict, *, dry_run: bool) -> None:
    line = (f"af_robot: found {res['found']}/{res['tried']} (undecided {res['undecided']})"
            + (" missed " + ", ".join(f"{m['key']}[{m['answer']}]" for m in res["missed"]) if res["missed"] else ""))
    print(line, flush=True)
    if dry_run:
        return
    for m in res["missed"]:
        # mon_raise returns 1 only for a NEW open alert, so a miss that repeats every hour opens one
        # work-queue row, not twenty-four.
        new = client.rpc("mon_raise", {"p_sev": "P2", "p_kind": KIND, "p_platform": m["platform"],
                                 "p_dedup": f"{KIND}:{m['key']}:{m['answer']}",
                                 "p_detail": {"key": m["key"], "answer": m["answer"],
                                              "why": "stored yes, the customer's anon request does not return it"}}
                   ).execute().data
        if new != 1:
            continue
        client.table("ops_engineer_backlog").insert({
            "engineer": "advanced_filter", "status": "open",
            "item": f"robot customer: {m['key']} stores {m['answer']}=true but the customer's request for "
                    f"{m['answer']} does not return it — root-cause the mapping / RPC",
            "evidence": f"af_robot {datetime.now(timezone.utc).isoformat(timespec='minutes')}"}).execute()
    client.table("ops_daily_engineer_run").insert({
        "run_at": datetime.now(timezone.utc).isoformat(), "phase": "advanced_filter:robot",
        "push_ok": not res["missed"], "report": line[:2000]}).execute()


def main() -> int:
    ap = argparse.ArgumentParser(description="Advanced Filter hourly robot customer")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--seed", type=int, default=None)
    a = ap.parse_args()
    anon = anon_client()
    if anon is None:
        print("af_robot: no anon key — cannot ask as a customer; failing loudly")
        return 1
    client = sb()
    hour = datetime.now(timezone.utc).hour
    res = run(client, anon, hour, random.Random(a.seed))
    report(client, res, dry_run=a.dry_run)
    return 1 if res["missed"] else 0


if __name__ == "__main__":
    sys.exit(main())
