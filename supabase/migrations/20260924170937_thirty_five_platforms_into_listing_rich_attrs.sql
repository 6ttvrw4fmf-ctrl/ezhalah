-- The thirty-five new platforms join listing_rich_attrs (AF: meters, utilities, balcony, laundry,
-- living/majlis rooms, installments, coordinates, postal code, car entrance, optical fibre).
-- Companion to …_thirty_five_platforms_into_listing_extra_attrs; see that migration for why the two
-- views are rebuilt in separate migrations. Arm shape = the live nufouth arms, verbatim (the same arm
-- 20260921191012 and 20260920003437 wrote; lat/lng come from additional_info 'latitude'/'lat' and
-- 'longitude'/'lng').
--
-- based on LIVE definition, md5(pg_get_viewdef('public.listing_rich_attrs'::regclass, true)) = 8d18fb4811fe56449882c9e37ffa0957 (229,430 chars) fetched 2026-09-24 15:02:27 UTC
-- The arms are appended to the body read LIVE at apply time (the nufouth commercial arm is the last
-- one in the live text, verified 2026-09-24), so a change another session made in between is carried
-- forward, never reverted by a pasted body. Still needed after b697505f: its "self-heal"
-- (20260914111548) was a ONE-SHOT splice, not a job — no cron or function adds branches to this
-- view, so a platform nobody splices here stays invisible to AF (re-checked 2026-09-24: no cron.job
-- command and no function body rewrites listing_rich_attrs).
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
  IF position('dwelleo_residential_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) > 0 THEN
    RAISE NOTICE 'listing_rich_attrs already carries the new arms';
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
  FOREACH t IN ARRAY ARRAY['dwelleo','aqalemhajer','sakani','shatri','alqasem','fkralemar',
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
    RAISE EXCEPTION 'an existing platform arm was dropped while adding the new ones';
  END IF;
  RAISE NOTICE 'thirty-five platforms are in listing_rich_attrs';
END
$verify$;
