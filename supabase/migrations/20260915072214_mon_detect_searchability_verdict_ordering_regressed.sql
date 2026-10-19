-- Data Integrity (routine #3), 2026-09-15. The PERMANENT half of the fix in 20260915071951.
--
-- That migration proved, by execution, that the OK_NO_SOURCE_ESTABLISHED_PERIOD waiver no longer
-- swallows NEW_ROWS_STUCK_BEFORE_SEARCH and PRODUCTION_READY_FELL. But a proof inside a migration
-- runs ONCE, at apply time. Nothing re-runs it, so the next `create or replace view` that inlines a
-- CASE again — or any edit that restores the old branch order — would reinstate the defect silently,
-- and the surface it breaks is a detector that reads as a clean bill of health when it cannot fire.
--
-- This detector EXECUTES the live predicate against the two synthetic cases the defect was made of,
-- on every sweep. It reads no listing data and is therefore cheap and ungated.
--
-- It is deliberately a check on BOTH directions: the two verdicts must fire when they should, AND
-- the waiver must still waive when it should. A regression in either direction is a P1, because
-- either the barrier has gone blind or an honest unknown period has started raising false alarms
-- against the owner rule of 2026-09-03/09-05.

create or replace function public.mon_detect_searchability_verdict_ordering()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  failures jsonb := '[]'::jsonb;
  v text;
begin
  -- Direction 1: the platform-health verdicts must be REACHABLE for a period-silent platform.
  v := public.mon_searchability_verdict(NULL, false, 13, NULL, 60, 60, 0, 30);
  if v is distinct from 'PRODUCTION_READY_FELL' then
    failures := failures || jsonb_build_object(
      'case', 'period_silent_production_ready_collapsed',
      'expected', 'PRODUCTION_READY_FELL', 'got', v);
  end if;

  v := public.mon_searchability_verdict(NULL, false, 13, NULL, 60, 20, 0, 0);
  if v is distinct from 'NEW_ROWS_STUCK_BEFORE_SEARCH' then
    failures := failures || jsonb_build_object(
      'case', 'period_silent_new_rows_stuck',
      'expected', 'NEW_ROWS_STUCK_BEFORE_SEARCH', 'got', v);
  end if;

  -- Direction 2: an honest unknown period must still be silent when the platform is healthy.
  v := public.mon_searchability_verdict(NULL, false, 13, NULL, 51, 55, 0, 0);
  if v is distinct from 'OK_NO_SOURCE_ESTABLISHED_PERIOD' then
    failures := failures || jsonb_build_object(
      'case', 'period_silent_but_healthy',
      'expected', 'OK_NO_SOURCE_ESTABLISHED_PERIOD', 'got', v);
  end if;

  -- Direction 2b: the period verdicts still outrank, and a waived platform is still exempt.
  v := public.mon_searchability_verdict(20, false, 13, 100, 60, 60, 12, 0);
  if v is distinct from 'SEARCHABILITY_COLLAPSE' then
    failures := failures || jsonb_build_object(
      'case', 'period_collapse_still_outranks', 'expected', 'SEARCHABILITY_COLLAPSE', 'got', v);
  end if;

  v := public.mon_searchability_verdict(20, true, 13, 100, 10, 10, 2, 0);
  if v is distinct from 'OK' then
    failures := failures || jsonb_build_object(
      'case', 'evidence_backed_waiver_still_exempt', 'expected', 'OK', 'got', v);
  end if;

  -- The view must keep DELEGATING to the predicate. If someone re-inlines a CASE, the function can
  -- stay perfect while the view ignores it — the proof would pass over code nothing uses.
  if position('mon_searchability_verdict' in
              pg_get_viewdef('public.mon_searchability_alerts'::regclass, true)) = 0 then
    failures := failures || jsonb_build_object(
      'case', 'view_no_longer_calls_the_shared_predicate',
      'expected', 'mon_searchability_alerts calls mon_searchability_verdict()',
      'got', 'the view inlines its own verdict logic again');
  end if;

  if jsonb_array_length(failures) = 0 then
    perform public.mon_resolve_key('searchability_verdict_ordering', 'searchability_verdict_ordering');
    return 0;
  end if;

  return public.mon_raise('P1', 'searchability_verdict_ordering', 'all',
    'searchability_verdict_ordering',
    jsonb_build_object(
      'failures', failures,
      'why', 'The searchability verdict predicate no longer behaves as proven on 2026-09-15. Until '
             'then, OK_NO_SOURCE_ESTABLISHED_PERIOD was the FIRST branch of the CASE, so every '
             'platform whose source publishes no rental period was exempt from '
             'NEW_ROWS_STUCK_BEFORE_SEARCH and PRODUCTION_READY_FELL — two verdicts that have '
             'nothing to do with the period. mon_detect_searchability_collapse treats every '
             'verdict matching OK% as healthy, so those platforms could not raise at all.',
      'adjudicate', 'Do NOT fix this by relaxing mon_detect_searchability_collapse or by widening '
                    'the OK% match. The waiver must stay LAST among the alerting branches: it is '
                    'entitled to silence the period verdicts (an honest unknown period is not a '
                    'searchability failure, owner 2026-09-03/09-05) and nothing else. If the view '
                    'has re-inlined its own CASE, point it back at '
                    'public.mon_searchability_verdict() so there is one predicate again.'));
end
$function$;

comment on function public.mon_detect_searchability_verdict_ordering() is
  'P1. Executes public.mon_searchability_verdict() against the synthetic cases the 2026-09-15 defect '
  'was made of, both directions, plus an assertion that mon_searchability_alerts still delegates to '
  'it. Permanent replacement for the one-shot proofs in migration 20260915071951: a period-silent '
  'platform must remain reachable by NEW_ROWS_STUCK_BEFORE_SEARCH and PRODUCTION_READY_FELL, and a '
  'healthy period-silent platform must remain silent. Reads no listing data; cheap, ungated.';

-- Roster entry in the SAME migration (AGENTS.md): a detector nothing reaches is decoration, and
-- mon_detect_orphaned_detectors fires on it. Guarded needle-edit, never a re-pasted body.
do $do$
declare
  src text; before_n int; after_n int;
  anchor text := '''mon_detect_orphaned_detectors''';
  needle text := ', ''mon_detect_searchability_verdict_ordering''';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found - refusing to wire blindly';
  end if;
  if position('mon_detect_searchability_verdict_ordering' in src) > 0 then
    raise notice 'already wired - no-op'; return;
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor appears % times, expected exactly 1 - refusing to splice',
      (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;

  before_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  src := replace(src, anchor, anchor || needle);
  after_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');

  if after_n <> before_n + 1 then
    raise exception 'roster went from % to % entries, expected exactly +1 - refusing to install',
      before_n, after_n;
  end if;
  if position('mon_detect_searchability_verdict_ordering' in src) = 0
     or position('mon_detect_searchability_collapse' in src) = 0
     or position('mon_detect_rent_period_unreachable' in src) = 0
     or position('mon_detect_orphaned_detectors' in src) = 0
     or position('mon_detect_stalled_daily_detector' in src) = 0 then
    raise exception 'post-splice assertion failed - refusing to install';
  end if;

  execute src;
end
$do$;

-- MUTATION PROOF of the detector itself, both directions, executed now and rolled back.
-- A detector that cannot fail is decoration just as surely as one nothing calls.
do $mut$
declare
  raised int;
  good_def text;
begin
  -- Direction A: on the CORRECT predicate it must be silent.
  raised := public.mon_detect_searchability_verdict_ordering();
  if raised <> 0 then
    raise exception 'MUTATION PROOF A FAILED: detector raised % on the correct predicate', raised;
  end if;

  -- Direction B: reinstate the DEFECT (waiver first) and prove the detector catches it.
  good_def := pg_get_functiondef('public.mon_searchability_verdict(numeric,boolean,bigint,numeric,bigint,numeric,bigint,bigint)'::regprocedure);

  execute $bad$
    create or replace function public.mon_searchability_verdict(
      p_pct_period_searchable numeric, p_period_waived boolean, p_baseline_samples bigint,
      p_baseline_pct numeric, p_held bigint, p_baseline_held numeric,
      p_searchable_by_period bigint, p_blocked_not_production_ready bigint)
    returns text language sql immutable as $bad_fn$
      select case
        when p_pct_period_searchable is null then 'OK_NO_SOURCE_ESTABLISHED_PERIOD'
        when p_held >= 20 and p_blocked_not_production_ready::numeric >= (p_held::numeric * 0.20)
          then 'PRODUCTION_READY_FELL'
        else 'OK' end
    $bad_fn$;
  $bad$;

  raised := public.mon_detect_searchability_verdict_ordering();

  -- Restore the good definition BEFORE asserting, so a failed assertion cannot leave the bad one live.
  execute good_def;

  if raised = 0 then
    raise exception 'MUTATION PROOF B FAILED: detector stayed silent with the waiver-first defect reinstated';
  end if;

  -- Clear the alert the proof itself just raised, and confirm the restored predicate is silent again.
  perform public.mon_resolve_key('searchability_verdict_ordering', 'searchability_verdict_ordering');
  raised := public.mon_detect_searchability_verdict_ordering();
  if raised <> 0 then
    raise exception 'MUTATION PROOF C FAILED: detector still raising % after the good predicate was restored', raised;
  end if;

  raise notice 'detector mutation-proven: silent on correct, fires on the reinstated defect, silent again after restore';
end
$mut$;

select public.mon_detect_searchability_verdict_ordering() as raised_now,
       (position('mon_detect_searchability_verdict_ordering'
                 in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) > 0) as in_roster;