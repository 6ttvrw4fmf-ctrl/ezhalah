-- Fleet liveness rechecks on free cron minutes (♻️ lifecycle, 2026-11-04). The two passes placed at
-- :48 earlier today share their minute with two other jobs (dealapp-location-propagate and
-- mon-p0-fast-lane), which scripts/verify-cron-slot-discipline.ts refuses (no minute starts more than
-- 2 jobs). recheck-2 moves to 20:56 (one neighbour; 6 h 39 min after the 14:17 pass) and recheck-3 to
-- 03:27 (a free minute; 6 h 31 min after 20:56), so every pass still lands at least REPROBE_MIN_HOURS
-- + 30 min after the one before it. sql/mirrors/cron_schedule.json carries the same two rows.
-- Fail-closed on the schedules this was written against.
do $mig$
declare v2 bigint; v3 bigint;
begin
  select jobid into v2 from cron.job where jobname = 'gh-fleet-liveness-recheck-2' and schedule = '48 20 * * *' and active;
  select jobid into v3 from cron.job where jobname = 'gh-fleet-liveness-recheck-3' and schedule = '48 3 * * *' and active;
  if v2 is null or v3 is null then
    raise exception 'fleet recheck schedules are not the ones this was written against; nothing changed';
  end if;
  perform cron.alter_job(v2, schedule := '56 20 * * *');
  perform cron.alter_job(v3, schedule := '27 3 * * *');
end
$mig$;
