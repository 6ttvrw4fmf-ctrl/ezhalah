-- AN UNWORKED ALERT QUEUE MUST GET LOUDER THE LONGER IT ROTS -- BUT AS ONE SIGNAL, NOT EIGHT.
-- (full rationale in supabase/migrations/20260921091500_unworked_alert_queue_escalates_with_age.sql)

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

  perform public.mon_resolve_key('alert_queue_unworked', 'alert_queue_unworked:' || o)
    from unnest(c_owners) as o
   where not exists (
     select 1 from public.alert_event a
      where coalesce(a.owner_routine, '(unrouted)') = o
        and a.resolved_at is null and a.dispatched_at is not null
        and a.acknowledged_at is null
        and a.dispatched_at < now() - c_grace);

  perform public.mon_resolve_key('alert_queue_unworked', 'alert_queue_unworked:all');

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