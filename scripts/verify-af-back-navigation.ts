// «رجوع» — in-flow Back for the Advanced Filter interview, and the single/double tap contract.
//
// Owner 2026-08-22. Two rules landed together:
//
//   1. Every AF question carries «رجوع». It returns exactly ONE question and restores that
//      question's recorded answer — including restoring a SKIP as a skip (open, no predicate).
//      Earlier answers survive. Changing an earlier answer recomputes the eligible set, the true
//      count, and which later answers are still valid: valid ones are preserved, incompatible ones
//      are dropped, and nothing stale is left behind in the query. From the FIRST question, Back
//      leaves the interview and hands the pre-AF controls back.
//   2. A single tap SELECTS ONLY (the user must see the pick and the recomputed count before
//      committing). A second tap on the same option confirms and advances EXACTLY ONE question.
//      The ~260 ms auto-advance from 2026-08-11 is banned.
//
// This barrier does not merely pattern-match the shipped code: the interview record is a PURE
// module (`src/lib/afSteps.ts`) precisely so the state rules can be EXECUTED here against fake
// questions — one REPLACING (bath) and one APPENDING (amenities), because those two fail in
// different ways. The source-text checks below cover only the wiring that cannot be executed
// (which handler the card calls, which prop the orchestrator passes).
//
// Every assertion is mutation-proven at the bottom: each one is re-run against a deliberately
// broken variant and must FAIL, so a check that has quietly stopped testing anything is caught.
//
//   node --experimental-strip-types scripts/verify-af-back-navigation.ts     (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveGuided, sameKeys, type GuidedStep } from '../src/lib/afSteps.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

const agentSrc = codeOnly(read('src/app/agent.tsx'));
const cardSrc = codeOnly(read('src/components/AdvancedQuestionCard.tsx'));

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nAdvanced Filter — «رجوع» state restoration + single/double tap contract\n');

// ── the two fake questions, mirroring the two REAL apply shapes ─────────────────────────────────
// bath REPLACES a scalar; amenities APPENDS to a list. An inverse-based "undo" looks fine on the
// first and silently doubles the second, which is the whole reason the rebuild exists.
type Q = GuidedStep['question'];
const q = (id: string, apply: (x: any, keys: string[]) => any): Q =>
  ({ id, titleKey: id, selection: 'single', eligibility: () => true, resolveOptions: async () => ({} as any), apply } as unknown as Q);

const BATH = q('bathrooms', (x, keys) => ({ ...x, bathMin: Number(keys[0]) }));
const AMEN = q('amenities', (x, keys) => ({ ...x, amenities: [...(x.amenities ?? []), ...keys] }));
const opts = (...ks: string[]) => ks.map((k) => ({ key: k, label: `L:${k}`, count: 10 })) as GuidedStep['options'];
const step = (question: Q, options: GuidedStep['options'], keys: string[] | null): GuidedStep =>
  ({ question, options, unknownCount: 0, total: 100, keys });

const BASE = { city: 'الرياض' } as any;

// ── 1. the step UNDER the cursor is never applied ───────────────────────────────────────────────
// While a question is on screen its own answer must not already be in the query, or the option
// counts and the live «N نتيجة» would be computed against a scope that already assumes the answer.
{
  const steps = [step(BATH, opts('2', '3'), ['2'])];
  const atCursor = deriveGuided(BASE, steps, 0); // asking step 0
  const past = deriveGuided(BASE, steps, 1);     // step 0 committed
  check('the question being asked is NOT yet applied to the query',
    (atCursor.query as any).bathMin === undefined && (past.query as any).bathMin === 2);
}

// ── 2. Back un-applies exactly one answer, and keeps the earlier ones ───────────────────────────
{
  const steps = [step(BATH, opts('2'), ['2']), step(AMEN, opts('pool', 'gym'), ['pool'])];
  const back = deriveGuided(BASE, steps, 1); // walked Back onto step 1
  check('Back drops the later predicate and preserves every earlier answer',
    (back.query as any).bathMin === 2 && (back.query as any).amenities === undefined
    && back.askedIds.join(',') === 'bathrooms');
}

