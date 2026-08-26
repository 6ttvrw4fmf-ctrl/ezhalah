-- AN ALERT KIND THAT CANNOT BE CLEARED IS A RATCHET — it only ever accumulates.
--
-- FOUND 2026-08-21 (senior run #34c). Of the 24 alert kinds open at the time, FOURTEEN had no
-- mon_resolve_key path anywhere: they can be raised but never auto-cleared. `run_field_range` was
-- the starkest — it has no mon_detect_* function at all, only the in-scraper mon_check_run_field_ranges
-- that end_run() calls, so once raised it stays open forever regardless of the underlying state.
--
-- The damage is not the count, it is the LOSS OF MEANING. With no resolver you cannot tell a stale
-- alert (condition fixed days ago) from a live one (condition still true) without adjudicating each
-- by hand, so the open-alert total stops being usable as a health signal at all. It also invites the
-- opposite error: on 2026-08-21 `run_field_range` LOOKED stale — 10.3 days old, its fix migration
-- already applied — and was in fact LIVE, with 62 integrity-guard trips in 7 days, the most recent
-- that same afternoon. A first probe using the wrong tag string returned a false negative and very
-- nearly closed a live alert.
--
-- This is the mirror image of mon_detect_orphaned_detectors(), which fires when a DETECTOR is
-- reachable by nothing. This one fires when an alert KIND is resolvable by nothing.
--
-- DELIBERATELY IT ONLY REPORTS. It raises a P2 naming the kind; it never resolves, suppresses or
-- edits another alert. A detector that auto-cleared alerts it did not understand would be the exact
-- "silence the barrier to make it green" failure the 2026-08-13 owner rule forbids. The remedy for
-- a flagged kind is to give it a real resolver that re-checks the condition, or to register a
-- genuine external resolver below — never to mute this.

create table if not exists public.ops_alert_kind_external_resolver (
  kind          text primary key,
  resolved_by   text        not null,
  evidence      text        not null,
  registered_at timestamptz not null default now()
);

comment on table public.ops_alert_kind_external_resolver is
  'Alert kinds whose mon_resolve_key call lives OUTSIDE the database (a CI workflow, a script). '
  'Exemptions are DATA, reviewable in one place — not a hidden allowlist inside a function body. '
  'Registering a kind here asserts a resolver genuinely exists and says exactly where; it is not a '
  'way to silence mon_detect_unresolvable_alert_kinds().';

insert into public.ops_alert_kind_external_resolver (kind, resolved_by, evidence)
values (
  'migration_drift',
  '.github/workflows/migration-drift-guard.yml',
  'That workflow runs every 15 minutes independently of any push and calls mon_resolve_key on a '
  'clean check, which is why migration_drift self-heals without any mon_detect_* function. Verified '
  '2026-08-21: the alert raised at 03:23 UTC was auto-resolved at 03:35 UTC by exactly this path.'
)
on conflict (kind) do nothing;

create or replace function public.mon_detect_unresolvable_alert_kinds()
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n int := 0;
  r record;
begin
  for r in
    with open_kinds as (
      select distinct kind from public.alert_event where resolved_at is null
    ),
    resolvers as (
      select p.proname, pg_get_functiondef(p.oid) as def
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname like 'mon\_%'
         and pg_get_functiondef(p.oid) like '%mon_resolve_key%'
    )
    select k.kind,
           (select count(*) from public.alert_event a
             where a.resolved_at is null and a.kind = k.kind) as open_count,
           (select min(a.created_at) from public.alert_event a
             where a.resolved_at is null and a.kind = k.kind) as oldest_open
      from open_kinds k
     where not exists (
             -- an in-database resolver that names this kind
             select 1 from resolvers r2
              where position(k.kind in r2.def) > 0
           )
       and not exists (
             -- or a registered, evidenced external one
             select 1 from public.ops_alert_kind_external_resolver x
              where x.kind = k.kind
           )
  loop
    v_n := v_n + public.mon_raise('P2', 'unresolvable_alert_kind', null,
      'unresolvable_alert_kind:' || r.kind,
      jsonb_build_object(
        'kind', r.kind,
        'open_count', r.open_count,
        'oldest_open', r.oldest_open,
        'why', 'This alert kind has open alerts but NO mon_resolve_key path anywhere — no mon_* '
               || 'function references it, and it is not registered in '
               || 'ops_alert_kind_external_resolver. It can be raised but never auto-cleared, so a '
               || 'stale alert and a live one are indistinguishable without hand adjudication, and '
               || 'the open-alert total stops meaning anything.',
        'fix', 'Give the kind a detector that RE-CHECKS its condition and calls mon_resolve_key when '
               || 'clean (the same shape every healthy detector already uses). If the resolver truly '
               || 'lives outside the database, register it in ops_alert_kind_external_resolver with '
               || 'evidence naming the exact workflow or script. Do NOT resolve the open alerts by '
               || 'hand to clear this, and do NOT delete this detector: an alert kind that cannot be '
               || 'cleared is a ratchet.'));
  end loop;
  return v_n;
end
$function$;

-- Roster entry, in the SAME migration — mon_detect_orphaned_detectors() fires on any detector
-- nothing reaches, and a detector outside the roster is decoration (AGENTS.md). GUARDED needle-edit
-- of the LIVE body, never a hand-pasted rebuild.
do $$
declare
  v_def text; v_before text; fn text;
  want text[] := array['mon_detect_unresolvable_alert_kinds'];
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then
      v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
    end if;
  end loop;
  if v_def = v_before then
    raise notice 'roster already carries the detector — nothing to do';
    return;
  end if;
  execute v_def;
end $$;

-- Prove reachability in the same migration.
do $$
declare
  v_def text; fn text; missing text[] := '{}';
  want text[] := array['mon_detect_unresolvable_alert_kinds', 'mon_detect_orphaned_detectors'];
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'roster edit lost or failed to add: %', missing;
  end if;
end $$;