// A RENT ROW HAS TWO NUMBERS, AND ONLY ONE OF THEM IS THE ONE THE SERVER USED.
// Auto-discovered barrier (scripts/verify-*.ts), offline, executes the REAL shipped functions.
//
// THE CLASS THIS PINS (found 2026-09-06, regression hunter, re-attacking the 2026-09-02 combined-
// budget fix at its siblings rather than re-running its reproduction).
//
// `listingPriceString()` prints a source-MONTHLY rent at price_annual÷12 and everything else at
// price_annual. So a Listing's `price` string carries a number whose UNIT depends on the row. The
// server has no such ambiguity: `location_search_candidates_ar` filters rent rows on `price_annual`
// (×12-ing the BOUND, never the row, and only when p_rent_period='شهري') and orders the whole matched
// set on `effective_price = coalesce(price_total_effective, price_annual)` before limit/offset.
//
// The two layers therefore agree exactly while a result set holds ONE rent period, and disagree by
// 12× the moment it holds both — which is precisely what «شهري+سنوي» (rentPeriod 'both') asks for,
// and what the annual arm admits too (p_rent_period='سنوي' also matches a rent_period_ar='شهري' row
// when rent_now_pay_later is true).
//
// Measured on production 2026-09-06, الرياض / إيجار / كلاهما with a 20,000 floor: the RPC matched
// 28,626 rows — the number the headline quotes — and the client net deleted 8,651 of them, every
// monthly card in the set. Three consumers read the display string where the server read price_annual:
// the budget net (scripts/verify-combined-deal-budget-split.ts §5 owns that half), the objective
// price/ppm sorts, and the closeness ranking. This file owns the two ranking consumers AND the CLASS,
// so a fourth consumer added later cannot join them quietly.
//
//   node --experimental-strip-types scripts/verify-rent-price-basis-is-the-rpc-basis.ts

import { readFileSync } from 'node:fs';
import { liftSymbols } from './lib/liftSymbols.ts';

const SEARCH_TS = new URL('../src/data/search.ts', import.meta.url).pathname;

// Lift the REAL functions. Never a copy: a barrier made of a copy passes while production breaks
// (feedback_never-test-a-copy-of-production-code). RECENCY and exactSizeTarget are shimmed — neither
// carries logic this file exercises, and lifting exactSizeTarget would drag in the whole taxonomy.
const lifted = await liftSymbols(
  SEARCH_TS,
  [
    { header: 'function listingPriceValue(' },
    { header: 'function rentAnnualValue(' },
    { header: 'const priceOf = ', endsWith: /;\s*$/ },
    { header: 'const sortPriceOf = ', endsWith: /;\s*$/ },
    { header: 'const byValue = ' },
    { header: 'function sortListings(' },
    { header: 'function closenessScore(' },
    { header: 'function closenessBonus(' },
  ],
  ['sortListings', 'closenessScore', 'closenessBonus', 'sortPriceOf', 'priceOf', 'rentAnnualValue'],
  [
    'type Listing = any; type SearchQuery = any; type SortKey = string;',
    'const RECENCY: Record<string, number> = {};',
    'const exactSizeTarget = (_q: SearchQuery) => null;',
  ].join('\n'),
);
const sortListings = lifted.sortListings as (l: unknown[], s: string) => unknown[];
const closenessScore = lifted.closenessScore as (l: unknown, q: unknown, cap: number | null) => number;
const closenessBonus = lifted.closenessBonus as (l: unknown, q: unknown, cap: number | null) => number;
const sortPriceOf = lifted.sortPriceOf as (l: unknown) => number;
const priceOf = lifted.priceOf as (l: unknown) => number;
// §0 asserts the annual basis directly, so it needs the primitive that BUILDS it.
const rentAnnualValue = lifted.rentAnnualValue as (l: Record<string, unknown>) => number;

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// ── the fixture: one mixed-period rent set, written the way listingPriceString() writes it ────────
// Deliberately adversarial: read on the DISPLAYED figure the cheapest-first order is exactly the
// reverse of the truth, so a barrier that got the basis wrong could not accidentally pass.
//                        id  displayed        rent_period   annual basis
const R = (id: number, price: string, rentPeriod: string | null, area = 100) =>
  ({ id, deal: 'Rent', price, rentPeriod, area, beds: 2, listed: 'today', recencyRank: id });
