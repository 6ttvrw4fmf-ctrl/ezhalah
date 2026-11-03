-- map_pins_ar() MEASURED, MADE FAST, AND GIVEN THE FILTER (2026-11-02, after the morning migration that created it):
-- the Riyadh city grid took 8.6 s and the country grid 17 s, because rent_pool_ar() ran once per row (182k / 424k
-- calls, each with its own feature-flag read) and the ids were gathered by re-scanning the point set per group. The
-- pool is now decided ONCE per distinct (platform, rent period, deal) — a few dozen rows — through the SAME
-- rent_pool_ar() (no inline copy of its logic, so the short-stays rule cannot drift); the default-pin register is
-- hashed instead of probed per row; the ids come from one ordered array per group, capped at 100.
-- THE PIN HEAD IS THE PRICE (owner 2026-11-02: «always show the price, don't show the property type»): an exact point
-- with one listing carries its price — price_total for a sale, price_annual for a rent — and the platform, so the app
-- prints it through the standing listingPrice() rule (Gathern / Aqar Monthly print nothing). THE MAP FILTER is the
-- site's own (owner: «make sure whatever the user keeps he gets it in terms of pins»): category by the source table's
-- vertical, property types by type_ar, bedrooms, area and price ranges — each null = not narrowed. Same signature
-- shape, two new output columns; the old 8-argument signature is DROPPED first so the function has one overload.
drop function if exists public.map_pins_ar(double precision, double precision, double precision, double precision, double precision, text[], jsonb, integer);
create function public.map_pins_ar(
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
  ), own as (
    select b.* from box b left join reg r on r.source_table = b.source_table and r.lat = b.la5 and r.lng = b.lo5
    where r.source_table is null
      and (p_poly is null or extensions.ST_Contains(
             extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_poly::text), 4326),
             extensions.ST_SetSRID(extensions.ST_MakePoint(b.lo, b.la), 4326)))
  ), combos as (
    select platform, rent_period_ar, deal_ar,
           case when deal_ar = 'بيع' then 'buy'
                when deal_ar = 'إيجار' and public.rent_pool_ar(platform, rent_period_ar) = 'شهري' then 'short'
                when deal_ar = 'إيجار' then 'rent' end as deal
    from (select distinct platform, rent_period_ar, deal_ar from own) d
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
revoke all on function public.map_pins_ar(double precision, double precision, double precision, double precision, double precision, text[], jsonb, integer, text, text[], integer[], integer, integer, numeric, numeric) from public;
grant execute on function public.map_pins_ar(double precision, double precision, double precision, double precision, double precision, text[], jsonb, integer, text, text[], integer[], integer, integer, numeric, numeric) to anon, authenticated, service_role;
