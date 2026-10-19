-- Data Integrity (routine #3), 2026-09-15. A NEW failure class, found in production this morning.
--
-- WHAT HAPPENED. pg_cron kept running, minute after minute, on a STALE in-memory job list. Three
-- hourly jobs vanished from the schedule at 2026-09-14 21:36-22:08 and never ran again:
--   28  sync-search-listings-ar        (:36) -- the ONLY writer of the served search index
--   40  wasalt-enrich-backlog-monitor  (:37)
--   109 refresh-district-display-canon (:08)
-- Every other job ran normally the whole time, so nothing looked broken. A job created FRESH at
-- 07:29 with a '30 seconds' schedule also never fired, which is what identified the cause: the
-- scheduler was not re-reading cron.job at all. `select pg_reload_conf();` fixed it instantly — the
-- new job fired within seconds and jobs 28 and 40 resumed on their own at :36 and :37.
--
-- THE COST. The search index had not synced for 10 hours. New listings scraped at 04:22-04:24 could
-- not reach users, and 23 source-inactive rows stayed searchable and kept inflating every count
-- surface (5 inactive_still_searchable + 5 inactive_still_counted P1 alerts, all of which resolved
-- by themselves once the sync ran: amlakalahsa 264 -> 256 = its 256 active rows, arkaan 1655 = 1408
-- + 247).
--
-- WHY THE EXISTING COVERAGE DID NOT PREVENT IT. cron_health SAW it — `cron_overdue:28` was raised at
-- 2026-09-14 23:59, two hours in, and `cron_absent:28` an hour before that. It raised them as **P2**,
-- next to ordinary attendance noise (mon-search-latency-sample at 83.7%), and its `action` text sends
-- the reader to "check top-of-hour contention against max_worker_processes". That was measured and
-- disproven here: concurrency was 1-2 against cron.max_running_jobs = 32. So the one alert that was
-- right about the WHAT pointed away from the WHY, and its severity did not match the blast radius.
--
-- WHAT THIS DETECTOR ADDS. Not another attendance percentage: a statement about the SHAPE of this
-- failure. A job that has a long, regular history, that is frequent, and that has now missed several
-- consecutive periods WHILE THE SCHEDULER IS DEMONSTRABLY ALIVE, is not flaky — it has been dropped.
-- The liveness half is what makes it specific: it stays silent when cron is simply down (a different
-- condition, with different remedies) and when a job is merely a little late.
--
-- A NOTE ON THE THRESHOLD, because it nearly shipped broken. The first draft used
-- `median_interval <= 3600` to mean "hourly or faster". Every hourly job here measures
-- 3600.000218 seconds, so that predicate matched NOTHING — it would have been a detector that could
-- never fire, over an incident that had just happened. The bound is 5400 and the proofs below
-- assert, with the real recorded interval, that an hourly job is inside it.

create or replace function public.mon_cron_frozen_jobs()
 returns table(jobid bigint, jobname text, median_interval_s double precision,
               runs_observed bigint, last_start timestamptz, overdue_factor numeric)
 language sql
 stable
 set search_path to 'public'
as $fn$
  with hist as (
    select d.jobid, d.start_time,
           lag(d.start_time) over (partition by d.jobid order by d.start_time) as prev
      from cron.job_run_details d
     where d.start_time > now() - interval '7 days'
  ), iv as (
    select h.jobid,
           percentile_cont(0.5) within group (order by extract(epoch from (h.start_time - h.prev)))
             as med_s,
           count(*) as n
      from hist h
     where h.prev is not null
     group by h.jobid
  ), last_run as (
    select d.jobid, max(d.start_time) as last_start
      from cron.job_run_details d
     group by d.jobid
  )
  select j.jobid, j.jobname, iv.med_s, iv.n, lr.last_start,
         round((extract(epoch from (now() - lr.last_start)) / nullif(iv.med_s, 0))::numeric, 1)
    from cron.job j
    join iv on iv.jobid = j.jobid
    join last_run lr on lr.jobid = j.jobid
   where j.active
     -- Frequent enough to judge. 5400s covers hourly jobs, which measure just OVER 3600.
     and iv.med_s <= 5400
     -- A long, regular history: this job is not new and not sporadic.
     and iv.n >= 10
     -- Several consecutive periods missed, not merely late.
     and lr.last_start < now() - ((iv.med_s * 4) || ' seconds')::interval
$fn$;

comment on function public.mon_cron_frozen_jobs() is
  'Rows = active pg_cron jobs with a long regular sub-90-minute cadence that have now missed 4+ '
  'consecutive periods. Shared by the detector and its proofs so there is ONE predicate.';

create or replace function public.mon_detect_cron_scheduler_frozen()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  frozen jsonb;
  n_frozen int;
  n_alive int;
  critical_hit boolean;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'jobid', f.jobid, 'job', f.jobname,
           'median_interval_s', round(f.median_interval_s::numeric, 1),
           'last_start', f.last_start,
           'periods_missed', f.overdue_factor) order by f.overdue_factor desc), '[]'::jsonb),
         count(*)
    into frozen, n_frozen
    from public.mon_cron_frozen_jobs() f;

  if n_frozen = 0 then
    perform public.mon_resolve_key('cron_scheduler_frozen', 'cron_scheduler_frozen');
    return 0;
  end if;

  -- THE LIVENESS HALF. If cron itself is down, this is a different condition with different
  -- remedies, and saying "the scheduler is frozen" would be wrong. Require proof it is running.
  select count(distinct d.jobid) into n_alive
    from cron.job_run_details d
   where d.start_time > now() - interval '10 minutes';

  if n_alive < 3 then
    perform public.mon_resolve_key('cron_scheduler_frozen', 'cron_scheduler_frozen');
    return 0;
  end if;

  -- The served search index has exactly one writer. If that is the job that got dropped, users stop
  -- seeing new listings and keep seeing dead ones, so this is not a P1.
  select exists(select 1 from public.mon_cron_frozen_jobs() f
                 where f.jobname in ('sync-search-listings-ar', 'refresh-listings',
                                     'sync-search-first-seen-at', 'refresh-location-index'))
    into critical_hit;

  return public.mon_raise(
    case when critical_hit then 'P0' else 'P1' end,
    'cron_scheduler_frozen', 'all', 'cron_scheduler_frozen',
    jsonb_build_object(
      'frozen_jobs', frozen,
      'frozen_count', n_frozen,
      'other_jobs_running_last_10min', n_alive,
      'serving_impact', critical_hit,
      'why', 'These jobs have a long, regular, frequent history and have each missed 4+ consecutive '
             'periods, WHILE ' || n_alive || ' other jobs ran in the last 10 minutes. A job that is '
             'merely flaky does not go silent for hours while the scheduler keeps working: pg_cron '
             'is running a STALE in-memory copy of cron.job and no longer sees these entries. '
             'Observed in production on 2026-09-15: jobs 28/40/109 were dropped at 21:36-22:08 the '
             'night before and a job created fresh at 07:29 also never fired.',
      'remedy', 'Run `select pg_reload_conf();`. That is a SIGHUP, not a restart — no disconnects — '
                'and it makes pg_cron re-read cron.job. On 2026-09-15 the newly created job fired '
                'within seconds of it and jobs 28 and 40 resumed on their own at the next :36/:37. '
                'Then confirm each named job actually ran, and re-run the sync-dependent detectors '
                '(inactive_still_searchable, inactive_still_counted) which clear themselves once '
                'the index syncs.',
      'do_not', 'Do NOT treat this as contention. That was the standing guidance on the cron_health '
                'action text and it was measured and disproven here: concurrency was 1-2 against '
                'cron.max_running_jobs = 32. Do NOT change any job SCHEDULE to work around it '
                '(owner-only, and it fixes nothing), and do NOT unschedule a job while its run is '
                'in flight — that cancels the running statement.'));
