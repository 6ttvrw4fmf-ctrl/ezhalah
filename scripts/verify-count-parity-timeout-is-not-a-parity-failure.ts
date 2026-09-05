// A COUNT RPC THAT TIMED OUT UNDER LOAD IS NOT A COUNT THAT DISAGREES.
//
// WHY THIS EXISTS (ops_incident #48, 2026-09-05). scripts/verify-count-rpc-parity-live.ts is
// scheduled `47 */6 * * *`, so one of its four daily runs always lands at 04:47–04:58 — inside the
// 01:00–06:00 UTC heavy scraper window AGENTS.md already names. At 04:57 apartment_guided_counts_ar
// answered 500 / 57014 «canceling statement due to statement timeout», the check's rpc() threw, and
// the workflow went red raising a P1 that READ LIKE a count-parity defect. It was not one: the same
// five scopes measured clean at 08:42 outside the window. The unfiltered AF count costs 2.5–3.3s at
// idle, close enough to the limit that the nightly batch tips it over.
//
// The repair was to pace against production's own signal (public.ops_search_load_now, harness note
// 19) and classify a non-arrival against it. That introduces exactly one dangerous failure mode, and
// this file exists to make it impossible: **a classifier that is too eager turns a REAL count-parity
// regression into "not exercised" and the run walks away.** So both directions are proven here, and
// the NOT-EXERCISED verdict is proven to still FAIL the run.
//
// This is deliberately an OFFLINE, hermetic check (it runs inside `npm test`) even though the check
// it guards is a live one: the predicate is pure, and a guard that needed production to run would be
// unavailable in exactly the degraded window it exists for. `isStatementTimeout` is LIFTED out of the
// live script rather than imported, because importing that module would execute the live check.
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { verdictForNonArrival, UNREADABLE_LOAD, type SearchLoad } from './lib/afJourneyPacing.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '❌'} ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
  if (!ok) failed++;
};

const lifted = await liftSymbols(
  join(ROOT, 'scripts/verify-count-rpc-parity-live.ts'),
  [{ header: 'export const isStatementTimeout = ', endsWith: /^\);$/ }],
  ['isStatementTimeout'],
);
const isStatementTimeout = lifted.isStatementTimeout as (status: number, body: string) => boolean;

console.log('\nThe timeout classifier, in BOTH directions\n');

// The real body PostgREST returned on 2026-09-05 at 04:57.
const REAL_57014 = '{"code":"57014","details":null,"hint":null,"message":"canceling statement due to statement timeout"}';
check('the real 04:57 body is recognised as a timeout', isStatementTimeout(500, REAL_57014));
check('a 504 carrying the timeout text is recognised', isStatementTimeout(504, 'canceling statement due to statement timeout'));

// THE DANGEROUS DIRECTION. Anything the classifier swallows becomes NOT EXERCISED instead of a
// reported defect, so every one of these must come back false.
check('a genuine 400 from a bad argument is NOT a timeout',
  !isStatementTimeout(400, '{"code":"22P02","message":"invalid input syntax for type integer"}'),
  'a malformed request would be excused as load');
check('PGRST203 (the 2026-07-16 ambiguous-overload outage) is NOT a timeout',
  !isStatementTimeout(300, '{"code":"PGRST203","message":"Could not choose the best candidate function"}'),
  'the outage shape this repo has already lived through would be excused as load');
check('a 500 with an unrelated message is NOT a timeout',
  !isStatementTimeout(500, '{"code":"XX000","message":"internal error"}'),
  'any server error at all would be excused as load');
check('a 200-range status is NOT a timeout whatever it says',
  !isStatementTimeout(200, REAL_57014),
  'a successful response mentioning the phrase would be excused');
check('an empty body is NOT a timeout', !isStatementTimeout(500, ''));

console.log('\nThe verdict a non-arrival gets — and that it is never a pass\n');

const HEALTHY: SearchLoad = { recent_mean_ms: 495, search_qps: 0.17, safe_qps: 1.5, samples: 3, degraded: false };
const DEGRADED: SearchLoad = { recent_mean_ms: 5109, search_qps: 3.8, safe_qps: 1.5, samples: 40, degraded: true };

