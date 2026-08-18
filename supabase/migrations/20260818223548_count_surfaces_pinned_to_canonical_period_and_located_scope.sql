-- Data Integrity run #29, owner product decisions 2026-08-18. Two gaps found while verifying the
-- count surfaces the owner named explicitly ("city counts, district counts, Trending counts").
--
-- GAP 1 - barrier 9 did not cover top_cities_by_deal_ar. That RPC is what src/data/locations.ts
-- calls for BOTH the city dropdown counts and the Trending Top-6 pool (keyed by period 'm'/'a'), so
-- it is precisely a surface that must consume the canonical classification. It does today; nothing
-- was watching that it keeps doing so.
--
-- GAP 2 - nothing pinned WHY unlocated listings cannot pollute a city or district count. The
-- mechanism is that every count surface is scoped to production_ready, and production_ready means
-- "has BOTH a city and a region" (limb b). Those two facts together make contamination structurally
-- impossible rather than merely absent - but only the second was guarded. Drop the production_ready
-- scope from district_options_ar and unlocated rows start appearing in district counts while every
-- other limb of this barrier stays green.
--
-- Verified before adding (all nine surfaces): af_eligibility_clause, af_eligible_count,
-- af_in_certified_cohort, apartment_guided_counts_ar, district_options_ar,
-- location_search_candidates_ar, property_age_option_counts_ar and top_cities_by_deal_ar all read
-- rent_period_ar; all except af_in_certified_cohort (a pure cohort predicate with no location scope)
-- are production_ready-scoped. resolve_district_cities is deliberately excluded from the period
-- check - it resolves a district name to candidate cities and has no period semantics.

create or replace function public.mon_detect_rent_period_contract()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0; v jsonb := '{}'::jsonb; bad int; total int := 0;
  sync_src text; struct_bad jsonb := '[]'::jsonb; surfaces jsonb := '[]'::jsonb;
