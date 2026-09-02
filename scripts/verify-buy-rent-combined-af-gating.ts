// BUY+RENT COMBINED ADVANCED FILTER GATING (owner feature, 2026-08-20) — a combined شراء+إيجار
// search may only offer an Advanced Filter question that is independently certified valid for
// Buy AND Annual Rent AND Monthly Rent for that clean type (INTERSECTION across all three legs,
// never a union — the exact same principle rentPeriod==='both' already established one dimension
// earlier, and the SAME dimension multi-type intersection established a second time — see the
// design comment above cohortAllowsCombined() in src/lib/afCohorts.ts).
//
// THE RISK THIS GUARDS AGAINST: without a dedicated combined-mode branch, cohortAllows() would
// route q.dealCombined through whichever single-deal branch q.deal (the last concrete button
// pressed) happens to still hold — silently offering a Buy-only question (dropping every Rent row
// the moment it's answered) or a Rent-only question like rnpl/rating (dropping every Buy row), or
// a Monthly-only signal (dropping every Annual row) — while the search still claims to cover
// Buy ∪ Annual Rent ∪ Monthly Rent. property_age (2026-09-01: unified onto cohortAllows, see below)
// inherits this same 3-way intersection automatically now that it has no separate gate of its own.
//
// EXECUTED ASSERTIONS (mirrors verify-mixed-period-af-gating.ts's 2026-08-20 upgrade): cohortAllows
// lives in src/lib/afCohorts.ts, a PURE module with no runtime imports beyond other pure modules,
// specifically so barriers can CALL it instead of regexing it — a regex could be satisfied by a
// branch that never executes. The few remaining source-text checks assert the ABSENCE of a shape
// (which execution cannot prove) or a data-file fact; comments are stripped so prose can never
// satisfy them.
//
//   node --experimental-strip-types scripts/verify-buy-rent-combined-af-gating.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SearchQuery } from '../src/data/search.ts';
import { cohortAllows, COHORT_QUESTIONS } from '../src/lib/afCohorts.ts';

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

const af = codeOnly(read('src/lib/afCohorts.ts'));

// The REAL gate + the REAL certified config.
const Q = (over: Record<string, unknown>) =>
  ({ deal: 'Buy', location: '', category: 'Residential', type: null, detail: null,
     priceInput: '', priceBand: null, rentPeriod: 'annual', ...over }) as unknown as SearchQuery;

// ── cohortAllowsCombined: EXECUTED — a 3-way intersection (Buy ∩ RentAnnual ∩ RentMonthly) ──────────
check('EXECUTED — combined mode refuses a Buy-only question (direction, Apartment) and a Rent-only one (rnpl)',
  cohortAllows(Q({ dealCombined: true, types: ['Apartment'] }), 'direction') === false
  && cohortAllows(Q({ dealCombined: true, types: ['Apartment'] }), 'rnpl') === false,
  'a combined search must never accept a question valid for only one or two of the three legs');
check('EXECUTED — combined mode refuses Monthly-only signals (rating, unit_subtype, Apartment)',
  cohortAllows(Q({ dealCombined: true, types: ['Apartment'] }), 'rating') === false
  && cohortAllows(Q({ dealCombined: true, types: ['Apartment'] }), 'unit_subtype') === false);
check('EXECUTED — non-vacuous: a question certified for ALL THREE legs IS still offered in combined mode',
  cohortAllows(Q({ dealCombined: true, types: ['Apartment'] }), 'amenities') === true
  && cohortAllows(Q({ dealCombined: true, types: ['Apartment'] }), 'bathrooms') === true,
  'kills the always-false mutant — intersection must keep the genuinely shared surface');
