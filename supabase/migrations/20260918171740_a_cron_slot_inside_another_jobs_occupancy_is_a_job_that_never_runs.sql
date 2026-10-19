-- WHY THIS EXISTS. On 2026-09-15 jobid 28 sync-search-listings-ar -- the ONLY writer of the served
-- search index -- stopped running for 76 HOURS. It did not fail. It was never started, left no run
-- row, and every count-based and failure-based check in the system stayed green throughout.
--
-- THE MECHANISM, measured not reasoned. pg_cron on this instance does not start a job while
-- another job's backend is active. Observed directly on 2026-09-18: at 13:39:39 nothing had started
-- since 13:29 while pg_stat_activity showed pid 914966, application_name=pg_cron, ACTIVE for 655s;
-- every job resumed at 13:40:18, the instant it freed. cron.max_running_jobs is 32 and
-- cron.use_background_workers is off, so the 32 is not what binds. The internal cause of the
-- serialization is NOT established and this migration deliberately claims none -- only the
-- OCCUPANCY is measured, and occupancy is all the detection needs.
--
-- jobid 38 mon-detectors-and-dispatch runs at :29 and :59, p95 683s over 336 runs in 7 days (max
-- 900s, its own statement_timeout). Its window therefore swallowed :36, where job 28 sat.
--
-- THE NATURAL EXPERIMENT, from this same day's run history:
--     job 38 14:29 ran 675.2s -> freed 14:40 -> job 28 at 14:36 DID NOT RUN
--     job 38 15:29 ran 216.4s -> freed 15:32 -> job 28 at 15:36 ran (111.6s)
--     job 38 16:29 ran 187.3s -> freed 16:32 -> job 28 at 16:36 ran (113.5s)
-- Same jobs, same schedules, same day. The only variable is whether the hog was still holding the
-- scheduler at :36.
--
-- THIS MIGRATION MOVES NO SCHEDULE. A cron schedule change is owner-only, and another session was
-- moving these very jobs while this was being written (20260918171507, applied 17:15:07, put
-- job 28 at :22 and job 40 at :03). Shuffling slots is also a losing game on its own: the hour is
-- saturated, and the reason this cost 76 hours was never that one slot was wrong -- it was that
-- NOTHING IN THE SYSTEM KNEW A SCHEDULE COULD BE STRUCTURALLY UNREACHABLE. That is what this adds.
--
-- MEASURED RESIDUAL AT APPLY TIME, recorded so it is not lost: job 28 now sits at :22, two minutes
-- after jobid 17 refresh_listing_native_location_v1 at :20, whose runtime is p50 64s but p95 265s
-- and max 404s -- 20 of its 168 runs in 7 days exceeded 120s. So the index writer is still expected
-- to be starved roughly one hour in eight. Smaller than before, not gone. The detector below is
-- what will say so out loud instead of leaving it to be rediscovered in three days.

-- 1 ------------------------------------------------- the decision, pure and therefore executable
create or replace function public.mon_minute_in_window(p_victim int, p_hog_start int, p_hog_secs numeric)
returns boolean
language sql
immutable
as $function$
  -- Does minute p_victim fall inside the window a job starting at p_hog_start holds for p_hog_secs?
  -- k = 0 is included on purpose: two DIFFERENT jobs on the same minute is the worst collision of
  -- all, not an exempt one. Arithmetic is modulo 60 so a window crossing the top of the hour
  -- (:59 + 11min -> :10) is handled rather than silently missed.
  select exists (
    select 1 from generate_series(0, ceil(coalesce(p_hog_secs,0) / 60.0)::int) k
     where (p_hog_start + k) % 60 = p_victim
  )
$function$;

comment on function public.mon_minute_in_window(int, int, numeric) is
  'Pure: is a cron minute inside another job''s occupancy window? Modulo-60 so top-of-hour wraps. Same-minute counts as a collision. Lifted out so the truth table is executed, not trusted.';

