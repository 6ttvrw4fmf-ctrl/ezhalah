-- THREE OF THE FIVE SOURCES LAUNCH STEP (asasmakeen, mrajhi, steam; owner said launch 2026-11-05; KW + Almajdiah launch separately) — apply ONLY when the owner says launch (docs/ops/FIVE_SOURCES_LAUNCH.md), in file order.
-- Generated 2026-11-05 from the APPLIED Property Finder launch migration 20261104181014 (the newest shape of this step) with the
-- platform list changed to the three sources (Asas Makeen, Al Rajhi, STeam). It refuses if the live shape moved: re-generate, never force.
-- Property Finder joins listing_extra_attrs (owner 2026-10-16, licensed offers only) — an Advanced-Filter view, so without an arm every one of
-- their listings answers "unknown" to every AF question. Arm shape is batch 6's verbatim, appended to
-- the body read LIVE at apply time; the same short-lock retry loop.
set local statement_timeout = '5min';
set local client_min_messages = warning;  -- the Management API drops the HTTP call at ~2 min (524); a NOTICE sent
                                           -- to that gone client kills the backend (Broken pipe, KW 02 2026-11-05) —
                                           -- so nothing is sent until COMMIT. RAISE EXCEPTION still aborts.
DO $do$
DECLARE base text; arms text; t text; i int; ok boolean := false;
  tables text[] := ARRAY['asasmakeen_residential_listings','asasmakeen_commercial_listings','mrajhi_residential_listings','mrajhi_commercial_listings','steam_residential_listings','steam_commercial_listings'];
BEGIN
  IF position('asasmakeen_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) > 0 THEN
    RAISE NOTICE 'listing_extra_attrs already carries the three sources (Asas Makeen, Al Rajhi, STeam) arms';
    RETURN;
  END IF;
  FOR i IN 1..20 LOOP
    BEGIN
      SET LOCAL lock_timeout = '3s';
      base := rtrim(rtrim(pg_get_viewdef('public.listing_extra_attrs'::regclass,true)),';');
      arms := '';
      FOREACH t IN ARRAY tables LOOP
        arms := arms || format($f$
UNION ALL
 SELECT %1$L::text AS source_table,
    x.id AS listing_id, x.furnished, x.property_age,
    canon_direction_ar(x.direction) AS direction, x.street_width_m, x.floor_number,
    x.tenant_category, x.license_number, x.elevator, x.parking, x.kitchen,
    x.air_conditioner, x.maid_room, x.driver_room, x.private_entrance
   FROM %1$I x WHERE x.active$f$, t);
      END LOOP;
      EXECUTE 'CREATE OR REPLACE VIEW public.listing_extra_attrs AS ' || base || arms;
      EXECUTE 'GRANT ALL ON public.listing_extra_attrs TO postgres, anon, authenticated, service_role';
      ok := true;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(2);
    END;
  END LOOP;
  IF NOT ok THEN
    RAISE EXCEPTION 'could not acquire ACCESS EXCLUSIVE on listing_extra_attrs after 20 short attempts - traffic never gapped; retry later';
  END IF;
  RAISE NOTICE 'listing_extra_attrs rebuilt with the three sources (Asas Makeen, Al Rajhi, STeam) on attempt %', i;
END
$do$;

DO $verify$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['asasmakeen','mrajhi','steam'] LOOP
    IF position(t || '_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
       OR position(t || '_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
      RAISE EXCEPTION '% did not land in listing_extra_attrs', t;
    END IF;
  END LOOP;
  IF position('maktab_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
     OR position('holoul_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
     OR position('tuba_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
     OR position('nufouth_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'an existing platform arm was dropped while adding the new ones';
  END IF;
  RAISE NOTICE 'the three sources (Asas Makeen, Al Rajhi, STeam) are in listing_extra_attrs';
END $verify$;