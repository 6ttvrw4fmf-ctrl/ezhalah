-- DRAFT — NOT APPLIED. Apply only through the migration flow (PR green → apply → mirror the minted
-- version byte-exact → merge in the same step). New Listings Engineer, 2026-10-07.
--
-- resolve_small_platform_cities() trusts additional_info.catalog_city_id. For muktamel «بحرة» in
-- «منطقة مكة المكرمة» that id is 3504, the catalog's only exact «بحرة», which sits in منطقة جازان
-- (scraper root fixed in PR #6323). Since 20261007072944 made the resolver correct stale cities, ~21
-- listings are served under Jazan: the app's typed list offers the Makkah-region «بحرة» and finds 0.
-- 1) The resolver uses a catalog city only when it lies in the region the source published.
-- 2) Location rows it wrote for a catalog city outside the published region go back to unknown city
--    (region kept): an unknown city is honest, a city in the wrong region is a fabrication.
CREATE OR REPLACE FUNCTION public.resolve_small_platform_cities()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare tbl text; total int := 0; n int;
begin
  foreach tbl in array array[
    'mizlaj_residential_listings','fursaghyr_residential_listings',
    'souq24_residential_listings','aqaratikom_residential_listings','aqaratikom_commercial_listings',
    'muktamel_residential_listings','muktamel_commercial_listings'
  ]
  loop
    execute format($q$
      with gap as (
        select r.id, s.platform, s.deal_ar,
               (r.additional_info->>'catalog_city_id')::int as catalog_city_id,
               r.additional_info->>'region_ar' as src_region
        from public.search_listings_ar s
        join public.%1$I r on r.id = s.listing_id
        where s.source_table = %2$L
          and s.city_id is distinct from (r.additional_info->>'catalog_city_id')::int
          and r.additional_info->>'catalog_city_id' is not null
      ),
      ins as (
        insert into public.listings_arabic_locations
          (index_id, platform, source_table, listing_id, purpose, city_ar, region_ar, matched, review_reason)
        select %2$L||':'||g.id::text, g.platform, %2$L, g.id,
               case when g.deal_ar='بيع' then 'buy' else 'rent' end,
               cc.city_ar, cr.region_ar, true, 'small_platform_catalog_fallback'
        from gap g
        join public.loc_catalog_city cc on cc.city_id = g.catalog_city_id
        join public.loc_catalog_region cr on cr.region_id = cc.region_id
        where g.src_region is null
           or public.normalize_ar(regexp_replace(cr.region_ar, '\s+', ' ', 'g'))
              like public.normalize_ar(regexp_replace(btrim(g.src_region), '\s+', ' ', 'g')) || '%%'
        on conflict (index_id) do update
          set city_ar       = excluded.city_ar,
              region_ar     = excluded.region_ar,
              matched       = true,
              review_reason = 'small_platform_catalog_fallback'
          where public.listings_arabic_locations.city_ar is distinct from excluded.city_ar
        returning 1
      )
      select count(*) from ins
    $q$, tbl, tbl) into n;
    total := total + coalesce(n,0);
  end loop;
  return total;
end $function$;

update public.listings_arabic_locations l
   set city_ar = null, matched = false, review_reason = 'catalog_city_outside_source_region'
  from (select 'muktamel_residential_listings' t, id, additional_info from public.muktamel_residential_listings
        union all
        select 'muktamel_commercial_listings', id, additional_info from public.muktamel_commercial_listings) r
  join public.loc_catalog_city cc on cc.city_id = (r.additional_info->>'catalog_city_id')::int
  join public.loc_catalog_region cr on cr.region_id = cc.region_id
 where l.index_id = r.t || ':' || r.id
   and l.review_reason = 'small_platform_catalog_fallback'
   and r.additional_info->>'region_ar' is not null
   and public.normalize_ar(regexp_replace(cr.region_ar, '\s+', ' ', 'g'))
       not like public.normalize_ar(regexp_replace(btrim(r.additional_info->>'region_ar'), '\s+', ' ', 'g')) || '%';
