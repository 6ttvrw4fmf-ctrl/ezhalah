-- عقاريون joins BOTH Advanced-Filter attribute views — launch-checklist box 8.
-- Without this the platform answers a normal-filter search but is skipped by every AF question
-- (age, direction, street width, floor, amenities); verify-af-attribute-views-cover-every-platform
-- is the barrier that exists for exactly that gap.
--
-- APPENDED, not rewritten. The sibling migrations spell out every arm in full, so each new platform
-- re-states ~50 UNION arms and any drift in an older arm is silently re-frozen. This reads the live
-- definition and appends only the new arms. Arm shapes are copied verbatim from the suwar arms so
-- the column list and types match exactly — a first attempt guessed a shorter list for
-- listing_rich_attrs and Postgres correctly refused it ("each UNION query must have the same number
-- of columns"), which is the right failure: the view shape is not something to infer.
--
-- akariyoun stores its GPS as additional_info->>'lat'/'lng', which the shared latitude/longitude
-- expression already COALESCEs alongside 'latitude'/'longitude'.
DO $do$
DECLARE base text; arms text := ''; t text;
BEGIN
  IF position('akariyoun_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
    base := rtrim(rtrim(pg_get_viewdef('public.listing_extra_attrs'::regclass,true)),';');
    arms := '';
    FOREACH t IN ARRAY ARRAY['akariyoun_residential_listings','akariyoun_commercial_listings'] LOOP
      arms := arms || format($f$
UNION ALL
 SELECT %1$L::text AS source_table,
    x.id AS listing_id, NULL::boolean AS furnished, x.property_age,
    canon_direction_ar(x.direction) AS direction, x.street_width_m, x.floor_number,
    x.tenant_category, NULL::text AS license_number, x.elevator, x.parking, x.kitchen,
    x.air_conditioner, x.maid_room, x.driver_room, x.private_entrance
   FROM %1$I x WHERE x.active$f$, t);
    END LOOP;
    EXECUTE 'CREATE OR REPLACE VIEW public.listing_extra_attrs AS ' || base || arms;
    EXECUTE 'GRANT ALL ON public.listing_extra_attrs TO postgres, anon, authenticated, service_role';
  END IF;

  IF position('akariyoun_residential_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) = 0 THEN
    base := rtrim(rtrim(pg_get_viewdef('public.listing_rich_attrs'::regclass,true)),';');
    arms := '';
    FOREACH t IN ARRAY ARRAY['akariyoun_residential_listings','akariyoun_commercial_listings'] LOOP
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
    NULL::smallint AS living_rooms,
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
  END IF;
END
$do$;

DO $verify$
BEGIN
  IF position('akariyoun_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'akariyoun did not land in listing_extra_attrs';
  END IF;
  IF position('akariyoun_residential_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'akariyoun did not land in listing_rich_attrs';
  END IF;
  -- an existing arm must not have been lost
  IF position('rakez_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
     OR position('suwar_residential_listings' in pg_get_viewdef('public.listing_rich_attrs'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'an existing platform arm was dropped while adding akariyoun';
  END IF;
  IF (SELECT count(*) FROM public.listing_extra_attrs_v1) = 0 THEN
    RAISE EXCEPTION 'the wrapped base view returned nothing — the chain is broken';
  END IF;
END
$verify$;