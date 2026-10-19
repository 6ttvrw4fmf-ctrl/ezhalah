-- Wave 3b (maqam, earthapp, nawafeth) join listing_extra_attrs — the Advanced Filter reads this view, so without an
-- arm every one of their listings answers "unknown" to every AF question.
--
-- The vmksa/macsaib arm shape verbatim, appended to the body read LIVE at apply time so another
-- session's change is carried forward rather than reverted by a pasted body. Same short-lock retry
-- loop. The verify block now also proves the vmksa arm (an existing platform since 2026-09-26)
-- survived, alongside the template's own squares/tuba checks.
set local statement_timeout = '5min';
DO $do$
DECLARE base text; arms text; t text; i int; ok boolean := false;
  tables text[] := ARRAY['maqam_residential_listings','maqam_commercial_listings',
    'earthapp_residential_listings','earthapp_commercial_listings',
    'nawafeth_residential_listings','nawafeth_commercial_listings'];
BEGIN
  IF position('maqam_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) > 0 THEN
    RAISE NOTICE 'listing_extra_attrs already carries the wave-3b arms';
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
  RAISE NOTICE 'listing_extra_attrs rebuilt with the wave-3b three on attempt %', i;
END
$do$;

DO $verify$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['maqam','earthapp','nawafeth'] LOOP
    IF position(t || '_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
       OR position(t || '_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
      RAISE EXCEPTION '% did not land in listing_extra_attrs', t;
    END IF;
  END LOOP;
  IF position('vmksa_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
     OR position('squares_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
     OR position('tuba_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
     OR position('nufouth_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'an existing platform arm was dropped while adding the new ones';
  END IF;
  RAISE NOTICE 'the wave-3b three are in listing_extra_attrs';
END $verify$;
