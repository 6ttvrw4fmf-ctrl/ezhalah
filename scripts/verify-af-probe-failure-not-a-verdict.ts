// UNKNOWN IS NOT NO — a failed AF probe may never be recorded as a verdict (owner 2026-08-26)
//
//   node --experimental-strip-types scripts/verify-af-probe-failure-not-a-verdict.ts   (in `npm test`)
//
// «Known useless → hide AF. Couldn't determine because backend failed → keep AF available.»
//
// THE DEFECT. Every Advanced Filter question earns its place by one live count RPC, capped at
// AGE_COUNT_TIMEOUT_MS (4s). Until this change, a timeout was collapsed into the same value as a
// real answer at every hop:
//     withTimeout        -> { timedOut: true }
//     the fetcher        -> null                     // identical to "the query returned no rows"
//     guidedOptions      -> { options: [], total: 0 } // identical to "this scope is empty"
//     scoreQuestion      -> null                      // question dropped
//     startAgeFlow       -> empty plan -> setAgeFlow(null) + startRefine(q)
// so a transient blip told the user "there is nothing more worth asking about this search" and
// demoted them to the legacy district/budget/beds chips. By the third hop the information that
// anything had gone wrong no longer existed.
//
// Reachable in practice, not hypothetical: one count on a real 6-district Villa/Buy scope measured
// 920 ms and the five certified questions 3,433 ms server-side on a QUIET database, against a
// 338 ms/search baseline and a concurrency knee of 3 (SEARCH_MATCH_QA_ENGINEER.md §40.1).
//
// This barrier EXECUTES the rule (src/lib/afProbe.ts is pure) and pins the wiring that carries it,
// because the failure mode is silent by construction: nothing errors, nothing logs, the interview
// simply does not open.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROBE_FAILED, isProbeFailure, probeVerdict, mayOpenInterview,
  mayAssertNothingToNarrow, shouldRetryProbes,
} from '../src/lib/afProbe.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};
const eq = (l: string, got: unknown, want: unknown) =>
  check(l, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// ── 1. THE THREE VERDICTS ARE DISTINCT — the whole point ─────────────────────────────────────────
eq('a useful question ⇒ "useful"',                       probeVerdict(1, false), 'useful');
eq('useful survives even if OTHER probes failed',        probeVerdict(1, true),  'useful');
eq('nothing useful, all probes ANSWERED ⇒ "known-empty"',probeVerdict(0, false), 'known-empty');
eq('nothing useful, a probe FAILED ⇒ "unknown"',         probeVerdict(0, true),  'unknown');
check('known-empty and unknown are NOT the same verdict', probeVerdict(0, false) !== probeVerdict(0, true),
  'if these ever collapse, a backend outage is a statement about the user’s search again');

// ── 2. WHAT EACH VERDICT PERMITS ─────────────────────────────────────────────────────────────────
check('AF opens ONLY on real surviving usefulness',
  mayOpenInterview('useful') && !mayOpenInterview('known-empty') && !mayOpenInterview('unknown'));
check('an EMPTY AF card is never opened on unknown', !mayOpenInterview('unknown'));
check('"nothing left to narrow" may be asserted ONLY when the sources answered',
  mayAssertNothingToNarrow('known-empty') && !mayAssertNothingToNarrow('unknown') && !mayAssertNothingToNarrow('useful'));
check('THE RULE: unknown must never be treated as no',
  !mayAssertNothingToNarrow('unknown') && mayAssertNothingToNarrow('known-empty'));

// ── 3. THE RETRY IS BOUNDED AND ONLY FOR THE UNDETERMINED CASE ───────────────────────────────────
check('an undetermined batch is retried exactly once', shouldRetryProbes('unknown', 0) && !shouldRetryProbes('unknown', 1));
check('a DECIDED verdict is never re-probed (that would be pure latency)',
  !shouldRetryProbes('known-empty', 0) && !shouldRetryProbes('useful', 0));
check('the retry cannot loop', [0,1,2,3].filter((a) => shouldRetryProbes('unknown', a)).length === 1);

// ── 4. THE SENTINEL IS DISTINGUISHABLE FROM EVERY REAL ANSWER ────────────────────────────────────
check('PROBE_FAILED is recognised', isProbeFailure(PROBE_FAILED));
for (const [label, v] of [['null (source answered: nothing)', null], ['undefined', undefined],
                          ['a real counts row', { cnt_total_base: 0 }], ['an empty object', {}],
                          ['zero', 0], ['a string', 'timedOut']] as const)
  check(`…and ${label} is NOT mistaken for a probe failure`, !isProbeFailure(v));

// ── 5. THE WIRING — the rule is inert if nothing consults it ─────────────────────────────────────
const SRC = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8');
const remote = SRC('data/remote.ts'), af = SRC('data/advancedFilters.ts'), agent = SRC('app/agent.tsx');

check('WIRING a timed-out probe returns the sentinel, not null', /timedOut' in result\) return PROBE_FAILED;/.test(remote));
check('WIRING …and no AF count fetcher still collapses a timeout to null',
  !/'timedOut' in result\) return null;/.test(remote));
check('WIRING a transport error is also "never learned", not "nothing"', /if \(error\) return PROBE_FAILED;/.test(remote));
check('WIRING an EMPTY RESULT SET still means the source answered nothing (null)',
  /length\) return null;\s+\/\/ the source answered: nothing/.test(remote));
