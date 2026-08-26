-- Follow-up to alert_delivery_detects_undelivered_not_just_unconfigured (same run, 2026-08-26).
--
-- Readability-only correction inside branch 2. The first SELECT assigned v_late the number of
-- SEVERITY GROUPS and the next statement immediately overwrote it with the number of ALERTS.
-- Behaviour was correct (the overwrite always won, and v_oldest/v_sev were right), but a barrier
-- must not contain a variable that means two different things three lines apart -- that is how a
-- future edit deletes the "wrong" line and silently changes what the detector counts.
--
-- Branch 2 now computes v_oldest/v_sev in one statement and v_late in exactly one place.
-- No predicate, threshold, severity, dedup key or payload field changed.

create or replace function public.mon_detect_alert_delivery()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- CANONICAL DELIVERY CONTRACT. Mirrored in scripts/lib/alertDelivery.ts and in the severity
  -- filter of .github/workflows/alert-dispatch.yml; scripts/verify-alert-delivery-coverage.ts
  -- (npm test) fails if the three ever disagree. P3 is deliberately NOT delivered -- it is
  -- informational -- which is why it must be excluded here too, or this detector would raise
  -- forever on rows nothing is contracted to deliver.
  c_delivered   text[] := array['P0','P1','P2'];
  -- alert-dispatch.yml runs at :09/:39. 60 minutes is two consecutive missed runs, so a single
  -- transient GitHub Actions failure does not raise.
  c_grace_min   int    := 60;

  v_hook text; v_channels int; v_open int; v_undelivered int;
  v_configured boolean;
  v_late int; v_late_sample jsonb; v_oldest timestamptz; v_sev jsonb;
  n int := 0;
begin
  select value into v_hook from public.mon_config where key = 'alert_webhook_url';
  select count(*) into v_channels from public.ops_alert_channel where enabled;
  select count(*) filter (where resolved_at is null),
         count(*) filter (where resolved_at is null and dispatched_at is null)
    into v_open, v_undelivered
    from public.alert_event;

  v_configured := coalesce(v_hook, '') <> ''
               or v_channels > 0
               or coalesce((select value from public.mon_config
                             where key = 'github_issue_delivery'), '') = 'enabled';

  ---------------------------------------------------------------------------
  -- BRANCH 1 -- nothing is configured to receive alerts at all (original check).
  ---------------------------------------------------------------------------
  if v_open > 0 and not v_configured then
    n := n + public.mon_raise('P1', 'alert_delivery', 'monitoring', 'alert_delivery_unconfigured',
      jsonb_build_object(
        'open_alerts', v_open, 'never_delivered', v_undelivered,
        'configured_channels', v_channels, 'webhook_configured', false,
        'why', 'Alerts are being raised and NOTHING is receiving them. No webhook URL, no enabled '
               'ops_alert_channel row, and github_issue_delivery is not enabled. A P1 nobody '
               'receives is not a P1. Choosing the destination is an OWNER input; until then this '
               'makes the silence itself visible in the sweep.'));
  else
    perform public.mon_resolve_key('alert_delivery', 'alert_delivery_unconfigured');
  end if;

  ---------------------------------------------------------------------------
  -- BRANCH 2 (2026-08-26) -- a destination is configured but is not actually delivering.
  -- This is the branch whose absence hid a 41-day P0 blackout.
  ---------------------------------------------------------------------------
  select count(*), min(created_at)
    into v_late, v_oldest
    from public.alert_event
   where resolved_at is null
     and dispatched_at is null
     and severity = any(c_delivered)
     and created_at < now() - make_interval(mins => c_grace_min);

  if v_late > 0 then
    select coalesce(jsonb_object_agg(severity, c), '{}'::jsonb)
      into v_sev
      from (select severity, count(*) c
              from public.alert_event
             where resolved_at is null
               and dispatched_at is null
               and severity = any(c_delivered)
               and created_at < now() - make_interval(mins => c_grace_min)
             group by severity) g;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', id, 'severity', severity, 'kind', kind,
             'dedup_key', dedup_key, 'created_at', created_at)), '[]'::jsonb)
      into v_late_sample
      from (select id, severity, kind, dedup_key, created_at
              from public.alert_event
             where resolved_at is null
               and dispatched_at is null
               and severity = any(c_delivered)
               and created_at < now() - make_interval(mins => c_grace_min)
             order by severity, created_at
             limit 20) s;

    n := n + public.mon_raise('P1', 'alert_delivery', 'monitoring', 'alert_delivery_undelivered',
      jsonb_build_object(
        'undelivered_count', v_late,
        'by_severity', v_sev,
        'oldest_undelivered', v_oldest,
        'grace_minutes', c_grace_min,
        'delivered_severities', to_jsonb(c_delivered),
        'sample', v_late_sample,
        'why', 'A delivery destination IS configured, and these delivery-eligible alerts have '
               'still not been dispatched past the grace window. Configured is not delivered. '
               'The 2026-08-26 instance of exactly this: alert-dispatch.yml selected '
               'severity=in.(P1,P2), so all 53 P0 silent_scraper_death alerts raised since '
               '2026-07-16 were dropped on the floor while this detector read green because a '
               'destination existed.',
        'action', 'Check the alert-dispatch.yml severity filter still matches '
               'scripts/lib/alertDelivery.ts DELIVERED_SEVERITIES, then check the last '
               'Alert dispatch workflow runs for a failure or an expired '
               'SUPABASE_SERVICE_ROLE_KEY. Do NOT hand-stamp dispatched_at to clear this.',
        'caveat', 'If the delivery channel is entirely down this alert cannot be delivered '
               'either. It is still visible in mon_run_all_detectors().open_alerts, which is '
               'why that return value must be read and not just the per-detector counts.'));
  else
    perform public.mon_resolve_key('alert_delivery', 'alert_delivery_undelivered');
  end if;

  return n;
end $function$;
