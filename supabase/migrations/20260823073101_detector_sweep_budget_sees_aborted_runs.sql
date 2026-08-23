-- mon_detect_detector_sweep_budget could not see the event it exists to warn about.
--
-- Its runtime query filtered `status = 'succeeded'`, so a sweep KILLED by the ceiling was excluded
-- from the very measurement meant to track distance to that ceiling. Measured on 2026-08-23: over
-- 7 days jobid 38 aborted 7 times with "canceling statement due to statement timeout", while the
-- slowest SUCCEEDED run was 383.1 s = 42.6% of the declared 900 s budget — comfortably under the
-- 0.6 warning threshold. The detector was therefore GREEN, with no open alert, in a week that
-- contained seven half-hour windows of total monitoring blindness (a pg_cron timeout rolls back
-- every alert the sweep raised AND skips mon_dispatch_alerts). This is the §23a/§25a shape from
-- another angle: a barrier that goes quiet exactly as its condition worsens, because the cohort it
-- measures excludes the failure.
--
-- Worse, the denominator is not the ceiling that actually fires. The cron command declares
-- `set statement_timeout to '900s'`, and the detector parses 900 out of that text — but SIX of the
-- seven aborts ended at exactly 300.0 s and only one at 900.0 s. Something resolves a 300 s ceiling
-- for most of these statements. Per §23b ("log a threshold's PROVENANCE, not just its value") this
-- limb does NOT guess which number is authoritative: it reports the OBSERVED abort durations, which
-- are ground truth, beside the declared budget, and flags the discrepancy so the gap is visible
-- rather than smoothed into a percentage. Diagnosing why 900 s resolves to 300 s is separate work
-- and is deliberately not attempted here.
--
-- The fix adds a limb rather than changing the existing one, so the two claims stay distinct:
--   * detector_sweep_budget  (P2, unchanged) — FORECAST: the slowest COMPLETED sweep is nearing the
--     ceiling. It stays green today (42.6%), which is correct and is what proves the new limb
--     detects something the old one structurally cannot.
--   * detector_sweep_aborted (P1, new)       — EVENT: a sweep was actually killed. Not a forecast.
--     P1 because each abort is 30 minutes in which nothing is monitored and nothing is dispatched.
--
-- Raise and resolve share ONE predicate (§25a), evaluated on the same path in the same call — there
-- is no second, independently-worded "self-heal" clause to disagree with it.
--
-- Both directions proven against live data at 2026-08-23 07:30 UTC, same predicate, two windows:
--   24 h → 1 aborted run, 47 succeeded, max succeeded 383.1 s  → limb RED, P2 forecast still green
--   10 h → 0 aborted runs                                       → limb GREEN
-- so the cohort discriminates on time rather than firing unconditionally.
--
-- No new function and no roster edit: this is a limb inside a detector mon_run_all_detectors()
-- already calls, so mon_detect_orphaned_detectors() has nothing new to find.

create or replace function public.mon_detect_detector_sweep_budget()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_jobid    int;
  v_cmd      text;
  v_budget_s numeric;
  v_max_s    numeric;
  v_runs     int;
  v_pct      numeric;
  v_aborts   int;
  v_abort_secs numeric[];
  v_last_abort timestamptz;
  n int := 0;
