-- Extend the deploy drift gate to detect the REVERSE direction too (owner 2026-08-21):
-- a migration FILE committed to git whose version was never applied to production, plus expose the
-- data the CLIENT needs to compute it correctly.
--
-- ops_deploy_preflight_checks already returns:
--   missing_in_git       — applied to prod but absent from the repo (version > baseline)
--   duplicate_overloads  — public functions with >1 overload (the PGRST203 outage shape)
-- This adds:
--   applied_ids          — every live schema_migrations.version ∪ name. The reverse diff
--                          (committed-but-not-applied) needs the file (version,name) PAIRS, which the
--                          server never receives — it is handed only a flattened, de-duplicated id
--                          set. So the client (scripts/lib/migrationDrift.ts) does that set-math and
--                          the duplicate-version check; the server just supplies applied_ids. A file
--                          is "applied" iff its version OR its name is in applied_ids — the exact
--                          version-or-name rule missing_in_git already uses, kept symmetric.
--
-- Signature is UNCHANGED (create-or-replace, same one overload) so this itself can never become the
-- duplicate-overload drift it guards against. Existing fields keep their exact meaning; callers that
-- only read missing_in_git / duplicate_overloads are unaffected.
create or replace function public.ops_deploy_preflight_checks(p_repo_versions text[])
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with repo as (
    select coalesce(p_repo_versions, '{}'::text[]) as ids
  ),
  live as (
    select sm.version, sm.name
    from supabase_migrations.schema_migrations sm
  ),
  missing as (
    select l.version, l.name
    from live l, repo r
    where l.version > '20260716093330'          -- baseline: see header comment
      and not (l.version = any(r.ids))
      and not (coalesce(l.name, '') = any(r.ids))
  ),
  applied_ids as (
    select l.version as id from live l
    union
    select l.name from live l where l.name is not null and l.name <> ''
  ),
  dups as (
    select p.proname
    from pg_proc p
    join pg_namespace n on p.pronamespace = n.oid
    where n.nspname = 'public'
      and p.prokind = 'f'
    group by p.proname
    having count(*) > 1
  )
  select jsonb_build_object(
    'baseline', '20260716093330',
    'missing_in_git',
      coalesce((select jsonb_agg(m.version order by m.version) from missing m), '[]'::jsonb),
    'missing_in_git_details',
      coalesce((select jsonb_agg(jsonb_build_object('version', m.version, 'name', m.name)
                                 order by m.version) from missing m), '[]'::jsonb),
    'applied_ids',
      coalesce((select jsonb_agg(a.id) from applied_ids a), '[]'::jsonb),
    'duplicate_overloads',
      coalesce((select jsonb_agg(d.proname order by d.proname) from dups d), '[]'::jsonb),
    'live_migrations_total', (select count(*) from live),
    'checked_at', now()
  );
$function$;
