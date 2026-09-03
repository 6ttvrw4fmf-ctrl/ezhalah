// THE RATING CANNOT LIE ABOUT ITS OWN COVERAGE.
//
// WHY THIS EXISTS (owner challenge, 2026-08-28)
// --------------------------------------------
// This routine reported «ADVANCED FILTER HEALTH: 9.4/10» and, asked what produced the 9.4, had no
// answer beyond calibrated judgement against the previous run's number. The owner's objection is
// exact: 9.5 must mean "production is extremely close to the canonical Product Contract", never
// "the suite is green". A health score with no derivation is decoration, and a decorative score on
// a correctness routine is worse than no score — it launders "I did not look" as "it is fine".
//
// scripts/lib/afContractCoverage.ts now derives every health number from a per-rule table. That
// table is only worth something if it cannot quietly diverge from the contract it claims to measure.
// The three ways it could rot, and what this file does about each:
//
//   1. A NEW RULE lands in the Product Contract and nobody grades it. The score would keep its old
//      denominator and stay high while coverage silently fell. → every R-number parsed out of
//      docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md must appear in the map.
//   2. AN INCONVENIENT RULE is deleted from the map to lift the average. → the reverse check: every
//      graded contract rule must still exist in the contract, so a deletion is a diff in BOTH files
//      and a rule cannot be dropped without deleting the owner's rule too.
//   3. A GRADE CITES A BARRIER THAT DOES NOT EXIST, or one that never runs. An 'L'/'B' backed by a
//      missing or unwired file is the most flattering possible lie. → every named barrier must be a
//      real file, and every barrier named by a 'B'-graded rule must actually execute somewhere
//      (npm test, or a scheduled live workflow).
//
// It also pins the scoring function itself: the grade weights must stay ordered L > B > P > N, so a
// future edit cannot make "no coverage" worth as much as "live-proved in production".
//
//   node --experimental-strip-types scripts/verify-af-contract-coverage-map.ts   (in `npm test`)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';
import {
  CONTRACT_RULES, ALL_ENTRIES, UNCONTRACTED, GRADE_SCORE, score, tally, byDim,
} from './lib/afContractCoverage.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-af-contract-coverage-map: every Product Contract rule is graded, every grade');
console.log('  cites a real executing barrier, and the scoring function stays honestly ordered.');

// ── 1. THE CONTRACT IS THE DENOMINATOR ───────────────────────────────────────────────────────────
const contract = read('docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md');
const contractRules = [...new Set(
  // A section may carry a letter suffix (§12A → R12A.1). Without the [A-Z]? the grader silently
  // skipped every rule in such a section — seven of them landed ungraded on 2026-09-03 and only
  // R13.12, numbered the ordinary way, was caught. A rule must not be able to hide behind its
  // own numbering.
  [...contract.matchAll(/\*\*(R\d+[A-Z]?\.\d+(?:\.\d+)?)\*\*/g)].map((m) => m[1]),
)];
check('the Product Contract still defines rules to measure against', contractRules.length > 100,
  `${contractRules.length} R-numbers found`);

const graded = new Set(CONTRACT_RULES.map((e) => e.rule));
const ungraded = contractRules.filter((r) => !graded.has(r));
check('EVERY contract rule appears in the coverage map (a new rule cannot land ungraded)',
  ungraded.length === 0, ungraded.length ? `missing: ${ungraded.join(', ')}` : `all ${contractRules.length} graded`);

const contractSet = new Set(contractRules);
const orphans = [...graded].filter((r) => !contractSet.has(r));
check('EVERY graded rule still exists in the contract (a rule cannot be dropped to lift the score)',
  orphans.length === 0, orphans.length ? `orphaned: ${orphans.join(', ')}` : 'none orphaned');

// Duplicate grading would double-weight a rule and skew the average.
const dupes = CONTRACT_RULES.map((e) => e.rule).filter((r, i, a) => a.indexOf(r) !== i);
check('no rule is graded twice', dupes.length === 0, dupes.join(', ') || 'none');

// ── 2. EVERY CITED BARRIER IS REAL, AND EVERY 'B' ACTUALLY RUNS ──────────────────────────────────
const scriptFiles = new Set(
  readdirSync(join(root, 'scripts')).filter((f) => f.endsWith('.ts')).map((f) => f.slice(0, -3)),
);
const cited = [...new Set(ALL_ENTRIES.flatMap((e) => e.barrier))].filter(Boolean);
const missingFiles = cited.filter((b) => !scriptFiles.has(b) && !existsSync(join(root, 'scripts', `${b}.mjs`)));
check('every barrier named anywhere in the map is a real file',
  missingFiles.length === 0, missingFiles.join(', ') || `${cited.length} barriers all present`);

// "Executes somewhere" = npm test, or invoked by a scheduled/dispatchable workflow. A live check is
// not in npm test BY DESIGN (it needs production), so requiring npm test alone would be wrong.
// `npm test` discovers its checks rather than listing them inline (scripts/lib/testRegistry.ts,
// 2026-08-28). Ask the registry the same question the old string-match asked; matching against the
// "test" script would now answer "no" for every barrier in the suite and fail every L/B grade.
const workflows = readdirSync(join(root, '.github', 'workflows'))
  .map((f) => read(join('.github', 'workflows', f))).join('\n');
