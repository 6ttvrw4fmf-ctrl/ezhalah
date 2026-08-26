// RENT PERIOD "BOTH" — a user may ask for monthly AND annual in one search (owner feature 2026-08-14).
//
// The feature is only correct if FOUR things hold together. Each has a way of silently breaking:
//
//  1. 'both' is the UNION OF TWO KNOWN PERIODS, never "no period filter". `p_rent_period IS NULL` already
//     meant "don't filter", and that also sweeps in the rent rows whose SOURCE PUBLISHED NO PERIOD (510
//     live on 2026-08-14). Those are neither monthly nor annual; claiming them would be a derived answer.
//     So the client must send a distinct token ('كلاهما'), never null, and the RPC branch must be exactly
//     monthly-predicate OR annual-predicate.
//  2. The two MONTHLY-ONLY platforms (Gathern, Aqar Monthly) must be in scope. They are the only sources
//     that are wholly monthly, and `resTables` used to add them for `rentPeriod === 'monthly'` ALONE — so
//     a both-search would have quietly returned an annual-dominated pool while claiming to cover both.
//  3. A typed price must be read on ONE basis. Monthly scales the budget ×12 to compare price_annual;
//     annual doesn't. 'both' spans the two, so it takes the ANNUAL basis (the canonical stored unit) —
//     and must NOT fall through to the agent's ×12 magnitude heuristic, which would halve the ceiling.
//  4. Results must actually MIX. Annual outnumbers monthly ~43k:32k fleet-wide, so an un-mixed list can
//     open all-annual and the feature reads as broken. MATCH FIRST, DIVERSIFY SECOND: the period key only
//     re-orders rows the filter already matched, and stays nested INSIDE platform (owner's permanent
//     platform-outermost rule, 2026-07-13).
//
//   node --experimental-strip-types scripts/verify-rent-period-both.ts     (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
// Strip comments so prose describing a rule can never satisfy the check for it.
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nRent period «both» — union-of-known-periods, monthly sources in scope, one price basis, real mix\n');

const search = codeOnly(read('src/data/search.ts'));
const remote = codeOnly(read('src/data/remote.ts'));
const diversity = codeOnly(read('src/lib/platformDiversity.ts'));
const index = codeOnly(read('src/app/index.tsx'));
const i18n = read('src/i18n.tsx');   // dictionary keys live in a plain object; comments are irrelevant

// ── 1. the type admits 'both', and the client sends a DISTINCT token (never null) ────────────────
check("SearchQuery.rentPeriod admits 'both'",
  /rentPeriod\?:\s*'monthly'\s*\|\s*'annual'\s*\|\s*'both'/.test(search));

check("rentPeriodParam maps 'both' → 'كلاهما' (a real token, NOT null)",
  /q\.rentPeriod\s*===\s*'both'\s*\)?\s*return\s*'كلاهما'/.test(remote),
  "returning null here would silently include rows whose source published no period at all");

