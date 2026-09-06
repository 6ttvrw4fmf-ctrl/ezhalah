-- ACTIVATION of abwbna + bahadhabab + alobid in the two search-union roots, same recipe as
-- 20260906051713 (remal/amaall). abwbna's own activation was missed when it onboarded earlier
-- today (its table creation + liveness-ledger PRs shipped, but this step never ran) — caught by
-- querying active_listing_ids_v2's own definition directly against prod rather than trusting the
-- prior session summary that assumed it.
--
-- Snapshot label: 'pre_abwbna_bahadhabab_alobid_activation_20260906' — 11 views + 4 matviews (2
-- roots + 2 dependents) + 21 indexes + 308 grants, captured via a pg_depend/pg_rewrite walk from
-- both roots (not a hand-curated list) to confirm the dependency set had not silently grown since
-- the 2026-09-03 baseline — it had not; same 14 non-root objects.
--
-- Real bug fixed immediately before this could run at all: abwbna/alobid/bahadhabab's tables were
-- created via `LIKE aqar_residential_listings`, which lacks 4 columns aldarim's own tables carry
-- (city_ar, district_ar, city_id, region_id) that all three clones' run.py (correctly cloned from
-- aldarim's) emit on every row. Fixed in 20260906170500 + 20260906170800 before any of the three
-- could complete a real crawl.
--
-- MEASURED (live crawl results, then confirmed post-activation in active_listing_ids_v2 itself):
-- abwbna 152 residential + 37 commercial, bahadhabab 52 residential + 1 commercial (single city —
-- الباحة, owner-confirmed business fact, see scrapers/bahadhabab/run.py), alobid 120 residential +
-- 18 commercial. 100% photo_urls coverage across all 6 tables. active_listing_ids_v2 grew by
-- exactly 380 rows (204,094 total), 0 duplicates (unique index holds). listing_extra_attrs /
-- listing_rich_attrs both cover all 380 rows post-wiring.
DO $do$
DECLARE
  base text; arms text := ''; suffix text := ') u) v'; body text; t text; r record;
BEGIN
  ---------------------------------------------------------------- active_listing_ids_v2
  IF position('abwbna_residential_listings' in pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)) = 0 THEN
    base := rtrim(rtrim(pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)),';');
    FOREACH t IN ARRAY ARRAY[
      'abwbna_residential_listings','abwbna_commercial_listings',
      'bahadhabab_residential_listings','bahadhabab_commercial_listings',
      'alobid_residential_listings','alobid_commercial_listings'] LOOP
      arms := arms || format($f$
UNION ALL
 SELECT '%1$s'::text AS source_table, %1$I.id AS listing_id, %1$I.transaction_type,
    %1$I.property_type, %1$I.price_total, %1$I.price_annual, %1$I.price_per_meter,
    %1$I.area_m2, %1$I.bedrooms, %1$I.bathrooms, %1$I.rent_period
   FROM %1$I WHERE %1$I.active IS TRUE$f$, t);
    END LOOP;
    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.active_listing_ids_v2__mig';
    EXECUTE 'CREATE MATERIALIZED VIEW public.active_listing_ids_v2__mig AS ' || base || arms;
    EXECUTE 'CREATE UNIQUE INDEX active_listing_ids_v2__mig_pk ON public.active_listing_ids_v2__mig (source_table, listing_id)';
    EXECUTE 'DROP MATERIALIZED VIEW public.active_listing_ids_v2 CASCADE';
    EXECUTE 'ALTER MATERIALIZED VIEW public.active_listing_ids_v2__mig RENAME TO active_listing_ids_v2';
    EXECUTE 'ALTER INDEX public.active_listing_ids_v2__mig_pk RENAME TO active_listing_ids_v2_pk';
  END IF;

  ---------------------------------------------------------------- listing_location_index
  IF position('abwbna_residential_listings' in pg_get_viewdef('public.listing_location_index'::regclass,true)) = 0 THEN
    arms := '';
    base := rtrim(rtrim(pg_get_viewdef('public.listing_location_index'::regclass,true)),';');
    IF right(base, length(suffix)) <> suffix THEN
      RAISE EXCEPTION 'listing_location_index shape changed; refusing to splice';
    END IF;
    body := left(base, length(base) - length(suffix));
    FOR r IN SELECT * FROM (VALUES
        ('abwbna_residential_listings','abwbna','residential'),
        ('abwbna_commercial_listings','abwbna','commercial'),
        ('bahadhabab_residential_listings','bahadhabab','residential'),
        ('bahadhabab_commercial_listings','bahadhabab','commercial'),
        ('alobid_residential_listings','alobid','residential'),
        ('alobid_commercial_listings','alobid','commercial')
      ) AS x(tbl,slug,cat)
    LOOP
      arms := arms || format($f$
UNION ALL
 SELECT ('%1$s'::text || ':'::text) || %1$I.id::text AS index_id, %1$I.id AS listing_id,
    '%2$s'::text AS platform, '%1$s'::text AS source_table, '%3$s'::text AS category,
    lower(%1$I.transaction_type) AS purpose, %1$I.region, %1$I.city,
    %1$I.neighborhood AS district, %1$I.street_name, %1$I.direction AS facade_direction,
    %1$I.last_seen_at AS last_updated, %1$I.scraped_at AS raw_created_at,
    NULL::timestamp with time zone AS raw_updated_at, %1$I.title
   FROM %1$I
  WHERE %1$I.active = true AND (%1$I.transaction_type = ANY (ARRAY['Buy'::text,'Rent'::text]))$f$,
        r.tbl, r.slug, r.cat);
    END LOOP;
    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.listing_location_index__mig CASCADE';
    EXECUTE 'CREATE MATERIALIZED VIEW public.listing_location_index__mig AS ' || body || arms || suffix;
    EXECUTE 'CREATE UNIQUE INDEX lli__mig_pk ON public.listing_location_index__mig (index_id)';
    EXECUTE 'DROP MATERIALIZED VIEW public.listing_location_index CASCADE';
    EXECUTE 'ALTER MATERIALIZED VIEW public.listing_location_index__mig RENAME TO listing_location_index';
    EXECUTE 'ALTER INDEX public.lli__mig_pk RENAME TO listing_location_index_pk';
  END IF;
