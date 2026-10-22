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

create or replace function public.mon_detect_catalog_city_outside_source_region()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n      int := 0;
  live   text[] := '{}';
  v_seen bigint;
  v_bad  bigint;
begin
  select count(*) into v_seen
    from public.search_listings_ar where source_table in ('muktamel_residential_listings','muktamel_commercial_listings');
  select count(*) into v_bad
    from public.search_listings_ar s
    join (select 'muktamel_residential_listings' t, id, additional_info from public.muktamel_residential_listings where active
          union all
          select 'muktamel_commercial_listings', id, additional_info from public.muktamel_commercial_listings where active) r
      on s.source_table = r.t and s.listing_id = r.id
    join public.loc_catalog_region cr on cr.region_id = s.region_id
   where r.additional_info->>'region_ar' is not null
     and s.city_id = (r.additional_info->>'catalog_city_id')::int
     and public.normalize_ar(regexp_replace(cr.region_ar, '\s+', ' ', 'g'))
         not like public.normalize_ar(regexp_replace(btrim(r.additional_info->>'region_ar'), '\s+', ' ', 'g')) || '%';

  if v_seen = 0 then
    live := live || 'catalog_city_outside_source_region:BLIND'::text;
    n := n + public.mon_raise('P2', 'catalog_city_outside_source_region', 'muktamel',
      'catalog_city_outside_source_region:BLIND',
      jsonb_build_object('blind', true, 'why', 'No muktamel listing is served, so this detector cannot see anything.'));
  elsif v_bad > 0 then
    live := live || 'catalog_city_outside_source_region:wrong_region'::text;
    n := n + public.mon_raise('P1', 'catalog_city_outside_source_region', 'muktamel',
      'catalog_city_outside_source_region:wrong_region',
      jsonb_build_object('rows', v_bad,
        'why', 'A listing is served under a catalog city whose region is not the region the source published '
            || '(muktamel «بحرة» in «منطقة مكة المكرمة» served under Jazan''s «بحرة»): the customer''s region/city pick misses it.',
        'action', 'arabic_location._pick_candidate must refuse a lone out-of-region namesake (#6323); '
            || 'resolve_small_platform_cities must require the source region; reset the location rows as 20261008 did.'));
  end if;

  perform public.mon_resolve_stale_keys('catalog_city_outside_source_region', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_catalog_city_outside_source_region' in src) > 0 then
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_aldarim_saas_unfilled_block_false'',',
    E'    ''mon_detect_aldarim_saas_unfilled_block_false'',\n    ''mon_detect_catalog_city_outside_source_region'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;
