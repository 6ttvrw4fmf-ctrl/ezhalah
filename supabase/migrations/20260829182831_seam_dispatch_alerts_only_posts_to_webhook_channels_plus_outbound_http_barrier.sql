-- Systems Seam Engineer, 2026-08-29.
-- SEAM: alert_event -> notification delivery.
--
-- BUG (proven in production, root cause matched to the exact request count):
-- mon_dispatch_alerts() has a per-alert x per-channel fan-out that posts to ch.webhook_url with
-- headers '{"Content-Type":"application/json"}' and NOTHING ELSE. It was written for plain webhook
-- sinks, and it loops over EVERY enabled row in ops_alert_channel regardless of kind.
--
-- On 2026-08-28 the owner made a 'github_workflow' channel the canonical P0 destination:
--   id 2, https://api.github.com/repos/6ttvrw4fmf-ctrl/ezhalah/actions/workflows/alert-dispatch.yml/dispatches
-- That is the GitHub REST workflow-dispatch endpoint. It needs a Bearer PAT (read from Vault at
-- send time) and a body of {"ref":"main"}. The fan-out sends an alert-shaped JSON body with no
-- Authorization header at all, so GitHub answers 401 "Requires authentication" -- every alert,
-- every sweep, forever.
--
-- Measured, not inferred. net._http_response over its full retained window (16:15-18:24 UTC):
--   204 x9  -- trigger_gh_workflow() from the gh-* cron jobs, at exact cron minutes. Healthy.
--   401 x9  -- at 16:32:32, 17:04:36, 17:32:18, 18:03:29: each is sweep-start + that sweep's
--              measured runtime, i.e. the tail of jobid 38 where mon_dispatch_alerts() runs.
-- The 401 count per sweep equals the number of open undispatched alerts at that moment (2, 2, 2,
-- then 3 after af_parity_empirical was raised at 17:43) -- one failed POST per alert, exactly as
-- the fan-out loop would produce.
--
-- Two harms, and the second is the one that makes this a seam bug rather than litter:
--   1. ~100-150 unauthenticated GitHub API calls a day from the database. Unauthenticated requests
--      are rate-limited by IP (60/hour), and the SAME IP carries the trigger_gh_workflow() calls
--      that dispatch every scraper sweep AND the P0 fast lane. This burns a shared budget the real
--      delivery path depends on.
--   2. net.http_post returns on ENQUEUE, so a 401 never raises -- the exception guard never fires,
--      `delivered` is set true, and the function RETURNS a non-zero delivered count for alerts that
--      reached nobody. A dispatcher reporting success for undelivered alerts is the exact shape of
--      the 41-day P0 blackout this file already carries scar tissue about.
--
-- FIX: the plain-webhook fan-out handles plain webhook channels only, as a POSITIVE allowlist on
-- kind = 'webhook' -- so a channel kind added later cannot silently inherit webhook-shaped posts
-- either. This loses no delivery: mon_dispatch_alerts() never once delivered to the github_workflow
-- channel (every attempt 401'd). That channel is served by the gh-alert-dispatch-backstop cron
-- (:24, trigger_gh_workflow('alert-dispatch.yml'), 204) and by mon_dispatch_p0_fast(), both of
-- which read the PAT from Vault and post the {"ref":"main"} body the endpoint actually expects.
-- Note mon_dispatch_p0_fast() already branches on ch.kind = 'github_workflow' correctly -- this
-- function is the one that never learned the distinction.

CREATE OR REPLACE FUNCTION public.mon_dispatch_alerts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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

    -- per-alert x per-channel fan-out.
    --
    -- kind = 'webhook' ONLY, and deliberately as a positive allowlist rather than
    -- "kind <> 'github_workflow'". This block speaks exactly one protocol: POST the alert as JSON,
    -- no auth, a 2xx is the delivery. A channel whose kind means anything else does not belong
    -- here, and a channel kind invented next year must opt IN rather than silently inherit this.
    --
    -- A 'github_workflow' channel is NOT a webhook sink: its URL is the GitHub REST
    -- workflow-dispatch endpoint, which requires a Bearer PAT from Vault and a {"ref":"main"} body.
    -- Posting an alert payload to it unauthenticated returned 401 on every attempt (see the header
    -- comment). It is delivered by gh-alert-dispatch-backstop (:24) and mon_dispatch_p0_fast(),
    -- which both do that correctly. Do not "fix" this by adding a token here -- one alert-shaped
    -- POST per alert is still the wrong request for that endpoint, and the right one is already
    -- being made elsewhere.
    begin
      for al in
        select id, severity, kind, platform, dedup_key, detail, created_at
        from public.alert_event where id = any(batch) order by id
      loop
        for ch in select id, webhook_url, headers from public.ops_alert_channel
                   where enabled and kind = 'webhook' order by id loop
          begin
            perform net.http_post(
              url     := ch.webhook_url,
              headers := '{"Content-Type":"application/json"}'::jsonb || coalesce(ch.headers, '{}'::jsonb),
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
    -- dispatched_at IS NULL. Do not restore the shared stamp --
    -- mon_detect_alert_delivery() BRANCH 3 raises P1 if any database function stamps
    -- dispatched_at = now() again.
    --
    -- The webhook fan-out above stays an UNBOOKKEPT MIRROR: best effort, no state, and it will
    -- re-post an unresolved alert on every run. If a webhook is ever meant to be a PRIMARY channel
    -- it needs its own dispatched column first. And note what `delivered` still does NOT mean:
    -- net.http_post returns on ENQUEUE, so this is "a request was queued", never "a human was
    -- told". mon_detect_outbound_http_failures() below is what reads the actual outcome.
    n := case when delivered then coalesce(array_length(batch, 1), 0) else 0 end;
  end if;

  begin
    if deadman is not null then perform net.http_get(url := deadman); end if;  -- "I'm alive"
  exception when others then
    raise notice 'mon_dispatch_alerts: dead-man ping failed (%), continuing', sqlerrm;
  end;
  return n;
end $fn$;


-- THE BARRIER
-- Nothing in this system read net._http_response for FAILURES. That is the whole reason a 401 on
-- every alert delivery, on every sweep, ran unnoticed: pg_net is fire-and-forget by design --
-- net.http_post returns on enqueue, the PL/pgSQL exception guard never fires on an HTTP error
-- status, and the response lands in a table no detector opened. Every "the request was sent"
-- signal in this database is therefore an enqueue receipt, not a delivery receipt.
--
-- This detector reads the receipts. It is deliberately generic: it does not know or care which
-- function made the call, so it covers alert delivery, trigger_gh_workflow(), the P0 fast lane,
-- the refresh-listings edge function and the dead-man ping alike -- including callers written
-- after it. A status_code that is NULL counts as a failure too: that is a transport error or a
-- timeout, which is exactly the case a status-code check alone would score as "no news".
--
-- Threshold is 3 failures in 6 hours, not 1: a single transient 5xx from any one endpoint is
-- noise, a repeating one is a broken handoff. 6h is also about as far back as pg_net's own
-- retention reaches, so this reads all the evidence there is rather than a window someone chose.
CREATE OR REPLACE FUNCTION public.mon_detect_outbound_http_failures()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net'
AS $fn$
declare
  n int := 0;
  v_fail int;
  v_ok int;
  v_breakdown jsonb;
  v_window constant interval := interval '6 hours';
  c_min_failures constant int := 3;
begin
  select count(*) filter (where r.status_code is null or r.status_code < 200 or r.status_code > 399),
         count(*) filter (where r.status_code between 200 and 399)
    into v_fail, v_ok
    from net._http_response r
   where r.created > now() - v_window;

  select coalesce(jsonb_agg(x order by x->>'status'), '[]'::jsonb) into v_breakdown
    from (
      select jsonb_build_object(
               'status', coalesce(r.status_code::text, 'transport_error'),
               'count',  count(*),
               'first',  min(r.created),
               'last',   max(r.created),
               'sample_error', left(coalesce(max(r.error_msg), max(r.content)), 200)) as x
        from net._http_response r
       where r.created > now() - v_window
         and (r.status_code is null or r.status_code < 200 or r.status_code > 399)
       group by coalesce(r.status_code::text, 'transport_error')
    ) g;

  if v_fail >= c_min_failures then
    n := public.mon_raise('P1', 'outbound_http_failure', 'all', 'outbound_http_failure',
      jsonb_build_object(
        'failures_6h', v_fail,
        'successes_6h', v_ok,
        'breakdown', v_breakdown,
        'why', 'The database is making outbound HTTP calls that are FAILING, and nothing else in '
            || 'this system would notice. pg_net is fire-and-forget: net.http_post returns on '
            || 'ENQUEUE, an HTTP error status never raises, and the real outcome lands here in '
            || 'net._http_response. So every "sent" signal upstream -- a dispatcher return count, '
            || 'a cron job marked succeeded -- is an enqueue receipt, not a delivery receipt. If '
            || 'these calls are alert deliveries, alerts are reaching nobody while every upstream '
            || 'indicator reads green.',
        'adjudicate', 'Match the failure timestamps to their callers: an exact cron minute is a '
            || 'trigger_gh_workflow() call from that job; sweep-start plus that sweep runtime is '
            || 'the tail of jobid 38 (mon_dispatch_alerts / mon_dispatch_p0_fast). 401 means the '
            || 'request carried no usable credential -- check whether the caller sends an '
            || 'Authorization header at all, not just whether the Vault secret exists. 404 on a '
            || 'GitHub URL usually means the endpoint is right but the method or path is not.',
        'do_not', 'Do NOT raise the threshold or shorten the window to make this quiet, and do NOT '
            || 'assume a failing call is harmless because the alert also has another delivery '
            || 'path. Unauthenticated GitHub calls are rate-limited by IP (60/hour) on the SAME IP '
            || 'that carries trigger_gh_workflow() for every scraper sweep and the P0 fast lane, so '
            || 'wasted failures burn a budget the real delivery path depends on.'));
  else
    perform public.mon_resolve_key('outbound_http_failure', 'outbound_http_failure');
  end if;

  return n;
end $fn$;


-- ROSTER -- needle edit of the LIVE mon_run_all_detectors(), same migration as the detector.
do $mig$
declare src text; newsrc text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors() not found -- refusing to guess a roster';
  end if;

  if position('mon_detect_outbound_http_failures' in src) > 0 then
    raise notice 'mon_detect_outbound_http_failures already on the roster -- nothing to do';
    return;
  end if;

  if (select count(*) from regexp_matches(src, '''mon_detect_alert_delivery''', 'g')) <> 1 then
    raise exception 'anchor mon_detect_alert_delivery not found exactly once in the live roster';
  end if;

  newsrc := replace(src,
    '''mon_detect_alert_delivery''',
    '''mon_detect_alert_delivery'',' || chr(10) || '    ''mon_detect_outbound_http_failures''');

  if newsrc = src then
    raise exception 'needle edit produced no change -- refusing to re-create the roster unchanged';
  end if;

  execute newsrc;
end
$mig$;

do $chk$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'mon_run_all_detectors'
       and position('mon_detect_outbound_http_failures' in pg_get_functiondef(p.oid)) > 0)
  then
    raise exception 'mon_detect_outbound_http_failures is NOT on the roster after the edit';
  end if;
  -- the previous migration in this session must still be on the roster too: a needle edit built
  -- from a stale body would have silently dropped it, and that is precisely what this pattern
  -- exists to prevent.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'mon_run_all_detectors'
       and position('mon_detect_stuck_open_alert' in pg_get_functiondef(p.oid)) > 0)
  then
    raise exception 'mon_detect_stuck_open_alert fell off the roster -- stale-body edit detected';
  end if;
end
$chk$;
