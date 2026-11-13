-- THE MAP BOX (owner 2026-11-12 — the agreed design is docs/ARCHITECTURE.md «THE MAP BOX AND ITS CARD»):
-- «123 جديد · 85 اختفى · المتر المعروض 6,100 ريال · أغلى من أحياء قريبة 9% · 15 خفضوا السعر», for exactly the ads the
-- pill counts, under EVERY map filter. Changes to the facts:
--   1. «اختفى» follows every filter too: the snapshot and the removal log now keep rooms and furnished, and the removal
--      read applies the full filter (it used to need an unfiltered view).
--   2. ppm      = the median asking price per square metre (sale, one picked type, ≥ 10 ads with a price and an area).
--   3. «أحياء قريبة»: nightly, each district's 4 nearest districts in the same city (by the centre of their pins, each
--      with ≥ 30 ads) — map_district_neighbors. The facts read the SAME filters over those districts
--      (map_view_facts_area) for nb_ppm; with no usable neighbours they fall back to the whole city, named as such.
--   4. cuts30   = ads whose seller lowered the asking price in the last 30 days (price diary 'price' events; a drop of
--      more than half is a page re-read, not a cut), shown once the diary covers 30 days.
--   5. The «last month» arrows are gone from the design (the card's أمس/أسبوع/شهر/3 أشهر columns replace them): the
--      weekly copy stops and its table is dropped.
-- The checker recounts ppm and nb_ppm another way and bounds cuts30.

alter table public.map_fact_points_snapshot add column if not exists bedrooms integer, add column if not exists furnished boolean;
alter table public.map_fact_removal add column if not exists bedrooms integer, add column if not exists furnished boolean;

create table if not exists public.map_district_neighbors (
  city_ar text not null, district_ar text not null, neighbors text[] not null,
  s numeric not null, w numeric not null, n numeric not null, e numeric not null,
  city_s numeric not null, city_w numeric not null, city_n numeric not null, city_e numeric not null,
  built_at timestamptz not null, primary key (city_ar, district_ar));
alter table public.map_district_neighbors enable row level security;

create table if not exists public.map_fact_source_start (source text primary key, started_at timestamptz not null);
alter table public.map_fact_source_start enable row level security;
insert into public.map_fact_source_start (source, started_at)
select 'price_diary', min(h.at) from public.listing_price_history h where h.event = 'price' and h.at >= date '2026-11-01'
on conflict (source) do nothing;

drop table if exists public.map_fact_points_week;

-- 1. the nightly neighbours: a district's centre is the middle of its pins; its 4 nearest districts in the same city
create or replace function public.map_fact_build_neighbors()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v int;
begin
  truncate public.map_district_neighbors;
  with d as (
    select p.city_ar, p.district_ar, count(*) as n,
           percentile_cont(0.5) within group (order by p.latitude) as lat,
           percentile_cont(0.5) within group (order by p.longitude) as lng,
           min(p.latitude) as s, max(p.latitude) as n_lat, min(p.longitude) as w, max(p.longitude) as e
    from public.map_fact_points_snapshot p
    where p.city_ar is not null and p.district_ar is not null
    group by p.city_ar, p.district_ar
    having count(*) >= 30
  ), c as (
    select p.city_ar, min(p.latitude) as s, max(p.latitude) as n_lat, min(p.longitude) as w, max(p.longitude) as e
    from public.map_fact_points_snapshot p where p.city_ar is not null group by p.city_ar
  ), nb as (
    select a.city_ar, a.district_ar, b.district_ar as nb_name, b.s, b.n_lat, b.w, b.e,
           row_number() over (partition by a.city_ar, a.district_ar
                              order by power(a.lat - b.lat, 2) + power((a.lng - b.lng) * cos(radians(a.lat)), 2), b.district_ar) as rk
    from d a join d b on b.city_ar = a.city_ar and b.district_ar <> a.district_ar
  )
  insert into public.map_district_neighbors (city_ar, district_ar, neighbors, s, w, n, e, city_s, city_w, city_n, city_e, built_at)
  select nb.city_ar, nb.district_ar, array_agg(nb.nb_name order by nb.rk), min(nb.s), min(nb.w), max(nb.n_lat), max(nb.e),
         c.s, c.w, c.n_lat, c.e, now()
  from nb join c on c.city_ar = nb.city_ar
  where nb.rk <= 4
  group by nb.city_ar, nb.district_ar, c.s, c.w, c.n_lat, c.e;
  get diagnostics v = row_count;
  return v;
end
$function$;
revoke all on function public.map_fact_build_neighbors() from public, anon, authenticated;

-- 2. the nightly job: removal log and snapshot keep rooms and furnished; neighbours rebuilt; no weekly copy
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
  v_nb := public.map_fact_build_neighbors();
  insert into public.map_fact_capture_run (ok, prev_taken_at, snapshot_rows, left_index, logged, reactivated_pruned)
  values (true, v_prev, v_rows, v_left, v_logged, v_pruned);
  return jsonb_build_object('prev_taken_at', v_prev, 'snapshot_rows', v_rows, 'left_index', v_left, 'logged', v_logged,
                            'reactivated_pruned', v_pruned, 'districts_with_neighbors', v_nb);
end
$function$;
revoke all on function public.map_fact_capture_removals() from public, anon, authenticated;

-- 3. the same facts over NAMED districts of one city (the neighbours, or the whole city): the facts' filter word for
--    word, plus one line naming the city and districts. scripts/verify-map-view-facts.ts compares the two.
create or replace function public.map_view_facts_area(
  p_s double precision, p_w double precision, p_n double precision, p_e double precision,
  p_deals text[] default null, p_poly jsonb default null, p_category text default null, p_types text[] default null,
  p_beds integer[] default null, p_area_min integer default null, p_area_max integer default null,
  p_price_min numeric default null, p_price_max numeric default null, p_furnished boolean default null,
  p_tables text[] default null, p_tables2 text[] default null, p_types2 text[] default null, p_macro text default null,
  p_city text default null, p_districts text[] default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_short text[];
  v_geom extensions.geometry;
  v jsonb;
begin
  if p_city is null then return null; end if;
  v_short := public.map_fact_short_pairs();
  v_geom := null;
  with kept as (
    select case when s.deal_ar = 'بيع' then 'buy'
                when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
                when s.deal_ar = 'إيجار' then 'rent' end as deal,
           case when s.deal_ar = 'بيع' then coalesce(s.price_total_effective, s.price_total) else s.price_annual end as price, s.posted_at,
           s.type_ar, s.platform, s.area_m2, s.city_ar, s.district_ar, s.source_table, s.listing_id
    from public.map_listing_points_ar s
    where s.latitude is not null and s.longitude is not null
      and s.latitude between p_s::numeric and p_n::numeric and s.longitude between p_w::numeric and p_e::numeric
      and s.city_ar = p_city and (p_districts is null or s.district_ar = any (p_districts))
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
  ), fd as (
    select f.*, (f.price is null or f.area_m2 is null
                 or f.platform = min(f.platform) over (partition by f.deal, f.type_ar, f.price, f.area_m2, f.city_ar, f.district_ar)) as own
    from f
  ), ppmc as (
    select fd.price / fd.area_m2 as ppm from fd where fd.own and fd.deal = 'buy' and fd.price > 0 and fd.area_m2 > 0
  )
  select jsonb_build_object(
    'any', (select count(*) from f),
    'new30', (select count(*) from fd where fd.own and fd.posted_at >= now() - make_interval(days => 30) and fd.posted_at <= now() + interval '1 day'),
    'ppm', case when (select count(*) from ppmc) >= 10
                then (select round(percentile_cont(0.5) within group (order by ppmc.ppm))::bigint from ppmc) end,
    'ppm_n', (select count(*) from ppmc))
  into v;
  return v;
end;
$function$;
revoke all on function public.map_view_facts_area(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text, text, text[]) from public, anon, authenticated;

-- 4. the facts for exactly the ads the pill counts
create or replace function public.map_view_facts_core(
  p_s double precision, p_w double precision, p_n double precision, p_e double precision,
  p_deals text[] default null, p_poly jsonb default null, p_category text default null, p_types text[] default null,
  p_beds integer[] default null, p_area_min integer default null, p_area_max integer default null,
  p_price_min numeric default null, p_price_max numeric default null, p_furnished boolean default null,
  p_tables text[] default null, p_tables2 text[] default null, p_types2 text[] default null, p_macro text default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_short text[];
  v_geom extensions.geometry;
  v_ready boolean;
  v_cuts_ready boolean;
  v_one_type boolean;
  v_city text;
  v_district text;
  v_nb record;
  v_area jsonb;
  v_kind text;
  v jsonb;
begin
  v_short := public.map_fact_short_pairs();
  v_geom := case when p_poly is null then null
                 else extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_poly::text), 4326) end;
  v_ready := public.map_view_facts_gone_ready();
  v_cuts_ready := exists (select 1 from public.map_fact_source_start ss where ss.source = 'price_diary' and ss.started_at <= now() - interval '30 days');
  with kept as (
    select case when s.deal_ar = 'بيع' then 'buy'
                when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
                when s.deal_ar = 'إيجار' then 'rent' end as deal,
           case when s.deal_ar = 'بيع' then coalesce(s.price_total_effective, s.price_total) else s.price_annual end as price, s.posted_at,
           s.type_ar, s.platform, s.area_m2, s.city_ar, s.district_ar, s.source_table, s.listing_id
    from public.map_listing_points_ar s
    where s.latitude is not null and s.longitude is not null
      and s.latitude between p_s::numeric and p_n::numeric and s.longitude between p_w::numeric and p_e::numeric
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
  ), fd as (
    -- a copy of the same ad on ANOTHER site counts once: same deal, type, price, area and place; the alphabetically first
    -- site keeps it. An ad without a price or an area is never treated as anyone's copy.
    select f.*, (f.price is null or f.area_m2 is null
                 or f.platform = min(f.platform) over (partition by f.deal, f.type_ar, f.price, f.area_m2, f.city_ar, f.district_ar)) as own
    from f
  ), g as (
    -- removed ads, under the SAME filters (rooms and furnished are kept on the log from 2026-11-12)
    select r.deal, r.type_ar, r.price, r.area_m2, r.city_ar, r.district_ar, r.platform, r.left_at
    from public.map_fact_removal r
    where v_ready and r.left_at >= now() - interval '30 days'
      and r.latitude between p_s::numeric and p_n::numeric and r.longitude between p_w::numeric and p_e::numeric
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
      and (v_geom is null or extensions.ST_Contains(v_geom, extensions.ST_SetSRID(extensions.ST_MakePoint(r.longitude::double precision, r.latitude::double precision), 4326)))
  ), gd as (
    select g.*, (g.price is null or g.area_m2 is null
                 or g.platform = min(g.platform) over (partition by g.deal, g.type_ar, g.price, g.area_m2, g.city_ar, g.district_ar)) as own
    from g
  ), pr as (
    select fd.price from fd where fd.own and fd.deal = 'buy' and fd.price > 0
  ), ppmc as (
    select fd.price / fd.area_m2 as ppm from fd where fd.own and fd.deal = 'buy' and fd.price > 0 and fd.area_m2 > 0
  ), cuts as (
    -- a seller lowered the asking price in the last 30 days (the price diary's own events; a drop of more than half is a
    -- re-read of the page, not a cut, and is not counted)
    select count(*) as n from fd
    where v_cuts_ready and fd.own and fd.deal = 'buy'
      and exists (select 1 from public.listing_price_history h
                  where h.source_table = fd.source_table and h.listing_id = fd.listing_id and h.event = 'price'
                    and h.at >= now() - interval '30 days'
                    and h.price_total > 0 and h.old_price_total > 0
                    and h.price_total < h.old_price_total and h.price_total >= h.old_price_total * 0.5)
  ), place as (
    select (select f.city_ar from f where f.city_ar is not null group by f.city_ar
            having count(*) * 10 >= (select count(*) from f) * 6 order by count(*) desc, f.city_ar limit 1) as city,
           (select f.district_ar from f where f.district_ar is not null group by f.district_ar
            having count(*) * 10 >= (select count(*) from f) * 6 order by count(*) desc, f.district_ar limit 1) as district,
           (select count(distinct f.type_ar) from f) = 1 as one_type
  )
  select jsonb_build_object(
    'any', (select count(*) from f),
    'new30_raw', (select count(*) from f where f.posted_at >= now() - make_interval(days => 30)),
    'new30', (select count(*) from fd where fd.own and fd.posted_at >= now() - make_interval(days => 30) and fd.posted_at <= now() + interval '1 day'),
    'priced', (select count(*) from pr),
    'median', case when p_deals = array['buy']::text[] and (p_types is not null or p_types2 is not null)
                        and (select place.one_type from place) and (select count(*) from pr) >= 10
                   then (select round(percentile_cont(0.5) within group (order by pr.price))::bigint from pr) end,
    'ppm', case when p_deals = array['buy']::text[] and (p_types is not null or p_types2 is not null)
                     and (select place.one_type from place) and (select count(*) from ppmc) >= 10
                then (select round(percentile_cont(0.5) within group (order by ppmc.ppm))::bigint from ppmc) end,
    'ppm_n', (select count(*) from ppmc),
    'gone30', case when v_ready then (select count(*) from gd where gd.own) end,
    'cuts30', case when v_cuts_ready and p_deals = array['buy']::text[] then (select cuts.n from cuts) end,
    'gone_ready', v_ready,
    'city_ar', (select place.city from place),
    'district_ar', (select place.district from place),
    'one_type', (select place.one_type from place))
  into v;
  -- «أحياء قريبة»: the same filters over the 4 nearest districts; with none usable, the whole city (named as such)
  v_city := v ->> 'city_ar'; v_district := v ->> 'district_ar';
  if (v ->> 'ppm') is not null and v_city is not null then
    select * into v_nb from public.map_district_neighbors d where d.city_ar = v_city and d.district_ar = v_district;
    if found then
      v_area := public.map_view_facts_area(v_nb.s::float8, v_nb.w::float8, v_nb.n::float8, v_nb.e::float8, p_deals, null, p_category, p_types,
                  p_beds, p_area_min, p_area_max, p_price_min, p_price_max, p_furnished, p_tables, p_tables2, p_types2, p_macro,
                  v_city, v_nb.neighbors);
      v_kind := 'near';
    end if;
    if v_area is null or (v_area ->> 'ppm') is null then
      select * into v_nb from public.map_district_neighbors d where d.city_ar = v_city limit 1;
      if found then
        v_area := public.map_view_facts_area(v_nb.city_s::float8, v_nb.city_w::float8, v_nb.city_n::float8, v_nb.city_e::float8, p_deals, null, p_category, p_types,
                    p_beds, p_area_min, p_area_max, p_price_min, p_price_max, p_furnished, p_tables, p_tables2, p_types2, p_macro,
                    v_city, null);
        v_kind := 'city';
      end if;
    end if;
    if v_area is not null and (v_area ->> 'ppm') is not null then
      v := v || jsonb_build_object('nb_kind', v_kind, 'nb_ppm', (v_area ->> 'ppm')::bigint, 'nb_ppm_n', (v_area ->> 'ppm_n')::bigint,
                                   'nb_names', case when v_kind = 'near' then to_jsonb(v_nb.neighbors) else to_jsonb(array[v_city]) end);
    end if;
  end if;
  return v;
end;
$function$;
revoke all on function public.map_view_facts_core(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text) from public, anon, authenticated;

-- 5. what the browser calls: a guest learns only which parts exist
create or replace function public.map_view_facts_ar(
  p_s double precision, p_w double precision, p_n double precision, p_e double precision,
  p_deals text[] default null, p_poly jsonb default null, p_category text default null, p_types text[] default null,
  p_beds integer[] default null, p_area_min integer default null, p_area_max integer default null,
  p_price_min numeric default null, p_price_max numeric default null, p_furnished boolean default null,
  p_tables text[] default null, p_tables2 text[] default null, p_types2 text[] default null, p_macro text default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
declare v jsonb;
begin
  if not coalesce((select ff.enabled from public.ops_feature_flags ff where ff.name = 'map_view_facts'), false) then
    return null;
  end if;
  v := public.map_view_facts_core(p_s, p_w, p_n, p_e, p_deals, p_poly, p_category, p_types, p_beds, p_area_min, p_area_max,
                                  p_price_min, p_price_max, p_furnished, p_tables, p_tables2, p_types2, p_macro);
  if auth.uid() is null then
    return jsonb_build_object('locked', true, 'any', v -> 'any',
      'has_new', coalesce((v ->> 'new30')::bigint, 0) > 0,
      'has_gone', coalesce((v ->> 'gone30')::bigint, 0) > 0,
      'has_ppm', (v ->> 'ppm') is not null,
      'has_cmp', (v ->> 'nb_ppm') is not null,
      'nb_kind', v -> 'nb_kind',
      'has_cuts', coalesce((v ->> 'cuts30')::bigint, 0) > 0,
      'one_type', v -> 'one_type');
  end if;
  return v;
end;
$function$;
revoke all on function public.map_view_facts_ar(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text) from public;
grant execute on function public.map_view_facts_ar(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text) to anon, authenticated;

-- 6. the checker: counts against the «نشر خلال» counter, the median and price per metre recounted over the box, the
--    neighbours' price per metre recounted over their named districts, cuts and gone bounded
create or replace function public.audit_map_view_facts()
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare
  r record; nbr record; c jsonb; w jsonb; m numeric; mp numeric; np numeric; gn bigint; checked int := 0; failed int := 0; ex jsonb := '[]'::jsonb; why text[];
  v_ready boolean := public.map_view_facts_gone_ready();
begin
  for r in select s.latitude::float8 as lat, s.longitude::float8 as lng, s.type_ar
           from public.map_fact_points_snapshot s
           where s.deal = 'buy' and s.type_ar is not null and s.type_ar <> 'أرض خام'
           order by random() limit 25
  loop
    checked := checked + 1; why := '{}'; np := null;
    c := public.map_view_facts_core(r.lat - 0.02, r.lng - 0.02, r.lat + 0.02, r.lng + 0.02, array['buy'], null, null, array[r.type_ar]);
    w := public.map_posted_window_counts_ar(r.lat - 0.02, r.lng - 0.02, r.lat + 0.02, r.lng + 0.02, array['buy'], null, null, array[r.type_ar]);
    if (c ->> 'any') is distinct from (w ->> 'any') then why := why || 'any'; end if;
    if (c ->> 'new30_raw') is distinct from (w ->> 'd30') then why := why || 'new30_raw'; end if;
    if (c ->> 'new30')::bigint > (c ->> 'new30_raw')::bigint or (c ->> 'new30')::bigint < 0 then why := why || 'new30_bounds'; end if;
    -- the median and the price per metre, written separately: sale ads of this type in the box, minus copies on another site
    with box as materialized (
      select coalesce(p.price_total_effective, p.price_total) as price_total, p.platform, p.area_m2,
             coalesce(p.city_ar, '') as city, coalesce(p.district_ar, '') as district
      from public.map_listing_points_ar p
      where p.deal_ar = 'بيع' and p.type_ar = r.type_ar and coalesce(p.price_total_effective, p.price_total) > 0
        and p.latitude between (r.lat - 0.02)::numeric and (r.lat + 0.02)::numeric
        and p.longitude between (r.lng - 0.02)::numeric and (r.lng + 0.02)::numeric
        and not exists (select 1 from public.ops_default_pin_register d
                        where d.source_table = p.source_table and d.lat = round(p.latitude::numeric, 5) and d.lng = round(p.longitude::numeric, 5))),
    mine as (
      select a.* from box a
      where a.area_m2 is null
         or not exists (select 1 from box q
                        where q.price_total = a.price_total and q.area_m2 = a.area_m2
                          and q.city = a.city and q.district = a.district and q.platform < a.platform))
    select percentile_cont(0.5) within group (order by mine.price_total),
           percentile_cont(0.5) within group (order by mine.price_total / mine.area_m2) filter (where mine.area_m2 > 0)
      into m, mp from mine;
    if (c ->> 'median') is not null and abs((c ->> 'median')::numeric - round(m)) > 1 then why := why || 'median'; end if;
    if (c ->> 'ppm') is not null and abs((c ->> 'ppm')::numeric - round(mp)) > 1 then why := why || 'ppm'; end if;
    -- the neighbours' price per metre, written separately over the districts the facts named
    if (c ->> 'nb_ppm') is not null then
      -- the same search box the facts used for those districts (last night's extent of their pins)
      select * into nbr from public.map_district_neighbors d
       where d.city_ar = c ->> 'city_ar' and (c ->> 'nb_kind' = 'city' or d.district_ar = c ->> 'district_ar') limit 1;
      with nbox as materialized (
        select coalesce(p.price_total_effective, p.price_total) as price_total, p.platform, p.area_m2, coalesce(p.district_ar, '') as district
        from public.map_listing_points_ar p
        where p.deal_ar = 'بيع' and p.type_ar = r.type_ar and coalesce(p.price_total_effective, p.price_total) > 0 and p.area_m2 > 0
          and p.city_ar = c ->> 'city_ar'
          and (c ->> 'nb_kind' = 'city' or p.district_ar in (select jsonb_array_elements_text(c -> 'nb_names')))
          and p.latitude between (case when c ->> 'nb_kind' = 'city' then nbr.city_s else nbr.s end)
                             and (case when c ->> 'nb_kind' = 'city' then nbr.city_n else nbr.n end)
          and p.longitude between (case when c ->> 'nb_kind' = 'city' then nbr.city_w else nbr.w end)
                              and (case when c ->> 'nb_kind' = 'city' then nbr.city_e else nbr.e end)
          and not exists (select 1 from public.ops_default_pin_register d
                          where d.source_table = p.source_table and d.lat = round(p.latitude::numeric, 5) and d.lng = round(p.longitude::numeric, 5)))
      select percentile_cont(0.5) within group (order by a.price_total / a.area_m2) into np
      from nbox a
      where not exists (select 1 from nbox q
                        where q.price_total = a.price_total and q.area_m2 = a.area_m2 and q.district = a.district and q.platform < a.platform);
      if abs((c ->> 'nb_ppm')::numeric - round(np)) > 1 then why := why || 'nb_ppm'; end if;
    end if;
    if (c ->> 'cuts30')::bigint > (c ->> 'any')::bigint then why := why || 'cuts30_bounds'; end if;
    if v_ready then
      select count(*) into gn from public.map_fact_removal x
      where x.deal = 'buy' and x.type_ar = r.type_ar and x.left_at >= now() - interval '30 days'
        and x.latitude between (r.lat - 0.02)::numeric and (r.lat + 0.02)::numeric
        and x.longitude between (r.lng - 0.02)::numeric and (r.lng + 0.02)::numeric;
      if (c ->> 'gone30')::bigint > gn then why := why || 'gone30_bounds'; end if;
    elsif (c ->> 'gone30') is not null then
      why := why || 'gone30_shown_before_ready';
    end if;
    if cardinality(why) > 0 then
      failed := failed + 1;
      if jsonb_array_length(ex) < 5 then
        ex := ex || jsonb_build_object('lat', r.lat, 'lng', r.lng, 'type', r.type_ar, 'why', to_jsonb(why), 'facts', c, 'windows', w,
                                       'median_recount', m, 'ppm_recount', mp, 'nb_ppm_recount', np);
      end if;
    end if;
  end loop;
  insert into public.map_view_facts_audit (checked, failed, examples) values (checked, failed, ex);
  if failed > 0 then
    update public.ops_feature_flags set enabled = false, changed_at = now(),
           reason = 'audit: the nightly checker could not reproduce ' || failed || ' of ' || checked || ' map views on ' || now()::date || ' — the map box facts are hidden until a clean night.'
     where name = 'map_view_facts' and enabled;
  else
    update public.ops_feature_flags set enabled = true, changed_at = now(),
           reason = 'owner 2026-11-12: the map box facts. Turned back on by a clean nightly check on ' || now()::date || '.'
     where name = 'map_view_facts' and not enabled and reason like 'audit:%';
  end if;
  return jsonb_build_object('checked', checked, 'failed', failed, 'examples', ex);
end
$function$;
revoke all on function public.audit_map_view_facts() from public, anon, authenticated;
