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
import { bathroomsForCard } from '../src/lib/indexBathrooms.ts';

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
check('the search path hands the index row\'s bathrooms to the rule right where af_canon travels with the card',
  /l\.canon = c\.af_canon;[\s\S]{0,700}?const servedBaths = c\.af_canon\?\.bathrooms;[^\n]*\n\s*l\.bathrooms = bathroomsForCard\(l\.bathrooms, servedBaths\) \?\? 0;/.test(remote));
check('the in-app ad page\'s sibling cards read the index\'s bathrooms with the Arabic place and hand it to the rule',
  /select\('listing_id,region_ar,city_ar,district_ar,bathrooms'\)/.test(remote) && /r\.bathrooms = bathroomsForCard\(r\.bathrooms, bathsById\.get\(Number\(r\.id\)\)\) \?\? 0;/.test(remote));
check('the rule is imported from one module', /import \{ bathroomsForCard \} from '@\/lib\/indexBathrooms';/.test(remote));

if (failed) { console.error(`\n❌ verify-card-prints-the-bathrooms-the-index-serves: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-card-prints-the-bathrooms-the-index-serves: an empty bath box prints the figure the index serves.');
