-- deep-location-matching-audit 2026-08-04.
-- listing_native_location_v1 is a MATERIALIZED VIEW (relkind='m', hourly-refreshed by cron
-- jobid 17). Postgres has no CREATE OR REPLACE MATERIALIZED VIEW, so this is DROP CASCADE +
-- rebuild. CASCADE blast radius confirmed via recursive pg_depend walk (and Postgres's own
-- dependency error) to be exactly: listing_native_location_v1 (matview) -> listing_native_
-- location_v2, platforms_unsearchable, platforms_deprecated_status, mon_search_index_city_drift
-- (all plain views, all recreated here BYTE-IDENTICAL to their live pg_get_viewdef() output --
-- v1's output columns/types/order are unchanged, only its internal WHERE/CASE/UNION logic
-- changed, so none of the 4 dependents need any edit). Grants are unaffected: this project uses
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public (confirmed via pg_default_acl), so anon/authenticated/
-- service_role automatically get the same privileges on the recreated objects.
--
-- (1) satel_residential/commercial_listings were missing from the "native" CTE entirely, so
--     satel fell through to the generic listings_arabic_locations staging path, which never
--     carries additional_info->>'district_ar' forward even though the scraper already writes a
--     correct, catalog-attested Arabic district there. Adds satel as a native branch (city_id/
--     region_id derived from additional_info->>'city_ar' via loc_catalog_city, same pattern
--     wasalt already uses inline). Verified pre-apply: satel district coverage 83->115 (city
--     unchanged at 216, no regression).
-- (2) "غير محدد" ("unspecified") is a placeholder sentinel (scrapers/common/placeholder_tokens.py
--     PLACEHOLDER_TOKENS), not a real district name, but the COALESCE fallback to
--     listings_arabic_locations.district_ar had no exclusion for it -> it leaked through as a
--     displayed district on 68 live rows in this matview. Both district_ar sources now guarded.
--     Verified pre-apply: aqargate district_matched 297->289 (8 fake matches -> honest NULL).

DROP MATERIALIZED VIEW public.listing_native_location_v1 CASCADE;

