-- gathern-liveness.yml moves from GitHub's `schedule:` trigger to pg_cron (2026-09-28, Lifecycle
-- Engineer finding; branch fix/gathern-liveness-drain).
--
-- MEASURED: the workflow declared '0 1,7,11,15,19,23 * * *' = 6 runs/day (owner directive
-- 2026-09-24). scrape_runs platform='gathern_liveness' 2026-09-24 02:24 -> 2026-09-28 01:30 holds
-- 16 runs in ~4 days (~4/day, one orphaned): a third of the slots never fired and the rest landed
-- 1-4h late (the 11:00 slot at 12:09-12:55). Same starvation 20260829073551 measured on
-- alert-dispatch.yml; pg_cron fires to the second, and the other liveness jobs already use it.
--
-- CREATED INACTIVE ON PURPOSE. Until the PR merges, main's workflow still carries its own
-- `schedule:` AND treats a no-input dispatch as a DRY RUN, so an active job now would double-fire
-- against gathern's GLOBAL ~2 req/s detail-page budget. The PR removes `schedule:` and makes a
-- no-input dispatch from main apply. Activate in the same breath as the merge:
--   select cron.alter_job((select jobid from cron.job where jobname = 'gh-gathern-liveness'),
--                         active := true);
--
-- Slots: same hours as before (dodging gh-gathern-cleanup 03:00 and gh-gathern-daily 04:40), at
-- minute :37, whose only hourly neighbour is sync-search-first-seen-at. One net.http_post, no load.
select cron.schedule('gh-gathern-liveness', '37 1,7,11,15,19,23 * * *',
  $cron$select public.trigger_gh_workflow('gathern-liveness.yml')$cron$);
select cron.alter_job((select jobid from cron.job where jobname = 'gh-gathern-liveness'),
                      active := false);