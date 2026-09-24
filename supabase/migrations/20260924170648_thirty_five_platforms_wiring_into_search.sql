-- The thirty-five new platforms JOIN SEARCH: arms on listing_native_location_v1 and
-- active_listing_ids_v2 (the two matviews listing_native_location_v2 → sync_search_listings_ar read).
-- Same splice as 20260921190604 (eleven platforms) and 20260920002703 (seven); nothing else in the
-- database names a platform's tables (re-introspected 2026-09-24: the only objects whose text mentions
-- the last onboarded platform, nufouth, are these two matviews, listing_extra_attrs,
-- listing_rich_attrs and listing_location_index — each has its own migration in this change), so the
-- search sync, the AF RPCs and every count surface pick the new tables up from these views with no
-- allowlist to edit.
--
-- based on LIVE definition, md5(pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) = 024fa413d718ee03c6aa13af77894de7 (51,672 chars) fetched 2026-09-24 15:02:27 UTC
-- based on LIVE definition, md5(pg_get_viewdef('public.active_listing_ids_v2'::regclass, true)) = ab6b24b048172cc335a125ae7de8e4da (89,469 chars) fetched 2026-09-24 15:02:27 UTC
-- The splice reads the LIVE body at apply time (never a body pasted from git), so a later change by
-- another session is carried forward, not reverted. The arms go right after the nufouth commercial
-- arm (the LAST arm the eleven-platform onboarding added, as it sits in the live text — verified
-- 2026-09-24: 'FROM nufouth_commercial_listings' occurs exactly once in each matview, followed by the
-- ksaaqar residential arm) so the rendered v1 text is predictable: the companion
-- …_sql_mirror_expected_catches_up_to_the_thirty_five_platform_arms registers the resulting digest,
-- and it fails loudly if v1 drifted in between.
--
-- DEPENDENTS: every object that depends on either matview is read out of the live catalog a moment
-- before the CASCADE — recursively, ANY relkind (a view OR a matview), with its indexes and ACL —
-- and replayed afterwards in dependency order (the listing_location_index recipe of 20260920003543,
-- which unlike 20260920002703's view-only walk cannot lose a matview). Measured 2026-09-24 the set
-- is unchanged since #3516: listing_native_location_v2, mon_search_index_city_drift,
-- platforms_deprecated_status and platforms_unsearchable; no function, constraint or trigger depends
-- on either matview. The twins are built FIRST, so a bad splice fails on CREATE and the originals are
-- never dropped; Postgres DDL is transactional, so any failure leaves production untouched.
-- APPLY WINDOW: this rebuild takes ACCESS EXCLUSIVE on matviews that cron reads almost continuously
-- (cron 17 refreshes v1/alids_v2 at :20 for up to ~400s, the sync at :22, detectors at :29/:59, the
-- age producer at :44). Apply between :05 and :15 after checking pg_stat_activity for those sessions.
-- The ambient statement_timeout (2 min) counts lock-wait time, so it is raised for THIS transaction
-- only; a failure still rolls the whole file back.
set local statement_timeout = '10min';
-- …but a LOCK wait fails fast: a DROP queued behind the :20/:22 cron would park every new reader
-- (the app's session-start location_index_live read included) behind it for up to 10 minutes.
set local lock_timeout = '15s';
DO $do$
DECLARE
  base text; arms text; t text; anchor text; d record; n_before int; lost text[];
  tables text[] := ARRAY[
    'dwelleo_residential_listings','dwelleo_commercial_listings',
    'aqalemhajer_residential_listings','aqalemhajer_commercial_listings',
    'sakani_residential_listings','sakani_commercial_listings',
    'shatri_residential_listings','shatri_commercial_listings',
    'alqasem_residential_listings','alqasem_commercial_listings',
    'fkralemar_residential_listings','fkralemar_commercial_listings',
    'wadod_residential_listings','wadod_commercial_listings',
    'almuteb_residential_listings','almuteb_commercial_listings',
    'aalbarrak_residential_listings','aalbarrak_commercial_listings',
    'alrifai_residential_listings','alrifai_commercial_listings',
    'sodasyat_residential_listings','sodasyat_commercial_listings',
    'hasaad_residential_listings','hasaad_commercial_listings',
    'aqaralriyadh_residential_listings','aqaralriyadh_commercial_listings',
    'justsa_residential_listings','justsa_commercial_listings',
    'snam_residential_listings','snam_commercial_listings',
    'jawher_residential_listings','jawher_commercial_listings',
    'm3tmd_residential_listings','m3tmd_commercial_listings',
    'senan_residential_listings','senan_commercial_listings',
    'goldendeal_residential_listings','goldendeal_commercial_listings',
    'thousand_residential_listings','thousand_commercial_listings',
    'yameen_residential_listings','yameen_commercial_listings',
    'ebriza_residential_listings','ebriza_commercial_listings',
    'eilmalriyada_residential_listings','eilmalriyada_commercial_listings',
    'daryusuf_residential_listings','daryusuf_commercial_listings',
    'albdah_residential_listings','albdah_commercial_listings',
    'eydah_residential_listings','eydah_commercial_listings',
    'tamyaz_residential_listings','tamyaz_commercial_listings',
    'hazim_residential_listings','hazim_commercial_listings',
    'villassa_residential_listings','villassa_commercial_listings',
    'marksa_residential_listings','marksa_commercial_listings',
    'rightcompound_residential_listings','rightcompound_commercial_listings',
    'livingcompound_residential_listings','livingcompound_commercial_listings',
    'azure_residential_listings','azure_commercial_listings',
    'expattrusted_residential_listings','expattrusted_commercial_listings',
    'flow_residential_listings','flow_commercial_listings'];
  wire_v1 boolean := position('dwelleo_residential_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass,true)) = 0;
  wire_v2 boolean := position('dwelleo_residential_listings' in pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)) = 0;
BEGIN
  IF NOT wire_v1 AND NOT wire_v2 THEN
    RAISE NOTICE 'both matviews already carry the thirty-five platforms - nothing to do';
    RETURN;
  END IF;
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'table % does not exist - apply the thirty_five_platforms_tables migration first', t;
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
    -- Every source table the live body reads must still be read by the twin, checked BEFORE the
    -- original is dropped (79 / 143 tables measured 2026-09-24; the floor catches a broken probe).
    SELECT count(DISTINCT m[1]), array_agg(DISTINCT m[1]) FILTER (WHERE position('FROM ' || m[1] in
             pg_get_viewdef('public.listing_native_location_v1__mig'::regclass,true)) = 0)
      INTO n_before, lost
      FROM regexp_matches(base, 'FROM (\w+_listings)\M', 'g') m;
    IF n_before < 50 OR lost IS NOT NULL THEN
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
    -- Every source table the live body reads must still be read by the twin, checked BEFORE the
    -- original is dropped (79 / 143 tables measured 2026-09-24; the floor catches a broken probe).
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
      CONTINUE;  -- survived: only one matview was rebuilt and this depends on the other alone
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
  FOREACH t IN ARRAY ARRAY['dwelleo','aqalemhajer','sakani','shatri','alqasem','fkralemar',
                           'wadod','almuteb','aalbarrak','alrifai','sodasyat','hasaad',
                           'aqaralriyadh','justsa','snam','jawher','m3tmd','senan',
                           'goldendeal','thousand','yameen','ebriza','eilmalriyada',
                           'daryusuf','albdah','eydah','tamyaz','hazim','villassa','marksa',
                           'rightcompound','livingcompound','azure','expattrusted','flow'] LOOP
    IF position(t || '_commercial_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass,true)) = 0 THEN
      RAISE EXCEPTION '% did not land in listing_native_location_v1', t;
    END IF;
    IF position(t || '_commercial_listings' in pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)) = 0 THEN
      RAISE EXCEPTION '% did not land in active_listing_ids_v2', t;
    END IF;
  END LOOP;
  -- the platforms wired most recently must survive: this CASCADEs the same matviews they use
  IF position('nufouth_commercial_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass,true)) = 0
     OR position('sakan_residential_listings' in pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)) = 0
     OR position('wslnaa_commercial_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass,true)) = 0
     OR position('akariyoun_residential_listings' in pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)) = 0 THEN
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
  RAISE NOTICE 'thirty-five platforms wired into search; existing arms and dependents intact';
END
$verify$;
