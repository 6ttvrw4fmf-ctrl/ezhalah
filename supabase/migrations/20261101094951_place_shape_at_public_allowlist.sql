-- place_shape_at() is a public READ the map makes on every area pick (owner 2026-11-01: real boundaries, not rectangles).
-- The definer-function rule (20261018 *_secdef_functions_are_not_a_public_api): a definer function the app calls keeps anon /
-- authenticated only through an allowlist row, or the next sweep revokes it and every area pick falls back to the rectangle.
insert into public.ops_public_secdef_allowlist (proname, grant_to, reason)
values ('place_shape_at', '{anon,authenticated}', 'map search: the smallest OSM district / governorate / region shape containing the picked coordinate, drawn as the area boundary (src/data/placeShape.ts). Read-only STABLE, one row, public open data (© OpenStreetMap contributors, ODbL), no personal data.')
on conflict do nothing;
grant execute on function public.place_shape_at(double precision, double precision, text) to anon, authenticated;