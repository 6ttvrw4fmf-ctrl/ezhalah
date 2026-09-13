-- amlakalahsa was registered into every OTHER platform-list this session touched tonight
-- (SEARCHABLE_TABLES, liveness_policies.py, absence-only-prune.txt, RLS policies, ADDL_FIELDS) but
-- was never added to listing_extra_attrs -- a UNION-ALL-per-platform view feeding street_width_m/
-- direction/floor_number/tenant_category into listing_native_location_v2 -> search_listings_ar ->
-- apartment_guided_counts_ar, i.e. every Advanced Filter guided-question count (street width,
-- direction, etc). Its raw street_width_m column has been correct in production all along; this
-- view just never surfaced it, so AF silently found 0 known rows for any cohort street_width could
-- narrow, failed the meaningful-narrowing test trivially (offersMeaningfulNarrowing in
-- src/lib/afRanking.ts), and never offered the question -- exactly the owner-reported symptom:
-- الجفر, أرض سكنية (residential land) -- AF asked property type, then jumped straight to full
-- results with no street-width follow-up, even though 87 rows there genuinely split 87/18/10/10
-- across the 15/20/25/30m rungs.
--
-- listing_extra_attrs' full CREATE OR REPLACE VIEW body is ~2,000 lines / 64KB (92 platform
-- branches) and repeatedly hit this connector's statement timeout when resubmitted whole (both via
-- apply_migration and execute_sql). Applied instead as three small statements, verified live after
-- each: (1) rename the existing view out of the way, (2) recreate the original name as a thin
-- wrapper (`SELECT * FROM <renamed> UNION ALL <2 new amlakalahsa branches>`, matching the exact
-- shape every other simple non-REGA platform branch already uses), (3) CREATE OR REPLACE
-- listing_native_location_v2 with byte-identical text so it rebinds its LEFT JOINs from the
-- renamed view to the new wrapper (a rename alone does not move an existing dependent's binding --
-- it has to be recreated to re-resolve the name). Recorded here as one migration since it is one
-- logical change; applied to production via execute_sql (not apply_migration, for the timeout
-- reason above) and mirrored here per the migration-mirror rule, with a matching row inserted into
-- supabase_migrations.schema_migrations at the same version.
--
-- Verified end-to-end after: search_listings_ar now carries street_width_m for all 262 amlakalahsa
-- rows (was 0); apartment_guided_counts_ar(p_deal:='بيع', p_cities:=['الجفر'],
-- p_types:=['أرض سكنية'], ...) now returns cnt_selected=87, cnt_stw15/20/25/30 = 87/18/10/10 (was
-- 0/0/0/0); live browser replay of the owner's exact steps now shows the interview committing
-- "وشارع ٢٠ م فأكثر" as a real second question, where it previously jumped straight to full results.

alter view public.listing_extra_attrs rename to listing_extra_attrs_v0;
create view public.listing_extra_attrs as
select * from public.listing_extra_attrs_v0
union all
select 'amlakalahsa_residential_listings'::text as source_table,
    x.id as listing_id,
    null::boolean as furnished,
    x.property_age,
    canon_direction_ar(x.direction) as direction,
    x.street_width_m,
    x.floor_number,
    x.tenant_category,
    null::text as license_number,
    x.elevator,
    x.parking,
    x.kitchen,
    x.air_conditioner,
    x.maid_room,
    x.driver_room,
    x.private_entrance
   from amlakalahsa_residential_listings x
  where x.active
union all
select 'amlakalahsa_commercial_listings'::text as source_table,
    x.id as listing_id,
    null::boolean as furnished,
    x.property_age,
    canon_direction_ar(x.direction) as direction,
    x.street_width_m,
    x.floor_number,
    x.tenant_category,
    null::text as license_number,
    x.elevator,
    x.parking,
    x.kitchen,
    x.air_conditioner,
    x.maid_room,
    x.driver_room,
    x.private_entrance
   from amlakalahsa_commercial_listings x
  where x.active;
