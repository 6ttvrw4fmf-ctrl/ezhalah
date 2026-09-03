-- Read-only helper so an engineer can recover the EXACT applied SQL of a migration for git
-- mirroring (AGENTS.md: the engineer who applies a migration owns mirroring it, byte-faithfully).
-- Without this, recovering the text means retyping it, which is how a mirror silently drifts from
-- what production actually ran. SECURITY DEFINER because supabase_migrations is not readable by the
-- API roles; it exposes only migration TEXT, which is already source-controlled by definition.
create or replace function public.ops_migration_sql(p_version text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select array_to_string(statements, E';\n')
  from supabase_migrations.schema_migrations
  where version = p_version;
$$;

revoke all on function public.ops_migration_sql(text) from public;
grant execute on function public.ops_migration_sql(text) to service_role;

comment on function public.ops_migration_sql(text) is
  'Returns the exact SQL applied for a migration version, so it can be mirrored into '
  'supabase/migrations/ verbatim instead of being retyped. service_role only.';

select length(public.ops_migration_sql('20260903175817')) as sample_len;
