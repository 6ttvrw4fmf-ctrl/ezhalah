-- CORRECTS THE PROBE ADDED HOURS EARLIER IN 20260827113819 (same routine, same day).
--
-- That migration bounded its anon Trending probe with `set local statement_timeout = '6s'` and said
-- so in its comment. THE BOUND DOES NOT BIND, and the mutation proof is what exposed it: with the
-- fix reverted inside a rolled-back transaction the probe ran for 19,214 ms, not 6,000 ms.
-- statement_timeout is enforced per TOP-LEVEL statement; every statement inside a function body
-- belongs to the top-level statement that called it, so a SET LOCAL there cannot cut short a query
-- the same function is already running. The sweep's own 900 s ceiling was the only real bound —
-- and mon_detect_search_performance_regression runs inside the ONE transaction that pg_cron job 38
-- executes, which is already carrying an open detector_sweep_budget alert at 61.7% of that ceiling.
-- A detector that can silently spend 20-40 s of a strained sweep is a detector that helps abort it.
--
-- THE REPLACEMENT IS CHEAPER, STRICTER AND HONEST: read the PLAN the user's role actually gets,
-- with EXPLAIN (costs off) — no execution at all. `total AS MATERIALIZED` appears in the plan as a
-- `CTE total` node; the inlined (broken) form has no such node and re-runs the aggregate per row.
-- Measured both directions, as ROLE anon:
--   fixed    -> has "CTE total" = true,  EXPLAIN cost 9 ms
--   mutated  -> has "CTE total" = false, EXPLAIN cost 5 ms   (detector raises P1)
-- This beats the source-text regex it replaces too: a regex reads what we wrote, EXPLAIN reads what
-- the planner decided FOR ANON, which is the only thing the 2026-08-27 defect was ever about.
--
-- The timing probe stays, but now runs ONLY when the plan is already healthy — so a re-broken
-- function costs the sweep ~9 ms to detect instead of 20-40 s to suffer.
create or replace function public.mon_detect_search_performance_regression()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n int := 0; t0 timestamptz; v_broad numeric; v_typical numeric;
  v_trend_anon numeric := null; v_trend_err text := null;
  v_prev_role text := current_user; v_plan text := ''; v_plan_ok boolean; r record;
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

  -- (c) TRENDING CITIES, AS THE USER'S ROLE (2026-08-27). bedrooms AND budget together is the shape
  -- that timed out; either predicate alone stayed fast, so a one-predicate probe cannot see it.
  begin
    execute format('set local role %I', 'anon');
    for r in execute $q$explain (costs off)
      select * from public.top_cities_by_deal_ar(
        p_deal := 'بيع', p_category := 'Residential',
        p_types := array['فيلا','تاون هاوس','بيت'], p_beds_min := 4, p_price_max := 3000000)$q$
    loop v_plan := v_plan || r."QUERY PLAN" || E'\n'; end loop;
    v_plan_ok := v_plan ~ 'CTE total';
    -- Only measure when the plan is sound: an unsound plan is already a P1 and running it would
    -- burn tens of seconds of the shared sweep transaction to learn nothing new.
    if v_plan_ok then
      t0 := clock_timestamp();
      perform 1 from public.top_cities_by_deal_ar(
        p_deal := 'بيع', p_category := 'Residential',
        p_types := array['فيلا','تاون هاوس','بيت'], p_beds_min := 4, p_price_max := 3000000);
      v_trend_anon := extract(epoch from clock_timestamp() - t0) * 1000;
    end if;
  exception when others then
    v_trend_err := sqlstate || ' ' || left(sqlerrm, 120);
    v_plan_ok := coalesce(v_plan_ok, false);
  end;
  execute format('set local role %I', v_prev_role);

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

  if v_trend_err is not null or coalesce(v_plan_ok, false) = false
     or coalesce(v_trend_anon, 0) > 4000 then
    n := n + public.mon_raise(
      case when v_trend_err is not null or coalesce(v_plan_ok, false) = false then 'P1' else 'P2' end,
      'search_performance_regression', 'all',
      'trending_cities_unusable_when_narrowed:' || current_date,
      jsonb_build_object(
        'anon_plan_materialises_total', v_plan_ok,
        'trending_anon_ms', round(coalesce(v_trend_anon, -1)), 'baseline_ms', 185,
        'trending_anon_error', v_trend_err,
        'probe', 'EXPLAIN as ROLE anon: top_cities_by_deal_ar, Buy · فيلا/تاون هاوس/بيت · beds>=4 · price<=3M',
        'why', 'Trending Cities is the location breakdown of the user''s eligible set. When this '
            || 'call errors or crawls, locations.ts refuses every widening fallback (correctly — a '
            || 'widened count under an active filter is a false count), so the city field renders '
            || 'NOTHING and the user cannot pick a city from Trending at all.',
        'first_check', 'EXPLAIN it AS ROLE anon, not as postgres. The 2026-08-27 defect was invisible '
                    || 'to every privileged probe: as postgres the cohort CTE estimated 25 rows and '
                    || 'the total aggregate ran once (179 ms); as anon it estimated 1 row and ran '
                    || 'once PER OUTPUT ROW — 16,708 loops, 39,221 ms. A sound plan carries a '
                    || '"CTE total" node; an unsound one has none.',
        'rule', 'Fix by making the aggregate materialise (total AS MATERIALIZED), never by dropping '
             || 'a predicate, capping the city list, or widening the fallback gate.'));
  end if;

  update public.ops_detector_last_full_run set last_result = n
   where detector = 'search_performance_regression';
  perform public.mon_resolve_stale_keys('search_performance_regression',
    (case when v_broad > 2000 or v_typical > 500
          then array['search_performance_regression:'||current_date::text] else '{}'::text[] end)
    || (case when v_trend_err is not null or coalesce(v_plan_ok, false) = false
                  or coalesce(v_trend_anon, 0) > 4000
             then array['trending_cities_unusable_when_narrowed:'||current_date::text] else '{}'::text[] end));
  return n;
end
$fn$;
