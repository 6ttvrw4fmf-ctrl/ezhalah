-- A SITE FOOTPRINT IS DRAWN ONLY WHEN IT IS THE PICKED SITE'S OWN (walked live 2026-11-01): «King Saud Hospital Mosque»
-- drew the whole hospital compound around the mosque, and «King Saud Palace Hospitality» drew the palace grounds — the
-- nearest shape at the point was a PARENT of the pick, not the pick. For kind 'place' a shape now qualifies only when its
-- name (ar or en, folded) contains the picked name: the airport for «مطار الملك خالد», the mall for «النخيل مول». No
-- match → no row → the caller draws its honest fallback (the soft circle). Area kinds (district / city / region) keep
-- plain containment: a district's point is inside exactly its district. One signature, unchanged.
create or replace function public.place_shape_at(p_lat double precision, p_lng double precision, p_kind text default 'district', p_name text default null)
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
    and (p_kind <> 'place' or (q.n is not null and length(q.n) >= 3 and exists (
       select 1 from unnest(array[s.name_ar, s.name_en]) nm
       where nm is not null
         and regexp_replace(translate(lower(nm), 'ةىأإآ', 'هياااا'), '(^|\s)ال', '\1', 'g') like '%' || q.n || '%')))
  order by extensions.ST_Distance(s.geom, pt.g) asc, s.area_deg2 asc
  limit 1;
$$;
