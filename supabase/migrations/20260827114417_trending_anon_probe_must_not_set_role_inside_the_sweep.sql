-- THIRD AND FINAL CORRECTION OF TODAY'S PROBE — and the most important one.
--
-- 20260827113819 and 20260827xxxxxx (the EXPLAIN rewrite) both did `set local role anon` inside
-- mon_detect_search_performance_regression, which is SECURITY DEFINER. That works when the function
-- is the top-level statement (`select mon_detect_search_performance_regression()` — how I tested it)
-- and FAILS when it is called from another function:
--     ERROR 42501: cannot set parameter "role" within security-definer function
-- mon_run_all_detectors() calls every detector exactly that way, and pg_cron job 38 runs the whole
-- sweep as ONE transaction — so the next scheduled sweep would have ERRORED, rolling back every
-- alert it had already raised and skipping mon_dispatch_alerts entirely. That is precisely the
-- failure the OPEN detector_sweep_budget/detector_sweep_aborted alerts describe, and I would have
-- caused another instance of it while adding a barrier against a different bug. Caught by running
-- the detector nested (inside a DO block) during its own mutation proof, before any sweep ran it.
--
-- THE SPLIT THAT FIXES IT, and is the right design anyway:
--   • IN THE DATABASE (here): pin the SOURCE — `total AS MATERIALIZED` must still be in the function
--     definition. Free, role-independent, and it catches the only way the fix can regress: someone
--     editing or regenerating top_cities_by_deal_ar without it.
--   • OVER THE WIRE (scripts/verify-trending-usable-under-narrowing.ts, in
--     count-rpc-parity-live-check.yml every 6h): prove the USER's experience as the anon role really
--     is — latency AND advertised-count == click-through — through the same REST path a browser
--     uses. No role switching needed there: that client IS anon.
-- A database detector cannot become the anon role without endangering the sweep; a live check is
-- already the anon role. Each half now does the thing it can actually do safely.
create or replace function public.mon_detect_search_performance_regression()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n int := 0; t0 timestamptz; v_broad numeric; v_typical numeric;
  v_trend_ms numeric; v_mat boolean;
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

  -- (c) TRENDING CITIES under the narrowed shape that died on 2026-08-27 (bedrooms AND budget —
  -- either alone stayed fast). Timed from this role, where the healthy plan is ~180 ms; the
  -- user-role truth is proven by the live check named in the header, not from in here.
  t0 := clock_timestamp();
  perform 1 from public.top_cities_by_deal_ar(
    p_deal := 'بيع', p_category := 'Residential',
    p_types := array['فيلا','تاون هاوس','بيت'], p_beds_min := 4, p_price_max := 3000000);
  v_trend_ms := extract(epoch from clock_timestamp() - t0) * 1000;

  -- (d) the fix is ONE WORD and a regeneration of the function would silently drop it.
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

  if coalesce(v_mat, false) = false or coalesce(v_trend_ms, 0) > 2000 then
    n := n + public.mon_raise(
      case when coalesce(v_mat, false) = false then 'P1' else 'P2' end,
      'search_performance_regression', 'all',
      'trending_cities_unusable_when_narrowed:' || current_date,
      jsonb_build_object(
        'total_cte_materialized', v_mat,
        'trending_ms_this_role', round(coalesce(v_trend_ms, -1)), 'baseline_ms', 180,
        'probe', 'top_cities_by_deal_ar: Buy · فيلا/تاون هاوس/بيت · beds>=4 · price<=3M',
        'why', 'Trending Cities is the location breakdown of the user''s eligible set. On 2026-08-27 '
            || 'this exact call took 20,205 ms and died with 57014 over the anon path. locations.ts '
            || 'refuses every widening fallback while the user is narrowed (correctly — a widened '
            || 'count under an active filter is a false count), so the city field rendered NOTHING '
            || 'and the user could not pick a city from Trending at all.',
        'first_check', 'EXPLAIN ANALYZE it AS ROLE anon, from a psql session — NOT from inside a '
                    || 'security-definer function, which cannot SET ROLE. As postgres the cohort CTE '
                    || 'estimated 25 rows and the total aggregate ran once (179 ms); as anon it '
                    || 'estimated 1 row and ran once PER OUTPUT ROW — 16,708 loops, 39,221 ms. A '
                    || 'sound plan carries a "CTE total" node; an unsound one has none.',
        'live_half', 'scripts/verify-trending-usable-under-narrowing.ts proves the anon-path latency '
                  || 'AND advertised-count == click-through every 6h in count-rpc-parity-live-check.yml.',
        'rule', 'Fix by making the aggregate materialise (total AS MATERIALIZED), never by dropping '
             || 'a predicate, capping the city list, or widening the fallback gate.'));
  end if;

  update public.ops_detector_last_full_run set last_result = n
   where detector = 'search_performance_regression';
  perform public.mon_resolve_stale_keys('search_performance_regression',
    (case when v_broad > 2000 or v_typical > 500
          then array['search_performance_regression:'||current_date::text] else '{}'::text[] end)
    || (case when coalesce(v_mat, false) = false or coalesce(v_trend_ms, 0) > 2000
             then array['trending_cities_unusable_when_narrowed:'||current_date::text] else '{}'::text[] end));
  return n;
end
$fn$;
