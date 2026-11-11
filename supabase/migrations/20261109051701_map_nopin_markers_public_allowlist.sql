-- MAP: map_nopin_markers_ar() is a PUBLIC read, on the definer allowlist (the rule of *_secdef_functions_are_not_a_public_api:
-- every SECURITY DEFINER function the app calls needs an allowlist row, or the next pass revokes it from anon/authenticated).
-- It serves the district markers for listings with no exact location (src/data/mapNoPin.ts) — a read over
-- map_nopin_ar, the same shape and roles as map_pins_ar / map_areas_ar.
insert into public.ops_public_secdef_allowlist (proname, grant_to, reason)
values ('map_nopin_markers_ar', '{anon,authenticated}', 'map: one marker per district for listings with no exact location, with count and card ids, inside the visible box (src/data/mapNoPin.ts); read over the hourly map_nopin_ar')
on conflict do nothing;
grant execute on function public.map_nopin_markers_ar(double precision, double precision, double precision, double precision, text[], text, text[], integer[], integer, integer, numeric, numeric, integer) to anon, authenticated;
