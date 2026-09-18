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

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';

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

// ── 7. EXECUTION: RUN THE REAL guidedOptions ─────────────────────────────────────────────────────
// Everything above this line reads TEXT. That is not nothing — the structural checks balance
// brackets and one of them already caught a vacuous green — but a regex over a file is a statement
// about the file, and the rule this barrier enforces is about a VALUE the user is shown. On
// 2026-09-04 an audit found five barriers that ASSERTED THE BUG rather than catching it, and every
// one was a source-TEXT tripwire over a path that was broken the whole time it was green
// (docs/ops/BARRIER_ENGINEER.md §0.1). Converted by routine #10, 2026-09-18 (ops_incident #136).
//
// The REAL guidedOptions is lifted and run. Its three real collaborators are IMPORTED, not shimmed —
// isProbeFailure, meaningful and MIN_TOTAL_TO_SHOW are the actual shipped implementations, so this
// cannot drift from production the way a hand-copied duplicate did on 2026-08-29 with extractPrice.
// Only `t` is shimmed, because it translates a LABEL and cannot influence a count.
const AF_PATH = join(root, 'src/data/advancedFilters.ts');
const url = (p: string) => pathToFileURL(join(root, p)).href;
const PRELUDE = `
import { isProbeFailure } from '${url('src/lib/afProbe.ts')}';
import { meaningful, MIN_TOTAL_TO_SHOW } from '${url('src/lib/afRanking.ts')}';
const t = (k: string) => k;
type GuidedCounts = Record<string, number>;
type AdvancedQuestionResult = { options: unknown[]; unknownCount: number | null; total: number; probeFailed?: boolean };
`;

const liftFrom = async (file: string) =>
  (await liftSymbols(file, [{ header: 'function guidedOptions(' }], ['guidedOptions'], PRELUDE))
    .guidedOptions as (c: unknown, d: unknown[], u?: (c: any) => number) => {
      options: unknown[]; unknownCount: number | null; total: number; probeFailed?: boolean };

const guidedOptions = await liftFrom(AF_PATH);

// REAL PRODUCTION COUNTS, not a fixture this barrier invented. Measured 2026-09-18 against
// search_listings_ar for deal_ar='إيجار' AND city_ar='الرياض' — the scope a Riyadh rent search hits:
//
//   total 33,464 · furnished 2,266 · unfurnished 8,397 · furnished IS NULL 22,801
//
// and 33,464 − 2,266 − 8,397 = 22,801 EXACTLY. So the FURNISHED derivation is checked against the
// database's own answer to "how many listings never said", not against arithmetic this file chose.
// A barrier that supplies its own input proves nothing (PART 6, Prohibition 2.3).
const PROD = { cnt_total_base: 33464, cnt_furnished: 2266, cnt_unfurnished: 8397 };
const PROD_TRUE_UNKNOWN = 22801;
const FURNISHED_UNKNOWN = (c: any) => c.cnt_total_base - c.cnt_furnished - c.cnt_unfurnished;
const DEFS = [
  { key: 'furnished', labelKey: 'Furnished', count: (c: any) => c.cnt_furnished },
  { key: 'unfurnished', labelKey: 'Unfurnished', count: (c: any) => c.cnt_unfurnished },
];

check('the FURNISHED derivation, RUN over real production counts, equals the DB\'s own "never said" count',
  guidedOptions(PROD, DEFS, FURNISHED_UNKNOWN).unknownCount === PROD_TRUE_UNKNOWN,
  `got ${guidedOptions(PROD, DEFS, FURNISHED_UNKNOWN).unknownCount}, production says ${PROD_TRUE_UNKNOWN}`);

// THE RULE ITSELF, EXECUTED: no resolver means "no honest number exists", and that is null — never 0.
const absent = guidedOptions(PROD, DEFS);
check('a question with NO unknown resolver returns null, not a fabricated 0',
  absent.unknownCount === null, `got ${JSON.stringify(absent.unknownCount)}`);

// A probe that never completed is UNKNOWN. This is the owner-locked silent→NULL, never unknown→NO
// rule at the exact line that decides it, and the one this file's prose says would be "worse than
// the missing caption" if it printed 0.
const failed = guidedOptions({ __probeFailed: true }, DEFS, FURNISHED_UNKNOWN);
check('a FAILED probe yields null + probeFailed, never 0 (a failed fetch is not an empty answer)',
  failed.unknownCount === null && failed.probeFailed === true,
  `got unknownCount=${JSON.stringify(failed.unknownCount)} probeFailed=${JSON.stringify(failed.probeFailed)}`);

