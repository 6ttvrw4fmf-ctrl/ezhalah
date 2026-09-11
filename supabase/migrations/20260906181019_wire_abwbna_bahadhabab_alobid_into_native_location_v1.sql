DO $do$
DECLARE
  base text; arms text := ''; t text; anchor text;
BEGIN
  IF position('abwbna_residential_listings.city_ar' in pg_get_viewdef('public.listing_native_location_v1'::regclass,true)) > 0 THEN
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
    'abwbna_residential_listings','abwbna_commercial_listings',
    'bahadhabab_residential_listings','bahadhabab_commercial_listings',
    'alobid_residential_listings','alobid_commercial_listings'] LOOP
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
END
$do$;

DO $restore$
DECLARE r record; pass int; okc int; last_okc int := -1;
BEGIN
  FOR pass IN 1..8 LOOP
    okc := 0;
    FOR r IN
      SELECT ddl, obj_name, obj_kind FROM ops_ddl_snapshot
      WHERE label='pre_native_location_v1_fix_20260906'
      ORDER BY ordinal, id
    LOOP
      BEGIN
        EXECUTE r.ddl;
        okc := okc + 1;
      EXCEPTION
        WHEN duplicate_table OR duplicate_object THEN okc := okc + 1;
        WHEN OTHERS THEN NULL;
      END;
    END LOOP;
    RAISE NOTICE 'pass %: % succeeded/already-present', pass, okc;
    EXIT WHEN okc = last_okc AND pass > 1;
    last_okc := okc;
  END LOOP;
END
$restore$;

DO $verify$
DECLARE expected_vm int; actual_vm int; expected_grants int; actual_grants int;
BEGIN
  SELECT count(*) INTO expected_vm FROM ops_ddl_snapshot
    WHERE label='pre_native_location_v1_fix_20260906' AND obj_kind IN ('view','matview');
  SELECT count(DISTINCT relname) INTO actual_vm FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND relname IN (
      SELECT obj_name FROM ops_ddl_snapshot
      WHERE label='pre_native_location_v1_fix_20260906' AND obj_kind IN ('view','matview'));
  SELECT count(*) INTO expected_grants FROM ops_ddl_snapshot
    WHERE label='pre_native_location_v1_fix_20260906' AND obj_kind='grant';
  SELECT count(*) INTO actual_grants FROM information_schema.role_table_grants g
    WHERE g.table_schema='public' AND g.table_name IN (
      SELECT DISTINCT obj_name FROM ops_ddl_snapshot
      WHERE label='pre_native_location_v1_fix_20260906' AND obj_kind IN ('view','matview'));
  IF actual_vm < expected_vm OR actual_grants < expected_grants THEN
    RAISE EXCEPTION 'restore incomplete: views/matviews %/%, grants %/%',
      actual_vm, expected_vm, actual_grants, expected_grants;
  END IF;
END
$verify$;