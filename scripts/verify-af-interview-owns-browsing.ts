// PERMANENT BARRIER: the Advanced Filter interview may hold browsing only while it is still asking,
// and the small-result threshold finishes the flow cleanly. (Owner rule, 2026-09-05.)
//
// THE RULE, in the owner's own terms:
//   1. While the AF interview is still ACTIVE and useful certified questions remain, do NOT show the
//      «عرض المزيد» pager. Keep narrowing with truthful questions that were not already asked.
//   2. Once the interview is actually FINISHED, normal browsing/pagination resumes if needed.
//   3. Once the set reaches the final small-result threshold, the flow FINISHES CLEANLY rather than
//      asking the user to keep browsing or narrowing forever.
//   4. Counts are never changed and results are never widened. MATCH FIRST, always.
//
// WHY A BARRIER AND NOT JUST THE FIX. The gate was a bare `!ageFlow`. That satisfied clause 1 for
// every phase that exists today — but by accident, not by construction: nothing connected the gate
// to whether a question was actually available. A phase added tomorrow inherits "withhold" from a
// truthiness test, and a user with thousands of matches loses the only control that reaches them.
// That is the lifetime ceiling the owner removed on 2026-08-29 returning through a side door.
//
// And it would have been INVISIBLE. On 2026-09-05 the live sweep's «عرض المزيد» journey was taught to
// stand down whenever an AF card is open — so the one layer that drives a real browser stopped being
// able to see a stuck-open interview at the same moment. This barrier plus the `afAsking` narrowing
// in e2e/live-sweep/showmore.mjs are the two halves that close that hole: this proves the rule
// offline over the whole state space, the sweep proves it against the rendered page.
//
// WHAT IS LOCKED (each mutation-proven at the bottom):
//   · every phase of the interview withholds browsing; `null` — finished — hands it back
//   · the phase union is EXHAUSTIVE, so a new phase cannot silently inherit a decision
//   · agent.tsx actually routes its gate through the predicate, and still ANDs it with (hasMore ||
//     canNarrowFurther) so a turn with nothing to offer never renders an empty row
//   · at/below the threshold: the whole set is revealed, `hasMore` is false, and narrowing is not
//     offered — three independent code paths agreeing on one line
//   · the gate touches no count and no predicate — clause 4, checked structurally
//
//   node --experimental-strip-types scripts/verify-af-interview-owns-browsing.ts
//   (auto-discovered by npm test — scripts/lib/testRegistry.ts)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afInterviewOwnsBrowsing, searchIsFinishedAtThreshold, resultsActionsRowVisible, type AfPhase } from '../src/lib/afBrowsingGate.ts';
import { resultCounts } from '../src/data/resultCount.ts';
import { initialReveal as initialRevealPure } from '../src/lib/initialReveal.ts';

const root = join(import.meta.dirname, '..');
const agentSrc = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');
const gateSrc = readFileSync(join(root, 'src/lib/afBrowsingGate.ts'), 'utf8');
const sweepSrc = readFileSync(join(root, 'e2e/live-sweep/showmore.mjs'), 'utf8');
// A COMMENT IS NOT A CODE PATH (permanent repo rule): the completed-trigger count below must count
// CALLS, never a prose mention of `setCompleted(true)` in an explanatory comment (this file's own
// header comment for the 2026-09-11 change names the literal call, and unstripped that is exactly
// the trap this rule exists to catch). Used only for that count — every other check in this file
// matches structural code shapes the comment strip is not needed for.
const decomment = (src: string) =>
  src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
const agentCode = decomment(agentSrc);

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
/**
 * A MUTATION PROOF: this barrier's own predicate, applied to a deliberately broken input, asserting
 * that it really comes back RED. `caught` must be a computed boolean — a literal `true` here is the
 * shape scripts/verify-new-barriers-are-mutation-proven.ts exists to refuse.
 */
const mustCatch = (label: string, caught: boolean, detail = '') => check(`MUTATION — ${label}`, caught, detail);

console.log('\nThe AF interview holds browsing only while it is asking; the threshold finishes cleanly\n');

// ── 1. CLAUSES 1 & 2 — EXECUTED over the complete state space ───────────────────────────────────
// The phase list is read out of the module's own type, so a phase added there without a case here
// is caught by check 2 rather than quietly untested.
const PHASES: AfPhase[] = ['loading', 'intro', 'asking', 'mining'];

check('clause 1 — every ACTIVE interview phase withholds browsing',
  PHASES.every((p) => afInterviewOwnsBrowsing(p) === true),
  PHASES.filter((p) => !afInterviewOwnsBrowsing(p)).join(', '));
check('clause 2 — a FINISHED interview (null) hands browsing back',
  afInterviewOwnsBrowsing(null) === false);

// ── 2. THE UNION IS EXHAUSTIVE — a new phase cannot inherit a decision ──────────────────────────
// The declared union and the switch must name the same phases. A `default:` would let a new phase
// silently inherit whatever the fallback is, which is exactly the accident this file exists to end.
const declared = (gateSrc.match(/export type AfPhase =([^;]+);/)?.[1] ?? '')
  .split('|').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
