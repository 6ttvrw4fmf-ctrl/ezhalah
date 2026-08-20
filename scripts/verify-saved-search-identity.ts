// PERMANENT BARRIERS for the account-aware search-history contract (owner decision 2026-08-20):
//
//   Logged OUT → a refresh throws the temporary search away; nothing anonymous is persisted.
//   Logged IN  → the completed search is saved to the sidebar, survives refresh, and reopening it
//                restores the EXACT search — Buy / Rent / Buy+Rent, سنوي / شهري / كلاهما,
//                city+district, type/group, price/area/bedrooms, and every Advanced Filter answer.
//
// Two halves, both executed rather than grepped where the code allows it:
//   A. IDENTITY — src/lib/savedSearchIdentity.ts is zero-dep, so this test runs the REAL function.
//   B. PERSISTENCE — the store is a React module with heavy imports, so its account rules are
//      asserted against its source. Each assertion targets a specific behaviour, not a phrase.
//
//   node --experimental-strip-types scripts/verify-saved-search-identity.ts   (wired into `npm test`)
import { readFileSync } from 'node:fs';
import { isSameSavedSearch, savedSearchIdentity, SAVED_SEARCH_IGNORED_KEYS } from '../src/lib/savedSearchIdentity.ts';

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

const base: any = {
  deal: 'Rent', location: 'الرياض', category: 'Residential', type: null, types: ['Apartment'],
  detail: null, priceInput: '', priceBand: null, typeGroup: 'Apartments & Shared Housing',
  contextBeds: null, contextBedsList: null, contextSize: null,
  areaMin: null, areaMax: null, priceMin: null, priceMax: null, districts: null,
};

// ── A1. THE SEARCHES THE OWNER NAMED MUST EACH BE THEIR OWN SIDEBAR ENTRY ────────────────────────
// Every one of these collapsed into a single entry before this fix, so the older search vanished
// from the sidebar and could never be reopened.
const distinctPairs: Array<[string, any, any]> = [
  ['«سنوي» ≠ «شهري»',                   { ...base, rentPeriod: 'annual' },  { ...base, rentPeriod: 'monthly' }],
  ['«سنوي» ≠ «كلاهما»',                 { ...base, rentPeriod: 'annual' },  { ...base, rentPeriod: 'both' }],
  ['«شهري» ≠ «كلاهما»',                 { ...base, rentPeriod: 'monthly' }, { ...base, rentPeriod: 'both' }],
  ['«إيجار» ≠ «إيجار + شراء»',          { ...base, bothDeals: false },      { ...base, bothDeals: true }],
  ['«شراء» ≠ «إيجار»',                  { ...base, deal: 'Buy' },           { ...base, deal: 'Rent' }],
  ['المدينة',                            { ...base, location: 'الرياض' },    { ...base, location: 'جدة' }],
  ['الحي',                               { ...base, districts: ['حي النرجس'] }, { ...base, districts: ['حي الملقا'] }],
  ['نوع العقار',                         { ...base, types: ['Apartment'] },  { ...base, types: ['Villa'] }],
  ['مجموعة العقار',                      { ...base, typeGroup: 'Villas & Houses' }, { ...base, typeGroup: 'Residential Lands' }],
  ['الفئة',                              { ...base, category: 'Residential' }, { ...base, category: 'Commercial' }],
  ['السعر',                              { ...base, priceMin: 20000, priceMax: 90000 }, { ...base, priceMin: 20000, priceMax: 95000 }],
  ['المساحة',                            { ...base, areaMin: 80, areaMax: 160 }, { ...base, areaMin: 80, areaMax: 200 }],
  ['غرف النوم',                          { ...base, contextBedsList: [3] },  { ...base, contextBedsList: [4] }],
  // Advanced Filter answers — the owner listed these explicitly.
  ['AF: التأثيث',                        { ...base, furnishedPref: true },   { ...base, furnishedPref: false }],
  ['AF: المميزات',                       { ...base, amenities: ['elevator'] }, { ...base, amenities: ['parking'] }],
  ['AF: دورات المياه',                   { ...base, bathMin: 1 },            { ...base, bathMin: 3 }],
  ['AF: التقييم',                        { ...base, ratingMin: 4 },          { ...base, ratingMin: 2 }],
  ['AF: عدد التقييمات',                  { ...base, reviewsMin: 10 },        { ...base, reviewsMin: 50 }],
  ['AF: نوع الوحدة',                     { ...base, unitSubtypes: ['شقة'] }, { ...base, unitSubtypes: ['غرفة'] }],
  ['AF: عرض الشارع',                     { ...base, streetWidthMin: 10 },    { ...base, streetWidthMin: 25 }],
  ['AF: الواجهة',                        { ...base, directions: ['شمالية'] }, { ...base, directions: ['جنوبية'] }],
  ['AF: عمر العقار',                     { ...base, ageMax: 5 },             { ...base, ageMax: 20 }],
  ['AF: جديد',                           { ...base, isNewConstruction: true }, { ...base, isNewConstruction: false }],
  ['المنصات',                            { ...base, sources: ['aqar'] },     { ...base, sources: ['wasalt'] }],
];
for (const [label, a, b] of distinctPairs) {
  check(`distinct saved search — ${label}`, !isSameSavedSearch(a, b));
}

