-- wasalt cleanup weekly -> daily, now that drain mode is validated for wasalt (dry-run 150/150 dead,
-- 0 skipped, 5/5 hand-confirmed real 404s) and its workflow timeout was raised to 180 min for the
-- browser re-check. At cap 500/day this drains wasalt's ~15.5k backlog in ~4-5 weeks, browser-
-- verifying every row (real 404 -> delete, 200+propertyDetailsV3 -> self-heal, block -> skip).
select cron.schedule('gh-wasalt-cleanup', '0 3 * * *', $$select public.trigger_gh_workflow('wasalt-cleanup.yml')$$);
