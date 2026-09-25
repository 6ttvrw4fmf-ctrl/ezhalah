-- Wave 1's ten platforms join listing_extra_attrs — the Advanced Filter reads this view, so without
-- an arm every one of their listings answers "unknown" to every AF question.
--
-- Same machinery as 20260924170846 (the thirty-five) and 20260925011639 (abaad), widened to twenty
-- tables: the arms are appended to the body read LIVE at apply time, so a change another session made
-- in between is carried forward rather than reverted by a pasted body. Arm shape is the live nufouth
-- arm verbatim.
--
-- APPLY WINDOW: CREATE OR REPLACE VIEW takes ACCESS EXCLUSIVE and the :22 cron reads this view, so
-- this is applied in the :05-:15 part of the hour; lock_timeout makes a collision fail fast and roll
-- the whole file back rather than queueing readers behind it.
set local lock_timeout = '15s';
DO $do$
DECLARE base text; arms text := ''; t text;
  tables text[] := ARRAY[
    'alsaedan_residential_listings','alsaedan_commercial_listings',
    'ego_residential_listings','ego_commercial_listings',
    'muhaysini_residential_listings','muhaysini_commercial_listings',
    'nofodh_residential_listings','nofodh_commercial_listings',
    'razre_residential_listings','razre_commercial_listings',
    'reinvest_residential_listings','reinvest_commercial_listings',
    'safa_residential_listings','safa_commercial_listings',
    'sokok_residential_listings','sokok_commercial_listings',
    'sukna_residential_listings','sukna_commercial_listings',
    'tuba_residential_listings','tuba_commercial_listings'];
BEGIN
  IF position('tuba_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) > 0 THEN
    RAISE NOTICE 'listing_extra_attrs already carries the wave-1 arms';
    RETURN;
  END IF;
  base := rtrim(rtrim(pg_get_viewdef('public.listing_extra_attrs'::regclass,true)),';');
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
END
$do$;

DO $verify$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['alsaedan','ego','muhaysini','nofodh','razre',
                           'reinvest','safa','sokok','sukna','tuba'] LOOP
    IF position(t || '_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
       OR position(t || '_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
      RAISE EXCEPTION '% did not land in listing_extra_attrs', t;
    END IF;
  END LOOP;
  -- the previous passes must still be there: a pasted body would have silently dropped them
  IF position('abaad_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
     OR position('nufouth_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
     OR position('wslnaa_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'an existing platform arm was dropped while adding the wave-1 ones';
  END IF;
  RAISE NOTICE 'wave-1 ten are in listing_extra_attrs';
END $verify$;
