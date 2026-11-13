// A card prints the bath count the search index SERVES when the site's own box is empty (🔧 2026-11-10,
// card_parity_card_missing fkralemar/aqargate bathrooms — alerts 13687/13920, backlog 1684).
//
// The raw row the card is hydrated from carries the site's box; the index serves af_rule_b_num(box, seller's words)
// (Rule B). A customer who filtered «3 حمامات» reached fkralemar 13106990 / aqargate 10028937 whose cards showed NO
// bath count, because the box was empty and only the index knew the seller's figure. EXECUTES bathroomsForCard()
// (the rule the two card paths call) and pins both call sites in src/data/remote.ts.
//   node --experimental-strip-types scripts/verify-card-prints-the-bathrooms-the-index-serves.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bathroomsForCard, indexBathLookup, servedBathsFor } from '../src/lib/indexBathrooms.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean, detail = '') => check(`(mutation) catches ${label}`, caught, detail);

// The rule, executed.
check('an empty box takes the index\'s figure (fkralemar 13106990: NULL + 4 → 4)', bathroomsForCard(null, 4) === 4);
check('a 0 box (finalize collapses NULL to 0) takes the index\'s figure', bathroomsForCard(0, 3) === 3);
check('a box the site filled is the box, even when the index differs (card = source page)', bathroomsForCard(2, 5) === 2);
check('a conflict the index serves as unknown leaves an empty box empty (nothing invented)', bathroomsForCard(null, null) === null);
check('an index value that is not a count is ignored', bathroomsForCard(null, 'x') === null && bathroomsForCard(null, 2.5) === null && bathroomsForCard(null, -1) === null);
check('a numeric string from the index counts (PostgREST may hand smallint as a string)', bathroomsForCard(undefined, '3') === 3);

// Mutation: the pre-11-10 card (raw only) executed on the fkralemar row prints nothing.
const rawOnly = (raw: unknown, _served: unknown) => (typeof raw === 'number' && raw > 0 ? raw : null);
mustCatch('the raw-only card: it prints no bath count for an empty box the index fills', rawOnly(null, 4) === null && bathroomsForCard(null, 4) === 4);

// Both card paths call the rule.
const remote = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');
// 🔧 2026-11-11: the line above used to be pinned as `c.af_canon?.bathrooms` — and af_canon is NULL on every search
// without an Advanced-Filter answer (migration 20261104033508), so this check stayed green while squares 13602721
// (box empty, index 5) printed no bath count on the live card. The search path's figure is now decided by
// servedBathsFor(), EXECUTED here on exactly that case.
const lookup = indexBathLookup([
  { source_table: 'squares_residential_listings', listing_id: 13602721, bathrooms: 5 },
  { source_table: 'other_residential_listings', listing_id: 13602721, bathrooms: 9 },   // same id, another site
  { source_table: 'squares_residential_listings', listing_id: 1, bathrooms: null },
]);
const plainSearch = { source_table: 'squares_residential_listings', listing_id: 13602721, af_canon: null };
check('an ordinary Filter search (af_canon NULL) takes the index read\'s figure (squares 13602721: NULL + 5 → 5)',
  bathroomsForCard(null, servedBathsFor(plainSearch, lookup)) === 5);
check('the lookup is keyed by site AND id (another site\'s same id never leaks in)',
  servedBathsFor({ source_table: 'other_residential_listings', listing_id: 13602721, af_canon: null }, lookup) === 9
  && servedBathsFor({ source_table: 'third_residential_listings', listing_id: 13602721, af_canon: null }, lookup) === undefined);
check('an AF search keeps reading its own canonical row', servedBathsFor({ ...plainSearch, af_canon: { bathrooms: 3 } }, lookup) === 3);
check('a null index count is not a count', !lookup.has('squares_residential_listings:1'));
check('a failed index read (empty lookup) leaves the site\'s box: never a guessed count', bathroomsForCard(2, servedBathsFor(plainSearch, new Map())) === 2
  && bathroomsForCard(null, servedBathsFor(plainSearch, new Map())) === null);
const oldSearchPath = (c: { af_canon?: Record<string, unknown> | null }) => c.af_canon?.bathrooms;
mustCatch('the 11-10 search path (af_canon only): an ordinary search prints no bath count',
  bathroomsForCard(null, oldSearchPath(plainSearch)) === null && bathroomsForCard(null, servedBathsFor(plainSearch, lookup)) === 5);
check('the search path hands servedBathsFor() to the rule right where af_canon travels with the card',
  /l\.canon = c\.af_canon;[\s\S]{0,700}?const servedBaths = servedBathsFor\(c, servedBathLookup\);[^\n]*\n\s*l\.bathrooms = bathroomsForCard\(l\.bathrooms, servedBaths\) \?\? 0;/.test(remote));
check('the index read starts BESIDE the card reads (no added wait) and is bounded',
  /const servedBathsP = indexBathsForSearch\(cleanCands\.filter\(\(c\) => !c\.af_canon\), signal\);\s*\n\s*let fetched/.test(remote)
  && /await bounded<IndexBathRow\[\]>\(supabase\.from\('search_listings_ar'\)\.select\('source_table,listing_id,bathrooms'\)/.test(remote));
check('the in-app ad page\'s sibling cards read the index\'s bathrooms with the Arabic place and hand it to the rule',
  /select\('listing_id,region_ar,city_ar,district_ar,bathrooms[,']/.test(remote) && /r\.bathrooms = bathroomsForCard\(r\.bathrooms, bathsById\.get\(Number\(r\.id\)\)\) \?\? 0;/.test(remote));
check('the rule is imported from one module', /import \{ bathroomsForCard, indexBathLookup, servedBathsFor, type IndexBathRow \} from '@\/lib\/indexBathrooms';/.test(remote));

if (failed) { console.error(`\n❌ verify-card-prints-the-bathrooms-the-index-serves: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-card-prints-the-bathrooms-the-index-serves: an empty bath box prints the figure the index serves.');
