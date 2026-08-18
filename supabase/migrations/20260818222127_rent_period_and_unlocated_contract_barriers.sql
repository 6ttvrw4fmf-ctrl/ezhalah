-- Permanent barriers for the two owner product decisions of 2026-08-18.
-- Nine requirements, split across two detectors so each failure names its own cause.

-- ═══ 1. THE RENT-PERIOD CLASSIFICATION CONTRACT ═══════════════════════════════════════════════
create or replace function public.mon_detect_rent_period_contract()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0; v jsonb := '{}'::jsonb; bad int; total int := 0;
  sync_src text; struct_bad jsonb := '[]'::jsonb;
begin
  -- (1) a SALE listing can never carry a rent period
  select count(*) into bad from public.search_listings_ar
   where deal_ar = 'بيع' and rent_period_ar is not null;
  total := total + bad; v := v || jsonb_build_object('sale_with_period', bad);

  -- (2) a RENT listing always carries one - the fallback, incl. every new listing
  select count(*) into bad from public.search_listings_ar
   where deal_ar = 'إيجار' and (rent_period_ar is null or rent_period_ar not in ('سنوي','شهري'));
  total := total + bad; v := v || jsonb_build_object('rent_without_period', bad);

  -- (3) explicit MONTHLY upstream stays شهري
  select count(*) into bad
    from public.listing_native_location_v2 lv
    join public.search_listings_ar s
      on s.source_table = lv.source_table and s.listing_id = lv.listing_id
   where lower(lv.transaction_type) = 'rent' and lv.rent_period = 'monthly'
     and s.rent_period_ar is distinct from 'شهري';
  total := total + bad; v := v || jsonb_build_object('explicit_monthly_lost', bad);

  -- (4) explicit ANNUAL upstream stays سنوي
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

  -- (6) eastabha is classified per LISTING, never by a platform-wide override
  select count(*) into bad
    from public.listing_native_location_v2 lv
    join public.search_listings_ar s
      on s.source_table = lv.source_table and s.listing_id = lv.listing_id
   where s.platform = 'eastabha' and lower(lv.transaction_type) = 'rent'
     and lv.rent_period in ('monthly','annual')
     and s.rent_period_ar is distinct from
         (case lv.rent_period when 'monthly' then 'شهري' else 'سنوي' end);
  total := total + bad; v := v || jsonb_build_object('eastabha_listing_evidence_overridden', bad);

  -- (7) STRUCTURAL: the fallback must still be in the only writer of the canonical field, and the
  -- sale guard must still wrap it. A rebuild of sync_search_listings_ar that drops either would
  -- otherwise be invisible until a user noticed.
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

  -- (9) every read surface must consume the CANONICAL field, never the raw scraper period
  select coalesce(jsonb_agg(pr.proname order by pr.proname), '[]'::jsonb) into v
    from pg_proc pr join pg_namespace nsp on nsp.oid = pr.pronamespace
   where nsp.nspname = 'public' and pr.prokind = 'f'
     and pr.proname in ('location_search_candidates_ar','af_eligibility_clause','af_eligible_count',
                        'af_in_certified_cohort','apartment_guided_counts_ar','district_options_ar',
                        'property_age_option_counts_ar')
     and pg_get_functiondef(pr.oid) !~* 'rent_period_ar';
  if jsonb_array_length(v) > 0 then
    struct_bad := struct_bad || v;
  end if;
  v := jsonb_build_object('surfaces_not_reading_rent_period_ar', v);

  -- rebuild the payload (the aggregate above clobbered it)
  v := jsonb_build_object(
    'sale_with_period', (select count(*) from public.search_listings_ar where deal_ar='بيع' and rent_period_ar is not null),
    'rent_without_period', (select count(*) from public.search_listings_ar where deal_ar='إيجار' and (rent_period_ar is null or rent_period_ar not in ('سنوي','شهري'))),
    'monthly_only_platform_not_monthly', (select count(*) from public.search_listings_ar where platform in ('gathern','aqarmonthly') and deal_ar='إيجار' and rent_period_ar is distinct from 'شهري'),
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

comment on function public.mon_detect_rent_period_contract() is
  'P1. Owner rent-period product decision (2026-08-18), 7 limbs: sale never carries a period; every '
  'rent listing carries one; explicit monthly/annual survive; gathern+aqarmonthly never fall back to '
  'annual; eastabha is classified per listing; the fallback and its rent-only guard are still in the '
  'sync; and every read surface consumes rent_period_ar rather than a raw scraper field.';

-- ═══ 2. THE UNKNOWN-LOCATION CONTRACT ═════════════════════════════════════════════════════════
create or replace function public.mon_detect_unlocated_search_contract()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0; leak int; fake int; ready int; rpc_src text; struct jsonb := '[]'::jsonb;
begin
  -- (a) an unlocated row must never carry city match ids - that is the branch that would let it
  --     into a city-filtered result set
  select count(*) into leak from public.search_listings_ar
   where city_id is null and match_city_ids is not null and cardinality(match_city_ids) > 0;

  -- (b) production_ready must keep meaning "has BOTH a city and a region", so every located
  --     surface excludes the unlocated by construction
  select count(*) into ready from public.search_listings_ar
   where production_ready and (city_id is null or region_id is null);

  -- (c) no unlocated row may have been handed a city_ar/district_ar without a real id - that is a
  --     fake location, which the owner forbade outright
  select count(*) into fake from public.search_listings_ar
   where city_id is null and (city_ar is not null or district_ar is not null)
     and exists (select 1 from public.loc_catalog_city c where c.city_norm = public.normalize_ar(search_listings_ar.city_ar));

  -- (d) STRUCTURAL: the RPC must still admit unlocated rows ONLY when no city, district or region
  --     filter is set. Losing any one guard turns "searchable without location" into contamination.
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

  if leak > 0 or ready > 0 or fake > 0 or jsonb_array_length(struct) > 0 then
    n := public.mon_raise('P1', 'unlocated_search_contract', 'all', 'unlocated_search_contract',
      jsonb_build_object(
        'unlocated_with_match_city_ids', leak,
        'production_ready_without_location', ready,
        'unlocated_with_resolvable_city_text', fake,
        'structural', struct,
        'contract', 'A listing whose source does not give enough to resolve a city/district stays '
                    'SEARCHABLE: it appears whenever no incompatible location constraint is selected, '
                    'matches its real deal/type/period/price, never appears under a city or district '
                    'we cannot prove, and is never assigned a fake location. UNKNOWN means unknown - '
                    'not excluded from Ezhalah.',
        'why', 'Owner location decision 2026-08-18. Verified live the same day: an unlocated Buy '
               'listing (wasalt 441665) was returned with no location filter and absent from city, '
               'city+district and region searches.',
        'do_not', 'Do NOT make this green by giving the listing a city. Never invent a location.'));
  else
    perform public.mon_resolve_key('unlocated_search_contract', 'unlocated_search_contract');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_unlocated_search_contract() is
  'P1. Owner location decision (2026-08-18): unknown location means UNKNOWN, not excluded. Guards '
  'both directions - unlocated rows must stay searchable with no location filter (the RPC fallback '
  'arm must survive) and must never reach a city/district/region-filtered result (no match_city_ids, '
  'never production_ready, never given a fake city).';

-- roster wiring, both, in this migration
do $do$
declare src text; before_n int; after_n int; anchor text := '''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  if src is null then raise exception 'roster not found'; end if;
  before_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');

  if position('mon_detect_rent_period_contract' in src) = 0 then
    src := replace(src, anchor, anchor || ', ''mon_detect_rent_period_contract''');
  end if;
  if position('mon_detect_unlocated_search_contract' in src) = 0 then
    src := replace(src, anchor, anchor || ', ''mon_detect_unlocated_search_contract''');
  end if;

  after_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  if after_n <> before_n + 2 then
    raise exception 'roster went from % to % entries, expected exactly +2', before_n, after_n;
  end if;
  if position('mon_detect_rent_period_contract' in src) = 0
     or position('mon_detect_unlocated_search_contract' in src) = 0
     or position('mon_detect_orphaned_detectors' in src) = 0
     or position('mon_detect_stalled_daily_detector' in src) = 0 then
    raise exception 'post-splice assertion failed';
  end if;
  execute src;
end
$do$;
