-- The seven new platforms join listing_extra_attrs (AF: age, direction, street width, floor,
-- amenities). Split from listing_rich_attrs into its own migration: both rebuilds in one
-- transaction hit the statement timeout while a monitoring sweep held readers on the view, and a
-- CREATE OR REPLACE VIEW needs ACCESS EXCLUSIVE. One view per migration keeps each lock window
-- short. Arm shape copied verbatim from the ksaaqar arms (20260919082157).
DO $do$
DECLARE base text; arms text := ''; t text;
  tables text[] := ARRAY[
    'gudai_residential_listings','gudai_commercial_listings',
    'safera_residential_listings','safera_commercial_listings',
    'alhumaidan_residential_listings','alhumaidan_commercial_listings',
    'aqarnajran_residential_listings','aqarnajran_commercial_listings',
    'fahadalshahri_residential_listings','fahadalshahri_commercial_listings',
    'compoundin_residential_listings','compoundin_commercial_listings',
    'wslnaa_residential_listings','wslnaa_commercial_listings'];
BEGIN
  IF position('gudai_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) > 0 THEN
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
    x.tenant_category, NULL::text AS license_number, x.elevator, x.parking, x.kitchen,
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
  FOREACH t IN ARRAY ARRAY['gudai_residential_listings','safera_residential_listings',
                           'alhumaidan_residential_listings','aqarnajran_residential_listings',
                           'fahadalshahri_residential_listings','compoundin_residential_listings',
                           'wslnaa_residential_listings'] LOOP
    IF position(t in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
      RAISE EXCEPTION '% did not land in listing_extra_attrs', t;
    END IF;
  END LOOP;
  IF position('ksaaqar_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'an existing platform arm was dropped while adding the new ones';
  END IF;
  RAISE NOTICE 'seven platforms are in listing_extra_attrs';
END
$verify$;
