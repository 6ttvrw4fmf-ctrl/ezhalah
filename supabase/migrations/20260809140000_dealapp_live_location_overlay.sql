-- Dealapp live location overlay (2026-08-09).
-- ROOT CAUSE: a dealapp listing whose Arabic city is resolved into listings_arabic_locations
-- (matched=true, confident) by resolve_dealapp_city() (every 10 min) is only carried into search
-- after the HOURLY listing_native_location_v1 matview refresh picks it up via its `legacy` CTE.
-- In the window before that refresh the row falls to v2's `unresolved_catchall` branch, which
-- hardcoded NULL location + production_ready=false -> NOT searchable for up to ~1-2h.
-- FIX: give the catchall branch a LIVE listings_arabic_locations overlay (dealapp-scoped,
-- CONFIDENT single catalogued-city match only via HAVING count(DISTINCT city_id)=1), mirroring the
-- existing udid/uali laterals. Never guesses: only a matched=true LAL row that maps to exactly one
-- loc_catalog_city resolves; otherwise the row stays unresolved (honest NULL) exactly as before.
-- Clobber-safe: v2 now resolves live, so sync_search_listings_ar() agrees and never reverts it.
-- Only output VALUES change on catchall rows; column list/types/order are byte-identical, so the
-- dependent views (platforms_unsearchable, platforms_deprecated_status, mon_search_index_city_drift)
-- are unaffected. CREATE OR REPLACE keeps grants.

CREATE OR REPLACE VIEW public.listing_native_location_v2 AS
 SELECT v1.platform,
    v1.source_table,
    v1.listing_id,
    COALESCE(a.transaction_type, v1.transaction_type) AS transaction_type,
    COALESCE(v1.region_id, uac.region_id, uc.region_id) AS region_id,
    COALESCE(v1.city_id, uali.city_id, uc.city_id) AS city_id,
    COALESCE(v1.city_ar, uc.city_ar) AS city_ar,
    COALESCE(v1.district_ar, dr.district_ar) AS district_ar,
    COALESCE(v1.region_ar, uar.region_ar, ur.region_ar) AS region_ar,
    v1.source_method,
    COALESCE(v1.region_id, uac.region_id, uc.region_id) IS NOT NULL AND COALESCE(v1.city_id, uali.city_id, uc.city_id) IS NOT NULL AS production_ready,
    v1.last_updated,
    a.property_type,
    a.price_total,
    a.price_annual,
    a.price_per_meter,
    a.area_m2,
    a.bedrooms,
    a.bathrooms,
    a.rent_period,
    ea.furnished,
    ar.property_age,
    ea.direction,
    ea.street_width_m,
    ea.floor_number,
    ea.tenant_category,
    ea.license_number,
    ea.elevator,
    ea.parking,
    ea.kitchen,
    ea.air_conditioner,
    ea.maid_room,
    ea.driver_room,
    ea.private_entrance
   FROM listing_native_location_v1 v1
     JOIN active_listing_ids_v2 a ON a.source_table = v1.source_table AND a.listing_id = v1.listing_id
     LEFT JOIN listing_extra_attrs ea ON ea.source_table = v1.source_table AND ea.listing_id = v1.listing_id
     LEFT JOIN listing_age_resolved ar ON ar.source_table = v1.source_table AND ar.listing_id = v1.listing_id
     LEFT JOIN district_recovery dr ON dr.source_table = v1.source_table AND dr.listing_id = v1.listing_id
     LEFT JOIN LATERAL ( SELECT max(d.city_id) AS city_id
           FROM loc_catalog_district d
          WHERE v1.city_ar IS NULL AND v1.city_id IS NULL AND v1.region_id IS NULL AND v1.district_ar IS NOT NULL AND d.district_norm = normalize_ar(v1.district_ar)
         HAVING count(DISTINCT d.city_id) = 1) udid ON true
     LEFT JOIN LATERAL ( SELECT a2.city_id
           FROM loc_catalog_city_alias a2
          WHERE v1.city_id IS NULL AND v1.city_ar IS NOT NULL AND a2.alias_norm = normalize_ar(v1.city_ar)
         LIMIT 1) uali ON true
     LEFT JOIN loc_catalog_city uac ON uac.city_id = uali.city_id
     LEFT JOIN loc_catalog_region uar ON uar.region_id = uac.region_id
     LEFT JOIN loc_catalog_city uc ON uc.city_id = udid.city_id
     LEFT JOIN loc_catalog_region ur ON ur.region_id = uc.region_id
