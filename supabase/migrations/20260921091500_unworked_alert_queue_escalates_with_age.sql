-- AN UNWORKED ALERT QUEUE MUST GET LOUDER THE LONGER IT ROTS -- BUT AS ONE SIGNAL, NOT EIGHT.
--
-- WHY (owner audit, 2026-09-21). mon_detect_alert_queue_unworked() already names each routine that
-- is not working its queue (P1, or P0 if that owner's batch contains a P0). But it had NO sense of
-- AGE: an owner whose oldest unacked alert was 48 hours old and one whose oldest was 41 DAYS old
-- produced the identical P1. Measured 2026-09-21: EIGHT owners have unworked queues, oldest ranging
-- 14 to 41 days; 108 open alerts are older than 7 days; system-wide, 2 of 1,014 alerts have ever
-- been acknowledged. Detection is excellent; remediation is the weak link, and the one lever meant
-- to force remediation could not tell 41-day neglect from a fresh miss.
--
-- WHY A ROLL-UP, NOT A PER-OWNER RATCHET. The obvious fix -- promote each stale owner's alert to P0
-- -- would have raised EIGHT P0s at once, because the whole queue is chronic. Eight P0s is not
-- triage; it is P0 inflation, and "if everything is P0, nothing is" is exactly how a breaker stops
-- being trusted. The true finding is not "routine-3 is behind"; it is "the remediation layer is
-- failing system-wide." So the per-owner alerts stay P1 (now carrying each owner's oldest-age for
-- triage), and a SINGLE systemic P0 fires when any owner's backlog is chronically old, carrying the
-- full per-owner breakdown. One unmissable signal, self-healing when the oldest falls back under the
-- threshold.
--
-- NOTE (owner action, surfaced not fixed here): a P0 still only reaches GitHub issues until
-- mon_config.alert_webhook_url is set. This ratchet makes rot loud inside the system; a human is
-- paged only once that webhook (and mon_config.deadman_ping_url) are configured -- both are null today.
--
-- Detect-only: writes to alert_event via mon_raise/mon_resolve_key, never to a listing or an index.

insert into public.mon_config (key, value, note) values
  ('alert_queue_escalate_days', '14',
   'alert_queue_unworked: age in days of the OLDEST unworked alert across the system past which a '
   'single systemic P0 fires. Lower = louder sooner. Owner-tunable with no code change.')
on conflict (key) do nothing;

create or replace function public.mon_detect_alert_queue_unworked()
returns integer language plpgsql as $fn$
declare
  rec record;
  n int := 0;
  c_grace interval := interval '48 hours';
  c_owners text[] := public.incident_known_owners() || array['(unrouted)'];
  c_escalate_days int := coalesce((select value from public.mon_config
                                    where key = 'alert_queue_escalate_days')::int, 14);
  c_escalate interval := make_interval(days => c_escalate_days);
  v_worst_days numeric := 0;
  v_chronic int := 0;
  v_total int := 0;
  v_breakdown jsonb := '[]'::jsonb;
begin
  for rec in
    select coalesce(a.owner_routine, '(unrouted)') as owner,
           count(*) as open_unacked,
           min(a.created_at) as oldest,
           count(*) filter (where a.severity = 'P0') as p0,
           count(*) filter (where a.severity = 'P1') as p1,
           count(*) filter (where a.severity = 'P2') as p2,
           left(string_agg(a.kind, ', ' order by a.created_at), 400) as kinds
      from public.alert_event a
     where a.resolved_at is null
       and a.dispatched_at is not null
       and a.acknowledged_at is null
       and a.dispatched_at < now() - c_grace
     group by 1
  loop
    n := n + public.mon_raise(
      case when rec.p0 > 0 then 'P0' else 'P1' end,
      'alert_queue_unworked', null,
      'alert_queue_unworked:' || rec.owner,
      jsonb_build_object(
        'owner_routine', rec.owner,
        'open_unacknowledged', rec.open_unacked,
        'p0', rec.p0, 'p1', rec.p1, 'p2', rec.p2,
        'oldest_raised_at', rec.oldest,
        'oldest_age_days', round(extract(epoch from (now() - rec.oldest))::numeric / 86400.0, 1),
        'kinds', rec.kinds,
        'grace_hours', 48,
        'why', 'These alerts were delivered as GitHub issues labelled for ' || rec.owner
            || ' and nothing has acknowledged them. A filed issue is not the same as someone having '
            || 'seen it -- measured all-time, 2 of 1,014 alerts have ever been acknowledged.',
        'action', 'That routine must drive each to a terminal classification per AGENT_AUTHORITY.md '
            || 'and self-assign the GitHub issue (the assignment is what stamps acknowledged_at). '
            || 'List them with: gh issue list --label ezhalah-alert --label '
            || replace(rec.owner, '(unrouted)', '<no routine label yet>') || ' --state open'));

    v_total := v_total + rec.open_unacked;
    if rec.oldest < now() - c_escalate then
      v_chronic := v_chronic + 1;
      v_worst_days := greatest(v_worst_days, round(extract(epoch from (now() - rec.oldest))::numeric / 86400.0, 1));
      v_breakdown := v_breakdown || jsonb_build_object(
        'owner', rec.owner, 'unworked', rec.open_unacked,
        'oldest_age_days', round(extract(epoch from (now() - rec.oldest))::numeric / 86400.0, 1));
    end if;
  end loop;

  -- Self-heal per owner, across every owner that can exist.
  perform public.mon_resolve_key('alert_queue_unworked', 'alert_queue_unworked:' || o)
    from unnest(c_owners) as o
   where not exists (
     select 1 from public.alert_event a
      where coalesce(a.owner_routine, '(unrouted)') = o
        and a.resolved_at is null and a.dispatched_at is not null
        and a.acknowledged_at is null
        and a.dispatched_at < now() - c_grace);

  -- Retire the pre-attribution key so it cannot sit open forever as a zombie.
  perform public.mon_resolve_key('alert_queue_unworked', 'alert_queue_unworked:all');

  -- THE SINGLE SYSTEMIC ESCALATION. One P0 when any owner's backlog is chronically old; it carries
  -- the whole breakdown so it is actionable on its own. Self-heals when nothing is chronic anymore.
  if v_chronic > 0 then
    n := n + public.mon_raise('P0', 'alert_queue_unworked', null,
      'alert_queue_unworked:__systemic__',
      jsonb_build_object(
        'scope', 'system',
        'chronic_owners', v_chronic,
        'worst_oldest_age_days', v_worst_days,
        'total_unworked', v_total,
        'escalate_threshold_days', c_escalate_days,
        'breakdown', v_breakdown,
        'why', 'The alert queue is not being worked system-wide: ' || v_chronic
            || ' routine(s) have unacknowledged alerts older than ' || c_escalate_days
            || ' days, the worst at ' || v_worst_days || ' days. This is a remediation-layer '
            || 'failure, not a detection gap -- the detectors are firing and re-affirming; nobody '
            || 'is driving the findings to a terminal state (2 of 1,014 alerts ever acknowledged).',
        'action', 'Work each owner''s queue to terminal classifications (per-owner alert_queue_unworked '
            || 'alerts name them), and set mon_config.alert_webhook_url so P0s reach a human instead '
            || 'of only a GitHub label. This alert clears when no owner''s oldest exceeds the threshold.'));
  else
    perform public.mon_resolve_key('alert_queue_unworked', 'alert_queue_unworked:__systemic__');
  end if;

  return n;
end $fn$;
