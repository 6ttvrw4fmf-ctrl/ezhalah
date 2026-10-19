// AN UNREADABLE COUNT AND A CHANGED COUNT ARE DIFFERENT DEFECTS, AND THE SWEEP MUST SAY WHICH.
//
// ops_incident #348, found by routine #9 on 2026-09-19 while attributing #331.
//
// e2e/live-sweep/showmore.mjs compared the headline before and after a «عرض المزيد» press with
// `st.headline !== total0` and, on any difference, reported `TRUE-TOTAL: headline moved across
// «عرض المزيد»: 21384 → null`.
//
// `headline` is resultsFoundCount(), and that function's contract is explicit:
//
//     NULL MEANS "NO SHIPPED SENTENCE IS ON THIS SCREEN" — it must never be conflated with "the
//     screen says zero". … a search that rendered results and whose count could not be read is a
//     BLIND journey, not a journey with no total.
//
// So `null` is the reader saying "I could not read it", and `!==` turned that into an accusation
// about the product's arithmetic. The accusation was wrong in a way that COST A DAY: routine #4
// went looking for a count/pagination bug, found nothing, and filed #331 as "Unattributed". The
// real defect was one layer over — production renders the sentence truncated mid-emoji after the
// second press, so it matches no shipped template (ops_incident #347).
//
// THE RED WAS CORRECT AND MUST STAY RED. This is not a tolerance being widened: both branches are
// still a defect, and `classifyHeadlineAcrossPress` returns 'OK' only when the two readings are
// equal numbers. What changed is which defect gets named. PART 7: never make a check green by
// weakening it — make it distinguish cases, and prove both directions.
//
// This barrier EXECUTES the real exported decision from the real module. It does not read the
// source text around it, because a source tripwire is exactly the shape that let the original
// conflation sit in place (PART 3.3 (1)).

import { classifyHeadlineAcrossPress } from '../e2e/live-sweep/showmore.mjs';
import { resultsFoundCount } from '../e2e/lib/resultsSentence.mjs';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) failures++;
};
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) ${label}`);
  if (!caught) failures++;
};

const kind = (a: number | null, b: number | null) => classifyHeadlineAcrossPress(a, b).kind;

// ── the four cases, executed ────────────────────────────────────────────────────────────────────
check('an UNREADABLE count after the press is COUNT-UNREADABLE, not a moved total',
  kind(21384, null) === 'COUNT-UNREADABLE', `got ${kind(21384, null)}`);
check('an unreadable count BEFORE the press is also COUNT-UNREADABLE (the blind direction is symmetric)',
  kind(null, 21384) === 'COUNT-UNREADABLE', `got ${kind(null, 21384)}`);
check('a genuinely MOVED total is still TRUE-TOTAL — the original alarm is intact',
  kind(21384, 9999) === 'TRUE-TOTAL', `got ${kind(21384, 9999)}`);
check('an unchanged total is OK', kind(21384, 21384) === 'OK', `got ${kind(21384, 21384)}`);
check('both readings unreadable is COUNT-UNREADABLE, never OK',
  kind(null, null) === 'COUNT-UNREADABLE', `got ${kind(null, null)}`);

// A zero is a NUMBER, not an absence — the other half of the same contract.
check('a real zero is treated as a value, not as unreadable',
  kind(0, 0) === 'OK' && kind(21384, 0) === 'TRUE-TOTAL',
  `kind(0,0)=${kind(0, 0)} kind(21384,0)=${kind(21384, 0)}`);

// ── the null this guards against is a REAL one the parser produces ──────────────────────────────
// Not a null this file invented: feed the parser the exact truncated sentence measured frozen on
// production and confirm it reads null, so the case above is the case that actually occurs.
const FROZEN = 'لقينا لك 72,470 نتيجة تطابق بحثك \ud83c';       // 34 of 35 code units, lone surrogate
const WHOLE = 'لقينا لك 72,470 نتيجة تطابق بحثك 🎉';   // the complete shipped template
check('the parser reads the production-measured TRUNCATED sentence as null (unreadable)',
  resultsFoundCount(FROZEN) === null, `got ${resultsFoundCount(FROZEN)}`);
check('…and reads the COMPLETE sentence as its number (the parser is not simply blind)',
  resultsFoundCount(WHOLE) === 72470, `got ${resultsFoundCount(WHOLE)}`);
check('end to end: a press that truncates the sentence classifies as COUNT-UNREADABLE',
  kind(resultsFoundCount(WHOLE), resultsFoundCount(FROZEN)) === 'COUNT-UNREADABLE',
  `got ${kind(resultsFoundCount(WHOLE), resultsFoundCount(FROZEN))}`);

// ── MUTATION PROOF — re-introduce the conflation and watch this barrier catch it ────────────────
type Verdict = 'OK' | 'TRUE-TOTAL' | 'COUNT-UNREADABLE';
/** The predicate this barrier enforces, applied to any candidate classifier. */
const conflates = (f: (a: number | null, b: number | null) => Verdict) =>
  f(21384, null) !== 'COUNT-UNREADABLE' || f(null, 21384) !== 'COUNT-UNREADABLE';
const losesTheAlarm = (f: (a: number | null, b: number | null) => Verdict) =>
  f(21384, 9999) !== 'TRUE-TOTAL';

mustCatch('THE INCIDENT: `after !== before` — a null reported as a moved true total',
  conflates((a, b) => (b !== a ? 'TRUE-TOTAL' : 'OK')));
mustCatch('a "fix" that silences the null instead of naming it (green on a broken sentence)',
  losesTheAlarm((a, b) => (b === null ? 'OK' : b !== a ? 'OK' : 'OK'))
  || conflates((a, b) => (b === null ? 'OK' : b !== a ? 'TRUE-TOTAL' : 'OK')));
mustCatch('a classifier that calls EVERYTHING unreadable loses the real alarm',
  losesTheAlarm(() => 'COUNT-UNREADABLE'));
mustCatch('the real classifier is NOT flagged by either predicate (not vacuously red)',
  !conflates(kind as never) && !losesTheAlarm(kind as never));

console.log(failures === 0
  ? '\n✓ an unreadable count is reported as unreadable, and a moved total is still a moved total (ops_incident #348)'
  : `\n✗ ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
