// ONE QUESTION, ONE GATE — THE MANUAL AF UI AND THE AI CHAT MUST NEVER OFFER DIFFERENT QUESTIONS.
//
// ── THE DEFECT THIS EXISTS FOR (found 2026-09-01, owner property-type audit) ─────────────────────
//
// Eight of the nine AF questions gated on `cohortAllows(q, id)`. `property_age` did not:
//
//   src/data/advancedFilters.ts   AGE_QUESTION.eligibility = isAgeFilterScopeFor(...)   ← cohort gate SKIPPED
//   src/lib/afIntents.ts          applyAfIntents            = cohortAllows(...)          ← age gate SKIPPED
//
// One question, two predicates, two surfaces — so the two surfaces disagreed on 16 of the 93
// (clean type × deal/period) cells, proven by executing both gates:
//
//   Room/Buy         the manual UI OFFERED the age question although COHORT_QUESTIONS.Room has no
//                    `Buy` list at all. A flat R2.1.1 violation: "Every AF question must appear in
//                    COHORT_QUESTIONS for a given (clean_type × deal × period) triple, or it can
//                    never be asked for that scope."
//   15 more cells    Studio/RentAnnual, Rest House ×2, Farm/Buy, Shop ×2, Showroom ×2, Workshop ×2,
//                    Commercial Building ×2, Hotel/Buy, Gas Station ×2 — certify property_age, so
//                    the AI chat APPLIED an age filter the manual UI can never offer, because
//                    AGE_FILTER_TYPES does not list those types.
//
// Note the shape: `agent.ts`'s own comment claimed each id was "gated by cohortAllows(q, id), the
// exact predicate its AF question uses", and verify-agent-af-intent-coverage.ts enforced that every
// certified question HAS a registry entry. Both were true. Neither checked that the two surfaces'
// gates AGREE — so the drift sat underneath a green suite.
//
// ── WHAT THIS PINS ───────────────────────────────────────────────────────────────────────────────
//
// 1. Both surfaces route through the ONE shared predicate `afQuestionAllowed()`.
// 2. R2.1.1 executably: nothing may be offered for a (type × deal × period) that COHORT_QUESTIONS
//    does not certify — swept over the FULL live matrix, not a sample.
// 3. No AF question's eligibility bypasses the shared gate at source level (the bypass that made
//    property_age special in the first place).
//
// Checks 1 and 3 are structural; check 2 is executed against the real functions. Together they mean
// a future question cannot be added with its own private gate, and a future gate cannot be applied
// to one surface only.
//
//   node --experimental-strip-types scripts/verify-af-question-gate-is-one-predicate.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COHORT_QUESTIONS, afQuestionAllowed, cohortAllows } from '../src/lib/afCohorts.ts';
import { CLEAN_MACRO } from '../src/data/propertyTypes.ts';

const ROOT = join(import.meta.dirname, '..');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nverify-af-question-gate-is-one-predicate: the manual AF UI and the AI chat must gate\n' +
            '  every question through the SAME predicate, and never past COHORT_QUESTIONS.\n');

// ── 1. both surfaces call the shared predicate ───────────────────────────────────────────────────
const advanced = readFileSync(join(ROOT, 'src/data/advancedFilters.ts'), 'utf8');
const intents = readFileSync(join(ROOT, 'src/lib/afIntents.ts'), 'utf8');

