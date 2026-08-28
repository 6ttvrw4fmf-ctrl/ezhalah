-- Alert delivery: dispatched_at gets exactly one writer, and the detector notices if that changes.
--
-- ROOT CAUSE THIS CLOSES. mon_dispatch_alerts() batch-stamped alert_event.dispatched_at whenever a
-- webhook POST had been ENQUEUED, while .github/workflows/alert-dispatch.yml stamps the same column
-- per row to mean "a GitHub issue was filed". Two writers, one column, opposite meanings. Today the
-- SQL path is inert (ops_alert_channel: 0 rows since launch, mon_config.alert_webhook_url NULL), so
-- this migration is behaviour-neutral in production. One INSERT into ops_alert_channel would have
-- made it stamp every open alert as delivered with no issue filed anywhere, and
-- mon_detect_alert_delivery() -- which counts rows with dispatched_at IS NULL -- would have gone on
-- reporting green. That is the 41-day P0 blackout, re-armed and waiting.
--
-- Both functions below are needle-edited from pg_get_functiondef() of the LIVE objects; the builder
-- asserts each needle matched verbatim before emitting. Same argument list (none), so these are
-- replacements, not new overloads. No roster change: no new detector function is introduced --
-- BRANCH 3 lives inside the detector that already owns the alert_delivery kind, so
-- mon_run_all_detectors() already calls it.

CREATE OR REPLACE FUNCTION public.mon_dispatch_alerts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  hook text; deadman text; payload jsonb; n int := 0;
  batch bigint[];
  al record; ch record;
  delivered boolean := false;
begin
  select value into hook    from public.mon_config where key='alert_webhook_url';
  select value into deadman from public.mon_config where key='deadman_ping_url';

  -- snapshot the undispatched batch ONCE so the aggregate hook and the per-channel fan-out see
  -- the same rows, and the dispatched_at stamp below covers exactly what was sent (an alert
  -- raised concurrently mid-dispatch simply waits for the next run).
  select array_agg(id) into batch
  from public.alert_event where dispatched_at is null and resolved_at is null;

  if batch is not null then
    -- legacy aggregate webhook (Batch 0 behavior, now exception-guarded)
    if hook is not null then
      begin
        select jsonb_build_object(
                 'source','ezhalah-monitoring','sent_at',now(),
                 'open_alerts', (select count(*) from public.alert_event where resolved_at is null),
                 'new', coalesce(jsonb_agg(jsonb_build_object('sev',severity,'kind',kind,'platform',platform,'detail',detail)),'[]'::jsonb))
          into payload
          from public.alert_event where id = any(batch);
        perform net.http_post(url := hook, headers := '{"Content-Type":"application/json"}'::jsonb, body := payload);
        delivered := true;
      exception when others then
        raise notice 'mon_dispatch_alerts: aggregate webhook post failed (%), continuing', sqlerrm;
      end;
    end if;

    -- per-alert × per-channel fan-out — clean no-op when ops_alert_channel is empty
    begin
      for al in
        select id, severity, kind, platform, dedup_key, detail, created_at
        from public.alert_event where id = any(batch) order by id
      loop
        for ch in select id, webhook_url from public.ops_alert_channel where enabled order by id loop
          begin
            perform net.http_post(
              url     := ch.webhook_url,
              headers := '{"Content-Type":"application/json"}'::jsonb,
              body    := jsonb_build_object(
                'severity',  al.severity,
                'kind',      al.kind,
                'platform',  al.platform,
                'dedup_key', al.dedup_key,
                'detail',    al.detail,
                'raised_at', al.created_at));
            delivered := true;
          exception when others then
            raise notice 'mon_dispatch_alerts: channel % post failed (%), continuing', ch.id, sqlerrm;
          end;
        end loop;
      end loop;
    exception when others then
      raise notice 'mon_dispatch_alerts: channel fan-out failed (%), continuing', sqlerrm;
    end;

    -- dispatched_at IS NOT THIS FUNCTION'S COLUMN (2026-08-28).
    --
    -- It means "a GitHub issue exists for this alert", and .github/workflows/alert-dispatch.yml is
    -- its ONLY writer -- stamping each row individually, only after that row's `gh issue create`
    -- succeeded.
    --
    -- This function used to stamp it too, for the WHOLE batch, whenever any webhook post had been
    -- ENQUEUED. net.http_post returns on enqueue, not on response, so a webhook that 500s counted
    -- as delivered. Together that made a single INSERT into ops_alert_channel enough to silently
    -- re-create the 41-day blackout: every open alert marked dispatched, no GitHub issue filed for
    -- any of them, and mon_detect_alert_delivery() reading green because it counts rows with
    -- dispatched_at IS NULL. The table has been empty since launch, so removing this stamp changes
    -- nothing observable today -- it disarms a trap that was loaded and waiting for the first row.
    --
    -- The webhook fan-out above stays an UNBOOKKEPT MIRROR: best effort, no state, and it will
    -- re-post an unresolved alert on every run. If a webhook is ever meant to be a PRIMARY channel
    -- it needs its own dispatched column first. Do not restore the shared stamp --
    -- mon_detect_alert_delivery() BRANCH 3 raises P1 if any database function stamps
    -- dispatched_at = now() again.
    n := case when delivered then coalesce(array_length(batch, 1), 0) else 0 end;
  end if;

  begin
    if deadman is not null then perform net.http_get(url := deadman); end if;  -- "I'm alive"
  exception when others then
    raise notice 'mon_dispatch_alerts: dead-man ping failed (%), continuing', sqlerrm;
  end;
  return n;
end $function$;

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