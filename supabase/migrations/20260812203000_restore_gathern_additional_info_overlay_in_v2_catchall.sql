-- Restore gathern additional_info city/region overlay that the Aug-9 dealapp_live_location_overlay
-- migration (20260809154124) silently dropped when it did a full CREATE OR REPLACE VIEW on
-- listing_native_location_v2 built from a stale pre-Aug-4 snapshot of the view. That clobbered the
-- `gth` LATERAL added by 20260804165900_gathern_city_region_overlay_v2_catchall_arm.sql, which read
-- scrapers/gathern/run.py's already-computed, catalog-attested additional_info->>'resolved_city_id'
-- (gated on resolved_confidence='city', never a guess) for gathern rows landing in the catchall arm.
--
-- Effect of the regression: every gathern row relying on that overlay silently reverted to
-- source_method='unresolved_catchall' / production_ready=false, even though scrapers/gathern had
-- already resolved a real, single, catalog-attested city for them. Root-caused via issue #460
-- (quarantine_growth:gathern) -- verified 70 of 84 currently-unready gathern rows carry a
-- resolved_confidence='city' tag in additional_info that this view was ignoring.
--
-- Fix: needle-edit the CURRENT LIVE view definition (fetched via pg_get_viewdef immediately before
-- writing this, per the RPC/view full-body-replace hazard rule) -- add the gathern `gth` LATERAL
-- back into the catchall arm alongside the dealapp `lalc` overlay, COALESCE'd together. The two are
-- mutually exclusive (lalc only matches dealapp source_tables, gth only matches gathern source_tables)
-- so this is additive with zero behavior change for every other platform in the catchall arm, and
-- zero behavior change for the v1/souq24 arms above (copied verbatim, untouched).
CREATE OR REPLACE VIEW public.listing_native_location_v2 AS
 SELECT v1.platform,
    v1.source_table,
    v1.listing_id,
    COALESCE(a.transaction_type, v1.transaction_type) AS transaction_type,
    COALESCE(v1.region_id, uac.region_id, uc.region_id) AS region_id,
    COALESCE(v1.city_id, uali.city_id, uc.city_id) AS city_id,
    COALESCE(v1.city_ar, uc.city_ar) AS city_ar,
    COALESCE(v1.district_ar, dr.district_ar) AS district_ar,
    COALESCE(v1.region_ar, uar.region_ar, ur.region_ar) AS region_ar,
    v1.source_method,
    COALESCE(v1.region_id, uac.region_id, uc.region_id) IS NOT NULL AND COALESCE(v1.city_id, uali.city_id, uc.city_id) IS NOT NULL AS production_ready,
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
          WHERE v1.city_ar IS NULL AND v1.city_id IS NULL AND v1.region_id IS NULL AND v1.district_ar IS NOT NULL AND d.district_norm = normalize_ar(v1.district_ar)
         HAVING count(DISTINCT d.city_id) = 1) udid ON true
     LEFT JOIN LATERAL ( SELECT a2.city_id
           FROM loc_catalog_city_alias a2
          WHERE v1.city_id IS NULL AND v1.city_ar IS NOT NULL AND a2.alias_norm = normalize_ar(v1.city_ar)
         LIMIT 1) uali ON true
     LEFT JOIN loc_catalog_city uac ON uac.city_id = uali.city_id
     LEFT JOIN loc_catalog_region uar ON uar.region_id = uac.region_id
     LEFT JOIN loc_catalog_city uc ON uc.city_id = udid.city_id
     LEFT JOIN loc_catalog_region ur ON ur.region_id = uc.region_id
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
    NULL::text AS direction,
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
    NULL::text AS direction,
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
    COALESCE(lalc.region_id, gth.region_id) AS region_id,
    COALESCE(lalc.city_id, gth.city_id) AS city_id,
    COALESCE(lalc.city_ar, gcat.city_ar) AS city_ar,
    NULL::text AS district_ar,
    COALESCE(lalc.region_ar, gcr2.region_ar) AS region_ar,
        CASE
            WHEN lalc.city_id IS NOT NULL THEN 'lal_live_overlay'::text
            WHEN gth.city_id IS NOT NULL THEN 'gathern_additional_info_overlay'::text
            ELSE 'unresolved_catchall'::text
        END AS source_method,
    (COALESCE(lalc.city_id, gth.city_id) IS NOT NULL AND COALESCE(lalc.region_id, gth.region_id) IS NOT NULL) AS production_ready,
    NULL::timestamp with time zone AS last_updated,
    a.property_type,
    a.price_total,
    a.price_annual,
    a.price_per_meter,
    a.area_m2,
    a.bedrooms,
    a.bathrooms,
    a.rent_period,
    NULL::boolean AS furnished,
    NULL::smallint AS property_age,
    NULL::text AS direction,
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
   FROM active_listing_ids_v2 a
     LEFT JOIN LATERAL ( SELECT min(lc.city_id) AS city_id,
            min(lc.region_id) AS region_id,
            min(l.city_ar) AS city_ar,
            min(cr.region_ar) AS region_ar
           FROM listings_arabic_locations l
             JOIN loc_catalog_city lc ON lc.city_norm = normalize_ar(l.city_ar)
             LEFT JOIN loc_catalog_region cr ON cr.region_id = lc.region_id
          WHERE l.source_table = a.source_table AND l.listing_id = a.listing_id AND (a.source_table = ANY (ARRAY['dealapp_residential_listings'::text, 'dealapp_commercial_listings'::text])) AND l.matched IS TRUE AND l.city_ar IS NOT NULL
         HAVING count(DISTINCT lc.city_id) = 1) lalc ON true
     LEFT JOIN LATERAL ( SELECT
            (g.additional_info ->> 'resolved_city_id'::text)::integer AS city_id,
            (g.additional_info ->> 'resolved_region_id'::text)::integer AS region_id
           FROM gathern_residential_listings g
          WHERE a.source_table = 'gathern_residential_listings'::text
            AND g.id = a.listing_id
            AND g.additional_info ->> 'resolved_confidence'::text = 'city'::text
        UNION ALL
         SELECT
            (g.additional_info ->> 'resolved_city_id'::text)::integer,
            (g.additional_info ->> 'resolved_region_id'::text)::integer
           FROM gathern_commercial_listings g
          WHERE a.source_table = 'gathern_commercial_listings'::text
            AND g.id = a.listing_id
            AND g.additional_info ->> 'resolved_confidence'::text = 'city'::text
        ) gth ON true
     LEFT JOIN loc_catalog_city gcat ON gcat.city_id = gth.city_id
     LEFT JOIN loc_catalog_region gcr2 ON gcr2.region_id = gth.region_id
  WHERE (a.source_table <> ALL (ARRAY['souq24_residential_listings'::text, 'souq24_commercial_listings'::text])) AND NOT (EXISTS ( SELECT 1
           FROM listing_native_location_v1 v1
          WHERE v1.source_table = a.source_table AND v1.listing_id = a.listing_id));
