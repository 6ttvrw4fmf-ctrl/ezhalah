-- Welcome facts: build at the start of the Saudi day, not 45 minutes into it (owner 2026-10-30: «we said when a user logs
-- in we give him a fact always — what happened?»).
--
-- welcome_insights_pick() serves only rows whose day = today in Asia/Riyadh (a daily fact is true only on the day it was
-- built for, owner 2026-10-27). The builder (cron job build-welcome-insights) ran «45 */3», so the new Saudi day began at
-- 21:00 UTC with NO rows until the 21:45 build finished (~21:47): every night from 00:00 to 00:47 Riyadh a signed-in
-- user got the plain line instead of a fact. Measured 2026-10-30 21:38 UTC: pick → {"day": null, "insights": []}; the
-- owner's screenshot at 00:38 Riyadh showed line #37 («the market moves every day»), no number.
--
-- Fix: «2 */3» — the first build of the day starts 2 minutes after Riyadh midnight (21:02 UTC) and takes ~2 minutes, so
-- the gap is ~4 minutes instead of ~47. The 3-hourly refresh keeps its cadence. (The :45 slot was chosen on 2026-10-24 to
-- follow the :22 index sync and :33/:35 rebuilds; for 7-day facts a sync 40 minutes older is immaterial, and the day
-- boundary is what the pick function keys on.) Rollback: cron.alter_job(job_id := <jobid>, schedule := '45 */3 * * *').
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'build-welcome-insights'), schedule := '2 */3 * * *');

do $proof$
begin
  if (select schedule from cron.job where jobname = 'build-welcome-insights') <> '2 */3 * * *' then
    raise exception 'PROOF: welcome build schedule not applied';
  end if;
  if (select count(*) from cron.job where jobname = 'build-welcome-insights' and active) <> 1 then
    raise exception 'PROOF: build-welcome-insights is not the one active job';
  end if;
  raise notice 'PROOF OK: welcome facts build at 00:02 Riyadh and every 3 hours';
end $proof$;
