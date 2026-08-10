-- Raghdan city/district bridge (2026-08-09), mirroring resolve_dealapp_city() and
-- resolve_small_platform_cities() exactly.
--
-- Raghdan stores a canonical ENGLISH city ("Jeddah") in its raw table and has no city_ar/city_id
-- column, so it is not in listing_native_location_v1's native CTE — it reaches v1 only through the
-- generic "legacy" CTE fed by listings_arabic_locations. Historically those bridge rows were
-- written at scrape time (review_reason='english_map_overlay'), which means the 168 rows repaired
-- by ops_raghdan_location_backfill_20260809 stayed unreachable until raghdan next crawled.
--
-- This resolver closes that gap and keeps it closed: it maps raghdan's English city through the
-- SAME loc_city_map overlay the scrape-time path uses (all 12 distinct live values map cleanly,
-- verified 2026-08-09), and carries the district the source published. NO new resolution logic and
-- NO guessing: an unmapped city writes nothing and the row stays honestly unresolved.
-- Region -> City -> District architecture untouched.
CREATE OR REPLACE FUNCTION public.resolve_raghdan_city()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare tbl text; total int := 0; n int;
begin
  foreach tbl in array array['raghdan_residential_listings','raghdan_commercial_listings']
  loop
    if to_regclass('public.'||tbl) is null then
      continue;
    end if;
    execute format($q$
      with gap as (
        select r.id, s.platform, s.deal_ar, r.city, r.neighborhood
        from public.search_listings_ar s
        join public.%1$I r on r.id = s.listing_id
        where s.source_table = %2$L
          and s.city_id is null
          and r.city is not null
      ),
      ins as (
        insert into public.listings_arabic_locations
          (index_id, platform, source_table, listing_id, purpose,
           raw_city_en, city_ar, region_ar, raw_district, district_ar, matched, review_reason)
        select %2$L||':'||g.id::text, g.platform, %2$L, g.id,
               case when g.deal_ar='بيع' then 'buy' else 'rent' end,
               g.city, m.city_ar, m.region_ar, g.neighborhood, g.neighborhood,
               true, 'english_map_overlay'
        from gap g
        join public.loc_city_map m on m.city_key = lower(btrim(g.city))
        on conflict (index_id) do update
          set city_ar       = excluded.city_ar,
              region_ar     = excluded.region_ar,
              raw_city_en   = excluded.raw_city_en,
              raw_district  = coalesce(public.listings_arabic_locations.raw_district, excluded.raw_district),
              district_ar   = coalesce(public.listings_arabic_locations.district_ar, excluded.district_ar),
              matched       = true,
              review_reason = 'english_map_overlay'
          where public.listings_arabic_locations.city_ar is distinct from excluded.city_ar
        returning 1
      )
      select count(*) from ins
    $q$, tbl, tbl) into n;
    total := total + coalesce(n,0);
  end loop;
  return total;
end $function$;

-- wiring: same cadence/offset style as the sibling resolvers (every 10 min, offset to spread load)
select cron.schedule(
  'resolve-raghdan-city',
  '3-59/10 * * * *',
  $$select public.resolve_raghdan_city();$$
);
