-- REPLAY CHECKPOINT 2 (2026-08-15): literal definitions of the three shared AF RPC surfaces
-- immediately after monthly_bucket_restore_rnpl_read_guard, byte-identical to production
-- (asserted below against af_rpc_build_state). Same purpose and same slate-wipe semantics as
-- af_rpc_replay_checkpoint: the guard migration rebuilds dynamically via rebuild_af_filter_rpcs(),
-- which scripts/lib/rpcReplay.ts correctly refuses to model; this literal snapshot is what a
-- fresh replay resolves to. The template path remains the only sanctioned editor; this file
-- changes nothing. It is also the repo's proof that the شهري bucket reads
-- payment_monthly = true and not coalesce(s.rent_now_pay_later, false) at query time.

CREATE OR REPLACE FUNCTION public.location_search_candidates_ar(p_deal text DEFAULT NULL::text, p_cities text[] DEFAULT NULL::text[], p_districts text[] DEFAULT NULL::text[], p_tables text[] DEFAULT NULL::text[], p_platforms text[] DEFAULT NULL::text[], p_per_platform integer DEFAULT NULL::integer, p_limit integer DEFAULT 5000, p_region_ids integer[] DEFAULT NULL::integer[], p_types text[] DEFAULT NULL::text[], p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_rent_period text DEFAULT NULL::text, p_area_min integer DEFAULT NULL::integer, p_area_max integer DEFAULT NULL::integer, p_beds_exact integer[] DEFAULT NULL::integer[], p_beds_min integer DEFAULT NULL::integer, p_bath_min integer DEFAULT NULL::integer, p_furnished boolean DEFAULT NULL::boolean, p_age_max integer DEFAULT NULL::integer, p_tenant text DEFAULT NULL::text, p_directions text[] DEFAULT NULL::text[], p_has_license boolean DEFAULT NULL::boolean, p_amenities text[] DEFAULT NULL::text[], p_offset integer DEFAULT 0, p_tables2 text[] DEFAULT NULL::text[], p_types2 text[] DEFAULT NULL::text[], p_age_min integer DEFAULT NULL::integer, p_bath_exact integer[] DEFAULT NULL::integer[], p_street_width_min smallint DEFAULT NULL::smallint, p_street_width_max smallint DEFAULT NULL::smallint, p_floor_min integer DEFAULT NULL::integer, p_floor_max integer DEFAULT NULL::integer, p_is_new_construction boolean DEFAULT NULL::boolean, p_category text DEFAULT NULL::text, p_sort_by text DEFAULT NULL::text, p_age_unknown boolean DEFAULT NULL::boolean)
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
    -- AMBIGUITY GUARD (2026-08-15): only bridge an English name that resolves to exactly ONE
    -- canonical Arabic city. The bridge is source-observed and noisy ('Riyadh' → 19 distinct
    -- Arabic cities), so an unguarded join fans a single city request out across the country.
    select normalize_ar(b.city_ar)
    from unnest(coalesce(p_cities, '{}')) c
    join city_name_bridge b on norm_en_place(b.city_en) = norm_en_place(c)
    where (select count(distinct normalize_ar(b2.city_ar))
             from city_name_bridge b2
            where norm_en_place(b2.city_en) = norm_en_place(c)) = 1
  ), city_ids as (
    select cc.city_id from loc_catalog_city cc join city_tokens t on cc.city_norm = t.tok
    union
    select a.city_id from loc_catalog_city_alias a join city_tokens t on a.alias_norm = t.tok
  ),
  matched as not materialized (
    select s.source_table, s.listing_id, s.platform, s.last_updated, coalesce(s.last_updated, s.first_seen_at) as recency_at, s.region_ar, s.city_ar, s.district_ar,
           coalesce(s.price_total, s.price_annual) as effective_price, s.area_m2, s.bedrooms
    from public.search_listings_ar s
    
    where (s.production_ready or ((p_cities is null or cardinality(p_cities) = 0) and (p_districts is null or cardinality(p_districts) = 0) and p_region_ids is null and not public.search_row_price_gated(s.deal_ar, s.price_total) and (s.region_id is null or s.city_id is null)))
      -- read-side defense-in-depth (2026-08): block only Ezhalah-side impossible/invalid states;
      -- never hides a source price (no magnitude check; 0 legal); production_ready must have a location.
      and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0
      and s.deal_ar is not null
      and (not s.production_ready or (s.city_id is not null and s.region_id is not null))
      and (p_deal       is null or s.deal_ar = p_deal)
      and (p_rent_period is null
           or s.deal_ar <> 'إيجار'
           or (p_rent_period = 'شهري' and s.payment_monthly = true and not coalesce(s.rent_now_pay_later, false))
           or (p_rent_period = 'سنوي' and (s.rent_period_ar = 'سنوي' or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false))))
           or (p_rent_period = 'كلاهما' and (s.payment_monthly = true or s.rent_period_ar = 'سنوي' or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false))))
           or (p_rent_period not in ('شهري','سنوي','كلاهما') and s.rent_period_ar = p_rent_period))
      and (
            ((p_tables is null or s.source_table = any(p_tables))
             and (p_types is null or s.type_ar = any(p_types)))
         or (p_tables2 is not null and p_types2 is not null
             and s.source_table = any(p_tables2)
             and s.type_ar = any(p_types2))
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
                          when 'Residential' then s.source_table like '%\_residential\_listings'
                          when 'Commercial'  then s.source_table like '%\_commercial\_listings'
                          else true
                        end)
                 )
               )
           ))
      and (p_cities is null or cardinality(p_cities) = 0
           or normalize_ar(s.city_ar) = any (array(select tok from city_tokens))
           or s.city_id = any (array(select city_id from city_ids))
           or s.match_city_ids && (select array_agg(city_id) from city_ids))
      and (p_districts is null or cardinality(p_districts) = 0 or norm_district_tok(s.district_ar) = any (array(select tok from district_tokens)))
      and (p_platforms is null or cardinality(p_platforms) = 0 or s.platform = any(p_platforms))
      -- CARDINALITY CAP (2026-08-15): an oversized array is anon-callable DoS, and a request that
      -- large is never a real user. Fail CLOSED (no rows) rather than burning 20s of DB time.
      and coalesce(cardinality(p_cities), 0)    <= 200
      and coalesce(cardinality(p_districts), 0) <= 500
      and coalesce(cardinality(p_types), 0)     <= 200
      and coalesce(cardinality(p_platforms), 0) <= 100
      and coalesce(cardinality(p_tables), 0)    <= 200
      and (p_region_ids is null or s.region_id = any(p_region_ids))
      and (nullif(p_area_min,0) is null or (s.area_m2 is not null and s.area_m2 >= p_area_min))
      and (nullif(p_area_max,0) is null or (s.area_m2 is not null and s.area_m2 <= p_area_max))
      and ((coalesce(cardinality(p_bath_exact),0) = 0 and p_bath_min is null)
           or (coalesce(cardinality(p_bath_exact),0) > 0 and s.bathrooms = any(p_bath_exact))
           or (p_bath_min is not null and s.bathrooms is not null and s.bathrooms >= p_bath_min))
      and ((coalesce(cardinality(p_beds_exact),0) = 0 and p_beds_min is null) or (coalesce(cardinality(p_beds_exact),0) > 0 and s.bedrooms = any(p_beds_exact)) or (p_beds_min is not null and s.bedrooms >= p_beds_min))
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
      and (p_age_unknown is null or (s.property_age is null) = p_age_unknown)
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
      select a.source_table, a.listing_id, a.platform, a.last_updated, a.recency_at, a.region_ar, a.city_ar, a.district_ar,
             a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.div_rank
      from (
        select m.source_table, m.listing_id, m.platform, m.last_updated, m.recency_at, m.region_ar, m.city_ar, m.district_ar,
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
                           order by m.recency_at desc nulls last, m.source_table, m.listing_id
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
        (case when p_sort_by = 'oldest'     then a.recency_at end) asc nulls last,
        a.div_rank asc nulls last,
        a.recency_at desc nulls last, a.source_table, a.listing_id
      limit greatest(p_limit, 0) offset greatest(p_offset, 0)
    )
    union all
    (
      select t.source_table, t.listing_id, t.platform, t.last_updated, t.recency_at, t.region_ar, t.city_ar, t.district_ar,
             t.total_count, t.effective_price, t.area_m2, t.bedrooms,
             case when coalesce(p_sort_by,'') not in ('price_asc','price_desc','area_asc','area_desc','beds_desc','oldest') then t.rn end as div_rank
      from (
        select m.source_table, m.listing_id, m.platform, m.last_updated, m.recency_at, m.region_ar, m.city_ar, m.district_ar,
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
                   (case when p_sort_by = 'oldest'     then m.recency_at end) asc nulls last,
                   m.recency_at desc nulls last, m.source_table, m.listing_id
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
        (case when p_sort_by = 'oldest'     then t.recency_at end) asc nulls last,
        (case when coalesce(p_sort_by,'') not in ('price_asc','price_desc','area_asc','area_desc','beds_desc','oldest') then t.rn end) asc nulls last,
        t.recency_at desc nulls last, t.source_table, t.listing_id
      limit greatest(p_limit, 0) offset greatest(p_offset, 0)
    )
  ) u
  order by
    (case when p_sort_by = 'price_asc'  then u.effective_price end) asc nulls last,
    (case when p_sort_by = 'price_desc' then u.effective_price end) desc nulls last,
    (case when p_sort_by = 'area_asc'   then u.area_m2 end) asc nulls last,
    (case when p_sort_by = 'area_desc'  then u.area_m2 end) desc nulls last,
    (case when p_sort_by = 'beds_desc'  then u.bedrooms end) desc nulls last,
    (case when p_sort_by = 'oldest'     then u.recency_at end) asc nulls last,
    u.div_rank asc nulls last,
    u.recency_at desc nulls last, u.source_table, u.listing_id;
