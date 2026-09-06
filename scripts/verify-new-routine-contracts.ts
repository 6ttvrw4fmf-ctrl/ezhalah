// Routines #8 🔴 Regression Hunter, #9 🔬 Production Red Team, #10 🧱 Bug Prevention & Barrier,
// and #11 ♻️ Listing Lifecycle — standing-contract guard.
//
// Sibling of scripts/verify-journey-seam-engineer-contracts.ts and built for the same reason: a
// routine's live prompt lives outside this repo and drifts, so the FILE is the contract — but only
// while something checks the file. These four were added on 2026-09-04 and have no operating
// history yet, which makes them the easiest specs in the tree to quietly hollow out.
//
// What this pins, and why each line is load-bearing:
//
//   1. EXISTENCE + REACHABILITY. A spec nothing links to is a spec nobody reads. ENGINEER_ROUTINES.md
//      is the roster AGENTS.md points at; if a contract falls out of it, the routine keeps running
//      with no contract at all and nothing goes red.
//
//   2. §G BINDING. Each of the four must state that the global engineering policy binds it. Without
//      that line a new spec reads as self-contained and a future run can argue §G.1 (fix first,
//      report last) or §G.2 (exactly six stop reasons) do not apply to it.
//
//   3. THE FOUR HARD RULES — one per routine, each the thing that makes the routine that routine
//      rather than a duplicate of an existing one:
//        #8  the seam / a fix that did not hold      (delete it and #8 becomes a second #4/#5/#6)
//        #9  distrusts the harness; layer disagreement (delete it and #9 becomes a second test run)
//        #10 never weakens a detector to make it green (the owner's words; deleting it inverts the
//            routine — a barrier engineer with permission to relax barriers is the worst role here)
//        #11 UNKNOWN IS NOT DEAD                      (the only one of the four whose loss is
//            IRREVERSIBLE: what follows the 30-day clock is a permanent delete, so a spec that
//            stops saying absence is not a verdict ends in unrecoverable data loss)
//
//   4. NO PHANTOM PATHS, across ALL ELEVEN specs — not just the four. This is the class fix for a
//      failure that happened twice in one day while these very files were being written:
//      ENGINEER_ROUTINES.md §R.2 named `scripts/verify-failure-is-not-emptiness.ts` as the guard
//      covering the failed-fetch class. No such file has ever existed; the real one is
//      `verify-failure-paths-stay-covered.ts`. A named guard reads as coverage, and a reader who
//      sees one stops asking whether the class is protected — so a phantom is worse than silence.
//      BARRIER_ENGINEER.md lists this as failure mode #11 and cites that exact incident, which is
//      why the string survives here in prose: this guard must not flag its own worked example.
//
// Run: node --experimental-strip-types scripts/verify-new-routine-contracts.ts

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join as __join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const REPO_ROOT = __join(import.meta.dirname, '..');
const ROUTINES = 'docs/ops/ENGINEER_ROUTINES.md';

const ok: string[] = [];
const problems: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

// The roster-link predicate, named so the mutation proof at the bottom applies THIS function to a
// real roster with one contract removed, instead of asserting a tautology about a string method.
export const linkedFromRoster = (roster: string, base: string) => roster.includes(base);

// The four contracts, each with the one rule that defines it. Phrases are matched loosely (case
// -insensitive, whitespace-collapsed) so ordinary editing survives and only DELETION trips this.
const CONTRACTS = [
  {
    n: 8, file: 'docs/ops/REGRESSION_HUNTER_ENGINEER.md',
    rule: /seam/i,
    ruleName: 'the seam between owners',
    second: /(did not hold|incomplete fix|regression_survived)/i,
    secondName: 'a fix that did not hold',
  },
  {
    n: 9, file: 'docs/ops/PRODUCTION_RED_TEAM_ENGINEER.md',
    rule: /distrust/i,
    ruleName: 'distrusts the harness',
    second: /(layer_disagreement|two layers|disagree)/i,
    secondName: 'two layers disagreeing',
  },
  {
    n: 10, file: 'docs/ops/BARRIER_ENGINEER.md',
    rule: /never weaken a detector|must never weaken/i,
    ruleName: 'never weakens a detector to make it green',
    second: /mutation/i,
    secondName: 'mutation proof',
  },
  {
    n: 11, file: 'docs/ops/LISTING_LIFECYCLE_ENGINEER.md',
    rule: /UNKNOWN IS NOT DEAD/i,
    ruleName: 'UNKNOWN IS NOT DEAD',
    second: /30[- ]day/i,
    secondName: 'the 30-day retention window',
  },
] as const;

