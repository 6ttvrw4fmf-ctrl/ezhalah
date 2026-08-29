-- THE SWEEP NOW GATES P0 DELIVERY, AND THE ONLY DETECTOR WATCHING IT MEASURES THE WRONG BUDGET.
--
-- WHAT BROKE, AND BETWEEN WHICH TWO SYSTEMS. Migration 20260828231336 chained
-- mon_dispatch_p0_fast() onto the END of the mon-detectors-and-dispatch cron command, to buy the
-- owner's 5-minute P0 SLO without spending a minute-slot. That reasoning is sound and is NOT
-- reverted here -- it was re-verified today: 51 of 56 P0s ever raised landed on an exact cron
-- boundary, and the :20/:50 P0s that look off-slot are simply from before 2026-08-10, when the
-- sweep itself ran at :20/:50. All five P0-raising detectors are still roster-only.
--
-- What that migration created, and nothing was updated to watch, is a COUPLING:
-- alert_event.created_at defaults to now(), which in Postgres is TRANSACTION START. So a P0's
-- 5-minute clock starts when the SWEEP starts, and the sweep's entire runtime is spent before
-- dispatch even begins. Sweep duration became the dominant term in P0 delivery latency on
-- 2026-08-28, and no detector's threshold moved.
--
-- MEASURED, NOT ASSUMED (2026-08-29):
--   * 04:29 sweep ran 185.3s; alerts 1097/1098 were born at its transaction start and their
--     GitHub issues were filed at 204.0s -- so filing overhead past the sweep is only ~19s, and
--     the sweep is essentially the whole delivery time.
--   * Slowest successful sweep in 24h: 332.1s. 332.1 + 19 = 351s = 5.9 min -- a breach of the
--     300s SLO, guaranteed, for any P0 born in that sweep.
--   * 5 of 48 sweeps in the last 24h exceeded 282s and would have breached.
--   * LIMB 3 flagged NONE of them: it measures the sweep against statement_timeout (900s) and
--     reads 332.1/900 = 36.9%, a comfortable green, all the way up to its 540s trigger.
--   * mon_detect_p0_delivery_sla() cannot catch it either: it only counts a breach while
--     dispatched_at is still null, and it evaluates INSIDE mon_run_all_detectors() -- i.e. one
--     full sweep (30 min) after the P0 was born, by which time the fast lane or the :24
--     alert-dispatch backstop has already stamped dispatched_at. The breach is real, and
--     invisible to both detectors.
--
-- FIX 1 -- LIMB 4. Measure the sweep against the budget it now actually gates (300s), not just
-- against the timeout that kills it (900s). This does NOT widen c_sla_minutes and does not touch
-- any existing threshold: it adds the missing forecast so the sweep cannot silently grow from
-- 332s to 540s while guaranteeing SLO breach the whole way. If it raises, the answer is a faster
-- sweep or an owner-granted minute slot -- never a larger number.
--
-- FIX 2 -- FRONT-LOAD THE FAST LANE. pg_cron runs the whole command in ONE transaction, so when
-- mon_run_all_detectors() hits statement_timeout the rollback takes mon_dispatch_p0_fast() with
-- it and NO P0 is dispatched at all. Observed 2026-08-26: the 17:29 AND 17:59 sweeps both aborted
-- on _dlr_cohort -- a full hour with zero dispatch capability -- and P0 1011 waited 2h47m for the
-- GitHub Actions backstop. Calling the fast lane FIRST as well as last means a P0 stranded by an
-- aborted sweep is dispatched within a second of the next tick, and survives even if that tick
-- aborts too. Adds zero minute-slots, changes no schedule, and the function is idempotent with a
-- cheap exit and its own 3-minute re-trigger guard.

-- ── FIX 1: needle-edit LIMB 4 into the LIVE function ────────────────────────────────────────────
do $patch$
declare
  v_def    text;
  v_anchor text := $anch$
  return n;
