-- MAP: map_posted_window_counts_ar() is a PUBLIC read, on the definer allowlist (the rule of *_secdef_functions_are_not_a_public_api:
-- every SECURITY DEFINER function the app calls needs an allowlist row, or the next pass revokes it from anon/authenticated).
-- It serves the «نُشر خلال» numbers of the map filter (src/data/mapPins.ts) — a read over map_listing_points_ar, the same
-- rows and roles as map_pins_ar.
insert into public.ops_public_secdef_allowlist (proname, grant_to, reason)
values ('map_posted_window_counts_ar', '{anon,authenticated}', 'map filter: «نُشر خلال» count of every window for the pins in the visible box (src/data/mapPins.ts); a read over map_listing_points_ar, same rows as map_pins_ar')
on conflict do nothing;
grant execute on function public.map_posted_window_counts_ar(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text) to anon, authenticated;
