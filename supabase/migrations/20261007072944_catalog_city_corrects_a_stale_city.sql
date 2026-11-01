-- resolve_small_platform_cities(): the source's own catalog city also CORRECTS a stale city, not only
-- fills a missing one (New Listings Engineer, 2026-10-07, backlog 119 follow-through).
--
-- PR #6218 stopped muktamel filing an unmapped town under its region's capital and records the
-- town's catalog id in additional_info.catalog_city_id. But this function only picked up rows whose
-- served city was NULL, and every muktamel row scraped BEFORE that fix still had an
-- english_map_overlay location row saying «مكة المكرمة» / «الرياض» / «جازان». Those rows were never
-- NULL, so they were never corrected: muktamel 15741395 (source city «بحرة», catalog 3504) was still
-- served under مكة المكرمة a day after the fix. Measured 2026-10-07 07:30 UTC: 24 muktamel rows where
-- the served city differs from the source's catalog city (بحرة ×14 under Makkah, العمارية ×3 / ضرما /
-- القصب / وادي الدواسر under Riyadh, ضمد ×2 under Jazan, الشملي under Hail, عسفان under Makkah),
-- and 0 such rows on the other five platforms this function reads.
--
-- Needle edit: `s.city_id is null` -> `s.city_id is distinct from (catalog_city_id)`. Everything else
-- is the live definition unchanged.
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

do $$
begin
  if position('s.city_id is distinct from (r.additional_info->>''catalog_city_id'')::int'
              in pg_get_functiondef('public.resolve_small_platform_cities()'::regprocedure)) = 0 then
    raise exception 'resolve_small_platform_cities() still only fills NULL cities';
  end if;
end $$;
