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
// WHY SOURCE-TEXT ASSERTIONS, NOT A LIVE IMPORT: src/data/advancedFilters.ts's own relative imports
// (`from './search'`, no extension) are unresolvable by Node's raw --experimental-strip-types loader
// (it does not do TS-style extension inference the way a bundler does) — the same reason every other
// non-zero-dependency module in this repo (verify-rent-period-both.ts, verify-advanced-filter-
// contract.ts, etc.) asserts against the SHIPPED SOURCE rather than importing it live. Comments are
// stripped first so prose describing the bug can never satisfy a check for the fix, or vice versa.
//
//   node --experimental-strip-types scripts/verify-mixed-period-af-gating.ts   (wired into `npm test`)

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

console.log('\nMixed-period (كلاهما) Advanced Filter gating — intersection-only, never union\n');

const af = codeOnly(read('src/data/advancedFilters.ts'));
const ageGate = codeOnly(read('src/lib/ageFilterTypes.ts'));

// ── cohortAllows: the 'both' branch must be an INTERSECTION of both period lists ────────────────────
const bothBranch = /if\s*\(q\.rentPeriod\s*===\s*'both'\)\s*return\s*\(cfg\.RentAnnual\s*\?\?\s*\[\]\)\.includes\(id\)\s*&&\s*\(cfg\.RentMonthly\s*\?\?\s*\[\]\)\.includes\(id\)/;
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

check("cohortAllows still routes Buy independently of rentPeriod",
  /if\s*\(q\.deal\s*===\s*'Buy'\)\s*return\s*\(cfg\.Buy\s*\?\?\s*\[\]\)\.includes\(id\)/.test(af));
check("cohortAllows still routes plain Monthly to RentMonthly alone (not the intersection)",
  /if\s*\(q\.rentPeriod\s*===\s*'monthly'\)\s*return\s*\(cfg\.RentMonthly\s*\?\?\s*\[\]\)\.includes\(id\)/.test(af));

// ── Data check: the certified Monthly cohorts really do have a NON-EMPTY but SMALLER intersection ──
// (proves the fix has real, non-vacuous effect for the 3 certified Monthly types, not just Buy/annual)
check('Apartment RentMonthly config includes rating (Monthly-only signal, unchanged by this fix)',
  /Apartment:\s*\{[\s\S]{0,400}?RentMonthly:\s*\[[^\]]*'rating'/.test(af));
check('Apartment RentAnnual config includes rnpl (Annual-only signal, unchanged by this fix)',
  /Apartment:\s*\{\s*RentAnnual:\s*\[[^\]]*'rnpl'/.test(af));
check('Apartment RentAnnual and RentMonthly share amenities+bathrooms (the actual both-mode surface)',
  /Apartment:\s*\{[\s\S]{0,400}?RentAnnual:\s*\[[^\]]*'amenities'[^\]]*'bathrooms'/.test(af)
  && /Apartment:\s*\{[\s\S]{0,400}?RentMonthly:\s*\[[^\]]*'amenities'[^\]]*'bathrooms'/.test(af));

// ── property_age (AGE_QUESTION) bypasses cohortAllows entirely via its own gate — must be fixed too ─
check("AGE_QUESTION's eligibility gate (isAgeFilterScope) excludes Monthly AND both, not just Monthly",
  /q\.deal === 'Rent' && \(q\.rentPeriod === 'monthly' \|\| q\.rentPeriod === 'both'\)\) return false/.test(ageGate),
  'this gate is SEPARATE from cohortAllows (property_age has its own eligibility fn) — fixing cohortAllows alone would have left this leak open');

console.log(failures === 0
  ? '\n✓ mixed-period AF gating intact: intersection-only, no period-specific leak in either direction\n'
  : `\n✗ ${failures} check(s) FAILED — mixed-period AF gating is broken\n`);
process.exit(failures === 0 ? 0 : 1);
