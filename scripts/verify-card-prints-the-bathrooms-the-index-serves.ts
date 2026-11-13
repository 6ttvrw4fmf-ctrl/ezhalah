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
  /l\.canon = c\.af_canon;[\s\S]{0,700}?const servedBaths = c\.af_canon \? c\.af_canon\.bathrooms : indexBaths\.get\([^\n]*\n\s*l\.bathrooms = bathroomsForCard\(l\.bathrooms, servedBaths\) \?\? 0;/.test(remote));
check('the in-app ad page\'s sibling cards read the index\'s bathrooms with the Arabic place and hand it to the rule',
  /select\('listing_id,region_ar,city_ar,district_ar,bathrooms[,']/.test(remote) && /r\.bathrooms = bathroomsForCard\(r\.bathrooms, bathsById\.get\(Number\(r\.id\)\)\) \?\? 0;/.test(remote));
// 🔧 2026-11-13: a PLAIN search carries no af_canon (the payload gate), so `c.af_canon?.bathrooms` alone left the
// rule nothing to read and aqarcity 5720470 / squares 13602721 / aqargate 10028936 printed no bath count on the live
// card (card_parity_card_missing, still raised 11-12 after the 11-10 fix). The search path must fall back to the
// page's own index read when af_canon is absent.
check('a plain search (no af_canon) reads the index bath count for the page, in parallel with the raw cards',
  /const needIndexBaths = !cleanCands\.some\(\(c\) => c\.af_canon\);\s*\n\s*const baths = needIndexBaths \? indexBathsForPage\(entries, signal\)/.test(remote)
  && /fetched = await Promise\.all\(entries\.map\(\(\[tbl, ids\]\) => fetchRawByIds\(q, tbl, ids, signal\)\)\);[\s\S]{0,200}?const indexBaths = await baths;/.test(remote));
check('the served figure falls back to that read when af_canon is absent',
  /const servedBaths = c\.af_canon \? c\.af_canon\.bathrooms : indexBaths\.get\(`\$\{c\.source_table\}:\$\{c\.listing_id\}`\);/.test(remote));
check('the page read is bounded, chunked like the raw read, and a failure is reported (never read as «no baths»)',
  /export async function indexBathsForPage\([\s\S]{0,1400}?ID_CHUNK[\s\S]{0,600}?bounded\(supabase!\.from\('search_listings_ar'\)\.select\('listing_id,bathrooms'\)[\s\S]{0,700}?reportMessage\('indexBathsForPage/.test(remote));
// Mutation: the 11-10 shape (af_canon only) on a plain-search candidate prints nothing; the fallback prints the index's.
{
  const cand = { source_table: 'aqarcity_residential_listings', listing_id: 5720470, af_canon: null as Record<string, unknown> | null };
  const page = new Map<string, unknown>([['aqarcity_residential_listings:5720470', 3]]);
  const old = bathroomsForCard(null, cand.af_canon?.bathrooms);
  const now = bathroomsForCard(null, cand.af_canon ? cand.af_canon.bathrooms : page.get(`${cand.source_table}:${cand.listing_id}`));
  mustCatch('the af_canon-only card on a plain search (aqarcity 5720470: NULL box, index 3 → printed nothing)', old === null && now === 3);
}
check('the rule is imported from one module', /import \{ bathroomsForCard \} from '@\/lib\/indexBathrooms';/.test(remote));

if (failed) { console.error(`\n❌ verify-card-prints-the-bathrooms-the-index-serves: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-card-prints-the-bathrooms-the-index-serves: an empty bath box prints the figure the index serves.');
