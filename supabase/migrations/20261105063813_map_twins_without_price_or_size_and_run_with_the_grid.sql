-- SAME-SITE TWINS, ROUND 2 (owner 2026-11-04: «check on the other websites … everything it needs to be like this … make
-- sure the map is fully fixed»). Two changes to 20261105060207:
--
-- 1. Twins with NO price or NO size are twins too. Round 1 required both, so 634 groups (1,413 ads, mostly aqar and
--    haraj «price on request» copies) still drew 756 extra pins. The fields are now compared with IS NOT DISTINCT FROM:
--    two copies that both leave the price blank match each other; a blank never matches a number. Measured widest such
--    group: 159 m.
-- 2. The refresh runs INSIDE map_grid_refresh_ar() (:53, 300 s budget) instead of its own cron job. Every minute of
--    the hour is already inside another job's p95 window (sync-search-listings-ar 890 s, mon-detectors-and-dispatch
--    667 s — verify-cron-slot-discipline.ts found no free minute), and the snap takes ~10 s.
--
-- The 100 m radius stays: over aqar, identical-attribute pairs at 0-100 m are ~24× denser per m² than at 100-300 m
-- (86,801 vs 28,989 pairs over 8× the area), i.e. the excess near zero is the same house; beyond 100 m the rate is what
-- neighbouring identical units produce by chance.
select cron.unschedule('map_pin_snap_refresh_ar');

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
      and not exists (select 1 from public.ops_default_pin_register r
                       where r.source_table = x.source_table and r.lat = round(x.latitude::numeric, 5) and r.lng = round(x.longitude::numeric, 5))
  ), multi as (
    select source_table, deal_ar, price, area_m2, type_ar, bedrooms
    from s group by 1, 2, 3, 4, 5, 6 having count(distinct (la, lo)) > 1
  ), c as (
    select s.*, extensions.ST_ClusterDBSCAN(extensions.ST_MakePoint(s.lo, s.la), 0.0009, 2)
             over (partition by s.source_table, s.deal_ar, s.price, s.area_m2, s.type_ar, s.bedrooms) cid
    from s join multi m on m.source_table = s.source_table and m.deal_ar = s.deal_ar and m.price is not distinct from s.price
                       and m.area_m2 is not distinct from s.area_m2 and m.type_ar is not distinct from s.type_ar and m.bedrooms is not distinct from s.bedrooms
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