begin
  -- (1) owner barrier 1: a SALE listing can never carry a rent period
  select count(*) into bad from public.search_listings_ar
   where deal_ar = 'بيع' and rent_period_ar is not null;
  total := total + bad; v := v || jsonb_build_object('sale_with_period', bad);

  -- (2) owner barriers 4/5/8: a RENT listing always carries one - the fallback covers price 0,
  --     missing price and السعر عند الطلب, and every listing that arrives later
  select count(*) into bad from public.search_listings_ar
   where deal_ar = 'إيجار' and (rent_period_ar is null or rent_period_ar not in ('سنوي','شهري'));
  total := total + bad; v := v || jsonb_build_object('rent_without_period', bad);

  -- (3) owner barrier 2: explicit MONTHLY upstream stays شهري - the fallback never overwrites evidence
  select count(*) into bad
    from public.listing_native_location_v2 lv
    join public.search_listings_ar s
      on s.source_table = lv.source_table and s.listing_id = lv.listing_id
   where lower(lv.transaction_type) = 'rent' and lv.rent_period = 'monthly'
     and s.rent_period_ar is distinct from 'شهري';
  total := total + bad; v := v || jsonb_build_object('explicit_monthly_lost', bad);

  -- (4) owner barrier 3: explicit ANNUAL upstream stays سنوي
  select count(*) into bad
    from public.listing_native_location_v2 lv
    join public.search_listings_ar s
      on s.source_table = lv.source_table and s.listing_id = lv.listing_id
   where lower(lv.transaction_type) = 'rent' and lv.rent_period = 'annual'
     and s.rent_period_ar is distinct from 'سنوي';
  total := total + bad; v := v || jsonb_build_object('explicit_annual_lost', bad);

  -- (5) the MONTHLY-ONLY platforms never fall back to annual (owner rule 2026-07-06)
  select count(*) into bad from public.search_listings_ar
   where platform in ('gathern','aqarmonthly') and deal_ar = 'إيجار'
     and rent_period_ar is distinct from 'شهري';
  total := total + bad; v := v || jsonb_build_object('monthly_only_platform_not_monthly', bad);

  -- (6) owner barrier 6: eastabha is classified per LISTING, never by a platform-wide override
  select count(*) into bad
    from public.listing_native_location_v2 lv
    join public.search_listings_ar s
      on s.source_table = lv.source_table and s.listing_id = lv.listing_id
   where s.platform = 'eastabha' and lower(lv.transaction_type) = 'rent'
     and lv.rent_period in ('monthly','annual')
     and s.rent_period_ar is distinct from
         (case lv.rent_period when 'monthly' then 'شهري' else 'سنوي' end);
  total := total + bad; v := v || jsonb_build_object('eastabha_listing_evidence_overridden', bad);

  -- (6b) owner barrier 6, second half: no platform-wide waiver may re-appear for eastabha. The
  --      whole ops_rent_period_sourceless table was emptied once the fallback made every rent
  --      listing reachable; a new row for this platform would be exactly the override the owner
  --      ruled out.
  select count(*) into bad from public.ops_rent_period_sourceless where platform = 'eastabha';
  total := total + bad; v := v || jsonb_build_object('eastabha_platform_wide_waiver_returned', bad);

  -- (7) STRUCTURAL: the fallback must still be in the only writer of the canonical field, and the
  -- sale guard must still wrap it.
  select pg_get_functiondef(p.oid) into sync_src
    from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
   where nsp.nspname = 'public' and p.proname = 'sync_search_listings_ar';
  if sync_src is null then
    struct_bad := struct_bad || to_jsonb('sync_search_listings_ar missing'::text);
  else
    if position('gathern'',''aqarmonthly' in sync_src) = 0 then
      struct_bad := struct_bad || to_jsonb('period fallback expression is gone from the sync'::text);
    end if;
    if position('lower(v.transaction_type) = ''rent''' in sync_src) = 0
       and position('lower(v.transaction_type)=''rent''' in sync_src) = 0 then
      struct_bad := struct_bad || to_jsonb('the rent-only guard around the period case is gone'::text);
    end if;
  end if;

  -- (9) owner barrier 9: every read surface must consume the CANONICAL field. top_cities_by_deal_ar
  --     drives the city dropdown counts AND the Trending Top-6 pool, both of which the owner named.
  select coalesce(jsonb_agg(pr.proname order by pr.proname), '[]'::jsonb) into surfaces
    from pg_proc pr join pg_namespace nsp on nsp.oid = pr.pronamespace
   where nsp.nspname = 'public' and pr.prokind = 'f'
     and pr.proname in ('location_search_candidates_ar','af_eligibility_clause','af_eligible_count',
                        'af_in_certified_cohort','apartment_guided_counts_ar','district_options_ar',
                        'property_age_option_counts_ar','top_cities_by_deal_ar')
     and pg_get_functiondef(pr.oid) !~* 'rent_period_ar';
  if jsonb_array_length(surfaces) > 0 then
    struct_bad := struct_bad || surfaces;
  end if;
  v := v || jsonb_build_object('surfaces_not_reading_rent_period_ar', surfaces,
                               'structural', struct_bad);

  if total > 0 or jsonb_array_length(struct_bad) > 0 then
    n := public.mon_raise('P1', 'rent_period_contract', 'all', 'rent_period_contract',
      v || jsonb_build_object(
        'contract', 'Confirmed rent + monthly evidence -> شهري. Confirmed rent + no monthly evidence '
                    '-> سنوي (including price 0 / missing / السعر عند الطلب). An explicit source '
                    'period always beats the fallback. NEVER applied to a sale listing. Never infer '
                    'monthly from a small-looking number.',
        'why', 'Owner product decision 2026-08-18, applied in sync_search_listings_ar - the only '
               'writer of search_listings_ar.rent_period_ar, which Normal Filter, Advanced Filter, '
               'the AI/backend search, city/district/Trending counts, totals and pagination all read. '
               'One classification, no special-case search behaviour.',
        'do_not', 'Do NOT fix a breach by writing a period into the scraper tables - that fabricates '
                  'a source value and destroys the honest NULL the run #29 live probes proved correct. '
                  'The fallback is a CLASSIFICATION and belongs in the sync.'));
  else
    perform public.mon_resolve_key('rent_period_contract', 'rent_period_contract');
  end if;

  return n;
end
$function$;

create or replace function public.mon_detect_unlocated_search_contract()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0; leak int; recoverable int; ready int; rpc_src text;
  struct jsonb := '[]'::jsonb; sample jsonb; trg_ok boolean; unscoped jsonb := '[]'::jsonb;
