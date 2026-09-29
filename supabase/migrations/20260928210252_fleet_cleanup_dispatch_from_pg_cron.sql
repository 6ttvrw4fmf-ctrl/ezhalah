-- One daily 30-day retention cleanup for every enabled site without a cleanup workflow of its own
-- (owner, 2026-09-28: «every day … it removes and hides then deletes it, for everything»).
-- .github/workflows/fleet-cleanup.yml runs `python -m scrapers.common.cleanup --all-enabled`:
-- every site whose platform_retention_policy is enabled, except aqar, gathern and wasalt (they keep
-- their own daily jobs), each through the unchanged engine and its own caps and guards.
--
-- 06:46 UTC: off 03:00 (gathern/wasalt cleanup) and 04:40 (gathern crawl), after the small-sources
-- crawl (04:22) and the aqarmonthly crawl (06:00) have refreshed the known-live controls. One
-- net.http_post, no database load.
--
-- CREATED INACTIVE ON PURPOSE. Until the PR merges, main has no fleet-cleanup.yml and no
-- --all-enabled, so an active job would only fail to dispatch. Activate in the same breath as the
-- merge, and retire aqarcity's weekly job at the same moment (aqarcity is enabled, so the fleet run
-- covers it daily from then on; aqarcity-cleanup.yml stays for manual bounded runs):
--   select cron.alter_job((select jobid from cron.job where jobname = 'gh-fleet-cleanup'), active := true);
--   select cron.alter_job((select jobid from cron.job where jobname = 'gh-aqarcity-cleanup'), active := false);
select cron.schedule('gh-fleet-cleanup', '46 6 * * *',
  $cron$select public.trigger_gh_workflow('fleet-cleanup.yml')$cron$);
select cron.alter_job((select jobid from cron.job where jobname = 'gh-fleet-cleanup'),
                      active := false);
