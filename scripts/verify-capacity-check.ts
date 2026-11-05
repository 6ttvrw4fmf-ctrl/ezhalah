// THE CAPACITY CHECK'S RAMP CAN STOP, AND CANNOT PASS 8 — hermetic half of the weekly capacity check (2026-11-05).
//
// scripts/lib/capacityRamp.ts decides, for the live robot (scripts/verify-capacity-check-live.ts), whether the database
// is quiet enough to start a step, whether a step passed, when to stop and what the safe number of simultaneous
// searches is. A robot that loads production and cannot stop is the 2026-10-09 outage shape (AGENTS.md «our own robots
// must not take production down»), so this file EXECUTES those decisions and then plants defects in a copy of the
// real source — the p95 stop removed, the error stop removed, the cap lifted, a fast error counted as speed — and fails
// unless every planted defect is caught. It also proves the live half is still homed and invoked, and that the
// workflow keeps its quiet slot and its no-overlap group.
//
//   node --experimental-strip-types scripts/verify-capacity-check.ts   (discovered by `npm test`)
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRegistry } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';
import * as real from './lib/capacityRamp.ts';

const ROOT = join(import.meta.dirname, '..');
const LIB = join(ROOT, 'scripts/lib/capacityRamp.ts');
type Lib = typeof real;
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches: ${label}`, caught, 'every claim still holds — the barrier is blind to this defect');

const S = (ms: number, n: number, ok = true) => Array.from({ length: n }, () => ({ ms, ok }));
const step = (L: Lib, concurrency: number, samples: { ms: number; ok: boolean }[]) =>
  ({ concurrency, seconds: 45, results: L.stats(samples), calls: { results_rpc: L.stats(samples), cards_phase: L.stats(S(10, 3)) } });

/** Every rule as an executable claim. Returns the claims that do NOT hold for this copy of the library. */
function broken(L: Lib): string[] {
  const out: string[] = [];
  const claim = (label: string, ok: boolean) => { if (!ok) out.push(label); };
  // the results-phase p95 at which the first card lands exactly at the strip's end
  const LIMIT = L.DATA_READY_LIMIT_MS - L.TAP_TO_FIRST_REQUEST_MS;
  const fast = (c: number) => step(L, c, S(LIMIT / 4, 40));

  // the owner's number: 12 s to the first card; the data limit sits inside it, the warning inside that
  claim('owner rule: first card by 12 s; data limit ≤ 12 s; warning < limit',
    L.FIRST_CARD_LIMIT_S === 12 && L.DATA_READY_LIMIT_MS <= 12_000 && L.DATA_READY_WARN_MS < L.DATA_READY_LIMIT_MS
    && L.TAP_TO_FIRST_REQUEST_MS > 0);

  // the cap: literal 8, so lifting CAP itself is caught too
  claim('the cap is 8 and every step is ≤ 8', L.CAP === 8 && L.STEPS.every((c) => c <= 8) && L.STEPS[0] === 1);
  const walk: number[] = [];
  const done: ReturnType<typeof fast>[] = [];
  for (let c = L.nextConcurrency(done); c !== null && walk.length < 20; c = L.nextConcurrency(done)) { walk.push(c); done.push(fast(c)); }
  claim('an all-passing ramp walks 1 → 8 and stops there', walk.join(',') === '1,2,3,4,6,8' && Math.max(...walk) <= 8);
  claim('an all-passing ramp reports 8, ended at the cap', L.safeConcurrency(done) === 8 && L.ended(done, false) === 'cap');

  // the first-card stop (data ready = tap→first request + results phase)
  const slow3 = [fast(1), fast(2), step(L, 3, S(LIMIT + 1, 40))];
  claim('data ready after the strip ends fails the step', L.verdict(slow3[2]) === 'late' && L.dataReadyP95(slow3[2]) === L.DATA_READY_LIMIT_MS + 1);
  claim('a late first card STOPS the ramp', L.nextConcurrency(slow3) === null);
  claim('the safe number is the last step before the slow one', L.safeConcurrency(slow3) === 2 && L.ended(slow3, false) === 'limit');
  claim('data ready exactly at the limit passes', L.verdict(step(L, 1, S(LIMIT, 40))) === 'pass');
  const margin = [fast(1), step(L, 2, S(L.DATA_READY_WARN_MS - L.TAP_TO_FIRST_REQUEST_MS + 1, 40)), fast(3)];
  claim('the warning margin is its own number (passes the limit, fails the warning)',
    L.safeConcurrency(margin) === 3 && L.safeConcurrency(margin, L.DATA_READY_WARN_MS) === 1);

  // the error stop
  const err = step(L, 2, [...S(100, 49), { ms: 100, ok: false }]);
  claim('2 % errors fail the step', L.verdict(err) === 'errors');
  claim('an error STOPS the ramp', L.nextConcurrency([fast(1), err]) === null && L.safeConcurrency([fast(1), err]) === 1);
  claim('0.5 % errors pass', L.verdict(step(L, 2, [...S(100, 199), { ms: 100, ok: false }])) === 'pass');
  claim('a fast error is not speed (latency counts only answers)', L.stats([...S(4000, 19), { ms: 5, ok: false }]).p95 === 4000);

  // an empty step, a first-step failure, a stop after a pass
  claim('a step with no answered search stops the ramp', L.nextConcurrency([fast(1), step(L, 2, S(100, 3, false))]) === null
    && L.verdict(step(L, 2, [])) === 'no-samples');
  claim('one user already too slow → safe 0', L.safeConcurrency([step(L, 1, S(LIMIT * 2, 10))]) === 0);
  claim('a pass after a failure never raises the safe number', L.safeConcurrency([fast(1), step(L, 2, S(LIMIT * 2, 10)), fast(3)]) === 1);
  claim('foreign load after passing steps is not a measurement', L.ended([fast(1), fast(2)], true) === 'foreign_load');

  // quiet before every step (AGENTS.md rule 1)
  claim('8 active / 0 slow is quiet', L.databaseBusy({ active: 8, slow: 0 }) === null);
  claim('9 active foreign queries is busy', L.databaseBusy({ active: 9, slow: 0 }) !== null);
  claim('one foreign query over 5 s is busy', L.databaseBusy({ active: 1, slow: 1 }) !== null);

  // the numbers themselves
  const xs = Array.from({ length: 100 }, (_, i) => i + 1);
  claim('nearest-rank percentile', L.percentile(xs, 50) === 50 && L.percentile(xs, 95) === 95 && L.percentile([], 95) === null);
  claim('the slowest call is the highest p95 at the heaviest step', L.slowestCall(slow3) === 'results_rpc');
  const at = (iso: string) => L.msUntilWindow(new Date(iso));
  claim('the ramp waits for :10 UTC (now, later this hour, or next hour)', at('2026-11-11T23:10:20Z') === 0
    && at('2026-11-11T22:50:00Z') === 20 * 60_000 && at('2026-11-11T23:11:00Z') === 59 * 60_000);
  return out;
}

// 1. the real library holds every claim
const realBroken = broken(real);
check('the real ramp holds every rule', realBroken.length === 0, realBroken.join('; '));

// 2. MUTATION PROOF on a copy of the real source: each planted defect must break at least one claim
const src = readFileSync(LIB, 'utf8');
const MUTANTS: [string, string, string][] = [
  ['first-card stop removed', "if (TAP_TO_FIRST_REQUEST_MS + f.p95 > limitMs) return 'late';", ''],
  ['tap→first-request time dropped', "if (TAP_TO_FIRST_REQUEST_MS + f.p95 > limitMs)", 'if (f.p95 > limitMs)'],
  ['data limit raised past 12 s', 'export const DATA_READY_LIMIT_MS = 11_500;', 'export const DATA_READY_LIMIT_MS = 20_000;'],
  ['error stop removed', "if (f.error_rate > MAX_ERROR_RATE) return 'errors';", ''],
  ['cap lifted (a step of 12, the guard gone)', "return next !== undefined && next <= CAP ? next : null;", "return next !== undefined ? next : null;"],
  ['CAP raised to 12 with a step of 12', 'export const CAP = 8;', 'export const CAP = 12;'],
  ['ramp keeps going after a failed step', "if (done.some((s) => verdict(s, limitMs) !== 'pass')) return null;\n  const next", 'const next'],
  ['safe number counts a pass after a failure', "if (verdict(s, limitMs) !== 'pass') break;", "if (verdict(s, limitMs) !== 'pass') continue;"],
  ['an empty step reads as a pass', "if (f.n === 0 || f.p95 === null) return 'no-samples';", "if (f.p95 === null) return 'pass';"],
  ['errors averaged into latency', 'const ok = samples.filter((s) => s.ok).map((s) => s.ms);', 'const ok = samples.map((s) => s.ms);'],
  ['a slow foreign query ignored', 'if (a.slow > 0) return', 'if (a.slow > 99) return'],
  ['window wait never rolls to the next hour', 'if (t.getTime() + 30_000 < now.getTime()) t.setUTCHours', 'if (false) t.setUTCHours'],
  ['foreign active limit loosened', 'if (a.active > FOREIGN_ACTIVE_MAX) return', 'if (a.active > FOREIGN_ACTIVE_MAX * 4) return'],
];
const dir = mkdtempSync(join(tmpdir(), 'ezhalah-capacity-'));
for (const [i, [label, from, to]] of MUTANTS.entries()) {
  const hits = src.split(from).length - 1;
  if (hits !== 1) { check(`mutant «${label}» anchors once in capacityRamp.ts`, false, `found ${hits} times — update the mutant`); continue; }
  let mutated = src.replace(from, to);
  if (label.includes('12')) mutated = mutated.replace('export const STEPS = [1, 2, 3, 4, 6, 8] as const;', 'export const STEPS = [1, 2, 3, 4, 6, 8, 12] as const;');
  const file = join(dir, `m${i}.mts`);
  writeFileSync(file, mutated);
  const caught = broken(await import(pathToFileURL(file).href) as Lib);
  mustCatch(label, caught.length > 0);
}

// 3. the live half still runs somewhere that fires on its own
const homing = liveHalfProblems('verify-capacity-check-live.ts', loadRegistry(ROOT),
  (name) => existsSync(join(ROOT, 'scripts', name)),
  (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null));
check('the live half is homed in a workflow that invokes it', homing.length === 0, homing.join('; '));

// 4. the workflow keeps a quiet slot and never overlaps itself
const wf = readFileSync(join(ROOT, '.github/workflows/capacity-check.yml'), 'utf8');
const cron = /cron:\s*"(\d+) (\d+) \* \* (\d)"/.exec(wf);
const BUSY_MINUTES = [0, 15, 20, 22, 29, 30, 40, 59];
const ENGINEER_HOURS = [5, 7, 9, 11, 13, 21];
check('weekly, off the busy cron minutes and the night engineers\' hours', !!cron
  && !BUSY_MINUTES.includes(Number(cron[1])) && !ENGINEER_HOURS.includes(Number(cron[2])), cron?.[0] ?? 'no weekly cron');
check('two runs never overlap (concurrency group, no cancel)', /concurrency:\s*\n\s*group: capacity-check\s*\n\s*cancel-in-progress: false/.test(wf));
check('the live half reads the shared ramp, not its own numbers',
  /from '\.\/lib\/capacityRamp\.ts'/.test(readFileSync(join(ROOT, 'scripts/verify-capacity-check-live.ts'), 'utf8')));

if (failed) { console.error(`\n✗ ${failed} capacity-check claim(s) failed`); process.exit(1); }
console.log(`\n✓ the capacity ramp stops on slow or failing searches, never passes 8, and ${MUTANTS.length} planted defects were all caught`);
