-- Safe unique-district city resolution — PERMANENT (2026-07-16). Strict Region->City->District.
-- Restore a city ONLY when a fully location-less row's district maps to EXACTLY ONE verified
-- Arabic city (loc_catalog_district, HAVING count(distinct city_id)=1). Never guess; ambiguous
-- (>1 city) and unmatched (0) stay unresolved. The v1.region_id IS NULL guard means we never
-- override an existing region with a district whose catalog city sits in a different region
-- (this caught sanadak 644684: district الواسط -> a Jazan city while the row said Makkah).
-- Additive COALESCE (v1 wins when present) => no listing dropped, no existing city changed, no
-- duplicate key. Verified prod: orphans 358->180 (178 resolved), 0 wrong-city, 0 dups, 0 deleted.
--
-- Layer 2: mon-district-resolution alerts if a uniquely-resolvable district is ever left without a
-- city — i.e. this resolver got overwritten by a deploy (it was silently reverted once before).
--
-- Applied to prod via apply_migration 20260716220313_safe_unique_district_city_resolver.
CREATE OR REPLACE VIEW public.listing_native_location_v2 AS
 SELECT v1.platform, v1.source_table, v1.listing_id,
    COALESCE(a.transaction_type, v1.transaction_type) AS transaction_type,
    COALESCE(v1.region_id, uc.region_id) AS region_id,
    COALESCE(v1.city_id, uc.city_id) AS city_id,
    COALESCE(v1.city_ar, uc.city_ar) AS city_ar,
    v1.district_ar,
    COALESCE(v1.region_ar, ur.region_ar) AS region_ar,
    v1.source_method,
    (COALESCE(v1.region_id, uc.region_id) IS NOT NULL AND COALESCE(v1.city_id, uc.city_id) IS NOT NULL) AS production_ready,
    v1.last_updated,
    a.property_type, a.price_total, a.price_annual, a.price_per_meter, a.area_m2, a.bedrooms, a.bathrooms, a.rent_period,
    ea.furnished, ea.property_age, ea.direction, ea.street_width_m, ea.floor_number, ea.tenant_category, ea.license_number,
    ea.elevator, ea.parking, ea.kitchen, ea.air_conditioner, ea.maid_room, ea.driver_room, ea.private_entrance
   FROM listing_native_location_v1 v1
     JOIN active_listing_ids_v2 a ON a.source_table = v1.source_table AND a.listing_id = v1.listing_id
     LEFT JOIN listing_extra_attrs ea ON ea.source_table = v1.source_table AND ea.listing_id = v1.listing_id
     LEFT JOIN LATERAL (
       SELECT max(d.city_id) AS city_id FROM loc_catalog_district d
       WHERE v1.city_id IS NULL AND v1.region_id IS NULL AND v1.district_ar IS NOT NULL
         AND d.district_norm = normalize_ar(v1.district_ar)
       HAVING count(DISTINCT d.city_id) = 1
     ) udid ON true
     LEFT JOIN loc_catalog_city uc ON uc.city_id = udid.city_id
     LEFT JOIN loc_catalog_region ur ON ur.region_id = uc.region_id
UNION ALL
 SELECT 'souq24'::text AS platform, 'souq24_residential_listings'::text AS source_table, s.id AS listing_id,
    s.transaction_type, cc.region_id, cc.city_id, cm.city_ar, NULLIF(btrim(s.neighborhood), ''::text) AS district_ar,
    cm.region_ar, 'inline_lookup'::text AS source_method,
    cc.region_id IS NOT NULL AND cc.city_id IS NOT NULL AS production_ready, s.last_seen_at AS last_updated,
    s.property_type, s.price_total, s.price_annual, s.price_per_meter, s.area_m2, s.bedrooms, s.bathrooms, s.rent_period,
    NULL::boolean AS furnished, NULL::smallint AS property_age, NULL::text AS direction, NULL::smallint AS street_width_m,
    NULL::integer AS floor_number, NULL::text AS tenant_category, NULL::text AS license_number, NULL::boolean AS elevator,
    NULL::boolean AS parking, NULL::boolean AS kitchen, NULL::boolean AS air_conditioner, NULL::boolean AS maid_room,
    NULL::boolean AS driver_room, NULL::boolean AS private_entrance
   FROM souq24_residential_listings s
     LEFT JOIN loc_city_map cm ON cm.city_key = lower(btrim(s.city))
     LEFT JOIN loc_catalog_region cr ON cr.region_ar = cm.region_ar
     LEFT JOIN LATERAL ( SELECT c2.city_id, c2.region_id FROM loc_catalog_city c2
          WHERE (normalize_ar(c2.city_ar) = normalize_ar(cm.city_ar) OR (EXISTS ( SELECT 1 FROM loc_catalog_city_alias al
                  WHERE al.alias_norm = normalize_ar(cm.city_ar) AND al.city_id = c2.city_id))) AND (cr.region_id IS NULL OR c2.region_id = cr.region_id)
          ORDER BY c2.city_id LIMIT 1) cc ON true
  WHERE s.active = true
