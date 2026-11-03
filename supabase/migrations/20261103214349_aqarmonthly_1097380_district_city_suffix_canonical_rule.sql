-- aqarmonthly_district_city_suffix (alert open 2026-11-03): one active row still carries the city glued onto its district.
-- aqarmonthly 1097380, slug «…-حي-الملك-فهد-المجمعة-المجمعة-5708581», city unresolved (NULL), district «حي الملك فهد المجمعة».
-- resolve_slug() already strips this shape when the city is unresolved (strip_city_suffix(d, trailing_catalog_city_norm(d)));
-- the row was stored on 2026-06-27, before that guard, and later passes only refreshed last_seen_at. This applies the SAME
-- canonical rule the parser and mon_detect_aqarmonthly_district_city_suffix() use, to this one row, guarded on its exact text.
update public.aqarmonthly_residential_listings r
   set district_ar = public.strip_district_city_suffix(r.district_ar, public.district_trailing_catalog_city_norm(r.district_ar))
 where r.id = 1097380
   and r.city_id is null
   and r.district_ar = 'حي الملك فهد المجمعة'
   and public.strip_district_city_suffix(r.district_ar, public.district_trailing_catalog_city_norm(r.district_ar)) = 'حي الملك فهد';

-- The standing detector that found it re-runs here and resolves its key once the row is clean (it re-raises on any regression).
select public.mon_detect_aqarmonthly_district_city_suffix();
