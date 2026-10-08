-- New Listings Engineer, 2026-10-08. An English district name stops translating when ONE stray ad pairs
-- it with another Arabic name: «Al-Hamra» is «حي الحمراء» on 232 wasalt ads and «الحمة» on 1, so
-- bridge_en_district stored it as ambiguous (n_distinct 2) and resolve_district_ar() returned NULL.
-- Tonight that left 63 Riyadh arrivals (and 2 Unaizah) with no district although Riyadh's catalog
-- has «حي الحمراء». 60 bridge keys are blocked this way (ghadeer 196:1, «حي العزيزية» 1507:1, …).
--
-- Rule (global rows only; the city-scoped '@' rows are unchanged): a translation is unique when every
-- other Arabic name for it is a single-ad pairing AND the dominant name has >= 10 ads AND >= 95% of
-- all ads. Anything closer stays ambiguous (e.g. «الحمر الجنوبي» 7:1, «العريجاء الأوسط» 5:1, «Al-Aziziyah»
-- with «حي الازدهار» on 2 ads). The resolver still requires the Arabic name in THIS city's catalog.
CREATE OR REPLACE FUNCTION public.refresh_bridge_en_district()
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare n bigint;
begin
  truncate public.bridge_en_district;
  insert into public.bridge_en_district (en_norm, district_norm, n_distinct)
  select en_norm,
         case when count(*) = 1 then min(dk)
              when count(*) filter (where ads >= 2) = 1 and max(ads) >= 10 and max(ads) >= 0.95 * sum(ads)
                then (array_agg(dk order by ads desc))[1]
              else null end,
         case when count(*) = 1
                or (count(*) filter (where ads >= 2) = 1 and max(ads) >= 10 and max(ads) >= 0.95 * sum(ads))
              then 1 else count(*)::int end
  from (
    select en_norm, dk, sum(coalesce(bn, 1)) as ads
    from (
      select norm_en_district(district_en) en_norm, norm_district_tok(district_ar) dk, n as bn
      from public.district_name_bridge
    ) z0
    where en_norm is not null and en_norm <> '' and dk is not null and dk <> '' and en_norm !~ '@'
    group by en_norm, dk
  ) z
  group by en_norm;
  get diagnostics n = row_count;
  -- city-scoped rows (2026-10-06): '<en_norm>@<city_id>', unambiguous inside that city, >= 2 ads each
  insert into public.bridge_en_district (en_norm, district_norm, n_distinct)
  select z.en_norm || '@' || z.city_id, min(z.dk), 1
  from (
    select norm_en_district(b.district_en) en_norm, norm_district_tok(b.district_ar) dk, pin.city_id
    from public.district_name_bridge b
    join lateral (
      select min(cc.city_id) as city_id
      from public.loc_city_map cm
      join public.loc_catalog_region cr on cr.region_ar = cm.region_ar
      join public.loc_catalog_city cc on cc.region_id = cr.region_id
           and (normalize_ar(cc.city_ar) = normalize_ar(cm.city_ar)
                or exists (select 1 from public.loc_catalog_city_alias al
                           where al.alias_norm = normalize_ar(cm.city_ar) and al.city_id = cc.city_id))
      where cm.city_key = lower(btrim(b.city_en))
      having count(distinct cc.city_id) = 1
    ) pin on true
    where b.n >= 2
  ) z
  where z.en_norm is not null and length(z.en_norm) >= 3 and z.en_norm !~ '@'
    and z.en_norm not in ('the', 'new', 'old', 'north', 'south', 'east', 'west', 'central', 'downtown')
    and z.dk is not null and z.dk <> ''
  group by z.en_norm, z.city_id
  having count(distinct z.dk) = 1;
  -- end city-scoped rows
  return n;
end;
$function$;

-- Check: the rule, run over the live evidence, translates «hamra» to حمرا and still refuses the
-- close calls named above.
do $$
declare v_hamra text; v_close int;
begin
  with p as (
    select norm_en_district(district_en) en_norm, norm_district_tok(district_ar) dk, sum(coalesce(n,1)) ads
    from public.district_name_bridge group by 1, 2),
  a as (
    select en_norm,
           case when count(*) = 1 then min(dk)
                when count(*) filter (where ads >= 2) = 1 and max(ads) >= 10 and max(ads) >= 0.95 * sum(ads)
                  then (array_agg(dk order by ads desc))[1] end as dk
    from p where en_norm is not null and en_norm <> '' and dk is not null and dk <> '' and en_norm !~ '@'
    group by en_norm)
  select max(dk) filter (where en_norm = 'hamra'),
         count(*) filter (where en_norm in ('الحمر الجنوبي', 'العريجاء الأوسط', 'aziziyah') and dk is not null)
    into v_hamra, v_close from a;
  if v_hamra is distinct from 'حمرا' then
    raise exception 'hamra does not translate to حمرا (got %)', v_hamra;
  end if;
  if v_close > 0 then
    raise exception 'a close call translated (% rows)', v_close;
  end if;
  if position('0.95 * sum(ads)' in pg_get_functiondef('public.refresh_bridge_en_district()'::regprocedure)) = 0 then
    raise exception 'refresh_bridge_en_district rule did not land';
  end if;
end $$;