const runsSomewhere = (b: string) => npmTestRuns(root, b) || workflows.includes(b);

const inert = ALL_ENTRIES
  .filter((e) => e.grade === 'B' || e.grade === 'L')
  .flatMap((e) => e.barrier)
  .filter((b) => b && !runsSomewhere(b));
check("no L/B grade rests on a barrier that never executes (npm test or a workflow)",
  inert.length === 0, [...new Set(inert)].join(', ') || 'every cited barrier runs');

// A 'B' or 'L' with NO barrier at all is a bare assertion — allowed only for 'L', where the evidence
// is a live measurement recorded in the run report rather than a script.
const bareB = ALL_ENTRIES.filter((e) => e.grade === 'B' && e.barrier.length === 0);
check("no rule is graded 'B' (barrier-protected) while naming no barrier",
  bareB.length === 0, bareB.map((e) => e.rule).join(', ') || 'none');

// Every entry must carry evidence prose; an empty string is how a grade becomes unauditable.
const noEvidence = ALL_ENTRIES.filter((e) => e.evidence.trim().length < 15);
check('every grade carries a stated evidence line', noEvidence.length === 0,
  noEvidence.map((e) => e.rule).join(', ') || 'all present');

// ── 3. THE SCORING FUNCTION STAYS HONEST ─────────────────────────────────────────────────────────
check('grade scores stay strictly ordered L > B > P > N',
  GRADE_SCORE.L > GRADE_SCORE.B && GRADE_SCORE.B > GRADE_SCORE.P && GRADE_SCORE.P > GRADE_SCORE.N);
check('a live-proved rule is worth full marks and an uncovered rule is worth nothing',
  GRADE_SCORE.L === 1 && GRADE_SCORE.N === 0);
check('an all-N set scores 0 and an all-L set scores 10',
  score([{ rule: 'x', dim: 'af', weight: 3, grade: 'N', barrier: [], evidence: 'synthetic probe row' }]) === 0
  && score([{ rule: 'y', dim: 'af', weight: 3, grade: 'L', barrier: [], evidence: 'synthetic probe row' }]) === 10);
check('weights actually weight: one w3 N among w1 Ls must score below the unweighted mean',
  score([
    { rule: 'a', dim: 'af', weight: 3, grade: 'N', barrier: [], evidence: 'synthetic probe row' },
    { rule: 'b', dim: 'af', weight: 1, grade: 'L', barrier: [], evidence: 'synthetic probe row' },
  ]) < 5);

// ── 4. THE PROBE-FAILURE RULE IS EITHER CONTRACTED, OR REGISTERED AS A GAP ───────────────────────
// X1 ("a failed/timed-out probe is UNKNOWN, never a verdict") was an owner rule with code and a
// barrier but no R-number, carried in UNCONTRACTED so the gap stayed visible. The owner made it
// canonical on 2026-08-28 as R2.5.4, so the register is now legitimately empty.
//
// This check therefore proves the CLOSURE rather than the gap, and it is deliberately an either/or:
// emptying the register is only allowed when the contract genuinely carries the rule. Deleting the
// row to tidy up, without the rule landing in the contract, fails here — which is the only reason
// the register was ever worth having.
const probeRuleContracted = /R2\.5\.4/.test(contract) && /FAILED, TIMED-OUT OR ERRORED PROBE/i.test(contract);
check('the probe-failure rule is canonical (R2.5.4) OR still registered as an uncontracted gap',
  probeRuleContracted || UNCONTRACTED.some((e) => e.rule.startsWith('X1-')),
  probeRuleContracted ? 'canonical as R2.5.4' : `registered: ${UNCONTRACTED.map((e) => e.rule).join(', ')}`);
check('the rule the contract now states is the one the code actually implements',
  /PROBE_FAILED/.test(read('src/lib/afProbe.ts')) && /never invent or estimate a count/i.test(contract));

// ── REPORT ───────────────────────────────────────────────────────────────────────────────────────
const t = tally(CONTRACT_RULES);
console.log(`\n  contract rules graded: ${CONTRACT_RULES.length}  (L ${t.L} · B ${t.B} · P ${t.P} · N ${t.N})`);
console.log(`  AF        ${score(byDim(ALL_ENTRIES, 'af')).toFixed(1)}/10`);
console.log(`  TRENDING  ${score(byDim(ALL_ENTRIES, 'trending')).toFixed(1)}/10`);
console.log(`  INTEGRITY ${score(byDim(ALL_ENTRIES, 'integrity')).toFixed(1)}/10`);
console.log(`  OVERALL   ${score(ALL_ENTRIES).toFixed(1)}/10`);

console.log(failures === 0
  ? '\n✅ verify-af-contract-coverage-map: all checks passed.'
  : `\n❌ verify-af-contract-coverage-map: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
