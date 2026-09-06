-- The one report the owner reads must name WHO is behind, not just HOW MANY.
--
-- ops_loop_health() feeds loop-health-digest.yml, the single always-current issue that is the
-- owner's whole view of the loop. It reported the alert backlog as four totals, which was all it
-- could do before alert_event.owner_routine existed. A total is a fact nobody owns; the owner's
-- instruction on 2026-09-04 was "Creating an issue and leaving it there is not success", and the
-- corollary is that a digest saying "110 unacknowledged" gives him nothing to act on either.
--
-- by_owner turns the same number into seven answerable rows, and stays honest about the ones nothing
-- has routed yet: '(unrouted)' is reported as its own bucket rather than being hidden or folded into
-- routine #2's pile, because "nobody has computed an owner for these" and "routine #2 owns these"
-- are different facts and only one of them is a triage instruction.
create or replace function public.ops_loop_health()
returns jsonb language sql stable as $fn$
  select jsonb_build_object(
    'generated_at', now(),
    'incidents', jsonb_build_object(
      'open', (select count(*) from public.ops_incident where state not in ('resolved','wont_fix')),
      'by_state', (select coalesce(jsonb_object_agg(state, c), '{}'::jsonb)
                     from (select state, count(*) c from public.ops_incident
                            where state not in ('resolved','wont_fix') group by 1) s),
      'by_owner', (select coalesce(jsonb_object_agg(owner_routine, c), '{}'::jsonb)
                     from (select owner_routine, count(*) c from public.ops_incident
                            where state not in ('resolved','wont_fix') group by 1) s),
      'resolved_last_7d', (select count(*) from public.ops_incident
                            where resolved_at > now() - interval '7 days' and state = 'resolved'),
      'oldest_open_days', (select coalesce(max(extract(day from now() - first_seen_at))::int, 0)
                             from public.ops_incident where state not in ('resolved','wont_fix'))
    ),
    'alerts', jsonb_build_object(
      'open', (select count(*) from public.alert_event where resolved_at is null),
      'open_unacknowledged', (select count(*) from public.alert_event
                               where resolved_at is null and acknowledged_at is null),
      'acknowledged_all_time', (select count(*) from public.alert_event where acknowledged_at is not null),
      'oldest_open_days', (select coalesce(max(extract(day from now() - created_at))::int, 0)
                             from public.alert_event where resolved_at is null),
      -- Per routine: what each one is carrying, and how old its oldest untouched item is.
      'by_owner', (select coalesce(jsonb_object_agg(owner, payload), '{}'::jsonb) from (
          select coalesce(owner_routine, '(unrouted)') as owner,
                 jsonb_build_object(
                   'open', count(*),
                   'unacknowledged', count(*) filter (where acknowledged_at is null),
                   'oldest_days', coalesce(max(extract(day from now() - created_at))::int, 0)
                 ) as payload
            from public.alert_event
           where resolved_at is null
           group by 1) s)
    ),
    -- The ONLY list that should routinely require him.
    'needs_owner_decision', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', id, 'title', title, 'surface', surface, 'owner', owner_routine,
               'blocked_since', last_progress_at, 'reason', exit_reason)), '[]'::jsonb)
        from public.ops_incident where state = 'blocked')
  )
$fn$;
