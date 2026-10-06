-- ♻️ Lifecycle Engineer, 2026-10-06. Two lifecycle jobs merged in PR #6238 run from pg_cron (a
-- workflow's own `schedule:` is not a schedule here; trigger_gh_workflow cannot pass inputs, so each
-- is its own dispatch-only workflow file).
--   gh-aqar-liveness-recheck  13:00 UTC: re-read only struck aqar/aqarmonthly rows (fast confirm,
--                             ~12 h after the 01:00 sweep; readings >= 6 h apart in code).
--   gh-gathern-recheck-dead   15:07 UTC: re-read the newest 1,500 hidden gathern units and restore any
--                             whose own page answers 200 (restore-only; clear of the :37 hourly sweep).
select cron.schedule('gh-aqar-liveness-recheck', '0 13 * * *', $$select public.trigger_gh_workflow('aqar-liveness-recheck.yml')$$);
select cron.schedule('gh-gathern-recheck-dead', '7 15 * * *', $$select public.trigger_gh_workflow('gathern-recheck-dead.yml')$$);
