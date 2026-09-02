// Automated, REAL tests for the Property Age (عمر العقار) advanced-filter eligibility gate.
//
// UNIFIED 2026-09-01 (owner bug-class fix): this used to test src/lib/ageFilterTypes.ts, a SECOND,
// hand-maintained type→macro map that duplicated COHORT_QUESTIONS (src/lib/afCohorts.ts) and drifted
// from it — Shop, Workshop, Commercial Building, Farm, and Rest House all earned real,
// chat-certified property_age data in COHORT_QUESTIONS but were never added to the second map, so
// the manual Advanced Filter card could never offer the question for them. The fix deleted that
// file outright: AGE_QUESTION's eligibility (src/data/advancedFilters.ts) is now
// `cohortAllows(q, 'property_age')` — the exact same canonical gate every other Advanced Filter
// question already uses. A silent desync here is invisible in the UI: the question simply stops
// appearing (or, worse, appears on a scope whose data can't honestly answer it).
//
// THE LOAD-BEARING TEST is the drift tripwire at the bottom: it fails the build if a second
// hardcoded type list for this question's eligibility is ever reintroduced (e.g. src/lib/
// ageFilterTypes.ts coming back, or AGE_QUESTION's eligibility stopping being a direct call to
// cohortAllows). Everything above it exercises the real gate through cohortAllows(), executed
// against COHORT_QUESTIONS — not grepped — so it fails on a real behavioral regression too.
//
//   node --experimental-strip-types scripts/verify-age-filter-gate.ts   (wired into `npm test`)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cohortAllows, COHORT_QUESTIONS } from '../src/lib/afCohorts.ts';
import { CLEAN_MACRO } from '../src/data/propertyTypes.ts';
import type { SearchQuery } from '../src/data/search.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const Q = (over: Record<string, unknown>) =>
  ({ deal: 'Buy', location: '', category: 'Residential', type: null, detail: null,
     priceInput: '', priceBand: null, rentPeriod: 'annual', ...over }) as unknown as SearchQuery;
const age = (q: SearchQuery) => cohortAllows(q, 'property_age');

// ── every type that COHORT_QUESTIONS certifies for property_age must actually fire, under its own
// macro and its own certified deal(s) — executed, not assumed ──────────────────────────────────────
console.log('── every type COHORT_QUESTIONS certifies for property_age fires, under its own macro ──');
for (const [type, cfg] of Object.entries(COHORT_QUESTIONS)) {
  const macro = CLEAN_MACRO[type] ?? 'Residential';
  for (const deal of ['Buy', 'RentAnnual'] as const) {
    const list = cfg[deal] ?? [];
    const certified = list.includes('property_age');
    const extra = deal === 'Buy' ? { deal: 'Buy' } : { deal: 'Rent', rentPeriod: 'annual' };
    const fires = age(Q({ types: [type], category: macro, ...extra }));
    check(`${type}/${deal}: property_age ${certified ? 'IS' : 'is NOT'} certified ⇒ gate ${certified ? 'fires' : 'stays closed'}`,
      fires === certified);
  }
}

// ── the 5 types this bug named by name (the owner's own reproduction set) ────────────────────────
console.log('\n── the 5 types this bug named: real COHORT_QUESTIONS data, unreachable before the fix ──');
const NAMED_FIVE: Array<{ type: string; buy: boolean; rentAnnual: boolean }> = [
  { type: 'Shop', buy: true, rentAnnual: true },
  { type: 'Workshop', buy: true, rentAnnual: true },
  { type: 'Commercial Building', buy: true, rentAnnual: true },
  { type: 'Farm', buy: true, rentAnnual: false },
  { type: 'Rest House', buy: true, rentAnnual: true },
];
for (const { type, buy, rentAnnual } of NAMED_FIVE) {
  const macro = CLEAN_MACRO[type] ?? 'Residential';
  check(`${type}/Buy fires: ${buy}`, age(Q({ types: [type], category: macro, deal: 'Buy' })) === buy);
  check(`${type}/Rent-Annual fires: ${rentAnnual}`,
    age(Q({ types: [type], category: macro, deal: 'Rent', rentPeriod: 'annual' })) === rentAnnual);
}

