-- CONCURRENT-WRITE CONVERGENCE, 2026-09-18.
--
-- Two sessions independently found the same P0 root cause within 80 seconds of each other and both
-- shipped a fix: 20260918130443 (13:04:43) and 20260918130603 (13:06:03, mine). The second
-- create-or-replaced the first's mon_detect_cron_scheduler_frozen body, and — because the two
-- sessions chose different signatures for the lifted decision — left TWO overloads of
-- public.mon_cron_frozen_verdict alive at once: (int,int) mine and (int,int,boolean) theirs.
--
-- A public function with more than one overload is condition 4 of this repo's migration drift guard
-- and the exact shape of the 2026-07-16 PGRST203 search outage. It does not get to survive a shift.
--
-- Converging on 20260918130443, which landed first and is the better design: its verdict function
-- also decides P0 vs P1, so MORE of the decision is pure and mutation-provable, and its analysis
-- identified why the liveness window reads quiet (job 38 mon-detectors-and-dispatch ran a single
-- 10m41s statement during which pg_cron started nothing else). Nothing of mine is being preserved
-- here on the merits — the ONLY reason this migration exists is that my replace was second.
--
-- Restored verbatim from supabase_migrations.schema_migrations.statements for 20260918130443, so
-- production matches the definition that session will mirror to git.
--
-- What is NOT reverted: mon_detect_alert_flapping / mon_flapping_alert_keys and the
-- mon-alert-flapping cron job from 20260918130603. Those are additive and overlap nothing here:
-- the other session fixed THIS instance of a self-clearing alert; the flapping detector watches the
-- CLASS, and would have surfaced these 22 flaps on day one.

drop function if exists public.mon_cron_frozen_verdict(int, int);

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

-- Re-proof after the convergence: the restored detector must reach the 3-arg verdict, exactly one
-- overload of it may exist, and the regression that cost 75 hours must still ABSTAIN.
do $proof$
declare n_overloads int;
begin
  select count(*) into n_overloads
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_cron_frozen_verdict';
  if n_overloads <> 1 then
    raise exception 'CONVERGENCE FAILED: % overloads of mon_cron_frozen_verdict remain, expected 1',
      n_overloads;
  end if;

  if public.mon_cron_frozen_verdict(3, 2, true) <> 'abstain' then
    raise exception 'CONVERGENCE FAILED: the 75-hour regression is back — frozen jobs with an '
                    'unconfirmable scheduler must ABSTAIN, got %',
      public.mon_cron_frozen_verdict(3, 2, true);
  end if;
  if public.mon_cron_frozen_verdict(0, 17, true) <> 'resolve' then
    raise exception 'CONVERGENCE FAILED: a true all-clear must still resolve';
  end if;
  if public.mon_cron_frozen_verdict(1, 3, true) <> 'raise_p0' then
    raise exception 'CONVERGENCE FAILED: frozen search-index writer must still raise P0';
  end if;

  -- The flapping barrier from 20260918130603 must have survived this convergence.
  if to_regprocedure('public.mon_detect_alert_flapping()') is null
     or to_regprocedure('public.mon_flapping_alert_keys()') is null then
    raise exception 'CONVERGENCE FAILED: the alert-flapping class barrier was lost';
  end if;

  raise notice 'convergence proof passed: 1 verdict overload, abstain intact, flapping barrier intact';
end
$proof$;
