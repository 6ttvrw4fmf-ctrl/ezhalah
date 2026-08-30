-- P0 DELIVERY IN UNDER 5 MINUTES (owner SLO, 2026-08-28).
--
-- THE OWNER DECISION THIS IMPLEMENTS. "P0 alerts must be delivered within 5 minutes of detection.
-- Do not loosen detectors to match slower reality. If the current GitHub delivery path cannot meet
-- that SLO, investigate and fix the delivery mechanism, then prove it end-to-end with a safe
-- synthetic P0." Full statement and rationale: docs/ops/SYSTEMS_SEAM_ENGINEER.md PART 1.
--
-- WHY THE EXISTING PATH CANNOT MEET IT, MEASURED RATHER THAN ASSUMED.
-- .github/workflows/alert-dispatch.yml is scheduled '9,39 * * * *'. Even if GitHub honoured that
-- exactly, an alert raised at :29 waits until :39 -- 10 minutes, TWICE THE SLO, on paper. It does
-- not honour it: over the 61.6h to 2026-08-28T11:12Z it ran 30 times against 288 scheduled
-- (11.7/day vs 48/day), essentially never at :09 or :39, gaps of 11.3h / 11.1h / 9.4h. Real cost:
-- P0 alert 1011 took 2h47m to reach a human; P1 1058 took 6h14m. A hand-triggered workflow_dispatch
-- delivers in ~30s (alert 1070, 21:49 today) -- which proves the WORKFLOW is fast and the SCHEDULER
-- is the defect. A manual run is not evidence the SLO is met.
--
-- THE FIX: push from inside the database, where the cadence is ours. pg_cron runs every minute and
-- pg_net POSTs. Nothing here touches alert-dispatch.yml, which stays exactly as it is as the
-- durable GitHub-issue record; this is a fast lane in front of it, not a replacement.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. It never stamps alert_event.dispatched_at. That column has
-- exactly one writer (alert-dispatch.yml, meaning "a GitHub issue exists"), and
-- mon_detect_alert_delivery() BRANCH 3 raises P1 on any database function that stamps it -- landed
-- hours ago in a concurrent session's work. Receipts therefore live in their own ledger,
-- ops_p0_delivery. Reading dispatched_at is fine and this does read it; stamping it is not.
--
-- THE DESTINATION IS STILL AN OWNER INPUT. ops_alert_channel decides who actually gets woken. The
-- alert-sink edge function is a proof fixture with no side effects that reaches no human, so
-- mon_detect_p0_delivery_sla() raises if it is the only channel configured. Meeting the SLO into a
-- sink is not meeting the SLO.

-- FAIL FAST RATHER THAN HANG. ops_p0_delivery carries a foreign key to alert_event, and creating
-- it needs SHARE ROW EXCLUSIVE on that table -- which conflicts with the ROW EXCLUSIVE the
-- twice-hourly detector sweep holds while mon_raise() writes alerts. Learned by doing: the first
-- attempt at this migration sat blocked behind the 21:59 sweep, the MCP client timed out at 60s,
-- and the natural next move -- assuming it failed and re-running it -- would have double-applied
-- everything (two cron jobs, two roster entries). A lock_timeout turns that silent hang into an
-- immediate, unambiguous error. Apply between sweeps (:04-:28 or :34-:58) if it trips.
set local lock_timeout = '15s';

create table if not exists public.ops_p0_delivery (
  alert_id     bigint      not null references public.alert_event(id) on delete cascade,
  channel_id   bigint      not null,
  request_id   bigint,
  attempts     integer     not null default 0,
  first_tried  timestamptz not null default now(),
  last_tried   timestamptz not null default now(),
  status_code  integer,
  settled_at   timestamptz,
  primary key (alert_id, channel_id)
);

comment on table public.ops_p0_delivery is
  'Delivery receipts for the 5-minute P0 SLO (owner, 2026-08-28). One row per (alert, channel). '
  'Deliberately NOT alert_event.dispatched_at, which has exactly one writer (alert-dispatch.yml) '
  'guarded by mon_detect_alert_delivery() BRANCH 3. status_code is filled in by reconciling '
  'net._http_response -- net.http_post returns on ENQUEUE, so a request_id alone proves nothing.';

alter table public.ops_p0_delivery enable row level security;
revoke all on public.ops_p0_delivery from anon, authenticated;

create index if not exists ops_p0_delivery_unsettled
  on public.ops_p0_delivery (settled_at) where settled_at is null;

-- Per-channel auth, rather than one global key in mon_config. Different destinations authenticate
-- differently (a Supabase function wants apikey + Bearer; Slack wants neither and would just be
-- handed a credential it has no business seeing). Additive with a default, so the concurrent
-- session's work against this table is unaffected.
alter table public.ops_alert_channel
  add column if not exists headers jsonb not null default '{}'::jsonb;

