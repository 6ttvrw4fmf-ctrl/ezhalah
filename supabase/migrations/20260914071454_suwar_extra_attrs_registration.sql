-- سوار joins listing_extra_attrs — the UNION-ALL-per-platform view that feeds amenity/direction/
-- floor/street-width into listing_native_location_v2 → search_listings_ar → apartment_guided_counts_ar,
-- i.e. EVERY Advanced Filter guided-question count. A platform missing from here has its amenity
-- columns silently read as NULL by AF, fails offersMeaningfulNarrowing trivially, and never gets
-- asked about — the exact amlakalahsa symptom on 2026-09-13 (street width known on 262 rows,
-- surfaced on 0).
--
-- EXTENDED IN PLACE, not chained. listing_extra_attrs is already a thin wrapper
-- (listing_extra_attrs → _v1 → _v0, the 62KB 92-platform base that times out if resubmitted whole).
-- Previous onboardings each renamed the top view and wrapped it again, which is why there is a _v0
-- AND a _v1. Appending UNION ALL arms to the existing top wrapper keeps the output columns
-- identical, so CREATE OR REPLACE is legal, and adds no new link to the chain.
create or replace view public.listing_extra_attrs as
 SELECT listing_extra_attrs_v1.source_table,
    listing_extra_attrs_v1.listing_id,
    listing_extra_attrs_v1.furnished,
    listing_extra_attrs_v1.property_age,
    listing_extra_attrs_v1.direction,
    listing_extra_attrs_v1.street_width_m,
    listing_extra_attrs_v1.floor_number,
    listing_extra_attrs_v1.tenant_category,
    listing_extra_attrs_v1.license_number,
    listing_extra_attrs_v1.elevator,
    listing_extra_attrs_v1.parking,
    listing_extra_attrs_v1.kitchen,
    listing_extra_attrs_v1.air_conditioner,
    listing_extra_attrs_v1.maid_room,
    listing_extra_attrs_v1.driver_room,
    listing_extra_attrs_v1.private_entrance
   FROM listing_extra_attrs_v1
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
UNION ALL
 SELECT 'suwar_residential_listings'::text AS source_table,
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
   FROM suwar_residential_listings x
  WHERE x.active
UNION ALL
 SELECT 'suwar_commercial_listings'::text AS source_table,
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
   FROM suwar_commercial_listings x
  WHERE x.active;

do $verify$
begin
  if position('suwar_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 then
    raise exception 'suwar did not land in listing_extra_attrs';
  end if;
  -- the pre-existing platforms must still be reachable through the wrapper
  if position('aqaralsaudia_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 then
    raise exception 'aqaralsaudia arm was dropped while adding suwar';
  end if;
  if (select count(*) from public.listing_extra_attrs_v1) = 0 then
    raise exception 'the wrapped base view returned nothing — the chain is broken';
  end if;
end $verify$;