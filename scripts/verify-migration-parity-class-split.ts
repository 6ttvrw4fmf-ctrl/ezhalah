// DRIFT CONDITION #5 — THE TWO DIVERGENCE CLASSES MUST KEEP DISTINCT DEDUP KEYS.
// Routine #7 (Daily Systems Seam Engineer), 2026-08-31. Offline, deterministic, in `npm test`.
//
// THE BUG THIS PINS SHUT. Condition #5 raised every divergence on ONE constant dedup key,
// 'migration_content_parity_diverged'. public.mon_raise() looks for a row with the same dedup_key
// and resolved_at is null; finding one, it rewrites that row's detail, returns 0, and — the part
// that actually costs — leaves dispatched_at SET unless the severity escalated. Only rows with
// dispatched_at IS NULL are ever sent. So while ANY divergence stood open, a NEWLY-APPEARING one
// produced no alert, no dispatch and no GitHub issue: the open alert's payload silently ticked
// from 3 divergences to 4 and nobody was told.
//
// Measured live 2026-08-31: the three standing divergences (20260830170234, 20260830175938,
// 20260830202054) were all COMMENT-ONLY — strip whole-line `--` comments and blank lines from both
// sides and the digests match exactly (a439cccc56 / 2d096391d1 / 512dccf291). Production had run
// precisely the executable SQL the repo files declared. So the BENIGN class was occupying the key
// that the class this barrier exists for would have needed: a `do $do$` block registering a
// detector that lives only in git — the dark-detector shape, nine of which once read as a clean
// bill of health here (AGENTS.md). And the benign class recurs by construction, because writing
// the rationale into the file after applying the migration is an ordinary workflow.
//
// WHAT IS AND IS NOT BEING RELAXED. Nothing about detection changes. digestOf()/`md5` is still the
// byte-exact comparison, and it alone still decides WHETHER a file diverges — migrationDrift.ts's
// "no comment-stripping, no whitespace collapsing" rule is intact and this file proves it.
// codeDigestOf()/`code_md5` is additive and only CLASSIFIES a divergence already found, so each
// class can carry its own dedup key. Every executable divergence still fails, now at P1.
//
// Run: node --experimental-strip-types scripts/verify-migration-parity-class-split.ts
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { npmTestRuns } from './lib/testRegistry.ts';
import {
  classifyDivergence,
  findContentDivergence,
  stripSqlCommentsAndBlanks,
} from './lib/migrationDrift.ts';
import {
  codeDigestOf,
  digestOf,
  CODE_DEDUP_KEY,
  COMMENT_DEDUP_KEY,
} from './verify-migration-content-parity.ts';

const ROOT = join(import.meta.dirname, '..');
const LIVE_CHECK = 'scripts/verify-migration-content-parity.ts';
const MIGRATION =
  'supabase/migrations/20260831105431_content_parity_code_digest_splits_divergence_classes.sql';

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

// ── 1. THE KEYS ARE DISTINCT ──────────────────────────────────────────────────────────────────
// The whole point. If these ever collapse back to one value, the suppression bug returns and this
// file is the only thing that would notice.
check(
  CODE_DEDUP_KEY !== COMMENT_DEDUP_KEY,
  'the code and comment classes use DISTINCT dedup keys',
  'THE TWO DIVERGENCE CLASSES SHARE ONE DEDUP KEY — a standing benign divergence will again ' +
    'suppress dispatch of a new code-level one',
);
check(
  Boolean(CODE_DEDUP_KEY) && Boolean(COMMENT_DEDUP_KEY),
  'both dedup keys are non-empty',
  'a dedup key is empty — mon_raise would dedup every alert of this kind onto one row',
);

