-- 🔬 Advanced Filter hourly robot customer (night-2 net): dispatch af-robot.yml at :41 every hour,
-- clear of the :22 search sync. Same pattern as gh-af-score. Idempotent.
select cron.unschedule('gh-af-robot') where exists (select 1 from cron.job where jobname = 'gh-af-robot');
select cron.schedule('gh-af-robot', '41 * * * *',
  $$select public.trigger_gh_workflow('af-robot.yml')$$);