UNION ALL
 SELECT 'souq24'::text AS platform,
    'souq24_residential_listings'::text AS source_table,
    s.id AS listing_id,
    s.transaction_type,
    cc.region_id,
    cc.city_id,
    cm.city_ar,
    NULLIF(btrim(s.neighborhood), ''::text) AS district_ar,
    cm.region_ar,
    'inline_lookup'::text AS source_method,
    cc.region_id IS NOT NULL AND cc.city_id IS NOT NULL AS production_ready,
    s.last_seen_at AS last_updated,
    s.property_type,
    s.price_total,
    s.price_annual,
    s.price_per_meter,
    s.area_m2,
    s.bedrooms,
    s.bathrooms,
    s.rent_period,
    NULL::boolean AS furnished,
    ( SELECT ar.property_age
           FROM listing_age_resolved ar
          WHERE ar.source_table = 'souq24_residential_listings'::text AND ar.listing_id = s.id) AS property_age,
    NULL::text AS direction,
    NULL::smallint AS street_width_m,
    NULL::integer AS floor_number,
    NULL::text AS tenant_category,
    NULL::text AS license_number,
    NULL::boolean AS elevator,
    NULL::boolean AS parking,
    NULL::boolean AS kitchen,
    NULL::boolean AS air_conditioner,
    NULL::boolean AS maid_room,
    NULL::boolean AS driver_room,
    NULL::boolean AS private_entrance
   FROM souq24_residential_listings s
     LEFT JOIN loc_city_map cm ON cm.city_key = lower(btrim(s.city))
     LEFT JOIN loc_catalog_region cr ON cr.region_ar = cm.region_ar
     LEFT JOIN LATERAL ( SELECT c2.city_id,
            c2.region_id
           FROM loc_catalog_city c2
          WHERE (normalize_ar(c2.city_ar) = normalize_ar(cm.city_ar) OR (EXISTS ( SELECT 1
                   FROM loc_catalog_city_alias al
                  WHERE al.alias_norm = normalize_ar(cm.city_ar) AND al.city_id = c2.city_id))) AND (cr.region_id IS NULL OR c2.region_id = cr.region_id)
          ORDER BY c2.city_id
         LIMIT 1) cc ON true
  WHERE s.active = true
UNION ALL
 SELECT 'souq24'::text AS platform,
    'souq24_commercial_listings'::text AS source_table,
    s.id AS listing_id,
    s.transaction_type,
    cc.region_id,
    cc.city_id,
    cm.city_ar,
    NULLIF(btrim(s.neighborhood), ''::text) AS district_ar,
    cm.region_ar,
    'inline_lookup'::text AS source_method,
    cc.region_id IS NOT NULL AND cc.city_id IS NOT NULL AS production_ready,
    s.last_seen_at AS last_updated,
    s.property_type,
    s.price_total,
    s.price_annual,
    s.price_per_meter,
    s.area_m2,
    s.bedrooms,
    s.bathrooms,
    s.rent_period,
    NULL::boolean AS furnished,
    ( SELECT ar.property_age
           FROM listing_age_resolved ar
          WHERE ar.source_table = 'souq24_commercial_listings'::text AND ar.listing_id = s.id) AS property_age,
    NULL::text AS direction,
    NULL::smallint AS street_width_m,
    NULL::integer AS floor_number,
    NULL::text AS tenant_category,
    NULL::text AS license_number,
    NULL::boolean AS elevator,
    NULL::boolean AS parking,
    NULL::boolean AS kitchen,
    NULL::boolean AS air_conditioner,
    NULL::boolean AS maid_room,
    NULL::boolean AS driver_room,
    NULL::boolean AS private_entrance
   FROM souq24_commercial_listings s
     LEFT JOIN loc_city_map cm ON cm.city_key = lower(btrim(s.city))
     LEFT JOIN loc_catalog_region cr ON cr.region_ar = cm.region_ar
     LEFT JOIN LATERAL ( SELECT c2.city_id,
            c2.region_id
           FROM loc_catalog_city c2
          WHERE (normalize_ar(c2.city_ar) = normalize_ar(cm.city_ar) OR (EXISTS ( SELECT 1
                   FROM loc_catalog_city_alias al
                  WHERE al.alias_norm = normalize_ar(cm.city_ar) AND al.city_id = c2.city_id))) AND (cr.region_id IS NULL OR c2.region_id = cr.region_id)
          ORDER BY c2.city_id
         LIMIT 1) cc ON true
  WHERE s.active = true
