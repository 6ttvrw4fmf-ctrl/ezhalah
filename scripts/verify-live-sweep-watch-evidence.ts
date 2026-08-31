// A PERMANENT WATCH IS GREEN ONLY WITH EVIDENCE IT RAN.
//
// THE DEFECT (found 2026-08-31, daily Search & Matching QA run).
// e2e/live-sweep/run.mjs recorded every watch's ledger result as
//
//     findings.some((f) => f.detail.includes(w)) ? 'fail' : 'pass'
//
// i.e. it read the ABSENCE of a finding as proof of a PASS. A watch produces no finding in three
// different situations, and only one of them is a pass:
//
//   1. it ran and found nothing                                   → genuinely pass
//   2. its journey threw a harness error, or returned null        → NOT evaluated
//   3. nothing in the tree ever asserted it                       → NEVER evaluated, on any run
//
// All three were written to ops_qa_coverage_ledger as `pass`, with a fresh last_tested_at — so the
// staleness rotation also treated them as freshly covered.
//
// Measured on the 2026-08-31 production run: the egress proxy timed out the LAST TWO watch journeys
// (`tab-switch-no-junk-history`, `typed-district-not-dropped`); both were stamped `pass` at
// 08:25:43 and 08:25:11 having executed no assertion at all. Separately, three watches
// (`buyrent-summary-both-budgets`, `unknown-period-stays-unknown`, `clarification-answer-commits`)
// were asserted by NO code anywhere in the repository and had been recorded `pass` on every run
// since they were added. The sweep reported 9/9 watches green and SEARCH & MATCHING HEALTH 10/10.
//
// This is the exact failure shape AGENTS.md names: "a monitor that cannot fire reads as 'clean'",
// and the nine dark detectors that once read as a clean bill of health.
//
// THE CONTRACT THIS PINS.
//   A. The sweep never derives a watch result from the absence of a finding. `pass` requires a
//      positive observeWatch() call reached at the point the assertion is actually made.
//   B. Every declared watch is either observed live (has an observeWatch call site) or names the
//      OFFLINE barrier that evaluates it — and that barrier file must EXIST and must RUN in
//      `npm test`. Naming nowhere is not allowed (same rule scripts/test-exclusions.txt enforces).
//   C. A watch that is neither is DARK: it records `skip`, never `pass`, and fails a coverage floor.
//   D. The offline-cover list cannot be used to retire live coverage: a watch that IS observed in
//      the browser must not appear in it.
//
// Wiring note (AGENTS.md, "How `npm test` finds its checks"): this file runs because it exists.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const sweep = read('e2e/live-sweep/sweep.mjs');
const run = read('e2e/live-sweep/run.mjs');
const journeys = read('e2e/live-sweep/journeys.mjs');
const allSweepSrc = sweep + journeys + run;

// The defect's own shape is quoted in the comments that explain it (here and in sweep.mjs), so the
// guard must read CODE, not prose — otherwise documenting the bug re-triggers the alarm.
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// `findings.some((f) => ...)` nests one level of parentheses, which a [^)]* class cannot span.
const ABSENCE_IMPLIES_PASS = /findings\.some\((?:[^()]|\([^()]*\))*\)\s*\?\s*'fail'\s*:\s*'pass'/;
const sweepCode = stripComments(allSweepSrc);

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
};

