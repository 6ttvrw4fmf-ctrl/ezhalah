-- Property Finder's DAILY crawl (owner launch 2026-11-04, docs/ops/PROPERTYFINDER_LAUNCH.md), dispatched by pg_cron like
-- every crawl here (pg_cron dispatches with NO inputs, so propertyfinder-sync.yml runs its default: a real write).
-- The liveness tier is SOURCE_LIST_PRESENCE («own full list = the check»): every day the crawl walks the four complete
-- category lists; an ad missing from 3 COMPLETE walks goes inactive (run.py prunes only when every side walked fully).
-- 05:55 UTC: a minute no other job uses (cron_schedule.json), clear of the :20/:22 search refresh + sync and the :00
-- matview slot; the ~8-minute walk lands before the 06:16 location refresh and the 06:22 sync, and before the
-- 07:08 facts reader (facts-extract.yml) reads the day's new ads.
do $sched$
begin
  if not exists (select 1 from cron.job where jobname = 'gh-propertyfinder-sync') then
    perform cron.schedule('gh-propertyfinder-sync', '55 5 * * *', $c$select public.trigger_gh_workflow('propertyfinder-sync.yml')$c$);
  end if;
end $sched$;

do $verify$
begin
  if not exists (select 1 from cron.job where jobname = 'gh-propertyfinder-sync' and schedule = '55 5 * * *'
                   and active and command like '%propertyfinder-sync.yml%') then
    raise exception 'gh-propertyfinder-sync is not scheduled';
  end if;
  raise notice 'gh-propertyfinder-sync scheduled daily at 05:55 UTC';
end $verify$;
