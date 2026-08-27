-- TRENDING CITIES DIED ON THE MOST ORDINARY FILTER A BUYER SETS (AF+Trending routine, 2026-08-27).
--
-- SYMPTOM, measured over the anon REST path this morning (the path a real browser uses):
--   Buy · villas · beds>=4 · price<=3,000,000   ->  20,205 ms, 57014 canceling statement due to
--                                                   statement timeout
--   Buy · villas · beds>=4                      ->     442 ms  (fine)
--   Buy · villas · price<=3M                    ->     574 ms  (fine)
--   Rent-Annual · apartments · beds>=2 · <=60k  ->  12,047 ms  (survived, on the same cliff)
-- Either predicate alone is fast; together the call dies. locations.ts correctly refuses every
-- widening fallback while the user is narrowed (a widened count under an active filter is a lie),
-- so the city pool goes to status 'error' and Trending Cities renders NOTHING. Honest, and dead.
--
-- ROOT CAUSE — a per-row re-aggregation that only appears under the USER's role:
--   ), total as (select count(*)::int as t from cohort)
--   ... from cohort co ... cross join total
-- `total` is referenced exactly once, so PG12+ INLINES it, and it is then free to re-evaluate the
-- aggregate once per output row. Whether it does depends entirely on the row estimate for `cohort`:
--   as postgres (service role): cohort estimated 25 rows -> aggregate materialised, loops=1  ->    179 ms
--   as anon      (RLS enabled): cohort estimated  1 row  -> Aggregate ... loops=16708        -> 39,221 ms
-- 16,708 x 16,708 CTE scans. The plan difference is the whole bug: every barrier we own runs as a
-- privileged role, so every barrier saw the 179 ms plan.
--
-- FIX: `total as MATERIALIZED` — evaluate the count once, by construction, whatever the estimate.
-- Semantics are untouched (proved below, and row-for-row against the live function before applying:
-- Buy/villas/4+/<=3M 113 rows, Rent-Annual/apartments 0 diffs, unfiltered 372 rows 0 diffs).
--
-- Edited with a server-side replace() carrying an occurrence-count assertion, which is the
-- established technique for this function (see 20260820194905_buy_rent_combined_trending_null_safe_
-- and_dual_price.sql) — a transcription slip fails loudly instead of shipping broken SQL. This
-- function is NOT one of the four af_rpc_templates surfaces, so it is edited here, not rebuilt.
do $$
declare d text; n int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'top_cities_by_deal_ar';

  select count(*) into n from regexp_matches(d, '\), total as \(select count\(\*\)::int as t from cohort\)', 'g');
  if n <> 1 then
    raise exception 'top_cities_by_deal_ar: expected exactly 1 inlinable total CTE, found % — inspect before editing', n;
  end if;

  d := replace(d, '), total as (select count(*)::int as t from cohort)',
                  '), total as materialized (select count(*)::int as t from cohort)');
  execute d;

  -- prove the edit landed, and that no second overload was created (the PGRST203 shape)
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'top_cities_by_deal_ar' and p.prokind = 'f';
  if n <> 1 then raise exception 'top_cities_by_deal_ar has % overloads after the edit (must be 1)', n; end if;

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'top_cities_by_deal_ar'
     and pg_get_functiondef(p.oid) ~ 'total as materialized';
  if n <> 1 then raise exception 'top_cities_by_deal_ar: the materialized total did not land'; end if;
end $$;

grant execute on function public.top_cities_by_deal_ar to anon, authenticated, service_role;

-- ── THE BARRIER, extended rather than duplicated ────────────────────────────────────────────────
-- mon_detect_search_performance_regression already owns "a count surface got slow". It stayed green
-- through a 39-second Trending call for two structural reasons, both fixed here:
--   1. it probed location_search_candidates_ar ONLY — never top_cities_by_deal_ar (Trending), the
--      surface that broke;
--   2. it probed as its own privileged role, and this bug class does not exist there. A performance
--      detector that never assumes the role the USER has cannot see a plan that only anon gets.
-- So the extension adds a Trending probe UNDER `set local role anon`, in the narrowed shape that
-- actually died, plus a static pin on the materialized total. Both are bounded by a local
-- statement_timeout so a re-broken function costs the (already budget-pressured) sweep seconds,
-- never minutes — and the whole detector still runs at most once per daily slot.
create or replace function public.mon_detect_search_performance_regression()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n int := 0; t0 timestamptz; v_broad numeric; v_typical numeric;
  v_trend_anon numeric; v_trend_err text := null; v_prev_role text := current_user;
  v_prev_timeout text := current_setting('statement_timeout');
  v_mat boolean;
