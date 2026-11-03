-- mon-text-facts (cron job 189) GETS THE BUDGET ITS WORK MEASURES (🔧 2026-11-03, alerts 12859 cron_timeout_abort:189
-- and 12856 cron_fail:189). The 11:52 UTC run was killed at 300 s inside ops_ai_facts_unread_new(), the per-table count
-- of 30-72 h arrivals the AI reader never read. Measured 90 minutes later on a quiet database: the same call answers
-- in 8.3 s and mon_selftest_text_facts() in 0.02 s. The job needs seconds; at 11:52 it starts inside the tail of the
-- 11:22 search sync (14-16 min today) beside the af-score reads, and that contention alone took it past 300 s on
-- 11-03. Budget 300 -> 900 s, the hourly sweep's own ceiling. The schedule is untouched: moving a monitoring job is the
-- owner's call. Nothing else in the command changes, and the edit raises if the expected text is absent.
do $mig$
declare
  v_old text;
  v_new text;
  old_ constant text := $s$set statement_timeout to '300s';$s$;
  new_ constant text := $s$set statement_timeout to '900s';$s$;
begin
  select command into v_old from cron.job where jobid = 189 and jobname = 'mon-text-facts';
  if v_old is null or position(old_ in v_old) = 0 then
    raise exception 'mon-text-facts: the 300 s budget was not found in job 189 — read cron.job first';
  end if;
  v_new := replace(v_old, old_, new_);
  perform cron.alter_job(job_id := 189, command := v_new);
  if (select command from cron.job where jobid = 189) <> v_new then
    raise exception 'mon-text-facts: the 900 s budget did not land';
  end if;
end
$mig$;
