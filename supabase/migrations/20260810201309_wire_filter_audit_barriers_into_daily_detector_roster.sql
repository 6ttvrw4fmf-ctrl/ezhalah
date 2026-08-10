-- Make the 2026-08-10 Filter-audit findings PERMANENT DAILY PROTECTION rather than one good day.
--
-- The barriers built during the audit are callable but nothing calls them. The daily Data Integrity
-- Engineer routine runs `mon_run_all_detectors()`, whose roster only holds `mon_detect_*` functions
-- returning an int. These five wrappers put every lesson from today into that sweep. They are added
-- to the roster in this same migration because `mon_detect_orphaned_detectors()` correctly fires on
-- any detector that nothing reaches — a detector outside the roster is decoration.
--
-- SOURCE IS TRUTH is preserved in every one of these: each reports a QUESTION for a human/agent to
-- adjudicate against source. None of them rewrites data, and none treats "unusual" as "wrong".

-- 1. PRICE ⇄ AREA CONTAMINATION, over residential AND commercial.
create or replace function public.mon_detect_price_size_contamination()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; r record;
begin
  for r in select * from public.mon_price_size_fidelity_barrier() loop
    -- P1: a fabricated value is being SERVED. P2 for the zero-placeholder class, which is wrong but
    -- not a wrong number on a card.
    n := n + public.mon_raise(
      case when r.check_name in ('area_leaked_into_price','rate_stored_as_total',
                                 'index_price_differs_from_raw') then 'P1' else 'P2' end,
      'price_size_contamination', r.platform,
      'price_size_contamination:' || r.check_name || ':' || r.platform,
      jsonb_build_object('check', r.check_name, 'rows', r.n, 'detail', r.detail,
        'adjudicate', 'Equality/oddness is NOT proof. Check the spec table and price_per_meter '
                   || 'before touching anything: ppm=1 makes total=area legitimately (aqar 6594767), '
                   || 'and a source-published area may coincide with the rent. Only repair when the '
                   || 'source demonstrably publishes something else.'));
  end loop;
  return n;
end $function$;

-- 2. TRENDING DISTRICT dead ends / unreachable inventory.
create or replace function public.mon_detect_trending_district_dead_end()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; r record;
begin
  for r in select * from public.mon_trending_district_barrier() loop
    n := n + public.mon_raise(
      case when r.check_name = 'trending_chip_dead_end' then 'P1' else 'P2' end,
      'trending_district', 'all',
      'trending_district:' || r.check_name,
      jsonb_build_object('check', r.check_name, 'n', r.n, 'detail', r.detail,
        'note', 'The chip must deliver what it promises. Callers MUST pass match_values, not the '
             || 'display name — the display name loses the hamza twin (measured 1,869 -> 1,104).'));
  end loop;
  return n;
end $function$;

-- 3. LOCATION PREDICATE PARITY — the 3-branch city OR must never be collapsed.
create or replace function public.mon_detect_location_predicate_drift()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; r record;
begin
  for r in select * from public.mon_location_predicate_branch_barrier() loop
    n := n + public.mon_raise('P1', 'location_predicate_drift', 'all',
      'location_predicate_drift:' || r.probe_city || ':' || r.probe_deal,
      jsonb_build_object('city', r.probe_city, 'deal', r.probe_deal,
        'rpc_total', r.rpc_total, 'truth_total', r.truth_total, 'gap', r.gap,
        'note', 'A city match is city_ar text OR city_id OR match_city_ids overlap. Each branch '
             || 'holds listings the others miss. A gap means a branch was dropped — inventory is '
             || 'silently unreachable, not merely slower.'));
  end loop;
  return n;
end $function$;

