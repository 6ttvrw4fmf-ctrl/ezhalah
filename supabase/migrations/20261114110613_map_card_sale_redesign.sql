-- THE MAP CARD FOR A RESIDENTIAL SALE, REDESIGNED (owner 2026-11-14: «it should strictly follow what the user selected …
-- we can get sued»; picture agreed in chat the same day). Every number follows EVERY filter the user picked, «نشر خلال»
-- included (it was dropped before); the card adds the price per metre of all its ads (ppm_all), how many priced ads
-- (n_priced), the share of each room count (rooms_share) and the price by rooms (by_rooms, top 3 with ≥ 10 ads), the
-- sale types with ≥ 10 priced ads (price_types, for the type buttons), the sites in the view (site_list, for the logos)
-- and a WEEKLY graph of the displayed price per metre — drawn only from the complete record of every new ad
-- (map_fact_ad_seen, started today), in Saudi weeks that ended 3 days ago, from sites read for 30 days, ≥ 10 ads a point.
-- The old signatures are dropped first so no second overload exists (the PGRST203 outage shape).

create table if not exists public.map_fact_ad_seen (
  source_table text not null, listing_id bigint not null, platform text, deal text, type_ar text, unit_subtype_ar text,
  price numeric, area_m2 integer, bedrooms integer, furnished boolean, city_ar text, district_ar text,
  latitude numeric, longitude numeric, posted_at timestamptz, first_seen_at timestamptz not null,
  primary key (source_table, listing_id));
create index if not exists map_fact_ad_seen_posted_idx on public.map_fact_ad_seen (deal, posted_at);
create index if not exists map_fact_ad_seen_seen_idx on public.map_fact_ad_seen (first_seen_at);
alter table public.map_fact_ad_seen enable row level security;
revoke all on table public.map_fact_ad_seen from public, anon, authenticated;

create table if not exists public.map_fact_site_start (source_table text primary key, first_seen timestamptz not null);
alter table public.map_fact_site_start enable row level security;
revoke all on table public.map_fact_site_start from public, anon, authenticated;

-- the record starts with every ad in the latest snapshot (its weeks are before the first graph week, so none is misdated)
insert into public.map_fact_ad_seen (source_table, listing_id, platform, deal, type_ar, unit_subtype_ar, price, area_m2,
                                     bedrooms, furnished, city_ar, district_ar, latitude, longitude, posted_at, first_seen_at)
select p.source_table, p.listing_id, p.platform, p.deal, p.type_ar, p.unit_subtype_ar, p.price, p.area_m2,
       p.bedrooms, p.furnished, p.city_ar, p.district_ar, p.latitude, p.longitude, p.posted_at, p.taken_at
from public.map_fact_points_snapshot p
on conflict (source_table, listing_id) do nothing;
insert into public.map_fact_site_start (source_table, first_seen)
select c.source_table, min(c.first_seen_at) from public.listing_comparables c group by c.source_table
on conflict (source_table) do update set first_seen = least(public.map_fact_site_start.first_seen, excluded.first_seen);

