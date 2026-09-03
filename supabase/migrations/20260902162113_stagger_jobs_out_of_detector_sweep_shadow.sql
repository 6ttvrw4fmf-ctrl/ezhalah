-- CRON ATTENDANCE ROOT CAUSE: THE SWEEP'S SHADOW, NOT TOP-OF-HOUR CONGESTION
-- (routine #7, systems seam, 2026-09-02 — owner-approved schedule change.)
--
-- LIMB 5 (20260902105054) measured the symptom: jobid 17 refresh_listing_native_location_v1
-- started 20 of 24 due runs, jobid 50 refresh-mon-audit-counts 42 of 48. The first hypothesis was
-- top-of-hour worker congestion. That was WRONG, and the evidence says so precisely.
--
-- At each of the four instants jobid 17 failed to start, exactly ONE job was running, and it was
-- the same one every time: jobid 38 mon-detectors-and-dispatch, the ':59' detector sweep,
-- overrunning into ':00'. Across the full 24h the separation is total:
--
--     :59 sweep duration    jobid 17 started?
--     167-354 s (21 hours)  YES, every time
--     362 / 440 / 655 s     NO,  every time
--
-- The sweep ALWAYS overruns :00 (it never finishes in under 60 s), so "overlaps" is not the
-- discriminator — DURATION is, with a clean boundary near 360 s. pg_cron defers a job it cannot
-- start (observed starts at :01, :02, :03, :04:43) and past roughly six minutes drops the
-- occurrence entirely. The effective cron worker pool is tiny: max_worker_processes = 6 shared
-- with parallel workers, autovacuum and the launcher, and measured concurrency never exceeded 2.
--
-- This also explains the rest of the roster exactly, which the congestion theory did not:
--   * jobid 50 sits at :02 AND :32 — BOTH slots are directly in a sweep shadow (:59 and :29).
--     That is why it lost 6 of 48 rather than 3 of 144.
--   * every job at minute >= 9 sits at 100%: the sweep's median run is ~172 s, so its typical
--     shadow has cleared by :02, and only the long tail reaches further.
--   * the 10-minute-cadence jobs lose 3-6 of 144 — the occurrences that land at :01/:31 etc.
--
-- THE FIX IS THE SCHEDULE, NOT THE MEASUREMENT. The 90% floor in LIMB 5 is untouched, the
-- detector is untouched, and no work is skipped: both jobs keep their exact frequency.
--
--   jobid 17  '0 * * * *'      -> '20 * * * *'      hourly, unchanged (1 run/hour)
--   jobid 50  '2,32 * * * *'   -> '22,52 * * * *'   twice hourly, still exactly 30 min apart
--
-- WHY THESE MINUTES, chosen from measured occupancy rather than by eye:
--   * :20, :22 and :52 are all outside BOTH sweep shadows (:59->~:10 and :29->~:40), with margin
--     past even a 900 s statement-timeout sweep, which from :59 would end at :14.
--   * each lands on a minute holding exactly one other job, so every affected minute ends at 2 —
--     mon_detect_cron_minute_collision() raises at >= 3, and simulating it over the whole live
--     roster with these values returns 0 collisions.
--   * :25 was the obvious-looking slot for jobid 50 and is a TRAP: jobid 44's '5-59/10' also lands
--     there, which would have made three. :14 and :42 are traps for the same reason. The
--     simulation caught all three before this was applied.
--   * the co-runners are light: :20 jobid 47 (40 s), :22 jobid 35 (101 s), :52 jobid 43 (3 s).
--
-- WHAT IS DELIBERATELY NOT TOUCHED:
--   * the sweep itself (jobid 38) and mon-p0-fast-lane (jobid 86). The P0 delivery design in
--     docs/ops/SYSTEMS_SEAM_ENGINEER.md pins the lane's 24 minute-slots around the sweep's
--     :29/:59; moving the sweep would invalidate that reasoning and the barrier that holds it.
--   * the ONE ordering contract, sync-search-listings-ar (:14) -> resolve-english-city-overlay
--     (:22), gap 8 >= the required 5. Neither side moves, so the contract is unchanged. Note
--     jobid 50 now shares :22 with the contract's downstream job; both are short and the minute
--     holds only those two.
--   * minute 0 is now empty. mon_detect_cron_minute_collision() raises only when minute 0 holds
--     MORE than one hourly job, so an empty :00 is fine. The reservation was not protecting jobid
--     17 in any case — the sweep's shadow crossed it every single hour.
--
-- FRESHNESS: jobid 17 refreshes an hourly matview, so its phase moves 20 minutes later while its
-- period is unchanged. That is strictly better than the status quo, which silently skipped four
-- refreshes a day and left the matview up to TWO hours stale; after this it is always <= 1 hour.
do $mig$
declare
  v_before_17 text;
  v_before_50 text;
begin
  select schedule into v_before_17 from cron.job where jobid = 17 and jobname = 'refresh_listing_native_location_v1';
  select schedule into v_before_50 from cron.job where jobid = 50 and jobname = 'refresh-mon-audit-counts';

  -- Fail closed if the roster moved under us: a jobid whose name no longer matches is a different
  -- job, and rescheduling it blind is how one session silently breaks another's work.
  if v_before_17 is null or v_before_50 is null then
    raise exception 'jobid 17/50 not found under their expected names -- refusing to reschedule blind (17=%, 50=%)',
      v_before_17, v_before_50;
  end if;

  perform cron.alter_job(job_id => 17, schedule => '20 * * * *');
  perform cron.alter_job(job_id => 50, schedule => '22,52 * * * *');

  raise notice 'jobid 17: % -> 20 * * * *', v_before_17;
  raise notice 'jobid 50: % -> 22,52 * * * *', v_before_50;
end
$mig$;
