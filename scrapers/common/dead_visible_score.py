"""Dead ads a customer can see — the one number — measured every night for every website, independently
of the jobs that hide (owner, 2026-10-02: «I want it to do its job always and perfectly so I can sit
and relax»; docs/ops/LIFECYCLE_ENGINEER.md, "Dead ads customers can see come first" and "Rating").

WHAT IT OPENS. search_listings_ar is what a customer sees, so the sample is drawn from its
production_ready rows, never from a source table's own idea of "active". Every registered website
(platform_registry, read through loader_platform_status_ar) with at least one shown ad gets a random
sample a night: 10 on a big website (500+ shown), all of them or 5 on a small one — the rulebook's
double-check sizes ("How often each website is checked"). Each sampled ad is opened the way its own
hiding job opens it, strongest first:

  site-reader        dealapp / gathern: lifecycle_spot_check._reader_for, their checkers' own sessions
  site-oracle        every fleet_liveness.SITES site: the same verify_gone its scraper hands to prune_unseen
  registered-marker  cleanup.PLATFORMS dead_marker through cleanup._probe (aqar, aqarmonthly, wasalt, aqarcity)
  status-only        a plain fetch: 404/410 is gone, a readable 200 is live, anything else UNKNOWN

UNKNOWN is never dead. Known-live controls (the crawl's freshest ads, lifecycle_spot_check.pick_controls)
open every website that has five: if they do not come back alive, that website's row is VOID — nothing
decided, never "all dead" (LISTING_LIVENESS.md §5). A website with fewer than five ads has no separate
gate; its row says so, and a false "gone" there is a loud false alarm the engineer re-reads, not a hide.

WHAT IT WRITES. Nothing on any listing. One row per website per night into ops_dead_visible_score,
the table the ♻️ engineer's rating is read from; until that table exists it prints the rows and
exits 0. The exit code is about transport (could the fleet be measured at all?), never about dead
ads: a dead ad is the finding, not the failure.

  python -m scrapers.common.dead_visible_score                            # every site, write rows
  python -m scrapers.common.dead_visible_score --sites raghdan jazwtn --dry-run
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
from datetime import datetime, timezone

from scrapers.common.cleanup import PLATFORMS
from scrapers.common.db import sb
from scrapers.common.fleet_liveness import SITES, oracle_for
from scrapers.common.fleet_liveness import read as oracle_read
from scrapers.common.lifecycle_spot_check import CANARIES, _reader_for, open_ad, pick_controls
from scrapers.common.liveness_contract import ALIVE, DEAD, UNKNOWN
from scrapers.common.liveness_trust import canary_environment_ok

TABLE = "ops_dead_visible_score"
BIG = 500                   # rulebook: a big website is 500+ listings
N_BIG, N_SMALL = 10, 5      # rulebook: 10 live ads a night on a big website; 5, or all, on a small one
PACE_S = 1.0                # at most one read a second per website (hard rule 7: don't get us blocked)
WINDOW = 5                  # the random window is WINDOW × n rows (PostgREST has no ORDER BY random())
# "The same lines everywhere": more than 5% of live ads gone is a bug on any website; on 50+ decided
# answers, more than 2% is. Either caps the ♻️ rating at CAP (LIFECYCLE_ENGINEER.md, "Rating").
LINE_ANY, LINE_BIG, BIG_DECIDED, CAP = 0.05, 0.02, 50, 5
_BUCKET = {ALIVE: "live", DEAD: "gone", UNKNOWN: "unknown"}


# ── Pure: sizes, shares, the rating cap ─────────────────────────────────────────────────────────

def sample_size(shown: int, big: int = N_BIG, small: int = N_SMALL) -> int:
    return big if shown >= BIG else min(small, shown)


def gone_share(row: dict) -> float | None:
    """Gone among DECIDED (live + gone). UNKNOWN is in neither half; nothing decided → None, never 0."""
    decided = row["live"] + row["gone"]
    return row["gone"] / decided if decided else None


def over_the_line(row: dict) -> bool:
    share = gone_share(row)
    if share is None:
        return False
    return share > LINE_ANY or (row["live"] + row["gone"] >= BIG_DECIDED and share > LINE_BIG)


def fleet(rows: list[dict]) -> dict:
    measured = [r for r in rows if gone_share(r) is not None]
    decided = sum(r["live"] + r["gone"] for r in rows)
    gone = sum(r["gone"] for r in rows)
    return {
        "sites": len(rows), "measured": len(measured), "decided": decided, "gone": gone,
        "gone_share": (gone / decided) if decided else None,
        # The rulebook's number: dead share × live listings, per website, summed.
        "visible_dead_estimate": sum(round(gone_share(r) * r["shown"]) for r in measured),
        "unmeasured": [r["platform"] for r in rows if gone_share(r) is None],
        "over_the_line": [r["platform"] for r in rows if over_the_line(r)],
    }


def rating_cap(rows: list[dict], *, complete: bool = True) -> tuple[int, str]:
    """The most the ♻️ engineer may rate tonight, read from the rows: CAP when any website is over a
    line; 10 only when the fleet's gone share is 0 and every website was measured; otherwise 9."""
    f = fleet(rows)
    if f["over_the_line"]:
        return CAP, f"capped at {CAP}: gone share over the line on " + ", ".join(f["over_the_line"])
    if f["gone"] == 0 and complete and rows and not f["unmeasured"]:
        return 10, "fleet gone share 0 and every website measured"
    why = []
    if f["gone"]:
        why.append(f"{f['gone']} gone ad(s) a customer can see")
    if f["unmeasured"]:
        why.append("not measured: " + ", ".join(f["unmeasured"]))
    if not complete or not rows:
        why.append("not every website was checked")
    return 9, "; ".join(why)


