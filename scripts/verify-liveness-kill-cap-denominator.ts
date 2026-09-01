// A DESTRUCTIVE CAP MUST NEVER BE RESOLVED FROM A DENOMINATOR WE COULD NOT READ.
//
// THE FAILURE CLASS (found 2026-08-16, DIE run #24). gathern's liveness anomaly guard sizes itself
// as max(150, 2% of currently-active). It read the denominator with:
//
//     client.table(TABLE).select("id", count="exact", head=True)...execute().count or 0
//
// On the pinned client (supabase==2.10.0 / postgrest 0.18.0) a HEAD request returns `.count = 0`,
// not the real total. Measured against production that day:
//     head=True  -> .count = 0        -> resolve_kill_cap(0)     = 150   <-- what production used
//     head=False -> .count = 29335    -> resolve_kill_cap(29335) = 586   <-- what was designed
// so the cap silently collapsed to its floor on EVERY run since the code shipped, and every run
// logged a bare "kill_cap=150" that looked computed. A threshold that degrades quietly is worse
// than one that is simply wrong: nothing about the log invites suspicion.
//
// The production consequence was not theoretical. The 2026-08-16 06:41 sweep aborted with
// "ANOMALY-CAPPED would_inactivate=173 cap=150" — refusing, as an anomaly, a batch the designed cap
// would have accepted. 172 of those 173 were confirmed 404 at the source by direct probe; they had
// been served to real users for days behind an alert nobody could act on.
//
// WHAT THIS GUARD PINS, and why each half matters:
//   1. the cap denominator is NOT read with head=True          — the bug itself
//   2. it does NOT silently coerce a missing count with `or 0`  — how the bug stayed invisible
//   3. it fails closed when the denominator is unreadable       — the safe behaviour
//   4. resolve_kill_cap's arithmetic still yields 586 at 29,335 — the intent it protects
//
// Deliberately OFFLINE (tracked repo files only), like the other verifiers in `npm test`. The LIVE
// half is mon_detect_liveness_cap_degraded(), which compares the cap a run actually logged against
// the cap its own active count implies.
//
// Run: node --experimental-strip-types scripts/verify-liveness-kill-cap-denominator.ts
import { readFileSync } from 'node:fs';
import { join as __join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

// "Is this guard actually wired in?" — asked of the test registry, which is what `npm test`
// resolves its run set from (scripts/lib/testRegistry.ts). String-matching package.json used to
// answer it; since the 201-command chain became one runner invocation, that match would read
// "not wired" for every barrier in the suite.
const REPO_ROOT = __join(import.meta.dirname, '..');

const SRC = 'scrapers/gathern/liveness.py';
const src = readFileSync(SRC, 'utf8');

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

// Isolate the cap-resolution block: from the `kill_cap = args.kill_cap` assignment to the
// resolve_kill_cap() call that consumes it.
const start = src.indexOf('kill_cap = args.kill_cap');
const end = src.indexOf('kill_cap = resolve_kill_cap(', start);
check(start > 0 && end > start,
  'found the kill-cap resolution block',
  `${SRC}: could not locate the kill-cap resolution block — this guard is no longer reading the ` +
  `code it was written to protect, so its passes mean nothing`);
const block = start > 0 && end > start ? src.slice(start, end) : '';

// 1. The bug itself. head=True makes .count return 0 on the pinned client.
check(!/head\s*=\s*True/i.test(block),
  'the cap denominator is not read with head=True',
  `${SRC}: the kill-cap denominator uses head=True again. On supabase==2.10.0 that returns ` +
  `.count = 0, so the cap collapses to its 150 floor and every run logs a cap that looks computed ` +
  `but is not. Use .select("id", count="exact").limit(1) instead.`);

// 2. How it stayed invisible: `or 0` turns an unreadable count into the most permissive-looking
//    input rather than an error.
check(!/\.count\s+or\s+0/.test(block),
  'a missing count is not silently coerced to 0',
  `${SRC}: the denominator still falls back to \`.count or 0\`, which converts "we could not read ` +
  `the count" into "the platform has no active rows" and resolves the cap to its floor in silence.`);

// 3. The safe behaviour: refuse to sweep rather than guess a destructive threshold.
check(/REFUSING TO SWEEP/.test(block) && /SystemExit/.test(block),
  'an unreadable denominator fails closed instead of falling back to the floor',
  `${SRC}: nothing fails closed when the active count is unreadable. A destructive cap must never ` +
  `be resolved from a denominator the run could not read.`);

// 4. The provenance line — an override and a computed cap must not read the same in the run log.
check(/cap_src/.test(src) && /override|auto=max/.test(src),
  'run notes record whether the cap was computed or overridden',
  `${SRC}: the run notes no longer distinguish a computed cap from an explicit --kill-cap ` +
  `override. That ambiguity is what hid the head=True bug for days.`);

// 5. The intent the cap encodes, pinned numerically so a future "simplification" of the formula
//    has to confront the real numbers.
const capFn = src.slice(src.indexOf('def resolve_kill_cap'), src.indexOf('def is_anomaly'));
const m = capFn.match(/return\s+max\((\d+),\s*active_now\s*\*\s*(\d+)\s*\/\/\s*(\d+)\)/);
check(m !== null, 'resolve_kill_cap still has the documented max(floor, pct) shape',
  `${SRC}: resolve_kill_cap no longer matches max(<floor>, active_now * <n> // <d>) — if the ` +
  `formula genuinely changed, update this guard deliberately.`);
if (m) {
  const [, floor, num, den] = m.map(Number) as unknown as [string, number, number, number];
  const cap = (n: number) => Math.max(floor, Math.floor((n * num) / den));
  check(cap(29335) === 586,
    `resolve_kill_cap(29335) = 586 (2% of gathern's active inventory), not the ${floor} floor`,
    `${SRC}: resolve_kill_cap(29335) is now ${cap(29335)}, expected 586. The 2026-08-16 incident ` +
    `was precisely this value silently reading as ${floor}.`);
  check(cap(0) === floor,
    `resolve_kill_cap(0) still returns the ${floor} floor (which is why a 0 denominator must be an error)`,
    `${SRC}: resolve_kill_cap(0) = ${cap(0)}, expected the ${floor} floor.`);
}

// 6. Worthless if nothing runs it.
check(npmTestRuns(REPO_ROOT, 'verify-liveness-kill-cap-denominator'),
  'npm test runs this guard',
  '`npm test` no longer runs verify-liveness-kill-cap-denominator.ts (see scripts/test-exclusions.txt) — the guard is inert');

console.log('liveness-kill-cap-denominator: a destructive cap must know its own denominator\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — the kill cap can silently degrade again.`);
  process.exit(1);
}
console.log('\n✅ liveness-kill-cap-denominator: passed.');
