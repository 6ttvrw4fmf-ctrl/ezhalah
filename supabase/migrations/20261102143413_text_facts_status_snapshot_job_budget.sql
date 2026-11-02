-- 🔧 2026-11-02: the daily snapshot job carries its own statement budget, the way mon-detectors-and-dispatch (job 38)
-- does. The first run (14:31 UTC) was cancelled by the session's default statement_timeout: a timeout set INSIDE a
-- running statement (set_config in the function) does not restart the timer that was armed when the statement
-- began, so the whole-overlay counts (minutes) never finished. The command sets the budget before the call.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'text-facts-status-snapshot'),
  command := $$set statement_timeout to '900s'; select public.text_facts_status_snapshot_take();$$);