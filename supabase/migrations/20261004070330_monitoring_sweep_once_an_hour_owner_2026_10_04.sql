-- OWNER DECISION 2026-10-04 («yeah», answering: run the heavy monitoring once an hour instead of twice).
-- Why: mon-detectors-and-dispatch ran 585–699 s twice an hour; during those minutes the customer-facing
-- counting RPCs (top_cities_by_deal_ar, district_options_ar) averaged 3–4 s and peaked at 19 s, so the
-- trending numbers looked missing. The schedule was owner-only (20260828231336 / 20260829104744); the owner
-- has now decided. Unchanged: the P0 fast lane (mon-p0-fast-lane, every few minutes) and the sweep's own
-- front + trailing mon_dispatch_p0_fast calls, so P0 delivery does not depend on this cadence; the watchdog
-- (mon_watchdog_detector_job) already allows 70 minutes between successes. Same job, same command.
do $mig$
declare v_jobid int;
begin
  select jobid into v_jobid from cron.job where jobname = 'mon-detectors-and-dispatch';
  if v_jobid is null then raise exception 'mon-detectors-and-dispatch not found'; end if;
  perform cron.alter_job(v_jobid, schedule := '59 * * * *');
  if (select schedule from cron.job where jobid = v_jobid) <> '59 * * * *' then
    raise exception 'schedule did not take';
  end if;
end
$mig$;
