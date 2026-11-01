# Evidence map: what each kind of hide leaves behind

Read from `origin/main` at 7bf84114 and measured read-only on production, 2026-10-02 20:15-20:30 UTC.
"Timing" is the ledger row's own timestamp minus the row's `deactivated_at`, over the last 7 days.

## The function and who reads it

| object | what it does with the function |
|---|---|
| `mon_unverified_inactivation_counts(interval)` | live md5 `364f925e0c9a85a1b5198bd5c9ef2933`; newest migration `20260906073746_a_deduplicated_copy_is_not_an_unverified_kill.sql` |
| view `mon_unverified_inactivations_24h` | the only caller; `(unverified, deduplicated)` for 24 h |
| `mon_detect_unverified_inactivation()` | live md5 `f30c15131f1adffb940a73cea6ebf210`; replaced in the same migration, strings only (its hint said `missing_count=0`). Reads the view; P1 `unverified_inactivation` when unverified > 0, P2 `deduplicated_copy_flood` when deduplicated >= 5 and >= unverified. Runs in `mon_run_all_detectors()` (cron `mon-detectors-and-dispatch`, :29 and :59, 900 s timeout, about 300 s per run) |
| `scripts/check_audit_invariants.py` | reads the view, fails the audit when it is not 0. Its docstring and both messages described the `missing_count` rule; corrected in the branch |
| `auto_recover_false_inactive(interval)` | does NOT call the function. Its own predicate is `missing_count = 0`, so it has the same blind spot from the other side: a hide stamped `missing_count = 3` is never recovered. Cron 05:20 daily. Not changed here |
| `mon_detect_adjudicated_reactivation`, `mon_detect_source_retraction_flap`, `mon_detect_false_resurrection` | mention the names in alert text only |
| `mon_detect_unknown_treated_as_dead()` | the neighbour. Per table, 48 h, demands a GONE row in the probe ledger by `ad_number`, but SKIPS every platform registered DIRECT_REVISIT or CANDIDATE_PLUS_DIRECT. So before this change, a hide with `missing_count = 3` on aqar, gathern, wasalt, dealapp or any fleet-liveness site was seen by nothing |

## Ledgers

| hide path (code) | ledger | join key to the listing | written before the hide? | measured timing | read by the new function |
|---|---|---|---|---|---|
| aqar / aqarmonthly liveness sweep (`scrapers/aqar/liveness.py`) | `aqar_liveness_detail`, verdict `kill`, `applied` | `source_table` + `listing_id` | Stamped before, INSERTED after: rows are buffered in memory and flushed every 500 or at the end of the shard. A shard that dies loses them | 0.05-0.75 s before | yes |
| gathern liveness (`scrapers/gathern/liveness.py`) | `gathern_liveness_detail`, verdict `kill` / `dead_confirmed`, `applied` (no `source_table` column; the sweep reads `gathern_residential_listings` only) | `listing_id` | No. Kill rows are flushed after the batch of hides | 0.1 s to 2 min 02 s AFTER | yes (gathern_residential only) |
| gathern crawl prune (`db.prune_unseen(verify_gone=...)`, daily about 04:50) | `ops_stale_inactivation_probe`, GONE, oracle `prune_unseen.verify_gone` | `source_table` + `ad_number` (`listing_id` is NULL) | Yes | under 1 s before | yes |
| wasalt liveness (`scrapers/wasalt/liveness.py`) | private `wasalt_liveness_pilot_detail` (`tbl` + `listing_id`, no index on them) AND, since 2026-09-08, a mirror row in `ops_stale_inactivation_probe`, GONE, oracle `wasalt.liveness.check_hybrid` | `source_table` + `listing_id` + `ad_number` | Yes ("evidence first: written even if a flip below fails") | under 3 min before; 3,700 of 3,700 hides matched | mirror only. `wasalt_liveness_runs` is one row per run and cannot verify a listing |
| fleet liveness, about 50 sites (`scrapers/common/fleet_liveness.py`) | `ops_stale_inactivation_probe`, GONE, oracle `fleet_liveness.<site>` | `listing_id` + `ad_number` | Yes, the insert is the line before the update | under 1 s before | yes |
| `db.prune_unseen` WITH `verify_gone` | `ops_stale_inactivation_probe`, GONE / LIVE / UNKNOWN, oracle `prune_unseen.verify_gone` | `ad_number` only | Yes | under 1 s before | yes (GONE only) |
| `db.prune_unseen` WITHOUT `verify_gone` (50 platforms in `scrapers/absence-only-prune.txt`) | NONE. Only `missing_count = 3` and the run's `scrape_runs` row | - | - | - | this is the one place the counter is still read, and only for platforms registered SOURCE_LIST_PRESENCE or CRAWL_PRESENCE_ONLY |
| sold pins (`scrapers/common/sold_pin.py`, 11+ sites) | `ops_stale_inactivation_probe`, GONE, oracle `<site>.sold_pin.<field>` | `ad_number` only | No. The row is hidden by the upsert, pinned, then recorded ("the ledger must never be able to block the pin") | 0-3 s AFTER | yes |
| `db.retire_superseded_siblings` | `ops_stale_inactivation_probe`, verdict SUPERSEDED, oracle `res_com.sibling_classified_this_run` | `listing_id` + `ad_number` | No. Written after the update, best-effort | 0-6 s AFTER | yes. With a live twin the row is `deduplicated`; with no live twin the SUPERSEDED row verifies it |
| hand / bulk applications (dealapp home-egress and CI-crawl, gathern home-egress, sanadak, aqar ad-end-date pins) | `ops_stale_inactivation_probe`, GONE, each with its own oracle name | `listing_id` + `ad_number` | Yes, but `probed_at` is supplied by the writer (the time the page was read), not by the database | 0 s to 3 d 08 h 57 min before | yes |
| dealapp liveness (`scrapers/dealapp/liveness_run.py`) | `dealapp_liveness_detail`, verdict `kill`, `applied` | `source_table` + `listing_id` | No, written after the trust gate | never happened: 0 kill rows all-time (13,091 rows are unknown/strike) | yes |
| dealapp crawl prune | `ops_stale_inactivation_probe`, GONE, `prune_unseen.verify_gone` | `ad_number` | Yes | - | yes |
| adjudicated retractions (`db.register_source_retraction`, res/com collision repair) | `ops_adjudicated_retraction`, `ops_res_com_collision_adjudication`, read through the view `ops_adjudicated_listing` | `tbl` + `listing_id` | At or after | not time-bounded (unchanged) | yes, unchanged: an adjudicated row is excluded from both counts |

