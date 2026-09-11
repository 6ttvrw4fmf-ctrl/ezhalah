-- Companion to 20260911141904_served_despite_direct_404_is_watched.
--
-- (1) SCHEDULE the new detector. It is deliberately NOT added to mon_run_all_detectors()'s hardcoded
--     fns[] array: that array is a single shared line ~100 entries long and AGENTS.md warns this repo
--     is worked by concurrent sessions with no tree isolation, so editing it is the same conflict
--     class that took PR #1196 five rebase rounds. mon_detect_orphaned_detectors() accepts a detector
--     reachable from mon_run_all_detectors OR from a cron job, so a dedicated job satisfies the
--     roster rule without touching a contended surface.
--
--     Minute 32 was chosen because it was free: CRON DISCIPLINE (2026-08-10 522 outage) is one job per
--     minute-slot, with :00 reserved for the matview refresh. Every 6h, not hourly — the condition it
--     watches is a daily sweep failing, so hourly would be cost without sensitivity.
--
-- (2) UNSTACK minute :36. mon_detect_cron_minute_collision() went RED during this run with
--     "min 36 -> jobs 28,54,65". It was green at 13:59 UTC and red at 14:19, so the third job arrived
--     mid-run from a concurrent session. Jobid 28 is sync-search-listings-ar — the hourly search-index
--     sync that runs with statement_timeout 600s and is the heaviest job on the clock — so the monitor
--     moved, not the sync. mon-pii-capture-sweep scans 15,000 rows an hour and is indifferent to which
--     minute it runs on. Detector re-run after the change returns 0.
--     Altered BY NAME, not by the jobid observed today, so this migration is not hostage to an id.
do $$
declare v_jobid bigint;
begin
  perform cron.schedule('mon-served-despite-direct-404', '32 */6 * * *',
                        'select public.mon_detect_served_despite_direct_404();');

  select jobid into v_jobid from cron.job where jobname = 'mon-pii-capture-sweep';
  if v_jobid is not null then
    perform cron.alter_job(v_jobid, schedule => '55 * * * *');
  end if;
end $$;