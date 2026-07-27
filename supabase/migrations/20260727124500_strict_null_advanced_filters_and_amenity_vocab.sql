-- Strict NULL semantics for the four remaining NULL-permissive advanced filters + amenity token
-- vocabulary hardening (daily-audit 2026-07-27, owner-instructed fix batch).
--
-- WHAT WAS WRONG (all proven live 2026-07-27, ground truth = search_listings_ar with NO
-- production_ready filter):
--   p_floor_min=>3        RPC returned 108,880   strict truth  3,661   (96.6% false positives)
--   p_street_width_min=>20 RPC returned  89,819   strict truth 20,112
--   p_directions=>['شمال'] RPC returned  67,439   strict truth 14,869 (buy)
--   p_tenant=>'عوائل'      RPC returned  75,014   strict truth  5,751 (rent)
-- Each predicate OR-ed an "attribute IS NULL escapes the filter" clause — NULL-permissive — while
-- age_max / bath_min / has_license / is_new_construction / furnished (fixed 2026-07-23, Bug C) are
-- all NULL-STRICT. A user explicitly asking for floor>=3 must not receive listings whose floor is
-- unknown. DEAD SURFACE today (the shipped app sends none of these four params — verified in
-- src/data/remote.ts), fixed BEFORE any UI chip wires them, not after.
--
-- ALSO IN THIS MIGRATION:
--   1. norm_direction_ar(): direction_ar holds TWO vocabulary families (شرق 17,224 / شمال 14,869 …
--      vs the feminine شرقية 37 / شمالية 40 …). A strict literal match would make whichever family
--      the caller does not send unreachable. Both sides of the comparison are canonicalized
--      word-by-word (شمالية/شمالي→شمال etc.), so compounds work too (شمالية شرقية == شمال شرقي).
--      Stored values are NOT rewritten (listing fidelity) — the alias layer lives in the RPC only.
--   2. p_amenities vocabulary: 'rent_now_pay_later' is now an explicit alias of 'rnpl' (it was
--      silently ignored — an unfiltered rent search, 75,492 instead of 15,199). And any UNKNOWN
--      amenity token now FAILS CLOSED (0 rows) instead of silently meaning "no filter": a typo'd
--      token must never widen a search. Fail-closed (vs raising) keeps the RPC total — a search
--      that filters on a token we don't recognize honestly matches nothing, and the failure is
--      visible the first time anyone wires a bad token, not years later in an audit.
--
-- p_furnished untouched (already NULL-strict since 20260723150000). Function body otherwise
-- byte-identical to the live definition (built by asserted-needle replacement from the last
-- reconciled body — see scripts/verify-rpc-clause-invariants.ts which pins these clauses).

create or replace function public.norm_direction_ar(t text)
returns text
language sql
immutable
parallel safe
as $$
  -- Canonicalize an Arabic compass direction to the masculine/short family so both vocabulary
  -- families compare equal: شمالية/شمالي→شمال, جنوبية/جنوبي→جنوب, شرقية/شرقي→شرق, غربية/غربي→غرب.
  -- Word-by-word via space padding (no regex word boundaries — Arabic + \m do not mix reliably),
  -- so compounds normalize too: 'شمالية شرقية' -> 'شمال شرق' == norm('شمال شرقي'). NULL/blank -> NULL.
  select nullif(trim(regexp_replace(
    replace(replace(replace(replace(replace(replace(replace(replace(
      ' ' || coalesce(t, '') || ' ',
      ' شمالية ', ' شمال '), ' شمالي ', ' شمال '),
      ' جنوبية ', ' جنوب '), ' جنوبي ', ' جنوب '),
      ' شرقية ', ' شرق '), ' شرقي ', ' شرق '),
      ' غربية ', ' غرب '), ' غربي ', ' غرب '),
    '\s+', ' ', 'g')), '');
$$;

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
      and (p_furnished  is null or s.furnished = p_furnished)
      and ((p_age_min is null and p_age_max is null)
           or (s.property_age is not null
               and s.property_age >= coalesce(p_age_min, 0) and s.property_age <= coalesce(p_age_max, 32767)))
      and (p_is_new_construction is null or (s.property_age = 0) = p_is_new_construction)
      and (p_tenant     is null or s.tenant_ar = p_tenant)
      and (p_directions is null or norm_direction_ar(s.direction_ar) in (select norm_direction_ar(d) from unnest(p_directions) d))
      and (p_has_license is null or (s.license_number is not null) = p_has_license)
      and (p_amenities is null or (
               not exists (select 1 from unnest(p_amenities) tok
                           where tok not in ('elevator','parking','kitchen','ac','maid_room','driver_room','private_entrance','furnished','rnpl','rent_now_pay_later'))
           and (not ('elevator'         = any(p_amenities)) or s.elevator)
           and (not ('parking'          = any(p_amenities)) or s.parking)
           and (not ('kitchen'          = any(p_amenities)) or s.kitchen)
           and (not ('ac'               = any(p_amenities)) or s.air_conditioner)
           and (not ('maid_room'        = any(p_amenities)) or s.maid_room)
           and (not ('driver_room'      = any(p_amenities)) or s.driver_room)
           and (not ('private_entrance' = any(p_amenities)) or s.private_entrance)
           and (not ('furnished'        = any(p_amenities)) or s.furnished)
           and (not ('rnpl'             = any(p_amenities) or 'rent_now_pay_later' = any(p_amenities)) or s.rent_now_pay_later)))
      and ((p_street_width_min is null and p_street_width_max is null)
           or (s.street_width_m is not null
               and s.street_width_m >= coalesce(p_street_width_min, 0) and s.street_width_m <= coalesce(p_street_width_max, 32767)))
      and ((p_floor_min is null and p_floor_max is null)
           or (s.floor_number is not null
               and s.floor_number >= coalesce(p_floor_min, 0) and s.floor_number <= coalesce(p_floor_max, 2147483647)))
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
