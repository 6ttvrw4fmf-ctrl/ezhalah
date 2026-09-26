-- Wahadat joins listing_extra_attrs — the Advanced Filter reads this view, so without an arm every
-- one of its listings answers "unknown" to every AF question.
--
-- Same machinery as 20260926042427 (wave-2 four) and 20260925080743 (wave-1 ten), narrowed to two
-- tables: arms are appended to the body read LIVE at apply time, so a change another session made
-- in between is carried forward rather than reverted by a pasted body.
--
-- Wahadat supplies real values for only some of these columns (parking from has_basement_parking,
-- license_number from the project). The rest are absent at source and stay NULL — the honest
-- tri-state the AF already understands: NULL means "the source never said", never "no".
--
-- WHY THE RETRY LOOP (2026-09-26). This view is read continuously by PostgREST and a single 15s
-- attempt at ACCESS EXCLUSIVE lost the race twice against live traffic. Raising lock_timeout would
-- be the wrong fix: a long wait parks every arriving reader behind this request. So each attempt
-- keeps a SHORT 3s lock_timeout — never queueing users for long — and the loop retries into a
-- natural gap. statement_timeout is widened only to cover the loop's own worst case (~100s).
set local statement_timeout = '5min';
DO $do$
DECLARE base text; arms text; t text; i int; ok boolean := false;
  tables text[] := ARRAY['wahadat_residential_listings','wahadat_commercial_listings'];
BEGIN
  IF position('wahadat_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) > 0 THEN
    RAISE NOTICE 'listing_extra_attrs already carries the wahadat arms';
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
  RAISE NOTICE 'listing_extra_attrs rebuilt with wahadat on attempt %', i;
END
$do$;

DO $verify$
BEGIN
  IF position('wahadat_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
     OR position('wahadat_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'wahadat did not land in listing_extra_attrs';
  END IF;
  IF position('tuba_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
     OR position('nufouth_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
     OR position('ibaax_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'an existing platform arm was dropped while adding the wahadat ones';
  END IF;
  RAISE NOTICE 'wahadat is in listing_extra_attrs';
END $verify$;
