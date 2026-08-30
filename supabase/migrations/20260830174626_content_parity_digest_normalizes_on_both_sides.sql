-- Systems Seam, 2026-08-30. Drift condition #5 compared two digests computed by DIFFERENT rules.
--
-- THE BUG. ops_migration_content_digests() hashed the applied text RAW:
--     left(md5(array_to_string(statements, E'\n')), 10)
-- while the client (scripts/verify-migration-content-parity.ts -> digestOf) hashed the repo file
-- AFTER normalizeMigrationSql() stripped its trailing whitespace. So whenever the APPLIED text
-- itself ends in whitespace, the repo side gets trimmed, the applied side does not, and the two can
-- never agree no matter how faithful the mirror is. verify-migration-content-parity.ts:54 states the
-- exact invariant this violated: "The digest must be computed identically on both sides or every
-- file reads as diverged."
--
-- MEASURED ON PRODUCTION, and this is why it surfaced only now. Most migrations are applied without
-- a trailing newline, so the asymmetry is invisible:
--     20260830071705 / 105044 / 134700   applied WITHOUT trailing ws  -> digest unchanged, matched
--     20260830170548                     applied WITH trailing ws     -> raw dd939b04d9, normalized 73d8b42c8f
--     20260830170234                     applied WITH trailing ws     -> raw 5f08246fa0, normalized 6c0a5d1149
-- For 20260830170548 the normalized digest 73d8b42c8f is EXACTLY the repo md5 the checker reported.
-- That mirror was byte-perfect all along: 117 lines vs 117 lines, zero differing lines, and the
-- file's raw md5 equals the applied text's raw md5. The barrier was crying wolf on a faithful file.
--
-- THIS DOES NOT WEAKEN THE CHECK, and that is provable rather than asserted. migrationDrift.ts
-- already defines a faithful mirror as differing "only in trailing whitespace"; this makes the
-- server obey the rule the client already implemented. Every real content difference still fails:
-- 20260830170234 is a GENUINE divergence and stays flagged after this change (normalized applied
-- 6c0a5d1149 vs repo 831764eadf). One false positive clears; one true positive survives. If this
-- change had made both go green it would have been the wrong change.
--
-- Deliberately NOT the alternative fix of removing normalizeMigrationSql() from the client: that
-- would make a mirror's trailing newline a "divergence", which is noise every editor generates and
-- which migrationDrift.ts explicitly rules out. Normalising both sides is the direction that keeps
-- the comparison exact on everything that matters.

create or replace function public.ops_migration_content_digests(p_since text default '20260815000000'::text)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'version', version,
           'name',    name,
           -- SYMMETRY WITH THE CLIENT (2026-08-30): must stay identical to digestOf() in
           -- scripts/verify-migration-content-parity.ts, which hashes
           -- normalizeMigrationSql(file) = file.replace(/\s+$/, ''). Changing either side alone
           -- re-opens the false-positive class this replaced.
           'md5',     left(md5(regexp_replace(array_to_string(statements, E'\n'), '\s+$', '')), 10))
         order by version), '[]'::jsonb)
    from supabase_migrations.schema_migrations
   where version > p_since
     and statements is not null;
$function$;

comment on function public.ops_migration_content_digests(text) is
  'Per applied migration, a digest of what production actually RAN, for drift condition #5. The '
  'digest is taken over the statements with TRAILING WHITESPACE STRIPPED, which must match '
  'digestOf()/normalizeMigrationSql() on the client exactly -- hashing raw here while the client '
  'normalised made every migration applied with a trailing newline read as diverged forever, on a '
  'byte-perfect mirror (2026-08-30). Normalise both sides or neither; never one.';