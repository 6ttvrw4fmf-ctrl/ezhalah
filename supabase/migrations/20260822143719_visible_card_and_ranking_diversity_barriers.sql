-- Owner permanent rule (2026-08-22): what the user SEES must match the actual listing/search
-- truth exactly, in clean Arabic — no English leaks, no admin-region junk, no stale labels, no
-- mismatched city/district text. And: match first, THEN diversify — ranking/diversity may only
-- reorder inside the eligible set, never introduce a row or change a count.
--
-- Two barriers, because the two contracts fail in different ways and are checked differently:
--   A. mon_detect_card_label_contract()      — cheap, index-state, runs on every sweep.
--   B. mon_detect_ranking_diversity_contract() — drives the REAL RPC, so it is daily-gated.

-- =============================================================================================
-- A. The visible-label contract on the search index.
-- =============================================================================================
create or replace function public.mon_detect_card_label_contract()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  n int := 0;
  v_latin bigint; v_city_ne_id bigint; v_admin bigint; v_guessed bigint;
  v_district_ne_canon bigint; v_district_split bigint; v_sample jsonb;
begin
  -- 1. English leaking into an Arabic card field the user reads.
  select count(*) into v_latin from public.search_listings_ar s
   where s.production_ready and (
         s.city_ar ~ '[A-Za-z]' or s.district_ar ~ '[A-Za-z]' or s.region_ar ~ '[A-Za-z]'
      or s.type_ar ~ '[A-Za-z]' or s.deal_ar ~ '[A-Za-z]' or s.rent_period_ar ~ '[A-Za-z]'
      or s.direction_ar ~ '[A-Za-z]' or s.tenant_ar ~ '[A-Za-z]' or s.unit_subtype_ar ~ '[A-Za-z]');

  -- 2. The visible city text must be the city its own city_id names.
  select count(*) into v_city_ne_id
    from public.search_listings_ar s join public.loc_catalog_city c on c.city_id = s.city_id
   where s.production_ready and s.city_ar is distinct from c.city_ar;

  -- 3. An administrative/emirate label must never stand where a city name belongs.
  --    (city_ar only: «منطقة صناعية» / «منطقة الاستراحات» are REAL district names — §36, source truth.)
  select count(*) into v_admin from public.search_listings_ar s
   where s.production_ready and (s.city_ar like 'امارة%' or s.city_ar like 'إمارة%'
                                 or s.city_ar like 'منطقة %');

  -- 4. An unknown location must stay unknown — never guessed, never back-filled with a label.
  select count(*) into v_guessed from public.search_listings_ar s
   where s.production_ready and s.city_id is null and s.city_ar is not null;

  -- 5. The visible district must be the one canonical rendering for its (city, district).
  select count(*) into v_district_ne_canon
    from public.search_listings_ar s
   where s.production_ready and s.district_ar is not null
     and s.district_ar is distinct from public.loc_display_district_ar(s.city_id, s.district_ar);

  -- 6. One district must never render two ways — a single result list showing «حي النرجس» and
  --    «النرجس» reads as two different places.
  select count(*) into v_district_split from (
    select 1 from public.search_listings_ar
     where production_ready and district_ar is not null
     group by city_id, norm_district_tok(district_ar)
    having count(distinct district_ar) > 1) z;

  if v_latin = 0 and v_city_ne_id = 0 and v_admin = 0 and v_guessed = 0
     and v_district_ne_canon = 0 and v_district_split = 0 then
    perform public.mon_resolve_key('card_label_contract','card_label_contract');
    return 0;
  end if;

  select jsonb_agg(t) into v_sample from (
    select s.source_table, s.listing_id, s.platform, s.city_id, s.city_ar, s.district_ar, s.region_ar
      from public.search_listings_ar s
      left join public.loc_catalog_city c on c.city_id = s.city_id
     where s.production_ready and (
           s.city_ar ~ '[A-Za-z]' or s.district_ar ~ '[A-Za-z]' or s.type_ar ~ '[A-Za-z]'
        or (c.city_id is not null and s.city_ar is distinct from c.city_ar)
        or s.city_ar like 'امارة%' or s.city_ar like 'إمارة%' or s.city_ar like 'منطقة %'
        or (s.city_id is null and s.city_ar is not null)
        or (s.district_ar is not null
            and s.district_ar is distinct from public.loc_display_district_ar(s.city_id, s.district_ar)))
     limit 8) t;

  n := public.mon_raise('P2','card_label_contract','all','card_label_contract',
    jsonb_build_object(
      'why','What the user SEES on a result card no longer matches the listing/search truth in clean '
         || 'canonical Arabic. Each count below is a distinct breach of the owner rule (2026-08-22).',
      'english_leak_in_arabic_field', v_latin,
      'city_text_ne_city_id',        v_city_ne_id,
      'admin_region_label_as_city',  v_admin,
      'unknown_location_guessed',    v_guessed,
      'district_ne_canonical',       v_district_ne_canon,
      'district_rendered_two_ways',  v_district_split,
      'fix','Labels are written by loc_display_city_ar()/loc_display_district_ar() in '
         || 'sync_search_listings_ar(); backfill_location_display_labels() repairs stored rows.',
      'sample', v_sample));
  return n;
