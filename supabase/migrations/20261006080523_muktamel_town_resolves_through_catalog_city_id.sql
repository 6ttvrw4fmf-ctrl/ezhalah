-- New Listings Engineer, 2026-10-06. Muktamel joins the small-platform catalog-city resolver.
--
-- muktamel 15741395 (page «شقة سكني للإيجار في حي الفنار في بحرة», source city_ar «بحرة») was stored
-- under Makkah city: scrapers/muktamel/run.py fell back to the REGION's capital for any town missing
-- from the English city map. 36 live Bahrah listings were searchable under مكة المكرمة, none under
-- بحرة; towns with no fallback at all (سراة عبيدة, يبرين, وادي ابن هشبل) had no city and were not
-- searchable. The scraper now writes the town's unambiguous catalog id (arabic_location.to_catalog,
-- inside its published region) to additional_info.catalog_city_id and never the region's capital.
-- This adds the two muktamel tables to resolve_small_platform_cities(), the existing path that turns
-- catalog_city_id into a city for rows whose city column did not resolve (same as aqaratikom).
-- Needle edit: the table array only; the body is byte-identical to the live definition.

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

do $check$
begin
  if position('muktamel_residential_listings' in pg_get_functiondef('public.resolve_small_platform_cities()'::regprocedure)) = 0 then
    raise exception 'resolve_small_platform_cities() does not read muktamel';
  end if;
end
$check$;
