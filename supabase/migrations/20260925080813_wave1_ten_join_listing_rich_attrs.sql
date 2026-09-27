-- Wave 1's ten platforms join listing_rich_attrs — the second Advanced-Filter view. Without an arm
-- every one of their listings answers "unknown" to every rich AF question (pool, gym, meters,
-- coordinates, majlis/living rooms, postal code, fibre, car entrance).
--
-- Same machinery as 20260924170937 (the thirty-five) and 20260925011717 (abaad), widened to twenty
-- tables: the arms are appended to the body read LIVE at apply time, so a change another session made
-- in between is carried forward rather than reverted by a pasted body. Arm shape is the live nufouth
-- arm verbatim, including x.license_number reaching the AF.
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
  IF position('tuba_residential_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) > 0 THEN
    RAISE NOTICE 'listing_rich_attrs already carries the wave-1 arms';
    RETURN;
  END IF;
  base := rtrim(rtrim(pg_get_viewdef('public.listing_rich_attrs'::regclass,true)),';');
  FOREACH t IN ARRAY tables LOOP
    arms := arms || format($f$
UNION ALL
 SELECT %1$L::text AS source_table,
    x.id AS listing_id,
    NULL::text AS ac_type,
    NULL::text AS kitchen_status,
    NULL::text AS furnishing_level,
    NULL::smallint AS parking_count,
    NULL::text AS parking_type,
    x.rent_now_pay_later AS installment_available,
        CASE
            WHEN x.rent_now_pay_later THEN x.rent_now_pay_later_monthly::numeric
            ELSE NULL::numeric
        END AS installment_amount,
    NULL::smallint AS installment_count,
    x.separate_electricity_meter,
    x.separate_water_meter,
    x.electricity,
    x.water_supply,
    x.sanitation,
    x.balcony_terrace AS balcony,
    x.laundry_room,
    NULL::boolean AS pool,
    NULL::boolean AS gym,
    NULL::boolean AS garden,
    x.halls AS living_rooms,
    x.reception_rooms_majlis AS majlis_rooms,
    NULL::smallint AS total_floors,
    NULL::smallint AS frontage_count,
        CASE
            WHEN COALESCE(x.additional_info ->> 'latitude'::text, x.additional_info ->> 'lat'::text) ~ '^-?[0-9.]+$'::text THEN COALESCE(x.additional_info ->> 'latitude'::text, x.additional_info ->> 'lat'::text)::numeric
            ELSE NULL::numeric
        END AS latitude,
        CASE
            WHEN COALESCE(x.additional_info ->> 'longitude'::text, x.additional_info ->> 'lng'::text) ~ '^-?[0-9.]+$'::text THEN COALESCE(x.additional_info ->> 'longitude'::text, x.additional_info ->> 'lng'::text)::numeric
            ELSE NULL::numeric
        END AS longitude,
    NULL::text AS rega_license_status,
    NULLIF(btrim(COALESCE(x.zip_code, ''::text)), ''::text) AS postal_code,
    NULL::text AS deed_location_text,
    x.car_entrance,
    x.optical_fibers
   FROM %1$I x
  WHERE x.active$f$, t);
  END LOOP;
  EXECUTE 'CREATE OR REPLACE VIEW public.listing_rich_attrs AS ' || base || arms;
  EXECUTE 'GRANT ALL ON public.listing_rich_attrs TO postgres, anon, authenticated, service_role';
END
$do$;

DO $verify$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['alsaedan','ego','muhaysini','nofodh','razre',
                           'reinvest','safa','sokok','sukna','tuba'] LOOP
    IF position(t || '_residential_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) = 0
       OR position(t || '_commercial_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) = 0 THEN
      RAISE EXCEPTION '% did not land in listing_rich_attrs', t;
    END IF;
  END LOOP;
  IF position('abaad_commercial_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) = 0
     OR position('nufouth_commercial_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) = 0
     OR position('wslnaa_commercial_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'an existing platform arm was dropped while adding the wave-1 ones';
  END IF;
  RAISE NOTICE 'wave-1 ten are in listing_rich_attrs';
END $verify$;
