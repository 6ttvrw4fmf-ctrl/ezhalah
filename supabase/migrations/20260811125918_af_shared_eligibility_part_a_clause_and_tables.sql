-- ONE DEFINITION OF ELIGIBILITY for every Advanced Filter surface — part A of three.
--
-- The ~90-line eligibility WHERE was copy-pasted into three functions
-- (location_search_candidates_ar, apartment_guided_counts_ar, property_age_option_counts_ar).
-- They agreed only because three texts had been edited in step — the same structural setup that
-- produced the PR#424 monthly/annual black hole. And the copies HAD drifted in three places:
--   1. results used the indexable `= any(array(select ...))` city/district form (PR#432); the two
--      counts functions still used the unindexable `in (select)`.
--   2. counts escaped the category-LIKE underscore, results did not (latent wrong-match).
--   3. results accepted p_bath_exact (OR-widening when both bath params set; empty array matched
--      NOTHING); counts knew only p_bath_min.
-- Worse: counts could not RECEIVE nine eligibility filters results applies (furnished, tenant,
-- directions, has_license, bath_exact, street width, floor), so chips overstated whenever the app
-- sent one; and cnt_unknown (age) was countable but never selectable.
--
-- This part stores THE clause (canonical semantics: bathrooms exact-wins/empty-array=absent,
-- p_age_unknown selectable, escaped LIKE, indexable location forms) plus the template/build-state
-- tables. Part B stores the four surface templates; part C is the builder + initial build.

create table if not exists public.af_rpc_templates (
  fn_name  text primary key,
  template text not null,
  check (position('__AF_ELIGIBILITY_WHERE__' in template) > 0)
);
create table if not exists public.af_rpc_build_state (
  fn_name  text primary key,
  def_md5  text not null,
  built_at timestamptz not null default now()
);

create or replace function public.af_eligibility_clause()
returns text language sql stable as $clause_fn$
select $af_clause$
    where (s.production_ready or ((p_cities is null or cardinality(p_cities) = 0) and (p_districts is null or cardinality(p_districts) = 0) and p_region_ids is null and not public.search_row_price_gated(s.deal_ar, s.price_total) and (s.region_id is null or s.city_id is null)))
      -- read-side defense-in-depth (2026-08): block only Ezhalah-side impossible/invalid states;
      -- never hides a source price (no magnitude check; 0 legal); production_ready must have a location.
      and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0
      and s.deal_ar is not null
      and (not s.production_ready or (s.city_id is not null and s.region_id is not null))
      and (p_deal       is null or s.deal_ar = p_deal)
      and (p_rent_period is null
           or s.deal_ar <> 'إيجار'
           or (p_rent_period = 'شهري' and s.payment_monthly = true)
           or (p_rent_period = 'سنوي' and (s.rent_period_ar = 'سنوي' or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false))))
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
      and (p_region_ids is null or s.region_id = any(p_region_ids))
      and (nullif(p_area_min,0) is null or (s.area_m2 is not null and s.area_m2 >= p_area_min))
      and (nullif(p_area_max,0) is null or (s.area_m2 is not null and s.area_m2 <= p_area_max))
      and ((coalesce(cardinality(p_bath_exact),0) = 0 and p_bath_min is null)
           or (coalesce(cardinality(p_bath_exact),0) > 0 and s.bathrooms = any(p_bath_exact))
           or (coalesce(cardinality(p_bath_exact),0) = 0 and p_bath_min is not null and s.bathrooms is not null and s.bathrooms >= p_bath_min))
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
$af_clause$::text;
$clause_fn$;