$function$
;

CREATE OR REPLACE FUNCTION public.apartment_guided_counts_ar(p_deal text DEFAULT NULL::text, p_rent_period text DEFAULT NULL::text, p_cities text[] DEFAULT NULL::text[], p_districts text[] DEFAULT NULL::text[], p_tables text[] DEFAULT NULL::text[], p_platforms text[] DEFAULT NULL::text[], p_region_ids integer[] DEFAULT NULL::integer[], p_tables2 text[] DEFAULT NULL::text[], p_types2 text[] DEFAULT NULL::text[], p_types text[] DEFAULT NULL::text[], p_beds_exact integer[] DEFAULT NULL::integer[], p_beds_min integer DEFAULT NULL::integer, p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_area_min integer DEFAULT NULL::integer, p_area_max integer DEFAULT NULL::integer, p_category text DEFAULT NULL::text, p_age_min integer DEFAULT NULL::integer, p_age_max integer DEFAULT NULL::integer, p_age_unknown boolean DEFAULT NULL::boolean, p_is_new_construction boolean DEFAULT NULL::boolean, p_amenities text[] DEFAULT NULL::text[], p_bath_min integer DEFAULT NULL::integer, p_bath_exact integer[] DEFAULT NULL::integer[], p_furnished boolean DEFAULT NULL::boolean, p_tenant text DEFAULT NULL::text, p_directions text[] DEFAULT NULL::text[], p_has_license boolean DEFAULT NULL::boolean, p_street_width_min smallint DEFAULT NULL::smallint, p_street_width_max smallint DEFAULT NULL::smallint, p_floor_min integer DEFAULT NULL::integer, p_floor_max integer DEFAULT NULL::integer)
 RETURNS TABLE(cnt_total_base bigint, cnt_rnpl bigint, cnt_kitchen bigint, cnt_parking bigint, cnt_elevator bigint, cnt_furnished bigint, cnt_ac bigint, cnt_private_entrance bigint, cnt_unfurnished bigint, cnt_maid_room bigint, cnt_driver_room bigint, cnt_bath1 bigint, cnt_bath2 bigint, cnt_bath3 bigint, cnt_bath4 bigint, cnt_dir_n bigint, cnt_dir_s bigint, cnt_dir_e bigint, cnt_dir_w bigint, cnt_dir_ne bigint, cnt_dir_nw bigint, cnt_dir_se bigint, cnt_dir_sw bigint, cnt_stw15 bigint, cnt_stw20 bigint, cnt_stw25 bigint, cnt_stw30 bigint, cnt_selected bigint)
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
    -- AMBIGUITY GUARD (2026-08-15): only bridge an English name that resolves to exactly ONE
    -- canonical Arabic city. The bridge is source-observed and noisy ('Riyadh' → 19 distinct
    -- Arabic cities), so an unguarded join fans a single city request out across the country.
    select normalize_ar(b.city_ar)
    from unnest(coalesce(p_cities, '{}')) c
    join city_name_bridge b on norm_en_place(b.city_en) = norm_en_place(c)
    where (select count(distinct normalize_ar(b2.city_ar))
             from city_name_bridge b2
            where norm_en_place(b2.city_en) = norm_en_place(c)) = 1
  ), city_ids as (
    select cc.city_id from loc_catalog_city cc join city_tokens t on cc.city_norm = t.tok
    union
    select a.city_id from loc_catalog_city_alias a join city_tokens t on a.alias_norm = t.tok
  ), scoped as (
    select s.rent_now_pay_later, s.kitchen, s.parking, s.elevator, s.furnished, s.bathrooms, s.air_conditioner, s.private_entrance, s.maid_room, s.driver_room, public.norm_direction_ar(s.direction_ar) as dirn, s.street_width_m
    from public.search_listings_ar s
    
    where (s.production_ready or ((p_cities is null or cardinality(p_cities) = 0) and (p_districts is null or cardinality(p_districts) = 0) and p_region_ids is null and not public.search_row_price_gated(s.deal_ar, s.price_total) and (s.region_id is null or s.city_id is null)))
      -- read-side defense-in-depth (2026-08): block only Ezhalah-side impossible/invalid states;
      -- never hides a source price (no magnitude check; 0 legal); production_ready must have a location.
      and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0
      and s.deal_ar is not null
      and (not s.production_ready or (s.city_id is not null and s.region_id is not null))
      and (p_deal       is null or s.deal_ar = p_deal)
      and (p_rent_period is null
           or s.deal_ar <> 'إيجار'
           or (p_rent_period = 'شهري' and s.payment_monthly = true and not coalesce(s.rent_now_pay_later, false))
           or (p_rent_period = 'سنوي' and (s.rent_period_ar = 'سنوي' or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false))))
           or (p_rent_period = 'كلاهما' and (s.payment_monthly = true or s.rent_period_ar = 'سنوي' or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false))))
           or (p_rent_period not in ('شهري','سنوي','كلاهما') and s.rent_period_ar = p_rent_period))
      and (
            ((p_tables is null or s.source_table = any(p_tables))
             and (p_types is null or s.type_ar = any(p_types)))
         or (p_tables2 is not null and p_types2 is not null
             and s.source_table = any(p_tables2)
             and s.type_ar = any(p_types2))
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
                          when 'Residential' then s.source_table like '%\_residential\_listings'
                          when 'Commercial'  then s.source_table like '%\_commercial\_listings'
                          else true
                        end)
                 )
               )
           ))
      and (p_cities is null or cardinality(p_cities) = 0
           or normalize_ar(s.city_ar) = any (array(select tok from city_tokens))
           or s.city_id = any (array(select city_id from city_ids))
           or s.match_city_ids && (select array_agg(city_id) from city_ids))
      and (p_districts is null or cardinality(p_districts) = 0 or norm_district_tok(s.district_ar) = any (array(select tok from district_tokens)))
      and (p_platforms is null or cardinality(p_platforms) = 0 or s.platform = any(p_platforms))
      -- CARDINALITY CAP (2026-08-15): an oversized array is anon-callable DoS, and a request that
      -- large is never a real user. Fail CLOSED (no rows) rather than burning 20s of DB time.
      and coalesce(cardinality(p_cities), 0)    <= 200
      and coalesce(cardinality(p_districts), 0) <= 500
      and coalesce(cardinality(p_types), 0)     <= 200
      and coalesce(cardinality(p_platforms), 0) <= 100
      and coalesce(cardinality(p_tables), 0)    <= 200
      and (p_region_ids is null or s.region_id = any(p_region_ids))
      and (nullif(p_area_min,0) is null or (s.area_m2 is not null and s.area_m2 >= p_area_min))
      and (nullif(p_area_max,0) is null or (s.area_m2 is not null and s.area_m2 <= p_area_max))
      and ((coalesce(cardinality(p_bath_exact),0) = 0 and p_bath_min is null)
           or (coalesce(cardinality(p_bath_exact),0) > 0 and s.bathrooms = any(p_bath_exact))
           or (p_bath_min is not null and s.bathrooms is not null and s.bathrooms >= p_bath_min))
      and ((coalesce(cardinality(p_beds_exact),0) = 0 and p_beds_min is null) or (coalesce(cardinality(p_beds_exact),0) > 0 and s.bedrooms = any(p_beds_exact)) or (p_beds_min is not null and s.bedrooms >= p_beds_min))
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
      and (p_age_unknown is null or (s.property_age is null) = p_age_unknown)
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
  select
    count(*)                                                as cnt_total_base,
    count(*) filter (where rent_now_pay_later)              as cnt_rnpl,
    count(*) filter (where kitchen)                         as cnt_kitchen,
    count(*) filter (where parking)                         as cnt_parking,
    count(*) filter (where elevator)                        as cnt_elevator,
    count(*) filter (where furnished)                       as cnt_furnished,
    count(*) filter (where air_conditioner)                 as cnt_ac,
    count(*) filter (where private_entrance)                as cnt_private_entrance,
    count(*) filter (where furnished is false)              as cnt_unfurnished,
    count(*) filter (where maid_room)                       as cnt_maid_room,
    count(*) filter (where driver_room)                     as cnt_driver_room,
    count(*) filter (where bathrooms >= 1)                  as cnt_bath1,
    count(*) filter (where bathrooms >= 2)                  as cnt_bath2,
    count(*) filter (where bathrooms >= 3)                  as cnt_bath3,
    count(*) filter (where bathrooms >= 4)                  as cnt_bath4,
    count(*) filter (where dirn = 'شمال')                   as cnt_dir_n,
    count(*) filter (where dirn = 'جنوب')                   as cnt_dir_s,
    count(*) filter (where dirn = 'شرق')                    as cnt_dir_e,
    count(*) filter (where dirn = 'غرب')                    as cnt_dir_w,
    count(*) filter (where dirn = 'شمال شرق')               as cnt_dir_ne,
    count(*) filter (where dirn = 'شمال غرب')               as cnt_dir_nw,
    count(*) filter (where dirn = 'جنوب شرق')               as cnt_dir_se,
    count(*) filter (where dirn = 'جنوب غرب')               as cnt_dir_sw,
    count(*) filter (where street_width_m >= 15)            as cnt_stw15,
    count(*) filter (where street_width_m >= 20)            as cnt_stw20,
    count(*) filter (where street_width_m >= 25)            as cnt_stw25,
    count(*) filter (where street_width_m >= 30)            as cnt_stw30,
    count(*)                                                as cnt_selected
  from scoped;