begin
  select jobid, command into v_jobid, v_cmd
    from cron.job where jobname = 'mon-detectors-and-dispatch';

  -- The job being absent or disabled is mon_watchdog_detector_job()'s alert, not ours; do not
  -- double-report it.
  if v_jobid is null then
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_budget');
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_budget_unknown');
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_aborted');
    return 0;
  end if;

  v_budget_s := nullif(substring(v_cmd from 'statement_timeout\s+to\s+''(\d+)s'''), '')::numeric;

  -- ── LIMB 1 (new, P1): a sweep that was actually KILLED. ──────────────────────────────────────
  -- Deliberately evaluated BEFORE the budget parse can early-return: an abort is observable from
  -- cron.job_run_details alone and must never depend on our ability to read the declared ceiling.
  select count(*),
         array_agg(distinct round(extract(epoch from end_time - start_time)::numeric, 1)),
         max(start_time)
    into v_aborts, v_abort_secs, v_last_abort
    from cron.job_run_details
   where jobid = v_jobid
     and status is distinct from 'succeeded'
     and start_time > now() - interval '24 hours';

  if coalesce(v_aborts, 0) > 0 then
    n := n + public.mon_raise('P1','detector_sweep_budget','monitoring','detector_sweep_aborted',
      jsonb_build_object(
        'jobid', v_jobid,
        'aborted_runs_24h', v_aborts,
        'observed_abort_seconds', v_abort_secs,
        'declared_budget_s', v_budget_s,
        'ceiling_disagrees_with_command',
           v_budget_s is not null and exists (
             select 1 from unnest(v_abort_secs) s where s < v_budget_s * 0.9),
        'last_abort_at', v_last_abort,
        'why','the twice-hourly detector sweep was KILLED mid-run. pg_cron runs the whole command '
           ||'in one transaction, so this is not one slow detector being skipped — it rolls back '
           ||'EVERY alert the sweep already raised and skips mon_dispatch_alerts entirely. Each '
           ||'abort is a half-hour in which nothing is monitored and nothing is dispatched, and it '
           ||'leaves no trace outside cron.job_run_details.',
        'note','observed_abort_seconds is ground truth; declared_budget_s is only what the cron '
           ||'command text says. When ceiling_disagrees_with_command is true the sweep is being '
           ||'cancelled by a shorter ceiling than the command sets (2026-08-23: six aborts at '
           ||'300.0s against a declared 900s), so do NOT reason from the declared number.',
        'action','attribute the runtime per detector and gate or slim the expensive ones. If the '
           ||'ceilings disagree, find which one actually applies BEFORE changing either.'));
  else
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_aborted');
  end if;

  -- ── LIMB 2 (unchanged, P2): the ceiling could not be read at all. ────────────────────────────
  -- A ceiling we cannot read is a ceiling we cannot warn about. Say so rather than passing quietly.
  if v_budget_s is null or v_budget_s <= 0 then
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_budget');
    return n + public.mon_raise('P2','detector_sweep_budget','monitoring','detector_sweep_budget_unknown',
      jsonb_build_object(
        'jobid', v_jobid,
        'why','the detector sweep''s statement_timeout could not be parsed out of its own cron '
           ||'command, so nothing can tell how close the sweep is to the ceiling that silently '
           ||'aborts it. A timeout rolls the ENTIRE sweep back — every alert raised in that run, '
           ||'plus mon_dispatch_alerts.',
        'command', v_cmd));
  end if;
  perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_budget_unknown');

  -- ── LIMB 3 (unchanged, P2): FORECAST on completed sweeps. ────────────────────────────────────
  -- Still scoped to succeeded runs ON PURPOSE: this limb answers "how close is a sweep that
  -- FINISHED to the ceiling", which is a different question from limb 1's "did one get killed".
  -- Folding aborts in here would peg it at 100% whenever limb 1 is red and report one fact twice.
  select count(*), max(extract(epoch from end_time - start_time))
    into v_runs, v_max_s
    from cron.job_run_details
   where jobid = v_jobid
     and status = 'succeeded'
     and start_time > now() - interval '24 hours';

  if v_runs = 0 or v_max_s is null then
    -- No successful run at all in 24h is far past a budget warning; the watchdog owns that case.
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_budget');
    return n;
  end if;

  v_pct := round(100.0 * v_max_s / v_budget_s, 1);

  if v_max_s > 0.6 * v_budget_s then
    n := n + public.mon_raise('P2','detector_sweep_budget','monitoring','detector_sweep_budget',
      jsonb_build_object(
        'jobid', v_jobid,
        'slowest_successful_run_s', round(v_max_s),
        'statement_timeout_s', v_budget_s,
        'pct_of_budget', v_pct,
        'runs_24h', v_runs,
        'why','the twice-hourly detector sweep is approaching the statement_timeout that aborts it. '
           ||'pg_cron runs the whole command in one transaction, so a timeout does not skip one '
           ||'detector — it rolls back every alert the sweep already raised and skips '
           ||'mon_dispatch_alerts entirely. That is a half-hour of total monitoring blindness which '
           ||'leaves no trace outside cron.job_run_details (2026-08-20..22: 6 such runs).',
        'action','attribute the runtime per detector and gate or slim the expensive ones, or widen '
           ||'the ceiling deliberately. Do NOT let it drift up to the ceiling again.'));
  else
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_budget');
  end if;

  return n;
end $function$;

comment on function public.mon_detect_detector_sweep_budget() is
$c$Three limbs over pg_cron job `mon-detectors-and-dispatch` (jobid 38), all resolving on the
evaluated path only:

  detector_sweep_aborted        P1  a sweep was KILLED (status <> succeeded) in the last 24h. The
                                    EVENT, not a forecast. Reports OBSERVED abort durations, never
                                    a percentage of the declared budget — on 2026-08-23 six of
                                    seven aborts ended at 300.0s against a cron command declaring
                                    900s, so the declared number is not the ceiling that fires.
  detector_sweep_budget_unknown P2  the statement_timeout could not be parsed from the command.
  detector_sweep_budget         P2  FORECAST: slowest SUCCEEDED sweep in 24h exceeds 60% of the
                                    declared budget. Scoped to succeeded runs deliberately — see
                                    limb 1 for aborts; folding them in would report one fact twice.

Why limb 1 exists (added 2026-08-23, Data Integrity run #38): the detector previously measured
ONLY succeeded runs. On 2026-08-23 jobid 38 had aborted 7 times in 7 days while the slowest
succeeded run sat at 383.1s = 42.6% of 900s, so this function returned 0 and held no open alert
through a week containing seven half-hour blackouts of the entire monitoring layer. A barrier whose
cohort excludes its own failure mode goes quiet exactly when it matters (§23a/§25a).

Measured cost: limb 1 is a single indexed range scan over cron.job_run_details, ~5 ms. The function
as a whole stays well under the roster's per-detector budget.$c$;
