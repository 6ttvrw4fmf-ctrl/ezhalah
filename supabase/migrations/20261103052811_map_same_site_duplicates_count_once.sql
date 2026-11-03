-- SAME-SITE DUPLICATES COUNT ONCE ON THE MAP (owner 2026-11-03: «Duplicates … must never ever happen. Make sure that
-- the new listings we get match the map»; «having duplicates [from the] same website is a bug, different [websites]
-- isn't»). Measured: aqaralmuhaysini published one Khobar villa as separate ads (MHS10457, 10462, 10468, 10746, 10756,
-- 10762, 10770, 10776 …) on one spot, same price, area and type, titles varying only in spelling («حي اللؤلؤ، الخبر» /
-- «اللولو، الخبر»), so the pin said «12 إعلانات» and the sheet showed the same card twelve times.
--
-- The rule, applied at READ time so every new listing follows it with no cleanup step: listings from the SAME SOURCE
-- TABLE on the SAME COORDINATES with the same deal, price, area, type and bedrooms are ONE listing on the map — one
-- pin count, one id handed to the card sheet (the newest), one count in the precomputed grid and the dots feed.
-- Listings from different sites are never folded, and the source tables are untouched (PRICE = SOURCE, nothing
-- deleted or deactivated).
create or replace function public.map_pins_ar(
  p_s double precision, p_w double precision, p_n double precision, p_e double precision,
  p_cell double precision default 0, p_deals text[] default null, p_poly jsonb default null, p_limit integer default 3000,
  p_category text default null, p_types text[] default null, p_beds integer[] default null,
  p_area_min integer default null, p_area_max integer default null, p_price_min numeric default null, p_price_max numeric default null)
returns table (lat double precision, lng double precision, n integer, deal text, type_ar text, platforms integer, ids jsonb,
               price numeric, platform text)
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_short text[];
  v_geom extensions.geometry;
begin
  -- PRECOMPUTED GRID: zoomed out with no narrowing → the hourly grid (already one count per same-site duplicate).
  if p_cell > 0 and p_poly is null and p_category is null and p_types is null and p_beds is null
     and p_area_min is null and p_area_max is null and p_price_min is null and p_price_max is null
     and exists (select 1 from public.map_grid_ar g where g.cell = p_cell) then
    return query
    select sum(g.lat * g.n) / sum(g.n), sum(g.lng * g.n) / sum(g.n), sum(g.n)::int,
           case when count(distinct g.deal) = 1 then min(g.deal) else 'mixed' end,
           null::text, 0, null::jsonb, null::numeric, null::text
    from public.map_grid_ar g
    where g.cell = p_cell and g.lat between p_s and p_n and g.lng between p_w and p_e
      and (p_deals is null or g.deal = any (p_deals))
    group by g.ki, g.kj
    order by 3 desc, 1, 2
    limit greatest(1, least(p_limit, 5000));
    return;
  end if;

  select coalesce(array_agg(k) filter (where pool = 'شهري'), '{}')
    into v_short
  from (select d.platform || '|' || coalesce(d.rent_period_ar, '') as k, public.rent_pool_ar(d.platform, d.rent_period_ar) as pool
        from (select distinct s.platform, s.rent_period_ar from public.search_listings_ar s where s.deal_ar = 'إيجار') d) x;
  v_geom := case when p_poly is null then null
                 else extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_poly::text), 4326) end;

  if p_cell > 0 then
    return query
    with kept as (
      select s.source_table, s.latitude::double precision la, s.longitude::double precision lo, s.type_ar, s.area_m2 area, s.bedrooms beds,
             case when s.deal_ar = 'بيع' then 'buy'
                  when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
                  when s.deal_ar = 'إيجار' then 'rent' end as deal,
             case when s.deal_ar = 'بيع' then s.price_total else s.price_annual end as price
      from public.search_listings_ar s
      where s.latitude is not null and s.longitude is not null
        and s.latitude between p_s and p_n and s.longitude between p_w and p_e
        and not exists (select 1 from public.ops_default_pin_register r
                         where r.source_table = s.source_table and r.lat = round(s.latitude::numeric, 5) and r.lng = round(s.longitude::numeric, 5))
        and (p_category is null or (p_category = 'residential' and s.source_table like '%\_residential\_%')
                                or (p_category = 'commercial' and s.source_table like '%\_commercial\_%'))
        and (p_types is null or s.type_ar = any (p_types))
        and (p_beds is null or s.bedrooms = any (p_beds))
        and (p_area_min is null or s.area_m2 >= p_area_min) and (p_area_max is null or s.area_m2 <= p_area_max)
        and (v_geom is null or extensions.ST_Contains(v_geom, extensions.ST_SetSRID(extensions.ST_MakePoint(s.longitude::double precision, s.latitude::double precision), 4326)))
    )
    select avg(k.la), avg(k.lo),
           count(distinct (k.source_table, k.la, k.lo, k.deal, k.price, k.area, k.type_ar, k.beds))::int,
           case when min(k.deal) = max(k.deal) then min(k.deal) else 'mixed' end,
           null::text, 0, null::jsonb, null::numeric, null::text
    from kept k
    where k.deal is not null and (p_deals is null or k.deal = any (p_deals))
      and (p_price_min is null or k.price >= p_price_min) and (p_price_max is null or k.price <= p_price_max)
    group by round((k.la / p_cell)::numeric) * p_cell, round((k.lo / p_cell)::numeric) * p_cell
    order by 3 desc, 1, 2
    limit greatest(1, least(p_limit, 5000));
  else
    return query
    with kept as (
      select s.source_table, s.listing_id, s.latitude::double precision la, s.longitude::double precision lo, s.type_ar, s.platform,
             s.area_m2 area, s.bedrooms beds,
             case when s.deal_ar = 'بيع' then 'buy'
                  when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
                  when s.deal_ar = 'إيجار' then 'rent' end as deal,
             case when s.deal_ar = 'بيع' then s.price_total else s.price_annual end as price
      from public.search_listings_ar s
      where s.latitude is not null and s.longitude is not null
        and s.latitude between p_s and p_n and s.longitude between p_w and p_e
        and not exists (select 1 from public.ops_default_pin_register r
                         where r.source_table = s.source_table and r.lat = round(s.latitude::numeric, 5) and r.lng = round(s.longitude::numeric, 5))
        and (p_category is null or (p_category = 'residential' and s.source_table like '%\_residential\_%')
                                or (p_category = 'commercial' and s.source_table like '%\_commercial\_%'))
        and (p_types is null or s.type_ar = any (p_types))
        and (p_beds is null or s.bedrooms = any (p_beds))
        and (p_area_min is null or s.area_m2 >= p_area_min) and (p_area_max is null or s.area_m2 <= p_area_max)
        and (v_geom is null or extensions.ST_Contains(v_geom, extensions.ST_SetSRID(extensions.ST_MakePoint(s.longitude::double precision, s.latitude::double precision), 4326)))
    ), uniq as (
      -- ONE per same-site duplicate: the newest of each (site, spot, deal, price, area, type, bedrooms) group.
      select * from (
        select k.*, row_number() over (partition by k.source_table, k.la, k.lo, k.deal, k.price, k.area, k.type_ar, k.beds
                                       order by k.listing_id desc) as rn
        from kept k
        where k.deal is not null and (p_deals is null or k.deal = any (p_deals))
          and (p_price_min is null or k.price >= p_price_min) and (p_price_max is null or k.price <= p_price_max)
      ) x where x.rn = 1
    )
    select u.la, u.lo, count(*)::int,
           case when count(distinct u.deal) = 1 then min(u.deal) else 'mixed' end,
           case when count(*) > 1 then null else min(u.type_ar) end,
           count(distinct u.platform)::int,
           to_jsonb((array_agg(jsonb_build_object('t', u.source_table, 'i', u.listing_id) order by u.listing_id desc))[1:100]),
           case when count(*) > 1 then null else min(u.price) end,
           case when count(*) > 1 then null else min(u.platform) end
    from uniq u
    group by u.la, u.lo
    order by 3 desc, 1, 2
    limit greatest(1, least(p_limit, 5000));
  end if;
