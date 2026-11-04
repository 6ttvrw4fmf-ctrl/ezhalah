-- aqarmonthly 13905878 (aqar 6629362) — SOURCE-PUBLISHED, recorded, never repriced (backlog 1261). The ad's own page,
-- with a 31-night stay chosen the way a guest does (09 Nov – 10 Dec 2026, minimum stay 30 days), quotes
-- «السعر الإجمالي 2,841,666,638.25 ريال (31 ليلة)» = the API's monthly 2,749,999,972.5 we store ×12 as 32,999,999,670.
-- Display is unaffected either way: listingPrice() prints nothing for Aqar Monthly (owner rule 2026-10-02/26).
insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
values ('aqarmonthly_residential_listings', 13905878,
        'live ad page https://sa.aqar.fm/...-6629362 read 2026-11-04 with dates 09 Nov–10 Dec 2026: «السعر الإجمالي 2,841,666,638.25 ريال (31 ليلة)», minimum stay 30 days — the host''s own figure (PRICE = SOURCE; backlog 1261)',
        now())
on conflict (source_table, listing_id) do nothing;