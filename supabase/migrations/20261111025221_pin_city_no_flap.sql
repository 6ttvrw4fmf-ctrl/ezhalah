-- PIN CITIES: NEVER PICK AN AD THE NEXT RUN WOULD DROP (follow-up to 20261111021620 / 20261111025049).
--
-- pin_city_for_cityless_rows() judged «the site gives no city» from the SERVED row, while the refresh gives the site
-- the last word from listing_native_location_v1. They disagreed on ads whose site names only a REGION (v1.region_id set,
-- served region empty because no city resolved): the first run placed them, the next run deleted them, and the one
-- after would have placed them again — a flip every hour. Measured on the 20261111025049 run: 3 rows dropped by the
-- site-wins test (one of them aqarmonthly 1097380, region منطقة الرياض). The picker now applies the same v1 test, so it never picks what the
-- refresh would drop. The 15 km / 2x rule is unchanged.

create or replace function public.pin_city_for_cityless_rows()
returns table (source_table text, listing_id bigint, platform text, city_id integer, km_nearest numeric, km_second numeric)
language sql stable
set search_path to 'public', 'extensions'
as $$
  with h as (
    -- served with no city, no city name and no region: the site gave none (an unknown place NAME is not «no city»)
    select s.source_table, s.listing_id, s.platform, s.latitude::float8 as lat, s.longitude::float8 as lon
      from public.search_listings_ar s
     where s.city_id is null
       and nullif(btrim(coalesce(s.city_ar, '')), '') is null and nullif(btrim(coalesce(s.region_ar, '')), '') is null
       and s.latitude between 16 and 33 and s.longitude between 34 and 56
       and not exists (select 1 from public.listing_city_correction x
                        where x.source_table = s.source_table and x.listing_id = s.listing_id
                          and x.city_source <> 'pin_nearest_city')
       -- the same test the refresh uses to give the site the last word: never pick what the next run would drop
       and not exists (select 1 from public.listing_native_location_v1 v1
                        where v1.source_table = s.source_table and v1.listing_id = s.listing_id
                          and (v1.city_id is not null or v1.region_id is not null
                               or nullif(btrim(coalesce(v1.city_ar, '')), '') is not null))),
  n as (
    select h.*, a.city_id as c1, a.km as d1, b.km as d2,
           (select g.gov_shape_id from public.loc_gov_shape_sub g
             where st_intersects(g.geom, st_setsrid(st_makepoint(h.lon, h.lat), 4326)) limit 1) as pin_gid
      from h
      cross join lateral (
        select cc.city_id, 111.0 * sqrt(power(cc.lat - h.lat, 2) + power((cc.lng - h.lon) * cos(radians(h.lat)), 2)) as km
          from public.loc_city_center cc join public.loc_catalog_city c on c.city_id = cc.city_id and c.retired_at is null
         where cc.ads >= 20 order by 2 limit 1) a
      cross join lateral (
        select 111.0 * sqrt(power(cc.lat - h.lat, 2) + power((cc.lng - h.lon) * cos(radians(h.lat)), 2)) as km
          from public.loc_city_center cc join public.loc_catalog_city c on c.city_id = cc.city_id and c.retired_at is null
         where cc.ads >= 20 and cc.city_id <> a.city_id order by 1 limit 1) b)
  select n.source_table, n.listing_id, n.platform, n.c1, round(n.d1::numeric, 2), round(n.d2::numeric, 2)
    from n
   where n.pin_gid is not null
     and n.d1 <= 15 and n.d2 >= 15 and n.d2 >= 2 * n.d1
     and n.pin_gid = (select g.gov_shape_id from public.loc_city_center cc
                        join public.loc_gov_shape_sub g on st_intersects(g.geom, st_setsrid(st_makepoint(cc.lng, cc.lat), 4326))
                       where cc.city_id = n.c1 limit 1)
$$;

revoke all on function public.pin_city_for_cityless_rows() from public, anon, authenticated;
