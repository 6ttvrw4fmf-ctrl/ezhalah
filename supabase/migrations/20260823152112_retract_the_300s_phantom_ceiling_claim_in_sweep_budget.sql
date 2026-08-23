-- RETRACTION. Migration 20260823073101 (Data Integrity run #38, earlier the same day) asserted that
-- "SIX of the seven aborts ended at exactly 300.0 s and only one at 900.0 s. Something resolves a
-- 300 s ceiling for most of these statements." That is FALSE, and it was left in a COMMENT ON where
-- a future run would read it and go hunting a phantom.
--
-- THE TRUTH. There is no hidden 300 s ceiling. jobid 38's own command literally contained
-- `set statement_timeout to '300s'` until 2026-08-22 06:16:43 UTC, when migration 20260822061643
-- (detector_sweep_runtime_budget_barrier_and_headroom) needle-edited it to 900 s via
-- cron.alter_job. The six 300 s aborts all happened BEFORE that change; the single 900 s abort
-- happened after. Every layer was checked and all are clean: no per-function proconfig timeout, no
-- role-level statement_timeout, no database-level override, nothing in cron.* settings.
--
-- WHY IT WAS WRONG, which is the part worth keeping. The detector parses the budget out of the LIVE
-- cron.job.command — so it read 900 — while its measurement window is the last 24 h/7 d of run
-- rows, which STRADDLED the 06:16:43 command change. Comparing a new budget against old aborts
-- manufactures a disagreement that never existed. The measurement was the defect, again: this is
-- §24e ("a fix whose premise was never verified is not a fix") reached from the opposite direction
-- — there a timeout was changed that was already correct; here a ceiling was invented that was
-- never there.
--
-- THE FIX. `ceiling_disagrees_with_command` was an INFERENCE from two numbers that are not
-- necessarily comparable, so it is removed rather than patched — the command's change time is not
-- knowable from pg_cron (it keeps no history), so it must not be inferred. What stays is the ground
-- truth: the observed abort durations, printed beside the declared budget, plus explicit guidance
-- to check for a budget change before reading any gap as a hidden ceiling.
--
-- Scoped strictly: limb 1's cohort, severity and resolve path are unchanged, and it is still the
-- limb that made aborted sweeps visible at all — the real defect run #38 fixed, which stands.

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

  if v_jobid is null then
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_budget');
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_budget_unknown');
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_aborted');
    return 0;
  end if;

  v_budget_s := nullif(substring(v_cmd from 'statement_timeout\s+to\s+''(\d+)s'''), '')::numeric;

  -- ── LIMB 1 (P1): a sweep that was actually KILLED. ──────────────────────────────────────────
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
        'last_abort_at', v_last_abort,
        'why','the twice-hourly detector sweep was KILLED mid-run. pg_cron runs the whole command '
           ||'in one transaction, so this is not one slow detector being skipped — it rolls back '
           ||'EVERY alert the sweep already raised and skips mon_dispatch_alerts entirely. Each '
           ||'abort is a half-hour in which nothing is monitored and nothing is dispatched, and it '
           ||'leaves no trace outside cron.job_run_details.',
        'reading_the_numbers',
             'observed_abort_seconds is ground truth; declared_budget_s is only what the cron '
           ||'command says RIGHT NOW. Before reading any gap between them as a hidden ceiling, '
           ||'check whether jobid ''s statement_timeout was CHANGED inside this window — pg_cron '
           ||'keeps no history of the command, so a widening migration makes older aborts '
           ||'incomparable to the current budget. That is exactly what produced a false '
           ||'"300s vs 900s hidden ceiling" reading on 2026-08-23: the command itself said 300s '
           ||'until 2026-08-22 06:16:43 UTC (migration 20260822061643 widened it), and the six '
           ||'300s aborts simply predated the change. There is no hidden ceiling; role, database, '
           ||'proconfig and cron.* settings were all checked and are clean.',
        'action','attribute the runtime per detector and gate or slim the expensive ones.'));
  else
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_aborted');
  end if;

  -- ── LIMB 2 (P2): the ceiling could not be read at all. ──────────────────────────────────────
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

  -- ── LIMB 3 (P2): FORECAST on completed sweeps. ──────────────────────────────────────────────
  select count(*), max(extract(epoch from end_time - start_time))
    into v_runs, v_max_s
    from cron.job_run_details
   where jobid = v_jobid
     and status = 'succeeded'
     and start_time > now() - interval '24 hours';

  if v_runs = 0 or v_max_s is null then
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
           ||'mon_dispatch_alerts entirely.',
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
                                    EVENT, not a forecast. Reports the OBSERVED abort durations.
  detector_sweep_budget_unknown P2  the statement_timeout could not be parsed from the command.
  detector_sweep_budget         P2  FORECAST: slowest SUCCEEDED sweep in 24h exceeds 60% of the
                                    declared budget. Scoped to succeeded runs deliberately — see
                                    limb 1 for aborts; folding them in would report one fact twice.

Why limb 1 exists (added 2026-08-23, Data Integrity run #38): the detector previously measured
ONLY succeeded runs. jobid 38 had aborted 7 times in 7 days while the slowest succeeded run sat at
383.1s = 42.6% of budget, so this function returned 0 and held no open alert through a week
containing seven half-hour blackouts of the entire monitoring layer. A barrier whose cohort
excludes its own failure mode goes quiet exactly when it matters (§23a/§25a).

RETRACTED 2026-08-23 (run #39): the first version of this comment claimed six aborts ended at 300s
"against a declared 900s" and that "something resolves a 300s ceiling". There is NO hidden ceiling.
jobid 38's command itself said `statement_timeout to '300s'` until 2026-08-22 06:16:43 UTC, when
migration 20260822061643 widened it to 900s; the six 300s aborts predate that change. The detector
parses the LIVE command while measuring a window that straddled it, which manufactures a
disagreement out of two numbers that are not comparable. Role, database, proconfig and cron.*
settings were all checked and are clean. The `ceiling_disagrees_with_command` field was removed
rather than patched — the change time is not knowable from pg_cron, so it must not be inferred.

Measured cost: limb 1 is a single indexed range scan over cron.job_run_details, ~5 ms.$c$;
