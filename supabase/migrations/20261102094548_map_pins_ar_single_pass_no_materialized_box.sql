-- map_pins_ar(): ONE PASS OVER THE BOX (2026-11-02, measured minutes after the previous version: Riyadh city grid
-- 4.8 s, country 10 s). The cost was materializing every listing in the box (182k / 424k rows written to temp and
-- sorted twice) only to learn its pool. The pool table is now built from the DISTINCT (platform, period, deal)
-- triples of the WHOLE index — a few hundred rows, one hash aggregate — through the same rent_pool_ar(), and the
-- box is then read once: index scan → anti-join the default-pin register → hash-join the pool → group. Nothing
-- is written to temp. Same signature, same answers.
create or replace function public.map_pins_ar(
  p_s double precision, p_w double precision, p_n double precision, p_e double precision,
  p_cell double precision default 0, p_deals text[] default null, p_poly jsonb default null, p_limit integer default 3000,
  p_category text default null, p_types text[] default null, p_beds integer[] default null,
  p_area_min integer default null, p_area_max integer default null, p_price_min numeric default null, p_price_max numeric default null)
returns table (lat double precision, lng double precision, n integer, deal text, type_ar text, platforms integer, ids jsonb,
               price numeric, platform text)
language plpgsql stable security definer
set search_path = public, extensions
as $$
begin
  if p_cell > 0 then
    return query
    with combos as materialized (
      select d.platform, d.rent_period_ar, d.deal_ar,
             case when d.deal_ar = 'بيع' then 'buy'
                  when d.deal_ar = 'إيجار' and public.rent_pool_ar(d.platform, d.rent_period_ar) = 'شهري' then 'short'
                  when d.deal_ar = 'إيجار' then 'rent' end as deal
      from (select distinct s.platform, s.rent_period_ar, s.deal_ar from public.search_listings_ar s) d
    ), kept as (
      select s.latitude::double precision la, s.longitude::double precision lo, c.deal
      from public.search_listings_ar s
      join combos c on c.platform = s.platform and c.deal_ar = s.deal_ar and c.rent_period_ar is not distinct from s.rent_period_ar
      left join public.ops_default_pin_register r
             on r.source_table = s.source_table and r.lat = round(s.latitude::numeric, 5) and r.lng = round(s.longitude::numeric, 5)
      where s.latitude is not null and s.longitude is not null
        and s.latitude between p_s and p_n and s.longitude between p_w and p_e
        and r.source_table is null
        and c.deal is not null and (p_deals is null or c.deal = any (p_deals))
        and (p_category is null or (p_category = 'residential' and s.source_table like '%\_residential\_%')
                                or (p_category = 'commercial' and s.source_table like '%\_commercial\_%'))
        and (p_types is null or s.type_ar = any (p_types))
        and (p_beds is null or s.bedrooms = any (p_beds))
        and (p_area_min is null or s.area_m2 >= p_area_min) and (p_area_max is null or s.area_m2 <= p_area_max)
        and (p_price_min is null or (case when c.deal = 'buy' then s.price_total else s.price_annual end) >= p_price_min)
        and (p_price_max is null or (case when c.deal = 'buy' then s.price_total else s.price_annual end) <= p_price_max)
        and (p_poly is null or extensions.ST_Contains(
               extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_poly::text), 4326),
               extensions.ST_SetSRID(extensions.ST_MakePoint(s.longitude::double precision, s.latitude::double precision), 4326)))
    )
    select avg(k.la), avg(k.lo), count(*)::int,
           case when min(k.deal) = max(k.deal) then min(k.deal) else 'mixed' end,
           null::text, 0, null::jsonb, null::numeric, null::text
    from kept k
    group by round((k.la / p_cell)::numeric) * p_cell, round((k.lo / p_cell)::numeric) * p_cell
    order by 3 desc, 1, 2
    limit greatest(1, least(p_limit, 5000));
  else
    return query
    with combos as materialized (
      select d.platform, d.rent_period_ar, d.deal_ar,
             case when d.deal_ar = 'بيع' then 'buy'
                  when d.deal_ar = 'إيجار' and public.rent_pool_ar(d.platform, d.rent_period_ar) = 'شهري' then 'short'
                  when d.deal_ar = 'إيجار' then 'rent' end as deal
      from (select distinct s.platform, s.rent_period_ar, s.deal_ar from public.search_listings_ar s) d
    ), kept as (
      select s.source_table, s.listing_id, s.latitude::double precision la, s.longitude::double precision lo, s.type_ar, s.platform, c.deal,
             case when c.deal = 'buy' then s.price_total else s.price_annual end as price
      from public.search_listings_ar s
      join combos c on c.platform = s.platform and c.deal_ar = s.deal_ar and c.rent_period_ar is not distinct from s.rent_period_ar
      left join public.ops_default_pin_register r
             on r.source_table = s.source_table and r.lat = round(s.latitude::numeric, 5) and r.lng = round(s.longitude::numeric, 5)
      where s.latitude is not null and s.longitude is not null
        and s.latitude between p_s and p_n and s.longitude between p_w and p_e
        and r.source_table is null
        and c.deal is not null and (p_deals is null or c.deal = any (p_deals))
        and (p_category is null or (p_category = 'residential' and s.source_table like '%\_residential\_%')
                                or (p_category = 'commercial' and s.source_table like '%\_commercial\_%'))
        and (p_types is null or s.type_ar = any (p_types))
        and (p_beds is null or s.bedrooms = any (p_beds))
        and (p_area_min is null or s.area_m2 >= p_area_min) and (p_area_max is null or s.area_m2 <= p_area_max)
        and (p_price_min is null or (case when c.deal = 'buy' then s.price_total else s.price_annual end) >= p_price_min)
        and (p_price_max is null or (case when c.deal = 'buy' then s.price_total else s.price_annual end) <= p_price_max)
        and (p_poly is null or extensions.ST_Contains(
               extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_poly::text), 4326),
               extensions.ST_SetSRID(extensions.ST_MakePoint(s.longitude::double precision, s.latitude::double precision), 4326)))
    )
    select k.la, k.lo, count(*)::int,
           case when count(distinct k.deal) = 1 then min(k.deal) else 'mixed' end,
           case when count(*) > 1 then null else min(k.type_ar) end,
           count(distinct k.platform)::int,
           to_jsonb((array_agg(jsonb_build_object('t', k.source_table, 'i', k.listing_id) order by k.listing_id desc))[1:100]),
           case when count(*) > 1 then null else min(k.price) end,
           case when count(*) > 1 then null else min(k.platform) end
    from kept k
    group by k.la, k.lo
    order by 3 desc, 1, 2
    limit greatest(1, least(p_limit, 5000));
  end if;
end;
$$;
