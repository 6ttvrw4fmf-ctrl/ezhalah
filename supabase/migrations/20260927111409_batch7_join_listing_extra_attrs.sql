-- Batch 7 (sirdab, ashab, manafe, wajaf, albukaeri, ryadah, sqcc, daraa, tawia) join listing_extra_attrs — an Advanced-Filter view, so without an arm every one of
-- their listings answers "unknown" to every AF question. Arm shape is batch 6's verbatim, appended to
-- the body read LIVE at apply time; the same short-lock retry loop.
set local statement_timeout = '5min';
DO $do$
DECLARE base text; arms text; t text; i int; ok boolean := false;
  tables text[] := ARRAY['sirdab_residential_listings','sirdab_commercial_listings','ashab_residential_listings','ashab_commercial_listings','manafe_residential_listings','manafe_commercial_listings','wajaf_residential_listings','wajaf_commercial_listings','albukaeri_residential_listings','albukaeri_commercial_listings','ryadah_residential_listings','ryadah_commercial_listings','sqcc_residential_listings','sqcc_commercial_listings','daraa_residential_listings','daraa_commercial_listings','tawia_residential_listings','tawia_commercial_listings'];
BEGIN
  IF position('sirdab_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) > 0 THEN
    RAISE NOTICE 'listing_extra_attrs already carries the batch-7 arms';
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
  RAISE NOTICE 'listing_extra_attrs rebuilt with batch 7 on attempt %', i;
END
$do$;

DO $verify$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sirdab','ashab','manafe','wajaf','albukaeri','ryadah','sqcc','daraa','tawia'] LOOP
    IF position(t || '_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
       OR position(t || '_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
      RAISE EXCEPTION '% did not land in listing_extra_attrs', t;
    END IF;
  END LOOP;
  IF position('arsh_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
     OR position('holoul_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
     OR position('tuba_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
     OR position('nufouth_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'an existing platform arm was dropped while adding the new ones';
  END IF;
  RAISE NOTICE 'batch 7 is in listing_extra_attrs';
END $verify$;