const MIXED = [
  R(1, 'SAR 2,000/mo', 'monthly'),   //  24,000/yr  ← cheapest by BOTH readings
  R(2, 'SAR 30,000/yr', 'annual'),   //  30,000/yr
  R(3, 'SAR 4,000/mo', 'monthly'),   //  48,000/yr
  R(4, 'SAR 60,000/yr', 'annual'),   //  60,000/yr
  R(5, 'SAR 9,000/mo', 'monthly'),   // 108,000/yr  ← dearest, but displays as 9,000
];
const ids = (rows: unknown[]) => rows.map((r) => (r as { id: number }).id);

// ── 0. THE BASIS IS CARRIED, NOT RECONSTRUCTED (added 2026-09-06, regression hunter) ──────────────
// The 2026-09-06 repair made every consumer below read rentAnnualValue(). That closed the 12×
// disagreement — and left a smaller one inside rentAnnualValue itself, because it REBUILT
// price_annual from the display string. listingPriceString() prints a source-monthly rent at
// Math.round(price_annual / 12), so ×12 is short by up to 6 SAR whenever price_annual is not
// divisible by 12, and the client then deletes a row the server's own bound accepted.
//
// It is not theoretical. Measured on production 2026-09-06: 430 of 32,226 monthly rows sit in that
// gap and 892 integer budget floors delete at least one of them — including 151,000, a floor any
// user might type. The worked case is listing 1143355 (الرياض): price_annual 151,001, printed
// 12,583/mo, reconstructed 150,996.
//
// So `Listing.priceAnnual` now carries price_annual verbatim and rentAnnualValue prefers it. The ×12
// remains ONLY as the fallback for rows that have none (the mock catalog, fixtures) — §1-§3 below
// still exercise it, which is why those fixtures deliberately carry no priceAnnual.
console.log('── the annual basis is the row\'s own price_annual, not ×12 of a rounded card figure ──');
const REAL = { id: 1143355, deal: 'Rent', price: 'SAR 12,583/mo', rentPeriod: 'monthly',
               priceAnnual: 151001, area: 100, beds: 2, listed: 'today' };
check('a carried price_annual is returned EXACTLY (151,001 — not the 150,996 the card rebuilds to)',
  rentAnnualValue(REAL) === 151001,
  `got ${rentAnnualValue(REAL)}; the ×12 reconstruction of the printed 12,583 gives 150,996`);
check("…so a 151,000 yearly floor keeps the row the server kept",
  rentAnnualValue(REAL) >= 151000,
  'the client net is deleting a row location_search_candidates_ar matched against the same bound');
check('the ×12 fallback still serves a row that carries no price_annual (mock catalog, fixtures)',
  rentAnnualValue({ price: 'SAR 4,000/mo', rentPeriod: 'monthly' }) === 48000);
check('…and an annual/period-less row is unchanged by either path',
  rentAnnualValue({ price: 'SAR 55,000/yr', rentPeriod: 'annual' }) === 55000
  && rentAnnualValue({ price: 'SAR 30,000', rentPeriod: null }) === 30000
  && rentAnnualValue({ price: 'SAR 55,000/yr', rentPeriod: 'annual', priceAnnual: 55000 }) === 55000);
// MUTATION for §0, executed: force the reconstruction path on the real row and watch the floor drop
// it. This is the defect exactly as production carried it.
const reconstructed = rentAnnualValue({ price: REAL.price, rentPeriod: REAL.rentPeriod });
check('(mutation) catches the reconstruction: without the carried figure the row falls below 151,000',
  reconstructed < 151000 && reconstructed === 150996,
  `MUTANT SURVIVED — the ×12 path gave ${reconstructed}, expected 150,996 (below the floor). If this `
  + 'is no longer below the bound, the rounding gap this section exists for has moved.');

