-- Bahrah near Jeddah is in Makkah region, not Jazan (owner 2026-10-22: «fix it … everything has a pin mapped»,
-- answering whether to add Sakan's «بحره» spelling).
--
-- Measured 2026-10-22: every served ad labelled city 3504 «بحرة» (region 10, Jazan) — 52 of them: muktamel 33,
-- sakan 8, tuba 8, aqarmonthly 3 — carries its own pin at 21.24–21.47 N, 39.0–39.6 E, i.e. Bahrah on the
-- Jeddah–Makkah road, ~600 km north of Jazan. Their sources say «منطقة مكة المكرمة». The catalogue's only
-- district under 3504, «حي الاصالة» (3790), is that Bahrah's district too, so district-led inference kept
-- pulling Makkah ads into Jazan. Makkah's Bahrah is catalogue city 1882 «بحرة المجاهدين» (region 2).
--   1. alias «بحره» → 1882: the norm now has a Makkah AND a Jazan candidate, so the resolver's region hint
--      decides and a hint-less name stays unresolved (never a guess).
--   2. district 3790 «حي الاصالة» moves to 1882.
--   3. the rows carrying city_id 3504 whose pin is in Makkah move to 1882 (tables that store city_id).
--   4. detector: a served ad labelled in Jazan region whose own pin is north of 19.5 N.
set local statement_timeout = '2min';

insert into public.loc_catalog_city_alias(alias_norm, city_id) values ('بحره', 1882)
on conflict (alias_norm) do nothing;

update public.loc_catalog_district set city_id = 1882 where district_id = 3790 and city_id = 3504;

update public.sakan_residential_listings x set city_id = 1882, region_id = 2, city_ar = 'بحرة المجاهدين'
 where x.city_id = 3504 and (x.additional_info->>'latitude')::numeric between 20.5 and 22.5;
update public.tuba_residential_listings x set city_id = 1882, region_id = 2, city_ar = 'بحرة المجاهدين'
 where x.city_id = 3504
   and coalesce(x.additional_info->>'latitude', x.source_capture #>> '{rega,location,latitude}')::numeric between 20.5 and 22.5;
update public.aqarmonthly_residential_listings x set city_id = 1882, region_id = 2, city_ar = 'بحرة المجاهدين'
 where x.city_id = 3504 and (x.additional_info->>'latitude')::numeric between 20.5 and 22.5;

create or replace function public.mon_detect_jazan_label_pin_far_north()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; live text[] := '{}'; v bigint; ex text;
begin
  -- Jazan region spans ~16.3–18.6 N. A Jazan-labelled ad whose OWN pin is north of 19.5 N is filed in the
  -- wrong region (the Bahrah twin, 2026-10-22). Cheap: region_id is indexed-small.
  select count(*), min(source_table || ':' || listing_id) into v, ex
    from public.search_listings_ar
   where production_ready and region_id = 10 and latitude > 19.5;
  if v > 0 then
    live := live || 'jazan_label_pin_far_north:rows'::text;
    n := n + public.mon_raise('P1', 'jazan_label_pin_far_north', 'fleet', 'jazan_label_pin_far_north:rows',
      jsonb_build_object('rows', v, 'example', ex,
        'why', 'An ad filed under Jazan region has its own pin far north of Jazan: a same-name city resolved to the wrong region.',
        'action', 'Check the city name against loc_catalog_city twins; give the right city a loc_catalog_city_alias and re-file the rows.'));
  end if;
  perform public.mon_resolve_stale_keys('jazan_label_pin_far_north', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_jazan_label_pin_far_north' in src) > 0 then return; end if;
  out_def := replace(src,
    E'    ''mon_detect_pin_share_drop'',',
    E'    ''mon_detect_pin_share_drop'',\n    ''mon_detect_jazan_label_pin_far_north'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

do $proof$
begin
  if exists (select 1 from public.sakan_residential_listings where active and city_id = 3504)
     or exists (select 1 from public.tuba_residential_listings where active and city_id = 3504)
     or exists (select 1 from public.aqarmonthly_residential_listings where active and city_id = 3504) then
    raise exception 'PROOF: an active Bahrah row still sits in Jazan';
  end if;
  if (select city_id from public.loc_catalog_district where district_id = 3790) <> 1882 then
    raise exception 'PROOF: حي الاصالة is not under Makkah''s Bahrah';
  end if;
end $proof$;
