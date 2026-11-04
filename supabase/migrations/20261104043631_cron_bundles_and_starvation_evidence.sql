-- Cron consolidation (owner, 2026-11-04: «do whatever u can to fix all problems» given in answer to
-- "may I combine the many small cron monitor/dispatch jobs into fewer jobs so the schedule fits?").
--
-- WHY. cron_minute_collision (P1, open since 2026-09-18) fires on any (hour, minute) that starts 3+
-- jobs. After the 2026-11-03 rebalance the busiest hour still started 146 jobs; with mon-p0-fast-lane
-- holding 24 minutes and :00 kept empty, at most 94 other starts fit at <= 2 per minute. Re-slotting
-- alone cannot reach that, so 33 small jobs (each p95 < 11 s) now run as steps of 4 BUNDLE jobs, and
-- 18 jobs move minute. Busiest hour after: 99 starts, no instant above 2, :00 empty, no plain hourly
-- job inside a >= 120 s hog window, no two single-writer jobs on one instant, every ordering contract
-- kept (35 resolve-english-city-overlay :54 -> :45, still >= 9 min after the :22 sync; 183
-- strip-shared-default-pins :15 -> :12, still >= 5 min before it). mon-p0-fast-lane is untouched.
--
-- HOW A BUNDLE STAYS HONEST.
--   * Each step is a literal `select public.<fn>(...)` IN THE CRON COMMAND, so every reader of
--     cron.job.command still sees it: mon_orphaned_detectors(), its AF-barrier list, the single-writer
--     scan in ops_cron_start_instants(), grep.
--   * ops_run_cron_bundle() runs each step in its OWN subtransaction. A failing step rolls back only
--     itself, is logged in ops_cron_bundle_step_run, and raises P1 cron_health
--     'cron_bundle_step_fail:<bundle>:<fn>' (resolved by that step's next success). A statement
--     timeout is NOT caught (query_canceled is outside WHEN OTHERS), so a slow bundle fails the whole
--     job loudly, exactly as cron_health / cron_timeout_headroom already watch.
--   * lock_timeout / statement_timeout are restored after every step, so one step's set_config(...,
--     true) (rebuild_age_producer sets lock_timeout 5s) cannot leak into the next.
--   * No single-writer function is bundled (they keep their own jobs and instants).
--
-- cron_starvation_risk. Its premise is "pg_cron does not start a job while another job's backend is
-- active". Measured 2026-11-04 over 7 days, the only flagged victim, mon-p0-fast-lane, started
-- 168/168 times at EVERY flagged minute (worst lag 0.07 s), 168 of them while
-- mon-detectors-and-dispatch was running at :01 and 167 while the sync was running at :24. The
-- detector now tells the two cases apart: a (victim, minute, hog) is cleared only when, since both
-- jobs' current schedules, the victim started ON TIME (< 60 s late) at that minute in at least
-- expected-1 hours AND did so at least 3 times while a run of that hog was in progress. A victim with
-- missing starts, or with no observed co-run (e.g. a brand-new job), is still raised. Cleared pairs
-- are reported in the alert detail as `proven_co_running` while any pair stays open.

do $pre$
begin
  if not exists (select 1 from cron.job where jobid = 86 and jobname = 'mon-p0-fast-lane'
                   and schedule = '1,4,7,10,13,15,18,21,24,26,28,31,34,35,38,40,42,44,46,48,51,54,57,58 * * * *') then
    raise exception 'anchor: mon-p0-fast-lane schedule moved; re-plan the hour before applying';
  end if;
end $pre$;

-- 1. step log ------------------------------------------------------------------------------------
create table if not exists public.ops_cron_bundle_step_run (
  id          bigserial primary key,
  bundle      text        not null,
  step_no     int         not null,
  step        text        not null,
  started_at  timestamptz not null,
  ms          numeric     not null,
  ok          boolean     not null,
  error       text
);
create index if not exists ops_cron_bundle_step_run_bundle_step_idx
  on public.ops_cron_bundle_step_run (bundle, step, started_at desc);
create index if not exists ops_cron_bundle_step_run_started_idx
  on public.ops_cron_bundle_step_run (started_at);
alter table public.ops_cron_bundle_step_run enable row level security;
revoke all on public.ops_cron_bundle_step_run from anon, authenticated;

