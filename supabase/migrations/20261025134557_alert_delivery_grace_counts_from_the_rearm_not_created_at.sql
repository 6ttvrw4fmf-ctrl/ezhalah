-- 🔧 Quality & Repair 2026-10-25: a false «alert_delivery_undelivered» P1 (alert 11323, 12:59 UTC).
-- mon_raise() re-arms delivery when an open alert ESCALATES (dispatched_at := null, so the page fires again), which
-- is right. mon_detect_alert_delivery() BRANCH 2 then measured the 60-minute grace from created_at, so an alert
-- created hours ago that escalates reads «undelivered past the grace window» in the SAME sweep that re-armed it —
-- before the hourly :24 dispatch can run. Measured today: stale_active:haraj_residential_listings (11253) and
-- haraj_commercial (11254) were created 05:59, filed as GitHub issues #8604/#8605 at 06:24, escalated P2 → P1 at
-- 12:59 (dispatched_at nulled), raised this P1 at 12:59, and were re-filed at 13:38. Nothing was undelivered.
-- Fix: alert_event.rearmed_at records the re-arm moment (mon_raise writes it next to dispatched_at := null), and
-- BRANCH 2 measures the grace from greatest(created_at, rearmed_at). last_affirmed_at is NOT usable for this: every
-- sweep moves it, so a genuinely undelivered standing alert would never age past the grace.
-- Both directions proven on production in a rolled-back transaction (🔧 proof row 2026-10-25): a planted P1 row
-- created 2 h ago and re-armed 1 min ago raises 0; the same row with rearmed_at null raises 1.

alter table public.alert_event add column if not exists rearmed_at timestamptz;
comment on column public.alert_event.rearmed_at is
  'When mon_raise() last re-armed delivery for this open alert (an escalation nulls dispatched_at/acknowledged_at). mon_detect_alert_delivery measures its grace from greatest(created_at, rearmed_at). NULL = never re-armed.';

create or replace function public.mon_raise(p_sev text, p_kind text, p_platform text, p_dedup text, p_detail jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id bigint; v_sev text; v_escalated boolean;
begin
  select id, severity into v_id, v_sev
    from public.alert_event
   where dedup_key = p_dedup and resolved_at is null
   order by created_at desc
   limit 1;

  if v_id is null then
    insert into public.alert_event(severity, kind, platform, dedup_key, detail)
    values (p_sev, p_kind, p_platform, p_dedup, coalesce(p_detail,'{}'::jsonb));
    return 1;
  end if;

  -- Still exactly ONE open row per dedup key -- this is not alert spam. But an open alert must
  -- never go stale or under-report: refresh the payload every run so the dashboard shows today's
  -- numbers, and if the condition has got WORSE, promote the severity and re-arm both dispatch and
  -- acknowledgement so the escalation actually reaches a human. mon_dispatch_alerts() only sends
  -- rows with dispatched_at IS NULL, so clearing it is what makes the page happen.
  v_escalated := public.mon_sev_rank(p_sev) > public.mon_sev_rank(v_sev);

  update public.alert_event
     set detail          = coalesce(p_detail,'{}'::jsonb),
         -- The condition was just re-observed as still true. This is the ONLY writer of this
         -- column, and it writes only on the already-open path, which is what makes
         -- (last_affirmed_at > created_at) mean "a detector is still standing behind this alert".
         last_affirmed_at = now(),
         severity        = case when v_escalated then p_sev else severity end,
         dispatched_at   = case when v_escalated then null else dispatched_at end,
         acknowledged_at = case when v_escalated then null else acknowledged_at end,
         -- 2026-10-25: the re-arm moment, so mon_detect_alert_delivery() measures its grace from here,
         -- not from created_at (an escalated hours-old alert is not «undelivered» one second later).
         rearmed_at      = case when v_escalated then now() else rearmed_at end
   where id = v_id;

  return case when v_escalated then 1 else 0 end;
end $function$;

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
  -- 2026-10-25: the grace is measured from the LAST RE-ARM (alert_event.rearmed_at, written by
  -- mon_raise() when an escalation nulls dispatched_at), falling back to created_at. Measured from
  -- created_at alone, an hours-old alert that escalated read «undelivered» in the same sweep that
  -- re-armed it (stale_active:haraj_* on 2026-10-25: filed 06:24, escalated 12:59, false P1 12:59).
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
     and greatest(created_at, coalesce(rearmed_at, created_at)) < now() - make_interval(mins => c_grace_min);

  if v_late > 0 then
    select coalesce(jsonb_object_agg(severity, c), '{}'::jsonb)
      into v_sev
      from (select severity, count(*) c
              from public.alert_event
             where resolved_at is null
               and dispatched_at is null
               and severity = any(c_delivered)
               and greatest(created_at, coalesce(rearmed_at, created_at)) < now() - make_interval(mins => c_grace_min)
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
               and greatest(created_at, coalesce(rearmed_at, created_at)) < now() - make_interval(mins => c_grace_min)
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
     -- which stamps dispatched_at on a row it creates and removes under the synthetic dedup key
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