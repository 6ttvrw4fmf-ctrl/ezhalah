// A DOCUMENTED BARRIER THAT DOES NOT EXIST IS WORSE THAN NO BARRIER — a reader who sees a named
// guard in a spec stops asking whether the class is protected.
//
// THE FINDING THAT PUT THIS HERE (2026-09-06, routine #10). `docs/ARCHITECTURE.md` §19.1 is a table
// headed "Search-correctness tripwires (build-time, deploy-blocking)", and one of its three rows is
//
//   | Gathern rent-only (§20.8) | `scripts/verify-gathern-rent-only.ts` | 3 layers: (1) DATA — 0
//   | gathern/aqarmonthly rows tagged `deal_ar='بيع'`; (2) RPC …; (3) CODE … |
//
// No such file exists anywhere in the tree, and `gathern_residential_listings` has no `deal_ar`
// column at all any more — so the row promised a deploy-blocking guard over an invariant stated in
// terms of a column that is gone. A reader consulting the tripwire table to ask "is the rent-only
// rule guarded?" got a confident yes from a citation nobody had executed.
//
// This is not the first one. `docs/ops/BARRIER_ENGINEER.md` PART 1 item 11 records the same shape
// from 2026-09-04: `ENGINEER_ROUTINES.md` §R.2 named `scripts/verify-failure-is-not-emptiness.ts` as
// "the replacement" for a rejected routine; what actually landed was
// `verify-failure-paths-stay-covered.ts`. Both phantoms were created the same way — by a writer who
// had two names in mind — which is exactly when the defect is easiest to introduce and hardest to
// notice. That spec's instruction is literally "grep every barrier path a doc names against the
// filesystem; a citation is a claim". This is that grep, made permanent, so it stops depending on
// one routine remembering to run it.
//
//   node --experimental-strip-types scripts/verify-docs-name-real-barriers.ts   (in `npm test`)

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const root = join(import.meta.dirname, '..');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '❌'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failed++;
};

// ── EXCEPTIONS: a citation that is deliberately NOT a claim of coverage ───────────────────────────
// Each row names the doc, the path, and why. Two kinds only, and both are self-limiting: an
// illustrative placeholder in an instruction, and a narration OF a phantom (a post-mortem naming the
// file that never existed is the whole point of the sentence). The rows are verified below — a
// stale exception, or one whose citation has moved, fails just as loudly as a phantom.
const NOT_A_CLAIM: { doc: string; path: string; why: string }[] = [
  { doc: 'AGENTS.md', path: 'scripts/verify-my-thing.ts',
    why: 'the placeholder name in "To add a barrier, create scripts/verify-my-thing.ts" — an instruction, not a citation' },
  { doc: 'docs/ops/BARRIER_ENGINEER.md', path: 'scripts/verify-failure-is-not-emptiness.ts',
    why: 'PART 1 item 11 narrates this exact phantom as its worked example; the file never existed and naming it is the point' },
  { doc: 'docs/ARCHITECTURE.md', path: 'scripts/verify-gathern-rent-only.ts',
    why: '§19.1\'s correction note records what the removed table row used to promise; the row itself is gone, and a table row naming it would still fail (exceptions never excuse a `|` line)' },
  { doc: 'docs/ARCHITECTURE.md', path: 'scripts/verify-locations.mjs',
    why: '§19.1\'s note records that this older tripwire was REMOVED, not merely unwired — naming it is how a reader knows the earlier note was stale' },
];

// ── THE PREDICATE, PURE ───────────────────────────────────────────────────────────────────────────
export type Citation = { doc: string; path: string; line: number; inTable: boolean };

/** Every `scripts/...` path a markdown file cites, with where it was cited. */
export function citationsIn(doc: string, text: string): Citation[] {
  const out: Citation[] = [];
  text.split('\n').forEach((l, i) => {
    for (const m of l.matchAll(/scripts\/[A-Za-z0-9_./-]*\.(?:ts|mjs|cjs|sh|py)/g)) {
      out.push({ doc, path: m[0].replace(/[.,;:)]+$/, ''), line: i + 1, inTable: l.trimStart().startsWith('|') });
    }
  });
  return out;
}

/**
 * Citations that promise a file which is not there. `exists` and the exception list are arguments so
 * a proof can hand this a tree where the file is missing — the barrier must not need the real
 * filesystem to be shown failing.
 */
export function phantomCitations(
  citations: readonly Citation[],
  exists: (p: string) => boolean,
  exceptions: readonly { doc: string; path: string }[] = [],
): Citation[] {
  const excused = new Set(exceptions.map((e) => `${e.doc}::${e.path}`));
  // AN EXCEPTION NEVER EXCUSES A TABLE ROW. Narrating a phantom in prose ("this row used to name X,
  // which never existed") is history a reader needs; a `|`-delimited row is a coverage TABLE entry,
  // which is the claim this barrier exists to refuse. Without this split, excusing the narration
  // would also excuse re-adding the very row it is describing — the exception becoming cover for the
  // defect it documents.
  return citations.filter((c) => !exists(c.path) && (c.inTable || !excused.has(`${c.doc}::${c.path}`)));
}

