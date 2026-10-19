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
// MUTATION-PROVEN (2026-09-14, routine #10 / R1). Until today this guard was on
// `scripts/mutation-proof-grandfathered.txt` — nobody had ever watched it go red, over a cap whose
// failure mode is "a destructive sweep silently uses the wrong threshold". The predicate below is a
// PURE function of the two source texts precisely so the proofs at the bottom can hand it the
// 2026-08-16 source and watch it fail, and hand it the shipped source and watch it pass. It still
// reads Python as TEXT — `scrapers/gathern/liveness.py` imports `scrapers.common.db` at module
// scope, so `scripts/lib/pythonMutant.ts` cannot lift `resolve_kill_cap` without the scraper
// requirements and a live env; that limit is stated here rather than papered over, and the
// arithmetic half below re-implements ONLY the three numbers it parses out of the real formula, so
// a changed formula is a parse failure, never a silently stale copy.
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

/**
 * The whole verdict, as a pure function of the liveness source. Takes the text as an argument so a
 * proof can hand it a BROKEN one — that is the entire reason this is not inlined (BARRIER_ENGINEER
 * PART 3, R1 step 2; the same shape as `coverageProblems(entries, read)`).
 *
 * Returns one string per violation; an empty array means healthy.
 */
export function capProblems(src: string): string[] {
  const problems: string[] = [];

  // Isolate the cap-resolution block: from the `kill_cap = args.kill_cap` assignment to the
  // resolve_kill_cap() call that consumes it.
  const start = src.indexOf('kill_cap = args.kill_cap');
  const end = src.indexOf('kill_cap = resolve_kill_cap(', start);
  const located = start > 0 && end > start;
  if (!located) {
    problems.push(
      `${SRC}: could not locate the kill-cap resolution block — this guard is no longer reading the ` +
      `code it was written to protect, so its passes mean nothing`);
  }
  // FAIL CLOSED: when the block cannot be located every text check below would pass vacuously over
  // an empty string, so the unreadable case returns the ONE honest problem and stops. An
  // unlocatable block reads as MISSING, never as healthy.
  if (!located) return problems;
  const block = src.slice(start, end);

  // 1. The bug itself. head=True makes .count return 0 on the pinned client.
  if (/head\s*=\s*True/i.test(block)) {
    problems.push(
      `${SRC}: the kill-cap denominator uses head=True again. On supabase==2.10.0 that returns ` +
      `.count = 0, so the cap collapses to its 150 floor and every run logs a cap that looks computed ` +
      `but is not. Use .select("id", count="exact").limit(1) instead.`);
  }

  // 2. How it stayed invisible: `or 0` turns an unreadable count into the most permissive-looking
  //    input rather than an error.
  if (/\.count\s+or\s+0/.test(block)) {
    problems.push(
      `${SRC}: the denominator still falls back to \`.count or 0\`, which converts "we could not read ` +
      `the count" into "the platform has no active rows" and resolves the cap to its floor in silence.`);
  }

  // 3. The safe behaviour: refuse to sweep rather than guess a destructive threshold.
  if (!(/REFUSING TO SWEEP/.test(block) && /SystemExit/.test(block))) {
    problems.push(
      `${SRC}: nothing fails closed when the active count is unreadable. A destructive cap must never ` +
      `be resolved from a denominator the run could not read.`);
  }

  // 4. The provenance line — an override and a computed cap must not read the same in the run log.
  if (!(/cap_src/.test(src) && /override|auto=max/.test(src))) {
    problems.push(
      `${SRC}: the run notes no longer distinguish a computed cap from an explicit --kill-cap ` +
      `override. That ambiguity is what hid the head=True bug for days.`);
  }

  // 5. The intent the cap encodes, pinned numerically so a future "simplification" of the formula
  //    has to confront the real numbers. The three constants are PARSED out of the shipped formula
  //    rather than copied, so this can never become a stale duplicate of production arithmetic: a
  //    formula this cannot parse is a failure, not a silent pass.
  const capFn = src.slice(src.indexOf('def resolve_kill_cap'), src.indexOf('def is_anomaly'));
  const m = capFn.match(/return\s+max\((\d+),\s*active_now\s*\*\s*(\d+)\s*\/\/\s*(\d+)\)/);
  if (!m) {
    problems.push(
      `${SRC}: resolve_kill_cap no longer matches max(<floor>, active_now * <n> // <d>) — if the ` +
      `formula genuinely changed, update this guard deliberately.`);
  } else {
    const [, floor, num, den] = m.map(Number) as unknown as [string, number, number, number];
    const cap = (n: number) => Math.max(floor, Math.floor((n * num) / den));
    if (cap(29335) !== 586) {
      problems.push(
        `${SRC}: resolve_kill_cap(29335) is now ${cap(29335)}, expected 586. The 2026-08-16 incident ` +
        `was precisely this value silently reading as ${floor}.`);
    }
    if (cap(0) !== floor) {
      problems.push(`${SRC}: resolve_kill_cap(0) = ${cap(0)}, expected the ${floor} floor.`);
    }
  }

  return problems;
}