$function$
;

CREATE OR REPLACE FUNCTION public.property_age_option_counts_ar(p_deal text DEFAULT NULL::text, p_rent_period text DEFAULT NULL::text, p_cities text[] DEFAULT NULL::text[], p_districts text[] DEFAULT NULL::text[], p_tables text[] DEFAULT NULL::text[], p_platforms text[] DEFAULT NULL::text[], p_region_ids integer[] DEFAULT NULL::integer[], p_tables2 text[] DEFAULT NULL::text[], p_types2 text[] DEFAULT NULL::text[], p_types text[] DEFAULT NULL::text[], p_beds_exact integer[] DEFAULT NULL::integer[], p_beds_min integer DEFAULT NULL::integer, p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_area_min integer DEFAULT NULL::integer, p_area_max integer DEFAULT NULL::integer, p_category text DEFAULT NULL::text, p_age_min integer DEFAULT NULL::integer, p_age_max integer DEFAULT NULL::integer, p_age_unknown boolean DEFAULT NULL::boolean, p_is_new_construction boolean DEFAULT NULL::boolean, p_amenities text[] DEFAULT NULL::text[], p_bath_min integer DEFAULT NULL::integer, p_bath_exact integer[] DEFAULT NULL::integer[], p_furnished boolean DEFAULT NULL::boolean, p_tenant text DEFAULT NULL::text, p_directions text[] DEFAULT NULL::text[], p_has_license boolean DEFAULT NULL::boolean, p_street_width_min smallint DEFAULT NULL::smallint, p_street_width_max smallint DEFAULT NULL::smallint, p_floor_min integer DEFAULT NULL::integer, p_floor_max integer DEFAULT NULL::integer)
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
    -- AMBIGUITY GUARD (2026-08-15): only bridge an English name that resolves to exactly ONE
    -- canonical Arabic city. The bridge is source-observed and noisy ('Riyadh' → 19 distinct
    -- Arabic cities), so an unguarded join fans a single city request out across the country.
    select normalize_ar(b.city_ar)
    from unnest(coalesce(p_cities, '{}')) c
    join city_name_bridge b on norm_en_place(b.city_en) = norm_en_place(c)
    where (select count(distinct normalize_ar(b2.city_ar))
             from city_name_bridge b2
            where norm_en_place(b2.city_en) = norm_en_place(c)) = 1
  ), city_ids as (
    select cc.city_id from loc_catalog_city cc join city_tokens t on cc.city_norm = t.tok
    union
    select a.city_id from loc_catalog_city_alias a join city_tokens t on a.alias_norm = t.tok
  ), scoped as (
    select s.platform, s.property_age
    from public.search_listings_ar s
    
    where (s.production_ready or ((p_cities is null or cardinality(p_cities) = 0) and (p_districts is null or cardinality(p_districts) = 0) and p_region_ids is null and not public.search_row_price_gated(s.deal_ar, s.price_total) and (s.region_id is null or s.city_id is null)))
      -- read-side defense-in-depth (2026-08): block only Ezhalah-side impossible/invalid states;
      -- never hides a source price (no magnitude check; 0 legal); production_ready must have a location.
      and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0
      and s.deal_ar is not null
      and (not s.production_ready or (s.city_id is not null and s.region_id is not null))
      and (p_deal       is null or s.deal_ar = p_deal)
      and (p_rent_period is null
           or s.deal_ar <> 'إيجار'
           or (p_rent_period = 'شهري' and s.payment_monthly = true and not coalesce(s.rent_now_pay_later, false))
           or (p_rent_period = 'سنوي' and (s.rent_period_ar = 'سنوي' or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false))))
           or (p_rent_period = 'كلاهما' and (s.payment_monthly = true or s.rent_period_ar = 'سنوي' or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false))))
           or (p_rent_period not in ('شهري','سنوي','كلاهما') and s.rent_period_ar = p_rent_period))
      and (
            ((p_tables is null or s.source_table = any(p_tables))
             and (p_types is null or s.type_ar = any(p_types)))
         or (p_tables2 is not null and p_types2 is not null
             and s.source_table = any(p_tables2)
             and s.type_ar = any(p_types2))
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
                          when 'Residential' then s.source_table like '%\_residential\_listings'
                          when 'Commercial'  then s.source_table like '%\_commercial\_listings'
                          else true
                        end)
                 )
               )
           ))
      and (p_cities is null or cardinality(p_cities) = 0
           or normalize_ar(s.city_ar) = any (array(select tok from city_tokens))
           or s.city_id = any (array(select city_id from city_ids))
           or s.match_city_ids && (select array_agg(city_id) from city_ids))
      and (p_districts is null or cardinality(p_districts) = 0 or norm_district_tok(s.district_ar) = any (array(select tok from district_tokens)))
      and (p_platforms is null or cardinality(p_platforms) = 0 or s.platform = any(p_platforms))
      -- CARDINALITY CAP (2026-08-15): an oversized array is anon-callable DoS, and a request that
      -- large is never a real user. Fail CLOSED (no rows) rather than burning 20s of DB time.
      and coalesce(cardinality(p_cities), 0)    <= 200
      and coalesce(cardinality(p_districts), 0) <= 500
      and coalesce(cardinality(p_types), 0)     <= 200
      and coalesce(cardinality(p_platforms), 0) <= 100
      and coalesce(cardinality(p_tables), 0)    <= 200
      and (p_region_ids is null or s.region_id = any(p_region_ids))
      and (nullif(p_area_min,0) is null or (s.area_m2 is not null and s.area_m2 >= p_area_min))
      and (nullif(p_area_max,0) is null or (s.area_m2 is not null and s.area_m2 <= p_area_max))
      and ((coalesce(cardinality(p_bath_exact),0) = 0 and p_bath_min is null)
           or (coalesce(cardinality(p_bath_exact),0) > 0 and s.bathrooms = any(p_bath_exact))
           or (p_bath_min is not null and s.bathrooms is not null and s.bathrooms >= p_bath_min))
      and ((coalesce(cardinality(p_beds_exact),0) = 0 and p_beds_min is null) or (coalesce(cardinality(p_beds_exact),0) > 0 and s.bedrooms = any(p_beds_exact)) or (p_beds_min is not null and s.bedrooms >= p_beds_min))
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
      and (p_age_unknown is null or (s.property_age is null) = p_age_unknown)
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
$function$
;

do $chk$
declare fn text; m text;
begin
  foreach fn in array array['location_search_candidates_ar','apartment_guided_counts_ar','property_age_option_counts_ar'] loop
    select md5(pg_get_functiondef(p.oid)) into m from pg_proc p where p.proname = fn and p.pronamespace = 'public'::regnamespace;
    if (select b.def_md5 from public.af_rpc_build_state b where b.fn_name = fn) is distinct from m then
      raise exception 'CHECKPOINT ABORT: % diverges from af_rpc_build_state', fn;
    end if;
  end loop;
end $chk$;