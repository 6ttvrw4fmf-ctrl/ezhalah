-- Two registry addenda for the thirty-five-platform batch (PR #3516's recipe had none; both
-- conditions are new with this batch).
--
-- 1. rightcompound and azure publish exactly ONE rent period as a PLATFORM statement, not a
--    per-unit token, so every priced unit carries rent_period='annual' from the source itself:
--    rightcompound — /api/v1/compounds rentPeriod=year and /llms.txt «Prices are ANNUAL rent in
--    Saudi Riyals (SAR), not monthly» (scrapers/rightcompound/run.py header, additional_info.
--    period_statement on every row); azure — the scraper reads ONLY the page's own «Paid Annually»
--    tab (data-tabs-content-id="paid-type-tab-annually"; the monthly figure is an instalment
--    breakdown kept in additional_info). Both are in SINGLE_PERIOD_PLATFORMS in the fleet tests.
--    Registering them here is what keeps mon_detect_manufactured_rent_period from raising once
--    either table holds 20 rent rows — the same reason aqarmonthly/gathern are registered.
insert into public.ops_rent_period_single_value_ok (table_name, only_value, reason)
select v.table_name, v.only_value, v.reason
from (values
  ('rightcompound_residential_listings', 'annual',
   'platform-level statement, not a parser default: /api/v1/compounds rentPeriod=year; /llms.txt «Prices are ANNUAL rent in Saudi Riyals (SAR), not monthly». Recorded on every row as additional_info.period_statement (scrapers/rightcompound/run.py).'),
  ('azure_residential_listings', 'annual',
   'the scraper reads only the page''s own «Paid Annually» tab (data-tabs-content-id="paid-type-tab-annually"); the monthly figure is the instalment breakdown, kept in additional_info, never a period (scrapers/azure/run.py).')
) as v(table_name, only_value, reason)
where not exists (select 1 from public.ops_rent_period_single_value_ok o where o.table_name = v.table_name);

-- 2. dwelleo's full detailed walk is measured at ~3.7 h (11,480 rows × ~0.8 s detail + the
--    inter-request pause; scrapers/dwelleo/run.py header) inside a 360-minute GitHub job. The
--    detector's flat 3-hour floor would raise a P1 during EVERY healthy dwelleo run and self-heal
--    at end_run — a daily false alarm. A run killed at the 6 h cap is still caught the moment it
--    passes it. Same body as 20260808062049 otherwise.
create or replace function public.mon_detect_dangling_scrape_run()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare rec record; n int := 0;
begin
  for rec in
    select s.platform,
           count(*)                                   as dangling_runs,
           min(s.started_at)                          as oldest,
           max(s.started_at)                          as newest,
           (array_agg(s.id order by s.started_at desc))[1:5] as sample_run_ids
    from public.scrape_runs s
    where s.ok is null
      and s.finished_at is null
      and s.started_at between now() - interval '48 hours'
                           -- ponytail: one-platform floor; a platform_cadence.max_run_hours column when a second platform needs one
                           and now() - (case when s.platform = 'dwelleo' then interval '6 hours' else interval '3 hours' end)
    group by s.platform
  loop
    n := n + public.mon_raise('P1','dangling_scrape_run', rec.platform,
      'dangling_scrape_run:'||rec.platform||':'||to_char(rec.newest,'YYYY-MM-DD'),
      jsonb_build_object(
        'platform', rec.platform,
        'dangling_runs', rec.dangling_runs,
        'oldest', rec.oldest,
        'newest', rec.newest,
        'sample_run_ids', rec.sample_run_ids,
        'why','scrape_runs row started but never finalized (ok and finished_at both still null) — the job was killed before end_run(), most often the GitHub Actions timeout-minutes budget. Rows it upserted are kept, but prune/sold-pin never ran and the platform''s last-OK freshness signal did not advance. Fix the run budget or the per-run cap; never hand-edit the row.'));
  end loop;

  -- self-heal: resolve once the platform has no dangling run left in the window (the run
  -- finalized late, or it aged past 48h)
  update public.alert_event a set resolved_at = now()
  where a.kind = 'dangling_scrape_run'
    and a.resolved_at is null
    and not exists (
      select 1 from public.scrape_runs s
      where s.platform = a.platform
        and s.ok is null
        and s.finished_at is null
        and s.started_at between now() - interval '48 hours'
                             and now() - (case when s.platform = 'dwelleo' then interval '6 hours' else interval '3 hours' end));

  return n;
end $function$;