// ── wrong-macro guards — a cross-category scope must match nothing, never fall through ─────────────
console.log('\n── wrong-macro / uncertified / malformed scopes never fire ──');
check('Villa does NOT fire under Commercial', !age(Q({ types: ['Villa'], category: 'Commercial' })));
check('Office does NOT fire under Residential', !age(Q({ types: ['Office'], category: 'Residential' })));
check('Warehouse does NOT fire under Residential (kinds:BOTH — macro match is the only thing stopping it)',
  !age(Q({ types: ['Warehouse'], category: 'Residential' })));
for (const t of ['Land', 'Chalet', 'Duplex'])
  check(`${t} (not certified for property_age) never fires`,
    !age(Q({ types: [t], category: 'Residential', deal: 'Buy' }))
    && !age(Q({ types: [t], category: 'Residential', deal: 'Rent', rentPeriod: 'annual' })));
check('an empty type scope never fires', !age(Q({ types: [], category: 'Residential' })));
check('a missing category never fires', !age(Q({ types: ['Apartment'], category: undefined })));
check('an unknown type never fires', !age(Q({ types: ['NotAType'], category: 'Residential' })));

// ── multi-type / group scope: INTERSECTION, never union (owner rule, same as every other question) ─
console.log('\n── multi-type scope: intersection, never union — the same rule cohortAllows enforces everywhere ──');
check('Apartment+Villa (both certify Buy) fires on Buy',
  age(Q({ types: ['Apartment', 'Villa'], category: 'Residential', deal: 'Buy' })));
check('Apartment+Duplex (Duplex has no property_age) does NOT fire — one uncertified type empties the set',
  !age(Q({ types: ['Apartment', 'Duplex'], category: 'Residential', deal: 'Buy' })));

// ── period / combined-deal gate — property_age has never been profiled against Monthly for ANY type,
// so RentMonthly never lists it; cohortAllows' existing monthly/both/dealCombined branches already
// enforce that structurally. Executed here so a change to those branches cannot silently reopen it. ──
console.log('\n── period + combined-deal gate (property_age is never certified for Monthly) ──');
check('Apartment does NOT fire on a Monthly-only Rent scope',
  !age(Q({ types: ['Apartment'], category: 'Residential', deal: 'Rent', rentPeriod: 'monthly' })));
check('Apartment does NOT fire on a combined (both) Rent scope',
  !age(Q({ types: ['Apartment'], category: 'Residential', deal: 'Rent', rentPeriod: 'both' })));
check('Apartment does NOT fire on Buy+Rent combined mode',
  !age(Q({ types: ['Apartment'], category: 'Residential', deal: 'Rent', dealCombined: true })));
check('Apartment STILL fires on a plain Annual Rent scope',
  age(Q({ types: ['Apartment'], category: 'Residential', deal: 'Rent', rentPeriod: 'annual' })));
check('Apartment STILL fires on Buy regardless of rentPeriod (irrelevant field)',
  age(Q({ types: ['Apartment'], category: 'Residential', deal: 'Buy', rentPeriod: 'monthly' })));

// ── THE DRIFT TRIPWIRE (item 8b): a second hardcoded type list for this question must never come back
console.log('\n── drift tripwire: no second hardcoded eligibility map for property_age ──');
const root = join(import.meta.dirname, '..');
check('src/lib/ageFilterTypes.ts is gone (the old second map)',
  !existsSync(join(root, 'src/lib/ageFilterTypes.ts')));
const advSrc = readFileSync(join(root, 'src/data/advancedFilters.ts'), 'utf8');
// Comments are stripped before the absence check: this file's OWN header comment names the deleted
// module for history, and prose can never satisfy (or fail) a code-shape assertion.
const advCode = advSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check("AGE_QUESTION's eligibility is a DIRECT call to cohortAllows(q, 'property_age') — no wrapper fn",
  /id:\s*'property_age'[\s\S]{0,1200}eligibility:\s*\(q\)\s*=>\s*cohortAllows\(q,\s*'property_age'\)/.test(advCode));
check('advancedFilters.ts no longer IMPORTS OR CALLS an age-specific eligibility function',
  !/ageFilterTypes|isAgeFilterScope/.test(advCode));

console.log(failed === 0 ? '\n✓ all age-filter-gate assertions passed' : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
