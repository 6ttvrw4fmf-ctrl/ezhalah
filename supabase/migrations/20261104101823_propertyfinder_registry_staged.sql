-- Property Finder Saudi joins platform_registry STAGED (owner approved the source 2026-11-04 and launches it
-- himself). status 'retired' is the registry's only "deliberately out of search scope" value, and it is the
-- one every detector already reads that way: mon_unreachable_listing_tables() exempts a *_listings table whose
-- platform is retired (the two propertyfinder tables are no arm of active_listing_ids_v2 until launch),
-- mon_detect_registry_orphans() stops calling the propertyfinder scrape_runs label unregistered,
-- gen-searchable-tables.ts keeps retired tables out of the app's search scope, and
-- reactivate_recovered_dormant_platforms() never touches it ('dormant' would self-launch on the first ok crawl).
-- The launch is docs/ops/PROPERTYFINDER_LAUNCH.md; it sets this row active in the same change that wires search.
insert into public.platform_registry (platform, status, kind, expected_cadence_hours, window_days, notes)
values ('propertyfinder', 'retired', 'source', 24, 7,
  'STAGED — NOT LAUNCHED (owner 2026-11-04: «approved, legal»; the owner flips it on himself, see '
  'docs/ops/PROPERTYFINDER_LAUNCH.md). Property Finder Saudi (propertyfinder.sa). Read ONLY from the four Arabic '
  'category pages and their standalone ?page=N (robots.txt allows them; /search?*, /ajax/ and every filter '
  'parameter are disallowed and never fetched; single-ad /plp/ pages answer 403 to robots and are never fetched). '
  'Honest UA «Ezhalah-bot/1.0», ≤1 req/s, any 403/429/503/CAPTCHA stops the run. Each page''s __NEXT_DATA__ '
  'searchResult.listings[].property carries the whole ad (type, offering, price{value,period,is_hidden}, size, '
  'beds/baths, location_tree REGION/CITY/DISTRICT, coordinates, amenities, furnished, completion_status, REGA '
  'licence «rera», listed_date, payment_method, rnpm). PRICE and PERIOD as published (sell/yearly/monthly; '
  'weekly/daily keep the price in evidence, no period bucket); is_hidden → price on request. Off-plan '
  '(completion_status off_plan*) is stored inactive, never shown. PDPL: agent/broker/client objects and '
  'contact_options are never stored; phones in the description are redacted. PF badges (is_great_value, '
  'is_high_demand, is_price_drop, is_verified…) are stored raw in source_capture only, never surfaced. Liveness: '
  'the site''s own complete list (unique ids ≥ 98% of the side''s total_count, every page read) is the check; an '
  'ad missing from 3 complete crawls goes inactive; a partial or failed crawl changes nothing.')
on conflict (platform) do nothing;

do $verify$
begin
  if not exists (select 1 from public.platform_registry
                  where platform = 'propertyfinder' and status = 'retired' and kind = 'source') then
    raise exception 'propertyfinder is not registered staged (retired+source)';
  end if;
  raise notice 'propertyfinder: registry row staged (retired+source) — out of every search scope until launch';
end $verify$;