CREATE MATERIALIZED VIEW public.listing_native_location_v1 AS
 WITH native AS (
         SELECT 'alhoshan'::text AS platform,
            'alhoshan_residential_listings'::text AS source_table,
            alhoshan_residential_listings.id AS listing_id,
            alhoshan_residential_listings.city_ar,
            alhoshan_residential_listings.city_id,
            alhoshan_residential_listings.district_ar,
            alhoshan_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            alhoshan_residential_listings.transaction_type
           FROM alhoshan_residential_listings
          WHERE alhoshan_residential_listings.active
        UNION ALL
         SELECT 'alhoshan'::text,
            'alhoshan_commercial_listings'::text,
            alhoshan_commercial_listings.id,
            alhoshan_commercial_listings.city_ar,
            alhoshan_commercial_listings.city_id,
            alhoshan_commercial_listings.district_ar,
            alhoshan_commercial_listings.region_id,
            'native_scraper'::text,
            alhoshan_commercial_listings.transaction_type
           FROM alhoshan_commercial_listings
          WHERE alhoshan_commercial_listings.active
        UNION ALL
         SELECT 'aldarim'::text,
            'aldarim_residential_listings'::text,
            aldarim_residential_listings.id,
            aldarim_residential_listings.city_ar,
            aldarim_residential_listings.city_id,
            aldarim_residential_listings.district_ar,
            aldarim_residential_listings.region_id,
            'native_scraper'::text,
            aldarim_residential_listings.transaction_type
           FROM aldarim_residential_listings
          WHERE aldarim_residential_listings.active
        UNION ALL
         SELECT 'aldarim'::text,
            'aldarim_commercial_listings'::text,
            aldarim_commercial_listings.id,
            aldarim_commercial_listings.city_ar,
            aldarim_commercial_listings.city_id,
            aldarim_commercial_listings.district_ar,
            aldarim_commercial_listings.region_id,
            'native_scraper'::text,
            aldarim_commercial_listings.transaction_type
           FROM aldarim_commercial_listings
          WHERE aldarim_commercial_listings.active
        UNION ALL
         SELECT 'aqarmonthly'::text,
            'aqarmonthly_residential_listings'::text,
            aqarmonthly_residential_listings.id,
            aqarmonthly_residential_listings.city_ar,
            aqarmonthly_residential_listings.city_id,
            aqarmonthly_residential_listings.district_ar,
            aqarmonthly_residential_listings.region_id,
            'native_scraper'::text,
            aqarmonthly_residential_listings.transaction_type
           FROM aqarmonthly_residential_listings
          WHERE aqarmonthly_residential_listings.active
        UNION ALL
         SELECT 'aqargate'::text,
            'aqargate_residential_listings'::text,
            aqargate_residential_listings.id,
            aqargate_residential_listings.city_ar,
            aqargate_residential_listings.city_id,
            aqargate_residential_listings.district_ar,
            aqargate_residential_listings.region_id,
            'native_scraper'::text,
            aqargate_residential_listings.transaction_type
           FROM aqargate_residential_listings
          WHERE aqargate_residential_listings.active
        UNION ALL
         SELECT 'aqargate'::text,
            'aqargate_commercial_listings'::text,
            aqargate_commercial_listings.id,
            aqargate_commercial_listings.city_ar,
            aqargate_commercial_listings.city_id,
            aqargate_commercial_listings.district_ar,
            aqargate_commercial_listings.region_id,
            'native_scraper'::text,
            aqargate_commercial_listings.transaction_type
           FROM aqargate_commercial_listings
          WHERE aqargate_commercial_listings.active
        UNION ALL
         SELECT 'sanadak'::text,
            'sanadak_residential_listings'::text,
            sanadak_residential_listings.id,
            sanadak_residential_listings.city_ar,
            sanadak_residential_listings.city_id,
            sanadak_residential_listings.district_ar,
            sanadak_residential_listings.region_id,
            'native_scraper'::text,
            sanadak_residential_listings.transaction_type
           FROM sanadak_residential_listings
          WHERE sanadak_residential_listings.active
        UNION ALL
         SELECT 'sanadak'::text,
            'sanadak_commercial_listings'::text,
            sanadak_commercial_listings.id,
            sanadak_commercial_listings.city_ar,
            sanadak_commercial_listings.city_id,
            sanadak_commercial_listings.district_ar,
            sanadak_commercial_listings.region_id,
            'native_scraper'::text,
            sanadak_commercial_listings.transaction_type
           FROM sanadak_commercial_listings
          WHERE sanadak_commercial_listings.active
        UNION ALL
         SELECT 'hajer'::text,
            'hajer_residential_listings'::text,
            hajer_residential_listings.id,
            hajer_residential_listings.city_ar,
            hajer_residential_listings.city_id,
            hajer_residential_listings.district_ar,
            hajer_residential_listings.region_id,
            'native_scraper'::text,
            hajer_residential_listings.transaction_type
           FROM hajer_residential_listings
          WHERE hajer_residential_listings.active
        UNION ALL
         SELECT 'hajer'::text,
            'hajer_commercial_listings'::text,
            hajer_commercial_listings.id,
            hajer_commercial_listings.city_ar,
            hajer_commercial_listings.city_id,
            hajer_commercial_listings.district_ar,
            hajer_commercial_listings.region_id,
            'native_scraper'::text,
            hajer_commercial_listings.transaction_type
           FROM hajer_commercial_listings
          WHERE hajer_commercial_listings.active
        UNION ALL
         SELECT 'wasalt'::text,
            'wasalt_residential_listings'::text,
            w.id,
            w.city_ar,
            ( SELECT cc.city_id
                   FROM loc_catalog_city cc
                  WHERE cc.city_norm = normalize_ar(w.city_ar) AND (w.region_id IS NULL OR cc.region_id = w.region_id)
                 LIMIT 1) AS city_id,
            w.district_ar,
            w.region_id,
            'native_scraper'::text,
            w.transaction_type
           FROM wasalt_residential_listings w
          WHERE w.active AND w.ar_fetched
        UNION ALL
         SELECT 'wasalt'::text,
            'wasalt_commercial_listings'::text,
            w.id,
            w.city_ar,
            ( SELECT cc.city_id
                   FROM loc_catalog_city cc
                  WHERE cc.city_norm = normalize_ar(w.city_ar) AND (w.region_id IS NULL OR cc.region_id = w.region_id)
                 LIMIT 1) AS city_id,
            w.district_ar,
            w.region_id,
            'native_scraper'::text,
            w.transaction_type
           FROM wasalt_commercial_listings w
          WHERE w.active AND w.ar_fetched
        UNION ALL
         SELECT 'aqar'::text,
            'aqar_residential_listings'::text,
            a.id,
            s.city_ar_parsed,
            s.parsed_city_id,
            NULL::text AS text,
            c.region_id,
            'aqar_parser'::text,
            a.transaction_type
           FROM aqar_residential_listings a
             JOIN aqar_shadow_resolved s ON s.id = a.id
             LEFT JOIN loc_catalog_city c ON c.city_id = s.parsed_city_id
          WHERE a.active AND s.parsed_city_id IS NOT NULL
        UNION ALL
         SELECT 'aqar'::text,
            'aqar_commercial_listings'::text,
            a.id,
            s.city_ar_parsed,
            s.parsed_city_id,
            NULL::text AS text,
            c.region_id,
            'aqar_parser'::text,
            a.transaction_type
           FROM aqar_commercial_listings a
             JOIN aqar_shadow_resolved s ON s.id = a.id
             LEFT JOIN loc_catalog_city c ON c.city_id = s.parsed_city_id
          WHERE a.active AND s.parsed_city_id IS NOT NULL
        UNION ALL
         SELECT p.platform,
            p.source_table,
            p.listing_id,
            p.city_ar_src,
            p.city_id,
            NULL::text AS text,
            p.region_id,
            'phasea'::text,
            NULL::text AS text
           FROM phasea_shadow_resolution p
          WHERE p.city_id IS NOT NULL
        UNION ALL
         SELECT 'satel'::text,
            'satel_residential_listings'::text,
            s.id,
            s.additional_info ->> 'city_ar'::text,
            ( SELECT cc.city_id FROM loc_catalog_city cc
               WHERE cc.city_norm = normalize_ar(s.additional_info ->> 'city_ar'::text)
               LIMIT 1) AS city_id,
            s.additional_info ->> 'district_ar'::text,
            ( SELECT cc.region_id FROM loc_catalog_city cc
               WHERE cc.city_norm = normalize_ar(s.additional_info ->> 'city_ar'::text)
               LIMIT 1) AS region_id,
            'native_scraper'::text,
            s.transaction_type
           FROM satel_residential_listings s
          WHERE s.active
        UNION ALL
         SELECT 'satel'::text,
            'satel_commercial_listings'::text,
            s.id,
            s.additional_info ->> 'city_ar'::text,
            ( SELECT cc.city_id FROM loc_catalog_city cc
               WHERE cc.city_norm = normalize_ar(s.additional_info ->> 'city_ar'::text)
               LIMIT 1) AS city_id,
            s.additional_info ->> 'district_ar'::text,
            ( SELECT cc.region_id FROM loc_catalog_city cc
               WHERE cc.city_norm = normalize_ar(s.additional_info ->> 'city_ar'::text)
               LIMIT 1) AS region_id,
            'native_scraper'::text,
            s.transaction_type
           FROM satel_commercial_listings s
          WHERE s.active
        ), legacy AS (
         SELECT lal_1.platform,
            lal_1.source_table,
            lal_1.listing_id,
            lal_1.city_ar,
            cc.city_id,
            lal_1.district_ar,
            cc.region_id,
            'legacy_derived'::text AS source_method,
            NULL::text AS transaction_type
           FROM listings_arabic_locations lal_1
             LEFT JOIN loc_catalog_city cc ON cc.city_norm = normalize_ar(lal_1.city_ar)
          WHERE lal_1.city_ar IS NOT NULL
        ), ranked AS (
         SELECT native.platform,
            native.source_table,
            native.listing_id,
            native.city_ar,
            native.city_id,
            native.district_ar,
            native.region_id,
            native.source_method,
            native.transaction_type,
            1 AS priority
           FROM native
        UNION ALL
         SELECT legacy.platform,
            legacy.source_table,
            legacy.listing_id,
            legacy.city_ar,
            legacy.city_id,
            legacy.district_ar,
            legacy.region_id,
            legacy.source_method,
            legacy.transaction_type,
            2 AS priority
           FROM legacy
        ), best AS (
         SELECT DISTINCT ON (ranked.platform, ranked.listing_id) ranked.platform,
            ranked.source_table,
            ranked.listing_id,
            ranked.city_ar,
            ranked.city_id,
            ranked.district_ar,
            ranked.region_id,
            ranked.source_method,
            ranked.transaction_type,
            ranked.priority
           FROM ranked
          ORDER BY ranked.platform, ranked.listing_id, ranked.priority
        )
 SELECT b.platform,
    b.source_table,
    b.listing_id,
    COALESCE(b.transaction_type,
        CASE lower(llc.purpose)
            WHEN 'buy'::text THEN 'Buy'::text
            WHEN 'rent'::text THEN 'Rent'::text
            ELSE NULL::text
        END) AS transaction_type,
    b.region_id,
    b.city_id,
    b.city_ar,
    COALESCE(
        CASE WHEN btrim(b.district_ar) IN ('', 'غير محدد', 'اخرى', 'أخرى') THEN NULL ELSE btrim(b.district_ar) END,
        CASE WHEN btrim(lal.district_ar) IN ('', 'غير محدد', 'اخرى', 'أخرى') THEN NULL ELSE btrim(lal.district_ar) END
    ) AS district_ar,
    cr.region_ar,
    b.source_method,
    b.region_id IS NOT NULL AND b.city_id IS NOT NULL AS production_ready,
    llc.last_updated
   FROM best b
     LEFT JOIN listings_arabic_locations lal ON lal.platform = b.platform AND lal.listing_id = b.listing_id
     LEFT JOIN listing_location_canonical llc ON llc.platform = b.platform AND llc.listing_id = b.listing_id
     LEFT JOIN loc_catalog_region cr ON cr.region_id = b.region_id
