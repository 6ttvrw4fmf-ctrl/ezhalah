"""Run the oracle-feasibility measurement from the egress the scrapers really use (CI).

    python -m scrapers.common.oracle_feasibility_run --platforms abwbna,alobid,bahadhabab
    python -m scrapers.common.oracle_feasibility_run --all-absence-only --sample 12

READ-ONLY BY CONSTRUCTION. It SELECTs listing rows and fetches public pages. It never writes to a
listing table, never deactivates, never restores, and has no --apply. Its entire output is a report
for a human to read, because every one of the five measurement failures recorded in
`scrapers/common/oracle_feasibility.py` would have passed a naive automated reading.

`--all-absence-only` takes its platform list from `scrapers/absence-only-prune.txt` — the shrink-only
ledger of platforms that still prune on crawl absence alone — so the worklist is DISCOVERED from the
repo's own record of the gap rather than from a list someone has to remember to update.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

import requests

from scrapers.common.oracle_feasibility import PlatformVerdict, probe_platform

ROOT = Path(__file__).resolve().parents[2]
LEDGER = ROOT / "scrapers" / "absence-only-prune.txt"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36")


def absence_only_platforms() -> list[str]:
    out: list[str] = []
    for line in LEDGER.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        out.append(line.split("|")[0].strip())
    return out


def _client():
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are required. Refusing to report a "
                 "measurement built on a failed read.")
    return url, key


def _rows(table: str, active: bool, sample: int) -> list[dict]:
    """Rows with a stored listing_url. LIVE = active, most recently seen first (our best
    'should be alive'). DEAD = inactive with strikes, most recently deactivated first."""
    url, key = _client()
    order = "last_seen_at.desc" if active else "deactivated_at.desc"
    q = (f"{url}/rest/v1/{table}?select=ad_number,listing_url"
         f"&active=is.{'true' if active else 'false'}"
         f"&listing_url=not.is.null&order={order}&limit={sample}")
    r = requests.get(q, headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=30)
    if r.status_code != 200:
        # A failed read is not an empty cohort. Say so and let the caller mark it unusable.
        print(f"    ! could not read {table} (HTTP {r.status_code}) — treating cohort as UNREAD",
              flush=True)
        return []
    return r.json() or []


def make_fetch(min_interval: float):
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "ar,en;q=0.8"})
    last = [0.0]

    def fetch(u: str) -> tuple[Optional[int], str, bool]:
        wait = min_interval - (time.time() - last[0])
        if wait > 0:
            time.sleep(wait)
        last[0] = time.time()
        r = s.get(u, timeout=30, allow_redirects=True)
        moved = bool(r.history) and (r.url.rstrip("/") != u.rstrip("/"))
        return r.status_code, r.text, moved

    return fetch


def report(v: PlatformVerdict) -> str:
    return (
        f"\n=== {v.platform} :: {v.verdict} ===\n"
        f"    live  n={v.live_n} unreachable={v.unreachable_live} statuses={v.live_statuses} "
        f"distinct_titles={v.distinct_live_titles} distinct_sizes={v.distinct_live_bytes}\n"
        f"    dead  n={v.dead_n} unreachable={v.unreachable_dead} statuses={v.dead_statuses}\n"
        f"    usable markers       : {list(v.usable_markers) or 'none'}\n"
        f"    disqualified markers : {list(v.disqualified_markers) or 'none'}"
        f"{'  (present on LIVE pages — furniture, never a signal)' if v.disqualified_markers else ''}\n"
        f"    {v.why}\n"
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--platforms", default="")
    ap.add_argument("--all-absence-only", action="store_true")
    ap.add_argument("--sample", type=int, default=10)
    ap.add_argument("--min-interval", type=float, default=1.0)
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    plats = ([p.strip() for p in args.platforms.split(",") if p.strip()]
             or (absence_only_platforms() if args.all_absence_only else []))
    if not plats:
        sys.exit("nothing to probe: pass --platforms or --all-absence-only")

    fetch = make_fetch(args.min_interval)
    verdicts: list[PlatformVerdict] = []
    for p in plats:
        print(f"\n--- probing {p} ({args.sample} live + {args.sample} dead, interleaved, "
              f"~{args.min_interval}s/req) ---", flush=True)
        live, dead = [], []
        for suffix in ("_residential_listings", "_commercial_listings"):
            if len(live) < args.sample:
                live += _rows(p + suffix, True, args.sample - len(live))
            if len(dead) < args.sample:
                dead += _rows(p + suffix, False, args.sample - len(dead))
        v, _reads = probe_platform(p, live, dead, fetch)
        verdicts.append(v)
        print(report(v), flush=True)

    print("\n================ SUMMARY ================")
    for v in verdicts:
        print(f"  {v.platform:16s} {v.verdict}")
    print("\nNothing here authorises a deactivation. ORACLE_POSSIBLE means 'now go write and "
          "control-validate a signal', not 'coverage'. See docs/ops/LISTING_LIVENESS.md §9.")

    if args.out:
        Path(args.out).write_text(json.dumps([v.__dict__ for v in verdicts], ensure_ascii=False,
                                             indent=2, default=list), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