UNION ALL
 SELECT 'souq24'::text AS platform, 'souq24_commercial_listings'::text AS source_table, s.id AS listing_id,
    s.transaction_type, cc.region_id, cc.city_id, cm.city_ar, NULLIF(btrim(s.neighborhood), ''::text) AS district_ar,
    cm.region_ar, 'inline_lookup'::text AS source_method,
    cc.region_id IS NOT NULL AND cc.city_id IS NOT NULL AS production_ready, s.last_seen_at AS last_updated,
    s.property_type, s.price_total, s.price_annual, s.price_per_meter, s.area_m2, s.bedrooms, s.bathrooms, s.rent_period,
    NULL::boolean AS furnished, NULL::smallint AS property_age, NULL::text AS direction, NULL::smallint AS street_width_m,
    NULL::integer AS floor_number, NULL::text AS tenant_category, NULL::text AS license_number, NULL::boolean AS elevator,
    NULL::boolean AS parking, NULL::boolean AS kitchen, NULL::boolean AS air_conditioner, NULL::boolean AS maid_room,
    NULL::boolean AS driver_room, NULL::boolean AS private_entrance
   FROM souq24_commercial_listings s
     LEFT JOIN loc_city_map cm ON cm.city_key = lower(btrim(s.city))
     LEFT JOIN loc_catalog_region cr ON cr.region_ar = cm.region_ar
     LEFT JOIN LATERAL ( SELECT c2.city_id, c2.region_id FROM loc_catalog_city c2
          WHERE (normalize_ar(c2.city_ar) = normalize_ar(cm.city_ar) OR (EXISTS ( SELECT 1 FROM loc_catalog_city_alias al
                  WHERE al.alias_norm = normalize_ar(cm.city_ar) AND al.city_id = c2.city_id))) AND (cr.region_id IS NULL OR c2.region_id = cr.region_id)
          ORDER BY c2.city_id LIMIT 1) cc ON true
  WHERE s.active = true
UNION ALL
 SELECT regexp_replace(a.source_table, '_(residential|commercial)_listings$'::text, ''::text) AS platform,
    a.source_table, a.listing_id, a.transaction_type,
    NULL::integer AS region_id, NULL::integer AS city_id, NULL::text AS city_ar, NULL::text AS district_ar, NULL::text AS region_ar,
    'unresolved_catchall'::text AS source_method, false AS production_ready, NULL::timestamp with time zone AS last_updated,
    a.property_type, a.price_total, a.price_annual, a.price_per_meter, a.area_m2, a.bedrooms, a.bathrooms, a.rent_period,
    NULL::boolean AS furnished, NULL::smallint AS property_age, NULL::text AS direction, NULL::smallint AS street_width_m,
    NULL::integer AS floor_number, NULL::text AS tenant_category, NULL::text AS license_number, NULL::boolean AS elevator,
    NULL::boolean AS parking, NULL::boolean AS kitchen, NULL::boolean AS air_conditioner, NULL::boolean AS maid_room,
    NULL::boolean AS driver_room, NULL::boolean AS private_entrance
   FROM active_listing_ids_v2 a
  WHERE (a.source_table <> ALL (ARRAY['souq24_residential_listings'::text, 'souq24_commercial_listings'::text]))
    AND NOT (EXISTS ( SELECT 1 FROM listing_native_location_v1 v1 WHERE v1.source_table = a.source_table AND v1.listing_id = a.listing_id));

-- Regression monitor: resolvable-but-unresolved MUST be 0; >0 => resolver was clobbered.
CREATE OR REPLACE FUNCTION public.district_resolution_health()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
declare v_unresolved bigint; v_total_orphans bigint;
begin
  select count(*) into v_total_orphans from public.search_listings_ar s
    where s.city_id is null and s.district_ar is not null;
  select count(*) into v_unresolved from public.search_listings_ar s
    where s.city_id is null and s.region_ar is null and s.district_ar is not null
      and (select count(distinct d.city_id) from public.loc_catalog_district d
           where d.district_norm = normalize_ar(s.district_ar)) = 1;
  return jsonb_build_object(
    'resolvable_but_unresolved', v_unresolved,
    'total_district_orphans', v_total_orphans,
    'rule', 'restore city only for fully location-less rows whose district maps to exactly one verified Arabic city (Region->City->District); never guess',
    'measured_at', now());
end $fn$;

CREATE OR REPLACE FUNCTION public.mon_detect_district_resolution()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
declare s jsonb; v_unresolved bigint; v_target text; v_open_sev text; n int := 0;
begin
  s := public.district_resolution_health();
  v_unresolved := (s->>'resolvable_but_unresolved')::bigint;
  if    v_unresolved > 100 then v_target := 'P1';
  elsif v_unresolved >  20 then v_target := 'P2';
  else  v_target := null; end if;
  select severity into v_open_sev from public.alert_event
   where dedup_key = 'district_resolver_regressed' and resolved_at is null order by created_at desc limit 1;
  if v_target is null then
    if v_open_sev is not null then perform public.mon_resolve('district_resolver_regressed','district_resolution'); end if;
  elsif v_open_sev is distinct from v_target then
    if v_open_sev is not null then perform public.mon_resolve('district_resolver_regressed','district_resolution'); end if;
    n := n + public.mon_raise(v_target, 'district_resolver_regressed', 'district_resolution', 'district_resolver_regressed',
      s || jsonb_build_object('why','Uniquely-resolvable districts are being left without a city — the safe unique-district resolver in listing_native_location_v2 was likely overwritten by a deploy.'));
  end if;
  return n;
end $fn$;

DO $cron$
BEGIN PERFORM cron.unschedule('mon-district-resolution'); EXCEPTION WHEN OTHERS THEN NULL; END $cron$;
SELECT cron.schedule('mon-district-resolution', '50 * * * *', $$select public.mon_detect_district_resolution();$$);
