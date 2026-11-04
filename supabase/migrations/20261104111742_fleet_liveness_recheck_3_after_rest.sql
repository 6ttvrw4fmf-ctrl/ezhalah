-- gh-fleet-liveness-recheck-3 at 03:48, not 02:48 (♻️ lifecycle, 2026-11-04). A recheck stamps a row
-- when its site's run ENDS and the next pass needs REPROBE_MIN_HOURS = 6 of rest, so 20:48 -> 02:48
-- (exactly 6 h) misses every row the evening pass struck. 03:48 is 7 h after 20:48 and still before
-- the 05:00 UTC crawl window. Guard: scrapers/common/tests/test_fleet_recheck_passes_are_rested_2026_11_04.py
-- (every gap >= 6 h 30 min). Fail-closed on the schedule this was written against.
do $mig$
declare v_id bigint;
begin
  select jobid into v_id from cron.job
   where jobname = 'gh-fleet-liveness-recheck-3' and schedule = '48 2 * * *' and active;
  if v_id is null then
    raise exception 'gh-fleet-liveness-recheck-3 is not at 48 2 * * *; nothing changed';
  end if;
  perform cron.alter_job(v_id, schedule := '48 3 * * *');
end
$mig$;
