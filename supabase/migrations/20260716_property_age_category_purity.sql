-- ─────────────────────────────────────────────────────────────────────────────────────────
-- عمر العقار (property age) option-counts RPC — add p_category (category-purity) parity with
-- PR#86's location_search_candidates_ar change. Applied LIVE to prod via Supabase MCP on
-- 2026-07-16; this file mirrors exactly what was applied (recoverability — MCP migrations are
-- otherwise live-only).
--
-- WHY: PR#86 (merged 2026-07-16, commit d6ed2e0) added an unconditional category-purity gate to
-- location_search_candidates_ar — a Residential search can never surface a Commercial-macro row
-- (Commercial Land/Industrial Land/Hotel/etc, ~14,301 such rows physically sit in residential
-- tables) and vice versa, checked against the canonical known_type_ar.macro taxonomy. Without this
-- same gate here, property_age_option_counts_ar's bucket counts would silently drift out of parity
-- with what Search actually returns for a scope where category purity matters — breaking this
-- feature's core guarantee that "the counts shown must exactly match what the user gets."
--
-- For شقة (Apartment) specifically this is a no-op in practice (Apartment is unambiguously
-- Residential-macro, never physically misfiled as Commercial) — live-verified: cnt_total for
-- Jeddah/Buy/Apartment is byte-identical (13,736) with and without p_category='Residential'. The
-- gate is still added for correctness/future-proofing (a later advanced-question field might not
-- be as clean), not because it changes today's apartment-scope numbers.
--
-- Same arity-changing-CREATE-OR-REPLACE lesson applied again (see 20260715 migration's own
-- history): DROP the old 16-arg overload immediately after, see bottom of this file.

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
  p_area_max integer default null,
  p_category text default null
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
      -- CATEGORY PURITY (mirrors location_search_candidates_ar verbatim, added 2026-07-16 alongside
      -- PR#86's RPC-layer purity gate) -- independent of whatever p_types/p_types2 was passed, so the
      -- age-bucket counts stay in exact parity with what Search actually returns for this scope.
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
  integer[], integer, numeric, numeric, integer, integer, text
) to anon, authenticated, service_role, postgres;

-- Remove the stale 16-arg overload CREATE OR REPLACE left behind (arity change ⇒ new overload, not
-- a replacement — same lesson as the 20260715 migration). Caught + fixed within the same session via
-- an immediate post-apply test call ("function ... is not unique").
drop function if exists public.property_age_option_counts_ar(
  p_deal text, p_rent_period text, p_cities text[], p_districts text[], p_tables text[],
  p_platforms text[], p_region_ids integer[], p_tables2 text[], p_types2 text[], p_types text[],
  p_beds_exact integer[], p_beds_min integer, p_price_min numeric, p_price_max numeric,
  p_area_min integer, p_area_max integer
);

notify pgrst, 'reload schema';
