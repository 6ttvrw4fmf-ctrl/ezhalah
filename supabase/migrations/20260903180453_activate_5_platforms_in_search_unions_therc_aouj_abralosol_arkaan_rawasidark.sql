-- ACTIVATION of the 5 new platforms in the search unions (2026-09-03), recorded so the change is
-- reproducible from git rather than existing only as an ad-hoc session action.
--
-- Performed live under the production deploy lock as a staged build + atomic swap:
--   1. active_listing_ids_v2__new and listing_location_index__new were built WITH DATA and indexed
--      while the live objects kept serving (no locks held on them);
--   2. one transaction dropped the two roots CASCADE (13 dependents), renamed the replacements in,
--      renamed their indexes to the canonical names, and restored every dependent + all 364 grants
--      from ops_ddl_snapshot label 'pre_5_platform_activation_20260903'.
-- Verified after: +4,314 rows in both roots, 0 duplicates, 0 unreachable, existing inventory intact.
-- active_listing_ids (v1) was deliberately left untouched — nothing reads it (0 functions, 0 views,
-- 0 cron jobs), so rebuilding it would have added blast radius for no benefit.
--
-- IDEMPOTENT: replaying this on an environment that already carries the arms is a no-op. On one
-- that does not, it regenerates them from whatever the current definition is, which is why the arms
-- are GENERATED from the live catalog rather than pasted — a pasted 270KB union would go stale the
-- moment any other platform is added.
DO $do$
DECLARE
  base text; arms text := ''; suffix text := ') u) v'; body text; t text; r record;
BEGIN
  ---------------------------------------------------------------- active_listing_ids_v2
  IF position('therc_residential_listings' in pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)) = 0 THEN
    base := rtrim(rtrim(pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)),';');
    FOREACH t IN ARRAY ARRAY[
      'therc_residential_listings','therc_commercial_listings',
      'aouj_residential_listings','aouj_commercial_listings',
      'abralosol_residential_listings','abralosol_commercial_listings',
      'arkaan_residential_listings','arkaan_commercial_listings',
      'rawasidark_residential_listings','rawasidark_commercial_listings'] LOOP
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
  IF position('therc_residential_listings' in pg_get_viewdef('public.listing_location_index'::regclass,true)) = 0 THEN
    arms := '';
    base := rtrim(rtrim(pg_get_viewdef('public.listing_location_index'::regclass,true)),';');
    IF right(base, length(suffix)) <> suffix THEN
      RAISE EXCEPTION 'listing_location_index shape changed; refusing to splice';
    END IF;
    body := left(base, length(base) - length(suffix));
    FOR r IN SELECT * FROM (VALUES
        ('therc_residential_listings','therc','residential'),('therc_commercial_listings','therc','commercial'),
        ('aouj_residential_listings','aouj','residential'),('aouj_commercial_listings','aouj','commercial'),
        ('abralosol_residential_listings','abralosol','residential'),('abralosol_commercial_listings','abralosol','commercial'),
        ('arkaan_residential_listings','arkaan','residential'),('arkaan_commercial_listings','arkaan','commercial'),
        ('rawasidark_residential_listings','rawasidark','residential'),('rawasidark_commercial_listings','rawasidark','commercial')
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

select (select count(*) from active_listing_ids_v2) v2_rows,
       (select count(*) from listing_location_index) lli_rows,
       (position('therc_residential_listings' in pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)) > 0) v2_has_new,
       (position('therc_residential_listings' in pg_get_viewdef('public.listing_location_index'::regclass,true)) > 0) lli_has_new;
