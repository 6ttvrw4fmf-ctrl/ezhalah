-- QA & Repair 2026-10-06 — the P0 fast lane (cron jobid 86) no longer dies when the 30-minute
-- sweep (cron jobid 38) holds an alert_event row lock.
--
-- DEFECT (measured, cron.job_run_details): jobid 86 FAILED with «canceling statement due to
-- statement timeout … while updating tuple … in relation "alert_event"» at 23:01 and 23:04 on
-- 2026-10-04, 02:01 on 2026-10-06, and 9 more times on 10-04; 40P01 deadlocks on 10-03/10-04
-- (alert_event ids 8004, 8230, 8231). Job 38 runs every detector in ONE transaction for 7-12
-- min; every alert row its mon_raise() touches stays locked until it commits. A lane detector
-- that reaches the same row waits; the lane's 45s statement_timeout fires; query_canceled is not
-- caught by `when others`, so the whole lane — and the P0 dispatch after it — rolls back.
--
-- FIX: each lane detector runs under lock_timeout 2s (14 x 2s < 45s). A lock wait becomes
-- lock_not_available, caught per detector: the lane continues and dispatch runs. The deferred
-- detector is reported in the return value; it counts as UNAVAILABLE (the P1 below) unless the
-- sweep — which runs all 14 detectors itself — is the one running. Nothing is dropped from the
-- lane and nothing else changes.

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
  v_deferred  text[] := '{}'::text[];
  v_lock_prev text   := current_setting('lock_timeout');
  v_sweep_on  boolean;
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
      -- 2026-10-06 (QA, backlog 104/106/107): a detector that waits on an alert_event row the
      -- 30-minute sweep (cron 38, ONE transaction, 7-12 min) has already updated used to wait out
      -- the lane's whole 45s statement_timeout. query_canceled is NOT caught by `when others`, so
      -- the timeout killed the entire lane, dispatch included (jobid 86 failed 23:01/23:04 on
      -- 10-03 and 10-04, 02:01 on 10-06; 40P01 deadlocks on 10-03/10-04). A short per-detector
      -- lock_timeout turns that wait into lock_not_available, which IS catchable, so the lane
      -- goes on to the next detector and to the dispatch.
      perform set_config('lock_timeout', '2s', true);
      execute format('select public.%I()', d) into v_one;
      perform set_config('lock_timeout', v_lock_prev, true);
      v_raised := v_raised + coalesce(v_one, 0);
    exception
      when lock_not_available then
        v_deferred := v_deferred || d;
      when others then
        -- Never let one detector abort the lane: the dispatch call that follows in the same cron
        -- command would roll back with it.
        v_crashed := v_crashed || (d || ': ' || sqlerrm);
    end;
  end loop;
  perform set_config('lock_timeout', v_lock_prev, true);

  -- A deferral is NOT a silent gap only while the sweep is running: the sweep evaluates all 14
  -- of these detectors itself (each is in mon_run_all_detectors) and is the transaction holding
  -- the row. Any other lock holder means the detector really did not run here: loud, as before.
  if coalesce(array_length(v_deferred, 1), 0) > 0 then
    select exists (select 1 from cron.job_run_details
                    where jobid = 38 and status = 'running') into v_sweep_on;
    if not coalesce(v_sweep_on, false) then
      v_crashed := v_crashed || array(select x || ': lock_timeout with no sweep running'
                                        from unnest(v_deferred) x);
    end if;
  end if;

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
    'missing',  v_missing,
    'deferred', v_deferred);
end $function$;

-- EXECUTED PROOF at apply time: the lane still checks 14, is clean, and reports a deferred list.
do $verify$
declare
  v jsonb;
  v_before text := current_setting('lock_timeout');
begin
  v := public.mon_run_p0_detectors();
  if (v->>'checked')::int <> 14 then
    raise exception 'the lane no longer checks 14 detectors: %', v;
  end if;
  if not (v ? 'deferred') then
    raise exception 'FIX DID NOT TAKE: the lane does not report deferrals: %', v;
  end if;
  if jsonb_array_length(v->'crashed') <> 0 or jsonb_array_length(v->'missing') <> 0 then
    raise exception 'the lane is degraded right now: %', v;
  end if;
  if current_setting('lock_timeout') <> v_before then
    raise exception 'the lane leaked its lock_timeout into the caller: %', current_setting('lock_timeout');
  end if;
end $verify$;
