-- THE ROUTINE ROSTER IS DEFINED ONCE, AND EVERY ENUMERATION READS IT.
--
-- Found by routine #8 (Regression Hunter) 2026-09-13, attacking the class rather than an instance.
-- Shape: PARTIAL (REGRESSION_HUNTER_ENGINEER.md PART 4.3 shape 1) -- the roster grew from SEVEN to
-- ELEVEN on 2026-09-04 (migration 20260905022312), incident_route_owner() and
-- scripts/lib/alertRouting.ts were updated, and three sibling enumerations in the same spine were
-- not. AGENTS.md already records this exact failure in prose for its own section G header ("It said
-- 'ALL SEVEN' until 2026-09-05, four routines after the roster grew to eleven"); this is the same
-- mechanism, in the code that routes and watches findings.
--
-- THE THREE SIBLINGS, and what each one cost (measured 2026-09-13):
--
--  1. incident_handoff() validated NOTHING about p_new_owner, while its sibling write path
--     incident_open() raises on an unknown SURFACE with the comment "UNKNOWN MUST BE LOUD ... a
--     surface nobody named is a typo". A handoff to a slug no routine reads therefore creates a
--     queue nobody sees. LIVE INSTANCE: ops_incident #182 was handed to 'routine-8-regression'
--     (not 'routine-8-regression-hunter') on 2026-09-11 and was invisible to the G.6b queue query
--     every routine spec prescribes verbatim -- two days, never worked, by a routine that read its
--     queue every day.
--
--  2. mon_detect_stalled_incident() RAISES grouped by owner_routine (so every slug, real or
--     typo'd, gets a key) but SELF-HEALS from a hardcoded seven. Measured natural experiment:
--     incident_stalled:routine-5-af-trending (inside the seven) was resolved 2026-09-13 11:57,
--     while incident_stalled:routine-10-barrier and :routine-11-lifecycle (outside it) have sat
--     open since 2026-09-09 with resolved_at NULL. Because mon_raise() returns 0 on an
--     already-open dedup key, those two keys now permanently SUPPRESS their own future raises --
--     the same "open dedup key makes the condition unraisable" class as ops_incident #204 and #206.
--
--  3. mon_detect_alert_queue_unworked() carries the identical seven, under a comment that states
--     the correct invariant and is contradicted by the line beneath it: "Self-heal per owner,
--     across every owner that can exist -- not merely the ones with rows today". routine-11-
--     lifecycle holds 21 open alerts and has no self-heal key at all.
--
-- A FOURTH sibling exists and is deliberately NOT touched here: mon_detect_routine_sentry_silent()
-- hardcodes seven HEARTBEAT slugs ('junior-scraping', ...), a different vocabulary that cannot
-- route through this roster. It is already filed and owned as ops_incident #90 (routine-7-seam).
--
-- THE FIX IS THE SHARED FUNCTION, NOT THE THREE CALLERS. incident_known_owners() mirrors the
-- existing incident_known_surfaces() exactly, so the spine now has one vocabulary per axis:
-- surfaces and owners. Adding routine #12 is one edit here, and the CHECK constraint plus the
-- barrier make forgetting it loud instead of silent.

-- 1. The roster itself ------------------------------------------------------------------------
create or replace function public.incident_known_owners()
returns text[]
language sql
immutable
as $$
  select array[
    -- the seven surface owners
    'routine-1-scraping','routine-2-production','routine-3-data-integrity','routine-4-search-qa',
    'routine-5-af-trending','routine-6-journey','routine-7-seam',
    -- the four objects added 2026-09-04: a gap, a layer disagreement, the apparatus, a lifecycle
    'routine-8-regression-hunter','routine-9-red-team','routine-10-barrier','routine-11-lifecycle'
  ]
$$;

comment on function public.incident_known_owners() is
  'The ELEVEN daily engineer routine slugs, defined ONCE. Must equal ROUTINES in '
  'scripts/lib/alertRouting.ts and the slugs incident_route_owner() can emit; '
  'scripts/verify-incident-owner-roster-has-one-source.ts fails if they diverge or if any spine '
  'function re-enumerates the roster by hand instead of calling this.';

-- 2. Repair the live orphan BEFORE the constraint that forbids it -----------------------------
-- ops_incident #182 was addressed to a slug no routine reads. This restores documented behaviour
-- (the G.6b queue query is verbatim in every spec); it is not a state change to make a check pass.
update public.ops_incident
   set owner_routine = 'routine-8-regression-hunter',
       handoff_from  = coalesce(handoff_from, 'routine-8-regression'),
       handoff_reason = coalesce(handoff_reason, '') ||
         ' [2026-09-13 routine-8: slug repaired from the non-existent ''routine-8-regression'' to '
         'the canonical ''routine-8-regression-hunter''. The original handoff named a queue no '
         'routine reads, so this finding was invisible to its owner for two days.]',
       updated_at = now()
 where owner_routine = 'routine-8-regression';

-- Fail loudly rather than silently constrain a table that still holds an unknown slug.
do $$
declare v_bad text[];
begin
  select array_agg(distinct owner_routine) into v_bad
    from public.ops_incident
   where not (owner_routine = any (public.incident_known_owners()));
  if v_bad is not null then
    raise exception 'ops_incident still holds unknown owner slugs %; repair them before constraining', v_bad;
  end if;
end $$;

-- 3. Close the hidden path: a raw UPDATE can address a queue nobody reads, too ----------------
-- Same mechanism as ops_incident_resolution_is_earned: a CHECK constraint, so the rule does not
-- depend on every writer going through the function that enforces it.
alter table public.ops_incident
  drop constraint if exists ops_incident_owner_is_a_real_routine;
alter table public.ops_incident
  add constraint ops_incident_owner_is_a_real_routine
  check (owner_routine = any (public.incident_known_owners()));

-- 4. incident_handoff() gets the guard incident_open() has had since 2026-09-04 ---------------
-- Needle-edited from the LIVE pg_get_functiondef; identical signature, so this replaces the
-- function rather than creating a second overload.
create or replace function public.incident_handoff(p_id bigint, p_new_owner text, p_reason text)
returns boolean
language plpgsql
as $function$
declare v_old text;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a handoff must say why it is not yours';
  end if;
  -- UNKNOWN MUST BE LOUD -- the same rule incident_open() applies to surfaces, applied to owners.
  -- A handoff to a slug no routine reads is not a routing decision, it is a finding deleted
  -- quietly: every spec's G.6b queue query filters on an exact owner_routine string.
  if not (p_new_owner = any (public.incident_known_owners())) then
    raise exception 'unknown routine slug %; a handoff to a slug no routine reads creates a queue nobody sees. Valid owners: %',
      coalesce(p_new_owner, '(null)'), array_to_string(public.incident_known_owners(), ', ');
  end if;
  select owner_routine into v_old from public.ops_incident where id = p_id;
  if v_old is null then raise exception 'incident % does not exist', p_id; end if;
  if v_old = p_new_owner then raise exception 'incident % is already owned by %', p_id, p_new_owner; end if;

  update public.ops_incident
     set owner_routine = p_new_owner, handoff_from = v_old, handoff_reason = p_reason,
         state = 'open', last_progress_at = now(), updated_at = now()
   where id = p_id;
  return true;
end $function$;

-- 5. The two detectors self-heal across the roster, not across a stale copy of it -------------
-- Needle-edited from the LIVE definitions: ONLY the owner list changes.
create or replace function public.mon_detect_stalled_incident()
returns integer
language plpgsql
as $function$
declare rec record; n int := 0;
begin
  for rec in
    select owner_routine,
           count(*) as stalled,
           min(last_progress_at) as oldest,
           string_agg(id::text || ':' || title, ' | ' order by last_progress_at) as items
      from public.ops_incident
     where state not in ('resolved','wont_fix','blocked')
       and last_progress_at < now() - case severity
             when 'P0' then interval '4 hours'
             when 'P1' then interval '24 hours'
             when 'P2' then interval '72 hours'
             else interval '14 days' end
     group by owner_routine
  loop
    n := n + public.mon_raise('P1', 'incident_stalled', null,
      'incident_stalled:' || rec.owner_routine,
      jsonb_build_object(
        'owner_routine', rec.owner_routine,
        'stalled_incidents', rec.stalled,
        'oldest_progress_at', rec.oldest,
        'items', left(rec.items, 2000),
        'why', 'These incidents are assigned to ' || rec.owner_routine || ' and have not moved '
            || 'within their severity SLA. An incident with no progress is an unstarted task, not a status.',
        'action', 'Drive each to a terminal state: incident_resolve() (barrier + production verified), '
            || 'incident_handoff() if it belongs to another routine, incident_block() if it genuinely '
            || 'needs an owner decision, or incident_wont_fix() with a reason.'));
  end loop;

  -- Self-heal across the WHOLE roster. This list used to be a hardcoded seven, written before the
  -- roster grew to eleven on 2026-09-04: incident_stalled:routine-10-barrier and
  -- :routine-11-lifecycle raised on 2026-09-09 and could never be retired by any arm, and an open
  -- dedup key makes mon_raise() return 0, so the keys suppressed their own re-raise.
  perform public.mon_resolve_key('incident_stalled', 'incident_stalled:' || r)
    from unnest(public.incident_known_owners()) as r
   where not exists (
     select 1 from public.ops_incident i
      where i.owner_routine = r
        and i.state not in ('resolved','wont_fix','blocked')
        and i.last_progress_at < now() - case i.severity
              when 'P0' then interval '4 hours' when 'P1' then interval '24 hours'
              when 'P2' then interval '72 hours' else interval '14 days' end);
  return n;
end $function$;

create or replace function public.mon_detect_alert_queue_unworked()
returns integer
language plpgsql
as $function$
declare
  rec record;
  n int := 0;
  c_grace interval := interval '48 hours';
  -- Was a hardcoded seven + '(unrouted)', which contradicted the comment on the self-heal below.
  c_owners text[] := public.incident_known_owners() || array['(unrouted)'];
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
end $function$;
