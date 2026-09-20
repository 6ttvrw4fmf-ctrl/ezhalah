-- Drain the sold/rented cleanup backlog in reasonable time (owner-approved 2026-09-20).
-- These jobs ran WEEKLY (Sun), which at a capped batch/run would take ~a year to clear aqar's 25k
-- backlog. Drain mode (PR #3377) makes each run drip a source-verified batch instead of aborting;
-- a DAILY cadence turns that into a ~2-week drain. Daily steady-state cleanup afterward is
-- low-volume and beneficial (dead listings leave search sooner), so this needs no revert.
-- cron.schedule(name, ...) re-schedules the existing named jobs in place (command unchanged).
select cron.schedule('gh-aqar-cleanup',    '0 2 * * *', $$select public.trigger_gh_workflow('aqar-cleanup.yml')$$);
select cron.schedule('gh-gathern-cleanup', '0 3 * * *', $$select public.trigger_gh_workflow('gathern-cleanup.yml')$$);
-- gh-wasalt-cleanup is intentionally LEFT WEEKLY here: wasalt drain is still held (drain_backlog
-- =false) pending its browser dry-run, and its recheck is metered-proxy + browser, so its cadence
-- is decided when it is enabled.
