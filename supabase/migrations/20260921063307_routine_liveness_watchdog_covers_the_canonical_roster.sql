-- THE ROUTINE-LIVENESS WATCHDOG MUST COVER THE CANONICAL ROSTER, NOT A FROZEN OLD SLUG LIST.
-- (see supabase/migrations/20260921090000_routine_liveness_watchdog_covers_the_canonical_roster.sql
--  for the full rationale; body identical)

create table if not exists public.ops_routine_heartbeat_alias (
  canonical text not null,
  emits_as  text not null,
  note      text,
  added_at  timestamptz not null default now(),
  primary key (canonical, emits_as)
);

comment on table public.ops_routine_heartbeat_alias is
  'Maps each canonical routine (incident_known_owners()) to the heartbeat slug(s) it currently '
  'passes to ops_record_sentry_heartbeat(). Bridges the 2026-09 old->new routine rename so '
  'mon_detect_routine_sentry_silent() watches the ELEVEN current routines without false-alarming a '
  'routine still emitting its old slug. Trim the old alias once a routine standardises on its '
  'canonical slug. Every canonical owner MUST have >=1 row (barrier-enforced): a routine with no '
  'alias would be silently unwatched.';

insert into public.ops_routine_heartbeat_alias (canonical, emits_as, note) values
  ('routine-1-scraping',          'routine-1-scraping',          'canonical'),
  ('routine-1-scraping',          'junior-scraping',             'pre-2026-09 slug'),
  ('routine-2-production',        'routine-2-production',        'canonical'),
  ('routine-2-production',        'senior-production',           'pre-2026-09 slug'),
  ('routine-3-data-integrity',   'routine-3-data-integrity',    'canonical'),
  ('routine-3-data-integrity',   'data-integrity',              'pre-2026-09 slug'),
  ('routine-4-search-qa',        'routine-4-search-qa',         'canonical'),
  ('routine-4-search-qa',        'search-matching-qa',          'pre-2026-09 slug'),
  ('routine-5-af-trending',      'routine-5-af-trending',       'canonical'),
  ('routine-5-af-trending',      'af-trending',                 'pre-2026-09 slug'),
  ('routine-6-journey',          'routine-6-journey',           'canonical'),
  ('routine-6-journey',          'journey-persistence',         'pre-2026-09 slug'),
  ('routine-7-seam',             'routine-7-seam',              'canonical'),
  ('routine-7-seam',             'systems-seam',                'pre-2026-09 slug'),
  ('routine-8-regression-hunter','routine-8-regression-hunter', 'canonical'),
  ('routine-9-red-team',         'routine-9-red-team',          'canonical'),
  ('routine-10-barrier',         'routine-10-barrier',          'canonical'),
  ('routine-11-lifecycle',       'routine-11-lifecycle',        'canonical')
on conflict do nothing;

create or replace function public.mon_detect_routine_sentry_silent()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  slot record;
  live_keys text[] := '{}'::text[];
  stale_after constant interval := interval '30 hours';
begin
  for slot in
    select o.canonical,
           (select max(h.ran_at)
              from public.ops_routine_sentry_heartbeat h
              join public.ops_routine_heartbeat_alias a on a.emits_as = h.routine
             where a.canonical = o.canonical
               and h.routine not like 'barrier-probe:%') as last_ran_at
      from (select unnest(public.incident_known_owners()) as canonical) o
  loop
    if slot.last_ran_at is null or slot.last_ran_at < (now() - stale_after) then
      n := n + public.mon_raise(
        case when slot.last_ran_at is null then 'P2' else 'P1' end,
        'routine_sentry_silent', slot.canonical,
        'routine_sentry_silent:' || slot.canonical,
        jsonb_build_object(
          'routine', slot.canonical,
          'last_ran_at', slot.last_ran_at,
          'hours_since', case when slot.last_ran_at is null then null
                             else round(extract(epoch from (now() - slot.last_ran_at))::numeric / 3600.0, 1) end,
          'threshold_hours', 30,
          'reason', case when slot.last_ran_at is null then 'never_recorded_a_sentry_heartbeat'
                         else 'went_silent' end,
          'why', 'This routine has recorded no ops_record_sentry_heartbeat() under ANY slug it is '
              || 'known to emit (ops_routine_heartbeat_alias) within 30h. Section S mandates the '
              || 'Sentry read AND heartbeat every run for all eleven routines; silence is observed, '
              || 'not trusted (owner rule 2026-08-30). The routines run daily, so a routine that '
              || 'missed one day is what this catches.',
          'action', 'On its next run the routine MUST call the Sentry MCP and '
              || 'ops_record_sentry_heartbeat(<slug>, seen, claimed, resolved) BEFORE any other work. '
              || 'If it now emits a NEW slug, add (canonical, emits_as) to ops_routine_heartbeat_alias '
              || 'in the same change so this clears on the next sweep.',
          'do_not', 'Do NOT resolve by hand or by inserting a synthetic heartbeat -- that hides the '
              || 'real silence. Do NOT widen the 30h window.'));
      live_keys := live_keys || ('routine_sentry_silent:' || slot.canonical);
    end if;
  end loop;

  perform public.mon_resolve_stale_keys('routine_sentry_silent', live_keys);
  return n;
end $function$;