// ── 1. the objective price sorts key on the basis the RPC ordered by ──────────────────────────────
console.log('── «الأرخص أولاً» over a «شهري+سنوي» result set ──');
eq('cheapest first is ascending in ANNUAL rent, not in printed digits',
  ids(sortListings(MIXED, 'price_asc')), [1, 2, 3, 4, 5]);
eq('dearest first is its exact reverse', ids(sortListings(MIXED, 'price_desc')), [5, 4, 3, 2, 1]);
// Why this is a PAGINATION defect and not only an ordering one: the server picks WHICH rows are on
// this page using its own key, so a client that re-sorts a page on a different key can display a
// cheaper card on page 2 than on page 1 — a cheapest-first walk that is not monotonic across pages.
const pageOne = sortListings(MIXED.slice(0, 3), 'price_asc');
const pageTwo = sortListings(MIXED.slice(3), 'price_asc');
check('a paged cheapest-first walk stays monotonic across the page boundary',
  sortPriceOf(pageOne[pageOne.length - 1]) <= sortPriceOf(pageTwo[0]),
  'page 2 opens cheaper than page 1 closed — the two pages were ordered on different keys');

// ppm is the one sort the RPC does not compute, so nothing downstream would ever catch it.
console.log('\n── price-per-m², the sort with no server counterpart ──');
const PPM = [R(10, 'SAR 3,000/mo', 'monthly', 200), R(11, 'SAR 20,000/yr', 'annual', 100)];
// 3,000/mo over 200 m² = 36,000/yr ÷ 200 = 180 SAR/m²/yr; 20,000/yr over 100 m² = 200 SAR/m²/yr.
eq('SAR/m² compares year against year, never a month against a year',
  ids(sortListings(PPM, 'ppm_asc')), [10, 11]);

// An unknown price must still sort LAST in both directions, never as the cheapest — the 2026-07-25
// contract byValue() exists for. rentAnnualValue multiplies NaN, so this could regress silently.
console.log('\n── an unreadable price is unknown, never zero ──');
const WITH_UNKNOWN = [R(20, 'Price on request', 'monthly'), R(21, 'SAR 30,000/yr', 'annual')];
eq('cheapest first puts the unpriced row last', ids(sortListings(WITH_UNKNOWN, 'price_asc')), [21, 20]);
eq('...and so does dearest first', ids(sortListings(WITH_UNKNOWN, 'price_desc')), [21, 20]);

// ── 2. the closeness ranking reads the cap's own unit ──────────────────────────────────────────────
// budgetCap() documents its unit in the source: "annual basis — see priceFilter" for rentPeriod
// 'both'. A card must be scored against the cap on THAT basis.
console.log('\n── closeness against a budget cap that states its own unit ──');
const Q = { rentPeriod: 'both', deal: 'Rent', contextSize: null, detail: null };
const CAP = 30_000;                                  // yearly
const inBudget = R(30, 'SAR 30,000/yr', 'annual');   //  30,000/yr — exactly at the cap
const overBudget = R(31, 'SAR 9,000/mo', 'monthly'); // 108,000/yr — 3.6× over it
check('a 9,000/mo card scores BELOW an at-cap annual card against a 30,000 yearly cap',
  closenessBonus(overBudget, Q, CAP) < closenessBonus(inBudget, Q, CAP),
  'the monthly card was scored on its printed 9,000, so a 108,000/yr rent read as comfortably in budget');
check('the same holds for closenessScore, the default ranking',
  closenessScore(overBudget, Q, CAP) < closenessScore(inBudget, Q, CAP));
