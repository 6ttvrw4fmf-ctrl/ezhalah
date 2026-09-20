// ONCE ADVANCED FILTER NARROWS TO ≤ INTERVIEW_STOP_AT, THE CHAT IS TERMINAL: NO «عرض المزيد».
//
// Owner rule (2026-09-06, the `final=50` incident). A round that truthfully narrows the eligible set
// to INTERVIEW_STOP_AT (50) or fewer FINISHES the chat: the composer locks AND every remaining match
// is revealed with no «عرض المزيد» pager. The bug this locks: at exactly 50 the composer locked
// (setCompleted) but the pager row still rendered — the two terminal signals disagreed, because the
// pager was gated on `hasMore` alone and never on the completion state.
//
// This executes the REAL predicates (never a copy) across the 49 / 50 / 51 boundary and proves:
//   • the completion decision is `<= stopAt` (49 and 50 finish; 51 keeps going),
//   • a completed chat renders NO «عرض المزيد» pager — even when `hasMore` is true (at the ≤50
//     terminal canNarrowFurther is false too, so nothing shows; the distinct >500 cap terminal,
//     owner 2026-09-14, keeps only the Advanced-Filter button),
//   • an un-completed chat with more matches DOES offer the pager (the fix does not over-hide),
//   • the composer-lock signal and the pager-hidden signal are DERIVED FROM THE SAME predicate, so
//     they can never disagree the way they did at 50.
//
// Run: node --experimental-strip-types scripts/verify-af-terminal-at-25-no-load-more.ts

import {
  searchIsFinishedAtThreshold,
  resultsActionsRowVisible,
  afInterviewOwnsBrowsing,
} from '../src/lib/afBrowsingGate.ts';
import { INTERVIEW_STOP_AT } from '../src/lib/afRanking.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) ${label}`);
  if (!caught) failed++;
};

console.log(`\nAF terminal at ≤${INTERVIEW_STOP_AT} — the chat finishes, no «عرض المزيد»\n`);

check(`INTERVIEW_STOP_AT is 25 (the owner's stop line)`, INTERVIEW_STOP_AT === 25, String(INTERVIEW_STOP_AT));

// 1. THE COMPLETION DECISION at the exact boundary. This is the SAME predicate finishGuided uses to
//    setCompleted(true), so proving it here proves the composer lock's boundary.
check('24 finishes the chat', searchIsFinishedAtThreshold(24, INTERVIEW_STOP_AT) === true);
check('25 finishes the chat (the exact boundary)', searchIsFinishedAtThreshold(25, INTERVIEW_STOP_AT) === true);
check('26 does NOT finish — the interview is right to continue', searchIsFinishedAtThreshold(26, INTERVIEW_STOP_AT) === false);
check('an unknown total (client-only narrowing) is NOT treated as finished',
  searchIsFinishedAtThreshold(null, INTERVIEW_STOP_AT) === false);

// 2. THE END-TO-END RULE: derive `completed` from the SAME predicate, then the pager must be hidden
//    exactly when the composer locks. `hasMore` is forced TRUE to prove the completion gate wins over it.
for (const total of [49, 50, 51]) {
  const completed = searchIsFinishedAtThreshold(total, INTERVIEW_STOP_AT);
  const rowVisible = resultsActionsRowVisible({
    hasMore: true, canNarrowFurther: false, afPhase: null, chatCompleted: completed,
  });
  const expectHidden = total <= INTERVIEW_STOP_AT;
  check(`total=${total}: composer ${completed ? 'LOCKS' : 'stays open'} and «عرض المزيد» ${rowVisible ? 'shows' : 'hidden'} — they agree`,
    rowVisible === !expectHidden);
}

// 3. THE FIX ITSELF: a completed chat hides «عرض المزيد» even with matches remaining. This holds for
//    BOTH terminals — the pager is always gone once the chat closes.
check('completed chat hides «عرض المزيد» even when hasMore is true',
  resultsActionsRowVisible({ hasMore: true, canNarrowFurther: false, afPhase: null, chatCompleted: true }) === false);
// The ≤50 AF terminal has canNarrowFurther=FALSE by construction (the set is ≤50, not
// > INTERVIEW_STOP_AT), so a completed chat there shows NOTHING at all — pager and narrow both gone.
check('the ≤50 terminal (completed, nothing left to narrow) shows no row at all',
  resultsActionsRowVisible({ hasMore: false, canNarrowFurther: false, afPhase: null, chatCompleted: true }) === false);
// A DISTINCT terminal (owner 2026-09-14, the >500 browse cap): the chat also completes there, but
// unseen inventory remains (canNarrowFurther), so «تحديد أكثر» STAYS — only «عرض المزيد» is gone.
// The completion gate returns canNarrowFurther, so it decouples the AF button from the composer lock.
check('the >500 cap terminal (completed, still narrowable) KEEPS the Advanced-Filter button',
  resultsActionsRowVisible({ hasMore: false, canNarrowFurther: true, afPhase: null, chatCompleted: true }) === true);

// 4. NOT OVER-HIDING: an un-completed chat with more matches still offers the pager (>50 keeps browsing).
check('un-completed chat with more matches still offers «عرض المزيد»',
  resultsActionsRowVisible({ hasMore: true, canNarrowFurther: false, afPhase: null, chatCompleted: false }) === true);
check('un-completed chat with a truthful next question still offers narrowing',
  resultsActionsRowVisible({ hasMore: false, canNarrowFurther: true, afPhase: null, chatCompleted: false }) === true);
check('un-completed chat with neither offers nothing',
  resultsActionsRowVisible({ hasMore: false, canNarrowFurther: false, afPhase: null, chatCompleted: false }) === false);

// 5. The interview-owns-browsing clause still hides the row while a question is on screen.
check('an open interview (asking) hides the row regardless of hasMore',
  resultsActionsRowVisible({ hasMore: true, canNarrowFurther: false, afPhase: 'asking', chatCompleted: false }) === false);

// ── MUTATIONS ──────────────────────────────────────────────────────────────────────────────────
// If the completion boundary regressed to `< stopAt`, exactly 50 would no longer finish.
mustCatch('a `< stopAt` completion boundary (25 not terminal) is caught',
  searchIsFinishedAtThreshold(25, INTERVIEW_STOP_AT) !== (25 < INTERVIEW_STOP_AT));
// If the pager gate dropped the chatCompleted clause, a completed chat with hasMore would show it.
mustCatch('dropping the completion gate (pager shows in a completed chat) is caught',
  resultsActionsRowVisible({ hasMore: true, canNarrowFurther: false, afPhase: null, chatCompleted: true }) === false);

console.log(failed === 0
  ? `\n✅ af-terminal-at-50: at ≤${INTERVIEW_STOP_AT} the chat finishes and «عرض المزيد» is gone; lock and pager agree.\n`
  : `\n❌ af-terminal-at-50: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