end;
$$;

-- The precomputed grid (and the dots feed built from it) counts each same-site duplicate once too.
create or replace function public.map_grid_refresh_ar()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_short text[];
  v_cell double precision;
  v_n integer := 0;
begin
  select coalesce(array_agg(k) filter (where pool = 'شهري'), '{}')
    into v_short
  from (select d.platform || '|' || coalesce(d.rent_period_ar, '') as k, public.rent_pool_ar(d.platform, d.rent_period_ar) as pool
        from (select distinct s.platform, s.rent_period_ar from public.search_listings_ar s where s.deal_ar = 'إيجار') d) x;

  create temp table map_grid_new (like public.map_grid_ar) on commit drop;
  create temp table map_grid_src on commit drop as
    select distinct u.source_table, u.la, u.lo, u.deal, u.price, u.area, u.type_ar, u.beds
    from (
      select s.source_table, s.latitude::double precision la, s.longitude::double precision lo, s.area_m2 area, s.type_ar, s.bedrooms beds,
             case when s.deal_ar = 'بيع' then 'buy'
                  when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
                  when s.deal_ar = 'إيجار' then 'rent' end as deal,
             case when s.deal_ar = 'بيع' then s.price_total else s.price_annual end as price
      from public.search_listings_ar s
      where s.latitude is not null and s.longitude is not null
        and not exists (select 1 from public.ops_default_pin_register r
                         where r.source_table = s.source_table and r.lat = round(s.latitude::numeric, 5) and r.lng = round(s.longitude::numeric, 5))
    ) u
    where u.deal is not null;

  foreach v_cell in array array[2.4,1.2,0.6,0.3,0.15,0.075,0.04,0.02,0.01] loop
    insert into map_grid_new (cell, ki, kj, deal, lat, lng, n)
    select v_cell, round(k.la / v_cell)::int, round(k.lo / v_cell)::int, k.deal, avg(k.la), avg(k.lo), count(*)::int
    from map_grid_src k
    group by 2, 3, 4;
  end loop;

  delete from public.map_grid_ar;
  insert into public.map_grid_ar select * from map_grid_new;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.map_grid_refresh_ar() from public, anon, authenticated;