const src = readFileSync(SRC, 'utf8');
const problems = capProblems(src);

console.log('liveness-kill-cap-denominator: a destructive cap must know its own denominator\n');
if (!problems.length) console.log('  ✓ the shipped sweep resolves its cap from a denominator it actually read');
for (const p of problems) console.error(`  ✗ ${p}`);

// 6. Worthless if nothing runs it.
if (!npmTestRuns(REPO_ROOT, 'verify-liveness-kill-cap-denominator')) {
  problems.push('`npm test` no longer runs verify-liveness-kill-cap-denominator.ts (see scripts/test-exclusions.txt) — the guard is inert');
  console.error(`  ✗ ${problems[problems.length - 1]}`);
} else {
  console.log('  ✓ npm test runs this guard');
}

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION PROOFS — the defect is re-introduced into a COPY of the real source and the predicate
// above is watched to go red. Each mutant is the 2026-08-16 code, or a plausible regression of it.
// The final proof is the negative control: the source as it actually ships is NOT flagged.
// ─────────────────────────────────────────────────────────────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

// The shipped denominator read, recovered from the source so the mutants below edit REAL code.
const blockStart = src.indexOf('kill_cap = args.kill_cap');
const blockEnd = src.indexOf('kill_cap = resolve_kill_cap(', blockStart);
const shippedBlock = src.slice(blockStart, blockEnd);
const countCall = shippedBlock.match(/\.select\([^\n]*count\s*=\s*"exact"[^\n]*\)/)?.[0] ?? '';

mustCatch('the 2026-08-16 defect itself: the denominator read back with head=True',
  capProblems(src.replace(countCall, countCall.replace(/\)$/, ', head=True)'))).length > 0);

mustCatch('…and how it hid: the denominator read coerced with `or 0`, which turns "we could not read the count" into "the platform is empty"',
  capProblems(src.replace('.limit(1).execute().count)', '.limit(1).execute().count or 0)')).length > 0);

mustCatch('the fail-closed refusal being deleted, so an unreadable denominator falls back to the floor',
  capProblems(src.replace(/REFUSING TO SWEEP/g, 'continuing anyway')).length > 0);

mustCatch('…and the same refusal defanged by dropping the SystemExit while keeping the message',
  capProblems(src.replace(/SystemExit/g, 'UserWarning')).length > 0);

mustCatch('the run log losing the computed-vs-override provenance that hid the bug for days',
  capProblems(src.replace(/cap_src/g, 'unused_src')).length > 0);

mustCatch('the cap FLOOR being raised so 2% of a real inventory can never win (the cap frozen at a constant)',
  capProblems(src.replace(/return\s+max\(150,/, 'return max(150000,')).length > 0);

mustCatch('the cap PERCENTAGE being quietly cut (586 → 293 on gathern\'s real inventory)',
  capProblems(src.replace(/active_now \* 2 \/\/ 100/, 'active_now * 1 // 100')).length > 0);

mustCatch('the formula being rewritten into a shape this guard cannot parse (never a silent pass)',
  capProblems(src.replace(/return\s+max\(150,[^\n]*\n/, 'return _cap_policy(active_now)\n')).length > 0);

mustCatch('the whole resolution block disappearing — an unreadable guard reads as MISSING, not healthy',
  capProblems(src.replace('kill_cap = args.kill_cap', 'kill_cap = 0  # gone')).length > 0);

// THE NEGATIVE CONTROL. A predicate that is red for everything is as useless as one that is green
// for everything; this is the line that catches an over-broad repair.
mustCatch('…while the source as it actually ships is NOT flagged (the predicate is not vacuously red)',
  capProblems(src).length === 0);

if (problems.length || mutFail) {
  if (problems.length) console.error(`\n❌ ${problems.length} check(s) failed — the kill cap can silently degrade again.`);
  if (mutFail) console.error(`❌ ${mutFail} mutation(s) went UNCAUGHT — this guard cannot see the defect it claims to prevent.`);
  process.exit(1);
}
console.log('\n✅ liveness-kill-cap-denominator: passed, and proven to fail on the defect it exists for.');