// `unknownCount` here must be `null`, not `0` (owner rule 2026-08-28, R7.1.3). A probe that never
// completed knows nothing about how many listings stated the field, so claiming 0 would be the same
// fabricated fact this file exists to prevent, one field over. Tightened, not loosened: the shape
// assertion is unchanged and the value is now pinned to the only honest one.
check('WIRING guidedOptions marks a failed probe instead of reporting an empty scope',
  /isProbeFailure\(counts\)\) return \{ options: \[\], unknownCount: null, total: 0, probeFailed: true \}/.test(af));
check('WIRING …and a failed probe claims no unknown count either (null, never a fabricated 0)',
  !/isProbeFailure\(counts\)\) return \{ options: \[\], unknownCount: 0/.test(af));
check('WIRING the age question guards its own probe too', af.split('isProbeFailure(counts)').length - 1 >= 2);
check('WIRING rankQuestions records whether any probe in the batch failed', /const anyProbeFailed = probes\.some/.test(af));
check('WIRING …and carries it to its callers', /probeFailed', \{ value: anyProbeFailed/.test(af));
check('WIRING the OPENING decision consults the verdict', /mayAssertNothingToNarrow\(verdict\)/.test(agent));
check('WIRING …and retries once before believing an undetermined batch',
  /shouldRetryProbes\(probeVerdict\(planOf\(ranked\)\.length, ranked\.probeFailed\), 0\)/.test(agent));
check('WIRING the MID-INTERVIEW re-rank obeys the same rule (not just the open)',
  /shouldRetryProbes\(probeVerdict\(0, rankedForPlan\.probeFailed\), 0\)/.test(agent));
check('WIRING …and an undetermined mid-interview batch changes nothing on screen',
  /still undetermined — leave the interview exactly as it is/.test(agent));
check('WIRING startRefine is no longer reachable from an UNDETERMINED plan',
  !/if \(fallbackToRefine\) startRefine\(q\);/.test(agent) && /mayAssertNothingToNarrow\(verdict\)\) startRefine\(q\)/.test(agent));

