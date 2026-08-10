-- ONE canonical production deploy lock. Aliases can no longer create a second lock. (2026-08-10)
--
-- THE DEFECT, observed live. acquire_deploy_lock() upserts with `on conflict (lock_name)`, so the
-- lock identity IS the string it is called with. AGENTS.md mandates 'production'. Today THREE
-- different names were in use across concurrent sessions:
--   11:08:39Z  'prod'         held by daily-health-check       (while 'production' was held 11:12:58Z)
--   12:22:29Z  'prod-change'  held by audit-fix-2026-08-10     (while 'production' was held 12:23:06Z)
-- In both windows two sessions each believed they held THE deploy lock and neither excluded the
-- other. It was harmless only because they touched disjoint objects — luck, not design. That is the
-- 2026-07-15 incident class this lock exists to prevent (memory pr78-outage-rollback-2026-07-15).
--
-- Real same-object collisions HAVE happened: 20260809154813's header records that 20260809154032 was
-- "silently reverted 52 seconds later by a concurrent session's migration
-- (20260809154124_dealapp_live_location_overlay), which recreated this same view from its own base
-- text". The same day a concurrent session re-added the sub-1000 price gate and NULLED 220 raw
-- prices (aqar 123 / wasalt 41 / dealapp 56), restored by 20260809122716.
--
-- WHY A PREFIX RULE, NOT AN ALLOWLIST: an enumerated set was the first design, and within minutes
-- 'prod-change' appeared — a name no list would have predicted. Anything named prod* is
-- production-scoped and serialising it against deploys is the safe default; a genuinely separate
-- resource is named for the resource ('gathern_liveness_apply'), never prod*.
--
-- WHY IN THE DATABASE: the offending callers are scheduled agent routines whose prompts live at
-- claude.ai, outside every repo tool's reach. Documentation cannot bind them. Only the database sits
-- on the path every caller shares.
--
-- WHAT THIS DOES NOT DO: collapse unrelated named locks. ops_deploy_lock is a general named-mutex
-- table; 'gathern_liveness_apply' (scrapers/gathern/liveness.py, held by a CI job right now) is a
-- different resource and serialising it against deploys would starve unrelated jobs.

-- 1. Canonical identity. Pure/IMMUTABLE so a CHECK constraint may call it.
create or replace function public.deploy_lock_canonical(p_name text)
returns text
language sql
immutable
as $function$
  -- Compare on the alphanumeric skeleton so 'prod-db', 'PROD_DB', 'prod change' are one identity.
  select case
    when regexp_replace(lower(coalesce(p_name,'')), '[^a-z0-9]', '', 'g') ~ '^prod'
      or regexp_replace(lower(coalesce(p_name,'')), '[^a-z0-9]', '', 'g') in (
           'prd','live','livedb','liveprod','deploy','deployment','deploylock')
    then 'production'
    else lower(btrim(coalesce(p_name,'')))
  end;
$function$;

comment on function public.deploy_lock_canonical(text) is
  'Canonical lock identity. Any prod* name plus prd/live/deploy aliases map to ''production'' so they '
  'contend for ONE row; every other name keeps its own identity, lower-cased, so unrelated named '
  'locks (gathern_liveness_apply) are unaffected. IMMUTABLE - the ops_deploy_lock CHECK calls it.';

-- 2. REFUSE to migrate the locking system underneath an active production writer.
do $guard$
declare v text;
begin
  select string_agg(lock_name || ' / ' || holder, ', ') into v
    from public.ops_deploy_lock
   where expires_at > now()
     and public.deploy_lock_canonical(lock_name) = 'production'
     and holder <> 'claude-senior-run8-lockfix-2026-08-10';
  if v is not null then
    raise exception 'a production writer is ACTIVE (%) - refusing to migrate the lock system under it', v;
  end if;
end $guard$;

-- 3. Append-only audit log. The old design kept NO history (rows are deleted on release), which is
--    exactly why "did these two production changes overlap?" was unanswerable after the fact.
create table if not exists public.ops_deploy_lock_audit (
  id             bigserial primary key,
  at             timestamptz not null default now(),
  action         text        not null check (action in ('acquire','release')),
  requested_name text        not null,
  canonical_name text        not null,
  holder         text        not null,
  granted        boolean     not null,
  blocked_by     text,
  note           text,
  aliased        boolean generated always as (requested_name is distinct from canonical_name) stored
);
comment on table public.ops_deploy_lock_audit is
  'Append-only history of every deploy-lock acquire/release attempt, including REJECTED ones and '
  'whether the caller used a non-canonical alias. Feeds mon_detect_deploy_lock_misuse().';
