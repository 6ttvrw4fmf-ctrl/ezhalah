// COMBINED شراء+إيجار: two budgets, two deals, and neither may be applied to the other's rows.
// Auto-discovered barrier (scripts/verify-*.ts), offline, executes the REAL shipped priceFilter().
//
// THE DEFECT THIS PINS (found 2026-09-02, routine #5 property-type audit).
//
// Selecting شراء AND إيجار together (owner feature 2026-08-20) gives the user TWO independent budget
// boxes, and the UI says so in as many words: «Buy budget» and «Rent budget (yearly basis)», under a
// helper line reading "When you choose Buy and Rent together, each one has its own budget."
// SearchQuery says the same thing at priceMinRent: "priceMin/priceMax stay the Buy budget".
//
// The SERVER already honours that split exactly. location_search_candidates_ar, the p_deal IS NULL
// branch, read live from production 2026-09-02:
//
//     (p_deal is null and s.deal_ar = 'بيع'
//       and (... s.price_total  >= coalesce(p_price_min,0)      and s.price_total  <= ...))
//  or (p_deal is null and s.deal_ar = 'إيجار'
//       and (... s.price_annual >= coalesce(p_price_min_rent,0) and s.price_annual <= ...))
//
// Buy rows are bounded by the Buy pair on price_total; rent rows by the RENT pair on price_annual.
//
// runSearch()'s own price net did NOT. priceFilter() saw priceMin/priceMax set and returned ONE
// predicate applied to every row in the eligible set — Buy and Rent alike — and never read
// priceMinRent/priceMaxRent at all. So a user who asked for
//
//     Buy 500,000–2,000,000  +  Rent 20,000–60,000
//
// got a correct server result set and then watched the client delete every rent card in it, because
// a 55,000 SAR annual rent is below a 500,000 SAR BUY floor. Silently, too: the headline count comes
// from the RPC's count(*) over(), which counted those rent rows, and hasClientOnlyNarrowing() did
// not declare this narrower — so the count was not even suppressed. The user was told «لقينا N
// إعلان» and shown fewer, with no rent among them. A missing row is as wrong as a wrong one.
//
//   node --experimental-strip-types scripts/verify-combined-deal-budget-split.ts

import { readFileSync } from 'node:fs';
import { liftSymbols } from './lib/liftSymbols.ts';

// src/data/search.ts uses extension-less imports Node's ESM loader rejects, so priceFilter cannot be
// imported directly. Lift the REAL predicate and its REAL arithmetic rather than keeping a copy — a
// copy is a test that passes while production breaks (feedback_never-test-a-copy-of-production-code).
// Only priceBandRange/detailFor are shimmed: no fixture below sets priceBand or detail, so neither
// carries logic this file exercises, and lifting them would drag in the whole taxonomy module.
const lifted = await liftSymbols(
  new URL('../src/data/search.ts', import.meta.url).pathname,
  [
    { header: 'const numOrNull = ' },
    { header: 'function fixedSize(' },
    { header: 'function listingPriceValue(' },
    { header: 'function withinValue(' },
    { header: 'function rentAnnualValue(' },
    { header: 'function priceFilter(' },
  ],
  ['priceFilter'],
  [
    'type SearchQuery = any; type Listing = any;',
    'const priceBandRange = (_b: string) => null;',
    'const detailFor = (_t: string) => ({ isBedrooms: false });',
  ].join('\n'),
);
const priceFilter = lifted.priceFilter as (q: unknown) => ((l: unknown) => boolean) | null;

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// ── the fixture ───────────────────────────────────────────────────────────────────────────────────
// Prices are written the way listingPriceString() writes them, because that string is what the
// shipped filter parses back: a Buy row shows price_total; a rent row shows price_annual, EXCEPT a
// source-published MONTHLY one, which the card divides by 12 and suffixes /mo. A rent row whose
// source published NO period keeps the bare annual figure with no suffix (owner rule: period =
// source, never guessed) — so its displayed number already IS the annual basis, and reading it as
// such guesses nothing.
const L = (id: number, deal: 'Buy' | 'Rent', price: string, rentPeriod: string | null) =>
  ({ id, deal, price, rentPeriod, area: 120 });

