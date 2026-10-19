-- Retracting the REASONING attached to 20260920073503, not the change (§24e precedent: a wrong
-- premise is retracted as a migration so it does not outlive the code it justified).
--
-- That migration and its COMMENT ON claimed the instantaneous cohort "is never empty between passes
-- and would flap", and that at the :59 sweep "every row scraped in the intervening 35 minutes reads
-- as a defect". That is WRONG, and one look at the view definition refutes it:
-- listing_native_location_v2 reads BOTH listing_native_location_v1 and active_listing_ids_v2, which
-- are matviews refreshed by jobid 17 at :20. A row scraped mid-hour does not enter v2 until that
-- refresh. So v2's membership changes only at :20 and the sync consumes it at :22 -- the
-- instantaneous cohort is normally EMPTY outside that two-minute window, and the settled-window gate
-- already excluded most of it. Measured: at the 07:59 sweep, watching=0, stuck=0, no raise.
--
-- Same shape as §24e, where "the job has no explicit statement_timeout" looked obvious and
-- pg_settings already reported 120000. Checking the value the system actually resolves -- here the
-- view definition -- would have refuted the premise before the change was applied.
--
-- The duration clock is KEPT, on its real merits rather than the invented one:
--   1. It states §3's propagation SLA as a number (90 minutes) instead of leaving it implicit in a
--      coincidence between two cron schedules.
--   2. It stays correct if that coincidence changes -- which is exactly what ops_incident #354
--      proposes to do to the jobid 17/28 spacing. An instantaneous cohort is only safe while the
--      refresh and the sync stay 2 minutes apart; nothing enforces that, and #354 intends to move it.
--   3. It reports how long a listing has been unreachable, which is the fact worth alerting on.
-- Both limbs remain proven by execution: 5-minute row -> 0 (green), 3-hour row -> mon_raise 1 (red).

comment on function public.mon_detect_sync_pass_left_rows_unindexed() is
  'P1. Every listing_native_location_v2 row with a buy/rent deal must reach search_listings_ar '
  'within one hourly sync cycle. Measures a DURATION via ops_sync_unindexed_watch (90-minute SLA) '
  'rather than the instantaneous cohort -- NOT because that cohort flaps today (it does not: v2 '
  'reads two matviews refreshed by jobid 17 at :20, so membership changes only at :20 and the sync '
  'consumes it at :22), but because that emptiness is a coincidence between two cron schedules that '
  'nothing enforces and ops_incident #354 intends to change. The clock also states §3''s SLA as a '
  'number and reports how long a listing has actually been unreachable. Evaluates only in a settled '
  'window (last jobid-28 pass succeeded, finished 10..55 min ago) and never resolves on a path it '
  'did not evaluate (§23a). Measured cost 2026-09-20: ~7.25 s idle; 60 s+ is a real regression. '
  'Born from the 2026-09-20 arkaan cohort: 16 rows unreachable 2h12m behind a sync pass that '
  'aborted and rolled back its own INSERT.';

comment on table public.ops_sync_unindexed_watch is
  'Per-row clock for mon_detect_sync_pass_left_rows_unindexed(). A row enters when it is first seen '
  'in v2 but not in search_listings_ar during a settled window, and leaves the moment it is indexed. '
  'Age here is how long a listing has been unreachable. NOTE: the original comment claimed the '
  'instantaneous cohort would flap; that was wrong (see migration '
  '20260920075900_correct_the_stated_reason_for_the_unindexed_duration_clock). The clock is kept '
  'because it states the SLA explicitly and survives a change to the jobid 17/28 spacing, not '
  'because the cohort is noisy today.';