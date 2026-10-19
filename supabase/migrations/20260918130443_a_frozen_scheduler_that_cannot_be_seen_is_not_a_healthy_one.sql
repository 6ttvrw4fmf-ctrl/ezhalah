-- A P0 that flaps is a P0 nobody can work, and a dashboard that lies at the moment anyone looks.
--
-- MEASURED, 2026-09-18. jobid 28 `sync-search-listings-ar` — the ONLY writer of the served search
-- index — froze at 2026-09-15 09:36Z and did not run again for 75 hours. The catch-up sync this
-- session ran by hand reported `upserted=173522 deleted=2673`: 173,522 index rows stale or missing,
-- and 2,673 listings our own source checks had already marked inactive still being served to users.
--
-- mon_detect_cron_scheduler_frozen SAW it. It raised the P0 correctly, roughly twenty times across
-- those three days — and something resolved it every ~30 minutes, two minutes before it raised
-- again:
--     raised 09-17 22:42 -> resolved 09-18 09:10
--     raised 09-18 09:13 -> resolved 09-18 09:40
--     raised 09-18 09:42 -> resolved 09-18 10:10
--     raised 09-18 10:13 -> resolved 09-18 11:40
-- The resolver was the detector's own LIVENESS HALF. Its intent is sound: if pg_cron itself is
-- down, "the scheduler dropped these jobs" is the wrong diagnosis with the wrong remedy. But it
-- expressed "I cannot confirm cron is running" by calling mon_resolve_key() — turning an absence of
-- evidence into a positive statement that the condition had cleared. That is this repo's
-- owner-locked SOURCE IS TRUTH / silent -> NULL, never unknown -> NO rule, violated in the
-- OBSERVABILITY layer instead of the data layer, and it is the same shape this routine recorded on
-- 2026-09-14 as "THE RULE THAT READ UNKNOWN AS NO".
--
-- WHY THE LIVENESS HALF KEPT READING QUIET. `n_alive` counted distinct jobids started in the last
-- 10 minutes and required >= 3. Measured at the fast lane's own :10 and :40 slots, every hour of
-- 2026-09-18: n_alive was 0, 1 or 2 — while cron was perfectly healthy. The cause is job 38
-- (mon-detectors-and-dispatch), which ran 12:29:00 -> 12:39:41, a single 10m41s statement during
-- which pg_cron started no other job at all (jobid 53 fired 0.02s after 38 returned). So a long
-- detector sweep starves the scheduler, the 10-minute window reads near-empty, and the detector
-- concludes cron might be down — at precisely the slots where it then erased a true P0.
--
-- TWO CHANGES, both measured:
--   1. UNKNOWN NOW ABSTAINS. Only n_frozen = 0 — real evidence the jobs are running again — may
--      resolve. An unconfirmable scheduler leaves any open alert exactly as it is. The failure
--      direction flips from "silently erase a live P0" to "leave it standing", which is the only
--      safe direction for a P0 whose blast radius is the served search index.
--   2. The liveness window widens 10m -> 30m, because a healthy scheduler demonstrably goes ~11
--      minutes without starting a job whenever a sweep runs long. This gates only the abstention,
--      never the raise.
--
-- The decision is lifted OUT of the detector into a pure function so the three outcomes cannot
-- drift apart again, and so they can be mutation-proven without touching live cron tables. That is
-- the same discipline as 20260905183554_searchability_detector_raise_and_resolve_share_one_predicate.

create or replace function public.mon_cron_frozen_verdict(
  p_n_frozen int,
  p_n_alive  int,
  p_critical boolean
) returns text
language sql
immutable
as $function$
  select case
    -- Real evidence the named jobs are running again. The ONLY path that may clear the alert.
    when coalesce(p_n_frozen, 0) = 0 then 'resolve'
    -- Cannot confirm the scheduler is alive. Absence of evidence is NOT evidence the P0 cleared:
    -- leave whatever is open exactly as it is.
    when coalesce(p_n_alive, 0) < 3  then 'abstain'
    when coalesce(p_critical, false) then 'raise_p0'
    else 'raise_p1'
  end
$function$;

comment on function public.mon_cron_frozen_verdict(int, int, boolean) is
  'Pure verdict for mon_detect_cron_scheduler_frozen: resolve | abstain | raise_p0 | raise_p1. '
  'Only n_frozen = 0 may resolve; an unconfirmable scheduler ABSTAINS and never clears an open '
  'alert. Mutation-proven at apply time in the migration that introduced it (2026-09-18).';

create or replace function public.mon_detect_cron_scheduler_frozen()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rows_frozen  jsonb;
  n_frozen     int;
  n_alive      int;
  critical_hit boolean;
  verdict      text;
