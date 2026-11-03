-- map_pins_ar(): THE POOL REALLY IS DECIDED ONCE (2026-11-02, measured minutes after the previous version): the
-- planner pushed «deal is not null» — and with it rent_pool_ar() — INTO the DISTINCT scan, so the function still
-- called rent_pool_ar once per listing (3,808 calls on a 3 km box = 3 s; the country view timed out). `combos` is
-- now MATERIALIZED: the distinct (platform, period, deal) set is built first, rent_pool_ar runs on those few dozen
-- rows, and the per-listing join reads the result. Same signature, same answers.
create or replace function public.map_pins_ar(
  p_s double precision, p_w double precision, p_n double precision, p_e double precision,
  p_cell double precision default 0, p_deals text[] default null, p_poly jsonb default null, p_limit integer default 3000,
  p_category text default null, p_types text[] default null, p_beds integer[] default null,
  p_area_min integer default null, p_area_max integer default null, p_price_min numeric default null, p_price_max numeric default null)
returns table (lat double precision, lng double precision, n integer, deal text, type_ar text, platforms integer, ids jsonb,
               price numeric, platform text)
language sql stable security definer
set search_path = public, extensions
as $$
  with box as (
    select s.source_table, s.listing_id, s.latitude::double precision la, s.longitude::double precision lo, s.type_ar, s.platform,
           s.deal_ar, s.rent_period_ar, s.bedrooms, s.area_m2, s.price_total, s.price_annual,
           round(s.latitude::numeric, 5) la5, round(s.longitude::numeric, 5) lo5
    from public.search_listings_ar s
    where s.latitude is not null and s.longitude is not null
      and s.latitude between p_s and p_n and s.longitude between p_w and p_e
      and (p_category is null or (p_category = 'residential' and s.source_table like '%\_residential\_%')
                              or (p_category = 'commercial' and s.source_table like '%\_commercial\_%'))
      and (p_types is null or s.type_ar = any (p_types))
      and (p_beds is null or s.bedrooms = any (p_beds))
      and (p_area_min is null or s.area_m2 >= p_area_min) and (p_area_max is null or s.area_m2 <= p_area_max)
  ), reg as (
    select r.source_table, r.lat, r.lng from public.ops_default_pin_register r
  ), own as materialized (
    select b.* from box b left join reg r on r.source_table = b.source_table and r.lat = b.la5 and r.lng = b.lo5
    where r.source_table is null
      and (p_poly is null or extensions.ST_Contains(
             extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_poly::text), 4326),
             extensions.ST_SetSRID(extensions.ST_MakePoint(b.lo, b.la), 4326)))
  ), distinct_combos as materialized (
    select distinct platform, rent_period_ar, deal_ar from own
  ), combos as materialized (
    select platform, rent_period_ar, deal_ar,
           case when deal_ar = 'بيع' then 'buy'
                when deal_ar = 'إيجار' and public.rent_pool_ar(platform, rent_period_ar) = 'شهري' then 'short'
                when deal_ar = 'إيجار' then 'rent' end as deal
    from distinct_combos
  ), kept as (
    select o.*, c.deal, case when c.deal = 'buy' then o.price_total else o.price_annual end as price
    from own o join combos c on c.platform = o.platform and c.deal_ar = o.deal_ar
                             and c.rent_period_ar is not distinct from o.rent_period_ar
    where c.deal is not null and (p_deals is null or c.deal = any (p_deals))
  ), priced as (
    select * from kept
    where (p_price_min is null or price >= p_price_min) and (p_price_max is null or price <= p_price_max)
  ), cells as (
    select case when p_cell > 0 then round((la / p_cell)::numeric) * p_cell else la end as ky,
           case when p_cell > 0 then round((lo / p_cell)::numeric) * p_cell else lo end as kx,
           la, lo, deal, type_ar, platform, source_table, listing_id, price
    from priced
  )
  select avg(la) as lat, avg(lo) as lng, count(*)::int as n,
         case when count(distinct deal) = 1 then min(deal) else 'mixed' end as deal,
         case when p_cell > 0 or count(*) > 1 then null else min(type_ar) end as type_ar,
         count(distinct platform)::int as platforms,
         case when p_cell > 0 then null
              else to_jsonb((array_agg(jsonb_build_object('t', source_table, 'i', listing_id) order by listing_id desc))[1:100]) end as ids,
         case when p_cell > 0 or count(*) > 1 then null else min(price) end as price,
         case when p_cell > 0 or count(*) > 1 then null else min(platform) end as platform
  from cells
  group by ky, kx
  order by n desc, ky, kx
  limit greatest(1, least(p_limit, 5000));
$$;