// ── A2. THE DE-DUPE THAT ALREADY WORKED MUST KEEP WORKING ───────────────────────────────────────
// Re-running the SAME search must update the one entry (keeping its id and its star), never fork a
// second copy. A stricter comparison must not break this.
check('same search de-dupes (identical)', isSameSavedSearch({ ...base }, { ...base }));
// Same fields, same values, different INSERTION order — persisted JSON can come back in any order,
// so identity must be order-independent or a reload would fork a duplicate of every saved search.
const ordered = { ...base, rentPeriod: 'annual', priceMin: 1 } as any;
const shuffled: any = {};
for (const k of Object.keys(ordered).reverse()) shuffled[k] = ordered[k];
check('same search de-dupes (key order)', isSameSavedSearch(ordered, shuffled));
check('undefined and absent are the same "not set"',
  isSameSavedSearch({ ...base, ageMax: undefined } as any, { ...base } as any));
check('null and absent are the same "not set"',
  isSameSavedSearch({ ...base, ageMax: null } as any, { ...base } as any));
check('empty array and absent are the same "no selection"',
  isSameSavedSearch({ ...base, amenities: [] } as any, { ...base } as any));
check('trailing whitespace in المدينة is not a different search',
  isSameSavedSearch({ ...base, location: 'الرياض ' } as any, { ...base, location: 'الرياض' } as any));
check('حي order does not matter (A+B === B+A)',
  isSameSavedSearch({ ...base, districts: ['حي النرجس', 'حي الملقا'] } as any,
                    { ...base, districts: ['حي الملقا', 'حي النرجس'] } as any));

// ── A3. LIVE / DERIVED VALUES MUST NOT FORK A DUPLICATE ENTRY ───────────────────────────────────
// districtListingCount moves with inventory. If identity compared it, the same saved search would
// fork a new entry (silently dropping the user's star) every time the district gained a listing.
check('a moving district count does not fork an entry',
  isSameSavedSearch({ ...base, districts: ['حي النرجس'], districtListingCount: 996 } as any,
                    { ...base, districts: ['حي النرجس'], districtListingCount: 1001 } as any));
check('resolver detail (locationMatch) does not fork an entry',
  isSameSavedSearch({ ...base, locationMatch: { kind: 'city', n: 1 } } as any,
                    { ...base, locationMatch: { kind: 'city', n: 2 } } as any));

// ── A4. DRIFT GUARD: NO SearchQuery FIELD MAY BE SILENTLY EXCLUDED ──────────────────────────────
// This is the assertion that keeps the bug from coming back. The original defect was an allowlist
// that fell behind the type; a new field must now be classified deliberately or the build fails.
const searchSrc = readFileSync(new URL('../src/data/search.ts', import.meta.url), 'utf8');
const typeBlock = searchSrc.slice(searchSrc.indexOf('export type SearchQuery = {'));
const typeBody = typeBlock.slice(0, typeBlock.indexOf('\n};'));
const declaredKeys = [...typeBody.matchAll(/^ {2}([a-zA-Z_][a-zA-Z0-9_]*)\??:/gm)].map((m) => m[1]);
check('SearchQuery field list was parsed', declaredKeys.length > 20);
const probe: any = {};
for (const k of declaredKeys) probe[k] = null;
const idOfEmpty = savedSearchIdentity(probe);
const uncovered: string[] = [];
for (const k of declaredKeys) {
  if (k in SAVED_SEARCH_IGNORED_KEYS) continue;
  // Setting the field to a distinctive value MUST change the identity string.
  const mutated: any = { ...probe, [k]: '__probe__' };
  if (savedSearchIdentity(mutated) === idOfEmpty) uncovered.push(k);
}
check(`every SearchQuery field is compared or explicitly ignored${uncovered.length ? ' — uncovered: ' + uncovered.join(', ') : ''}`,
  uncovered.length === 0);
for (const k of Object.keys(SAVED_SEARCH_IGNORED_KEYS)) {
  check(`ignored key '${k}' still exists on SearchQuery (stale ignore entry)`, declaredKeys.includes(k));
  check(`ignored key '${k}' carries a written justification`, (SAVED_SEARCH_IGNORED_KEYS[k] || '').length > 40);
}

