-- Fail fast instead of queueing behind the detector sweep. ops_cron_job_first_seen is upserted by
-- mon_detect_cron_health itself (jobid 38 at :29/:59, and the P0 fast lane most other minutes), so a
-- bare ALTER TABLE here waits on that sweep's lock -- which is how the first attempt at this
-- migration timed out at 23:30 rather than failing. A refused migration is recoverable; a migration
-- holding a lock queue behind it is not.
set local lock_timeout = '5s';

-- THE CLAIM THAT WAS FALSE. 20260822144338 replaced mon_detect_cron_health's regex-derived overdue
-- grace with an OBSERVED one -- the median gap between a job's own successful runs over the last 7
-- days, doubled -- and justified it in one sentence:
--
--     "Observed cadence cannot drift out of sync with the schedule, because it IS the schedule's
--      observed effect."
--
-- That is true in steady state and FALSE for seven days after any schedule change. The 7-day window
-- spans the change, so the median mixes the old cadence with the new one. When a schedule is
-- LOOSENED the mixed median comes out BELOW the job's real period -- and a grace smaller than the
-- period means the job is "overdue" every single day, between its real due time and its next run.
-- The alert then self-resolves when the job fires, so it FLAPS rather than standing still, and
-- mon_detect_alert_flapping is explicit that a self-clearing alert is worse than none: the dashboard
-- reads clean between flaps and every re-raise resets created_at, so the age never grows.
--
-- MEASURED 2026-09-23 23:2xZ against the live roster. Three wasalt jobs were loosened on 2026-09-18
-- (the cron_minute_collision / cron_starvation_risk window) and every one of them had a grace at or
-- below its own cadence:
--
--   jobid  job                  schedule       real cadence   learned grace   flaps since 09-19
--   -----  -------------------  -------------  ------------   -------------   -----------------
--   4      gh-wasalt-res        40 2 * * *     24h            18h             5 raises / 4 resolves
--   5      gh-wasalt-com        45 2 * * *     24h            18h             5 raises / 4 resolves
--   39     gh-wasalt-enrich-ar  15 */12 * * *  12h            12h             9 raises / 9 resolves
--
-- jobid 4's series shows the mechanism exactly: 00:40/08:40/16:40 daily through 2026-09-18 16:40,
-- then 02:40 once a day from 2026-09-19. Gaps in the 7-day window: 8,8,8,8,8,10,24,24,24,24 ->
-- median 9h -> grace 18h. Every one of those runs SUCCEEDED. Nothing was wrong with the job.
--
-- Both P2 cron_health alerts open at the time this was written (cron_overdue:4, cron_overdue:5) were
-- this, and a P0 alert_queue_unworked was open saying the alert queue is not being worked. A monitor
-- that cries wolf daily on three healthy jobs is how a queue becomes unworkable.
--
-- THE FIX, in the shape this table already uses. mon_detect_cron_health's own upsert comment says a
-- reused jobid carrying a DIFFERENT jobname "is a new job: restart its clock rather than inheriting
-- the dead job's age, which would make it raise immediately and wrongly." A schedule change is the
-- same event for the GAP clock, and that sentence applies to it verbatim. So: track the schedule
-- alongside the jobname, stamp schedule_changed_at when it actually changes, and learn the cadence
-- only from runs after that stamp. Fewer than 5 post-change gaps falls back to the regex bucket --
-- the identical, already-reviewed path a brand-new job takes, which is conservative (wider), never
-- narrower.
--
-- NOT A WEAKENING. The grace can only move UP for a loosened job, and for a TIGHTENED schedule the
-- reset makes it move DOWN faster than waiting 7 days for the old slow gaps to age out. No job's
-- grace becomes wider than the regex fallback it had before 20260822144338.
--
-- BACKFILL IS DELIBERATELY SILENT. The first sweep after this migration populates `schedule` for
-- every job and leaves schedule_changed_at NULL, so no job's learned cadence is discarded and
-- nothing changes for anyone. Only a genuine later change stamps it.

alter table public.ops_cron_job_first_seen
  add column if not exists schedule text,
  add column if not exists schedule_changed_at timestamptz;

