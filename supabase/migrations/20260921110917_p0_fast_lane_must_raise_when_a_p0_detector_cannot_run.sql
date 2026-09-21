-- Systems Seam Engineer, 2026-09-21 (adversarial half of the same run as 20260921104912).
--
-- DEFECT. mon_run_p0_detectors() is the P0 fast lane's detection half: cron jobid 86 runs
--     set statement_timeout to '45s'; select public.mon_run_p0_detectors(); select public.mon_dispatch_p0_fast();
-- every ~2 minutes. It catches a per-detector exception so one bad detector cannot abort the lane
-- and roll the dispatch back with it — correct, and it must stay. It then records what went wrong
-- in `crashed` and `missing` and RETURNS them.
--
-- Nothing reads that return. `select public.mon_run_p0_detectors();` in a cron command discards its
-- result, and the only two functions that mention the name (ops_p0_lane_contract,
-- ops_p0_detectors_off_fast_lane) read its SOURCE TEXT for the detector list — neither executes it
-- nor reads its runtime report. The function's own comment promises the opposite:
--
--     "A renamed or dropped detector must be loud, never a silent gap in P0 coverage."
--
-- It is written into a value thrown away one frame later. Verified 2026-09-21: the live function
-- contains no mon_raise at all.
--
-- WHY THIS IS NOT COSMETIC, AND WHY IT IS THIS ROUTINE'S. The lane runs under a 45 s
-- statement_timeout; the sweep that runs the SAME detectors runs under 900 s. A detector that grows
-- past 45 s therefore crashes on EVERY lane tick while still succeeding in the sweep — so it keeps
-- passing scripts/verify-p0-fast-lane-detection.ts (a static list check), keeps appearing healthy in
-- ops_detector_timing (which the SWEEP writes), and silently stops being a fast-lane detector. Its
-- P0s are then only ever born in the slow sweep transaction, with the sweep's whole runtime already
-- charged against the 300 s SLO — which is exactly the breach class 20260921104912 was applied this
-- same run to make visible (2 of 2 sweep-born P0s breached, at 371 s and 665 s). This gap can
-- silently recreate that condition one detector at a time.
--
-- A dropped or renamed detector is the same shape with a faster fuse: `missing` is populated, the
-- lane returns a smaller `checked`, and nothing anywhere says so.
--
-- FIX. Make the promise true: raise P1 when either array is non-empty, resolve the key when the
-- lane is clean again. Nothing else changes — the per-detector exception handler, the ordering, the
-- return value and the lane's early-exit behaviour are all untouched, so this can only ADD signal.
--
-- KIND. `p0_delivery_lane_health`, deliberately under the `^p0_delivery` prefix that
-- scripts/lib/alertRouting.ts already routes to routine 7 ("any future p0_delivery_* key arrives
-- with the same owner instead of silently re-opening this hole"). No routing change is needed and
-- none is made, so this cannot fall through to the #2 triage fallback the way #3480 describes.
--
-- The decision is a PURE function so both directions are executable against synthetic inputs
-- without needing to break a real detector in production.

do $guard$
declare v_src text;
begin
  select pg_get_functiondef('public.mon_run_p0_detectors()'::regprocedure) into v_src;
  if v_src !~ 'c_p0_detectors' or v_src !~ 'v_crashed' or v_src !~ 'v_missing' then
    raise exception 'mon_run_p0_detectors() is not the body this migration was written against — re-read the LIVE definition before replacing it';
  end if;
  if v_src ~ 'mon_raise' then
    raise exception 'this migration has already been applied (the lane already raises)';
  end if;
end $guard$;

create or replace function public.mon_p0_lane_unavailable(p_crashed text[], p_missing text[])
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  -- A detector that cannot RUN is not a detector. Either array non-empty means some P0 condition
  -- is currently unwatched on the fast lane, whatever the lane's own exit status says.
  select coalesce(array_length(p_crashed, 1), 0) > 0
      or coalesce(array_length(p_missing, 1), 0) > 0
$function$;

create or replace function public.mon_run_p0_detectors()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  -- EVERY P0-capable detector. This list is machine-checked against reality by
  -- scripts/verify-p0-fast-lane-detection.ts, which enumerates every public mon_detect_* whose
  -- body can raise 'P0' and FAILS if one is missing here. That barrier is the point: a new P0
  -- detector added to the sweep but not to this lane would silently inherit the 712s latency this
  -- migration exists to remove, and nothing else would notice.
  c_p0_detectors constant text[] := array[
    'mon_detect_agent_calls_per_message',
    'mon_detect_agent_health',
    'mon_detect_ai_cost_health',
    'mon_detect_alert_delivery',
    'mon_detect_alert_queue_unworked',
    'mon_detect_cron_scheduler_frozen',
    'mon_detect_deleted_but_source_live',
    'mon_detect_deletion_on_inconclusive_evidence',
    'mon_detect_p0_delivery_sla',
    'mon_detect_price_borrowed_from_chrome',
    'mon_detect_silent_scraper_death',
    'mon_detect_stalled_incident',
    'mon_detect_unacknowledged_p0',
    'mon_detect_unledgered_hard_delete'
  ];
  d           text;
  v_raised    int := 0;
  v_one       int;
  v_crashed   text[] := '{}'::text[];
  v_missing   text[] := '{}'::text[];
begin
  foreach d in array c_p0_detectors loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = d
    ) then
      -- A renamed or dropped detector must be loud, never a silent gap in P0 coverage.
      v_missing := v_missing || d;
      continue;
    end if;
    begin
      execute format('select public.%I()', d) into v_one;
      v_raised := v_raised + coalesce(v_one, 0);
    exception when others then
      -- Never let one detector abort the lane: the dispatch call that follows in the same cron
      -- command would roll back with it.
      v_crashed := v_crashed || (d || ': ' || sqlerrm);
    end;
  end loop;

  -- 2026-09-21: MAKE THE PROMISE ABOVE TRUE. Until now `v_crashed`/`v_missing` went only into the
  -- return value, and the lane's cron command discards it -- so "must be loud" was written into
  -- something nobody reads. A detector that exceeds the lane's 45s statement_timeout crashes on
  -- every tick while still succeeding in the 900s sweep, so no existing check can see it.
  if public.mon_p0_lane_unavailable(v_crashed, v_missing) then
    perform public.mon_raise('P1', 'p0_delivery_lane_health', 'monitoring',
      'p0_lane_detector_unavailable',
      jsonb_build_object(
        'crashed', to_jsonb(v_crashed),
        'missing', to_jsonb(v_missing),
        'checked', array_length(c_p0_detectors, 1),
        'ran', array_length(c_p0_detectors, 1)
                 - coalesce(array_length(v_crashed, 1), 0)
                 - coalesce(array_length(v_missing, 1), 0),
        'why', 'a P0-capable detector did not RUN on the fast lane. The lane catches per-detector '
            || 'errors so one bad detector cannot abort the dispatch that follows it in the same '
            || 'cron command -- correct, but it means the failure is otherwise silent. While this '
            || 'holds, whatever that detector watches is UNWATCHED on the fast lane, and any P0 it '
            || 'would have raised is left to be born in the 30-minute sweep instead, inside the '
            || 'sweep transaction, with the sweep runtime already charged against the 300s SLO.',
        'action', 'root-cause the named detector. The lane runs under statement_timeout 45s while '
            || 'the sweep runs under 900s, so a detector that merely grew past 45s crashes here '
            || 'every tick and still looks healthy everywhere else -- check its cost first '
            || '(detector_cost_step_change). NEVER quiet this by dropping the detector from '
            || 'c_p0_detectors: that trades a loud gap for a silent one.'));
  else
    perform public.mon_resolve_key('p0_delivery_lane_health', 'p0_lane_detector_unavailable');
  end if;

  return jsonb_build_object(
    'raised',   v_raised,
    'checked',  array_length(c_p0_detectors, 1),
    'crashed',  v_crashed,
    'missing',  v_missing);