// ── A5. PROVE THE OLD COMPARISON FAILS THESE ────────────────────────────────────────────────────
// The shipped-until-2026-08-20 comparison, copied verbatim. A regression test that also passes on
// the broken code proves nothing, so assert it genuinely collapsed the owner's cases.
const sj = (v: unknown) => JSON.stringify(v ?? null);
const oldSameQuery = (a: any, b: any) =>
  a.deal === b.deal && a.location.trim() === b.location.trim() && a.category === b.category &&
  a.type === b.type && a.detail === b.detail && a.priceBand === b.priceBand &&
  a.priceInput === b.priceInput && a.typeGroup === b.typeGroup &&
  sj(a.types) === sj(b.types) && sj(a.contextBedsList) === sj(b.contextBedsList) &&
  a.contextBeds === b.contextBeds && a.contextSize === b.contextSize &&
  a.areaMin === b.areaMin && a.areaMax === b.areaMax &&
  a.priceMin === b.priceMin && a.priceMax === b.priceMax &&
  sj(a.districts) === sj(b.districts);
const periodAndAf = distinctPairs.filter(([l]) => l.startsWith('«سنوي') || l.startsWith('«شهري') || l.startsWith('AF:') || l.startsWith('«إيجار'));
const collapsedByOld = periodAndAf.filter(([, a, b]) => oldSameQuery(a, b)).length;
check(`the old comparison collapsed all ${periodAndAf.length} period/deal/AF cases (proof the fix is load-bearing)`,
  collapsedByOld === periodAndAf.length);

// ── B. ACCOUNT-AWARE PERSISTENCE (asserted against src/store.tsx) ───────────────────────────────
const store = readFileSync(new URL('../src/store.tsx', import.meta.url), 'utf8');
const stripped = store.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''); // ignore prose

check('B1. store uses the shared identity function (no second hand-rolled comparison)',
  /isSameSavedSearch/.test(stripped) && !/const sameQuery = \(a: SearchQuery, b: SearchQuery\) =>/.test(stripped));

// Logged-out refresh must not persist an anonymous search. Assert the RULE where it lives — inside
// the persistence effect — rather than hunting for a string anywhere in the file: the storage key is
// a local variable there, so a file-wide grep for historyKey('guest') silently misses the write that
// matters. (Caught by mutation-testing this barrier against the pre-fix code.)
const persistStart = store.indexOf('// Persist chats');
const persistBody = persistStart >= 0 ? store.slice(persistStart, store.indexOf('}, [history, user]);', persistStart)) : '';
check('B2. the persistence effect was located', persistBody.length > 0);
check('B2a. logged-out: the persistence effect returns early for a guest — nothing is written',
  /if \(!user\) return;/.test(persistBody));
check('B2b. logged-out: the persistence effect derives its key from a signed-in user ONLY',
  /historyKey\(user\.sub\)/.test(persistBody) && !/historyKey\(user \? user\.sub : 'guest'\)/.test(persistBody));
check("B2c. no code path anywhere writes the anonymous bucket",
  !/(setItem|multiSet)\([^;]*historyKey\((user \? user\.sub : )?'guest'/.test(stripped));
check('B3. logged-out: any pre-existing anonymous bucket is purged, not adopted',
  /removeKeysSync\(\[historyKey\('guest'\)\]\)/.test(stripped) ||
  /removeItem\(historyKey\('guest'\)\)/.test(stripped));

// Logged-in save + refresh survival.
check('B4. logged-in: history is persisted under the per-account key',
  /localStorage\.setItem\(historyKey\(user\.sub\), JSON\.stringify\(/.test(stripped));
check('B5. logged-in: star/delete write-through is also signed-in only',
  (stripped.match(/if \(user\) try \{/g) || []).length >= 2);
check('B6. refresh re-reads the account bucket on launch (history survives reload)',
  /AsyncStorage\.getItem\(key\)/.test(stripped));

// No cross-user leakage, and no stale state from another account.
check('B7. storage is keyed per account (never one shared history key)',
  /const historyKey = \(sub: string\) => 'history:' \+ sub;/.test(store));
check('B8. the legacy shared key is still purged (it was the cross-account leak)',
  /removeItem\(LEGACY_HISTORY_KEY\)/.test(stripped));
check('B9. hydration re-runs when the ACCOUNT changes, not once per mount',
  /historyLoadedRef = useRef<string \| null>\(null\)/.test(stripped) &&
  /historyLoadedRef\.current === \(key \?\? 'guest'\)/.test(stripped));
check('B10. switching account clears the previous account’s chats before loading',
  /setHistory\(\[\]\);/.test(stripped));
check('B11. an in-flight read cannot land under a different account',
  /if \(historyLoadedRef\.current !== key\) return;/.test(stripped));

// Reopening a saved entry must carry the FULL query (the sidebar hands the chat the whole thing).
const sidebar = readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');
check('B12. reopening a saved search replays the FULL stored query',
  /filter: JSON\.stringify\(c\.query\)/.test(sidebar));
check('B13. reopening a saved search restores its saved results snapshot (hid)',
  /hid: c\.id/.test(sidebar));
check('B14. the saved entry stores the whole query, not a summary',
  /query: SearchQuery;/.test(store));

console.log(failed === 0
  ? '\n✅ saved-search-identity: passed.'
  : `\n❌ saved-search-identity: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