comment on column public.ops_cron_job_first_seen.schedule is
  'The cron schedule last OBSERVED for this jobid. Compared on every sweep so a change can be dated.';
comment on column public.ops_cron_job_first_seen.schedule_changed_at is
  'When the schedule was observed to CHANGE (never stamped on first population). mon_cron_expected_gap() learns the cadence only from successful runs after this instant, because gaps from the old schedule describe a cadence the job no longer has.';

-- The arithmetic, lifted out of the gathering so a barrier can EXECUTE it against a real gap series
-- instead of reading the function's text. Identical to what 20260822144338 shipped inline:
-- >= 5 usable gaps -> max(median*2, 20 min); otherwise the caller's fallback.
create or replace function public.mon_cron_gap_from_series(p_gaps numeric[], p_fallback_h int)
 returns interval
 language sql
 immutable
 set search_path to 'public'
as $function$
  with g as (select unnest(coalesce(p_gaps, '{}'::numeric[])) as gap_s),
  m as (
    select (percentile_cont(0.5) within group (order by gap_s))::numeric as med_s,
           count(*) as n
      from g
     where gap_s is not null and gap_s > 0
  )
  select case
           when m.n >= 5 and m.med_s is not null
             then make_interval(secs => greatest(m.med_s * 2, 1200)::double precision)
           else make_interval(hours => p_fallback_h)
         end
    from m;
$function$;

create or replace function public.mon_cron_expected_gap(p_jobid bigint, p_fallback_h int)
 returns interval
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with g as (
    select extract(epoch from (d.start_time
             - lag(d.start_time) over (order by d.start_time)))::numeric as gap_s
      from cron.job_run_details d
     where d.jobid = p_jobid
       and d.status = 'succeeded'
       and d.start_time > greatest(
             now() - interval '7 days',
             coalesce((select s.schedule_changed_at
                         from public.ops_cron_job_first_seen s
                        where s.jobid = p_jobid), '-infinity'::timestamptz))
  )
  select public.mon_cron_gap_from_series(array_agg(g.gap_s), p_fallback_h) from g;
$function$;

-- EVIDENCE-BACKED REPAIR of the three jobs already contaminated. Their schedules changed before the
-- column existed, so no sweep could have dated it; without this they keep crying wolf until the old
-- gaps age out of the 7-day window (~2026-09-25). Each stamp sits between the LAST run of the old
-- cadence and the FIRST run of the new one, read from cron.job_run_details:
--
--   jobid 4  last 8-hourly 2026-09-18 16:40    first daily     2026-09-19 02:40
--   jobid 5  last 8-hourly 2026-09-18 16:45    first daily     2026-09-19 02:45
--   jobid 39 last 4-hourly 2026-09-18 16:15    first 12-hourly 2026-09-19 00:15
--
-- Narrow (three named jobids), idempotent (only stamps a NULL), and reversible with one UPDATE.
update public.ops_cron_job_first_seen s
   set schedule            = j.schedule,
       schedule_changed_at = timestamptz '2026-09-18 20:00:00+00'
  from cron.job j
 where j.jobid = s.jobid
   and s.jobid in (4, 5, 39)
   and s.schedule_changed_at is null;

-- A SECOND, DISTINCT ZERO-MARGIN CASE, found by the same measurement and fixed here because it is
-- the same sentence in 20260822144338 ("everything else -> 48h") failing on a form it never named.
-- jobid 36 (gh-wasalt-enum-liveness, '0 21 */2 * *') runs every 48h and had a 48h grace -- not from
-- a contaminated median but from the regex DEFAULT, because no branch recognises a step in the
-- day-of-month field. Grace equal to cadence has no margin at all: any jitter raises. The wasalt
-- enumeration liveness job is precisely the one LISTING_LIVENESS 9 says must be watched for
-- EXPECTED-BUT-ABSENT runs on its own cadence, so a grace it trips on a healthy run is the worst
-- place for this to sit. '*/N' in the day-of-month field -> 24*N hours, doubled like every other
-- branch.
create or replace function public.mon_detect_cron_health()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  rec record;
  n int := 0;
  overdue_h int;
  v_grace interval;