UNION ALL
 SELECT regexp_replace(a.source_table, '_(residential|commercial)_listings$'::text, ''::text) AS platform,
    a.source_table,
    a.listing_id,
    a.transaction_type,
    lalc.region_id,
    lalc.city_id,
    lalc.city_ar,
    NULL::text AS district_ar,
    lalc.region_ar,
    CASE WHEN lalc.city_id IS NOT NULL THEN 'lal_live_overlay'::text ELSE 'unresolved_catchall'::text END AS source_method,
    (lalc.city_id IS NOT NULL AND lalc.region_id IS NOT NULL) AS production_ready,
    NULL::timestamp with time zone AS last_updated,
    a.property_type,
    a.price_total,
    a.price_annual,
    a.price_per_meter,
    a.area_m2,
    a.bedrooms,
    a.bathrooms,
    a.rent_period,
    NULL::boolean AS furnished,
    NULL::smallint AS property_age,
    NULL::text AS direction,
    NULL::smallint AS street_width_m,
    NULL::integer AS floor_number,
    NULL::text AS tenant_category,
    NULL::text AS license_number,
    NULL::boolean AS elevator,
    NULL::boolean AS parking,
    NULL::boolean AS kitchen,
    NULL::boolean AS air_conditioner,
    NULL::boolean AS maid_room,
    NULL::boolean AS driver_room,
    NULL::boolean AS private_entrance
   FROM active_listing_ids_v2 a
     LEFT JOIN LATERAL ( SELECT min(lc.city_id) AS city_id, min(lc.region_id) AS region_id,
            min(l.city_ar) AS city_ar, min(cr.region_ar) AS region_ar
           FROM listings_arabic_locations l
             JOIN loc_catalog_city lc ON lc.city_norm = normalize_ar(l.city_ar)
             LEFT JOIN loc_catalog_region cr ON cr.region_id = lc.region_id
          WHERE l.source_table = a.source_table AND l.listing_id = a.listing_id
            AND a.source_table = ANY (ARRAY['dealapp_residential_listings'::text, 'dealapp_commercial_listings'::text])
            AND l.matched IS TRUE AND l.city_ar IS NOT NULL
         HAVING count(DISTINCT lc.city_id) = 1) lalc ON true
  WHERE (a.source_table <> ALL (ARRAY['souq24_residential_listings'::text, 'souq24_commercial_listings'::text])) AND NOT (EXISTS ( SELECT 1
           FROM listing_native_location_v1 v1
          WHERE v1.source_table = a.source_table AND v1.listing_id = a.listing_id));

-- Targeted fast propagation: push confidently-resolved dealapp locations from the (now overlay-aware)
-- v2 into search every 10 min, so a resolved listing is searchable without waiting for the hourly
-- full sync. Reads v2 (agrees with sync -> no clobber/flap). The search_listings_ar gate trigger
-- still applies price/size withholding. Never guesses (v2 resolves only confident single-catalogue matches).
CREATE OR REPLACE FUNCTION public.propagate_dealapp_resolved_locations()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
declare n int;
begin
  update public.search_listings_ar s
     set city_id = v.city_id, region_id = v.region_id, city_ar = v.city_ar, region_ar = v.region_ar,
         production_ready = v.production_ready, last_updated = coalesce(v.last_updated, s.last_updated)
  from public.listing_native_location_v2 v
  where v.source_table in ('dealapp_residential_listings','dealapp_commercial_listings')
    and s.source_table = v.source_table and s.listing_id = v.listing_id
    and v.production_ready and v.city_id is not null
    and (s.production_ready is not true
         or s.city_id is distinct from v.city_id
         or s.region_id is distinct from v.region_id);
  get diagnostics n = row_count;
  return n;
end $fn$;

SELECT cron.schedule('dealapp-location-propagate','8-59/10 * * * *',
                     $$select public.propagate_dealapp_resolved_locations();$$);

-- Health monitor: location_not_propagated>0 across a sync cycle = the lag bug returned.
-- withheld_by_safety_gate = resolved but held by the price/size barrier (NOT a location failure).
DROP VIEW IF EXISTS public.mon_dealapp_resolution_lag;
CREATE VIEW public.mon_dealapp_resolution_lag AS
WITH lal AS (
  SELECT listing_id, bool_or(matched) AS matched
  FROM listings_arabic_locations
  WHERE source_table='dealapp_residential_listings' GROUP BY listing_id
),
s AS (
  SELECT listing_id, city_id, production_ready
  FROM search_listings_ar WHERE source_table='dealapp_residential_listings'
)
SELECT
  count(*) FILTER (WHERE coalesce(lal.matched,false) AND s.city_id IS NULL) AS location_not_propagated,
  count(*) FILTER (WHERE NOT coalesce(lal.matched,false) AND coalesce(s.production_ready,false)=false) AS unresolved_no_catalog_city,
  count(*) FILTER (WHERE coalesce(lal.matched,false) AND s.city_id IS NOT NULL AND coalesce(s.production_ready,false)=false) AS withheld_by_safety_gate,
  now() AS as_of
FROM dealapp_residential_listings d
LEFT JOIN lal ON lal.listing_id=d.id
LEFT JOIN s ON s.listing_id=d.id
WHERE d.active;
