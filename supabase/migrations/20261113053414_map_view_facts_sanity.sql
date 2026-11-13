-- A STRONGER BARRIER for the map box (owner 2026-11-13, «add a strong strong barrier»): nothing impossible is served.
--   • a price per metre is shown only between 10 and 200,000 SAR — outside that a unit or parse error is somewhere;
--   • the «أحياء قريبة» comparison needs the neighbours' price in the same bounds and a gap of at most 200%;
--   • the nightly checker samples 40 views (was 25) and also fails on any out-of-bounds price or a count larger than
--     the ads in view — and a failure switches the facts off everywhere, as before.
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
                     and (select percentile_cont(0.5) within group (order by ppmc.ppm) from ppmc) between 10 and 200000
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
    if v_area is not null and (v_area ->> 'ppm') is not null
       and (v_area ->> 'ppm')::numeric between 10 and 200000
       and abs((v ->> 'ppm')::numeric - (v_area ->> 'ppm')::numeric) <= 2 * (v_area ->> 'ppm')::numeric then
      v := v || jsonb_build_object('nb_kind', v_kind, 'nb_ppm', (v_area ->> 'ppm')::bigint, 'nb_ppm_n', (v_area ->> 'ppm_n')::bigint,
                                   'nb_names', case when v_kind = 'near' then to_jsonb(v_nb.neighbors) else to_jsonb(array[v_city]) end);
    end if;
  end if;
  return v;
end;
$function$;
revoke all on function public.map_view_facts_core(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text) from public, anon, authenticated;

create or replace function public.audit_map_view_facts()
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare
  r record; nbr record; c jsonb; w jsonb; m numeric; mp numeric; np numeric; gn bigint; checked int := 0; failed int := 0; ex jsonb := '[]'::jsonb; why text[];
  v_ready boolean := public.map_view_facts_gone_ready();
begin
  for r in select s.latitude::float8 as lat, s.longitude::float8 as lng, s.type_ar
           from public.map_fact_points_snapshot s
           where s.deal = 'buy' and s.type_ar is not null and s.type_ar <> 'أرض خام'
           order by random() limit 40
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
      select percentile_cont(0.5) within group (order by y.price_total / y.area_m2) into np
      from (select a.*, min(a.platform) over (partition by a.price_total, a.area_m2, a.district) as first_site from nbox a) y
      where y.platform = y.first_site;
      if abs((c ->> 'nb_ppm')::numeric - round(np)) > 1 then why := why || 'nb_ppm'; end if;
    end if;
    if (c ->> 'cuts30')::bigint > (c ->> 'any')::bigint then why := why || 'cuts30_bounds'; end if;
    -- sanity: nothing impossible is ever served
    if (c ->> 'ppm') is not null and (c ->> 'ppm')::numeric not between 10 and 200000 then why := why || 'ppm_out_of_bounds'; end if;
    if (c ->> 'nb_ppm') is not null and (c ->> 'nb_ppm')::numeric not between 10 and 200000 then why := why || 'nb_ppm_out_of_bounds'; end if;
    if (c ->> 'new30')::bigint > (c ->> 'any')::bigint then why := why || 'new30_over_any'; end if;
    if (c ->> 'ppm_n')::bigint > (c ->> 'any')::bigint then why := why || 'ppm_n_over_any'; end if;
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