WITH DATA;

CREATE UNIQUE INDEX lnl_v1_pk ON public.listing_native_location_v1 USING btree (platform, listing_id);
CREATE INDEX idx_lnl_v1_norm_city_purpose ON public.listing_native_location_v1 USING btree (normalize_ar(city_ar), lower(transaction_type), last_updated DESC NULLS LAST) WHERE production_ready;
CREATE INDEX lnl_v1_city_purpose ON public.listing_native_location_v1 USING btree (city_ar, transaction_type, last_updated DESC NULLS LAST);
CREATE INDEX lnl_v1_district ON public.listing_native_location_v1 USING btree (district_ar, last_updated DESC NULLS LAST);
CREATE INDEX lnl_v1_region_ready ON public.listing_native_location_v1 USING btree (region_id, transaction_type, last_updated DESC NULLS LAST) WHERE production_ready;
CREATE INDEX lnl_v1_platform_updated ON public.listing_native_location_v1 USING btree (platform, last_updated DESC NULLS LAST);
CREATE INDEX lnl_v1_source_table ON public.listing_native_location_v1 USING btree (source_table);

-- Recreated byte-identical to the pre-drop pg_get_viewdef() output (v1's output shape unchanged).
CREATE VIEW public.listing_native_location_v2 AS
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
  WHERE s.active = true
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
  WHERE s.active = true
UNION ALL
 SELECT regexp_replace(a.source_table, '_(residential|commercial)_listings$'::text, ''::text) AS platform,
    a.source_table,
    a.listing_id,
    a.transaction_type,
    NULL::integer AS region_id,
    NULL::integer AS city_id,
    NULL::text AS city_ar,
    NULL::text AS district_ar,
    NULL::text AS region_ar,
    'unresolved_catchall'::text AS source_method,
    false AS production_ready,
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
  WHERE (a.source_table <> ALL (ARRAY['souq24_residential_listings'::text, 'souq24_commercial_listings'::text])) AND NOT (EXISTS ( SELECT 1
           FROM listing_native_location_v1 v1
          WHERE v1.source_table = a.source_table AND v1.listing_id = a.listing_id));

CREATE VIEW public.platforms_unsearchable AS
 WITH source_platforms AS (
         SELECT DISTINCT regexp_replace(tables.table_name::text, '_(residential|commercial)_listings$'::text, ''::text) AS platform_name,
            array_agg(tables.table_name ORDER BY tables.table_name) AS source_tables
           FROM information_schema.tables
          WHERE tables.table_schema::name = 'public'::name AND tables.table_name::name ~ '_(residential|commercial)_listings$'::text AND (tables.table_name::name <> ALL (ARRAY['listings'::name, 'listings_legacy'::name, 'listings_arabic_locations'::name]))
          GROUP BY (regexp_replace(tables.table_name::text, '_(residential|commercial)_listings$'::text, ''::text))
        ), indexed_platforms AS (
         SELECT DISTINCT listing_native_location_v2.platform AS platform_name
           FROM listing_native_location_v2
        )
 SELECT s.platform_name,
    s.source_tables,
    'Platform has source tables but is NOT in listing_native_location_v2 — listings are invisible to Filter + AI Agent. Add it to v2 before declaring the platform complete.'::text AS reason
   FROM source_platforms s
     LEFT JOIN indexed_platforms i ON i.platform_name = s.platform_name
  WHERE i.platform_name IS NULL AND NOT (s.platform_name IN ( SELECT deprecated_platforms.platform
           FROM deprecated_platforms))
  ORDER BY s.platform_name;

CREATE VIEW public.platforms_deprecated_status AS
 SELECT platform,
    reason,
    deprecated_at,
    COALESCE(( SELECT sum(x.c) AS sum
           FROM ( SELECT count(*) AS c
                   FROM deal_residential_listings
                  WHERE d.platform = 'deal'::text
                UNION ALL
                 SELECT count(*) AS count
                   FROM deal_commercial_listings
                  WHERE d.platform = 'deal'::text) x), 0::numeric) AS rows_retained,
    (platform IN ( SELECT listing_native_location_v2.platform
           FROM listing_native_location_v2)) AS still_in_search
   FROM deprecated_platforms d;

CREATE VIEW public.mon_search_index_city_drift AS
 SELECT s.source_table,
    s.listing_id,
    s.city_id AS index_city_id,
    n.city_id AS resolved_city_id,
    s.region_id AS index_region_id,
    n.region_id AS resolved_region_id
   FROM search_listings_ar s
     JOIN listing_native_location_v2 n USING (source_table, listing_id)
  WHERE s.city_id IS NOT NULL AND n.city_id IS NOT NULL AND s.city_id <> n.city_id OR s.region_id IS NOT NULL AND n.region_id IS NOT NULL AND s.region_id <> n.region_id;
