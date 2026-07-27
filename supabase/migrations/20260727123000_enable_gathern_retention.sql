-- Enable gathern in the retention cleanup framework + schedule its weekly run (owner: "enable gathern
-- next", 2026-07-27). Safe because the engine 404-re-verifies every candidate before deleting:
-- verified 2026-07-27 with an 18-day dry-run — of 50 rechecked, 36 were real 404s and 14 came back
-- LIVE (self-healed, NOT deleted). Production policy uses the 30-day floor + a 300 cap/anomaly gate.

insert into public.platform_retention_policy
  (platform, min_inactive_days, min_missing_count, require_source_recheck, max_delete_per_run, anomaly_floor, anomaly_factor, enabled, note)
values
  ('gathern', 30, 3, true, 300, 300, 4, true,
   '404-only: delisted unit = server 404, live/booked = 200. Source re-check reactivates live rows, deletes only hard 404s. Verified 2026-07-27 (18d dry-run: 50 rechecked → 36 dead, 14 self-healed).')
on conflict (platform) do update set
  min_inactive_days      = excluded.min_inactive_days,
  min_missing_count      = excluded.min_missing_count,
  require_source_recheck = excluded.require_source_recheck,
  max_delete_per_run     = excluded.max_delete_per_run,
  anomaly_floor          = excluded.anomaly_floor,
  anomaly_factor         = excluded.anomaly_factor,
  enabled                = excluded.enabled,
  note                   = excluded.note;

-- Weekly Sunday 03:00 UTC (staggered after aqar 02:00 / wasalt 02:30). Idempotent re-schedule.
do $$ begin perform cron.unschedule('gh-gathern-cleanup'); exception when others then null; end $$;
select cron.schedule('gh-gathern-cleanup', '0 3 * * 0', $$select public.trigger_gh_workflow('gathern-cleanup.yml')$$);
