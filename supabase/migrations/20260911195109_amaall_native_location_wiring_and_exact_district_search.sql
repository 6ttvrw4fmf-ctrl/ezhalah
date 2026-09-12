-- amaall JOINS THE NATIVE LOCATION RESOLVER — district was fixable but still couldn't be found by
-- an exact district search, only by a broad city scan (owner-caught live, 2026-09-11).
--
-- PR #2277 (merged 08:42 today) fixed the real bug: `property_area`, the Houzez taxonomy holding
-- the site's own «تسمية الحي» field, was simply missing from amaall's TAXONOMIES list, so every
-- amaall listing shipped neighborhood=None though the source states its district as plainly as its
-- city. That fix reached this listing's `neighborhood` column correctly once re-scraped — the
-- PROPERTY CARD already shows it, verified live.
--
-- But an exact-district search (owner: "put the exact district in district and see, don't just do
-- a broad search") still returned nothing, because `neighborhood` was never the whole story.
-- `listing_native_location_v1` — the ONE materialized view every Filter/Trending/AF district query
-- actually reads — never had an arm for amaall at all: `position('amaall' in
-- pg_get_viewdef(...)) = 0`. Every amaall row fell through v2's THIRD, catch-all UNION arm, which
-- resolves city ONLY via `listings_arabic_locations` (a table with zero amaall rows) and hardcodes
-- `district_ar` to NULL — no coalesce, no recovery table, by construction. amaall's city_ar had
-- been sitting correct in `search_listings_ar` only because of a one-time historical backfill that
-- this pipeline could no longer reproduce; the very next sync would have silently REGRESSED every
-- amaall listing to production_ready=false the moment it tried to refresh them (caught live before
-- that happened, mid-fix, and fixed instead of reverted).
--
-- THE FIX mirrors the exact, proven pattern already used for abwbna/alobid/bahadhabab
-- (20260906170500/170800/181019): give amaall's own raw tables native city_ar/district_ar/
-- city_id/region_id columns, wire amaall into listing_native_location_v1 as a real arm, and let the
-- existing COALESCE chain in v2 pick up native data before ever falling to the catch-all. city_id/
-- region_id are resolved through the SAME shared, catalog-verified values search_listings_ar
-- already held (7 distinct amaall cities, all major/unambiguous — Mecca, Medina, Jeddah, Riyadh,
-- Dammam, Khobar, Al Qunfudhah), never the ambiguous city_name_bridge (measured live: "Mecca" alone
-- bridges to 6 different Arabic cities without a guard).
--
-- scrapers/amaall/run.py is updated in the SAME PR to write district_ar/city_ar/city_id/region_id
-- going forward via the shared to_catalog() helper (6 other scrapers already use it) — this
-- migration's backfill covers listings already in the table; new listings self-populate at scrape
-- time from here on, so this gap cannot silently reopen for future amaall listings.

-- ── 1. Arabic-native shadow columns on amaall's raw tables (idempotent — matches the exact
--       add_city_ar_district_ar_to_… / add_city_id_region_id_to_… pattern already used for
--       abwbna/alobid/bahadhabab) ──────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['amaall_residential_listings','amaall_commercial_listings'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_ar text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS district_ar text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_id integer', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS region_id integer', t);
  END LOOP;
END $$;

-- ── 2. Backfill district_ar verbatim from neighborhood (the PR #2277 fix already populated
--       neighborhood; this just mirrors the same source fact into the native-shadow column the
--       resolver reads). Idempotent: re-running assigns the same values. ──────────────────────
UPDATE amaall_residential_listings SET district_ar = neighborhood
 WHERE neighborhood IS NOT NULL AND neighborhood <> '' AND district_ar IS DISTINCT FROM neighborhood;
UPDATE amaall_commercial_listings SET district_ar = neighborhood
 WHERE neighborhood IS NOT NULL AND neighborhood <> '' AND district_ar IS DISTINCT FROM neighborhood;

