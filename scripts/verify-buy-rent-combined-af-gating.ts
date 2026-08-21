// BUY+RENT COMBINED ADVANCED FILTER GATING (owner feature, 2026-08-20) — a combined شراء+إيجار
// search may only offer an Advanced Filter question that is independently certified valid for
// Buy AND Annual Rent AND Monthly Rent for that clean type (INTERSECTION across all three legs,
// never a union — the exact same principle rentPeriod==='both' already established one dimension
// earlier; see the design comment above cohortAllowsCombined() in src/data/advancedFilters.ts).
//
// THE RISK THIS GUARDS AGAINST: without a dedicated combined-mode branch, cohortAllows() would
// route q.dealCombined through whichever single-deal branch q.deal (the last concrete button
// pressed) happens to still hold — silently offering a Buy-only question (dropping every Rent row
// the moment it's answered) or a Rent-only question like rnpl/rating (dropping every Buy row), or
// a Monthly-only signal (dropping every Annual row) — while the search still claims to cover
// Buy ∪ Annual Rent ∪ Monthly Rent. property_age has its OWN separate eligibility gate
// (isAgeFilterScope, never profiled against Monthly for any type) that must be fixed independently.
//
// WHY SOURCE-TEXT ASSERTIONS, NOT A LIVE IMPORT: same reason as verify-mixed-period-af-gating.ts —
// advancedFilters.ts's relative imports (`from './search'`) are unresolvable by Node's raw
// --experimental-strip-types loader. Comments are stripped first so prose describing the risk can
// never satisfy a check for the fix, or vice versa.
//
//   node --experimental-strip-types scripts/verify-buy-rent-combined-af-gating.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nBuy+Rent combined (شراء+إيجار) Advanced Filter gating — 3-way intersection, never union\n');

const af = codeOnly(read('src/data/advancedFilters.ts'));
const ageGate = codeOnly(read('src/lib/ageFilterTypes.ts'));

// ── cohortAllowsCombined: a 3-way intersection (Buy ∩ RentAnnual ∩ RentMonthly) ─────────────────────
const combinedFn = /function cohortAllowsCombined\([^)]*\)[^{]*\{\s*return\s*\(cfg\.Buy\s*\?\?\s*\[\]\)\.includes\(id\)\s*&&\s*\(cfg\.RentAnnual\s*\?\?\s*\[\]\)\.includes\(id\)\s*&&\s*\(cfg\.RentMonthly\s*\?\?\s*\[\]\)\.includes\(id\)/;
check('cohortAllowsCombined requires membership in Buy AND RentAnnual AND RentMonthly (all three legs)',
  combinedFn.test(af),
  'a combined search must never accept a question valid for only one or two of the three legs');

// ── cohortAllows: dealCombined must be checked and routed to cohortAllowsCombined BEFORE the
// single-deal Buy/Rent branches — otherwise it falls through to whichever q.deal happens to hold.
const dealCombinedBranch = /if\s*\(q\.dealCombined\)\s*return\s*cohortAllowsCombined\(cfg,\s*id\)/;
check('cohortAllows routes q.dealCombined to cohortAllowsCombined',
  dealCombinedBranch.test(af));
const combinedIdx = af.search(dealCombinedBranch);
const buyBranchIdx = af.search(/if\s*\(q\.deal\s*===\s*'Buy'\)\s*return\s*\(cfg\.Buy\s*\?\?\s*\[\]\)\.includes\(id\)/);
check('the dealCombined check runs BEFORE the single-deal Buy branch (order matters — combined must never fall through to Buy-only)',
  combinedIdx !== -1 && buyBranchIdx !== -1 && combinedIdx < buyBranchIdx);

// ── Data check: rnpl (Rent-only, never in ANY cohort's Buy list) must be excluded in combined mode ──
check('rnpl never appears in a Buy list anywhere in COHORT_QUESTIONS (so combined mode always excludes it, correctly)',
  !/Buy:\s*\[[^\]]*'rnpl'/.test(af));

// ── Data check: Monthly-only signals (rating, unit_subtype) must be excluded — never in Buy/RentAnnual ──
check('rating never appears in a Buy or RentAnnual list (Monthly-only signal, correctly excluded from combined mode)',
  !/Buy:\s*\[[^\]]*'rating'/.test(af) && !/RentAnnual:\s*\[[^\]]*'rating'/.test(af));
check('unit_subtype never appears in a Buy or RentAnnual list (Monthly-only signal, correctly excluded from combined mode)',
  !/Buy:\s*\[[^\]]*'unit_subtype'/.test(af) && !/RentAnnual:\s*\[[^\]]*'unit_subtype'/.test(af));

// ── Data check: the 3-way intersection has real, NON-VACUOUS effect for a certified cohort ──────────
// Apartment: Buy=[property_age,amenities,bathrooms,direction], RentAnnual=[rnpl,property_age,
// amenities,bathrooms,furnished], RentMonthly=[rating,unit_subtype,amenities,bathrooms] →
// intersection = {amenities, bathrooms} exactly — proves combined mode genuinely offers something
// (not an empty set everywhere) while still correctly excluding property_age/rnpl/furnished/
// direction/rating/unit_subtype for this exact cohort.
check('Apartment 3-way intersection is non-empty (amenities + bathrooms genuinely shared across Buy/RentAnnual/RentMonthly)',
  /Apartment:\s*\{[\s\S]{0,400}?Buy:\s*\[[^\]]*'amenities'[^\]]*'bathrooms'/.test(af)
  && /Apartment:\s*\{[\s\S]{0,50}?RentAnnual:\s*\[[^\]]*'amenities'[^\]]*'bathrooms'/.test(af)
  && /Apartment:\s*\{[\s\S]{0,600}?RentMonthly:\s*\[[^\]]*'amenities'[^\]]*'bathrooms'/.test(af));

// ── Data check: a type with NO Buy cohort at all (Room, n=1) must offer ZERO combined questions ─────
// (cfg.Buy is undefined → `?? []` → empty → intersection is empty regardless of the Rent lists —
// mechanically correct: you cannot meaningfully combine Buy+Rent for a type where Buy barely exists.)
check('Room has no Buy entry in COHORT_QUESTIONS (so combined mode mechanically offers it zero questions)',
  /Room:\s*\{\s*RentAnnual:/.test(af) && !/Room:\s*\{[\s\S]{0,200}?Buy:/.test(af));

// ── property_age (AGE_QUESTION) bypasses cohortAllows entirely via its own gate — must be fixed too ─
check("AGE_QUESTION's eligibility gate (isAgeFilterScope) also excludes dealCombined, unconditionally",
  /if\s*\(q\.dealCombined\)\s*return\s*false;/.test(ageGate),
  'this gate is SEPARATE from cohortAllows (property_age has its own eligibility fn) — fixing cohortAllows alone would have left this leak open, exactly like the mixed-period fix needed the same second fix');
check('isAgeFilterScope\'s dealCombined check runs BEFORE the single-type/category checks (fails closed, not open)',
  /if\s*\(effectiveTypes\.length\s*!==\s*1\)\s*return\s*false;\s*if\s*\(q\.dealCombined\)\s*return\s*false;/.test(ageGate));

console.log(failures === 0
  ? '\n✓ Buy+Rent combined AF gating intact: 3-way intersection, no Buy-only/Rent-only/Monthly-only leak\n'
  : `\n✗ ${failures} check(s) FAILED — Buy+Rent combined AF gating is broken\n`);
process.exit(failures === 0 ? 0 : 1);
