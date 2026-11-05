-- MAP LABELS GO COUNTRY → REGION → CITY → DISTRICT (owner 2026-11-05: «when the user zooms in, first thing Saudi, the
-- total number, then region, then city, and then district»). The labels feed had cities and districts only. Each CITY
-- label now carries its region (the region most of that city's listings are in), and map_areas_feed_ar() appends it
-- as a 9th element of the city rows — an older app reads the first 8 and is unaffected. The app sums cities into the
-- 13 region labels and the one country label (src/lib/mapAreas.ts areasFromFeed). No new rows, no new levels in
-- map_area_ar, so nothing an older bundle draws changes.
alter table public.map_area_ar add column if not exists region text;

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

  -- Same-site twins → one drawn spot (map_pin_snap), refreshed with the grid. A failure keeps the previous snaps
  -- (the block rolls back alone) and never costs the grid its refresh; the WARNING lands in the cron run's log.
  begin
    perform public.map_pin_snap_refresh_ar();
  exception when others then
    raise warning 'map_pin_snap_refresh_ar failed: %', sqlerrm;
  end;

  create temp table map_grid_new (like public.map_grid_ar) on commit drop;
  create temp table map_area_new (like public.map_area_ar) on commit drop;
  -- Every listing, as each site published it (owner 2026-11-03: same-site copies stay).
  create temp table map_grid_src on commit drop as
    select u.source_table, u.la, u.lo, u.deal, u.price, u.area, u.type_ar, u.beds, u.city, u.district, u.region
    from (
      select s.source_table, s.latitude::double precision la, s.longitude::double precision lo, s.area_m2 area, s.type_ar, s.bedrooms beds,
             nullif(btrim(s.city_ar), '') city, nullif(btrim(s.district_ar), '') district, nullif(btrim(s.region_ar), '') region,
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

  -- Each city label carries the region most of its listings are in, so the map can sum cities into region labels and
  -- the country label (owner 2026-11-05: «first Saudi, the total number, then region, then city, then district»).
  insert into map_area_new (level, city, district, deal, lat, lng, n, region)
  select 'city', k.city, '', k.deal,
         percentile_cont(0.5) within group (order by k.la), percentile_cont(0.5) within group (order by k.lo), count(*)::int,
         mode() within group (order by k.region)
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

create or replace function public.map_areas_feed_ar()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_array(x.is_city, x.city, x.district, x.lat, x.lng, x.nb, x.nr, x.ns, x.region)), '[]'::jsonb)
  from (
    select a.level = 'city' as is_city, a.city, a.district,
           round((sum(a.lat * a.n) / sum(a.n))::numeric, 4) as lat, round((sum(a.lng * a.n) / sum(a.n))::numeric, 4) as lng,
           coalesce(sum(a.n) filter (where a.deal = 'buy'), 0) as nb,
           coalesce(sum(a.n) filter (where a.deal = 'rent'), 0) as nr,
           coalesce(sum(a.n) filter (where a.deal = 'short'), 0) as ns,
           coalesce(max(a.region), '') as region
    from public.map_area_ar a
    group by a.level, a.city, a.district
  ) x;
$$;
