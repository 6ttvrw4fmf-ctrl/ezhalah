-- Harden location_search_candidates_ar's category-purity check for 'both'-macro types — 2026-07-21
-- =============================================================================================
-- Context (read-only audit 2026-07-17, project_residential-commercial-isolation-audit-2026-07-17):
-- known_type_ar has exactly 2 rows with macro='both' — عمارة (Building, ~9,200 live rows) and
-- غير معروف (unknown, ~3 rows). The RPC's purity clause is:
--   (k.macro = p_category OR k.macro = 'both')
-- For a 'both'-macro row this is an unconditional pass regardless of p_category — the RPC trusts
-- the CALLER's p_tables scoping to have already restricted to the right table-kind, with zero
-- independent check of its own. Today's shipped frontend never actually triggers this (it hardcodes
-- Residential Building -> RES_TABLES only, Commercial Building -> COM_TABLES only, and the two
-- misfile-recovery sweeps explicitly exclude عمارة), so this was audited as LATENT, not live-
-- reachable. But the RPC is public (callable with the shipped anon key by anyone), so a caller that
-- passes p_category alone (or a mismatched p_tables) gets no defense-in-depth at all for these rows.
--
-- Fix: derive table-kind INDEPENDENTLY from the row's own s.source_table suffix (every one of the
-- 54 live source tables ends in exactly '_residential_listings' or '_commercial_listings' — verified
-- live, zero exceptions, 2026-07-21) rather than trusting p_tables. A 'both'-macro row now only
-- passes a non-null p_category if its OWN table-kind actually matches that category. An
-- unrecognized p_category value (anything other than 'Residential'/'Commercial') falls back to the
-- OLD permissive behavior for 'both' rows only — never a behavior change for a value the app
-- doesn't send today.
--
-- Everything else in the function is byte-for-byte identical to the live definition (pulled via
-- pg_get_functiondef immediately before writing this migration, per the RPC full-body-replace
-- hazard rule) — only this one predicate changed. Parameter list is UNCHANGED (same signature), so
-- this is a true REPLACE, not a new overload.
--
-- No backslash-escaping used in the LIKE patterns below on purpose: PostgreSQL's LIKE has no
-- default escape character (must be declared explicitly via `... ESCAPE '\'`, see this repo's own
-- 20260721095938_fix_search_cities_like_escaping_and_negative_limit.sql for the pattern) — an
-- un-declared `\_` would be interpreted literally and never match. Not needed here anyway: the
-- pattern is our own fixed literal, not attacker-controlled input, and an unescaped `_` wildcard
-- still correctly matches the literal underscore in every real table name.
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.location_search_candidates_ar(p_deal text DEFAULT NULL::text, p_cities text[] DEFAULT NULL::text[], p_districts text[] DEFAULT NULL::text[], p_tables text[] DEFAULT NULL::text[], p_platforms text[] DEFAULT NULL::text[], p_per_platform integer DEFAULT NULL::integer, p_limit integer DEFAULT 5000, p_region_ids integer[] DEFAULT NULL::integer[], p_types text[] DEFAULT NULL::text[], p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_rent_period text DEFAULT NULL::text, p_area_min integer DEFAULT NULL::integer, p_area_max integer DEFAULT NULL::integer, p_beds_exact integer[] DEFAULT NULL::integer[], p_beds_min integer DEFAULT NULL::integer, p_bath_min integer DEFAULT NULL::integer, p_furnished boolean DEFAULT NULL::boolean, p_age_max integer DEFAULT NULL::integer, p_tenant text DEFAULT NULL::text, p_directions text[] DEFAULT NULL::text[], p_has_license boolean DEFAULT NULL::boolean, p_amenities text[] DEFAULT NULL::text[], p_offset integer DEFAULT 0, p_tables2 text[] DEFAULT NULL::text[], p_types2 text[] DEFAULT NULL::text[], p_age_min integer DEFAULT NULL::integer, p_bath_exact integer[] DEFAULT NULL::integer[], p_street_width_min smallint DEFAULT NULL::smallint, p_street_width_max smallint DEFAULT NULL::smallint, p_floor_min integer DEFAULT NULL::integer, p_floor_max integer DEFAULT NULL::integer, p_is_new_construction boolean DEFAULT NULL::boolean, p_category text DEFAULT NULL::text)
 RETURNS TABLE(source_table text, listing_id bigint, platform text, last_updated timestamp with time zone, region_ar text, city_ar text, district_ar text, total_count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with district_tokens as (
    select norm_district_tok(d) as tok from unnest(coalesce(p_districts, '{}')) d
    union
    select norm_district_tok(b.district_ar)
    from unnest(coalesce(p_districts, '{}')) d
    join district_name_bridge b on norm_en_place(b.district_en) = norm_en_place(d)
  ), city_tokens as (
    select normalize_ar(c) as tok from unnest(coalesce(p_cities, '{}')) c
    union
    select normalize_ar(b.city_ar)
    from unnest(coalesce(p_cities, '{}')) c
    join city_name_bridge b on norm_en_place(b.city_en) = norm_en_place(c)
  ), city_ids as (
    select cc.city_id from loc_catalog_city cc join city_tokens t on cc.city_norm = t.tok
    union
    select a.city_id from loc_catalog_city_alias a join city_tokens t on a.alias_norm = t.tok
  ),
  matched as not materialized (
    select s.source_table, s.listing_id, s.platform, s.last_updated, s.region_ar, s.city_ar, s.district_ar
    from public.search_listings_ar s
    where (s.production_ready or ((p_cities is null or cardinality(p_cities) = 0) and (p_districts is null or cardinality(p_districts) = 0) and p_region_ids is null))
      and (p_deal       is null or s.deal_ar = p_deal)
      and (p_rent_period is null
           or s.deal_ar <> 'إيجار'
           or (p_rent_period = 'شهري' and s.payment_monthly = true)
           or (p_rent_period = 'سنوي' and s.payment_monthly = false)
           or (p_rent_period not in ('شهري','سنوي') and s.rent_period_ar = p_rent_period))
      and (
            ((p_tables is null or s.source_table = any(p_tables))
             and (p_types is null or s.type_ar = any(p_types)))
         or (p_tables2 is not null and s.source_table = any(p_tables2)
             and (p_types2 is null or s.type_ar = any(p_types2)))
      )
      and (p_category is null
           or exists (
             select 1 from known_type_ar k
             where k.type_ar = s.type_ar
               and (
                 k.macro = p_category
                 or (
                   k.macro = 'both'
                   -- Independent table-kind check (2026-07-21 hardening) — do not trust p_tables
                   -- alone for 'both'-macro types (عمارة/غير معروف). Every live source_table ends in
                   -- exactly one of these two suffixes (verified, zero exceptions). An unrecognized
                   -- p_category value falls back to the prior permissive behavior for 'both' rows.
                   and (case p_category
                          when 'Residential' then s.source_table like '%_residential_listings'
                          when 'Commercial'  then s.source_table like '%_commercial_listings'
                          else true
                        end)
                 )
               )
           ))
      and (p_cities is null or cardinality(p_cities) = 0
           or normalize_ar(s.city_ar) in (select tok from city_tokens)
           or s.city_id in (select city_id from city_ids)
           or s.match_city_ids && (select array_agg(city_id) from city_ids))
      and (p_districts is null or cardinality(p_districts) = 0 or norm_district_tok(s.district_ar) in (select tok from district_tokens))
      and (p_platforms is null or cardinality(p_platforms) = 0 or s.platform = any(p_platforms))
      and (p_region_ids is null or s.region_id = any(p_region_ids))
      and (nullif(p_area_min,0) is null or (s.area_m2 is not null and s.area_m2 >= p_area_min))
      and (nullif(p_area_max,0) is null or (s.area_m2 is not null and s.area_m2 <= p_area_max))
      and ((p_bath_exact is null and p_bath_min is null)
           or (p_bath_exact is not null and s.bathrooms = any(p_bath_exact))
           or (p_bath_min   is not null and s.bathrooms is not null and s.bathrooms >= p_bath_min))
      and ((coalesce(cardinality(p_beds_exact), 0) = 0 and p_beds_min is null)
           or (coalesce(cardinality(p_beds_exact), 0) > 0 and s.bedrooms = any(p_beds_exact))
           or (p_beds_min   is not null and s.bedrooms >= p_beds_min))
      and ((nullif(p_price_min,0) is null and nullif(p_price_max,0) is null)
           or (s.deal_ar = 'بيع'
               and s.price_total is not null and s.price_total > 0
               and s.price_total >= coalesce(p_price_min,0) and s.price_total <= coalesce(nullif(p_price_max,0),1e15))
           or (s.deal_ar = 'إيجار'
               and s.price_annual is not null and s.price_annual > 0
               and s.price_annual >= coalesce(p_price_min,0)*(case when p_rent_period='شهري' then 12 else 1 end)
               and s.price_annual <= coalesce(nullif(p_price_max,0),1e15)*(case when p_rent_period='شهري' then 12 else 1 end)))
      and (p_furnished  is null or s.furnished is null or s.furnished = p_furnished)
      and ((p_age_min is null and p_age_max is null)
           or (s.property_age is not null
               and s.property_age >= coalesce(p_age_min, 0) and s.property_age <= coalesce(p_age_max, 32767)))
      and (p_is_new_construction is null or (s.property_age = 0) = p_is_new_construction)
      and (p_tenant     is null or s.tenant_ar is null or s.tenant_ar = p_tenant)
      and (p_directions is null or s.direction_ar is null or s.direction_ar = any(p_directions))
      and (p_has_license is null or (s.license_number is not null) = p_has_license)
      and (p_amenities is null or (
               (not ('elevator'         = any(p_amenities)) or s.elevator)
           and (not ('parking'          = any(p_amenities)) or s.parking)
           and (not ('kitchen'          = any(p_amenities)) or s.kitchen)
           and (not ('ac'               = any(p_amenities)) or s.air_conditioner)
           and (not ('maid_room'        = any(p_amenities)) or s.maid_room)
           and (not ('driver_room'      = any(p_amenities)) or s.driver_room)
           and (not ('private_entrance' = any(p_amenities)) or s.private_entrance)
           and (not ('furnished'        = any(p_amenities)) or s.furnished)
           and (not ('rnpl'             = any(p_amenities)) or s.rent_now_pay_later)))
      and ((p_street_width_min is null and p_street_width_max is null)
           or s.street_width_m is null
           or (s.street_width_m >= coalesce(p_street_width_min, 0) and s.street_width_m <= coalesce(p_street_width_max, 32767)))
      and ((p_floor_min is null and p_floor_max is null)
           or s.floor_number is null
           or (s.floor_number >= coalesce(p_floor_min, 0) and s.floor_number <= coalesce(p_floor_max, 2147483647)))
  )
  (
    select m.source_table, m.listing_id, m.platform, m.last_updated, m.region_ar, m.city_ar, m.district_ar,
           count(*) over() as total_count
    from matched m
    where p_per_platform is null
    order by m.last_updated desc nulls last, m.source_table, m.listing_id
    limit p_limit offset greatest(p_offset, 0)
  )
  union all
  (
    select t.source_table, t.listing_id, t.platform, t.last_updated, t.region_ar, t.city_ar, t.district_ar,
           count(*) over() as total_count
    from (
      select m.source_table, m.listing_id, m.platform, m.last_updated, m.region_ar, m.city_ar, m.district_ar,
             row_number() over (partition by m.platform order by m.last_updated desc nulls last, m.source_table, m.listing_id) as rn
      from matched m
      where p_per_platform is not null
    ) t
    where t.rn <= p_per_platform
    order by t.last_updated desc nulls last, t.source_table, t.listing_id
    limit p_limit offset greatest(p_offset, 0)
  )
  order by last_updated desc nulls last, source_table, listing_id;
$function$;

-- =============================================================================================
-- ROLLBACK: re-apply the original clause (byte-identical to the pre-2026-07-21 live definition):
--   and (p_category is null
--        or exists (
--          select 1 from known_type_ar k
--          where k.type_ar = s.type_ar and (k.macro = p_category or k.macro = 'both')
--        ))
-- in place of the hardened block above, leaving every other line unchanged.
-- =============================================================================================
