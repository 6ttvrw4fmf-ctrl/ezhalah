-- SAME-SITE TWINS, ROUND 3: the blank-matches-blank join made the refresh take MINUTES. 20261105063813 compared the
-- six keys with IS NOT DISTINCT FROM, which no hash join can use, so the planner nested-looped 429k rows against the
-- groups (two manual runs were still going at 2-4 min and were cancelled; map_grid_refresh_ar() would have hit its 300 s
-- budget at :53, and a statement timeout is NOT caught by WHEN OTHERS). A blank becomes a sentinel no real value can
-- take (price/area/bedrooms -1, type ''), so the keys are plain columns, joined USING, hashable: measured 5.8 s for
-- 31,928 ads (round 1: 31,115). Same twins, same rule: a blank matches a blank, never a number.
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
           x.deal_ar, coalesce(x.price_total, x.price_annual, -1) price, coalesce(x.area_m2, -1) area_m2,
           coalesce(x.type_ar, '') type_ar, coalesce(x.bedrooms, -1) bedrooms
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
    from s join multi m using (source_table, deal_ar, price, area_m2, type_ar, bedrooms)
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