begin
  if not public.mon_claim_daily_slot('search_performance_regression') then return 0; end if;
  t0 := clock_timestamp();
  perform 1 from public.location_search_candidates_ar(
    p_deal := 'بيع', p_cities := array['الرياض'], p_limit := 10);
  v_broad := extract(epoch from clock_timestamp() - t0) * 1000;

  t0 := clock_timestamp();
  perform 1 from public.location_search_candidates_ar(
    p_deal := 'بيع', p_cities := array['الرياض'], p_types := array['شقة'],
    p_price_min := 500000, p_price_max := 1500000, p_beds_exact := array[3], p_limit := 10);
  v_typical := extract(epoch from clock_timestamp() - t0) * 1000;

  -- (c) TRENDING CITIES, AS THE USER'S ROLE, UNDER A REAL NARROWED STATE (2026-08-27).
  -- bedrooms AND budget together is the shape that timed out; either alone stayed fast, so a
  -- one-predicate probe would not have caught it.
  begin
    set local statement_timeout = '6s';
    execute format('set local role %I', 'anon');
    t0 := clock_timestamp();
    perform 1 from public.top_cities_by_deal_ar(
      p_deal := 'بيع', p_category := 'Residential',
      p_types := array['فيلا','تاون هاوس','بيت'], p_beds_min := 4, p_price_max := 3000000);
    v_trend_anon := extract(epoch from clock_timestamp() - t0) * 1000;
  exception when others then
    v_trend_err := sqlstate || ' ' || left(sqlerrm, 120);
    v_trend_anon := null;
  end;
  -- Restore BOTH. Never hard-reset statement_timeout to 0 here: the detector sweep runs as ONE
  -- transaction, so that would strip every later detector of the ceiling the detector_sweep_budget
  -- alert exists to protect.
  execute format('set local role %I', v_prev_role);
  execute format('set local statement_timeout = %L', v_prev_timeout);

  -- (d) static pin: the fix is one word, and a regeneration of this function would silently drop it.
  select pg_get_functiondef(p.oid) ~ 'total as materialized' into v_mat
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'top_cities_by_deal_ar';

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

  if v_trend_err is not null or coalesce(v_trend_anon, 1e9) > 4000 or coalesce(v_mat, false) = false then
    n := n + public.mon_raise(
      case when v_trend_err is not null or coalesce(v_mat, false) = false then 'P1' else 'P2' end,
      'search_performance_regression', 'all',
      'trending_cities_unusable_when_narrowed:' || current_date,
      jsonb_build_object(
        'trending_anon_ms', round(coalesce(v_trend_anon, -1)), 'baseline_ms', 185,
        'trending_anon_error', v_trend_err,
        'total_cte_materialized', v_mat,
        'probe', 'top_cities_by_deal_ar as ROLE anon: Buy · فيلا/تاون هاوس/بيت · beds>=4 · price<=3M',
        'why', 'Trending Cities is the location breakdown of the user''s eligible set. When this '
            || 'call errors or crawls, locations.ts refuses every widening fallback (correctly — a '
            || 'widened count under an active filter is a false count), so the city field renders '
            || 'NOTHING and the user cannot pick a city from Trending at all.',
        'first_check', 'EXPLAIN ANALYZE it AS ROLE anon, not as postgres. The 2026-08-27 defect was '
                    || 'invisible to every privileged probe: as postgres the cohort CTE estimated 25 '
                    || 'rows and the total aggregate ran once (179 ms); as anon it estimated 1 row '
                    || 'and ran once PER OUTPUT ROW — 16,708 loops, 39,221 ms. Look for '
                    || '"Aggregate ... loops=<many>" over a CTE scan.',
        'rule', 'Fix by making the aggregate materialise (total AS MATERIALIZED), never by dropping '
             || 'a predicate, capping the city list, or widening the fallback gate.'));
  end if;

  update public.ops_detector_last_full_run set last_result = n
   where detector = 'search_performance_regression';
  perform public.mon_resolve_stale_keys('search_performance_regression',
    (case when v_broad > 2000 or v_typical > 500
          then array['search_performance_regression:'||current_date::text] else '{}'::text[] end)
    || (case when v_trend_err is not null or coalesce(v_trend_anon, 1e9) > 4000 or coalesce(v_mat, false) = false
             then array['trending_cities_unusable_when_narrowed:'||current_date::text] else '{}'::text[] end));
  return n;
end
$fn$;
