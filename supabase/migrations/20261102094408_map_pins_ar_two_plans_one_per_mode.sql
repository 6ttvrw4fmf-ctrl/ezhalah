-- map_pins_ar(): ONE PLAN PER MODE (2026-11-02, measured minutes after the previous version). The same body run
-- inline took 1.6 s for the Riyadh city grid; the SQL function took 10.8 s. A SQL-language function is planned with
-- its arguments as parameters, so «where p_cell = 0» and «where p_cell > 0» could not be folded and BOTH branches
-- ran over every listing — the point branch built its jsonb id arrays for 182k rows the grid call never wanted.
-- The function is now plpgsql with an IF: the call runs only the branch it asked for, each with its own plan.
-- Same signature, same answers.
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
    with box as (
      select s.source_table, s.listing_id, s.latitude::double precision la, s.longitude::double precision lo, s.platform,
             s.deal_ar, s.rent_period_ar, s.price_total, s.price_annual,
             round(s.latitude::numeric, 5) la5, round(s.longitude::numeric, 5) lo5
      from public.search_listings_ar s
      where s.latitude is not null and s.longitude is not null
        and s.latitude between p_s and p_n and s.longitude between p_w and p_e
        and (p_category is null or (p_category = 'residential' and s.source_table like '%\_residential\_%')
                                or (p_category = 'commercial' and s.source_table like '%\_commercial\_%'))
        and (p_types is null or s.type_ar = any (p_types))
        and (p_beds is null or s.bedrooms = any (p_beds))
        and (p_area_min is null or s.area_m2 >= p_area_min) and (p_area_max is null or s.area_m2 <= p_area_max)
    ), own as materialized (
      select b.* from box b left join public.ops_default_pin_register r
             on r.source_table = b.source_table and r.lat = b.la5 and r.lng = b.lo5
      where r.source_table is null
        and (p_poly is null or extensions.ST_Contains(
               extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_poly::text), 4326),
               extensions.ST_SetSRID(extensions.ST_MakePoint(b.lo, b.la), 4326)))
    ), distinct_combos as materialized (
      select distinct o.platform, o.rent_period_ar, o.deal_ar from own o
    ), combos as materialized (
      select d.platform, d.rent_period_ar, d.deal_ar,
             case when d.deal_ar = 'بيع' then 'buy'
                  when d.deal_ar = 'إيجار' and public.rent_pool_ar(d.platform, d.rent_period_ar) = 'شهري' then 'short'
                  when d.deal_ar = 'إيجار' then 'rent' end as deal
      from distinct_combos d
    ), kept as (
      select o.la, o.lo, c.deal
      from own o join combos c on c.platform = o.platform and c.deal_ar = o.deal_ar
                               and c.rent_period_ar is not distinct from o.rent_period_ar
      where c.deal is not null and (p_deals is null or c.deal = any (p_deals))
        and (p_price_min is null or (case when c.deal = 'buy' then o.price_total else o.price_annual end) >= p_price_min)
        and (p_price_max is null or (case when c.deal = 'buy' then o.price_total else o.price_annual end) <= p_price_max)
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
    with box as (
      select s.source_table, s.listing_id, s.latitude::double precision la, s.longitude::double precision lo, s.type_ar, s.platform,
             s.deal_ar, s.rent_period_ar, s.price_total, s.price_annual,
             round(s.latitude::numeric, 5) la5, round(s.longitude::numeric, 5) lo5
      from public.search_listings_ar s
      where s.latitude is not null and s.longitude is not null
        and s.latitude between p_s and p_n and s.longitude between p_w and p_e
        and (p_category is null or (p_category = 'residential' and s.source_table like '%\_residential\_%')
                                or (p_category = 'commercial' and s.source_table like '%\_commercial\_%'))
        and (p_types is null or s.type_ar = any (p_types))
        and (p_beds is null or s.bedrooms = any (p_beds))
        and (p_area_min is null or s.area_m2 >= p_area_min) and (p_area_max is null or s.area_m2 <= p_area_max)
    ), own as materialized (
      select b.* from box b left join public.ops_default_pin_register r
             on r.source_table = b.source_table and r.lat = b.la5 and r.lng = b.lo5
      where r.source_table is null
        and (p_poly is null or extensions.ST_Contains(
               extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_poly::text), 4326),
               extensions.ST_SetSRID(extensions.ST_MakePoint(b.lo, b.la), 4326)))
    ), distinct_combos as materialized (
      select distinct o.platform, o.rent_period_ar, o.deal_ar from own o
    ), combos as materialized (
      select d.platform, d.rent_period_ar, d.deal_ar,
             case when d.deal_ar = 'بيع' then 'buy'
                  when d.deal_ar = 'إيجار' and public.rent_pool_ar(d.platform, d.rent_period_ar) = 'شهري' then 'short'
                  when d.deal_ar = 'إيجار' then 'rent' end as deal
      from distinct_combos d
    ), kept as (
      select o.*, c.deal, case when c.deal = 'buy' then o.price_total else o.price_annual end as price
      from own o join combos c on c.platform = o.platform and c.deal_ar = o.deal_ar
                               and c.rent_period_ar is not distinct from o.rent_period_ar
      where c.deal is not null and (p_deals is null or c.deal = any (p_deals))
        and (p_price_min is null or (case when c.deal = 'buy' then o.price_total else o.price_annual end) >= p_price_min)
        and (p_price_max is null or (case when c.deal = 'buy' then o.price_total else o.price_annual end) <= p_price_max)
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
