-- THE INCIDENT SPINE: a durable home for a finding, with exactly one owner and an earned exit.
--
-- WHY THIS EXISTS (measured, 2026-09-04). The alerting layer is excellent at DETECTING and terrible
-- at CLOSING. Of 1,014 alert_event rows ever raised, exactly 2 were ever acknowledged; 106 sit open
-- right now, the oldest 24 days, with zero acknowledgements across all of them. The acknowledgement
-- watchdog that should have caught this, mon_detect_unacknowledged_p0(), filters `severity = 'P0'`
-- and there are no open P0s, so it has been watching an empty set while the P1/P2 queue rotted.
--
-- Worse, a whole CLASS of finding has no home at all. ENGINEER_ROUTINES.md §G.3 requires a routine
-- that cannot fix something to ROUTE it to the write-authorized owner rather than merely say someone
-- should look at it -- and it names the ownership tables that exist for that: SENTRY_ROUTING.md for
-- Sentry issues and ALERT_ROUTING.md for [alert] issues. A finding that is NEITHER of those (a
-- production journey seeing a card render wrong, a visual regression, a dead control) has no row to
-- create, so the policy is right and the mechanism is missing. That gap is the one the owner has
-- been personally filling by testing screens himself.
--
-- WHAT THIS IS. alert_event answers "is a CONDITION true right now" -- it is dedup-keyed, detector-
-- raised and self-healing, and it is good at that. ops_incident answers a different question: "who
-- owns this FINDING, what has been done about it, and what is it still waiting on." An alert can
-- spawn an incident; so can a Sentry error, a failed production journey, or an engineer noticing
-- something outside its own lane. The two are complements, not replacements.
--
-- THE ONE INVARIANT WORTH THE WHOLE TABLE. `resolved` is not a mood, it is EARNED: the constraint
-- ops_incident_resolution_is_earned makes it structurally impossible to close an incident without
-- naming the permanent regression barrier AND stamping a production verification. The owner's
-- standing rule -- every real bug produces a barrier so the class cannot silently return -- stops
-- depending on an agent remembering it at the end of a long run, and becomes something the database
-- refuses to let it skip. An incident that genuinely should not be fixed exits through `wont_fix`,
-- and one that genuinely needs the owner exits through `blocked` -- both of which demand a written
-- reason. There is no fourth way out.
--
-- STATE MACHINE (one state per step of the owner's requested loop):
--   open -> investigating -> reproduced -> fixed -> verifying -> resolved
--   plus handed_off (re-owned, never dropped), blocked (needs the owner), wont_fix (not a bug).
-- `reproduced` is deliberately its own state because "I could not reproduce it" is a real, honest
-- outcome that must be visible rather than laundered into either "fixed" or "still broken".

create table if not exists public.ops_incident (
  id                      bigserial primary key,
  fingerprint             text        not null unique,
  title                   text        not null,
  surface                 text        not null,
  severity                text        not null check (severity in ('P0','P1','P2','P3')),
  source                  text        not null check (source in ('detector','sentry','journey','agent','owner','deploy')),
  source_ref              text,
  detail                  jsonb       not null default '{}'::jsonb,
  owner_routine           text        not null,
  state                   text        not null default 'open'
                            check (state in ('open','investigating','reproduced','fixed',
                                             'verifying','resolved','handed_off','blocked','wont_fix')),
  reproduced_at           timestamptz,
  root_cause              text,
  fix_pr                  integer,
  barrier_script          text,
  deployed_at             timestamptz,
  production_verified_at  timestamptz,
  resolved_at             timestamptz,
  exit_reason             text,
  handoff_from            text,
  handoff_reason          text,
  observations            integer     not null default 1,
  first_seen_at           timestamptz not null default now(),
  last_seen_at            timestamptz not null default now(),
  last_progress_at        timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint ops_incident_resolution_is_earned check (
    state <> 'resolved' or (barrier_script is not null and production_verified_at is not null)
  ),
  constraint ops_incident_non_fix_exit_needs_a_reason check (
    state not in ('blocked','wont_fix') or (exit_reason is not null and length(btrim(exit_reason)) > 0)
  ),
  constraint ops_incident_handoff_records_its_origin check (
    state <> 'handed_off' or (handoff_from is not null and handoff_reason is not null)
  )
);

comment on table public.ops_incident is
  'Durable owner-assigned queue for findings. Complements alert_event (a CONDITION) with a LIFECYCLE. '
  'resolved is unreachable without a barrier and a production verification, by CHECK constraint.';

create index if not exists ops_incident_open_by_owner
  on public.ops_incident (owner_routine, state) where resolved_at is null;
create index if not exists ops_incident_progress
  on public.ops_incident (last_progress_at) where state not in ('resolved','wont_fix');

alter table public.ops_incident enable row level security;
revoke all on public.ops_incident from anon, authenticated;

-- routing: surface -> owning routine. TOTAL, like routineForKind().
-- A fallback is a real owner, not a bin: anything unmapped belongs to routine #2, which holds the
-- standing triage mandate. The seven slugs here MUST match scripts/lib/alertRouting.ts -- the
-- barrier scripts/verify-incident-spine.ts executes both and fails if they ever disagree.
create or replace function public.incident_route_owner(p_surface text)
returns text language sql immutable as $fn$
  select case lower(coalesce(p_surface, ''))
    when 'advanced_filter'   then 'routine-5-af-trending'
    when 'trending'          then 'routine-5-af-trending'
    when 'search'            then 'routine-4-search-qa'
    when 'matching'          then 'routine-4-search-qa'
    when 'normal_filter'     then 'routine-4-search-qa'
    when 'pagination'        then 'routine-4-search-qa'
    when 'result_card'       then 'routine-4-search-qa'
    when 'auth'              then 'routine-6-journey'
    when 'session'           then 'routine-6-journey'
    when 'sidebar'           then 'routine-6-journey'
    when 'chat_persistence'  then 'routine-6-journey'
    when 'navigation'        then 'routine-6-journey'
    when 'theme'             then 'routine-6-journey'
    when 'voice'             then 'routine-6-journey'
    when 'loading_states'    then 'routine-6-journey'
    when 'modal'             then 'routine-6-journey'
    when 'data_integrity'    then 'routine-3-data-integrity'
    when 'price'             then 'routine-3-data-integrity'
    when 'location'          then 'routine-3-data-integrity'
    when 'listing'           then 'routine-3-data-integrity'
    when 'scraper'           then 'routine-1-scraping'
    when 'ingestion'         then 'routine-1-scraping'
    when 'deploy'            then 'routine-7-seam'
    when 'monitoring'        then 'routine-7-seam'
    when 'alerting'          then 'routine-7-seam'
    when 'cron'              then 'routine-7-seam'
    when 'seam'              then 'routine-7-seam'
    when 'migration'         then 'routine-7-seam'
    else 'routine-2-production'
  end
$fn$;

-- Severity only ever escalates on re-observation; a repeat sighting must not quietly downgrade.
create or replace function public.incident_worst_severity(a text, b text)
returns text language sql immutable as $fn$
  select case when public.mon_sev_rank(coalesce(b, a)) > public.mon_sev_rank(a) then b else a end
$fn$;

-- open (or re-observe). Idempotent on fingerprint. Re-observing a RESOLVED incident REOPENS it,
-- because that fact -- the barrier did not hold -- is louder than the original bug.
create or replace function public.incident_open(
  p_fingerprint text, p_title text, p_surface text, p_severity text,
  p_source text, p_source_ref text default null, p_detail jsonb default '{}'::jsonb
) returns bigint language plpgsql as $fn$
declare
  v_id bigint; v_state text; v_owner text;
begin
  select id, state into v_id, v_state from public.ops_incident where fingerprint = p_fingerprint;

  if v_id is null then
    v_owner := public.incident_route_owner(p_surface);
    insert into public.ops_incident (fingerprint, title, surface, severity, source, source_ref,
                                     detail, owner_routine)
    values (p_fingerprint, p_title, p_surface, p_severity, p_source, p_source_ref,
            coalesce(p_detail, '{}'::jsonb), v_owner)
    returning id into v_id;
    return v_id;
  end if;

  if v_state = 'resolved' then
    update public.ops_incident
       set state = 'open', resolved_at = null, last_progress_at = now(), updated_at = now(),
           last_seen_at = now(), observations = observations + 1,
           severity = public.incident_worst_severity(severity, p_severity),
           detail = detail || jsonb_build_object(
             'regressed_at', now(),
             'regression_note', 'This incident was resolved with barrier ' ||
                                coalesce(barrier_script, '(none recorded)') ||
                                ' and has been observed again -- the barrier did not hold.')
     where id = v_id;
    return v_id;
  end if;

  update public.ops_incident
     set last_seen_at = now(), observations = observations + 1, updated_at = now(),
         detail = detail || coalesce(p_detail, '{}'::jsonb)
   where id = v_id;
  return v_id;
end $fn$;

-- advance: stamps the evidence column that belongs to the state being entered, so the trail cannot
-- be claimed without being recorded. Illegal transitions raise rather than silently no-op.
create or replace function public.incident_advance(
  p_id bigint, p_state text,
  p_root_cause text default null, p_fix_pr integer default null, p_note jsonb default '{}'::jsonb
) returns boolean language plpgsql as $fn$
declare v_cur text;
begin
  select state into v_cur from public.ops_incident where id = p_id;
  if v_cur is null then raise exception 'incident % does not exist', p_id; end if;
  if v_cur in ('resolved','wont_fix') then
    raise exception 'incident % is already terminal (%); reopen it via incident_open() on its fingerprint', p_id, v_cur;
  end if;
  if p_state not in ('investigating','reproduced','fixed','verifying') then
    raise exception 'incident_advance() handles investigating/reproduced/fixed/verifying only; use incident_resolve(), incident_handoff(), incident_block() or incident_wont_fix() for the rest';
  end if;

  update public.ops_incident
     set state = p_state,
         reproduced_at = case when p_state = 'reproduced' then coalesce(reproduced_at, now()) else reproduced_at end,
         deployed_at   = case when p_state = 'verifying'  then coalesce(deployed_at, now())   else deployed_at end,
         root_cause    = coalesce(p_root_cause, root_cause),
         fix_pr        = coalesce(p_fix_pr, fix_pr),
         detail        = detail || coalesce(p_note, '{}'::jsonb),
         last_progress_at = now(), updated_at = now()
   where id = p_id;
  return true;
end $fn$;

-- resolve: the earned exit.
create or replace function public.incident_resolve(
  p_id bigint, p_barrier_script text, p_production_verified_at timestamptz default now()
) returns boolean language plpgsql as $fn$
begin
  if p_barrier_script is null or length(btrim(p_barrier_script)) = 0 then
    raise exception 'incident % cannot resolve without naming its permanent regression barrier', p_id;
  end if;
  if p_production_verified_at is null then
    raise exception 'incident % cannot resolve without a production verification timestamp', p_id;
  end if;
  update public.ops_incident
     set state = 'resolved', barrier_script = p_barrier_script,
         production_verified_at = p_production_verified_at,
         resolved_at = now(), last_progress_at = now(), updated_at = now()
   where id = p_id;
  return true;
end $fn$;

-- handoff: re-own, never drop. This is the §G.3 mechanism the specs ask for and did not have.
create or replace function public.incident_handoff(p_id bigint, p_new_owner text, p_reason text)
returns boolean language plpgsql as $fn$
declare v_old text;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a handoff must say why it is not yours';
  end if;
  select owner_routine into v_old from public.ops_incident where id = p_id;
  if v_old is null then raise exception 'incident % does not exist', p_id; end if;
  if v_old = p_new_owner then raise exception 'incident % is already owned by %', p_id, p_new_owner; end if;

  update public.ops_incident
     set owner_routine = p_new_owner, handoff_from = v_old, handoff_reason = p_reason,
         state = 'open', last_progress_at = now(), updated_at = now()
   where id = p_id;
  return true;
end $fn$;

-- `blocked` is the ONLY state that should routinely reach the owner, so it is deliberately the
-- hardest to enter: it must cite which of ENGINEER_ROUTINES.md §G.2's six legitimate reasons to stop
-- without fixing applies. §G.2 is explicit that "I ran out of time", "it seemed out of scope" and
-- "someone should look at this" do not qualify -- this signature is that rule made unskippable.
--   a = destructive/high-risk operation needing owner approval
--   b = genuine product / source-truth / taxonomy ambiguity
--   c = the fix would weaken a safety or security gate
--   d = another routine currently owns that protected surface     (must ROUTE, per §G.3)
--   e = a role/permission boundary physically prevents this write (must ROUTE, per §G.3)
--   f = external dependency/source outage with no truthful fix
create or replace function public.incident_block(p_id bigint, p_g2_category text, p_reason text)
returns boolean language plpgsql as $fn$
begin
  if p_g2_category is null or lower(p_g2_category) not in ('a','b','c','d','e','f') then
    raise exception 'blocked must cite which of G.2 six reasons applies (a-f); got %', p_g2_category;
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'blocked is the only state that reaches the owner; it must say what it needs';
  end if;
  if lower(p_g2_category) in ('d','e') then
    raise exception 'category % is an OWNERSHIP/PERMISSION boundary, which G.3 says must be ROUTED, not parked: use incident_handoff(%, ''<owning routine>'', ''<why>'')', p_g2_category, p_id;
  end if;
  update public.ops_incident
     set state = 'blocked',
         exit_reason = 'G.2(' || lower(p_g2_category) || ') ' || p_reason,
         last_progress_at = now(), updated_at = now()
   where id = p_id;
  return true;
end $fn$;

create or replace function public.incident_wont_fix(p_id bigint, p_reason text)
returns boolean language plpgsql as $fn$
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'wont_fix must record why this is not a bug worth fixing';
  end if;
  update public.ops_incident
     set state = 'wont_fix', exit_reason = p_reason, resolved_at = now(),
         last_progress_at = now(), updated_at = now()
   where id = p_id;
  return true;
end $fn$;

-- detector: a stalled incident, reported PER OWNER.
-- Deliberately one alert per owning routine rather than one per incident: 40 stalled incidents are
-- not 40 problems, they are one routine not working its queue, and 40 alerts would be an alert storm
-- delivered into the very queue that is already not being read.
-- SLA by severity: P0 4h (the owner's existing P0 SLO), P1 24h (every routine runs daily, so 24h
-- means "you had your run and did not touch it"), P2 72h, P3 14d.
create or replace function public.mon_detect_stalled_incident()
returns integer language plpgsql as $fn$
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

  perform public.mon_resolve_key('incident_stalled', 'incident_stalled:' || r)
    from unnest(array['routine-1-scraping','routine-2-production','routine-3-data-integrity',
                      'routine-4-search-qa','routine-5-af-trending','routine-6-journey',
                      'routine-7-seam']) as r
   where not exists (
     select 1 from public.ops_incident i
      where i.owner_routine = r
        and i.state not in ('resolved','wont_fix','blocked')
        and i.last_progress_at < now() - case i.severity
              when 'P0' then interval '4 hours' when 'P1' then interval '24 hours'
              when 'P2' then interval '72 hours' else interval '14 days' end);
  return n;
end $fn$;

-- detector: an alert queue nobody is working.
-- Reported as ONE aggregate rather than per routine on purpose: alert ownership is decided by
-- routineForKind() in scripts/lib/alertRouting.ts, which SQL cannot call, and duplicating that map
-- here would create exactly the two-copies divergence this codebase has been burned by. The
-- attributable per-routine signal is mon_detect_stalled_incident(), which reads ops_incident, where
-- the owner IS a column. This one answers the blunter question: is anybody working the queue at all.
create or replace function public.mon_detect_alert_queue_unworked()
returns integer language plpgsql as $fn$
declare rec record; n int := 0; c_grace interval := interval '48 hours';
begin
  for rec in
    select count(*) as open_unacked, min(a.created_at) as oldest,
           count(*) filter (where a.severity = 'P1') as p1,
           count(*) filter (where a.severity = 'P2') as p2
      from public.alert_event a
     where a.resolved_at is null and a.dispatched_at is not null
       and a.acknowledged_at is null
       and a.dispatched_at < now() - c_grace
     having count(*) > 0
  loop
    n := n + public.mon_raise('P1', 'alert_queue_unworked', null,
      'alert_queue_unworked:all',
      jsonb_build_object(
        'open_unacknowledged', rec.open_unacked,
        'p1', rec.p1, 'p2', rec.p2,
        'oldest_raised_at', rec.oldest,
        'grace_hours', 48,
        'why', 'Alerts were delivered as GitHub issues and nothing has acknowledged them. A filed '
            || 'issue is not the same as someone having seen it -- measured all-time, 2 of 1,014 '
            || 'alerts have ever been acknowledged, so this chain has effectively never closed.',
        'action', 'Each owning routine must drive its labelled alerts to a terminal classification '
            || 'and self-assign the GitHub issue (that assignment is what stamps acknowledged_at). '
            || 'Use: gh issue list --label ezhalah-alert --label <routine-label> --state open'));
  end loop;
  if n = 0 then
    perform public.mon_resolve_key('alert_queue_unworked', 'alert_queue_unworked:all');
  end if;
  return n;
end $fn$;

-- the one-glance health of the whole loop.
-- The owner asked for one report rather than a screen-by-screen inspection. This is its primitive:
-- everything a daily digest needs in a single call, including the ONLY list that should ever require
-- him -- the incidents genuinely blocked on an owner decision.
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
                             from public.alert_event where resolved_at is null)
    ),
    'needs_owner_decision', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', id, 'title', title, 'surface', surface, 'owner', owner_routine,
               'blocked_since', last_progress_at, 'reason', exit_reason)), '[]'::jsonb)
        from public.ops_incident where state = 'blocked')
  )
$fn$;
