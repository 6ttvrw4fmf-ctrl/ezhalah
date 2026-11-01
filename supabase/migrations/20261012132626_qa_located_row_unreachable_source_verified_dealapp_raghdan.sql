-- 🔧 Quality & Repair 2026-10-12: 15 located_row_unreachable rows whose extreme price IS the
-- source's own figure. Read live 2026-10-12 13:40–13:46 UTC from each ad's own page
-- (dealapp.sa /ar/ad-details/<id> ng-state "price"; raghdan.sa property page), each equal to the
-- stored price_total / price_annual. Owner rule: a source-published price is never hidden, at any
-- magnitude (PRICE = SOURCE, never repriced). Registering exempts the row from the price/size hide
-- (enforce_price_size_sanity); the UPDATE below re-runs that BEFORE UPDATE trigger so the rows
-- rejoin the located branch now instead of waiting for a source change to reach the hourly sync.
-- Not registered (source not readable from this container, stay hidden, routed to ⚡ with the CI
-- re-read path): aqar_commercial 15150858/15150868/15204126, aqarcity 13634535, aqarmonthly
-- 13905878, gomenassat 15709861, wasalt 12915861/13746442/16532216.
insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
select v.source_table, v.listing_id,
       '🔧 Quality & Repair 2026-10-12 (located_row_unreachable). Read live ' || v.when_utc
       || ' UTC from ' || v.url || ': page price = ' || v.page_price || ' = stored ' || v.col
       || ' ' || v.stored || '. Source-published; never repriced.',
       now()
from (values
  ('dealapp_residential_listings', 17351628::bigint, 'https://dealapp.sa/ar/ad-details/597758', '2870724010596',    'price_total',  '2870724010596',  '13:41'),
  ('dealapp_residential_listings', 17021762, 'https://dealapp.sa/ar/ad-details/598999', '117923416000',     'price_total',  '117923416000',   '13:42'),
  ('dealapp_residential_listings', 16672694, 'https://dealapp.sa/ar/ad-details/599013', '3000000000150',    'price_total',  '3000000000150',  '13:42'),
  ('dealapp_residential_listings', 14739204, 'https://dealapp.sa/ar/ad-details/528010', '199999999620',     'price_total',  '199999999620',   '13:42'),
  ('dealapp_residential_listings', 14851747, 'https://dealapp.sa/ar/ad-details/559789', '200000000000',     'price_total',  '200000000000',   '13:45'),
  ('dealapp_residential_listings', 14872520, 'https://dealapp.sa/ar/ad-details/567879', '4403900000',       'price_total',  '4403900000',     '13:45'),
  ('dealapp_residential_listings', 15310410, 'https://dealapp.sa/ar/ad-details/436309', '253999999746',     'price_total',  '253999999746',   '13:45'),
  ('dealapp_residential_listings', 16094506, 'https://dealapp.sa/ar/ad-details/539010', '80000000000',      'price_total',  '80000000000',    '13:45'),
  ('dealapp_residential_listings', 16153423, 'https://dealapp.sa/ar/ad-details/603785', '3715887835.14',    'price_total',  '3715887835',     '13:45'),
  ('dealapp_residential_listings', 16239810, 'https://dealapp.sa/ar/ad-details/602026', '25032906759.2',    'price_total',  '25032906759',    '13:45'),
  ('dealapp_residential_listings', 16671588, 'https://dealapp.sa/ar/ad-details/605592', '100000000000',     'price_total',  '100000000000',   '13:45'),
  ('dealapp_residential_listings', 16672996, 'https://dealapp.sa/ar/ad-details/597344', '34533754170.75',   'price_total',  '34533754170',    '13:46'),
  ('dealapp_residential_listings', 17346648, 'https://dealapp.sa/ar/ad-details/594699', '10000000000',      'price_annual', '10000000000',    '13:46'),
  ('dealapp_commercial_listings',  15807897, 'https://dealapp.sa/ar/ad-details/405396', '7380000000',       'price_total',  '7380000000',     '13:46'),
  ('raghdan_residential_listings', 12586145, 'https://raghdan.sa/ar/property/860433094227/', '10000000000', 'price_annual', '10000000000',    '13:46')
) as v(source_table, listing_id, url, page_price, col, stored, when_utc)
where not exists (select 1 from public.ops_price_source_verified e
                   where e.source_table = v.source_table and e.listing_id = v.listing_id);

update public.search_listings_ar s
   set production_ready = true
  from public.ops_price_source_verified v
 where v.source_table = s.source_table and v.listing_id = s.listing_id
   and v.evidence like '🔧 Quality & Repair 2026-10-12 (located_row_unreachable)%'
   and not s.production_ready
   and s.city_id is not null and s.region_id is not null
   and not exists (select 1 from public.platform_registry pr
                    where pr.platform = s.platform and pr.status = 'dormant');