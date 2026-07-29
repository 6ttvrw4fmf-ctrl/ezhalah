-- Enable aqarcity in the retention framework + weekly cron (owner: "enable aqarcity next", 2026-07-27).
-- Safe: engine re-checks each candidate and deletes only when the aqarcity soft-expire banner
-- «الإعلان منتهي» is present on the 200 page; every clean 200 is live → self-heal. Verified 2026-07-27:
-- 8/8 inactive marked, 12/12 active clean; 15-day dry-run rechecked 50 → 50 dead, 0 false, 0 self-heal.
insert into public.platform_retention_policy
  (platform, min_inactive_days, min_missing_count, require_source_recheck, max_delete_per_run, anomaly_floor, anomaly_factor, enabled, note)
values
  ('aqarcity', 30, 3, true, 300, 300, 4, true,
   'soft-expire: 200 + «الإعلان منتهي» banner = dead; clean 200 = live/self-heal. Verified 2026-07-27 (15d dry-run 50 rechecked -> 50 dead, 0 false).')
on conflict (platform) do update set
  min_inactive_days=excluded.min_inactive_days, min_missing_count=excluded.min_missing_count,
  require_source_recheck=excluded.require_source_recheck, max_delete_per_run=excluded.max_delete_per_run,
  anomaly_floor=excluded.anomaly_floor, anomaly_factor=excluded.anomaly_factor,
  enabled=excluded.enabled, note=excluded.note;

do $$ begin perform cron.unschedule('gh-aqarcity-cleanup'); exception when others then null; end $$;
select cron.schedule('gh-aqarcity-cleanup', '30 3 * * 0', $$select public.trigger_gh_workflow('aqarcity-cleanup.yml')$$);
