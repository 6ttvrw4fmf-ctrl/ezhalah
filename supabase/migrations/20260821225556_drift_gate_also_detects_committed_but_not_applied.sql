-- Extend the deploy drift gate to detect the REVERSE direction too (owner 2026-08-21):
-- a migration FILE committed to git whose version was never applied to production.
--
-- ops_deploy_preflight_checks already returns:
--   missing_in_git       — applied to prod but absent from the repo (version > baseline)
--   duplicate_overloads  — public functions with >1 overload (the PGRST203 outage shape)
-- This adds a third:
--   missing_in_prod      — a repo id that is a real 14-digit migration-version timestamp, past the
--                          baseline, yet absent from supabase_migrations.schema_migrations. i.e. a
--                          migration file someone committed but never applied to prod. Only true
--                          14-digit versions are checked; the non-timestamp repo ids (migration
--                          NAMES, and legacy date-only 8-digit prefixes below the baseline) are
--                          ignored — an applied migration always carries its version in live.version.
--
-- Signature is UNCHANGED (create-or-replace, same one overload) so this itself can never become the
-- duplicate-overload drift it guards against. Existing fields keep their exact meaning; callers that
-- only read missing_in_git / duplicate_overloads are unaffected. The 4th condition the owner asked
-- for — duplicate migration VERSIONS in git — is detected repo-side (the RPC receives an already
-- de-duplicated id set, so it cannot see filename dups): see build-repo-migration-versions.cjs.
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
  committed_not_applied as (
    select v as version
    from unnest(coalesce(p_repo_versions, '{}'::text[])) v
    where v ~ '^[0-9]{14}$'
      and v > '20260716093330'
      and not exists (select 1 from live l where l.version = v)
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
    'missing_in_prod',
      coalesce((select jsonb_agg(c.version order by c.version) from committed_not_applied c), '[]'::jsonb),
    'duplicate_overloads',
      coalesce((select jsonb_agg(d.proname order by d.proname) from dups d), '[]'::jsonb),
    'live_migrations_total', (select count(*) from live),
    'checked_at', now()
  );
$function$;
