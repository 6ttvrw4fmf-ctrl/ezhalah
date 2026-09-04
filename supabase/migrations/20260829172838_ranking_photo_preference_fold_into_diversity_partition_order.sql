-- CORRECTION, same session, caught by live verification immediately after the previous migration
-- (ranking_photo_preference_and_rotation_order_by): computing div_rank on recency ALONE let a
-- platform's most-recent-but-no-photo listing outrank that SAME platform's older-but-real-photo
-- listing, because div_rank was compared before photo_rank in the outer ORDER BY. Live-reproduced:
-- wasalt/villa/بيع/الرياض/الملقا, a false-has_photo row sat at global position 5 while true-has_photo
-- wasalt rows sat at 11-83 - exactly the "photo-less occupying the first 10" failure the owner
-- explicitly said not to allow. Same signature as before (CREATE OR REPLACE, no new overload) -
-- folds photo preference into div_rank's OWN per-platform row_number() ordering (photo first, then
-- recency), so each platform's round-robin slot is its own BEST (real-photo, most-recent) listing;
-- a platform's no-photo listings only surface once its photo-having ones are exhausted, still within
-- that platform's fair diversity quota. total_count/eligibility/objective-sort behavior unchanged
-- (same reasoning as before: this only reorders row_number() WITHIN a platform, changes nothing
-- about which rows exist or how many). Re-verified after applying: set-hash, total_count, and
-- price_asc byte-identity all still match the pre-change baseline; the reproduced bug case (wasalt
-- villa/بيع/الرياض/الملقا) now shows every true-has_photo row before the platform's own false rows.
CREATE OR REPLACE FUNCTION public.location_search_candidates_ar(p_deal text DEFAULT NULL::text, p_cities text[] DEFAULT NULL::text[], p_districts text[] DEFAULT NULL::text[], p_tables text[] DEFAULT NULL::text[], p_platforms text[] DEFAULT NULL::text[], p_per_platform integer DEFAULT NULL::integer, p_limit integer DEFAULT 5000, p_region_ids integer[] DEFAULT NULL::integer[], p_types text[] DEFAULT NULL::text[], p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_rent_period text DEFAULT NULL::text, p_area_min integer DEFAULT NULL::integer, p_area_max integer DEFAULT NULL::integer, p_beds_exact integer[] DEFAULT NULL::integer[], p_beds_min integer DEFAULT NULL::integer, p_bath_min integer DEFAULT NULL::integer, p_furnished boolean DEFAULT NULL::boolean, p_age_max integer DEFAULT NULL::integer, p_tenant text DEFAULT NULL::text, p_directions text[] DEFAULT NULL::text[], p_has_license boolean DEFAULT NULL::boolean, p_amenities text[] DEFAULT NULL::text[], p_offset integer DEFAULT 0, p_tables2 text[] DEFAULT NULL::text[], p_types2 text[] DEFAULT NULL::text[], p_age_min integer DEFAULT NULL::integer, p_bath_exact integer[] DEFAULT NULL::integer[], p_street_width_min smallint DEFAULT NULL::smallint, p_street_width_max smallint DEFAULT NULL::smallint, p_floor_min integer DEFAULT NULL::integer, p_floor_max integer DEFAULT NULL::integer, p_is_new_construction boolean DEFAULT NULL::boolean, p_category text DEFAULT NULL::text, p_sort_by text DEFAULT NULL::text, p_age_unknown boolean DEFAULT NULL::boolean, p_rating_min numeric DEFAULT NULL::numeric, p_reviews_min integer DEFAULT NULL::integer, p_unit_subtypes text[] DEFAULT NULL::text[], p_price_min_rent numeric DEFAULT NULL::numeric, p_price_max_rent numeric DEFAULT NULL::numeric, p_rotation_seed text DEFAULT NULL::text)
 RETURNS TABLE(source_table text, listing_id bigint, platform text, last_updated timestamp with time zone, region_ar text, city_ar text, district_ar text, total_count bigint, effective_price numeric, area_m2 integer, bedrooms integer)
 LANGUAGE sql
 STABLE
