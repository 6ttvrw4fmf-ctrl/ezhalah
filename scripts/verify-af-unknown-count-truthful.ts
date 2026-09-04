// AN UNKNOWN COUNT IS EITHER TRUE OR ABSENT — never a fabricated zero.
//
// WHY THIS EXISTS (owner rule, 2026-08-28)
// ----------------------------------------
// R7.1.3 promises the user a caption saying how many listings never stated the fact a question is
// about ("382 إعلان لم يذكر …"). The count reached the card and was thrown away —
// `unknownCount: _unknownCount` — so the promise was not kept. When the owner approved restoring the
// caption they attached one rule, and it is the whole point of this file:
//
//     NEVER display a fake unknown count. If a question does not have a truthful, source-grounded
//     unknown count, do not show 0 and do not guess it.
//
// That rule has teeth because the obvious implementation breaks it. `guidedOptions()` used to return
// a hardcoded `unknownCount: 0` for EVERY chip question. Switching the caption on over that would
// have printed «0 إعلان لم يذكر» on the amenities question — asserting that every listing in Saudi
// Arabia stated whether it has a kitchen. That is a fabricated fact of exactly the kind R13.2 and
// P2 ("unknown stays unknown") forbid, and it would have been *worse* than the missing caption,
// because it converts silence into a confident claim.
//
// So the type is `number | null`, `null` means "no honest single number exists here", and the card
// renders nothing for it. This barrier pins all three halves: the honest derivations, the honest
// absences, and the render gate.
//
// THE DERIVATIONS, AND WHY EACH IS SOUND
//   • FURNISHED   total − cnt_furnished − cnt_unfurnished. `furnished` is a tri-state boolean, so
//     true + false + null partitions the scope by construction. Verified live 2026-08-28 on
//     الرياض/إيجار/سنوي/شقة: 11,153 − 1,048 − 2,671 = 7,434, exactly `furnished IS NULL` in the DB.
//   • DIRECTION   total − Σ(the 8 direction counts). Sound ONLY because norm_direction_ar's range is
//     exactly those 8 buckets — measured over the whole production index, 0 rows normalise to a 9th.
//     A 9th bucket would silently inflate "did not mention", so the 8-value domain is pinned below.
//   • PROPERTY AGE has a real `cnt_unknown` column and needs no arithmetic.
//
// THE ABSENCES, AND WHY EACH IS RIGHT
//   • AMENITIES — no single unknown exists; each chip is its own column, so one number would be a
//     lie about the others.
//   • BATHROOMS / STREET_WIDTH / RATING — threshold ladders: total − (≥1) conflates NULL with rows
//     genuinely below the threshold.
//   • UNIT_SUBTYPE — total − Σ(3) is right only while the value domain has exactly 3 members. True
//     today, but a data fact rather than an invariant, so it must not be published as truth.
//   • RNPL — false and null are inseparable from cnt_rnpl alone.
//
//   node --experimental-strip-types scripts/verify-af-unknown-count-truthful.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-af-unknown-count-truthful: the "did not mention" caption is shown only where the');
console.log('  number is real, and is absent — never zero — everywhere else.');

const af = read('src/data/advancedFilters.ts');
const card = read('src/components/AdvancedQuestionCard.tsx');
const ranking = read('src/lib/afRanking.ts');
const steps = read('src/lib/afSteps.ts');

// ── 1. THE TYPE ADMITS "I DON'T KNOW" ────────────────────────────────────────────────────────────
// Without a nullable, every question is forced to invent a number.
check('AdvancedQuestionResult.unknownCount is nullable (a question may say "no honest number")',
  /unknownCount: number \| null/.test(ranking));
check('the card prop is nullable too', /unknownCount: number \| null/.test(card));
check('GuidedStep carries the nullable through the orchestrator', /unknownCount: number \| null/.test(steps));

// ── 2. NO FABRICATED ZERO ANYWHERE IN THE DATA LAYER ─────────────────────────────────────────────
// This is the exact regression: a literal 0 standing in for "unknown". `null` is the only legal
// stand-in. (A derived expression that happens to evaluate to 0 is fine — that is a real count.)
check('no question hardcodes `unknownCount: 0` (the fabricated-zero regression)',
  !/unknownCount:\s*0\b/.test(af), (af.match(/unknownCount:\s*0\b/g) ?? []).join(', '));
check('no orchestrator step hardcodes `unknownCount: 0` either',
  !/unknownCount:\s*0\b/.test(read('src/app/agent.tsx')));

// ── 3. THE RENDER GATE ───────────────────────────────────────────────────────────────────────────
check('the card no longer discards the count (`_unknownCount` is gone)',
  !/unknownCount:\s*_unknownCount/.test(card));
check('the caption renders ONLY for a non-null, positive count',
  /unknownCount != null && unknownCount > 0/.test(card));
check('the caption is a real testable element (af-unknown-count)',
  /testID="af-unknown-count"/.test(card));
