-- Batch 4 (2026-07-16): deploy-gate RPC — schema-drift + duplicate-overload detection.
--
-- WHY: this morning's 16-minute search outage. A migration applied directly to prod (via MCP)
-- without being committed to git left public.location_search_candidates_ar with TWO overloads
-- (33-arg and 34-arg). PostgREST answered every call with PGRST203 "Could not choose the best
-- candidate function" — i.e. every search, app-wide, until the stale overload was dropped
-- (see 20260716093330_drop_stale_location_search_candidates_ar_overload.sql). Both failure
-- ingredients are detectable from the database itself, BEFORE a deploy is blessed:
--   (a) migrations applied to prod but absent from git (schema drift), and
--   (b) any public function name with more than one overload (the exact PGRST203 shape).
-- scripts/safe-deploy.sh calls this RPC after its live-search smoke test and refuses to advance
-- the approved baseline if either list is non-empty.
--
-- BASELINE '20260716093330' — why missing_in_git is not a naive "live NOT IN repo" check:
-- this repo was built MCP-first and has NEVER been migration-complete. As of 2026-07-16 prod's
-- supabase_migrations.schema_migrations holds 178 applied versions (full 14-digit timestamps,
-- 2026-06-09 → 2026-07-16) while supabase/migrations/ holds ~19 files, most named with date-only
-- prefixes that don't correspond to live version keys at all (e.g. repo 20260716_deploy_lock.sql
-- ↔ live version 20260716091411, name 'deploy_lock' — the MCP apply step mints its own version).
-- A naive check would therefore flag ~170 historical versions and block every deploy forever.
-- Instead: the six most recent drifted migrations (20260706130201, 20260706131008,
-- 20260716091736, 20260716091913, 20260716093330, 20260716094913) were recovered VERBATIM into
-- supabase/migrations/ in this same batch, and the line is drawn at the newest one involved in
-- the outage remediation. The enforced invariant from here on: EVERY migration applied to prod
-- after the baseline must exist in git, matched by version OR by name (see below).
--
-- p_repo_versions — what callers pass: for each supabase/migrations/*.sql file, BOTH the
-- filename's leading digit run (its version, when the file uses a real 14-digit version) AND the
-- remainder after the first underscore (its name). A live migration counts as committed when its
-- version or its name appears in the array — necessary because repo files applied via the MCP
-- get a server-minted timestamp version that never matches a date-only filename prefix.
--
-- duplicate_overloads: public-schema plain functions (prokind='f' — excludes aggregates/window/
-- procedures) grouped by proname with count > 1. Verified against live prod 2026-07-16: the list
-- is EMPTY today (the 093330 fix dropped the offending overload), so no intentional-overload
-- allowlist is needed. If a deliberate overload is ever introduced, it must be added as an
-- explicit exclusion here — with a comment defending why PostgREST can disambiguate it.
--
-- SECURITY: SECURITY DEFINER (owner: postgres, who owns supabase_migrations.schema_migrations —
-- direct SELECT verified 2026-07-16) with search_path pinned. Exposes only drift metadata
-- (migration versions/names past the baseline + duplicated function names), no listing or user
-- data, so anon execution is safe by design — the deploy script authenticates with the same
-- client-public anon key already baked into the app bundle.

create or replace function public.ops_deploy_preflight_checks(p_repo_versions text[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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
    'duplicate_overloads',
      coalesce((select jsonb_agg(d.proname order by d.proname) from dups d), '[]'::jsonb),
    'live_migrations_total', (select count(*) from live),
    'checked_at', now()
  );
$$;

comment on function public.ops_deploy_preflight_checks(text[]) is
  'Deploy gate (batch 4, 2026-07-16): reports prod migrations applied after the 20260716093330 baseline that are missing from git (matched by version OR name), and public functions with duplicate overloads (the PGRST203 outage shape). Called by scripts/safe-deploy.sh; drift metadata only.';

grant execute on function public.ops_deploy_preflight_checks(text[]) to anon, authenticated, service_role;
