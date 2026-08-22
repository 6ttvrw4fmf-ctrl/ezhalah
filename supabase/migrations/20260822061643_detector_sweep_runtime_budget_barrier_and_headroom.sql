-- Companion to 'cron_health_cannot_see_the_job_it_runs_inside' (senior run #35, 2026-08-22).
--
-- That migration made the sweep's failures VISIBLE. This one addresses why it was failing, and adds
-- the barrier that sees the failure coming instead of reporting it after the fact.
--
-- THE MEASUREMENT. Average successful runtime of jobid 38 (mon-detectors-and-dispatch), by day:
--   08-12  23s | 08-13  24s | 08-14  26s | 08-15  26s | 08-16  27s | 08-17  29s
--   08-18  39s | 08-19  49s | 08-20 102s | 08-21 146s | 08-22 180s   (max observed 274s)
-- against a hard `set statement_timeout to '300s'` in the job's own command. The sweep did not break;
-- it GREW into its ceiling — 88 detectors over an inventory that keeps growing, each one a few
-- seconds (measured today: af_tri_state_violations 12.6s, legacy_branch_region_scope 4.9s). Nothing
-- was pathological; the total simply crossed the line, first intermittently (6 failures 08-20..22)
-- and, on this trend, soon permanently.
--
-- WHY A TIMEOUT IS SO EXPENSIVE HERE. pg_cron runs the whole command in ONE transaction. The
-- per-detector exception handler inside mon_run_all_detectors() cannot save it either: once
-- statement_timeout fires, every subsequent statement in the same top-level statement is cancelled
-- too. So a timeout does not lose one detector — it rolls back every alert the sweep already raised
-- and skips mon_dispatch_alerts() entirely. Confirmed in the data: the 05:29 and 05:59 failed
-- runs today left ZERO alert_event rows, while the 03:29 and 04:29 successes left several.
--
-- FIX 1 — HEADROOM: 300s -> 900s, applied as a needle-edit of the live command so the three
-- statements after it cannot be lost. The job runs every 30 min (1800s), so a 900s ceiling still
-- leaves 2x spacing and cannot overlap the next run. This is operational configuration, fully
-- reversible, and changes no detection semantics whatsoever.
--
-- FIX 2 — THE BARRIER: raising a ceiling without watching the distance to it just moves the same
-- silent failure further out. mon_detect_detector_sweep_budget() reads the ceiling out of the job's
-- OWN command (so the two can never drift apart) and reports when the sweep's slowest successful run
-- in 24h passes 60% of it — i.e. while there is still time to act, not after the blindness.

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
  n int := 0;
begin
  select jobid, command into v_jobid, v_cmd
    from cron.job where jobname = 'mon-detectors-and-dispatch';

  -- The job being absent or disabled is mon_watchdog_detector_job()'s alert, not ours; do not
  -- double-report it.
  if v_jobid is null then
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_budget');
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_budget_unknown');
    return 0;
  end if;

  v_budget_s := nullif(substring(v_cmd from 'statement_timeout\s+to\s+''(\d+)s'''), '')::numeric;

  -- A ceiling we cannot read is a ceiling we cannot warn about. Say so rather than passing quietly.
  if v_budget_s is null or v_budget_s <= 0 then
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_budget');
    return public.mon_raise('P2','detector_sweep_budget','monitoring','detector_sweep_budget_unknown',
      jsonb_build_object(
        'jobid', v_jobid,
        'why','the detector sweep''s statement_timeout could not be parsed out of its own cron '
           ||'command, so nothing can tell how close the sweep is to the ceiling that silently '
           ||'aborts it. A timeout rolls the ENTIRE sweep back — every alert raised in that run, '
           ||'plus mon_dispatch_alerts.',
        'command', v_cmd));
  end if;
  perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_budget_unknown');

  select count(*), max(extract(epoch from end_time - start_time))
    into v_runs, v_max_s
    from cron.job_run_details
   where jobid = v_jobid
     and status = 'succeeded'
     and start_time > now() - interval '24 hours';

  if v_runs = 0 or v_max_s is null then
    -- No successful run at all in 24h is far past a budget warning; the watchdog owns that case.
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_budget');
    return 0;
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

-- FIX 1: headroom, as a needle-edit of the LIVE command. Never rewrite that command wholesale — the
-- three statements after the timeout are the entire monitoring sweep.
do $$
declare
  v_cmd text; v_new text; v_jobid bigint;
begin
  select jobid, command into v_jobid, v_cmd
    from cron.job where jobname = 'mon-detectors-and-dispatch';
  if v_cmd is null then raise exception 'mon-detectors-and-dispatch is missing'; end if;

  if position('''300s''' in v_cmd) = 0 then
    raise notice 'sweep timeout is not 300s — leaving the command alone (current: %)', v_cmd;
  else
    v_new := replace(v_cmd, '''300s''', '''900s''');
    if v_new !~ 'mon_run_all_detectors' or v_new !~ 'mon_dispatch_alerts'
       or v_new !~ 'mon_reconcile_dangling_scrape_runs' then
      raise exception 'refusing to write a sweep command that lost a statement';
    end if;
    perform cron.alter_job(job_id := v_jobid, command := v_new);
  end if;
end $$;

-- FIX 2b: wire the detector into the roster with the guarded needle-edit — read the LIVE body and
-- splice one name in, so it cannot drop entries it never read (the class that has bitten this
-- function seven times).
do $$
declare
  v_def text; v_before text;
  fn constant text := 'mon_detect_detector_sweep_budget';
  anchor constant text := '    ''mon_detect_cron_ordering_contract''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;

  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;

  if position('''' || fn || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
  end if;

  if v_def = v_before then
    raise notice 'detector already rostered — nothing to do';
    return;
  end if;
  execute v_def;
end $$;

-- Prove all three parts in the same transaction that made them, including that the threshold
-- arithmetic actually fires: the detector is silent today only BECAUSE the ceiling was raised, and a
-- barrier that has never been shown to fire is decoration.
do $$
declare
  v_def text; v_cmd text; v_budget numeric; v_max numeric; v_ctrl text;
begin
  -- (a) the sweep command kept every statement and now carries the wider ceiling
  select command into v_cmd from cron.job where jobname = 'mon-detectors-and-dispatch';
  if v_cmd !~ '900s' then raise exception 'sweep timeout was not widened'; end if;
  foreach v_ctrl in array array['mon_reconcile_dangling_scrape_runs','mon_run_all_detectors','mon_dispatch_alerts'] loop
    if position(v_ctrl in v_cmd) = 0 then
      raise exception 'sweep command lost statement %', v_ctrl;
    end if;
  end loop;

  -- (b) the detector is reachable from the roster, and the roster still holds its controls
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  foreach v_ctrl in array array['mon_detect_detector_sweep_budget','mon_detect_cron_health',
                                'mon_detect_orphaned_detectors','mon_detect_unresolvable_alert_kinds',
                                'mon_detect_silent_scraper_death','mon_detect_cron_ordering_contract'] loop
    if position('''' || v_ctrl || '''' in v_def) = 0 then
      raise exception 'roster is missing % after the needle-edit', v_ctrl;
    end if;
  end loop;

  -- (c) the budget is read from the job's own command, not hardcoded
  v_budget := substring(v_cmd from 'statement_timeout\s+to\s+''(\d+)s''')::numeric;
  if v_budget <> 900 then raise exception 'budget parse returned % (expected 900)', v_budget; end if;

  -- (d) MUTATION PROOF of the predicate against real data: the slowest successful sweep in the last
  --     24h, measured against the ceiling that was in force until this migration (300s), must exceed
  --     the 60% threshold. If this ever stops holding, the arithmetic has been broken.
  select max(extract(epoch from end_time - start_time)) into v_max
    from cron.job_run_details
   where jobid = (select jobid from cron.job where jobname='mon-detectors-and-dispatch')
     and status = 'succeeded' and start_time > now() - interval '24 hours';
  if v_max is null then raise exception 'no successful sweep in 24h to measure'; end if;
  if not (v_max > 0.6 * 300) then
    raise exception 'threshold arithmetic did not reproduce the incident: slowest run %s is not '
                    'above 60%% of the old 300s ceiling', round(v_max);
  end if;

  -- (e) the kind can be cleared, or mon_detect_unresolvable_alert_kinds will rightly call it a ratchet
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_detector_sweep_budget';
  if v_def !~ 'mon_resolve_key\s*\(\s*''detector_sweep_budget''' then
    raise exception 'detector_sweep_budget has no resolve path';
  end if;
end $$;