create or replace function public.map_fact_capture_removals()
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare v_prev timestamptz; v_short text[]; t text; c int; v_left int := 0; v_logged int := 0; v_pruned int := 0; v_rows int := 0; v_nb int := 0;
begin
  select max(taken_at) into v_prev from public.map_fact_points_snapshot;
  v_short := public.map_fact_short_pairs();
  drop table if exists _mf_left;
  if v_prev is not null then
    create temp table _mf_left on commit drop as
      select p.* from public.map_fact_points_snapshot p
      where not exists (select 1 from public.search_listings_ar s where s.source_table = p.source_table and s.listing_id = p.listing_id);
    get diagnostics v_left = row_count;
    for t in select distinct g.source_table from _mf_left g loop
      if to_regclass('public.' || quote_ident(t)) is null then continue; end if;
      execute format($q$
        insert into public.map_fact_removal (source_table, listing_id, platform, deal, type_ar, unit_subtype_ar, price, area_m2,
                                             city_ar, district_ar, latitude, longitude, posted_at, deactivated_at, left_at,
                                             bedrooms, furnished)
        select g.source_table, g.listing_id, g.platform, g.deal, g.type_ar, g.unit_subtype_ar, g.price, g.area_m2,
               g.city_ar, g.district_ar, g.latitude, g.longitude, g.posted_at, r.deactivated_at, now(), g.bedrooms, g.furnished
        from _mf_left g join public.%I r on r.id = g.listing_id
        where g.source_table = %L and r.active = false and r.deactivated_at is not null
          and r.deactivated_at >= %L::timestamptz - interval '1 day'
          and exists (select 1 from public.ops_liveness_registry lr
                      where lr.platform = regexp_replace(g.source_table, '_(residential|commercial)_listings$', '')
                        and lr.strategy in ('DIRECT_REVISIT', 'CANDIDATE_PLUS_DIRECT'))
          and not exists (select 1 from public.ops_adjudicated_listing j where j.tbl = %L and j.listing_id = r.id)
        on conflict (source_table, listing_id) do nothing$q$, t, t, v_prev, t);
      get diagnostics c = row_count; v_logged := v_logged + c;
    end loop;
  end if;
  -- an ad that came back is not gone
  for t in select distinct m.source_table from public.map_fact_removal m loop
    if to_regclass('public.' || quote_ident(t)) is null then continue; end if;
    execute format('delete from public.map_fact_removal m using public.%I r where m.source_table = %L and r.id = m.listing_id and r.active', t, t);
    get diagnostics c = row_count; v_pruned := v_pruned + c;
  end loop;
  delete from public.map_fact_removal where left_at < now() - interval '100 days';
  truncate public.map_fact_points_snapshot;
  insert into public.map_fact_points_snapshot (source_table, listing_id, platform, deal, type_ar, unit_subtype_ar, price, area_m2,
                                               city_ar, district_ar, latitude, longitude, posted_at, taken_at, bedrooms, furnished)
  select distinct on (s.source_table, s.listing_id)
         s.source_table, s.listing_id, s.platform, x.deal, s.type_ar, s.unit_subtype_ar,
         case when s.deal_ar = 'بيع' then coalesce(s.price_total_effective, s.price_total) else s.price_annual end, s.area_m2,
         s.city_ar, s.district_ar, s.latitude, s.longitude, s.posted_at, now(), s.bedrooms, s.furnished
  from public.map_listing_points_ar s
  cross join lateral (select case when s.deal_ar = 'بيع' then 'buy'
                                  when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
                                  when s.deal_ar = 'إيجار' then 'rent' end as deal) x
  where s.latitude is not null and s.longitude is not null and x.deal is not null;
  get diagnostics v_rows = row_count;
  -- THE RECORD OF EVERY NEW AD (owner 2026-11-14, «full filters»): the first time an ad is in the index it is kept here
  -- with everything the map's filters read, and it stays after the ad leaves — so a past week of the card's graph is
  -- never missing the ads that already went (the removal log keeps only verified removals)
  insert into public.map_fact_ad_seen (source_table, listing_id, platform, deal, type_ar, unit_subtype_ar, price, area_m2,
                                       bedrooms, furnished, city_ar, district_ar, latitude, longitude, posted_at, first_seen_at)
  select p.source_table, p.listing_id, p.platform, p.deal, p.type_ar, p.unit_subtype_ar, p.price, p.area_m2,
         p.bedrooms, p.furnished, p.city_ar, p.district_ar, p.latitude, p.longitude, p.posted_at, p.taken_at
  from public.map_fact_points_snapshot p
  on conflict (source_table, listing_id) do nothing;
  delete from public.map_fact_ad_seen where first_seen_at < now() - interval '400 days';
  -- each site's first day in our record (the price diary's own first sighting): a site read for under 30 days never
  -- moves the graph
  insert into public.map_fact_site_start (source_table, first_seen)
  select c.source_table, min(c.first_seen_at) from public.listing_comparables c group by c.source_table
  on conflict (source_table) do update set first_seen = least(public.map_fact_site_start.first_seen, excluded.first_seen);
  v_nb := public.map_fact_build_neighbors();
  insert into public.map_fact_capture_run (ok, prev_taken_at, snapshot_rows, left_index, logged, reactivated_pruned)
  values (true, v_prev, v_rows, v_left, v_logged, v_pruned);
  return jsonb_build_object('prev_taken_at', v_prev, 'snapshot_rows', v_rows, 'left_index', v_left, 'logged', v_logged,
                            'reactivated_pruned', v_pruned, 'districts_with_neighbors', v_nb);
end
$function$;

revoke all on function public.map_fact_capture_removals() from public, anon, authenticated;

