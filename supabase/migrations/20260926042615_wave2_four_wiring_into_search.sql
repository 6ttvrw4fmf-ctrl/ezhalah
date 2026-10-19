-- Wave 2's four platforms join search: their eight tables become arms of
-- listing_native_location_v1 and active_listing_ids_v2. Until this runs, the eight tables created by
-- 20260926042334 are tables no search can reach.
--
--   ibaax  remaxsa  qmra  alajlan
--
-- THIS IS THE 20260925081236 MACHINERY VERBATIM (wave-1's, itself abaad's and the thirty-five's),
-- with only the platform list, the presence guards and the post-swap roster changed. Proven path
-- rather than fresh DDL surgery on the matview the whole product reads: capture every dependent's
-- definition/indexes/grants first, refuse to touch anything if the probe returns zero dependents or
-- an empty definition, build a `__mig` twin, assert the twin still reads every source table the live
-- body read, swap, then replay the dependents. Any failed assertion raises and the whole transaction
-- rolls back.
--
-- The twin is CREATE MATERIALIZED VIEW ... AS, which POPULATES, so no window exists in which search
-- reads an empty index: the live matview is dropped only after its populated replacement passed
-- every assertion.
--
-- The dependency capture snapshots definitions AS THEY ARE NOW, so listing_native_location_v2 is
-- replayed WITH the dormant gate added by 20260925005642 — the down-platform rule survives this.
--
-- The post-swap loop checks all four landed AND that wave-1's ten and abaad are still there, because
-- this CASCADEs the same matviews they depend on.

set local statement_timeout = '10min';
-- …but a LOCK wait fails fast: a DROP queued behind the :20/:22 cron would park every new reader
-- (the app's session-start location_index_live read included) behind it for up to 10 minutes.
set local lock_timeout = '15s';
DO $do$
DECLARE
  base text; arms text; t text; anchor text; d record; n_before int; lost text[];
  tables text[] := ARRAY[
    'ibaax_residential_listings','ibaax_commercial_listings',
    'remaxsa_residential_listings','remaxsa_commercial_listings',
    'qmra_residential_listings','qmra_commercial_listings',
    'alajlan_residential_listings','alajlan_commercial_listings'];
  wire_v1 boolean := position('alajlan_residential_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass,true)) = 0;
  wire_v2 boolean := position('alajlan_residential_listings' in pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)) = 0;
BEGIN
  IF NOT wire_v1 AND NOT wire_v2 THEN
    RAISE NOTICE 'both matviews already carry the wave-2 four - nothing to do';
    RETURN;
  END IF;
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'table % does not exist - apply wave2_four_platforms_listing_tables first', t;
    END IF;
  END LOOP;

  CREATE TEMP TABLE _dep_capture_search ON COMMIT DROP AS
  WITH RECURSIVE deps AS (
    SELECT c.oid, c.relkind, 1 AS lvl
      FROM pg_class c
     WHERE c.oid IN (
       SELECT DISTINCT rw.ev_class FROM pg_depend dp JOIN pg_rewrite rw ON rw.oid = dp.objid
        WHERE dp.refobjid IN ('public.listing_native_location_v1'::regclass, 'public.active_listing_ids_v2'::regclass)
          AND dp.deptype = 'n'
          AND rw.ev_class NOT IN ('public.listing_native_location_v1'::regclass, 'public.active_listing_ids_v2'::regclass))
    UNION
    SELECT c2.oid, c2.relkind, deps.lvl + 1
      FROM deps
      JOIN pg_depend d2 ON d2.refobjid = deps.oid AND d2.deptype = 'n'
      JOIN pg_rewrite r2 ON r2.oid = d2.objid
      JOIN pg_class c2 ON c2.oid = r2.ev_class AND c2.oid <> deps.oid
  ), g AS (
    SELECT oid, max(relkind::text) AS relkind, max(lvl) AS ord FROM deps GROUP BY oid
  )
  SELECT c.relname::text AS nm, g.relkind, g.ord,
         pg_get_viewdef(g.oid, true) AS def,
         coalesce((SELECT string_agg(indexdef, ';') FROM pg_indexes
                    WHERE schemaname = 'public' AND tablename = c.relname), '') AS idx,
         coalesce((SELECT string_agg(format('GRANT %s ON public.%I TO %I', a.privilege_type, c.relname,
                                            pg_get_userbyid(a.grantee)), ';')
                     FROM aclexplode(c.relacl) a WHERE a.grantee <> 0), '') AS grants
    FROM g JOIN pg_class c ON c.oid = g.oid;

  IF (SELECT count(*) FROM _dep_capture_search) = 0 THEN
    RAISE EXCEPTION 'captured ZERO dependents - the dependency probe is broken, refusing to drop anything';
  END IF;
  IF EXISTS (SELECT 1 FROM _dep_capture_search WHERE def IS NULL OR btrim(def) = '') THEN
    RAISE EXCEPTION 'a dependent definition came back empty - refusing to drop anything';
  END IF;
  RAISE NOTICE 'captured % dependent(s): %', (SELECT count(*) FROM _dep_capture_search),
    (SELECT string_agg(nm || ':' || relkind, ', ' ORDER BY ord, nm) FROM _dep_capture_search);

  -- ── listing_native_location_v1 ──────────────────────────────────────────────────────────────
  IF wire_v1 THEN
    base := rtrim(rtrim(pg_get_viewdef('public.listing_native_location_v1'::regclass,true)),';');
    anchor := 'FROM nufouth_commercial_listings
          WHERE nufouth_commercial_listings.active';
    IF (length(base) - length(replace(base, anchor, ''))) / length(anchor) <> 1 THEN
      RAISE EXCEPTION 'v1 nufouth commercial arm anchor not found exactly once - matview shape changed, refusing to guess';
    END IF;
    arms := '';
    FOREACH t IN ARRAY tables LOOP
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
    SELECT count(DISTINCT m[1]), array_agg(DISTINCT m[1]) FILTER (WHERE position('FROM ' || m[1] in
             pg_get_viewdef('public.listing_native_location_v1__mig'::regclass,true)) = 0)
      INTO n_before, lost
      FROM regexp_matches(base, 'FROM (\w+_listings)\M', 'g') m;
    IF n_before < 100 OR lost IS NOT NULL THEN
      RAISE EXCEPTION 'listing_native_location_v1 splice: % source tables before, lost %', n_before, lost;
    END IF;
    EXECUTE 'DROP MATERIALIZED VIEW public.listing_native_location_v1 CASCADE';
    EXECUTE 'ALTER MATERIALIZED VIEW public.listing_native_location_v1__mig RENAME TO listing_native_location_v1';
    EXECUTE 'ALTER INDEX public.listing_native_location_v1__mig_pk RENAME TO listing_native_location_v1_pk';
    EXECUTE 'GRANT ALL ON public.listing_native_location_v1 TO postgres, anon, authenticated, service_role';
  END IF;

  -- ── active_listing_ids_v2 ───────────────────────────────────────────────────────────────────
  IF wire_v2 THEN
    base := rtrim(rtrim(pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)),';');
    anchor := 'FROM nufouth_commercial_listings
  WHERE nufouth_commercial_listings.active IS TRUE';
    IF (length(base) - length(replace(base, anchor, ''))) / length(anchor) <> 1 THEN
      RAISE EXCEPTION 'active_listing_ids_v2 nufouth commercial arm anchor not found exactly once - refusing to guess';
    END IF;
    arms := '';
    FOREACH t IN ARRAY tables LOOP
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
    SELECT count(DISTINCT m[1]), array_agg(DISTINCT m[1]) FILTER (WHERE position('FROM ' || m[1] in
             pg_get_viewdef('public.active_listing_ids_v2__mig'::regclass,true)) = 0)
      INTO n_before, lost
      FROM regexp_matches(base, 'FROM (\w+_listings)\M', 'g') m;
    IF n_before < 100 OR lost IS NOT NULL THEN
      RAISE EXCEPTION 'active_listing_ids_v2 splice: % source tables before, lost %', n_before, lost;
    END IF;
    EXECUTE 'DROP MATERIALIZED VIEW public.active_listing_ids_v2 CASCADE';
    EXECUTE 'ALTER MATERIALIZED VIEW public.active_listing_ids_v2__mig RENAME TO active_listing_ids_v2';
    EXECUTE 'ALTER INDEX public.active_listing_ids_v2__mig_pk RENAME TO active_listing_ids_v2_pk';
    EXECUTE 'GRANT ALL ON public.active_listing_ids_v2 TO postgres, anon, authenticated, service_role';
  END IF;

  -- ── replay every captured dependent, in dependency order ────────────────────────────────────
  FOR d IN SELECT * FROM _dep_capture_search ORDER BY ord, nm LOOP
    IF to_regclass('public.' || d.nm) IS NOT NULL THEN
      CONTINUE;
    END IF;
    IF d.relkind = 'm' THEN
      EXECUTE format('CREATE MATERIALIZED VIEW public.%I AS %s', d.nm, rtrim(rtrim(d.def), ';'));
    ELSE
      EXECUTE format('CREATE VIEW public.%I AS %s', d.nm, rtrim(rtrim(d.def), ';'));
    END IF;
    IF d.idx <> '' THEN EXECUTE d.idx; END IF;
    IF d.grants <> '' THEN EXECUTE d.grants; END IF;
  END LOOP;
END
$do$;

DO $verify$
DECLARE t text; missing text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ibaax','remaxsa','qmra','alajlan','tuba','abaad'] LOOP
    IF position(t || '_commercial_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass,true)) = 0 THEN
      RAISE EXCEPTION '% did not land in listing_native_location_v1', t;
    END IF;
    IF position(t || '_commercial_listings' in pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)) = 0 THEN
      RAISE EXCEPTION '% did not land in active_listing_ids_v2', t;
    END IF;
  END LOOP;
  IF position('nufouth_commercial_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass,true)) = 0
     OR position('sakan_residential_listings' in pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'an existing platform was lost while wiring the new ones';
  END IF;
  SELECT string_agg(v, ', ') INTO missing
    FROM unnest(ARRAY['listing_native_location_v2','mon_search_index_city_drift',
                      'platforms_deprecated_status','platforms_unsearchable']) v
   WHERE to_regclass('public.'||v) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'CASCADE ate these and replay did not restore them: %', missing;
  END IF;
  IF (SELECT count(*) FROM public.listing_native_location_v1) = 0
     OR (SELECT count(*) FROM public.active_listing_ids_v2) = 0 THEN
    RAISE EXCEPTION 'a rebuilt matview came back empty';
  END IF;
  RAISE NOTICE 'wave-2 four are wired into search; wave-1, abaad and every dependent intact';
END
$verify$;