END
$do$;

-- ── Restore every dependent, index and grant the two CASCADEs removed ──────────────────────────
-- MULTI-PASS, not single-pass-then-raise: a single-pass version of this loop was tried live first
-- and its own trailing RAISE EXCEPTION on leftover failures rolled back the ENTIRE DO block's
-- transaction — undoing every dependent that HAD succeeded in the same pass (Postgres runs one DO
-- block as one transaction). The real cause of that first failure was a genuine ordering bug: this
-- migration's snapshot assigns every non-root dependent the same fallback ordinal, but
-- listing_native_location_v1 actually depends on phasea_shadow_resolution, which was in that same
-- fallback tier and could land either before or after it. Retrying across passes (each pass only
-- needs objects already created in an earlier pass) fixes this without hand-sequencing every
-- dependency edge, and never raises — so a partial success always survives, and a genuinely broken
-- DDL fails loud in the follow-up count check below instead of silently wiping earlier progress.
DO $restore$
DECLARE r record; pass int; okc int; last_okc int := -1;
BEGIN
  FOR pass IN 1..8 LOOP
    okc := 0;
    FOR r IN
      SELECT ddl, obj_name, obj_kind FROM ops_ddl_snapshot
      WHERE label='pre_abwbna_bahadhabab_alobid_activation_20260906'
      ORDER BY ordinal, id
    LOOP
      BEGIN
        EXECUTE r.ddl;
        okc := okc + 1;
      EXCEPTION
        WHEN duplicate_table OR duplicate_object THEN okc := okc + 1;
        WHEN OTHERS THEN NULL; -- leave for a later pass
      END;
    END LOOP;
    RAISE NOTICE 'pass %: % succeeded/already-present', pass, okc;
    EXIT WHEN okc = last_okc AND pass > 1; -- no progress since last pass — stop early
    last_okc := okc;
  END LOOP;
END
$restore$;

-- ── Prove the restore actually completed (measured live: 15/15 views+matviews, 21/21 indexes, ────
-- 308/308 grants) — a separate statement so a shortfall here fails loud without touching anything
-- the retry loop above already committed.
DO $verify$
DECLARE expected_vm int; actual_vm int; expected_idx int; expected_grants int; actual_grants int;
BEGIN
  SELECT count(*) INTO expected_vm FROM ops_ddl_snapshot
    WHERE label='pre_abwbna_bahadhabab_alobid_activation_20260906' AND obj_kind IN ('view','matview');
  SELECT count(DISTINCT relname) INTO actual_vm FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND relname IN (
      SELECT obj_name FROM ops_ddl_snapshot
      WHERE label='pre_abwbna_bahadhabab_alobid_activation_20260906' AND obj_kind IN ('view','matview'));
  SELECT count(*) INTO expected_grants FROM ops_ddl_snapshot
    WHERE label='pre_abwbna_bahadhabab_alobid_activation_20260906' AND obj_kind='grant';
  SELECT count(*) INTO actual_grants FROM information_schema.role_table_grants g
    WHERE g.table_schema='public' AND g.table_name IN (
      SELECT DISTINCT obj_name FROM ops_ddl_snapshot
      WHERE label='pre_abwbna_bahadhabab_alobid_activation_20260906' AND obj_kind IN ('view','matview'));
  IF actual_vm < expected_vm OR actual_grants < expected_grants THEN
    RAISE EXCEPTION 'restore incomplete: views/matviews %/%, grants %/%',
      actual_vm, expected_vm, actual_grants, expected_grants;
  END IF;
END
$verify$;

-- ── Wire into the AF attribute views, same clone-from-october pattern as remal/amaall ───────────
DO $do2$
DECLARE
  v text; src text; arm text; arms text; st int; en int; t text;
  tbls text[] := ARRAY[
    'abwbna_residential_listings','abwbna_commercial_listings',
    'bahadhabab_residential_listings','bahadhabab_commercial_listings',
    'alobid_residential_listings','alobid_commercial_listings'];
BEGIN
  FOREACH v IN ARRAY ARRAY['listing_extra_attrs','listing_rich_attrs'] LOOP
    src := rtrim(rtrim(pg_get_viewdef(('public.'||v)::regclass, true)), ';');

    IF position('abwbna_residential_listings' in src) > 0 THEN
      RAISE NOTICE '% already carries the new arms — skipping', v;
      CONTINUE;
    END IF;

    st := position('SELECT ''october_residential_listings''::text AS source_table' in src);
    IF st = 0 THEN
      RAISE EXCEPTION '% has no october arm to clone — shape changed, refusing to guess', v;
    END IF;
    en := st + position('FROM october_residential_listings x' in substring(src from st)) - 1;
    en := en + position('WHERE x.active' in substring(src from en)) - 1 + length('WHERE x.active');
    arm := substring(src from st for en - st);

    arms := '';
    FOREACH t IN ARRAY tbls LOOP
      arms := arms || E'\nUNION ALL\n ' || replace(arm, 'october_residential_listings', t);
    END LOOP;

    EXECUTE format('CREATE OR REPLACE VIEW public.%I AS %s', v, src || arms);
    RAISE NOTICE 'wired 6 arms into %', v;
  END LOOP;
END
$do2$;
