-- THE DISTRICT MOVES WITH A PIN-CORRECTED CITY (backlog 1166). listing_native_location_v2 took the corrected city from
-- listing_city_correction but kept the SOURCE's district, so an ad moved from الحناكية to المدينة المنورة would have
-- carried «حي الحناكية» — the old town's name — under Madinah. For city_source 'pin_governorate' the district is now
-- the one refresh_pin_city_correction() proved on the new city's official list (title «حي X» or the OSM district
-- under the pin), else NULL. Every other row is unchanged. Patched on the live view definition (rule: re-read, never
-- retype — other sessions edit this view too); fails closed if the expression is not found exactly once.
set local lock_timeout = '15s';
do $mig$
declare
  d text := pg_get_viewdef('public.listing_native_location_v2'::regclass);
  old_txt constant text := 'COALESCE(v1.district_ar, dr.district_ar) AS district_ar,';
  new_txt constant text := 'CASE WHEN (xcc.city_source = ''pin_governorate''::text) THEN ( SELECT kd.district_ar FROM loc_catalog_district kd WHERE ((kd.city_id = xcc.city_id) AND (kd.district_norm = xcc.district_norm) AND (kd.retired_at IS NULL)) LIMIT 1) ELSE COALESCE(v1.district_ar, dr.district_ar) END AS district_ar,';
begin
  if (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 then
    raise exception 'listing_native_location_v2: district expression not found exactly once';
  end if;
  execute 'create or replace view public.listing_native_location_v2 as ' || replace(d, old_txt, new_txt);
  if position('pin_governorate' in pg_get_viewdef('public.listing_native_location_v2'::regclass)) = 0 then
    raise exception 'listing_native_location_v2: district patch did not land';
  end if;
end
$mig$;
