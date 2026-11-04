-- AREA LABELS: CITY AND DISTRICT NAMES WITH THEIR COUNTS (owner's father, 2026-11-02, relayed by the owner 2026-11-03:
-- «too much listings and place marks for such low zoom level — show only the number of listings in the area when
-- scrolling at such low zoom, and show place marks only when the user zooms in further»; «at this zoom level show the
-- names of the districts only and the number of listings»). Zoomed far out the map shows each CITY's name and count,
-- at city zoom each DISTRICT's name and count, and price pins only closer in.
--
-- map_area_ar is precomputed hourly by map_grid_refresh_ar() from the same distinct set the grid uses (pinned rows,
-- default-pin register excluded, same-site duplicates once, rent_pool_ar() pools), one row per (level, city, district,
-- deal) with the median position of its listings (a median, so one mis-pinned ad cannot drag a label away) and the
-- count. map_areas_ar() serves the labels inside the visible box for the chosen deals in milliseconds.
create table if not exists public.map_area_ar (
  level    text not null check (level in ('city', 'district')),
  city     text not null,
  district text not null default '',
  deal     text not null,
  lat      double precision not null,
  lng      double precision not null,
  n        integer not null,
  primary key (level, city, district, deal)
);
create index if not exists idx_map_area_ar_box on public.map_area_ar (level, lat, lng);
comment on table public.map_area_ar is 'Precomputed map labels: city and district names with their pinned-listing counts per deal (median position). Rebuilt hourly by map_grid_refresh_ar(); served by map_areas_ar().';

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
  create temp table map_area_new (like public.map_area_ar) on commit drop;
  -- One row per listing, same-site duplicates once (site, spot, deal, price, area, type, bedrooms).
  create temp table map_grid_src on commit drop as
    select distinct on (u.source_table, u.la, u.lo, u.deal, u.price, u.area, u.type_ar, u.beds)
           u.source_table, u.la, u.lo, u.deal, u.price, u.area, u.type_ar, u.beds, u.city, u.district
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
    where u.deal is not null
    order by u.source_table, u.la, u.lo, u.deal, u.price, u.area, u.type_ar, u.beds, u.city nulls last, u.district nulls last;

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

-- The labels inside the box for the chosen deals: one per city (or district), position weighted by each deal's count.
create or replace function public.map_areas_ar(
  p_s double precision, p_w double precision, p_n double precision, p_e double precision,
  p_level text default 'district', p_deals text[] default null, p_limit integer default 400)
returns table (city text, district text, lat double precision, lng double precision, n integer)
language sql stable security definer
set search_path = public
as $$
  select a.city, a.district, sum(a.lat * a.n) / sum(a.n), sum(a.lng * a.n) / sum(a.n), sum(a.n)::int
  from public.map_area_ar a
  where a.level = p_level and a.lat between p_s and p_n and a.lng between p_w and p_e
    and (p_deals is null or a.deal = any (p_deals))
  group by a.city, a.district
  order by 5 desc
  limit greatest(1, least(p_limit, 1000));
$$;
grant execute on function public.map_areas_ar(double precision, double precision, double precision, double precision, text, text[], integer) to anon, authenticated;
insert into public.ops_public_secdef_allowlist (proname, grant_to, reason)
values ('map_areas_ar', '{anon,authenticated}', 'map: city / district names with their pinned-listing counts inside the visible box (src/data/mapAreas.ts); precomputed hourly in map_area_ar')
on conflict do nothing;
comment on function public.map_areas_ar(double precision, double precision, double precision, double precision, text, text[], integer) is 'Map labels: city or district names with counts inside a box, for the chosen deals (map_area_ar).';
