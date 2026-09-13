-- aqaralsaudia was wired into the search chain (listing_native_location_v1, active_listing_ids_v2,
-- RLS, SEARCHABLE_TABLES) but NOT into listing_extra_attrs — the UNION-ALL-per-platform view that
-- feeds amenities/street-width/direction/floor into every Advanced Filter question. Symptom found by
-- testing as a real user 2026-09-13: 14 of its listings carry elevator=true and the AF amenity
-- filter returned ZERO of them, while bathrooms/rooms/area/price (which come from a different view)
-- all worked. Same class as the amlakalahsa gap fixed in 20260913025049 — a platform can be fully
-- searchable and still be invisible to AF, because these are two different views.
--
-- Same wrapper technique as that fix, and for the same reason: the base view's body is ~2,000 lines
-- and times out when resubmitted whole. Rename the current view aside, recreate the public name as a
-- thin wrapper over it plus this platform's two branches, then recreate the dependent view so its
-- LEFT JOINs rebind to the new wrapper (a rename alone does not move an existing dependent's
-- binding). The dependent body is captured LIVE here rather than pasted, so nothing goes stale.
DO $do$
DECLARE v2_def text; drift_def text; depr_def text; unsearch_def text;
BEGIN
  IF position('aqaralsaudia_residential_listings' in
              pg_get_viewdef('public.listing_extra_attrs'::regclass, true)) > 0 THEN
    RAISE NOTICE 'already registered';
    RETURN;
  END IF;

  v2_def       := pg_get_viewdef('public.listing_native_location_v2'::regclass, true);
  drift_def    := pg_get_viewdef('public.mon_search_index_city_drift'::regclass, true);
  depr_def     := pg_get_viewdef('public.platforms_deprecated_status'::regclass, true);
  unsearch_def := pg_get_viewdef('public.platforms_unsearchable'::regclass, true);

  EXECUTE 'ALTER VIEW public.listing_extra_attrs RENAME TO listing_extra_attrs_v1';

  EXECUTE $v$
    CREATE VIEW public.listing_extra_attrs AS
    SELECT * FROM public.listing_extra_attrs_v1
    UNION ALL
    SELECT 'aqaralsaudia_residential_listings'::text AS source_table,
        x.id AS listing_id,
        NULL::boolean AS furnished,
        x.property_age,
        canon_direction_ar(x.direction) AS direction,
        x.street_width_m,
        x.floor_number,
        x.tenant_category,
        NULL::text AS license_number,
        x.elevator,
        x.parking,
        x.kitchen,
        x.air_conditioner,
        x.maid_room,
        x.driver_room,
        x.private_entrance
       FROM aqaralsaudia_residential_listings x
      WHERE x.active
    UNION ALL
    SELECT 'aqaralsaudia_commercial_listings'::text AS source_table,
        x.id AS listing_id,
        NULL::boolean AS furnished,
        x.property_age,
        canon_direction_ar(x.direction) AS direction,
        x.street_width_m,
        x.floor_number,
        x.tenant_category,
        NULL::text AS license_number,
        x.elevator,
        x.parking,
        x.kitchen,
        x.air_conditioner,
        x.maid_room,
        x.driver_room,
        x.private_entrance
       FROM aqaralsaudia_commercial_listings x
      WHERE x.active
  $v$;

  -- rebind the dependents onto the new wrapper
  EXECUTE 'CREATE OR REPLACE VIEW public.listing_native_location_v2 AS ' || v2_def;
  EXECUTE 'CREATE OR REPLACE VIEW public.mon_search_index_city_drift AS ' || drift_def;
  EXECUTE 'CREATE OR REPLACE VIEW public.platforms_deprecated_status AS ' || depr_def;
  EXECUTE 'CREATE OR REPLACE VIEW public.platforms_unsearchable AS ' || unsearch_def;
END
$do$;

GRANT SELECT ON public.listing_extra_attrs, public.listing_extra_attrs_v1
  TO anon, authenticated, postgres, service_role;

DO $check$
DECLARE v_n int; v_prev int;
BEGIN
  SELECT count(*) INTO v_n FROM public.listing_extra_attrs
   WHERE source_table = 'aqaralsaudia_residential_listings';
  IF v_n = 0 THEN
    RAISE EXCEPTION 'aqaralsaudia still absent from listing_extra_attrs';
  END IF;
  -- the platforms already registered must not have been dropped by the rewrap
  SELECT count(*) INTO v_prev FROM public.listing_extra_attrs
   WHERE source_table = 'amlakalahsa_residential_listings';
  IF v_prev = 0 THEN
    RAISE EXCEPTION 'amlakalahsa fell out of listing_extra_attrs — the wrapper lost the base view';
  END IF;
END
$check$;