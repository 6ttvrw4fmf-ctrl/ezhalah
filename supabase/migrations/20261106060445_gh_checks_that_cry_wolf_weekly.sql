-- Weekly dispatch of checks-that-cry-wolf.yml on the database clock (owner 2026-11-06: «test every alarm … so they
-- don't stop»). The robot lists every check whose verdict flips red/green on unchanged code and goes red (→ alert_event)
-- at >= 3 flips in 7 days. GitHub's own schedule fired migration-auto-mirror 3 times in a day (2026-11-05), so this one
-- is dispatched here. Slot Monday 07:27 UTC: chosen with verify-cron-slot-discipline.ts (06:53, 09:13 and the
-- workflow's own 06:33 would each stack a third job on one instant).
select cron.schedule('gh-checks-that-cry-wolf', '27 7 * * 1', $$select public.trigger_gh_workflow('checks-that-cry-wolf.yml')$$);