-- New Listings Engineer, 2026-10-08. resolve_dealapp_city() matched the page's Arabic city only by an
-- exact city_norm, so «الجلة و تبراك» (dealapp, 61 ads, 49 active; 3 tonight: 16094523, 16094609,
-- 16093739) never met the catalog's «الجلة وتبراك» (902, منطقة الرياض) and «الصرّار» (shadda) never
-- met «الصرار» (118): no city, so not searchable at all. Same place, different spacing/diacritics.
-- The exact match still wins; only when it finds nothing does the bridge compare with spaces and
-- Arabic diacritics removed, and it still requires exactly ONE catalog city (never a guess).
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
      cand as (
        -- exact normalised name first; the spacing/diacritic-insensitive key only when exact is empty
        select g.*, lc.city_id
        from gap g
        join public.loc_catalog_city lc on lc.city_norm = normalize_ar(g.city_ar)
        union all
        select g.*, lc.city_id
        from gap g
        join public.loc_catalog_city lc
          on replace(regexp_replace(lc.city_norm, '[ًٌٍَُِّْـ]', '', 'g'), ' ', '')
           = replace(regexp_replace(normalize_ar(g.city_ar), '[ًٌٍَُِّْـ]', '', 'g'), ' ', '')
        where not exists (select 1 from public.loc_catalog_city e where e.city_norm = normalize_ar(g.city_ar))
      ),
      resolved as (
        -- one row per listing, ONLY where city_ar maps to exactly ONE catalogued city
        select c.id, c.platform, c.deal_ar, c.raw_city_en, c.city_ar,
               min(c.city_id) as city_id, count(distinct c.city_id) as n_cat
        from cand c
        group by c.id, c.platform, c.deal_ar, c.raw_city_en, c.city_ar
        having count(distinct c.city_id) = 1
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

do $$
begin
  if replace(regexp_replace(normalize_ar('الجلة و تبراك'), '[ًٌٍَُِّْـ]', '', 'g'), ' ', '')
     <> replace(regexp_replace((select city_norm from public.loc_catalog_city where city_id = 902), '[ًٌٍَُِّْـ]', '', 'g'), ' ', '') then
    raise exception 'spacing fold does not reach catalog 902 «الجلة وتبراك»';
  end if;
  if position('[ًٌٍَُِّْـ]' in pg_get_functiondef('public.resolve_dealapp_city()'::regprocedure)) = 0 then
    raise exception 'resolve_dealapp_city fold did not land';
  end if;
end $$;
