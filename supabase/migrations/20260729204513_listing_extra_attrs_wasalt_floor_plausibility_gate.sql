-- 2026-07-29: wasalt's own API occasionally leaks a huge garbage integer into floorNumber
-- (live-proven: WST5862677 / id 453054 carries floorNumber = 581633381 AND noOfFloors = 581633381 in
-- additional_info — clearly an upstream ID leaked into the field, not a floor). The view's old
-- '^\d+$' regex accepted it verbatim, so search showed a 581-million-floor apartment. The raw JSONB
-- capture stays untouched (capture fidelity); the READ gate tightens from '^\d+$' to '^\d{1,2}$'
-- (0-99 — far above any real Saudi building) so implausible values resolve to an honest NULL.
-- Everything else in this view (aqar branches, 14 amenity/attr expressions, wasalt furnished/age/
-- direction cases) is byte-identical to the prior live definition, rebuilt from pg_get_viewdef.
create or replace view public.listing_extra_attrs as
 SELECT 'aqar_residential_listings'::text AS source_table,
    aqar_residential_listings.id AS listing_id,
    aqar_residential_listings.furnished,
    aqar_residential_listings.property_age,
    aqar_residential_listings.direction,
    aqar_residential_listings.street_width_m,
    aqar_residential_listings.floor_number,
    aqar_residential_listings.tenant_category,
    aqar_residential_listings.license_number,
    aqar_residential_listings.elevator,
    aqar_residential_listings.parking,
    aqar_residential_listings.kitchen,
    aqar_residential_listings.air_conditioner,
    aqar_residential_listings.maid_room,
    aqar_residential_listings.driver_room,
    aqar_residential_listings.private_entrance
   FROM aqar_residential_listings
  WHERE aqar_residential_listings.active
UNION ALL
 SELECT 'aqar_commercial_listings'::text AS source_table,
    aqar_commercial_listings.id AS listing_id,
    aqar_commercial_listings.furnished,
    aqar_commercial_listings.property_age,
    aqar_commercial_listings.direction,
    aqar_commercial_listings.street_width_m,
    aqar_commercial_listings.floor_number,
    aqar_commercial_listings.tenant_category,
    aqar_commercial_listings.license_number,
    aqar_commercial_listings.elevator,
    aqar_commercial_listings.parking,
    aqar_commercial_listings.kitchen,
    aqar_commercial_listings.air_conditioner,
    aqar_commercial_listings.maid_room,
    aqar_commercial_listings.driver_room,
    aqar_commercial_listings.private_entrance
   FROM aqar_commercial_listings
  WHERE aqar_commercial_listings.active
UNION ALL
 SELECT 'wasalt_residential_listings'::text AS source_table,
    w.id AS listing_id,
    ( SELECT
                CASE ( SELECT elem.value ->> 'value'::text
                       FROM jsonb_array_elements(w.additional_info) elem(value)
                      WHERE (elem.value ->> 'key'::text) = 'furnishingType'::text
                     LIMIT 1)
                    WHEN 'Furnished'::text THEN true
                    WHEN 'Un-Furnished'::text THEN false
                    ELSE NULL::boolean
                END AS "case") AS furnished,
    (( SELECT
                CASE ( SELECT elem.value ->> 'value'::text
                       FROM jsonb_array_elements(w.additional_info) elem(value)
                      WHERE (elem.value ->> 'key'::text) = 'completionYear'::text
                     LIMIT 1)
                    WHEN 'New'::text THEN 0
                    WHEN '<1 year'::text THEN 0
                    WHEN '1 year'::text THEN 1
                    WHEN '2 years'::text THEN 2
                    WHEN '3 years'::text THEN 3
                    WHEN '4 years'::text THEN 4
                    WHEN '5 years'::text THEN 5
                    WHEN '6 years'::text THEN 6
                    WHEN '7 years'::text THEN 7
                    WHEN '8 years'::text THEN 8
                    WHEN '9 years'::text THEN 9
                    WHEN '10 years'::text THEN 10
                    WHEN '10+ years'::text THEN 10
                    ELSE NULL::integer
                END AS "case"))::smallint AS property_age,
    ( SELECT
                CASE ( SELECT elem.value ->> 'value'::text
                       FROM jsonb_array_elements(w.additional_info) elem(value)
                      WHERE (elem.value ->> 'key'::text) = 'propertyFacade'::text
                     LIMIT 1)
                    WHEN 'North'::text THEN 'شمال'::text
                    WHEN 'South'::text THEN 'جنوب'::text
                    WHEN 'East'::text THEN 'شرق'::text
                    WHEN 'West'::text THEN 'غرب'::text
                    WHEN 'North East'::text THEN 'شمال شرقي'::text
                    WHEN 'North West'::text THEN 'شمال غربي'::text
                    WHEN 'South East'::text THEN 'جنوب شرقي'::text
                    WHEN 'South West'::text THEN 'جنوب غربي'::text
                    ELSE NULL::text
                END AS "case") AS direction,
    NULL::smallint AS street_width_m,
    ( SELECT
                CASE
                    WHEN (( SELECT elem.value ->> 'value'::text
                       FROM jsonb_array_elements(w.additional_info) elem(value)
                      WHERE (elem.value ->> 'key'::text) = 'floorNumber'::text
                     LIMIT 1)) = 'Ground'::text THEN 0
                    ELSE ( SELECT (elem.value ->> 'value'::text)::integer AS int4
                       FROM jsonb_array_elements(w.additional_info) elem(value)
                      WHERE (elem.value ->> 'key'::text) = 'floorNumber'::text AND (elem.value ->> 'value'::text) ~ '^\d{1,2}$'::text
                     LIMIT 1)
                END AS int4) AS floor_number,
    NULL::text AS tenant_category,
    NULL::text AS license_number,
    NULL::boolean AS elevator,
    NULL::boolean AS parking,
    NULL::boolean AS kitchen,
    NULL::boolean AS air_conditioner,
    NULL::boolean AS maid_room,
    NULL::boolean AS driver_room,
    NULL::boolean AS private_entrance
   FROM wasalt_residential_listings w
  WHERE w.active
