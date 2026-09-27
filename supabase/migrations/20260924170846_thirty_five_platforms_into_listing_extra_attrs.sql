-- The thirty-five new platforms join listing_extra_attrs (AF: age, direction, street width, floor,
-- furnished, tenant category, elevator/parking/kitchen/AC/maid/driver/private entrance).
-- One view per migration, as 20260921190754 / 20260920003415: a CREATE OR REPLACE VIEW takes ACCESS
-- EXCLUSIVE, and rebuilding both AF views in one transaction once hit the statement timeout while a
-- monitoring sweep held readers on them. Arm shape = the live nufouth arms, verbatim (x.license_number
-- is read, so a source's own ad licence — aqalemhajer, aalbarrak, villassa, goldendeal, yameen and
-- others write it — reaches the AF; it is NULL wherever a scraper is silent).
--
-- based on LIVE definition, md5(pg_get_viewdef('public.listing_extra_attrs'::regclass, true)) = 4e532e86f1e25bc6dc43de3d5b7f0416 (22,954 chars) fetched 2026-09-24 15:02:27 UTC
-- The arms are appended to the body read LIVE at apply time (the nufouth commercial arm is the last
-- one in the live text, verified 2026-09-24), so a change another session made in between is carried
-- forward, never reverted by a pasted body.
-- APPLY WINDOW: CREATE OR REPLACE VIEW takes ACCESS EXCLUSIVE and sync_all_rich_attrs (cron 28, :22,
-- up to ~6 min) reads these views. Apply in the same :05-:15 session as the wiring migration; a lock
-- wait fails fast instead of queueing readers, and the whole file rolls back.
set local lock_timeout = '15s';
DO $do$
DECLARE base text; arms text := ''; t text;
  tables text[] := ARRAY[
    'dwelleo_residential_listings','dwelleo_commercial_listings',
    'aqalemhajer_residential_listings','aqalemhajer_commercial_listings',
    'sakani_residential_listings','sakani_commercial_listings',
    'shatri_residential_listings','shatri_commercial_listings',
    'alqasem_residential_listings','alqasem_commercial_listings',
    'fkralemar_residential_listings','fkralemar_commercial_listings',
    'wadod_residential_listings','wadod_commercial_listings',
    'almuteb_residential_listings','almuteb_commercial_listings',
    'aalbarrak_residential_listings','aalbarrak_commercial_listings',
    'alrifai_residential_listings','alrifai_commercial_listings',
    'sodasyat_residential_listings','sodasyat_commercial_listings',
    'hasaad_residential_listings','hasaad_commercial_listings',
    'aqaralriyadh_residential_listings','aqaralriyadh_commercial_listings',
    'justsa_residential_listings','justsa_commercial_listings',
    'snam_residential_listings','snam_commercial_listings',
    'jawher_residential_listings','jawher_commercial_listings',
    'm3tmd_residential_listings','m3tmd_commercial_listings',
    'senan_residential_listings','senan_commercial_listings',
    'goldendeal_residential_listings','goldendeal_commercial_listings',
    'thousand_residential_listings','thousand_commercial_listings',
    'yameen_residential_listings','yameen_commercial_listings',
    'ebriza_residential_listings','ebriza_commercial_listings',
    'eilmalriyada_residential_listings','eilmalriyada_commercial_listings',
    'daryusuf_residential_listings','daryusuf_commercial_listings',
    'albdah_residential_listings','albdah_commercial_listings',
    'eydah_residential_listings','eydah_commercial_listings',
    'tamyaz_residential_listings','tamyaz_commercial_listings',
    'hazim_residential_listings','hazim_commercial_listings',
    'villassa_residential_listings','villassa_commercial_listings',
    'marksa_residential_listings','marksa_commercial_listings',
    'rightcompound_residential_listings','rightcompound_commercial_listings',
    'livingcompound_residential_listings','livingcompound_commercial_listings',
    'azure_residential_listings','azure_commercial_listings',
    'expattrusted_residential_listings','expattrusted_commercial_listings',
    'flow_residential_listings','flow_commercial_listings'];
BEGIN
  IF position('dwelleo_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) > 0 THEN
    RAISE NOTICE 'listing_extra_attrs already carries the new arms';
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
  FOREACH t IN ARRAY ARRAY['dwelleo','aqalemhajer','sakani','shatri','alqasem','fkralemar',
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
    RAISE EXCEPTION 'an existing platform arm was dropped while adding the new ones';
  END IF;
  RAISE NOTICE 'thirty-five platforms are in listing_extra_attrs';
END
$verify$;
