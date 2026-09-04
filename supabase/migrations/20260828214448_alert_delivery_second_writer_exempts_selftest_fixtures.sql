-- BRANCH 3 exempts the mon_selftest_* fixtures. This exemption was EARNED, not assumed.
--
-- BRANCH 3 (previous migration) shipped and named exactly one writer on its first live run:
-- mon_selftest_raise_escalates(). Reading it: it inserts an alert under the synthetic dedup key
-- '__selftest__mon_raise_escalates', stamps dispatched_at on that row to simulate "already
-- delivered", asserts that mon_raise() re-arms dispatch when the alert escalates, then deletes the
-- row. It is a fixture exercising the mechanic, not a function claiming a delivery nobody made.
--
-- Keeping BRANCH 3 raising on it would have produced a P1 that is red on every sweep forever, and a
-- permanently-red alert is how the real one gets ignored. Needle-edited from the LIVE definition.

CREATE OR REPLACE FUNCTION public.mon_detect_alert_delivery()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_writers text[];
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

  ---------------------------------------------------------------------------
  -- BRANCH 3 (2026-08-28) -- dispatched_at must have exactly ONE writer.
  --
  -- BRANCH 2 asks "were these alerts delivered?" and reads dispatched_at to answer. That answer is
  -- only worth anything while dispatched_at means what the workflow makes it mean: a GitHub issue
  -- exists for this row. Any database function that stamps it instead marks alerts delivered that
  -- nobody was told about -- and BRANCH 2 then reads green over the silence. That is not a
  -- hypothetical: mon_dispatch_alerts() did exactly this until 2026-08-28, batch-stamping every
  -- open alert as soon as one webhook POST was ENQUEUED (net.http_post returns on enqueue, so even
  -- a 500 counted). It was inert only because ops_alert_channel has been empty since launch. One
  -- INSERT would have re-created the 41-day blackout with the monitoring still reading green.
  --
  -- Clearing dispatched_at is a different act and stays legal: mon_raise() nulls it to re-arm
  -- delivery when an open alert escalates. Only stamping a TIME is a delivery claim, so only
  -- `dispatched_at = now()` is matched here.
  ---------------------------------------------------------------------------
  select coalesce(array_agg(p.proname order by p.proname), '{}'::text[])
    into v_writers
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.prokind = 'f'
     -- EXEMPTION, EARNED ON THE FIRST LIVE RUN. BRANCH 3 named mon_selftest_raise_escalates(),
     -- which stamps dispatched_at on a row it creates and deletes under the synthetic dedup key
     -- '__selftest__mon_raise_escalates', to prove mon_raise() re-arms dispatch on escalation. A
     -- fixture exercising the mechanic is not a function claiming an undelivered alert was sent.
     -- WHAT THIS COSTS, stated plainly: a real stamp hidden inside a function named mon_selftest_*
     -- would not be seen here. Accepted, because the alternative is a P1 that is red on every
     -- sweep forever -- and an alert everyone has learned to ignore is how the real one gets past.
     and p.proname not like 'mon\_selftest\_%'
     -- COMMENTS ARE STRIPPED FIRST, and that is load-bearing rather than tidy. mon_dispatch_alerts()
     -- now carries a comment that QUOTES the banned stamp while explaining why it is gone. Matching
     -- the raw definition would read that prose as code and raise this alert forever -- the same
     -- documentation-instead-of-code trap recorded in scripts/lib/alertDelivery.ts. Leaving the
     -- quote in place is deliberate: it is the permanent live test that this stripping still works.
     and regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g')
         ~ 'dispatched_at\s*=\s*now\(\)';

  if array_length(v_writers, 1) > 0 then
    n := n + public.mon_raise('P1', 'alert_delivery', 'monitoring', 'alert_delivery_second_writer',
      jsonb_build_object(
        'writers', to_jsonb(v_writers),
        -- Worded to avoid the literal pattern this branch searches for. A string literal is not a
        -- comment, so the comment-stripping above would NOT save it, and this detector would flag
        -- itself forever. Quoting the pattern is safe in a comment and fatal in a string.
        'why', 'A database function stamps alert_event.dispatched_at with a wall-clock time. It is '
               'owned by .github/workflows/alert-dispatch.yml and means "a GitHub issue exists '
               'for this alert". A second writer marks alerts delivered that no human was told '
               'about, and BRANCH 2 of this detector then reads green over the silence -- the '
               'exact shape of the 2026-07-16 to 2026-08-26 P0 blackout.',
        'action', 'Remove the stamp from the listed function(s). If a second delivery channel is '
               'genuinely wanted, give it its OWN dispatched column first; do not share this one. '
               'Nulling dispatched_at (mon_raise re-arming an escalated alert) is legal and is '
               'deliberately not matched here.'));
  else
    perform public.mon_resolve_key('alert_delivery', 'alert_delivery_second_writer');
  end if;

  return n;
end $function$;