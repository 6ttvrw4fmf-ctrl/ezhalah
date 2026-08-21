// MIXED-PERIOD ADVANCED FILTER GATING (owner brief §3, 2026-08-19) — a combined سنوي+شهري search may
// only offer an Advanced Filter question that is independently certified valid for BOTH Annual AND
// Monthly Rent for that clean type (INTERSECTION, never union — see the design comment above
// cohortAllows() in src/data/advancedFilters.ts for the full reasoning).
//
// THE BUG THIS GUARDS AGAINST: cohortAllows() used to route rentPeriod==='both' through the SAME
// branch as plain Annual Rent (`q.deal === 'Rent' ? 'RentAnnual' : ...`) — a combined search would
// silently offer Annual-only-certified questions (rnpl, property_age, furnished: all ~unknown on
// Monthly inventory) and could NEVER offer Monthly-only questions (rating, unit_subtype). Answering
// an Annual-tuned question in that state would silently amputate nearly all Monthly rows from the
// result while the search still claimed to cover both periods — the mirror image of the owner's
// named Gathern-rating risk (Monthly-leaking-into-Annual), just in the Annual-into-Monthly direction.
//
// UPGRADED TO EXECUTED ASSERTIONS (2026-08-20): cohortAllows moved to src/lib/afCohorts.ts, a PURE
// module with no runtime imports beyond other pure modules, specifically so barriers can CALL it
// instead of regexing it. The period-intersection checks below now run the real function against
// real queries — a regex could be satisfied by a branch that never executes. The few remaining
// source-text checks (the old aliasing ternary, the separate age gate) assert the ABSENCE of a
// shape, which execution cannot prove; comments are stripped so prose can never satisfy them.
//
//   node --experimental-strip-types scripts/verify-mixed-period-af-gating.ts   (wired into `npm test`)

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

console.log('\nMixed-period (كلاهما) Advanced Filter gating — intersection-only, never union\n');

const af = codeOnly(read('src/lib/afCohorts.ts'));
const ageGate = codeOnly(read('src/lib/ageFilterTypes.ts'));

// The REAL gate + the REAL certified config.
const Q = (over: Record<string, unknown>) =>
  ({ deal: 'Rent', location: '', category: 'Residential', type: null, detail: null,
     priceInput: '', priceBand: null, rentPeriod: 'annual', ...over }) as unknown as SearchQuery;

// ── cohortAllows: the 'both' branch must be an INTERSECTION of both period lists ────────────────────
const bothBranch = /if\s*\(q\.rentPeriod\s*===\s*'both'\)\s*return\s*\(cfg\.RentAnnual\s*\?\?\s*\[\]\)\.includes\(id\)\s*&&\s*\(cfg\.RentMonthly\s*\?\?\s*\[\]\)\.includes\(id\)/;
check("EXECUTED — 'both' refuses an Annual-only question (rnpl) and a Monthly-only one (rating)",
  cohortAllows(Q({ rentPeriod: 'both', types: ['Apartment'] }), 'rnpl') === false
  && cohortAllows(Q({ rentPeriod: 'both', types: ['Apartment'] }), 'rating') === false,
  'a mixed search must never accept a question valid for only one period');
check('EXECUTED — non-vacuous: a question certified for BOTH periods IS still offered on both-mode',
  cohortAllows(Q({ rentPeriod: 'both', types: ['Apartment'] }), 'amenities') === true
  && cohortAllows(Q({ rentPeriod: 'both', types: ['Apartment'] }), 'bathrooms') === true,
  'kills the always-false mutant — intersection must keep the shared surface');
check("cohortAllows has an explicit 'both' branch requiring membership in BOTH RentAnnual and RentMonthly",
  bothBranch.test(af),
  'a mixed search must never accept a question valid for only one period');

// The 'both' branch must be checked BEFORE the function falls back to the plain-Annual return —
// otherwise 'both' would silently reach the Annual-only fallback first (the exact old bug).
const bothIdx = af.search(bothBranch);
const fallbackIdx = af.search(/return\s*\(cfg\.RentAnnual\s*\?\?\s*\[\]\)\.includes\(id\);\s*\/\/\s*plain Annual Rent/);
check("the 'both' intersection check runs BEFORE the plain-Annual fallback (order matters)",
  bothIdx !== -1 && fallbackIdx !== -1 && bothIdx < fallbackIdx);

// The exact pre-fix bug shape must be gone: 'both' must not be handled by the same ternary arm as
// plain Rent (that ternary chain, if still present verbatim, means 'both' silently aliases to Annual).
check("the OLD ternary that aliased 'both' to RentAnnual is gone",
  !/q\.deal === 'Rent' && q\.rentPeriod === 'monthly' \? 'RentMonthly'\s*:\s*q\.deal === 'Rent' \? 'RentAnnual'/.test(af),
  "this exact shape silently treats 'both' as annual-only — the bug this test locks out");

check('EXECUTED — Buy routes independently of rentPeriod',
  cohortAllows(Q({ deal: 'Buy', rentPeriod: 'both', types: ['Apartment'] }), 'bathrooms') === true);
check('EXECUTED — plain Monthly uses RentMonthly ALONE (rating allowed), not the intersection',
  cohortAllows(Q({ rentPeriod: 'monthly', types: ['Apartment'] }), 'rating') === true
  && cohortAllows(Q({ rentPeriod: 'monthly', types: ['Apartment'] }), 'rnpl') === false);
check('EXECUTED — plain Annual uses RentAnnual ALONE (rnpl allowed)',
  cohortAllows(Q({ rentPeriod: 'annual', types: ['Apartment'] }), 'rnpl') === true);

// ── Data check: the certified Monthly cohorts really do have a NON-EMPTY but SMALLER intersection ──
// (proves the fix has real, non-vacuous effect for the 3 certified Monthly types, not just Buy/annual)
const apt = COHORT_QUESTIONS.Apartment ?? {};
check('Apartment RentMonthly config includes rating (Monthly-only signal, unchanged by this fix)',
  (apt.RentMonthly ?? []).includes('rating'));
check('Apartment RentAnnual config includes rnpl (Annual-only signal, unchanged by this fix)',
  (apt.RentAnnual ?? []).includes('rnpl'));
check('Apartment RentAnnual and RentMonthly share amenities+bathrooms (the actual both-mode surface)',
  ['amenities', 'bathrooms'].every((id) => (apt.RentAnnual ?? []).includes(id) && (apt.RentMonthly ?? []).includes(id)));

// ── property_age (AGE_QUESTION) bypasses cohortAllows entirely via its own gate — must be fixed too ─
check("AGE_QUESTION's eligibility gate (isAgeFilterScope) excludes Monthly AND both, not just Monthly",
  /q\.deal === 'Rent' && \(q\.rentPeriod === 'monthly' \|\| q\.rentPeriod === 'both'\)\) return false/.test(ageGate),
  'this gate is SEPARATE from cohortAllows (property_age has its own eligibility fn) — fixing cohortAllows alone would have left this leak open');

console.log(failures === 0
  ? '\n✓ mixed-period AF gating intact: intersection-only, no period-specific leak in either direction\n'
  : `\n✗ ${failures} check(s) FAILED — mixed-period AF gating is broken\n`);
process.exit(failures === 0 ? 0 : 1);