const combinedFn = /function cohortAllowsCombined\([^)]*\)[^{]*\{\s*return\s*\(cfg\.Buy\s*\?\?\s*\[\]\)\.includes\(id\)\s*&&\s*\(cfg\.RentAnnual\s*\?\?\s*\[\]\)\.includes\(id\)\s*&&\s*\(cfg\.RentMonthly\s*\?\?\s*\[\]\)\.includes\(id\)/;
check('cohortAllowsCombined requires membership in Buy AND RentAnnual AND RentMonthly (all three legs)',
  combinedFn.test(af));

// ── cohortAllows: dealCombined must be checked and routed to cohortAllowsCombined BEFORE the
// single-deal Buy/Rent branches — otherwise it falls through to whichever q.deal happens to hold.
// WIDENED 2026-09-02: the branch condition now also admits q.bothDeals. That is not a loosening —
// remote.ts sends `p_deal: (q.bothDeals || q.dealCombined) ? null : …`, so the SEARCH already treats
// the two identically as Buy ∪ Rent(any period); gating on dealCombined alone let the AI-chat
// fallback certify against a single leg while searching both, the exact fall-through this check's
// own comment above warns about. The regex still REQUIRES q.dealCombined in the condition and still
// pins the ordering, so neither can regress.
const dealCombinedBranch = /if\s*\(q\.dealCombined(?:\s*\|\|\s*q\.bothDeals)?\)\s*return\s*cohortAllowsCombined\(cfg,\s*id\)/;
check('cohortAllows routes q.dealCombined to cohortAllowsCombined',
  dealCombinedBranch.test(af));
check('…and q.bothDeals routes there too — the search sends p_deal null for both',
  /if\s*\(q\.dealCombined\s*\|\|\s*q\.bothDeals\)\s*return\s*cohortAllowsCombined/.test(af),
  'bothDeals is a Buy∪Rent scope at the request boundary; certifying it against one leg amputates the other');
const combinedIdx = af.search(dealCombinedBranch);
const buyBranchIdx = af.search(/if\s*\(q\.deal\s*===\s*'Buy'\)\s*return\s*\(cfg\.Buy\s*\?\?\s*\[\]\)\.includes\(id\)/);
check('the dealCombined check runs BEFORE the single-deal Buy branch (order matters — combined must never fall through to Buy-only)',
  combinedIdx !== -1 && buyBranchIdx !== -1 && combinedIdx < buyBranchIdx);
check('EXECUTED — a real q.deal value does NOT override dealCombined (regression: falling through to Buy-only)',
  cohortAllows(Q({ deal: 'Buy', dealCombined: true, types: ['Apartment'] }), 'direction') === false);

// ── EXECUTED — combined mode intersects with the MULTI-TYPE dimension too (owner 2026-08-20, #841):
// two types must each independently clear the 3-way deal intersection.
check('EXECUTED — combined + 2 types (Apartment, Villa): only the surface shared by ALL SIX lists survives',
  cohortAllows(Q({ dealCombined: true, types: ['Apartment', 'Villa'] }), 'amenities') === true
  && cohortAllows(Q({ dealCombined: true, types: ['Apartment', 'Villa'] }), 'bathrooms') === true
  && cohortAllows(Q({ dealCombined: true, types: ['Apartment', 'Villa'] }), 'direction') === false);

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
// intersection = {amenities, bathrooms} exactly.
const apt = COHORT_QUESTIONS.Apartment ?? {};
check('Apartment 3-way intersection is non-empty (amenities + bathrooms genuinely shared across Buy/RentAnnual/RentMonthly)',
  ['amenities', 'bathrooms'].every((id) =>
    (apt.Buy ?? []).includes(id) && (apt.RentAnnual ?? []).includes(id) && (apt.RentMonthly ?? []).includes(id)));

// ── Data check: a type with NO Buy cohort at all (Room, n=1) must offer ZERO combined questions ─────
// (cfg.Buy is undefined → `?? []` → empty → intersection is empty regardless of the Rent lists —
// mechanically correct: you cannot meaningfully combine Buy+Rent for a type where Buy barely exists.)
const room = COHORT_QUESTIONS.Room;
check('Room has no Buy entry in COHORT_QUESTIONS (so combined mode mechanically offers it zero questions)',
  room !== undefined && room.Buy === undefined && (room.RentAnnual ?? []).length > 0);
check('EXECUTED — combined mode on Room offers nothing, even for a question in its RentAnnual list',
  cohortAllows(Q({ dealCombined: true, types: ['Room'] }), 'amenities') === false);

// ── property_age (AGE_QUESTION) UNIFIED 2026-09-01: it used to bypass cohortAllows entirely via its
// own gate (src/lib/ageFilterTypes.ts, deleted). Now AGE_QUESTION's eligibility IS
// cohortAllows(q, 'property_age') directly (src/data/advancedFilters.ts), so it inherits
// cohortAllowsCombined()'s 3-way intersection automatically — proved here EXECUTED, not by reading
// a second file's source, because there is no longer a second file to read.
check('EXECUTED — property_age also excludes dealCombined (never certified for RentMonthly, so the 3-way intersection is empty)',
  cohortAllows(Q({ dealCombined: true, types: ['Apartment'] }), 'property_age') === false
  && cohortAllows(Q({ dealCombined: true, types: ['Shop'], category: 'Commercial' }), 'property_age') === false);
check('EXECUTED — property_age still fires on plain Buy and plain Annual Rent once dealCombined is false',
  cohortAllows(Q({ deal: 'Buy', dealCombined: false, types: ['Apartment'] }), 'property_age') === true
  && cohortAllows(Q({ deal: 'Rent', rentPeriod: 'annual', dealCombined: false, types: ['Apartment'] }), 'property_age') === true);

console.log(failures === 0
  ? '\n✓ Buy+Rent combined AF gating intact: 3-way intersection, no Buy-only/Rent-only/Monthly-only leak\n'
  : `\n✗ ${failures} check(s) FAILED — Buy+Rent combined AF gating is broken\n`);
process.exit(failures === 0 ? 0 : 1);
