-- Smoke migration for .github/workflows/apply-migration.yml (owner 2026-11-04): harmless comment, applied by the
-- workflow to prove the file and its history row land together and byte-exact.
comment on function public.ops_migration_sql(text) is
  'Returns the exact SQL applied for a migration version, so it can be mirrored into supabase/migrations/ verbatim instead of being retyped. service_role only. Rows written by .github/workflows/apply-migration.yml read back byte-exact here.';
