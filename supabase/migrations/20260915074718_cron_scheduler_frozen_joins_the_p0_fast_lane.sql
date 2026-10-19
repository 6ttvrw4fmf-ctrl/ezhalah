-- Data Integrity (routine #3), 2026-09-15. Follow-up to 20260915074113, caught by CI on PR #2747.
--
-- mon_detect_cron_scheduler_frozen can raise P0 (when the dropped job is the one writing the served
-- search index), which makes it P0-CAPABLE — and every P0-capable detector must run on the fast
-- lane. `Every P0-capable detector is on the fast lane` went red on the PR, correctly:
-- ops_p0_detectors_off_fast_lane() enumerates P0-capable mon_detect_* from pg_proc and named it.
--
-- The guard is right and is NOT weakened here. A P0 raised only inside mon_run_all_detectors()
-- waits for the whole sweep to commit before dispatch can even see it — 241s average, 731s worst
-- over the 24h measured on 2026-09-05, against a 300s P0 delivery budget the owner set and forbade
-- widening. Being on the lane is the difference between a 15-26s page and a missed SLO. The lane is
-- exactly where a frozen-scheduler P0 belongs: the whole point of this detector is that the search
-- index stopped updating and nobody noticed for 10 hours.
--
-- COST, because the lane runs 24 times an hour under a 45s statement timeout. mon_cron_frozen_jobs()
-- measures 97ms / 6,728 shared buffers. The first draft called it TWICE — once for the payload and
-- again for the critical-job test — which is ~195ms and 13k buffers per tick for an answer that
-- cannot change between the two calls. It is now called ONCE and the critical test reads the
-- materialised rows. Same verdict, half the work, and no window in which the two calls could
-- disagree.

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
  select exists(select 1 from _frozen_now f
                 where f.jobname in ('sync-search-listings-ar', 'refresh-listings',
                                     'sync-search-first-seen-at', 'refresh-location-index'))
    into critical_hit;

  return public.mon_raise(
    case when critical_hit then 'P0' else 'P1' end,
    'cron_scheduler_frozen', 'all', 'cron_scheduler_frozen',
    jsonb_build_object(
      'frozen_jobs', rows_frozen,
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

-- Fast-lane roster entry, in the SAME migration. Guarded needle-edit, never a re-pasted body.
do $do$
declare
  src text; before_n int; after_n int;
  anchor text := '''mon_detect_deleted_but_source_live''';
  needle text := '''mon_detect_cron_scheduler_frozen'',
    ';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_p0_detectors';

  if src is null then raise exception 'mon_run_p0_detectors not found'; end if;
  if position('mon_detect_cron_scheduler_frozen' in src) > 0 then
    raise notice 'already on the fast lane'; return;
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor appears % times, expected exactly 1',
      (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;

  before_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  src := replace(src, anchor, needle || anchor);
  after_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');

  if after_n <> before_n + 1 then
    raise exception 'lane roster went % -> %, expected exactly +1', before_n, after_n;
  end if;
  execute src;
end
$do$;

-- ---------------------------------------------------------------------------------------------
-- PROOFS
-- ---------------------------------------------------------------------------------------------
DO $proof$
DECLARE off_lane int; v_raised int;
BEGIN
  -- 1. The invariant the CI check enforces, asserted here against the same RPC it calls.
  select count(*) into off_lane from public.ops_p0_detectors_off_fast_lane();
  IF off_lane <> 0 THEN
    RAISE EXCEPTION 'PROOF 1 FAILED: % P0-capable detector(s) still off the fast lane', off_lane;
  END IF;

  -- 2. The detector still works after the single-evaluation rewrite. It must not crash on the lane:
  --    mon_run_p0_detectors traps exceptions per detector, so a crash here would be SILENT.
  v_raised := public.mon_detect_cron_scheduler_frozen();
  RAISE NOTICE 'PROOF 2: detector executed cleanly on the lane, raised=%', v_raised;

  -- 3. It is genuinely reachable through the lane entrypoint, not merely listed in it.
  IF position('mon_detect_cron_scheduler_frozen'
              in pg_get_functiondef('public.mon_run_p0_detectors()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'PROOF 3 FAILED: detector is not in the lane roster body';
  END IF;

  RAISE NOTICE 'proofs complete';
END
$proof$;

select (select count(*) from public.ops_p0_detectors_off_fast_lane()) as off_lane_after,
       (public.mon_run_p0_detectors() -> 'crashed') as lane_crashed;