check('the caption text is translated, not a hardcoded English string',
  /t\('\{n\} listings did not mention this'/.test(card));
check('the caption has an Arabic translation (no English leak into an Arabic UI)',
  /'\{n\} listings did not mention this':\s*'[^']*\{n\}[^']*'/.test(read('src/i18n.tsx')));

// ── 4. THE DERIVATIONS ARE THE SOUND ONES ────────────────────────────────────────────────────────
check('FURNISHED derives unknown from the tri-state partition (total − true − false)',
  /cnt_total_base - c\.cnt_furnished - c\.cnt_unfurnished/.test(af));
check('DIRECTION derives unknown as total − Σ(the offered direction chips), not a re-typed list',
  /cnt_total_base - DIRECTION_DEFS\.reduce/.test(af));
check('PROPERTY AGE uses its real cnt_unknown column', /unknownCount: counts\.cnt_unknown/.test(af));
check('a derived count can never render negative (clamped at 0)', /Math\.max\(0, unknownOf\(counts\)\)/.test(af));

// DIRECTION's soundness rests entirely on the chip list being the WHOLE normalised domain. Pin the
// count: 8 buckets, matching norm_direction_ar's measured range. A 9th chip (or a removed one) makes
// `total − Σ` mean something else, and the caption would silently over- or under-state.
const dirBlock = af.slice(af.indexOf('const DIRECTION_DEFS'), af.indexOf('const DIRECTION_QUESTION'));
const dirChips = (dirBlock.match(/key: '/g) ?? []).length;
check('DIRECTION offers exactly the 8 normalised buckets its subtraction assumes',
  dirChips === 8, `${dirChips} chips`);

// ── 5. THE ABSENCES STAY ABSENT ──────────────────────────────────────────────────────────────────
// Each of these questions must call guidedOptions WITHOUT an unknown resolver. The check is
// positional: grab each question's resolveOptions body and assert the call has only two arguments.
const questionBody = (marker: string, end: string) => {
  const i = af.indexOf(marker);
  return i < 0 ? '' : af.slice(i, af.indexOf(end, i) > 0 ? af.indexOf(end, i) : i + 1400);
};

// Count a call's TOP-LEVEL arguments by balancing brackets. A regex cannot do this: the first
// version of this check matched only multi-line calls, so the two SINGLE-LINE `guidedOptions(...)`
// calls in AMENITIES_QUESTION matched nothing and the check passed while testing nothing at all —
// a vacuous green, which is the exact failure mode this whole file exists to prevent. Found by
// mutation M1 (give amenities a `() => 0` resolver and watch the barrier stay green).
function callArgCounts(body: string, fn: string): number[] {
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = body.indexOf(`${fn}(`, from);
    if (at < 0) return out;
    let depth = 0, args = 1, i = at + fn.length;
    for (; i < body.length; i++) {
      const c = body[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) break; }
      else if (c === ',' && depth === 1) args++;
    }
    out.push(args);
    from = i + 1;
  }
}
const MUST_NOT_CLAIM: Array<[string, string, string]> = [
  ['AMENITIES_QUESTION', 'const BATHROOMS_QUESTION', 'each chip is its own column — no single unknown exists'],
  ['BATHROOMS_QUESTION', 'const FURNISHED_QUESTION', 'threshold ladder — NULL and below-threshold are not separable'],
  ['STREET_WIDTH_QUESTION', 'const DIRECTION_DEFS', 'threshold ladder'],
  ['RATING_QUESTION', 'const UNIT_SUBTYPE_QUESTION', 'threshold ladder'],
  ['UNIT_SUBTYPE_QUESTION', 'export const ADVANCED_QUESTIONS', 'value domain is a data fact, not an invariant'],
  ['RNPL_QUESTION', 'const AMENITIES_QUESTION', 'false and null inseparable from cnt_rnpl'],
];
for (const [q, end, why] of MUST_NOT_CLAIM) {
  const body = questionBody(`const ${q}`, end);
  const calls = callArgCounts(body, 'guidedOptions');
  // Every guidedOptions call in this question must pass exactly 2 args (counts, defs). A third is
  // an unknown-count claim. Requiring calls.length > 0 is what stops the check going vacuous if the
  // question is ever restructured out from under it.
  check(`${q} reports NO unknown count — ${why}`,
    body.length > 0 && calls.length > 0 && calls.every((n) => n === 2),
    calls.length ? `guidedOptions arg counts: ${calls.join(', ')}` : 'NO guidedOptions call found — check went vacuous');
}
// And the two that DO claim one must genuinely pass the third argument, or the derivations above are
// dead prose describing code that no longer runs.
for (const [q, end] of [['FURNISHED_QUESTION', 'const STREET_WIDTH_QUESTION'], ['DIRECTION_QUESTION', 'const RATING_QUESTION']] as const) {
  const calls = callArgCounts(questionBody(`const ${q}`, end), 'guidedOptions');
  check(`${q} DOES supply its truthful unknown resolver`,
    calls.length > 0 && calls.every((n) => n === 3), `arg counts: ${calls.join(', ') || 'none'}`);
}

// ── 6. THE RULE IS WRITTEN DOWN WHERE THE NEXT EDITOR WILL SEE IT ────────────────────────────────
check('guidedOptions carries the owner rule in prose at the point of temptation',
  /never display a fake unknown count|NEVER GUESSED/i.test(af));

console.log(failures === 0
  ? '\n✅ verify-af-unknown-count-truthful: all checks passed.'
  : `\n❌ verify-af-unknown-count-truthful: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