begin
  -- Record when each active job was first OBSERVED. pg_cron has no creation timestamp, so this
  -- is what makes the "never fired yet" exemption in LIMB 3 boundable instead of permanent.
  -- A reused jobid carrying a DIFFERENT jobname is a new job: restart its clock rather than
  -- inheriting the dead job's age, which would make it raise immediately and wrongly.
  --
  -- The SCHEDULE is tracked here for the same reason and dated the same way (2026-09-23): gaps
  -- observed under the old schedule describe a cadence the job no longer has, and feeding them to
  -- mon_cron_expected_gap() produced a grace BELOW the job's own period on three live jobs. First
  -- population leaves schedule_changed_at NULL on purpose -- backfilling a stamp would discard
  -- every job's learned cadence at once.
  insert into public.ops_cron_job_first_seen (jobid, jobname, schedule)
  select j.jobid, j.jobname, j.schedule from cron.job j where j.active
  on conflict (jobid) do update
    set jobname       = excluded.jobname,
        first_seen_at = case when public.ops_cron_job_first_seen.jobname is distinct from excluded.jobname
                             then now() else public.ops_cron_job_first_seen.first_seen_at end,
        schedule      = excluded.schedule,
        schedule_changed_at = case
          when public.ops_cron_job_first_seen.schedule is null
            then public.ops_cron_job_first_seen.schedule_changed_at
          when public.ops_cron_job_first_seen.schedule is distinct from excluded.schedule
            then now()
          else public.ops_cron_job_first_seen.schedule_changed_at end;

  for rec in
    select j.jobid, j.jobname, j.schedule,
           (select d.status
              from cron.job_run_details d
             where d.jobid = j.jobid and d.status in ('succeeded','failed')
             order by d.start_time desc limit 1)          as last_completed_status,
           (select max(d.start_time)
              from cron.job_run_details d
             where d.jobid = j.jobid and d.status = 'succeeded') as last_success,
           coalesce(f.fails_24h, 0)                        as fails_24h
      from cron.job j
      left join (select jobid, count(*) as fails_24h
                   from cron.job_run_details
                  where status = 'failed'
                    and start_time > now() - interval '24 hours'
                  group by jobid) f on f.jobid = j.jobid
     where j.active
  loop
    -- crude cadence: */N or 'N * * *' hourly-ish -> ~1h; every-N-days -> 24*N; weekly -> 168h;
    -- default 24h (all doubled in the branches, as before)
    overdue_h := case
      when rec.schedule ~ '^\*/[0-9]+ ' then 1
      when rec.schedule ~ '^[0-9]+ \* ' then 2
      when rec.schedule ~ '\* \* [0-6]$' then 168*2
      when rec.schedule ~ '^[0-9,*/-]+ [0-9,*/-]+ \*/[0-9]+ '
        then 24 * (regexp_match(rec.schedule, '^[0-9,*/-]+ [0-9,*/-]+ \*/([0-9]+) '))[1]::int * 2
      else 24*2 end;
    v_grace := public.mon_cron_expected_gap(rec.jobid, overdue_h);

    -- (1) the most recent COMPLETED run failed. 'running' rows are excluded above precisely so that
    -- a job can see its own last outcome instead of its own in-flight row.
    if rec.last_completed_status = 'failed' then
      n := n + public.mon_raise('P1','cron_health', null, 'cron_fail:'||rec.jobid,
        jsonb_build_object('jobid',rec.jobid,'job',rec.jobname,'last_status','failed',
          'fails_24h', rec.fails_24h,
          'action','read cron.job_run_details.return_message for this jobid — it carries the exception'));
    else
      perform public.mon_resolve_key('cron_health', 'cron_fail:'||rec.jobid);
    end if;

    -- (2) INTERMITTENT failure. A job that fails a few runs a day and succeeds in between looks
    -- healthy at every single point-in-time check, which is exactly how 6 blind sweeps went
    -- unreported for three days.
    if rec.fails_24h >= 2 then
      n := n + public.mon_raise('P1','cron_health', null, 'cron_flapping:'||rec.jobid,
        jsonb_build_object('jobid',rec.jobid,'job',rec.jobname,'fails_24h',rec.fails_24h,
          'why','this job has failed repeatedly in the last 24h while still succeeding in between, '
             ||'so every point-in-time health read looks green. Each failed run is work that did not '
             ||'happen — for jobid 38 (mon-detectors-and-dispatch) it is an entire detector sweep '
             ||'rolled back, alerts included.',
          'action','root-cause the failures in cron.job_run_details.return_message. This clears '
             ||'itself once 24h pass with fewer than 2 failures.'));
    else
      perform public.mon_resolve_key('cron_health', 'cron_flapping:'||rec.jobid);
    end if;

    -- (3) ran successfully before but has since gone stale. A brand-new job that has never run
    -- (last_success IS NULL) is intentionally NOT alerted — it isn't overdue, it just hasn't been
    -- due yet (else every freshly-created job false-alarms until its first fire).
    if rec.last_success is not null
       and rec.last_success < now() - v_grace then
      n := n + public.mon_raise('P2','cron_health', null, 'cron_overdue:'||rec.jobid,
        jsonb_build_object('jobid',rec.jobid,'job',rec.jobname,
          'last_success',rec.last_success,'overdue_h', round(extract(epoch from v_grace)::numeric/3600.0, 2), 'grace_basis', case when abs(extract(epoch from v_grace) - overdue_h * 3600.0) < 1 then 'schedule-fallback' else 'observed-cadence' end));
    else
      perform public.mon_resolve_key('cron_health', 'cron_overdue:'||rec.jobid);
    end if;

    -- (4) NEVER FIRED AT ALL, past its own cadence. LIMB 3 deliberately exempts a job that has
    -- never succeeded, so a fresh job does not false-alarm before its first fire. This bounds that
    -- exemption to the job's own expected gap instead of forever: a monitor that cannot fire must
    -- never read as a clean bill of health.
    if rec.last_success is null
       and exists (select 1 from public.ops_cron_job_first_seen s
                    where s.jobid = rec.jobid and s.first_seen_at < now() - v_grace) then
      n := n + public.mon_raise('P1','cron_health', null, 'cron_never_fired:'||rec.jobid,
        jsonb_build_object('jobid',rec.jobid,'job',rec.jobname,'schedule',rec.schedule,
          'first_seen_at',(select s.first_seen_at from public.ops_cron_job_first_seen s where s.jobid = rec.jobid),
          'grace_h', round(extract(epoch from v_grace)::numeric/3600.0, 2),
          'why','this job has NEVER completed a successful run, and it has now been watched for '
             ||'longer than its own expected cadence. LIMB 3 exempts a never-run job so a freshly '
             ||'created one does not false-alarm before its first fire; this is that exemption '
             ||'expiring. A job that never fires is work nobody is doing and nothing else reports.',
          'action','check the schedule is actually reachable (a date that never occurs), that the '
             ||'command parses, and cron.job_run_details for a run that died before being recorded. '
             ||'Do NOT silence this by deactivating the job -- inactive jobs are skipped entirely.'));
    else
      perform public.mon_resolve_key('cron_health', 'cron_never_fired:'||rec.jobid);
    end if;
  end loop;

  -- LIMB 5 -- ATTENDANCE: a scheduled run that pg_cron never STARTED (2026-09-02).
  -- Limbs 1-4 all measure FAILURE or STALENESS. A dropped run writes no row at all: there is no
  -- 'failed' status for limbs 1-2, and the next period's success refreshes last_success before
  -- limb 3's grace expires. Measured 2026-09-02: jobid 17 (refresh_listing_native_location_v1,
  -- the matview refresh behind location search) started 20 of 24 due runs in 24h -- skipping
  -- 12:00, 23:00, 01:00 and 05:00 outright -- while all four limbs read green, because every run
  -- that did start succeeded.
  --
  -- HOURLY ONLY ('*' in hour/dom/month/dow). A daily job's 24h attendance is 0 or 1 and cannot be
  -- thresholded. mon_cron_minutes_in_hour() returns 0 for a minute-field it cannot count exactly,
  -- and such a job is skipped rather than handed a guessed denominator.
  --
  -- P2, consistent with LIMB 3: an ERROR is P1 (limbs 1-2), an ABSENCE is P2. Two guards keep the
  -- 24h window edge from crying wolf: the shortfall must exceed one run AND attendance must be
  -- under 90%.
  for rec in
    select j.jobid, j.jobname, j.schedule,
           public.mon_cron_attendance_expected(j.schedule, s.first_seen_at, now()) as expected_24h,
           (select count(*) from cron.job_run_details d
             where d.jobid = j.jobid
               and d.start_time > now() - interval '24 hours')::int as actual_24h
      from cron.job j
      left join public.ops_cron_job_first_seen s on s.jobid = j.jobid
     where j.active
       and split_part(j.schedule, ' ', 2) = '*' and split_part(j.schedule, ' ', 3) = '*'
       and split_part(j.schedule, ' ', 4) = '*' and split_part(j.schedule, ' ', 5) = '*'
       and public.mon_cron_minutes_in_hour(j.schedule) > 0
  loop
    if rec.expected_24h >= 24
       and rec.actual_24h < rec.expected_24h - 1
       and rec.actual_24h::numeric / rec.expected_24h::numeric < 0.90 then
      n := n + public.mon_raise('P2','cron_health', null, 'cron_absent:'||rec.jobid,
        jsonb_build_object('jobid', rec.jobid, 'job', rec.jobname, 'schedule', rec.schedule,
          'expected_runs_24h', rec.expected_24h,
          'actual_runs_24h', rec.actual_24h,
          'attendance_pct', round(100.0 * rec.actual_24h / rec.expected_24h, 1),
          'why', 'pg_cron never STARTED these runs. They are not failures and leave no row behind, '
              || 'so limbs 1-4 cannot see them; each absence is one period of work that did not happen.',
          'action', 'Check top-of-hour contention against max_worker_processes: on 2026-09-02 every '
              || 'job scheduled in minutes 0-8 lost runs while every job at minute >= 9 sat at 100%. '
              || 'A cron SCHEDULE change is owner-only -- never silence this by widening the 90% '
              || 'threshold or by moving the job without that decision.'));
    else
      perform public.mon_resolve_key('cron_health', 'cron_absent:'||rec.jobid);
    end if;
  end loop;

  -- ORPHANED-KEY SWEEP (2026-09-12). Every resolve above lives INSIDE the per-job loop, so a
  -- key belonging to a job that has since been DELETED is unreachable: the loop never yields
  -- that jobid again. Alert 2419 (cron_fail:113, a temporary job another session removed) sat
  -- open through 48 consecutive sweeps because of it, and while it sat there mon_raise()
  -- returned 0 for that key — so a FUTURE job reusing jobid 113 and failing would have raised
  -- nothing at all. pg_cron reuses jobids.
  --
  -- This is a resolve on an EVALUATED path, not a grace window: the discriminator is whether
  -- the job still exists, which is the same fact that made the key unreachable. A key whose
  -- job is still on the roster is untouched, so nothing this detector genuinely reports can be
  -- silenced here. Never widen this to resolve keys for jobs that DO exist.
  update public.alert_event a
     set resolved_at = now()
   where a.kind = 'cron_health'
     and a.resolved_at is null
     and a.dedup_key ~ '^cron_[a-z_]+:[0-9]+$'
     and not exists (select 1 from cron.job j
                      where j.jobid = split_part(a.dedup_key, ':', 2)::bigint);

  return n;
