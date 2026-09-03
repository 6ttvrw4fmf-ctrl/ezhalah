-- MIRROR of the LIVE production object (audit item 7f). NOT a migration — see the
-- full-body-replace rule. Regenerated verbatim from pg_get_viewdef(..., true).
--
-- Re-verified 2026-09-03 (5-platform search activation): UNCHANGED, and this one is a real test of
--   that claim. This view was DROPPED and recreated during the activation: adding the new platforms
--   required rebuilding listing_location_index, whose CASCADE takes listing_native_location_v1 with
--   it. It was restored from a catalog-generated snapshot (ops_ddl_snapshot, label
--   pre_5_platform_activation_20260903) rather than from anything hand-written, and afterwards
--   md5(pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) still returns
--   31036a9c8b92fddc5293b700985b869d at 14127 chars — byte-identical to the body below, which is
--   independent proof the restore was faithful. The two migrations that trip this checker
--   (20260903173233 snapshot, 20260903180453 activation) MENTION the view but neither redefines it:
--   the first only reads its DDL, the second only recreates it from that captured text.
--
-- Re-verified 2026-08-31 (migration-drift recovery, routine #7 seam run): UNCHANGED. The recovered
--   migrations 20260831080856 (phasea snapshot vs live source city) and 20260831092750 (district
--   contradicts source) both MENTION listing_native_location_v1 in prose — each explains that the
--   view's final SELECT falls back to a frozen snapshot table for district_ar/city — but neither
--   redefines it: one creates a view + detector over phasea_src_arabic, the other UPDATEs
--   listings_arabic_locations and creates a detector. Re-ran
--   md5(pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) against live
--   production: still 31036a9c8b92fddc5293b700985b869d (14127 chars) — unchanged since 2026-08-20,
--   so the body below is current; only the re-verification date advances.
--
-- DO NOT "FIX" THE CANDIDATE ORDERING WHILE READING THIS (data-integrity run, PR #1403). The
--   ordering inside phasea_shadow_resolution that prefers the frozen city_ar_src over shadow_city
--   looks like an obvious bug and is deliberately LEFT AS IT IS: flipping it moves 49 listings
--   between genuinely different cities, and only 2 of those were provably wrong. 29 are the
--   الاحساء/الهفوف pair and 17 are rows where the snapshot's Arabic value is the MORE specific and
--   correct city (حقل is its own city, not تبوك), so the current ordering is right for them. The
--   2026-08-31 repair was three snapshot DATA rows (gathern 726509/725383, sadin 597777), never a
--   resolver change. See docs/ops/DERIVED_STORE_FRESHNESS.md for the permanent architecture.
--   UPDATE (owner decision, 2026-08-31): الاحساء/الهفوف was SETTLED by CLUSTERING, not relabelling
--   — migration 20260831195108 puts city_id 3677 and 12 in one loc_city_cluster key so each name
--   finds the other through match_city_ids, while every listing keeps the city its source
--   published. That decision does NOT license flipping this ordering; the 17 rows above are still
--   correct as they stand.
--
-- Re-verified 2026-08-21 (migration-drift recovery, PR #874): UNCHANGED. The recovered phasea
--   migrations 20260821153734 / 20260821154150 / 20260821154316 MENTION listing_native_location_v1
--   in prose comments (154316's detector reads the resolver's OUTPUT, listing_native_location_v2),
--   but none redefine this view. Re-ran md5(pg_get_viewdef('public.listing_native_location_v1'::regclass,
--   true)) against live production: still 31036a9c8b92fddc5293b700985b869d (14127 chars) — unchanged
--   since 2026-08-20, so the body below is current; only the re-verification date advances.
--
-- Re-verified 2026-08-20 (prod-drift resolution): CHANGED and regenerated. Migration
--   20260820074258_v1_legacy_city_resolution_scoped_to_published_region redefined this view
--   (legacy city resolution scoped to the published region). Recorded md5: 31036a9c8b92fddc5293b700985b869d (14127 chars),
--   from md5(pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) against live production.
-- Refreshed 2026-08-08 (senior run #7). The previous copy had drifted badly: it was missing the
-- ENTIRE `satel` native branch (both the residential and commercial UNION ALL arms), and it still
-- carried the older parenthesised rendering (`WHERE (p.city_id IS NOT NULL)`) from a superseded
-- pg_get_viewdef formatting — 11,245 chars against production's 13,385. A mirror is what an agent
-- session READS to reason about the location pipeline, so a stale one is how a session concludes
-- "satel has no native resolution" and ships a fix for a problem that does not exist.
--
-- Re-verified 2026-08-18 (senior run #28, PR #746): UNCHANGED. Migration 20260818064958 repairs the
--   `lal_live_overlay` in listing_native_location_v2 — its catch-all branch read our own
--   listings_arabic_locations resolution but gated it behind a hardcoded dealapp-only allowlist, so
--   19 already-resolved listings were invisible to every Filter combination. That migration NAMES
--   this view only to say which rows fall through to the catch-all ("not (yet) in the
--   listing_native_location_v1 materialized view"); v1 itself was deliberately NOT redefined, and
--   the repair was again made one level up in v2. Same any-mention trip as the 2026-08-17,
--   2026-08-15, 2026-08-12 and 2026-08-10 entries. Re-ran
--   md5(pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) against live
--   production at 06:53Z: d7fff7ec0378d6095728e862aee80106, 13,385 chars — byte-identical to the
--   digest this header already carries; only the verification date advances.
-- Re-verified 2026-08-17 (data-integrity run #26, PR #723): UNCHANGED. Migration 20260817075301
--   registers mon_detect_discarded_location_resolution, whose alert text NAMES this view — it
--   explains that the defect's root cause is the precedence in `listing_native_location_v1.best`
--   (a native row that resolves to NULL outranking a legacy row that resolves to a real city).
--   The repair was made one level up, in listing_native_location_v2's COALESCE fallback chain;
--   v1 itself was deliberately NOT redefined, so this is the same any-mention trip as the
--   2026-08-15, 2026-08-12 and 2026-08-10 entries. Re-ran
--   md5(pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) against live
--   production at 07:59Z: d7fff7ec0378d6095728e862aee80106, 13,385 chars — byte-identical to the
--   digest this header already carries; only the verification date advances.
-- Re-verified 2026-08-15 (cron-state mirror sweep, PR #673): UNCHANGED. Migration 20260815211103
--   records the verbatim command of cron jobid 17, which NAMES this view (`refresh materialized
--   view concurrently public.listing_native_location_v1 ...`) but never redefines it — the same
--   any-mention trip as the 2026-08-12 and 2026-08-10 entries below, not real drift. Re-ran
--   md5(pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) against live
--   production at 21:14Z: d7fff7ec0378d6095728e862aee80106, 13,385 chars — byte-identical to the
--   digest this header already carries; only the verification date advances.
-- Re-verified 2026-08-12 (issue #460 gathern fix, PR #546): UNCHANGED. This migration's needle-edit
--   only rewrites listing_native_location_v2's catchall arm (restoring a dropped gathern LATERAL);
--   it reads FROM v1 but never redefines it. Re-ran pg_get_viewdef('listing_native_location_v1'::
--   regclass, true) against live production immediately before this commit: byte-exact with the body
--   below (same 13,385 chars, same md5 d7fff7ec0378d6095728e862aee80106) — content genuinely
--   unchanged, only the verification date needed to advance past this migration (same any-mention
--   trip as the 2026-08-10 entry below, not real drift).
-- Re-verified 2026-08-11 (Data Integrity self-audit): UNCHANGED. md5(pg_get_viewdef(...,true)) in
--   production read d7fff7ec0378d6095728e862aee80106 at 13:04Z — byte-identical to the digest this
--   header already carried, so the body below is untouched. The stamp moves because migration
--   20260811130514 NAMES this view (it seeds ops_sql_mirror_expected with the view's expected
--   digest) and the staleness guard matches on any MENTION, deliberately: needle-edit migrations
--   change a function without ever spelling out CREATE OR REPLACE, so a CREATE-only heuristic would
--   miss real drift. Re-stamping after a genuine live re-verification is the intended workflow —
--   loosening the guard to recognise "merely records the digest" would reopen that hole.
--   That migration also adds mon_detect_sql_mirror_drift, which from now on compares this digest to
--   the live definition twice an hour, so a future divergence is caught by a barrier, not by a date.
-- Re-verified 2026-08-10 (daily engineer, recovering 24 uncommitted 2026-08-09 migrations —
-- verify-sql-mirrors-not-stale flagged this file because 20260809154124_dealapp_live_location_
-- overlay.sql MENTIONS listing_native_location_v1 (it reads from v1 while rebuilding v2), which
-- trips the checker's any-mention heuristic even though it does not modify v1 itself. Re-ran
-- pg_get_viewdef('listing_native_location_v1'::regclass, true) against live production: byte-exact
-- with the body below (same 13,385 chars, same md5) — content genuinely unchanged, only the
-- verification date needed to advance past that migration.
--
-- Regenerated from pg_get_viewdef('listing_native_location_v1'::regclass, true) — 13,385 chars.
-- Verified byte-exact; md5 of everything below this header block: d7fff7ec0378d6095728e862aee80106
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
