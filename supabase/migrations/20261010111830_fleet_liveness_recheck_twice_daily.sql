-- Fleet liveness recheck twice a day, so a removed ad leaves within about half a day (♻️ lifecycle,
-- 2026-10-10). Measured that night: reinvest unit 13257993 (own API answered 404 at the 07:35 UTC
-- daily read, strike 2 of 3) was the one dead ad the 09:05 UTC dead-visible score found on a
-- customer's screen, and under the single 19:17 UTC recheck it would stay visible until that
-- evening. fleet-liveness-recheck.yml re-reads ONLY rows already carrying a strike, under the same
-- known-live controls, per-site cap and REPROBE_MIN_HOURS = 6 (scrapers/common/fleet_liveness.py),
-- so a second dispatch costs a few dozen reads a day and raises no cap.
--
-- 14:17 UTC: seven hours after the daily run starts, so every row the daily run stamped before
-- 08:17 is rested (>= 6 h) and takes its second reading. 20:47 UTC: six and a half hours later,
-- so a row read at 14:17 is rested again and takes its third. A removed ad read dead at 07:17 is
-- therefore hidden at 20:47 the same day (about 13 h); one the daily run reached later is hidden
-- at the next 07:17 (about 23 h), as before. Nothing else changes: same workflow, same code path,
-- same concurrency group as the daily run (fleet-liveness), so they never write at the same time.
select cron.unschedule('gh-fleet-liveness-recheck');
select cron.schedule('gh-fleet-liveness-recheck', '17 14 * * *',
  $$select public.trigger_gh_workflow('fleet-liveness-recheck.yml')$$);
select cron.schedule('gh-fleet-liveness-recheck-2', '47 20 * * *',
  $$select public.trigger_gh_workflow('fleet-liveness-recheck.yml')$$);
