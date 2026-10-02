-- Recheck of struck rows between the daily fleet-liveness runs (owner, 2026-10-02: «whenever someone
-- on those websites removes a listing, it gets removed from ours»).
--
-- A removed ad needs three "gone" readings of its own page. gh-fleet-liveness reads each ad once a
-- day (07:17 UTC), so three readings took three days. fleet-liveness-recheck.yml re-reads ONLY the
-- rows already carrying a strike (scrapers/common/fleet_liveness.py --struck-only), under the same
-- known-live controls and per-site cap, each row at least 6 hours after its last reading.
--
-- 19:17 UTC: twelve hours after the daily run starts and twelve before the next, so a row's three
-- readings are daily, recheck, daily, and a removed ad is hidden 24 hours after its first "gone".
-- Both workflows share one concurrency group, so they never write at the same time.
select cron.schedule('gh-fleet-liveness-recheck', '17 19 * * *',
  $$select public.trigger_gh_workflow('fleet-liveness-recheck.yml')$$);