// The migration must carry the union branch. Search every migration: at least one must define it, and it
// must be the union of BOTH predicates (payment_monthly for monthly, rent_period_ar/RNPL for annual).
const migrations = readFileSync(join(root, 'supabase/migrations/20260815012506_rent_period_both_monthly_and_annual.sql'), 'utf8');
check('migration defines the كلاهما branch as monthly-OR-annual (a true union)',
  /p_rent_period\s*=\s*''كلاهما''\s*and\s*\(\s*s\.payment_monthly\s*=\s*true\s*or\s*s\.rent_period_ar\s*=\s*''سنوي''/.test(migrations),
  'the both-branch must reuse BOTH existing predicates verbatim, not invent a third rule');

check('migration excludes كلاهما from the passthrough branch (no double-match)',
  /not\s+in\s*\(''شهري'',''سنوي'',''كلاهما''\)/.test(migrations));

check('migration needle-edits from the LIVE body and aborts rather than rewriting blind',
  /pg_get_functiondef/.test(migrations) && /raise exception/i.test(migrations),
  'a full-body CREATE OR REPLACE from a stale copy is how predicates get silently reverted');

check('migration patches all THREE readers (counts must match results)',
  /location_search_candidates_ar/.test(migrations)
  && /apartment_guided_counts_ar/.test(migrations)
  && /property_age_option_counts_ar/.test(migrations));

// ── 2. monthly-only platforms are in scope whenever the period scope includes monthly ────────────
check("resTables adds the monthly-only sources for 'both', not just 'monthly'",
  /rentPeriod\s*===\s*'monthly'\s*\|\|\s*q\.rentPeriod\s*===\s*'both'/.test(remote)
  && /gathern_residential_listings'?,\s*'aqarmonthly_residential_listings/.test(remote),
  'without this a both-search returns an annual-only pool while claiming to cover both periods');

check("candidate-level period filter has an explicit 'both' branch",
  /rentPeriod\s*===\s*'both'\s*\)\s*\{[\s\S]{0,220}?\.in\(\s*'rent_period',\s*\[\s*'monthly',\s*'annual'\s*\]/.test(remote),
  "mixed platforms must still require a PUBLISHED monthly|annual period — a null one is neither");

// ── 3. one price basis ───────────────────────────────────────────────────────────────────────────
check("priceFilter reads a 'both' budget on the annual basis (no ×12 heuristic fallthrough)",
  /explicitBoth\s*=\s*q\.rentPeriod\s*===\s*'both'/.test(search)
  && /explicitMonthly\s*\|\|\s*explicitAnnual\s*\|\|\s*explicitBoth\s*\?\s*amount/.test(search),
  'falling through to the magnitude heuristic would ×12 a ≤25k budget and silently shrink the ceiling');

check("agentPriceCapAnnual returns a 'both' budget unscaled (already annual)",
  /q\.rentPeriod\s*===\s*'both'\s*\)\s*return\s+amount\s*;/.test(remote));

// ── 4. results actually mix, without displacing platform as the outermost key ────────────────────
check("orderByScope takes a mixPeriods flag and nests 'period' INSIDE platform",
  /mixPeriods\s*=\s*false/.test(diversity)
  && /mixPeriods\s*&&\s*base\.length\s*\?\s*\[\s*base\[0\]\s*,\s*'period'\s*,\s*\.\.\.base\.slice\(1\)\s*\]/.test(diversity),
  "period must never become the outermost key — platform-first is a PERMANENT owner rule (2026-07-13)");

check("the diversity key reads the listing's own rentPeriod",
  /k\s*===\s*'period'\s*\?\s*\(r\.l\.rentPeriod\s*\?\?\s*''\)/.test(diversity));

check("remote.ts turns mixing on only for an actual both-search",
  /mixPeriods\s*=\s*!q\.bothDeals\s*&&\s*q\.deal\s*===\s*'Rent'\s*&&\s*q\.rentPeriod\s*===\s*'both'/.test(remote));

// ── UI + copy (owner 2026-08-19: كلاهما button REMOVED — سنوي/شهري are independent toggles) ────────
check("the Filter offers ONLY two period buttons (سنوي/شهري) — no third «Both» button in the UI",
  /\(\['annual',\s*'monthly'\]\s*as const\)\.map/.test(index)
  && !/options=\{\['Monthly',\s*'Yearly',\s*'Both'\]\}/.test(index),
  'a third visible Both button was explicitly banned by the owner — both periods reach the same query value via independent toggles instead');

check("both toggle buttons route through togglePeriodButton (one canonical transition function)",
  /togglePeriodButton\(rentPeriod,\s*which\)/.test(index));

check("city/district pools use the SAME 'شهري'/'سنوي'/'كلاهما' token as the results RPC, never a bare boolean",
  /rentPeriod\s*===\s*'monthly'\s*\?\s*'شهري'[\s\S]{0,40}rentPeriod\s*===\s*'both'\s*\?\s*'كلاهما'/.test(index),
  "a combined search must send the EXACT كلاهما token to Trending too — null would wrongly include unpublished-period rows (docs/ARCHITECTURE.md §17)");

check("the old boolean-scoped 'both → null' Trending gap is gone",
  !/rentPeriod\s*===\s*'both'\s*\?\s*null\s*:\s*rentPeriod\s*===\s*'monthly'/.test(index),
  'this shape sent a broader, wrong-scope pool to Trending for a combined search — the exact gap this fix closes');

// The owner's copy rule: state the price BASIS, never assert a lease length no source publishes.
// 'both' wording trimmed 2026-08-22 (owner feedback): dropped the "this means you want both, so
// you get both" framing — selecting both buttons is already self-explanatory. Kept only the one
// genuinely non-obvious fact: mixed results carry mixed price units.
for (const [label, key] of [
  ['monthly', 'Monthly: the displayed price is the monthly price.'],
  ['yearly', 'Yearly: the displayed price is the yearly price.'],
  ['both', 'Each listing shows its own price basis (monthly or yearly).'],
] as const) {
  check(`${label} period hint has an Arabic translation (no English key leak)`, i18n.includes(`'${key}'`));
}
check("the 'both' hint no longer re-explains what selecting both buttons already means (owner feedback 2026-08-22)",
  !index.includes('Both: monthly and yearly listings together'));
// Comment-stripped: a NEGATIVE check must not be tripped by prose that merely QUOTES the banned copy
// (the comment above these keys explains what was removed and why — that is documentation, not a claim).
check("period hints never assert a contract/lease length (owner 2026-08-14)",
  !/عقد لمدة 12 شهر|عقد من 1 إلى 11 شهر|من شهر إلى 11/.test(codeOnly(i18n)),
  'no source publishes the lease term — say what the displayed price means instead');

check('the Monthly note is the OWNER-EXACT wording (2026-08-18): «الأسعار معروضة بالشهر» — price basis only, never a contract-length claim',
  /'الأسعار معروضة بالشهر'/.test(i18n));
check("'Both' and the both-verb are translated", /'Both':\s*'كلاهما'/.test(i18n) && /'to rent monthly or yearly':/.test(i18n));

console.log(failures === 0
  ? '\n✓ rent-period «both» intact: true union, monthly sources in scope, annual price basis, mixed output\n'
  : `\n✗ ${failures} check(s) FAILED — the both-period feature is not intact\n`);
process.exit(failures === 0 ? 0 : 1);
