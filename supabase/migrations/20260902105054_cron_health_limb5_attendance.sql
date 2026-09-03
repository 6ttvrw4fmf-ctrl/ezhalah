-- LIMB 5 — A CRON RUN THAT WAS NEVER STARTED (routine #7, systems seam, 2026-09-02).
--
-- Built by NEEDLE-EDITING pg_get_functiondef() of the LIVE mon_detect_cron_health(), never from a
-- copy pasted into this file: a concurrent session re-creating the function from a stale body is
-- how one session's limb silently disappears. The anchor is asserted unique before the edit and
-- the whole thing is idempotent (it returns early if LIMB 5 is already there).
do $mig$
declare
  v_def    text;
  v_anchor text := E'  end loop;\n  return n;';
  v_limb5  text;
  v_hits   int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_cron_health';

  if v_def is null then
    raise exception 'mon_detect_cron_health() not found -- refusing to invent one';
  end if;

  if position('cron_absent:' in v_def) > 0 then
    raise notice 'LIMB 5 already present -- nothing to do';
    return;
  end if;

  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'anchor found % times, expected exactly 1 -- the live body moved; re-derive the edit', v_hits;
  end if;

  v_limb5 := $limb$
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
           public.mon_cron_minutes_in_hour(j.schedule) * 24 as expected_24h,
           (select count(*) from cron.job_run_details d
             where d.jobid = j.jobid
               and d.start_time > now() - interval '24 hours')::int as actual_24h
      from cron.job j
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
$limb$;

  execute replace(v_def, v_anchor, E'  end loop;\n' || v_limb5 || E'\n  return n;');
  raise notice 'LIMB 5 (attendance) added to mon_detect_cron_health()';
end
$mig$;
