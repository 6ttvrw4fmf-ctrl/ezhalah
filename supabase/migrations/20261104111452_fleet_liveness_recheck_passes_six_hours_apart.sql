-- Fleet liveness recheck: every pass must land 6 h after the one before it (♻️ lifecycle, 2026-11-04).
--
-- fleet-liveness-recheck.yml re-reads only struck rows, and only rows whose last reading is at least
-- REPROBE_MIN_HOURS = 6 old (scrapers/common/fleet_liveness.py; the stamp is written when a site's
-- run ENDS). The cron rebalance of 2026-11-04 00:04 (20261104000454, "minute only") moved
-- gh-fleet-liveness-recheck-2 from 20:47 to 20:06, 5 h 49 min after the 14:17 pass: no row the
-- first recheck struck can be rested by then, so the third reading moved to the next day's daily
-- run on every site. Measured the night before even at 20:47: tuba's 14:17 pass waited behind the
-- daily run (same concurrency group) until 15:41, the 20:47 pass ran 21:17, 5 h 35 min later, and
-- probed 0 — 20 tuba ads read dead three times (07:59, 15:41, and a 21:56 shadow read) stayed on
-- customers' screens into 11-04.
--
-- So: recheck-2 back to 20:48 (6 h 31 min after 14:17), and a third pass at 02:48 UTC (quiet hours,
-- before ⚡'s 05:00 start) that takes every row the evening pass struck or skipped because the
-- earlier pass ran late. Same workflow, same code, same caps and controls; a recheck reads only
-- struck rows (a few dozen a day), so no cap moves and proxy use stays within rule 8.
-- Fail-closed: recheck-2 must still carry the schedule this was written against.
do $mig$
declare v_id bigint;
begin
  select jobid into v_id from cron.job
   where jobname = 'gh-fleet-liveness-recheck-2' and schedule = '6 20 * * *' and active;
  if v_id is null then
    raise exception 'gh-fleet-liveness-recheck-2 is not at 6 20 * * *; nothing changed';
  end if;
  perform cron.alter_job(v_id, schedule := '48 20 * * *');
  if exists (select 1 from cron.job where jobname = 'gh-fleet-liveness-recheck-3') then
    raise exception 'gh-fleet-liveness-recheck-3 already exists; nothing changed';
  end if;
  perform cron.schedule('gh-fleet-liveness-recheck-3', '48 2 * * *',
    $$select public.trigger_gh_workflow('fleet-liveness-recheck.yml')$$);
end
$mig$;