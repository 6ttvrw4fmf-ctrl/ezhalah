-- Owner 2026-10-04: one night shift (Arizona), every engineer 2 hours, one after another. The 🆕 New Listings
-- Engineer moves from 10:00 UTC to 07:00 UTC (00:00 Arizona), so its computed score must land before it wakes:
-- 05:35 UTC = 22:35 Arizona, 85 minutes ahead, the same lead it had before. Same job, new time.
select cron.schedule('gh-new-listings-score', '35 5 * * *',
  $$select public.trigger_gh_workflow('new-listings-score.yml')$$);
