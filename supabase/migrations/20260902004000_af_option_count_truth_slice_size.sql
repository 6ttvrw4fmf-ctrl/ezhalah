-- SLICE SIZE, set from a measured timeout rather than a guess.
--
-- statement_timeout is 120s. A single large cohort (Apartment/Buy, 38k rows) costs ~10s for its 36
-- option comparisons, and the commercial land cohorts are slower still. At 6 slices (~10 cohorts per
-- run) the detector hit the timeout and raised nothing — a detector that cannot complete is a
-- detector that cannot fire, which reads as a clean bill of health. 20 slices puts ~3 cohorts in each
-- run, ~20-30s, with real headroom.
--
-- Slower full coverage is the right trade here: this detector watches for DRIFT BETWEEN THE COUNT
-- EXPRESSION AND THE PREDICATE, which only changes when someone ships a migration — not with the
-- data. The repo-side barrier catches that same drift at source on every PR; this one is the runtime
-- backstop that proves what is actually DEPLOYED still agrees with itself.
create or replace function mon_detect_af_option_count_truth()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  SLICES constant int := 20;            -- ~3 cohorts per run; full coverage every 20 days
  v_slice int := mod(extract(doy from now())::int, SLICES);
  v_bad jsonb := '[]'::jsonb;
  v_n int := 0; v_cohorts int; r record;
begin
  if not public.mon_claim_daily_slot('af_option_count_truth') then return 0; end if;

  select count(*) into v_cohorts from public.af_cohort_registry where enabled;
  if coalesce(v_cohorts, 0) < 10 then
    raise exception 'refusing to run: af_cohort_registry has only % enabled cohorts', v_cohorts;
  end if;

  for r in
    select * from public.ops_af_option_truth_sweep(
      p_deal := null, p_period := null, p_type := null,
      p_row_limit := 1, p_check_rows := false,
      p_slice := v_slice, p_slices := SLICES)
  loop
    v_n := v_n + 1;
    v_bad := v_bad || jsonb_build_object(
      'cohort', r.cohort, 'option', r.opt,
      'count_shown_on_chip', r.chip, 'count_the_filter_returns', r.applied);
  end loop;

  update public.ops_detector_last_full_run
     set last_result = v_n where detector = 'af_option_count_truth';

  if v_n = 0 then
    perform public.mon_resolve_key('af_option_count_truth','af_option_count_truth_slice_' || v_slice);
    return 0;
  end if;

  return public.mon_raise('P1','af_option_count_truth','all',
    'af_option_count_truth_slice_' || v_slice,
    jsonb_build_object(
      'disagreements', v_n,
      'slice', v_slice, 'of_slices', SLICES, 'cohorts_enabled', v_cohorts,
      'offenders', v_bad,
      'why', 'An Advanced Filter option shows the user one number and its filter returns another. '
          || 'The chip count comes from apartment_guided_counts_ar and the filter from '
          || 'af_eligible_count, both generated from af_eligibility_clause() — so a disagreement means '
          || 'the cnt_* expression and the predicate have drifted apart. The user is told N before '
          || 'they click and given something else after.',
      'adjudicate', 'Compare the cnt_* expression for that option against the matching predicate in '
          || 'af_eligibility_clause(). Check the SCOPE first: the direction defect (2026-09-01) was a '
          || 'cnt_* computed inside a scope that already applied the same parameter, while the UI '
          || 'action UNIONS onto it. Then re-run ops_af_option_truth_sweep with p_check_rows := true '
          || 'for that cohort to see whether the returned rows are wrong too, or only the number.'));
end
$fn$;
