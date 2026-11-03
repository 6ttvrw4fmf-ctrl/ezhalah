-- 🔧 2026-11-03 — THE SCRAPE ALARM GETS THE SAME pg_cron DISPATCH BACKSTOP ITS SIBLINGS HAVE (alert 12874, P2 scrape_alarm_silent).
--
-- scripts/scrape-alarm.ts runs from .github/workflows/scrape-alarm.yml on GitHub's own hourly schedule ('17 * * * *').
-- GitHub delivered none of those schedules between 06:48 and 15:07 UTC on 11-03 (the workflow is active, its last
-- eight scheduled runs succeeded, a workflow_dispatch at 15:07 ran clean in 20 s) — the schedule was dropped, not the
-- checker. While it is silent nobody is watching for bulk listing downloads. alert-dispatch, migration-drift-guard and
-- repair-enrollment-guard already carry a pg_cron backstop that dispatches the workflow through trigger_gh_workflow()
-- (fail-closed: it raises when the PAT is missing, ops_incident 74); the scrape alarm now gets one every 3 hours, well
-- inside the detector's 8-hour window, at a minute no other backstop uses. Each run catches up on 24 h, so one
-- dispatch closes any gap GitHub leaves.
select cron.schedule('gh-scrape-alarm-backstop', '53 */3 * * *', $$select public.trigger_gh_workflow('scrape-alarm.yml')$$);

do $proof$
begin
  if not exists (select 1 from cron.job where jobname = 'gh-scrape-alarm-backstop' and schedule = '53 */3 * * *'
                   and command = $$select public.trigger_gh_workflow('scrape-alarm.yml')$$) then
    raise exception 'PROOF: the scrape-alarm backstop job did not land as scheduled';
  end if;
  if (select count(*) from cron.job where jobname like 'gh-%-backstop') < 4 then
    raise exception 'PROOF: expected the four backstops (alert-dispatch, drift-guard, enrollment-guard, scrape-alarm)';
  end if;
end $proof$;