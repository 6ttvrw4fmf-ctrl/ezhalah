-- The map card's «أحياء قريبة» prices per district took ~2 s (four separate scans of every listing). They now come from
-- the neighbours' own read — the same filtered ads, one pass — so a district's card answers in about half a second.
create or replace function public.map_view_card_core(
  p_s double precision, p_w double precision, p_n double precision, p_e double precision,
  p_deals text[] default null, p_poly jsonb default null, p_category text default null, p_types text[] default null,
  p_beds integer[] default null, p_area_min integer default null, p_area_max integer default null,
  p_price_min numeric default null, p_price_max numeric default null, p_furnished boolean default null,
  p_tables text[] default null, p_tables2 text[] default null, p_types2 text[] default null, p_macro text default null,
  p_city text default null, p_districts text[] default null, p_nb boolean default true)
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
    -- with ≥ 10 priced ads (named on the card) — a price is never a mix of types
    select o.type_ar from own o
    where p_deals = array['buy']::text[] and o.deal = 'buy' and o.price > 0 and o.area_m2 > 0 and o.type_ar is not null
    group by o.type_ar having count(*) >= 10
    order by count(*) desc, o.type_ar limit 1
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
      case when v_diary_start <= w.a and p_deals = array['buy']::text[] then (select count(*) from cut where cut.at >= w.a and cut.at < w.b) end as cuts_n,
      (select count(*) from pr where pr.area_m2 > 0 and pr.posted_at >= w.a and pr.posted_at < w.b) as ppm_n,
      (select round(percentile_cont(0.5) within group (order by pr.price / pr.area_m2))::bigint from pr
        where pr.area_m2 > 0 and pr.posted_at >= w.a and pr.posted_at < w.b) as ppm_med
    from win w
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
    -- how long an ad stays up: posted (the site's date) to confirmed removal, once the log covers a month
    'stay_days', case when v_log_fresh and v_log_start <= now() - interval '30 days' then
                   (select case when count(*) >= 10 then round(percentile_cont(0.5) within group (order by extract(epoch from gd.left_at - gd.posted_at) / 86400))::int end
                    from gd where gd.posted_at is not null and gd.left_at > gd.posted_at and gd.left_at >= now() - interval '30 days') end,
    'top_type', (select jsonb_build_object('type', x.type_ar, 'pct', round(100.0 * x.n / nullif((select count(*) from f), 0)))
                 from (select f.type_ar, count(*) as n from f where f.type_ar is not null group by f.type_ar order by count(*) desc, f.type_ar limit 1) x),
    'top_rooms', (select case when sum(x.n) over () >= 10 then jsonb_build_object('rooms', x.bedrooms, 'pct', round(100.0 * x.n / sum(x.n) over ())) end
                  from (select pr.bedrooms, count(*) as n from pr where pr.bedrooms between 1 and 20 group by pr.bedrooms) x order by x.n desc, x.bedrooms limit 1),
    'median_age', (select case when count(*) >= 10 then round(percentile_cont(0.5) within group (order by ages.property_age))::int end from ages),
    'sites', (select count(distinct f.platform) from f),
    -- for «أحياء قريبة»: each named district's own asking price per metre, from the SAME filtered ads (≥ 10, sane bounds)
    'by_district', case when p_districts is not null then
                     (select jsonb_object_agg(x.district_ar, x.ppm) from (
                        select pr.district_ar, round(percentile_cont(0.5) within group (order by pr.price / pr.area_m2))::bigint as ppm
                        from pr where pr.area_m2 > 0 and pr.district_ar is not null group by pr.district_ar having count(*) >= 10) x
                      where x.ppm between 10 and 200000) end,
    'log_start', v_log_start, 'diary_start', v_diary_start,
    'updated_at', (select max(cr.run_at) from public.map_fact_capture_run cr where cr.ok))
  into v;
  -- «أحياء قريبة»: the 4 nearest districts, the same filters and the SAME price type, their month (counts per district)
  if p_nb and v_fresh_nb and (v ->> 'city_ar') is not null and (v ->> 'district_ar') is not null then
    select * into v_nb from public.map_district_neighbors d where d.city_ar = v ->> 'city_ar' and d.district_ar = v ->> 'district_ar';
    if found then
      v_nbv := public.map_view_card_core(v_nb.s::float8, v_nb.w::float8, v_nb.n::float8, v_nb.e::float8, p_deals, null, p_category,
                 case when (v ->> 'price_type') is not null then array[v ->> 'price_type'] else p_types end,
                 p_beds, p_area_min, p_area_max, p_price_min, p_price_max, p_furnished, p_tables, p_tables2, p_types2, p_macro,
                 v ->> 'city_ar', v_nb.neighbors, false);
      v := v || jsonb_build_object('nb', jsonb_build_object(
        'names', to_jsonb(v_nb.neighbors),
        'n_districts', greatest((v_nbv ->> 'n_districts')::int, 1),
        'month', v_nbv -> 'table' -> 'm',
        'median_price', v_nbv -> 'median_price', 'median_area', v_nbv -> 'median_area',
        'price_low', v_nbv -> 'price_low', 'price_high', v_nbv -> 'price_high', 'stay_days', v_nbv -> 'stay_days',
        'top_type', v_nbv -> 'top_type', 'top_rooms', v_nbv -> 'top_rooms', 'median_age', v_nbv -> 'median_age',
        -- each nearby district's own asking price per metre (same type, same filters, ≥ 10 ads), in nearest-first order
        'by_district', (select jsonb_agg(jsonb_build_object('district', dd.district_ar, 'ppm', v_nbv -> 'by_district' -> dd.district_ar) order by dd.k)
                        from unnest(v_nb.neighbors) with ordinality dd(district_ar, k)
                        where (v ->> 'price_type') is not null)));
    end if;
  end if;
  return v;
end;
$function$;
revoke all on function public.map_view_card_core(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text, text, text[], boolean) from public, anon, authenticated;
