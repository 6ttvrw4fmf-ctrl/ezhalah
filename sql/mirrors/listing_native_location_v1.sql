-- MIRROR of the LIVE production object (audit item 7f). NOT a migration — this
-- object is already applied in production and has no repo migration base.
-- Do not re-apply blindly; to change it, follow the RPC full-body-replace rule
-- (rebuild from pg_get_functiondef of the LIVE object, needle-edit, migrate).
-- Dumped byte-exact via anon REST on 2026-07-27; md5 (no trailing newline): e13dc823621d28ec62385c861de70d1f
-- pg_matviews.definition is the SELECT body only; the live object is:
-- CREATE MATERIALIZED VIEW public.listing_native_location_v1 AS <body below>
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
                  WHERE ((cc.city_norm = normalize_ar(w.city_ar)) AND ((w.region_id IS NULL) OR (cc.region_id = w.region_id)))
                 LIMIT 1) AS city_id,
            w.district_ar,
            w.region_id,
            'native_scraper'::text,
            w.transaction_type
           FROM wasalt_residential_listings w
          WHERE (w.active AND w.ar_fetched)
        UNION ALL
         SELECT 'wasalt'::text,
            'wasalt_commercial_listings'::text,
            w.id,
            w.city_ar,
            ( SELECT cc.city_id
                   FROM loc_catalog_city cc
                  WHERE ((cc.city_norm = normalize_ar(w.city_ar)) AND ((w.region_id IS NULL) OR (cc.region_id = w.region_id)))
                 LIMIT 1) AS city_id,
            w.district_ar,
            w.region_id,
            'native_scraper'::text,
            w.transaction_type
           FROM wasalt_commercial_listings w
          WHERE (w.active AND w.ar_fetched)
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
           FROM ((aqar_residential_listings a
             JOIN aqar_shadow_resolved s ON ((s.id = a.id)))
             LEFT JOIN loc_catalog_city c ON ((c.city_id = s.parsed_city_id)))
          WHERE (a.active AND (s.parsed_city_id IS NOT NULL))
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
           FROM ((aqar_commercial_listings a
             JOIN aqar_shadow_resolved s ON ((s.id = a.id)))
             LEFT JOIN loc_catalog_city c ON ((c.city_id = s.parsed_city_id)))
          WHERE (a.active AND (s.parsed_city_id IS NOT NULL))
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
          WHERE (p.city_id IS NOT NULL)
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
           FROM (listings_arabic_locations lal_1
             LEFT JOIN loc_catalog_city cc ON ((cc.city_norm = normalize_ar(lal_1.city_ar))))
          WHERE (lal_1.city_ar IS NOT NULL)
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
    COALESCE(NULLIF(btrim(b.district_ar), ''::text), NULLIF(btrim(lal.district_ar), ''::text)) AS district_ar,
    cr.region_ar,
    b.source_method,
    ((b.region_id IS NOT NULL) AND (b.city_id IS NOT NULL)) AS production_ready,
    llc.last_updated
   FROM (((best b
     LEFT JOIN listings_arabic_locations lal ON (((lal.platform = b.platform) AND (lal.listing_id = b.listing_id))))
     LEFT JOIN listing_location_canonical llc ON (((llc.platform = b.platform) AND (llc.listing_id = b.listing_id))))
     LEFT JOIN loc_catalog_region cr ON ((cr.region_id = b.region_id)));
