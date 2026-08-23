"""RETIRED 2026-08-23 — the legacy no-recheck hard-deleter. Refuses to run.

WHAT THIS USED TO DO, AND WHY IT IS GONE.
This module hard-deleted rows from `aqar_*_listings` and (via scripts/wasalt-cleanup.sh, which
passed `--table`) `wasalt_*_listings`, on age + strike count ALONE:
  • active = false, AND
  • missing_count >= 3, AND
  • last_seen_at older than 30 days.
It never re-fetched the source before deleting. It had no anomaly or fraction circuit breaker. Its
`PAGE = 1000` was a batch size, not a cap — the loop ran until the eligible population was
exhausted. And it wrote no per-row audit trail: only an aggregate `deleted=N` into
`scrape_runs.notes`, so nothing recorded WHICH listings were removed.

Measured consequence (Data Integrity run #39, 2026-08-23): **21,371 rows hard-deleted across 20
runs since 2026-06-21 with zero recoverable record of which listings they were** — including 5,533
on 2026-08-23 alone. Whether any of them were still live at the source is not merely unknown, it is
*unknowable*: no listing_id, ad_number or listing_url of a legacy-deleted row survives anywhere.

The age+strike rule is not a safe proxy for death, and that is measured rather than assumed:
gathern's own 18-day engine pilot found **14 of 50 (28%)** age+strike-eligible rows were STILL LIVE
at the final re-check. A path that deletes on that rule with no re-check is therefore expected to
remove live listings, not merely at risk of it.

Worse, the strikes it trusted can be stale. wasalt's enum-liveness sweep failed on 2026-08-19 and
2026-08-21 (100% proxy timeouts, 0 rows), so `missing_count` had not moved since 2026-08-18 — and
this deleter still removed 2,254 wasalt rows on 2026-08-23 using those five-day-old strikes.

THE REPLACEMENT is `scrapers/common/cleanup.py`, the unified retention engine, which aqar and
wasalt were migrated onto by PR #898 (`platform_retention_policy.enabled = true`, applied
2026-08-23). It keeps the same 30-day / 3-strike thresholds and adds, before any delete:
  1. a FRESH re-fetch of the listing's own URL — 404/410 or a registered dead-marker only;
     403/429/5xx/timeout/network error is inconclusive and the row is SKIPPED, never deleted;
     a live 200 REACTIVATES the row instead,
  2. a run-level freeze if >30% of that run's re-checks came back inconclusive,
  3. a platform-health gate that refuses to run at all while a scraper_failure_step_change or
     silent_scraper_death alert is open,
  4. an anomaly circuit breaker and a 10%-of-platform fraction guard,
  5. a hard `max_delete_per_run` cap, and
  6. a per-row audit trail written to `cleanup_deletion_log` BEFORE the delete.

This file is deliberately KEPT rather than deleted so that any external crontab still calling it
(the historical schedule was `0 2 * * 0` on /srv/ezhalah, outside this repo) fails LOUDLY with this
explanation, instead of a bare ModuleNotFoundError or — far worse — a silently restored deleter.

Regression guard: `scripts/verify-no-unguarded-deleter.ts` (in `npm test`) fails if any code path
outside the engine can hard-delete a listings table.
"""
from __future__ import annotations

import sys

_REFUSAL = """\
REFUSED: scrapers/aqar/cleanup.py is RETIRED and will not delete anything.

It deleted on age + strike count with no final source re-check, no circuit breaker and no per-row
audit trail. It removed 21,371 rows that way, unrecoverably, and gathern's pilot measured 28% of
age+strike-eligible rows as STILL LIVE at re-check.

Use the unified retention engine instead, which re-probes every row before deleting it:

    python -m scrapers.common.cleanup --platform aqar   --dry-run
    python -m scrapers.common.cleanup --platform wasalt --dry-run

Drop --dry-run only after reading the dry-run report. The engine refuses unless
platform_retention_policy.enabled is true for that platform.
"""


def main() -> int:
    """Always refuses. See the module docstring for the full rationale."""
    sys.stderr.write(_REFUSAL)
    return 2


if __name__ == "__main__":
    sys.exit(main())
