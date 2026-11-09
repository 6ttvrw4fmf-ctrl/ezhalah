-- MAP: EVERY LISTING WITH NO EXACT LOCATION GETS A MARKER (owner 2026-11-09: «make sure it's live for all the ones
-- with no pins»). The first pass (20261109045105) placed a listing at its DISTRICT's centre and covered 12,166 of
-- 15,300: a listing whose district has no pinned listing (no centre, 1,302) or that names only its city (1,665) had
-- nowhere to go. Those now sit at their CITY's centre (loc_city_center), under the city's own marker — district '' —
-- so the sheet titles them by city. Only a listing with no city at all (179) stays search-only.
create or replace function public.map_nopin_refresh_ar()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_short text[];
  v_n integer := 0;
begin
  select coalesce(array_agg(p.k), '{}') into v_short from public.map_short_pairs_ar p;
  create temp table map_nopin_new on commit drop as
  with ctr as (
    -- The district's centre: its pinned listings' median (map_area_ar, refreshed by the grid a moment earlier),
    -- weighted over the deals.
    select a.city, a.district, sum(a.lat * a.n) / sum(a.n) lat, sum(a.lng * a.n) / sum(a.n) lng
    from public.map_area_ar a
    where a.level = 'district'
    group by a.city, a.district
  )
  select s.source_table, s.listing_id,
         coalesce(c.city, btrim(s.city_ar)) city,
         -- No district centre → the city's marker (district '').
         case when c.city is not null then c.district else '' end district,
         coalesce(c.lat, cc.lat::double precision) lat, coalesce(c.lng, cc.lng::double precision) lng,
         case when s.deal_ar = 'بيع' then 'buy'
              when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
              when s.deal_ar = 'إيجار' then 'rent' end as deal,
         case when s.deal_ar = 'بيع' then s.price_total else s.price_annual end as price,
         s.area_m2 area, s.type_ar, s.bedrooms beds
  from public.search_listings_ar s
  left join ctr c on c.city = btrim(s.city_ar) and c.district = btrim(s.district_ar)
  left join public.loc_city_center cc on cc.city_id = s.city_id
  where (s.latitude is null or s.longitude is null)
    -- A listing that borrowed its sure twin's pin is already on the map at that pin.
    and not exists (select 1 from public.map_pin_borrow b where b.source_table = s.source_table and b.listing_id = s.listing_id)
    and s.deal_ar in ('بيع', 'إيجار')
    and coalesce(c.lat, cc.lat::double precision) is not null
    and nullif(btrim(s.city_ar), '') is not null;
  delete from public.map_nopin_ar;
  insert into public.map_nopin_ar (source_table, listing_id, city, district, lat, lng, deal, price, area, type_ar, beds)
  select source_table, listing_id, city, district, lat, lng, deal, price, area, type_ar, beds from map_nopin_new;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function public.map_nopin_refresh_ar() from public, anon, authenticated;

select public.map_nopin_refresh_ar();