## Alive readings (what overrides an older GONE row)

| writer | what it leaves | read by the new function |
|---|---|---|
| any sweep's direct ALIVE branch (`liveness_contract.verification_patch` / `direct_alive_patch`: aqar, gathern, wasalt, dealapp liveness, dealapp-recover since 0bb1a4d0) | `last_verified_alive_at` on the listing row; no ledger row | yes |
| sold pin, when the source relists (`<site>.sold_pin.<field>`, note "source relisted"; 13 rows) | LIVE row in `ops_stale_inactivation_probe`, `ad_number` only | yes |
| `prune_unseen(verify_gone)` (966 rows) | LIVE row, `ad_number` only | yes |
| wasalt liveness mirror (359 rows) | LIVE row, both keys | yes |
| hand probes: aqarcity soft-404 (252), abeea (9), aqar soft-close (6) | LIVE row, `listing_id` only | yes (this is why both keys are read) |
| any UNKNOWN reading (5,233 rows) | UNKNOWN row | no: it neither verifies a hide nor cancels a GONE row |

## Indexes the lookups use

| ledger | rows | index |
|---|---|---|
| `ops_stale_inactivation_probe` | 59k | `idx_stale_inact_probe_row (source_table, listing_id, probed_at desc)`, `idx_stale_inact_probe_ad (source_table, ad_number, probed_at desc)` |
| `aqar_liveness_detail` | 86k | `aqar_liveness_detail_listing_idx (source_table, listing_id)` |
| `gathern_liveness_detail` | 110k | `idx_gathern_liveness_detail_listing (listing_id, run_at desc)` |
| `dealapp_liveness_detail` | 12k | `dealapp_liveness_detail_listing_idx (source_table, listing_id)` |
| `wasalt_liveness_pilot_detail` | 22k | primary key only. A per-row lookup timed out the first measurement, which is why the mirror is read instead |

No listing table has an index on `deactivated_at` (0 of 303). The scan uses each table's `active` index
or a sequential scan, exactly as the old function did.

## Findings the map turned up

1. **aqar loses its kill records when a shard dies.** 66 rows of `aqar_residential_listings` went
   `active = false`, `missing_count = 3` on 2026-10-02 01:07-01:10 UTC with no kill row. All 66 are
   `id % 16 = 7`; shard 7 wrote 0 ledger rows that night (shard 6 wrote 653) and its `scrape_runs` row
   57198 is orphaned. They carry earlier strike rows (HTTP 200, soft-closed) but the third reading is
   gone. Fix on the scraper side: flush the buffer in a `finally`, or insert each kill row before its
   update. Not changed in this branch.
2. **50 platforms still hide on absence alone.** 10 such rows in 7 days (aqaratikom 3, shomou 3,
   opensooq 2, ashab 1, maqrat 1). They are already raised per table by
   `mon_detect_unknown_treated_as_dead`, so the new function does not count them a second time.
3. **`probed_at` is whatever the writer says.** The 1,933 dealapp CI-crawl rows carry `probed_at`
   from 2026-09-29 to the 02:00 hour of 2026-10-02 but were inserted between 09:40 and 12:25 UTC on 2026-10-02
   (ledger ids 55920-57852 sit between rows stamped 09:40:10 and 12:25:29). The hide ran at 11:30:46.
   The table has no insert-time column, so no monitor can tell a reading recorded when it was taken
   from one typed in later.
4. **`auto_recover_false_inactive()` has the mirror-image blind spot** (`missing_count = 0` only).
   Out of scope here; listed so it is not forgotten.
