-- A BENIGN DIVERGENCE WAS OCCUPYING THE DEDUP KEY A DANGEROUS ONE NEEDS (routine #7, 2026-08-31).
--
-- Drift condition #5 raises ONE alert on ONE constant dedup key,
-- 'migration_content_parity_diverged'. mon_raise() returns 0 and — critically — leaves
-- dispatched_at SET whenever a row with that key is already open and the severity has not
-- escalated. So with a divergence standing open, a NEWLY-APPEARING divergence only rewrites the
-- open alert's detail payload: no new alert, no dispatch, no GitHub issue, nobody told. The
-- counter in the payload silently ticks 3 -> 4 and the ops dashboard shows the same P2 it showed
-- yesterday.
--
-- That is not hypothetical here. Measured 2026-08-31, the three standing divergences
-- (20260830170234, 20260830175938, 20260830202054) are COMMENT-ONLY: strip whole-line `--`
-- comments and blank lines from both sides and the digests are identical
-- (a439cccc56 / 2d096391d1 / 512dccf291, and identical code-line counts). Production ran exactly
-- the executable SQL the repo files declare. They are the benign class — and they were sitting on
-- the key that the class this barrier actually exists for would need: a `do $do$` block
-- registering a detector that lives only in git, the dark-detector shape (see the header of
-- scripts/lib/migrationDrift.ts, and the nine dark detectors of 2026-08-10 in AGENTS.md).
--
-- The comment-only class is not a one-off. It is produced by an ordinary and reasonable workflow:
-- apply the migration, verify it, then write the rationale up into the committed file. It will
-- recur, and every recurrence re-occupies the key.
--
-- THIS DOES NOT WEAKEN THE GATE, AND DELIBERATELY DOES NOT REPLACE THE EXACT COMPARISON.
-- migrationDrift.ts is explicit that normalisation is exact, not fuzzy — "no comment-stripping, no
-- whitespace collapsing: a looser comparison would let real SQL differences hide behind 'it's
-- probably just formatting'". That rule stands: `md5` below is unchanged, it remains the byte-exact
-- digest, and it remains what decides whether a file is divergent at all. `code_md5` is ADDITIVE
-- and is used only to CLASSIFY a divergence that the exact comparison has already found, so the
-- alert can carry a dedup key per class. Every executable divergence still fails, at P1.
--
-- Stripping only WHOLE-LINE comments is the conservative choice: a line beginning with `--` cannot
-- be executable SQL, while a trailing `-- ...` on a code line is left in place, so SQL can never be
-- reclassified as a comment. Blank lines are dropped for the same reason they are meaningless.
--
-- SYMMETRY WITH THE CLIENT is the whole contract, exactly as for `md5` — see the 2026-08-30
-- asymmetric-normalisation false-positive class (issue #1357), where the server hashed raw text and
-- the client hashed trailing-trimmed text, so a byte-perfect mirror could never agree. `code_md5`
-- must stay identical to codeDigestOf() in scripts/lib/migrationDrift.ts:
--   split on '\n' -> drop lines matching /^\s*--/ and lines that are blank after trimming
--                 -> strip each surviving line's trailing whitespace -> join with '\n'
-- scripts/verify-migration-parity-class-split.ts pins that both sides agree, and pins that the two
-- classes use DISTINCT dedup keys so neither can suppress the other.

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
           'md5',     left(md5(regexp_replace(array_to_string(statements, E'\n'), '\s+$', '')), 10),
           -- ADDITIVE (2026-08-31): the same text with whole-line comments and blank lines removed.
           -- Classifies an already-detected divergence as code-level or comment-only. Never decides
           -- WHETHER a file diverges — 'md5' above still does that, byte-exactly.
           'code_md5', left(md5(coalesce((
              select string_agg(regexp_replace(l, '\s+$', ''), E'\n' order by o)
                from regexp_split_to_table(array_to_string(statements, E'\n'), E'\n')
                     with ordinality t(l, o)
               where btrim(l) <> '' and l !~ '^\s*--'
           ), '')), 10))
         order by version), '[]'::jsonb)
    from supabase_migrations.schema_migrations
   where version > p_since
     and statements is not null;
$function$;

comment on function public.ops_migration_content_digests(text) is
  'Drift condition #5 feed. Anon-executable and read-only. Returns, per applied migration: md5 = '
  'the BYTE-EXACT digest (trailing whitespace trimmed) that decides whether a committed file '
  'diverges from what production ran, and code_md5 = the same text with whole-line -- comments and '
  'blank lines removed, which only CLASSIFIES an already-detected divergence as code-level '
  '(dangerous: the dark-detector shape) or comment-only (benign). Both must stay byte-symmetric '
  'with digestOf()/codeDigestOf() in scripts/lib/migrationDrift.ts or every file reads as diverged.';