create index if not exists ops_deploy_lock_audit_at_idx on public.ops_deploy_lock_audit (at desc);

-- 4. Normalise at the table boundary, so even a direct INSERT/UPDATE cannot fork the lock.
create or replace function public.ops_deploy_lock_canonicalize()
returns trigger
language plpgsql
as $function$
begin
  new.lock_name := public.deploy_lock_canonical(new.lock_name);
  return new;
end $function$;

drop trigger if exists trg_ops_deploy_lock_canonicalize on public.ops_deploy_lock;
create trigger trg_ops_deploy_lock_canonicalize
  before insert or update on public.ops_deploy_lock
  for each row execute function public.ops_deploy_lock_canonicalize();

delete from public.ops_deploy_lock
 where lock_name <> public.deploy_lock_canonical(lock_name) and expires_at < now();

-- Belt and braces: if the trigger is ever dropped, an alias INSERT FAILS CLOSED (caller refuses to
-- deploy) instead of silently creating a second lock.
alter table public.ops_deploy_lock drop constraint if exists ops_deploy_lock_name_is_canonical;
alter table public.ops_deploy_lock add constraint ops_deploy_lock_name_is_canonical
  check (lock_name = public.deploy_lock_canonical(lock_name));

-- 5. acquire/release: canonicalise + record every attempt. Same signature, same "zero rows = you did
--    NOT get it" contract every existing caller already depends on.
--    #variable_conflict use_column: the RETURNS TABLE output names (lock_name, holder, ...) would
--    otherwise shadow the table columns in the INSERT / ON CONFLICT below.
create or replace function public.acquire_deploy_lock(
  p_lock_name text, p_holder text, p_ttl_seconds integer default 600, p_note text default null)