UNION ALL
 SELECT 'wasalt_commercial_listings'::text AS source_table,
    w.id AS listing_id,
    ( SELECT
                CASE ( SELECT elem.value ->> 'value'::text
                       FROM jsonb_array_elements(w.additional_info) elem(value)
                      WHERE (elem.value ->> 'key'::text) = 'furnishingType'::text
                     LIMIT 1)
                    WHEN 'Furnished'::text THEN true
                    WHEN 'Un-Furnished'::text THEN false
                    ELSE NULL::boolean
                END AS "case") AS furnished,
    (( SELECT
                CASE ( SELECT elem.value ->> 'value'::text
                       FROM jsonb_array_elements(w.additional_info) elem(value)
                      WHERE (elem.value ->> 'key'::text) = 'completionYear'::text
                     LIMIT 1)
                    WHEN 'New'::text THEN 0
                    WHEN '<1 year'::text THEN 0
                    WHEN '1 year'::text THEN 1
                    WHEN '2 years'::text THEN 2
                    WHEN '3 years'::text THEN 3
                    WHEN '4 years'::text THEN 4
                    WHEN '5 years'::text THEN 5
                    WHEN '6 years'::text THEN 6
                    WHEN '7 years'::text THEN 7
                    WHEN '8 years'::text THEN 8
                    WHEN '9 years'::text THEN 9
                    WHEN '10 years'::text THEN 10
                    WHEN '10+ years'::text THEN 10
                    ELSE NULL::integer
                END AS "case"))::smallint AS property_age,
    ( SELECT
                CASE ( SELECT elem.value ->> 'value'::text
                       FROM jsonb_array_elements(w.additional_info) elem(value)
                      WHERE (elem.value ->> 'key'::text) = 'propertyFacade'::text
                     LIMIT 1)
                    WHEN 'North'::text THEN 'شمال'::text
                    WHEN 'South'::text THEN 'جنوب'::text
                    WHEN 'East'::text THEN 'شرق'::text
                    WHEN 'West'::text THEN 'غرب'::text
                    WHEN 'North East'::text THEN 'شمال شرقي'::text
                    WHEN 'North West'::text THEN 'شمال غربي'::text
                    WHEN 'South East'::text THEN 'جنوب شرقي'::text
                    WHEN 'South West'::text THEN 'جنوب غربي'::text
                    ELSE NULL::text
                END AS "case") AS direction,
    NULL::smallint AS street_width_m,
    ( SELECT
                CASE
                    WHEN (( SELECT elem.value ->> 'value'::text
                       FROM jsonb_array_elements(w.additional_info) elem(value)
                      WHERE (elem.value ->> 'key'::text) = 'floorNumber'::text
                     LIMIT 1)) = 'Ground'::text THEN 0
                    ELSE ( SELECT (elem.value ->> 'value'::text)::integer AS int4
                       FROM jsonb_array_elements(w.additional_info) elem(value)
                      WHERE (elem.value ->> 'key'::text) = 'floorNumber'::text AND (elem.value ->> 'value'::text) ~ '^\d{1,2}$'::text
                     LIMIT 1)
                END AS int4) AS floor_number,
    NULL::text AS tenant_category,
    NULL::text AS license_number,
    NULL::boolean AS elevator,
    NULL::boolean AS parking,
    NULL::boolean AS kitchen,
    NULL::boolean AS air_conditioner,
    NULL::boolean AS maid_room,
    NULL::boolean AS driver_room,
    NULL::boolean AS private_entrance
   FROM wasalt_commercial_listings w
  WHERE w.active;
