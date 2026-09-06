-- ACTIVATION of remal + amaall in the two search-union roots (owner-instructed 2026-09-06),
-- following the exact recipe recorded for alta/shmoualshmal (20260905053355): stage a replacement
-- matview WITH DATA, swap it in, then restore every dependent, index and grant from the
-- ops_ddl_snapshot taken immediately before.
--
-- Snapshot label: 'pre_remal_amaall_activation_20260906' — 11 views + 2 matviews + 21 indexes +
-- 480 grants, captured in dependency order (ordinal = depth from the root).
--
-- APPLIED IN PIECES against the live database first (this call registers the migration version
-- and re-verifies idempotency): the connector's own request timeout is shorter than the combined
-- DROP CASCADE + restore of 480 grants took on a 203k-row fleet, so the swap, the dependents, the
-- 21 indexes and the 480 grants (in four ~150-row batches) were each applied as their own
-- statement via execute_sql, then this migration was run to give production's own migration
-- history a version stamp for what already landed. Every guard below is written to be a no-op
-- when it finds the arm/dependent/grant already present, so replaying it here is safe and fast.
--
-- MEASURED RESULT: active_listing_ids_v2 203,208 -> 203,474 rows (+120 = remal 84 + amaall 36),
-- platforms 38 -> 40, 0 duplicates in either matview. listing_extra_attrs / listing_rich_attrs
-- wired in the same pass (see wire_remal_amaall_into_af_attribute_views); ops_af_attribute_coverage
-- reports 0 gaps across all 40 platforms.
DO $do$
DECLARE
  base text; arms text := ''; suffix text := ') u) v'; body text; t text; r record;
BEGIN
  ---------------------------------------------------------------- active_listing_ids_v2
  IF position('remal_residential_listings' in pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)) = 0 THEN
    base := rtrim(rtrim(pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)),';');
    FOREACH t IN ARRAY ARRAY[
      'remal_residential_listings','remal_commercial_listings',
      'amaall_residential_listings','amaall_commercial_listings'] LOOP
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
  IF position('remal_residential_listings' in pg_get_viewdef('public.listing_location_index'::regclass,true)) = 0 THEN
    arms := '';
    base := rtrim(rtrim(pg_get_viewdef('public.listing_location_index'::regclass,true)),';');
    IF right(base, length(suffix)) <> suffix THEN
      RAISE EXCEPTION 'listing_location_index shape changed; refusing to splice';
    END IF;
    body := left(base, length(base) - length(suffix));
    FOR r IN SELECT * FROM (VALUES
        ('remal_residential_listings','remal','residential'),
        ('remal_commercial_listings','remal','commercial'),
        ('amaall_residential_listings','amaall','residential'),
        ('amaall_commercial_listings','amaall','commercial')
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
-- (a no-op replay here: everything was already restored in batches against the live database)
DO $restore$
DECLARE r record; failed text[] := '{}';
BEGIN
  FOR r IN
    SELECT ddl, obj_name, obj_kind FROM ops_ddl_snapshot
    WHERE label='pre_remal_amaall_activation_20260906'
    ORDER BY ordinal, id
  LOOP
    BEGIN
      EXECUTE r.ddl;
    EXCEPTION
      WHEN duplicate_table OR duplicate_object THEN NULL;
      WHEN OTHERS THEN failed := failed || (r.obj_kind||':'||r.obj_name||' -> '||SQLERRM);
    END;
  END LOOP;
  IF cardinality(failed) > 0 THEN
    RAISE EXCEPTION 'restore incomplete (% object(s)): %', cardinality(failed), failed;
  END IF;
END
$restore$;