//                       id  deal    displayed price   rent_period      annual basis
const ROWS = [
  L(9001, 'Buy',  'SAR 1,200,000', null),      // 1,200,000  inside the Buy budget
  L(9002, 'Buy',  'SAR 300,000',   null),      //   300,000  below the Buy floor
  L(9003, 'Buy',  'SAR 5,000,000', null),      // 5,000,000  above the Buy ceiling
  L(9004, 'Rent', 'SAR 55,000/yr', 'annual'),  //    55,000  inside the rent budget
  L(9005, 'Rent', 'SAR 4,000/mo',  'monthly'), //    48,000  inside — via ×12
  L(9006, 'Rent', 'SAR 30,000',    null),      //    30,000  inside — period unpublished
  L(9007, 'Rent', 'SAR 250,000/yr', 'annual'), //   250,000  above the rent ceiling
  L(9008, 'Rent', 'SAR 9,000/mo',  'monthly'), //   108,000  above the rent ceiling via ×12
  // No published price at all — listingPriceString()'s «Price on request». UNKNOWN in the strictest
  // sense: it can never be PROVEN inside a stated budget, and must never be silently deleted by a
  // budget the user did not state for that deal. One of each, so the rule is pinned in both
  // directions rather than only where the fixture happens to have rows.
  L(9009, 'Rent', 'Price on request', null),
  L(9010, 'Buy',  'Price on request', null),
];

const BASE = {
  deal: 'Buy', dealCombined: true, priceInput: '', priceBand: null, detail: null,
  priceMin: null, priceMax: null, priceMinRent: null, priceMaxRent: null,
};

/** Ids surviving the shipped predicate — null (no filter) means every row survives. */
const kept = (over: Record<string, unknown>): number[] => {
  const f = priceFilter({ ...BASE, ...over });
  return ROWS.filter((l) => (f ? f(l) : true)).map((l) => l.id);
};

// ── 1. THE DEFECT: the Buy floor must not touch a rent row ────────────────────────────────────────
console.log('── two budgets, split by the row\'s own deal (mirrors the RPC) ──');
const both = { priceMin: '500000', priceMax: '2000000', priceMinRent: '20000', priceMaxRent: '60000' };
eq('Buy 500k–2M + Rent 20k–60k keeps the in-budget rows of BOTH deals',
  kept(both), [9001, 9004, 9005, 9006]);

// Each half of that, stated on its own so a regression names which side broke.
const set = new Set(kept(both));
check('THE BUG: a 55,000 annual rent survives a 500,000 BUY floor', set.has(9004),
  'the Buy budget was applied to a rent row — the whole defect this file exists for');
check('a monthly rent card (4,000/mo = 48,000/yr) survives it too', set.has(9005),
  'a /mo figure is price_annual÷12; the rent budget is the YEARLY basis, so ×12 before comparing');
check('a rent row whose source published NO period is kept, never guessed away', set.has(9006),
  'its displayed figure already IS price_annual — the ÷12 branch was never taken (period = source)');
check('the Buy budget still bites on Buy rows — below the floor is out', !set.has(9002));
check('...and above the ceiling is out', !set.has(9003));
check('the RENT budget bites on rent rows — 250,000/yr is over the rent ceiling', !set.has(9007));
check('...and 9,000/mo (108,000/yr) is over it too, which only ×12 can see', !set.has(9008));
check('a rent row with NO published price cannot be proven in-budget, so a stated budget excludes it',
  !set.has(9009));
check('...and the same for a Buy row against a stated Buy budget', !set.has(9010));

// ── 2. one budget only: the other deal stays UNBOUNDED, never zeroed ──────────────────────────────
// A user may fill one box and leave the other blank. An empty box is "no opinion", never a 0 ceiling
// — the same UNKNOWN-is-not-a-value rule every AF predicate follows.
// An unstated budget must also leave an UNPRICED row of that deal alone: "no opinion" cannot become
// "and also delete the ones I can't read". That is the single behaviour the empty-box early return
// buys over letting the bounds fall through as 0..Infinity, and the only mutation that survived the
// first version of this file.
console.log('\n── an empty budget box is no opinion, never a zero bound ──');
eq('Buy budget alone leaves every rent row untouched, unpriced ones included',
  kept({ priceMin: '500000', priceMax: '2000000' }), [9001, 9004, 9005, 9006, 9007, 9008, 9009]);