def exit_code(f: dict) -> int:
    """Transport only: a fleet with nothing decided could not be measured. A dead ad never fails the job."""
    return 0 if f["measured"] else 1


# ── Reading: what customers see, opened the way each website's own hiding job opens it ──────────

def registered_sites(client) -> list[str]:
    """Every website in platform_registry (kind 'source'), whatever its status: a dormant website
    with rows still shown is exactly what this must catch."""
    rows = client.rpc("loader_platform_status_ar", {}).execute().data or []
    return sorted({r["platform"] for r in rows})


def shown_count(client, platform: str) -> int:
    return (client.table("search_listings_ar").select("listing_id", count="exact")
            .eq("platform", platform).eq("production_ready", True).limit(1).execute().count or 0)


def sample(client, platform: str, shown: int, n: int, rng: random.Random) -> list[dict]:
    """n random shown ads of one website, each joined to its own source row (ad_number, listing_url).
    A shown ad whose source row cannot be read stays in the sample with neither: it is UNKNOWN."""
    if n <= 0 or shown <= 0:
        return []
    window = min(shown, n * WINDOW)
    off = rng.randrange(0, max(1, shown - window + 1))
    rows = (client.table("search_listings_ar").select("source_table,listing_id")
            .eq("platform", platform).eq("production_ready", True)
            .order("listing_id").range(off, off + window - 1).execute().data or [])
    picked = rng.sample(rows, min(n, len(rows)))
    out = {(r["source_table"], r["listing_id"]): {"table": r["source_table"], "id": r["listing_id"]}
           for r in picked}
    for t in sorted({k[0] for k in out}):
        ids = [k[1] for k in out if k[0] == t]
        for s in client.table(t).select("id,ad_number,listing_url").in_("id", ids).execute().data or []:
            out[(t, s["id"])].update(ad_number=s.get("ad_number"), listing_url=s.get("listing_url"))
    return list(out.values())


def reader_for(platform: str, control: dict | None):
    """(method, read(row) -> ALIVE / DEAD / UNKNOWN): the website's own hiding check, strongest first."""
    site = _reader_for(platform)
    if site is not None:
        return "site-reader", lambda r: site(r["listing_url"])
    if platform in SITES:
        oracle = oracle_for(SITES[platform], control)
        return "site-oracle", lambda r: oracle_read(oracle, r["ad_number"])[0]
    marker = PLATFORMS.get(platform, {}).get("dead_marker")
    return ("registered-marker" if marker else "status-only"), lambda r: open_ad(r["listing_url"], marker)


def empty_row(night: str, platform: str, shown: int, **kw) -> dict:
    row = {"night": night, "platform": platform, "method": None, "shown": shown, "sampled": 0,
           "live": 0, "gone": 0, "unknown": 0, "gated": False, "gone_ids": [], "note": None}
    row.update(kw)
    return row


def score_site(client, platform: str, shown: int, *, n: int, rng: random.Random, night: str,
               pace: float = PACE_S) -> dict:
    row = empty_row(night, platform, shown)
    picked = sample(client, platform, shown, n, rng)
    tables = sorted({r["table"] for r in picked})
    ctl = pick_controls(client, tables, rng) if tables else []
    row["method"], read = reader_for(platform, ctl[0] if ctl else None)
    last = -math.inf

    def opened(r: dict) -> str:
        nonlocal last
        if not r.get("listing_url") or (row["method"] == "site-oracle" and not r.get("ad_number")):
            return UNKNOWN                      # nothing to open is nothing decided
        # pace is a RATE (one read per pace seconds), not a pause added to every read.
        time.sleep(max(0.0, last + pace - time.monotonic()))
        last = time.monotonic()
        try:
            return read(r)
        except Exception:  # noqa: BLE001 — a reader that blew up has said nothing about the ad
            return UNKNOWN

    if len(ctl) >= CANARIES:
        row["gated"] = True
        alive = sum(opened(r) == ALIVE for r in ctl)
        if not canary_environment_ok(alive, len(ctl)):
            row["note"] = f"void: known-live controls {alive}/{len(ctl)} alive, nothing decided"
            return row
    else:
        row["note"] = f"no control gate: fewer than {CANARIES} known-live ads"
    for r in picked:
        v = opened(r)
        row["sampled"] += 1
        row[_BUCKET.get(v, "unknown")] += 1     # only an exact DEAD is gone
        if v == DEAD:
            row["gone_ids"].append(f"{r['table']}:{r['id']}")
    return row


