-- العروض العقارية JOINS SEARCH — owner-approved 2026-09-13. Wires aqaralsaudia into the two
-- matviews every search read depends on: listing_native_location_v1 (native district/city/region
-- arm) and active_listing_ids_v2 (the price/area/rooms feed).
--
-- DIFFERENCE FROM THE EARLIER PLATFORM MIGRATIONS, ON PURPOSE: those embedded a hand-copied 400-line
-- body of listing_native_location_v2 and its 3 dependents to restore them after the CASCADE. That
-- text goes stale the moment any other platform lands, and a stale restore silently un-wires whoever
-- was added in between. Here the dependent definitions are CAPTURED FROM THE LIVE CATALOG at the top
-- of this migration and replayed verbatim afterwards, so whatever is current is what comes back —
-- there is nothing to copy and nothing to drift.
--
-- Failure containment: each matview is rebuilt as a `__mig` copy FIRST. If the rewritten SQL is
-- wrong, that CREATE fails and the original is never dropped.
DO $do$
DECLARE
  v2_def text; drift_def text; depr_def text; unsearch_def text;
  base text; arms text := ''; t text; anchor text;
BEGIN
  IF position('aqaralsaudia_residential_listings' in
              pg_get_viewdef('public.listing_native_location_v1'::regclass,true)) > 0 THEN
    RAISE NOTICE 'already wired — nothing to do';
    RETURN;
  END IF;

  -- ── capture every dependent the CASCADEs will take, exactly as it is right now ────────────────
  v2_def       := pg_get_viewdef('public.listing_native_location_v2'::regclass, true);
  drift_def    := pg_get_viewdef('public.mon_search_index_city_drift'::regclass, true);
  depr_def     := pg_get_viewdef('public.platforms_deprecated_status'::regclass, true);
  unsearch_def := pg_get_viewdef('public.platforms_unsearchable'::regclass, true);

  -- ── 1. listing_native_location_v1 (native arm) ───────────────────────────────────────────────
  base := rtrim(rtrim(pg_get_viewdef('public.listing_native_location_v1'::regclass,true)),';');
  anchor := 'FROM amlakalahsa_commercial_listings
          WHERE amlakalahsa_commercial_listings.active';
  IF position(anchor in base) = 0 THEN
    RAISE EXCEPTION 'v1 anchor not found — matview shape changed, refusing to guess';
  END IF;
  arms := '';
  FOREACH t IN ARRAY ARRAY['aqaralsaudia_residential_listings','aqaralsaudia_commercial_listings'] LOOP
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

  -- ── 2. active_listing_ids_v2 (price/area/rooms feed) ─────────────────────────────────────────
  base := rtrim(rtrim(pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)),';');
  anchor := 'FROM amlakalahsa_commercial_listings
  WHERE amlakalahsa_commercial_listings.active IS TRUE';
  IF position(anchor in base) = 0 THEN
    RAISE EXCEPTION 'active_listing_ids_v2 anchor not found — refusing to guess';
  END IF;
  arms := '';
  FOREACH t IN ARRAY ARRAY['aqaralsaudia_residential_listings','aqaralsaudia_commercial_listings'] LOOP
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

  -- ── 3. restore the captured dependents, in dependency order ──────────────────────────────────
  EXECUTE 'CREATE OR REPLACE VIEW public.listing_native_location_v2 AS ' || v2_def;
  EXECUTE 'CREATE OR REPLACE VIEW public.mon_search_index_city_drift AS ' || drift_def;
  EXECUTE 'CREATE OR REPLACE VIEW public.platforms_deprecated_status AS ' || depr_def;
  EXECUTE 'CREATE OR REPLACE VIEW public.platforms_unsearchable AS ' || unsearch_def;
END
$do$;

GRANT SELECT ON public.listing_native_location_v1, public.active_listing_ids_v2,
  public.listing_native_location_v2, public.mon_search_index_city_drift,
  public.platforms_deprecated_status, public.platforms_unsearchable
  TO anon, authenticated, postgres, service_role;

-- ── self-assert: wired, and the whole chain still answers ────────────────────────────────────────
DO $check$
BEGIN
  IF position('aqaralsaudia_residential_listings.city_ar' in
              pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) = 0 THEN
    RAISE EXCEPTION 'aqaralsaudia not wired into listing_native_location_v1';
  END IF;
  IF position('aqaralsaudia_residential_listings' in
              pg_get_viewdef('public.active_listing_ids_v2'::regclass, true)) = 0 THEN
    RAISE EXCEPTION 'aqaralsaudia not wired into active_listing_ids_v2';
  END IF;
  -- the dependents must exist AND still be readable (a stale restore would have broken them)
  PERFORM 1 FROM public.listing_native_location_v2 LIMIT 1;
  PERFORM 1 FROM public.mon_search_index_city_drift LIMIT 1;
  PERFORM 1 FROM public.platforms_deprecated_status LIMIT 1;
  PERFORM 1 FROM public.platforms_unsearchable LIMIT 1;
  -- and the platforms added before this one must still be present (the stale-restore trap)
  IF position('amlakalahsa_residential_listings' in
              pg_get_viewdef('public.active_listing_ids_v2'::regclass, true)) = 0 THEN
    RAISE EXCEPTION 'amlakalahsa fell out of active_listing_ids_v2 — a stale restore un-wired it';
  END IF;
END
$check$;