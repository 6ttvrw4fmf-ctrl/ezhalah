-- Owner-approved 2026-08-09 (option 2, explicitly NOT --force): raise gathern's anomaly_floor so
-- the retention gate can judge the real eligible population instead of aborting on a legitimate
-- standing backlog.
--
-- WHY. The gate aborts when eligible > max(anomaly_floor, factor x trailing median). gathern's
-- floor was 300 and its trailing median is 0 (nothing has ever been deleted), so the threshold sat
-- at 300 while 488 rows were legitimately eligible — a permanent abort. Paired with the code fix in
-- PR #368 (the candidate SELECT no longer clamps the measurement to max_delete_per_run + 1), the
-- floor is now the only thing standing between a legitimate backlog and a guarded drain.
--
-- WHY 1000:
--   * above max_delete_per_run (300), so a permitted run can actually reduce the backlog;
--   * above the current legitimate backlog (488, verified 30-37 days stale, 0 in search index);
--   * well below the scale guard's trip point (max_eligible_frac 10% of 31,688 rows = 3,169), so
--     the fraction guard remains the outer bound for a real mass-inactivation event.
-- Nothing else changes: source re-verification (404-only for gathern), the 300/run delete cap, the
-- 30-day age rule, the 3-strike missing_count rule, and the audit log all stay exactly as they were.
update public.platform_retention_policy
   set anomaly_floor = 1000
 where platform = 'gathern'
   and anomaly_floor = 300;