check('a scope below MIN_TOTAL_TO_SHOW reports null rather than inventing a number',
  guidedOptions({ ...PROD, cnt_total_base: 3 }, DEFS, FURNISHED_UNKNOWN).unknownCount === null);

// The clamp, executed rather than grepped: arithmetic that stops partitioning must not print a
// negative "did not mention".
check('arithmetic that no longer partitions is clamped at 0, never rendered negative',
  guidedOptions({ cnt_total_base: 100, cnt_furnished: 80, cnt_unfurnished: 80 }, DEFS, FURNISHED_UNKNOWN)
    .unknownCount === 0);

// ── MUTATION PROOFS: the real file, really mutated, really re-executed ───────────────────────────
// Not a synthetic predicate fed a broken value — the SHIPPED source with the defect written back
// into it, lifted and run. This is the strongest form available and it is what "watched to fail"
// means (PART 5).
const mutations: string[] = [];

// THE ANCHOR MUST LAND INSIDE THE LIFTED FUNCTION, and this is not pedantry — it caught a real
// no-op proof while this section was being written. `isProbeFailure(counts)) return { options: [],
// unknownCount: null, total: 0, probeFailed: true };` appears TWICE in advancedFilters.ts, in two
// different functions. String.replace takes the FIRST, which is outside guidedOptions, so the
// mutant was written to a region liftSymbols never lifts: the proof reported the defect as
// SURVIVING when in truth it had never been introduced. A whole-file `mutated !== src` guard is not
// enough — the file DID change. Only the lifted slice counts.
const guidedSlice = (s: string) => {
  const a = s.indexOf('function guidedOptions(');
  const b = s.indexOf('\n}\n', a);
  return a < 0 || b < 0 ? '' : s.slice(a, b);
};

const mustCatch = async (what: string, anchor: string, replacement: string, broken: (r: any) => boolean) => {
  const src = readFileSync(AF_PATH, 'utf8');
  const slice = guidedSlice(src);
  const hits = slice.split(anchor).length - 1;
  if (hits !== 1) {
    failures++;
    console.log(`  ❌ MUTATION ANCHOR NOT UNIQUE INSIDE guidedOptions (${hits} occurrence(s)): ${what} — ` +
      `nothing was proven; a mutant outside the lifted region reads as a surviving defect`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-af-mutant-'));
  const p = join(dir, 'advancedFilters.ts');
  const mutated = src.replace(slice, slice.replace(anchor, replacement));
  if (mutated === src) { failures++; console.log(`  ❌ MUTATION NO-OP: ${what}`); return; }
  writeFileSync(p, mutated);
  let caught = false;
  try { caught = broken(await liftFrom(p)); } catch { caught = true; }
  if (caught) { mutations.push(what); return; }
  failures++;
  console.log(`  ❌ MUTATION SURVIVED: ${what} would NOT be caught`);
};

await mustCatch('the fabricated zero returning instead of null — the exact regression this file exists for',
  'unknownCount: unknownOf ? Math.max(0, unknownOf(counts)) : null,',
  'unknownCount: unknownOf ? Math.max(0, unknownOf(counts)) : 0,',
  (g) => g(PROD, DEFS).unknownCount !== null);
await mustCatch('a failed probe being reported as an honest zero',
  'return { options: [], unknownCount: null, total: 0, probeFailed: true };',
  'return { options: [], unknownCount: 0, total: 0, probeFailed: true };',
  (g) => g({ __probeFailed: true }, DEFS, FURNISHED_UNKNOWN).unknownCount !== null);
await mustCatch('the clamp removed, so a broken partition renders a negative "did not mention"',
  'Math.max(0, unknownOf(counts))', 'unknownOf(counts)',
  (g) => (g({ cnt_total_base: 100, cnt_furnished: 80, cnt_unfurnished: 80 }, DEFS, FURNISHED_UNKNOWN)
    .unknownCount ?? 0) < 0);
await mustCatch('the MIN_TOTAL_TO_SHOW floor inverted, so a tiny scope publishes a number anyway',
  'counts.cnt_total_base < MIN_TOTAL_TO_SHOW', 'false',
  (g) => g({ ...PROD, cnt_total_base: 3 }, DEFS, FURNISHED_UNKNOWN).unknownCount !== null);

for (const m of mutations) console.log(`  ✓ mutation caught: ${m}`);

console.log(failures === 0
  ? `\n✅ verify-af-unknown-count-truthful: all checks passed (${mutations.length} mutations, real symbol executed).`
  : `\n❌ verify-af-unknown-count-truthful: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