-- ── 3. Backfill city_ar/city_id/region_id for amaall's existing rows, using the exact 7 (city_en →
--       city_ar/city_id/region_id) triples already verified correct in the LIVE search_listings_ar
--       before this fix (the historical backfill this migration is replacing with a reproducible
--       native path). All 7 are major, unambiguous Saudi cities. Idempotent — a CASE re-assigns the
--       same values on re-run. ──────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['amaall_residential_listings','amaall_commercial_listings'] LOOP
    EXECUTE format($f$
      UPDATE %I SET
        city_ar = CASE city
          WHEN 'Mecca' THEN 'مكة المكرمة'
          WHEN 'Medina' THEN 'المدينة المنورة'
          WHEN 'Al Qunfudhah' THEN 'القنفذة'
          WHEN 'Jeddah' THEN 'جدة'
          WHEN 'Riyadh' THEN 'الرياض'
          WHEN 'Dammam' THEN 'الدمام'
          WHEN 'Khobar' THEN 'الخبر'
        END,
        city_id = CASE city
          WHEN 'Mecca' THEN 6 WHEN 'Medina' THEN 14 WHEN 'Al Qunfudhah' THEN 1625
          WHEN 'Jeddah' THEN 18 WHEN 'Riyadh' THEN 3 WHEN 'Dammam' THEN 13 WHEN 'Khobar' THEN 31
        END,
        region_id = CASE city
          WHEN 'Mecca' THEN 2 WHEN 'Medina' THEN 3 WHEN 'Al Qunfudhah' THEN 2
          WHEN 'Jeddah' THEN 2 WHEN 'Riyadh' THEN 1 WHEN 'Dammam' THEN 5 WHEN 'Khobar' THEN 5
        END
      WHERE city IN ('Mecca','Medina','Al Qunfudhah','Jeddah','Riyadh','Dammam','Khobar')
        AND city_id IS NULL
    $f$, t);
  END LOOP;
END $$;

-- ── 4. Wire amaall into listing_native_location_v1 — the exact proven pattern from
--       20260906181019 (abwbna/bahadhabab/alobid), self-guarding against a double-run. ─────────
DO $do$
DECLARE
  base text; arms text := ''; t text; anchor text;
BEGIN
  IF position('amaall_residential_listings.city_ar' in pg_get_viewdef('public.listing_native_location_v1'::regclass,true)) > 0 THEN
    RAISE NOTICE 'already wired — skipping';
    RETURN;
  END IF;

  base := rtrim(rtrim(pg_get_viewdef('public.listing_native_location_v1'::regclass,true)),';');

  anchor := 'FROM aldarim_commercial_listings
          WHERE aldarim_commercial_listings.active';
  IF position(anchor in base) = 0 THEN
    RAISE EXCEPTION 'aldarim commercial arm anchor not found — matview shape changed, refusing to guess';
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'amaall_residential_listings','amaall_commercial_listings'] LOOP
    arms := arms || format($f$
        UNION ALL
         SELECT %2$L::text AS platform,
            %1$L::text AS source_table,
            %1$I.id AS listing_id,
            %1$I.city_ar,
            %1$I.city_id,
            %1$I.district_ar,
            %1$I.region_id,
            'native_scraper'::text AS source_method,
            %1$I.transaction_type
           FROM %1$I
          WHERE %1$I.active$f$,
      t, regexp_replace(t, '_(residential|commercial)_listings$', ''));
  END LOOP;

  EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.listing_native_location_v1__mig';
  EXECUTE 'CREATE MATERIALIZED VIEW public.listing_native_location_v1__mig AS ' ||
    replace(base, anchor, anchor || arms);

  EXECUTE 'CREATE UNIQUE INDEX listing_native_location_v1__mig_pk ON public.listing_native_location_v1__mig (source_table, listing_id)';
  EXECUTE 'DROP MATERIALIZED VIEW public.listing_native_location_v1 CASCADE';
  EXECUTE 'ALTER MATERIALIZED VIEW public.listing_native_location_v1__mig RENAME TO listing_native_location_v1';
  EXECUTE 'ALTER INDEX public.listing_native_location_v1__mig_pk RENAME TO listing_native_location_v1_pk';

  -- The CASCADE above takes every dependent view down with it (listing_native_location_v2 and,
  -- transitively, mon_search_index_city_drift / platforms_deprecated_status /
  -- platforms_unsearchable — the 3 that read v2 rather than surviving on some other path). Steps
  -- 5-7 below restore all four unconditionally, which is why this whole block is safe to run even
  -- when the IF-guard above did NOT return early on a partial prior application.
END
$do$;

