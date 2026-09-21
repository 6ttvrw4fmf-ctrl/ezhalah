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
import sys
from pathlib import Path
from typing import Optional

# THE FLEET'S OWN FETCH STACK, not a foreign HTTP client. scrapers/common/http.py says why in its
# first line: "We use curl_cffi (NOT vanilla requests) because Saudi real-estate sites ... fingerprint
# TLS handshakes." The first version of this file imported `requests`, which is not in
# scrapers/requirements.txt at all — so the probe died on its first real run. But the packaging error
# was the smaller half: a probe that presents a DIFFERENT TLS fingerprint than every real scraper is
# not measuring what the real jobs see, and this probe exists for no other reason than to measure
# exactly that. Borrowing the fleet's session makes the measurement representative AND costs no new
# dependency.
from scrapers.common import db, http as fleet_http
from scrapers.common.oracle_feasibility import (
    PlatformVerdict,
    absence_only_platforms,
    probe_platform,
)

def _rows(table: str, active: bool, sample: int) -> list[dict]:
    """Rows with a stored listing_url, read through the same client every scraper uses.

    LIVE = active, most recently seen first (our best "should be alive").
    DEAD = inactive, most recently deactivated first (our best "should be gone").
    """
    order_col = "last_seen_at" if active else "deactivated_at"
    try:
        q = (db.sb().table(table)
             .select("ad_number, listing_url")
             .eq("active", active)
             .not_.is_("listing_url", "null")
             # THE ORDER COLUMN MUST BE NON-NULL, and this is not defensive noise —
             # `order by x desc` puts NULLs FIRST in Postgres. deactivated_at is null on rows
             # inactivated before that column was populated, so without this the DEAD cohort fills
             # up with the oldest, least representative rows in the table instead of the ones most
             # recently confirmed gone, and every verdict would be drawn from the wrong sample while
             # looking perfectly healthy. scrapers/gathern/liveness.py guards the same way.
             .not_.is_(order_col, "null")
             .order(order_col, desc=True)
             .limit(sample))
        return q.execute().data or []
    except Exception as e:
        # A FAILED READ IS NOT AN EMPTY COHORT. Say so loudly; judge() will then see a missing
        # cohort and return UNUSABLE_READ rather than inventing a verdict from nothing.
        print(f"    ! could not read {table} ({type(e).__name__}: {e}) — cohort UNREAD", flush=True)
        return []


def make_fetch(min_interval: float):
    """One request per URL, through the fleet's own curl_cffi session.

    NO RETRIES, deliberately, and this is the opposite of the usual rule. `fleet_http.get()` retries
    and returns None on anything that is not 2xx — perfect for a scraper, useless here: this probe
    must be able to tell a 404 from a 403 from a timeout, and a retry would smear a transient over
    the one reading it is trying to characterise. So it borrows the SESSION (the fingerprint, the
    headers, the wasalt proxy routing) and does its own single, honest request.
    """
    def fetch(u: str) -> tuple[Optional[int], str, bool]:
        fleet_http._throttle(u)                     # the fleet's own politeness, per host
        s = fleet_http.session()
        r = s.get(u, timeout=30, allow_redirects=True)
        landed = str(getattr(r, "url", "") or "")
        moved = bool(landed) and landed.rstrip("/") != u.rstrip("/")
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
    ap.add_argument("--min-interval", type=float, default=1.0,
                    help="kept for compatibility; pacing comes from scrapers/common/http.py")
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
