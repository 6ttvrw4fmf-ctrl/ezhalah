-- Keller Williams + Almajdiah launch (owner «launch» 2026-11-05): each site's complete catalogue size in
-- ops_platform_catalogue_rebase, so silent_partial_success holds the daily crawl to it from the FIRST run (a run under half
-- raises) — crawl_went_silent only watches crawls with a 1,000-row median, which neither has. Same declaration as the Asas
-- Makeen / Al Rajhi / STeam launch makes for its three.
insert into public.ops_platform_catalogue_rebase
  (platform, rebased_at, expected_rows_per_run, reason, source_rule_url, evidence, decided_by)
values
  ('kellerwilliams', now(), 164,
   'New source launched 2026-11-05: its complete catalogue is the site''s own list API (POST api.kw-saudiarabia.com/api/listings/list/properties, pagination.total_items); the 2026-11-05 runs read 155–167 (the site''s own total moves a few ads within an hour).',
   'https://api.kw-saudiarabia.com/api/listings/list/properties',
   jsonb_build_object('run', 41983319773, 'total_items', 164, 'unique', 164, 'mapped_ads', 161), 'launch 2026-11-05'),
  ('almajdiah', now(), 59,
   'New source launched 2026-11-05: its complete catalogue is the rental API (35 projects + 3 outer units = 59 rent units, every page to meta.last_page).',
   'https://etmaam.almajdiah.com/api/client/v1/rental-request?page=1',
   jsonb_build_object('run', 41983319773, 'projects', 35, 'units', 59), 'launch 2026-11-05')
on conflict (platform) do nothing;

do $verify$
begin
  if (select count(*) from public.ops_platform_catalogue_rebase where platform in ('kellerwilliams', 'almajdiah')) <> 2 then
    raise exception 'an expected catalogue size is missing';
  end if;
  raise notice 'kellerwilliams / almajdiah expected catalogue sizes declared';
end $verify$;
