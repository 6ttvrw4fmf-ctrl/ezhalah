-- Regression protection for the 2026-08-03 monitoring blackout (senior audit run #4).
--
-- THE BLIND SPOT: mon_detect_cron_health() is the detector that alerts when a pg_cron job's last
-- run failed. It is invoked by mon_run_all_detectors(), which is itself run by pg_cron job 38
-- (mon-detectors-and-dispatch) — in a SINGLE transaction that also runs every other detector and
-- then mon_dispatch_alerts(). So when ANY detector raises an exception, job 38 aborts, and the one
-- detector whose job is to notice "a cron job is failing" never gets to run. The monitoring system
-- cannot report its own death.
--
-- That is not hypothetical: on 2026-08-03 a `date - numeric` type error in
-- mon_detect_mass_inactivation() (shipped 19:04Z in 20260803190624) aborted job 38 on all 7 runs
-- from 19:20Z to 22:20Z. Zero alerts were raised in those 3 hours by ANY detector — including
-- cron_health — and nothing surfaced it. It was found by a human-run audit, not by monitoring.
-- Immediately after the type fix, the first successful sweep raised 18 previously-suppressed
-- alerts (15 field_integrity, 1 cron_health, 1 quarantine_growth, 1 legacy novel-type).
--
-- THE WATCHDOG: a deliberately tiny, dependency-free function on its own pg_cron schedule, offset
-- from job 38, that does exactly one thing — check whether the monitoring job itself has failed or
-- gone silent — and raises through the normal alert_event path. It reads only cron.job /
-- cron.job_run_details and calls mon_raise(); it does NOT call any detector, so a defect in any
-- detector cannot take the watchdog down with it. Self-resolving, day-independent dedup key, same
-- shape as the other mon_* detectors.
--
-- Scope: monitoring/operational only. No listing data, no search semantics, no product behavior.
-- Reversible with: select cron.unschedule('mon-watchdog-detector-job'); drop function
-- public.mon_watchdog_detector_job();

create or replace function public.mon_watchdog_detector_job()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_jobid      int;
  v_active     bool;
  v_last_start timestamptz;
  v_last_status text;
  v_last_ok    timestamptz;
  n int := 0;
begin
  select jobid, active into v_jobid, v_active
    from cron.job where jobname = 'mon-detectors-and-dispatch';

  -- The monitoring job is gone or disabled entirely: that is itself the alert.
  if v_jobid is null or not coalesce(v_active, false) then
    return public.mon_raise('P1','monitoring_watchdog', null, 'monitoring_job_absent',
      jsonb_build_object(
        'why','pg_cron job `mon-detectors-and-dispatch` is missing or inactive — the entire detector suite and alert dispatch are not running',
        'jobid', v_jobid, 'active', v_active));
  else
    update public.alert_event set resolved_at = now()
     where kind='monitoring_watchdog' and resolved_at is null and dedup_key='monitoring_job_absent';
  end if;

  select status, start_time into v_last_status, v_last_start
    from cron.job_run_details where jobid = v_jobid order by start_time desc limit 1;
  select max(start_time) into v_last_ok
    from cron.job_run_details where jobid = v_jobid and status = 'succeeded';

  -- Job 38 runs at :20 and :50. Anything past ~70 minutes without a SUCCESS means the detector
  -- suite is blind right now, whether it is erroring out or has stopped firing altogether.
  if v_last_ok is null or v_last_ok < now() - interval '70 minutes' then
    n := n + public.mon_raise('P1','monitoring_watchdog', null, 'monitoring_job_blind',
      jsonb_build_object(
        'why','the monitoring job has not completed successfully in over 70 minutes — every detector (price fidelity, unverified inactivation, mass inactivation, quarantine growth, field integrity, …) is currently blind, and cron_health cannot report this because it runs INSIDE the job that is failing',
        'jobid', v_jobid,
        'last_success', v_last_ok,
        'last_run_at', v_last_start,
        'last_run_status', v_last_status,
        'action','read cron.job_run_details for this jobid — return_message carries the exception that is aborting the sweep'));
  else
    update public.alert_event set resolved_at = now()
     where kind='monitoring_watchdog' and resolved_at is null and dedup_key='monitoring_job_blind';
  end if;

  return n;
end $$;

-- Offset from job 38's :20/:50 so a watchdog run always lands between two monitoring runs.
select cron.schedule('mon-watchdog-detector-job', '5,35 * * * *',
  $cron$ set statement_timeout to '60s'; select public.mon_watchdog_detector_job(); $cron$);