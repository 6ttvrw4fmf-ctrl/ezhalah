-- location-followup-pass 2026-08-04. mizlaj/fursaghyr/souq24/aqaratikom's scraper-side catalog
-- fallback (this pass) writes a resolved catalog_city_id/catalog_region_id into additional_info,
-- but these 4 tables have no city_id/region_id column and aren't wired into
-- listing_native_location_v1's native CTE -- without this resolver the fix is a correct, safe
-- no-op on search results. Mirrors resolve_dealapp_city()'s exact pattern: writes city_ar (+
-- region_ar) into listings_arabic_locations, picked up generically by v1's "legacy" CTE. Since
-- catalog_city_id is already resolved (unambiguous, computed at scrape time), this just looks up
-- the corresponding city_ar/region_ar -- no re-resolution/ambiguity risk.
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
    'souq24_residential_listings','aqaratikom_residential_listings','aqaratikom_commercial_listings'
  ]
  loop
    execute format($q$
      with gap as (
        select r.id, s.platform, s.deal_ar,
               (r.additional_info->>'catalog_city_id')::int as catalog_city_id
        from public.search_listings_ar s
        join public.%1$I r on r.id = s.listing_id
        where s.source_table = %2$L
          and s.city_id is null
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

-- wiring: pg_cron entry, mirroring resolve-dealapp-city (every 10 min, offset to spread load)
select cron.schedule(
  'resolve-small-platform-cities',
  '7-59/10 * * * *',
  $$select public.resolve_small_platform_cities();$$
);
