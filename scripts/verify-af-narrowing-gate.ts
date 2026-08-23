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
//   node --experimental-strip-types scripts/verify-af-narrowing-gate.ts   (wired into `npm test`)

import { scoreQuestion, MIN_TOTAL_TO_SHOW } from '../src/lib/afRanking.ts';

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

// ── 2. THE MIRROR BUG: a real, large-majority option used to be silently dropped ─────────────────
// amenities «has parking»: 1,820 of 1,874 (97.1%) — under the old 90%-of-N cap this was excluded too,
// even though picking it narrows 1,874 → 1,820 (small, but real and occasionally exactly what a user
// wants — "I need parking" is a valid ask even when most listings already have it).
check('a multi-select question with only a LARGE real narrowing option (97.1% of N) is now OFFERED',
  scoreQuestion('amenities', 'multi',
    result([{ key: 'parking', count: 1820 }])) !== null,
  'amenities used to be dropped for having no option in [150, 1687]');

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

// ── 5. Selectivity still decides ORDER, not inclusion — a balanced split still scores higher ──────
const balanced = scoreQuestion('property_age', 'single',
  result([{ key: 'new', count: 937 }, { key: 'old', count: 937 }]));
const lopsided = scoreQuestion('property_age', 'single',
  result([{ key: 'new', count: 60 }, { key: 'old', count: 1814 }]));
check('a balanced split scores higher than a lopsided one (ask-order still rewards information gain)',
  !!balanced && !!lopsided && balanced.score > lopsided.score,
  `balanced=${balanced?.score} lopsided=${lopsided?.score}`);
check('…but the lopsided one is still INCLUDED, not dropped — this is the whole fix',
  lopsided !== null);

console.log(failed === 0
  ? '\n✓ narrowing gate holds — selectivity orders, never hides, a real question'
  : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
