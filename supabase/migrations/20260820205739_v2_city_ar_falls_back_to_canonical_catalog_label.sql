-- Senior Production Engineer run #32b (2026-08-20), owner-directed.
--
-- DEFECT. 13 production_ready (searchable) listings carried a valid city_id and region_ar but
-- city_ar IS NULL, so their property cards rendered no city name while the listing stayed fully
-- reachable by that city's filter. All 13 are source_method='native_scraper' (the v1 branch).
--
-- ROOT CAUSE. v2 assembles the label as COALESCE(v1.city_ar, uc.city_ar). Both arms are about
-- RESOLVING an unknown city: v1.city_ar is the scraper's own Arabic text, and uc is the
-- district-only inference overlay. Neither arm derives the label from a city_id that is ALREADY
-- resolved -- so a row whose city_id came from the alias/legacy/region-scoped overlays (uali / ulg /
-- ulg2), or straight from v1.city_id with no accompanying Arabic text, has an identity but no name.
-- The catch-all branch already gets this right (it joins loc_catalog_city as `gcat` for exactly this
-- purpose); the v1 branch simply never had the equivalent.
--
-- FIX. Add a final COALESCE arm reading loc_catalog_city.city_ar for the row's OWN resolved city_id
-- -- the same expression v2 already publishes as its city_id column. This is canonical truth, not
-- inference: the Arabic name of a city_id is definitional. Nothing is matched from text, no city is
-- invented, and a row with no city identity still gets no name.
--
-- VERIFIED against a test view BEFORE applying (test vs live, same snapshot):
--   196,086 rows both sides
--   13 city_ar diffs, ALL of them NULL -> value gains; 0 rows changed or lost a city_ar
--   0 diffs on any non-target column (city_id, region_id, region_ar, district_ar, production_ready,
--     platform, price_total, area_m2, elevator, source_method)
--   0 gained labels that are not exactly loc_catalog_city.city_ar for that row's city_id
--   0 gained labels whose catalog region disagrees with the row's region_id
-- So no listing moves city, no search scope changes, and no count can shift: city/district/Trending
-- surfaces filter on city_id (and production_ready), neither of which this touches.

do $$
declare v_def text; v_new text; a_sel text; a_join text; n1 int; n2 int;
begin
  select pg_get_viewdef(c.oid,true) into v_def from pg_class c where c.relname='listing_native_location_v2';

  a_sel  := 'COALESCE(v1.city_ar, uc.city_ar) AS city_ar';
  a_join := '     LEFT JOIN loc_catalog_region ur ON ur.region_id = uc.region_id
';

  n1 := (length(v_def)-length(replace(v_def,a_sel,'')))/length(a_sel);
  n2 := (length(v_def)-length(replace(v_def,a_join,'')))/length(a_join);
  if n1 <> 1 or n2 <> 1 then raise exception 'REFUSED: anchors not unique (sel=%, join=%)', n1, n2; end if;

  v_new := replace(v_def, a_sel, 'COALESCE(v1.city_ar, uc.city_ar, ccl.city_ar) AS city_ar');
  v_new := replace(v_new, a_join, a_join ||
'     LEFT JOIN LATERAL ( SELECT lcc.city_ar
           FROM loc_catalog_city lcc
          WHERE lcc.city_id = COALESCE(v1.city_id, uali.city_id, ulg.city_id, ulg2.city_id, uc.city_id)) ccl ON true
');
  if v_new = v_def then raise exception 'REFUSED: no change'; end if;
  execute 'create or replace view public.listing_native_location_v2 as ' || v_new;
end $$;

drop view if exists public.listing_native_location_v2_test;
