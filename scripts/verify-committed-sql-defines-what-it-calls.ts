// NO PRODUCTION-ONLY OBJECTS: committed SQL may not call what no committed migration creates.
//
// WHY THIS EXISTS (ops_incident #26, 2026-09-05)
// ----------------------------------------------
// `prune_inactive_from_search()` is the guaranteed remover of inactive rows from the served search
// index: `sync_search_listings_ar()` calls it in four committed migrations, migration
// 20260824082414 pins its presence in the sync body, and `verify-sync-change-detection-canonical-
// labels.ts` asserts the same string. Its DEFINITION existed only in production. Nobody could
// review it, diff it, or restore it from this repository — and "UNKNOWN: its exact predicate, and
// whether it is guarded" is what docs/ops/LISTING_LIFECYCLE_ENGINEER.md §8 had to record about the
// one function that decides whether a dead listing keeps being served.
//
// HOW IT SURVIVED EVERY EXISTING BARRIER. The migration-drift guard checks five conditions, and all
// five grandfather the pre-strict era: missing_in_git below 20260716093330 (ops_deploy_preflight_
// checks), and committed-not-applied / duplicate-versions / content-parity below
// STRICT_ERA_BASELINE = 20260815000000 (scripts/lib/migrationDrift.ts). The applied row for this
// function is 20260706163008 — under every one of those lines, so all five read clean while the
// object was untracked. Grandfathering is right (judging legacy filenames would cry wolf forever),
// but it left the whole "a production object has no committed definition" class unwatched.
//
// WHAT THIS CHECKS, AND WHAT IT CANNOT. It is OFFLINE and deterministic (so it runs on every PR
// inside `npm test`, unlike the live drift check): for every `public.<name>(` that committed SQL
// references, some committed migration must CREATE that name as a function, table, view,
// materialized view or sequence. That catches exactly the incident's shape — the repo depends on an
// object it never defines. It does NOT see a production object that nothing in the repo references;
// only the live check (`ops_deploy_preflight_checks`, conditions #1/#4) can see those, and it is
// blind below its own baseline. That gap is stated, not papered over.
//
// A COMMENT IS NOT A DEFINITION. Whole-line comments are stripped from both sides before matching,
// using the repo's own `stripSqlCommentsAndBlanks`. Four names in this tree have a
// `create function` that appears ONLY inside a comment — `norm_district_key`,
// `reactivate_suspect_inactive`, `sync_listings_arabic_locations`, `trigger_gh_workflow` — so a
// reader that counted prose would have declared them defined and gone quiet.
//
//   node --experimental-strip-types scripts/verify-committed-sql-defines-what-it-calls.ts

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { stripSqlCommentsAndBlanks } from './lib/migrationDrift.ts';

const root = join(import.meta.dirname, '..');
const MIGRATIONS = join(root, 'supabase', 'migrations');
const BASELINE = join(root, 'scripts', 'production-only-object-baseline.txt');

// The incident-26 artifact. A historical migration never legitimately changes, so its bytes are
// pinned: this is the exact text production executed, recovered verbatim from
// supabase_migrations.schema_migrations.statements (1,411 characters / 1,413 bytes — length()
// counts CHARACTERS, wc -c counts BYTES, and the «→» in its header is where the two differ).
const RECOVERED_FILE = '20260706163008_prune_inactive_from_search.sql';
const RECOVERED_MD5 = 'eaf7d972969dc71d23b35d590f267c6b';

// THE RATCHET. 32 objects were already production-only when this barrier was created; they are
// enumerated in the baseline as known debt. Reconciling one means DELETING its line, so this number
// may only go DOWN. Raising it means "we accepted a new object that exists only in production" —
// a decision that belongs in a reviewed diff, not in an append to a text file.
const MAX_BASELINE_ENTRIES = 32;

