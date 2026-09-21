-- THE ROUTINE-LIVENESS WATCHDOG MUST COVER THE CANONICAL ROSTER, NOT A FROZEN OLD SLUG LIST.
--
-- WHY (owner audit, 2026-09-21). mon_detect_routine_sentry_silent() hardcoded SEVEN old routine
-- slugs: junior-scraping, senior-production, data-integrity, search-matching-qa, af-trending,
-- journey-persistence, systems-seam. But the canonical roster is now ELEVEN routine-N-* slugs
-- (public.incident_known_owners()), and the heartbeat table shows the routines have begun checking
-- in under their NEW names (routine-2-production 2026-09-18, routine-3-data-integrity 2026-09-19)
-- while systems-seam still uses its old one.
--
-- So the watchdog whose whole job is to notice a dead routine was watching GHOSTS. Measured
-- 2026-09-21: 6 open routine_sentry_silent alerts, oldest 2026-08-30, every one keyed on a renamed
-- or never-seen OLD slug — while NINE of the eleven current routines had NO liveness coverage under
-- their canonical slug at all. A routine could stop running for days and nothing would fire. That is
-- the exact "a monitor silently fails and no independent signal notices" hole this system exists to
-- close, reopened by a rename.
--
-- FIX. Iterate the canonical roster (incident_known_owners() — the single source of truth used by
-- the alert owner column and incident spine), and treat a routine as alive if ANY slug it is KNOWN
-- TO EMIT has a fresh heartbeat. The old->new slug map lives in a DATA table so the rename
-- transition does not false-alarm routines still emitting an old slug, and so this can never
-- silently drift again: a barrier (scripts/verify-routine-liveness-covers-the-roster.ts) asserts
-- every canonical owner has >=1 alias and that the detector reads the roster function, not a literal.
--
-- §S (ENGINEER_ROUTINES.md line 106) mandates the Sentry read + heartbeat every run for ALL ELEVEN
-- routines, so all eleven are watched. A routine that has NEVER recorded a heartbeat is reported
-- with reason "never_recorded_a_sentry_heartbeat" (a real §S-compliance finding), distinct from one
-- that "went_silent" after previously checking in. Detect-only: this writes to alert_event, never to
-- a routine, a listing, a location table, or an index.

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

-- Seed: canonical self for all eleven, plus the observed pre-2026-09 slug for the original seven.
-- Routines 8-11 were added 2026-09-04 and have only ever been named canonically.
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
  -- The roster is read from incident_known_owners(), never hardcoded here: the alert owner column
  -- and the incident spine already read it, so a twelfth routine is covered the moment it is added
  -- (it just needs an alias row, which the barrier requires).
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
      -- went_silent (was heartbeating, then stopped) is a P1: a live routine violating its §S
      -- mandate, or a genuinely dead one. never_seen (added to the roster but never onboarded onto
      -- the heartbeat) is a P2 setup/compliance gap, not an outage -- kept distinct so a newly-added
      -- routine does not page as if it had died mid-flight.
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
              || 'known to emit (ops_routine_heartbeat_alias) within 30h. §S mandates the Sentry read '
              || 'AND heartbeat every run for all eleven routines; silence is observed, not trusted '
              || '(owner rule 2026-08-30). The routines run daily, so a routine that missed one day '
              || 'is what this catches.',
          'action', 'On its next run the routine MUST call the Sentry MCP and '
              || 'ops_record_sentry_heartbeat(<slug>, seen, claimed, resolved) BEFORE any other work. '
              || 'If it now emits a NEW slug, add (canonical, emits_as) to ops_routine_heartbeat_alias '
              || 'in the same change so this clears on the next sweep.',
          'do_not', 'Do NOT resolve by hand or by inserting a synthetic heartbeat -- that hides the '
              || 'real silence. Do NOT widen the 30h window.'));
      live_keys := live_keys || ('routine_sentry_silent:' || slot.canonical);
    end if;
  end loop;

  -- Clears (a) any routine that has since checked in, and (b) the pre-fix GHOST keys that were
  -- keyed on old slugs: they are no longer in live_keys, which now uses canonical names only.
  perform public.mon_resolve_stale_keys('routine_sentry_silent', live_keys);
  return n;
end $function$;
