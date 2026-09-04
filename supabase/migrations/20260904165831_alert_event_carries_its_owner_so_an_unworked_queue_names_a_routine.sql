-- AN UNWORKED ALERT QUEUE MUST NAME THE ROUTINE THAT IS NOT WORKING IT.
--
-- mon_detect_alert_queue_unworked() (2026-09-04) made the backlog visible for the first time:
-- 1,014 alerts raised all-time, 2 ever acknowledged, 106 open with the oldest at 24 days. But it
-- could only report ONE aggregate number, because ownership of an alert is decided by
-- routineForKind() in scripts/lib/alertRouting.ts -- TypeScript that SQL cannot call -- and
-- duplicating that map into SQL would create exactly the two-copies divergence this codebase has
-- been burned by. So the owner existed only as a GitHub issue LABEL, where no detector can read it.
--
-- An anonymous backlog is not actionable. "106 alerts are unacknowledged" is a fact nobody owns;
-- "routine #3 has 24 unacknowledged alerts, oldest 24 days" is a task with a name on it. The owner's
-- instruction on 2026-09-04 was explicit: "Creating an issue and leaving it there is not success."
--
-- THE FIX IS A PROJECTION, NOT A SECOND COPY. alert-dispatch.yml already executes routineForKind()
-- once per issue to choose the label. It now writes that same answer back here in the same sweep, so
-- there is still exactly ONE implementation of the mapping and this column is its projection. A row
-- whose owner has not been computed yet reads as '(unrouted)' rather than silently joining someone
-- else's pile.
alter table public.alert_event add column if not exists owner_routine text;

comment on column public.alert_event.owner_routine is
  'Projection of routineForKind() written by alert-dispatch.yml''s routing sweep. NEVER computed in '
  'SQL -- scripts/lib/alertRouting.ts is the single implementation. NULL means not yet routed.';

create index if not exists alert_event_open_by_owner
  on public.alert_event (owner_routine) where resolved_at is null;

-- Attribute the backlog. Same grace window and same self-heal discipline as before; the only change
-- is that the dedup key now carries the owner, so seven routines get seven answerable alerts instead
-- of one anonymous one.
create or replace function public.mon_detect_alert_queue_unworked()
returns integer language plpgsql as $fn$
declare
  rec record;
  n int := 0;
  c_grace interval := interval '48 hours';
  c_owners text[] := array['routine-1-scraping','routine-2-production','routine-3-data-integrity',
                           'routine-4-search-qa','routine-5-af-trending','routine-6-journey',
                           'routine-7-seam','(unrouted)'];
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
        'kinds', rec.kinds,
        'grace_hours', 48,
        'why', 'These alerts were delivered as GitHub issues labelled for ' || rec.owner
            || ' and nothing has acknowledged them. A filed issue is not the same as someone having '
            || 'seen it -- measured all-time, 2 of 1,014 alerts have ever been acknowledged.',
        'action', 'That routine must drive each to a terminal classification per AGENT_AUTHORITY.md '
            || 'and self-assign the GitHub issue (the assignment is what stamps acknowledged_at). '
            || 'List them with: gh issue list --label ezhalah-alert --label '
            || replace(rec.owner, '(unrouted)', '<no routine label yet>') || ' --state open'));
  end loop;

  -- Self-heal per owner, across every owner that can exist -- not merely the ones with rows today,
  -- because an owner whose backlog was just cleared still has an open alert to retire.
  perform public.mon_resolve_key('alert_queue_unworked', 'alert_queue_unworked:' || o)
    from unnest(c_owners) as o
   where not exists (
     select 1 from public.alert_event a
      where coalesce(a.owner_routine, '(unrouted)') = o
        and a.resolved_at is null and a.dispatched_at is not null
        and a.acknowledged_at is null
        and a.dispatched_at < now() - c_grace);

  -- Retire the pre-attribution key. Its condition is still reported, just per owner now; without
  -- this it could never self-heal and would sit open forever as a zombie contradicting its successors.
  perform public.mon_resolve_key('alert_queue_unworked', 'alert_queue_unworked:all');
  return n;
end $fn$;