create or replace view public.listing_native_location_v2 as
 SELECT v1.platform,
    v1.source_table,
    v1.listing_id,
    COALESCE(a.transaction_type, v1.transaction_type) AS transaction_type,
    COALESCE(v1.region_id, uac.region_id, ulgc.region_id, ulg2c.region_id, uc.region_id) AS region_id,
    COALESCE(v1.city_id, uali.city_id, ulg.city_id, ulg2.city_id, uc.city_id) AS city_id,
    COALESCE(v1.city_ar, uc.city_ar, ccl.city_ar) AS city_ar,
    COALESCE(v1.district_ar, dr.district_ar) AS district_ar,
    COALESCE(v1.region_ar, uar.region_ar, ulgr.region_ar, ulg2r.region_ar, ur.region_ar) AS region_ar,
    v1.source_method,
    COALESCE(v1.region_id, uac.region_id, ulgc.region_id, ulg2c.region_id, uc.region_id) IS NOT NULL AND COALESCE(v1.city_id, uali.city_id, ulg.city_id, ulg2.city_id, uc.city_id) IS NOT NULL AS production_ready,
    v1.last_updated,
    a.property_type,
    a.price_total,
    a.price_annual,
    a.price_per_meter,
    a.area_m2,
    a.bedrooms,
    a.bathrooms,
    a.rent_period,
    ea.furnished,
    ar.property_age,
    ea.direction,
    ea.street_width_m,
    ea.floor_number,
    ea.tenant_category,
    ea.license_number,
    ea.elevator,
    ea.parking,
    ea.kitchen,
    ea.air_conditioner,
    ea.maid_room,
    ea.driver_room,
    ea.private_entrance
   FROM listing_native_location_v1 v1
     JOIN active_listing_ids_v2 a ON a.source_table = v1.source_table AND a.listing_id = v1.listing_id
     LEFT JOIN listing_extra_attrs ea ON ea.source_table = v1.source_table AND ea.listing_id = v1.listing_id
     LEFT JOIN listing_age_resolved ar ON ar.source_table = v1.source_table AND ar.listing_id = v1.listing_id
     LEFT JOIN district_recovery dr ON dr.source_table = v1.source_table AND dr.listing_id = v1.listing_id
     LEFT JOIN LATERAL ( SELECT max(d.city_id) AS city_id
           FROM loc_catalog_district d
          WHERE (EXISTS ( SELECT 1
                   FROM ops_location_inference_flags f
                  WHERE f.name = 'district_only_city_inference'::text AND f.enabled)) AND v1.city_ar IS NULL AND v1.city_id IS NULL AND v1.region_id IS NULL AND v1.district_ar IS NOT NULL AND d.district_norm = normalize_ar(v1.district_ar)
         HAVING count(DISTINCT d.city_id) = 1) udid ON true
     LEFT JOIN LATERAL ( SELECT a2.city_id
           FROM loc_catalog_city_alias a2
          WHERE v1.city_id IS NULL AND v1.city_ar IS NOT NULL AND a2.alias_norm = normalize_ar(v1.city_ar)
         LIMIT 1) uali ON true
     LEFT JOIN LATERAL ( SELECT max(cc2.city_id) AS city_id
           FROM listings_arabic_locations lal2
             JOIN loc_catalog_city cc2 ON cc2.city_norm = normalize_ar(lal2.city_ar)
          WHERE v1.city_id IS NULL AND uali.city_id IS NULL AND lal2.matched AND lal2.city_ar IS NOT NULL AND lal2.source_table = v1.source_table AND lal2.listing_id = v1.listing_id
         HAVING count(DISTINCT cc2.city_id) = 1) ulg ON true
     LEFT JOIN LATERAL ( SELECT max(cc3.city_id) AS city_id
           FROM listings_arabic_locations lal3
             JOIN loc_catalog_region cr3 ON cr3.region_ar = lal3.region_ar
             JOIN loc_catalog_city cc3 ON cc3.city_norm = normalize_ar(lal3.city_ar) AND cc3.region_id = cr3.region_id
          WHERE v1.city_id IS NULL AND uali.city_id IS NULL AND ulg.city_id IS NULL AND lal3.matched AND lal3.city_ar IS NOT NULL AND lal3.region_ar IS NOT NULL AND lal3.source_table = v1.source_table AND lal3.listing_id = v1.listing_id
         HAVING count(DISTINCT cc3.city_id) = 1) ulg2 ON true
     LEFT JOIN loc_catalog_city ulg2c ON ulg2c.city_id = ulg2.city_id
     LEFT JOIN loc_catalog_region ulg2r ON ulg2r.region_id = ulg2c.region_id
     LEFT JOIN loc_catalog_city ulgc ON ulgc.city_id = ulg.city_id
     LEFT JOIN loc_catalog_region ulgr ON ulgr.region_id = ulgc.region_id
     LEFT JOIN loc_catalog_city uac ON uac.city_id = uali.city_id
     LEFT JOIN loc_catalog_region uar ON uar.region_id = uac.region_id
     LEFT JOIN loc_catalog_city uc ON uc.city_id = udid.city_id
     LEFT JOIN loc_catalog_region ur ON ur.region_id = uc.region_id
     LEFT JOIN LATERAL ( SELECT lcc.city_ar
           FROM loc_catalog_city lcc
          WHERE lcc.city_id = COALESCE(v1.city_id, uali.city_id, ulg.city_id, ulg2.city_id, uc.city_id)) ccl ON true
