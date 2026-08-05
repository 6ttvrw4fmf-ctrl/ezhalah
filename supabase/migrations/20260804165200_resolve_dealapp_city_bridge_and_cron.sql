-- location-followup-pass 2026-08-04. dealapp is not wired into listing_native_location_v1's native
-- CTE (unlike alhoshan/aldarim/aqarmonthly/aqargate/sanadak/hajer/wasalt/aqar/phasea/satel); it only
-- reaches listings_arabic_locations via resolve_english_city_overlay(), which requires an ENGLISH
-- raw.city bridged through loc_city_map -- 362 rows have a genuine, unambiguous Arabic city_ar
-- (captured correctly by the scraper's own breadcrumb extraction) that never gets a chance to
-- resolve because raw.city stays NULL for these small towns (not in CITY_MAP_AR/CITY_FALLBACK_AR).
-- Mirrors resolve_dealapp_districts()'s exact safety pattern (SECURITY DEFINER, per-table loop,
-- exactly-one-catalog-match gate, ON CONFLICT DO UPDATE ... WHERE ... IS DISTINCT FROM). Verified via
-- an independent read-only dry-run immediately before this migration: 345 residential + 17
-- commercial = 362 total, 23 distinct unambiguous city_ar values.
CREATE OR REPLACE FUNCTION public.resolve_dealapp_city()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare tbl text; total int := 0; n int;
begin
  foreach tbl in array array['dealapp_residential_listings','dealapp_commercial_listings']
  loop
    execute format($q$
      with gap as (
        select r.id, s.platform, s.deal_ar, r.city as raw_city_en,
               r.additional_info->>'city_ar' as city_ar
        from public.search_listings_ar s
        join public.%1$I r on r.id = s.listing_id
        where s.source_table = %2$L
          and s.city_id is null
          and r.additional_info->>'city_ar' is not null
          and btrim(r.additional_info->>'city_ar') <> ''
      ),
      resolved as (
        -- one row per listing, ONLY where city_ar maps to exactly ONE catalogued city
        select g.id, g.platform, g.deal_ar, g.raw_city_en, g.city_ar,
               min(lc.city_id) as city_id, count(distinct lc.city_id) as n_cat
        from gap g
        join public.loc_catalog_city lc on lc.city_norm = normalize_ar(g.city_ar)
        group by g.id, g.platform, g.deal_ar, g.raw_city_en, g.city_ar
        having count(distinct lc.city_id) = 1
      ),
      ins as (
        insert into public.listings_arabic_locations
          (index_id, platform, source_table, listing_id, purpose, raw_city_en, city_ar, region_ar, matched, review_reason)
        select %2$L||':'||x.id::text, x.platform, %2$L, x.id,
               case when x.deal_ar='بيع' then 'buy' else 'rent' end,
               nullif(btrim(x.raw_city_en), ''), cc.city_ar, cr.region_ar, true, 'dealapp_arabic_city_bridge'
        from resolved x
        join public.loc_catalog_city cc on cc.city_id = x.city_id
        join public.loc_catalog_region cr on cr.region_id = cc.region_id
        on conflict (index_id) do update
          set city_ar       = excluded.city_ar,
              region_ar     = excluded.region_ar,
              raw_city_en   = excluded.raw_city_en,
              matched       = true,
              review_reason = 'dealapp_arabic_city_bridge'
          where public.listings_arabic_locations.city_ar is distinct from excluded.city_ar
        returning 1
      )
      select count(*) from ins
    $q$, tbl, tbl) into n;
    total := total + coalesce(n,0);
  end loop;
  return total;
end $function$;

-- wiring: new pg_cron entry, mirroring jobid 41 (resolve-dealapp-districts, every 10 min)
select cron.schedule(
  'resolve-dealapp-city',
  '6-59/10 * * * *',
  $$select public.resolve_dealapp_city();$$
);
