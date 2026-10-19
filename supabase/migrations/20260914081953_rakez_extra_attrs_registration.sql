-- راكز joins listing_extra_attrs — the view feeding amenity/direction/floor/street-width into
-- listing_native_location_v2 → search_listings_ar → apartment_guided_counts_ar, i.e. every Advanced
-- Filter guided-question count. A platform missing from here has its amenity columns silently read
-- as NULL by AF and never gets asked about (the amlakalahsa symptom, 2026-09-13).
--
-- Extended IN PLACE on the existing top wrapper, adding no new link to the
-- listing_extra_attrs → _v1 → _v0 chain. floor_number matters here specifically: rakez publishes a
-- per-unit floor, which most sibling platforms do not.
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
    x.id AS listing_id, NULL::boolean AS furnished, x.property_age,
    canon_direction_ar(x.direction) AS direction, x.street_width_m, x.floor_number,
    x.tenant_category, NULL::text AS license_number, x.elevator, x.parking, x.kitchen,
    x.air_conditioner, x.maid_room, x.driver_room, x.private_entrance
   FROM aqaralsaudia_residential_listings x WHERE x.active
UNION ALL
 SELECT 'aqaralsaudia_commercial_listings'::text AS source_table,
    x.id AS listing_id, NULL::boolean AS furnished, x.property_age,
    canon_direction_ar(x.direction) AS direction, x.street_width_m, x.floor_number,
    x.tenant_category, NULL::text AS license_number, x.elevator, x.parking, x.kitchen,
    x.air_conditioner, x.maid_room, x.driver_room, x.private_entrance
   FROM aqaralsaudia_commercial_listings x WHERE x.active
UNION ALL
 SELECT 'suwar_residential_listings'::text AS source_table,
    x.id AS listing_id, NULL::boolean AS furnished, x.property_age,
    canon_direction_ar(x.direction) AS direction, x.street_width_m, x.floor_number,
    x.tenant_category, NULL::text AS license_number, x.elevator, x.parking, x.kitchen,
    x.air_conditioner, x.maid_room, x.driver_room, x.private_entrance
   FROM suwar_residential_listings x WHERE x.active
UNION ALL
 SELECT 'suwar_commercial_listings'::text AS source_table,
    x.id AS listing_id, NULL::boolean AS furnished, x.property_age,
    canon_direction_ar(x.direction) AS direction, x.street_width_m, x.floor_number,
    x.tenant_category, NULL::text AS license_number, x.elevator, x.parking, x.kitchen,
    x.air_conditioner, x.maid_room, x.driver_room, x.private_entrance
   FROM suwar_commercial_listings x WHERE x.active
UNION ALL
 SELECT 'rakez_residential_listings'::text AS source_table,
    x.id AS listing_id, NULL::boolean AS furnished, x.property_age,
    canon_direction_ar(x.direction) AS direction, x.street_width_m, x.floor_number,
    x.tenant_category, NULL::text AS license_number, x.elevator, x.parking, x.kitchen,
    x.air_conditioner, x.maid_room, x.driver_room, x.private_entrance
   FROM rakez_residential_listings x WHERE x.active
UNION ALL
 SELECT 'rakez_commercial_listings'::text AS source_table,
    x.id AS listing_id, NULL::boolean AS furnished, x.property_age,
    canon_direction_ar(x.direction) AS direction, x.street_width_m, x.floor_number,
    x.tenant_category, NULL::text AS license_number, x.elevator, x.parking, x.kitchen,
    x.air_conditioner, x.maid_room, x.driver_room, x.private_entrance
   FROM rakez_commercial_listings x WHERE x.active;

do $verify$
begin
  if position('rakez_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 then
    raise exception 'rakez did not land in listing_extra_attrs';
  end if;
  if position('suwar_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0
     or position('aqaralsaudia_residential_listings' in pg_get_viewdef('public.listing_extra_attrs'::regclass,true)) = 0 then
    raise exception 'an existing platform arm was dropped while adding rakez';
  end if;
  if (select count(*) from public.listing_extra_attrs_v1) = 0 then
    raise exception 'the wrapped base view returned nothing — the chain is broken';
  end if;
end $verify$;