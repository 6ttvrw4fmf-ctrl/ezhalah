-- THE DEFECT (found 2026-08-22, senior run #35): mon-detectors-and-dispatch (jobid 38) — the pg_cron
-- job that runs EVERY barrier twice an hour — failed 6 times over 2026-08-20..22 with
-- `canceling statement due to statement timeout`, and NOT ONE alert was raised. The whole sweep runs
-- in a single transaction, so a timeout rolls back every alert its detectors had already raised and
-- mon_dispatch_alerts() never runs: each failure is a half-hour of total monitoring blindness that
-- leaves no trace anywhere except cron.job_run_details.
--
-- WHY cron_health COULD NOT SEE IT. It read the single most recent run row:
--     select status, start_time into last_status, last_ok
--       from cron.job_run_details where jobid=rec.jobid order by start_time desc limit 1;
-- For the job this detector is RUNNING INSIDE, that row is the sweep's own in-flight row, whose
-- status is 'running'. 'running' is not 'failed', so jobid 38 fell straight to the else branch —
-- which RESOLVES its cron_fail alert. The monitoring job was therefore structurally incapable of
-- ever reporting its own failure, and empirically never did: cron_health has raised cron_fail for
-- jobids 22/34/50/63 but never once for 38.
-- The same blind spot hits every OTHER job that happens to be mid-run at :29/:59 — its standing
-- cron_fail alert is silently resolved by a 'running' row.
--
-- WHY THE WATCHDOG DID NOT COVER IT EITHER. mon_watchdog_detector_job() (jobid 53) is deliberately
-- scoped to "blind RIGHT NOW": it fires only after 70 minutes with no SUCCESS. The sweep fails
-- intermittently (4 of 48 runs in 24h), so a success always lands inside the window and the watchdog
-- stays correctly silent. Nothing at all watched intermittent failure.
--
-- THE FIX, three independent and independently-clearable conditions per job:
--   1. cron_fail     — the most recent COMPLETED run failed  (status filter excludes 'running')
--   2. cron_flapping — >= 2 failed runs in 24h even if the latest completed run succeeded. This is
--                      the shape that hid here: mostly green, repeatedly blind.
--   3. cron_overdue  — succeeded before, but not recently enough for its cadence.
--
-- Resolution moves from a hand-rolled UPDATE to mon_resolve_key(), because mon_detect_unresolvable_
-- alert_kinds() (2026-08-21) requires a literal mon_resolve_key('<kind>' call before it will treat a
-- kind as clearable — without this, the first cron_health alert raised by this fix would immediately
-- be reported as an unclearable ratchet.
--
-- The 24h failure tally is one grouped scan outside the loop, not a per-job count: this detector runs
-- inside the very sweep whose runtime budget is the problem, and must not make it worse.

create or replace function public.mon_detect_cron_health()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rec record;
  n int := 0;
  overdue_h int;
begin
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
    -- crude cadence: */N or 'N * * *' hourly-ish -> ~1h; daily -> ~24h; weekly -> ~168h; default 24h
    overdue_h := case
      when rec.schedule ~ '^\*/[0-9]+ ' then 1
      when rec.schedule ~ '^[0-9]+ \* ' then 2
      when rec.schedule ~ '\* \* [0-6]$' then 168*2
      else 24*2 end;

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
       and rec.last_success < now() - make_interval(hours => overdue_h) then
      n := n + public.mon_raise('P2','cron_health', null, 'cron_overdue:'||rec.jobid,
        jsonb_build_object('jobid',rec.jobid,'job',rec.jobname,
          'last_success',rec.last_success,'overdue_h',overdue_h));
    else
      perform public.mon_resolve_key('cron_health', 'cron_overdue:'||rec.jobid);
    end if;
  end loop;
  return n;
end $function$;

-- Prove the blind spot is closed in the same transaction that closed it: a 'running' row must no
-- longer be able to mask the last completed outcome.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_cron_health';
  if v_def !~ 'status in \(''succeeded'',''failed''\)' then
    raise exception 'cron_health still reads run rows without excluding in-flight runs';
  end if;
  if v_def !~ 'cron_flapping' then
    raise exception 'cron_health has no intermittent-failure condition';
  end if;
  if v_def !~ 'mon_resolve_key\s*\(\s*''cron_health''' then
    raise exception 'cron_health does not clear its own kind via mon_resolve_key — it would be '
                    'reported as an unresolvable ratchet the moment it raises';
  end if;
end $$;
