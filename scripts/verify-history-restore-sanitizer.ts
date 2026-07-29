// Permanent tests for the history-restore allowlist (audit item 2, owner-approved 2026-07-27).
// A Filter search must NEVER inherit hidden AI-agent fields (bothDeals, sources, keywords, sort,
// count, type, detail, priceInput, priceIsAnnual, amenities, bathMin, age…) from a restored history
// item — only what the Filter UI visibly represents. searchDefaults.ts is zero-dep, so this test
// EXECUTES the real sanitizer (not a source grep).
//   node --experimental-strip-types scripts/verify-history-restore-sanitizer.ts   (wired into `npm test`)
import { readFileSync } from 'node:fs';
import { sanitizeForFilterRestore, HOME_DEFAULT_QUERY, hasActiveFilters } from '../src/lib/searchDefaults.ts';

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// A maximally-contaminated agent query: every hidden field set to a dangerous value.
const agentQuery: any = {
  deal: 'Buy',
  location: 'الرياض',
  category: 'Residential',
  typeGroup: 'Villas & Houses',
  types: ['Villa'],
  areaMin: 200, areaMax: 400, priceMin: 500000, priceMax: 1000000,
  contextBeds: '3', contextBedsList: [3], contextSize: null,
  rentPeriod: 'annual',
  districts: ['حي الملقا'], districtLabel: 'حي الملقا',
  locationMatch: { kind: 'city' },
  // ── agent-only contamination (no Filter-home control) ──
  bothDeals: true, priceIsAnnual: true, priceInput: '3000', priceBand: 'SAR 75k–150k',
  type: 'Apartment', detail: '2', sources: ['aqar'], keywords: ['مسبح'],
  proximity: [{ phrase: 'قرب الجامعة' }], sort: 'cheapest', count: 5,
  amenities: ['rnpl'], bathMin: 3, ageMin: 0, ageMax: 5, isNewConstruction: true,
  regionPin: 'منطقة الرياض', priceOriginal: 'USD 100,000',
};

const out: any = sanitizeForFilterRestore(agentQuery);

// 1) Every dangerous agent-only field is dropped/reset.
const mustNotSurvive: Array<[string, any]> = [
  ['bothDeals', undefined], ['priceIsAnnual', undefined], ['priceInput', ''], ['priceBand', null],
  ['type', null], ['detail', null], ['sources', undefined], ['keywords', undefined],
  ['proximity', undefined], ['sort', undefined], ['count', undefined], ['amenities', undefined],
  ['bathMin', undefined], ['ageMin', undefined], ['ageMax', undefined], ['isNewConstruction', undefined],
  ['regionPin', undefined], ['priceOriginal', undefined],
];
for (const [k, want] of mustNotSurvive)
  check(`agent-only field "${k}" does not survive restore (=${JSON.stringify(want)})`, out[k] === want);

// 2) Every visible Filter field IS preserved.
const mustSurvive: Array<[string, any]> = [
  ['deal', 'Buy'], ['location', 'الرياض'], ['category', 'Residential'],
  ['typeGroup', 'Villas & Houses'], ['areaMin', 200], ['areaMax', 400],
  ['priceMin', 500000], ['priceMax', 1000000], ['contextBeds', '3'], ['rentPeriod', 'annual'],
  ['districtLabel', 'حي الملقا'],
];
for (const [k, want] of mustSurvive)
  check(`visible Filter field "${k}" survives restore`, JSON.stringify(out[k]) === JSON.stringify(want));
check('types survives as the visible multi-select', JSON.stringify(out.types) === JSON.stringify(['Villa']));
check('districts survives (visible district field)', JSON.stringify(out.districts) === JSON.stringify(['حي الملقا']));

// 3) Buy stays Buy, Rent stays Rent — the deal a user SEES is the deal that searches.
check('restored Buy query searches Buy only (no bothDeals)', out.deal === 'Buy' && out.bothDeals === undefined);
const rentOut: any = sanitizeForFilterRestore({ ...agentQuery, deal: 'Rent' });
check('restored Rent query searches Rent only', rentOut.deal === 'Rent' && rentOut.bothDeals === undefined);

// 4) Sanitizing a pure default query stays default (no phantom "active filters").
check('sanitize(HOME_DEFAULT_QUERY) has no active filters', !hasActiveFilters(sanitizeForFilterRestore(HOME_DEFAULT_QUERY())));

// 5) The injection point actually uses the sanitizer.
const SB = readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');
check('Sidebar restores via sanitizeForFilterRestore (never raw c.query into the store)',
  SB.includes('setQuery(() => sanitizeForFilterRestore(c.query))') && !SB.includes('setQuery(() => c.query)'));
check('Sidebar chat replay still passes the FULL query to the agent (params, not store)',
  SB.includes('JSON.stringify(c.query)'));

if (failed) { console.error(`\n✗ ${failed} history-restore assertion(s) FAILED`); process.exit(1); }
console.log('\n✓ all history-restore sanitizer assertions passed (strict allowlist; Buy=Buy, Rent=Rent; replay unaffected)');
