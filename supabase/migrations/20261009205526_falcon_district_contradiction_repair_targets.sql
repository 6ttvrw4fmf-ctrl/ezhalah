-- 🦅 Falcon 2026-10-09, step 1 of 2: the served-district-contradicts-source class (open P1 alerts
-- district_contradicts_source since 10-05, owned by a deleted routine). mon_district_contradicts_source
-- lists 1,524 served rows; ~1,000 are the Hofuf «ضاحية هجر» spelling variants (an owner naming decision,
-- 🔧 10-09, NOT touched here). The rest — dealapp 405, aqar 51 (+10 with no snapshot row), mustqr 12,
-- gathern 3 — are served straight from listings_arabic_locations, the frozen snapshot the location view
-- falls back to when the native arm yields no district: in every one of them snapshot.district_ar
-- equals what we display and never equals what the source publishes today (e.g. dealapp 2121064
-- source «حي الروضة» served «حي شرق المطار د»). Rule 2 (exact location) and rule 10 (the district is
-- the platform table's own neighbourhood) are both broken for these customers.
-- This step materialises the exact target set with its evidence (what the source says, what we
-- display, and the source district resolved against the city's own catalog — NULL when it does not
-- resolve, per the detector's own instruction «resolve to NULL rather than guessing»). Kept as an
-- evidence table; step 2 updates the snapshot from it.
create table public.ops_falcon_district_repair_2026_10_09 as
with c as (
  select c.source_table, c.listing_id, c.platform, c.city_ar, c.source_says, c.we_display, s.city_id
    from public.mon_district_contradicts_source c
    join public.search_listings_ar s on s.source_table = c.source_table and s.listing_id = c.listing_id
   where c.platform in ('dealapp','aqar','mustqr','gathern')
     and public.norm_district_tok(c.source_says) !~ 'هجر|الضاحي|ضاحية'
     and public.norm_district_tok(c.we_display) !~ 'هجر|الضاحي|ضاحية')
select c.*,
       (select cd.canonical_district_ar from public.loc_canonical_district cd
         where cd.city_id = c.city_id and cd.district_norm = public.norm_district_tok(c.source_says)
         limit 1) as resolved_district_ar,
       now() as captured_at
  from c;
comment on table public.ops_falcon_district_repair_2026_10_09 is
  'Evidence for the 2026-10-09 Falcon repair of listings_arabic_locations rows that served a district the source never published (mon_district_contradicts_source, non-هجر rows). resolved_district_ar is the source district resolved against the city catalog, NULL when it does not resolve.';