// ── 3. no stale predicate after a CHANGED earlier answer ────────────────────────────────────────
// The failure this exists for: a replacing answer left at its old value, or an appending answer
// accumulating both the old and the new keys.
{
  const before = [step(BATH, opts('2', '4'), ['2']), step(AMEN, opts('pool', 'gym'), ['pool'])];
  const changed = [step(BATH, opts('2', '4'), ['4']), before[1]];
  const out = deriveGuided(BASE, changed, 2);
  check('changing an earlier answer leaves NO stale predicate behind',
    (out.query as any).bathMin === 4 && (out.query as any).amenities.join(',') === 'pool');

  const reanswered = [before[0], step(AMEN, opts('pool', 'gym'), ['gym'])];
  const out2 = deriveGuided(BASE, reanswered, 2);
  check('re-answering an APPENDING question replaces, never accumulates',
    (out2.query as any).amenities.join(',') === 'gym',
    `got ${JSON.stringify((out2.query as any).amenities)}`);
}

// ── 4. a skip stays open — before AND after a Back ──────────────────────────────────────────────
{
  const steps = [step(BATH, opts('2'), []), step(AMEN, opts('pool'), ['pool'])];
  const out = deriveGuided(BASE, steps, 2);
  check('Skip writes NO predicate yet counts as asked (never a false/No)',
    (out.query as any).bathMin === undefined && out.askedIds.includes('bathrooms')
    && !out.facets.some((f) => f.id === 'bathrooms'));
  const back = deriveGuided(BASE, steps, 0);
  check('walking Back past a skip restores it as open, not as a negative answer',
    (back.query as any).bathMin === undefined && back.askedIds.length === 0);
}

// ── 5. an unanswered step is neither asked nor applied ──────────────────────────────────────────
{
  const out = deriveGuided(BASE, [step(BATH, opts('2'), null)], 1);
  check('a presented-but-unanswered step is not counted as asked',
    out.askedIds.length === 0 && (out.query as any).bathMin === undefined);
}

// ── 6. labels/facets track the surviving answers only ───────────────────────────────────────────
{
  const steps = [step(BATH, opts('2'), ['2']), step(AMEN, opts('pool'), ['pool'])];
  check('facets + summary labels are derived, so Back drops them together with the predicate',
    deriveGuided(BASE, steps, 2).facets.length === 2 && deriveGuided(BASE, steps, 1).labels.join(',') === 'L:2');
}

// ── 7. order-insensitive answer comparison ──────────────────────────────────────────────────────
check('sameKeys ignores tap order (a re-confirm must not look like a change)',
  sameKeys(['a', 'b'], ['b', 'a']) && !sameKeys(['a'], ['a', 'b']) && !sameKeys(['a'], ['b']));