-- ── 5. listing_native_location_v2 — CREATE OR REPLACE, so re-running is a no-op. Its OWN text is
--       unchanged by amaall joining v1 (v2 just selects v1.* — this is why the same 13,047-char
--       body has been byte-identical since the 2026-09-03 5-platform activation through today's
--       pre_azdad_activation snapshot); recreating it is only ever needed to undo the CASCADE. ──
CREATE OR REPLACE VIEW public.listing_native_location_v2 AS  SELECT v1.platform,
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
    NULL::text AS district_ar,
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
            (g.additional_info ->> 'resolved_region_id'::text)::integer AS region_id
           FROM gathern_residential_listings g
          WHERE a.source_table = 'gathern_residential_listings'::text AND g.id = a.listing_id AND (g.additional_info ->> 'resolved_confidence'::text) = 'city'::text
        UNION ALL
         SELECT (g.additional_info ->> 'resolved_city_id'::text)::integer AS int4,
            (g.additional_info ->> 'resolved_region_id'::text)::integer AS int4
           FROM gathern_commercial_listings g
          WHERE a.source_table = 'gathern_commercial_listings'::text AND g.id = a.listing_id AND (g.additional_info ->> 'resolved_confidence'::text) = 'city'::text) gth ON true
     LEFT JOIN loc_catalog_city gcat ON gcat.city_id = gth.city_id
     LEFT JOIN loc_catalog_region gcr2 ON gcr2.region_id = gth.region_id
  WHERE (a.source_table <> ALL (ARRAY['souq24_residential_listings'::text, 'souq24_commercial_listings'::text])) AND NOT (EXISTS ( SELECT 1
           FROM listing_native_location_v1 v1
          WHERE v1.source_table = a.source_table AND v1.listing_id = a.listing_id));

-- ── 6. The 3 views that read v2 directly (not survivors of the CASCADE by any other path) —
--       CREATE OR REPLACE, unchanged bodies, only ever needed to undo the CASCADE. ─────────────
CREATE OR REPLACE VIEW public.mon_search_index_city_drift AS  SELECT s.source_table,
    s.listing_id,
    s.city_id AS index_city_id,
    n.city_id AS resolved_city_id,
    s.region_id AS index_region_id,
    n.region_id AS resolved_region_id
   FROM search_listings_ar s
     JOIN listing_native_location_v2 n USING (source_table, listing_id)
  WHERE s.city_id IS NOT NULL AND n.city_id IS NOT NULL AND s.city_id <> n.city_id OR s.region_id IS NOT NULL AND n.region_id IS NOT NULL AND s.region_id <> n.region_id;

CREATE OR REPLACE VIEW public.platforms_deprecated_status AS  SELECT platform,
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

CREATE OR REPLACE VIEW public.platforms_unsearchable AS  WITH source_platforms AS (
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

-- ── 7. Grants on listing_native_location_v1 — a MATERIALIZED VIEW does NOT auto-inherit the
--       schema's default privileges the way a plain view does (confirmed live: v2 kept its grants
--       automatically after CREATE OR REPLACE; v1 lost every one after CASCADE dropped and
--       recreated it). GRANT is idempotent — re-running changes nothing if already held. ────────
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
  ON public.listing_native_location_v1 TO anon, authenticated, postgres, service_role;

-- ── 8. SELF-ASSERTION — proves the fix instead of trusting that it ran. ─────────────────────────
DO $check$
DECLARE v_wired boolean; v_n int; v_district text;
BEGIN
  SELECT position('amaall_residential_listings.city_ar' in
    pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) > 0 INTO v_wired;
  IF NOT v_wired THEN
    RAISE EXCEPTION 'amaall was not wired into listing_native_location_v1';
  END IF;

  SELECT count(*) INTO v_n FROM listing_native_location_v2 WHERE source_table like 'amaall_%';
  IF v_n = 0 THEN
    RAISE EXCEPTION 'listing_native_location_v2 returns zero amaall rows — the view chain is broken';
  END IF;

  SELECT district_ar INTO v_district FROM listing_native_location_v2
   WHERE source_table = 'amaall_residential_listings' AND listing_id = 10729176;
  IF v_district IS DISTINCT FROM 'حي العزيزية' THEN
    RAISE EXCEPTION 'expected حي العزيزية for the known-good listing 10729176, got %', v_district;
  END IF;
END
$check$;
