-- Found live 2026-07-24 (filter-vs-backend audit): property_age_option_counts_ar had no p_amenities/
-- p_bath_min params, so once a user answered an earlier advanced-filter question (e.g. RNPL
-- "installment options"), the age-bucket count badges silently ignored that already-selected filter,
-- showing counts far larger than what Search (and apartment_guided_counts_ar, which already has both
-- params) actually returns for the same combination. This adds the identical STRICT p_amenities/
-- p_bath_min predicate apartment_guided_counts_ar already uses, verbatim, as two new trailing
-- DEFAULT NULL params. DROP+CREATE (not bare CREATE OR REPLACE) because adding parameters changes the
-- function's argument-type identity — a bare OR REPLACE would create a second overloaded function
-- instead of replacing this one, risking PostgREST's PGRST203 ambiguous-overload error (see AGENTS.md
-- 'CREATE OR REPLACE overload hazard' — a lesson from a prior incident in this exact project). No
-- dependents (checked pg_depend) and no other callers pass extra args, so this is purely additive:
-- every existing call site keeps working identically (both new params default to NULL = no-op).

drop function if exists public.property_age_option_counts_ar(
  text, text, text[], text[], text[], text[], integer[], text[], text[], text[],
  integer[], integer, numeric, numeric, integer, integer, text
);

create function public.property_age_option_counts_ar(
  p_deal text DEFAULT NULL::text,
  p_rent_period text DEFAULT NULL::text,
  p_cities text[] DEFAULT NULL::text[],
  p_districts text[] DEFAULT NULL::text[],
  p_tables text[] DEFAULT NULL::text[],
  p_platforms text[] DEFAULT NULL::text[],
  p_region_ids integer[] DEFAULT NULL::integer[],
  p_tables2 text[] DEFAULT NULL::text[],
  p_types2 text[] DEFAULT NULL::text[],
  p_types text[] DEFAULT NULL::text[],
  p_beds_exact integer[] DEFAULT NULL::integer[],
  p_beds_min integer DEFAULT NULL::integer,
  p_price_min numeric DEFAULT NULL::numeric,
  p_price_max numeric DEFAULT NULL::numeric,
  p_area_min integer DEFAULT NULL::integer,
  p_area_max integer DEFAULT NULL::integer,
  p_category text DEFAULT NULL::text,
  p_amenities text[] DEFAULT NULL::text[],
  p_bath_min integer DEFAULT NULL::integer
)
 RETURNS TABLE(cnt_new bigint, cnt_1_2 bigint, cnt_3_5 bigint, cnt_6_9 bigint, cnt_10p bigint, cnt_unknown bigint, cnt_total bigint, platform_breakdown jsonb)
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
    select s.platform, s.property_age
    from public.search_listings_ar s
    where (s.production_ready or ((p_cities is null or cardinality(p_cities) = 0) and (p_districts is null or cardinality(p_districts) = 0) and p_region_ids is null))
      and (p_deal        is null or s.deal_ar = p_deal)
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
             where k.type_ar = s.type_ar and (k.macro = p_category or k.macro = 'both')
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
      and (p_bath_min is null or (s.bathrooms is not null and s.bathrooms >= p_bath_min))
  )
  select
    count(*) filter (where property_age = 0)               as cnt_new,
    count(*) filter (where property_age between 1 and 2)    as cnt_1_2,
    count(*) filter (where property_age between 3 and 5)    as cnt_3_5,
    count(*) filter (where property_age between 6 and 9)    as cnt_6_9,
    count(*) filter (where property_age >= 10)              as cnt_10p,
    count(*) filter (where property_age is null)            as cnt_unknown,
    count(*)                                                 as cnt_total,
    (select jsonb_object_agg(bucket, per_platform) from (
       select bucket, jsonb_object_agg(platform, cnt) as per_platform
       from (
         select
           case
             when property_age is null then 'unknown'
             when property_age = 0 then 'new'
             when property_age between 1 and 2 then '1_2'
             when property_age between 3 and 5 then '3_5'
             when property_age between 6 and 9 then '6_9'
             else '10p'
           end as bucket,
           coalesce(platform, 'unknown') as platform,
           count(*) as cnt
         from scoped
         group by 1, 2
       ) g
       group by bucket
    ) agg) as platform_breakdown
  from scoped;
$function$;

grant execute on function public.property_age_option_counts_ar(
  text, text, text[], text[], text[], text[], integer[], text[], text[], text[],
  integer[], integer, numeric, numeric, integer, integer, text, text[], integer
) to anon, authenticated;