// Identity where the two bases cannot differ — the repair must not move a single-period search.
const annualOnlyA = R(40, 'SAR 30,000/yr', 'annual'), annualOnlyB = R(41, 'SAR 60,000/yr', 'annual');
check('an annual-only set is scored exactly as before',
  closenessBonus(annualOnlyA, Q, CAP) > closenessBonus(annualOnlyB, Q, CAP));

// ── 3. THE CLASS: every listing-price read in search.ts declares its basis ─────────────────────────
// Discovery, not a checklist. Every line in src/data/search.ts that turns a Listing into a comparable
// price number is enumerated AT RUN TIME and matched against the registry below. A consumer added
// tomorrow is RED until someone states which basis it reads and why — the same shape
// SEARCH_MATCH_QA_ENGINEER.md §1 requires for UI controls, and the reason this file is a class
// barrier rather than a third patch. The registry is what IS known, never what SHOULD exist.
console.log('\n── every price consumer declares its basis ──');
const src = readFileSync(SEARCH_TS, 'utf8');
const READS_A_LISTING_PRICE = /listingPriceValue\(\s*l\.price\s*\)|priceOf\(\s*l\s*\)|rentAnnualValue\(\s*l\s*\)|sortPriceOf\(\s*l\s*\)/;
// expression (whitespace-normalised) → the basis it reads, and why that is the right one here.
const REGISTRY = new Map<string, string>([
  ['const v = listingPriceValue(l.price);',
    'inside rentAnnualValue() itself — the primitive that BUILDS the annual basis'],
  ['const annual = rentAnnualValue(l);',
    'priceFilter: rent rows on the annual basis, mirroring the RPC (both the combined and single-deal branches)'],
  ['const v = listingPriceValue(l.price);/perm2',
    'priceFilter per-m² branch: Buy only (v / l.area vs a SAR/m² figure), where the displayed total IS the RPC key'],
  ['const priceOf = (l: Listing): number => listingPriceValue(l.price);',
    'the displayed-basis primitive — correct for Buy, and the input sortPriceOf corrects for Rent'],
  ["const sortPriceOf = (l: Listing): number => (l.deal === 'Rent' ? rentAnnualValue(l) : priceOf(l));",
    'the RPC effective_price basis: annual for rent, displayed total for Buy'],
  ['const ppm = (l: Listing) => (l.area > 0 ? sortPriceOf(l) / l.area : NaN);',
    'SAR/m² on the annual basis, so a month is never compared against a year'],
  ["const v = l.deal === 'Rent' ? rentAnnualValue(l) : listingPriceValue(l.price);",
    'closenessScore/closenessBonus: read on budgetCap()\'s own declared unit'],
]);
const consumers: string[] = [];
src.split('\n').forEach((line, i) => {
  const code = line.replace(/\/\/.*$/, '').trim();
  if (!code || !READS_A_LISTING_PRICE.test(code)) return;
  // The per-m² Buy branch and rentAnnualValue's own body are the same text on different rows; the
  // line number disambiguates them without hardcoding either one's position.
  const isPerM2 = code === 'const v = listingPriceValue(l.price);'
    && /return !Number\.isNaN\(v\) && l\.area > 0/.test(src.split('\n')[i + 1] ?? '');
  consumers.push(isPerM2 ? `${code}/perm2` : code);
});
check('at least one consumer was discovered (an empty sweep is a broken sweep, never a clean one)',
  consumers.length >= 6, `found ${consumers.length}`);
for (const c of new Set(consumers)) {
  check(`declared: ${REGISTRY.get(c) ?? c}`, REGISTRY.has(c),
    `UNREGISTERED listing-price read: ${c}\n      `
    + 'A new consumer must state which basis it reads. A rent row prints price_annual÷12 when its '
    + 'source published a monthly period, so "the number on the card" is not a unit.');
}
// The registry must not rot in the other direction either: an entry nothing matches any more is a
// stale claim about code that no longer exists.
for (const k of REGISTRY.keys()) {
  check(`the registry entry for \`${k.slice(0, 48)}…\` still matches real code`, consumers.includes(k),
    'stale registry entry — the consumer it describes is gone or was reworded');
}

