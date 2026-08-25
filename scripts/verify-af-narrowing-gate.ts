// ADVANCED FILTER NARROWING GATE (owner bug report, 2026-08-22) — mutation-proves the fix for:
// Villa + 6 Riyadh districts, ~5,154 matches, the interview asked ~2 questions and stopped at
// ~1,874 remaining while several more source-certified Villa questions (street width, direction,
// amenities…) had never been asked. Root cause: scoreQuestion() used to require every candidate
// option to fall inside an 8%-90% "selectivity" band (plus ≥1 option ≤75%N) — a question with only
// a small-but-real or a large-but-real narrowing option was DROPPED from the pool entirely, not
// ranked lower. See docs/ADVANCED_FILTER_DESIGN_CONTRACT.md "Amendment 2026-08-22" for the full
// story and scripts/verify-advanced-filter-contract.ts for the structural (source-grep) half of
// this barrier — this script is the EXECUTED half: scoreQuestion() is pure (src/lib/afRanking.ts,
// 2026-08-22 extraction, matching the afCohorts.ts precedent), so real fixtures get real answers
// instead of a regex hoping the numbers didn't drift.
//
// AMENDED 2026-08-25 (owner decision of that date — this gate has now MOVED TWICE, and both moves
// are recorded here on purpose). The 2026-08-11 band rejected an option for being too SMALL a slice
// AND for being too LOPSIDED. The 2026-08-22 rule above threw out both halves. Only the small-slice
// half was the bug the owner reported: an option matching 60 of 1,874 removes 96.8% and is exactly
// the question they wanted back. The lopsided half was an over-correction — the owner's 2026-08-25
// words: "If the next question is 'do you want a gym?' but 100/100 properties have a gym, asking
// that is pointless. Same if 98/100 have it." So the gate is now ONE-SIDED: an option is included
// only when it removes ≥MEANINGFUL_NARROWING_FRACTION of the scope OR lands at/under
// INTERVIEW_STOP_AT (`optionNarrowsMeaningfully`, shared with the OFFER gate so the two can never
// disagree — see scripts/verify-af-offer-gate.ts). Small slices are still never rejected; §1 below
// is unchanged and is what keeps that permanent. §2 and §5 below were INVERTED by this decision and
// say so in place. Nothing is invented and nothing is forced to reach ≤25: when no meaningful
// truthful option is left the Advanced Filter is simply DONE.
//
//   node --experimental-strip-types scripts/verify-af-narrowing-gate.ts   (wired into `npm test`)

import { scoreQuestion, MIN_TOTAL_TO_SHOW, INTERVIEW_STOP_AT, optionNarrowsMeaningfully } from '../src/lib/afRanking.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`);
};

const N = 1874; // the owner's own repro number
const result = (options: Array<{ key: string; count: number }>) =>
  ({ options: options.map((o) => ({ ...o, label: o.key })), unknownCount: 0, total: N });

console.log(`\nAF narrowing gate — Villa/1,874-repro numbers (N=${N})\n`);

// ── 1. THE BUG: a real, small-share option used to be silently dropped ───────────────────────────
// street_width «30m+»: 60 of 1,874 (3.2%) — under the old 8%-of-N floor (150), so scoreQuestion
// returned null and the question vanished from the pool even though answering it would take the
// user from 1,874 straight to 60 (exactly the kind of aggressive narrowing the owner wants back).
check('a single-select question with only a SMALL real narrowing option (3.2% of N) is now OFFERED',
  scoreQuestion('street_width', 'single',
    result([{ key: '30', count: 60 }, { key: '25', count: 210 }])) !== null,
  'street_width used to be dropped for having no option in [150, 1687]');

// ── 2. THE OTHER END — INVERTED BY THE OWNER ON 2026-08-25 ──────────────────────────────────────
// This assertion used to read "a LARGE real narrowing option (97.1% of N) is now OFFERED" — written
// on 2026-08-22 when both halves of the old band were thrown out together. The owner reversed exactly
// this half on 2026-08-25: amenities «has parking» at 1,820 of 1,874 narrows the set by 54 listings
// (2.9%). That is the gym question — a tap that buys the user nothing — so the option is dropped, and
// with it the only chip this multi-select had, so the question dies. §1 above is untouched: this is a
// one-sided rule and a SMALL slice is still always asked.
check('a near-no-op option (97.1% of N, removes 2.9%) is EXCLUDED, so this question is not asked',
  scoreQuestion('amenities', 'multi',
    result([{ key: 'parking', count: 1820 }])) === null,
  "owner 2026-08-25: 'if 98/100 have it, asking is pointless' — 1,820/1,874 is the same shape");
// …and the same question survives untouched the moment it has a chip that actually cuts: «has pool»
// at 900 of 1,874 removes 52%.
check('the same multi-select IS asked when one of its chips really narrows (900 of 1,874)',
  scoreQuestion('amenities', 'multi',
    result([{ key: 'parking', count: 1820 }, { key: 'pool', count: 900 }])) !== null);

