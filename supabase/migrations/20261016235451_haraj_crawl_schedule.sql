-- Haraj's 2-hourly crawl (owner 2026-10-16), dispatched by pg_cron like every crawl here (pg_cron dispatches
-- with NO inputs, so haraj-sync.yml's defaults — the last 2 complete hourly sitemap files — are the schedule's).
-- Applied after haraj-sync.yml reached main.
do $sched$
begin
  if not exists (select 1 from cron.job where jobname = 'gh-haraj-sync') then
    -- :05 of every odd hour — clear of the :20/:22 search refresh + sync; a 2-file run takes ~45 min.
    perform cron.schedule('gh-haraj-sync', '5 1-23/2 * * *', $c$select public.trigger_gh_workflow('haraj-sync.yml')$c$);
  end if;
end $sched$;

do $verify$
begin
  if not exists (select 1 from cron.job where jobname = 'gh-haraj-sync' and command like '%haraj-sync.yml%') then
    raise exception 'gh-haraj-sync is not scheduled';
  end if;
  raise notice 'gh-haraj-sync scheduled';
end $verify$;