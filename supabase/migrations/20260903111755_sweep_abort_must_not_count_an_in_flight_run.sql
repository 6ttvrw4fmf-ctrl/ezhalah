-- A SWEEP THAT IS STILL RUNNING IS NOT A SWEEP THAT WAS KILLED
-- (routine #7, systems seam, 2026-09-03).
--
-- THE DEFECT. mon_detect_detector_sweep_budget() LIMB 1 counted an abort with:
--
--     where jobid = v_jobid
--       and status is distinct from 'succeeded'
--       and start_time > now() - interval '24 hours'
--
-- pg_cron writes the cron.job_run_details row when a job STARTS, with end_time NULL and status
-- 'starting'/'running'. `status is distinct from 'succeeded'` matches that row, so ANY evaluation
-- that races a live sweep counts the in-flight run as a KILL.
--
-- CAUGHT LIVE, with its fingerprints on it: alert 1308 (P1, dedup key detector_sweep_aborted,
-- created 2026-09-03 10:57:12). Payload:
--     observed_abort_seconds : [null]                          <- no end_time to subtract
--     last_abort_at          : 2026-09-03T10:59:00.015746      <- the 10:59 sweep's own START
--     aborted_runs_24h       : 1
-- Meanwhile every scheduled sweep that day SUCCEEDED (jobid 38: 161.9 s at 10:59, 284.4 s at
-- 10:29, 171.1 s at 09:59, 181.5 s at 09:29 ...), and a direct query for non-succeeded jobid-38
-- runs in the window returns zero rows. Nothing was aborted. The alert self-resolved at
-- 10:59:00.015939 once that run completed, which is why it had never been noticed: it is a race,
-- not a steady state, and it was never even dispatched.
--
-- WHY A SHORT-LIVED FALSE POSITIVE STILL MATTERS. mon_raise() returns 0 for a dedup key already
-- open at the same severity. While detector_sweep_aborted stands open on an in-flight run, a
-- GENUINE sweep abort raises nothing, dispatches nothing and pages nobody -- and a real abort is a
-- half-hour in which nothing is monitored and nothing is dispatched, leaving no trace outside
-- cron.job_run_details. Same wound as the day-scoped stuck_open_alert false positive
-- (20260901073449) and the bimodal run_duration_explosion one (20260902063604): a spuriously-true
-- barrier is a disabled barrier.
--
-- THE FIX DISCRIMINATES; IT DOES NOT NARROW, AND IT WIDENS NOTHING. The 24h window, the P1
-- severity, the dedup key and the resolve path are all untouched. A genuinely killed run always
-- lands with end_time set, so requiring end_time loses no real abort. The single case that
-- requirement WOULD lose -- a run wedged in 'running' forever because its backend died -- is added
-- back explicitly as "still running past the sweep's own declared statement_timeout", a case LIMB 1
-- could not detect at all before. So detection strictly improves in both directions.
--
-- DERIVED FROM THE LIVE BODY, NEVER PASTED (hard safety rail): concurrent sessions edit this
-- function -- LIMB 4 was rewritten by 20260901104521 only two days ago -- and a full-body
-- CREATE OR REPLACE from a stale copy silently drops whatever another session landed in the
-- meantime. The anchor is asserted to occur EXACTLY ONCE before any rewrite, and the whole
-- migration is idempotent.
do $mig$
declare
  v_def    text;
  v_new    text;
  v_hits   int;
  v_needle constant text := $needle$    from cron.job_run_details
   where jobid = v_jobid
     and status is distinct from 'succeeded'
     and start_time > now() - interval '24 hours';$needle$;
  v_repl   constant text := $repl$    from cron.job_run_details
   where jobid = v_jobid
     and status is distinct from 'succeeded'
     and start_time > now() - interval '24 hours'
     -- IN-FLIGHT IS NOT ABORTED (2026-09-03, alert 1308). pg_cron writes this row at START with
     -- end_time NULL and status 'starting'/'running', so the predicate above matched a sweep that
     -- was merely still going. A killed run always lands with end_time set, so requiring it loses
     -- no real abort; the one case it would lose -- a run wedged 'running' after its backend died
     -- -- is the second branch, which LIMB 1 could not see at all before.
     and (end_time is not null
          or start_time < now() - make_interval(secs => coalesce(v_budget_s, 900)::double precision));$repl$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_detector_sweep_budget';

  if v_def is null then
    raise exception 'mon_detect_detector_sweep_budget() not found -- refusing to invent one';
  end if;

  if position('IN-FLIGHT IS NOT ABORTED' in v_def) > 0 then
    raise notice 'LIMB 1 already discriminates in-flight runs -- nothing to do';
    return;
  end if;

  v_hits := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);
  if v_hits <> 1 then
    raise exception 'LIMB 1 anchor found % times, expected exactly 1 -- the live body moved; re-derive the edit', v_hits;
  end if;

  v_new := replace(v_def, v_needle, v_repl);
  execute v_new;
  raise notice 'LIMB 1: in-flight runs no longer counted as aborts';
end
$mig$;

-- PROOF, against the LIVE function as it now stands. A migration that silently no-ops is how a
-- barrier ends up decoration.
do $proof$
declare v_def text; v_raised int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_detector_sweep_budget';

  if position('end_time is not null' in v_def) = 0 then
    raise exception 'LIMB 1 does not require a finished run -- the edit did not take';
  end if;
  if position('make_interval' in v_def) = 0 then
    raise exception 'LIMB 1 lost the stuck-running branch -- detection would be narrower, not sharper';
  end if;
  -- The limbs this change must not have disturbed.
  if position('detector_sweep_vs_p0_slo' in v_def) = 0 then
    raise exception 'LIMB 4 (P0 SLO) went missing -- a concurrent body was clobbered';
  end if;
  if position('''p0_slo_s'', 300' in v_def) = 0 then
    raise exception 'the 300s P0 SLO was altered -- never widen the SLO to quiet a limb';
  end if;

  -- It must still RUN, and on today's production state (every sweep succeeded) it must not raise
  -- the aborted key.
  v_raised := public.mon_detect_detector_sweep_budget();
  if exists (select 1 from public.alert_event
              where dedup_key = 'detector_sweep_aborted' and resolved_at is null) then
    raise exception 'detector_sweep_aborted is open while no jobid-38 run has actually failed';
  end if;
  raise notice 'LIMB 1 verified against production; detector returned %', v_raised;
end
$proof$;

comment on function public.mon_detect_detector_sweep_budget() is
  'Four limbs over the twice-hourly detector sweep (cron jobid 38): killed runs, unknown budget, '
  'runtime vs statement_timeout, and LIMB 4 runtime vs the 300s P0 delivery SLO. LIMB 1 counts a '
  'run as aborted only once it has FINISHED unsuccessfully, or is still running past the sweep''s '
  'own statement_timeout -- an in-flight run is not a killed one (alert 1308, 2026-09-03, where a '
  'race against the live 10:59 sweep raised a P1 with observed_abort_seconds [null]). Since '
  '20260831192229 P0 DETECTION runs on the fast lane (jobid 86), so LIMB 4 raises only when a P0 '
  'could still be born inside the sweep transaction. Fails SAFE on an unreadable contract. Never '
  'widen the 300s SLO or the 40s overhead to quiet it.';