drop function if exists public.map_view_card_ar(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text, text, text);
drop function if exists public.map_view_card_core(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text, text, text[], boolean, text);
create or replace function public.map_view_card_core(
  p_s double precision, p_w double precision, p_n double precision, p_e double precision,
  p_deals text[] default null, p_poly jsonb default null, p_category text default null, p_types text[] default null,
  p_beds integer[] default null, p_area_min integer default null, p_area_max integer default null,
  p_price_min numeric default null, p_price_max numeric default null, p_furnished boolean default null,
  p_tables text[] default null, p_tables2 text[] default null, p_types2 text[] default null, p_macro text default null,
  p_city text default null, p_districts text[] default null, p_nb boolean default true, p_price_type text default null,
  p_posted_within_days integer default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_short text[];
  v_geom extensions.geometry;
  v_log_start timestamptz;
  v_log_fresh boolean;
  v_diary_start timestamptz;
  v_day1 timestamptz;
  v_day0 timestamptz;
  v_fresh_nb boolean;
  v_nb record;
  v_nbv jsonb;
  v jsonb;
  v_seen_start timestamptz;
  v_wk0 timestamptz;
  v_wk_cur timestamptz;
begin
  v_short := public.map_fact_short_pairs();
  v_geom := case when p_poly is null then null
                 else extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_poly::text), 4326) end;
  select min(cr.run_at) into v_log_start from public.map_fact_capture_run cr where cr.ok;
  v_log_fresh := exists (select 1 from public.map_fact_capture_run cr where cr.ok and cr.run_at >= now() - interval '36 hours');
  select ss.started_at into v_diary_start from public.map_fact_source_start ss where ss.source = 'price_diary';
  -- «أمس» is the last FINISHED day in Riyadh (never «اليوم», which reads 0 in the morning)
  v_day1 := (date_trunc('day', now() at time zone 'Asia/Riyadh')) at time zone 'Asia/Riyadh';
  v_day0 := v_day1 - interval '1 day';
  v_fresh_nb := exists (select 1 from public.map_district_neighbors nbt where nbt.built_at >= now() - interval '36 hours');
  -- the weekly graph (owner 2026-11-14 «full filters»): Saudi weeks (Sunday first), only weeks that start after the
  -- complete record of every new ad began (map_fact_ad_seen), so no week is missing the ads that already left
  select min(a.first_seen_at) into v_seen_start from public.map_fact_ad_seen a;
  v_wk_cur := (date_trunc('week', (now() at time zone 'Asia/Riyadh') + interval '1 day') - interval '1 day') at time zone 'Asia/Riyadh';
  v_wk0 := (date_trunc('week', (v_seen_start at time zone 'Asia/Riyadh') + interval '1 day') - interval '1 day') at time zone 'Asia/Riyadh';
  if v_wk0 < v_seen_start then v_wk0 := v_wk0 + interval '7 days'; end if;
  with kept as (
    select case when s.deal_ar = 'بيع' then 'buy'
                when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
                when s.deal_ar = 'إيجار' then 'rent' end as deal,
           case when s.deal_ar = 'بيع' then coalesce(s.price_total_effective, s.price_total) else s.price_annual end as price, s.posted_at,
           s.type_ar, s.platform, s.area_m2, s.city_ar, s.district_ar, s.source_table, s.listing_id, s.bedrooms
    from public.map_listing_points_ar s
    where s.latitude is not null and s.longitude is not null
      and s.latitude between p_s::numeric and p_n::numeric and s.longitude between p_w::numeric and p_e::numeric
      and (p_city is null or (s.city_ar = p_city and (p_districts is null or s.district_ar = any (p_districts))))
      and not exists (select 1 from public.ops_default_pin_register r
                       where r.source_table = s.source_table and r.lat = round(s.latitude::numeric, 5) and r.lng = round(s.longitude::numeric, 5))
      and (p_category is null or (p_category = 'residential' and s.source_table like '%\_residential\_%')
                              or (p_category = 'commercial' and s.source_table like '%\_commercial\_%'))
      and ( ((p_tables is null or s.source_table = any (p_tables))
             and (p_types is null or s.type_ar = any (p_types) or (s.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (p_types))))
         or (p_tables2 is not null and p_types2 is not null and s.source_table = any (p_tables2)
             and (s.type_ar = any (p_types2) or (s.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (p_types2)))) )
      and (p_macro is null
           or (s.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (coalesce(p_types, '{}'::text[]) || coalesce(p_types2, '{}'::text[])))
           or s.type_ar in (select k.type_ar from public.known_type_ar k where k.macro = p_macro)
           or (s.type_ar in (select k.type_ar from public.known_type_ar k where k.macro = 'both')
               and (case p_macro when 'Residential' then s.source_table like '%\_residential\_listings'
                                 when 'Commercial' then s.source_table like '%\_commercial\_listings' else true end)))
      and (p_beds is null or s.bedrooms = any (p_beds)) and (p_furnished is null or s.furnished = p_furnished)
      and (p_area_min is null or s.area_m2 >= p_area_min) and (p_area_max is null or s.area_m2 <= p_area_max)
      and (v_geom is null or extensions.ST_Contains(v_geom, extensions.ST_SetSRID(extensions.ST_MakePoint(s.longitude::double precision, s.latitude::double precision), 4326)))
  ), f as (
    select k.* from kept k
    where k.deal is not null and (p_deals is null or k.deal = any (p_deals))
      and (p_price_min is null or k.price >= p_price_min) and (p_price_max is null or k.price <= p_price_max)
      -- «نشر خلال» applies to the card too (owner 2026-11-14: «it should strictly follow what the user selected»)
      and (p_posted_within_days is null or (k.posted_at is not null and k.posted_at >= now() - make_interval(days => p_posted_within_days)))
  ), fd as (
    select f.*, (f.price is null or f.area_m2 is null
                 or f.platform = min(f.platform) over (partition by f.deal, f.type_ar, f.price, f.area_m2, f.city_ar, f.district_ar)) as own
    from f
  ), own as materialized (
    select fd.* from fd where fd.own
  ), place as (
    select (select f.city_ar from f where f.city_ar is not null group by f.city_ar
            having count(*) * 10 >= (select count(*) from f) * 6 order by count(*) desc, f.city_ar limit 1) as city,
           (select f.district_ar from f where f.district_ar is not null group by f.district_ar
            having count(*) * 10 >= (select count(*) from f) * 6 order by count(*) desc, f.district_ar limit 1) as district,
           (select count(distinct f.type_ar) from f) as n_types,
           (select count(distinct f.district_ar) from f) as n_districts
  ), ptype as (
    -- the ONE type every price is about: the picked type when the view holds only it, else the most common sale type
    -- with ≥ 10 priced ads (named on the card) — a price is never a mix of types. «أحياء قريبة» is handed the main
    -- card's type (p_price_type), so its prices measure the SAME type while its counts keep the SAME filters.
    select p_price_type as type_ar where p_price_type is not null
    union all
    select x.type_ar from (
      select o.type_ar from own o
      where p_deals = array['buy']::text[] and o.deal = 'buy' and o.price > 0 and o.area_m2 > 0 and o.type_ar is not null
      group by o.type_ar having count(*) >= 10
      order by count(*) desc, o.type_ar limit 1) x
    where p_price_type is null
  ), pr as materialized (
    select o.* from own o where o.deal = 'buy' and o.price > 0 and o.type_ar = (select ptype.type_ar from ptype)
  ), win as (
    select * from (values ('y', v_day0, v_day1), ('w', now() - interval '7 days', now() + interval '1 day'),
                          ('m', now() - interval '30 days', now() + interval '1 day'), ('q', now() - interval '90 days', now() + interval '1 day')) w(k, a, b)
  ), g as (
    -- removed ads (the nightly confirmed-removal log), under the SAME filters as the box
    select r.deal, r.type_ar, r.price, r.area_m2, r.city_ar, r.district_ar, r.platform, r.left_at, r.posted_at
    from public.map_fact_removal r
    where v_log_fresh and r.left_at >= now() - interval '90 days'
      and r.latitude between p_s::numeric and p_n::numeric and r.longitude between p_w::numeric and p_e::numeric
      and (p_city is null or (r.city_ar = p_city and (p_districts is null or r.district_ar = any (p_districts))))
      and not exists (select 1 from public.ops_default_pin_register d
                       where d.source_table = r.source_table and d.lat = round(r.latitude::numeric, 5) and d.lng = round(r.longitude::numeric, 5))
      and (p_deals is null or r.deal = any (p_deals))
      and (p_category is null or (p_category = 'residential' and r.source_table like '%\_residential\_%')
                              or (p_category = 'commercial' and r.source_table like '%\_commercial\_%'))
      and ( ((p_tables is null or r.source_table = any (p_tables))
             and (p_types is null or r.type_ar = any (p_types) or (r.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (p_types))))
         or (p_tables2 is not null and p_types2 is not null and r.source_table = any (p_tables2)
             and (r.type_ar = any (p_types2) or (r.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (p_types2)))) )
      and (p_macro is null
           or (r.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (coalesce(p_types, '{}'::text[]) || coalesce(p_types2, '{}'::text[])))
           or r.type_ar in (select k.type_ar from public.known_type_ar k where k.macro = p_macro)
           or (r.type_ar in (select k.type_ar from public.known_type_ar k where k.macro = 'both')
               and (case p_macro when 'Residential' then r.source_table like '%\_residential\_listings'
                                 when 'Commercial' then r.source_table like '%\_commercial\_listings' else true end)))
      and (p_beds is null or r.bedrooms = any (p_beds)) and (p_furnished is null or r.furnished = p_furnished)
      and (p_area_min is null or r.area_m2 >= p_area_min) and (p_area_max is null or r.area_m2 <= p_area_max)
      and (p_price_min is null or r.price >= p_price_min) and (p_price_max is null or r.price <= p_price_max)
      and (p_posted_within_days is null or (r.posted_at is not null and r.posted_at >= now() - make_interval(days => p_posted_within_days)))
      and (v_geom is null or extensions.ST_Contains(v_geom, extensions.ST_SetSRID(extensions.ST_MakePoint(r.longitude::double precision, r.latitude::double precision), 4326)))
  ), gd as materialized (
    select g.* from (select g0.*, (g0.price is null or g0.area_m2 is null
                       or g0.platform = min(g0.platform) over (partition by g0.deal, g0.type_ar, g0.price, g0.area_m2, g0.city_ar, g0.district_ar)) as own
                     from g g0) g
    where g.own
  ), cut as materialized (
    -- a seller lowered the asking price (the price diary's own events; a drop of more than half is a page re-read)
    select h.at from own o join public.listing_price_history h on h.source_table = o.source_table and h.listing_id = o.listing_id
    where o.deal = 'buy' and h.event = 'price' and h.at >= now() - interval '90 days'
      and h.price_total > 0 and h.old_price_total > 0 and h.price_total < h.old_price_total and h.price_total >= h.old_price_total * 0.5
  ), rows_ as (
    select w.k,
      (select count(*) from own o where o.posted_at >= w.a and o.posted_at < w.b) as new_n,
      case when v_log_fresh and v_log_start <= w.a then (select count(*) from gd where gd.left_at >= w.a and gd.left_at < w.b) end as gone_n,
      -- price cuts only where the diary covered the whole window AND was healthy all through it (no open or overlapping
      -- price_diary_unhealthy alarm — a listing table without its diary trigger would read as «0 cuts»)
      case when v_diary_start <= w.a and p_deals = array['buy']::text[]
                and not exists (select 1 from public.alert_event a where a.kind = 'price_diary_unhealthy' and coalesce(a.resolved_at, now()) >= w.a)
           then (select count(*) from cut where cut.at >= w.a and cut.at < w.b) end as cuts_n,
      (select count(*) from pr where pr.area_m2 > 0 and pr.posted_at >= w.a and pr.posted_at < w.b) as ppm_n,
      (select round(percentile_cont(0.5) within group (order by pr.price / pr.area_m2))::bigint from pr
        where pr.area_m2 > 0 and pr.posted_at >= w.a and pr.posted_at < w.b) as ppm_med
    from win w
  ), sn0 as (
    -- every NEW ad of the price type as first seen (map_fact_ad_seen keeps it even after it leaves): the SAME filters as
    -- the box, word for word; posted (the site's date) in a finished Saudi week of the complete record; seen within 3 days
    -- of posting (a site's old back catalogue never rewrites a past week); from a site we had read for 30 days by then
    -- (a newly added site never makes a jump); never with «نشر خلال», which a weekly history cannot honour
    select a.price, a.area_m2, a.posted_at, a.platform, a.type_ar, a.city_ar, a.district_ar
    from public.map_fact_ad_seen a
    where a.latitude is not null and a.longitude is not null
      and a.latitude between p_s::numeric and p_n::numeric and a.longitude between p_w::numeric and p_e::numeric
      and (p_city is null or (a.city_ar = p_city and (p_districts is null or a.district_ar = any (p_districts))))
      and not exists (select 1 from public.ops_default_pin_register r
                       where r.source_table = a.source_table and r.lat = round(a.latitude::numeric, 5) and r.lng = round(a.longitude::numeric, 5))
      and (p_category is null or (p_category = 'residential' and a.source_table like '%\_residential\_%')
                              or (p_category = 'commercial' and a.source_table like '%\_commercial\_%'))
      and ( ((p_tables is null or a.source_table = any (p_tables))
             and (p_types is null or a.type_ar = any (p_types) or (a.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (p_types))))
         or (p_tables2 is not null and p_types2 is not null and a.source_table = any (p_tables2)
             and (a.type_ar = any (p_types2) or (a.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (p_types2)))) )
      and (p_macro is null
           or (a.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (coalesce(p_types, '{}'::text[]) || coalesce(p_types2, '{}'::text[])))
           or a.type_ar in (select k.type_ar from public.known_type_ar k where k.macro = p_macro)
           or (a.type_ar in (select k.type_ar from public.known_type_ar k where k.macro = 'both')
               and (case p_macro when 'Residential' then a.source_table like '%\_residential\_listings'
                                 when 'Commercial' then a.source_table like '%\_commercial\_listings' else true end)))
      and (p_beds is null or a.bedrooms = any (p_beds)) and (p_furnished is null or a.furnished = p_furnished)
      and (p_area_min is null or a.area_m2 >= p_area_min) and (p_area_max is null or a.area_m2 <= p_area_max)
      and (v_geom is null or extensions.ST_Contains(v_geom, extensions.ST_SetSRID(extensions.ST_MakePoint(a.longitude::double precision, a.latitude::double precision), 4326)))
      and a.deal = 'buy' and p_deals = array['buy']::text[] and p_posted_within_days is null
      and a.type_ar = (select ptype.type_ar from ptype) and a.price > 0 and a.area_m2 > 0
      and (p_price_min is null or a.price >= p_price_min) and (p_price_max is null or a.price <= p_price_max)
      and a.posted_at >= v_wk0 and a.posted_at < v_wk_cur and a.first_seen_at <= a.posted_at + interval '3 days'
      and exists (select 1 from public.map_fact_site_start ss where ss.source_table = a.source_table and ss.first_seen <= a.posted_at - interval '30 days')
  ), sn as materialized (
    select x.* from (select s0.*, s0.platform = min(s0.platform) over (partition by s0.type_ar, s0.price, s0.area_m2, s0.city_ar, s0.district_ar) as own
                     from sn0 s0) x
    where x.own
  ), wk as (
    -- a week counts only once it ended 3 days ago and the record was written every day from its start until then
    select ws.ws from generate_series(v_wk0, v_wk_cur - interval '7 days', interval '7 days') ws(ws)
    where v_wk0 is not null and ws.ws + interval '10 days' <= now()
      and (select count(distinct (cr.run_at at time zone 'Asia/Riyadh')::date) from public.map_fact_capture_run cr
           where cr.ok and cr.run_at >= ws.ws and cr.run_at < ws.ws + interval '10 days') >= 10
    order by ws.ws desc limit 8
  ), ages as (
    select sl.property_age from pr join public.search_listings_ar sl on sl.source_table = pr.source_table and sl.listing_id = pr.listing_id
    where sl.property_age is not null and sl.property_age between 0 and 100
  )
  select jsonb_build_object(
    'any', (select count(*) from f),
    'city_ar', (select place.city from place),
    'district_ar', (select place.district from place),
    'n_districts', (select place.n_districts from place),
    'price_type', (select ptype.type_ar from ptype),
    'table', (select jsonb_object_agg(r.k, jsonb_build_object('new', r.new_n, 'gone', r.gone_n, 'cuts', r.cuts_n,
               'ppm', case when r.ppm_n >= 10 and r.ppm_med between 10 and 200000 then r.ppm_med end, 'ppm_n', r.ppm_n)) from rows_ r),
    'median_price', (select case when count(*) >= 10 then round(percentile_cont(0.5) within group (order by pr.price))::bigint end from pr),
    'median_area', (select case when count(*) >= 10 then round(percentile_cont(0.5) within group (order by pr.area_m2))::bigint end from pr where pr.area_m2 > 0),
    'price_low', (select case when count(*) >= 10 then round(percentile_cont(0.1) within group (order by pr.price))::bigint end from pr),
    'price_high', (select case when count(*) >= 10 then round(percentile_cont(0.9) within group (order by pr.price))::bigint end from pr),
    -- how long an ad stays up: posted (the site's date) to confirmed removal — a median of the removals seen so far
    -- (owner 2026-11-13: «ok ok»), shown from 10 of them; a duration needs no full window, only enough ads
    'stay_days', (select case when count(*) >= 10 then round(percentile_cont(0.5) within group (order by extract(epoch from gd.left_at - gd.posted_at) / 86400))::int end
                  from gd where gd.posted_at is not null and gd.left_at > gd.posted_at),
    'top_type', (select jsonb_build_object('type', x.type_ar, 'pct', round(100.0 * x.n / nullif((select count(*) from f), 0)))
                 from (select f.type_ar, count(*) as n from f where f.type_ar is not null group by f.type_ar order by count(*) desc, f.type_ar limit 1) x),
    'top_rooms', (select case when sum(x.n) over () >= 10 then jsonb_build_object('rooms', x.bedrooms, 'pct', round(100.0 * x.n / sum(x.n) over ())) end
                  from (select pr.bedrooms, count(*) as n from pr where pr.bedrooms between 1 and 20 group by pr.bedrooms) x order by x.n desc, x.bedrooms limit 1),
    'median_age', (select case when count(*) >= 10 then round(percentile_cont(0.5) within group (order by ages.property_age))::int end from ages),
    'sites', (select count(distinct f.platform) from f),
    'site_list', (select jsonb_agg(z.platform order by z.n desc, z.platform) from (
                    select f.platform, count(*) as n from f where f.platform is not null group by f.platform) z),
    -- the redesigned sale card (owner 2026-11-14): every number of the ONE price type, ≥ 10 ads, the same filters
    'n_priced', (select count(*) from pr),
    'ppm_all', (select case when count(*) >= 10 and percentile_cont(0.5) within group (order by pr.price / pr.area_m2) between 10 and 200000
                       then round(percentile_cont(0.5) within group (order by pr.price / pr.area_m2))::bigint end from pr where pr.area_m2 > 0),
    'rooms_share', (select case when sum(x.n) >= 10 then jsonb_object_agg(x.bedrooms::text, round(100.0 * x.n / x.total)) end
                    from (select pr.bedrooms, count(*) as n, sum(count(*)) over () as total from pr where pr.bedrooms between 1 and 20 group by pr.bedrooms) x),
    'by_rooms', (select jsonb_agg(jsonb_build_object('rooms', y.bedrooms, 'n', y.n, 'price', y.med) order by y.bedrooms) from (
                   select pr.bedrooms, count(*) as n, round(percentile_cont(0.5) within group (order by pr.price))::bigint as med
                   from pr where pr.bedrooms between 1 and 20 group by pr.bedrooms having count(*) >= 10
                   order by count(*) desc, pr.bedrooms limit 3) y),
    'price_types', case when p_deals = array['buy']::text[] then (select jsonb_agg(z.type_ar order by z.n desc, z.type_ar) from (
                     select o.type_ar, count(*) as n from own o
                     where o.deal = 'buy' and o.price > 0 and o.area_m2 > 0 and o.type_ar is not null
                     group by o.type_ar having count(*) >= 10 order by count(*) desc, o.type_ar limit 3) z) end,
    'weeks', (select jsonb_agg(jsonb_build_object('start', to_char(wk.ws at time zone 'Asia/Riyadh', 'YYYY-MM-DD'), 'n', q.n,
                         'ppm', case when q.n >= 10 and q.med between 10 and 200000 then q.med end) order by wk.ws)
              from wk cross join lateral (select count(*) as n, round(percentile_cont(0.5) within group (order by sn.price / sn.area_m2))::bigint as med
                                          from sn where sn.posted_at >= wk.ws and sn.posted_at < wk.ws + interval '7 days') q),
    -- for «أحياء قريبة»: each named district's own asking price per metre, from the SAME filtered ads (≥ 10, sane bounds)
    'by_district', case when p_districts is not null then
                     (select jsonb_object_agg(x.district_ar, x.ppm) from (
                        select pr.district_ar, round(percentile_cont(0.5) within group (order by pr.price / pr.area_m2))::bigint as ppm
                        from pr where pr.area_m2 > 0 and pr.district_ar is not null group by pr.district_ar having count(*) >= 10) x
                      where x.ppm between 10 and 200000) end,
    'log_start', v_log_start, 'diary_start', v_diary_start,
    'updated_at', (select max(cr.run_at) from public.map_fact_capture_run cr where cr.ok))
  into v;
  -- too few removals here yet: the whole CITY's number, named on the card («في الرياض»), same deal — until this view has 10
  if p_nb and v_log_fresh and (v ->> 'stay_days') is null and (v ->> 'city_ar') is not null then
    v := v || jsonb_build_object('stay_city', (
      select case when count(*) >= 10 then jsonb_build_object('city', v ->> 'city_ar',
               'days', round(percentile_cont(0.5) within group (order by extract(epoch from r.left_at - r.posted_at) / 86400))::int) end
      from public.map_fact_removal r
      where r.city_ar = v ->> 'city_ar' and (p_deals is null or r.deal = any (p_deals))
        and r.posted_at is not null and r.left_at > r.posted_at and r.left_at >= now() - interval '90 days'
        and not exists (select 1 from public.ops_default_pin_register d
                        where d.source_table = r.source_table and d.lat = round(r.latitude::numeric, 5) and d.lng = round(r.longitude::numeric, 5))));
  end if;
  -- «أحياء قريبة»: the 4 nearest districts, the same filters and the SAME price type, their month (counts per district)
  if p_nb and v_fresh_nb and (v ->> 'city_ar') is not null and (v ->> 'district_ar') is not null then
    select * into v_nb from public.map_district_neighbors d where d.city_ar = v ->> 'city_ar' and d.district_ar = v ->> 'district_ar';
    if found then
      -- the SAME filters (so its counts compare like with like) and the SAME price type (so its prices do too)
      v_nbv := public.map_view_card_core(v_nb.s::float8, v_nb.w::float8, v_nb.n::float8, v_nb.e::float8, p_deals, null, p_category,
                 p_types, p_beds, p_area_min, p_area_max, p_price_min, p_price_max, p_furnished, p_tables, p_tables2, p_types2, p_macro,
                 v ->> 'city_ar', v_nb.neighbors, false, v ->> 'price_type', p_posted_within_days);
      v := v || jsonb_build_object('nb', jsonb_build_object(
        'names', to_jsonb(v_nb.neighbors),
        -- every named neighbour counts in the per-district average, even one with no matching ads
        'n_districts', greatest(cardinality(v_nb.neighbors), 1),
        'month', v_nbv -> 'table' -> 'm',
        'median_price', v_nbv -> 'median_price', 'median_area', v_nbv -> 'median_area',
        'price_low', v_nbv -> 'price_low', 'price_high', v_nbv -> 'price_high', 'stay_days', v_nbv -> 'stay_days',
        'top_type', v_nbv -> 'top_type', 'top_rooms', v_nbv -> 'top_rooms', 'median_age', v_nbv -> 'median_age',
        'n_priced', v_nbv -> 'n_priced', 'ppm_all', v_nbv -> 'ppm_all', 'rooms_share', v_nbv -> 'rooms_share',
        -- each nearby district's own asking price per metre (same type, same filters, ≥ 10 ads), in nearest-first order
        'by_district', (select jsonb_agg(jsonb_build_object('district', dd.district_ar, 'ppm', v_nbv -> 'by_district' -> dd.district_ar) order by dd.k)
                        from unnest(v_nb.neighbors) with ordinality dd(district_ar, k)
                        where (v ->> 'price_type') is not null)));
    end if;
  end if;
  return v;
end;
$function$;
revoke all on function public.map_view_card_core(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text, text, text[], boolean, text, integer) from public, anon, authenticated;

create or replace function public.map_view_card_ar(
  p_s double precision default null, p_w double precision default null, p_n double precision default null, p_e double precision default null,
  p_deals text[] default null, p_poly jsonb default null, p_category text default null, p_types text[] default null,
  p_beds integer[] default null, p_area_min integer default null, p_area_max integer default null,
  p_price_min numeric default null, p_price_max numeric default null, p_furnished boolean default null,
  p_tables text[] default null, p_tables2 text[] default null, p_types2 text[] default null, p_macro text default null,
  p_city text default null, p_district text default null, p_posted_within_days integer default null, p_price_type text default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
begin
  if not coalesce((select ff.enabled from public.ops_feature_flags ff where ff.name = 'map_view_facts'), false) then return null; end if;
  if auth.uid() is null then return jsonb_build_object('locked', true); end if;
  -- a named district: ALL its ads (the pill counts the whole district), so no box limits it
  if p_district is not null then
    if p_city is null then return null; end if;
    return public.map_view_card_core(-90, -180, 90, 180, p_deals, null, p_category, p_types, p_beds,
             p_area_min, p_area_max, p_price_min, p_price_max, p_furnished, p_tables, p_tables2, p_types2, p_macro, p_city, array[p_district], true,
             p_price_type, p_posted_within_days);
  end if;
  if p_s is null or p_w is null or p_n is null or p_e is null then return null; end if;
  return public.map_view_card_core(p_s, p_w, p_n, p_e, p_deals, p_poly, p_category, p_types, p_beds, p_area_min, p_area_max,
           p_price_min, p_price_max, p_furnished, p_tables, p_tables2, p_types2, p_macro, null, null, true, p_price_type, p_posted_within_days);
end;
$function$;
revoke all on function public.map_view_card_ar(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text, text, text, integer, text) from public;
grant execute on function public.map_view_card_ar(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text, text, text, integer, text) to anon, authenticated;

create or replace function public.audit_map_view_card()
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare
  r record; c jsonb; fc jsonb; why text[]; checked int := 0; failed int := 0; ex jsonb := '[]'::jsonb;
  mp numeric; md numeric; v_log_start timestamptz; v_day0 timestamptz; t text;
  mpa numeric; nn bigint; rj jsonb; e jsonb;
begin
  select min(cr.run_at) into v_log_start from public.map_fact_capture_run cr where cr.ok;
  v_day0 := ((date_trunc('day', now() at time zone 'Asia/Riyadh')) at time zone 'Asia/Riyadh') - interval '1 day';
  for r in (select s.latitude::float8 as lat, s.longitude::float8 as lng, s.type_ar
            from public.map_fact_points_snapshot s where s.deal = 'buy' and s.type_ar is not null and s.type_ar <> 'أرض خام'
            order by random() limit 10)
           union all
           (select s.latitude::float8, s.longitude::float8, null::text
            from public.map_fact_points_snapshot s where s.deal = 'buy' order by random() limit 5)
  loop
    checked := checked + 1; why := '{}'; mp := null; md := null;
    c := public.map_view_card_core(r.lat - 0.02, r.lng - 0.02, r.lat + 0.02, r.lng + 0.02, array['buy'], null, null,
                                   case when r.type_ar is null then null else array[r.type_ar] end);
    fc := public.map_view_facts_core(r.lat - 0.02, r.lng - 0.02, r.lat + 0.02, r.lng + 0.02, array['buy'], null, null,
                                     case when r.type_ar is null then null else array[r.type_ar] end);
    if (c ->> 'any') is distinct from (fc ->> 'any') then why := why || 'any'; end if;
    if (c -> 'table' -> 'm' ->> 'new') is distinct from (fc ->> 'new30') then why := why || 'new_month'; end if;
    if not ((c -> 'table' -> 'y' ->> 'new')::bigint <= (c -> 'table' -> 'w' ->> 'new')::bigint
            and (c -> 'table' -> 'w' ->> 'new')::bigint <= (c -> 'table' -> 'm' ->> 'new')::bigint
            and (c -> 'table' -> 'm' ->> 'new')::bigint <= (c -> 'table' -> 'q' ->> 'new')::bigint
            and (c -> 'table' -> 'q' ->> 'new')::bigint <= (c ->> 'any')::bigint) then why := why || 'new_windows'; end if;
    -- nothing shown before its log covers the window
    if v_log_start > now() - interval '7 days' and (c -> 'table' -> 'w' ->> 'gone') is not null then why := why || 'gone_week_early'; end if;
    if v_log_start > now() - interval '30 days' and (c -> 'table' -> 'm' ->> 'gone') is not null then why := why || 'gone_month_early'; end if;
    -- how long ads stay up: never a guess (≥ 10 removals) and never an impossible number
    if (c ->> 'stay_days') is not null and (c ->> 'stay_days')::int not between 0 and 3650 then why := why || 'stay_bounds'; end if;
    if (c -> 'stay_city' ->> 'days') is not null and ((c -> 'stay_city' ->> 'days')::int not between 0 and 3650 or (c ->> 'stay_days') is not null) then why := why || 'stay_city'; end if;
    if v_log_start > now() - interval '90 days' and (c -> 'table' -> 'q' ->> 'gone') is not null then why := why || 'gone_quarter_early'; end if;
    if v_log_start > v_day0 and (c -> 'table' -> 'y' ->> 'gone') is not null then why := why || 'gone_yesterday_early'; end if;
    -- the price type: the picked one when the view holds only it
    t := c ->> 'price_type';
    if r.type_ar is not null and t is not null and t <> r.type_ar and (fc ->> 'one_type')::boolean then why := why || 'price_type'; end if;
    -- the month's price per metre and the median price, recounted separately (same type, copies once, default pins out)
    if t is not null then
      with box as materialized (
        select coalesce(p.price_total_effective, p.price_total) as price, p.platform, p.area_m2, p.posted_at, p.bedrooms,
               coalesce(p.city_ar, '') as city, coalesce(p.district_ar, '') as district
        from public.map_listing_points_ar p
        where p.deal_ar = 'بيع' and p.type_ar = t and coalesce(p.price_total_effective, p.price_total) > 0
          and p.latitude between (r.lat - 0.02)::numeric and (r.lat + 0.02)::numeric
          and p.longitude between (r.lng - 0.02)::numeric and (r.lng + 0.02)::numeric
          and not exists (select 1 from public.ops_default_pin_register d
                          where d.source_table = p.source_table and d.lat = round(p.latitude::numeric, 5) and d.lng = round(p.longitude::numeric, 5))),
      mine as (
        select y.* from (select a.*, min(a.platform) over (partition by a.price, a.area_m2, a.city, a.district) as first_site from box a) y
        where y.area_m2 is null or y.platform = y.first_site)
      select percentile_cont(0.5) within group (order by mine.price / mine.area_m2)
               filter (where mine.area_m2 > 0 and mine.posted_at >= now() - interval '30 days' and mine.posted_at < now() + interval '1 day'),
             percentile_cont(0.5) within group (order by mine.price),
             percentile_cont(0.5) within group (order by mine.price / mine.area_m2) filter (where mine.area_m2 > 0),
             count(*),
             (select jsonb_object_agg(z.b::text, jsonb_build_array(z.n, z.med)) from (
                select m2.bedrooms as b, count(*) as n, round(percentile_cont(0.5) within group (order by m2.price)) as med
                from mine m2 where m2.bedrooms between 1 and 20 group by m2.bedrooms) z)
        into mp, md, mpa, nn, rj from mine;
      if (c -> 'table' -> 'm' ->> 'ppm') is not null and abs((c -> 'table' -> 'm' ->> 'ppm')::numeric - round(mp)) > 1 then why := why || 'ppm_month'; end if;
      if (c ->> 'median_price') is not null and abs((c ->> 'median_price')::numeric - round(md)) > 1 then why := why || 'median_price'; end if;
      -- the redesigned sale card (owner 2026-11-14): the price per metre of ALL its ads, how many, and the price by rooms
      if (c ->> 'ppm_all') is not null and abs((c ->> 'ppm_all')::numeric - round(mpa)) > 1 then why := why || 'ppm_all'; end if;
      if (c ->> 'n_priced') is not null and (c ->> 'n_priced')::bigint <> nn then why := why || 'n_priced'; end if;
      for e in select * from jsonb_array_elements(coalesce(c -> 'by_rooms', '[]'::jsonb)) loop
        if (e ->> 'n')::bigint < 10 or rj -> (e ->> 'rooms') is null
           or (rj -> (e ->> 'rooms') ->> 0)::bigint <> (e ->> 'n')::bigint
           or abs((rj -> (e ->> 'rooms') ->> 1)::numeric - (e ->> 'price')::numeric) > 1 then why := why || 'by_rooms'; end if;
      end loop;
      if (c -> 'price_types') is not null and jsonb_array_length(c -> 'price_types') > 0 and (c -> 'price_types' ->> 0) is distinct from t then why := why || 'price_types'; end if;
    end if;
    -- sanity: nothing impossible is ever served
    if exists (select 1 from jsonb_each(c -> 'table') w where (w.value ->> 'ppm') is not null and (w.value ->> 'ppm')::numeric not between 10 and 200000) then why := why || 'ppm_bounds'; end if;
    if (c -> 'nb' -> 'month' ->> 'ppm') is not null and (c -> 'nb' -> 'month' ->> 'ppm')::numeric not between 10 and 200000 then why := why || 'nb_ppm_bounds'; end if;
    if exists (select 1 from jsonb_array_elements(coalesce(c -> 'nb' -> 'by_district', '[]'::jsonb)) d where (d ->> 'ppm') is not null and (d ->> 'ppm')::numeric not between 10 and 200000) then why := why || 'nb_district_bounds'; end if;
    if (c -> 'top_type' ->> 'pct')::numeric > 100 or (c -> 'top_rooms' ->> 'pct')::numeric > 100 then why := why || 'pct_over_100'; end if;
    if (c ->> 'price_low')::numeric > (c ->> 'price_high')::numeric then why := why || 'range_upside_down'; end if;
    -- a weekly point only from 10 ads, only for a week that ended 3 days ago
    if exists (select 1 from jsonb_array_elements(coalesce(c -> 'weeks', '[]'::jsonb)) w
               where ((w ->> 'ppm') is not null and (w ->> 'n')::int < 10) or (w ->> 'start')::date > (now() at time zone 'Asia/Riyadh')::date - 10)
      then why := why || 'weeks'; end if;
    if cardinality(why) > 0 then
      failed := failed + 1;
      if jsonb_array_length(ex) < 5 then
        ex := ex || jsonb_build_object('card', true, 'lat', r.lat, 'lng', r.lng, 'type', r.type_ar, 'why', to_jsonb(why),
                                       'ppm_month_recount', mp, 'median_recount', md, 'card_any', c -> 'any', 'facts_any', fc -> 'any');
      end if;
    end if;
  end loop;
  insert into public.map_view_facts_audit (checked, failed, examples) values (checked, failed, ex);
  if failed > 0 then
    update public.ops_feature_flags set enabled = false, changed_at = now(),
           reason = 'audit: the nightly card checker could not reproduce ' || failed || ' of ' || checked || ' map cards on ' || now()::date || ' — the map box facts and card are hidden until a clean night.'
     where name = 'map_view_facts' and enabled;
  end if;
  return jsonb_build_object('checked', checked, 'failed', failed, 'examples', ex);
end
$function$;

revoke all on function public.audit_map_view_card() from public, anon, authenticated;