// ── 2b. THE OWNER'S OWN WORKED EXAMPLE (2026-08-25), EXECUTED ───────────────────────────────────
// Bathrooms at N=100 with rungs 100/98/60/20: «1+» (0% cut) and «2+» (2% cut) drop, «3+» (40%) and
// «4+» (80%) stay — the question survives with a real choice of two, and the user never sees a chip
// that does nothing. Gym at 100/100 loses its only option and the question disappears entirely.
{
  const bathrooms = scoreQuestion('bathrooms', 'single', {
    options: [['1', 100], ['2', 98], ['3', 60], ['4', 20]].map(([key, count]) =>
      ({ key: String(key), label: String(key), count: Number(count) })),
    unknownCount: 0, total: 100,
  });
  check('owner example: bathrooms 100/98/60/20 at N=100 survives with EXACTLY the 60 and 20 rungs',
    !!bathrooms && bathrooms.options.map((o) => o.count).join(',') === '60,20',
    `got ${bathrooms ? bathrooms.options.map((o) => o.count).join(',') : 'null'}`);
  check('owner example: a gym every listing has (100 of 100) kills its question outright',
    scoreQuestion('amenities', 'multi',
      { options: [{ key: 'gym', label: 'gym', count: 100 }], unknownCount: 0, total: 100 }) === null);
}

// ── 3. NOT "ask anything" — a question with ZERO real narrowing option is still excluded ──────────
// Every option ties at N (a no-op — selecting it changes nothing for this scope): correctly dropped,
// same as before. This is the difference between "genuinely nothing left to ask" and "asked in the
// wrong order" that the design contract amendment insists on keeping distinct.
check('a question where every option ties at N (a genuine no-op) is still EXCLUDED',
  scoreQuestion('furnished', 'single',
    result([{ key: 'yes', count: N }])) === null,
  'a no-op option must never be offered as if it were a real choice');
check('single-select still needs a real CHOICE (≥2 narrowing options) — one alone is not a choice',
  scoreQuestion('bathrooms', 'single',
    result([{ key: '3', count: 900 }])) === null,
  'MIN_OPTIONS_SINGLE=2 must still apply — a lone option is not a decision');
check('multi-select still accepts a single real narrowing chip (a yes/no is a valid choice)',
  scoreQuestion('rnpl', 'multi',
    result([{ key: 'rnpl', count: 900 }])) !== null);

// ── 4. Below the interview's own stop line, nothing is ever offered (unchanged) ───────────────────
check(`below MIN_TOTAL_TO_SHOW (${MIN_TOTAL_TO_SHOW}), no question is ever offered, split or not`,
  scoreQuestion('property_age', 'single',
    { options: [{ key: 'new', label: 'new', count: 5 }, { key: '1_2', label: '1_2', count: 5 }], unknownCount: 0, total: 20 }) === null);

// ── 5. Selectivity still decides ORDER, not inclusion ────────────────────────────────────────────
// Both fixtures clear the 2026-08-25 gate (1,500 of 1,874 removes 20%, 300 removes 84%), so the only
// thing separating them is the score. UPDATED 2026-08-25: this pair used to be 937/937 vs 60/1,814,
// and the second assertion used to read "the lopsided one is still INCLUDED" — under the owner's new
// rule the 1,814 chip (3.2% cut) is dropped, which leaves that single-select with one option, and
// MIN_OPTIONS_SINGLE=2 then correctly says one option is not a choice. That is the new rule working,
// not selectivity creeping back into inclusion: the 60 chip itself survives (see §1).
const balanced = scoreQuestion('property_age', 'single',
  result([{ key: 'new', count: 937 }, { key: 'old', count: 937 }]));
const lopsided = scoreQuestion('property_age', 'single',
  result([{ key: 'new', count: 300 }, { key: 'old', count: 1500 }]));
check('a balanced split scores higher than a lopsided one (ask-order still rewards information gain)',
  !!balanced && !!lopsided && balanced.score > lopsided.score,
  `balanced=${balanced?.score} lopsided=${lopsided?.score}`);
check('…but the lopsided one is still INCLUDED, not dropped — selectivity never decides inclusion',
  lopsided !== null);

// ── 6. THE ONE-SIDEDNESS, SWEPT (owner 2026-08-25) ──────────────────────────────────────────────
// The permanent half of the 2026-08-22 rule, asserted as a property rather than one fixture: over
// every scope size and every count, an option is NEVER rejected for being small. Whatever else this
// gate learns to do, "a small slice is a great question" must survive it.
{
  let smallRejected = 0; let first = '';
  for (let N = 26; N <= 2000; N += 1) {
    for (const k of [0, 1, 5, 25, 26, Math.ceil(N * 0.05), Math.ceil(N * 0.5), Math.floor(N * 0.9)]) {
      if (k > N) continue;
      if (k <= N * 0.9 && !optionNarrowsMeaningfully(k, N)) { smallRejected++; if (!first) first = `N=${N} k=${k}`; }
    }
  }
  check('no option that removes ≥10% is EVER rejected — the gate is one-sided, small slices always ask',
    smallRejected === 0, `${smallRejected} rejection(s), first ${first}`);
  check(`the ≤${INTERVIEW_STOP_AT} escape survives: a 3.8%-cut option that LANDS at the target still asks`,
    optionNarrowsMeaningfully(25, 26) === true,
    'the last step to the target must never be blocked by a percentage');
}

console.log(failed === 0
  ? '\n✓ narrowing gate holds — selectivity orders, never hides, a real question'
  : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