end $function$;

-- THE BARRIER. The defect above was a SQL-layer arithmetic result, so the guard that catches its
-- return has to be an executing production check, not a source-text tripwire over the function.
-- This measures the invariant itself on every sweep: a job's overdue grace must leave real margin
-- over the cadence the job is CURRENTLY running at. It is the same query that measured the four
-- offending jobs before they were repaired, which is what makes it a watched mutation rather than an
-- assertion -- it returned 4 rows against the defective function and must return 0 now.
--
-- Deliberately observational: it compares the grace against the job's own RECENT median gap (last
-- 6 gaps), never against a parsed cron expression, so it needs no schedule parser and cannot be
-- fooled by a form nobody taught it. It therefore catches BOTH shapes found on 2026-09-23 -- a
-- contaminated learned median AND a regex fallback that happens to equal the real cadence.
--
-- Do NOT silence this by widening the 1.5x margin. The margin is what "one missed tick is
-- tolerated" means; below it, a healthy run raises an alert, and a monitor that fires on health is
-- how a queue stops being worked (a P0 alert_queue_unworked was open when this was written).
create or replace function public.mon_detect_cron_grace_below_cadence()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rec record;
  n int := 0;
  v_seen text[] := '{}';
begin
  for rec in
    with succ as (
      select d.jobid,
             extract(epoch from (d.start_time
               - lag(d.start_time) over (partition by d.jobid order by d.start_time)))::numeric as gap_s,
             row_number() over (partition by d.jobid order by d.start_time desc) as rn
        from cron.job_run_details d
       where d.status = 'succeeded'
         and d.start_time > now() - interval '7 days'
    ), recent as (
      select jobid,
             (percentile_cont(0.5) within group (order by gap_s))::numeric as recent_med_s,
             count(*) as n_recent
        from succ
       where gap_s is not null and gap_s > 0 and rn <= 6
       group by jobid
    )
    select j.jobid, j.jobname, j.schedule, r.recent_med_s, r.n_recent,
           extract(epoch from public.mon_cron_expected_gap(
             j.jobid,
             case
               when j.schedule ~ '^\*/[0-9]+ ' then 1
               when j.schedule ~ '^[0-9]+ \* ' then 2
               when j.schedule ~ '\* \* [0-6]$' then 168*2
               when j.schedule ~ '^[0-9,*/-]+ [0-9,*/-]+ \*/[0-9]+ '
                 then 24 * (regexp_match(j.schedule, '^[0-9,*/-]+ [0-9,*/-]+ \*/([0-9]+) '))[1]::int * 2
               else 24*2 end))::numeric as grace_s
      from cron.job j
      join recent r on r.jobid = j.jobid
     where j.active
       and r.n_recent >= 3
  loop
    if rec.grace_s < rec.recent_med_s * 1.5 then
      v_seen := v_seen || ('cron_grace_tight:'||rec.jobid);
      n := n + public.mon_raise('P2','cron_health', null, 'cron_grace_tight:'||rec.jobid,
        jsonb_build_object('jobid', rec.jobid, 'job', rec.jobname, 'schedule', rec.schedule,
          'grace_h', round(rec.grace_s/3600.0, 2),
          'recent_cadence_h', round(rec.recent_med_s/3600.0, 2),
          'why', 'this job''s overdue grace is smaller than 1.5x the cadence it is actually running '
              || 'at, so a HEALTHY run raises cron_overdue and then self-resolves -- the flapping '
              || 'shape mon_detect_alert_flapping exists to condemn. Two causes seen on 2026-09-23: '
              || 'a learned median contaminated by a schedule change (jobid 4/5/39, grace 18h vs a '
              || '24h cadence), and a regex fallback that happens to equal the real cadence '
              || '(jobid 36, 48h vs 48h).',
          'action', 'Find out WHICH. If the schedule changed, ops_cron_job_first_seen.'
              || 'schedule_changed_at should be dated at the change -- a sweep stamps it '
              || 'automatically now, so a NULL stamp on a job whose cadence visibly moved means the '
              || 'change predates the column and wants an evidence-backed stamp. If the grace came '
              || 'from the regex fallback (grace_basis on the cron_overdue alert says '
              || '"schedule-fallback"), the schedule form is one no branch recognises -- teach '
              || 'mon_detect_cron_health that form. Do NOT widen the 1.5x margin.'));
    else
      perform public.mon_resolve_key('cron_health', 'cron_grace_tight:'||rec.jobid);
    end if;
  end loop;

  -- A job that drops out of the candidate set entirely (deleted, deactivated, or too few recent
  -- runs to judge) can never reach the resolve above: the loop stops yielding it. That is exactly
  -- how alert 2419 sat open through 48 sweeps. Resolve every key this detector owns that it did
  -- not just evaluate.
  update public.alert_event a
     set resolved_at = now()
   where a.kind = 'cron_health'
     and a.resolved_at is null
     and a.dedup_key like 'cron_grace_tight:%'
     and not (a.dedup_key = any(v_seen));

  return n;
