-- أبعاد (abaad) joins listing_rich_attrs — the second Advanced Filter view (utilities, balcony,
-- laundry, majlis/living rooms, coordinates, postal code, instalments).
--
-- Same machinery and same arm shape as 20260924170937 (the thirty-five-platform pass), narrowed to
-- abaad's two tables, appended to the body read LIVE at apply time. abaad's scraper puts its
-- coordinates in additional_info.latitude/longitude — which is exactly what this arm reads — so its
-- map data reaches the AF without a coordinate column existing on any listing table.
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
  IF position('abaad_residential_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) > 0 THEN
    RAISE NOTICE 'listing_rich_attrs already carries the abaad arms';
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
  FOREACH t IN ARRAY ARRAY['abaad',
                           'dwelleo','aqalemhajer','sakani','shatri','alqasem','fkralemar',
                           'wadod','almuteb','aalbarrak','alrifai','sodasyat','hasaad',
                           'aqaralriyadh','justsa','snam','jawher','m3tmd','senan',
                           'goldendeal','thousand','yameen','ebriza','eilmalriyada',
                           'daryusuf','albdah','eydah','tamyaz','hazim','villassa','marksa',
                           'rightcompound','livingcompound','azure','expattrusted','flow'] LOOP
    IF position(t || '_residential_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) = 0
       OR position(t || '_commercial_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) = 0 THEN
      RAISE EXCEPTION '% did not land in listing_rich_attrs', t;
    END IF;
  END LOOP;
  IF position('nufouth_commercial_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) = 0
     OR position('wslnaa_commercial_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'an existing platform arm was dropped while adding abaad';
  END IF;
  RAISE NOTICE 'abaad is in listing_rich_attrs; all earlier arms intact';
END
$verify$;
