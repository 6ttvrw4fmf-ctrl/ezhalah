-- MIRROR of the LIVE production object (audit item 7f). NOT a migration — see the
-- full-body-replace rule. Regenerated verbatim from pg_get_viewdef(..., true).
--
-- Re-verified 2026-09-25 (migration 20260925012657_abaad_wiring_into_search):
-- CHANGED. Two arms were added right after the nufouth commercial arm — أبعاد (abaad),
-- residential + commercial — so the body below is genuinely new, not a re-dated copy.
--   The two arms were spliced into the previous body in the identical rendering
--   pg_get_viewdef produces for every other arm, and the result was then PROVEN equal to
--   production rather than assumed: md5 of the spliced body (trailing newline stripped, which is
--   how pg_get_viewdef returns it) == the live digest, over the same 94,952 chars. No 95 KB of
--   view text had to be shipped through a tool call to establish that.
--   • md5 of everything below this header block: 6a0c034c408d43d3f179bafef7f97a55
--     (as pg_get_viewdef returns it, i.e. the body minus the file's trailing newline — the same
--     convention the previous header used for 70d106fc, and the digest the migration registers)
--   Previous: 70d106fc0bd506b9bc69497f4ad0745b over 93,797 chars.
--   ops_sql_mirror_expected.expected_md5 is updated to the same digest in the SAME change
--   (regenerating a mirror is a two-place edit; verify-mirror-md5-is-registered enforces it).
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
         SELECT 'alhoshan'::text AS text,
            'alhoshan_commercial_listings'::text AS text,
            alhoshan_commercial_listings.id,
            alhoshan_commercial_listings.city_ar,
            alhoshan_commercial_listings.city_id,
            alhoshan_commercial_listings.district_ar,
            alhoshan_commercial_listings.region_id,
            'native_scraper'::text AS text,
            alhoshan_commercial_listings.transaction_type
           FROM alhoshan_commercial_listings
          WHERE alhoshan_commercial_listings.active
        UNION ALL
         SELECT 'aldarim'::text AS text,
            'aldarim_residential_listings'::text AS text,
            aldarim_residential_listings.id,
            aldarim_residential_listings.city_ar,
            aldarim_residential_listings.city_id,
            aldarim_residential_listings.district_ar,
            aldarim_residential_listings.region_id,
            'native_scraper'::text AS text,
            aldarim_residential_listings.transaction_type
           FROM aldarim_residential_listings
          WHERE aldarim_residential_listings.active
        UNION ALL
         SELECT 'aldarim'::text AS text,
            'aldarim_commercial_listings'::text AS text,
            aldarim_commercial_listings.id,
            aldarim_commercial_listings.city_ar,
            aldarim_commercial_listings.city_id,
            aldarim_commercial_listings.district_ar,
            aldarim_commercial_listings.region_id,
            'native_scraper'::text AS text,
            aldarim_commercial_listings.transaction_type
           FROM aldarim_commercial_listings
          WHERE aldarim_commercial_listings.active
        UNION ALL
         SELECT 'gudai'::text AS platform,
            'gudai_residential_listings'::text AS source_table,
            gudai_residential_listings.id AS listing_id,
            gudai_residential_listings.city_ar,
            gudai_residential_listings.city_id,
            gudai_residential_listings.district_ar,
            gudai_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            gudai_residential_listings.transaction_type
           FROM gudai_residential_listings
          WHERE gudai_residential_listings.active
        UNION ALL
         SELECT 'gudai'::text AS platform,
            'gudai_commercial_listings'::text AS source_table,
            gudai_commercial_listings.id AS listing_id,
            gudai_commercial_listings.city_ar,
            gudai_commercial_listings.city_id,
            gudai_commercial_listings.district_ar,
            gudai_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            gudai_commercial_listings.transaction_type
           FROM gudai_commercial_listings
          WHERE gudai_commercial_listings.active
        UNION ALL
         SELECT 'safera'::text AS platform,
            'safera_residential_listings'::text AS source_table,
            safera_residential_listings.id AS listing_id,
            safera_residential_listings.city_ar,
            safera_residential_listings.city_id,
            safera_residential_listings.district_ar,
            safera_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            safera_residential_listings.transaction_type
           FROM safera_residential_listings
          WHERE safera_residential_listings.active
        UNION ALL
         SELECT 'safera'::text AS platform,
            'safera_commercial_listings'::text AS source_table,
            safera_commercial_listings.id AS listing_id,
            safera_commercial_listings.city_ar,
            safera_commercial_listings.city_id,
            safera_commercial_listings.district_ar,
            safera_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            safera_commercial_listings.transaction_type
           FROM safera_commercial_listings
          WHERE safera_commercial_listings.active
        UNION ALL
         SELECT 'alhumaidan'::text AS platform,
            'alhumaidan_residential_listings'::text AS source_table,
            alhumaidan_residential_listings.id AS listing_id,
            alhumaidan_residential_listings.city_ar,
            alhumaidan_residential_listings.city_id,
            alhumaidan_residential_listings.district_ar,
            alhumaidan_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            alhumaidan_residential_listings.transaction_type
           FROM alhumaidan_residential_listings
          WHERE alhumaidan_residential_listings.active
        UNION ALL
         SELECT 'alhumaidan'::text AS platform,
            'alhumaidan_commercial_listings'::text AS source_table,
            alhumaidan_commercial_listings.id AS listing_id,
            alhumaidan_commercial_listings.city_ar,
            alhumaidan_commercial_listings.city_id,
            alhumaidan_commercial_listings.district_ar,
            alhumaidan_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            alhumaidan_commercial_listings.transaction_type
           FROM alhumaidan_commercial_listings
          WHERE alhumaidan_commercial_listings.active
        UNION ALL
         SELECT 'aqarnajran'::text AS platform,
            'aqarnajran_residential_listings'::text AS source_table,
            aqarnajran_residential_listings.id AS listing_id,
            aqarnajran_residential_listings.city_ar,
            aqarnajran_residential_listings.city_id,
            aqarnajran_residential_listings.district_ar,
            aqarnajran_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            aqarnajran_residential_listings.transaction_type
           FROM aqarnajran_residential_listings
          WHERE aqarnajran_residential_listings.active
        UNION ALL
         SELECT 'aqarnajran'::text AS platform,
            'aqarnajran_commercial_listings'::text AS source_table,
            aqarnajran_commercial_listings.id AS listing_id,
            aqarnajran_commercial_listings.city_ar,
            aqarnajran_commercial_listings.city_id,
            aqarnajran_commercial_listings.district_ar,
            aqarnajran_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            aqarnajran_commercial_listings.transaction_type
           FROM aqarnajran_commercial_listings
          WHERE aqarnajran_commercial_listings.active
        UNION ALL
         SELECT 'fahadalshahri'::text AS platform,
            'fahadalshahri_residential_listings'::text AS source_table,
            fahadalshahri_residential_listings.id AS listing_id,
            fahadalshahri_residential_listings.city_ar,
            fahadalshahri_residential_listings.city_id,
            fahadalshahri_residential_listings.district_ar,
            fahadalshahri_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            fahadalshahri_residential_listings.transaction_type
           FROM fahadalshahri_residential_listings
          WHERE fahadalshahri_residential_listings.active
        UNION ALL
         SELECT 'fahadalshahri'::text AS platform,
            'fahadalshahri_commercial_listings'::text AS source_table,
            fahadalshahri_commercial_listings.id AS listing_id,
            fahadalshahri_commercial_listings.city_ar,
            fahadalshahri_commercial_listings.city_id,
            fahadalshahri_commercial_listings.district_ar,
            fahadalshahri_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            fahadalshahri_commercial_listings.transaction_type
           FROM fahadalshahri_commercial_listings
          WHERE fahadalshahri_commercial_listings.active
        UNION ALL
         SELECT 'compoundin'::text AS platform,
            'compoundin_residential_listings'::text AS source_table,
            compoundin_residential_listings.id AS listing_id,
            compoundin_residential_listings.city_ar,
            compoundin_residential_listings.city_id,
            compoundin_residential_listings.district_ar,
            compoundin_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            compoundin_residential_listings.transaction_type
           FROM compoundin_residential_listings
          WHERE compoundin_residential_listings.active
        UNION ALL
         SELECT 'compoundin'::text AS platform,
            'compoundin_commercial_listings'::text AS source_table,
            compoundin_commercial_listings.id AS listing_id,
            compoundin_commercial_listings.city_ar,
            compoundin_commercial_listings.city_id,
            compoundin_commercial_listings.district_ar,
            compoundin_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            compoundin_commercial_listings.transaction_type
           FROM compoundin_commercial_listings
          WHERE compoundin_commercial_listings.active
        UNION ALL
         SELECT 'wslnaa'::text AS platform,
            'wslnaa_residential_listings'::text AS source_table,
            wslnaa_residential_listings.id AS listing_id,
            wslnaa_residential_listings.city_ar,
            wslnaa_residential_listings.city_id,
            wslnaa_residential_listings.district_ar,
            wslnaa_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            wslnaa_residential_listings.transaction_type
           FROM wslnaa_residential_listings
          WHERE wslnaa_residential_listings.active
        UNION ALL
         SELECT 'wslnaa'::text AS platform,
            'wslnaa_commercial_listings'::text AS source_table,
            wslnaa_commercial_listings.id AS listing_id,
            wslnaa_commercial_listings.city_ar,
            wslnaa_commercial_listings.city_id,
            wslnaa_commercial_listings.district_ar,
            wslnaa_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            wslnaa_commercial_listings.transaction_type
           FROM wslnaa_commercial_listings
          WHERE wslnaa_commercial_listings.active
        UNION ALL
         SELECT 'alsidra'::text AS platform,
            'alsidra_residential_listings'::text AS source_table,
            alsidra_residential_listings.id AS listing_id,
            alsidra_residential_listings.city_ar,
            alsidra_residential_listings.city_id,
            alsidra_residential_listings.district_ar,
            alsidra_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            alsidra_residential_listings.transaction_type
           FROM alsidra_residential_listings
          WHERE alsidra_residential_listings.active
        UNION ALL
         SELECT 'alsidra'::text AS platform,
            'alsidra_commercial_listings'::text AS source_table,
            alsidra_commercial_listings.id AS listing_id,
            alsidra_commercial_listings.city_ar,
            alsidra_commercial_listings.city_id,
            alsidra_commercial_listings.district_ar,
            alsidra_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            alsidra_commercial_listings.transaction_type
           FROM alsidra_commercial_listings
          WHERE alsidra_commercial_listings.active
        UNION ALL
         SELECT 'moftah'::text AS platform,
            'moftah_residential_listings'::text AS source_table,
            moftah_residential_listings.id AS listing_id,
            moftah_residential_listings.city_ar,
            moftah_residential_listings.city_id,
            moftah_residential_listings.district_ar,
            moftah_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            moftah_residential_listings.transaction_type
           FROM moftah_residential_listings
          WHERE moftah_residential_listings.active
        UNION ALL
         SELECT 'moftah'::text AS platform,
            'moftah_commercial_listings'::text AS source_table,
            moftah_commercial_listings.id AS listing_id,
            moftah_commercial_listings.city_ar,
            moftah_commercial_listings.city_id,
            moftah_commercial_listings.district_ar,
            moftah_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            moftah_commercial_listings.transaction_type
           FROM moftah_commercial_listings
          WHERE moftah_commercial_listings.active
        UNION ALL
         SELECT 'masar'::text AS platform,
            'masar_residential_listings'::text AS source_table,
            masar_residential_listings.id AS listing_id,
            masar_residential_listings.city_ar,
            masar_residential_listings.city_id,
            masar_residential_listings.district_ar,
            masar_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            masar_residential_listings.transaction_type
           FROM masar_residential_listings
          WHERE masar_residential_listings.active
        UNION ALL
         SELECT 'masar'::text AS platform,
            'masar_commercial_listings'::text AS source_table,
            masar_commercial_listings.id AS listing_id,
            masar_commercial_listings.city_ar,
            masar_commercial_listings.city_id,
            masar_commercial_listings.district_ar,
            masar_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            masar_commercial_listings.transaction_type
           FROM masar_commercial_listings
          WHERE masar_commercial_listings.active
        UNION ALL
         SELECT 'gomenassat'::text AS platform,
            'gomenassat_residential_listings'::text AS source_table,
            gomenassat_residential_listings.id AS listing_id,
            gomenassat_residential_listings.city_ar,
            gomenassat_residential_listings.city_id,
            gomenassat_residential_listings.district_ar,
            gomenassat_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            gomenassat_residential_listings.transaction_type
           FROM gomenassat_residential_listings
          WHERE gomenassat_residential_listings.active
        UNION ALL
         SELECT 'gomenassat'::text AS platform,
            'gomenassat_commercial_listings'::text AS source_table,
            gomenassat_commercial_listings.id AS listing_id,
            gomenassat_commercial_listings.city_ar,
            gomenassat_commercial_listings.city_id,
            gomenassat_commercial_listings.district_ar,
            gomenassat_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            gomenassat_commercial_listings.transaction_type
           FROM gomenassat_commercial_listings
          WHERE gomenassat_commercial_listings.active
        UNION ALL
         SELECT 'sakan'::text AS platform,
            'sakan_residential_listings'::text AS source_table,
            sakan_residential_listings.id AS listing_id,
            sakan_residential_listings.city_ar,
            sakan_residential_listings.city_id,
            sakan_residential_listings.district_ar,
            sakan_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            sakan_residential_listings.transaction_type
           FROM sakan_residential_listings
          WHERE sakan_residential_listings.active
        UNION ALL
         SELECT 'sakan'::text AS platform,
            'sakan_commercial_listings'::text AS source_table,
            sakan_commercial_listings.id AS listing_id,
            sakan_commercial_listings.city_ar,
            sakan_commercial_listings.city_id,
            sakan_commercial_listings.district_ar,
            sakan_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            sakan_commercial_listings.transaction_type
           FROM sakan_commercial_listings
          WHERE sakan_commercial_listings.active
        UNION ALL
         SELECT 'bossbih'::text AS platform,
            'bossbih_residential_listings'::text AS source_table,
            bossbih_residential_listings.id AS listing_id,
            bossbih_residential_listings.city_ar,
            bossbih_residential_listings.city_id,
            bossbih_residential_listings.district_ar,
            bossbih_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            bossbih_residential_listings.transaction_type
           FROM bossbih_residential_listings
          WHERE bossbih_residential_listings.active
        UNION ALL
         SELECT 'bossbih'::text AS platform,
            'bossbih_commercial_listings'::text AS source_table,
            bossbih_commercial_listings.id AS listing_id,
            bossbih_commercial_listings.city_ar,
            bossbih_commercial_listings.city_id,
            bossbih_commercial_listings.district_ar,
            bossbih_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            bossbih_commercial_listings.transaction_type
           FROM bossbih_commercial_listings
          WHERE bossbih_commercial_listings.active
        UNION ALL
         SELECT 'alshawaf'::text AS platform,
            'alshawaf_residential_listings'::text AS source_table,
            alshawaf_residential_listings.id AS listing_id,
            alshawaf_residential_listings.city_ar,
            alshawaf_residential_listings.city_id,
            alshawaf_residential_listings.district_ar,
            alshawaf_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            alshawaf_residential_listings.transaction_type
           FROM alshawaf_residential_listings
          WHERE alshawaf_residential_listings.active
        UNION ALL
         SELECT 'alshawaf'::text AS platform,
            'alshawaf_commercial_listings'::text AS source_table,
            alshawaf_commercial_listings.id AS listing_id,
            alshawaf_commercial_listings.city_ar,
            alshawaf_commercial_listings.city_id,
            alshawaf_commercial_listings.district_ar,
            alshawaf_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            alshawaf_commercial_listings.transaction_type
           FROM alshawaf_commercial_listings
          WHERE alshawaf_commercial_listings.active
        UNION ALL
         SELECT 'ialqarawi'::text AS platform,
            'ialqarawi_residential_listings'::text AS source_table,
            ialqarawi_residential_listings.id AS listing_id,
            ialqarawi_residential_listings.city_ar,
            ialqarawi_residential_listings.city_id,
            ialqarawi_residential_listings.district_ar,
            ialqarawi_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            ialqarawi_residential_listings.transaction_type
           FROM ialqarawi_residential_listings
          WHERE ialqarawi_residential_listings.active
        UNION ALL
         SELECT 'ialqarawi'::text AS platform,
            'ialqarawi_commercial_listings'::text AS source_table,
            ialqarawi_commercial_listings.id AS listing_id,
            ialqarawi_commercial_listings.city_ar,
            ialqarawi_commercial_listings.city_id,
            ialqarawi_commercial_listings.district_ar,
            ialqarawi_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            ialqarawi_commercial_listings.transaction_type
           FROM ialqarawi_commercial_listings
          WHERE ialqarawi_commercial_listings.active
        UNION ALL
         SELECT 'aljassim'::text AS platform,
            'aljassim_residential_listings'::text AS source_table,
            aljassim_residential_listings.id AS listing_id,
            aljassim_residential_listings.city_ar,
            aljassim_residential_listings.city_id,
            aljassim_residential_listings.district_ar,
            aljassim_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            aljassim_residential_listings.transaction_type
           FROM aljassim_residential_listings
          WHERE aljassim_residential_listings.active
        UNION ALL
         SELECT 'aljassim'::text AS platform,
            'aljassim_commercial_listings'::text AS source_table,
            aljassim_commercial_listings.id AS listing_id,
            aljassim_commercial_listings.city_ar,
            aljassim_commercial_listings.city_id,
            aljassim_commercial_listings.district_ar,
            aljassim_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            aljassim_commercial_listings.transaction_type
           FROM aljassim_commercial_listings
          WHERE aljassim_commercial_listings.active
        UNION ALL
         SELECT 'almotmkenah'::text AS platform,
            'almotmkenah_residential_listings'::text AS source_table,
            almotmkenah_residential_listings.id AS listing_id,
            almotmkenah_residential_listings.city_ar,
            almotmkenah_residential_listings.city_id,
            almotmkenah_residential_listings.district_ar,
            almotmkenah_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            almotmkenah_residential_listings.transaction_type
           FROM almotmkenah_residential_listings
          WHERE almotmkenah_residential_listings.active
        UNION ALL
         SELECT 'almotmkenah'::text AS platform,
            'almotmkenah_commercial_listings'::text AS source_table,
            almotmkenah_commercial_listings.id AS listing_id,
            almotmkenah_commercial_listings.city_ar,
            almotmkenah_commercial_listings.city_id,
            almotmkenah_commercial_listings.district_ar,
            almotmkenah_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            almotmkenah_commercial_listings.transaction_type
           FROM almotmkenah_commercial_listings
          WHERE almotmkenah_commercial_listings.active
        UNION ALL
         SELECT 'nufouth'::text AS platform,
            'nufouth_residential_listings'::text AS source_table,
            nufouth_residential_listings.id AS listing_id,
            nufouth_residential_listings.city_ar,
            nufouth_residential_listings.city_id,
            nufouth_residential_listings.district_ar,
            nufouth_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            nufouth_residential_listings.transaction_type
           FROM nufouth_residential_listings
          WHERE nufouth_residential_listings.active
        UNION ALL
         SELECT 'nufouth'::text AS platform,
            'nufouth_commercial_listings'::text AS source_table,
            nufouth_commercial_listings.id AS listing_id,
            nufouth_commercial_listings.city_ar,
            nufouth_commercial_listings.city_id,
            nufouth_commercial_listings.district_ar,
            nufouth_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            nufouth_commercial_listings.transaction_type
           FROM nufouth_commercial_listings
          WHERE nufouth_commercial_listings.active
        UNION ALL
         SELECT 'abaad'::text AS platform,
            'abaad_residential_listings'::text AS source_table,
            abaad_residential_listings.id AS listing_id,
            abaad_residential_listings.city_ar,
            abaad_residential_listings.city_id,
            abaad_residential_listings.district_ar,
            abaad_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            abaad_residential_listings.transaction_type
           FROM abaad_residential_listings
          WHERE abaad_residential_listings.active
        UNION ALL
         SELECT 'abaad'::text AS platform,
            'abaad_commercial_listings'::text AS source_table,
            abaad_commercial_listings.id AS listing_id,
            abaad_commercial_listings.city_ar,
            abaad_commercial_listings.city_id,
            abaad_commercial_listings.district_ar,
            abaad_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            abaad_commercial_listings.transaction_type
           FROM abaad_commercial_listings
          WHERE abaad_commercial_listings.active
        UNION ALL
         SELECT 'dwelleo'::text AS platform,
            'dwelleo_residential_listings'::text AS source_table,
            dwelleo_residential_listings.id AS listing_id,
            dwelleo_residential_listings.city_ar,
            dwelleo_residential_listings.city_id,
            dwelleo_residential_listings.district_ar,
            dwelleo_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            dwelleo_residential_listings.transaction_type
           FROM dwelleo_residential_listings
          WHERE dwelleo_residential_listings.active
        UNION ALL
         SELECT 'dwelleo'::text AS platform,
            'dwelleo_commercial_listings'::text AS source_table,
            dwelleo_commercial_listings.id AS listing_id,
            dwelleo_commercial_listings.city_ar,
            dwelleo_commercial_listings.city_id,
            dwelleo_commercial_listings.district_ar,
            dwelleo_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            dwelleo_commercial_listings.transaction_type
           FROM dwelleo_commercial_listings
          WHERE dwelleo_commercial_listings.active
        UNION ALL
         SELECT 'aqalemhajer'::text AS platform,
            'aqalemhajer_residential_listings'::text AS source_table,
            aqalemhajer_residential_listings.id AS listing_id,
            aqalemhajer_residential_listings.city_ar,
            aqalemhajer_residential_listings.city_id,
            aqalemhajer_residential_listings.district_ar,
            aqalemhajer_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            aqalemhajer_residential_listings.transaction_type
           FROM aqalemhajer_residential_listings
          WHERE aqalemhajer_residential_listings.active
        UNION ALL
         SELECT 'aqalemhajer'::text AS platform,
            'aqalemhajer_commercial_listings'::text AS source_table,
            aqalemhajer_commercial_listings.id AS listing_id,
            aqalemhajer_commercial_listings.city_ar,
            aqalemhajer_commercial_listings.city_id,
            aqalemhajer_commercial_listings.district_ar,
            aqalemhajer_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            aqalemhajer_commercial_listings.transaction_type
           FROM aqalemhajer_commercial_listings
          WHERE aqalemhajer_commercial_listings.active
        UNION ALL
         SELECT 'sakani'::text AS platform,
            'sakani_residential_listings'::text AS source_table,
            sakani_residential_listings.id AS listing_id,
            sakani_residential_listings.city_ar,
            sakani_residential_listings.city_id,
            sakani_residential_listings.district_ar,
            sakani_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            sakani_residential_listings.transaction_type
           FROM sakani_residential_listings
          WHERE sakani_residential_listings.active
        UNION ALL
         SELECT 'sakani'::text AS platform,
            'sakani_commercial_listings'::text AS source_table,
            sakani_commercial_listings.id AS listing_id,
            sakani_commercial_listings.city_ar,
            sakani_commercial_listings.city_id,
            sakani_commercial_listings.district_ar,
            sakani_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            sakani_commercial_listings.transaction_type
           FROM sakani_commercial_listings
          WHERE sakani_commercial_listings.active
        UNION ALL
         SELECT 'shatri'::text AS platform,
            'shatri_residential_listings'::text AS source_table,
            shatri_residential_listings.id AS listing_id,
            shatri_residential_listings.city_ar,
            shatri_residential_listings.city_id,
            shatri_residential_listings.district_ar,
            shatri_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            shatri_residential_listings.transaction_type
           FROM shatri_residential_listings
          WHERE shatri_residential_listings.active
        UNION ALL
         SELECT 'shatri'::text AS platform,
            'shatri_commercial_listings'::text AS source_table,
            shatri_commercial_listings.id AS listing_id,
            shatri_commercial_listings.city_ar,
            shatri_commercial_listings.city_id,
            shatri_commercial_listings.district_ar,
            shatri_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            shatri_commercial_listings.transaction_type
           FROM shatri_commercial_listings
          WHERE shatri_commercial_listings.active
        UNION ALL
         SELECT 'alqasem'::text AS platform,
            'alqasem_residential_listings'::text AS source_table,
            alqasem_residential_listings.id AS listing_id,
            alqasem_residential_listings.city_ar,
            alqasem_residential_listings.city_id,
            alqasem_residential_listings.district_ar,
            alqasem_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            alqasem_residential_listings.transaction_type
           FROM alqasem_residential_listings
          WHERE alqasem_residential_listings.active
        UNION ALL
         SELECT 'alqasem'::text AS platform,
            'alqasem_commercial_listings'::text AS source_table,
            alqasem_commercial_listings.id AS listing_id,
            alqasem_commercial_listings.city_ar,
            alqasem_commercial_listings.city_id,
            alqasem_commercial_listings.district_ar,
            alqasem_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            alqasem_commercial_listings.transaction_type
           FROM alqasem_commercial_listings
          WHERE alqasem_commercial_listings.active
        UNION ALL
         SELECT 'fkralemar'::text AS platform,
            'fkralemar_residential_listings'::text AS source_table,
            fkralemar_residential_listings.id AS listing_id,
            fkralemar_residential_listings.city_ar,
            fkralemar_residential_listings.city_id,
            fkralemar_residential_listings.district_ar,
            fkralemar_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            fkralemar_residential_listings.transaction_type
           FROM fkralemar_residential_listings
          WHERE fkralemar_residential_listings.active
        UNION ALL
         SELECT 'fkralemar'::text AS platform,
            'fkralemar_commercial_listings'::text AS source_table,
            fkralemar_commercial_listings.id AS listing_id,
            fkralemar_commercial_listings.city_ar,
            fkralemar_commercial_listings.city_id,
            fkralemar_commercial_listings.district_ar,
            fkralemar_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            fkralemar_commercial_listings.transaction_type
           FROM fkralemar_commercial_listings
          WHERE fkralemar_commercial_listings.active
        UNION ALL
         SELECT 'wadod'::text AS platform,
            'wadod_residential_listings'::text AS source_table,
            wadod_residential_listings.id AS listing_id,
            wadod_residential_listings.city_ar,
            wadod_residential_listings.city_id,
            wadod_residential_listings.district_ar,
            wadod_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            wadod_residential_listings.transaction_type
           FROM wadod_residential_listings
          WHERE wadod_residential_listings.active
        UNION ALL
         SELECT 'wadod'::text AS platform,
            'wadod_commercial_listings'::text AS source_table,
            wadod_commercial_listings.id AS listing_id,
            wadod_commercial_listings.city_ar,
            wadod_commercial_listings.city_id,
            wadod_commercial_listings.district_ar,
            wadod_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            wadod_commercial_listings.transaction_type
           FROM wadod_commercial_listings
          WHERE wadod_commercial_listings.active
        UNION ALL
         SELECT 'almuteb'::text AS platform,
            'almuteb_residential_listings'::text AS source_table,
            almuteb_residential_listings.id AS listing_id,
            almuteb_residential_listings.city_ar,
            almuteb_residential_listings.city_id,
            almuteb_residential_listings.district_ar,
            almuteb_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            almuteb_residential_listings.transaction_type
           FROM almuteb_residential_listings
          WHERE almuteb_residential_listings.active
        UNION ALL
         SELECT 'almuteb'::text AS platform,
            'almuteb_commercial_listings'::text AS source_table,
            almuteb_commercial_listings.id AS listing_id,
            almuteb_commercial_listings.city_ar,
            almuteb_commercial_listings.city_id,
            almuteb_commercial_listings.district_ar,
            almuteb_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            almuteb_commercial_listings.transaction_type
           FROM almuteb_commercial_listings
          WHERE almuteb_commercial_listings.active
        UNION ALL
         SELECT 'aalbarrak'::text AS platform,
            'aalbarrak_residential_listings'::text AS source_table,
            aalbarrak_residential_listings.id AS listing_id,
            aalbarrak_residential_listings.city_ar,
            aalbarrak_residential_listings.city_id,
            aalbarrak_residential_listings.district_ar,
            aalbarrak_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            aalbarrak_residential_listings.transaction_type
           FROM aalbarrak_residential_listings
          WHERE aalbarrak_residential_listings.active
        UNION ALL
         SELECT 'aalbarrak'::text AS platform,
            'aalbarrak_commercial_listings'::text AS source_table,
            aalbarrak_commercial_listings.id AS listing_id,
            aalbarrak_commercial_listings.city_ar,
            aalbarrak_commercial_listings.city_id,
            aalbarrak_commercial_listings.district_ar,
            aalbarrak_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            aalbarrak_commercial_listings.transaction_type
           FROM aalbarrak_commercial_listings
          WHERE aalbarrak_commercial_listings.active
        UNION ALL
         SELECT 'alrifai'::text AS platform,
            'alrifai_residential_listings'::text AS source_table,
            alrifai_residential_listings.id AS listing_id,
            alrifai_residential_listings.city_ar,
            alrifai_residential_listings.city_id,
            alrifai_residential_listings.district_ar,
            alrifai_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            alrifai_residential_listings.transaction_type
           FROM alrifai_residential_listings
          WHERE alrifai_residential_listings.active
        UNION ALL
         SELECT 'alrifai'::text AS platform,
            'alrifai_commercial_listings'::text AS source_table,
            alrifai_commercial_listings.id AS listing_id,
            alrifai_commercial_listings.city_ar,
            alrifai_commercial_listings.city_id,
            alrifai_commercial_listings.district_ar,
            alrifai_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            alrifai_commercial_listings.transaction_type
           FROM alrifai_commercial_listings
          WHERE alrifai_commercial_listings.active
        UNION ALL
         SELECT 'sodasyat'::text AS platform,
            'sodasyat_residential_listings'::text AS source_table,
            sodasyat_residential_listings.id AS listing_id,
            sodasyat_residential_listings.city_ar,
            sodasyat_residential_listings.city_id,
            sodasyat_residential_listings.district_ar,
            sodasyat_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            sodasyat_residential_listings.transaction_type
           FROM sodasyat_residential_listings
          WHERE sodasyat_residential_listings.active
        UNION ALL
         SELECT 'sodasyat'::text AS platform,
            'sodasyat_commercial_listings'::text AS source_table,
            sodasyat_commercial_listings.id AS listing_id,
            sodasyat_commercial_listings.city_ar,
            sodasyat_commercial_listings.city_id,
            sodasyat_commercial_listings.district_ar,
            sodasyat_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            sodasyat_commercial_listings.transaction_type
           FROM sodasyat_commercial_listings
          WHERE sodasyat_commercial_listings.active
        UNION ALL
         SELECT 'hasaad'::text AS platform,
            'hasaad_residential_listings'::text AS source_table,
            hasaad_residential_listings.id AS listing_id,
            hasaad_residential_listings.city_ar,
            hasaad_residential_listings.city_id,
            hasaad_residential_listings.district_ar,
            hasaad_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            hasaad_residential_listings.transaction_type
           FROM hasaad_residential_listings
          WHERE hasaad_residential_listings.active
        UNION ALL
         SELECT 'hasaad'::text AS platform,
            'hasaad_commercial_listings'::text AS source_table,
            hasaad_commercial_listings.id AS listing_id,
            hasaad_commercial_listings.city_ar,
            hasaad_commercial_listings.city_id,
            hasaad_commercial_listings.district_ar,
            hasaad_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            hasaad_commercial_listings.transaction_type
           FROM hasaad_commercial_listings
          WHERE hasaad_commercial_listings.active
        UNION ALL
         SELECT 'aqaralriyadh'::text AS platform,
            'aqaralriyadh_residential_listings'::text AS source_table,
            aqaralriyadh_residential_listings.id AS listing_id,
            aqaralriyadh_residential_listings.city_ar,
            aqaralriyadh_residential_listings.city_id,
            aqaralriyadh_residential_listings.district_ar,
            aqaralriyadh_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            aqaralriyadh_residential_listings.transaction_type
           FROM aqaralriyadh_residential_listings
          WHERE aqaralriyadh_residential_listings.active
        UNION ALL
         SELECT 'aqaralriyadh'::text AS platform,
            'aqaralriyadh_commercial_listings'::text AS source_table,
            aqaralriyadh_commercial_listings.id AS listing_id,
            aqaralriyadh_commercial_listings.city_ar,
            aqaralriyadh_commercial_listings.city_id,
            aqaralriyadh_commercial_listings.district_ar,
            aqaralriyadh_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            aqaralriyadh_commercial_listings.transaction_type
           FROM aqaralriyadh_commercial_listings
          WHERE aqaralriyadh_commercial_listings.active
        UNION ALL
         SELECT 'justsa'::text AS platform,
            'justsa_residential_listings'::text AS source_table,
            justsa_residential_listings.id AS listing_id,
            justsa_residential_listings.city_ar,
            justsa_residential_listings.city_id,
            justsa_residential_listings.district_ar,
            justsa_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            justsa_residential_listings.transaction_type
           FROM justsa_residential_listings
          WHERE justsa_residential_listings.active
        UNION ALL
         SELECT 'justsa'::text AS platform,
            'justsa_commercial_listings'::text AS source_table,
            justsa_commercial_listings.id AS listing_id,
            justsa_commercial_listings.city_ar,
            justsa_commercial_listings.city_id,
            justsa_commercial_listings.district_ar,
            justsa_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            justsa_commercial_listings.transaction_type
           FROM justsa_commercial_listings
          WHERE justsa_commercial_listings.active
        UNION ALL
         SELECT 'snam'::text AS platform,
            'snam_residential_listings'::text AS source_table,
            snam_residential_listings.id AS listing_id,
            snam_residential_listings.city_ar,
            snam_residential_listings.city_id,
            snam_residential_listings.district_ar,
            snam_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            snam_residential_listings.transaction_type
           FROM snam_residential_listings
          WHERE snam_residential_listings.active
        UNION ALL
         SELECT 'snam'::text AS platform,
            'snam_commercial_listings'::text AS source_table,
            snam_commercial_listings.id AS listing_id,
            snam_commercial_listings.city_ar,
            snam_commercial_listings.city_id,
            snam_commercial_listings.district_ar,
            snam_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            snam_commercial_listings.transaction_type
           FROM snam_commercial_listings
          WHERE snam_commercial_listings.active
        UNION ALL
         SELECT 'jawher'::text AS platform,
            'jawher_residential_listings'::text AS source_table,
            jawher_residential_listings.id AS listing_id,
            jawher_residential_listings.city_ar,
            jawher_residential_listings.city_id,
            jawher_residential_listings.district_ar,
            jawher_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            jawher_residential_listings.transaction_type
           FROM jawher_residential_listings
          WHERE jawher_residential_listings.active
        UNION ALL
         SELECT 'jawher'::text AS platform,
            'jawher_commercial_listings'::text AS source_table,
            jawher_commercial_listings.id AS listing_id,
            jawher_commercial_listings.city_ar,
            jawher_commercial_listings.city_id,
            jawher_commercial_listings.district_ar,
            jawher_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            jawher_commercial_listings.transaction_type
           FROM jawher_commercial_listings
          WHERE jawher_commercial_listings.active
        UNION ALL
         SELECT 'm3tmd'::text AS platform,
            'm3tmd_residential_listings'::text AS source_table,
            m3tmd_residential_listings.id AS listing_id,
            m3tmd_residential_listings.city_ar,
            m3tmd_residential_listings.city_id,
            m3tmd_residential_listings.district_ar,
            m3tmd_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            m3tmd_residential_listings.transaction_type
           FROM m3tmd_residential_listings
          WHERE m3tmd_residential_listings.active
        UNION ALL
         SELECT 'm3tmd'::text AS platform,
            'm3tmd_commercial_listings'::text AS source_table,
            m3tmd_commercial_listings.id AS listing_id,
            m3tmd_commercial_listings.city_ar,
            m3tmd_commercial_listings.city_id,
            m3tmd_commercial_listings.district_ar,
            m3tmd_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            m3tmd_commercial_listings.transaction_type
           FROM m3tmd_commercial_listings
          WHERE m3tmd_commercial_listings.active
        UNION ALL
         SELECT 'senan'::text AS platform,
            'senan_residential_listings'::text AS source_table,
            senan_residential_listings.id AS listing_id,
            senan_residential_listings.city_ar,
            senan_residential_listings.city_id,
            senan_residential_listings.district_ar,
            senan_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            senan_residential_listings.transaction_type
           FROM senan_residential_listings
          WHERE senan_residential_listings.active
        UNION ALL
         SELECT 'senan'::text AS platform,
            'senan_commercial_listings'::text AS source_table,
            senan_commercial_listings.id AS listing_id,
            senan_commercial_listings.city_ar,
            senan_commercial_listings.city_id,
            senan_commercial_listings.district_ar,
            senan_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            senan_commercial_listings.transaction_type
           FROM senan_commercial_listings
          WHERE senan_commercial_listings.active
        UNION ALL
         SELECT 'goldendeal'::text AS platform,
            'goldendeal_residential_listings'::text AS source_table,
            goldendeal_residential_listings.id AS listing_id,
            goldendeal_residential_listings.city_ar,
            goldendeal_residential_listings.city_id,
            goldendeal_residential_listings.district_ar,
            goldendeal_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            goldendeal_residential_listings.transaction_type
           FROM goldendeal_residential_listings
          WHERE goldendeal_residential_listings.active
        UNION ALL
         SELECT 'goldendeal'::text AS platform,
            'goldendeal_commercial_listings'::text AS source_table,
            goldendeal_commercial_listings.id AS listing_id,
            goldendeal_commercial_listings.city_ar,
            goldendeal_commercial_listings.city_id,
            goldendeal_commercial_listings.district_ar,
            goldendeal_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            goldendeal_commercial_listings.transaction_type
           FROM goldendeal_commercial_listings
          WHERE goldendeal_commercial_listings.active
        UNION ALL
         SELECT 'thousand'::text AS platform,
            'thousand_residential_listings'::text AS source_table,
            thousand_residential_listings.id AS listing_id,
            thousand_residential_listings.city_ar,
            thousand_residential_listings.city_id,
            thousand_residential_listings.district_ar,
            thousand_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            thousand_residential_listings.transaction_type
           FROM thousand_residential_listings
          WHERE thousand_residential_listings.active
        UNION ALL
         SELECT 'thousand'::text AS platform,
            'thousand_commercial_listings'::text AS source_table,
            thousand_commercial_listings.id AS listing_id,
            thousand_commercial_listings.city_ar,
            thousand_commercial_listings.city_id,
            thousand_commercial_listings.district_ar,
            thousand_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            thousand_commercial_listings.transaction_type
           FROM thousand_commercial_listings
          WHERE thousand_commercial_listings.active
        UNION ALL
         SELECT 'yameen'::text AS platform,
            'yameen_residential_listings'::text AS source_table,
            yameen_residential_listings.id AS listing_id,
            yameen_residential_listings.city_ar,
            yameen_residential_listings.city_id,
            yameen_residential_listings.district_ar,
            yameen_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            yameen_residential_listings.transaction_type
           FROM yameen_residential_listings
          WHERE yameen_residential_listings.active
        UNION ALL
         SELECT 'yameen'::text AS platform,
            'yameen_commercial_listings'::text AS source_table,
            yameen_commercial_listings.id AS listing_id,
            yameen_commercial_listings.city_ar,
            yameen_commercial_listings.city_id,
            yameen_commercial_listings.district_ar,
            yameen_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            yameen_commercial_listings.transaction_type
           FROM yameen_commercial_listings
          WHERE yameen_commercial_listings.active
        UNION ALL
         SELECT 'ebriza'::text AS platform,
            'ebriza_residential_listings'::text AS source_table,
            ebriza_residential_listings.id AS listing_id,
            ebriza_residential_listings.city_ar,
            ebriza_residential_listings.city_id,
            ebriza_residential_listings.district_ar,
            ebriza_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            ebriza_residential_listings.transaction_type
           FROM ebriza_residential_listings
          WHERE ebriza_residential_listings.active
        UNION ALL
         SELECT 'ebriza'::text AS platform,
            'ebriza_commercial_listings'::text AS source_table,
            ebriza_commercial_listings.id AS listing_id,
            ebriza_commercial_listings.city_ar,
            ebriza_commercial_listings.city_id,
            ebriza_commercial_listings.district_ar,
            ebriza_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            ebriza_commercial_listings.transaction_type
           FROM ebriza_commercial_listings
          WHERE ebriza_commercial_listings.active
        UNION ALL
         SELECT 'eilmalriyada'::text AS platform,
            'eilmalriyada_residential_listings'::text AS source_table,
            eilmalriyada_residential_listings.id AS listing_id,
            eilmalriyada_residential_listings.city_ar,
            eilmalriyada_residential_listings.city_id,
            eilmalriyada_residential_listings.district_ar,
            eilmalriyada_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            eilmalriyada_residential_listings.transaction_type
           FROM eilmalriyada_residential_listings
          WHERE eilmalriyada_residential_listings.active
        UNION ALL
         SELECT 'eilmalriyada'::text AS platform,
            'eilmalriyada_commercial_listings'::text AS source_table,
            eilmalriyada_commercial_listings.id AS listing_id,
            eilmalriyada_commercial_listings.city_ar,
            eilmalriyada_commercial_listings.city_id,
            eilmalriyada_commercial_listings.district_ar,
            eilmalriyada_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            eilmalriyada_commercial_listings.transaction_type
           FROM eilmalriyada_commercial_listings
          WHERE eilmalriyada_commercial_listings.active
        UNION ALL
         SELECT 'daryusuf'::text AS platform,
            'daryusuf_residential_listings'::text AS source_table,
            daryusuf_residential_listings.id AS listing_id,
            daryusuf_residential_listings.city_ar,
            daryusuf_residential_listings.city_id,
            daryusuf_residential_listings.district_ar,
            daryusuf_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            daryusuf_residential_listings.transaction_type
           FROM daryusuf_residential_listings
          WHERE daryusuf_residential_listings.active
        UNION ALL
         SELECT 'daryusuf'::text AS platform,
            'daryusuf_commercial_listings'::text AS source_table,
            daryusuf_commercial_listings.id AS listing_id,
            daryusuf_commercial_listings.city_ar,
            daryusuf_commercial_listings.city_id,
            daryusuf_commercial_listings.district_ar,
            daryusuf_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            daryusuf_commercial_listings.transaction_type
           FROM daryusuf_commercial_listings
          WHERE daryusuf_commercial_listings.active
        UNION ALL
         SELECT 'albdah'::text AS platform,
            'albdah_residential_listings'::text AS source_table,
            albdah_residential_listings.id AS listing_id,
            albdah_residential_listings.city_ar,
            albdah_residential_listings.city_id,
            albdah_residential_listings.district_ar,
            albdah_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            albdah_residential_listings.transaction_type
           FROM albdah_residential_listings
          WHERE albdah_residential_listings.active
        UNION ALL
         SELECT 'albdah'::text AS platform,
            'albdah_commercial_listings'::text AS source_table,
            albdah_commercial_listings.id AS listing_id,
            albdah_commercial_listings.city_ar,
            albdah_commercial_listings.city_id,
            albdah_commercial_listings.district_ar,
            albdah_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            albdah_commercial_listings.transaction_type
           FROM albdah_commercial_listings
          WHERE albdah_commercial_listings.active
        UNION ALL
         SELECT 'eydah'::text AS platform,
            'eydah_residential_listings'::text AS source_table,
            eydah_residential_listings.id AS listing_id,
            eydah_residential_listings.city_ar,
            eydah_residential_listings.city_id,
            eydah_residential_listings.district_ar,
            eydah_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            eydah_residential_listings.transaction_type
           FROM eydah_residential_listings
          WHERE eydah_residential_listings.active
        UNION ALL
         SELECT 'eydah'::text AS platform,
            'eydah_commercial_listings'::text AS source_table,
            eydah_commercial_listings.id AS listing_id,
            eydah_commercial_listings.city_ar,
            eydah_commercial_listings.city_id,
            eydah_commercial_listings.district_ar,
            eydah_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            eydah_commercial_listings.transaction_type
           FROM eydah_commercial_listings
          WHERE eydah_commercial_listings.active
        UNION ALL
         SELECT 'tamyaz'::text AS platform,
            'tamyaz_residential_listings'::text AS source_table,
            tamyaz_residential_listings.id AS listing_id,
            tamyaz_residential_listings.city_ar,
            tamyaz_residential_listings.city_id,
            tamyaz_residential_listings.district_ar,
            tamyaz_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            tamyaz_residential_listings.transaction_type
           FROM tamyaz_residential_listings
          WHERE tamyaz_residential_listings.active
        UNION ALL
         SELECT 'tamyaz'::text AS platform,
            'tamyaz_commercial_listings'::text AS source_table,
            tamyaz_commercial_listings.id AS listing_id,
            tamyaz_commercial_listings.city_ar,
            tamyaz_commercial_listings.city_id,
            tamyaz_commercial_listings.district_ar,
            tamyaz_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            tamyaz_commercial_listings.transaction_type
           FROM tamyaz_commercial_listings
          WHERE tamyaz_commercial_listings.active
        UNION ALL
         SELECT 'hazim'::text AS platform,
            'hazim_residential_listings'::text AS source_table,
            hazim_residential_listings.id AS listing_id,
            hazim_residential_listings.city_ar,
            hazim_residential_listings.city_id,
            hazim_residential_listings.district_ar,
            hazim_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            hazim_residential_listings.transaction_type
           FROM hazim_residential_listings
          WHERE hazim_residential_listings.active
        UNION ALL
         SELECT 'hazim'::text AS platform,
            'hazim_commercial_listings'::text AS source_table,
            hazim_commercial_listings.id AS listing_id,
            hazim_commercial_listings.city_ar,
            hazim_commercial_listings.city_id,
            hazim_commercial_listings.district_ar,
            hazim_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            hazim_commercial_listings.transaction_type
           FROM hazim_commercial_listings
          WHERE hazim_commercial_listings.active
        UNION ALL
         SELECT 'villassa'::text AS platform,
            'villassa_residential_listings'::text AS source_table,
            villassa_residential_listings.id AS listing_id,
            villassa_residential_listings.city_ar,
            villassa_residential_listings.city_id,
            villassa_residential_listings.district_ar,
            villassa_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            villassa_residential_listings.transaction_type
           FROM villassa_residential_listings
          WHERE villassa_residential_listings.active
        UNION ALL
         SELECT 'villassa'::text AS platform,
            'villassa_commercial_listings'::text AS source_table,
            villassa_commercial_listings.id AS listing_id,
            villassa_commercial_listings.city_ar,
            villassa_commercial_listings.city_id,
            villassa_commercial_listings.district_ar,
            villassa_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            villassa_commercial_listings.transaction_type
           FROM villassa_commercial_listings
          WHERE villassa_commercial_listings.active
        UNION ALL
         SELECT 'marksa'::text AS platform,
            'marksa_residential_listings'::text AS source_table,
            marksa_residential_listings.id AS listing_id,
            marksa_residential_listings.city_ar,
            marksa_residential_listings.city_id,
            marksa_residential_listings.district_ar,
            marksa_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            marksa_residential_listings.transaction_type
           FROM marksa_residential_listings
          WHERE marksa_residential_listings.active
        UNION ALL
         SELECT 'marksa'::text AS platform,
            'marksa_commercial_listings'::text AS source_table,
            marksa_commercial_listings.id AS listing_id,
            marksa_commercial_listings.city_ar,
            marksa_commercial_listings.city_id,
            marksa_commercial_listings.district_ar,
            marksa_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            marksa_commercial_listings.transaction_type
           FROM marksa_commercial_listings
          WHERE marksa_commercial_listings.active
        UNION ALL
         SELECT 'rightcompound'::text AS platform,
            'rightcompound_residential_listings'::text AS source_table,
            rightcompound_residential_listings.id AS listing_id,
            rightcompound_residential_listings.city_ar,
            rightcompound_residential_listings.city_id,
            rightcompound_residential_listings.district_ar,
            rightcompound_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            rightcompound_residential_listings.transaction_type
           FROM rightcompound_residential_listings
          WHERE rightcompound_residential_listings.active
        UNION ALL
         SELECT 'rightcompound'::text AS platform,
            'rightcompound_commercial_listings'::text AS source_table,
            rightcompound_commercial_listings.id AS listing_id,
            rightcompound_commercial_listings.city_ar,
            rightcompound_commercial_listings.city_id,
            rightcompound_commercial_listings.district_ar,
            rightcompound_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            rightcompound_commercial_listings.transaction_type
           FROM rightcompound_commercial_listings
          WHERE rightcompound_commercial_listings.active
        UNION ALL
         SELECT 'livingcompound'::text AS platform,
            'livingcompound_residential_listings'::text AS source_table,
            livingcompound_residential_listings.id AS listing_id,
            livingcompound_residential_listings.city_ar,
            livingcompound_residential_listings.city_id,
            livingcompound_residential_listings.district_ar,
            livingcompound_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            livingcompound_residential_listings.transaction_type
           FROM livingcompound_residential_listings
          WHERE livingcompound_residential_listings.active
        UNION ALL
         SELECT 'livingcompound'::text AS platform,
            'livingcompound_commercial_listings'::text AS source_table,
            livingcompound_commercial_listings.id AS listing_id,
            livingcompound_commercial_listings.city_ar,
            livingcompound_commercial_listings.city_id,
            livingcompound_commercial_listings.district_ar,
            livingcompound_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            livingcompound_commercial_listings.transaction_type
           FROM livingcompound_commercial_listings
          WHERE livingcompound_commercial_listings.active
        UNION ALL
         SELECT 'azure'::text AS platform,
            'azure_residential_listings'::text AS source_table,
            azure_residential_listings.id AS listing_id,
            azure_residential_listings.city_ar,
            azure_residential_listings.city_id,
            azure_residential_listings.district_ar,
            azure_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            azure_residential_listings.transaction_type
           FROM azure_residential_listings
          WHERE azure_residential_listings.active
        UNION ALL
         SELECT 'azure'::text AS platform,
            'azure_commercial_listings'::text AS source_table,
            azure_commercial_listings.id AS listing_id,
            azure_commercial_listings.city_ar,
            azure_commercial_listings.city_id,
            azure_commercial_listings.district_ar,
            azure_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            azure_commercial_listings.transaction_type
           FROM azure_commercial_listings
          WHERE azure_commercial_listings.active
        UNION ALL
         SELECT 'expattrusted'::text AS platform,
            'expattrusted_residential_listings'::text AS source_table,
            expattrusted_residential_listings.id AS listing_id,
            expattrusted_residential_listings.city_ar,
            expattrusted_residential_listings.city_id,
            expattrusted_residential_listings.district_ar,
            expattrusted_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            expattrusted_residential_listings.transaction_type
           FROM expattrusted_residential_listings
          WHERE expattrusted_residential_listings.active
        UNION ALL
         SELECT 'expattrusted'::text AS platform,
            'expattrusted_commercial_listings'::text AS source_table,
            expattrusted_commercial_listings.id AS listing_id,
            expattrusted_commercial_listings.city_ar,
            expattrusted_commercial_listings.city_id,
            expattrusted_commercial_listings.district_ar,
            expattrusted_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            expattrusted_commercial_listings.transaction_type
           FROM expattrusted_commercial_listings
          WHERE expattrusted_commercial_listings.active
        UNION ALL
         SELECT 'flow'::text AS platform,
            'flow_residential_listings'::text AS source_table,
            flow_residential_listings.id AS listing_id,
            flow_residential_listings.city_ar,
            flow_residential_listings.city_id,
            flow_residential_listings.district_ar,
            flow_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            flow_residential_listings.transaction_type
           FROM flow_residential_listings
          WHERE flow_residential_listings.active
        UNION ALL
         SELECT 'flow'::text AS platform,
            'flow_commercial_listings'::text AS source_table,
            flow_commercial_listings.id AS listing_id,
            flow_commercial_listings.city_ar,
            flow_commercial_listings.city_id,
            flow_commercial_listings.district_ar,
            flow_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            flow_commercial_listings.transaction_type
           FROM flow_commercial_listings
          WHERE flow_commercial_listings.active
        UNION ALL
         SELECT 'ksaaqar'::text AS platform,
            'ksaaqar_residential_listings'::text AS source_table,
            ksaaqar_residential_listings.id AS listing_id,
            ksaaqar_residential_listings.city_ar,
            ksaaqar_residential_listings.city_id,
            ksaaqar_residential_listings.district_ar,
            ksaaqar_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            ksaaqar_residential_listings.transaction_type
           FROM ksaaqar_residential_listings
          WHERE ksaaqar_residential_listings.active
        UNION ALL
         SELECT 'ksaaqar'::text AS platform,
            'ksaaqar_commercial_listings'::text AS source_table,
            ksaaqar_commercial_listings.id AS listing_id,
            ksaaqar_commercial_listings.city_ar,
            ksaaqar_commercial_listings.city_id,
            ksaaqar_commercial_listings.district_ar,
            ksaaqar_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            ksaaqar_commercial_listings.transaction_type
           FROM ksaaqar_commercial_listings
          WHERE ksaaqar_commercial_listings.active
        UNION ALL
         SELECT 'sadiqeltajer'::text AS platform,
            'sadiqeltajer_residential_listings'::text AS source_table,
            sadiqeltajer_residential_listings.id AS listing_id,
            sadiqeltajer_residential_listings.city_ar,
            sadiqeltajer_residential_listings.city_id,
            sadiqeltajer_residential_listings.district_ar,
            sadiqeltajer_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            sadiqeltajer_residential_listings.transaction_type
           FROM sadiqeltajer_residential_listings
          WHERE sadiqeltajer_residential_listings.active
        UNION ALL
         SELECT 'sadiqeltajer'::text AS platform,
            'sadiqeltajer_commercial_listings'::text AS source_table,
            sadiqeltajer_commercial_listings.id AS listing_id,
            sadiqeltajer_commercial_listings.city_ar,
            sadiqeltajer_commercial_listings.city_id,
            sadiqeltajer_commercial_listings.district_ar,
            sadiqeltajer_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            sadiqeltajer_commercial_listings.transaction_type
           FROM sadiqeltajer_commercial_listings
          WHERE sadiqeltajer_commercial_listings.active
        UNION ALL
         SELECT 'akariyoun'::text AS platform,
            'akariyoun_residential_listings'::text AS source_table,
            akariyoun_residential_listings.id AS listing_id,
            akariyoun_residential_listings.city_ar,
            akariyoun_residential_listings.city_id,
            akariyoun_residential_listings.district_ar,
            akariyoun_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            akariyoun_residential_listings.transaction_type
           FROM akariyoun_residential_listings
          WHERE akariyoun_residential_listings.active
        UNION ALL
         SELECT 'akariyoun'::text AS platform,
            'akariyoun_commercial_listings'::text AS source_table,
            akariyoun_commercial_listings.id AS listing_id,
            akariyoun_commercial_listings.city_ar,
            akariyoun_commercial_listings.city_id,
            akariyoun_commercial_listings.district_ar,
            akariyoun_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            akariyoun_commercial_listings.transaction_type
           FROM akariyoun_commercial_listings
          WHERE akariyoun_commercial_listings.active
        UNION ALL
         SELECT 'rakez'::text AS platform,
            'rakez_residential_listings'::text AS source_table,
            rakez_residential_listings.id AS listing_id,
            rakez_residential_listings.city_ar,
            rakez_residential_listings.city_id,
            rakez_residential_listings.district_ar,
            rakez_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            rakez_residential_listings.transaction_type
           FROM rakez_residential_listings
          WHERE rakez_residential_listings.active
        UNION ALL
         SELECT 'rakez'::text AS platform,
            'rakez_commercial_listings'::text AS source_table,
            rakez_commercial_listings.id AS listing_id,
            rakez_commercial_listings.city_ar,
            rakez_commercial_listings.city_id,
            rakez_commercial_listings.district_ar,
            rakez_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            rakez_commercial_listings.transaction_type
           FROM rakez_commercial_listings
          WHERE rakez_commercial_listings.active
        UNION ALL
         SELECT 'suwar'::text AS platform,
            'suwar_residential_listings'::text AS source_table,
            suwar_residential_listings.id AS listing_id,
            suwar_residential_listings.city_ar,
            suwar_residential_listings.city_id,
            suwar_residential_listings.district_ar,
            suwar_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            suwar_residential_listings.transaction_type
           FROM suwar_residential_listings
          WHERE suwar_residential_listings.active
        UNION ALL
         SELECT 'suwar'::text AS platform,
            'suwar_commercial_listings'::text AS source_table,
            suwar_commercial_listings.id AS listing_id,
            suwar_commercial_listings.city_ar,
            suwar_commercial_listings.city_id,
            suwar_commercial_listings.district_ar,
            suwar_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            suwar_commercial_listings.transaction_type
           FROM suwar_commercial_listings
          WHERE suwar_commercial_listings.active
        UNION ALL
         SELECT 'amlakalahsa'::text AS platform,
            'amlakalahsa_residential_listings'::text AS source_table,
            amlakalahsa_residential_listings.id AS listing_id,
            amlakalahsa_residential_listings.city_ar,
            amlakalahsa_residential_listings.city_id,
            amlakalahsa_residential_listings.district_ar,
            amlakalahsa_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            amlakalahsa_residential_listings.transaction_type
           FROM amlakalahsa_residential_listings
          WHERE amlakalahsa_residential_listings.active
        UNION ALL
         SELECT 'amlakalahsa'::text AS platform,
            'amlakalahsa_commercial_listings'::text AS source_table,
            amlakalahsa_commercial_listings.id AS listing_id,
            amlakalahsa_commercial_listings.city_ar,
            amlakalahsa_commercial_listings.city_id,
            amlakalahsa_commercial_listings.district_ar,
            amlakalahsa_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            amlakalahsa_commercial_listings.transaction_type
           FROM amlakalahsa_commercial_listings
          WHERE amlakalahsa_commercial_listings.active
        UNION ALL
         SELECT 'aqaralsaudia'::text AS platform,
            'aqaralsaudia_residential_listings'::text AS source_table,
            aqaralsaudia_residential_listings.id AS listing_id,
            aqaralsaudia_residential_listings.city_ar,
            aqaralsaudia_residential_listings.city_id,
            aqaralsaudia_residential_listings.district_ar,
            aqaralsaudia_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            aqaralsaudia_residential_listings.transaction_type
           FROM aqaralsaudia_residential_listings
          WHERE aqaralsaudia_residential_listings.active
        UNION ALL
         SELECT 'aqaralsaudia'::text AS platform,
            'aqaralsaudia_commercial_listings'::text AS source_table,
            aqaralsaudia_commercial_listings.id AS listing_id,
            aqaralsaudia_commercial_listings.city_ar,
            aqaralsaudia_commercial_listings.city_id,
            aqaralsaudia_commercial_listings.district_ar,
            aqaralsaudia_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            aqaralsaudia_commercial_listings.transaction_type
           FROM aqaralsaudia_commercial_listings
          WHERE aqaralsaudia_commercial_listings.active
        UNION ALL
         SELECT 'remal'::text AS platform,
            'remal_residential_listings'::text AS source_table,
            remal_residential_listings.id AS listing_id,
            remal_residential_listings.city_ar,
            remal_residential_listings.city_id,
            remal_residential_listings.district_ar,
            remal_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            remal_residential_listings.transaction_type
           FROM remal_residential_listings
          WHERE remal_residential_listings.active
        UNION ALL
         SELECT 'remal'::text AS platform,
            'remal_commercial_listings'::text AS source_table,
            remal_commercial_listings.id AS listing_id,
            remal_commercial_listings.city_ar,
            remal_commercial_listings.city_id,
            remal_commercial_listings.district_ar,
            remal_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            remal_commercial_listings.transaction_type
           FROM remal_commercial_listings
          WHERE remal_commercial_listings.active
        UNION ALL
         SELECT 'amaall'::text AS platform,
            'amaall_residential_listings'::text AS source_table,
            amaall_residential_listings.id AS listing_id,
            amaall_residential_listings.city_ar,
            amaall_residential_listings.city_id,
            amaall_residential_listings.district_ar,
            amaall_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            amaall_residential_listings.transaction_type
           FROM amaall_residential_listings
          WHERE amaall_residential_listings.active
        UNION ALL
         SELECT 'amaall'::text AS platform,
            'amaall_commercial_listings'::text AS source_table,
            amaall_commercial_listings.id AS listing_id,
            amaall_commercial_listings.city_ar,
            amaall_commercial_listings.city_id,
            amaall_commercial_listings.district_ar,
            amaall_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            amaall_commercial_listings.transaction_type
           FROM amaall_commercial_listings
          WHERE amaall_commercial_listings.active
        UNION ALL
         SELECT 'aqarmonthly'::text AS text,
            'aqarmonthly_residential_listings'::text AS text,
            aqarmonthly_residential_listings.id,
            aqarmonthly_residential_listings.city_ar,
            aqarmonthly_residential_listings.city_id,
            aqarmonthly_residential_listings.district_ar,
            aqarmonthly_residential_listings.region_id,
            'native_scraper'::text AS text,
            aqarmonthly_residential_listings.transaction_type
           FROM aqarmonthly_residential_listings
          WHERE aqarmonthly_residential_listings.active
        UNION ALL
         SELECT 'aqargate'::text AS text,
            'aqargate_residential_listings'::text AS text,
            aqargate_residential_listings.id,
            aqargate_residential_listings.city_ar,
            aqargate_residential_listings.city_id,
            aqargate_residential_listings.district_ar,
            aqargate_residential_listings.region_id,
            'native_scraper'::text AS text,
            aqargate_residential_listings.transaction_type
           FROM aqargate_residential_listings
          WHERE aqargate_residential_listings.active
        UNION ALL
         SELECT 'aqargate'::text AS text,
            'aqargate_commercial_listings'::text AS text,
            aqargate_commercial_listings.id,
            aqargate_commercial_listings.city_ar,
            aqargate_commercial_listings.city_id,
            aqargate_commercial_listings.district_ar,
            aqargate_commercial_listings.region_id,
            'native_scraper'::text AS text,
            aqargate_commercial_listings.transaction_type
           FROM aqargate_commercial_listings
          WHERE aqargate_commercial_listings.active
        UNION ALL
         SELECT 'sanadak'::text AS text,
            'sanadak_residential_listings'::text AS text,
            sanadak_residential_listings.id,
            sanadak_residential_listings.city_ar,
            sanadak_residential_listings.city_id,
            sanadak_residential_listings.district_ar,
            sanadak_residential_listings.region_id,
            'native_scraper'::text AS text,
            sanadak_residential_listings.transaction_type
           FROM sanadak_residential_listings
          WHERE sanadak_residential_listings.active
        UNION ALL
         SELECT 'sanadak'::text AS text,
            'sanadak_commercial_listings'::text AS text,
            sanadak_commercial_listings.id,
            sanadak_commercial_listings.city_ar,
            sanadak_commercial_listings.city_id,
            sanadak_commercial_listings.district_ar,
            sanadak_commercial_listings.region_id,
            'native_scraper'::text AS text,
            sanadak_commercial_listings.transaction_type
           FROM sanadak_commercial_listings
          WHERE sanadak_commercial_listings.active
        UNION ALL
         SELECT 'hajer'::text AS text,
            'hajer_residential_listings'::text AS text,
            hajer_residential_listings.id,
            hajer_residential_listings.city_ar,
            hajer_residential_listings.city_id,
            hajer_residential_listings.district_ar,
            hajer_residential_listings.region_id,
            'native_scraper'::text AS text,
            hajer_residential_listings.transaction_type
           FROM hajer_residential_listings
          WHERE hajer_residential_listings.active
        UNION ALL
         SELECT 'hajer'::text AS text,
            'hajer_commercial_listings'::text AS text,
            hajer_commercial_listings.id,
            hajer_commercial_listings.city_ar,
            hajer_commercial_listings.city_id,
            hajer_commercial_listings.district_ar,
            hajer_commercial_listings.region_id,
            'native_scraper'::text AS text,
            hajer_commercial_listings.transaction_type
           FROM hajer_commercial_listings
          WHERE hajer_commercial_listings.active
        UNION ALL
         SELECT 'wasalt'::text AS text,
            'wasalt_residential_listings'::text AS text,
            w.id,
            w.city_ar,
            ( SELECT cc.city_id
                   FROM loc_catalog_city cc
                  WHERE cc.city_norm = normalize_ar(w.city_ar) AND (w.region_id IS NULL OR cc.region_id = w.region_id)
                 LIMIT 1) AS city_id,
            w.district_ar,
            w.region_id,
            'native_scraper'::text AS text,
            w.transaction_type
           FROM wasalt_residential_listings w
          WHERE w.active AND w.ar_fetched
        UNION ALL
         SELECT 'wasalt'::text AS text,
            'wasalt_commercial_listings'::text AS text,
            w.id,
            w.city_ar,
            ( SELECT cc.city_id
                   FROM loc_catalog_city cc
                  WHERE cc.city_norm = normalize_ar(w.city_ar) AND (w.region_id IS NULL OR cc.region_id = w.region_id)
                 LIMIT 1) AS city_id,
            w.district_ar,
            w.region_id,
            'native_scraper'::text AS text,
            w.transaction_type
           FROM wasalt_commercial_listings w
          WHERE w.active AND w.ar_fetched
        UNION ALL
         SELECT 'aqar'::text AS text,
            'aqar_residential_listings'::text AS text,
            a.id,
            s.city_ar_parsed,
            s.parsed_city_id,
            NULL::text AS text,
            c.region_id,
            'aqar_parser'::text AS text,
            a.transaction_type
           FROM aqar_residential_listings a
             JOIN aqar_shadow_resolved s ON s.id = a.id
             LEFT JOIN loc_catalog_city c ON c.city_id = s.parsed_city_id
          WHERE a.active AND s.parsed_city_id IS NOT NULL
        UNION ALL
         SELECT 'aqar'::text AS text,
            'aqar_commercial_listings'::text AS text,
            a.id,
            s.city_ar_parsed,
            s.parsed_city_id,
            NULL::text AS text,
            c.region_id,
            'aqar_parser'::text AS text,
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
            'phasea'::text AS text,
            NULL::text AS text
           FROM phasea_shadow_resolution p
          WHERE p.city_id IS NOT NULL
        UNION ALL
         SELECT 'satel'::text AS text,
            'satel_residential_listings'::text AS text,
            s.id,
            s.additional_info ->> 'city_ar'::text,
            ( SELECT cc.city_id
                   FROM loc_catalog_city cc
                  WHERE cc.city_norm = normalize_ar(s.additional_info ->> 'city_ar'::text)
                 LIMIT 1) AS city_id,
            s.additional_info ->> 'district_ar'::text,
            ( SELECT cc.region_id
                   FROM loc_catalog_city cc
                  WHERE cc.city_norm = normalize_ar(s.additional_info ->> 'city_ar'::text)
                 LIMIT 1) AS region_id,
            'native_scraper'::text AS text,
            s.transaction_type
           FROM satel_residential_listings s
          WHERE s.active
        UNION ALL
         SELECT 'satel'::text AS text,
            'satel_commercial_listings'::text AS text,
            s.id,
            s.additional_info ->> 'city_ar'::text,
            ( SELECT cc.city_id
                   FROM loc_catalog_city cc
                  WHERE cc.city_norm = normalize_ar(s.additional_info ->> 'city_ar'::text)
                 LIMIT 1) AS city_id,
            s.additional_info ->> 'district_ar'::text,
            ( SELECT cc.region_id
                   FROM loc_catalog_city cc
                  WHERE cc.city_norm = normalize_ar(s.additional_info ->> 'city_ar'::text)
                 LIMIT 1) AS region_id,
            'native_scraper'::text AS text,
            s.transaction_type
           FROM satel_commercial_listings s
          WHERE s.active
        UNION ALL
         SELECT 'abwbna'::text AS platform,
            'abwbna_residential_listings'::text AS source_table,
            abwbna_residential_listings.id AS listing_id,
            abwbna_residential_listings.city_ar,
            abwbna_residential_listings.city_id,
            abwbna_residential_listings.district_ar,
            abwbna_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            abwbna_residential_listings.transaction_type
           FROM abwbna_residential_listings
          WHERE abwbna_residential_listings.active
        UNION ALL
         SELECT 'abwbna'::text AS platform,
            'abwbna_commercial_listings'::text AS source_table,
            abwbna_commercial_listings.id AS listing_id,
            abwbna_commercial_listings.city_ar,
            abwbna_commercial_listings.city_id,
            abwbna_commercial_listings.district_ar,
            abwbna_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            abwbna_commercial_listings.transaction_type
           FROM abwbna_commercial_listings
          WHERE abwbna_commercial_listings.active
        UNION ALL
         SELECT 'bahadhabab'::text AS platform,
            'bahadhabab_residential_listings'::text AS source_table,
            bahadhabab_residential_listings.id AS listing_id,
            bahadhabab_residential_listings.city_ar,
            bahadhabab_residential_listings.city_id,
            bahadhabab_residential_listings.district_ar,
            bahadhabab_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            bahadhabab_residential_listings.transaction_type
           FROM bahadhabab_residential_listings
          WHERE bahadhabab_residential_listings.active
        UNION ALL
         SELECT 'bahadhabab'::text AS platform,
            'bahadhabab_commercial_listings'::text AS source_table,
            bahadhabab_commercial_listings.id AS listing_id,
            bahadhabab_commercial_listings.city_ar,
            bahadhabab_commercial_listings.city_id,
            bahadhabab_commercial_listings.district_ar,
            bahadhabab_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            bahadhabab_commercial_listings.transaction_type
           FROM bahadhabab_commercial_listings
          WHERE bahadhabab_commercial_listings.active
        UNION ALL
         SELECT 'alobid'::text AS platform,
            'alobid_residential_listings'::text AS source_table,
            alobid_residential_listings.id AS listing_id,
            alobid_residential_listings.city_ar,
            alobid_residential_listings.city_id,
            alobid_residential_listings.district_ar,
            alobid_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            alobid_residential_listings.transaction_type
           FROM alobid_residential_listings
          WHERE alobid_residential_listings.active
        UNION ALL
         SELECT 'alobid'::text AS platform,
            'alobid_commercial_listings'::text AS source_table,
            alobid_commercial_listings.id AS listing_id,
            alobid_commercial_listings.city_ar,
            alobid_commercial_listings.city_id,
            alobid_commercial_listings.district_ar,
            alobid_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            alobid_commercial_listings.transaction_type
           FROM alobid_commercial_listings
          WHERE alobid_commercial_listings.active
        UNION ALL
         SELECT 'azdad'::text AS platform,
            'azdad_residential_listings'::text AS source_table,
            azdad_residential_listings.id AS listing_id,
            azdad_residential_listings.city_ar,
            azdad_residential_listings.city_id,
            azdad_residential_listings.district_ar,
            azdad_residential_listings.region_id,
            'native_scraper'::text AS source_method,
            azdad_residential_listings.transaction_type
           FROM azdad_residential_listings
          WHERE azdad_residential_listings.active
        UNION ALL
         SELECT 'azdad'::text AS platform,
            'azdad_commercial_listings'::text AS source_table,
            azdad_commercial_listings.id AS listing_id,
            azdad_commercial_listings.city_ar,
            azdad_commercial_listings.city_id,
            azdad_commercial_listings.district_ar,
            azdad_commercial_listings.region_id,
            'native_scraper'::text AS source_method,
            azdad_commercial_listings.transaction_type
           FROM azdad_commercial_listings
          WHERE azdad_commercial_listings.active
        ), legacy AS (
         SELECT lal_1.platform,
            lal_1.source_table,
            lal_1.listing_id,
            lal_1.city_ar,
            COALESCE(lsc.city_id, lgc.city_id) AS city_id,
            lal_1.district_ar,
            COALESCE(lsc.region_id, lgc.region_id) AS region_id,
            'legacy_derived'::text AS source_method,
            NULL::text AS transaction_type
           FROM listings_arabic_locations lal_1
             LEFT JOIN LATERAL ( SELECT min(c.city_id) AS city_id,
                    min(c.region_id) AS region_id
                   FROM loc_catalog_city c
                     JOIN loc_catalog_region r ON r.region_id = c.region_id
                  WHERE c.city_norm = normalize_ar(lal_1.city_ar) AND lal_1.region_ar IS NOT NULL AND normalize_ar(r.region_ar) = normalize_ar(lal_1.region_ar)
                 HAVING count(DISTINCT c.city_id) = 1) lsc ON true
             LEFT JOIN LATERAL ( SELECT c2.city_id,
                    c2.region_id
                   FROM loc_catalog_city c2
                  WHERE c2.city_norm = normalize_ar(lal_1.city_ar)
                  ORDER BY c2.city_id
                 LIMIT 1) lgc ON true
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
          ORDER BY ranked.platform, ranked.listing_id, ranked.priority, ranked.source_method
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
        CASE
            WHEN btrim(b.district_ar) = ANY (ARRAY[''::text, 'غير محدد'::text, 'اخرى'::text, 'أخرى'::text]) THEN NULL::text
            ELSE btrim(b.district_ar)
        END,
        CASE
            WHEN btrim(lal.district_ar) = ANY (ARRAY[''::text, 'غير محدد'::text, 'اخرى'::text, 'أخرى'::text]) THEN NULL::text
            ELSE btrim(lal.district_ar)
        END) AS district_ar,
    cr.region_ar,
    b.source_method,
    b.region_id IS NOT NULL AND b.city_id IS NOT NULL AS production_ready,
    llc.last_updated
   FROM best b
     LEFT JOIN listings_arabic_locations lal ON lal.platform = b.platform AND lal.listing_id = b.listing_id
     LEFT JOIN listing_location_canonical llc ON llc.platform = b.platform AND llc.listing_id = b.listing_id
     LEFT JOIN loc_catalog_region cr ON cr.region_id = b.region_id;
