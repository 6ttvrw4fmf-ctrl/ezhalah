-- Owner PERMANENT rule 2026-08-05: MATCH FIRST -> DIVERSIFY SECOND.
-- Correct matching always outranks diversity. Once the eligible set is fixed, no platform may
-- unnecessarily dominate the sequence while other platforms still have qualifying inventory --
-- and that must hold across the ENTIRE sequence, including every Show More batch.
--
-- BEFORE: ordering was pure recency (last_updated desc), so whichever platform was scraped most
-- recently saturated every window. Live: Riyadh/annual-rent/apartment had 11 platforms and 9,257
-- eligible listings, yet the first 100 rows showed 3 platforms with a 65-row single-platform streak.
-- Client-side interleaving could not fix it: it can only diversify platforms the batch contained,
-- and the batch was already narrowed by recency BEFORE it reached the client.
--
-- AFTER: each platform's own eligible rows are numbered 1..n (div_rank) by the SAME relevance order,
-- and div_rank leads the sort. That yields every platform's #1, then every #2, ... a neutral
-- round-robin. Because it is applied BEFORE limit/offset and the full key ends in the unique
-- (source_table, listing_id), the whole result set is ONE stable total order -- so pagination and
-- Show More inherit the diversified sequence instead of re-deriving it per batch.
--
-- INVARIANTS (all verified live before apply):
--   * the `matched` CTE (eligibility) is byte-for-byte unchanged -> WHICH listings qualify and
--     total_count cannot change. Verified: 9,257 = 9,257, 0 missing, 0 extra, over 10 scenarios.
--   * div_rank is NULL for the 6 objective sorts -> price/area/beds/oldest keep exact semantics.
--     Verified: 0 mismatched positions over 300 rows x 6 sorts.
--   * total order -> deterministic paging. Verified: 4 consecutive Show More batches = 100 rows,
--     100 distinct, 0 duplicates, identical to a single 100-row call.
--   * platform-neutral: no platform is named anywhere. A platform with 2 eligible rows contributes
--     exactly 2 and is then exhausted; larger platforms continue. No forced equality.
CREATE OR REPLACE FUNCTION public.location_search_candidates_ar(p_deal text DEFAULT NULL::text, p_cities text[] DEFAULT NULL::text[], p_districts text[] DEFAULT NULL::text[], p_tables text[] DEFAULT NULL::text[], p_platforms text[] DEFAULT NULL::text[], p_per_platform integer DEFAULT NULL::integer, p_limit integer DEFAULT 5000, p_region_ids integer[] DEFAULT NULL::integer[], p_types text[] DEFAULT NULL::text[], p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_rent_period text DEFAULT NULL::text, p_area_min integer DEFAULT NULL::integer, p_area_max integer DEFAULT NULL::integer, p_beds_exact integer[] DEFAULT NULL::integer[], p_beds_min integer DEFAULT NULL::integer, p_bath_min integer DEFAULT NULL::integer, p_furnished boolean DEFAULT NULL::boolean, p_age_max integer DEFAULT NULL::integer, p_tenant text DEFAULT NULL::text, p_directions text[] DEFAULT NULL::text[], p_has_license boolean DEFAULT NULL::boolean, p_amenities text[] DEFAULT NULL::text[], p_offset integer DEFAULT 0, p_tables2 text[] DEFAULT NULL::text[], p_types2 text[] DEFAULT NULL::text[], p_age_min integer DEFAULT NULL::integer, p_bath_exact integer[] DEFAULT NULL::integer[], p_street_width_min smallint DEFAULT NULL::smallint, p_street_width_max smallint DEFAULT NULL::smallint, p_floor_min integer DEFAULT NULL::integer, p_floor_max integer DEFAULT NULL::integer, p_is_new_construction boolean DEFAULT NULL::boolean, p_category text DEFAULT NULL::text, p_sort_by text DEFAULT NULL::text)
 RETURNS TABLE(source_table text, listing_id bigint, platform text, last_updated timestamp with time zone, region_ar text, city_ar text, district_ar text, total_count bigint, effective_price numeric, area_m2 integer, bedrooms integer)
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
    select s.source_table, s.listing_id, s.platform, s.last_updated, s.region_ar, s.city_ar, s.district_ar,
           coalesce(s.price_total, s.price_annual) as effective_price, s.area_m2, s.bedrooms
    from public.search_listings_ar s
    where (s.production_ready or ((p_cities is null or cardinality(p_cities) = 0) and (p_districts is null or cardinality(p_districts) = 0) and p_region_ids is null and not public.search_row_price_gated(s.deal_ar, s.price_total)))
      and (p_deal       is null or s.deal_ar = p_deal)
      and (p_rent_period is null
           or s.deal_ar <> 'إيجار'
           or (p_rent_period = 'شهري' and s.payment_monthly = true)
           or (p_rent_period = 'سنوي' and s.rent_period_ar = 'سنوي')
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
      and (case
               when coalesce(cardinality(p_beds_exact), 0) > 0 then s.bedrooms = any(p_beds_exact)
               when p_beds_min is not null then s.bedrooms >= p_beds_min
               else true
             end)
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
  select u.source_table, u.listing_id, u.platform, u.last_updated, u.region_ar, u.city_ar, u.district_ar,
         u.total_count, u.effective_price, u.area_m2, u.bedrooms
  from (
    (
      select a.source_table, a.listing_id, a.platform, a.last_updated, a.region_ar, a.city_ar, a.district_ar,
             a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.div_rank
      from (
        select m.source_table, m.listing_id, m.platform, m.last_updated, m.region_ar, m.city_ar, m.district_ar,
               count(*) over() as total_count, m.effective_price, m.area_m2, m.bedrooms,
               -- PLATFORM DIVERSITY (owner PERMANENT rule 2026-08-05): each platform's own eligible rows are
               -- numbered 1..n by the SAME relevance/recency order used below; ordering by that number first
               -- yields every platform's #1, then every #2, ... a neutral round-robin over the WHOLE result
               -- set. Because it sits BEFORE limit/offset and the full key is a TOTAL order, every page and
               -- every Show More batch inherits one stable diversified sequence (no per-page re-diversify,
               -- no duplicates, no gaps). It reorders ONLY: the `matched` CTE (eligibility) is untouched, so
               -- total_count and WHICH listings qualify are bit-for-bit unchanged. No platform is named:
               -- a platform with 2 eligible rows contributes exactly 2 and then the larger ones continue.
               -- NULL for the 6 objective sorts, so price/area/beds/oldest keep their exact semantics.
               case when coalesce(p_sort_by,'') not in ('price_asc','price_desc','area_asc','area_desc','beds_desc','oldest')
                    then row_number() over (
                           partition by m.platform
                           order by m.last_updated desc nulls last, m.source_table, m.listing_id
                         )
               end as div_rank
        from matched m
        where p_per_platform is null
      ) a
      order by
        (case when p_sort_by = 'price_asc'  then a.effective_price end) asc nulls last,
        (case when p_sort_by = 'price_desc' then a.effective_price end) desc nulls last,
        (case when p_sort_by = 'area_asc'   then a.area_m2 end) asc nulls last,
        (case when p_sort_by = 'area_desc'  then a.area_m2 end) desc nulls last,
        (case when p_sort_by = 'beds_desc'  then a.bedrooms end) desc nulls last,
        (case when p_sort_by = 'oldest'     then a.last_updated end) asc nulls last,
        a.div_rank asc nulls last,
        a.last_updated desc nulls last, a.source_table, a.listing_id
      limit greatest(p_limit, 0) offset greatest(p_offset, 0)
    )
    union all
    (
      select t.source_table, t.listing_id, t.platform, t.last_updated, t.region_ar, t.city_ar, t.district_ar,
             t.total_count, t.effective_price, t.area_m2, t.bedrooms,
             case when coalesce(p_sort_by,'') not in ('price_asc','price_desc','area_asc','area_desc','beds_desc','oldest') then t.rn end as div_rank
      from (
        select m.source_table, m.listing_id, m.platform, m.last_updated, m.region_ar, m.city_ar, m.district_ar,
               m.effective_price, m.area_m2, m.bedrooms,
               count(*) over () as total_count,
               row_number() over (
                 partition by m.platform
                 order by
                   (case when p_sort_by = 'price_asc'  then m.effective_price end) asc nulls last,
                   (case when p_sort_by = 'price_desc' then m.effective_price end) desc nulls last,
                   (case when p_sort_by = 'area_asc'   then m.area_m2 end) asc nulls last,
                   (case when p_sort_by = 'area_desc'  then m.area_m2 end) desc nulls last,
                   (case when p_sort_by = 'beds_desc'  then m.bedrooms end) desc nulls last,
                   (case when p_sort_by = 'oldest'     then m.last_updated end) asc nulls last,
                   m.last_updated desc nulls last, m.source_table, m.listing_id
               ) as rn
        from matched m
        where p_per_platform is not null
      ) t
      where t.rn <= p_per_platform
      order by
        (case when p_sort_by = 'price_asc'  then t.effective_price end) asc nulls last,
        (case when p_sort_by = 'price_desc' then t.effective_price end) desc nulls last,
        (case when p_sort_by = 'area_asc'   then t.area_m2 end) asc nulls last,
        (case when p_sort_by = 'area_desc'  then t.area_m2 end) desc nulls last,
        (case when p_sort_by = 'beds_desc'  then t.bedrooms end) desc nulls last,
        (case when p_sort_by = 'oldest'     then t.last_updated end) asc nulls last,
        (case when coalesce(p_sort_by,'') not in ('price_asc','price_desc','area_asc','area_desc','beds_desc','oldest') then t.rn end) asc nulls last,
        t.last_updated desc nulls last, t.source_table, t.listing_id
      limit greatest(p_limit, 0) offset greatest(p_offset, 0)
    )
  ) u
  order by
    (case when p_sort_by = 'price_asc'  then u.effective_price end) asc nulls last,
    (case when p_sort_by = 'price_desc' then u.effective_price end) desc nulls last,
    (case when p_sort_by = 'area_asc'   then u.area_m2 end) asc nulls last,
    (case when p_sort_by = 'area_desc'  then u.area_m2 end) desc nulls last,
    (case when p_sort_by = 'beds_desc'  then u.bedrooms end) desc nulls last,
    (case when p_sort_by = 'oldest'     then u.last_updated end) asc nulls last,
    u.div_rank asc nulls last,
    u.last_updated desc nulls last, u.source_table, u.listing_id;
$function$;