end $function$;

-- EXECUTED PROOF, both directions, at apply time.
do $verify$
declare
  v jsonb;
begin
  if public.mon_p0_lane_unavailable('{}'::text[], '{}'::text[]) then
    raise exception 'REGRESSION: a clean lane must not raise';
  end if;
  if not public.mon_p0_lane_unavailable(array['mon_detect_x: boom'], '{}'::text[]) then
    raise exception 'FIX DID NOT TAKE: a crashed detector must raise';
  end if;
  if not public.mon_p0_lane_unavailable('{}'::text[], array['mon_detect_gone']) then
    raise exception 'FIX DID NOT TAKE: a missing detector must raise';
  end if;
  if not public.mon_p0_lane_unavailable(array['a: boom'], array['b']) then
    raise exception 'FIX DID NOT TAKE: both together must raise';
  end if;
  -- NULL is what array_length returns for an empty array in some paths; it must read as clean,
  -- not crash the lane.
  if public.mon_p0_lane_unavailable(null, null) then
    raise exception 'a null pair must read as clean, not raise';
  end if;

  -- And the real lane still runs and reports the same shape.
  v := public.mon_run_p0_detectors();
  if (v->>'checked')::int <> 14 then
    raise exception 'the lane no longer checks 14 detectors: %', v;
  end if;
  if jsonb_array_length(v->'crashed') <> 0 or jsonb_array_length(v->'missing') <> 0 then
    raise exception 'the lane is degraded right now: %', v;
  end if;
end $verify$;