-- 4. SEARCH PERFORMANCE REGRESSION. Baselines measured 2026-08-10 on Large/m6g.large AFTER the
--    ARRAY(SELECT ...) rewrite: broad Riyadh/Buy 255 ms, typical filtered search 65 ms. Thresholds
--    are deliberately loose (~4-8x) so ordinary contention never pages anyone; this exists to catch
--    a STRUCTURAL regression — someone reverting the indexable form back to `IN (SELECT ...)`, or
--    dropping idx_slar_city_norm / idx_slar_deal_city / idx_slar_match_city_ids.
create or replace function public.mon_detect_search_performance_regression()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; t0 timestamptz; v_broad numeric; v_typical numeric;
begin
  t0 := clock_timestamp();
  perform 1 from public.location_search_candidates_ar(
    p_deal := 'بيع', p_cities := array['الرياض'], p_limit := 10);
  v_broad := extract(epoch from clock_timestamp() - t0) * 1000;

  t0 := clock_timestamp();
  perform 1 from public.location_search_candidates_ar(
    p_deal := 'بيع', p_cities := array['الرياض'], p_types := array['شقة'],
    p_price_min := 500000, p_price_max := 1500000, p_beds_exact := array[3], p_limit := 10);
  v_typical := extract(epoch from clock_timestamp() - t0) * 1000;

  if v_broad > 2000 or v_typical > 500 then
    n := public.mon_raise(case when v_broad > 5000 then 'P1' else 'P2' end,
      'search_performance_regression', 'all',
      'search_performance_regression:' || current_date,
      jsonb_build_object('broad_ms', round(v_broad), 'broad_baseline_ms', 255,
        'typical_ms', round(v_typical), 'typical_baseline_ms', 65,
        'first_check', 'EXPLAIN the broad query. It MUST show a BitmapOr over idx_slar_city_norm + '
                    || 'idx_slar_deal_city + idx_slar_match_city_ids. If it shows a hashed SubPlan '
                    || 'instead, the location predicate was reverted from = ANY (ARRAY(SELECT ...)) '
                    || 'to IN (SELECT ...), which makes those indexes unusable.',
        'rule', 'NEVER fix this by narrowing the predicate. Correctness outranks speed: any change '
             || 'must return byte-identical ordered results on the 12 audited query shapes.'));
  end if;
  return n;
end $function$;

-- 5. COMMERCIAL BLIND SPOT. Today's most transferable lesson: a check JOINed only to
--    aqar_residential_listings, so a real defect in aqar_commercial_listings (ad 6650784, the area
--    label followed by an ellipsis and the parser taking the RENT) was invisible to both the sweep
--    and the barrier. A per-table check silently scopes away half a platform. This detects the
--    structural version: a commercial table holding active rows that reaches search with none.
create or replace function public.mon_detect_commercial_coverage_blind_spot()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; r record; v_active bigint; v_search bigint;
begin
  for r in
    select c.table_name
    from information_schema.tables c
    where c.table_schema = 'public' and c.table_name like '%\_commercial\_listings'
  loop
    execute format('select count(*) from public.%I where active', r.table_name) into v_active;
    select count(*) into v_search from public.search_listings_ar s where s.source_table = r.table_name;
    if v_active > 50 and v_search = 0 then
      n := n + public.mon_raise('P1', 'commercial_coverage_blind_spot',
        replace(r.table_name, '_commercial_listings', ''),
        'commercial_coverage_blind_spot:' || r.table_name,
        jsonb_build_object('table', r.table_name, 'active_rows', v_active, 'rows_in_search', v_search,
          'note', 'A whole commercial table holds active inventory but reaches search with nothing. '
               || 'Also re-check that every fidelity barrier spans BOTH the residential and the '
               || 'commercial table for this platform — a residential-only JOIN hides half a platform.'));
    end if;
  end loop;
  return n;
end $function$;

-- Wire all five into the daily roster. Guarded needle-edit off the LIVE definition: if the roster
-- has drifted from what we expect, abort rather than rebuild it from a stale base — that is exactly
-- how mon_detect_unverified_inactivation went dark once before.
do $$
declare v_def text; v_new text; n int;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
  where n2.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  select count(*) into n from regexp_matches(v_def, '''mon_detect_orphaned_detectors''', 'g');
  if n <> 1 then raise exception 'roster anchor not found exactly once (found %)', n; end if;

  if position('mon_detect_price_size_contamination' in v_def) > 0 then
    raise notice 'already wired; nothing to do'; return;
  end if;

  v_new := replace(v_def,
    '    ''mon_detect_orphaned_detectors''',
    '    ''mon_detect_price_size_contamination'','
    || E'\n    ''mon_detect_trending_district_dead_end'','
    || E'\n    ''mon_detect_location_predicate_drift'','
    || E'\n    ''mon_detect_search_performance_regression'','
    || E'\n    ''mon_detect_commercial_coverage_blind_spot'','
    || E'\n    ''mon_detect_orphaned_detectors''');

  if v_new = v_def then raise exception 'roster needle-edit produced no change'; end if;
  execute v_new;
end $$;