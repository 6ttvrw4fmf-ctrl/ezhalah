#!/usr/bin/env python3
"""LIVE-DATA monitoring guard (2026-07-10 architecture redesign, item 6 — "if any platform starts
sending placeholder values in the future, the build fails or an alert is raised immediately").

Unlike scrapers/common/tests/ (which guards the CODE), this checks actual PRODUCTION data for a
REGRESSION: is any (table, column) pair's placeholder-value ROW COUNT higher than the recorded
baseline in scripts/placeholder_location_baseline.json?

BASELINE, NOT A TIME WINDOW — and why: an earlier version of this script tried "only count rows
written in the last N hours" using `last_seen_at`, but `last_seen_at` is bumped on EVERY successful
re-scrape of a listing regardless of whether ITS placeholder field changed (see `_wasalt_batch` in
scrapers/common/db.py) — so a long-standing, never-fixed junk value looks "fresh" every single day,
and the check would cry wolf forever on the same ~119 legacy rows instead of catching a genuine
regression. A committed baseline sidesteps this entirely: it's a real snapshot of what already
existed BEFORE this redesign (~1,400 city/region rows from the 2026-07-10 audit, PLUS ~119
district_ar/neighborhood rows this script's first real run additionally found — see
project_location-other-sentinel-audit-2026-07-10.md), and the guard only fires when today's count
for a given (table, column) EXCEEDS what's on file — i.e. a scraper wrote MORE placeholder rows
since the baseline was captured. A future backfill should re-run with --update-baseline to ratchet
the numbers down as real data gets cleaned up; it must NEVER be raised to silence a real regression.

Exit code 0 = no (table, column) exceeds its baseline. Exit code 1 = a scraper is writing
placeholders again — this is the "build fails" mechanism. Also logs one row to
location_pipeline_alerts per affected (table, column) so it surfaces on the ops dashboard.

Usage:
  python3 scripts/check_placeholder_locations.py                 # check against the baseline
  python3 scripts/check_placeholder_locations.py --update-baseline  # after an approved backfill
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from scrapers.common import db
from scrapers.common.placeholder_tokens import PLACEHOLDER_TOKENS

BASELINE_PATH = Path(__file__).parent / "placeholder_location_baseline.json"

# See scripts/check_placeholder_locations.py's own history for why this is hardcoded rather than
# discovered via information_schema: the Supabase REST API only exposes the public/graphql_public
# schemas (confirmed empirically — PGRST106 "Invalid schema: information_schema"), so a Python
# script using the service-role REST client can't introspect table columns the way a SQL migration
# can. Add a new platform's table name(s) here when it's added.
_TABLES = [
    "abeea_residential_listings", "abeea_commercial_listings",
    "aldarim_residential_listings", "aldarim_commercial_listings",
    "alhoshan_residential_listings", "alhoshan_commercial_listings",
    "alkhaas_residential_listings", "alkhaas_commercial_listings",
    "alnokhba_residential_listings", "alnokhba_commercial_listings",
    "aqaratikom_residential_listings", "aqaratikom_commercial_listings",
    "aqarcity_residential_listings", "aqarcity_commercial_listings",
    "aqargate_residential_listings", "aqargate_commercial_listings",
    "aqarmonthly_residential_listings",
    "awal_residential_listings", "awal_commercial_listings",
    "deal_residential_listings", "deal_commercial_listings",
    "dealapp_residential_listings", "dealapp_commercial_listings",
    "eaqartabuk_residential_listings", "eaqartabuk_commercial_listings",
    "eastabha_residential_listings", "eastabha_commercial_listings",
    "erapulse_residential_listings", "erapulse_commercial_listings",
    "fursaghyr_residential_listings", "fursaghyr_commercial_listings",
    "gathern_residential_listings", "gathern_commercial_listings",
    "hajer_residential_listings", "hajer_commercial_listings",
    "jazwtn_residential_listings", "jazwtn_commercial_listings",
    "jurash_residential_listings", "jurash_commercial_listings",
    "mizlaj_residential_listings", "mizlaj_commercial_listings",
    "muktamel_residential_listings", "muktamel_commercial_listings",
    "mustqr_residential_listings", "mustqr_commercial_listings",
    "nowaisiry_residential_listings", "nowaisiry_commercial_listings",
    "october_residential_listings", "october_commercial_listings",
    "raghdan_residential_listings", "raghdan_commercial_listings",
    "ramzalqasim_residential_listings", "ramzalqasim_commercial_listings",
    "sadin_residential_listings", "sadin_commercial_listings",
    "sanadak_residential_listings", "sanadak_commercial_listings",
    "satel_residential_listings", "satel_commercial_listings",
    "toor_residential_listings", "toor_commercial_listings",
    "wasalt_residential_listings", "wasalt_commercial_listings",
]
_LOCATION_COLS = ("city", "region", "city_ar", "district_ar", "neighborhood")  # keep in sync with scrapers/common/db.py's _LOCATION_COLS


def _current_counts(client, tokens: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in _TABLES:
        for col in _LOCATION_COLS:
            try:
                res = client.table(table).select("ad_number", count="exact").in_(col, tokens).execute()
            except Exception as e:
                if "column" not in str(e).lower():
                    print(f"  (skip {table}.{col}: {e})", flush=True)
                continue
            n = res.count or 0
            if n:
                counts[f"{table}.{col}"] = n
    return counts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--update-baseline", action="store_true",
                     help="write today's counts as the new baseline (only after an approved backfill)")
    args = ap.parse_args()

    client = db.sb()
    tokens = sorted(t for t in PLACEHOLDER_TOKENS if t)  # empty string isn't a useful .in_() target
    current = _current_counts(client, tokens)

    if args.update_baseline:
        BASELINE_PATH.write_text(json.dumps(current, indent=2, ensure_ascii=False, sort_keys=True) + "\n")
        print(f"Baseline updated: {len(current)} (table, column) pairs recorded to {BASELINE_PATH}.")
        return 0

    baseline: dict[str, int] = json.loads(BASELINE_PATH.read_text()) if BASELINE_PATH.exists() else {}
    regressions = {k: (v, baseline.get(k, 0)) for k, v in current.items() if v > baseline.get(k, 0)}

    if not regressions:
        print(f"OK: no (table, column) pair exceeds its recorded baseline "
              f"({len(current)} pairs currently have placeholder rows, all within baseline).")
        return 0

    print("FAIL: a scraper wrote MORE placeholder location values than the recorded baseline allows:")
    for key, (now_n, base_n) in sorted(regressions.items(), key=lambda kv: -(kv[1][0] - kv[1][1])):
        print(f"  {key}: {now_n} now vs {base_n} baseline (+{now_n - base_n})")
        try:
            client.table("location_pipeline_alerts").insert({
                "alert_type": "placeholder_location_regression",
                "metric": now_n - base_n,
                "detail": f"{key}: {now_n} now vs {base_n} baseline (+{now_n - base_n} new placeholder rows)",
            }).execute()
        except Exception:
            pass  # the FAIL exit code is the primary signal; the alert row is best-effort
    return 1


if __name__ == "__main__":
    sys.exit(main())