-- 2. runner --------------------------------------------------------------------------------------
create or replace function public.ops_run_cron_bundle(p_bundle text, variadic p_steps text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  i int;
  v_step text;
  v_fn text;
  v_t0 timestamptz;
  v_ok boolean;
  v_err text;
  v_key text;
  v_lock text := current_setting('lock_timeout');
  v_stmt text := current_setting('statement_timeout');
  v_failed text[] := '{}';
begin
  if p_bundle is null or p_bundle !~ '^[a-z0-9-]+$' then
    raise exception 'ops_run_cron_bundle: bad bundle name %', p_bundle;
  end if;
  -- A malformed step is a configuration error: refuse the whole bundle, loudly, before running any.
  for i in 1 .. coalesce(array_length(p_steps, 1), 0) loop
    if p_steps[i] !~ '^select public\.[a-z0-9_]+\([^;]*\)$' then
      raise exception 'ops_run_cron_bundle(%): step % is not a single "select public.fn(...)" call: %',
        p_bundle, i, p_steps[i];
    end if;
  end loop;
  if coalesce(array_length(p_steps, 1), 0) = 0 then
    raise exception 'ops_run_cron_bundle(%): no steps', p_bundle;
  end if;

  for i in 1 .. array_length(p_steps, 1) loop
    v_step := p_steps[i];
    v_fn := substring(v_step from '^select public\.([a-z0-9_]+)\(');
    v_t0 := clock_timestamp();
    v_ok := true; v_err := null;
    begin
      execute v_step;
    exception when others then
      v_ok := false;
      get stacked diagnostics v_err = message_text;
    end;
    perform set_config('lock_timeout', v_lock, true);
    perform set_config('statement_timeout', v_stmt, true);

    insert into public.ops_cron_bundle_step_run (bundle, step_no, step, started_at, ms, ok, error)
    values (p_bundle, i, v_fn, v_t0,
            round((extract(epoch from clock_timestamp() - v_t0) * 1000)::numeric, 1), v_ok, v_err);

    v_key := 'cron_bundle_step_fail:' || p_bundle || ':' || v_fn;
    if v_ok then
      if exists (select 1 from public.alert_event
                  where kind = 'cron_health' and dedup_key = v_key and resolved_at is null) then
        perform public.mon_resolve_key('cron_health', v_key);
      end if;
    else
      v_failed := v_failed || v_fn;
      perform public.mon_raise('P1', 'cron_health', null, v_key,
        jsonb_build_object('bundle', p_bundle, 'step', v_fn, 'step_no', i, 'error', v_err,
          'why', 'This step runs inside a bundled cron job. Its failure was rolled back on its own and '
              || 'the other steps ran, so cron.job_run_details records the bundle as succeeded: this '
              || 'alert is the only place the failure shows.',
          'action', 'select * from ops_cron_bundle_step_run where bundle = ''' || p_bundle
              || ''' and step = ''' || v_fn || ''' order by started_at desc limit 5; then fix the step. '
              || 'It resolves on the step''s next success.'));
    end if;
  end loop;

  delete from public.ops_cron_bundle_step_run where started_at < now() - interval '14 days';

  return jsonb_build_object('bundle', p_bundle, 'steps', array_length(p_steps, 1), 'failed', to_jsonb(v_failed));
end $function$;
revoke all on function public.ops_run_cron_bundle(text, text[]) from public, anon, authenticated;

-- 3. retire the bundled jobs (fail closed if any jobid no longer carries the expected job) ----------
do $retire$
declare
  r record;
  v_expect jsonb := jsonb_build_object(
    '25','resolve-aqar-locations','41','resolve-dealapp-districts','54','resolve-dealapp-city',
    '174','mon-engineer-locked-out','141','run-remediation','182','gh-engineer-automerge',
    '144','alert-to-incident-bridge',
    '168','reactivate-recovered-dormant-platforms','55','resolve-small-platform-cities',
    '115','resolve-amlakalahsa-locations','57','resolve-raghdan-city','46','rebuild-age-producer',
    '142','mon-remediation-worker-stale','132','mon-alert-flapping','64','normal-filter-barrier',
    '33','novel-type-alarm','65','mon-pii-capture-sweep','71','mon-af-predicate-parity',
    '134','mon-cron-starvation-risk','40','wasalt-enrich-backlog-monitor','135','mon-sync-stale-snapshot',
    '43','mon-district-resolution','53','mon-watchdog-detector-job','76','mon-filter-parity-barrier',
    '206','mon-resolve-ended-scrape-blocks','140','mon-search-writer-starved',
    '87','liveness-coverage-snapshot','63','mon-aqar-ppm-as-total',
    '83','gh-alert-dispatch-backstop','84','gh-migration-drift-guard-backstop',
    '126','gh-enrollment-guard-backstop','162','gh-af-robot','188','gh-facts-words-nightly');
begin
  for r in select key::bigint as jobid, value #>> '{}' as jobname from jsonb_each(v_expect) loop
    if not exists (select 1 from cron.job j where j.jobid = r.jobid and j.jobname = r.jobname and j.active) then
      raise exception 'retire anchor: jobid % is no longer active job %', r.jobid, r.jobname;
    end if;
  end loop;
  for r in select key::bigint as jobid from jsonb_each(v_expect) loop
    perform cron.unschedule(r.jobid);
  end loop;
end $retire$;

-- 4. the four bundles ------------------------------------------------------------------------------
select cron.schedule('bundle-locations-10min', '1-59/10 * * * *', $cmd$set statement_timeout to '120s'; select public.ops_run_cron_bundle('bundle-locations-10min',
  $s$select public.resolve_aqar_locations()$s$,
  $s$select public.resolve_dealapp_districts()$s$,
  $s$select public.resolve_dealapp_city()$s$);$cmd$);

select cron.schedule('bundle-quarter-hour', '2-59/15 * * * *', $cmd$set statement_timeout to '240s'; select public.ops_run_cron_bundle('bundle-quarter-hour',
  $s$select public.mon_detect_engineer_locked_out()$s$,
  $s$select public.run_remediation()$s$,
  $s$select public.promote_aged_alerts_to_incidents()$s$,
  $s$select public.trigger_gh_workflow('engineer-automerge.yml')$s$);$cmd$);

select cron.schedule('bundle-hourly-resolvers', '12 * * * *', $cmd$set statement_timeout to '240s'; select public.ops_run_cron_bundle('bundle-hourly-resolvers',
  $s$select public.reactivate_recovered_dormant_platforms()$s$,
  $s$select public.resolve_small_platform_cities()$s$,
  $s$select public.resolve_amlakalahsa_locations()$s$,
  $s$select public.resolve_raghdan_city()$s$,
  $s$select public.rebuild_age_producer()$s$);$cmd$);

select cron.schedule('bundle-hourly-monitors', '43 * * * *', $cmd$set statement_timeout to '900s'; select public.ops_run_cron_bundle('bundle-hourly-monitors',
  $s$select public.mon_detect_remediation_worker_stale()$s$,
  $s$select public.mon_detect_alert_flapping()$s$,
  $s$select public.mon_check_normal_filter_barrier()$s$,
  $s$select public.detect_novel_property_types()$s$,
  $s$select public.mon_scan_pii_capture_batch(15000)$s$,
  $s$select public.mon_af_predicate_parity()$s$,
  $s$select public.mon_detect_cron_starvation_risk()$s$,
  $s$select public.mon_detect_wasalt_enrich_backlog()$s$,
  $s$select public.mon_detect_sync_ran_against_stale_snapshot()$s$,
  $s$select public.mon_detect_district_resolution()$s$,
  $s$select public.mon_watchdog_detector_job()$s$,
  $s$select public.mon_check_filter_parity_legacy()$s$,
  $s$select public.mon_resolve_ended_scrape_blocks()$s$,
  $s$select public.mon_detect_search_writer_starved()$s$,
  $s$select public.ops_liveness_snapshot_refresh()$s$,
  $s$select public.mon_detect_aqar_ppm_as_total()$s$,
  $s$select public.trigger_gh_workflow('alert-dispatch.yml')$s$,
  $s$select public.trigger_gh_workflow('migration-drift-guard.yml')$s$,
  $s$select public.trigger_gh_workflow('repair-enrollment-guard.yml')$s$,
  $s$select public.trigger_gh_workflow('af-robot.yml')$s$,
  $s$select public.trigger_gh_workflow('facts-words.yml')$s$);$cmd$);

-- 5. re-slots (fail closed on name AND old schedule) ------------------------------------------------
do $reslot$
declare
  r record;
begin
  for r in select * from (values
      (4::bigint,   'gh-wasalt-res',                '40 2 * * *',        '25 2 * * *'),
      (5,   'gh-wasalt-com',                        '45 2 * * *',        '27 2 * * *'),
      (16,  'refresh-location-index',               '15 * * * *',        '44 * * * *'),
      (24,  'crawl-stats-hourly',                   '50 * * * *',        '42 * * * *'),
      (29,  'location-selftest-hourly',             '52 * * * *',        '53 * * * *'),
      (35,  'resolve-english-city-overlay',         '54 * * * *',        '45 * * * *'),
      (49,  'gh-gathern-cleanup',                   '2 3 * * *',         '10 3 * * *'),
      (59,  'mon-price-magnitude-gate',             '35 6 * * *',        '17 6 * * *'),
      (69,  'mon-rich-attrs-barrier',               '52 6 * * *',        '33 6 * * *'),
      (75,  'sync-search-first-seen-at',            '7-59/10 * * * *',   '6-59/10 * * * *'),
      (106, 'mon-image-coverage-snapshot',          '35 3 * * *',        '37 3 * * *'),
      (139, 'refresh-loader-scale-stats',           '58 * * * *',        '39 * * * *'),
      (159, 'gh-new-listings-score',                '35 5 * * *',        '37 5 * * *'),
      (173, 'gh-haraj-sync',                        '5 1-23/2 * * *',    '3 1-23/2 * * *'),
      (183, 'strip-shared-default-pins',            '15 * * * *',        '12 * * * *'),
      (189, 'mon-text-facts',                       '52 11 * * *',       '50 11 * * *'),
      (198, 'text-facts-status-snapshot',           '40 10 * * *',       '50 10 * * *'),
      (203, 'title-district',                       '58 * * * *',        '43 * * * *')
    ) v(jobid, jobname, old_s, new_s)
  loop
    if not exists (select 1 from cron.job j where j.jobid = r.jobid and j.jobname = r.jobname
                     and j.schedule = r.old_s and j.active) then
      raise exception 'reslot anchor: jobid % (%) is not at %', r.jobid, r.jobname, r.old_s;
    end if;
    perform cron.alter_job(r.jobid, schedule := r.new_s);
  end loop;
end $reslot$;

-- 6. location_pipeline_monitor watches the bundle that now runs its two resolvers -------------------
do $lpm$
declare
  v_def text := pg_get_functiondef('public.location_pipeline_monitor'::regproc);
  v_old text := $o$j.jobname in ('refresh_listing_native_location_v1','resolve-aqar-locations','sync-search-listings-ar','resolve-dealapp-districts')$o$;
  v_new text := $n$j.jobname in ('refresh_listing_native_location_v1','bundle-locations-10min','sync-search-listings-ar')$n$;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'location_pipeline_monitor anchor not found exactly once';
  end if;
  execute replace(v_def, v_old, v_new);
end $lpm$;

-- 7. starvation: clear a pair only on measured co-running evidence --------------------------------
create or replace function public.mon_cron_victim_proven_alongside_hog(p_victim bigint, p_minute int, p_hog bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- TRUE only when the victim demonstrably starts at p_minute, on time, even while p_hog runs:
  --   on_time_starts >= expected_hours - 1   (attendance at that minute since both current schedules)
  --   co_running     >= 3                    (starts that fell inside a run of the hog)
  -- Anything less -- a missed start, no observed overlap, a job too new to judge -- is FALSE, and the
  -- starvation alarm keeps the pair.
  with since as (
    select greatest(now() - interval '7 days',
                    coalesce((select f.first_seen_at       from public.ops_cron_job_first_seen f where f.jobid = p_victim), now() - interval '7 days'),
                    coalesce((select f.schedule_changed_at from public.ops_cron_job_first_seen f where f.jobid = p_victim), now() - interval '7 days'),
                    coalesce((select f.schedule_changed_at from public.ops_cron_job_first_seen f where f.jobid = p_hog),    now() - interval '7 days')) as t
  ),
  v as (
    select d.start_time
      from cron.job_run_details d, since
     where d.jobid = p_victim
       and d.start_time >= since.t
       and extract(minute from d.start_time)::int = p_minute
       and d.start_time - date_trunc('minute', d.start_time) < interval '60 seconds'
  ),
  h as (
    select d.start_time, coalesce(d.end_time, now()) as end_time
      from cron.job_run_details d, since
     where d.jobid = p_hog
       and d.start_time >= since.t - interval '1 hour'
  ),
  stats as (
    select (select count(*) from v) as on_time,
           (select count(*) from v where exists (select 1 from h where h.start_time < v.start_time
                                                                  and h.end_time > v.start_time)) as co_run,
           (select floor(extract(epoch from now() - since.t) / 3600.0)::int from since) as expected
  )
  select co_run >= 3 and on_time >= expected - 1 from stats
$function$;

create or replace function public.mon_detect_cron_starvation_risk()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rows_starved jsonb;
  rows_proven  jsonb;
  n_starved    int;
  critical_hit boolean;
begin
  -- One evaluation of the evidence per pair, then every aggregate from that same set.
  with e as materialized (
    select s.*, public.mon_cron_victim_proven_alongside_hog(s.victim_jobid, s.victim_minute, s.hog_jobid) as proven
      from public.mon_cron_starved_schedules() s
  )
  select count(*) filter (where not e.proven),
         coalesce(jsonb_agg(jsonb_build_object(
           'victim', e.victim_jobname, 'victim_jobid', e.victim_jobid,
           'victim_minute', e.victim_minute,
           'blocked_by', e.hog_jobname, 'hog_jobid', e.hog_jobid,
           'hog_starts', e.hog_start, 'hog_p95_s', e.hog_p95_s, 'hog_max_s', e.hog_max_s)
           order by e.victim_jobname, e.victim_minute) filter (where not e.proven), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('victim', e.victim_jobname, 'victim_minute', e.victim_minute,
           'hog', e.hog_jobname) order by e.victim_jobname, e.victim_minute) filter (where e.proven), '[]'::jsonb),
         -- The served search index has exactly one writer. A starved writer is not a scheduling nit:
         -- it is users seeing no new listings and still seeing dead ones.
         coalesce(bool_or(not e.proven and e.victim_jobname in ('sync-search-listings-ar', 'refresh-listings',
                                            'sync-search-first-seen-at', 'refresh-location-index')), false)
    into n_starved, rows_starved, rows_proven, critical_hit
    from e;

  if n_starved = 0 then
    perform public.mon_resolve_key('cron_starvation_risk', 'cron_starvation_risk');
    return 0;
  end if;

  return public.mon_raise(
    case when critical_hit then 'P1' else 'P2' end,
    'cron_starvation_risk', 'all', 'cron_starvation_risk',
    jsonb_build_object(
      'starved', rows_starved,
      'starved_count', n_starved,
      'proven_co_running', rows_proven,
      'serving_impact', critical_hit,
      'why', 'These jobs are scheduled inside a window during which another job is expected (p95) '
             'to be holding the scheduler, and there is NO measured evidence that they start there '
             'anyway (on time in >= expected-1 hours at that minute and >= 3 starts during a run of '
             'that hog, since both current schedules). Measured 2026-09-18: sync-search-listings-ar at '
             ':36 inside mon-detectors-and-dispatch''s :29 window went 76 HOURS without running. '
             'Pairs with that evidence are listed in proven_co_running and do not raise.',
      'action', 'Move the victim to a minute outside every hog window (check the whole hour: '
                'sql/mirrors/cron_schedule.json + scripts/verify-cron-slot-discipline.ts), or reduce '
                'the hog''s runtime. Do NOT satisfy this by raising the 120s bar, narrowing the '
                'window, loosening the evidence rule or switching p95 back to a median.'));
end
$function$;

-- 8. cron_grace_tight compared a grace computed SINCE the schedule change (mon_cron_expected_gap
--    honours ops_cron_job_first_seen.schedule_changed_at) with a "recent cadence" taken from runs
--    BEFORE it. Measured 2026-11-04: jobid 36 gh-wasalt-enum-liveness went every-other-day -> daily at
--    00:06 (20261104000629); its grace fell back to 48 h (no post-change run yet) while its last six
--    runs still read 48 h apart, so 48 < 1.5 x 48 raised -- a false alarm whose shape the detector's
--    own text describes ("a learned median contaminated by a schedule change"). Both sides now read
--    the same window: a job is judged only on >= 3 runs under its CURRENT schedule. A job whose
--    grace is genuinely tight on its current cadence still raises.
do $grace$
declare
  v_def text := pg_get_functiondef('public.mon_detect_cron_grace_below_cadence'::regproc);
  v_old text := E'      from cron.job_run_details d\n       where d.status = ''succeeded''\n         and d.start_time > now() - interval ''7 days''\n    ), recent as (';
  v_new text := E'      from cron.job_run_details d\n      left join public.ops_cron_job_first_seen f on f.jobid = d.jobid\n       where d.status = ''succeeded''\n         and d.start_time > greatest(now() - interval ''7 days'',\n                                     coalesce(f.schedule_changed_at, ''-infinity''::timestamptz))\n    ), recent as (';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'mon_detect_cron_grace_below_cadence anchor not found exactly once';
  end if;
  execute replace(v_def, v_old, v_new);
end $grace$;
