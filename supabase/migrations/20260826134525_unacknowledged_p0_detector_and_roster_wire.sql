-- Daily engineer, 2026-08-26 (owner-directed follow-up to the P0-delivery blackout fix).
--
-- A FILED GITHUB ISSUE IS NOT THE SAME AS A HUMAN HAVING SEEN IT. alert_event.acknowledged_at
-- has existed since the schema was introduced and nothing has ever written to it: as of this
-- migration there are 28 open P0/P1 alerts, every one already dispatched (a GitHub issue exists
-- for each), zero acknowledged, the oldest since 2026-08-11. mon_raise() only ever CLEARS this
-- column (on escalation); nothing sets it. Delivery proves an issue exists. It does not prove a
-- human is coming.
--
-- This adds the barrier half of the fix (the delivery half -- a human assigning the GitHub issue
-- writes acknowledged_at back -- lives in .github/workflows/alert-dispatch.yml, same commit).
--
-- mon_detect_unacknowledged_p0(): for every P0 alert that has ever been dispatched, if it is
-- still open, still unacknowledged, and the dispatch is more than 4 hours old, raise a fresh P1
-- naming the exact row and its original dedup_key. Self-clears the moment the row is
-- acknowledged, resolved, or (defensively) no longer P0 -- so it can never ratchet.
create or replace function public.mon_detect_unacknowledged_p0()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record;
  n int := 0;
  c_grace_hours int := 4;
begin
  for rec in
    select id, kind, platform, dedup_key, created_at, dispatched_at, resolved_at, acknowledged_at
      from public.alert_event
     where severity = 'P0'
       and dispatched_at is not null
  loop
    if rec.resolved_at is null
       and rec.acknowledged_at is null
       and rec.dispatched_at < now() - make_interval(hours => c_grace_hours) then
      n := n + public.mon_raise('P1', 'alert_acknowledgment', rec.platform,
        'unacknowledged_p0:' || rec.id,
        jsonb_build_object(
          'alert_id', rec.id, 'original_kind', rec.kind, 'original_dedup_key', rec.dedup_key,
          'raised_at', rec.created_at, 'dispatched_at', rec.dispatched_at,
          'grace_hours', c_grace_hours,
          'why', 'This P0 was delivered as a GitHub issue but nothing has acknowledged it -- '
                 || 'a filed issue is not the same as a human having seen it. No one is assigned '
                 || 'to the issue.',
          'action', 'Assign the GitHub issue titled "[alert] ' || rec.dedup_key || '" to whoever '
                 || 'is investigating. alert-dispatch.yml stamps acknowledged_at the next cycle '
                 || 'after an assignee appears.'));
    else
      perform public.mon_resolve_key('alert_acknowledgment', 'unacknowledged_p0:' || rec.id);
    end if;
  end loop;
  return n;
end $function$;

-- Guarded needle-edit (the ONLY safe way to touch the roster -- see
-- scripts/verify-detector-roster-edits-are-guarded.ts): read the LIVE body, splice the one new
-- name in next to the detector it follows on, execute the result. This can never drop an entry
-- it never had to read.
do $roster$
declare
  v_body text;
begin
  select pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure) into v_body;

  if v_body not like '%mon_detect_alert_delivery%' then
    raise exception 'anchor mon_detect_alert_delivery not found in live mon_run_all_detectors body -- refusing to splice blind';
  end if;
  if v_body like '%mon_detect_unacknowledged_p0%' then
    raise exception 'mon_detect_unacknowledged_p0 already present in the roster -- refusing to duplicate';
  end if;

  v_body := replace(v_body,
    $marker$'mon_detect_alert_delivery',$marker$,
    $marker$'mon_detect_alert_delivery',
    'mon_detect_unacknowledged_p0',$marker$);

  execute v_body;
end $roster$;
