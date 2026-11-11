-- «نُشر خلال» numbers on the MAP filter (owner 2026-11-11): the menu must count what the map's own button counts — the
-- pins in the current view for the picked choices — so «أي وقت» and «عرض N إعلان» are the same number. Live on
-- ezhalah.com the menu showed the nationwide Filter count (311,791) while the button showed the pins in view (300,755).
-- One pass over the same rows map_pins_ar's grid branch keeps, every window counted at once (ten map_pins_ar reads
-- would cost ~0.5-0.9 s each). The WHERE below is map_pins_ar's p_cell > 0 branch, verbatim.
create or replace function public.map_posted_window_counts_ar(
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
  v jsonb;
begin
  select coalesce(array_agg(p.k), '{}') into v_short from public.map_short_pairs_ar p;
  if not exists (select 1 from public.map_short_pairs_ar) then
    select coalesce(array_agg(k) filter (where pool = 'شهري'), '{}')
      into v_short
    from (select d.platform || '|' || coalesce(d.rent_period_ar, '') as k, public.rent_pool_ar(d.platform, d.rent_period_ar) as pool
          from (select distinct s.platform, s.rent_period_ar from public.search_listings_ar s where s.deal_ar = 'إيجار') d) x;
  end if;
  v_geom := case when p_poly is null then null
                 else extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_poly::text), 4326) end;
  with kept as (
    select case when s.deal_ar = 'بيع' then 'buy'
                when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
                when s.deal_ar = 'إيجار' then 'rent' end as deal,
           case when s.deal_ar = 'بيع' then s.price_total else s.price_annual end as price, s.posted_at
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
    select k.posted_at from kept k
    where k.deal is not null and (p_deals is null or k.deal = any (p_deals))
      and (p_price_min is null or k.price >= p_price_min) and (p_price_max is null or k.price <= p_price_max)
  )
  select jsonb_build_object(
    'any', count(*),
    'd1', count(*) filter (where f.posted_at >= now() - make_interval(days => 1)),
    'd7', count(*) filter (where f.posted_at >= now() - make_interval(days => 7)),
    'd14', count(*) filter (where f.posted_at >= now() - make_interval(days => 14)),
    'd30', count(*) filter (where f.posted_at >= now() - make_interval(days => 30)),
    'd90', count(*) filter (where f.posted_at >= now() - make_interval(days => 90)),
    'd183', count(*) filter (where f.posted_at >= now() - make_interval(days => 183)),
    'd365', count(*) filter (where f.posted_at >= now() - make_interval(days => 365)),
    'd730', count(*) filter (where f.posted_at >= now() - make_interval(days => 730)),
    'd1095', count(*) filter (where f.posted_at >= now() - make_interval(days => 1095)))
  into v from f;
  return v;
end;
$function$;

grant execute on function public.map_posted_window_counts_ar(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text) to anon, authenticated;
