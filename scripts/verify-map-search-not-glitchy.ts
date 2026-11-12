// THE MAP SEARCH BOX IS NOT GLITCHY (owner 2026-11-10: «the search can be a bit glitchy, it's a bit annoying, not nice
// … test after each other»). Three defects measured live on ezhalah.com (390×844) the same day, each pinned here:
//  1. a new search kept the OLD list under the new words for 0.75-1.1 s;
//  2. the list waited for the slowest of 8 look-ups, up to 1.5 s;
//  3. a tap held 0.35 s on a suggestion lost the list (blur closed it first) and picked nothing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hitsToShow, RESOLVE_BUDGET_MS, makeSuggestCache, suggestKey } from '../src/lib/placeSearch.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => check(`(mutation) catches ${name}`, caught);

// 1. A list shows only under the words it was found for (or words that refine them).
const narjis = { q: 'حي النرجس', rows: ['النرجس · الرياض'] };
check('the list found for «حي النرجس» shows while «حي النرجس» is typed', hitsToShow('حي النرجس', narjis).length === 1);
check('typing a different place hides it at once (live: 0.75 s of wrong rows)', hitsToShow('الخبر', narjis).length === 0 && hitsToShow('riyadh park', { q: 'الخبر', rows: ['x'] }).length === 0);
check('typing on (refining) keeps the rows until the new ones arrive', hitsToShow('الخبر', { q: 'الخب', rows: ['x'] }).length === 1);
check('deleting back to shorter words hides rows found for longer words', hitsToShow('الخب', { q: 'الخبر', rows: ['x'] }).length === 0);
check('spaces and case do not matter', hitsToShow(' Riyadh  Park', { q: 'riyadh park', rows: ['x'] }).length === 1);
check('one typed letter is not a refinement of anything', hitsToShow('ا', { q: 'ا', rows: ['x'] }).length === 1 && hitsToShow('اب', { q: 'ا', rows: ['x'] }).length === 0);
mustCatch('the old list shown under new words', hitsToShow('الخبر', narjis).length === 0);

// 2. A row waits at most RESOLVE_BUDGET_MS for its details; recent answers come back at once.
check('a row waits at most 600 ms for its kind tag (was 1,500)', RESOLVE_BUDGET_MS <= 600);
const c = makeSuggestCache<string[]>(2);
c.set('a', ['1']); c.set('b', ['2']); c.get('a'); c.set('c', ['3']);
check('the cache keeps recent answers and drops the oldest', c.get('b') === undefined && c.get('c')?.[0] === '3' && c.size() === 2);
const view = (lat: number, lng: number, d: number) => ({ center: { latitude: lat, longitude: lng }, span: { latitudeDelta: d, longitudeDelta: d } });
check('the cache key ignores spacing and a tiny pan, not the language', suggestKey('الخبر ', 'ar', view(26.21, 50.2, 0.3)) === suggestKey('الخبر', 'ar', view(26.22, 50.21, 0.3)) && suggestKey('الخبر', 'ar') !== suggestKey('الخبر', 'en'));
check('a zoom changes the key (Apple ranks around the view; review of #11635)', suggestKey('مول', 'ar', view(24.7, 46.7, 16)) !== suggestKey('مول', 'ar', view(24.7, 46.7, 0.05)));
check('a pan of more than half a view changes the key', suggestKey('مول', 'ar', view(24.70, 46.70, 0.1)) !== suggestKey('مول', 'ar', view(24.70, 46.90, 0.1)) && suggestKey('x', 'en', view(24.7, 46.7, 2)) !== suggestKey('x', 'en', view(21.5, 39.2, 2)));
mustCatch('a key on the centre alone (a Kingdom-wide answer reused inside one district)', suggestKey('مول', 'ar', view(24.7, 46.7, 16)) !== suggestKey('مول', 'ar', view(24.7, 46.7, 0.05)));

// Wiring: the web search uses the budget and the cache, and never remembers an empty (maybe failed) answer.
const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
check('suggestPlaces waits RESOLVE_BUDGET_MS per row, not 1,500 ms', /setTimeout\(\(\) => resolve\(r\), RESOLVE_BUDGET_MS\)/.test(web) && !/resolve\(r\), 1500\)/.test(web));
check('suggestPlaces answers from the cache and stores only non-empty answers', /const cached = suggestCache\.get\(key\);\n\s*if \(cached\) return \{ rows: cached, failed: false \};/.test(web) && /if \(rows\.length\) suggestCache\.set\(key, out\);/.test(web));

// 3. The field: rows remember their words, and a finger on a suggestion keeps the list open through the blur.
const f = readFileSync(join(root, 'src/components/MapDealRow.tsx'), 'utf8');
check('the field shows hitsToShow(q, found), never a list kept from other words', /const hits = hitsToShow\(q, found\);/.test(f) && /setHits\(r\.rows, q\)/.test(f));
check('the press flag clears whenever the list changes (a row that vanished mid-press never calls onPressOut)', /useEffect\(\(\) => \{ pressing\.current = false; \}, \[found\]\);/.test(f));
check('suggestPlaces keys its cache on the whole view (centre AND span)', /suggestKey\(query, language, live\.map\?\.region\)/.test(web));
check('a press on a suggestion holds the list open through the field\'s blur', /onPressIn=\{\(\) => \{ pressing\.current = true; \}\}/.test(f) && /onBlur=\{\(\) => setTimeout\(\(\) => \{ if \(!pressing\.current\) setFocused\(false\); \}, 150\)\}/.test(f));
mustCatch('a blur that closes the list under a finger (the lost 0.35 s tap)', !/onBlur=\{\(\) => setTimeout\(\(\) => setFocused\(false\), 150\)\}/.test(f));
check('a picked place keeps the words the list showed (no jump to Apple\'s raw line)', /setValue\(p\.name \?\? p\.displayLines\[0\]\)/.test(f) && /value=\{from \? \(from\.name \?\? from\.displayLines\[0\]\) : ''\}/.test(f));

console.log(failed ? `\n❌ verify-map-search-not-glitchy: ${failed} check(s) failed` : '\nverify-map-search-not-glitchy: the list belongs to its words, comes fast, and a tap always lands');
process.exit(failed ? 1 : 0);
