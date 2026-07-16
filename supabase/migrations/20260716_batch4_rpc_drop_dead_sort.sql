-- ============================================================================
-- Batch 4 (search & location) — drop the always-paid, always-discarded window
-- sort from the hot-path search RPC. (2026-07-16)
--
-- PROBLEM (measured on prod aannarbkwcymrotzwdbo, 2026-07-16):
--   location_search_candidates_ar computed
--     row_number() over (partition by platform order by last_updated desc ...)
--   over the ENTIRE filtered candidate set on EVERY call, then filtered
--   rn <= coalesce(p_per_platform, 2147483647). The app's MAIN call
--   (src/data/remote.ts, every search request + every Load-More page) always
--   passes p_per_platform = null, so the window was a permanent no-op whose
--   cost — a full (platform, recency) sort of all candidates + WindowAgg +
--   Subquery Scan — was paid on every single search. p_per_platform is only
--   non-null on the page-0 platform-diversity seed call (20 / limit 2000).
--
-- FIX:
--   One shared, NOT MATERIALIZED `matched` CTE holds the (unchanged, verbatim)
--   filter set, and two parameter-gated UNION ALL branches consume it:
--     * fast path  (p_per_platform IS NULL)     — straight recency sort + LIMIT/OFFSET;
--     * diversity  (p_per_platform IS NOT NULL) — the same per-platform
--       row_number() window as before, unchanged.
--   The branch gates reference only p_per_platform, so the planner deletes the
--   dead branch outright when the argument is a literal (function is inlined),
--   and skips it via a never-executed one-time filter under prepared/generic
--   plans (PostgREST). Signature (34 args + defaults), column list, row order
--   (total order: last_updated desc nulls first, source_table, listing_id) and
--   total_count semantics are IDENTICAL for both call shapes — CREATE OR
--   REPLACE on the exact existing signature, no new overload (the ambiguous-
--   overload class of failure caused the 2026-07-16 16-minute outage).
--
-- MEASURED (warm cache, EXPLAIN (ANALYZE, BUFFERS), prod, 2026-07-16, new body
-- exercised as an identical pg_temp copy against the live table):
--   (a) broad Riyadh Rent, MAIN shape (p_per_platform=null, limit 1500):
--       before 384.0 ms -> after 283.9 ms (-26%). The platform-partition
--       row_number() WindowAgg + its full (platform, recency) Sort
--       (quicksort 4,408 kB) + Subquery Scan are GONE from the plan, and the
--       sort's temp spill (temp read=455 written=423) disappeared with them.
--       The only WindowAgg left in the live branch is count(*) over(), which
--       the total_count contract requires. Under a FORCED GENERIC PLAN
--       (prepared statement, p_per_platform bound as a parameter — the
--       PostgREST call shape): 280.0 ms, dead branch = One-Time Filter:
--       ($1 IS NOT NULL) with its Index Scan "(never executed)".
--   (b) diversity-seed shape (p_per_platform=20, limit 2000):
--       before 337.8 ms -> after 347.7 ms (unchanged within run noise; same
--       scan + platform sort + window, Run Condition rn <= 20 intact).
--   (c) narrow filtered (Riyadh + شقة + سنوي + price 20k-80k + 3BR, main
--       shape): before 110.5 ms -> after 103.5 ms (scan-dominated).
--
-- PARITY (one prod snapshot — a single statement calling old public fn and new
-- pg_temp copy, WITH ORDINALITY so set AND order are compared, total_count in
-- every compared row): 5 shapes x 0 differing rows —
--   A main broad Riyadh Rent (null,1500,0):     1500 rows, total_count 28751
--   B diversity seed (20,2000,0):                222 rows, total_count 222
--   C narrow (types/rent_period/price/beds):    1500 rows, total_count 2431
--   D Load-More page (null,1500,offset 1500):   1500 rows, total_count 28751
--   E nationwide broad Buy (null,1500,0):       1500 rows, total_count 115671
--
-- REHEARSED: this exact statement was applied inside BEGIN/ROLLBACK on prod;
-- in-txn checks confirmed exactly ONE pg_proc overload (no ambiguous-overload
-- regression), unchanged identity arguments, new body active, both call shapes
-- returning rows; rolled back clean (old body verified back in place).
-- ============================================================================

create or replace function public.location_search_candidates_ar(p_deal text DEFAULT NULL::text, p_cities text[] DEFAULT NULL::text[], p_districts text[] DEFAULT NULL::text[], p_tables text[] DEFAULT NULL::text[], p_platforms text[] DEFAULT NULL::text[], p_per_platform integer DEFAULT NULL::integer, p_limit integer DEFAULT 5000, p_region_ids integer[] DEFAULT NULL::integer[], p_types text[] DEFAULT NULL::text[], p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_rent_period text DEFAULT NULL::text, p_area_min integer DEFAULT NULL::integer, p_area_max integer DEFAULT NULL::integer, p_beds_exact integer[] DEFAULT NULL::integer[], p_beds_min integer DEFAULT NULL::integer, p_bath_min integer DEFAULT NULL::integer, p_furnished boolean DEFAULT NULL::boolean, p_age_max integer DEFAULT NULL::integer, p_tenant text DEFAULT NULL::text, p_directions text[] DEFAULT NULL::text[], p_has_license boolean DEFAULT NULL::boolean, p_amenities text[] DEFAULT NULL::text[], p_offset integer DEFAULT 0, p_tables2 text[] DEFAULT NULL::text[], p_types2 text[] DEFAULT NULL::text[], p_age_min integer DEFAULT NULL::integer, p_bath_exact integer[] DEFAULT NULL::integer[], p_street_width_min smallint DEFAULT NULL::smallint, p_street_width_max smallint DEFAULT NULL::smallint, p_floor_min integer DEFAULT NULL::integer, p_floor_max integer DEFAULT NULL::integer, p_is_new_construction boolean DEFAULT NULL::boolean, p_category text DEFAULT NULL::text)
 returns table(source_table text, listing_id bigint, platform text, last_updated timestamp with time zone, region_ar text, city_ar text, district_ar text, total_count bigint)
 language sql
 stable