end $function$;

-- Roster it in the SAME migration: AGENTS.md — a detector outside mon_run_all_detectors() is
-- decoration, and mon_detect_orphaned_detectors() fires on any detector nothing reaches. Edited by
-- needle rather than rewritten, so every other entry and the function's catalog attributes survive.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if v_def is null then
    raise exception 'mon_run_all_detectors() not found — refusing to strand a detector';
  end if;
  if position('mon_detect_cron_grace_below_cadence' in v_def) > 0 then
    raise notice 'already rostered';
    return;
  end if;
  if position('''mon_detect_cron_health''' in v_def) = 0 then
    raise exception 'roster anchor not found — refusing to guess where to insert';
  end if;

  v_new := replace(v_def,
    '''mon_detect_cron_health''',
    '''mon_detect_cron_health'', ''mon_detect_cron_grace_below_cadence''');
  execute v_new;
end $$;

-- Prove every half before this migration is allowed to commit.
do $$
declare v_def text; v_contaminated numeric; v_clean numeric; v_tight int;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname='public' and p.proname='mon_detect_cron_grace_below_cadence') then
    raise exception 'detector was not created';
  end if;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='mon_run_all_detectors';
  if position('mon_detect_cron_grace_below_cadence' in v_def) = 0 then
    raise exception 'roster edit did nothing — detector would be decoration';
  end if;

  -- EXECUTE the extracted arithmetic against jobid 4's REAL observed series, both ways. This is the
  -- defect and the fix in one assertion: the contaminated series (8-hourly gaps mixed with daily)
  -- yields 18h, below the 24h period the job actually runs at; the post-change series has too few
  -- gaps to learn from and falls back, which is wider. An edit that reintroduces the mixing fails
  -- here. The first draft of this proof asserted a flat ">= 24h grace" for all three repaired jobs
  -- and correctly failed on jobid 39, whose cadence is 12h and whose right answer is 24h -- the
  -- invariant is a RATIO to the job's own cadence, never an absolute.
  select extract(epoch from public.mon_cron_gap_from_series(
           array[28800,28800,28800,28800,28800,36000,86400,86400,86400,86400]::numeric[], 48))/3600.0
    into v_contaminated;
  if v_contaminated is distinct from 18.0 then
    raise exception 'expected the contaminated series to still measure 18h, got %', v_contaminated;
  end if;
  select extract(epoch from public.mon_cron_gap_from_series(
           array[86400,86400,86400,86400]::numeric[], 48))/3600.0
    into v_clean;
  if v_clean <= 24.0 then
    raise exception 'post-change series must not yield a grace at or below the 24h period, got %', v_clean;
  end if;

  -- And the invariant must hold on the four jobs this migration is about, measured the way the new
  -- detector measures it. Scoped to those four rather than the whole roster so the migration cannot
  -- be blocked by an unrelated job's transient cadence.
  with succ as (
    select d.jobid,
           extract(epoch from (d.start_time
             - lag(d.start_time) over (partition by d.jobid order by d.start_time)))::numeric as gap_s,
           row_number() over (partition by d.jobid order by d.start_time desc) as rn
      from cron.job_run_details d
     where d.status = 'succeeded' and d.start_time > now() - interval '7 days'
       and d.jobid in (4,5,36,39)
  ), recent as (
    select jobid, (percentile_cont(0.5) within group (order by gap_s))::numeric as recent_med_s,
           count(*) as n_recent
      from succ where gap_s is not null and gap_s > 0 and rn <= 6 group by jobid
  )
  select count(*) into v_tight
    from cron.job j join recent r on r.jobid = j.jobid
   where j.active and r.n_recent >= 3
     and extract(epoch from public.mon_cron_expected_gap(
           j.jobid,
           case
             when j.schedule ~ '^\*/[0-9]+ ' then 1
             when j.schedule ~ '^[0-9]+ \* ' then 2
             when j.schedule ~ '\* \* [0-6]$' then 168*2
             when j.schedule ~ '^[0-9,*/-]+ [0-9,*/-]+ \*/[0-9]+ '
               then 24 * (regexp_match(j.schedule, '^[0-9,*/-]+ [0-9,*/-]+ \*/([0-9]+) '))[1]::int * 2
             else 24*2 end)) < r.recent_med_s * 1.5;
  if v_tight <> 0 then
    raise exception '% of the four jobs still have a grace below 1.5x their own cadence', v_tight;
  end if;
end $$;