// ── 2. COMMENT STRIPPING IS CONSERVATIVE ──────────────────────────────────────────────────────
// Only WHOLE-LINE comments go. A line starting with `--` cannot be executable SQL; a trailing
// `-- ...` on a code line must stay, or real SQL could be reclassified as a comment and a genuine
// code divergence would be downgraded to the benign class.
check(
  stripSqlCommentsAndBlanks('-- a\nselect 1;\n-- b\n') === 'select 1;',
  'whole-line comments and blank lines are stripped',
  'whole-line comments are not being stripped — the classifier cannot see comment-only drift',
);
check(
  stripSqlCommentsAndBlanks('select 1; -- trailing') === 'select 1; -- trailing',
  'a trailing comment on a code line is KEPT',
  'TRAILING COMMENTS ARE BEING STRIPPED — real SQL differences could be downgraded to benign',
);
check(
  stripSqlCommentsAndBlanks('   -- indented\nselect 1;') === 'select 1;',
  'an indented whole-line comment is stripped',
  'an indented whole-line comment is not recognised',
);
check(
  stripSqlCommentsAndBlanks("select '-- not a comment';") === "select '-- not a comment';",
  'a `--` inside a string literal on a code line is kept',
  'a `--` inside a string literal is being treated as a comment',
);
check(
  stripSqlCommentsAndBlanks('select 1;   \nselect 2;') === 'select 1;\nselect 2;',
  'per-line trailing whitespace is stripped (symmetry with the server)',
  'per-line trailing whitespace is not stripped — the client and server code digests cannot agree',
);
check(
  stripSqlCommentsAndBlanks('select 1;') !== stripSqlCommentsAndBlanks('select 2;'),
  'different executable SQL survives stripping distinctly',
  'the comment stripper is collapsing different SQL together',
);

// ── 3. CLASSIFICATION, AND IT FAILS CLOSED ────────────────────────────────────────────────────
check(
  classifyDivergence('aaaaaaaaaa', 'aaaaaaaaaa') === 'comments',
  'equal code digests → comment-only',
  'equal code digests are not classified as comment-only',
);
check(
  classifyDivergence('aaaaaaaaaa', 'bbbbbbbbbb') === 'code',
  'differing code digests → code-level',
  'A CODE-LEVEL DIVERGENCE IS NOT CLASSIFIED AS SUCH — it would alert at P2 on the benign key',
);
// An older server that does not return code_md5, a rollback, or a malformed payload must never
// read as benign. Unknown is the dangerous class.
check(
  classifyDivergence(undefined, 'aaaaaaaaaa') === 'code' &&
    classifyDivergence('aaaaaaaaaa', undefined) === 'code' &&
    classifyDivergence(undefined, undefined) === 'code',
  'a missing code digest on either side fails CLOSED to the code class',
  'A MISSING CODE DIGEST READS AS BENIGN — an older or rolled-back server would silently ' +
    'downgrade every code-level divergence',
);

// ── 4. THE CLASS REACHES findContentDivergence ────────────────────────────────────────────────
const V = '20260901000000'; // strict era
const commentOnly = findContentDivergence(
  [{ version: V, name: 'thing', file: `${V}_thing.sql`, md5: 'aaaaaaaaaa', codeMd5: 'cccccccccc' }],
  [{ version: V, name: 'thing', md5: 'bbbbbbbbbb', codeMd5: 'cccccccccc' }],
);
check(
  commentOnly.length === 1 && commentOnly[0].kind === 'comments',
  'a byte-divergent but code-identical file is reported, and classified comment-only',
  'a comment-only divergence is misreported (it must still be FOUND — only its class differs)',
);
const codeLevel = findContentDivergence(
  [{ version: V, name: 'thing', file: `${V}_thing.sql`, md5: 'aaaaaaaaaa', codeMd5: 'cccccccccc' }],
  [{ version: V, name: 'thing', md5: 'bbbbbbbbbb', codeMd5: 'dddddddddd' }],
);
check(
  codeLevel.length === 1 && codeLevel[0].kind === 'code',
  'a file whose executable SQL differs is classified code-level',
  'A CODE-LEVEL DIVERGENCE IS CLASSIFIED BENIGN — the dark-detector shape would alert at P2',
);
// Detection is unchanged: classification must never make a divergence disappear.
check(
  findContentDivergence(
    [{ version: V, name: 'thing', file: `${V}_thing.sql`, md5: 'aaaaaaaaaa', codeMd5: 'cccccccccc' }],
    [{ version: V, name: 'thing', md5: 'aaaaaaaaaa', codeMd5: 'zzzzzzzzzz' }],
  ).length === 0,
  'an identical byte digest is still clean regardless of code digest',
  'the exact comparison is no longer what decides whether a file diverges',
);

