-- The map box checker took over 4 minutes (cancelled): a district's search box was the min/max of its pins, so a few
-- misplaced pins stretched the «أحياء قريبة» box of a Riyadh district over the whole city (24.35–25.38 N), and the
-- neighbours' recount compared every ad with every other one. The box is now the 1st–99th percentile of the district's
-- pins (the facts and the checker use the same box), and the recount finds copies with one window pass. What is
-- checked is unchanged.

create or replace function public.map_fact_build_neighbors()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v int;
begin
  truncate public.map_district_neighbors;
  with d as (
    select p.city_ar, p.district_ar, count(*) as n,
           percentile_cont(0.5) within group (order by p.latitude) as lat,
           percentile_cont(0.5) within group (order by p.longitude) as lng,
           percentile_cont(0.01) within group (order by p.latitude) as s, percentile_cont(0.99) within group (order by p.latitude) as n_lat,
           percentile_cont(0.01) within group (order by p.longitude) as w, percentile_cont(0.99) within group (order by p.longitude) as e
    from public.map_fact_points_snapshot p
    where p.city_ar is not null and p.district_ar is not null
    group by p.city_ar, p.district_ar
    having count(*) >= 30
  ), c as (
    select p.city_ar,
           percentile_cont(0.01) within group (order by p.latitude) as s, percentile_cont(0.99) within group (order by p.latitude) as n_lat,
           percentile_cont(0.01) within group (order by p.longitude) as w, percentile_cont(0.99) within group (order by p.longitude) as e
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
      select percentile_cont(0.5) within group (order by y.price_total / y.area_m2) into np
      from (select a.*, min(a.platform) over (partition by a.price_total, a.area_m2, a.district) as first_site from nbox a) y
      where y.platform = y.first_site;
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
