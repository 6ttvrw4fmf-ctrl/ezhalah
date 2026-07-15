-- ─────────────────────────────────────────────────────────────────────────────────────────
-- عمر العقار (property age) advanced-filter backend — APPLIED LIVE to prod via Supabase MCP on
-- 2026-07-15; this file mirrors exactly what was applied (recoverability — MCP migrations are
-- otherwise live-only). Supports the «خلّنا نحدد الطلب أكثر» age-question card, Residential→Apartment
-- scope only (see isApartmentOnlyScope() in agent.tsx). Frontend: feat/age-filter-advanced-question-
-- 2026-07-12 branch, commits ad99a45, 7fde1c5, e088de1.
--
-- What this adds:
--   1) NEW function property_age_option_counts_ar — combined cross-platform counts for each عمر
--      العقار bucket (new/lt1/1_2/3_5/6_9/10p/unknown/total), computed within the caller's exact
--      current search scope (mirrors location_search_candidates_ar's predicate verbatim so a
--      bucket's count always matches what Search actually returns if picked). Granted EXECUTE to
--      anon/authenticated/service_role/postgres, matching the sibling function.
--   2) location_search_candidates_ar — appends ONE new trailing parameter, p_is_new_construction
--      boolean DEFAULT NULL, with every pre-existing parameter (name/type/order/default) and every
--      pre-existing WHERE-clause line left byte-for-byte unchanged (verified via live diff before
--      applying) — fully backward-compatible for any caller that omits it.
--
-- UNKNOWN-AGE HANDLING (data-semantics decision, 2026-07-15 review — see project memory
-- project_property-age-advanced-filter-2026-07-14.md for full reasoning):
--   - property_age = 0 is the ONLY available signal for "new construction" across all ~34 platform
--     tables (no separate raw column exists) — it's the ingestion-time sentinel when a scraper sees
--     a "جديد"/"New" label (46,159 of 187,004 rows in search_listings_ar carry it, overwhelmingly
--     from wasalt — see property_age="New" ingestion-loss fix, task history).
--   - "جديد" (p_is_new_construction=true / cnt_new) is STRICT: unknown-age listings do NOT match.
--     This is a deliberate exception to this codebase's usual OR-NULL-safe philosophy (used for
--     every other advanced predicate below) — "new construction" is a specific positive claim, not
--     a tolerant range, so zero age data must not silently count as "yes it's new".
--   - "أقل من سنة" (p_age_min=0,p_age_max=0 / cnt_lt1) and every other numeric age bucket KEEP the
--     existing, unchanged OR-NULL-safe behavior (unknown-age listings stay eligible) — this was
--     already deployed/working before this migration and is not touched here.
--   - Net effect: cnt_new ⊆ cnt_lt1 always. "جديد" and "أقل من سنة" now return genuinely different,
--     non-invented counts (a bug initially found in review: both were computed as identical
--     property_age=0-only predicates, which would have made the two buttons indistinguishable).
--
-- Also fixed same-day, live, DURING this deploy (see git log for full detail):
--   - CREATE OR REPLACE with a changed arity does NOT replace a Postgres function — it creates a
--     SECOND OVERLOAD alongside the original, causing "function is not unique" for every existing
--     caller. Caught within seconds via a direct post-apply test call; fixed by DROP FUNCTION on the
--     old 32-arg signature immediately after. See DROP statement at the bottom of this file.
--   - agent.tsx's isApartmentOnlyScope() compared against the Arabic label 'شقة', but
--     effectiveTypes() returns the canonical English key 'Apartment' — the age flow had never
--     actually fired for any real user. Fixed in commit e088de1 (frontend, not this file).