-- 2 --------------------------------------------------------------------- measured hog occupancy
create or replace function public.mon_cron_hog_windows()
returns table(hog_jobid bigint, hog_jobname text, start_minute int, p95_s numeric, max_s numeric)
language sql
stable
set search_path to 'public'
as $function$
  -- A hog is any active job that can hold the scheduler long enough to swallow a neighbouring
  -- slot. The window uses p95, not max: max here is usually just the job's statement_timeout and
  -- would paint half the hour red. p95 is what actually recurs. max is reported alongside so a
  -- reader can see the tail they are accepting.
  with occ as (
    select d.jobid,
           percentile_cont(0.95) within group (order by extract(epoch from (d.end_time - d.start_time))) as p95,
           max(extract(epoch from (d.end_time - d.start_time))) as mx
      from cron.job_run_details d
     where d.end_time is not null
       and d.start_time > now() - interval '7 days'
     group by d.jobid
    having percentile_cont(0.95) within group (order by extract(epoch from (d.end_time - d.start_time))) >= 120
  ),
  -- Only plain "<m> * * * *" / "<m1>,<m2> * * * *" schedules are parsed. Anything more exotic is
  -- left alone rather than guessed at: a wrong parse here is a false accusation, and this repo has
  -- been burned by confident wrong verdicts more than by missing ones.
  starts as (
    select j.jobid, j.jobname, trim(m)::int as start_minute
      from cron.job j
      cross join lateral unnest(string_to_array(split_part(j.schedule, ' ', 1), ',')) as m
     where j.active
       and j.schedule ~ '^[0-9]+(,[0-9]+)* \* \* \* \*$'
  )
  select s.jobid, s.jobname, s.start_minute, round(o.p95::numeric, 0), round(o.mx::numeric, 0)
    from starts s join occ o on o.jobid = s.jobid
$function$;

comment on function public.mon_cron_hog_windows() is
  'Active jobs whose p95 runtime (7d) is >= 120s, with each scheduled start minute. These can hold the scheduler across a neighbour''s slot.';

-- 3 ------------------------------------------------------------------ victims, by execution
create or replace function public.mon_cron_starved_schedules()
returns table(victim_jobid bigint, victim_jobname text, victim_minute int,
              hog_jobid bigint, hog_jobname text, hog_start int, hog_p95_s numeric, hog_max_s numeric)
language sql
stable
set search_path to 'public'
as $function$
  with victims as (
    select j.jobid, j.jobname, trim(m)::int as minute
      from cron.job j
      cross join lateral unnest(string_to_array(split_part(j.schedule, ' ', 1), ',')) as m
     where j.active
       and j.schedule ~ '^[0-9]+(,[0-9]+)* \* \* \* \*$'
  )
  select distinct v.jobid, v.jobname, v.minute,
         h.hog_jobid, h.hog_jobname, h.start_minute, h.p95_s, h.max_s
    from victims v
    join public.mon_cron_hog_windows() h
      on v.jobid <> h.hog_jobid
     and public.mon_minute_in_window(v.minute, h.start_minute, h.p95_s)
$function$;

comment on function public.mon_cron_starved_schedules() is
  'Jobs scheduled inside another job''s p95 occupancy window. Such a job does not fail -- it silently never starts and leaves no row, so every count-based check stays green. This hid a 76h search-index outage (2026-09-15 -> 2026-09-18).';

-- 4 ------------------------------------------------------------------------------ the detector
create or replace function public.mon_detect_cron_starvation_risk()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rows_starved jsonb;
  n_starved    int;
  critical_hit boolean;
begin
  select count(*),
         coalesce(jsonb_agg(jsonb_build_object(
           'victim', s.victim_jobname, 'victim_jobid', s.victim_jobid,
           'victim_minute', s.victim_minute,
           'blocked_by', s.hog_jobname, 'hog_jobid', s.hog_jobid,
           'hog_starts', s.hog_start, 'hog_p95_s', s.hog_p95_s, 'hog_max_s', s.hog_max_s)
           order by s.victim_jobname), '[]'::jsonb)
    into n_starved, rows_starved
    from public.mon_cron_starved_schedules() s;

  if n_starved = 0 then
    perform public.mon_resolve_key('cron_starvation_risk', 'cron_starvation_risk');
    return 0;
  end if;

  -- The served search index has exactly one writer. A starved writer is not a scheduling nit: it
  -- is users seeing no new listings and still seeing dead ones.
  select exists(select 1 from public.mon_cron_starved_schedules() s
                 where s.victim_jobname in ('sync-search-listings-ar', 'refresh-listings',
                                            'sync-search-first-seen-at', 'refresh-location-index'))
    into critical_hit;

  return public.mon_raise(
    case when critical_hit then 'P1' else 'P2' end,
    'cron_starvation_risk', 'all', 'cron_starvation_risk',
    jsonb_build_object(
      'starved', rows_starved,
      'starved_count', n_starved,
      'serving_impact', critical_hit,
      'why', 'These jobs are scheduled inside a window during which another job is expected (p95) '
             'to be holding the scheduler. pg_cron here does not start a job while another job''s '
             'backend is active, so a job in this position does not fail -- it silently never '
             'starts, leaves no run row, and every count-based and failure-based check stays '
             'green. Measured 2026-09-18: sync-search-listings-ar at :36 sat inside '
             'mon-detectors-and-dispatch''s :29 window (p95 683s) and went 76 HOURS without '
             'running, while no listing became searchable and listings the source had dropped kept '
             'being served to users.',
      'action', 'Move the victim to a minute outside every hog window -- a cron schedule change is '
                'OWNER-ONLY, so ask, and check the whole hour first because this instance''s hour '
                'is close to saturated. The other half is reducing the hog''s runtime, which '
                'belongs to whoever owns that job. Do NOT satisfy this by raising the 120s bar, '
                'narrowing the window or switching p95 back to a median: the victim would still '
                'never run and the only thing that changed would be that nobody is told.'));