// ── MUTATION PROOF ────────────────────────────────────────────────────────────────────────────────
// EXECUTED against the real functions, not grepped. The mutant is the pre-2026-09-06 sort key —
// priceOf, the displayed figure — rebuilt from the REAL lifted arithmetic and run over the same
// fixture. Source-TEXT tripwires are exactly what stayed green through the five defects of
// 2026-09-04, two of which pinned the defective line as correct.
console.log('\n── mutation ──');
const mustCatch = (what: string, caught: boolean, detail = '') =>
  check(`(mutation) catches ${what}`, caught,
    detail || 'MUTANT SURVIVED — the assertions above are blind to the defect this file exists for');

const mutantOrder = [...MIXED].sort((a, b) => priceOf(a) - priceOf(b)).map((r) => r.id);
mustCatch('the pre-2026-09-06 displayed-figure sort key on a mixed-period set',
  JSON.stringify(mutantOrder) !== JSON.stringify([1, 2, 3, 4, 5]),
  `MUTANT SURVIVED — the pre-fix key gave ${JSON.stringify(mutantOrder)}, which §1 accepts`);
mustCatch('…and it is wrong in the exact way production was: every /mo card floated to the front',
  JSON.stringify(mutantOrder) === JSON.stringify([1, 3, 5, 2, 4]),
  `the displayed key gave ${JSON.stringify(mutantOrder)}, expected [1,3,5,2,4]`);
// A mutant that reads the closeness cap on the printed figure must be caught too — that consumer has
// its own assertion above and would otherwise be proven by nothing.
const capMutant = (l: { price: string }) => 1 - Math.min(1, Math.max(0, priceOf(l) - CAP) / CAP);
// Read on the printed 9,000 the over-budget card clears a 30,000 cap outright, so it earns the FULL
// in-budget score and becomes indistinguishable from a card that genuinely fits — the mutant does not
// invert the ranking, it erases it. The shipped basis separates them 1 vs 0.
mustCatch('the closeness cap scored on the printed figure (9,000/mo reading as inside a 30,000 cap)',
  capMutant(overBudget) >= capMutant(inBudget)
  && closenessBonus(overBudget, Q, CAP) < closenessBonus(inBudget, Q, CAP),
  `MUTANT SURVIVED — printed-figure scores were over=${capMutant(overBudget)} vs in=${capMutant(inBudget)}`);
// Surgical: on a single-period set the two keys must agree exactly, or the repair moved a search it
// had no business moving. Here a SURVIVING mutant is the correct outcome, so it is asserted as
// agreement rather than as a catch.
for (const [what, rows] of [
  ['an annual-only set', [R(50, 'SAR 60,000/yr', 'annual'), R(51, 'SAR 30,000/yr', 'annual')]],
  ['a monthly-only set', [R(52, 'SAR 9,000/mo', 'monthly'), R(53, 'SAR 2,000/mo', 'monthly')]],
  ['a Buy set', [{ ...R(54, 'SAR 5,000,000', null), deal: 'Buy' }, { ...R(55, 'SAR 1,200,000', null), deal: 'Buy' }]],
] as const) {
  const shipped = ids(sortListings(rows as unknown[], 'price_asc'));
  const mutant = [...(rows as { id: number }[])].sort((a, b) => priceOf(a) - priceOf(b)).map((r) => r.id);
  check(`the repair is inert on ${what} — the displayed key and the annual key agree`,
    JSON.stringify(shipped) === JSON.stringify(mutant),
    `shipped ${JSON.stringify(shipped)} vs displayed-key ${JSON.stringify(mutant)}`);
}

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — a rent row is being read on the printed unit, not the one the RPC used`);
  process.exit(1);
}
console.log('\nOK — every listing-price consumer in search.ts reads a rent row on the RPC\'s annual basis, and says so');
