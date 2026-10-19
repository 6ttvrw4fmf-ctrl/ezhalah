-- ⚡ Scraping Engineer, 2026-10-12 — the early-warning robot runs AFTER the nightly crawl, not 33 min into it.
--
-- scraper_early_warning() is written to judge «the nightly small-sources crawl» (its own header), but its
-- cron fired at 04:55 UTC while the nightly small-sources-sync is dispatched at 04:22 and runs ~143 jobs
-- 18 at a time: on the last six nights its site starts ran until 05:31-06:42 UTC. At 04:55 every site the
-- queue had not reached yet still showed only YESTERDAY's row (~24 h old), so the ABSENT branch (no row in
-- 20 h) flagged it as «died before begin_run» and re-dispatched it. 2026-10-12: 37 healthy sites flagged
-- (backlog 409-446), every one with an ok run on 10-11 04:48-05:31, and a 37-site duplicate re-crawl
-- dispatched (run 38205717468, cancelled by hand). The failure branch had the same flaw: at 04:55 it judged
-- yesterday's finished run for most sites.
-- 07:45 UTC is after the latest nightly site start of the last six nights bar one queue outlier (06:42),
-- so the 20 h window now means what it says: no row since yesterday's afternoon = tonight's job never ran.
do $mig$
declare v_id bigint;
begin
  select jobid into v_id from cron.job where jobname = 'scraper-early-warning';
  if v_id is null then raise exception 'scraper-early-warning cron not found'; end if;
  perform cron.alter_job(job_id := v_id, schedule := '45 7 * * *');
end $mig$;

do $chk$
declare n int;
begin
  select count(*) into n from cron.job where jobname = 'scraper-early-warning' and schedule = '45 7 * * *' and active;
  if n <> 1 then raise exception 'scraper-early-warning not rescheduled to 07:45 UTC exactly once (%)', n; end if;
end $chk$;
