-- Barrier 4 of 5: a monitor, so a leak is SEEN even if every upstream guard were removed.
-- Owner rule 2026-09-13: our own city/district picker lists must never show a number; a
-- source-published number belongs on the property card only.
CREATE OR REPLACE FUNCTION public.mon_detect_picker_number_leak()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int := 0;
  v_district_leak int;
  v_city_leak int;
  v_sample text;
begin
  -- Districts: 'live' rows are scraped text and must never carry a digit. 'catalog' rows are our
  -- OWN official list (e.g. الليث's "حي رقم 1".."حي رقم 10", where the number IS the name) and are
  -- deliberately allowed — owner's explicit call 2026-09-13.
  select count(*), min(canonical_district_ar) into v_district_leak, v_sample
    from public.loc_canonical_district
   where source = 'live' and canonical_district_ar ~ '[0-9٠-٩]';

  if v_district_leak > 0 then
    n := n + public.mon_raise('P1', 'picker_number_leak', 'location',
      'picker_number_leak:district',
      jsonb_build_object('leaked', v_district_leak, 'sample', v_sample,
        'why', v_district_leak || ' scraped district value(s) carrying a number reached the '
            || 'district picker (e.g. ' || coalesce(v_sample, '?') || '). Our own lists must never '
            || 'show a number — the number belongs on the property card only. Either the digit '
            || 'filter in refresh_loc_canonical_district() was weakened, its self-check was '
            || 'removed, or the loc_canonical_district_live_never_numbered constraint was dropped.'));
  else
    perform public.mon_resolve_key('picker_number_leak', 'picker_number_leak:district');
  end if;

  -- Cities: a city the user can pick must never carry a number either.
  select count(*), min(city_ar) into v_city_leak, v_sample
    from public.search_listings_ar
   where city_ar is not null and city_ar ~ '[0-9٠-٩]';

  if v_city_leak > 0 then
    n := n + public.mon_raise('P1', 'picker_number_leak', 'location',
      'picker_number_leak:city',
      jsonb_build_object('leaked', v_city_leak, 'sample', v_sample,
        'why', v_city_leak || ' searchable listing(s) carry a city name containing a number (e.g. '
            || coalesce(v_sample, '?') || '). A city in our own list must never show a number.'));
  else
    perform public.mon_resolve_key('picker_number_leak', 'picker_number_leak:city');
  end if;

  return n;
end $function$;

do $verify$
declare raised int;
begin
  select public.mon_detect_picker_number_leak() into raised;
  if raised <> 0 then
    raise exception 'mon_detect_picker_number_leak raised % alert(s) immediately after its own fix', raised;
  end if;
end $verify$;