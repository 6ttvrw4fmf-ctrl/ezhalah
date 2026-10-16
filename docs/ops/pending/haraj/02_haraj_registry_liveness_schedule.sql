-- Haraj joins the fleet registry (owner 2026-10-16: «licensed ads only»): its platform_registry row (what was
-- MEASURED, including the traps), its ops_liveness_registry row (CANDIDATE_PLUS_DIRECT — the same entry as
-- scrapers/common/liveness_policies.py and sql/mirrors/liveness_registry.json), and its 2-hourly crawl dispatch.
-- Insert-only on purpose: no other platform's row is touched.
insert into public.platform_registry (platform, status, kind, expected_cadence_hours, window_days, notes)
values ('haraj', 'active', 'source', 4, 7,
  'حراج (haraj.com.sa) — public classifieds; ONLY the حراج العقار posts that are (1) an OFFER by scrapers/haraj/classify.py '
  '(requests, jobs, cars, furniture, «تقبيل», broker catalogues and doubt never stored), (2) carry REGA''s ad-licence block '
  '«معلومات العقار حسب الرخصة», and (3) whose licence «تاريخ انتهاء رخصة الإعلان» has not passed. Discovery = the hourly '
  'sitemap .txt files (all categories, ~4,400 posts/h; property-titled slugs fetched, honest UA, ≤1 req/s); a STREAM, never '
  'pruned on absence; removal = own-page proof (404/410, «العرض محذوف او قديم», licence gone or expired) via fleet_liveness. '
  'Licence values print in Arabic OR REGA''s English enums (Sell/Land/Southern/Electricity/New/Seven Year). City/district = '
  'the DEED lines «وصف موقع العقار حسب الصك» first (the seller''s own words may name another district). Licence number = '
  'the page''s «رقم الترخيص NNNNNNNNNN». «عدد الغرف» is a total, never bedrooms. Land «سعر الوحدة» is a total on some ads '
  'and the metre rate on others: the ad''s own words decide. PDPL: holder / officer / seller names, phones and the '
  'advertiser number are never stored. Many licensed posts are cross-posted from DealApp (same licence number).')
on conflict (platform) do nothing;

insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace)
values ('haraj', 'CANDIDATE_PLUS_DIRECT', 168, 3)
on conflict (platform) do nothing;

do $sched$
begin
  if not exists (select 1 from cron.job where jobname = 'gh-haraj-sync') then
    -- :05 of every odd hour — clear of the :20/:22 search refresh + sync; a 2-file run takes ~45 min.
    perform cron.schedule('gh-haraj-sync', '5 1-23/2 * * *', $c$select public.trigger_gh_workflow('haraj-sync.yml')$c$);
  end if;
end $sched$;

do $verify$
begin
  if not exists (select 1 from public.platform_registry where platform = 'haraj' and status = 'active' and kind = 'source') then
    raise exception 'haraj is not registered active+source';
  end if;
  if not exists (select 1 from public.ops_liveness_registry where platform = 'haraj' and strategy = 'CANDIDATE_PLUS_DIRECT') then
    raise exception 'haraj has no CANDIDATE_PLUS_DIRECT liveness registry row';
  end if;
  if not exists (select 1 from cron.job where jobname = 'gh-haraj-sync' and command like '%haraj-sync.yml%') then
    raise exception 'gh-haraj-sync is not scheduled';
  end if;
  raise notice 'haraj: registry row, liveness row and the 2-hourly dispatch are in place';
end $verify$;
