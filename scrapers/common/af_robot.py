"""The hourly robot customer — the 🔬 engineer's night-2 safety net (docs/ops/ADVANCED_FILTER_ENGINEER.md).

No AI, no page reads. Every hour it takes 10 rotating real listings that STORE a yes for an Advanced
Filter answer (elevator, parking, kitchen, AC, furnished, maid/driver room, private entrance), sends the
request a customer would send for it — deal, city, district, type, rent period and that one answer —
through the PUBLIC anon RPC the app uses (location_search_candidates_ar), and checks the listing comes
back. A stored yes that the customer's request cannot find is a machinery bug: a mapping, a slug, the
eligibility clause, a policy. Each miss raises a P2 alert (kind af_robot_miss) and a work-queue row.

It also times the LIVE COUNT the card shows on «متابعة · N نتيجة» (apartment_guided_counts_ar) for a
3–5 feature selection, the way the app asks for it: one long-budget call plus two retries. When all three
fail, a customer would see the number vanish (owner screenshot 2026-10-08, backlog 281): P2
af_robot_count_missing + one work-queue row; a clean hour resolves it.

It reuses af_score's request builder (rpc_params, offered) so the robot and the nightly score ask
exactly the same question. Every run writes an 'advanced_filter:robot' heartbeat row — a robot that
stopped running must read as silence, never as health.

  python -m scrapers.common.af_robot --dry-run
"""
from __future__ import annotations

import argparse
import random
import sys
import time
from datetime import datetime, timedelta, timezone

from scrapers.common.af_score import FURNISHED, MIN_AGE_H, anon_client, ask, findable, offered, rpc_params
from scrapers.common.db import sb
from scrapers.common.new_listings_score import STORED

# Stored column → the answer name rpc_params() understands (same names af_score uses).
ANSWERS = ("elevator", "parking", "kitchen", "air_conditioner", FURNISHED, "maid_room", "driver_room",
           "private_entrance")
N_PICKS = 10
KIND = "af_robot_miss"
COUNT_KIND = "af_robot_count_missing"
# The app's count budget: BACKGROUND_COUNT_TIMEOUT_MS (src/data/remote.ts) = 12 s, one call + 2 retries
# (src/app/agent.tsx liveCount). Robot requests (python UA) wait in robot_gate up to 6 s first, which a
# customer's browser never does, so an attempt here gets 12 + 6 s before it counts as failed.
COUNT_BUDGET_S = 12.0
ROBOT_GATE_WAIT_S = 6.0
COUNT_ATTEMPTS = 3
COUNT_PROBES = 3


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


def count_probe(anon, stored: dict, clock=time.monotonic, sleep=time.sleep) -> dict | None:
    """The card's live count for a 3–5 feature selection this listing stores. None = not askable.
    ok False = every attempt errored or ran past the budget: the customer would see no number."""
    answers = [a for a in ANSWERS if a != FURNISHED and stored.get(a) is True][:5]
    if len(answers) < 3:
        return None
    params = rpc_params(stored, answers)
    if not params:
        return None
    params = {k: v for k, v in params.items() if k not in ("p_limit", "p_offset")}
    ms: list[int] = []
    for i in range(COUNT_ATTEMPTS):
        if i:
            sleep(0.7)
        t0 = clock()
        try:
            rows = anon.rpc("apartment_guided_counts_ar", params).execute().data
        except Exception:  # noqa: BLE001 — a failed count is exactly what this probe exists to see
            rows = None
        took = clock() - t0
        ms.append(int(took * 1000))
        n = (rows[0] if isinstance(rows, list) and rows else {}).get("cnt_selected")
        if n is not None and took <= COUNT_BUDGET_S + ROBOT_GATE_WAIT_S:
            return {"key": f"{stored['source_table']}:{stored['listing_id']}", "ticks": len(answers),
                    "ok": True, "n": int(n), "ms": ms}
    return {"key": f"{stored['source_table']}:{stored['listing_id']}", "ticks": len(answers), "ok": False,
            "n": None, "ms": ms, "platform": stored.get("platform")}


def run(client, anon, hour: int, rng: random.Random) -> dict:
    out = {"tried": 0, "found": 0, "undecided": 0, "missed": [], "counts": []}
    for answer in rotation(hour):
        stored = pick(client, answer, rng)
        if not stored:
            out["undecided"] += 1
            continue
        if len(out["counts"]) < COUNT_PROBES:
            probe = count_probe(anon, stored)
            if probe:
                out["counts"].append(probe)
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
    counts = res.get("counts") or []
    lost = [c for c in counts if not c["ok"]]
    line = (f"af_robot: found {res['found']}/{res['tried']} (undecided {res['undecided']})"
            + (" missed " + ", ".join(f"{m['key']}[{m['answer']}]" for m in res["missed"]) if res["missed"] else "")
            + f" · live count {len(counts) - len(lost)}/{len(counts)} shown, ms "
            + ",".join("/".join(str(x) for x in c["ms"]) for c in counts)
            + (" COUNT MISSING " + ", ".join(c["key"] for c in lost) if lost else ""))
    print(line, flush=True)
    if dry_run:
        return
    if lost:
        new = client.rpc("mon_raise", {"p_sev": "P2", "p_kind": COUNT_KIND, "p_platform": None,
                                 "p_dedup": COUNT_KIND,
                                 "p_detail": {"keys": [c["key"] for c in lost], "ms": [c["ms"] for c in lost],
                                              "why": "the card's live count failed all 3 attempts: «متابعة · N نتيجة» shows no number"}}
                   ).execute().data
        if new == 1:
            client.table("ops_engineer_backlog").insert({
                "engineer": "advanced_filter", "status": "open",
                "item": f"robot customer: the Advanced Filter live count failed all {COUNT_ATTEMPTS} attempts for "
                        + ", ".join(c["key"] for c in lost) + " (the header chip and «متابعة · N نتيجة» would show no "
                        "number) — find what slowed apartment_guided_counts_ar",
                "evidence": f"af_robot {datetime.now(timezone.utc).isoformat(timespec='minutes')} ms "
                            + ";".join("/".join(str(x) for x in c["ms"]) for c in lost)}).execute()
    elif counts:
        client.rpc("mon_resolve_key", {"p_kind": COUNT_KIND, "p_dedup": COUNT_KIND}).execute()
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
        "push_ok": not res["missed"] and not lost, "report": line[:2000]}).execute()


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
    return 1 if res["missed"] or any(not c["ok"] for c in res.get("counts") or []) else 0


if __name__ == "__main__":
    sys.exit(main())