comment on column public.ops_alert_channel.headers is
  'Extra request headers for this destination, merged over Content-Type by mon_dispatch_p0_fast(). '
  'Keep secrets OUT of here unless the destination genuinely needs one: the alert-sink fixture uses '
  'the PUBLISHABLE key, which already ships inside the served web bundle.';

-------------------------------------------------------------------------------
-- The fast lane itself.
-------------------------------------------------------------------------------
create or replace function public.mon_dispatch_p0_fast()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- Bounded retries. A channel that is down must NOT produce a POST every minute forever: that is
  -- a retry storm aimed at whoever is already having a bad day. Three attempts, then stop and let
  -- mon_detect_p0_delivery_sla() raise -- a visible failure beats an invisible flood.
  c_max_attempts int := 3;
  v_posted   int := 0;
  v_settled  int := 0;
  v_pending  int;
  al  record;
  ch  record;
  rid bigint;
begin
  -- (1) RECONCILE FIRST. Fill in outcomes for anything already in flight, so the SLA detector reads
  --     real status codes rather than "we called http_post once".
  update public.ops_p0_delivery d
     set status_code = r.status_code,
         settled_at  = r.created
    from net._http_response r
   where r.id = d.request_id
     and d.settled_at is null;
  get diagnostics v_settled = row_count;

  -- (2) Cheap exit. This runs every minute; on the overwhelming majority of minutes there is
  --     nothing to do and it must cost almost nothing (2026-08-10 stampede lesson).
  select count(*) into v_pending
    from public.alert_event a
   where a.severity = 'P0'
     and a.resolved_at is null
     and exists (select 1 from public.ops_alert_channel c where c.enabled);
  if v_pending = 0 then
    return jsonb_build_object('posted', 0, 'settled', v_settled, 'pending_p0', 0);
  end if;

  -- (3) POST each open P0 to each enabled channel that has not already taken it.
  for al in
    select a.id, a.severity, a.kind, a.platform, a.dedup_key, a.detail, a.created_at
      from public.alert_event a
     where a.severity = 'P0' and a.resolved_at is null
     order by a.created_at
  loop
    for ch in select c.id, c.webhook_url, c.headers from public.ops_alert_channel c where c.enabled order by c.id
    loop
      -- Skip if already delivered (2xx) or already out of attempts.
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
                       'severity',  al.severity,
                       'kind',      al.kind,
                       'platform',  al.platform,
                       'dedup_key', al.dedup_key,
                       'detail',    al.detail,
                       'raised_at', al.created_at,
                       'sla',       '5m'))
          into rid;

        insert into public.ops_p0_delivery (alert_id, channel_id, request_id, attempts, last_tried)
        values (al.id, ch.id, rid, 1, now())
        on conflict (alert_id, channel_id) do update
          set request_id = excluded.request_id,
              attempts   = public.ops_p0_delivery.attempts + 1,
              last_tried = now(),
              status_code = null,
              settled_at  = null;
        v_posted := v_posted + 1;
      exception when others then
        -- Record the attempt even when the POST could not be enqueued, so attempts still climbs
        -- and a permanently broken channel exhausts rather than looping.
        insert into public.ops_p0_delivery (alert_id, channel_id, attempts, last_tried)
        values (al.id, ch.id, 1, now())
        on conflict (alert_id, channel_id) do update
          set attempts = public.ops_p0_delivery.attempts + 1, last_tried = now();
        raise notice 'mon_dispatch_p0_fast: channel % post failed (%), continuing', ch.id, sqlerrm;
      end;
    end loop;
  end loop;

  return jsonb_build_object('posted', v_posted, 'settled', v_settled, 'pending_p0', v_pending);
end $function$;