// ── 5. THE SERVER SIDE STILL CARRIES THE SAME RULE ────────────────────────────────────────────
// The digests are computed in two languages; only symmetry makes them comparable. The 2026-08-30
// false-positive class (issue #1357) is exactly what one side drifting looks like.
check(existsSync(join(ROOT, MIGRATION)), `${MIGRATION} exists`, `${MIGRATION} is missing — the server half of the class split is unmirrored`);
if (existsSync(join(ROOT, MIGRATION))) {
  const sql = readFileSync(join(ROOT, MIGRATION), 'utf8');
  check(sql.includes("'code_md5'"), 'the RPC returns code_md5', 'the RPC no longer returns code_md5 — every divergence fails closed to P1');
  check(
    sql.includes("l !~ '^\\s*--'") && sql.includes("btrim(l) <> ''"),
    'the server strips whole-line comments and blank lines, matching the client',
    'THE SERVER COMMENT RULE NO LONGER MATCHES THE CLIENT — code digests can never agree',
  );
  check(
    sql.includes("regexp_replace(l, '\\s+$', '')"),
    'the server strips per-line trailing whitespace, matching the client',
    'the server per-line whitespace rule diverged from the client',
  );
}

const live = readFileSync(join(ROOT, LIVE_CHECK), 'utf8');
check(
  live.includes('CODE_DEDUP_KEY') && live.includes('COMMENT_DEDUP_KEY'),
  'the live check raises on both class keys',
  'the live check no longer references both dedup keys',
);
check(
  !/p_dedup:\s*DEDUP_KEY\b/.test(live),
  'the old single dedup key is gone from the raise path',
  'THE OLD SHARED DEDUP KEY IS STILL IN USE — the suppression bug is back',
);
check(
  npmTestRuns(ROOT, 'verify-migration-parity-class-split'),
  'this barrier is discovered and run by `npm test`',
  'this barrier is not run by `npm test` — the class split is unpinned',
);

// ── 6. MUTATION PROOF ─────────────────────────────────────────────────────────────────────────
// Break each property deliberately and prove the predicate above would have caught it. A barrier
// that cannot go red is decoration.
const mutations: Array<[string, boolean]> = [
  // Collapse the two keys back onto one — the original bug. The predicate under test is the
  // distinctness check in §1; feed it the pre-fix values and prove it would have gone red.
  [
    'shared dedup key is rejected',
    (() => {
      const oldCode = 'migration_content_parity_diverged';
      const oldComment = 'migration_content_parity_diverged';
      return !(oldCode !== oldComment); // §1's predicate is false ⇒ §1 fails ⇒ mutation caught
    })(),
  ],
  // A stripper that also eats trailing comments would downgrade real SQL differences.
  [
    'a stripper that eats trailing comments is rejected',
    ((s: string) => s.replace(/--.*$/gm, '').trim())('select 1; -- x') !== 'select 1; -- x',
  ],
  // A classifier that treats unknown as benign is rejected.
  [
    'a classifier defaulting unknown to comment-only is rejected',
    ((a?: string, b?: string) => (a === b ? 'comments' : 'code'))(undefined, undefined) !==
      classifyDivergence(undefined, undefined),
  ],
  // A classifier that ignores the code digest entirely is rejected.
  [
    'a classifier that calls everything benign is rejected',
    (() => 'comments')() !== classifyDivergence('aaaaaaaaaa', 'bbbbbbbbbb'),
  ],
];
for (const [name, caught] of mutations) {
  check(caught, `mutation caught — ${name}`, `MUTATION SURVIVED — ${name}`);
}

for (const o of ok) console.log(`  PASS  ${o}`);
if (problems.length) {
  console.error(`\n✗ migration parity class split: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
console.log(`\n✓ migration parity class split: ${ok.length} checks passed`);
