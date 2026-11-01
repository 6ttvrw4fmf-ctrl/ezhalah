-- REAL AREA BOUNDARIES ON THE MAP (owner 2026-11-01: «create a boundary around it, don't make just a square»).
-- A picked district / city / region draws the actual shape of the place, not Apple's bounding rectangle.
-- Shapes come from OpenStreetMap (© OpenStreetMap contributors, ODbL — the map already credits OSM for the region
-- silhouettes in src/data/saRegionPaths.json), loaded by .github/workflows/place-shapes-load.yml from the committed
-- data/place-shapes.geojson.gz through place_shapes_upsert(). The app reads ONE shape per pick through
-- place_shape_at(): the smallest shape of the asked kind that contains the picked coordinate — no name matching.
create extension if not exists postgis with schema extensions;

create table if not exists public.place_shapes (
  id bigserial primary key,
  osm_type text not null,
  osm_id bigint not null,
  kind text not null check (kind in ('district', 'city', 'region')),
  admin_level smallint,
  name_ar text,
  name_en text,
  geom extensions.geometry(MultiPolygon, 4326) not null,
  area_deg2 double precision not null,
  updated_at timestamptz not null default now(),
  unique (osm_type, osm_id)
);
create index if not exists place_shapes_geom_gix on public.place_shapes using gist (geom);
create index if not exists place_shapes_kind_idx on public.place_shapes (kind);
alter table public.place_shapes enable row level security;
revoke all on public.place_shapes from anon, authenticated;
comment on table public.place_shapes is 'OSM area boundaries (district / city / region) drawn on the map when a place is picked. © OpenStreetMap contributors, ODbL. Read only through place_shape_at(); written only by place_shapes_upsert() (service role).';

-- The one read the app makes: the smallest shape of that kind containing the point, as GeoJSON (5 decimals ≈ 1 m).
create or replace function public.place_shape_at(p_lat double precision, p_lng double precision, p_kind text default 'district')
returns table (name_ar text, name_en text, kind text, geojson text)
language sql stable security definer
set search_path = public, extensions
as $$
  select s.name_ar, s.name_en, s.kind, extensions.ST_AsGeoJSON(s.geom, 5)
  from public.place_shapes s
  where s.kind = p_kind
    and extensions.ST_Intersects(s.geom, extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326))
  order by s.area_deg2 asc
  limit 1;
$$;
revoke all on function public.place_shape_at(double precision, double precision, text) from public;
grant execute on function public.place_shape_at(double precision, double precision, text) to anon, authenticated, service_role;

-- The loader's write: rows as [{osm_type, osm_id, kind, admin_level, name_ar, name_en, geometry}] (GeoJSON geometry).
create or replace function public.place_shapes_upsert(p_rows jsonb)
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
declare n integer;
begin
  with src as (
    select (r->>'osm_type') as osm_type, (r->>'osm_id')::bigint as osm_id, (r->>'kind') as kind,
           nullif(r->>'admin_level', '')::smallint as admin_level, nullif(r->>'name_ar', '') as name_ar, nullif(r->>'name_en', '') as name_en,
           extensions.ST_Multi(extensions.ST_MakeValid(extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(r->'geometry'), 4326))) as geom
    from jsonb_array_elements(p_rows) r
  ), ok as (
    select * from src where extensions.GeometryType(geom) = 'MULTIPOLYGON' and not extensions.ST_IsEmpty(geom)
  ), up as (
    insert into public.place_shapes (osm_type, osm_id, kind, admin_level, name_ar, name_en, geom, area_deg2)
    select osm_type, osm_id, kind, admin_level, name_ar, name_en, geom, extensions.ST_Area(geom) from ok
    on conflict (osm_type, osm_id) do update
      set kind = excluded.kind, admin_level = excluded.admin_level, name_ar = excluded.name_ar, name_en = excluded.name_en,
          geom = excluded.geom, area_deg2 = excluded.area_deg2, updated_at = now()
    returning 1
  )
  select count(*) into n from up;
  return n;
end;
$$;
revoke all on function public.place_shapes_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.place_shapes_upsert(jsonb) to service_role;