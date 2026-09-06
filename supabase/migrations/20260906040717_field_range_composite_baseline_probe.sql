-- THE COMPOSITE-BASELINE REGRESSION PROBE 20260821031350 PROMISED — OBSERVED, THEN ROLLED BACK.
--
-- WHAT WAS MISSING. 20260821031350_fix_run_field_range_composite_baseline.sql says in its own
-- header: "Regression coverage (proven red-on-old / green-on-new against synthetic data mirroring
-- the real per-type baselines above, matching alert 466's exact slice_n=321/slice_frac=0.318
-- shape): scripts/verify-run-field-range-composite-baseline-live.ts". That file was never written.
-- It sat in the KNOWN_GAPS ledger of scripts/verify-ops-remediation-scripts-exist.ts as
-- ops_incident #50 — a protection that reads as present and is absent, which is worse than no
-- claim because it tells the next reader to stop looking.
--
-- WHY IT NEEDED A DATABASE FUNCTION AT ALL. mon_check_run_field_ranges() is judged by BEHAVIOUR:
-- reading its source text would pass just as happily on a body whose composite weighting had been
-- re-emitted flat by a CREATE OR REPLACE from a pre-fix snapshot, which is exactly the recurrence
-- shape here. Executing it needs rows in a listings-shaped table (20260821031441 created
-- public.ops_test_field_range_synthetic for precisely this), and the must-trip direction reaches
-- public.mon_raise(). A committed alert_event row would become a GitHub issue within 30 minutes
-- (.github/workflows/alert-dispatch.yml) for a condition that was fabricated by the test, and
-- `run_field_range` has no mon_resolve_key path anywhere, so it would then stay open forever
-- (20260821231752). A barrier that pages a human on its own synthetic data is not a barrier.
--
-- SO THE PROBE OBSERVES INSIDE A SUBTRANSACTION AND THEN DISCARDS IT. Each scenario seeds the
-- fixture, calls the REAL function, reads back the reasons mon_raise() recorded, and then aborts
-- its own block with a private SQLSTATE. PL/pgSQL rolls every write in that block back — the
-- fixture rows and any alert_event row alike — while the local variables keep the values they held
-- when the error was raised, which is what makes an observation possible without leaving one. No
-- other session ever sees the rows: they are never committed. `residue` below re-counts both after
-- the unwind so the barrier can assert the trace is gone rather than trust this comment.
--
-- THE TWO SCENARIOS, and what each one proves.
--   faithful_skew — alert 466's real shape: 321 touched Rent rows composed Chalet/Room/Rest
--     House-heavy, every type null at ITS OWN measured table-wide rate (Apartment 4.28%, Chalet
--     ~91%, Room 25%, Rest House ~17% — the 2026-08-21 aqar_residential figures). Nothing has
--     regressed; only the COMPOSITION differs from the table average. slice_frac lands ~0.34
--     against a flat table-wide baseline of ~0.069, so the pre-fix predicate (slice >= flat + 0.25)
--     trips and the composite predicate must not. This is the false positive the fix removed.
--   genuine_regression — 300 touched Apartment rows with EVERY price_annual null, against an
--     Apartment baseline of ~11.8%. A real parse regression must still trip, or the fix would have
--     bought quiet by going blind. The reasons array proves it tripped as
--     rent_price_null_regression and not as some unrelated check.
--
-- ANON-EXECUTABLE, deliberately, like ops_detector_sweep_health() and
-- ops_searchable_platforms_unmonitored(). The barrier's home workflow runs with no secrets, and
-- scripts/verify-live-checks-self-sufficient.ts exists because two live barriers never ran once
-- for want of a repo secret nobody was watching. A caller can persist nothing through this
-- function and read nothing but the verdict: every write it makes is discarded before it returns.
--
-- Barrier: scripts/verify-run-field-range-composite-baseline-live.ts (out of the hermetic
-- `npm test` because it calls production; runs on .github/workflows/p0-fast-lane-coverage.yml,
-- whose schedule + push-on-migrations triggers are load-bearing for the same reason as that
-- workflow's own check — this invariant breaks when a migration is APPLIED, not when a PR opens).
create or replace function public.ops_probe_field_range_composite()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- The touched slice is "last_seen_at >= p_since", exactly as end_run() calls it.
  c_since       constant timestamptz := now() - interval '1 hour';
  -- Placeholder-location tokens, as end_run() passes them. The seeded city/region match none, so
  -- check (d) stays silent and the only check that can fire here is the null-price regression.
  c_tokens      constant text[] := array['unknown', 'n/a'];
  c_dedup       constant text   := 'run_field_range:ops_test_field_range_synthetic';
  -- property_type -> (base_n, base_null_n, touched_n, touched_null_n). Touched rows are a SUBSET
  -- of the base population, so touched_null_n <= base_null_n and the untouched remainder carries
  -- the rest of that type's nulls: seeding a type's own baseline and its touched share in one pass.
  c_seeds       constant jsonb := jsonb_build_object(
    'faithful_skew', jsonb_build_array(
      jsonb_build_array('Apartment',  4000, 171, 131,   6),
      jsonb_build_array('Chalet',      100,  91,  90,  81),
      jsonb_build_array('Room',         80,  20,  60,  15),
      jsonb_build_array('Rest House',   60,  10,  40,   7)),
    'genuine_regression', jsonb_build_array(
      jsonb_build_array('Apartment',  4000, 471, 300, 300),
      jsonb_build_array('Chalet',      100,  91,   0,   0),
      jsonb_build_array('Room',         80,  20,   0,   0),
      jsonb_build_array('Rest House',   60,  10,   0,   0)));
  v_result      jsonb := '{}'::jsonb;
  v_scenario    text;
  v_tripped     boolean;
  v_slice_n     bigint;
  v_slice_null  bigint;
  v_base_n      bigint;
  v_base_null   bigint;
  v_checks      jsonb;
  v_rows_after  bigint;
  v_alerts_after bigint;
begin
  for v_scenario in select k from jsonb_object_keys(c_seeds) k order by k loop
    begin
      delete from public.ops_test_field_range_synthetic;

      insert into public.ops_test_field_range_synthetic
        (ad_number, listing_url, property_type, transaction_type,
         price_total, price_annual, city, region, active, last_seen_at)
      select
        format('probe-%s-%s', s.ptype, g.i),
        format('https://probe.invalid/%s/%s', s.ptype, g.i),
        s.ptype,
        'Rent',
        null,
        -- The type's own nulls come first, so the touched slice can draw from both pools.
        case when g.i <= s.base_null then null else 45000 end,
        'Probe City',
        'Probe Region',
        true,
        case when g.i <= s.touched_null
                  or (g.i > s.base_null and g.i <= s.base_null + (s.touched_n - s.touched_null))
             then now() else now() - interval '30 days' end
      from (
        select e->>0            as ptype,
               (e->>1)::int     as base_n,
               (e->>2)::int     as base_null,
               (e->>3)::int     as touched_n,
               (e->>4)::int     as touched_null
        from jsonb_array_elements(c_seeds -> v_scenario) e
      ) s, lateral generate_series(1, s.base_n) g(i);

      select count(*) filter (where last_seen_at >= c_since),
             count(*) filter (where last_seen_at >= c_since and price_annual is null),
             count(*),
             count(*) filter (where price_annual is null)
        into v_slice_n, v_slice_null, v_base_n, v_base_null
        from public.ops_test_field_range_synthetic;

      -- THE REAL FUNCTION, on the real call shape end_run() uses.
      v_tripped := public.mon_check_run_field_ranges(
        -1, 'barrier-probe', 'ops_test_field_range_synthetic', c_since, c_tokens);

      -- Which check fired, straight out of what mon_raise() wrote. An empty array means it stayed
      -- quiet, and that is a different fact from "it tripped for a reason we did not look at".
      select coalesce(jsonb_agg(r->>'check' order by r->>'check'), '[]'::jsonb)
        into v_checks
        from public.alert_event a,
             lateral jsonb_array_elements(a.detail -> 'reasons') r
       where a.dedup_key = c_dedup;

      -- Deliberate abort: unwinds every write above. Not an error path — the only exit.
      raise exception using errcode = 'ZZ001', message = 'probe rollback (expected)';
    exception
      when sqlstate 'ZZ001' then null;
    end;

    v_result := v_result || jsonb_build_object(v_scenario, jsonb_build_object(
      'tripped',            v_tripped,
      'slice_n',            v_slice_n,
      'slice_null',         v_slice_null,
      'slice_frac',         round(v_slice_null::numeric / nullif(v_slice_n, 0), 6),
      'flat_baseline_frac', round(v_base_null::numeric / nullif(v_base_n, 0), 6),
      'checks',             v_checks));
  end loop;

  -- Measured AFTER the unwind: the probe asserts its own cleanliness instead of promising it.
  select count(*) into v_rows_after from public.ops_test_field_range_synthetic;
  select count(*) into v_alerts_after from public.alert_event where dedup_key = c_dedup;

  return v_result || jsonb_build_object('residue', jsonb_build_object(
    'fixture_rows', v_rows_after, 'probe_alerts', v_alerts_after));
end $function$;

comment on function public.ops_probe_field_range_composite() is
  'Regression probe for mon_check_run_field_ranges()''s composite per-property_type null-price '
  'baseline (20260821031350). Seeds public.ops_test_field_range_synthetic, calls the REAL function '
  'on two scenarios — alert 466''s faithful type skew, which must NOT trip, and a genuine '
  'all-null parse regression, which must — and rolls every write back, so no fixture row and no '
  'fabricated alert_event is ever committed. Read by '
  'scripts/verify-run-field-range-composite-baseline-live.ts.';

revoke all on function public.ops_probe_field_range_composite() from public;
grant execute on function public.ops_probe_field_range_composite() to anon, authenticated, service_role;