for (const f of [ROUTINES, ...CONTRACTS.map((c) => c.file)]) {
  if (!existsSync(__join(REPO_ROOT, f))) {
    console.error(`❌ new-routine-contracts: ${f} is missing — routine #${
      CONTRACTS.find((c) => c.file === f)?.n ?? '?'} has no contract.`);
    process.exit(1);
  }
}

const roster = readFileSync(__join(REPO_ROOT, ROUTINES), 'utf8');

for (const c of CONTRACTS) {
  const body = readFileSync(__join(REPO_ROOT, c.file), 'utf8');
  const base = c.file.split('/').pop()!;

  check(linkedFromRoster(roster, base),
    `#${c.n}: ${base} is reachable from the roster`,
    `#${c.n}: ${ROUTINES} no longer names ${base} — the contract is unlinked, so nothing routes a run to it`);

  check(/§\s*G\b/.test(body),
    `#${c.n}: states that §G binds it`,
    `#${c.n}: ${base} no longer cites §G — the spec now reads as self-contained and a run can argue fix-first-report-last does not apply`);

  check(c.rule.test(body),
    `#${c.n}: keeps its defining rule — ${c.ruleName}`,
    `#${c.n}: ${base} no longer states ${c.ruleName} — without it the routine is a duplicate of one that already exists`);

  check(c.second.test(body),
    `#${c.n}: keeps ${c.secondName}`,
    `#${c.n}: ${base} no longer mentions ${c.secondName}`);
}

// ── Phantom paths, across every routine contract in docs/ops/ ─────────────────────────────────
// A path a spec names must exist. Globs are skipped (a glob is a pattern, not a claim about one
// file), and so is the one deliberate citation of the historical phantom.
const KNOWN_PHANTOM_CITATION = 'scripts/verify-failure-is-not-emptiness.ts';
const PATH_RE = /\b(?:scripts|src|e2e|docs|supabase|scrapers|\.github)\/[A-Za-z0-9_.\/-]+\.(?:ts|tsx|mjs|cjs|md|sql|py|yml)\b/g;

// Pure, so the mutation proofs below run THIS scanner over a synthetic doc instead of asserting
// something about a filename nobody ever wrote. `exists` is injected for the same reason.
export function phantomPaths(text: string, exists: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const m of text.match(PATH_RE) ?? []) {
    if (m.includes('*') || m === KNOWN_PHANTOM_CITATION) continue;
    if (!exists(m)) out.push(m);
  }
  return out;
}

const specs = readdirSync(__join(REPO_ROOT, 'docs/ops')).filter((f) => f.endsWith('_ENGINEER.md'));
check(specs.length >= 4,
  `docs/ops holds ${specs.length} routine contracts`,
  `docs/ops holds only ${specs.length} *_ENGINEER.md contracts — specs have gone missing`);

const onDisk = (m: string) => existsSync(__join(REPO_ROOT, m));
const phantoms: string[] = [];
for (const spec of [...specs, 'ENGINEER_ROUTINES.md', 'AUTONOMOUS_INCIDENT_LOOP.md']) {
  const p = __join(REPO_ROOT, 'docs/ops', spec);
  if (!existsSync(p)) continue;
  for (const m of phantomPaths(readFileSync(p, 'utf8'), onDisk)) phantoms.push(`${spec} → ${m}`);
}
check(phantoms.length === 0,
  `no routine contract names a repo path that does not exist (${specs.length + 2} files scanned)`,
  `a routine contract names ${phantoms.length} path(s) that do not exist — a named guard reads as coverage:\n      ${phantoms.join('\n      ')}`);