UNION ALL
 SELECT 'souq24'::text AS platform,
    'souq24_residential_listings'::text AS source_table,
    s.id AS listing_id,
    s.transaction_type,
    cc.region_id,
    cc.city_id,
    cm.city_ar,
    NULLIF(btrim(s.neighborhood), ''::text) AS district_ar,
    cm.region_ar,
    'inline_lookup'::text AS source_method,
    cc.region_id IS NOT NULL AND cc.city_id IS NOT NULL AS production_ready,
    s.last_seen_at AS last_updated,
    s.property_type,
    s.price_total,
    s.price_annual,
    s.price_per_meter,
    s.area_m2,
    s.bedrooms,
    s.bathrooms,
    s.rent_period,
    NULL::boolean AS furnished,
    ( SELECT ar.property_age
           FROM listing_age_resolved ar
          WHERE ar.source_table = 'souq24_residential_listings'::text AND ar.listing_id = s.id) AS property_age,
    ( SELECT ea.direction
           FROM listing_extra_attrs ea
          WHERE ea.source_table = 'souq24_residential_listings'::text AND ea.listing_id = s.id) AS direction,
    NULL::smallint AS street_width_m,
    NULL::integer AS floor_number,
    NULL::text AS tenant_category,
    NULL::text AS license_number,
    NULL::boolean AS elevator,
    NULL::boolean AS parking,
    NULL::boolean AS kitchen,
    NULL::boolean AS air_conditioner,
    NULL::boolean AS maid_room,
    NULL::boolean AS driver_room,
    NULL::boolean AS private_entrance
   FROM souq24_residential_listings s
     LEFT JOIN loc_city_map cm ON cm.city_key = lower(btrim(s.city))
     LEFT JOIN loc_catalog_region cr ON cr.region_ar = cm.region_ar
     LEFT JOIN LATERAL ( SELECT c2.city_id,
            c2.region_id
           FROM loc_catalog_city c2
          WHERE (normalize_ar(c2.city_ar) = normalize_ar(cm.city_ar) OR (EXISTS ( SELECT 1
                   FROM loc_catalog_city_alias al
                  WHERE al.alias_norm = normalize_ar(cm.city_ar) AND al.city_id = c2.city_id))) AND (cr.region_id IS NULL OR c2.region_id = cr.region_id)
          ORDER BY c2.city_id
         LIMIT 1) cc ON true
  WHERE s.active = true AND NOT (EXISTS ( SELECT 1
           FROM listing_native_location_v1 v1
             JOIN active_listing_ids_v2 a2 ON a2.source_table = v1.source_table AND a2.listing_id = v1.listing_id
          WHERE v1.source_table = 'souq24_residential_listings'::text AND v1.listing_id = s.id))
