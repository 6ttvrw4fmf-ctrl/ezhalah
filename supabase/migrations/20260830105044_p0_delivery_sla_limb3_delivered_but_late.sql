-- Systems Seam run 2026-08-30. LIMB 3: a P0 that WAS delivered, but LATE.
--
-- THE HOLE. mon_detect_p0_delivery_sla() had exactly two limbs, and BOTH can only see a P0 that is
-- still UNDELIVERED (`a.dispatched_at is null`). The instant alert-dispatch.yml stamps
-- dispatched_at, a breach becomes invisible to this detector forever. The owner's SLO is defined on
-- DELIVERY LATENCY; limbs 1-2 measure only PENDING latency. Those are not the same predicate, and
-- the gap between them is total: a path that delivers every single P0 at 371s reads permanently
-- GREEN while missing the 5-minute SLO every single time.
--
-- This is not hypothetical. Measured on production this run:
--   alert 1166 (deleted_but_source_live:73)  created 2026-08-30 05:29:00  dispatched 05:35:11
--   -> 371s end-to-end, a 71s breach of the 300s SLO. NOTHING raised. Nothing could have.
--
-- WHY IT BREACHED (already diagnosed, already open as detector_sweep_vs_p0_slo / alert 1115):
-- alert_event.created_at defaults to now() = TRANSACTION START, mon_dispatch_p0_fast() is chained
-- at the END of the mon-detectors-and-dispatch command, so the whole sweep runtime is spent before
-- dispatch begins. The 05:29 sweep ran 356.8s. The P0 clock had already expired when the fast lane
-- started. That mechanism fix is a separate, owner-scoped decision (slim the sweep, or grant the
-- fast lane a dedicated minute-slot -- cron schedules are owner-only). THIS limb does not fix the
-- latency; it makes the latency VISIBLE, which is the part that was missing entirely.
--
-- WHY dispatched_at IS THE RIGHT CLOCK. It has exactly ONE writer -- alert-dispatch.yml, per-row,
-- after `gh issue create` actually succeeds -- and mon_detect_alert_delivery() BRANCH 3 raises P1
-- on any database function that stamps it. So it means "a GitHub issue exists", which is the only
-- honest definition of delivered. A github_workflow 204 receipt in ops_p0_delivery is a TRIGGER
-- ACCEPTED, not a delivery, and is excluded here for exactly the reason limbs 1-2 exclude it: that
-- is the enqueue-vs-delivered mistake that produced the 41-day blackout.
--
-- WHY A ROLLING 24h WINDOW. This is a "recent breaches" signal. A persistently slow path keeps
-- producing new breaches and keeps this raised; a genuine one-off ages out and the limb goes GREEN
-- on its own, so it can go green without anyone editing it (SS23a: a barrier must be able to go
-- GREEN, not only red). It is deliberately NOT permanent: alert 1011 (10037s, 2026-08-26, from
-- before the 2026-08-29 fast-lane fix) is history, and pinning a red on it forever would train
-- people to ignore this key.
--
-- WHY P1 AND NOT P0, deliberately. The alert DID reach a human -- this is not the delivery-blackout
-- class that limb 2 guards, where nobody is told at all. This says the PATH is too slow and needs
-- fixing. Raising P0 for an alert already sitting in someone's inbox would dilute the P0 signal,
-- and P0 dilution is itself a documented failure mode in this system. Going from NOTHING to P1 is
-- strictly stronger than what was here before; it is not a softened P0.
--
-- NEVER widen c_sla_minutes, and never shorten this window, to make this key quiet. If it raises,
-- the delivery path is what changes.

create or replace function public.mon_detect_p0_delivery_sla()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- OWNER-SET, 2026-08-28. Not a tuning knob. If this raises, fix the delivery path, never this.
  c_sla_minutes int := 5;
  c_late_window constant interval := interval '24 hours';
  v_channels    int;
  v_human       int;
  v_open_p0     int;
  v_breached    int;
  v_sample      jsonb;
  v_worst       numeric;
  v_late        int;
  v_late_worst  numeric;
  v_late_sample jsonb;
  n int := 0;
