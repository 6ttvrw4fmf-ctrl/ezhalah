-- Senior Production Engineer, 2026-08-26.
--
-- THE BARRIER THAT WATCHED ALERT DELIVERY COULD ONLY SEE ONE CAUSE OF SILENCE.
--
-- mon_detect_alert_delivery() asked exactly one question: "is a destination CONFIGURED?"
-- (webhook URL / ops_alert_channel / mon_config.github_issue_delivery). Once
-- github_issue_delivery was set to 'enabled' on 2026-08-11 the detector took its else-branch
-- forever and never looked again. It computed v_undelivered and then discarded it -- the number
-- only ever appeared inside the alert it could no longer raise.
--
-- Meanwhile the configured deliverer, .github/workflows/alert-dispatch.yml, selected
-- severity=in.(P1,P2). P0 was not in the list. Measured on 2026-08-26: 53 P0 alerts raised since
-- 2026-07-16, ALL of kind silent_scraper_death, dispatched = 0. Not one has ever reached a human.
-- The only thing that ever reached GitHub about them was the P2 meta-alert
-- unresolvable_alert_kind:silent_scraper_death -- the alert ABOUT the alert was delivered while
-- the P0 itself was not.
--
-- CONFIGURED IS NOT DELIVERED. This adds the second branch, which asks the question the first one
-- structurally cannot: is anything delivery-eligible sitting undelivered past its grace window,
-- whatever the reason (wrong filter, workflow disabled, expired secret, silent gh failure)?
-- Branch 1 is preserved verbatim in intent so an unconfigured channel is still caught.
--
-- Both branches self-clear via mon_resolve_key on their own dedup key, so neither can ratchet
-- (mon_detect_unresolvable_alert_kinds stays green for kind 'alert_delivery').

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
  select count(*), min(created_at),
         coalesce(jsonb_object_agg(severity, c), '{}'::jsonb)
    into v_late, v_oldest, v_sev
    from (select severity, count(*) c, min(created_at) created_at
            from public.alert_event
           where resolved_at is null
             and dispatched_at is null
             and severity = any(c_delivered)
             and created_at < now() - make_interval(mins => c_grace_min)
           group by severity) g;

  select count(*) into v_late
    from public.alert_event
   where resolved_at is null
     and dispatched_at is null
     and severity = any(c_delivered)
     and created_at < now() - make_interval(mins => c_grace_min);

  if v_late > 0 then
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
