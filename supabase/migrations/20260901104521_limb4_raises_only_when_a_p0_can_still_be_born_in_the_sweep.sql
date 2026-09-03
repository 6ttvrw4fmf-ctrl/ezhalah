-- Systems Seam Engineer, 2026-09-01.
--
-- DEFECT (a seam, not a component bug). mon_detect_detector_sweep_budget() LIMB 4
-- (`detector_sweep_vs_p0_slo`) raises P1 whenever the slowest successful sweep in 24h plus 40s of
-- assumed filing overhead exceeds the 300s P0 SLO. Its premise, stated in its own comment and
-- payload, is:
--
--     "mon_dispatch_p0_fast() runs at the END of this cron command and alert_event.created_at is
--      TRANSACTION START, so the sweep runtime is charged in full against the owner 5-minute P0
--      SLO before dispatch even begins."
--
-- That premise was TRUE when the limb shipped (20260829, while the fast lane was chained onto the
-- end of jobid 38's command) and was made FALSE two days later by 20260831192229
-- ("p0_detection_leaves_the_long_sweep_transaction"), which moved P0 DETECTION itself onto the
-- fast lane: cron jobid 86 now runs `mon_run_p0_detectors(); mon_dispatch_p0_fast();` in its own
-- 45s transaction on 24 minute-slots. A P0 is therefore born, committed and dispatched inside the
-- LANE's transaction; the sweep's runtime is no longer a term in its delivery latency at all.
--
-- Nobody updated the detector watching the old coupling. This is the orphaned-guarantee shape one
-- level up: a fix landed in component A and the barrier asserting A's previous contract kept
-- firing against a risk that no longer exists.
--
-- PRODUCTION EVIDENCE (2026-09-01):
--   * ops_p0_lane_contract(): p0_capable_detectors == lane_detectors, ten each, identical sets;
--     lane_active=true, lane_runs_24h=568, lane_failures_24h=0, lane_max_runtime_s=24.8.
--   * P0 alerts 1243/1244 (silent_scraper_death:sanadak / :sadin) were created 04:24:00.024 -- a
--     LANE minute, not a sweep minute (:29/:59) -- and dispatched at 04:24:20 / 04:24:22.
--     Delivery latency 20s and 22s against a 300s SLO.
--   * The same day's sweeps ran 167.9s - 270.8s. Under the limb's premise those P0s would have
--     been born at :29/:59 and delivered 200s+ later. They were not.
--
-- WHY IT MATTERS RATHER THAN BEING MERE NOISE. Alert 1115 has been open on
-- `detector_sweep_vs_p0_slo` since 2026-08-29 and is re-affirmed every sweep. mon_raise() returns
-- 0 for a dedup key that is already open at the same severity, so while this false positive
-- stands, a GENUINE re-coupling of sweep duration to P0 delivery would raise nothing, dispatch
-- nothing and page nobody. A permanently-true barrier is a disabled barrier. Same wound as
-- sections 23a/25a and as 20260901073449's stuck_open_alert fix.
--
-- FIX: DISCRIMINATE, DO NOT WIDEN. The 300s SLO and the 40s overhead constant are untouched. The
-- limb now additionally asks whether a P0 could still be born inside the sweep transaction at all,
-- and raises only when the answer is yes. Both directions are preserved:
--   * every P0-capable detector on a healthy lane  -> sweep duration cannot delay a P0 -> RESOLVE
--   * any P0-capable detector OFF the lane, or the lane down/inactive/not running, or the contract
--     unreadable                                    -> exposure is real -> RAISE P1, as before
--
-- The guard FAILS SAFE in every unreadable direction, so a refactor that breaks
-- ops_p0_lane_contract() makes this limb raise rather than fall silent. It also makes LIMB 4 the
-- RUNTIME watchdog for fast-lane membership -- previously only scripts/verify-p0-fast-lane-
-- detection.ts covered that, and only at CI time on a PR that touches the repo.
--
-- NEVER widen c_sla (300) or the 40s overhead to quiet this limb. If it raises after this change,
-- a P0-capable detector is genuinely outside the lane -- put it on the lane.

-- ---------------------------------------------------------------------------------------------
-- The decision is a PURE function so both directions are unit-testable against synthetic
-- contracts, with no dependence on live production state.
create or replace function public.mon_p0_sweep_exposure_should_raise(
  p_max_sweep_s numeric,
  p_contract    jsonb
) returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select
    -- (1) Is the sweep slow enough that a P0 BORN INSIDE IT would breach the 300s SLO?
    --     Unchanged from the original limb: 300s SLO, 40s assumed filing overhead.
    coalesce(p_max_sweep_s, 0) + 40 > 300
    and
    -- (2) ...and could a P0 still be born inside it? Fail SAFE: anything unreadable counts as
    --     exposed, so a broken contract raises rather than silently disabling the limb.
    (
         p_contract is null
      or coalesce((p_contract->>'lane_active')::boolean, false) is not true
      or coalesce((p_contract->>'lane_runs_24h')::int, 0) <= 0
      or coalesce(jsonb_typeof(p_contract->'p0_capable_detectors'), 'null') <> 'array'
      or coalesce(jsonb_typeof(p_contract->'lane_detectors'), 'null') <> 'array'
      or exists (
           select 1
             from jsonb_array_elements_text(p_contract->'p0_capable_detectors') d
            where not (p_contract->'lane_detectors' ? d)
         )
    )
$function$;

comment on function public.mon_p0_sweep_exposure_should_raise(numeric, jsonb) is
  'LIMB 4 of mon_detect_detector_sweep_budget(), extracted pure so both directions are testable. '
  'TRUE when the sweep is slow enough to breach the 300s P0 SLO *and* a P0 could still be born '
  'inside the sweep transaction (a P0-capable detector off the fast lane, or the lane down). '
  'Since 20260831192229 P0 detection runs on cron jobid 86, so a complete healthy lane means sweep '
  'duration is NOT a term in P0 delivery latency. Fails SAFE: a null/unreadable contract returns '
  'TRUE. Never widen the 300s SLO or the 40s overhead to quiet the caller.';

-- ---------------------------------------------------------------------------------------------
-- Needle-edit the LIVE function. Re-creating it from a snapshot would silently drop whatever a
-- concurrent session changed in limbs 1-3 (hard safety rail).
do $patch$
declare src text; newsrc text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_detector_sweep_budget';

  if src is null then
    raise exception 'mon_detect_detector_sweep_budget() not found -- refusing to patch';
  end if;

  if position('mon_p0_sweep_exposure_should_raise' in src) > 0 then
    raise notice 'LIMB 4 exposure guard already present';
    return;
  end if;

  -- (a) declare the contract holder
  newsrc := replace(src,
    '  v_abort_secs numeric[];',
    '  v_abort_secs numeric[];' || chr(10) || '  v_contract jsonb;');
  if newsrc = src then
    raise exception 'declare anchor not found -- refusing a no-op patch';
  end if;
  src := newsrc;

  -- (b) read the lane contract, failing SAFE to null (= exposed)
  newsrc := replace(src,
    '  if v_max_s + 40 > 300 then',
    '  begin' || chr(10) ||
    '    v_contract := public.ops_p0_lane_contract();' || chr(10) ||
    '  exception when others then' || chr(10) ||
    '    v_contract := null;  -- unreadable contract = treat as exposed' || chr(10) ||
    '  end;' || chr(10) || chr(10) ||
    '  if public.mon_p0_sweep_exposure_should_raise(v_max_s, v_contract) then');
  if newsrc = src then
    raise exception 'LIMB 4 condition anchor not found -- refusing a no-op patch';
  end if;
  src := newsrc;

  -- (c) carry the exposure into the payload so the alert says WHICH detector is off the lane
  newsrc := replace(src,
    '        ''pct_of_p0_budget'', round(100.0 * (v_max_s + 40) / 300.0, 1),' || chr(10) ||
    '        ''runs_24h'', v_runs,',
    '        ''pct_of_p0_budget'', round(100.0 * (v_max_s + 40) / 300.0, 1),' || chr(10) ||
    '        ''runs_24h'', v_runs,' || chr(10) ||
    '        ''lane_active'', coalesce(v_contract->>''lane_active'', ''UNREADABLE''),' || chr(10) ||
    '        ''lane_runs_24h'', coalesce(v_contract->>''lane_runs_24h'', ''UNREADABLE''),' || chr(10) ||
    '        ''p0_capable_off_lane'', coalesce((' || chr(10) ||
    '            select jsonb_agg(d order by d)' || chr(10) ||
    '              from jsonb_array_elements_text(v_contract->''p0_capable_detectors'') d' || chr(10) ||
    '             where not (v_contract->''lane_detectors'' ? d)), ''[]''::jsonb),');
  if newsrc = src then
    raise exception 'LIMB 4 payload anchor not found -- refusing a no-op patch';
  end if;

  execute newsrc;
end $patch$;

comment on function public.mon_detect_detector_sweep_budget() is
  'Four limbs over the twice-hourly detector sweep (cron jobid 38): killed runs, unknown budget, '
  'runtime vs statement_timeout, and LIMB 4 runtime vs the 300s P0 delivery SLO. Since '
  '20260831192229 P0 DETECTION runs on the fast lane (jobid 86), so LIMB 4 raises only when a P0 '
  'could still be born inside the sweep transaction -- a P0-capable detector off the lane, or the '
  'lane down. It is therefore also the runtime watchdog for fast-lane membership. Fails SAFE on an '
  'unreadable contract. Never widen the 300s SLO or the 40s overhead to quiet it.';