// ── THE SWEEP ─────────────────────────────────────────────────────────────────────────────────────
const docs: string[] = ['AGENTS.md', 'CLAUDE.md'];
const walk = (dir: string) => {
  for (const e of readdirSync(join(root, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel);
    else if (rel.endsWith('.md')) docs.push(rel);
  }
};
walk('docs');

console.log('\nEvery scripts/ path a doc names must exist — a citation is a claim of coverage\n');

check('the sweep actually found documentation to read (it cannot pass by finding nothing)',
  docs.length >= 20, `only ${docs.length} markdown file(s) discovered`);

const citations = docs
  .filter((d) => existsSync(join(root, d)))
  .flatMap((d) => citationsIn(d, readFileSync(join(root, d), 'utf8')));

check('the sweep actually found citations to check (an empty citation set proves nothing)',
  citations.length >= 50, `only ${citations.length} scripts/ citation(s) found across ${docs.length} docs`);

const phantoms = phantomCitations(citations, (p) => existsSync(join(root, p)), NOT_A_CLAIM);
check('every scripts/ path named in documentation exists on disk',
  phantoms.length === 0,
  phantoms.map((p) => `${p.doc}:${p.line} names ${p.path}, which does not exist`).join('\n      ')
  + (phantoms.length
    ? '\n      Either the guard was renamed (point the doc at the real file and say what it covers), or it '
      + 'never landed (say so — a table row promising a deploy-blocking tripwire that nothing runs is '
      + 'read as coverage). If the citation is deliberately NOT a claim, add it to NOT_A_CLAIM with a reason.'
    : ''));

// Exceptions may not rot: each must still be cited where it says it is.
for (const e of NOT_A_CLAIM) {
  check(`exception still cited where it claims: ${e.path} in ${e.doc}`,
    citations.some((c) => c.doc === e.doc && c.path === e.path),
    `no longer appears there — delete the exception rather than leaving it as cover for a future phantom`);
  check(`exception states a reason: ${e.path}`, e.why.trim().length > 20);
}

check('this barrier runs in `npm test` (asked of the registry, never by string-matching package.json)',
  npmTestRuns(root, 'verify-docs-name-real-barriers'));

// ── MUTATION PROOFS ───────────────────────────────────────────────────────────────────────────────
console.log('');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  ✓ MUTATION catches ${label}`); return; }
  mutFail++;
  console.error(`  ❌ MUTATION BLIND to ${label}`);
};

const REAL_ROW = '| Gathern rent-only (§20.8) | `scripts/verify-gathern-rent-only.ts` | 3 layers: (1) DATA … |';
const real = (p: string) => p === 'scripts/verify-taxonomy.ts';

mustCatch('THE 2026-09-06 FINDING, verbatim: a tripwire table row naming a file that does not exist',
  phantomCitations(citationsIn('docs/ARCHITECTURE.md', REAL_ROW), real).length === 1);
mustCatch('the 2026-09-04 shape: a spec naming "the replacement" barrier under a name that never landed',
  phantomCitations(citationsIn('docs/ops/ENGINEER_ROUTINES.md',
    'the replacement is `scripts/verify-failure-is-not-emptiness.ts`.'), real).length === 1);
mustCatch('a phantom cited on a later line of a multi-line doc (the reader is not just checking line 1)',
  phantomCitations(citationsIn('docs/x.md', `intro\nmore\nsee scripts/verify-gone.ts for this`), real)[0]?.line === 3);
mustCatch('a citation whose file DOES exist is not flagged (the predicate is not vacuously red)',
  phantomCitations(citationsIn('docs/x.md', 'see `scripts/verify-taxonomy.ts`'), real).length === 0);
mustCatch('an exception excusing ONE doc does not excuse the same phantom cited from ANOTHER doc',
  phantomCitations(citationsIn('docs/other.md', 'see scripts/verify-my-thing.ts'), real,
    [{ doc: 'AGENTS.md', path: 'scripts/verify-my-thing.ts' }]).length === 1);
mustCatch('…while the excused citation in its OWN doc is still excused',
  phantomCitations(citationsIn('AGENTS.md', 'create scripts/verify-my-thing.ts'), real,
    [{ doc: 'AGENTS.md', path: 'scripts/verify-my-thing.ts' }]).length === 0);
mustCatch('trailing sentence punctuation is not read as part of the filename',
  citationsIn('docs/x.md', 'run scripts/verify-taxonomy.ts.')[0].path === 'scripts/verify-taxonomy.ts');
mustCatch('AN EXCUSED PHANTOM RE-ADDED AS A COVERAGE TABLE ROW — the exception must not cover the row it documents',
  phantomCitations(citationsIn('docs/ARCHITECTURE.md', REAL_ROW), real,
    [{ doc: 'docs/ARCHITECTURE.md', path: 'scripts/verify-gathern-rent-only.ts' }]).length === 1);
mustCatch('…while the same name narrated in PROSE in that doc stays excused',
  phantomCitations(citationsIn('docs/ARCHITECTURE.md', 'the row used to name `scripts/verify-gathern-rent-only.ts`, which never existed.'),
    real, [{ doc: 'docs/ARCHITECTURE.md', path: 'scripts/verify-gathern-rent-only.ts' }]).length === 0);

failed += mutFail;
console.log(failed === 0
  ? '\n✅ verify-docs-name-real-barriers: every documented guard is a real file.\n'
  : `\n❌ verify-docs-name-real-barriers: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
