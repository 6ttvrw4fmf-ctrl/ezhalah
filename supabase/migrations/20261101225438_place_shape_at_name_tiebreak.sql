-- THE PICKED NAME BREAKS THE TIE (walked live 2026-11-01): Apple's point for «مطار الملك خالد الدولي» lies inside the
-- aerodrome AND inside «Terminal 2», and smallest-first handed back the terminal. The lookup is still by coordinate —
-- a shape must be at (or within ~50 m of) the point — but among those shapes the one whose name matches what the user
-- picked wins; then nearest, then smallest. A fourth parameter means a new signature: the old one is DROPPED first so
-- the function never has two overloads (PGRST203, the 2026-07-16 outage shape).
drop function if exists public.place_shape_at(double precision, double precision, text);
create function public.place_shape_at(p_lat double precision, p_lng double precision, p_kind text default 'district', p_name text default null)
returns table (name_ar text, name_en text, kind text, geojson text)
language sql stable security definer
set search_path = public, extensions
as $$
  with pt as (select extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326) as g),
  q as (select nullif(regexp_replace(translate(lower(coalesce(p_name, '')), 'ةىأإآ', 'هياااا'), '(^|\s)ال', '\1', 'g'), '') as n)
  select s.name_ar, s.name_en, s.kind, extensions.ST_AsGeoJSON(s.geom, 5)
  from public.place_shapes s, pt, q
  where s.kind = p_kind
    and extensions.ST_DWithin(s.geom, pt.g, case when p_kind = 'place' then 0.0005 else 0 end)
  order by
    (case when q.n is not null and length(q.n) >= 3 and exists (
       select 1 from unnest(array[s.name_ar, s.name_en]) nm
       where nm is not null and length(nm) >= 3
         and (regexp_replace(translate(lower(nm), 'ةىأإآ', 'هياااا'), '(^|\s)ال', '\1', 'g') like '%' || q.n || '%'
           or q.n like '%' || regexp_replace(translate(lower(nm), 'ةىأإآ', 'هياااا'), '(^|\s)ال', '\1', 'g') || '%'))
     then 0 else 1 end),
    extensions.ST_Distance(s.geom, pt.g) asc, s.area_deg2 asc
  limit 1;
$$;
revoke all on function public.place_shape_at(double precision, double precision, text, text) from public;
grant execute on function public.place_shape_at(double precision, double precision, text, text) to anon, authenticated, service_role;
