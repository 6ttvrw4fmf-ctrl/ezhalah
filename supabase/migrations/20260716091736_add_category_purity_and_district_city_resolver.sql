-- RECOVERED FROM PRODUCTION 2026-07-16: this migration was applied directly to prod (via
-- MCP/psql) without being committed — recovered verbatim from
-- supabase_migrations.schema_migrations so a clean clone reconstructs the real schema. Do not
-- edit. See the 2026-07-16 search outage (PGRST203 ambiguous overload) this drift caused.

-- Owner PERMANENT rule (2026-07-16): a broad Residential/Commercial search must never leak the
-- other macro-category's types, even when the raw row physically sits in the "wrong" table
-- (Commercial Land/Industrial Land/Hotel misfiled into residential tables, or a residential type
-- misfiled into a commercial table). This adds a new, backward-compatible p_category parameter
-- (DEFAULT NULL — existing callers unaffected) enforced against the canonical known_type_ar.macro
-- taxonomy mapping (the same single source of truth the deploy-time taxonomy gate already keeps
-- byte-synced with src/data/propertyTypes.ts) — RPC-level, so this can never be bypassed by a
-- frontend p_types mistake. macro='both' (currently only «عمارة», Building) passes either category,
-- since that ambiguity is correctly disambiguated by TABLE KIND (p_tables vs p_tables2) elsewhere,
-- not by type_ar alone — this filter is an ADDITIONAL, independent safety net on top, not a
-- replacement. A type_ar with no known_type_ar entry (verified: only 1 orphan row, 'Compound', out
-- of 185,427) is excluded when a category is requested — consistent with "never guess" (excluded
-- from a category filter, not left ambiguous), and unaffected when no category is requested at all.
CREATE OR REPLACE FUNCTION public.location_search_candidates_ar(
  p_deal text DEFAULT NULL,
  p_cities text[] DEFAULT NULL,
  p_districts text[] DEFAULT NULL,
  p_tables text[] DEFAULT NULL,
  p_platforms text[] DEFAULT NULL,
  p_per_platform integer DEFAULT NULL,
  p_limit integer DEFAULT 5000,
  p_region_ids integer[] DEFAULT NULL,
  p_types text[] DEFAULT NULL,
  p_price_min numeric DEFAULT NULL,
  p_price_max numeric DEFAULT NULL,
  p_rent_period text DEFAULT NULL,
  p_area_min integer DEFAULT NULL,
  p_area_max integer DEFAULT NULL,
  p_beds_exact integer[] DEFAULT NULL,
  p_beds_min integer DEFAULT NULL,
  p_bath_min integer DEFAULT NULL,
  p_furnished boolean DEFAULT NULL,
  p_age_max integer DEFAULT NULL,
  p_tenant text DEFAULT NULL,
  p_directions text[] DEFAULT NULL,
  p_has_license boolean DEFAULT NULL,
  p_amenities text[] DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_tables2 text[] DEFAULT NULL,
  p_types2 text[] DEFAULT NULL,
  p_age_min integer DEFAULT NULL,
  p_bath_exact integer[] DEFAULT NULL,
  p_street_width_min smallint DEFAULT NULL,
  p_street_width_max smallint DEFAULT NULL,
  p_floor_min integer DEFAULT NULL,
  p_floor_max integer DEFAULT NULL,
  p_is_new_construction boolean DEFAULT NULL,
  p_category text DEFAULT NULL
)
RETURNS TABLE(source_table text, listing_id bigint, platform text, last_updated timestamptz, region_ar text, city_ar text, district_ar text, total_count bigint)
LANGUAGE sql STABLE AS $$
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
  ) t
  where rn <= coalesce(p_per_platform, 2147483647)
  order by last_updated desc nulls first, source_table, listing_id
  limit p_limit offset greatest(p_offset, 0);
$$;

-- Owner PERMANENT rule (2026-07-16): a district-only location search (no city resolved) must NEVER
-- silently fan out across every city that happens to share that district name. This resolver lets the
-- frontend check, BEFORE querying, how many distinct real cities a district name actually belongs to
-- (grounded in the live listings themselves, not the noisy scraper-geocoding city_name_bridge table):
-- 0 → honest zero, 1 → safe to auto-scope, 2+ → genuinely ambiguous, must ask or refuse to guess.
CREATE OR REPLACE FUNCTION public.resolve_district_cities(p_districts text[])
RETURNS TABLE(city_ar text, match_count bigint)
LANGUAGE sql STABLE AS $$
  select s.city_ar, count(*) as match_count
  from public.search_listings_ar s
  where s.production_ready
    and s.city_ar is not null
    and norm_district_tok(s.district_ar) in (
      select norm_district_tok(d) from unnest(coalesce(p_districts, '{}')) d
    )
  group by s.city_ar
  order by match_count desc;
$$;