// ── the declared watches ─────────────────────────────────────────────────────────────────────────
const watchBlock = sweep.match(/export const WATCHES = \[([\s\S]*?)\];/);
if (!watchBlock) { console.log('FAIL  cannot find WATCHES in e2e/live-sweep/sweep.mjs'); process.exit(1); }
const WATCHES = [...watchBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
check('WATCHES is non-empty', WATCHES.length > 0, `found ${WATCHES.length}`);

const coverBlock = sweep.match(/const WATCH_OFFLINE_COVER = \{([\s\S]*?)\};/);
const OFFLINE = new Map<string, string>(
  coverBlock ? [...coverBlock[1].matchAll(/'([^']+)':\s*'([^']+)'/g)].map((m) => [m[1], m[2]] as [string, string]) : [],
);

// ── A. absence of a finding is never a pass ──────────────────────────────────────────────────────
// The original defect, pinned verbatim so it cannot be reintroduced by a refactor.
check('the ledger write does NOT infer pass from the absence of a finding',
  !ABSENCE_IMPLIES_PASS.test(sweepCode));
check('watchStatus() exists and is what the ledger writes',
  /const watchStatus\s*=/.test(sweep) && /ledgerRecord\('live_watch',\s*w,\s*(st|watchStatus\(w\))/.test(run));
check('watchStatus() requires a positive observation for `pass`',
  /watchesObserved\.has\(name\)\s*\?\s*'pass'/.test(sweep));
check('a watch that is neither observed nor covered offline records `skip`',
  /:\s*'skip'/.test(sweep) && /watchStatus\(w\)\s*===\s*'skip'/.test(sweep));

// ── B. every watch is observed live, or names an offline barrier that exists and runs ────────────
for (const w of WATCHES) {
  // An observeWatch call site for this watch, anywhere in the sweep's own sources.
  const observedLive = new RegExp(`observeWatch\\(\\s*'${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\s*\\)`).test(allSweepSrc);
  const offline = OFFLINE.get(w);

  check(`watch «${w}» has evidence: observed live or covered offline`,
    observedLive || !!offline,
    'declared but nothing evaluates it and it names no offline barrier');

  if (offline) {
    check(`watch «${w}» → ${offline} exists`, existsSync(join(ROOT, offline)));
    const base = offline.replace(/^scripts\//, '').replace(/\.(ts|mjs)$/, '');
    check(`watch «${w}» → ${offline} actually runs in npm test`, npmTestRuns(ROOT, base));
    // D. the offline list must not be used to retire live coverage.
    check(`watch «${w}» is not BOTH observed live and declared offline`, !observedLive,
      'remove it from WATCH_OFFLINE_COVER — the sweep does evaluate it');
  }
}

// ── C. a dark watch fails a coverage floor (not merely logged) ───────────────────────────────────
check('unobserved watches are pushed onto floorMisses', /floorMisses\.push\(`permanent watches never evaluated/.test(run));
check('floor misses still fail the run', /process\.exit\(findings\.length \|\| floorMisses\.length \? 1 : 0\)/.test(run));

// ── MUTATION PROOFS — each guard must FAIL on its own defect ─────────────────────────────────────
// A guard that cannot fail is decoration. Each mutation below is the real regression, applied to a
// copy of the source, and the corresponding predicate must reject it.
const mut = (label: string, broken: string, predicate: (s: string) => boolean) =>
  check(`MUTATION: ${label}`, !predicate(broken), 'the guard accepted the broken form');

mut('the old absence-implies-pass ledger write comes back',
  `ledgerRecord('live_watch', w, findings.some((f) => f.detail.includes(w)) ? 'fail' : 'pass', 'x')`,
  (s) => !ABSENCE_IMPLIES_PASS.test(stripComments(s)));

mut('watchStatus stops requiring an observation',
  `const watchStatus = (name) => findings.some((f) => f.detail.includes(name)) ? 'fail' : 'pass';`,
  (s) => /watchesObserved\.has\(name\)\s*\?\s*'pass'/.test(s));

mut('a dark watch no longer fails the floor',
  `const dark = unobservedWatches(); if (dark.length) console.error('some watches were skipped');`,
  (s) => /floorMisses\.push\(`permanent watches never evaluated/.test(s));

mut('a watch is declared with no observeWatch call site and no offline cover',
  `export const WATCHES = ['ghost-watch'];`,
  (s) => {
    const w = [...(s.match(/export const WATCHES = \[([\s\S]*?)\];/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    return w.every((n) => new RegExp(`observeWatch\\('${n}'\\)`).test(allSweepSrc) || OFFLINE.has(n));
  });

mut('an offline cover entry names a file that does not exist',
  `const WATCH_OFFLINE_COVER = { 'x': 'scripts/verify-this-does-not-exist.ts' };`,
  (s) => {
    const entries = [...(s.match(/const WATCH_OFFLINE_COVER = \{([\s\S]*?)\};/)?.[1] ?? '').matchAll(/'([^']+)':\s*'([^']+)'/g)];
    return entries.every(([, , f]) => existsSync(join(ROOT, f)));
  });

console.log(failures === 0
  ? '\n✓ live-sweep watch evidence: a watch is green only with proof it ran'
  : `\n✗ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
