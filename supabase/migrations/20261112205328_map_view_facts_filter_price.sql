-- The map pill's numbers price a sale the way the Filter (and, since 20261112184000, every map read) does:
-- coalesce(price_total_effective, price_total). 20261112184000 rewrote map_posted_window_counts_ar to that column 36
-- minutes before map_view_facts was written from the older text, so the pill's facts read the bare price_total: the
-- median left out per-metre-priced sale ads (price_total empty, effective set), and a price-filtered view could count
-- other ads than the pill. Same three functions, same logic, the Filter's price in all of them: the facts' read
-- (map_view_facts_core, word for word the counter's filter again), the nightly snapshot and weekly copy, and the
-- checker's separate median recount.

-- 1. the nightly job (snapshot and weekly copy keep the Filter's price)
create or replace function public.map_fact_capture_removals()
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare v_prev timestamptz; v_short text[]; t text; c int; v_left int := 0; v_logged int := 0; v_pruned int := 0; v_rows int := 0; v_week int := 0;
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
                                             city_ar, district_ar, latitude, longitude, posted_at, deactivated_at, left_at)
        select g.source_table, g.listing_id, g.platform, g.deal, g.type_ar, g.unit_subtype_ar, g.price, g.area_m2,
               g.city_ar, g.district_ar, g.latitude, g.longitude, g.posted_at, r.deactivated_at, now()
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
  delete from public.map_fact_removal where left_at < now() - interval '75 days';
  truncate public.map_fact_points_snapshot;
  insert into public.map_fact_points_snapshot (source_table, listing_id, platform, deal, type_ar, unit_subtype_ar, price, area_m2,
                                               city_ar, district_ar, latitude, longitude, posted_at, taken_at)
  select distinct on (s.source_table, s.listing_id)
         s.source_table, s.listing_id, s.platform, x.deal, s.type_ar, s.unit_subtype_ar,
         case when s.deal_ar = 'بيع' then coalesce(s.price_total_effective, s.price_total) else s.price_annual end, s.area_m2,
         s.city_ar, s.district_ar, s.latitude, s.longitude, s.posted_at, now()
  from public.map_listing_points_ar s
  cross join lateral (select case when s.deal_ar = 'بيع' then 'buy'
                                  when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
                                  when s.deal_ar = 'إيجار' then 'rent' end as deal) x
  where s.latitude is not null and s.longitude is not null and x.deal is not null;
  get diagnostics v_rows = row_count;
  -- once a week, keep what the map showed today (the «last month» arrows compare with the copy from 28–34 days ago)
  if not exists (select 1 from public.map_fact_points_week w where w.taken_on > current_date - 7) then
    insert into public.map_fact_points_week (taken_on, source_table, listing_id, platform, deal, type_ar, unit_subtype_ar, price,
                                             area_m2, city_ar, district_ar, latitude, longitude, posted_at)
    select current_date, p.source_table, p.listing_id, p.platform, p.deal, p.type_ar, p.unit_subtype_ar, p.price,
           p.area_m2, p.city_ar, p.district_ar, p.latitude, p.longitude, p.posted_at
    from public.map_fact_points_snapshot p;
    get diagnostics v_week = row_count;
  end if;
  delete from public.map_fact_points_week where taken_on < current_date - 36;
  insert into public.map_fact_capture_run (ok, prev_taken_at, snapshot_rows, left_index, logged, reactivated_pruned)
  values (true, v_prev, v_rows, v_left, v_logged, v_pruned);
  return jsonb_build_object('prev_taken_at', v_prev, 'snapshot_rows', v_rows, 'left_index', v_left, 'logged', v_logged,
                            'reactivated_pruned', v_pruned, 'week_copy_rows', v_week);
end
$function$;
revoke all on function public.map_fact_capture_removals() from public, anon, authenticated;

-- 2. the numbers
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
  v_plain boolean;
  v_ready boolean;
  v_base date;
  v_prev_ready boolean;
  v jsonb;
begin
  v_short := public.map_fact_short_pairs();
  v_geom := case when p_poly is null then null
                 else extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_poly::text), 4326) end;
  v_plain := p_poly is null and p_beds is null and p_area_min is null and p_area_max is null
             and p_price_min is null and p_price_max is null and p_furnished is null;
  v_ready := public.map_view_facts_gone_ready();
  select max(w.taken_on) into v_base from public.map_fact_points_week w
   where w.taken_on between current_date - 34 and current_date - 28;
  v_prev_ready := v_base is not null
    and exists (select 1 from public.map_fact_capture_run cr where cr.ok and cr.prev_taken_at is null and cr.run_at::date <= v_base - 30);
  with kept as (
    select case when s.deal_ar = 'بيع' then 'buy'
                when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
                when s.deal_ar = 'إيجار' then 'rent' end as deal,
           case when s.deal_ar = 'بيع' then coalesce(s.price_total_effective, s.price_total) else s.price_annual end as price, s.posted_at,
           s.type_ar, s.platform, s.area_m2, s.city_ar, s.district_ar
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
    select r.deal, r.type_ar, r.price, r.area_m2, r.city_ar, r.district_ar, r.platform, r.left_at
    from public.map_fact_removal r
    where v_plain and (v_ready or v_prev_ready) and r.left_at >= now() - interval '60 days'
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
  ), gd as (
    select g.*, (g.price is null or g.area_m2 is null
                 or g.platform = min(g.platform) over (partition by g.deal, g.type_ar, g.price, g.area_m2, g.city_ar, g.district_ar)) as own
    from g
  ), pr as (
    select fd.price from fd where fd.own and fd.deal = 'buy' and fd.price > 0
  ), b as (
    -- the map as it stood on the baseline day (same deal / category / type rules, unfiltered views only)
    select w.deal, w.price, w.posted_at, w.type_ar, w.platform, w.area_m2, w.city_ar, w.district_ar
    from public.map_fact_points_week w
    where v_plain and v_base is not null and w.taken_on = v_base
      and w.latitude between p_s::numeric and p_n::numeric and w.longitude between p_w::numeric and p_e::numeric
      and not exists (select 1 from public.ops_default_pin_register r
                      where r.source_table = w.source_table and r.lat = round(w.latitude::numeric, 5) and r.lng = round(w.longitude::numeric, 5))
      and (p_deals is null or w.deal = any (p_deals))
      and (p_category is null or (p_category = 'residential' and w.source_table like '%\_residential\_%')
                              or (p_category = 'commercial' and w.source_table like '%\_commercial\_%'))
      and ( ((p_tables is null or w.source_table = any (p_tables))
             and (p_types is null or w.type_ar = any (p_types) or (w.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (p_types))))
         or (p_tables2 is not null and p_types2 is not null and w.source_table = any (p_tables2)
             and (w.type_ar = any (p_types2) or (w.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (p_types2)))) )
      and (p_macro is null
           or (w.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (coalesce(p_types, '{}'::text[]) || coalesce(p_types2, '{}'::text[])))
           or w.type_ar in (select k.type_ar from public.known_type_ar k where k.macro = p_macro)
           or (w.type_ar in (select k.type_ar from public.known_type_ar k where k.macro = 'both')
               and (case p_macro when 'Residential' then w.source_table like '%\_residential\_listings'
                                 when 'Commercial' then w.source_table like '%\_commercial\_listings' else true end)))
  ), bd as (
    select b.*, (b.price is null or b.area_m2 is null
                 or b.platform = min(b.platform) over (partition by b.deal, b.type_ar, b.price, b.area_m2, b.city_ar, b.district_ar)) as own
    from b
  ), bpr as (
    select bd.price from bd where bd.own and bd.deal = 'buy' and bd.price > 0
  )
  select jsonb_build_object(
    'any', (select count(*) from f),
    'new30_raw', (select count(*) from f where f.posted_at >= now() - make_interval(days => 30)),
    'new30', (select count(*) from fd where fd.own and fd.posted_at >= now() - make_interval(days => 30) and fd.posted_at <= now() + interval '1 day'),
    'priced', (select count(*) from pr),
    'median', case when p_deals = array['buy']::text[] and (p_types is not null or p_types2 is not null)
                        and (select count(distinct f.type_ar) from f) = 1 and (select count(*) from pr) >= 10
                   then (select round(percentile_cont(0.5) within group (order by pr.price))::bigint from pr) end,
    'gone30', case when v_plain and v_ready then (select count(*) from gd where gd.own and gd.left_at >= now() - interval '30 days') end,
    'gone_ready', v_ready,
    'plain', v_plain,
    'base_on', case when v_plain then v_base end,
    'prev_new30_raw', case when v_plain and v_base is not null
                           then (select count(*) from b where b.posted_at >= v_base::timestamptz - interval '30 days' and b.posted_at <= v_base::timestamptz + interval '1 day') end,
    'prev_new30', case when v_plain and v_base is not null
                       then (select count(*) from bd where bd.own and bd.posted_at >= v_base::timestamptz - interval '30 days' and bd.posted_at <= v_base::timestamptz + interval '1 day') end,
    'prev_median', case when v_plain and v_base is not null and p_deals = array['buy']::text[] and (p_types is not null or p_types2 is not null)
                             and (select count(distinct b.type_ar) from b) = 1 and (select count(*) from bpr) >= 10
                        then (select round(percentile_cont(0.5) within group (order by bpr.price))::bigint from bpr) end,
    'prev_gone30', case when v_plain and v_prev_ready
                        then (select count(*) from gd where gd.own and gd.left_at >= v_base::timestamptz - interval '30 days' and gd.left_at < v_base::timestamptz) end)
  into v;
  return v;