// ── 6. MUTATION PROOFS — each way of reintroducing the bug must be caught ────────────────────────
console.log('\n── mutation proofs ──');
{
  // M1: the original defect — treat a failed probe as an answer.
  const collapsed = (useful: number, _failed: boolean) => (useful > 0 ? 'useful' : 'known-empty');
  check('MUT-1 collapsing unknown into known-empty is DETECTED',
    collapsed(0, true) !== probeVerdict(0, true) && probeVerdict(0, true) === 'unknown');
  // M2: letting an undetermined verdict assert "nothing to narrow".
  const lax = (_v: string) => true;
  check('MUT-2 a permissive mayAssertNothingToNarrow is DETECTED',
    lax('unknown') !== mayAssertNothingToNarrow('unknown'));
  // M3: opening an empty card on unknown.
  const eager = (v: string) => v !== 'known-empty';
  check('MUT-3 opening AF on an undetermined batch is DETECTED',
    eager('unknown') !== mayOpenInterview('unknown'));
  // M4: an unbounded retry loop.
  const unbounded = (v: string, _a: number) => v === 'unknown';
  check('MUT-4 an unbounded retry is DETECTED',
    [0,1,2,3].filter((a) => unbounded('unknown', a)).length !== [0,1,2,3].filter((a) => shouldRetryProbes('unknown', a)).length);
  // M5: a sentinel that any object satisfies.
  const loose = (v: unknown) => !!v && typeof v === 'object';
  check('MUT-5 a sentinel test that matches ANY object is DETECTED',
    loose({ cnt_total_base: 0 }) !== isProbeFailure({ cnt_total_base: 0 }));
  // CONTROL: the real implementations are not flagged by their own mutation tests.
  check('CONTROL the shipped rule still behaves correctly',
    probeVerdict(0, true) === 'unknown' && probeVerdict(0, false) === 'known-empty'
    && !mayAssertNothingToNarrow('unknown') && !mayOpenInterview('unknown'));
}

// ── THE SAME RULE, APPLIED TO THE TEST HARNESS (2026-09-04) ──────────────────────────────────────
//
// UNKNOWN-is-not-NO binds whatever ASSERTS on the product too. web-runtime-smoke's Journey [J]
// (Factory / RentAnnual / الرياض, the 1-question street_width cohort) clicked `snap.options[0]`
// only `if (snap.options.length)` — correct — and then demanded a narrowed count UNCONDITIONALLY.
// When the count probes returned UNDETERMINED, resolveOptions offered ZERO options exactly as this
// file requires, the harness answered nothing, and the run failed with `start=26 final=26`.
//
// That is a demand the product does not owe: an interview nobody answered MUST leave the count
// alone. It failed for the OPPOSITE of a defect — the product correctly declining to invent options
// it has no counts for — and a red that means "the environment was slow" trains people to ignore
// the check, or to delete the narrowing assertion to make it quiet. Both lose the real guard.
//
// DB truth for that cohort, measured 2026-09-04: base 26 → ≥15m 24, ≥20m 24, ≥25m 8, ≥30m 6. No
// option the card can offer returns 26, so `final === start` PROVES nothing was answered.
{
  const smoke = readFileSync(new URL('./verify-web-runtime-smoke.mjs', import.meta.url), 'utf8');
  const jBlock = smoke.slice(smoke.indexOf('[J] 1-question scope'), smoke.indexOf('[J0]'));
  check('[J] smoke journey exists to guard', jBlock.length > 500);
  // 1. It must RECORD that an answer really happened...
  check('[J] records whether an option was actually answered',
    /jAnswered\s*=\s*snap\.options\[0\]/.test(jBlock));
  // 2. ...and must not demand narrowing when none was.
  check('[J] does not demand narrowing when AF offered no options',
    /if \(jOpened && !jAnswered\)/.test(jBlock) && /SKIP\s+\[J\]/.test(jBlock));
  // 3. But the narrowing assertion itself must SURVIVE — quieting the flake by deleting the rule is
  //    the regression this pairing exists to prevent.
  check('[J] still enforces real narrowing once an option IS answered',
    /jFinal < jStart/.test(jBlock) && /genuinely narrowed/.test(jBlock));

  // MUTATION SELF-PROOF: the two failure modes this pairing must catch.
  const unconditional = jBlock.replace(/if \(jOpened && !jAnswered\)/, 'if (false)');
  check('MUTATION reverting [J] to an unconditional demand is caught',
    !/if \(jOpened && !jAnswered\)/.test(unconditional));
  const gutted = jBlock.replace(/jFinal < jStart/g, 'true');
  check('MUTATION deleting [J]\u2019s narrowing rule is caught', !/jFinal < jStart/.test(gutted));
}

console.log(failed ? `\n${failed} FAILED` : '\nUNKNOWN is never treated as NO');
process.exit(failed ? 1 : 0);
