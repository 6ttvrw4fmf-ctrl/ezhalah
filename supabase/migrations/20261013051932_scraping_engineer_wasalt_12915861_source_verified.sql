-- ⚡ Scraping Engineer 2026-10-13 (backlog 478, located_row_unreachable): wasalt 12915861 read from CI
-- (source-reread run 38350369885, 05:17 UTC, the residential proxy): the ad's own page data
-- propertyDetailsV3.propertyInfo.salePrice = 4,544,010,000 = stored price_total (title «Land 870.5 SQM
-- Facing South on 32m Width Street»). Source-published; never repriced (PRICE = SOURCE). Registering
-- exempts it from the price/size hide; the UPDATE re-runs the BEFORE UPDATE trigger so it rejoins now.
-- Not registered: 13746442 (the page now prints salePrice 8,925,000 while we store 3,346,875,000: the
-- next crawl refreshes it, so it stays hidden until then); 16532216 (the page answers 404: dead at
-- source, the liveness path's to retire).
insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
select 'wasalt_residential_listings', 12915861,
       '⚡ Scraping Engineer 2026-10-13 (located_row_unreachable, backlog 478). Read 05:17 UTC from CI '
       || '(source-reread run 38350369885) at https://wasalt.sa/en/property/land-8705-sqm-facing-south-on-32m-width-street-5910581: '
       || 'propertyInfo.salePrice = 4544010000 = stored price_total 4544010000. Source-published; never repriced.',
       now()
where not exists (select 1 from public.ops_price_source_verified e
                   where e.source_table = 'wasalt_residential_listings' and e.listing_id = 12915861);

update public.search_listings_ar s
   set production_ready = true
 where s.source_table = 'wasalt_residential_listings' and s.listing_id = 12915861
   and not s.production_ready
   and s.city_id is not null and s.region_id is not null
   and not exists (select 1 from public.platform_registry pr
                    where pr.platform = s.platform and pr.status = 'dormant');
