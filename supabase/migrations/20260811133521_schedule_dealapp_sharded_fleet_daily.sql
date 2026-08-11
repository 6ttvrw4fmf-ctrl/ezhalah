-- Daily schedule for the dealapp 12-shard fleet (owner-approved 2026-08-11, option b).
--
-- SLOT CHOICE. 02:33 UTC, chosen against three constraints:
--   * minute 33 is unoccupied — AGENTS.md requires one job per minute-slot after the 2026-08-10
--     cron-stampede outage, and mon_detect_cron_minute_collision enforces it. :00 belongs to the
--     matview refresh alone.
--   * the fleet's worst-case shard is ~97 min (699 rows at the worst observed 8.3 rows/min plus
--     13 min fixed overhead), so a 02:33 start finishes by ~04:10 — comfortably BEFORE
--     gh-small-sources at 04:22, which no longer carries dealapp but does share runner capacity.
--   * it lands well clear of the 01:00 aqar liveness sweep, so the two heaviest fleets never
--     overlap on the database.
--
-- dealapp is no longer in small-sources-sync.yml, so this is the ONLY scheduled dealapp crawl —
-- verify-dealapp-crawl-budget.ts fails CI if it reappears there, which is what keeps "no duplicate
-- work" true rather than merely intended.
select cron.schedule(
  'gh-dealapp-sharded',
  '33 2 * * *',
  $$select public.trigger_gh_workflow('dealapp-sharded.yml')$$
);