check('the AI chat intent applier gates on afQuestionAllowed()',
  /if\s*\(!afQuestionAllowed\(/.test(intents),
  'src/lib/afIntents.ts must call afQuestionAllowed(), not cohortAllows() — cohortAllows alone ' +
  'misses the per-question extra gates (property_age) and lets the chat apply what the UI cannot offer');

// ── 2. NO question may carry a private gate that skips cohort certification ──────────────────────
//
// Every `eligibility:` in the question table must be either afQuestionAllowed(...) or
// cohortAllows(...) — the scope questions (group/type pickers) are the documented exception because
// they are not cohort-certified content questions at all.
const eligibilityLines = [...advanced.matchAll(/^\s*eligibility:\s*(.+)$/gm)].map((m) => m[1].trim());
const SCOPE_EXEMPT = /unresolvedScopeTiers\(/;
// `=> boolean` is the AdvancedQuestion TYPE declaration, not a question's gate (it can carry a
// trailing comment, so anchoring on end-of-line misses it).
const TYPE_DECL = /=>\s*boolean/;
const offenders = eligibilityLines.filter((l) =>
  !SCOPE_EXEMPT.test(l) && !TYPE_DECL.test(l) && !/afQuestionAllowed\(|cohortAllows\(/.test(l));
check('no AF question eligibility bypasses the shared cohort gate',
  offenders.length === 0,
  offenders.length
    ? `these gate on something else entirely:\n      ${offenders.join('\n      ')}\n      ` +
      'A question with its own private predicate is exactly how property_age drifted from every ' +
      'other question and from the AI surface. Route it through afQuestionAllowed().'
    : `${eligibilityLines.length} eligibility expressions, all routed through the shared gate`);

check('property_age specifically still routes through the shared gate (the 2026-09-01 regression)',
  /eligibility:\s*\(q\)\s*=>\s*afQuestionAllowed\(q,\s*'property_age'\)/.test(advanced));

// ── 3. R2.1.1, EXECUTED over the whole live matrix ───────────────────────────────────────────────
const LEGS: Record<string, { deal: string; rentPeriod: string | null }> = {
  Buy: { deal: 'Buy', rentPeriod: null },
  RentAnnual: { deal: 'Rent', rentPeriod: 'annual' },
  RentMonthly: { deal: 'Rent', rentPeriod: 'monthly' },
};
const LEG_KEY: Record<string, 'Buy' | 'RentAnnual' | 'RentMonthly'> = {
  Buy: 'Buy', RentAnnual: 'RentAnnual', RentMonthly: 'RentMonthly',
};
const ALL_IDS = [...new Set(Object.values(COHORT_QUESTIONS).flatMap((c: any) =>
  [...(c.Buy ?? []), ...(c.RentAnnual ?? []), ...(c.RentMonthly ?? [])]))].sort();

const violations: string[] = [];
const divergences: string[] = [];
let cells = 0;
for (const cleanType of Object.keys(CLEAN_MACRO)) {
  for (const [legName, legQ] of Object.entries(LEGS)) {
    const q: any = { category: CLEAN_MACRO[cleanType], types: [cleanType], ...legQ };
    cells++;
    for (const id of ALL_IDS) {
      const allowed = afQuestionAllowed(q, id);
      if (!allowed) continue;
      // R2.1.1: whatever is offered MUST be in this exact cohort's certified list.
      const certified = (COHORT_QUESTIONS[cleanType] as any)?.[LEG_KEY[legName]] ?? [];
      if (!certified.includes(id)) violations.push(`${cleanType}/${legName} offers '${id}' — not in COHORT_QUESTIONS`);
      // The shared predicate is what BOTH surfaces call, so agreement is structural; assert that the
      // narrowing direction still holds (never wider than the raw cohort gate).
      if (!cohortAllows(q, id)) divergences.push(`${cleanType}/${legName} '${id}' allowed while cohortAllows() says no`);
    }
  }
}

check(`R2.1.1 holds on every live cell — nothing offered outside COHORT_QUESTIONS (${cells} cells × ${ALL_IDS.length} ids)`,
  violations.length === 0,
  violations.slice(0, 8).join('\n      '));

check('the shared gate is never WIDER than cohort certification',
  divergences.length === 0,
  divergences.slice(0, 8).join('\n      '));

// ── 4. the specific cells the incident was measured on ───────────────────────────────────────────
const roomBuy: any = { category: 'Residential', types: ['Room'], deal: 'Buy', rentPeriod: null };
check("Room/Buy no longer offers property_age (COHORT_QUESTIONS.Room has no Buy list)",
  afQuestionAllowed(roomBuy, 'property_age') === false);

const shopBuy: any = { category: 'Commercial', types: ['Shop'], deal: 'Buy', rentPeriod: null };
check('Shop/Buy: the AI chat can no longer apply an age filter the UI cannot offer',
  afQuestionAllowed(shopBuy, 'property_age') === false);

const aptBuy: any = { category: 'Residential', types: ['Apartment'], deal: 'Buy', rentPeriod: null };
check('a doubly-certified cohort still WORKS — Apartment/Buy keeps property_age',
  afQuestionAllowed(aptBuy, 'property_age') === true,
  'the fix must narrow only where evidence is missing, never disable a certified question');

console.log(failures
  ? `\n✗ verify-af-question-gate-is-one-predicate: ${failures} check(s) failed.\n`
  : '\n✅ verify-af-question-gate-is-one-predicate: one gate, both surfaces, R2.1.1 holds everywhere.\n');
process.exit(failures ? 1 : 0);
