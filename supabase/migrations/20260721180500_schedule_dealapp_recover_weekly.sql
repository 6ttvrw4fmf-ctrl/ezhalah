-- Weekly Deal App inactive-row recovery (owner-approved 2026-07-21).
-- dealapp's inactive stock is dominated by mc=0 age-sweep kills of listings that are still
-- published live at the source (source audit 2026-07-21: 0 dead found in a 40-row sample) —
-- the crawler's partial enumeration keeps auto_recover_false_inactive() from ever re-seeing
-- them. This job re-checks each inactive row's REAL ad page and reactivates only what Deal App
-- itself serves as InStock; it never deactivates anything.
-- Mon 03:00 UTC — after the nightly liveness/enum jobs, before the 04:0x small-sources sync.
select cron.schedule(
  'dealapp-recover-weekly',
  '0 3 * * 1',
  $$select public.trigger_gh_workflow('dealapp-recover.yml')$$
);