returns table(lock_name text, holder text, acquired_at timestamptz, expires_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_canon text := public.deploy_lock_canonical(p_lock_name);
        v_blocker text;
        v_granted boolean;
begin
  return query
    insert into ops_deploy_lock as l (lock_name, holder, acquired_at, expires_at, note)
    values (v_canon, p_holder, now(), now() + make_interval(secs => p_ttl_seconds), p_note)
    on conflict (lock_name) do update
      set holder = excluded.holder,
          acquired_at = excluded.acquired_at,
          expires_at = excluded.expires_at,
          note = excluded.note
      where l.expires_at < now()
    returning l.lock_name, l.holder, l.acquired_at, l.expires_at;

  v_granted := found;
  if not v_granted then
    select l.holder into v_blocker from ops_deploy_lock l where l.lock_name = v_canon;
  end if;

  insert into ops_deploy_lock_audit (action, requested_name, canonical_name, holder, granted, blocked_by, note)
  values ('acquire', coalesce(p_lock_name,''), v_canon, p_holder, v_granted, v_blocker, p_note);
  return;
end $function$;

create or replace function public.release_deploy_lock(p_lock_name text, p_holder text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_canon text := public.deploy_lock_canonical(p_lock_name);
        v_n int;
begin
  delete from ops_deploy_lock where lock_name = v_canon and holder = p_holder;
  get diagnostics v_n = row_count;
  insert into ops_deploy_lock_audit (action, requested_name, canonical_name, holder, granted)
  values ('release', coalesce(p_lock_name,''), v_canon, p_holder, v_n > 0);
  return v_n > 0;
end $function$;

-- 6. The regression barrier, executable against production. Proves prod-vs-production exclusion on
--    the LIVE functions, using reserved holders, and cleans up after itself.
create or replace function public.ops_selftest_deploy_lock_exclusive()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a constant text := '__selftest__lock_holder_A';
  b constant text := '__selftest__lock_holder_B';
  v_rows int; v_ok boolean := true; v_name text;
begin
  if exists (select 1 from ops_deploy_lock
             where lock_name = 'production' and expires_at > now() and holder not in (a, b)) then
    raise notice 'production lock genuinely held - selftest skipped';
    return true;
  end if;
  delete from ops_deploy_lock where holder in (a, b);

  select count(*) into v_rows from acquire_deploy_lock('prod', a, 300, 'selftest');
  if v_rows <> 1 then v_ok := false; end if;

  select l.lock_name into v_name from ops_deploy_lock l where l.holder = a;
  if v_name is distinct from 'production' then v_ok := false; end if;

  select count(*) into v_rows from acquire_deploy_lock('production', b, 300, 'selftest');
  if v_rows <> 0 then v_ok := false; end if;
  select count(*) into v_rows from acquire_deploy_lock('PROD-DB', b, 300, 'selftest');
  if v_rows <> 0 then v_ok := false; end if;
  select count(*) into v_rows from acquire_deploy_lock('prod-change', b, 300, 'selftest');
  if v_rows <> 0 then v_ok := false; end if;
  select count(*) into v_rows from acquire_deploy_lock('Production', b, 300, 'selftest');
  if v_rows <> 0 then v_ok := false; end if;

  select count(*) into v_rows from ops_deploy_lock where lock_name = 'production';
  if v_rows <> 1 then v_ok := false; end if;

  if not release_deploy_lock('production', a) then v_ok := false; end if;

  select count(*) into v_rows from acquire_deploy_lock('prd', b, 300, 'selftest');
  if v_rows <> 1 then v_ok := false; end if;
  perform release_deploy_lock('prod', b);

  select count(*) into v_rows from acquire_deploy_lock('__selftest__unrelated_resource', a, 60, 'selftest');
  if v_rows <> 1 then v_ok := false; end if;
  perform release_deploy_lock('__selftest__unrelated_resource', a);

  delete from ops_deploy_lock where holder in (a, b);
  delete from ops_deploy_lock_audit where holder in (a, b);
  return v_ok;
end $function$;

comment on function public.ops_selftest_deploy_lock_exclusive() is
  'Proves the production deploy lock is truly exclusive across aliases (prod / production / PROD-DB '
  '/ prod-change / prd), that release works across aliases, and that unrelated named locks are '
  'unaffected. Returns false on the pre-2026-08-10 implementation. Self-cleaning; safe on production.';

-- 7. Production monitor: surface alias use and rejected (i.e. genuinely concurrent) writers.
create or replace function public.mon_detect_deploy_lock_misuse()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_alias bigint; v_blocked bigint; v_unknown bigint; v_detail jsonb; n int := 0;
begin
  select count(*) into v_alias from ops_deploy_lock_audit
   where at > now() - interval '7 days' and action = 'acquire' and aliased;
  select count(*) into v_blocked from ops_deploy_lock_audit
   where at > now() - interval '7 days' and action = 'acquire' and not granted;
  select count(*) into v_unknown from ops_deploy_lock
   where lock_name not in ('production', 'gathern_liveness_apply');

  if v_alias = 0 and v_unknown = 0 then
    perform mon_resolve_key('deploy_lock_misuse', 'deploy_lock_misuse');
    return 0;
  end if;

  select jsonb_build_object(
      'alias_acquires_7d', v_alias,
      'rejected_acquires_7d', v_blocked,
      'unknown_lock_identities', v_unknown,
      'offenders', coalesce((select jsonb_agg(distinct jsonb_build_object(
              'holder', a.holder, 'requested', a.requested_name))
            from ops_deploy_lock_audit a
           where a.at > now() - interval '7 days' and a.action = 'acquire' and a.aliased), '[]'::jsonb),
      'why', 'a caller acquired the production deploy lock under a NON-CANONICAL alias. It is now '
             'normalised, so exclusion still holds - but the caller should be corrected at source, '
             'and before 2026-08-10 this exact pattern let two sessions hold "the lock" at once. '
             'rejected_acquires_7d > 0 is NOT a fault: it is the lock correctly refusing a second '
             'concurrent writer.')
    into v_detail;

  n := n + mon_raise('P2', 'deploy_lock_misuse', 'ops', 'deploy_lock_misuse', v_detail);
  return n;
end $function$;

do $wire$
declare src text; newsrc text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if src is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('mon_detect_deploy_lock_misuse' in src) > 0 then raise notice 'already wired'; return; end if;
  if position('''mon_detect_orphaned_detectors''' in src) = 0 then
    raise exception 'anchor missing - runner restructured, refusing to edit blindly';
  end if;
  newsrc := replace(src, '    ''mon_detect_orphaned_detectors''',
    '    ''mon_detect_deploy_lock_misuse'',' || chr(10) || '    ''mon_detect_orphaned_detectors''');
  if newsrc = src then raise exception 'needle-edit produced no change'; end if;
  execute newsrc;
end $wire$;
