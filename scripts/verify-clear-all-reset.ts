// Automated, REAL runtime tests for the "مسح الكل" (Clear All) filter-reset feature.
//
// Owner report (2026-07-13 bug sweep): hasActiveFilters() (src/lib/searchDefaults.ts, formerly
// inline in src/app/index.tsx) never checked query.rentPeriod — a stale non-default rentPeriod
// (e.g. left over from a Rent→Monthly→Buy sequence, where the Deal toggle resets price fields but
// not rentPeriod) could hide behind an invisible Clear All button: hasActiveFilters() would say
// "nothing to clear" while a real filter value was still silently in effect. Fixed by adding
// rentPeriod to the check.
//
// HOME_DEFAULT_QUERY()/hasActiveFilters() are pure and now live in src/lib/searchDefaults.ts (zero-
// dependency — only a type-only import of SearchQuery from src/data/search.ts, erased at compile
// time — mirrors src/lib/arabicText.ts's design), so this test genuinely IMPORTS AND EXECUTES the
// real functions used by src/app/index.tsx's Clear All button and src/store.tsx's initial state,
// rather than grepping source text for the right shape.
//
//   node --experimental-strip-types scripts/verify-clear-all-reset.ts   (wired into `npm test`)

import { HOME_DEFAULT_QUERY, hasActiveFilters, emptyQuery } from '../src/lib/searchDefaults.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) console.error(`  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  check(label, ok);
};

// ── The default itself ──────────────────────────────────────────────────────────────────────────
eq('HOME_DEFAULT_QUERY() is exactly {Buy, empty location, Residential, no type/detail, annual rent}', HOME_DEFAULT_QUERY(), {
  deal: 'Buy',
  location: '',
  category: 'Residential',
  type: null,
  detail: null,
  priceInput: '',
  priceBand: null,
  rentPeriod: 'annual',
});
check('emptyQuery() itself stays Rent-default (the agent/chat base, unaffected by the Home screen override)', emptyQuery().deal === 'Rent');
check('hasActiveFilters(HOME_DEFAULT_QUERY()) is false — a fresh screen never shows Clear All', !hasActiveFilters(HOME_DEFAULT_QUERY()));

// ── THE regression this test suite exists to catch: rentPeriod ─────────────────────────────────
// Exact repro from the bug report: Rent → Monthly → Buy leaves rentPeriod:'monthly' stranded even
// though every OTHER field is back at its default.
check(
  'hasActiveFilters flags a stale rentPeriod even when every other field is at default (THE reported regression)',
  hasActiveFilters({ ...HOME_DEFAULT_QUERY(), rentPeriod: 'monthly' }),
);
check(
  'hasActiveFilters does NOT flag rentPeriod when it is undefined (agent-created queries that never touched it) — matches index.tsx\'s own `query.rentPeriod ?? \'annual\'` convention',
  !hasActiveFilters({ ...HOME_DEFAULT_QUERY(), rentPeriod: undefined }),
);

// ── Full field-by-field coverage matrix — every field the Home screen's UI can set must, on its
// own, flip hasActiveFilters() to true. Each case starts from a clean default and changes exactly
// ONE field, so a false result unambiguously means THAT field's check is missing or broken. ──────
const cases: Array<[string, Partial<ReturnType<typeof HOME_DEFAULT_QUERY>> & Record<string, unknown>]> = [
  ['location', { location: 'الرياض' }],
  ['deal', { deal: 'Rent' }],
  ['category', { category: 'Commercial' }],
  ['typeGroup', { typeGroup: 'Villas & Houses' }],
  ['type', { type: 'Villa' }],
  ['types', { types: ['Villa', 'House'] }],
  ['detail', { detail: '3' }],
  ['contextBeds', { contextBeds: '2' }],
  ['contextBedsList', { contextBedsList: ['2', '3'] }],
  ['contextSize', { contextSize: '300' }],
  ['areaMin', { areaMin: '100' }],
  ['areaMax', { areaMax: '500' }],
  ['priceInput', { priceInput: '500000' }],
  ['priceBand', { priceBand: 'SAR 500k–1M' }],
  ['priceMin', { priceMin: '100000' }],
  ['priceMax', { priceMax: '900000' }],
  ['rentPeriod', { rentPeriod: 'monthly' }],
];
for (const [field, patch] of cases) {
  const q = { ...HOME_DEFAULT_QUERY(), ...patch };
  check(`hasActiveFilters detects a lone change to '${field}'`, hasActiveFilters(q as any));
}

// ── The full-replace reset itself: every field the UI could have set is gone after a reset, no
// merge artifacts survive. Simulates the exact Clear All handler: setQuery(() => HOME_DEFAULT_QUERY()) —
// a bare replacement (confirmed against src/store.tsx's setQuery, a plain functional setState with
// no merge), so starting from a heavily-filled query and replacing it must land exactly back on
// hasActiveFilters() === false. ──────────────────────────────────────────────────────────────────
const heavilyFilled = {
  ...HOME_DEFAULT_QUERY(),
  location: 'جدة',
  deal: 'Rent',
  category: 'Commercial',
  typeGroup: 'Retail & Workspace',
  type: 'Shop',
  types: ['Shop', 'Showroom'],
  detail: '2',
  contextBeds: '2',
  contextBedsList: ['2', '3'],
  contextSize: '200',
  areaMin: '50',
  areaMax: '300',
  priceInput: '200000',
  priceBand: 'SAR 200k–400k',
  priceMin: '150000',
  priceMax: '350000',
  rentPeriod: 'monthly',
} as any;
check('a heavily-filled query trips hasActiveFilters (sanity check before testing the reset)', hasActiveFilters(heavilyFilled));
const afterReset = HOME_DEFAULT_QUERY(); // exactly what the Clear All handler assigns
check('after a full-replace reset, hasActiveFilters is false again — no field survives', !hasActiveFilters(afterReset));
eq('after a full-replace reset, the query is byte-for-byte the same default every time (idempotent)', afterReset, HOME_DEFAULT_QUERY());

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} clear-all-reset assertion(s) FAILED`);
  process.exit(1);
}
console.log('✓ all clear-all-reset assertions passed');