-- ============================================================================
-- 1) property_age_option_counts_ar (new function)
-- ============================================================================
create or replace function public.property_age_option_counts_ar(
  p_deal text default null,
  p_rent_period text default null,
  p_cities text[] default null,
  p_districts text[] default null,
  p_tables text[] default null,
  p_platforms text[] default null,
  p_region_ids integer[] default null,
  p_tables2 text[] default null,
  p_types2 text[] default null,
  p_types text[] default null,
  p_beds_exact integer[] default null,
  p_beds_min integer default null,
  p_price_min numeric default null,
  p_price_max numeric default null,
  p_area_min integer default null,
  p_area_max integer default null
)
returns table(
  cnt_new bigint,
  cnt_lt1 bigint,
  cnt_1_2 bigint,
  cnt_3_5 bigint,
  cnt_6_9 bigint,
  cnt_10p bigint,
  cnt_unknown bigint,
  cnt_total bigint,
  platform_breakdown jsonb
)
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
  ), scoped as (
    select s.platform, s.property_age
    from public.search_listings_ar s
    where (s.production_ready or (p_cities is null and p_districts is null and p_region_ids is null))
      and (p_deal        is null or s.deal_ar = p_deal)
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
      -- NOTE: no property_age predicate here — property_age is exactly the dimension being bucketed.
  )
  select
    -- STRICT: property_age=0 only, unknown excluded (matches p_is_new_construction below).
    count(*) filter (where property_age = 0)                                        as cnt_new,
    -- OR-NULL-safe: matches p_age_min=0,p_age_max=0's existing search-time behavior.
    count(*) filter (where property_age = 0 or property_age is null)                as cnt_lt1,
    count(*) filter (where (property_age between 1 and 2) or property_age is null)   as cnt_1_2,
    count(*) filter (where (property_age between 3 and 5) or property_age is null)   as cnt_3_5,
    count(*) filter (where (property_age between 6 and 9) or property_age is null)   as cnt_6_9,
    count(*) filter (where property_age >= 10 or property_age is null)              as cnt_10p,
    count(*) filter (where property_age is null)                                    as cnt_unknown,
    count(*)                                                                          as cnt_total,
    -- INTERNAL ONLY (monitoring/concentration checks) — client never renders this, see remote.ts.
    (select jsonb_object_agg(bucket, per_platform) from (
       select bucket, jsonb_object_agg(platform, cnt) as per_platform
       from (
         select
           case
             when property_age is null then 'unknown'
             when property_age = 0 then 'new_or_lt1'
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
  integer[], integer, numeric, numeric, integer, integer
) to anon, authenticated, service_role, postgres;

-- ============================================================================
-- 2) location_search_candidates_ar — append p_is_new_construction (trailing param)
-- ============================================================================
create or replace function public.location_search_candidates_ar(
  p_deal text default null::text,
  p_cities text[] default null::text[],
  p_districts text[] default null::text[],
  p_tables text[] default null::text[],
  p_platforms text[] default null::text[],
  p_per_platform integer default null::integer,
  p_limit integer default 5000,
  p_region_ids integer[] default null::integer[],
  p_types text[] default null::text[],
  p_price_min numeric default null::numeric,
  p_price_max numeric default null::numeric,
  p_rent_period text default null::text,
  p_area_min integer default null::integer,
  p_area_max integer default null::integer,
  p_beds_exact integer[] default null::integer[],
  p_beds_min integer default null::integer,
  p_bath_min integer default null::integer,
  p_furnished boolean default null::boolean,
  p_age_max integer default null::integer,
  p_tenant text default null::text,
  p_directions text[] default null::text[],
  p_has_license boolean default null::boolean,
  p_amenities text[] default null::text[],
  p_offset integer default 0,
  p_tables2 text[] default null::text[],
  p_types2 text[] default null::text[],
  p_age_min integer default null::integer,
  p_bath_exact integer[] default null::integer[],
  p_street_width_min smallint default null::smallint,
  p_street_width_max smallint default null::smallint,
  p_floor_min integer default null::integer,
  p_floor_max integer default null::integer,
  p_is_new_construction boolean default null::boolean
)
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
  )
  select source_table, listing_id, platform, last_updated, region_ar, city_ar, district_ar,
         count(*) over() as total_count
  from (
    select s.source_table, s.listing_id, s.platform, s.last_updated, s.region_ar, s.city_ar, s.district_ar,
           row_number() over (partition by s.platform order by s.last_updated desc nulls first, s.source_table, s.listing_id) as rn
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
  ) t
  where rn <= coalesce(p_per_platform, 2147483647)
  order by last_updated desc nulls first, source_table, listing_id
  limit p_limit offset greatest(p_offset, 0);
$function$;

-- ============================================================================
-- 3) Remove the stale 32-arg overload CREATE OR REPLACE left behind
-- ============================================================================
-- CREATE OR REPLACE with a different arity creates a NEW overload rather than replacing the
-- original — caught live within seconds via a direct post-apply test call that failed with
-- "function is not unique". This DROP is what makes the 33-arg version in step 2 the only one.
drop function if exists public.location_search_candidates_ar(
  p_deal text, p_cities text[], p_districts text[], p_tables text[], p_platforms text[],
  p_per_platform integer, p_limit integer, p_region_ids integer[], p_types text[],
  p_price_min numeric, p_price_max numeric, p_rent_period text, p_area_min integer, p_area_max integer,
  p_beds_exact integer[], p_beds_min integer, p_bath_min integer, p_furnished boolean, p_age_max integer,
  p_tenant text, p_directions text[], p_has_license boolean, p_amenities text[], p_offset integer,
  p_tables2 text[], p_types2 text[], p_age_min integer, p_bath_exact integer[],
  p_street_width_min smallint, p_street_width_max smallint, p_floor_min integer, p_floor_max integer
);

notify pgrst, 'reload schema';
