-- New Listings Engineer, 2026-10-08, fix-forward of 20261008074119. Inside plpgsql the bridge column
-- «n» collided with the function's own variable «n» («column reference "n" is ambiguous»), so job 45's
-- refresh_district_recovery_pipeline() failed at 08:10 UTC and rolled back (bridge, canonical and
-- district_recovery kept their 07:10 contents; nothing was lost). The column is now table-qualified.
-- The check below EXECUTES the function, the step the first migration's check block never ran, and
-- proves «Al-Hamra» now resolves in Riyadh.
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
      select norm_en_district(b0.district_en) en_norm, norm_district_tok(b0.district_ar) dk, b0.n as bn
      from public.district_name_bridge b0
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
do $$
declare v_rows bigint; v_riy text;
begin
  v_rows := public.refresh_bridge_en_district();
  if v_rows < 1000 then
    raise exception 'refresh_bridge_en_district produced only % global rows', v_rows;
  end if;
  if (select district_norm from public.bridge_en_district where en_norm = 'hamra' and n_distinct = 1) is distinct from 'حمرا' then
    raise exception 'hamra did not translate after the refresh';
  end if;
  v_riy := public.resolve_district_ar(3, 'Al-Hamra');
  if v_riy is null then
    raise exception 'Al-Hamra still does not resolve in Riyadh';
  end if;
end $$;
