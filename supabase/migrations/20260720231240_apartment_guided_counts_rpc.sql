-- Annual-Rent apartment guided flow (owner 2026-07-20): one scope-respecting count row powering the
-- RNPL, amenities, and min-bathrooms questions. Reuses the EXACT scope resolution of
-- property_age_option_counts_ar (district/city token CTEs + the same base WHERE) so a count always
-- matches what location_search_candidates_ar returns — never a hand-approximated query.
--
-- The scoped set applies every passed filter INCLUDING this call's amenities (strict) + min-bathrooms
-- (STRICT: >= N, unknown excluded) + age. So:
--   • count(*)            → cnt_total_base = cnt_selected : the current matching total (drives the ≥150
--                           gate on a fetchOptions call; the live continue-button count on a liveCount call)
--   • count(*) FILTER (…) → per-option standalone availabilities within that set (chip / ladder counts)
-- Additive, dormant until the new frontend calls it. New: this signature is a fresh function name, so
-- there is no overload collision with anything existing.

CREATE OR REPLACE FUNCTION public.apartment_guided_counts_ar(
  p_deal text DEFAULT NULL::text, p_rent_period text DEFAULT NULL::text, p_cities text[] DEFAULT NULL::text[],
  p_districts text[] DEFAULT NULL::text[], p_tables text[] DEFAULT NULL::text[], p_platforms text[] DEFAULT NULL::text[],
  p_region_ids integer[] DEFAULT NULL::integer[], p_tables2 text[] DEFAULT NULL::text[], p_types2 text[] DEFAULT NULL::text[],
  p_types text[] DEFAULT NULL::text[], p_beds_exact integer[] DEFAULT NULL::integer[], p_beds_min integer DEFAULT NULL::integer,
  p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_area_min integer DEFAULT NULL::integer,
  p_area_max integer DEFAULT NULL::integer, p_category text DEFAULT NULL::text, p_age_min integer DEFAULT NULL::integer,
  p_age_max integer DEFAULT NULL::integer, p_is_new_construction boolean DEFAULT NULL::boolean,
  p_amenities text[] DEFAULT NULL::text[], p_bath_min integer DEFAULT NULL::integer)
 RETURNS TABLE(
   cnt_total_base bigint, cnt_rnpl bigint, cnt_kitchen bigint, cnt_parking bigint, cnt_elevator bigint,
   cnt_furnished bigint, cnt_bath1 bigint, cnt_bath2 bigint, cnt_bath3 bigint, cnt_bath4 bigint, cnt_selected bigint)
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
  ), scoped as (
    select s.rent_now_pay_later, s.kitchen, s.parking, s.elevator, s.furnished, s.bathrooms
    from public.search_listings_ar s
    where (s.production_ready or (p_cities is null and p_districts is null and p_region_ids is null))
      and (p_deal        is null or s.deal_ar = p_deal)
      and (p_rent_period is null
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
             where k.type_ar = s.type_ar and (k.macro = p_category or k.macro = 'both')
           ))
      and (p_cities     is null
           or normalize_ar(s.city_ar) in (select tok from city_tokens)
           or s.city_id in (select city_id from city_ids)
           or s.match_city_ids && (select array_agg(city_id) from city_ids))
      and (p_districts  is null or norm_district_tok(s.district_ar) in (select tok from district_tokens))
      and (p_platforms  is null or s.platform = any(p_platforms))
      and (p_region_ids is null or s.region_id = any(p_region_ids))
      and (p_area_min is null or (s.area_m2 is not null and s.area_m2 >= p_area_min))
      and (p_area_max is null or (s.area_m2 is not null and s.area_m2 <= p_area_max))
      and ((p_beds_exact is null and p_beds_min is null)
           or (p_beds_exact is not null and s.bedrooms = any(p_beds_exact))
           or (p_beds_min   is not null and s.bedrooms >= p_beds_min))
      and ((p_price_min is null and p_price_max is null)
           or (s.deal_ar = 'بيع'
               and s.price_total is not null and s.price_total > 0
               and s.price_total >= coalesce(p_price_min,0) and s.price_total <= coalesce(p_price_max,1e15))
           or (s.deal_ar = 'إيجار'
               and s.price_annual is not null and s.price_annual > 0
               and s.price_annual >= coalesce(p_price_min,0)*(case when p_rent_period='شهري' then 12 else 1 end)
               and s.price_annual <= coalesce(p_price_max,1e15)*(case when p_rent_period='شهري' then 12 else 1 end)))
      -- age (same predicate as the search RPC)
      and ((p_age_min is null and p_age_max is null)
           or (s.property_age is not null
               and s.property_age >= coalesce(p_age_min, 0) and s.property_age <= coalesce(p_age_max, 32767)))
      and (p_is_new_construction is null or (s.property_age = 0) = p_is_new_construction)
      -- amenities: STRICT, incl. the new furnished + rnpl tokens (same block as the search RPC)
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
      -- min bathrooms: STRICT (>= N, unknown excluded)
      and (p_bath_min is null or (s.bathrooms is not null and s.bathrooms >= p_bath_min))
  )
  select
    count(*)                                                as cnt_total_base,
    count(*) filter (where rent_now_pay_later)              as cnt_rnpl,
    count(*) filter (where kitchen)                         as cnt_kitchen,
    count(*) filter (where parking)                         as cnt_parking,
    count(*) filter (where elevator)                        as cnt_elevator,
    count(*) filter (where furnished)                       as cnt_furnished,
    count(*) filter (where bathrooms >= 1)                  as cnt_bath1,
    count(*) filter (where bathrooms >= 2)                  as cnt_bath2,
    count(*) filter (where bathrooms >= 3)                  as cnt_bath3,
    count(*) filter (where bathrooms >= 4)                  as cnt_bath4,
    count(*)                                                as cnt_selected
  from scoped;
$function$;