UNION ALL
 SELECT 'souq24'::text AS platform,
    'souq24_commercial_listings'::text AS source_table,
    s.id AS listing_id,
    s.transaction_type,
    cc.region_id,
    cc.city_id,
    cm.city_ar,
    NULLIF(btrim(s.neighborhood), ''::text) AS district_ar,
    cm.region_ar,
    'inline_lookup'::text AS source_method,
    cc.region_id IS NOT NULL AND cc.city_id IS NOT NULL AS production_ready,
    s.last_seen_at AS last_updated,
    s.property_type,
    s.price_total,
    s.price_annual,
    s.price_per_meter,
    s.area_m2,
    s.bedrooms,
    s.bathrooms,
    s.rent_period,
    NULL::boolean AS furnished,
    ( SELECT ar.property_age
           FROM listing_age_resolved ar
          WHERE ar.source_table = 'souq24_commercial_listings'::text AND ar.listing_id = s.id) AS property_age,
    ( SELECT ea.direction
           FROM listing_extra_attrs ea
          WHERE ea.source_table = 'souq24_commercial_listings'::text AND ea.listing_id = s.id) AS direction,
    NULL::smallint AS street_width_m,
    NULL::integer AS floor_number,
    NULL::text AS tenant_category,
    NULL::text AS license_number,
    NULL::boolean AS elevator,
    NULL::boolean AS parking,
    NULL::boolean AS kitchen,
    NULL::boolean AS air_conditioner,
    NULL::boolean AS maid_room,
    NULL::boolean AS driver_room,
    NULL::boolean AS private_entrance
   FROM souq24_commercial_listings s
     LEFT JOIN loc_city_map cm ON cm.city_key = lower(btrim(s.city))
     LEFT JOIN loc_catalog_region cr ON cr.region_ar = cm.region_ar
     LEFT JOIN LATERAL ( SELECT c2.city_id,
            c2.region_id
           FROM loc_catalog_city c2
          WHERE (normalize_ar(c2.city_ar) = normalize_ar(cm.city_ar) OR (EXISTS ( SELECT 1
                   FROM loc_catalog_city_alias al
                  WHERE al.alias_norm = normalize_ar(cm.city_ar) AND al.city_id = c2.city_id))) AND (cr.region_id IS NULL OR c2.region_id = cr.region_id)
          ORDER BY c2.city_id
         LIMIT 1) cc ON true
  WHERE s.active = true AND NOT (EXISTS ( SELECT 1
           FROM listing_native_location_v1 v1
             JOIN active_listing_ids_v2 a2 ON a2.source_table = v1.source_table AND a2.listing_id = v1.listing_id
          WHERE v1.source_table = 'souq24_commercial_listings'::text AND v1.listing_id = s.id))
