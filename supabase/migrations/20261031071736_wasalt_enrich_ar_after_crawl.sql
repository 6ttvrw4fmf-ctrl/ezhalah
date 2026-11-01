-- New Wasalt ads waited ~10 h for their map pin and Advanced Filter fields (🆕 2026-10-31).
-- Both come only from the Arabic detail page (ar_data), which gh-wasalt-enrich-ar fetches. That job ran
-- at 00:15 and 12:15 UTC, while the daily crawl (gh-wasalt-res 02:40 / gh-wasalt-com 02:45) finishes
-- ~04:20. So every new ad sat ~8-10 h without either. Measured 07:10 UTC that day: 842 Wasalt
-- arrivals, 0 pins (every earlier day 100% once enriched), AF fields 1.4 vs 3.8 over 7 days.
-- The fix moves the same two runs to 05:15 and 17:15: about an hour after the crawl ends. Spend stays
-- the same (2 runs a day, the 2026-09-18 proxy-cost ruling stands); only the order changes.
do $mig$
declare v_enr int;
begin
  select jobid into v_enr from cron.job where jobname = 'gh-wasalt-enrich-ar';
  if v_enr is null then raise exception 'gh-wasalt-enrich-ar is missing'; end if;
  perform cron.alter_job(v_enr, schedule => '15 5,17 * * *');
end $mig$;

do $verify$
declare s text; a boolean;
begin
  select schedule, active into s, a from cron.job where jobname = 'gh-wasalt-enrich-ar';
  if s <> '15 5,17 * * *' or not a then
    raise exception 'enrich-ar schedule did not take or job inactive: % %', s, a;
  end if;
  if (select count(*) from cron.job where active and schedule = '15 5,17 * * *') <> 1 then
    raise exception 'the new enrich-ar slot collides with another active job';
  end if;
end $verify$;
