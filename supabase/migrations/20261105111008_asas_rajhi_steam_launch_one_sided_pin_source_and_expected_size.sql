-- Asas Makeen, Al Rajhi, STeam launch (owner «launch» 2026-11-05, docs/ops/FIVE_SOURCES_LAUNCH.md): the ongoing-care
-- declarations that make the fleet's detectors judge the three from their first night.
--   1. ops_platform_one_sided: Al Rajhi and STeam publish RENT only (platforms.ts allowsBuy false) — the one-sided
--      detectors read an empty Buy side as the source's truth, not a capture gap.
--   2. ops_pin_source_declared (= data/pin-sources.json, verify-pin-capture-declared.ts): Asas Makeen's pin is its
--      PROJECT page's directions link (502/507 on 2026-11-05, 507/507 after #10673); Al Rajhi's own map embed on 22
--      of 39 + the project's one pair on 9 more (31/39); STeam draws no map anywhere (none).
--   3. ops_platform_catalogue_rebase: each site's complete catalogue size, so silent_partial_success holds the crawl
--      to it from the FIRST run (a run under half raises) — crawl_went_silent only watches crawls with a 1,000-row
--      median, which none of the three has.
insert into public.ops_platform_one_sided (platform, side, proof_url, why) values
  ('mrajhi', 'rent_only', 'https://mrajhi.com.sa/units',
   'Al Rajhi Development lists yearly rentals only: 39 of 39 unit pages say «إيجار سنوي» (sitemap.xml, 2026-11-05); the site has no sale catalogue.'),
  ('steam', 'rent_only', 'https://steam-realestate.com/property/',
   'STeam Residence lists rentals only: 10 of 10 property pages carry «للايجار» (Yoast property-sitemap.xml, 2026-11-05); no sale ad exists.')
on conflict do nothing;

insert into public.ops_pin_source_declared (platform, pin_source, floor_pct, proven_on) values
  ('asasmakeen', 'project-page', 95, date '2026-11-05'),
  ('mrajhi', 'partial', 75, date '2026-11-05'),
  ('steam', 'none', 0, date '2026-11-05')
on conflict (platform) do update set pin_source = excluded.pin_source, floor_pct = excluded.floor_pct,
  proven_on = excluded.proven_on, declared_at = now();

insert into public.ops_platform_catalogue_rebase
  (platform, rebased_at, expected_rows_per_run, reason, source_rule_url, evidence, decided_by)
values
  ('asasmakeen', now(), 554,
   'New source launched 2026-11-05: its complete catalogue is the unit sitemap (554 pages = 507 listings + 47 off-plan stored hidden); every run reads all of it.',
   'https://asasmakeen.com/sitemap-units-ar.xml',
   jsonb_build_object('run', 41989287535, 'sitemap', 554, 'parsed', 554, 'listings', 507, 'offplan', 47), 'launch 2026-11-05'),
  ('mrajhi', now(), 39,
   'New source launched 2026-11-05: its complete catalogue is the /units/ pages of its sitemap.xml (39 yearly rentals in Riyadh).',
   'https://mrajhi.com.sa/sitemap.xml',
   jsonb_build_object('run', 41995087743, 'sitemap_units', 39, 'parsed', 39), 'launch 2026-11-05'),
  ('steam', now(), 10,
   'New source launched 2026-11-05: its complete catalogue is the Arabic /property/ pages of its Yoast property sitemap (10 rentals).',
   'https://steam-realestate.com/property-sitemap.xml',
   jsonb_build_object('run', 41973339082, 'property_pages', 10, 'parsed', 10), 'launch 2026-11-05')
on conflict (platform) do nothing;

do $verify$
begin
  if (select count(*) from public.ops_platform_one_sided where platform in ('mrajhi', 'steam') and side = 'rent_only') <> 2 then
    raise exception 'Al Rajhi / STeam are not both declared rent_only';
  end if;
  if (select count(*) from public.ops_pin_source_declared where platform in ('asasmakeen', 'mrajhi', 'steam')) <> 3 then
    raise exception 'a pin declaration is missing';
  end if;
  if (select count(*) from public.ops_platform_catalogue_rebase where platform in ('asasmakeen', 'mrajhi', 'steam')) <> 3 then
    raise exception 'an expected catalogue size is missing';
  end if;
  raise notice 'three sources: rent-only sides, pin sources and expected catalogue sizes declared';
end $verify$;