end;
$function$;
revoke all on function public.map_view_facts_core(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text) from public, anon, authenticated;

-- 3. the checker (its separate median recount uses the Filter's price too)
create or replace function public.audit_map_view_facts()
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare
  r record; c jsonb; w jsonb; m numeric; pm numeric; pn bigint; gn bigint; base date; checked int := 0; failed int := 0; ex jsonb := '[]'::jsonb; why text[];
  v_ready boolean := public.map_view_facts_gone_ready();
begin
  for r in select s.latitude::float8 as lat, s.longitude::float8 as lng, s.type_ar
           from public.map_fact_points_snapshot s
           where s.deal = 'buy' and s.type_ar is not null and s.type_ar <> 'أرض خام'
           order by random() limit 25
  loop
    checked := checked + 1; why := '{}';
    c := public.map_view_facts_core(r.lat - 0.02, r.lng - 0.02, r.lat + 0.02, r.lng + 0.02, array['buy'], null, null, array[r.type_ar]);
    w := public.map_posted_window_counts_ar(r.lat - 0.02, r.lng - 0.02, r.lat + 0.02, r.lng + 0.02, array['buy'], null, null, array[r.type_ar]);
    if (c ->> 'any') is distinct from (w ->> 'any') then why := why || 'any'; end if;
    if (c ->> 'new30_raw') is distinct from (w ->> 'd30') then why := why || 'new30_raw'; end if;
    if (c ->> 'new30')::bigint > (c ->> 'new30_raw')::bigint or (c ->> 'new30')::bigint < 0 then why := why || 'new30_bounds'; end if;
    -- the median, written separately: sale ads of this type in the box, minus copies on another site
    with box as materialized (
      select coalesce(p.price_total_effective, p.price_total) as price_total, p.platform, p.area_m2, p.city_ar, p.district_ar
      from public.map_listing_points_ar p
      where p.deal_ar = 'بيع' and p.type_ar = r.type_ar and coalesce(p.price_total_effective, p.price_total) > 0
        and p.latitude between (r.lat - 0.02)::numeric and (r.lat + 0.02)::numeric
        and p.longitude between (r.lng - 0.02)::numeric and (r.lng + 0.02)::numeric
        and not exists (select 1 from public.ops_default_pin_register d
                        where d.source_table = p.source_table and d.lat = round(p.latitude::numeric, 5) and d.lng = round(p.longitude::numeric, 5)))
    select percentile_cont(0.5) within group (order by a.price_total) into m
    from box a
    where a.area_m2 is null
       or not exists (select 1 from box q
                      where q.price_total = a.price_total and q.area_m2 = a.area_m2
                        and q.city_ar is not distinct from a.city_ar and q.district_ar is not distinct from a.district_ar
                        and q.platform < a.platform);
    if (c ->> 'median') is not null and abs((c ->> 'median')::numeric - round(m)) > 1 then why := why || 'median'; end if;
    -- last month, written separately over the weekly copy
    base := (c ->> 'base_on')::date;
    if base is not null then
      select count(*) into pn from public.map_fact_points_week x
      where x.taken_on = base and x.deal = 'buy' and x.type_ar = r.type_ar
        and x.latitude between (r.lat - 0.02)::numeric and (r.lat + 0.02)::numeric
        and x.longitude between (r.lng - 0.02)::numeric and (r.lng + 0.02)::numeric
        and x.posted_at >= base::timestamptz - interval '30 days' and x.posted_at <= base::timestamptz + interval '1 day'
        and not exists (select 1 from public.ops_default_pin_register d
                        where d.source_table = x.source_table and d.lat = round(x.latitude::numeric, 5) and d.lng = round(x.longitude::numeric, 5));
      if (c ->> 'prev_new30_raw')::bigint is distinct from pn then why := why || 'prev_new30_raw'; end if;
      if (c ->> 'prev_new30')::bigint > pn then why := why || 'prev_new30_bounds'; end if;
      with pbox as materialized (
        select x.price, x.platform, x.area_m2, x.city_ar, x.district_ar
        from public.map_fact_points_week x
        where x.taken_on = base and x.deal = 'buy' and x.type_ar = r.type_ar and x.price > 0
          and x.latitude between (r.lat - 0.02)::numeric and (r.lat + 0.02)::numeric
          and x.longitude between (r.lng - 0.02)::numeric and (r.lng + 0.02)::numeric
          and not exists (select 1 from public.ops_default_pin_register d
                          where d.source_table = x.source_table and d.lat = round(x.latitude::numeric, 5) and d.lng = round(x.longitude::numeric, 5)))
      select percentile_cont(0.5) within group (order by a.price) into pm
      from pbox a
      where a.area_m2 is null
         or not exists (select 1 from pbox q
                        where q.price = a.price and q.area_m2 = a.area_m2
                          and q.city_ar is not distinct from a.city_ar and q.district_ar is not distinct from a.district_ar
                          and q.platform < a.platform);
      if (c ->> 'prev_median') is not null and abs((c ->> 'prev_median')::numeric - round(pm)) > 1 then why := why || 'prev_median'; end if;
    elsif (c ->> 'prev_new30') is not null or (c ->> 'prev_median') is not null or (c ->> 'prev_gone30') is not null then
      why := why || 'prev_shown_without_baseline';
    end if;
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
                                       'median_recount', m, 'prev_median_recount', pm, 'prev_new_recount', pn);
      end if;
    end if;
  end loop;
  insert into public.map_view_facts_audit (checked, failed, examples) values (checked, failed, ex);
  if failed > 0 then
    update public.ops_feature_flags set enabled = false, changed_at = now(),
           reason = 'audit: the nightly checker could not reproduce ' || failed || ' of ' || checked || ' map views on ' || now()::date || ' — the second line is hidden until a clean night.'
     where name = 'map_view_facts' and enabled;
  else
    update public.ops_feature_flags set enabled = true, changed_at = now(),
           reason = 'owner 2026-11-12: the map pill''s second line. Turned back on by a clean nightly check on ' || now()::date || '.'
     where name = 'map_view_facts' and not enabled and reason like 'audit:%';
  end if;
  return jsonb_build_object('checked', checked, 'failed', failed, 'examples', ex);
end
$function$;
revoke all on function public.audit_map_view_facts() from public, anon, authenticated;

-- 4. today's weekly copy was taken with the bare price: drop it, so the next run keeps one with the Filter's price
--    (the «last month» arrows compare like with like).
delete from public.map_fact_points_week where taken_on >= date '2026-11-12';
