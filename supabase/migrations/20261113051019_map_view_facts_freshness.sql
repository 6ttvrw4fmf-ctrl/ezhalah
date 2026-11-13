-- STRONGER FRESHNESS BARRIER for the map box (owner 2026-11-13: «we can't have mistakes … add strong barrier»):
--   • the «أحياء قريبة» comparison is shown only while map_district_neighbors was rebuilt in the last 36 h — a stale
--     neighbours table hides the comparison instead of comparing with yesterday's districts;
--   • the facts carry updated_at (the last successful nightly run) so the card can say «آخر تحديث»;
--   • mon_detect_map_view_facts also pages when the neighbours table is empty or older than 36 h.
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
  v_fresh_nb boolean;
  v jsonb;
begin
  v_short := public.map_fact_short_pairs();
  v_geom := case when p_poly is null then null
                 else extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_poly::text), 4326) end;
  v_ready := public.map_view_facts_gone_ready();
  v_cuts_ready := exists (select 1 from public.map_fact_source_start ss where ss.source = 'price_diary' and ss.started_at <= now() - interval '30 days');
  -- the neighbours table is rebuilt every night; older than 36 h it is not trusted and the comparison is not shown
  v_fresh_nb := exists (select 1 from public.map_district_neighbors nbt where nbt.built_at >= now() - interval '36 hours');
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
    'one_type', (select place.one_type from place),
    'updated_at', (select max(cr.run_at) from public.map_fact_capture_run cr where cr.ok))
  into v;
  -- «أحياء قريبة»: the same filters over the 4 nearest districts; with none usable, the whole city (named as such)
  v_city := v ->> 'city_ar'; v_district := v ->> 'district_ar';
  if (v ->> 'ppm') is not null and v_city is not null and v_fresh_nb then
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

-- the alarm also watches the neighbours table: empty, or not rebuilt for 36 h, pages (the comparison is hidden meanwhile)
create or replace function public.mon_detect_map_view_facts()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; live text[] := '{}'; a record; nb_at timestamptz;
begin
  if not exists (select 1 from public.map_fact_capture_run where ok and run_at >= now() - interval '36 hours') then
    live := live || 'map_view_facts:capture_not_run'::text;
    n := n + public.mon_raise('P2', 'map_view_facts', 'fleet', 'map_view_facts:capture_not_run',
      jsonb_build_object('why', 'The nightly removal log for the map box did not run; «اختفى» stops showing after 36 h.',
        'action', 'Check cron job map-view-facts; run select public.map_fact_capture_removals();'));
  end if;
  select max(built_at) into nb_at from public.map_district_neighbors;
  if nb_at is null or nb_at < now() - interval '36 hours' then
    live := live || 'map_view_facts:neighbors_stale'::text;
    n := n + public.mon_raise('P2', 'map_view_facts', 'fleet', 'map_view_facts:neighbors_stale',
      jsonb_build_object('built_at', nb_at, 'why', 'The map box «أحياء قريبة» table is empty or older than 36 h; the comparison is hidden until it is rebuilt.',
        'action', 'Check cron job map-view-facts; run select public.map_fact_build_neighbors();'));
  end if;
  select * into a from public.map_view_facts_audit order by run_at desc limit 1;
  if a.run_at is null or a.run_at < now() - interval '36 hours' then
    live := live || 'map_view_facts:audit_not_run'::text;
    n := n + public.mon_raise('P2', 'map_view_facts', 'fleet', 'map_view_facts:audit_not_run',
      jsonb_build_object('why', 'The independent checker of the map box numbers did not run.',
        'action', 'Check cron job map-view-facts; run select public.audit_map_view_facts();'));
  elsif a.failed > 0 then
    live := live || 'map_view_facts:disagree'::text;
    n := n + public.mon_raise('P1', 'map_view_facts', 'fleet', 'map_view_facts:disagree',
      jsonb_build_object('checked', a.checked, 'failed', a.failed, 'examples', a.examples,
        'why', 'The checker could not reproduce the map box numbers; the facts were switched off before users saw more.',
        'action', 'Compare map_view_facts_core() with audit_map_view_facts() for the examples; fix the builder, never the checker.'));
  end if;
  perform public.mon_resolve_stale_keys('map_view_facts', live);
  return n;
end
$function$;
revoke execute on function public.mon_detect_map_view_facts() from public, anon, authenticated;
