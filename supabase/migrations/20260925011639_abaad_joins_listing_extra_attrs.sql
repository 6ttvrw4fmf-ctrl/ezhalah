-- أبعاد (abaad) joins listing_extra_attrs — the Advanced Filter reads this view, so without this
-- arm every abaad listing answers "unknown" to every AF question.
--
-- Same machinery as 20260924170846 (the thirty-five-platform pass), narrowed to abaad's two tables:
-- the arms are appended to the body read LIVE at apply time, so a change another session made in
-- between is carried forward rather than reverted by a pasted body. Arm shape is the live nufouth
-- arm verbatim, including x.license_number, so abaad's own REGA ad licence (ad_license_number,
-- present on every one of its ~400 records) reaches the AF.
--
-- APPLY WINDOW: CREATE OR REPLACE VIEW takes ACCESS EXCLUSIVE and the :22 cron reads this view, so
-- this is applied in the :05-:15 part of the hour; lock_timeout makes a collision fail fast and roll
-- the whole file back rather than queueing readers behind it.
set local lock_timeout = '15s';
DO $do$
DECLARE base text; arms text := ''; t text;
  tables text[] := ARRAY[
    'abaad_residential_listings','abaad_commercial_listings'];
BEGIN
  IF position('abaad_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) > 0 THEN
    RAISE NOTICE 'listing_extra_attrs already carries the abaad arms';
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
  -- abaad must have landed, and every arm wired earlier today must still be there
  FOREACH t IN ARRAY ARRAY['abaad',
                           'dwelleo','aqalemhajer','sakani','shatri','alqasem','fkralemar',
                           'wadod','almuteb','aalbarrak','alrifai','sodasyat','hasaad',
                           'aqaralriyadh','justsa','snam','jawher','m3tmd','senan',
                           'goldendeal','thousand','yameen','ebriza','eilmalriyada',
                           'daryusuf','albdah','eydah','tamyaz','hazim','villassa','marksa',
                           'rightcompound','livingcompound','azure','expattrusted','flow'] LOOP
    IF position(t || '_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
       OR position(t || '_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
      RAISE EXCEPTION '% did not land in listing_extra_attrs', t;
    END IF;
  END LOOP;
  IF position('nufouth_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
     OR position('wslnaa_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'an existing platform arm was dropped while adding abaad';
  END IF;
  RAISE NOTICE 'abaad is in listing_extra_attrs; all earlier arms intact';
END
$verify$;
