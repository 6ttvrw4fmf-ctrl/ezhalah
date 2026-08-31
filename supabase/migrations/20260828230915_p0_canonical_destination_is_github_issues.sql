-- THE CANONICAL P0 DESTINATION IS GITHUB ISSUES, VIA THE EXISTING DELIVERY ARCHITECTURE.
-- Owner decision, 2026-08-28: "I want the canonical P0 destination to be GitHub Issues for
-- engineering alerts, using the existing routing/ownership system ... Reuse the existing GitHub
-- alert delivery architecture. Do not build a second parallel ownership/routing system."
--
-- WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT.
-- The chain already exists and works: detector -> alert_event -> alert-dispatch.yml -> ONE GitHub
-- issue per dedup_key -> routing label -> assignee writes acknowledged_at -> auto-close on resolve.
-- None of that is rebuilt, replaced, or duplicated here. The ONLY thing that was broken is WHEN the
-- workflow runs: GitHub's `schedule` delivers ~11.7 runs/day against 48 scheduled, and even a
-- perfectly honoured '9,39 * * * *' means an alert raised at :29 waits until :39 -- 10 minutes,
-- twice the SLO, on paper.
--
-- So the fast lane stops being a webhook sender and becomes a TRIGGER for the existing workflow,
-- reusing the mechanism this repo already uses for every gh-* cron job: public.trigger_gh_workflow()
-- (vault-held PAT + net.http_post to the workflow dispatches endpoint). Same credential, same
-- transport, same workflow, same routing, same acknowledgement. One new channel row, no new system.
--
-- THE MISTAKE THIS MIGRATION IS BUILT TO AVOID.
-- A workflow dispatch returns 204 the moment GitHub ACCEPTS the request. That is not a delivered
-- alert -- it is the enqueue-vs-delivered distinction one level up, and it is exactly how this
-- repo's 41-day P0 blackout read green (a destination existed, so it counted). Therefore:
--   * for a 'github_workflow' channel the receipt in ops_p0_delivery records a TRIGGER, never a
--     delivery, and mon_detect_p0_delivery_sla() explicitly refuses to count it as one;
--   * the only accepted proof that a P0 reached a human is alert_event.dispatched_at, which
--     alert-dispatch.yml stamps ONLY after `gh issue create` has succeeded.
-- Getting this backwards would have made the SLO detector green while nothing was filed.
--
-- The alert-sink fixture is disabled here. It answers 200 and reaches nobody; the owner was explicit
-- that it must not count as satisfying P0 delivery. It stays in the table, disabled, as the negative
-- control the detector's human-reaching predicate is written against.

-- Fail fast rather than hang behind the twice-hourly detector sweep (learned the hard way in
-- 20260828220456: a blocked apply looks identical to a failed one, and re-running double-applies).
set local lock_timeout = '15s';

-- The real destination. The URL lives here; the CREDENTIAL never does -- it is read from Vault at
-- send time, exactly as trigger_gh_workflow() has done since 2026-07-08. A PAT sitting in a plain
-- ops table would be a worse secret posture than the one we already have.
insert into public.ops_alert_channel (kind, webhook_url, enabled, note, headers)
values (
  'github_workflow',
  'https://api.github.com/repos/6ttvrw4fmf-ctrl/ezhalah/actions/workflows/alert-dispatch.yml/dispatches',
  true,
  'CANONICAL P0 DESTINATION (owner, 2026-08-28). Triggers the existing alert-dispatch.yml, which '
  'files one GitHub issue per dedup_key, applies the routing/ownership label, accepts an assignee '
  'as acknowledgement and auto-closes on resolve. The PAT is read from Vault at send time and is '
  'NEVER stored in this table. A 204 here means the workflow was accepted, NOT that an alert was '
  'delivered -- only alert_event.dispatched_at proves an issue was filed.',
  '{}'::jsonb
)
on conflict do nothing;

