// Data Integrity Engineer §0 standing operating contract guard (owner-granted, 2026-08-12).
//
// docs/ops/DATA_INTEGRITY_ENGINEER.md §0 is what makes routine #3 FINISH its own work instead of
// handing safely fixable problems back to the owner. Like the agent-authority contract, the risk
// runs in both directions and this guard watches both:
//
//   • DELETION / DILUTION — the contract quietly loses the clause that says "do not report while
//     safely fixable Ezhalah-side issues remain", and the routine drifts back to writing up a
//     partial run. That is the exact behaviour the owner wrote §0 to stop.
//
//   • WIDENING — a future run trims §0.1 to unblock itself. §0 grants COMPLETION authority, never
//     permission to cut a corner: source truth, destructive safety gates (kill caps, anomaly and
//     collapse guards, coverage floors, strike grace, retention, the deploy locks) and the RED list
//     are outside it. Dropping one of those is an OWNER decision, so CI goes red before it matters.
//
// It also pins the two load-bearing structural facts:
//
//   1. §0 must name THIS job. The owner's instruction was "Do not create a different engineer or
//      duplicate routine" — a contract that stops naming routine #3 / trig_01Tr6Rb6XPggFXqCf3EKG62y
//      could be silently re-attached to a different engineer, or copied into a fifth one.
//   2. ENGINEER_ROUTINES.md must still be owner-locked at FOUR routines and still name this one.
//      That file is what prevents overlapping duplicate engineers from accumulating.
//
// And, as with the authority contract, AGENTS.md must keep pointing here: AGENTS.md is loaded into
// every session and declared as overriding, so the contract only has force while AGENTS.md routes
// agents to it.
//
// Run: node --experimental-strip-types scripts/verify-data-integrity-contract.ts
import { readFileSync, existsSync } from 'node:fs';

const SPEC = 'docs/ops/DATA_INTEGRITY_ENGINEER.md';
const ROUTINES = 'docs/ops/ENGINEER_ROUTINES.md';
const AGENTS = 'AGENTS.md';

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

for (const f of [SPEC, ROUTINES, AGENTS]) {
  if (!existsSync(f)) {
    console.error(`❌ data-integrity-contract: ${f} is missing — the routine's contract is incoherent.`);
    process.exit(1);
  }
}