end $function$
$anch$;
  v_new text := $lit$
  -- ── LIMB 4 (P1): the sweep gates P0 DELIVERY, not just its own timeout. ─────────────────────
  -- Since 20260828231336 mon_dispatch_p0_fast() is chained onto the END of this sweep's cron
  -- command, and alert_event.created_at defaults to now() = TRANSACTION START. A P0's 5-minute
  -- clock therefore starts when the sweep STARTS, and the sweep's own runtime is spent before
  -- dispatch begins. LIMB 3 above measures this same runtime against statement_timeout (900s)
  -- and reads a comfortable 37% while the sweep is already eating >100% of the 300s delivery
  -- budget -- which is why this limb exists and why it must not be merged into LIMB 3.
  -- Measured 2026-08-29: 185.3s sweep -> issue filed at 204.0s (~19s overhead); slowest sweep
  -- 332.1s => 351s forecast, a breach; 5 of 48 sweeps in 24h would have breached, LIMB 3 caught 0.
  if v_max_s + 40 > 300 then
    n := n + public.mon_raise('P1','detector_sweep_budget','monitoring','detector_sweep_vs_p0_slo',
      jsonb_build_object(
        'slowest_successful_sweep_s', round(v_max_s),
        'p0_slo_s', 300,
        'assumed_filing_overhead_s', 40,
        'forecast_delivery_s', round(v_max_s) + 40,
        'pct_of_p0_budget', round(100.0 * (v_max_s + 40) / 300.0, 1),
        'runs_24h', v_runs,
        'why','this sweep now gates P0 DELIVERY. mon_dispatch_p0_fast() runs at the END of this '
           ||'cron command and alert_event.created_at is TRANSACTION START, so the sweep runtime '
           ||'is charged in full against the owner 5-minute P0 SLO before dispatch even begins. '
           ||'At this duration a P0 born in this sweep breaches the SLO on arrival. LIMB 3 will '
           ||'NOT catch this: it measures the same runtime against statement_timeout (900s) and '
           ||'stays green until 540s. mon_detect_p0_delivery_sla() will not catch it either -- it '
           ||'only counts a breach while dispatched_at is null, and by the time it next evaluates '
           ||'(one full sweep, 30 min later) the fast lane or the :24 backstop has already '
           ||'stamped it.',
        'action','make the SWEEP faster -- attribute runtime per detector and gate or slim the '
           ||'expensive ones -- or ask the owner for a dedicated minute-slot for the fast lane. '
           ||'NEVER widen the 5-minute SLO, never widen this limb, and never hand-stamp '
           ||'dispatched_at to make it go quiet.'));
  else
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_vs_p0_slo');
  end if;

  return n;
end $function$
$lit$;
begin
  select pg_get_functiondef('public.mon_detect_detector_sweep_budget()'::regprocedure) into v_def;

  if position('detector_sweep_vs_p0_slo' in v_def) > 0 then
    raise notice 'LIMB 4 already present -- nothing to do';
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'anchor not found in live mon_detect_detector_sweep_budget -- re-derive this edit by hand rather than guessing';
  end if;
  -- Needle-edit from the LIVE definition: a concurrent session may have changed this body, and a
  -- hand-pasted CREATE OR REPLACE would silently drop their work.
  execute replace(v_def, v_anchor, v_new);
end $patch$;

-- ── FIX 2: front-load the fast lane in the sweep's cron command ─────────────────────────────────
do $chain$
declare
  v_cmd    text;
  v_sched  text;
  v_anchor text := 'select public.mon_reconcile_dangling_scrape_runs();';
  v_new    text := 'select public.mon_dispatch_p0_fast();' || chr(10)
                || '    select public.mon_reconcile_dangling_scrape_runs();';
begin
  select command, schedule into v_cmd, v_sched from cron.job where jobname = 'mon-detectors-and-dispatch';
  if v_cmd is null then
    raise exception 'mon-detectors-and-dispatch not found -- refusing to touch the fast lane';
  end if;
  if position(v_anchor in v_cmd) = 0 then
    raise exception 'anchor not found in sweep command -- re-derive this edit by hand rather than guessing';
  end if;
  -- Idempotent: only front-load if the FIRST statement is not already the fast lane.
  if position('mon_dispatch_p0_fast' in v_cmd) > 0
     and position('mon_dispatch_p0_fast' in v_cmd) < position(v_anchor in v_cmd) then
    raise notice 'fast lane already front-loaded -- nothing to do';
    return;
  end if;
  -- Needle-edit from the LIVE command, same discipline as 20260828231336.
  perform cron.schedule('mon-detectors-and-dispatch', v_sched, replace(v_cmd, v_anchor, v_new));
end $chain$;

-- ── VERIFY BOTH, FAIL LOUD ──────────────────────────────────────────────────────────────────────
do $verify$
declare v_cmd text; v_sched text; v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_detector_sweep_budget';
  if position('detector_sweep_vs_p0_slo' in v_src) = 0 then
    raise exception 'LIMB 4 did not land';
  end if;
  -- LIMB 3 and the abort limb must both survive the needle-edit.
  if position('detector_sweep_aborted' in v_src) = 0 or position('statement_timeout_s' in v_src) = 0 then
    raise exception 'needle-edit clobbered an existing limb -- refusing to leave the detector degraded';
  end if;

  select command, schedule into v_cmd, v_sched from cron.job where jobname = 'mon-detectors-and-dispatch';
  if v_sched <> '29,59 * * * *' then
    raise exception 'sweep schedule is now % -- schedule changes are owner-only', v_sched;
  end if;
  if position('mon_dispatch_p0_fast' in v_cmd) > position('mon_run_all_detectors' in v_cmd) then
    raise exception 'fast lane did not get front-loaded -- an aborted sweep would still strand every P0';
  end if;
  -- The trailing call must still be there: the front call cannot dispatch a P0 this sweep raises.
  if (length(v_cmd) - length(replace(v_cmd, 'mon_dispatch_p0_fast', ''))) / length('mon_dispatch_p0_fast') <> 2 then
    raise exception 'expected exactly TWO mon_dispatch_p0_fast calls (front + trailing), found a different count';
  end if;
  -- No new minute-slot may have been spent.
  if (select count(*) from cron.job where jobname = 'mon-p0-fast-dispatch') > 0 then
    raise exception 'a per-minute job reappeared -- that is the collision 20260828231336 removed';
  end if;
end $verify$;