end $function$;

comment on function public.mon_detect_card_label_contract() is
  'Owner rule 2026-08-22: the visible card label must equal the listing/search truth in clean '
  'canonical Arabic. Covers English leakage, city text vs city_id, admin-region labels as city, '
  'guessed unknown locations, and district canonicality/consistency.';

-- =============================================================================================
-- B. Match first, THEN diversify. Drives the REAL RPC and compares it to the independent oracle.
--    Proves, on live production data: (1) eligibility is exact, (2) ranking/diversity runs AFTER
--    eligibility, (3) no row outside the requested filters appears, (4) diversity does not distort
--    the count. Expensive (real RPC calls) -> daily-gated like the other behavioural detectors.
-- =============================================================================================
create or replace function public.mon_detect_ranking_diversity_contract()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  n int := 0; v_probe record; v_bad jsonb := '[]'::jsonb;
  v_ineligible bigint; v_count_delta bigint; v_dupes bigint;
  v_checked int := 0;
begin
  if not public.mon_claim_daily_slot('mon_detect_ranking_diversity_contract') then
    return 0;
  end if;

  -- Probes are chosen to sit well under the 1,500-row page so the FULL result set is comparable:
  -- an identical key-set md5 proves in one shot that ranking/diversity introduced no ineligible
  -- row, duplicated nothing, and lost nothing. The oracle is reused rather than re-implemented —
  -- a second copy of the matching predicate is exactly the drift this barrier exists to catch.
  for v_probe in
    select * from (values
      ('شقة',    'إيجار', 'سنوي', array['الرياض'], array['حي النرجس'], array[1]),
      ('فيلا',   'بيع',   null,   array['جدة'],    array['حي السلامة'], array[2]),
      ('مكتب',   'بيع',   null,   null::text[],    null::text[],        null::int[]),
      ('معرض',   'إيجار', 'سنوي', null::text[],    null::text[],        null::int[]),
      ('مستودع', 'بيع',   null,   null::text[],    null::text[],        null::int[])
    ) as t(ui_type, deal, period, cities, districts, region_ids)
  loop
    v_checked := v_checked + 1;
    with scope as (
      select public.ops_qa_scope_tables(
               case when v_probe.deal='إيجار' and v_probe.period in ('شهري','كلاهما')
                    then c.scope||'m' else c.scope end) tb,
             case when c.scope2 is null then null
                  else public.ops_qa_scope_tables(
                    case when v_probe.deal='إيجار' and v_probe.period in ('شهري','كلاهما')
                         then c.scope2||'m' else c.scope2 end) end tb2,
             c.types_ar, c.scope2, c.macro
        from public.ops_qa_cohort c where c.ui_type = v_probe.ui_type),
    -- what the RPC actually hands the user, AFTER ranking and diversification
    rpc as (
      select r.source_table||':'||r.listing_id k, r.total_count
        from scope, lateral public.location_search_candidates_ar(
          p_deal := v_probe.deal, p_cities := v_probe.cities, p_districts := v_probe.districts,
          p_tables := scope.tb, p_platforms := null, p_per_platform := null, p_limit := 1500,
          p_region_ids := v_probe.region_ids, p_types := scope.types_ar,
          p_price_min := null, p_price_max := null, p_rent_period := v_probe.period,
          p_area_min := null, p_area_max := null, p_beds_exact := null, p_beds_min := null,
          p_bath_min := null, p_furnished := null, p_age_max := null, p_tenant := null,
          p_directions := null, p_has_license := null, p_amenities := null, p_offset := 0,
          p_tables2 := scope.tb2,
          p_types2 := case when scope.scope2 is null then null else scope.types_ar end,
          p_category := scope.macro) r),
    oracle as (
      select d.n, d.h from public.ops_qa_diff(v_probe.ui_type, v_probe.deal, v_probe.period,
               v_probe.cities, v_probe.districts, v_probe.region_ids,
               null, null, null, null, null, null) d)
    select
      case when (select n from oracle) <= 1500
             and md5((select string_agg(k, ',' order by k) from rpc))
                 is distinct from (select h from oracle)
           then 1 else 0 end,
      coalesce((select max(total_count) from rpc), 0) - (select n from oracle),
      (select count(*) - count(distinct k) from rpc)
      into v_ineligible, v_count_delta, v_dupes;

    if coalesce(v_ineligible,0) <> 0 or coalesce(v_count_delta,0) <> 0 or coalesce(v_dupes,0) <> 0 then
      v_bad := v_bad || jsonb_build_object(
        'ui_type', v_probe.ui_type, 'deal', v_probe.deal, 'period', v_probe.period,
        'cities', v_probe.cities, 'districts', v_probe.districts,
        'returned_set_differs_from_eligible_set', v_ineligible,
        'rpc_count_minus_eligible_count', v_count_delta,
        'duplicate_rows_from_diversification', v_dupes);
    end if;
  end loop;

  if jsonb_array_length(v_bad) = 0 then
    perform public.mon_resolve_key('ranking_diversity_contract','ranking_diversity_contract');
    return 0;
  end if;

  n := public.mon_raise('P1','ranking_diversity_contract','all','ranking_diversity_contract',
    jsonb_build_object(
      'why','Ranking/diversification must operate strictly INSIDE the eligible set: it may reorder, '
         || 'never introduce a listing that fails the user''s filters, never duplicate a listing, '
         || 'and never change the count the user is shown. (Owner rule 2026-08-22.)',
      'probes_checked', v_checked,
      'violations', v_bad));
  return n;
