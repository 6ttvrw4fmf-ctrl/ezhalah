-- THE MAP FEELS SLOW ON ZOOM-IN (owner 2026-11-03: «the map feels slow when I zoom in»). Measured that day: every
-- street-level pin read took 0.47-1.5 s, while the area labels took 1 ms and the count grid 5 ms. Two causes, both cut:
--   1. each call re-derived the short-stay (platform|period) pairs from 151,605 rent rows (~250 ms) — now cached hourly in
--      map_short_pairs_ar by map_grid_refresh_ar(), computed live only if the cache was never filled;
--   2. a crowded view built every spot's card ids (jsonb, up to ~1.2 s) only for the map to count «more than the cap» and
--      switch to bubbles — now, when the view holds at least p_limit distinct spots, p_limit bare spots return at once.
-- Results are unchanged for every view under the cap; the precomputed grid and the labels are untouched.
create table if not exists public.map_short_pairs_ar (k text primary key);
comment on table public.map_short_pairs_ar is 'Cache: the (platform|rent period) pairs rent_pool_ar() puts in the short-stays pool, refreshed hourly by map_grid_refresh_ar(); read by map_pins_ar().';
revoke all on table public.map_short_pairs_ar from anon, authenticated;
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
  -- PRECOMPUTED GRID: zoomed out with no narrowing → the hourly grid, in milliseconds.
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

  -- Every (platform, rent period) pair with rent listings whose pool is «شهري» (Short stays), decided once through
  -- rent_pool_ar(); any other rent listing is «rent».
  -- The short-stay (platform|period) pairs, cached hourly by map_grid_refresh_ar() (measured 2026-11-03: computing
  -- them here re-read 151k rent rows on every zoom, ~250 ms of each pin read). Computed live only if never cached.
  select coalesce(array_agg(p.k), '{}') into v_short from public.map_short_pairs_ar p;
  if not exists (select 1 from public.map_short_pairs_ar) then
    select coalesce(array_agg(k) filter (where pool = 'شهري'), '{}')
      into v_short
    from (select d.platform || '|' || coalesce(d.rent_period_ar, '') as k, public.rent_pool_ar(d.platform, d.rent_period_ar) as pool
          from (select distinct s.platform, s.rent_period_ar from public.search_listings_ar s where s.deal_ar = 'إيجار') d) x;
  end if;
  v_geom := case when p_poly is null then null
                 else extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_poly::text), 4326) end;

  if p_cell > 0 then
    return query
    with kept as (
      select s.latitude::double precision la, s.longitude::double precision lo,
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
    select avg(k.la), avg(k.lo), count(*)::int,
           case when min(k.deal) = max(k.deal) then min(k.deal) else 'mixed' end,
           null::text, 0, null::jsonb, null::numeric, null::text
    from kept k
    where k.deal is not null and (p_deals is null or k.deal = any (p_deals))
      and (p_price_min is null or k.price >= p_price_min) and (p_price_max is null or k.price <= p_price_max)
    group by round((k.la / p_cell)::numeric) * p_cell, round((k.lo / p_cell)::numeric) * p_cell
    order by 3 desc, 1, 2
    limit greatest(1, least(p_limit, 5000));
  else
    -- CROWDED PROBE (measured 2026-11-03: a crowded street-zoom read built every spot's card ids, 0.5-1.5 s, only for the
    -- map to see «more than the cap» and switch to bubbles). When the view holds at least p_limit distinct spots, return
    -- p_limit bare spots at once — the map reads only the row count there (AppleMap.web.tsx asks for PIN_SHOW_MAX + 1).
    if (select count(*) from (
          with kept as (
                select s.source_table, s.listing_id, s.latitude::double precision la, s.longitude::double precision lo, s.type_ar, s.platform,
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
          select distinct k.la, k.lo from kept k
          where k.deal is not null and (p_deals is null or k.deal = any (p_deals))
            and (p_price_min is null or k.price >= p_price_min) and (p_price_max is null or k.price <= p_price_max)
          limit greatest(1, least(p_limit, 5000))) z) >= greatest(1, least(p_limit, 5000)) then
      return query
      with kept as (
            select s.source_table, s.listing_id, s.latitude::double precision la, s.longitude::double precision lo, s.type_ar, s.platform,
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
      select distinct k.la, k.lo, 1, null::text, null::text, 0, null::jsonb, null::numeric, null::text
      from kept k
      where k.deal is not null and (p_deals is null or k.deal = any (p_deals))
        and (p_price_min is null or k.price >= p_price_min) and (p_price_max is null or k.price <= p_price_max)
      limit greatest(1, least(p_limit, 5000));
      return;
    end if;
    return query
    with kept as (
      select s.source_table, s.listing_id, s.latitude::double precision la, s.longitude::double precision lo, s.type_ar, s.platform,
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
    select k.la, k.lo, count(*)::int,
           case when count(distinct k.deal) = 1 then min(k.deal) else 'mixed' end,
           case when count(*) > 1 then null else min(k.type_ar) end,
           count(distinct k.platform)::int,
           to_jsonb((array_agg(jsonb_build_object('t', k.source_table, 'i', k.listing_id) order by k.listing_id desc))[1:100]),
           case when count(*) > 1 then null else min(k.price) end,
           case when count(*) > 1 then null else min(k.platform) end
    from kept k
    where k.deal is not null and (p_deals is null or k.deal = any (p_deals))
      and (p_price_min is null or k.price >= p_price_min) and (p_price_max is null or k.price <= p_price_max)
    group by k.la, k.lo
    order by 3 desc, 1, 2
    limit greatest(1, least(p_limit, 5000));
  end if;
end;
$$;

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
  -- Cache the pairs for map_pins_ar() (one read an hour instead of one per zoom).
  delete from public.map_short_pairs_ar;
  insert into public.map_short_pairs_ar (k) select unnest(v_short) on conflict do nothing;

  create temp table map_grid_new (like public.map_grid_ar) on commit drop;
  create temp table map_area_new (like public.map_area_ar) on commit drop;
  -- Every listing, as each site published it (owner 2026-11-03: same-site copies stay).
  create temp table map_grid_src on commit drop as
    select u.source_table, u.la, u.lo, u.deal, u.price, u.area, u.type_ar, u.beds, u.city, u.district
    from (
      select s.source_table, s.latitude::double precision la, s.longitude::double precision lo, s.area_m2 area, s.type_ar, s.bedrooms beds,
             nullif(btrim(s.city_ar), '') city, nullif(btrim(s.district_ar), '') district,
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

  insert into map_area_new (level, city, district, deal, lat, lng, n)
  select 'city', k.city, '', k.deal,
         percentile_cont(0.5) within group (order by k.la), percentile_cont(0.5) within group (order by k.lo), count(*)::int
  from map_grid_src k where k.city is not null
  group by k.city, k.deal;
  insert into map_area_new (level, city, district, deal, lat, lng, n)
  select 'district', k.city, k.district, k.deal,
         percentile_cont(0.5) within group (order by k.la), percentile_cont(0.5) within group (order by k.lo), count(*)::int
  from map_grid_src k where k.city is not null and k.district is not null
  group by k.city, k.district, k.deal;

  delete from public.map_grid_ar;
  insert into public.map_grid_ar select * from map_grid_new;
  get diagnostics v_n = row_count;
  delete from public.map_area_ar;
  insert into public.map_area_ar select * from map_area_new;
  return v_n;
end;
$$;
revoke all on function public.map_grid_refresh_ar() from public, anon, authenticated;