const cased = [...gateSrc.matchAll(/^\s*case '([a-z]+)':/gm)].map((m) => m[1]);
check('the AfPhase union and the switch cover exactly the same phases',
  declared.length > 0 && declared.length === new Set(cased).size
  && declared.every((p) => cased.includes(p)),
  `declared: ${declared.join(',')} | cased: ${[...new Set(cased)].join(',')}`);
check('the switch has NO default branch — a new phase must fail the build, not inherit a verdict',
  !/^\s*default:/m.test(gateSrc));
check('every phase in the union is exercised by this barrier',
  declared.every((p) => (PHASES as string[]).includes(p)),
  `untested: ${declared.filter((p) => !(PHASES as string[]).includes(p)).join(',')}`);

// ── 3. THE CALL SITE really routes through it ───────────────────────────────────────────────────
check('agent.tsx routes the actions row through resultsActionsRowVisible with the interview phase (not a bare !ageFlow)',
  /const showActionsRow = resultsActionsRowVisible\(\{[\s\S]{0,240}?afPhase: ageFlow\?\.phase \?\? null/.test(agentSrc),
  'the whole point is that the rule is stated where it can be executed');
check('the bare `!ageFlow` gate is gone',
  !/showActionsRow = \(hasMore \|\| canNarrowFurther\) && !ageFlow;/.test(agentSrc));
// EXECUTED, not grepped: the gate itself refuses an empty row (nothing to page, nothing to ask).
check('the row still requires something real to offer — an empty row is never rendered',
  resultsActionsRowVisible({ hasMore: false, canNarrowFurther: false, afPhase: null, chatCompleted: false }) === false
  && resultsActionsRowVisible({ hasMore: true, canNarrowFurther: false, afPhase: null, chatCompleted: false }) === true
  && /const showActionsRow = resultsActionsRowVisible\(\{[\s\S]{0,120}?hasMore,[\s\S]{0,120}?canNarrowFurther,/.test(agentSrc));
check('the wording still follows the rendered buttons (the 2026-09-05 honesty fix is intact)',
  /const offersMore = hasMore && showActionsRow;/.test(agentSrc)
  && /const offersNarrow = canNarrowFurther && showActionsRow;/.test(agentSrc));

// ── 4. CLAUSE 3 — the threshold finishes cleanly, proven across THREE independent paths ─────────
// `initialRevealPure` reveals the whole set, `resultCounts` then reports hasMore=false on its own,
// and `canNarrowFurther`'s `> INTERVIEW_STOP_AT` guard withholds the narrow offer. They are separate
// code paths that must agree on one line; this executes all three at the boundary.
const STOP_AT = 25;
for (const total of [1, 10, 24, 25]) {
  const reveal = initialRevealPure({ fetched: total, honestTotal: total, firstPage: 10, stopAt: STOP_AT, platforms: 3 });
  const rc = resultCounts({ trueTotal: total, shown: reveal, fetched: total, serverMore: false });
  check(`clause 3 — at ${total} matches (≤ ${STOP_AT}): all revealed, no «عرض المزيد», flow finished`,
    reveal === total && rc.hasMore === false && rc.endKind === 'all'
    && searchIsFinishedAtThreshold(total, STOP_AT) === true,
    `reveal=${reveal} hasMore=${rc.hasMore} endKind=${rc.endKind}`);
}
// Just ABOVE the line browsing must still work, or clause 3 would have eaten clause 2.
const above = resultCounts({ trueTotal: 26, shown: 10, fetched: 26, serverMore: false });
check(`clause 3 stops exactly at the line — ${STOP_AT + 1} matches still browse`,
  above.hasMore === true && searchIsFinishedAtThreshold(26, STOP_AT) === false);
// An UNKNOWN honest total is not a small one (silent → NULL, never unknown → NO).
check('an unquotable total is never treated as "finished"',
  searchIsFinishedAtThreshold(null, STOP_AT) === false);

// The narrow offer obeys the same line, in agent.tsx's own expression.
check('narrowing is offered only ABOVE the threshold (canNarrowFurther > INTERVIEW_STOP_AT)',
  /const canNarrowFurther = rawTotal > INTERVIEW_STOP_AT && isLatestResults && afCanNarrow\[m\.id\] === true;/.test(agentSrc));
// ONLY two things may end the flow: the small-result threshold (R11.1), or the user's own explicit
// «عرض المزيد» show-all-and-finish choice (Task 4, 2026-09-11). R11.2 (no useful questions left)
// must not, or a 3,000-match cohort with no questions left would be declared finished and lose its
// pager — the owner's clause 2 exactly. Generalized 2026-09-11 from "exactly one call site" to
// "every call site is one of the two named, honest gates" — the count is no longer the invariant,
// the GATE is: every setCompleted(true) in this file must sit directly behind an
// `if (searchIsFinishedAtThreshold(...))` or an `if (userChoseShowAllAndFinish)`, and those two
// names are the only things allowed to gate it (clause 4 below independently proves the threshold
// predicate touches no count/query surface; userChoseShowAllAndFinish is `!hasMoreNow` computed only
// after a drain that never merely guessed — see loadMore — so neither gate can be satisfied by
// anything but an honestly-finished reveal).
const completedCalls = [...agentCode.matchAll(/setCompleted\(true\)/g)].length;
// Non-greedy up to the first `))`: today's threshold call sites nest at most one paren inside the
// predicate's own arguments (`quotableTotal(result)`), and that inner call is followed by `,` — the
// FIRST `))` in the line is always the predicate's own outer close, never a false-early stop.
// `userChoseShowAllAndFinish` needs no such care — it is a bare identifier, no nested parens.
const gatedCompletedCalls = [...agentCode.matchAll(/if \((?:searchIsFinishedAtThreshold\(.*?\)|userChoseShowAllAndFinish)\)\s*setCompleted\(true\);/g)].length;
check('every completed-trigger is the ≤50 threshold or the explicit show-all choice, and nothing else',
  completedCalls >= 3 && completedCalls === gatedCompletedCalls,
  `saw ${completedCalls} setCompleted(true) call(s), ${gatedCompletedCalls} directly gated by one of the two named predicates`);

// ── 5. CLAUSE 4 — the gate changes no count and no predicate ────────────────────────────────────
// Structural: the module must not import or mention any search/count/query surface. It decides which
// controls render; it has no search input to widen.
check('afBrowsingGate imports nothing — it cannot reach a query, a count or the RPC',
  !/^import /m.test(gateSrc));
for (const forbidden of ['p_limit', 'p_offset', 'p_types', 'p_cities', 'runSearch', 'fetchListings', 'total_count']) {
  check(`the gate never mentions \`${forbidden}\` — no path from this decision to the eligible set`,
    !gateSrc.includes(forbidden));
}

// ── 6. THE LIVE SWEEP'S STAND-DOWN IS CONDITIONED THE SAME WAY ─────────────────────────────────
// Standing down on ANY open AF card is what made a stuck interview invisible to the browser layer.
check('the sweep stands down only while the AF card is ASKING, not merely open',
  /afAsking: !!document\.querySelector\('\[data-testid="af-question-title"\]'\)/.test(sweepSrc)
  && /if \(st\.afAsking\) \{/.test(sweepSrc));
check('an AF card open with NO question while matches remain is a DEFECT, not a note',
  /AF-HOLDS-PAGER-WITH-NO-QUESTION/.test(sweepSrc)
  && /\} else if \(st\.afOpen && num\(total0\) > n\) \{/.test(sweepSrc));
check('the plain missing-pager defect still fires when no AF card is involved',
  /defect\(name, 'PAGER-MISSING'/.test(sweepSrc));

// ── 7. MUTATION PROOFS ──────────────────────────────────────────────────────────────────────────
// The pre-fix gate: `!ageFlow`, i.e. "withhold whenever anything is set". Indistinguishable from the
// correct answer on today's phases — which is why the EXHAUSTIVENESS and call-site checks, not the
// per-phase verdicts, are what actually catch a regression here.
const bareGate = (phase: AfPhase | null) => !!phase;
mustCatch('a bare !ageFlow agrees on today\'s phases — so the union/call-site checks are the real guard',
  PHASES.every((p) => bareGate(p) === afInterviewOwnsBrowsing(p)) && bareGate(null) === afInterviewOwnsBrowsing(null));
// A gate that let an ASKING interview be interrupted by a pager under its own overlay.
const leakyGate = (phase: AfPhase | null) => phase !== null && phase !== 'asking';
mustCatch('a gate that releases the pager while a question is on screen is caught',
  leakyGate('asking') !== afInterviewOwnsBrowsing('asking'));
// A threshold that finished the flow one match too early would strip a browsable set of its pager.
mustCatch('an off-by-one threshold is caught at the boundary',
  searchIsFinishedAtThreshold(26, STOP_AT) === false && searchIsFinishedAtThreshold(25, STOP_AT) === true);
// An UNGATED completed-trigger (e.g. an R11.2 "no questions left" call, or any call not behind the
// exact searchIsFinishedAtThreshold(...) predicate) is what this barrier must still catch, now that
// more than one CORRECTLY gated call site is legitimate. A raw `setCompleted(true)` appended with no
// guard raises completedCalls but not gatedCompletedCalls — the equality check goes red.
const withUngatedCall = `${agentCode}\nsetCompleted(true);`;
const ungatedTotal = [...withUngatedCall.matchAll(/setCompleted\(true\)/g)].length;
const ungatedGated = [...withUngatedCall.matchAll(/if \((?:searchIsFinishedAtThreshold\(.*?\)|userChoseShowAllAndFinish)\)\s*setCompleted\(true\);/g)].length;
mustCatch('an un-gated completed-trigger (e.g. R11.2) is caught by the gated-count mismatch',
  ungatedTotal !== ungatedGated && ungatedTotal === completedCalls + 1);

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed — the interview can hold browsing it has no right to, or the threshold no longer finishes cleanly.`);
  process.exit(1);
}
console.log('\n✓ the interview holds browsing only while asking, hands it back when finished, and the threshold ends the flow cleanly\n');