as $function$
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
  -- BATCH 4 (2026-07-16): the filter set is defined ONCE, shared by both branches below, so the two
  -- can never drift apart (drift here = a diversity-seed row that fails the main pool's WHERE, or vice
  -- versa). NOT MATERIALIZED so the planner inlines a copy into each branch instead of computing the
  -- whole candidate set up front for a branch that never runs.
  matched as not materialized (
    select s.source_table, s.listing_id, s.platform, s.last_updated, s.region_ar, s.city_ar, s.district_ar
    from public.search_listings_ar s
    where (s.production_ready or (p_cities is null and p_districts is null and p_region_ids is null))
      and (p_deal       is null or s.deal_ar = p_deal)
      and (p_rent_period is null
           or (p_rent_period = 'شهري'
               and (s.rent_period_ar = 'شهري' or s.platform in ('gathern','aqarmonthly')))
           or (p_rent_period = 'سنوي'
               and s.rent_period_ar = 'سنوي'
               and (s.platform is null or s.platform not in ('gathern','aqarmonthly')))
           or (p_rent_period not in ('شهري','سنوي') and s.rent_period_ar = p_rent_period))
      and (
            ((p_tables is null or s.source_table = any(p_tables))
             and (p_types is null or s.type_ar = any(p_types)))
         or (p_tables2 is not null and s.source_table = any(p_tables2)
             and (p_types2 is null or s.type_ar = any(p_types2)))
      )
      -- NEW: category-purity gate (owner 2026-07-16). Independent of, and in addition to, whatever
      -- p_types/p_types2 the caller passed — closes the class of bug where a broad (no-type) category
      -- search forgot to constrain type_ar, by checking the canonical macro taxonomy directly.
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
           or s.bathrooms is null
           or (p_bath_exact is not null and s.bathrooms = any(p_bath_exact))
           or (p_bath_min   is not null and s.bathrooms >= p_bath_min))
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
           or s.property_age is null
           or (s.property_age >= coalesce(p_age_min, 0) and s.property_age <= coalesce(p_age_max, 32767)))
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
           and (not ('private_entrance' = any(p_amenities)) or s.private_entrance)))
      and ((p_street_width_min is null and p_street_width_max is null)
           or s.street_width_m is null
           or (s.street_width_m >= coalesce(p_street_width_min, 0) and s.street_width_m <= coalesce(p_street_width_max, 32767)))
      and ((p_floor_min is null and p_floor_max is null)
           or s.floor_number is null
           or (s.floor_number >= coalesce(p_floor_min, 0) and s.floor_number <= coalesce(p_floor_max, 2147483647)))
  )
  -- FAST PATH — p_per_platform IS NULL: the app's MAIN call (every search request and every Load-More
  -- page; src/data/remote.ts always sends p_per_platform: null here). Straight recency sort +
  -- LIMIT/OFFSET. Before Batch 4 this shape still paid the per-platform row_number() window below — a
  -- full (platform, recency) sort of the ENTIRE candidate set — only to keep every row via
  -- rn <= 2147483647. The branch gate references only p_per_platform, so the dead branch is deleted at
  -- plan time for literal calls (this function inlines) and skipped as a never-executed one-time filter
  -- under prepared/generic plans (PostgREST). count(*) over() still means the FULL matching count on
  -- every returned row: window aggregates are computed before ORDER BY/LIMIT, exactly as before.
  (
    select m.source_table, m.listing_id, m.platform, m.last_updated, m.region_ar, m.city_ar, m.district_ar,
           count(*) over() as total_count
    from matched m
    where p_per_platform is null
    order by m.last_updated desc nulls first, m.source_table, m.listing_id
    limit p_limit offset greatest(p_offset, 0)
  )
  union all
  -- DIVERSITY PATH — p_per_platform IS NOT NULL: only the page-0 platform-diversity seed call
  -- (p_per_platform=20, p_limit=2000 in src/data/remote.ts). Semantics unchanged from the pre-Batch-4
  -- version: the per-platform row_number() window keeps each platform's freshest p_per_platform rows
  -- regardless of global recency rank, and total_count counts the CAPPED (post-window) set, as it
  -- always has for this shape.
  (
    select t.source_table, t.listing_id, t.platform, t.last_updated, t.region_ar, t.city_ar, t.district_ar,
           count(*) over() as total_count
    from (
      select m.source_table, m.listing_id, m.platform, m.last_updated, m.region_ar, m.city_ar, m.district_ar,
             row_number() over (partition by m.platform order by m.last_updated desc nulls first, m.source_table, m.listing_id) as rn
      from matched m
      where p_per_platform is not null
    ) t
    where t.rn <= p_per_platform
    order by t.last_updated desc nulls first, t.source_table, t.listing_id
    limit p_limit offset greatest(p_offset, 0)
  )
  -- Exactly one branch produces rows. This final sort re-asserts the contractual total order over the
  -- returned page only (<= p_limit rows — negligible) so row order never depends on Append mechanics.
  order by last_updated desc nulls first, source_table, listing_id;
$function$;