begin
  select count(*) into v_channels from public.ops_alert_channel where enabled;
  select count(*) into v_human from public.ops_alert_channel
   where enabled and webhook_url not like '%/functions/v1/alert-sink%';
  select count(*) into v_open_p0 from public.alert_event where severity = 'P0' and resolved_at is null;

  if v_channels = 0 or v_human = 0 then
    n := n + public.mon_raise('P1', 'p0_delivery_sla', 'monitoring', 'p0_delivery_no_human_channel',
      jsonb_build_object(
        'enabled_channels', v_channels, 'human_reaching_channels', v_human,
        'open_p0', v_open_p0, 'sla_minutes', c_sla_minutes,
        'why', 'No channel that reaches a HUMAN is configured -- ops_alert_channel is empty, or the '
            || 'only enabled row is the alert-sink proof fixture, which answers 200 and reaches '
            || 'nobody. Meeting the SLO into a sink is not meeting the SLO.',
        'action', 'OWNER INPUT: enable the github_workflow channel (or another real destination). '
            || 'Do NOT point this at alert-sink and do NOT widen c_sla_minutes.'));
  else
    perform public.mon_resolve_key('p0_delivery_sla', 'p0_delivery_no_human_channel');
  end if;

  -- DELIVERED means an issue exists. A 'github_workflow' receipt is a TRIGGER ACCEPTED (204) and is
  -- excluded: counting it would mark alerts delivered the instant GitHub accepted a dispatch --
  -- the enqueue-vs-delivered mistake that produced the 41-day blackout, one layer up.
  select count(*),
         round(max(extract(epoch from (now() - a.created_at)) / 60.0), 1)
    into v_breached, v_worst
    from public.alert_event a
   where a.severity = 'P0'
     and a.resolved_at is null
     and a.created_at < now() - make_interval(mins => c_sla_minutes)
     and a.dispatched_at is null
     and not exists (
       select 1 from public.ops_p0_delivery d
         join public.ops_alert_channel c on c.id = d.channel_id
        where d.alert_id = a.id
          and d.status_code between 200 and 299
          and c.kind <> 'github_workflow');

  if v_breached > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', a.id, 'dedup_key', a.dedup_key, 'created_at', a.created_at,
             'minutes_undelivered', round(extract(epoch from (now() - a.created_at)) / 60.0, 1),
             'attempts', (select max(d.attempts) from public.ops_p0_delivery d where d.alert_id = a.id),
             'last_status', (select max(d.status_code) from public.ops_p0_delivery d where d.alert_id = a.id))), '[]'::jsonb)
      into v_sample
      from (select * from public.alert_event a
             where a.severity = 'P0' and a.resolved_at is null
               and a.created_at < now() - make_interval(mins => c_sla_minutes)
               and a.dispatched_at is null
               and not exists (select 1 from public.ops_p0_delivery d
                                 join public.ops_alert_channel c on c.id = d.channel_id
                                where d.alert_id = a.id and d.status_code between 200 and 299
                                  and c.kind <> 'github_workflow')
             order by a.created_at limit 10) a;

    n := n + public.mon_raise('P0', 'p0_delivery_sla', 'monitoring', 'p0_delivery_sla_breach',
      jsonb_build_object(
        'breached_count', v_breached, 'worst_minutes', v_worst, 'sla_minutes', c_sla_minutes,
        'sample', v_sample,
        'why', 'A P0 passed the owner''s 5-minute delivery SLO with no GitHub issue filed '
            || '(dispatched_at is still null). A workflow-trigger 204 does not count -- only a '
            || 'filed issue does. Recursive trap: if the channel is down this alert cannot be '
            || 'delivered either, which is why open_alerts must be read directly.',
        'action', 'Check the fast lane in the mon-detectors-and-dispatch command (there is deliberately NO '
            || 'mon-p0-fast-dispatch job -- 20260828231336 unscheduled it and the barrier asserts it '
            || 'stays gone). Check, in order: did the sweep ABORT (cron.job_run_details) -- one '
            || 'transaction, so a timeout rolls the dispatch back with it; is detector_sweep_vs_p0_slo '
            || 'open -- the sweep runtime is charged against this SLO because created_at is '
            || 'transaction start; then the Alert dispatch workflow runs, then '
            || 'ops_p0_delivery.status_code / net._http_response. Fix the PATH. Never widen '
            || 'c_sla_minutes and never hand-stamp dispatched_at.'));
  else
    perform public.mon_resolve_key('p0_delivery_sla', 'p0_delivery_sla_breach');
  end if;

  -- ---- LIMB 3: DELIVERED, BUT LATE. The half neither limb above can see. ----------------------
  -- Measured against dispatched_at (one writer; "an issue exists"), NOT against a 204 trigger
  -- receipt. Rolling window so it can self-clear; see the header for why P1 and why 24h.
  select count(*), round(max(extract(epoch from (a.dispatched_at - a.created_at))))
    into v_late, v_late_worst
    from public.alert_event a
   where a.severity = 'P0'
     and a.dispatched_at is not null
     and a.created_at > now() - c_late_window
     and a.dispatched_at - a.created_at > make_interval(mins => c_sla_minutes);

  if coalesce(v_late, 0) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', a.id, 'dedup_key', a.dedup_key, 'created_at', a.created_at,
             'dispatched_at', a.dispatched_at,
             'delivered_after_s', round(extract(epoch from (a.dispatched_at - a.created_at))))), '[]'::jsonb)
      into v_late_sample
      from (select * from public.alert_event a
             where a.severity = 'P0'
               and a.dispatched_at is not null
               and a.created_at > now() - c_late_window
               and a.dispatched_at - a.created_at > make_interval(mins => c_sla_minutes)
             order by (a.dispatched_at - a.created_at) desc limit 10) a;

    n := n + public.mon_raise('P1', 'p0_delivery_sla', 'monitoring', 'p0_delivery_sla_late',
      jsonb_build_object(
        'late_count', v_late, 'worst_delivery_s', v_late_worst,
        'sla_seconds', c_sla_minutes * 60, 'window_hours', 24,
        'sample', v_late_sample,
        'why', 'These P0s DID reach a human, but slower than the owner''s 5-minute SLO. Limbs 1 and '
            || '2 are structurally blind to this: they only match while dispatched_at is null, so a '
            || 'breach disappears the instant the issue is filed. A path that delivers every P0 at '
            || '371s would read GREEN forever without this limb.',
        'action', 'Fix the PATH, never this limb and never c_sla_minutes. Look first at '
            || 'detector_sweep_vs_p0_slo: alert_event.created_at is TRANSACTION START and '
            || 'mon_dispatch_p0_fast() is chained at the END of the mon-detectors-and-dispatch '
            || 'command, so the entire sweep runtime is charged against this SLO before dispatch '
            || 'even begins. Either slim the sweep (attribute it with ops_detector_timing) or ask '
            || 'the OWNER for a dedicated minute-slot for the fast lane -- cron schedule changes '
            || 'are owner-only. Do NOT hand-stamp dispatched_at.'));
  else
    perform public.mon_resolve_key('p0_delivery_sla', 'p0_delivery_sla_late');
  end if;

  return n;
end $function$;

comment on function public.mon_detect_p0_delivery_sla() is
  'Owner 5-minute P0 delivery SLO. LIMB 1: no human-reaching channel. LIMB 2: a P0 still '
  'undelivered past the SLO. LIMB 3 (2026-08-30): a P0 DELIVERED but LATE -- limbs 1-2 only match '
  'while dispatched_at is null, so without it a path that delivers every P0 late reads green '
  'forever (measured: alert 1166, 371s, 2026-08-30). Never widen c_sla_minutes; fix the path.';
