-- THE ADVANCED FILTER BUTTON MUST NOT LIE (owner rule, 2026-09-01).
--
-- «If Advanced Filter says "Gym — 3 listings", then selecting Gym must return exactly those 3, and
-- every one of them must really have a gym according to the certified data.»
--
-- Three surfaces are generated from ONE shared clause into THREE different RPCs — the chip count
-- (apartment_guided_counts_ar), the eligible count (af_eligible_count) and the result set
-- (location_search_candidates_ar). Nothing compared what those three actually DO at runtime, and
-- that gap shipped a real defect: with شمال+غرب committed, the جنوب chip advertised 0 and tapping it
-- returned 804 more listings, because cnt_dir_* was computed inside a scope that already applied
-- p_directions while the tap UNIONS. A count and a predicate can each be individually reasonable and
-- still disagree; only running them side by side finds it.
--
-- This detector runs ops_af_option_truth_sweep over the certified cohort registry and raises on ANY
-- disagreement. It is EXPENSIVE (it drives real RPCs), so it takes the daily slot like the other
-- behavioural detectors, and it runs COUNTS-ONLY: the row-level half (`viol`) is for manual/major
-- certification runs, where a 2,000-row pull per option is affordable.
--
-- SEVERITY P1: a wrong number on the button is a lie told to the user before they click, and a
-- filter that returns something other than what it advertised is the whole product being wrong.
create or replace function mon_detect_af_option_count_truth()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_bad jsonb := '[]'::jsonb;
  v_n int := 0;
  v_cohorts int;
  r record;
begin
  if not public.mon_claim_daily_slot('af_option_count_truth') then return 0; end if;

  -- FAIL CLOSED. An empty registry means this detector is watching nothing, and a detector that
  -- cannot fire reads as a clean bill of health — the exact failure this repo has been burned by.
  select count(*) into v_cohorts from public.af_cohort_registry where enabled;
  if coalesce(v_cohorts, 0) < 10 then
    raise exception 'refusing to run: af_cohort_registry has only % enabled cohorts', v_cohorts;
  end if;

  for r in
    select * from public.ops_af_option_truth_sweep(
      p_deal := null, p_period := null, p_type := null,
      p_row_limit := 1, p_check_rows := false)      -- counts only; see note above
  loop
    v_n := v_n + 1;
    v_bad := v_bad || jsonb_build_object(
      'cohort', r.cohort, 'option', r.opt,
      'count_shown_on_chip', r.chip, 'count_the_filter_returns', r.applied);
  end loop;

  update public.ops_detector_last_full_run
     set last_result = v_n where detector = 'af_option_count_truth';

  if v_n = 0 then
    perform public.mon_resolve_key('af_option_count_truth','af_option_count_truth');
    return 0;
  end if;

  return public.mon_raise('P1','af_option_count_truth','all','af_option_count_truth',
    jsonb_build_object(
      'disagreements', v_n,
      'cohorts_checked', v_cohorts,
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

comment on function mon_detect_af_option_count_truth() is
  'P1: an AF chip count that disagrees with the filter it applies. Counts-only sweep of every certified cohort x option.';

-- Roster row, so mon_detect_stalled_daily_detector can see whether this ever runs. Created in the
-- SAME migration as the detector: a detector nothing reaches is decoration, and a missing roster row
-- is what mon_detect_orphaned_detectors exists to catch.
insert into public.ops_detector_last_full_run (detector, last_run_at, last_result)
values ('af_option_count_truth', now() - interval '2 days', null)
on conflict (detector) do nothing;