eq('Rent budget alone leaves every Buy row untouched, unpriced ones included',
  kept({ priceMinRent: '20000', priceMaxRent: '60000' }), [9001, 9002, 9003, 9004, 9005, 9006, 9010]);
eq('neither budget set → no price predicate at all', kept({}), ROWS.map((l) => l.id));

// A one-sided bound is a bound, not a range: a max with no min must not install a floor, and a min
// with no max must not install a ceiling.
eq('rent max alone (≤60k) drops the over-budget rent rows and keeps every Buy row',
  kept({ priceMaxRent: '60000' }), [9001, 9002, 9003, 9004, 9005, 9006, 9010]);
eq('Buy min alone (≥500k) drops only the cheap BUY row',
  kept({ priceMin: '500000' }), [9001, 9003, 9004, 9005, 9006, 9007, 9008, 9009]);

// ── 3. SINGLE-DEAL PATHS UNCHANGED — the fix must be invisible outside combined mode ──────────────
// The split is gated on q.dealCombined. Every single-deal call keeps the one-pair semantics it has
// always had (the pair against the displayed price, in the displayed unit), which is also what the
// RPC's `p_deal is not null` branch does. Pinning it here is what stops the fix from becoming a
// silent behaviour change on the 99% path.
// Read in isolation, the single-deal predicate is deliberately DEAL-AGNOSTIC: it applies its one
// pair to whatever row it is handed, because runSearch has already narrowed the pool to the one
// selected deal before it runs (`.filter((l) => … l.deal === q.deal)`). So the expectations below
// are "the pair, against every fixture row" — that is the pre-fix behaviour, pinned unchanged.
console.log('\n── single-deal semantics unchanged ──');
eq('Buy-only: one pair, read as the Buy budget against the displayed total',
  kept({ dealCombined: false, deal: 'Buy', priceMin: '500000', priceMax: '2000000' }), [9001]);
eq('Rent-only: the SAME pair is the Rent budget, read in the DISPLAYED unit (no ×12 here)',
  kept({ dealCombined: false, deal: 'Rent', rentPeriod: 'annual',
    priceMin: '20000', priceMax: '60000' }),
  [9004, 9006]);
// 9005 (4,000/mo) is correctly absent above: under Rent-only/annual the pair is the ANNUAL budget and
// the card shows 4,000, so it reads as below the 20,000 floor. That is pre-existing behaviour and the
// period pool filter, not this predicate, is what keeps a /mo row out of an annual search — pinned
// only so the combined fix cannot quietly change it.

// ── 4. the fix mirrors the SERVER, and says which side of the row decides ─────────────────────────
console.log('\n── provenance ──');
const src = readFileSync(new URL('../src/data/search.ts', import.meta.url), 'utf8');
check('the shipped split is gated on dealCombined and reads BOTH pairs',
  /q\.dealCombined/.test(src) && /numOrNull\(q\.priceMinRent\)/.test(src)
  && /numOrNull\(q\.priceMaxRent\)/.test(src),
  'priceFilter() must read the rent pair — the pre-fix version never mentioned it');
check('the predicate branches on the ROW\'s deal, exactly as the RPC branches on s.deal_ar',
  /l\.deal === 'Buy'/.test(src));
// The relaxation probe must relax BOTH budgets, or "drop the budget" would report zero while the
// rent half was still biting — a suggestion that declines a relaxation the user could actually use.
check('noResultsSuggestion relaxes the rent budget alongside the Buy one',
  /countWith\(\{ priceInput: '', priceMin: null, priceMax: null, priceMinRent: null, priceMaxRent: null \}\)/.test(src));

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — the combined Buy+Rent budgets are not split by deal`);
  process.exit(1);
}
console.log('\nOK — each combined-mode budget binds only its own deal, and single-deal search is unchanged');
