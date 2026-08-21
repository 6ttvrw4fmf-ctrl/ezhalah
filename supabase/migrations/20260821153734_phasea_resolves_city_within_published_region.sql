-- phasea_shadow_resolution: resolve the city INSIDE the region the platform itself published.
--
-- Rule 24a ("unambiguous inside the region the source published"), applied at a FIFTH stage.
-- Run #29 fixed it in three places (resolve_english_city_overlay, listing_native_location_v2's
-- catchall, mon_detect_discarded_location_resolution); run #33 fixed it in listing_native_location_v1.
-- phasea is a priority-1 resolver and never consulted the platform's own region at all.
--
-- The defect: the cc lateral ordered candidates by (a) does the catalog name equal the platform's
-- own Arabic city string, then (b) does the catalog region equal mv.region -- and mv.region is
-- itself derived from loc_city_map keyed on the city NAME with no region predicate, so it is
-- circular, and it is NULL for every row phasea labels source='unresolved'. With both keys tied,
-- LIMIT 1 returned whichever row the executor happened to produce first, and that pick could change
-- between rebuilds. Saudi place names repeat across regions legitimately (القاع exists 7 times
-- across 4 regions), so this filed listings in a region their own source contradicts.
--
-- The fix threads mv.region_raw -- the platform's OWN published region string, already carried by
-- listing_location_canonical_mv and never read here -- through to the lateral, maps it via
-- loc_region_map, and prefers a candidate inside that region. It is MONOTONIC by construction:
-- when the published region is absent or holds no candidate, every candidate scores pub_pref=1 and
-- the previous ordering stands unchanged; c.city_id is appended only as a deterministic final
-- tiebreak, replacing an arbitrary executor-order pick (same precedent as run #33's v1 fix, which
-- chose determinism over "ambiguous -> NULL" because the catalog contains genuine duplicate city
-- rows WITHIN one region and NULLing them would LOSE cities).
--
-- Measured differential over the complete at-risk cohort (1,553 rows carrying one of the 28
-- catalog-duplicate city names): 11 rows change, 0 cities lost, 0 cities gained. Source-verified
-- live this run against aqarcity's own schema.org block -- 10/10 probed pages contradict the stored
-- region and agree with region_raw:
--   29809/27569 الشيحيه -> منطقة حائل · 29787 السليمي -> منطقة حائل · 29743 تربة -> منطقة حائل
--   ("تربة حائل" in its own streetAddress) · 29618/29617 الفويلق -> منطقة القصيم ·
--   27595 ملح -> منطقة المدينة المنورة · 27210/27150/27149 القاع -> منطقة عسير.
-- The 11th is ramzalqasim 615755 (البطين -> Qassim), a Qassim-only platform.
--
-- NOT changed by this, deliberately: the aqar and wasalt off-region rows. aqar's region column is
-- the CRAWL FACET while the ad's own title publishes a different city+region (ad 6458403's slug
-- reads «مدينة كحله منطقة القصيم» while the facet says Hail) -- the source disagrees with itself and
-- Ezhalah stored the ad's own statement, so nothing is provably ours. wasalt's 23 self-contradicting
-- rows were adjudicated the same way by run #33. aqar/wasalt are outside phasea's platform filter
-- regardless. Core rule: weird is not wrong; only repair what Ezhalah provably created.
create or replace view public.phasea_shadow_resolution as
 WITH base AS (
         SELECT mv.source_table,
            mv.listing_id,
            mv.platform,
            mv.city AS live_city,
            mv.region AS live_region,
            mv.district AS live_district,
            mv.region_raw,
            s.city_ar_src,
            COALESCE(( SELECT cm.city_ar
                   FROM loc_city_map cm
                  WHERE normalize_ar(cm.city_ar) = normalize_ar(s.city_ar_src)
                 LIMIT 1), ( SELECT al.city_ar
                   FROM loc_city_alias_ar al
                  WHERE al.alias_norm = normalize_ar(s.city_ar_src)
                 LIMIT 1)) AS arabic_resolved
           FROM listing_location_canonical_mv mv
             LEFT JOIN phasea_src_arabic s ON s.source_table = mv.source_table AND s.listing_id = mv.listing_id
          WHERE mv.source_table ~ '_(residential|commercial)_listings$'::text AND mv.source_table !~ '^(aqar|alhoshan|aldarim|aqarmonthly|aqargate|sanadak|hajer|wasalt|souq24)_'::text
        ), res AS (
         SELECT base.source_table,
            base.listing_id,
            base.platform,
            base.live_city,
            base.live_region,
            base.live_district,
            base.city_ar_src,
            base.arabic_resolved,
            pr.region_id AS pub_region_id,
                CASE
                    WHEN base.live_city IS NULL THEN NULL::text
                    WHEN base.arabic_resolved = base.live_city THEN base.arabic_resolved
                    ELSE base.live_city
                END AS shadow_city,
                CASE
                    WHEN base.live_city IS NULL THEN 'unresolved'::text
                    WHEN base.arabic_resolved = base.live_city THEN 'arabic-native'::text
                    WHEN base.arabic_resolved IS NOT NULL THEN 'english(diverge-pinned)'::text
                    ELSE 'english-fallback'::text
                END AS source
           FROM base
             LEFT JOIN loc_region_map rm ON rm.region_key = lower(btrim(base.region_raw))
             LEFT JOIN loc_catalog_region pr ON pr.region_ar = rm.region_ar
        )
 SELECT res.source_table,
    res.listing_id,
    res.platform,
    res.live_city,
    res.live_region,
    res.live_district,
    COALESCE(NULLIF(btrim(res.city_ar_src), ''::text), cc.city_ar_resolved) AS city_ar_src,
    res.arabic_resolved,
    res.shadow_city,
    res.source,
    cc.city_id,
    cc.region_id,
    ( SELECT d.district_id
           FROM loc_catalog_district d
          WHERE d.city_id = cc.city_id AND d.district_norm = normalize_ar(res.live_district)
         LIMIT 1) AS district_id
   FROM res
     LEFT JOIN LATERAL ( SELECT q.city_id,
            q.region_id,
            q.city_ar_resolved
           FROM ( SELECT c.city_id,
                    c.region_id,
                    c.city_ar AS city_ar_resolved
                   FROM loc_catalog_city c
                     JOIN loc_catalog_region rr ON rr.region_id = c.region_id
                  WHERE c.city_norm = normalize_ar(res.shadow_city) OR c.city_norm = normalize_ar(NULLIF(btrim(res.city_ar_src), ''::text)) OR c.city_id = (( SELECT a.city_id
                           FROM loc_catalog_city_alias a
                          WHERE a.alias_norm = normalize_ar(res.shadow_city))) OR c.city_id = (( SELECT a.city_id
                           FROM loc_catalog_city_alias a
                          WHERE a.alias_norm = normalize_ar(NULLIF(btrim(res.city_ar_src), ''::text))))
                  ORDER BY (
                        CASE
                            WHEN c.city_norm = normalize_ar(NULLIF(btrim(res.city_ar_src), ''::text)) THEN 0
                            ELSE 1
                        END), (
                        CASE
                            WHEN res.pub_region_id IS NOT NULL AND c.region_id = res.pub_region_id THEN 0
                            ELSE 1
                        END), (
                        CASE
                            WHEN normalize_ar(rr.region_ar) = normalize_ar(res.live_region) THEN 0
                            ELSE 1
                        END), c.city_id
                 LIMIT 1) q) cc ON true;

comment on view public.phasea_shadow_resolution is
'Priority-1 native location resolution for the non-aqar/wasalt platforms. Candidate cities are
ordered by (1) does the catalog name equal the platform''s own Arabic city string, (2) is the
candidate inside the region the PLATFORM PUBLISHED (mv.region_raw via loc_region_map) -- rule 24a,
added 2026-08-21 after 11 listings were served in a region their own source contradicts, (3) the
legacy mv.region preference (derived from a region-less name lookup, so circular -- kept only as a
lower-priority tiebreak), (4) c.city_id, a deterministic final tiebreak replacing an arbitrary
executor-order pick. Monotonic: with no published region, or none of the candidates inside it, the
pre-2026-08-21 ordering stands unchanged.';