end
$function$;

-- Roster: a detector nothing runs is decoration. Its own job at :44 -- outside both of job 38's
-- p95 windows, which is the point, and it is itself covered by the detector it registers.
select cron.schedule('mon-cron-starvation-risk', '44 * * * *',
                     $j$ set statement_timeout to '30s'; select public.mon_detect_cron_starvation_risk(); $j$);

-- 5 -------------------------------------------------------------- APPLY-TIME SELF-TESTS
do $tests$
declare n_hogs int; n_now int; found_hist boolean;
begin
  -- T1-T6: the truth table, EXECUTED against the pure decision.
  -- T1 is THE OUTAGE: :36 inside mon-detectors-and-dispatch starting :29 with p95 683s.
  if not public.mon_minute_in_window(36, 29, 683) then
    raise exception 'T1 failed: the predicate does not reproduce the 76-hour outage (:36 inside :29+683s)';
  end if;
  -- T2 is TODAY''S RESIDUAL: :22 inside refresh_listing_native_location_v1 starting :20, p95 265s.
  if not public.mon_minute_in_window(22, 20, 265) then
    raise exception 'T2 failed: the predicate does not see the current :22 vs :20 collision';
  end if;
  -- T3 a minute BEFORE the hog is not starved.
  if public.mon_minute_in_window(28, 29, 683) then
    raise exception 'T3 failed: :28 is before the :29 hog and must not be flagged';
  end if;
  -- T4 a minute well clear of the window is not starved.
  if public.mon_minute_in_window(45, 29, 683) then
    raise exception 'T4 failed: :45 is outside :29+683s and must not be flagged';
  end if;
  -- T5 WRAPAROUND: :59 + 683s reaches :10. A naive start+span comparison misses this entirely.
  if not public.mon_minute_in_window(5, 59, 683) then
    raise exception 'T5 failed: the window must wrap past the top of the hour';
  end if;
  -- T6 SAME MINUTE is the worst collision, not an exempt one.
  if not public.mon_minute_in_window(20, 20, 404) then
    raise exception 'T6 failed: a different job on the same minute must count as a collision';
  end if;

  -- T7: the predicate must be able to fire at all against real production. A detector that
  -- matches nothing anywhere is indistinguishable from a broken one.
  select count(*) into n_hogs from public.mon_cron_hog_windows();
  if n_hogs = 0 then
    raise exception 'T7 failed: no hog measured in production -- the detector cannot fire';
  end if;

  -- T8: THE KNOWN-INCIDENT CASE MUST MATCH IN LIVE DATA, not just in the truth table. jobid 38
  -- must still be measured as a hog whose window would have covered the old :36 slot. If this
  -- stops holding, the stated cause of the outage is no longer reproducible and someone must know.
  select exists(select 1 from public.mon_cron_hog_windows()
                 where hog_jobid = 38 and start_minute = 29
                   and public.mon_minute_in_window(36, 29, p95_s))
    into found_hist;
  if not found_hist then
    raise exception 'T8 failed: jobid 38 at :29 no longer measures as a hog covering :36 -- '
                    're-derive this detector against current occupancy before trusting it';
  end if;

  select count(*) into n_now from public.mon_cron_starved_schedules();
  raise notice 'self-tests T1-T8 passed (% hogs measured, % starved slots found right now)',
    n_hogs, n_now;
end
$tests$;