check(npmTestRuns(REPO_ROOT, 'verify-new-routine-contracts'),
  'npm test runs this guard',
  '`npm test` no longer runs verify-new-routine-contracts.ts — the guard is inert');

// ── Mutation proofs: each direction must actually be catchable ────────────────────────────────
const mutations: string[] = [];
const mustCatch = (what: string, wouldFail: boolean) =>
  wouldFail ? mutations.push(what) : problems.push(`MUTATION SURVIVED: ${what} would NOT be caught`);

const lifecycle = readFileSync(__join(REPO_ROOT, CONTRACTS[3].file), 'utf8');
mustCatch('the lifecycle spec dropping UNKNOWN IS NOT DEAD',
  !CONTRACTS[3].rule.test(lifecycle.replace(/UNKNOWN IS NOT DEAD/gi, 'a listing is inactive')));
mustCatch('the barrier spec dropping "never weakens a detector"',
  !CONTRACTS[2].rule.test(readFileSync(__join(REPO_ROOT, CONTRACTS[2].file), 'utf8')
    .replace(/never weaken a detector|must never weaken/gi, 'may adjust a detector')));
// REPAIRED 2026-09-04 by routine #10. Both proofs below replace tautologies that could not fail:
//   * the roster proof was `!roster.replace(/X/g, '').includes('X')` — removing every occurrence of a
//     string and then asking whether it is still there is false for ALL inputs, so it was
//     `mustCatch('…', true)` wearing a string method, and it stayed green with the check deleted.
//   * the phantom proof was `!existsSync('scripts/verify-a-guard-nobody-ever-wrote.ts')` — an
//     assertion about a filename this barrier invented, which never touched the scanner it claims to
//     prove. Both now apply the REAL predicate, and both carry the not-vacuous control beside them.
mustCatch('a contract falling out of the roster',
  !linkedFromRoster(roster.replace('LISTING_LIFECYCLE_ENGINEER.md', 'LIFECYCLE.md'),
                    'LISTING_LIFECYCLE_ENGINEER.md'));
mustCatch('…while the roster as it actually stands still links it (the check is not vacuously red)',
  linkedFromRoster(roster, 'LISTING_LIFECYCLE_ENGINEER.md'));

// The phantom scanner, run over a synthetic spec — one real path, one that has never existed.
const SYNTHETIC_SPEC = 'see `scripts/verify-new-routine-contracts.ts` and `scripts/verify-a-guard-nobody-ever-wrote.ts`';
mustCatch('a spec naming a barrier that does not exist',
  phantomPaths(SYNTHETIC_SPEC, onDisk).join() === 'scripts/verify-a-guard-nobody-ever-wrote.ts');
mustCatch('…while a spec naming only REAL paths is not flagged (no false phantom)',
  phantomPaths('see `scripts/verify-new-routine-contracts.ts`', onDisk).length === 0);
mustCatch('the historical phantom citation staying exempt, so the worked example cannot flag itself',
  phantomPaths(`prose about ${KNOWN_PHANTOM_CITATION}`, onDisk).length === 0);

console.log(
  'new-routine-contracts: #8 #9 #10 #11 must keep their defining rules, stay linked to the roster,\n' +
  '                       and no routine contract may name a path that does not exist\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const m of mutations) console.log(`  ✓ mutation caught: ${m}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — a 2026-09-04 routine contract has been weakened, unlinked, or is citing a phantom.`);
  process.exit(1);
}
console.log(`\n✅ new-routine-contracts: passed (${ok.length} checks, ${mutations.length} mutations).`);
