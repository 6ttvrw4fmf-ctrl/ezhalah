-- A home whose district names a retired «district that is really a town» moves to that town even when the site
-- filed it under a NEIGHBOURING city of the same region — but only when its OWN pin sits within 15 km of the town
-- (🆕 2026-11-11; backlog #894 «one name, one list», owner 2026-10-26).
--
-- Measured 2026-11-11 07:45 UTC: «حي جواثا» was retired under الاحساء (3677) as «is the city جواثا (city 3700)».
-- retired_place_remap_rows() moved a home only when its city WAS 3677 (g2d.city_id = v1.city_id), so the 10
-- aqalemhajer homes filed under الاحساء moved, while the homes arkaan / aqar / dealapp / abralosol file under الهفوف
-- (12) kept a district the display hides on purpose and stayed in no picker: a customer who picks جواثا never saw
-- them. Two of tonight's arkaan arrivals (26298570, 26298575, «أرض سكنية للبيع في حي جواثا») had that fate.
-- The same shape: aqalemhajer homes under الاحساء whose district is «المبرز» (retired under الهفوف as city 2748).
--
-- The new arm g2n is the old g2 with ONE relaxation and ONE new gate:
--   * the home's city may differ from the retired row's city, inside the SAME region (as before: never a region cross);
--   * the home must carry its own pin, within 15 km of the town's served-ad centre (loc_city_center). A home without
--     a pin, or farther away, stays where it is (never a guess). Dry run 2026-11-11: 32 homes, every pinned one within
--     5.6 km of its town (arkaan 17, aqar 6, aqalemhajer 4, abralosol 3, dealapp 2); 41 unpinned stay.
-- Nothing is deleted; the source tables are untouched (SOURCE IS TRUTH). The hourly job 17 (:16) refreshes the
-- corrections and the :22 sync serves them.

create or replace function public.retired_place_remap_rows()
returns table(source_table text, listing_id bigint, old_city_id integer, new_city_id integer, kind text)
language sql stable security definer set search_path = public as $$
  with tc as (
    select c.city_id as src, c.region_id as src_region,
           coalesce((regexp_match(c.retired_why, 'duplicate of city (\d+)'))[1],
                    (regexp_match(c.retired_why, '\(city (\d+)'))[1])::int as t1,
           c.retired_why like 'duplicate of city%' as dup
      from public.loc_catalog_city c where c.retired_at is not null
  ), tc2 as (
    select tc.src, tc.src_region,
           case when t.retired_at is null then tc.t1 end as tgt,
           tc.dup
      from tc join public.loc_catalog_city t on t.city_id = tc.t1
  ), g34 as (
    select v1.source_table, v1.listing_id, v1.city_id as old_city_id, tc2.tgt as new_city_id,
           case when tc2.dup then 'duplicate_city' else 'city_is_district' end as kind
      from public.listing_native_location_v1 v1
      join tc2 on tc2.src = v1.city_id
      join public.loc_catalog_city n on n.city_id = tc2.tgt
     where tc2.tgt is not null and (n.region_id = tc2.src_region or tc2.dup)
  ), g2d as (
    select d.city_id, public.district_key_letters(d.district_ar) as k,
           (regexp_match(d.retired_why, '\(city (\d+)'))[1]::int as tgt
      from public.loc_catalog_district d
     where d.retired_at is not null and d.retired_why like 'is the city%'
  ), g2 as (
    select v1.source_table, v1.listing_id, v1.city_id, g2d.tgt, 'district_is_city'
      from public.listing_native_location_v1 v1
      left join public.district_recovery dr on dr.source_table = v1.source_table and dr.listing_id = v1.listing_id
      join g2d on g2d.city_id = v1.city_id
              and g2d.k = public.district_key_letters(coalesce(nullif(btrim(v1.district_ar), ''), dr.district_ar))
      join public.loc_catalog_city o on o.city_id = v1.city_id
      join public.loc_catalog_city n on n.city_id = g2d.tgt
     where n.retired_at is null and n.region_id = o.region_id
  ), g2n as (
    -- the same retired town named under a NEIGHBOURING city of the same region: moved only on the home's own pin
    select distinct on (v1.source_table, v1.listing_id)
           v1.source_table, v1.listing_id, v1.city_id, g2d.tgt, 'district_is_city_by_pin'
      from public.listing_native_location_v1 v1
      left join public.district_recovery dr on dr.source_table = v1.source_table and dr.listing_id = v1.listing_id
      join g2d on g2d.city_id <> v1.city_id and g2d.tgt <> v1.city_id
              and g2d.k = public.district_key_letters(coalesce(nullif(btrim(v1.district_ar), ''), dr.district_ar))
      join public.loc_catalog_city o on o.city_id = v1.city_id
      join public.loc_catalog_city n on n.city_id = g2d.tgt
      join public.loc_city_center cc on cc.city_id = g2d.tgt
      join public.search_listings_ar s on s.source_table = v1.source_table and s.listing_id = v1.listing_id
     where n.retired_at is null and n.region_id = o.region_id
       and s.latitude is not null and s.longitude is not null
       and 111.0 * sqrt(power(s.latitude::float8 - cc.lat, 2)
                        + power((s.longitude::float8 - cc.lng) * cos(radians(cc.lat)), 2)) <= 15
     order by v1.source_table, v1.listing_id, g2d.tgt
  )
  select * from g34 union all select * from g2 union all select * from g2n;
$$;

-- Apply-time proof, both directions, on tonight's real rows:
--   (a) arkaan 26298570 (pin 2 km from جواثا, filed under الهفوف) now moves to جواثا (3700);
--   (b) no move crosses a region or lands on a retired town, and every by-pin move is within 15 km.
do $chk$
declare bad int;
begin
  if not exists (select 1 from public.retired_place_remap_rows()
                  where source_table = 'arkaan_residential_listings' and listing_id = 26298570 and new_city_id = 3700) then
    raise exception 'retired_place_remap: arkaan 26298570 («حي جواثا», الهفوف, pin by جواثا) is not moving to جواثا (3700)';
  end if;
  if not exists (select 1 from public.retired_place_remap_rows() where old_city_id = 1071 and new_city_id = 1061) then
    raise exception 'retired_place_remap: الهياثم (1071) homes are no longer moving to الخرج (1061)';
  end if;
  select count(*) into bad from public.retired_place_remap_rows() r
    join public.loc_catalog_city o on o.city_id = r.old_city_id join public.loc_catalog_city n on n.city_id = r.new_city_id
   where o.region_id <> n.region_id and r.kind <> 'duplicate_city';
  if bad > 0 then raise exception 'retired_place_remap: % homes would cross a region without being the same town', bad; end if;
  select count(*) into bad from public.retired_place_remap_rows() r
    join public.loc_catalog_city n on n.city_id = r.new_city_id where n.retired_at is not null;
  if bad > 0 then raise exception 'retired_place_remap: % homes would move to a retired city', bad; end if;
  select count(*) into bad from public.retired_place_remap_rows() r
    join public.search_listings_ar s using (source_table, listing_id)
    join public.loc_city_center cc on cc.city_id = r.new_city_id
   where r.kind = 'district_is_city_by_pin'
     and (s.latitude is null or 111.0 * sqrt(power(s.latitude::float8 - cc.lat, 2)
                                              + power((s.longitude::float8 - cc.lng) * cos(radians(cc.lat)), 2)) > 15);
  if bad > 0 then raise exception 'retired_place_remap: % by-pin moves without a pin within 15 km', bad; end if;
end
$chk$;