begin
  -- (a) an unlocated row must never carry city match ids - the branch that would let it into a
  --     city-filtered result set, i.e. contaminate a city/district count
  select count(*) into leak from public.search_listings_ar
   where city_id is null and match_city_ids is not null and cardinality(match_city_ids) > 0;

  -- (b) production_ready must keep meaning "has BOTH a city and a region". Together with limb (f)
  --     this is what makes an unlocated listing structurally unable to reach a count.
  select count(*) into ready from public.search_listings_ar
   where production_ready and (city_id is null or region_id is null);

  -- (c) an unlocated row whose city text resolves to EXACTLY ONE catalog city is a resolver
  --     failure, not an honest unknown. AMBIGUOUS names (>1 candidate) are deliberately NOT
  --     counted - with no region published, picking one would be the duplicate-place-name bug this
  --     run fixed («البريكه» is 3 cities in 2 regions, «العقيق» 4 in 3, «المجمعة» 4 in 3).
  select count(*) into recoverable from public.search_listings_ar s
   where s.city_id is null and s.city_ar is not null
     and (select count(distinct c.city_id) from public.loc_catalog_city c
           where c.city_norm = public.normalize_ar(s.city_ar)) = 1;

  -- (d) STRUCTURAL: the RPC must still admit unlocated rows ONLY when no city, district or region
  --     filter is set. Losing the arm excludes them from Ezhalah; losing a guard contaminates.
  select pg_get_functiondef(p.oid) into rpc_src
    from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
   where nsp.nspname = 'public' and p.proname = 'location_search_candidates_ar';
  if rpc_src is null then
    struct := struct || to_jsonb('location_search_candidates_ar missing'::text);
  else
    if position('s.region_id is null or s.city_id is null' in rpc_src) = 0 then
      struct := struct || to_jsonb('the unlocated-fallback arm is gone - unlocated listings are now excluded from Ezhalah entirely'::text);
    end if;
    if position('p_cities is null or cardinality(p_cities) = 0' in rpc_src) = 0
       or position('p_districts is null or cardinality(p_districts) = 0' in rpc_src) = 0
       or position('p_region_ids is null' in rpc_src) = 0 then
      struct := struct || to_jsonb('a location guard on the unlocated arm is gone - unlocated rows can now pollute a city/district/region result'::text);
    end if;
  end if;

  -- (e) STRUCTURAL: the trigger that DERIVES match_city_ids must still be attached and enabled.
  --     It, not limb (a), is what makes contamination unreachable - limb (a) can only report the
  --     damage after a write has already landed.
  select exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.search_listings_ar'::regclass
       and t.tgname = 'set_match_city_ids' and not t.tgisinternal and t.tgenabled <> 'D'
  ) into trg_ok;
  if not trg_ok then
    struct := struct || to_jsonb('the set_match_city_ids trigger is missing or disabled - match_city_ids is no longer derived, so an unlocated row can now be handed city ids by any write'::text);
  end if;

  -- (f) STRUCTURAL: every COUNT surface must stay scoped to production_ready. This is the actual
  --     mechanism that keeps unlocated listings out of city, district and Trending counts - the
  --     owner's explicit worry. Drop the scope from any one of these and unlocated rows start
  --     being counted under places we cannot prove, with every other limb still green.
  select coalesce(jsonb_agg('count surface no longer scoped to production_ready: ' || pr.proname
                            order by pr.proname), '[]'::jsonb) into unscoped
    from pg_proc pr join pg_namespace nsp on nsp.oid = pr.pronamespace
   where nsp.nspname = 'public' and pr.prokind = 'f'
     and pr.proname in ('top_cities_by_deal_ar','district_options_ar','apartment_guided_counts_ar',
                        'property_age_option_counts_ar','af_eligible_count','af_eligibility_clause')
     and pg_get_functiondef(pr.oid) !~* 'production_ready';
  if jsonb_array_length(unscoped) > 0 then
    struct := struct || unscoped;
  end if;

  if leak > 0 or ready > 0 or recoverable > 0 or jsonb_array_length(struct) > 0 then
    if recoverable > 0 then
      select jsonb_agg(x) into sample from (
        select s.source_table, s.listing_id, s.platform, s.city_ar
          from public.search_listings_ar s
         where s.city_id is null and s.city_ar is not null
           and (select count(distinct c.city_id) from public.loc_catalog_city c
                 where c.city_norm = public.normalize_ar(s.city_ar)) = 1
         limit 20) x;
    end if;

    n := public.mon_raise('P1', 'unlocated_search_contract', 'all', 'unlocated_search_contract',
      jsonb_build_object(
        'unlocated_with_match_city_ids', leak,
        'production_ready_without_location', ready,
        'unlocated_but_city_resolves_unambiguously', recoverable,
        'recoverable_sample', sample,
        'structural', struct,
        'contract', 'A listing whose source does not give enough to resolve a city/district stays '
                    'SEARCHABLE: it appears whenever no incompatible location constraint is selected, '
                    'matches its real deal/type/period/price, never appears under a city or district '
                    'we cannot prove, and is never assigned a fake location. UNKNOWN means unknown - '
                    'not excluded from Ezhalah.',
        'why', 'Owner location decision 2026-08-18. Verified live the same day: unlocated listings '
               'were returned with no location filter (wasalt 441665 Buy; ramzalqasim 615836 Rent) '
               'and absent from city, city+district and region searches.',
        'do_not', 'Do NOT make this green by giving a listing a city. Never invent a location. In '
                  'particular do NOT resolve an AMBIGUOUS city name by picking a candidate - limb (c) '
                  'deliberately ignores those, because 5 unlocated rows today carry names that match '
                  '3-4 real Saudi cities each with no source region to choose between them.'));
  else
    perform public.mon_resolve_key('unlocated_search_contract', 'unlocated_search_contract');
  end if;

  return n;
end
$function$;;
