-- MIRROR of public.resolve_aqar_locations() so scripts/verify-committed-sql-defines-what-it-calls
-- can see this definition when other migrations reference it (owner 2026-09-12: unblocks the
-- district-fold repair chain, migration 20260912183332).
-- Refreshed 2026-09-12 for the district-fold repair chain (migration 20260912183332).
-- Verified byte-exact; md5 of everything below this header block: 313aa32eaf5cc066ce241b56f073831b
--   equals md5(pg_get_functiondef) in production, checked 2026-09-12.
CREATE OR REPLACE FUNCTION public.resolve_aqar_locations()
 RETURNS TABLE(shadow_added integer, lal_added integer)
 LANGUAGE plpgsql
AS $function$
declare s1 int:=0; s2 int:=0; l1 int:=0; l2 int:=0;
begin
  with ins as (
    insert into aqar_shadow_resolved (src_table, id, city_ar_parsed, region_ar_parsed, parsed_city_id, today_city, today_region, today_city_id)
    select distinct on (a.id) 'aqar_residential_listings', a.id, cc.city_ar, cm.region_ar, cc.city_id, cc.city_ar, cm.region_ar, cc.city_id
    from aqar_residential_listings a
    join loc_city_map cm on cm.city_key = lower(btrim(a.city))
    join loc_catalog_region cr on cr.region_ar = cm.region_ar
    join loc_catalog_city cc on cc.region_id = cr.region_id and (normalize_ar(cc.city_ar) = normalize_ar(cm.city_ar) or exists (select 1 from loc_catalog_city_alias al where al.alias_norm = normalize_ar(cm.city_ar) and al.city_id = cc.city_id))
    where a.active and not exists (select 1 from aqar_shadow_resolved s where s.src_table='aqar_residential_listings' and s.id=a.id and s.parsed_city_id is not null)
    order by a.id, cc.city_id
    on conflict (src_table, id) do update set
      city_ar_parsed = excluded.city_ar_parsed, region_ar_parsed = excluded.region_ar_parsed,
      parsed_city_id = excluded.parsed_city_id, today_city = excluded.today_city,
      today_region = excluded.today_region, today_city_id = excluded.today_city_id
    where aqar_shadow_resolved.parsed_city_id is null
    returning id, parsed_city_id
  ), lg as (insert into aqar_resolver_log(src_table, id, city_id) select 'aqar_residential_listings', id, parsed_city_id from ins returning 1)
  select count(*) into s1 from lg;

  with ins as (
    insert into aqar_shadow_resolved (src_table, id, city_ar_parsed, region_ar_parsed, parsed_city_id, today_city, today_region, today_city_id)
    select distinct on (a.id) 'aqar_commercial_listings', a.id, cc.city_ar, cm.region_ar, cc.city_id, cc.city_ar, cm.region_ar, cc.city_id
    from aqar_commercial_listings a
    join loc_city_map cm on cm.city_key = lower(btrim(a.city))
    join loc_catalog_region cr on cr.region_ar = cm.region_ar
    join loc_catalog_city cc on cc.region_id = cr.region_id and (normalize_ar(cc.city_ar) = normalize_ar(cm.city_ar) or exists (select 1 from loc_catalog_city_alias al where al.alias_norm = normalize_ar(cm.city_ar) and al.city_id = cc.city_id))
    where a.active and not exists (select 1 from aqar_shadow_resolved s where s.src_table='aqar_commercial_listings' and s.id=a.id and s.parsed_city_id is not null)
    order by a.id, cc.city_id
    on conflict (src_table, id) do update set
      city_ar_parsed = excluded.city_ar_parsed, region_ar_parsed = excluded.region_ar_parsed,
      parsed_city_id = excluded.parsed_city_id, today_city = excluded.today_city,
      today_region = excluded.today_region, today_city_id = excluded.today_city_id
    where aqar_shadow_resolved.parsed_city_id is null
    returning id, parsed_city_id
  ), lg as (insert into aqar_resolver_log(src_table, id, city_id) select 'aqar_commercial_listings', id, parsed_city_id from ins returning 1)
  select count(*) into s2 from lg;

  with ins as (
    insert into listings_arabic_locations (index_id, platform, source_table, listing_id, purpose, raw_city_en, city_ar, raw_region_en, region_ar, raw_district, district_ar, matched)
    select 'aqar_residential_listings:'||a.id::text, 'aqar', 'aqar_residential_listings', a.id, lower(a.transaction_type), a.city, cc.city_ar, a.region, cr.region_ar, a.neighborhood, d.district_ar, true
    from aqar_residential_listings a
    join loc_city_map cm on cm.city_key = lower(btrim(a.city))
    join loc_catalog_region cr on cr.region_ar = cm.region_ar
    join loc_catalog_city cc on cc.region_id = cr.region_id and (normalize_ar(cc.city_ar) = normalize_ar(cm.city_ar) or exists (select 1 from loc_catalog_city_alias al where al.alias_norm = normalize_ar(cm.city_ar) and al.city_id = cc.city_id))
    join loc_catalog_district d on d.city_id = cc.city_id and d.district_norm = public.norm_district_tok(a.neighborhood)
    where a.active and not exists (select 1 from listings_arabic_locations l where l.index_id = 'aqar_residential_listings:'||a.id::text)
    on conflict (index_id) do nothing
    returning listing_id
  ) select count(*) into l1 from ins;

  with ins as (
    insert into listings_arabic_locations (index_id, platform, source_table, listing_id, purpose, raw_city_en, city_ar, raw_region_en, region_ar, raw_district, district_ar, matched)
    select 'aqar_commercial_listings:'||a.id::text, 'aqar', 'aqar_commercial_listings', a.id, lower(a.transaction_type), a.city, cc.city_ar, a.region, cr.region_ar, a.neighborhood, d.district_ar, true
    from aqar_commercial_listings a
    join loc_city_map cm on cm.city_key = lower(btrim(a.city))
    join loc_catalog_region cr on cr.region_ar = cm.region_ar
    join loc_catalog_city cc on cc.region_id = cr.region_id and (normalize_ar(cc.city_ar) = normalize_ar(cm.city_ar) or exists (select 1 from loc_catalog_city_alias al where al.alias_norm = normalize_ar(cm.city_ar) and al.city_id = cc.city_id))
    join loc_catalog_district d on d.city_id = cc.city_id and d.district_norm = public.norm_district_tok(a.neighborhood)
    where a.active and not exists (select 1 from listings_arabic_locations l where l.index_id = 'aqar_commercial_listings:'||a.id::text)
    on conflict (index_id) do nothing
    returning listing_id
  ) select count(*) into l2 from ins;

  return query select s1+s2, l1+l2;
end $function$
;
