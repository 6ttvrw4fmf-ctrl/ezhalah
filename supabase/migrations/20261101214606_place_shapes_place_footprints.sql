-- EVERY PICK DRAWS A BOUNDARY (owner 2026-11-01: «whenever you choose something in Apple Maps we want to create
-- this boundary — anything»). A fourth kind, 'place', holds the footprint of a named site or building from
-- OpenStreetMap (a mall, hospital, university, airport, park, hotel, mosque, stadium …) so a landmark pick draws
-- its real outline the way a district pick already does. The circle stays only for a landmark with no footprint.
alter table public.place_shapes drop constraint if exists place_shapes_kind_check;
alter table public.place_shapes add constraint place_shapes_kind_check check (kind in ('district', 'city', 'region', 'place'));
comment on table public.place_shapes is 'OSM boundaries (district / city / region) and named-site footprints (place) drawn on the map when a place is picked. © OpenStreetMap contributors, ODbL. Read only through place_shape_at(); written only by place_shapes_upsert() (service role).';

-- Same read, one tolerance: Apple pins a site at its entrance or centre, which can sit a few metres outside the
-- OSM footprint, so a 'place' lookup accepts a shape within ~50 m and takes the nearest, then the smallest.
-- Area kinds keep strict containment.
create or replace function public.place_shape_at(p_lat double precision, p_lng double precision, p_kind text default 'district')
returns table (name_ar text, name_en text, kind text, geojson text)
language sql stable security definer
set search_path = public, extensions
as $$
  with pt as (select extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326) as g)
  select s.name_ar, s.name_en, s.kind, extensions.ST_AsGeoJSON(s.geom, 5)
  from public.place_shapes s, pt
  where s.kind = p_kind
    and extensions.ST_DWithin(s.geom, pt.g, case when p_kind = 'place' then 0.0005 else 0 end)
  order by extensions.ST_Distance(s.geom, pt.g) asc, s.area_deg2 asc
  limit 1;
$$;
