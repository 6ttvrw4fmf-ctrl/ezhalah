-- Backlog 1261 follow-up: two of the dealapp rows read live today live in dealapp_commercial_listings, not the residential
-- table the sweep migration named, so their register rows missed. Same evidence: dealapp's own JSON-LD offers.price equals
-- the stored price (17022539 → 3,385,600,000; 23282125 → 2,200,000,000). The two mis-tabled residential register rows point
-- at no listing and are removed so the register stays exact.
insert into public.ops_price_source_verified (source_table, listing_id, evidence) values
 ('dealapp_commercial_listings', 17022539, 'Billion-price sweep 2026-11-03 (backlog 1261): read live — dealapp JSON-LD offers.price = 3385600000 = the stored price. Source-published; kept (PRICE = SOURCE), never repriced.'),
 ('dealapp_commercial_listings', 23282125, 'Billion-price sweep 2026-11-03 (backlog 1261): read live — dealapp JSON-LD offers.price = 2200000000 = the stored price. Source-published; kept (PRICE = SOURCE), never repriced.')
on conflict (source_table, listing_id) do nothing;
delete from public.ops_price_source_verified v
 where v.source_table = 'dealapp_residential_listings' and v.listing_id in (17022539, 23282125)
   and not exists (select 1 from public.dealapp_residential_listings d where d.id = v.listing_id);