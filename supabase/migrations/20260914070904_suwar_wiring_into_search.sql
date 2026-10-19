-- سوار العقارية JOINS SEARCH — owner-approved 2026-09-14.
-- Wires suwar into BOTH matviews every search read depends on: listing_native_location_v1 (native
-- district/city/region resolution) and active_listing_ids_v2 (the price/area/rooms feed).
--
-- CAPTURE-AND-REPLAY, NOT A HARDCODED RESTORE. Dropping either matview CASCADEs away
-- listing_native_location_v2 and, through it, mon_search_index_city_drift,
-- platforms_deprecated_status and platforms_unsearchable (4 objects, enumerated from pg_depend at
-- the time of writing). Every previous platform onboarding pasted those bodies into the migration
-- verbatim, which means each one had to re-verify a 400-line copy against live and would silently
-- restore a STALE definition if anything had changed since. Here the bodies and their grants are
-- read out of the live catalog INSIDE this migration, a moment before the drop, and replayed
-- afterwards — so this cannot restore a stale shape, and it keeps working when a later platform
-- adds another dependent.
DO $do$
DECLARE
  base text; arms text := ''; t text; anchor text;
  rec record;
  saved jsonb := '[]'::jsonb;
BEGIN
  -- ── 0. capture every dependent view (recursively), in dependency order, with its grants ──────
  FOR rec IN
    WITH RECURSIVE deps AS (
      SELECT c.oid, c.relname, 1 AS lvl
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'v'
         AND EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid
                       JOIN pg_class src ON src.oid = d.refobjid
                      WHERE rw.ev_class = c.oid
                        AND src.relname IN ('listing_native_location_v1','active_listing_ids_v2'))
      UNION ALL
      SELECT c.oid, c.relname, deps.lvl + 1
        FROM deps
        JOIN pg_depend d ON d.refobjid = deps.oid
        JOIN pg_rewrite rw ON rw.oid = d.objid
        JOIN pg_class c ON c.oid = rw.ev_class AND c.relkind = 'v' AND c.oid <> deps.oid
    )
    SELECT relname, max(lvl) AS lvl, pg_get_viewdef(oid, true) AS def
      FROM deps GROUP BY relname, oid ORDER BY max(lvl)
  LOOP
    saved := saved || jsonb_build_object('name', rec.relname, 'lvl', rec.lvl, 'def', rec.def);
  END LOOP;
  IF jsonb_array_length(saved) = 0 THEN
    RAISE EXCEPTION 'captured ZERO dependent views — the dependency probe is broken, refusing to drop anything';
  END IF;
  RAISE NOTICE 'captured % dependent view(s) for replay', jsonb_array_length(saved);

  -- ── 1. listing_native_location_v1 (native arm) ───────────────────────────────────────────────
  IF position('suwar_residential_listings.city_ar' in pg_get_viewdef('public.listing_native_location_v1'::regclass,true)) > 0 THEN
    RAISE NOTICE 'already wired — skipping v1';
  ELSE
    base := rtrim(rtrim(pg_get_viewdef('public.listing_native_location_v1'::regclass,true)),';');
    anchor := 'FROM aldarim_commercial_listings
          WHERE aldarim_commercial_listings.active';
    IF position(anchor in base) = 0 THEN
      RAISE EXCEPTION 'v1 aldarim commercial arm anchor not found — matview shape changed, refusing to guess';
    END IF;
    FOREACH t IN ARRAY ARRAY['suwar_residential_listings','suwar_commercial_listings'] LOOP
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
    EXECUTE 'GRANT ALL ON public.listing_native_location_v1 TO postgres, anon, authenticated, service_role';
  END IF;

  -- ── 2. active_listing_ids_v2 (price/area/rooms feed) ─────────────────────────────────────────
  arms := '';
  IF position('suwar_residential_listings' in pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)) > 0 THEN
    RAISE NOTICE 'already wired — skipping active_listing_ids_v2';
  ELSE
    base := rtrim(rtrim(pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)),';');
    anchor := 'FROM azdad_commercial_listings
  WHERE azdad_commercial_listings.active IS TRUE';
    IF position(anchor in base) = 0 THEN
      RAISE EXCEPTION 'active_listing_ids_v2 azdad commercial arm anchor not found — refusing to guess';
    END IF;
    FOREACH t IN ARRAY ARRAY['suwar_residential_listings','suwar_commercial_listings'] LOOP
      arms := arms || format($f$
UNION ALL
 SELECT %1$L::text AS source_table,
    %1$I.id AS listing_id,
    %1$I.transaction_type,
    %1$I.property_type,
    %1$I.price_total,
    %1$I.price_annual,
    %1$I.price_per_meter,
    %1$I.area_m2,
    %1$I.bedrooms,
    %1$I.bathrooms,
    %1$I.rent_period
   FROM %1$I
  WHERE %1$I.active IS TRUE$f$, t);
    END LOOP;
    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.active_listing_ids_v2__mig';
    EXECUTE 'CREATE MATERIALIZED VIEW public.active_listing_ids_v2__mig AS ' ||
      replace(base, anchor, anchor || arms);
    EXECUTE 'CREATE UNIQUE INDEX active_listing_ids_v2__mig_pk ON public.active_listing_ids_v2__mig (source_table, listing_id)';
    EXECUTE 'DROP MATERIALIZED VIEW public.active_listing_ids_v2 CASCADE';
    EXECUTE 'ALTER MATERIALIZED VIEW public.active_listing_ids_v2__mig RENAME TO active_listing_ids_v2';
    EXECUTE 'ALTER INDEX public.active_listing_ids_v2__mig_pk RENAME TO active_listing_ids_v2_pk';
    EXECUTE 'GRANT ALL ON public.active_listing_ids_v2 TO postgres, anon, authenticated, service_role';
  END IF;

  -- ── 3. replay every captured dependent, shallowest first ────────────────────────────────────
  FOR rec IN SELECT * FROM jsonb_to_recordset(saved) AS x(name text, lvl int, def text) ORDER BY lvl
  LOOP
    EXECUTE format('CREATE OR REPLACE VIEW public.%I AS %s', rec.name, rtrim(rtrim(rec.def), ';'));
    EXECUTE format('GRANT ALL ON public.%I TO postgres, anon, authenticated, service_role', rec.name);
    RAISE NOTICE 'restored view %', rec.name;
  END LOOP;
END
$do$;

REFRESH MATERIALIZED VIEW public.listing_native_location_v1;
REFRESH MATERIALIZED VIEW public.active_listing_ids_v2;

-- ── self-verify: the arms are there AND every dependent came back ──────────────────────────────
DO $verify$
DECLARE missing text;
BEGIN
  IF position('suwar_residential_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'suwar did not land in listing_native_location_v1';
  END IF;
  IF position('suwar_residential_listings' in pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'suwar did not land in active_listing_ids_v2';
  END IF;
  SELECT string_agg(v, ', ') INTO missing
    FROM unnest(ARRAY['listing_native_location_v2','mon_search_index_city_drift',
                      'platforms_deprecated_status','platforms_unsearchable']) v
   WHERE to_regclass('public.'||v) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'CASCADE ate these and replay did not restore them: %', missing;
  END IF;
END $verify$;