# ── Output ──────────────────────────────────────────────────────────────────────────────────────

def write_rows(client, rows: list[dict]) -> str:
    """One row per website per night. A missing table is reported, not raised: the migration lands on
    its own schedule and the measurement must not wait for it. Any other write failure is transport."""
    try:
        client.table(TABLE).upsert(rows, on_conflict="night,platform").execute()
    except Exception as e:  # noqa: BLE001
        text = str(e)
        if TABLE in text and ("PGRST205" in text or "42P01" in text or "not find" in text):
            return f"{TABLE} does not exist yet: rows printed only"
        raise
    return f"wrote {len(rows)} rows to {TABLE}"


def _pct(share: float | None) -> str:
    return "n/a" if share is None else f"{100 * share:.1f}%"


def _line(r: dict) -> str:
    return (f"{r['platform']}: {r['method']} shown={r['shown']} sampled={r['sampled']} live={r['live']} "
            f"gone={r['gone']} unknown={r['unknown']} gone_share={_pct(gone_share(r))}"
            + (f" | {r['note']}" if r["note"] else ""))


def markdown(out: dict) -> str:
    f, (cap, why) = out["fleet"], out["rating"]
    head = (f"### Dead ads a customer can see — {out['night']}\n\n"
            f"**Fleet:** {f['gone']} gone of {f['decided']} decided ({_pct(f['gone_share'])}), "
            f"estimate {f['visible_dead_estimate']} visible dead ads, {f['measured']}/{f['sites']} websites "
            f"measured. **Rating cap: {cap}/10** — {why}\n\n")
    lines = ["| website | method | shown | sampled | live | gone | unknown | gone share | note |",
             "|---|---|---:|---:|---:|---:|---:|---:|---|"]
    for r in sorted(out["sites"], key=lambda r: (-(gone_share(r) or 0), r["platform"])):
        lines.append(f"| {r['platform']} | {r['method'] or ''} | {r['shown']} | {r['sampled']} | {r['live']} | "
                     f"{r['gone']} | {r['unknown']} | {_pct(gone_share(r))} | {r['note'] or ''} |")
    gone_ids = [i for r in out["sites"] for i in r["gone_ids"]]
    return head + "\n".join(lines) + "\n\n**Gone (evidence, table:id):** " + (", ".join(gone_ids) or "none") + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="Dead ads a customer can see: a nightly random sample per website")
    ap.add_argument("--sites", nargs="*", help="only these websites (default: every registered one)")
    ap.add_argument("--big", type=int, default=N_BIG, help="ads opened on a big website (500+ shown)")
    ap.add_argument("--small", type=int, default=N_SMALL, help="ads opened on a small website, or all of them")
    ap.add_argument("--pace", type=float, default=PACE_S, help="seconds between reads of one website")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true", help="print the rows, write nothing")
    a = ap.parse_args()

    client = sb()
    rng = random.Random(a.seed)
    night = datetime.now(timezone.utc).date().isoformat()
    run = [os.environ.get(k, "") for k in ("GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_RUN_ID")]
    run_url = f"{run[0]}/{run[1]}/actions/runs/{run[2]}" if all(run) else None
    rows: list[dict] = []
    # ponytail: one website after another, ~1 h for 149 sites; a thread per site if the window gets tight.
    for p in a.sites or registered_sites(client):
        shown = shown_count(client, p)
        if not shown:
            continue                            # nothing a customer can see
        try:
            row = score_site(client, p, shown, n=sample_size(shown, a.big, a.small), rng=rng, night=night,
                             pace=a.pace)
        except Exception as e:  # noqa: BLE001 — one website failing never stops the fleet; its row says so
            row = empty_row(night, p, shown, note=f"error: {type(e).__name__}: {e}"[:300])
        row["run_url"] = run_url
        rows.append(row)
        print(_line(row), flush=True)

    out = {"night": night, "fleet": fleet(rows), "rating": rating_cap(rows, complete=not a.sites), "sites": rows}
    out["written"] = "dry run: nothing written" if a.dry_run else write_rows(client, rows)
    text = json.dumps(out, ensure_ascii=False, indent=2)
    print(text)
    with open("dead-visible-score.json", "w", encoding="utf-8") as f:
        f.write(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(markdown(out))
    return exit_code(out["fleet"])


if __name__ == "__main__":
    sys.exit(main())
