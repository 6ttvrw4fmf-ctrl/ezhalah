-- The eleven new platforms join listing_extra_attrs (AF: age, direction, street width, floor,
-- furnished, tenant category, elevator/parking/kitchen/AC/maid/driver/private entrance).
-- One view per migration, as 20260920003415: a CREATE OR REPLACE VIEW takes ACCESS EXCLUSIVE, and
-- rebuilding both AF views in one transaction once hit the statement timeout while a monitoring
-- sweep held readers on them. Arm shape = the live wslnaa arms, except license_number: the wslnaa
-- arm hard-codes NULL::text, which would hide the source's own ad licence (ialqarawi writes the
-- column from «ترخيص الإعلان»). x.license_number is NULL wherever a scraper is silent.
--
-- based on LIVE definition, md5(pg_get_viewdef('public.listing_extra_attrs'::regclass, true)) = 98efeac1d09265f72c66904464259b08 (12,964 chars) fetched 2026-09-21 06:30:18 UTC
-- The arms are appended to the body read LIVE at apply time, so a change another session made in
-- between is carried forward, never reverted by a pasted body.
-- APPLY WINDOW: CREATE OR REPLACE VIEW takes ACCESS EXCLUSIVE and sync_all_rich_attrs (cron 28, :22,
-- up to ~6 min) reads these views. Apply in the same :05-:15 session as 180100/180500; a lock wait
-- fails fast instead of queueing readers, and the whole file rolls back.
set local lock_timeout = '15s';
DO $do$
DECLARE base text; arms text := ''; t text;
  tables text[] := ARRAY[
    'alsidra_residential_listings','alsidra_commercial_listings',
    'moftah_residential_listings','moftah_commercial_listings',
    'masar_residential_listings','masar_commercial_listings',
    'gomenassat_residential_listings','gomenassat_commercial_listings',
    'sakan_residential_listings','sakan_commercial_listings',
    'bossbih_residential_listings','bossbih_commercial_listings',
    'alshawaf_residential_listings','alshawaf_commercial_listings',
    'ialqarawi_residential_listings','ialqarawi_commercial_listings',
    'aljassim_residential_listings','aljassim_commercial_listings',
    'almotmkenah_residential_listings','almotmkenah_commercial_listings',
    'nufouth_residential_listings','nufouth_commercial_listings'];
BEGIN
  IF position('alsidra_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) > 0 THEN
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
  FOREACH t IN ARRAY ARRAY['alsidra','moftah','masar','gomenassat','sakan','bossbih','alshawaf',
                           'ialqarawi','aljassim','almotmkenah','nufouth'] LOOP
    IF position(t || '_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
       OR position(t || '_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
      RAISE EXCEPTION '% did not land in listing_extra_attrs', t;
    END IF;
  END LOOP;
  IF position('wslnaa_commercial_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'an existing platform arm was dropped while adding the new ones';
  END IF;
  RAISE NOTICE 'eleven platforms are in listing_extra_attrs';
END
$verify$;