AS $function$
  with district_tokens as (
    select norm_district_tok(d) as tok from unnest(coalesce(p_districts, '{}')) d
    union
    -- AMBIGUITY GUARD (2026-08-18, mirrors the city guard below): only bridge a name that
    -- resolves to exactly ONE canonical Arabic district. district_name_bridge is
    -- source-observed and noisy ('حقروصين' -> both 'حقروصين' and 'حي جعرانة'), so an
    -- unguarded join injects a FOREIGN حي as a search token and the user gets listings from a
    -- حي they did not select. Measured: 68 ambiguous names, 126 leaking pairs.
    select norm_district_tok(b.district_ar)
    from unnest(coalesce(p_districts, '{}')) d
    join district_name_bridge b on norm_en_place(b.district_en) = norm_en_place(d)
    where (select count(distinct norm_district_tok(b2.district_ar))
             from district_name_bridge b2
            where norm_en_place(b2.district_en) = norm_en_place(d)) = 1
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
           coalesce(s.price_total, s.price_annual) as effective_price, s.area_m2, s.bedrooms,
           -- PHOTO PREFERENCE (owner PERMANENT rule 2026-08-29): carried through untouched into the
           -- ranking stages below. NEVER referenced in any WHERE predicate above - this CTE's
           -- eligibility and total_count are bit-for-bit identical with or without this column.
           -- NULL = unknown/unaudited platform (ops_photo_capture_trust.trusted = false); see
           -- search_listings_ar.has_photo comment and the PHOTO PREFERENCE rule in ARCHITECTURE.md.
           s.has_photo
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
      and (
            (p_deal is null and s.deal_ar = 'بيع'
             and (nullif(p_price_min,0) is null and nullif(p_price_max,0) is null
                  or (s.price_total is not null and s.price_total > 0
                      and s.price_total >= coalesce(p_price_min,0) and s.price_total <= coalesce(nullif(p_price_max,0),1e15))))
         or (p_deal is null and s.deal_ar = 'إيجار'
             and (nullif(p_price_min_rent,0) is null and nullif(p_price_max_rent,0) is null
                  or (s.price_annual is not null and s.price_annual > 0
                      and s.price_annual >= coalesce(p_price_min_rent,0)
                      and s.price_annual <= coalesce(nullif(p_price_max_rent,0),1e15))))
         or (p_deal is not null and nullif(p_price_min,0) is null and nullif(p_price_max,0) is null)
         or (p_deal is not null and s.deal_ar = 'بيع'
               and s.price_total is not null and s.price_total > 0
               and s.price_total >= coalesce(p_price_min,0) and s.price_total <= coalesce(nullif(p_price_max,0),1e15))
         or (p_deal is not null and s.deal_ar = 'إيجار'
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
                           where tok not in ('elevator','parking','kitchen','ac','maid_room','driver_room','private_entrance','car_entrance','sanitation','electricity','water_supply','furnished','rnpl','rent_now_pay_later'))
           and (not ('elevator'         = any(p_amenities)) or s.elevator)
           and (not ('parking'          = any(p_amenities)) or s.parking)
           and (not ('kitchen'          = any(p_amenities)) or s.kitchen)
           and (not ('ac'               = any(p_amenities)) or s.air_conditioner)
           and (not ('maid_room'        = any(p_amenities)) or s.maid_room)
           and (not ('driver_room'      = any(p_amenities)) or s.driver_room)
           and (not ('private_entrance' = any(p_amenities)) or s.private_entrance)
           and (not ('car_entrance'     = any(p_amenities)) or s.car_entrance)
           and (not ('sanitation'       = any(p_amenities)) or s.sanitation)
           and (not ('electricity'      = any(p_amenities)) or s.electricity)
           and (not ('water_supply'     = any(p_amenities)) or s.water_supply)
           and (not ('furnished'        = any(p_amenities)) or s.furnished)
           and (not ('rnpl'             = any(p_amenities) or 'rent_now_pay_later' = any(p_amenities)) or s.rent_now_pay_later)))
      and ((p_street_width_min is null and p_street_width_max is null)
           or (s.street_width_m is not null
               and s.street_width_m >= coalesce(p_street_width_min, 0) and s.street_width_m <= coalesce(p_street_width_max, 32767)))
      and ((p_floor_min is null and p_floor_max is null)
           or (s.floor_number is not null
               and s.floor_number >= coalesce(p_floor_min, 0) and s.floor_number <= coalesce(p_floor_max, 2147483647)))
      and (p_rating_min is null or s.rating >= p_rating_min)
      and (p_reviews_min is null or s.reviews_count >= p_reviews_min)
      and (p_unit_subtypes is null or cardinality(p_unit_subtypes) = 0 or s.unit_subtype_ar = any(p_unit_subtypes))

  )
  select u.source_table, u.listing_id, u.platform, u.last_updated, u.region_ar, u.city_ar, u.district_ar,
         u.total_count, u.effective_price, u.area_m2, u.bedrooms
  from (
    (
      select a.source_table, a.listing_id, a.platform, a.last_updated, a.recency_at, a.region_ar, a.city_ar, a.district_ar,
             a.total_count, a.effective_price, a.area_m2, a.bedrooms, a.div_rank, a.photo_rank, a.rot_key
      from (
        select m.source_table, m.listing_id, m.platform, m.last_updated, m.recency_at, m.region_ar, m.city_ar, m.district_ar,
               count(*) over() as total_count, m.effective_price, m.area_m2, m.bedrooms,
               -- PLATFORM DIVERSITY (owner PERMANENT rule 2026-08-05): each platform's own eligible
               -- rows are numbered 1..n by the SAME relevance/recency order used below; ordering by
               -- that number first yields every platform's #1, then every #2, ... a neutral
               -- round-robin over the WHOLE result set. Because it sits BEFORE limit/offset and the
               -- full key is a TOTAL order, every page and every Show More batch inherits one stable
               -- diversified sequence (no per-page re-diversify, no duplicates, no gaps). It reorders
               -- ONLY: the `matched` CTE (eligibility) is untouched, so total_count and WHICH
               -- listings qualify are bit-for-bit unchanged. No platform is named: a platform with 2
               -- eligible rows contributes exactly 2 and then the larger ones continue.
               -- NULL for the 6 objective sorts, so price/area/beds/oldest keep their exact semantics.
               case when coalesce(p_sort_by,'') not in ('price_asc','price_desc','area_asc','area_desc','beds_desc','oldest')
                    then row_number() over (
                           partition by m.platform
                           -- PHOTO PREFERENCE folded into diversity's OWN per-platform ordering
                           -- (owner PERMANENT rule 2026-08-29, corrected same-session after live
                           -- verification caught the bug: computing div_rank on recency ALONE let a
                           -- platform's most-recent-but-no-photo listing outrank that SAME platform's
                           -- older-but-real-photo listing, because div_rank was compared before
                           -- photo_rank in the outer ORDER BY - exactly the "photo-less occupying the
                           -- first 10" failure the owner named. Each platform's #1 slot in the
                           -- round-robin is now its own BEST (real-photo, most-recent) listing; a
                           -- platform's no-photo listings only surface once its photo-having ones are
                           -- exhausted - still within that platform's own fair diversity quota, never
                           -- displacing another platform's slot.
                           order by (case when m.has_photo is true then 0 when m.has_photo is null then 1 else 2 end) asc,
                                    m.recency_at desc nulls last, m.source_table, m.listing_id
                         )
               end as div_rank,
               -- PHOTO PREFERENCE, tier 3 (owner PERMANENT rule 2026-08-29): 0 = confirmed real
               -- photo, 1 = UNKNOWN/unaudited platform (ops_photo_capture_trust.trusted = false -
               -- ranks strictly between confirmed-yes and confirmed-no so it is neither rewarded as
               -- "has a photo" nor punished as "confirmed no photo" - "UNKNOWN must remain UNKNOWN"),
               -- 2 = confirmed no real photo. NEVER filters - every row here already passed
               -- `matched`, so a no-photo (or unknown) listing is exactly as reachable/counted as
               -- before; this only nudges its position within its own div_rank tier. NULL (inactive)
               -- for the 6 objective sorts, same convention as div_rank, so price/area/beds/oldest
               -- keep their exact prior ordering.
               case when coalesce(p_sort_by,'') not in ('price_asc','price_desc','area_asc','area_desc','beds_desc','oldest')
                    then (case when m.has_photo is true then 0 when m.has_photo is null then 1 else 2 end)
               end as photo_rank,
               -- CONTROLLED ROTATION, tier 4 (owner PERMANENT rule 2026-08-29): deterministic hash
               -- of (source_table, listing_id, caller-supplied seed) - NEVER random()/gen_random_*.
               -- hashtext() is a pure, stable Postgres builtin: the SAME (row, seed) input always
               -- produces the SAME output, so one seed held constant across every page of one search
               -- (the client generates it once per search, not per page - see rotationSeed.ts)
               -- yields one stable total order for that whole browse/pagination walk, with zero
               -- duplicate/skip risk BY CONSTRUCTION (this key sits strictly before the unconditional
               -- (source_table, listing_id) tiebreaker below, which alone already guarantees a total
               -- order - see the standing pagination rule). NULL (inactive, falls through to the
               -- existing recency/id tiebreakers) whenever the caller passes no seed (default,
               -- 100% backward compatible with every existing caller) or under an objective sort.
               case when coalesce(p_sort_by,'') not in ('price_asc','price_desc','area_asc','area_desc','beds_desc','oldest')
                         and p_rotation_seed is not null
                    then hashtext(m.source_table || ':' || m.listing_id::text || ':' || p_rotation_seed)
               end as rot_key
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
        a.photo_rank asc nulls last,
        a.rot_key asc nulls last,
        a.recency_at desc nulls last, a.source_table, a.listing_id
      limit greatest(p_limit, 0) offset greatest(p_offset, 0)
    )
    union all
    (
      select t.source_table, t.listing_id, t.platform, t.last_updated, t.recency_at, t.region_ar, t.city_ar, t.district_ar,
             t.total_count, t.effective_price, t.area_m2, t.bedrooms,
             case when coalesce(p_sort_by,'') not in ('price_asc','price_desc','area_asc','area_desc','beds_desc','oldest') then t.rn end as div_rank,
             case when coalesce(p_sort_by,'') not in ('price_asc','price_desc','area_asc','area_desc','beds_desc','oldest')
                  then (case when t.has_photo is true then 0 when t.has_photo is null then 1 else 2 end)
             end as photo_rank,
             case when coalesce(p_sort_by,'') not in ('price_asc','price_desc','area_asc','area_desc','beds_desc','oldest')
                       and p_rotation_seed is not null
                  then hashtext(t.source_table || ':' || t.listing_id::text || ':' || p_rotation_seed)
             end as rot_key
      from (
        select m.source_table, m.listing_id, m.platform, m.last_updated, m.recency_at, m.region_ar, m.city_ar, m.district_ar,
               m.effective_price, m.area_m2, m.bedrooms, m.has_photo,
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
                   -- same photo-first-within-platform correction as branch `a` above, gated NULL
                   -- (inert) under every objective sort by construction (all 6 CASE arms above take
                   -- priority when active; this term only matters once none of them fired).
                   (case when coalesce(p_sort_by,'') not in ('price_asc','price_desc','area_asc','area_desc','beds_desc','oldest')
                         then (case when m.has_photo is true then 0 when m.has_photo is null then 1 else 2 end) end) asc nulls last,
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
    u.photo_rank asc nulls last,
    u.rot_key asc nulls last,
    u.recency_at desc nulls last, u.source_table, u.listing_id;
$function$