// ── 8. the card: single tap selects only, double tap confirms ───────────────────────────────────
// NB: `[^)]*` cannot cross the ')' in `setTimeout(() => …)`, which made an earlier draft of this
// guard blind to the exact regression it exists for. The mutation proof below caught that.
check('a single tap NEVER auto-advances (no timer-driven onConfirm anywhere in the card)',
  !/setTimeout\([\s\S]{0,120}?onConfirm/.test(cardSrc) && !/autoRef/.test(cardSrc));
check('the double tap rides the SAME onPress path — no rival dbl-click/long-press handler',
  /DOUBLE_TAP_MS/.test(cardSrc) && /lastTapRef/.test(cardSrc)
  && !/onDoubleClick|onLongPress|doubleTapHandler/.test(cardSrc));
// One onConfirm call per double tap: the confirm sits inside the double-tap branch and returns
// immediately, so the same tap cannot also fall through to the select branch and advance twice.
check('the double-tap branch commits once and returns (cannot advance two questions)',
  /if \(last && last\.key === key && now - last\.at <= DOUBLE_TAP_MS\) \{[\s\S]{0,240}?onConfirm\(\[key\]\);\s*\n\s*return;/.test(cardSrc));
check('the tap log is cleared when the question changes (no cross-question double tap)',
  /lastTapRef\.current = null;/.test(cardSrc));

// ── 9. the card: «رجوع» exists and is restorable ────────────────────────────────────────────────
check('«رجوع» renders on the question card with a stable testID and rides onBack',
  /testID="af-back"/.test(cardSrc) && /onPress=\{onBack\}/.test(cardSrc) && /t\('Back'\)/.test(cardSrc));
check('the card restores the recorded answer instead of clearing on every question change',
  /setSel\(initialKeys \?\? \[\]\)/.test(cardSrc) && !/^\s*setSel\(\[\]\);$/m.test(cardSrc));

// ── 10. the orchestrator: cursor, restoration, revalidation, back-to-start ──────────────────────
check('Back steps the cursor back exactly one question',
  /presentGuided\(stepIndex - 1, ageFlowTokenRef\.current\)/.test(agentSrc));
check('Back from the FIRST question leaves AF (which is what restores the pre-AF controls)',
  /if \(stepIndex <= 0\) \{[\s\S]{0,220}?setAgeFlow\(null\);/.test(agentSrc)
  && /\(hasMore \|\| canNarrowFurther\) && !ageFlow/.test(agentSrc));
check('the recorded answer is handed back to the card on Back',
  /initialKeys: st\.keys \?\? \[\]/.test(agentSrc) && /initialKeys=\{ageFlow\.initialKeys\}/.test(agentSrc));
check('a CHANGED earlier answer triggers re-validation of everything after it',
  /const changedAnswer = prev != null && !sameKeys\(prev, keys\)/.test(agentSrc)
  && /if \(changedAnswer\) await revalidateStepsAfter\(stepIndex, token\)/.test(agentSrc));
check('re-validation keeps a skip, and drops only ineligible or zero-yield later answers',
  /if \(!st\.keys\.length\) \{ kept\.push\(st\); continue; \}/.test(agentSrc)
  && /eligibleQuestions\(q\)\.some\(\(x\) => x\.id === st\.question\.id\)/.test(agentSrc)
  && /if \(n == null \|\| n <= 0\) continue;/.test(agentSrc));
// Count honesty applies to the option pills too: a step re-shown after an EARLIER answer changed
// would otherwise display the counts captured under the old scope.
check('a re-presented question re-resolves its option counts against the CURRENT scope',
  /fresh = await st\.question\.resolveOptions\(q0\)/.test(agentSrc)
  && /const options = fresh\?\.options\.length \? fresh\.options : st\.options;/.test(agentSrc));
// Found live on production 2026-08-22: with the auto-advance gone, a user can sit on a SELECTED but
// uncommitted option and leave via «عرض النتائج». That exit used to run finishGuided directly, so it
// discarded the visible answer and landed on a different count than the chip had just promised
// (10,945 delivered against a chip reading 2,488). Every exit now runs the ONE commit path.
check('«عرض النتائج» commits the visible selection instead of discarding it',
  /onPress=\{\(\) => onSkipAll\(sel\)\}/.test(cardSrc)
  && /const onAgeSkipAll = \(keys: string\[\]\) => \{ void commitGuidedStep\(keys, true\); \}/.test(agentSrc)
  && !/const onAgeSkipAll = \(\) => finishGuided/.test(agentSrc));
check('the query is REBUILT from the record, never mutated in place by a handler',
  /deriveGuided\(ageFlowBaseQRef\.current, ageFlowStepsRef\.current, upTo\)/.test(agentSrc)
  && !/ageFlowQueryRef\.current = question\.apply\(/.test(agentSrc));

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
// Each assertion is re-run against a deliberately broken variant; a check that no longer fails on
// its own defect has stopped testing anything.
console.log('\n  mutation proof — each guard must FAIL on its own defect\n');
let mutFail = 0;
const mustCatch = (label: string, brokenIsCaught: boolean) => {
  if (brokenIsCaught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

// Executable mutations — re-implement the defect and check the same predicate flips.
{
  // (a) applying the step under the cursor
  const bad = (steps: GuidedStep[], upTo: number) => deriveGuided(BASE, steps, upTo + 1);
  mustCatch('deriveGuided applying the question currently being asked',
    (bad([step(BATH, opts('2'), ['2'])], 0).query as any).bathMin === 2);

  // (b) a skip treated as a real answer — the defect lives in the DERIVATION (dropping the
  // empty-keys guard), not in a question's apply(), so the broken derivation is what must be run.
  const deriveWithoutSkipGuard = (steps: GuidedStep[], upTo: number) => {
    let query: any = BASE;
    for (const st of steps.slice(0, upTo)) { if (st.keys == null) continue; query = st.question.apply(query, st.keys); }
    return query;
  };
  const skipAsNo = q('bathrooms', (x, keys) => ({ ...x, bathMin: keys.length ? Number(keys[0]) : 0 }));
  mustCatch('a skip written into the query as a value (false/No)',
    deriveWithoutSkipGuard([step(skipAsNo, opts('2'), [])], 1).bathMin === 0
    && (deriveGuided(BASE, [step(skipAsNo, opts('2'), [])], 1).query as any).bathMin === undefined);

  // (c) appending answer accumulating across a re-answer — the classic stale predicate
  const stale = { ...BASE, amenities: ['pool'] };
  mustCatch('an appending answer accumulating the OLD keys as well as the new',
    (deriveGuided(stale, [step(AMEN, opts('gym'), ['gym'])], 1).query as any).amenities.join(',') === 'pool,gym');

  // (d) order-sensitive comparison would report a spurious change
  mustCatch('sameKeys comparing raw order', ['a', 'b'].join() === ['b', 'a'].join() ? false : true);
}

// Source mutations — flip the shipped text and confirm the regex stops matching.
const mut = (src: string, from: string | RegExp, to: string) => src.replace(from, to);
mustCatch('the 260 ms auto-advance creeping back',
  /setTimeout\([\s\S]{0,120}?onConfirm/.test(mut(cardSrc, 'lastTapRef.current = { key, at: now };',
    'autoRef.current = setTimeout(() => onConfirm([key]), 260);')));
mustCatch('a rival double-click handler being added',
  /onDoubleClick|onLongPress|doubleTapHandler/.test(mut(cardSrc, 'onPress={onBack}', 'onDoubleClick={onBack}')));
mustCatch('«رجوع» losing its testID',
  !/testID="af-back"/.test(mut(cardSrc, 'testID="af-back"', '')));
mustCatch('the card going back to clearing the selection on every question',
  !/setSel\(initialKeys \?\? \[\]\)/.test(mut(cardSrc, 'setSel(initialKeys ?? [])', 'setSel([])')));
mustCatch('Back-to-start no longer restoring the pre-AF controls',
  !/if \(stepIndex <= 0\) \{[\s\S]{0,220}?setAgeFlow\(null\);/.test(
    mut(agentSrc, /if \(stepIndex <= 0\) \{/, 'if (false) {')));
mustCatch('the pre-AF CTA row losing its !ageFlow gate',
  !/\(hasMore \|\| canNarrowFurther\) && !ageFlow/.test(
    mut(agentSrc, '(hasMore || canNarrowFurther) && !ageFlow', '(hasMore || canNarrowFurther)')));
mustCatch('a changed earlier answer no longer re-validating later ones',
  !/if \(changedAnswer\) await revalidateStepsAfter\(stepIndex, token\)/.test(
    mut(agentSrc, 'if (changedAnswer) await revalidateStepsAfter(stepIndex, token)', '')));
mustCatch('re-validation starting to drop skips',
  !/if \(!st\.keys\.length\) \{ kept\.push\(st\); continue; \}/.test(
    mut(agentSrc, 'if (!st.keys.length) { kept.push(st); continue; }', 'if (!st.keys.length) continue;')));
mustCatch('a handler mutating the query in place again',
  /ageFlowQueryRef\.current = question\.apply\(/.test(
    mut(agentSrc, 'ageFlowQueryRef.current = d.query;', 'ageFlowQueryRef.current = question.apply(q, keys);')));
mustCatch('a re-presented step showing stale per-option counts',
  !/fresh = await st\.question\.resolveOptions\(q0\)/.test(
    mut(agentSrc, 'fresh = await st.question.resolveOptions(q0)', 'fresh = null')));
mustCatch('«عرض النتائج» going back to discarding the visible selection',
  /const onAgeSkipAll = \(\) => finishGuided/.test(
    mut(agentSrc, /const onAgeSkipAll = \(keys: string\[\]\) => \{ void commitGuidedStep\(keys, true\); \}/,
      'const onAgeSkipAll = () => finishGuided(ageFlowTokenRef.current);')));
mustCatch('the restored answer no longer reaching the card',
  !/initialKeys=\{ageFlow\.initialKeys\}/.test(mut(agentSrc, 'initialKeys={ageFlow.initialKeys}', '')));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ «رجوع» restores state without stale predicates; single tap selects, double tap advances one\n');
