// A JOURNEY RUN THAT ASSERTED NOTHING MUST NOT BE BOOKED AS A PASS.
//
// `e2e/journeys/run.mjs` decided each run's verdict by subtraction: findings grew → failed, else
// skips grew → skipped, else pass. That reads correctly right up to the case it cannot see — a run
// that recorded NEITHER, because it reached no oracle at all. There is no signal in "no finding and
// no skip" that distinguishes *everything I checked was fine* from *I checked nothing*, and the
// subtraction resolved the ambiguity in the most dangerous direction available: a clean pass, in
// the console, in `ops_qa_coverage_ledger`, and in the rotation that decides what gets tested next.
//
// MEASURED, 2026-09-11 (routine #6). PR #2061 renamed the agent tab «الوكيل الذكي» → «الوسيط الذكي»
// in the repo on 2026-09-06; the production deploy carrying it landed 2026-09-11T12:12:28Z.
// `voice-control` clicks that tab unguarded and everything it asserts is conditional on the mic
// control existing, so from that deploy onwards it clicked a string that no longer existed, stayed
// on Filter home, logged «SpeechRecognition supported=true, mic control rendered=0», and returned —
// no pass, no skip, no defect. The runner booked a pass, 4/4 in fresh contexts across both
// viewports, and PART 10's whole voice surface read as covered while nothing had touched it.
//
// The window was short only because it was caught the same afternoon. What makes it worth a
// permanent barrier is that nothing in the shape of the failure bounds it: had it not been found,
// every subsequent sweep would have reported the same clean pass indefinitely, and the ledger's
// rotation would have kept booking voice as attention already paid.
//
// The stale label is fixed and separately barriered
// (scripts/verify-e2e-targets-still-exist-in-the-product.ts). This barrier is for the CLASS: the
// label was only the trigger, and any future reason a journey fails to reach its surface — a
// removed testid, a changed route, a control behind a flag — lands in exactly the same blind spot.
//
// Run: node --experimental-strip-types scripts/verify-journey-run-records-an-outcome.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyRunOutcome } from '../e2e/journeys/harness.mjs';

const root = join(import.meta.dirname, '..');
let failed = 0;
const ok = (m: string) => console.log(`  ok  ${m}`);
const check = (m: string, cond: boolean) => { if (cond) ok(m); else { console.error(`  FAIL  ${m}`); failed++; } };

// ── 1. THE FULL TRUTH TABLE, EXECUTED ───────────────────────────────────────────────────────────
// Every combination, so a refactor cannot quietly change precedence. The first three rows are the
// runner's ORIGINAL behaviour and must not move; the last row is the case that did not exist.
const TABLE: { defects: number; skipped: number; passed: number; want: string; why: string }[] = [
  { defects: 1, skipped: 0, passed: 0, want: 'defect', why: 'a defect alone' },
  { defects: 1, skipped: 1, passed: 1, want: 'defect', why: 'a defect outranks everything' },
  { defects: 1, skipped: 0, passed: 3, want: 'defect', why: 'passes never mask a defect' },
  { defects: 0, skipped: 1, passed: 0, want: 'skip',   why: 'a skip alone' },
  { defects: 0, skipped: 1, passed: 2, want: 'skip',   why: 'a partial run is a skip, as it always was' },
  { defects: 0, skipped: 0, passed: 1, want: 'pass',   why: 'a real pass' },
  { defects: 0, skipped: 0, passed: 9, want: 'pass',   why: 'many passes' },
  { defects: 0, skipped: 0, passed: 0, want: 'no-outcome', why: 'THE CASE THIS EXISTS FOR — nothing was asserted' },
];
for (const row of TABLE) {
  const got = classifyRunOutcome(row);
  check(`${row.why}: (d=${row.defects},s=${row.skipped},p=${row.passed}) → ${row.want}`, got === row.want);
}

// A missing field must not be read as a pass. `classifyRunOutcome()` with nothing at all is the
// shape a careless caller produces, and it has to fail closed.
check('an empty call is `no-outcome`, never `pass`', classifyRunOutcome() === 'no-outcome');
check('an empty object is `no-outcome`, never `pass`', classifyRunOutcome({}) === 'no-outcome');

// ── 2. MUTATION: the exact defect, replayed ─────────────────────────────────────────────────────
// voice-control's real 2026-09-11 shape: one note, nothing else. `note()` is deliberately NOT an
// outcome — it carries information, not a verdict — so this must classify as `no-outcome`.
check('MUTATION: the measured voice-control run (a note and nothing else) is NOT a pass',
  classifyRunOutcome({ defects: 0, skipped: 0, passed: 0 }) !== 'pass');

// ── 3. THE RUNNER ACTUALLY USES IT ──────────────────────────────────────────────────────────────
// The predicate being right is worth nothing if run.mjs still does its own subtraction. This is the
// one assertion that must read source: the alternative is running a full production sweep to prove
// a branch. It is kept narrow — the decision itself is executed above, not grepped.
const runner = readFileSync(join(root, 'e2e/journeys/run.mjs'), 'utf8');
check('run.mjs imports classifyRunOutcome from the harness', /classifyRunOutcome/.test(runner.split('\n').slice(0, 30).join('\n')));
check('run.mjs calls it once per run', /classifyRunOutcome\(\{/.test(runner));
check("run.mjs turns `no-outcome` into a recorded skip", /'no-outcome'/.test(runner) && /outcome === 'no-outcome'/.test(runner));
check('the runner still counts passes (harness.mjs pushes them, not just logs them)',
  /passes\.push\(/.test(readFileSync(join(root, 'e2e/journeys/harness.mjs'), 'utf8')));

if (failed) { console.error(`\n${failed} check(s) failed\n`); process.exit(1); }
console.log('  PASS  a journey run that asserts nothing is recorded as a skip, never a pass');
