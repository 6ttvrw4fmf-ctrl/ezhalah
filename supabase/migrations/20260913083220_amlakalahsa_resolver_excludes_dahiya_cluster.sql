-- The "ضاحية هجر" numbered-sub-plot cluster (city مeant to be الجفر) is being actively owned and
-- fixed by a separate, owner-approved change (2026-09-13): scrapers/amlakalahsa/run.py was updated
-- to collapse it to district_ar='الضاحية' at scrape time, and migrations
-- amlakalahsa_jafr_dahiya_districts_merged_to_one / _search_index_backfill / _merge_gets_a_detector
-- already handle the rows that are correctly city-tagged. resolve_amlakalahsa_locations()'s city-
-- only fallback (Part B) has no way to know a raw city_id is unreliable, so on every re-run it kept
-- re-claiming this cluster's still-mistagged rows with whatever wrong city the scraper's geocode
-- gave them (observed live: same neighborhood text resolving to الجفر/الهفوف/الفضول on different
-- rows) — permanently locking in the wrong answer, since listings_arabic_locations never updates an
-- existing row. Excluding the pattern here stops this resolver from fighting that other fix.
create or replace function public.resolve_amlakalahsa_locations()
returns table(district_matched integer, city_only_matched integer)
language plpgsql
as $function$
declare d1 int := 0; c1 int := 0;
begin
  with ins as (
    insert into listings_arabic_locations
      (index_id, platform, source_table, listing_id, purpose, raw_city_en, city_ar, region_ar, raw_district, district_ar, matched, review_reason)
    select distinct on (a.id)
           'amlakalahsa_residential_listings:'||a.id::text, 'amlakalahsa', 'amlakalahsa_residential_listings', a.id,
           case when a.transaction_type = 'Buy' then 'buy' else 'rent' end,
           a.city, cc.city_ar, cr.region_ar, a.neighborhood, d.district_ar, true,
           'amlakalahsa_district_first_match'
    from amlakalahsa_residential_listings a
    join loc_catalog_district d on d.district_norm = public.norm_district_tok(a.neighborhood)
    join loc_catalog_city cc on cc.city_id = d.city_id and cc.region_id = 5
    join loc_catalog_region cr on cr.region_id = cc.region_id
    where a.active
      and not exists (select 1 from listings_arabic_locations l where l.index_id = 'amlakalahsa_residential_listings:'||a.id::text)
    order by a.id, cc.city_id
    on conflict (index_id) do nothing
    returning 1
  ) select count(*) into d1 from ins;

  with ins2 as (
    insert into listings_arabic_locations
      (index_id, platform, source_table, listing_id, purpose, raw_city_en, city_ar, region_ar, matched, review_reason)
    select distinct on (a.id)
           'amlakalahsa_residential_listings:'||a.id::text, 'amlakalahsa', 'amlakalahsa_residential_listings', a.id,
           case when a.transaction_type = 'Buy' then 'buy' else 'rent' end,
           a.city, cc.city_ar, cr.region_ar, true, 'amlakalahsa_city_only_fallback'
    from amlakalahsa_residential_listings a
    join loc_catalog_city cc on cc.city_id = a.city_id
    join loc_catalog_region cr on cr.region_id = cc.region_id
    where a.active and a.city_id is not null
      and a.neighborhood not like 'الضاحية%'
      and not exists (select 1 from listings_arabic_locations l where l.index_id = 'amlakalahsa_residential_listings:'||a.id::text)
    order by a.id
    on conflict (index_id) do nothing
    returning 1
  ) select count(*) into c1 from ins2;

  return query select d1, c1;
end
$function$;

-- Clean up the wrongly-city-tagged rows this resolver's Part B already inserted before the
-- exclusion above existed (re-claimed after an earlier manual cleanup, since re-running is
-- idempotent-by-row, not self-correcting for a pattern it didn't yet know to avoid).
delete from listings_arabic_locations l
using amlakalahsa_residential_listings a
where l.listing_id = a.id and l.platform = 'amlakalahsa'
  and l.review_reason = 'amlakalahsa_city_only_fallback'
  and a.neighborhood like 'الضاحية%';