-- Retire the proof fixture: it reaches no human and the owner ruled it cannot count.
update public.ops_alert_channel
   set enabled = false,
       note = note || ' [DISABLED 2026-08-28: superseded by the github_workflow channel. Kept as the '
                   || 'negative control for the human-reaching predicate.]'
 where webhook_url like '%/functions/v1/alert-sink%' and enabled;

-------------------------------------------------------------------------------
-- Dispatcher: trigger the existing workflow for github_workflow channels.
-------------------------------------------------------------------------------
create or replace function public.mon_dispatch_p0_fast()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $function$
declare
  c_max_attempts int := 3;
  -- A workflow run takes ~40s. Re-triggering every minute while one is in flight would hammer
  -- Actions and race its own concurrency group for no benefit.
  c_retrigger_after interval := interval '3 minutes';
  v_posted   int := 0;
  v_settled  int := 0;
  v_pending  int;
  al  record;
  ch  record;
  rid bigint;
  tok text;
begin
  -- (1) RECONCILE FIRST, so the SLA detector reads real status codes rather than "http_post was
  --     called". net.http_post returns on ENQUEUE; the outcome lands in net._http_response.
  update public.ops_p0_delivery d
     set status_code = r.status_code,
         settled_at  = r.created
    from net._http_response r
   where r.id = d.request_id
     and d.settled_at is null;
  get diagnostics v_settled = row_count;

  -- (2) Cheap exit on the overwhelming majority of minutes (2026-08-10 stampede lesson).
  --     Only P0s that have NOT yet produced a GitHub issue are worth acting on.
  select count(*) into v_pending
    from public.alert_event a
   where a.severity = 'P0'
     and a.resolved_at is null
     and a.dispatched_at is null
     and exists (select 1 from public.ops_alert_channel c where c.enabled);
  if v_pending = 0 then
    return jsonb_build_object('posted', 0, 'settled', v_settled, 'pending_p0', 0);
  end if;

  for al in
    select a.id, a.severity, a.kind, a.platform, a.dedup_key, a.detail, a.created_at
      from public.alert_event a
     where a.severity = 'P0' and a.resolved_at is null and a.dispatched_at is null
     order by a.created_at
  loop
    for ch in select c.id, c.kind, c.webhook_url, c.headers
                from public.ops_alert_channel c where c.enabled order by c.id
    loop
      if ch.kind = 'github_workflow' then
        -- Skip while a trigger is in flight, recently fired, or the attempt cap is spent.
        if exists (
          select 1 from public.ops_p0_delivery d
           where d.alert_id = al.id and d.channel_id = ch.id
             and (d.attempts >= c_max_attempts
                  or d.last_tried > now() - c_retrigger_after
                  or (d.settled_at is null and d.request_id is not null))
        ) then
          continue;
        end if;

        select decrypted_secret into tok from vault.decrypted_secrets
         where name = any(array['github', 'github_pat']) limit 1;
        if tok is null then
          raise notice 'mon_dispatch_p0_fast: no GitHub PAT in Vault; cannot trigger %', ch.webhook_url;
          continue;
        end if;

        begin
          select net.http_post(
            url     := ch.webhook_url,
            headers := jsonb_build_object(
                         'Authorization',         'Bearer ' || tok,
                         'Accept',                'application/vnd.github+json',
                         'X-GitHub-Api-Version',  '2022-11-28',
                         'User-Agent',            'ezhalah-p0-fast-dispatch',
                         'Content-Type',          'application/json'),
            body    := jsonb_build_object('ref', 'main'))
            into rid;

          insert into public.ops_p0_delivery (alert_id, channel_id, request_id, attempts, last_tried)
          values (al.id, ch.id, rid, 1, now())
          on conflict (alert_id, channel_id) do update
            set request_id = excluded.request_id,
                attempts   = public.ops_p0_delivery.attempts + 1,
                last_tried = now(), status_code = null, settled_at = null;
          v_posted := v_posted + 1;
        exception when others then
          insert into public.ops_p0_delivery (alert_id, channel_id, attempts, last_tried)
          values (al.id, ch.id, 1, now())
          on conflict (alert_id, channel_id) do update
            set attempts = public.ops_p0_delivery.attempts + 1, last_tried = now();
          raise notice 'mon_dispatch_p0_fast: workflow trigger failed (%), continuing', sqlerrm;
        end;

      else
        -- Plain webhook channel: a 2xx here IS the delivery.
        if exists (
          select 1 from public.ops_p0_delivery d
           where d.alert_id = al.id and d.channel_id = ch.id
             and ((d.status_code between 200 and 299) or d.attempts >= c_max_attempts
                  or (d.settled_at is null and d.request_id is not null))
        ) then
          continue;
        end if;

        begin
          select net.http_post(
            url     := ch.webhook_url,
            headers := '{"Content-Type":"application/json"}'::jsonb || coalesce(ch.headers, '{}'::jsonb),
            body    := jsonb_build_object(
                         'severity', al.severity, 'kind', al.kind, 'platform', al.platform,
                         'dedup_key', al.dedup_key, 'detail', al.detail,
                         'raised_at', al.created_at, 'sla', '5m'))
            into rid;

          insert into public.ops_p0_delivery (alert_id, channel_id, request_id, attempts, last_tried)
          values (al.id, ch.id, rid, 1, now())
          on conflict (alert_id, channel_id) do update
            set request_id = excluded.request_id,
                attempts   = public.ops_p0_delivery.attempts + 1,
                last_tried = now(), status_code = null, settled_at = null;
          v_posted := v_posted + 1;
        exception when others then
          insert into public.ops_p0_delivery (alert_id, channel_id, attempts, last_tried)
          values (al.id, ch.id, 1, now())
          on conflict (alert_id, channel_id) do update
            set attempts = public.ops_p0_delivery.attempts + 1, last_tried = now();
          raise notice 'mon_dispatch_p0_fast: channel % post failed (%), continuing', ch.id, sqlerrm;
        end;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('posted', v_posted, 'settled', v_settled, 'pending_p0', v_pending);