// Prose checks run against a NORMALISED copy. The contract is written for humans: it uses **bold**
// on exactly the phrases worth pinning, quotes the owner in a `>` blockquote, and hard-wraps at ~100
// columns — so a pinned sentence routinely spans two lines with a `> ` in the middle. Matching the
// raw text would fail for pure formatting reasons and teach the next author to delete the check
// instead of the content.
//
// Strip `*` and backticks only — NOT `_`, which is part of identifiers like
// trig_01Tr6Rb6XPggFXqCf3EKG62y and would silently mangle the very thing being pinned. Then drop
// blockquote markers and collapse all whitespace, so wrapping is irrelevant.
const norm = (s: string) =>
  s.replace(/[*`]/g, '')       // emphasis only; `_` is load-bearing in identifiers
   .replace(/^\s*>\s?/gm, '')  // blockquote markers (the owner's words are quoted)
   .replace(/\s+/g, ' ')       // collapse hard wrapping
   .trim();

const spec = readFileSync(SPEC, 'utf8');
const plain = norm(spec);
const lc = plain.toLowerCase();
const routines = norm(readFileSync(ROUTINES, 'utf8'));
const agents = readFileSync(AGENTS, 'utf8');

// ── 1. §0 exists and is attached to THIS job ─────────────────────────────────────────────────
check(/##\s*§0\.\s*Standing operating contract/i.test(plain),
  '§0 standing operating contract is present',
  `${SPEC} has lost its §0 standing operating contract — the routine reverts to asking permission ` +
  `for normal safely provable fixes`);

check(plain.includes('trig_01Tr6Rb6XPggFXqCf3EKG62y'),
  '§0 names this routine by trigger id, so it cannot be re-attached to a different engineer',
  `${SPEC} §0 no longer names trig_01Tr6Rb6XPggFXqCf3EKG62y — the owner attached this contract to ` +
  `routine #3 specifically ("Do not create a different engineer or duplicate routine")`);

// ── 2. The completion duty — the whole point of §0 ───────────────────────────────────────────
for (const [needle, why] of [
  ['find → prove → root cause → fix → repair affected data → add/strengthen barrier → deploy → production verify → continue testing',
   'the end-to-end lifecycle the routine must complete'],
  ['do not send the final report while safely fixable ezhalah-side issues from the run remain unfinished',
   'the clause that stops a partial run being written up as finished'],
  ['0 known safely fixable ezhalah-side issues remaining',
   'the completion target that makes the 10/10 goal measurable'],
] as const) {
  check(lc.includes(needle.toLowerCase()),
    `§0 keeps: "${needle.slice(0, 52)}…"`,
    `${SPEC} §0 dropped ${why} — specifically the text "${needle}"`);
}

// ── 3. §0.1 — what the grant does NOT waive. Trimming this is the widening risk. ─────────────
check(/§0\.1/.test(plain), '§0.1 (what §0 does not waive) is present',
  `${SPEC} lost §0.1 — §0 would read as unlimited authority`);

for (const [needle, why] of [
  ['never bypass source truth or a destructive safety gate just to reach 10/10',
   'the rule that stops the score becoming a reason to cut a corner'],
  ['source truth is absolute', 'the source-is-truth floor'],
  ['destructive safety gates stay closed', 'the kill-cap / collapse-guard / coverage-floor floor'],
  ['red list', 'the owner-approval categories in AGENT_AUTHORITY.md'],
] as const) {
  check(lc.includes(needle),
    `§0.1 still holds: ${why}`,
    `${SPEC} §0.1 no longer states ${why} ("${needle}") — an agent could read §0 as licence to ` +
    `loosen a gate or overwrite source data to finish. Widening this is an OWNER decision.`);
}

// ── 4. The report shape the owner asked for ──────────────────────────────────────────────────
check(/before rating/i.test(plain) && /after rating/i.test(plain),
  '§0.3 pins the one BEFORE → AFTER report',
  `${SPEC} lost the BEFORE → AFTER report shape — the owner asked for exactly one report per run ` +
  `in that order`);

check(lc.includes('remaining genuine source limitations'),
  'genuine source limitations stay reported separately, not scored away',
  `${SPEC} no longer requires source limitations / owner decisions to be reported separately — ` +
  `without it they can be quietly folded into the score`);

// ── 5. Structural: exactly four routines, this one among them ────────────────────────────────
check(/exactly\s+FOUR separate cloud routines/i.test(routines),
  'ENGINEER_ROUTINES.md is still owner-locked at four routines (no duplicate engineers)',
  `${ROUTINES} no longer states the owner lock of exactly FOUR routines — duplicate/overlapping ` +
  `engineers are exactly what the owner said not to create`);

check(routines.includes('trig_01Tr6Rb6XPggFXqCf3EKG62y') && /Data Integrity Engineer/i.test(routines),
  'ENGINEER_ROUTINES.md still lists this engineer as routine #3',
  `${ROUTINES} no longer lists the Senior Data Integrity Engineer — the roster and the contract ` +
  `have drifted apart`);

// ── 6. The load-bearing link: AGENTS.md must still route agents here ─────────────────────────
check(agents.includes('docs/ops/DATA_INTEGRITY_ENGINEER.md'),
  'AGENTS.md still routes agents to the spec',
  `${AGENTS} stopped pointing at ${SPEC} — the contract only governs while AGENTS.md links it`);

check(/§0/.test(agents),
  'AGENTS.md surfaces the §0 contract, not just the spec file',
  `${AGENTS} no longer mentions §0 — a session reading only AGENTS.md would not learn that this ` +
  `routine is expected to finish its own work`);

// ── 7. Worthless if nothing runs it ──────────────────────────────────────────────────────────
check(readFileSync('package.json', 'utf8').includes('verify-data-integrity-contract'),
  'npm test runs this guard',
  'package.json no longer runs verify-data-integrity-contract.ts — the guard is inert');

console.log('data-integrity-contract: §0 must keep granting completion, and keep its limits\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — the Data Integrity §0 contract has been ` +
    `weakened, widened, or unlinked.`);
  process.exit(1);
}
console.log('\n✅ data-integrity-contract: passed.');
