-- SAME HOUSE, POSTED TWICE ON ONE SITE → ONE PIN, SEPARATE CARDS (owner 2026-11-04: «they become like 2 … but same pin
-- … do it for everything they basically merge but show separately of course»). Measured 2026-11-04: a site often
-- carries the same property more than once (two agents, a re-post), each copy with its own hand-placed pin a few
-- metres apart — aqar 6797149 / 6834756: plan 3/505/ت parcel 359, two agents, 6 m apart — so the map drew two pins
-- for one house. Nothing is removed: every ad keeps its own card (the pin sheet lists every id), and the source tables
-- and the served index keep every site's own coordinates (SOURCE IS TRUTH). Only the spot a pin is DRAWN at moves.
--
-- Twins = same site (source_table), same deal, same price, same area, same type, same bedrooms, within ~100 m of each
-- other (DBSCAN, eps 0.0009°, chained). Measured over the whole index: 12,182 groups that move (51,952 ads), median
-- span 22 m, widest 455 m, none over 1 km. Each member is drawn at its group's most-shared spot (ties → lowest id).
-- Snaps are refreshed hourly; a new ad shows at its own spot until the next refresh, and a snap is ignored if the
-- listing has since moved more than ~1 km (abs < 0.01°), so a stale snap can never misplace a pin. Default/placeholder
-- pins (ops_default_pin_register) never take part.
create table if not exists public.map_pin_snap (
  source_table text not null,
  listing_id bigint not null,
  lat double precision not null,
  lng double precision not null,
  primary key (source_table, listing_id)
);
alter table public.map_pin_snap enable row level security;
revoke all on public.map_pin_snap from anon, authenticated;

create or replace function public.map_pin_snap_refresh_ar()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_n integer := 0;
begin
  create temp table map_pin_snap_new on commit drop as
  with s as (
    select x.source_table, x.listing_id, x.latitude::double precision la, x.longitude::double precision lo,
           x.deal_ar, coalesce(x.price_total, x.price_annual) price, x.area_m2, x.type_ar, x.bedrooms
    from public.search_listings_ar x
    where x.latitude is not null and x.longitude is not null
      and coalesce(x.price_total, x.price_annual) is not null and x.area_m2 is not null
      and not exists (select 1 from public.ops_default_pin_register r
                       where r.source_table = x.source_table and r.lat = round(x.latitude::numeric, 5) and r.lng = round(x.longitude::numeric, 5))
  ), multi as (
    select source_table, deal_ar, price, area_m2, type_ar, bedrooms
    from s group by 1, 2, 3, 4, 5, 6 having count(distinct (la, lo)) > 1
  ), c as (
    select s.*, extensions.ST_ClusterDBSCAN(extensions.ST_MakePoint(s.lo, s.la), 0.0009, 2)
             over (partition by s.source_table, s.deal_ar, s.price, s.area_m2, s.type_ar, s.bedrooms) cid
    from s join multi m on m.source_table = s.source_table and m.deal_ar = s.deal_ar and m.price = s.price
                       and m.area_m2 = s.area_m2 and m.type_ar is not distinct from s.type_ar and m.bedrooms is not distinct from s.bedrooms
  ), spot as (
    select c.*, count(*) over (partition by source_table, deal_ar, price, area_m2, type_ar, bedrooms, cid, la, lo) at_spot
    from c where cid is not null
  ), anchored as (
    select spot.*,
           first_value(la) over w a_la, first_value(lo) over w a_lo
    from spot
    window w as (partition by source_table, deal_ar, price, area_m2, type_ar, bedrooms, cid order by at_spot desc, listing_id)
  )
  select source_table, listing_id, a_la lat, a_lo lng from anchored where a_la <> la or a_lo <> lo;

  delete from public.map_pin_snap;
  insert into public.map_pin_snap (source_table, listing_id, lat, lng)
  select source_table, listing_id, lat, lng from map_pin_snap_new on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.map_pin_snap_refresh_ar() from public, anon, authenticated;

select cron.schedule('map_pin_snap_refresh_ar', '23 * * * *',
  $c$set statement_timeout to '300s'; select public.map_pin_snap_refresh_ar();$c$);

-- The exact-point read (street zoom) draws each listing at its snapped spot; the box filter still uses the listing's
-- own numeric coordinates so idx_slar_pin keeps serving it. Grid branches are unchanged.
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
        and s.latitude between p_s::numeric and p_n::numeric and s.longitude between p_w::numeric and p_e::numeric
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
                select s.source_table, s.listing_id, coalesce(snap.lat, s.latitude::double precision) la, coalesce(snap.lng, s.longitude::double precision) lo, s.type_ar, s.platform,
                       case when s.deal_ar = 'بيع' then 'buy'
                            when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
                            when s.deal_ar = 'إيجار' then 'rent' end as deal,
                       case when s.deal_ar = 'بيع' then s.price_total else s.price_annual end as price
                from public.search_listings_ar s
                left join public.map_pin_snap snap on snap.source_table = s.source_table and snap.listing_id = s.listing_id
                  and abs(snap.lat - s.latitude::double precision) < 0.01 and abs(snap.lng - s.longitude::double precision) < 0.01
                where s.latitude is not null and s.longitude is not null
                  and s.latitude between p_s::numeric and p_n::numeric and s.longitude between p_w::numeric and p_e::numeric
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
            select s.source_table, s.listing_id, coalesce(snap.lat, s.latitude::double precision) la, coalesce(snap.lng, s.longitude::double precision) lo, s.type_ar, s.platform,
                   case when s.deal_ar = 'بيع' then 'buy'
                        when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
                        when s.deal_ar = 'إيجار' then 'rent' end as deal,
                   case when s.deal_ar = 'بيع' then s.price_total else s.price_annual end as price
            from public.search_listings_ar s
            left join public.map_pin_snap snap on snap.source_table = s.source_table and snap.listing_id = s.listing_id
              and abs(snap.lat - s.latitude::double precision) < 0.01 and abs(snap.lng - s.longitude::double precision) < 0.01
            where s.latitude is not null and s.longitude is not null
              and s.latitude between p_s::numeric and p_n::numeric and s.longitude between p_w::numeric and p_e::numeric
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
      select s.source_table, s.listing_id, coalesce(snap.lat, s.latitude::double precision) la, coalesce(snap.lng, s.longitude::double precision) lo, s.type_ar, s.platform,
             case when s.deal_ar = 'بيع' then 'buy'
                  when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
                  when s.deal_ar = 'إيجار' then 'rent' end as deal,
             case when s.deal_ar = 'بيع' then s.price_total else s.price_annual end as price
      from public.search_listings_ar s
      left join public.map_pin_snap snap on snap.source_table = s.source_table and snap.listing_id = s.listing_id
        and abs(snap.lat - s.latitude::double precision) < 0.01 and abs(snap.lng - s.longitude::double precision) < 0.01
      where s.latitude is not null and s.longitude is not null
        and s.latitude between p_s::numeric and p_n::numeric and s.longitude between p_w::numeric and p_e::numeric
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
