-- QA & Repair 2026-10-07 (backlog #160): the hourly monitoring sweep (jobid 38) must not freeze the
-- whole pg_cron scheduler for its 6–12 minutes. Measured 2026-10-07: no job started between 14:00
-- and 14:07:25 — the instant job 38's backend finished — every hour 05–14 UTC.
-- Postgres logs show WHY: «cron job 38 COMMAND completed: SET» arrived at 13:59:36, 36 s after a
-- start whose first statement is an instant SET. The server buffers a multi-statement command's
-- results and sends them only when something flushes mid-run (a NOTICE raised inside the sweep);
-- pg_cron (libpq mode, cron.use_background_workers = off) then consumes those partial results and
-- blocks waiting for the next one until the sweep ends — the launcher starts nothing meanwhile.
-- Job 28 (search sync, same «set …; select …» shape) emits no mid-run NOTICE, never flushes early,
-- and never blocks the scheduler (jobs 44, 63, 54, 86, 75, 33 started during its 12:22 run).
-- Fix: the sweep stops sending NOTICEs to its client. Every statement, its order, the single
-- transaction and the '900s' statement_timeout literal (read by mon_detect_detector_sweep_budget)
-- are unchanged; the command is DERIVED from the live one (verify-monitoring-sweep-is-guarded).
do $$
declare v_old text; v_new text;
begin
  select command into v_old from cron.job where jobname = 'mon-detectors-and-dispatch';
  if v_old is null then raise exception 'mon-detectors-and-dispatch not found'; end if;
  if position('client_min_messages' in v_old) > 0 then return; end if;
  v_new := replace(v_old, 'set statement_timeout to ''900s'';',
                   'set client_min_messages to warning; set statement_timeout to ''900s'';');
  if v_new = v_old then raise exception 'anchor «set statement_timeout to ''900s'';» not found — refusing to guess'; end if;
  perform cron.alter_job(job_id := (select jobid from cron.job where jobname = 'mon-detectors-and-dispatch'), command := v_new);
end $$;