end $function$;

comment on function public.mon_detect_ranking_diversity_contract() is
  'Owner rule 2026-08-22 — match first, then diversify. Drives the real search RPC and proves '
  'against the independent oracle that every returned row is eligible, no row is duplicated by '
  'diversification, and the displayed count equals the eligible count. Daily-gated (real RPC load).';

-- Roster wiring for BOTH, in the same migration (mon_detect_orphaned_detectors() fires on any
-- detector nothing reaches). Guarded splice; +2 entries asserted.
do $do$
declare
  src text; before_n int; after_n int;
  anchor text := '''mon_detect_orphaned_detectors''';
  needle text := ', ''mon_detect_card_label_contract'', ''mon_detect_ranking_diversity_contract''';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found - refusing to wire blindly';
  end if;
  if position('mon_detect_card_label_contract' in src) > 0 then
    raise notice 'already wired - no-op'; return;
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor appears % times, expected exactly 1 - refusing to splice',
      (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;

  before_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  src := replace(src, anchor, anchor || needle);
  after_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');

  if after_n <> before_n + 2 then
    raise exception 'roster went from % to % entries, expected exactly +2 - refusing to install',
      before_n, after_n;
  end if;
  if position('mon_detect_card_label_contract' in src) = 0
     or position('mon_detect_ranking_diversity_contract' in src) = 0
     or position('mon_detect_city_label_is_admin_region' in src) = 0
     or position('mon_detect_orphaned_detectors' in src) = 0
     or position('mon_detect_stalled_daily_detector' in src) = 0 then
    raise exception 'post-splice assertion failed - refusing to install';
  end if;

  execute src;
end
$do$;