begin
  -- ONE evaluation of the predicate. Both the payload and the severity test read these same rows,
  -- so they cannot disagree and the lane pays for the scan once.
  create temporary table if not exists _frozen_now (
    jobid bigint, jobname text, median_interval_s double precision,
    runs_observed bigint, last_start timestamptz, overdue_factor numeric
  ) on commit drop;
  delete from _frozen_now;
  insert into _frozen_now select * from public.mon_cron_frozen_jobs();

  select count(*),
         coalesce(jsonb_agg(jsonb_build_object(
           'jobid', f.jobid, 'job', f.jobname,
           'median_interval_s', round(f.median_interval_s::numeric, 1),
           'last_start', f.last_start,
           'periods_missed', f.overdue_factor) order by f.overdue_factor desc), '[]'::jsonb)
    into n_frozen, rows_frozen
    from _frozen_now f;

  -- THE LIVENESS HALF. 30 minutes, not 10: a single long detector sweep (job 38 ran 10m41s on
  -- 2026-09-18) starves the scheduler, and a 10-minute window then reads near-empty on a perfectly
  -- healthy cron.
  select count(distinct d.jobid) into n_alive
    from cron.job_run_details d
   where d.start_time > now() - interval '30 minutes';

  -- The served search index has exactly one writer. If that is the job that got dropped, users stop
  -- seeing new listings and keep seeing dead ones, so this is not a P1.
  select exists(select 1 from _frozen_now f
                 where f.jobname in ('sync-search-listings-ar', 'refresh-listings',
                                     'sync-search-first-seen-at', 'refresh-location-index'))
    into critical_hit;

  verdict := public.mon_cron_frozen_verdict(n_frozen, n_alive, critical_hit);

  if verdict = 'resolve' then
    perform public.mon_resolve_key('cron_scheduler_frozen', 'cron_scheduler_frozen');
    return 0;
  end if;

  if verdict = 'abstain' then
    -- Deliberately NOT mon_resolve_key. We cannot see the scheduler well enough to say anything,
    -- so we say nothing and any open alert stands.
    return 0;
  end if;

  return public.mon_raise(
    case when verdict = 'raise_p0' then 'P0' else 'P1' end,
    'cron_scheduler_frozen', 'all', 'cron_scheduler_frozen',
    jsonb_build_object(
      'frozen_jobs', rows_frozen,
      'frozen_count', n_frozen,
      'other_jobs_running_last_30min', n_alive,
      'serving_impact', critical_hit,
      'why', 'These jobs have a long, regular, frequent history and have each missed 4+ consecutive '
             'periods, WHILE ' || n_alive || ' other jobs ran in the last 30 minutes. A job that is '
             'merely flaky does not go silent for hours while the scheduler keeps working: pg_cron '
             'is running a STALE in-memory copy of cron.job and no longer sees these entries. '
             'Observed in production on 2026-09-15: jobs 28/40/109 were dropped at 21:36-22:08 the '
             'night before and a job created fresh at 07:29 also never fired. Observed AGAIN '
             '2026-09-15 09:36 -> 2026-09-18 12:57 on jobs 28/40: 75 hours, and the catch-up sync '
             'reported upserted=173522 deleted=2673.',
      'remedy', 'Run `select pg_reload_conf();`. That is a SIGHUP, not a restart — no disconnects — '
                'and it makes pg_cron re-read cron.job. On 2026-09-15 the newly created job fired '
                'within seconds of it and jobs 28 and 40 resumed on their own at the next :36/:37. '
                'Then confirm each named job actually ran, and re-run the sync-dependent detectors '
                '(inactive_still_searchable, inactive_still_counted) which clear themselves once '
                'the index syncs. If the index is badly behind, do not wait for the next :36 — call '
                'public.sync_search_listings_ar() directly.',
      'do_not', 'Do NOT treat this as contention. That was the standing guidance on the cron_health '
                'action text and it was measured and disproven here: concurrency was 1-2 against '
                'cron.max_running_jobs = 32. Do NOT change any job SCHEDULE to work around it '
                '(owner-only, and it fixes nothing), and do NOT unschedule a job while its run is '
                'in flight — that cancels the running statement. Do NOT resolve this alert because '
                'the scheduler looks quiet: quiet is UNKNOWN, not recovered.'));
end
$function$;

-- MUTATION PROOF. Each assertion below fails this migration if the verdict function stops
-- distinguishing the cases. The third is the regression that cost 75 hours of a stale search index:
-- frozen jobs present but the scheduler unconfirmable must ABSTAIN, never resolve.
do $proof$
begin
  if public.mon_cron_frozen_verdict(0, 17, true) <> 'resolve' then
    raise exception 'PROOF FAILED: no frozen jobs must resolve, got %',
      public.mon_cron_frozen_verdict(0, 17, true);
  end if;

  if public.mon_cron_frozen_verdict(0, 0, true) <> 'resolve' then
    raise exception 'PROOF FAILED: no frozen jobs resolves regardless of liveness, got %',
      public.mon_cron_frozen_verdict(0, 0, true);
  end if;

  -- THE REGRESSION ITSELF.
  if public.mon_cron_frozen_verdict(1, 0, true) <> 'abstain' then
    raise exception 'PROOF FAILED: frozen job + unconfirmable scheduler must ABSTAIN, got %',
      public.mon_cron_frozen_verdict(1, 0, true);
  end if;
  if public.mon_cron_frozen_verdict(3, 2, true) <> 'abstain' then
    raise exception 'PROOF FAILED: n_alive=2 is still unknown, must ABSTAIN, got %',
      public.mon_cron_frozen_verdict(3, 2, true);
  end if;

  if public.mon_cron_frozen_verdict(1, 3, true) <> 'raise_p0' then
    raise exception 'PROOF FAILED: frozen search-index writer with live scheduler must raise P0, got %',
      public.mon_cron_frozen_verdict(1, 3, true);
  end if;
  if public.mon_cron_frozen_verdict(1, 17, false) <> 'raise_p1' then
    raise exception 'PROOF FAILED: frozen non-critical job with live scheduler must raise P1, got %',
      public.mon_cron_frozen_verdict(1, 17, false);
  end if;

  -- And the property that matters most, stated as a property: NOTHING with a frozen job may resolve.
  if exists (
    select 1
      from generate_series(1, 5) f,
           generate_series(0, 20) a,
           unnest(array[true, false]) c
     where public.mon_cron_frozen_verdict(f, a, c) = 'resolve'
  ) then
    raise exception 'PROOF FAILED: a verdict of resolve is reachable while jobs are frozen';
  end if;
end
$proof$;
