"""The ♻️ Lifecycle Engineer's double-check: open a sample of one website's HIDDEN and LIVE ads and
report how many answers were wrong (docs/ops/LIFECYCLE_ENGINEER.md, "How often each website is
checked" and protection 1).

READ-ONLY. It never writes a strike, a hide, a verification stamp or anything else: it only tells the
engineer whether the site's hiding is right. The verdict for every page comes from the one shared
judge, `liveness_contract.classify_response()`, and the run is only believed when known-live
controls (listings the crawl saw in the last 24 hours) come back alive — `liveness_trust`'s canary
gate. An untrusted run reports "void", never "all dead".

A site with no registered dead-check in cleanup.PLATFORMS is judged by HTTP status alone
(method "status-only"): a 404/410 is gone, anything else it can read is live. That is weaker (a
soft-closed ad serving 200 reads live), and the report says so, so the engineer knows the site still
needs a real "gone" check (backlog B/C).

  python -m scrapers.common.lifecycle_spot_check --platform gathern --n 100
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone

from scrapers.common import http
from scrapers.common.cleanup import PLATFORMS
from scrapers.common.db import sb
from scrapers.common.liveness_contract import ALIVE, DEAD, UNKNOWN, classify_response
from scrapers.common.liveness_trust import canary_environment_ok

CANARIES = 5
COLS = "id,ad_number,listing_url,active,deactivated_at,last_seen_at"


def judge(side: str, verdict: str) -> str:
    """'right', 'wrong' or 'unknown' for one opened ad. A hidden ad that answers ALIVE was wrongly
    hidden; a live ad that answers DEAD is wrongly still shown. UNKNOWN is never wrong or right."""
    if verdict == UNKNOWN:
        return "unknown"
    if side == "hidden":
        return "wrong" if verdict == ALIVE else "right"
    return "wrong" if verdict == DEAD else "right"


def summarize(platform: str, method: str, canary: dict, results: list[dict]) -> dict:
    out = {"platform": platform, "method": method, "canaries": canary, "trusted": canary["ok"]}
    for side in ("hidden", "live"):
        rows = [r for r in results if r["side"] == side]
        out[side] = {
            "opened": len(rows),
            "right": sum(r["judged"] == "right" for r in rows),
            "wrong": sum(r["judged"] == "wrong" for r in rows),
            "unknown": sum(r["judged"] == "unknown" for r in rows),
            "wrong_examples": [f"{r['table']}:{r['id']} {r['url']}" for r in rows if r["judged"] == "wrong"][:20],
        }
    if not canary["ok"]:
        out["verdict"] = "void: known-live controls did not come back alive, so nothing here may be believed"
    else:
        wrong = out["hidden"]["wrong"] + out["live"]["wrong"]
        out["verdict"] = "clean" if wrong == 0 else f"{wrong} wrong answer(s)"
    return out


def tables_for(client, platform: str) -> list[str]:
    names = {f"{platform}_residential_listings", f"{platform}_commercial_listings"}
    names.update(PLATFORMS.get(platform, {}).get("tables", []))
    rows = (client.table("search_listings_ar").select("source_table").eq("platform", platform)
            .limit(1000).execute().data or [])
    names.update(r["source_table"] for r in rows if r.get("source_table"))
    found = []
    for t in sorted(names):
        try:
            client.table(t).select("id").limit(1).execute()
            found.append(t)
        except Exception:
            pass
    return found


def sample(client, table: str, *, active: bool, n: int, since: str | None, rng: random.Random) -> list[dict]:
    """Up to n rows from a random window of the table (PostgREST has no ORDER BY random())."""
    def q(cols: str, **kw):
        x = client.table(table).select(cols, **kw).eq("active", active).filter("listing_url", "not.is", "null")
        return x.gte("deactivated_at", since) if since else x
    total = q("id", count="exact").limit(1).execute().count or 0
    if total == 0 or n <= 0:
        return []
    window = min(total, n * 5)
    off = rng.randrange(0, max(1, total - window + 1))
    rows = q(COLS).order("id").range(off, off + window - 1).execute().data or []
    return rng.sample(rows, min(n, len(rows)))


def open_ad(url: str, dead_marker) -> str:
    resp = http.get(url)
    if resp is None:
        return classify_response(None)
    return classify_response(resp.status_code, resp.text or "", dead_marker=dead_marker)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--platform", required=True)
    ap.add_argument("--n", type=int, default=30, help="ads per side")
    ap.add_argument("--which", choices=("hidden", "live", "both"), default="both")
    ap.add_argument("--hidden-days", type=int, default=30, help="only ads hidden within this many days")
    ap.add_argument("--seed", type=int, default=None)
    a = ap.parse_args()

    client = sb()
    rng = random.Random(a.seed)
    reg = PLATFORMS.get(a.platform, {})
    dead_marker = reg.get("dead_marker")
    method = "registered-marker" if dead_marker else "status-only"
    tables = tables_for(client, a.platform)
    if not tables:
        print(json.dumps({"platform": a.platform, "verdict": "void: no listing tables found"}))
        return 1

    # Controls first: listings the crawl saw in the last 24 hours must come back alive, or the
    # environment (a block, a proxy failure) is lying and the run is void.
    day_ago = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    ctl = []
    for t in tables:
        rows = (client.table(t).select(COLS).eq("active", True).gte("last_seen_at", day_ago)
                .filter("listing_url", "not.is", "null").limit(50).execute().data or [])
        ctl += [dict(r, table=t) for r in rows]
    ctl = rng.sample(ctl, min(CANARIES, len(ctl)))
    ctl_alive = sum(open_ad(r["listing_url"], dead_marker) == ALIVE for r in ctl)
    canary = {"probed": len(ctl), "alive": ctl_alive, "ok": canary_environment_ok(ctl_alive, len(ctl))}

    since = (datetime.now(timezone.utc) - timedelta(days=a.hidden_days)).isoformat()
    results = []
    if canary["ok"]:
        per_table = max(1, a.n // len(tables))
        for side, active, win in (("hidden", False, since), ("live", True, None)):
            if a.which not in (side, "both"):
                continue
            picked = []
            for t in tables:
                picked += [dict(r, table=t) for r in sample(client, t, active=active, n=per_table, since=win, rng=rng)]
            for r in picked[: a.n]:
                v = open_ad(r["listing_url"], dead_marker)
                results.append({"side": side, "table": r["table"], "id": r["id"], "url": r["listing_url"],
                                "verdict": v, "judged": judge(side, v)})

    out = summarize(a.platform, method, canary, results)
    text = json.dumps(out, ensure_ascii=False, indent=2)
    print(text)
    with open("spot-check.json", "w", encoding="utf-8") as f:
        f.write(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"### ♻️ spot check: {a.platform}\n\n```json\n{text}\n```\n")
    return 0 if out["verdict"] == "clean" else 1


if __name__ == "__main__":
    sys.exit(main())
