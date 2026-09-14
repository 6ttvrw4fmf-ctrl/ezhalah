-- مكتمل has been stale for 9 days with no attempt at all. Root cause, found 2026-09-14: its ONLY
-- scheduler entry, `gh-muktamel-weekly`, points at the OLD `muktamel-sync.yml` and is deliberately
-- paused — docs/ARCHITECTURE.md records why (2026-07-15: "never completed a single full-range crawl,
-- every GitHub Actions run killed by its own 330-minute timeout mid-crawl … Re-enable only after the
-- scraper itself is rebuilt — its enumeration approach needs redesigning, not just a longer timeout").
-- 20260815211103_mirror_live_only_pg_cron_jobs.sql asserts that job STAYS paused, and this migration
-- deliberately does not touch it.
--
-- The precondition in that note has since been met. `muktamel-sharded.yml` (PR #1635, 2026-09-03) IS
-- the rebuild it asked for: 8 parallel runners over the evidenced 24000-32300 id band, sized from
-- measured throughput at ~59 min/shard against a 120-minute cap — the timeout problem the old
-- workflow died of, solved by design rather than by a bigger number. It ran successfully by hand on
-- 2026-09-03 and is where muktamel's current 3,924 searchable listings came from. Nothing has ever
-- scheduled it, so that one manual run is the only data the platform has.
--
-- This adds the missing scheduler for the REBUILT workflow and leaves the retired one alone.
-- Weekly, matching the original cadence and the sizing argument in the workflow's own header.
-- 03:45 Monday: hour 3 already holds gh-gathern-cleanup (:00 Sun), mon-searchability-snapshot (:15),
-- dealapp-recover-weekly (:20), safety_barrier_state (:23), gh-aqarcity-cleanup (:30 Sun) and
-- mon-image-coverage-snapshot (:35), so :45 is clear — mon_detect_cron_minute_collision stays quiet.
-- trigger_gh_workflow() dispatches with ref=main and no inputs, so the workflow's own declared
-- defaults (min_id 24000 / max_id 32300) apply, which are the evidenced band.
select cron.schedule(
  'gh-muktamel-sharded',
  '45 3 * * 1',
  $job$select public.trigger_gh_workflow('muktamel-sharded.yml')$job$
);

do $verify$
declare v_active boolean; v_old_active boolean; v_sched text;
begin
  select active, schedule into strict v_active, v_sched
    from cron.job where jobname = 'gh-muktamel-sharded';
  if not v_active then
    raise exception 'gh-muktamel-sharded was created inactive — it would never run';
  end if;
  if v_sched <> '45 3 * * 1' then
    raise exception 'gh-muktamel-sharded landed on the wrong schedule: %', v_sched;
  end if;
  -- the retired job must be exactly as we found it: still present, still paused
  select active into strict v_old_active from cron.job where jobname = 'gh-muktamel-weekly';
  if v_old_active then
    raise exception 'gh-muktamel-weekly was un-paused — 20260815211103 requires it stay paused';
  end if;
end $verify$;