let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}${ok || !extra ? '' : `\n        ${extra}`}`);
  if (!ok) failed++;
};

export type SqlFile = { file: string; sql: string };

const DEFINES_FUNCTION = /create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\.)?"?([a-zA-Z0-9_]+)"?\s*\(/gi;
const DEFINES_RELATION =
  /create\s+(?:or\s+replace\s+)?(?:unlogged\s+)?(?:materialized\s+)?(?:table|view|sequence)\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?([a-zA-Z0-9_]+)"?/gi;
const REFERENCES = /\bpublic\.([a-zA-Z0-9_]+)\s*\(/gi;

const namesIn = (sql: string, re: RegExp): string[] =>
  [...sql.matchAll(new RegExp(re.source, re.flags))].map((m) => m[1].toLowerCase());

// Pure: files in, verdict out. No fs, no network — so the mutation proofs below can feed it a
// synthetic corpus and a deliberately broken one.
export function unresolvedPublicRefs(files: SqlFile[]): Map<string, string[]> {
  const defined = new Set<string>();
  const referenced = new Map<string, string[]>();
  for (const { file, sql } of files) {
    const code = stripSqlCommentsAndBlanks(sql);
    for (const n of namesIn(code, DEFINES_FUNCTION)) defined.add(n);
    for (const n of namesIn(code, DEFINES_RELATION)) defined.add(n);
    for (const n of namesIn(code, REFERENCES)) {
      const seen = referenced.get(n) ?? [];
      if (!seen.includes(file)) seen.push(file);
      referenced.set(n, seen);
    }
  }
  return new Map([...referenced].filter(([n]) => !defined.has(n)).sort());
}

const readBaseline = (): Set<string> =>
  new Set(
    readFileSync(BASELINE, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')),
  );

console.log('\nEvery object committed SQL calls is created by a committed migration\n');

const files: SqlFile[] = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS, f), 'utf8') }));

// ── 1. THE RECOVERED DEFINITION IS PRESENT AND VERBATIM ───────────────────────────────────────
const recovered = files.find((f) => f.file === RECOVERED_FILE);
check(!!recovered, `${RECOVERED_FILE} is committed`,
  'the incident-26 recovery was deleted — prune_inactive_from_search() is a production-only object again');
if (recovered) {
  const md5 = createHash('md5').update(recovered.sql, 'utf8').digest('hex');
  check(md5 === RECOVERED_MD5,
    'the recovered definition is byte-identical to the statements production executed',
    `md5 ${md5} != ${RECOVERED_MD5} — a mirror that has been "tidied" is no longer a record of what ran`);
}

// ── 2. NOTHING NEW MAY BE PRODUCTION-ONLY ─────────────────────────────────────────────────────
const baseline = readBaseline();
const unresolved = unresolvedPublicRefs(files);
const fresh = [...unresolved].filter(([n]) => !baseline.has(n));
check(fresh.length === 0,
  `no NEW production-only object (${unresolved.size} known, all baselined)`,
  fresh.map(([n, f]) => `public.${n}() is called by ${f[0]} but created by no committed migration`).join('\n        '));

// ── 3. THE RATCHET ────────────────────────────────────────────────────────────────────────────
check(baseline.size <= MAX_BASELINE_ENTRIES,
  `baseline holds ${baseline.size} entries (floor ${MAX_BASELINE_ENTRIES}, may only shrink)`,
  `baseline GREW to ${baseline.size}. A new production-only object must be RECOVERED, not baselined.`);
const stale = [...baseline].filter((n) => !unresolved.has(n));
check(stale.length === 0,
  'every baseline entry is still genuinely production-only',
  `these now have a committed definition and their baseline lines must be DELETED: ${stale.join(', ')}`);

// ── MUTATION PROOF ────────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, caught: boolean) =>
  check(caught, `(mutation) catches ${what}`,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

// The real defect, on the real corpus: take the recovered file away and incident #26 comes back.
// Both directions, so a reader that always says "unresolved" cannot pass this.
const withoutRecovery = files.filter((f) => f.file !== RECOVERED_FILE);
mustCatch('incident #26 itself — the sync calling prune_inactive_from_search() with no committed CREATE',
  unresolvedPublicRefs(withoutRecovery).has('prune_inactive_from_search') &&
  !unresolved.has('prune_inactive_from_search'));

// A definition that exists only as prose. This is how trigger_gh_workflow reads as "defined" to a
// reader that does not strip comments — and it is the shape of the repo's own "a comment is not a
// code path" rule.
const COMMENTED_OUT: SqlFile[] = [
  { file: 'a.sql', sql: '-- create or replace function public.ghost() returns void as $$ begin end $$;' },
  { file: 'b.sql', sql: 'select public.ghost();' },
];
mustCatch('a CREATE that exists only inside a comment being counted as a definition',
  unresolvedPublicRefs(COMMENTED_OUT).has('ghost'));

// The negative direction: a real definition in the same corpus must silence it, or the check is a
// constant red that someone will eventually delete.
const REALLY_DEFINED: SqlFile[] = [
  { file: 'a.sql', sql: 'create or replace function public.ghost() returns void as $$ begin end $$;' },
  { file: 'b.sql', sql: 'select public.ghost();' },
];
mustCatch('a genuinely defined function being reported as production-only (false positive)',
  !unresolvedPublicRefs(REALLY_DEFINED).has('ghost'));

console.log(failed === 0
  ? '\n✅ verify-committed-sql-defines-what-it-calls: nothing the repo calls is invisible to the repo.'
  : `\n❌ verify-committed-sql-defines-what-it-calls: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