end
$function$;

comment on function public.mon_detect_cron_scheduler_frozen() is
  'P0/P1. pg_cron running a stale in-memory job list: frequent jobs with a long regular history go '
  'silent for 4+ periods while other jobs keep running. P0 when the dropped job writes the served '
  'search index. Remedy is pg_reload_conf(). Added after the 2026-09-15 incident, in which the '
  'search index went 10 hours without a sync and the only alert that saw it was a P2 whose action '
  'text pointed at contention that was not happening.';

-- Roster entry in the SAME migration. Guarded needle-edit, never a re-pasted body.
do $do$
declare
  src text; before_n int; after_n int;
  anchor text := '''mon_detect_orphaned_detectors''';
  needle text := ', ''mon_detect_cron_scheduler_frozen''';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('mon_detect_cron_scheduler_frozen' in src) > 0 then
    raise notice 'already wired'; return;
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor appears % times, expected 1',
      (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;

  before_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  src := replace(src, anchor, anchor || needle);
  after_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');

  if after_n <> before_n + 1 then
    raise exception 'roster went % -> %, expected +1', before_n, after_n;
  end if;
  execute src;
end
$do$;

-- ---------------------------------------------------------------------------------------------
-- PROOFS. The threshold bug above is the reason these assert against REAL recorded numbers rather
-- than against the predicate's own reasoning.
-- ---------------------------------------------------------------------------------------------
DO $proof$
DECLARE
  hourly_med double precision;
  v_in_band boolean;
  v_alive int;
BEGIN
  -- 1. THE BUG THAT NEARLY SHIPPED. An hourly job's measured median must be inside the band.
  --    Measured 2026-09-15: 3600.000218 for job 109. A `<= 3600` bound excludes it.
  select percentile_cont(0.5) within group (order by extract(epoch from (start_time - prev)))
    into hourly_med
  from (select start_time, lag(start_time) over (order by start_time) prev
          from cron.job_run_details where jobid = 109
           and start_time > now() - interval '7 days') t
  where prev is not null;

  IF hourly_med IS NULL THEN
    RAISE EXCEPTION 'PROOF 1 INCONCLUSIVE: no interval history for the hourly reference job';
  END IF;
  v_in_band := hourly_med <= 5400;
  IF NOT v_in_band THEN
    RAISE EXCEPTION 'PROOF 1 FAILED: hourly median % is outside the 5400s band', hourly_med;
  END IF;
  IF hourly_med <= 3600 THEN
    RAISE NOTICE 'note: hourly median % is <= 3600 on this instance; the band is still correct', hourly_med;
  ELSE
    RAISE NOTICE 'PROOF 1: hourly median is % (> 3600) — the original bound really would have matched nothing', hourly_med;
  END IF;

  -- 2. THE LIVENESS HALF must be satisfiable right now, or the detector can never raise at all.
  select count(distinct jobid) into v_alive
    from cron.job_run_details where start_time > now() - interval '10 minutes';
  IF v_alive < 3 THEN
    RAISE NOTICE 'PROOF 2: only % distinct jobs ran in 10 min — detector correctly stays silent', v_alive;
  ELSE
    RAISE NOTICE 'PROOF 2: cron is demonstrably alive (% jobs in 10 min)', v_alive;
  END IF;

  RAISE NOTICE 'proofs complete';
END
$proof$;

select public.mon_detect_cron_scheduler_frozen() as raised_now,
       (select count(*) from public.mon_cron_frozen_jobs()) as frozen_now,
       (position('mon_detect_cron_scheduler_frozen'
                 in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) > 0) as in_roster;