end $function$;

-------------------------------------------------------------------------------
-- Detector: a 204 from a workflow trigger is NOT a delivered alert.
-------------------------------------------------------------------------------
create or replace function public.mon_detect_p0_delivery_sla()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- OWNER-SET, 2026-08-28. Not an engineering tuning knob. If this raises, the delivery path is
  -- what changes -- never this number.
  c_sla_minutes int := 5;
  v_channels    int;
  v_human       int;
  v_open_p0     int;
  v_breached    int;
  v_sample      jsonb;
  v_worst       numeric;
  n int := 0;
begin
  select count(*) into v_channels from public.ops_alert_channel where enabled;
  -- A channel that reaches nobody cannot satisfy an SLO about reaching somebody. alert-sink answers
  -- 200 and does nothing else; a github_workflow channel files an issue a human is assigned to.
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

  -- DELIVERED means an issue exists. alert_event.dispatched_at is stamped by alert-dispatch.yml
  -- ONLY after `gh issue create` succeeds, so it is the one trustworthy signal. A 2xx receipt counts
  -- only for a plain webhook channel, where the POST itself IS the delivery. A 'github_workflow'
  -- receipt is a TRIGGER ACCEPTED (204) and is explicitly excluded: counting it would mark alerts
  -- delivered the instant GitHub accepted a dispatch, which is the enqueue-vs-delivered mistake that
  -- produced the 41-day blackout, moved one layer up.
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
        'action', 'Check mon-p0-fast-dispatch is active, then the Alert dispatch workflow runs, then '
            || 'ops_p0_delivery.status_code / net._http_response. Fix the PATH. Never widen '
            || 'c_sla_minutes and never hand-stamp dispatched_at.'));
  else
    perform public.mon_resolve_key('p0_delivery_sla', 'p0_delivery_sla_breach');
  end if;

  return n;
end $function$;
