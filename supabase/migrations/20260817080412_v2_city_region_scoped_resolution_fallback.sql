-- Data Integrity run #26 (2026-08-17), second fix in the same class.
--
-- The first fix (v2_city_falls_back_to_matched_arabic_resolution) recovered 39 listings whose
-- matched resolution named a city that is UNIQUE across the whole catalog. It deliberately left
-- alone the rows whose city NAME is carried by several catalog cities -- «المجمعة» exists in 4
-- regions, «بيش»/«الدرعية»/«العيون»/«الباحة»/«القويعية» in 2-4 -- because §6 forbids letting an
-- ambiguous name silently select the first id.
--
-- But §6's very next clause says duplicate names are "resolved using hierarchy/context", and the
-- context is already there: the SAME listings_arabic_locations row that records city_ar also
-- records region_ar, and both come as a PAIR from one loc_city_map entry. Measured across every
-- unlocated row: 9 are ambiguous by name, and 9 of 9 resolve to EXACTLY ONE catalog city once
-- scoped to the region already recorded beside the name. Using the pair is strictly more faithful
-- than using the name alone -- it is not a loosened gate, it is a better-informed one.
--
-- METHOD: a SECOND lateral (ulg2) placed AFTER ulg in the same COALESCE chain, never a change to
-- ulg itself. The first branch's behaviour is already proven against production on 39 rows; a
-- proven branch does not get edited to serve a new case. ulg2 fires only where ulg found nothing,
-- so this remains strictly additive and the earlier proof still holds unmodified.
--
-- The unambiguity gate is NOT relaxed: count(DISTINCT cc3.city_id) = 1 still applies, merely
-- within the recorded region. A row whose name is ambiguous EVEN INSIDE its own region still
-- resolves to NULL, and there are currently 0 of those.

do $mig$
declare
  v_def text;
  v_new text;
  v_lateral text;
  n_ulg int; n_city int; n_region int; n_region_ar int; n_from int;
begin
  v_def := regexp_replace(pg_get_viewdef('public.listing_native_location_v2'::regclass), '\s+', ' ', 'g');

  -- Anchors: the first fix must be present and intact, or this migration is operating on a
  -- definition it did not write and must refuse.
  n_ulg       := (length(v_def) - length(replace(v_def,'HAVING (count(DISTINCT cc2.city_id) = 1)) ulg ON (true))','')))
                 / length('HAVING (count(DISTINCT cc2.city_id) = 1)) ulg ON (true))');
  n_city      := (length(v_def) - length(replace(v_def,'COALESCE(v1.city_id, uali.city_id, ulg.city_id, uc.city_id)','')))
                 / length('COALESCE(v1.city_id, uali.city_id, ulg.city_id, uc.city_id)');
  n_region    := (length(v_def) - length(replace(v_def,'COALESCE(v1.region_id, uac.region_id, ulgc.region_id, uc.region_id)','')))
                 / length('COALESCE(v1.region_id, uac.region_id, ulgc.region_id, uc.region_id)');
  n_region_ar := (length(v_def) - length(replace(v_def,'COALESCE(v1.region_ar, uar.region_ar, ulgr.region_ar, ur.region_ar)','')))
                 / length('COALESCE(v1.region_ar, uar.region_ar, ulgr.region_ar, ur.region_ar)');
  n_from      := (length(v_def) - length(replace(v_def,'FROM (((((((((((((listing_native_location_v1 v1','')))
                 / length('FROM (((((((((((((listing_native_location_v1 v1');

  if n_ulg <> 1 or n_city <> 2 or n_region <> 2 or n_region_ar <> 1 or n_from <> 1 then
    raise exception 'listing_native_location_v2 is not in the shape the first fix left it (ulg=%, city=%, region=%, region_ar=%, from=%) - refusing to splice',
      n_ulg, n_city, n_region, n_region_ar, n_from;
  end if;

  insert into ops_view_definition_backup(view_name, reason, definition)
  values ('listing_native_location_v2',
          'run26: before adding the region-scoped resolution fallback (ulg2)',
          pg_get_viewdef('public.listing_native_location_v2'::regclass));

  v_lateral :=
    ' LEFT JOIN LATERAL ( SELECT max(cc3.city_id) AS city_id'
 || ' FROM ((listings_arabic_locations lal3'
 || ' JOIN loc_catalog_region cr3 ON ((cr3.region_ar = lal3.region_ar)))'
 || ' JOIN loc_catalog_city cc3 ON (((cc3.city_norm = normalize_ar(lal3.city_ar))'
 || ' AND (cc3.region_id = cr3.region_id))))'
 || ' WHERE ((v1.city_id IS NULL) AND (uali.city_id IS NULL) AND (ulg.city_id IS NULL)'
 || ' AND lal3.matched AND (lal3.city_ar IS NOT NULL) AND (lal3.region_ar IS NOT NULL)'
 || ' AND (lal3.source_table = v1.source_table) AND (lal3.listing_id = v1.listing_id))'
 || ' HAVING (count(DISTINCT cc3.city_id) = 1)) ulg2 ON (true))'
 || ' LEFT JOIN loc_catalog_city ulg2c ON ((ulg2c.city_id = ulg2.city_id)))'
 || ' LEFT JOIN loc_catalog_region ulg2r ON ((ulg2r.region_id = ulg2c.region_id)))';

  v_new := replace(v_def,
      'FROM (((((((((((((listing_native_location_v1 v1',
      'FROM ((((((((((((((((listing_native_location_v1 v1');

  v_new := replace(v_new,
      'HAVING (count(DISTINCT cc2.city_id) = 1)) ulg ON (true))',
      'HAVING (count(DISTINCT cc2.city_id) = 1)) ulg ON (true))' || v_lateral);

  v_new := replace(v_new,
      'COALESCE(v1.city_id, uali.city_id, ulg.city_id, uc.city_id)',
      'COALESCE(v1.city_id, uali.city_id, ulg.city_id, ulg2.city_id, uc.city_id)');

  v_new := replace(v_new,
      'COALESCE(v1.region_id, uac.region_id, ulgc.region_id, uc.region_id)',
      'COALESCE(v1.region_id, uac.region_id, ulgc.region_id, ulg2c.region_id, uc.region_id)');

  v_new := replace(v_new,
      'COALESCE(v1.region_ar, uar.region_ar, ulgr.region_ar, ur.region_ar)',
      'COALESCE(v1.region_ar, uar.region_ar, ulgr.region_ar, ulg2r.region_ar, ur.region_ar)');

  execute 'CREATE OR REPLACE VIEW public.listing_native_location_v2 AS ' || v_new;
end
$mig$;
