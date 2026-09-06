-- ACTIVATION of alta + shmoualshmal in the two search-union roots (owner-instructed 2026-09-05),
-- following the exact recipe recorded for the 2026-09-03 five-platform activation
-- (20260903180453): stage a replacement matview WITH DATA, swap it in, then restore every
-- dependent, index and grant from the ops_ddl_snapshot taken immediately before.
--
-- Snapshot label: 'pre_alta_shmoualshmal_activation_20260905' — 11 views + 2 matviews + 21 indexes
-- + 480 grants, captured in dependency order (ordinal = depth from the root).
--
-- Baseline immediately before: active_listing_ids_v2 200,884 rows / 36 platforms;
-- listing_location_index 197,439. Expected delta: +13 rows in both (alta 7 active, shmoualshmal 6)
-- and 38 platforms. alta's other 9 rows are source-confirmed sold/rented and carry active=false,
-- so the union's `active IS TRUE` predicate correctly excludes them.
--
-- IDEMPOTENT: each half is guarded on whether the arm is already present in the live definition,
-- and the arms are GENERATED from the current catalog rather than pasted, so replaying this after
-- another platform lands does not resurrect a stale union.
DO $do$
DECLARE
  base text; arms text := ''; suffix text := ') u) v'; body text; t text; r record;
BEGIN
  ---------------------------------------------------------------- active_listing_ids_v2
  IF position('alta_residential_listings' in pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)) = 0 THEN
    base := rtrim(rtrim(pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)),';');
    FOREACH t IN ARRAY ARRAY[
      'alta_residential_listings','alta_commercial_listings',
      'shmoualshmal_residential_listings','shmoualshmal_commercial_listings'] LOOP
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
  IF position('alta_residential_listings' in pg_get_viewdef('public.listing_location_index'::regclass,true)) = 0 THEN
    arms := '';
    base := rtrim(rtrim(pg_get_viewdef('public.listing_location_index'::regclass,true)),';');
    IF right(base, length(suffix)) <> suffix THEN
      RAISE EXCEPTION 'listing_location_index shape changed; refusing to splice';
    END IF;
    body := left(base, length(base) - length(suffix));
    FOR r IN SELECT * FROM (VALUES
        ('alta_residential_listings','alta','residential'),
        ('alta_commercial_listings','alta','commercial'),
        ('shmoualshmal_residential_listings','shmoualshmal','residential'),
        ('shmoualshmal_commercial_listings','shmoualshmal','commercial')
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
DO $restore$
DECLARE r record; failed text[] := '{}';
BEGIN
  FOR r IN
    SELECT ddl, obj_name, obj_kind FROM ops_ddl_snapshot
    WHERE label='pre_alta_shmoualshmal_activation_20260905'
    ORDER BY ordinal, id
  LOOP
    BEGIN
      EXECUTE r.ddl;
    EXCEPTION
      -- an object/index/grant that survived the CASCADE is already correct; anything else is real
      WHEN duplicate_table OR duplicate_object THEN NULL;
      WHEN OTHERS THEN failed := failed || (r.obj_kind||':'||r.obj_name||' -> '||SQLERRM);
    END;
  END LOOP;
  IF cardinality(failed) > 0 THEN
    RAISE EXCEPTION 'restore incomplete (% object(s)): %', cardinality(failed), failed;
  END IF;
END
$restore$;