check('a timeout while production was HEALTHY is a real red', verdictForNonArrival(HEALTHY) === 'red',
  'a genuine count-RPC regression would be filed as a load artefact');
check('a timeout while production was DEGRADED is not_exercised', verdictForNonArrival(DEGRADED) === 'not_exercised');
check('UNREADABLE load is NOT treated as healthy', verdictForNonArrival(UNREADABLE_LOAD) === 'not_exercised',
  'a blind probe must not hand out a free red');

// The three structural rules, as PURE predicates over the live script's source — so the mutation
// proofs below can feed each one the exact regression it exists to catch.
export const countsSkipsAgainstExit = (s: string): boolean =>
  /const clean = failed === 0 && notExercised === 0;/.test(s) && /process\.exit\(clean \? 0 : 1\)/.test(s);
export const pacesBeforeMeasuring = (s: string): boolean => /paceUntilHealthy\(/.test(s);
export const fireSequentially = (s: string): boolean => !/Promise\.all\(\[\s*\n\s*searchTotal/.test(s);

const src = await (await import('node:fs/promises')).readFile(join(ROOT, 'scripts/verify-count-rpc-parity-live.ts'), 'utf8');
check('the live check exits non-zero when a scope was NOT EXERCISED', countsSkipsAgainstExit(src),
  'verify-count-rpc-parity-live.ts no longer counts NOT EXERCISED against its exit code — a degraded ' +
  'window would report as a clean pass, which is exactly the route to green this repair forbids');
check('the live check paces against production before measuring', pacesBeforeMeasuring(src),
  'the pacing call is gone, so the check is back to measuring production inside the scraper window');
check('the count RPCs are not fired as one concurrent batch again', fireSequentially(src),
  'three concurrent unfiltered counts is the contention this check was dying of');

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
// Each predicate is handed the real regression, and must reject it. These are the same mutations
// that were applied to the live file by hand while building this barrier; encoding them is what
// stops the barrier quietly going blind when someone refactors either file.
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

console.log('\nMutation proofs\n');

// M1 — the classifier goes over-eager and swallows every server error. Every non-timeout vector
// above must then be misread as a timeout, i.e. excused as load. The contract is that a classifier
// keying on status ALONE cannot satisfy this file's own test vectors.
const overEager = (status: number, _body: string): boolean => status >= 500;
mustCatch('a classifier that swallows every 500 (PGRST203 would be excused as load)',
  overEager(500, '{"code":"PGRST203"}') && !isStatementTimeout(500, '{"code":"PGRST203"}'));
mustCatch('…and one that never fires at all (a real timeout reported as a parity defect)',
  !((() => false) as (s: number, b: string) => boolean)(500, REAL_57014) && isStatementTimeout(500, REAL_57014));

// M2 — NOT EXERCISED stops counting against the exit code: a degraded window reads as a clean pass.
mustCatch('the exit rule dropping notExercised (the route to green this repair forbids)',
  !countsSkipsAgainstExit(src.replace('const clean = failed === 0 && notExercised === 0;', 'const clean = failed === 0;')));
mustCatch('…while the real source still satisfies it (the predicate is not vacuously red)',
  countsSkipsAgainstExit(src));

// M3 — the pacing call is removed, so the check measures production inside the scraper window again.
mustCatch('the pacing call being deleted', !pacesBeforeMeasuring(src.replace(/paceUntilHealthy\(/g, 'noPace(')));
mustCatch('…while the real source still paces', pacesBeforeMeasuring(src));

// M4 — the three heavy counts go back to one concurrent batch, which is the contention it died of.
mustCatch('the concurrent Promise.all batch coming back',
  !fireSequentially('const [search, apt, age] = await Promise.all([\n      searchTotal(s.args),\n    ]);'));
mustCatch('…while sequential calls are not mistaken for it', fireSequentially(src));

const ok = failed === 0 && mutFail === 0;
console.log(ok
  ? '\n✓ a timed-out count RPC is classified as load, a broken one is still reported, and neither is a pass'
  : `\n✗ ${failed} check(s) failed, ${mutFail} mutation(s) survived`);
process.exit(ok ? 0 : 1);
