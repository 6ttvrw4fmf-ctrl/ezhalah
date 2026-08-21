-- Data Integrity Engineer: AF data-layer coverage extension (2026-08-20, run #34).
--
-- The routine's spec (docs/ops/DATA_INTEGRITY_ENGINEER.md line 90) said "Advanced Filter is out
-- of scope". The owner directive of 2026-08-20 is to certify the AF DATA LAYER inside this
-- routine (source -> scraper -> parser -> DB -> normalization -> canonical AF field -> search
-- index) for every enabled cohort, with UI matching left to Search QA.
--
-- The pre-existing AF barriers already cover: RPC-surface parity (mon_af_predicate_parity),
-- per-platform x field x cohort-segment fresh-listing capture regression (mon_af_new_listing_
-- readiness), canonical -> search parity (mon_rich_attrs_barrier), v2-branch discards
-- (mon_detect_v2_discards_captured_attrs), Monthly Residential count exactness
-- (mon_detect_monthly_af_exactness), summary-only capture (mon_detect_summary_only_capture).
-- ADVANCED_FILTER_SOURCE_TRUTH.md §4 mandates two more classes that no current detector guards:
--
--   * NULL -> false silent conversion along the chain. If listing_extra_attrs.field IS NULL
--     but search_listings_ar.field IS FALSE for the same key, the pipeline manufactured a
--     negative from an unknown -- a data corruption incident, not a default. Measured today
--     across all 8 booleans in the certified cohort: 0/0/0/0/0/0/0/0. This detector locks in
--     that guarantee: a standing 0 is the healthy reading, and it must NEVER be tidied away.
--
--   * All-true / all-false variance per (platform x field x cohort segment). Naive detectors
--     of this class flood on legitimate source realities (elevator=false on land; kitchen=false
--     on warehouse). The honest shape uses cross-platform sanity: only alert when THIS platform
--     is stuck at one value while some OTHER platform in the same (deal, period, type) shows
--     meaningful variance (both t>=5 and f>=5). Measured today, that filter reduces the naive
--     hit set to 11 real-signal rows; run #34 does NOT waive them -- they are exactly the
--     alerts this barrier exists to surface. The threshold is >=30 known rows per segment,
--     the same cross-platform sanity limbs mon_af_new_listing_readiness already uses.
--
-- Impossible-value detection was DELIBERATELY EXCLUDED from this barrier. During probe design
-- 102 rows had street_width_m > 200 m in the cohort; aqar 124827's own captured page reads
-- «عرض الشارع 7,779 م» -- aqar published 7,779 metres. Weird is not wrong (core rule / §0.1).
-- A barrier that would pressure repair of source-published numbers is worse than no barrier.
create or replace function public.mon_detect_af_tri_state_violations()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; total_leaks int := 0; total_stuck int := 0;
  leaks jsonb := '[]'::jsonb; stuck jsonb := '[]'::jsonb;
  f text; sample jsonb;
  boolean_fields constant text[] := array[
    'furnished','elevator','parking','kitchen','air_conditioner',
    'maid_room','driver_room','private_entrance'];
begin
  -- limb A: NULL -> false silent conversion (structural; must stay 0)
  foreach f in array boolean_fields loop
    execute format($q$
      select coalesce(jsonb_agg(x order by x->>'source_table', x->>'listing_id'), '[]'::jsonb)
      from (
        select jsonb_build_object('source_table', s.source_table, 'listing_id', s.listing_id) x
        from public.search_listings_ar s
        join public.listing_extra_attrs e using (source_table, listing_id)
        where s.production_ready
          and public.af_in_certified_cohort(s.deal_ar, s.rent_period_ar, s.type_ar)
          and s.%I is false and e.%I is null
        limit 10) q$q$, f, f) into sample;
    if jsonb_array_length(sample) > 0 then
      leaks := leaks || jsonb_build_object('field', f, 'sample', sample);
      total_leaks := total_leaks + jsonb_array_length(sample);
    end if;
  end loop;
  if total_leaks > 0 then
    n := n + public.mon_raise('P1', 'af_null_to_false_conversion', 'search_index',
      'af_null_to_false_conversion',
      jsonb_build_object(
        'leaks_by_field', leaks,
        'why', 'A listing whose Advanced-Filter boolean is NULL in listing_extra_attrs became FALSE '
            || 'in search_listings_ar. That is the tri-state law being broken: the pipeline '
            || 'manufactured a negative from an unknown. Never leave standing.',
        'do_not', 'Do NOT flip search rows to NULL by hand. Fix the sync/writer that manufactured '
                 || 'the FALSE, then re-run sync_search_listings_ar to let the correct NULL propagate.'));
  else
    perform public.mon_resolve_key('af_null_to_false_conversion', 'af_null_to_false_conversion');
  end if;

  -- limb B: stuck-at-one-value with CROSS-PLATFORM SANITY
  --   n_known >= 30 and (all-true or all-false), but ONLY when some other platform in the same
  --   (deal, period, type) shows meaningful variance (both true>=5 and false>=5). The sanity
  --   filter is what stops elevator=false on 1,570 aqar لأرض سكنية from raising -- every platform
  --   reports the same, so it is a source truth, not a stuck parser.
  with per_seg as (
    select s.source_table, s.deal_ar, s.rent_period_ar, s.type_ar, u.field,
      count(*) filter (where val is true) t,
      count(*) filter (where val is false) f
    from public.search_listings_ar s
    cross join lateral (values
      ('furnished'::text,        s.furnished),
      ('elevator',               s.elevator),
      ('parking',                s.parking),
      ('kitchen',                s.kitchen),
      ('air_conditioner',        s.air_conditioner),
      ('maid_room',              s.maid_room),
      ('driver_room',            s.driver_room),
      ('private_entrance',       s.private_entrance)) u(field, val)
    where s.production_ready
      and public.af_in_certified_cohort(s.deal_ar, s.rent_period_ar, s.type_ar)
    group by 1,2,3,4,5),
  peer as (
    select deal_ar, rent_period_ar, type_ar, field,
      max(case when t>=5 and f>=5 then 1 else 0 end) peer_variance
    from per_seg group by 1,2,3,4)
  select coalesce(jsonb_agg(jsonb_build_object(
           'source_table', p.source_table, 'field', p.field,
           'deal', p.deal_ar, 'period', p.rent_period_ar, 'type', p.type_ar,
           'true_count', p.t, 'false_count', p.f)
         order by p.f+p.t desc), '[]'::jsonb),
         count(*)::int
    into stuck, total_stuck
  from per_seg p join peer x using (deal_ar, rent_period_ar, type_ar, field)
  where p.t + p.f >= 30 and (p.t = 0 or p.f = 0) and x.peer_variance = 1
    and not exists (
      select 1 from public.ops_amenity_capture_verified w
      where w.source_table = p.source_table and w.field = p.field
        and w.deal_ar = p.deal_ar
        and (w.rent_period_key = coalesce(p.rent_period_ar, '') or w.rent_period_key = '*')
        and w.type_ar = p.type_ar);

  if total_stuck > 0 then
    n := n + public.mon_raise('P2', 'af_field_stuck_no_variance', 'search_index',
      'af_field_stuck_no_variance',
      jsonb_build_object(
        'stuck_pairs', stuck,
        'why', 'For this (platform x field x cohort segment) with >=30 known values, the field '
            || 'is 100% one value, while another platform in the same (deal, period, type) '
            || 'reports meaningful variance. Either this platform''s parser is asserting a '
            || 'constant, or the source itself only publishes one value -- adjudicate against '
            || 'the source and either fix the parser or acknowledge in ops_amenity_capture_verified.',
        'do_not', 'Do NOT waive without live source evidence. Cross-platform variance is the '
                 || 'signal that this cohort segment CAN vary; the burden is on the source to '
                 || 'prove it does not.'));
  else
    perform public.mon_resolve_key('af_field_stuck_no_variance', 'af_field_stuck_no_variance');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_af_tri_state_violations() is
  'Data-Integrity AF barrier (2026-08-20, run #34). Two limbs of ADVANCED_FILTER_SOURCE_TRUTH.md '
  '§4 the pipeline had no explicit guard for: (A) NULL->false silent conversion between '
  'listing_extra_attrs and search_listings_ar -- MUST stay 0; (B) all-one-value stuck fields per '
  '(platform, field, cohort segment) with cross-platform sanity so land/warehouse false-on-100% '
  'stays quiet. Impossible-value detection intentionally omitted (source-published extreme values '
  'are protected by the core rule -- see aqar 124827 street_width 7,779 m).';

-- ROSTER WIRING (guarded needle-edit per 20260810222259). Splice one entry into the array.
do $$
declare v_def text; v_before text;
  anchor constant text := '''mon_detect_orphaned_detectors''';
  add    constant text := 'mon_detect_af_tri_state_violations';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing - refusing to guess at the array shape';
  end if;
  if position('''' || add || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, anchor || ', ''' || add || '''');
  end if;
  if v_def = v_before then
    raise notice 'roster already carries % - nothing to do', add;
    return;
  end if;
  execute v_def;
end $$;

-- Prove in the same transaction: new entry reachable AND pre-existing controls survived.
do $$
declare v_def text; fn text; missing text[] := '{}';
  want text[] := array[
    'mon_detect_af_tri_state_violations',
    -- CONTROLS
    'mon_detect_legacy_branch_region_scope',
    'mon_detect_silent_scraper_death','mon_detect_zero_new_stall',
    'mon_detect_english_overlay_stranded_city','mon_detect_orphaned_detectors',
    'mon_detect_v2_discards_captured_attrs','mon_detect_monthly_af_exactness',
    'mon_detect_summary_only_capture'];
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'roster edit incomplete or dropped entries: %', array_to_string(missing, ', ');
  end if;
end $$;
