-- sync-search-posted-at moves to the one stepped slot the cron discipline leaves free (scripts/verify-cron-slot-discipline.ts,
-- owner decision 6): '3-59/10' put a third job on :43 every hour. At :29 and :59 it starts alone, outside every hog's
-- p95 window. 50,000 rows an hour still finish the backlog; new rows are kept exact by its first pass.
select cron.alter_job((select jobid from cron.job where jobname = 'sync-search-posted-at'), schedule := '29-59/30 * * * *');