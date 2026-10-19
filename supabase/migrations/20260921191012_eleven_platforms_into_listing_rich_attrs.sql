-- The eleven new platforms join listing_rich_attrs (AF: meters, utilities, balcony, laundry,
-- living/majlis rooms, installments, coordinates, postal code, car entrance, optical fibre).
-- Companion to 20260921180200 (listing_extra_attrs); see that migration for why the two views are
-- rebuilt in separate migrations. Arm shape = the live wslnaa arms, verbatim (the same arm
-- 20260920003437 wrote; lat/lng come from additional_info 'latitude'/'lat' and 'longitude'/'lng').
--
-- based on LIVE definition, md5(pg_get_viewdef('public.listing_rich_attrs'::regclass, true)) = f87d426b77946ea43cfd114e0ae75371 (190,906 chars) fetched 2026-09-21 06:30:18 UTC
-- The arms are appended to the body read LIVE at apply time, so a change another session made in
-- between is carried forward, never reverted by a pasted body. Still needed after b697505f: its
-- "self-heal" (20260914111548) was a ONE-SHOT splice, not a job — no cron or function adds
-- branches to this view, so a platform nobody splices here stays invisible to AF (checked
-- 2026-09-21: no cron.job command and no function body rewrites listing_rich_attrs).
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
  IF position('alsidra_residential_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) > 0 THEN
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
  FOREACH t IN ARRAY ARRAY['alsidra','moftah','masar','gomenassat','sakan','bossbih','alshawaf',
                           'ialqarawi','aljassim','almotmkenah','nufouth'] LOOP
    IF position(t || '_residential_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) = 0
       OR position(t || '_commercial_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) = 0 THEN
      RAISE EXCEPTION '% did not land in listing_rich_attrs', t;
    END IF;
  END LOOP;
  IF position('wslnaa_commercial_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'an existing platform arm was dropped while adding the new ones';
  END IF;
  RAISE NOTICE 'eleven platforms are in listing_rich_attrs';
END
$verify$;
