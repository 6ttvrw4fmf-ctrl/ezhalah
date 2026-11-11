-- aqarcity: a twin city name with NO stated region is placed by the region of the ad's OWN pin (🆕 2026-11-10).
--
-- Tonight's arrivals aqarcity_residential_listings 26246412 / 26246413 («ارض للبيع في الشيحيه», 361 / 360 m²) were NOT
-- searchable: no city. The page (re-read run 42774404592) gives addressLocality «الشيحيه» and no addressRegion, and
-- loc_catalog_city holds «الشيحية» three times (city 107 region 5, 2374 region 8, 2611 region 4), so
-- aqarcity_arabic_city_pin(city_ar, region) — correctly — refuses to pick a twin when region is NULL. Older ads from the
-- same office carried region «Hail» and are served under 2374 (6 rows).
-- The ad publishes its own pin (27.8958, 42.6790; rega_location_verified = true). It lies in «محافظة بقعاء», region 8
-- (حائل) — the seller's own text says «الشيحية - بقعاء - حائل». Measured the same night on 391 active aqarcity ads that
-- state a region AND carry a pin: the pin's region agrees 391 / 391, 0 disagreements.
-- Rule (owner 2026-11-03 «Title/pin wins»): the stated region always wins; only when the site states NONE is the pin's
-- region handed to the unchanged twin resolver, and only when the pin sits in exactly ONE region. A name that is not in
-- the catalogue still resolves to nothing (26246411 «قرية وادي نخلين»: pin in Asir, no such catalogue city — unmatched).
-- Two needle edits, one text each, each RAISES unless its anchor is found exactly as counted. Cron is untouched.

create or replace function public.aqarcity_pin_region_en(p_info jsonb)
 returns text
 language sql
 stable
 set search_path to 'public', 'extensions'
as $function$
  select case min(g.region_id)
           when 1 then 'Riyadh' when 2 then 'Makkah' when 3 then 'Madinah' when 4 then 'Qassim'
           when 5 then 'Eastern Province' when 6 then 'Asir' when 7 then 'Tabuk' when 8 then 'Hail'
           when 9 then 'Northern Borders' when 10 then 'Jazan' when 11 then 'Najran' when 12 then 'Al Bahah'
           when 13 then 'Al Jawf' end
    from public.loc_gov_shape_sub g
   where p_info->>'latitude' ~ '^-?[0-9]+(\.[0-9]+)?$'
     and p_info->>'longitude' ~ '^-?[0-9]+(\.[0-9]+)?$'
     and (p_info->>'latitude')::float8 between 16 and 33
     and (p_info->>'longitude')::float8 between 34 and 56
     and st_intersects(g.geom, st_setsrid(st_makepoint((p_info->>'longitude')::float8,
                                                       (p_info->>'latitude')::float8), 4326))
  having count(distinct g.region_id) = 1
$function$;

do $edit$
declare
  old_anchor constant text := 'r.region)';
  new_text   constant text := 'coalesce(r.region, public.aqarcity_pin_region_en(r.additional_info)))';
  d text;
begin
  d := pg_get_functiondef('public.resolve_aqarcity_arabic_city_before_sync()'::regprocedure);
  if (length(d) - length(replace(d, old_anchor, ''))) / length(old_anchor) <> 1 then
    raise exception 'resolve_aqarcity_arabic_city_before_sync: anchor % not found exactly once', old_anchor;
  end if;
  execute replace(d, old_anchor, new_text);

  d := pg_get_functiondef('public.mon_detect_aqarcity_arabic_city_stranded()'::regprocedure);
  if (length(d) - length(replace(d, old_anchor, ''))) / length(old_anchor) <> 2 then
    raise exception 'mon_detect_aqarcity_arabic_city_stranded: anchor % not found exactly twice', old_anchor;
  end if;
  execute replace(d, old_anchor, new_text);
end $edit$;

-- Check block: EXECUTE the new path on the real rows, both directions.
do $chk$
declare v text; c text;
begin
  if position('aqarcity_pin_region_en' in pg_get_functiondef('public.resolve_aqarcity_arabic_city_before_sync()'::regprocedure)) = 0
     or position('aqarcity_pin_region_en' in pg_get_functiondef('public.mon_detect_aqarcity_arabic_city_stranded()'::regprocedure)) = 0 then
    raise exception 'check: the pin region did not land in both functions';
  end if;
  -- (a) tonight's الشيحية ad: no stated region → its pin's region → the Hail twin
  select coalesce(r.region, public.aqarcity_pin_region_en(r.additional_info)), p.city_ar into v, c
    from public.aqarcity_residential_listings r
    left join lateral public.aqarcity_arabic_city_pin(r.additional_info->>'city_ar',
                coalesce(r.region, public.aqarcity_pin_region_en(r.additional_info))) p on true
   where r.id = 26246412;
  if v is distinct from 'Hail' or c is distinct from 'الشيحية' then
    raise exception 'check (a): 26246412 resolved region % city % (want Hail / الشيحية)', v, c;
  end if;
  -- (b) a pin with no region → still no city when the name is not in the catalogue
  select p.city_ar into c
    from public.aqarcity_residential_listings r
    left join lateral public.aqarcity_arabic_city_pin(r.additional_info->>'city_ar',
                coalesce(r.region, public.aqarcity_pin_region_en(r.additional_info))) p on true
   where r.id = 26246411;
  if c is not null then
    raise exception 'check (b): «قرية وادي نخلين» must stay unmatched, got %', c;
  end if;
  -- (c) a pin outside the kingdom, or none, gives no region
  if public.aqarcity_pin_region_en('{"latitude":"40.0","longitude":"10.0"}'::jsonb) is not null
     or public.aqarcity_pin_region_en('{}'::jsonb) is not null then
    raise exception 'check (c): a missing / foreign pin produced a region';
  end if;
  -- (d) the resolver itself runs
  perform public.resolve_aqarcity_arabic_city_before_sync();
end $chk$;