UNION ALL
 SELECT regexp_replace(a.source_table, '_(residential|commercial)_listings$'::text, ''::text) AS platform,
    a.source_table,
    a.listing_id,
    a.transaction_type,
    COALESCE(lalc.region_id, lalc2.region_id, gth.region_id) AS region_id,
    COALESCE(lalc.city_id, lalc2.city_id, gth.city_id) AS city_id,
    COALESCE(lalc.city_ar, lalc2.city_ar, gcat.city_ar) AS city_ar,
    gth.district_ar,
    COALESCE(lalc.region_ar, lalc2.region_ar, gcr2.region_ar) AS region_ar,
        CASE
            WHEN lalc.city_id IS NOT NULL THEN 'lal_live_overlay'::text
            WHEN lalc2.city_id IS NOT NULL THEN 'lal_region_scoped_overlay'::text
            WHEN gth.city_id IS NOT NULL THEN 'gathern_additional_info_overlay'::text
            ELSE 'unresolved_catchall'::text
        END AS source_method,
    COALESCE(lalc.city_id, lalc2.city_id, gth.city_id) IS NOT NULL AND COALESCE(lalc.region_id, lalc2.region_id, gth.region_id) IS NOT NULL AS production_ready,
    NULL::timestamp with time zone AS last_updated,
    a.property_type,
    a.price_total,
    a.price_annual,
    a.price_per_meter,
    a.area_m2,
    a.bedrooms,
    a.bathrooms,
    a.rent_period,
    cea.furnished,
    car.property_age,
    cea.direction,
    cea.street_width_m,
    cea.floor_number,
    cea.tenant_category,
    cea.license_number,
    cea.elevator,
    cea.parking,
    cea.kitchen,
    cea.air_conditioner,
    cea.maid_room,
    cea.driver_room,
    cea.private_entrance
   FROM active_listing_ids_v2 a
     LEFT JOIN listing_extra_attrs cea ON cea.source_table = a.source_table AND cea.listing_id = a.listing_id
     LEFT JOIN listing_age_resolved car ON car.source_table = a.source_table AND car.listing_id = a.listing_id
     LEFT JOIN LATERAL ( SELECT min(lc.city_id) AS city_id,
            min(lc.region_id) AS region_id,
            min(l.city_ar) AS city_ar,
            min(cr.region_ar) AS region_ar
           FROM listings_arabic_locations l
             JOIN loc_catalog_city lc ON lc.city_norm = normalize_ar(l.city_ar)
             LEFT JOIN loc_catalog_region cr ON cr.region_id = lc.region_id
          WHERE l.source_table = a.source_table AND l.listing_id = a.listing_id AND l.matched IS TRUE AND l.city_ar IS NOT NULL
         HAVING count(DISTINCT lc.city_id) = 1) lalc ON true
     LEFT JOIN LATERAL ( SELECT min(lc2.city_id) AS city_id,
            min(lc2.region_id) AS region_id,
            min(l2.city_ar) AS city_ar,
            min(cr2.region_ar) AS region_ar
           FROM listings_arabic_locations l2
             JOIN loc_catalog_region cr2 ON cr2.region_ar = l2.region_ar
             JOIN loc_catalog_city lc2 ON lc2.city_norm = normalize_ar(l2.city_ar) AND lc2.region_id = cr2.region_id
          WHERE lalc.city_id IS NULL AND l2.source_table = a.source_table AND l2.listing_id = a.listing_id AND l2.matched IS TRUE AND l2.city_ar IS NOT NULL AND l2.region_ar IS NOT NULL
         HAVING count(DISTINCT lc2.city_id) = 1) lalc2 ON true
     LEFT JOIN LATERAL ( SELECT (g.additional_info ->> 'resolved_city_id'::text)::integer AS city_id,
            (g.additional_info ->> 'resolved_region_id'::text)::integer AS region_id,
            resolve_district_ar((g.additional_info ->> 'resolved_city_id'::text)::integer, g.additional_info ->> 'district_ar'::text) AS district_ar
           FROM gathern_residential_listings g
          WHERE a.source_table = 'gathern_residential_listings'::text AND g.id = a.listing_id AND (g.additional_info ->> 'resolved_confidence'::text) = 'city'::text
        UNION ALL
         SELECT (g.additional_info ->> 'resolved_city_id'::text)::integer AS int4,
            (g.additional_info ->> 'resolved_region_id'::text)::integer AS int4,
            resolve_district_ar((g.additional_info ->> 'resolved_city_id'::text)::integer, g.additional_info ->> 'district_ar'::text) AS district_ar
           FROM gathern_commercial_listings g
          WHERE a.source_table = 'gathern_commercial_listings'::text AND g.id = a.listing_id AND (g.additional_info ->> 'resolved_confidence'::text) = 'city'::text) gth ON true
     LEFT JOIN loc_catalog_city gcat ON gcat.city_id = gth.city_id
     LEFT JOIN loc_catalog_region gcr2 ON gcr2.region_id = gth.region_id
  WHERE (a.source_table <> ALL (ARRAY['souq24_residential_listings'::text, 'souq24_commercial_listings'::text])) AND NOT (EXISTS ( SELECT 1
           FROM listing_native_location_v1 v1
          WHERE v1.source_table = a.source_table AND v1.listing_id = a.listing_id));
