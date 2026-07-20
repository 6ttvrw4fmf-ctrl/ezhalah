-- IMMEDIATE CORRECTIVE REVERT: the prior migration (fix_buy_monthly_zero_and_empty_array_traps) used
-- regexp_replace() WITHOUT the 'g' flag for p_cities/p_districts, which only replaces the FIRST match --
-- but "p_cities is null" / "p_districts is null" each appear TWICE in these functions: once in the
-- unrelated production_ready-visibility gate (`s.production_ready or (p_cities is null and p_districts
-- is null and p_region_ids is null)`), and once in the actual filter clause. The regex hit the WRONG
-- (first) occurrence, corrupting the production_ready gate's boolean precedence
-- (`p_cities is null or cardinality(p_cities)=0 and p_districts is null or cardinality(p_districts)=0
-- and p_region_ids is null` parses as `p_cities is null OR (... AND ...) OR (... AND ...)` due to
-- AND binding tighter than OR in SQL) while leaving the REAL filter clause unfixed. This restores both
-- functions to their exact pre-fix bodies (byte-identical to what was live before this migration's
-- predecessor ran), verified against the pg_get_functiondef() captured immediately before that
-- migration ran. The correct fix (targeting only the real filter clauses, with occurrence-scoped
-- replacements) follows in a separate forward migration
-- (fix_buy_monthly_zero_and_empty_array_traps_v2) -- history is never edited, only moved forward.

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
    where (s.production_ready or (p_cities is null and p_districts is null and p_region_ids is null))
      and (p_deal       is null or s.deal_ar = p_deal)
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
      and ((p_bath_exact is null and p_bath_min is null)
           or (p_bath_exact is not null and s.bathrooms = any(p_bath_exact))
           or (p_bath_min   is not null and s.bathrooms is not null and s.bathrooms >= p_bath_min))
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

CREATE OR REPLACE FUNCTION public.property_age_option_counts_ar(p_deal text DEFAULT NULL::text, p_rent_period text DEFAULT NULL::text, p_cities text[] DEFAULT NULL::text[], p_districts text[] DEFAULT NULL::text[], p_tables text[] DEFAULT NULL::text[], p_platforms text[] DEFAULT NULL::text[], p_region_ids integer[] DEFAULT NULL::integer[], p_tables2 text[] DEFAULT NULL::text[], p_types2 text[] DEFAULT NULL::text[], p_types text[] DEFAULT NULL::text[], p_beds_exact integer[] DEFAULT NULL::integer[], p_beds_min integer DEFAULT NULL::integer, p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_area_min integer DEFAULT NULL::integer, p_area_max integer DEFAULT NULL::integer, p_category text DEFAULT NULL::text)
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

notify pgrst, 'reload schema';
