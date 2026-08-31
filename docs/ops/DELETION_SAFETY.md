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

Those 65 were re-probed on 2026-08-24 through the wasalt proxy (`verify_deletions --legacy`, run
`backaudit:wasalt` 34757): `calibration=valid probed=65 dead=65 live=0 inconclusive=0` — every one
of them 404s at the source, so **0 restorations were warranted and 0 were made**. Read it for what
it is: 65 rows is 0.3% of 21,371, drawn from whichever rows happened to appear in a July ops
snapshot, so it is not a random sample and it does not clear the legacy path. The measurements that
speak to the path's actual failure rate are the engine's own re-checks above (28% at gathern,
1.9% then 4-of-4 at aqar), and the 10,617 remain permanently unknowable either way.

The rules for reading it, which apply to any future back-audit:

* restore a row **only** on an authoritative `live` verdict, and re-ingest it through the normal
  scraper rather than rebuilding it from the probe — one surviving field is not a listing;
* **never** classify a row `dead` because its evidence is missing;
* when a URL has to be BUILT from an ad number, calibrate that form against listings that are
  currently live first. An un-calibrated built URL that 404s produces a confident "correctly
  deleted" about a listing that is still on the market — the same manufactured certainty the legacy
  deleter had.

## 6. The standing aqar/wasalt cleanup-engine backlog — owner decision (2026-08-30)

`cleanup:aqar` and `cleanup:wasalt` (the unified engine, §2) have aborted on their anomaly breaker
every run since the engine went live for these two platforms on 2026-08-22/23: ~4,921 eligible rows
for aqar, ~4,416 for wasalt, both far past the anomaly floor of 300. Neither platform has hard-deleted
a single row through the engine — `cleanup_deletion_log` holds only `aqarcity` and `gathern`. Both the
Daily Engineer (2026-08-30 heartbeat) and Senior Production (run #71, 2026-08-30) independently
classified this as `OWNER DECISION` and left it untouched. The owner's decision, given 2026-08-30, is
now explicit and permanent:

**Do not raise or weaken the anomaly floor merely to let the backlog through.** Deletion on these two
platforms stays fail-closed. The anomaly/fraction breaker (§2.2) is not a bug to route around here —
raising a destructive-operation threshold to make a blocked run go green is exactly the kind of
"weaken a gate to reach 10/10" this repo's engineering policy forbids (`AGENTS.md`,
`docs/ops/AGENT_AUTHORITY.md` RED list #4/#6).

**The sanctioned path is a controlled, source-confirmed drain, not a threshold change.** Whoever
implements it (Senior Production Engineer owns this surface; the daily scraping-layer routine does
not have write authority for it) must build it to this spec:

1. **Re-probe every one of the ~4,921 / ~4,416 candidates against the live source** — the same
   per-row re-probe §2.3 already requires, run explicitly over this backlog rather than skipped
   because the row is already "eligible."
2. **`live` (HTTP 200, no dead marker) → preserve.** Reactivate if currently marked inactive. Never
   delete a row the source still serves.
3. **`inconclusive` (403/429/5xx/timeout/parser failure/anything ambiguous) → preserve.** Per §1,
   inconclusive is not permission to delete. **Scraper/crawl absence alone is never evidence of
   death** — a listing missing from a crawl only becomes eligible once its own URL has been
   individually re-probed and returned an authoritative dead signal, never from strike/age counters
   alone.
4. **Only rows that come back authoritatively dead (404/410, or the platform's registered dead
   marker) on that fresh per-row probe are eligible for deletion.**
5. **Drain in bounded batches, not one pass over the whole backlog** — a `max_delete_per_run`-style
   cap per run (§2.5), sized and owner-visible, so a mistake in the drain logic itself has a small,
   auditable blast radius rather than touching thousands of rows at once.
6. **The anomaly/fraction breaker (§2.2) stays fully active during and after the drain.** A drain run
   is not exempted from it — it is bounded specifically so it never needs to be.
7. **Every deletion still goes through `cleanup_deletion_log` (§2.6) and barrier 14's archive
   (§3)** — the drain uses the sanctioned engine path and its full audit trail, not a one-off script
   that bypasses it. `scripts/verify-no-unguarded-deleter.ts` continues to apply.
8. **No arbitrary threshold increase to make the job report green.** If, after the source re-probe,
   the confirmed-dead count is still large, that is a finding to report with evidence — not a reason
   to loosen anomaly_floor so the run stops aborting.

Until this drain is built and run, the correct, expected state is: both platforms keep aborting on
this backlog, deleting nothing. That is the gate working, not a defect to clear.
