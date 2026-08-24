# Deletion safety — the permanent rules, the one sanctioned path, and the barriers

Owner-granted, 2026-08-24 (alert 931 investigation). This file is canonical. A migration header or a
docstring may add detail; none of them may contradict what is here.

## 1. The permanent rules

They are about EVIDENCE, not about age, strike counts, or how a listing looks.

| Source says | What Ezhalah does |
|---|---|
| HTTP 200 and no dead marker → **live** | **Never delete.** Reactivate the row (self-heal). |
| 404 / 410, or the platform's registered dead marker → **authoritatively dead** | Eligible for deletion — and only after every other safety requirement below also passes. |
| 403 / 429 / 5xx / timeout / network error / parser failure / anything ambiguous → **inconclusive** | **Do not delete.** Inconclusive is not permission in either direction: it is also not permission to *restore*. |

And the rule that covers everything the table does not:

> **No deletion without durable, per-row evidence, written before the delete.**

A deletion whose evidence exists only in an aggregate count is unprovable, and an unprovable
deletion is unrecoverable. That is not a documentation problem; it is the whole harm.

## 2. The only sanctioned deleter

`scrapers/common/cleanup.py`, the unified retention engine, invoked per platform and gated on
`platform_retention_policy.enabled`. Nothing else may hard-delete a listing row. Before it deletes
anything it must clear, in order:

1. **platform health** — refuses to run at all while a `scraper_failure_step_change` or
   `silent_scraper_death` alert is open for that platform (a degraded scraper produces stale
   strikes, and stale strikes are what a no-recheck deleter trusts);
2. **anomaly + fraction breakers** — an eligible population past the anomaly threshold or past
   10% of the platform aborts the run and deletes nothing;
3. **a fresh re-probe of the listing's own URL** — per row, immediately before the delete;
4. **the run-level inconclusive freeze** — if more than 30% of that run's re-checks came back
   inconclusive, every verdict in the run is suspect, so deletions are discarded and the run
   aborts. Reactivations are deliberately KEPT: restoring a live listing is the fail-safe
   direction;
5. **`max_delete_per_run`** — a hard cap;
6. **`cleanup_deletion_log`** — the per-row audit trail, written BEFORE the delete.

Nothing in that list may be weakened to make a run succeed or a barrier go green.

## 3. The barriers, and what each one cannot see

| # | Barrier | Watches | Blind to |
|---|---|---|---|
| 11 | `verify_deletions.py` + `mon_detect_deleted_but_source_live` | a post-delete re-probe sample; a `live` verdict is a P0 | deletions with no ledger row |
| 12 | `mon_detect_cleanup_evidence_gap` (3 limbs) | engine runs whose ledger count ≠ deletions; bypass paths that open a `scrape_runs` row; unclassifiable runs | a deleter that writes no run row |
| 13 | `mon_detect_deletion_spike` | `cleanup_runs` volume | a bypass path — it never writes `cleanup_runs` |
| 14 | `trg_archive_hard_delete` + `mon_detect_unledgered_hard_delete` | **every row that actually disappears**, from any entrypoint | nothing: the evidence is taken by the table's own trigger |
| CI | `scripts/verify-no-unguarded-deleter.ts` (`npm test`) | any tracked file that could hard-delete a listings table | statements that never land in a file |

Barrier 14 is the one that does not depend on the deleter cooperating. It archives the complete row
into `purged_listings_archive` on delete, so a false deletion is provable (which listing) and
recoverable (`row_data`), and any delete without a matching engine ledger entry raises P0.
`purged_listings_archive.deletion_reason` is informational only and is **never** a detector
predicate — a bypass path could set that GUC as easily as it skips the ledger.

## 4. Retiring a deletion path

Freezing an unsafe entrypoint is not finished until it is registered:

1. make the entrypoint a **loud refusal** rather than deleting the file — an external crontab must
   fail visibly, not with a bare `ModuleNotFoundError` (`scrapers/aqar/cleanup.py`,
   `scripts/wasalt-cleanup.sh`);
2. move the platform onto the engine (`platform_retention_policy.enabled = true`);
3. insert the freeze into **`ops_retired_deletion_path`** with its timestamp, evidence and totals.

Barrier 12 limb B then reports that path only for runs AFTER its `retired_at`. An unregistered path
has no row, so every one of its runs counts and a new bypass still raises on its first deletion.
Registering a path is an assertion the entrypoint is gone — it silences nothing on its own, because
barrier 14 still raises P0 on any row that actually disappears without evidence.

## 5. The 2026-06/08 incident, and what a back-audit can honestly say

The legacy `scrapers/aqar/cleanup.py` deleted on `missing_count >= 3` + 30 days of age ALONE — no
re-check, no breaker, no per-row trail — across `aqar_*` and (via `scripts/wasalt-cleanup.sh`)
`wasalt_*`. It removed **21,371 rows in 20 runs between 2026-06-21 and 2026-08-23**, recording only
`deleted=N` per run. Retired 2026-08-23 (PR #951); both platforms migrated to the engine (PR #898).

That rule is measured to remove live listings, not merely at risk of it:

* gathern's 18-day engine pilot: **14 of 50** age+strike-eligible rows were still LIVE at re-check;
* aqar's own first engine dry run: **3 of 158**;
* aqar's first real engine run (2026-08-23): **4 of 4** candidates came back live and were
  reactivated instead of deleted.

`ops_hard_deleted_listing_backaudit` reconstructs what identity survived, and its limits are the
point of the table:

* **10,682 of 21,371** identities recovered from other ops snapshots. The rest left no trace.
* **65** of those still carry an `ad_number` or `listing_url` — the only ones that can ever be
  re-probed. The other **10,617** are `unverifiable_no_source_key`: an internal bigint PK does not
  resolve to a source page, and `storage.objects` is empty, so no raw capture survives.

The rules for reading it, which apply to any future back-audit:

* restore a row **only** on an authoritative `live` verdict, and re-ingest it through the normal
  scraper rather than rebuilding it from the probe — one surviving field is not a listing;
* **never** classify a row `dead` because its evidence is missing;
* when a URL has to be BUILT from an ad number, calibrate that form against listings that are
  currently live first. An un-calibrated built URL that 404s produces a confident "correctly
  deleted" about a listing that is still on the market — the same manufactured certainty the legacy
  deleter had.
