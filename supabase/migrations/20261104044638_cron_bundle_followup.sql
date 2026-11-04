-- Follow-up to 20261104043631, from watching its first hour.
--
-- 1. mon_detect_cron_starvation_risk took 57 s in its first bundled run (0.5 s before): it evaluated
--    the evidence pair by pair, and every pair re-scanned cron.job_run_details (260k rows, no index on
--    jobid we may create — the table belongs to supabase_admin). The detector now reads the 7-day runs
--    of the involved jobs ONCE and judges every pair from that set. Same rule, same thresholds:
--    on-time (< 60 s late) starts at the minute >= expected - 1 AND >= 3 of them during a hog run,
--    counted since the later of both jobs' schedule changes. The single-pair
--    mon_cron_victim_proven_alongside_hog() is kept for ad-hoc reads.
-- 2. A bundle step's alert key was <bundle>:<fn>, and bundle-hourly-monitors runs trigger_gh_workflow
--    five times: one dispatch failing and the next succeeding would resolve the failure's alert in the
--    same run. The key now carries the step number: cron_bundle_step_fail:<bundle>:<n>:<fn>.

create or replace function public.mon_cron_starved_schedules_with_evidence()
returns table(victim_jobid bigint, victim_jobname text, victim_minute int, hog_jobid bigint, hog_jobname text,
              hog_start int, hog_p95_s numeric, hog_max_s numeric, proven boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with s as materialized (
    select * from public.mon_cron_starved_schedules()
  ),
  runs as materialized (
    select d.jobid, d.start_time, coalesce(d.end_time, now()) as end_time
      from cron.job_run_details d
     where d.start_time >= now() - interval '7 days 1 hour'
       and d.jobid in (select x.victim_jobid from s x union select x.hog_jobid from s x)
  ),
  w as (
    select s.*,
           greatest(now() - interval '7 days',
                    coalesce(fv.first_seen_at,       now() - interval '7 days'),
                    coalesce(fv.schedule_changed_at, now() - interval '7 days'),
                    coalesce(fh.schedule_changed_at, now() - interval '7 days')) as t
      from s
      left join public.ops_cron_job_first_seen fv on fv.jobid = s.victim_jobid
      left join public.ops_cron_job_first_seen fh on fh.jobid = s.hog_jobid
  ),
  ev as (
    select w.*,
           (select count(*) from runs v
             where v.jobid = w.victim_jobid and v.start_time >= w.t
               and extract(minute from v.start_time)::int = w.victim_minute
               and v.start_time - date_trunc('minute', v.start_time) < interval '60 seconds') as on_time,
           (select count(*) from runs v
             where v.jobid = w.victim_jobid and v.start_time >= w.t
               and extract(minute from v.start_time)::int = w.victim_minute
               and v.start_time - date_trunc('minute', v.start_time) < interval '60 seconds'
               and exists (select 1 from runs h
                            where h.jobid = w.hog_jobid and h.start_time >= w.t - interval '1 hour'
                              and h.start_time < v.start_time and h.end_time > v.start_time)) as co_run,
           floor(extract(epoch from now() - w.t) / 3600.0)::int as expected
      from w
  )
  select victim_jobid, victim_jobname, victim_minute, hog_jobid, hog_jobname, hog_start, hog_p95_s, hog_max_s,
         (co_run >= 3 and on_time >= expected - 1) as proven
    from ev
$function$;

do $det$
declare
  v_def text := pg_get_functiondef('public.mon_detect_cron_starvation_risk'::regproc);
  v_old text := $o$    select s.*, public.mon_cron_victim_proven_alongside_hog(s.victim_jobid, s.victim_minute, s.hog_jobid) as proven
      from public.mon_cron_starved_schedules() s$o$;
  v_new text := $n$    select s.* from public.mon_cron_starved_schedules_with_evidence() s$n$;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'mon_detect_cron_starvation_risk anchor not found exactly once';
  end if;
  execute replace(v_def, v_old, v_new);
end $det$;

do $key$
declare
  v_def text := pg_get_functiondef('public.ops_run_cron_bundle(text, text[])'::regprocedure);
  v_old text := $o$v_key := 'cron_bundle_step_fail:' || p_bundle || ':' || v_fn;$o$;
  v_new text := $n$v_key := 'cron_bundle_step_fail:' || p_bundle || ':' || i || ':' || v_fn;$n$;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'ops_run_cron_bundle key anchor not found exactly once';
  end if;
  execute replace(v_def, v_old, v_new);
end $key$;
