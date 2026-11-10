-- THE FINAL PIN RULE, server half (owner 2026-11-10: «Do step 1 step 2 … make sure the rules is in place … new listings»).
--
-- STEP 2 — A LAZY PIN IS NOT A PLACE. When one site puts ten or more DIFFERENT whole properties (villas, lands,
-- buildings … of different sizes) of several kinds on one exact point, that point is the site's stand-in for the
-- district, not a building. Those ads leave the point and show under their district's «موقع غير محدد» marker, which
-- already exists. A pile of ONE kind (a land plan's plots, a developer's row of villas, a building's flats) is a real
-- project and keeps its pin. Map only: the listing rows are untouched, and nothing is hidden — every ad keeps a card.
--
-- STEP 1 — THE SAME PROPERTY ON SEVERAL SITES IS ONE PIN. Ads that carry the same government advertising licence, in the
-- same city and the same deal, are one property. When different agents dropped its pin a few metres apart, every copy
-- is drawn at one spot (map_pin_snap, the table the same-site twins already use). Looking alike is never enough: the
-- licence must match, the sizes must agree, and the copies must already sit within ~150 m of each other.
--
-- Both run inside the hourly map refresh, so a listing that arrives tomorrow follows the same rule within the hour.

create table if not exists public.map_stray_pin (
  source_table text   not null,
  listing_id   bigint not null,
  lat          numeric not null,
  lng          numeric not null,
  refreshed_at timestamptz not null default now(),
  primary key (source_table, listing_id)
);
alter table public.map_stray_pin enable row level security;
revoke all on public.map_stray_pin from public, anon, authenticated;
comment on table public.map_stray_pin is
  'Map only: listings whose pin is a site''s stand-in point for a district (ten or more different whole properties of several kinds on one exact point). They are drawn under the district''s no-exact-location marker instead. Rebuilt hourly by map_stray_pin_refresh_ar().';

create or replace function public.map_stray_pin_refresh_ar()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_n integer := 0;
  v_new integer := 0;
begin
  create temp table map_stray_new on commit drop as
  with a as (
    select s.source_table, s.listing_id, s.platform, round(s.latitude::numeric, 5) la, round(s.longitude::numeric, 5) lo,
           s.deal_ar, s.type_ar, s.area_m2,
           -- A whole property stands on its own ground; a unit (flat, room, office, shop …) shares a building.
           (s.type_ar is not null and s.type_ar <> all (array['شقة','استوديو','دور','غرفة','مكتب','محل','ملحق علوي','مكاتب مشتركة','كشك','غير معروف','مركز أعمال','مواقف','تخزين ذاتي','مخازن سحابية'])) whole
    from public.search_listings_ar s
    where s.latitude is not null and s.longitude is not null
  ), bad as (
    -- One site, one exact point: ten or more different whole properties (kind + size) AND several kinds
    -- (three kinds, or two kinds offered both for sale and for rent). «أرض سكنية» and «أرض تجارية» are one kind.
    select platform, la, lo
    from a where whole
    group by platform, la, lo
    having count(distinct (type_ar, area_m2)) >= 10
       and (count(distinct split_part(type_ar, ' ', 1)) >= 3
            or (count(distinct split_part(type_ar, ' ', 1)) >= 2 and count(distinct deal_ar) >= 2))
  )
  select a.source_table, a.listing_id, a.la lat, a.lo lng from a join bad using (platform, la, lo);

  select count(*) into v_new from map_stray_new;
  -- A rule that suddenly wants thousands of pins off the map is a broken rule, not a finding: keep the last set.
  if v_new > 5000 then
    raise exception 'map_stray_pin_refresh_ar: % listings flagged (ceiling 5000) — previous set kept', v_new;
  end if;
  delete from public.map_stray_pin;
  insert into public.map_stray_pin (source_table, listing_id, lat, lng)
  select source_table, listing_id, lat, lng from map_stray_new on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.map_stray_pin_refresh_ar() from public, anon, authenticated;

-- The pins' source view: a stray pin is not drawn, and a pin borrowed from a stray donor is not drawn either.
create or replace view public.map_listing_points_ar as
 SELECT s.source_table, s.listing_id, s.latitude, s.longitude, s.type_ar, s.platform, s.deal_ar, s.rent_period_ar,
    s.price_total, s.price_annual, s.bedrooms, s.area_m2, s.city_ar, s.district_ar, s.region_ar, s.furnished
   FROM search_listings_ar s
  WHERE ((s.latitude IS NOT NULL) AND (s.longitude IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM map_stray_pin st WHERE st.source_table = s.source_table AND st.listing_id = s.listing_id)
UNION ALL
 SELECT s.source_table, s.listing_id, b.lat AS latitude, b.lng AS longitude, s.type_ar, s.platform, s.deal_ar, s.rent_period_ar,
    s.price_total, s.price_annual, s.bedrooms, s.area_m2, s.city_ar, s.district_ar, s.region_ar, s.furnished
   FROM (map_pin_borrow b
     JOIN search_listings_ar s ON (((s.source_table = b.source_table) AND (s.listing_id = b.listing_id))))
  WHERE ((s.latitude IS NULL) OR (s.longitude IS NULL))
    AND NOT EXISTS (SELECT 1 FROM map_stray_pin st WHERE st.source_table = b.donor_table AND st.listing_id = b.donor_id);

-- The district markers: listings with no pin of their own (as before) PLUS the stray pins.
create or replace function public.map_nopin_refresh_ar()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $$
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
         s.area_m2 area, s.type_ar, s.bedrooms beds, s.furnished
  from public.search_listings_ar s
  left join ctr c on c.city = btrim(s.city_ar) and c.district = btrim(s.district_ar)
  left join public.loc_city_center cc on cc.city_id = s.city_id
  where (s.latitude is null or s.longitude is null)
    -- A listing that borrowed its sure twin's pin is already on the map at that pin.
    and not exists (select 1 from public.map_pin_borrow b where b.source_table = s.source_table and b.listing_id = s.listing_id)
    and s.deal_ar in ('بيع', 'إيجار')
    and coalesce(c.lat, cc.lat::double precision) is not null
    and nullif(btrim(s.city_ar), '') is not null
  union all
  -- A stray pin (map_stray_pin) is a site's stand-in point, not a place: the ad shows under its district's marker.
  -- So does a pin-less ad whose borrowed pin came from a stray donor.
  select s.source_table, s.listing_id,
         coalesce(c.city, btrim(s.city_ar)) city,
         case when c.city is not null then c.district else '' end district,
         coalesce(c.lat, cc.lat::double precision) lat, coalesce(c.lng, cc.lng::double precision) lng,
         case when s.deal_ar = 'بيع' then 'buy'
              when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
              when s.deal_ar = 'إيجار' then 'rent' end as deal,
         case when s.deal_ar = 'بيع' then s.price_total else s.price_annual end as price,
         s.area_m2 area, s.type_ar, s.bedrooms beds, s.furnished
  from public.search_listings_ar s
  left join ctr c on c.city = btrim(s.city_ar) and c.district = btrim(s.district_ar)
  left join public.loc_city_center cc on cc.city_id = s.city_id
  where (exists (select 1 from public.map_stray_pin st where st.source_table = s.source_table and st.listing_id = s.listing_id)
         or ((s.latitude is null or s.longitude is null)
             and exists (select 1 from public.map_pin_borrow b
                           join public.map_stray_pin st on st.source_table = b.donor_table and st.listing_id = b.donor_id
                          where b.source_table = s.source_table and b.listing_id = s.listing_id)))
    and s.deal_ar in ('بيع', 'إيجار')
    and coalesce(c.lat, cc.lat::double precision) is not null
    and nullif(btrim(s.city_ar), '') is not null;
  delete from public.map_nopin_ar;
  insert into public.map_nopin_ar (source_table, listing_id, city, district, lat, lng, deal, price, area, type_ar, beds, furnished)
  select distinct on (source_table, listing_id) source_table, listing_id, city, district, lat, lng, deal, price, area, type_ar, beds, furnished from map_nopin_new;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- The drawn spot of every twin: pass 1 = same-site twins (unchanged), pass 2 = the same licence across sites.
create or replace function public.map_pin_snap_refresh_ar()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $$
declare
  v_n integer := 0;
begin
  create temp table map_pin_snap_new on commit drop as
  with s as (
    select x.source_table, x.listing_id, x.latitude::double precision la, x.longitude::double precision lo,
           x.deal_ar, coalesce(x.price_total, x.price_annual, -1) price, coalesce(x.area_m2, -1) area_m2,
           coalesce(x.type_ar, '') type_ar, coalesce(x.bedrooms, -1) bedrooms,
           case when coalesce(x.price_total, x.price_annual) is null then coalesce(x.price_per_meter, -1) else -1 end ppm
    from public.search_listings_ar x
    where x.latitude is not null and x.longitude is not null
      and not exists (select 1 from public.ops_default_pin_register r
                       where r.source_table = x.source_table and r.lat = round(x.latitude::numeric, 5) and r.lng = round(x.longitude::numeric, 5))
      and not exists (select 1 from public.map_stray_pin st where st.source_table = x.source_table and st.listing_id = x.listing_id)
  ), multi as (
    select source_table, deal_ar, price, area_m2, type_ar, bedrooms, ppm
    from s group by 1, 2, 3, 4, 5, 6, 7 having count(distinct (la, lo)) > 1
  ), c as (
    select s.*, extensions.ST_ClusterDBSCAN(extensions.ST_MakePoint(s.lo, s.la), 0.0009, 2)
             over (partition by s.source_table, s.deal_ar, s.price, s.area_m2, s.type_ar, s.bedrooms, s.ppm) cid
    from s join multi m using (source_table, deal_ar, price, area_m2, type_ar, bedrooms, ppm)
  ), spot as (
    select c.*, count(*) over (partition by source_table, deal_ar, price, area_m2, type_ar, bedrooms, ppm, cid, la, lo) at_spot
    from c where cid is not null
  ), anchored as (
    select spot.*,
           first_value(la) over w a_la, first_value(lo) over w a_lo
    from spot
    window w as (partition by source_table, deal_ar, price, area_m2, type_ar, bedrooms, ppm, cid order by at_spot desc, listing_id)
  )
  select source_table, listing_id, a_la lat, a_lo lng from anchored where a_la <> la or a_lo <> lo;

  -- PASS 2 — ONE LICENCE, ONE PROPERTY, ONE PIN (owner 2026-11-10). The government advertising licence names one
  -- property, so its copies on different sites are the same place. Proof, not looks: the licence is a real number,
  -- the city and the deal match, the sizes agree (within 1 m²), and every copy already sits within ~150 m of the
  -- others. All of them are drawn where most of them already are (ties: the lowest site name, then listing id).
  create temp table map_pin_lic_new on commit drop as
  with e as (
    select x.source_table, x.listing_id, x.license_number lic, x.city_id, x.deal_ar, x.area_m2,
           x.latitude::double precision la, x.longitude::double precision lo,
           coalesce(n.lat, x.latitude::double precision) ela, coalesce(n.lng, x.longitude::double precision) elo
    from public.search_listings_ar x
    left join map_pin_snap_new n on n.source_table = x.source_table and n.listing_id = x.listing_id
    where x.latitude is not null and x.longitude is not null
      and x.license_number ~ '^[0-9]{6,}$' and x.city_id is not null and x.deal_ar is not null
      and not exists (select 1 from public.ops_default_pin_register r
                       where r.source_table = x.source_table and r.lat = round(x.latitude::numeric, 5) and r.lng = round(x.longitude::numeric, 5))
      and not exists (select 1 from public.map_stray_pin st where st.source_table = x.source_table and st.listing_id = x.listing_id)
  ), g as (
    select lic, city_id, deal_ar
    from e group by lic, city_id, deal_ar
    having count(*) between 2 and 40 and count(distinct (ela, elo)) > 1
       and max(la) - min(la) <= 0.0015 and max(lo) - min(lo) <= 0.0015
       and coalesce(max(area_m2) - min(area_m2), 0) <= 1
  ), spot as (
    select e.*, count(*) over (partition by lic, city_id, deal_ar, ela, elo) at_spot
    from e join g using (lic, city_id, deal_ar)
  )
  select source_table, listing_id, la, lo,
         first_value(ela) over w a_la, first_value(elo) over w a_lo
  from spot
  window w as (partition by lic, city_id, deal_ar order by at_spot desc, source_table, listing_id);

  delete from map_pin_snap_new n using map_pin_lic_new l where l.source_table = n.source_table and l.listing_id = n.listing_id;
  insert into map_pin_snap_new (source_table, listing_id, lat, lng)
  select source_table, listing_id, a_la, a_lo from map_pin_lic_new where a_la <> la or a_lo <> lo;

  delete from public.map_pin_snap;
  insert into public.map_pin_snap (source_table, listing_id, lat, lng)
  select source_table, listing_id, lat, lng from map_pin_snap_new on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- The hourly grid refresh finds the stray pins first (own block: a failure keeps the previous set and the grid).
do $mig$
declare v text; v2 text;
begin
  v := pg_get_functiondef('public.map_grid_refresh_ar()'::regprocedure);
  if position('map_stray_pin_refresh_ar' in v) > 0 then return; end if;
  v2 := replace(v, '  begin' || chr(10) || '    perform public.map_pin_snap_refresh_ar();',
    '  begin' || chr(10) || '    perform public.map_stray_pin_refresh_ar();' || chr(10) || '  exception when others then' || chr(10)
    || '    raise warning ''map_stray_pin_refresh_ar failed: %'', sqlerrm;' || chr(10) || '  end;' || chr(10)
    || '  begin' || chr(10) || '    perform public.map_pin_snap_refresh_ar();');
  if v2 = v then raise exception 'map_grid_refresh_ar: unexpected shape, stray refresh not added'; end if;
  execute v2;
end
$mig$;