-------------------------------------------------------------------------------
-- The detector that holds the SLO to 5 minutes and cannot be quietly widened.
-------------------------------------------------------------------------------
create or replace function public.mon_detect_p0_delivery_sla()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- OWNER-SET, 2026-08-28. Not an engineering tuning knob. If this starts raising, the delivery
  -- path is what changes -- never this number. Raising it to make a sweep green is precisely the
  -- "loosen the detector to match slower reality" the owner forbade.
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
  -- A channel that reaches nobody does not satisfy an SLO about reaching somebody. alert-sink is
  -- this repo's proof fixture: it answers 200 and does nothing else, on purpose.
  select count(*) into v_human from public.ops_alert_channel
   where enabled and webhook_url not like '%/functions/v1/alert-sink%';
  select count(*) into v_open_p0 from public.alert_event where severity = 'P0' and resolved_at is null;

  ---------------------------------------------------------------------------
  -- BRANCH 1 -- the SLO is structurally unmeetable: nothing is configured to receive a P0, or the
  -- only thing configured is the proof sink.
  ---------------------------------------------------------------------------
  if v_channels = 0 or v_human = 0 then
    n := n + public.mon_raise('P1', 'p0_delivery_sla', 'monitoring', 'p0_delivery_no_human_channel',
      jsonb_build_object(
        'enabled_channels', v_channels,
        'human_reaching_channels', v_human,
        'open_p0', v_open_p0,
        'sla_minutes', c_sla_minutes,
        'why', 'The owner SLO (2026-08-28) is that a P0 reaches its destination within 5 minutes. '
            || 'The fast-dispatch mechanism is in place and proven, but no channel that reaches a '
            || 'HUMAN is configured -- either ops_alert_channel is empty, or the only enabled row '
            || 'is the alert-sink proof fixture, which answers 200 and deliberately does nothing '
            || 'else. Meeting the SLO into a sink is not meeting the SLO.',
        'action', 'OWNER INPUT: insert a real destination (on-call webhook / Slack / PagerDuty) '
            || 'into ops_alert_channel. Do NOT satisfy this by pointing it at alert-sink, and do '
            || 'NOT widen c_sla_minutes.'));
  else
    perform public.mon_resolve_key('p0_delivery_sla', 'p0_delivery_no_human_channel');
  end if;

  ---------------------------------------------------------------------------
  -- BRANCH 2 -- a P0 actually blew the 5 minutes. Delivered means a 2xx receipt from the fast lane
  -- OR a GitHub issue (dispatched_at). Reading dispatched_at is legal; stamping it is not, and this
  -- function never does -- see mon_detect_alert_delivery() BRANCH 3.
  ---------------------------------------------------------------------------
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
        where d.alert_id = a.id and d.status_code between 200 and 299);

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
                                where d.alert_id = a.id and d.status_code between 200 and 299)
             order by a.created_at limit 10) a;

    n := n + public.mon_raise('P0', 'p0_delivery_sla', 'monitoring', 'p0_delivery_sla_breach',
      jsonb_build_object(
        'breached_count', v_breached,
        'worst_minutes', v_worst,
        'sla_minutes', c_sla_minutes,
        'sample', v_sample,
        'why', 'A P0 has gone past the owner''s 5-minute delivery SLO with neither a 2xx receipt in '
            || 'ops_p0_delivery nor a GitHub issue (dispatched_at). Note the recursive trap: if the '
            || 'channel is down this alert cannot be delivered either, which is why '
            || 'mon_run_all_detectors().open_alerts must be read directly and never inferred from a '
            || 'quiet inbox.',
        'action', 'Check mon-p0-fast-dispatch (cron) is active and running every minute, then read '
            || 'ops_p0_delivery.status_code and net._http_response for the real outcome. Fix the '
            || 'PATH. Never widen c_sla_minutes and never hand-insert a receipt.'));
  else
    perform public.mon_resolve_key('p0_delivery_sla', 'p0_delivery_sla_breach');
  end if;

  return n;
end $function$;

-------------------------------------------------------------------------------
-- Wire the detector into the roster IN THIS SAME MIGRATION, needle-edited from the LIVE definition.
-- A concurrent session edited this same roster twice today; building from pg_get_functiondef() is
-- what stops one of us silently dropping the other's detector.
-------------------------------------------------------------------------------
do $wire$
declare
  v_def    text;
  v_anchor text := $a$    'mon_detect_alert_dispatch_silent',$a$;
  v_new    text := $a$    'mon_detect_alert_dispatch_silent',
    'mon_detect_p0_delivery_sla',$a$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors'
   limit 1;

  if v_def is null then
    raise exception 'mon_run_all_detectors() not found -- refusing to wire a detector nothing reaches';
  end if;
  if position('mon_detect_p0_delivery_sla' in v_def) > 0 then
    raise notice 'already on the roster, nothing to do';
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'roster anchor not found -- re-derive the needle edit by hand rather than guessing';
  end if;

  execute replace(v_def, v_anchor, v_new);
end $wire$;

do $verify$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors' limit 1;
  if position('mon_detect_p0_delivery_sla' in v_def) = 0 then
    raise exception 'roster edit did not take -- mon_detect_p0_delivery_sla is not reachable';
  end if;
end $verify$;

-------------------------------------------------------------------------------
-- The every-minute fast lane. This is what actually buys the 5 minutes: the detector sweep raises
-- a P0 at :29/:59, and this picks it up within ~60s instead of waiting for a GitHub schedule that
-- measured 11.7 runs/day. It is deliberately cheap -- one indexed count and an early return on the
-- overwhelming majority of minutes where there is no open P0.
-------------------------------------------------------------------------------
select cron.schedule('mon-p0-fast-dispatch', '* * * * *', $cron$select public.mon_dispatch_p0_fast();$cron$);
