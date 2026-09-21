-- مكتمل moves from WEEKLY to DAILY (owner request, 2026-09-21).
--
-- WHY. muktamel carries 4,067 searchable listings and was checked once a week, so a sold listing
-- could sit live in the app for up to 7 days. Every comparable platform is daily. The weekly cadence
-- was never a sizing decision: 20260914041355 chose it as "the cadence the paused job had" — i.e.
-- inherited from `gh-muktamel-weekly` (jobid 14), the OLD sequential job that was paused in July
-- precisely because it could never finish. The reason for weekly retired with the job it came from.
--
-- WHY DAILY IS SAFE, from the rebuilt workflow's own measured sizing (muktamel-sharded.yml header):
-- 8 shards over the evidenced 24000-32300 band, ~1038 ids/shard, ~59 min/shard at the WORST observed
-- rate (17.7 ids/min), against a 120-minute cap — 50%+ headroom, per shard, per run. Nothing about
-- that math is per-week; it is per-run, and it holds identically at any cadence.
--
-- PRECEDENT, not a new pattern: dealapp-sharded.yml is the file muktamel-sharded.yml was modelled
-- on, and it already runs **12** shards **daily** (gh-dealapp-sharded, jobid 72, '33 2 * * *').
-- muktamel daily at 8 shards is strictly less fleet load than something production already does
-- every night.
--
-- SLOT. Unchanged at 03:45 — only the day-of-week field moves (1 -> *). Hour 3 holds
-- mon-searchability-snapshot (:15), dealapp-recover-weekly (:20), safety_barrier_state (:23) and
-- mon-image-coverage-snapshot (:35) daily, plus gh-gathern-cleanup (:00) and gh-aqarcity-cleanup
-- (:30) on Sundays. :45 stays clear on every day of the week, so mon_detect_cron_minute_collision
-- stays quiet.
--
-- The retired sequential job (jobid 14, 'gh-muktamel-weekly') is NOT touched and stays paused —
-- 20260815211103_mirror_live_only_pg_cron_jobs.sql requires that, and it remains true.
--
-- alter_job edits in place: same jobid, same jobname, same command, only `schedule` changes.
-- Reversible with the same call and '45 3 * * 1'.

select cron.alter_job(
  (select jobid from cron.job where jobname = 'gh-muktamel-sharded'),
  schedule => '45 3 * * *'
);

do $verify$
declare
  v_sched      text;
  v_active     boolean;
  v_cmd        text;
  v_old_active boolean;
begin
  select schedule, active, command
    into strict v_sched, v_active, v_cmd
    from cron.job where jobname = 'gh-muktamel-sharded';

  if v_sched <> '45 3 * * *' then
    raise exception 'gh-muktamel-sharded did not move to daily: %', v_sched;
  end if;
  if not v_active then
    raise exception 'gh-muktamel-sharded is inactive — a daily schedule on a dead job runs never';
  end if;
  if v_cmd not like '%muktamel-sharded.yml%' then
    raise exception 'gh-muktamel-sharded no longer dispatches the REBUILT workflow: %', v_cmd;
  end if;

  -- the retired sequential job must be exactly as we found it: still present, still paused
  select active into strict v_old_active from cron.job where jobname = 'gh-muktamel-weekly';
  if v_old_active then
    raise exception 'gh-muktamel-weekly was un-paused — 20260815211103 requires it stay paused';
  end if;

  raise notice 'gh-muktamel-sharded now daily at 03:45 UTC; gh-muktamel-weekly still paused';
end
$verify$;
