// «NO RESULTS» MUST ALWAYS BE TRUE (owner 2026-10-05: «how can we never get this issue — or anything
// like it»). After «حي الملك» told a user «ما لقينا نتائج» while ~1,700 listings existed, four guards:
//
//   1. THE SHELF CHECK (src/lib/shelfCheck.ts, wired in store.tsx runQuery): a place-only search
//      whose place we KNOW holds listings never shows «none» — it asks again, then words it as our
//      failure («try again»), reports it to Sentry and notes it.
//   2. RIGHT PLACE ONLY (src/data/locations.ts liveDistrictLookup): spell-check never "corrects" a
//      word that exists, and a correction must land on ONE word — never a fan-out to other districts.
//   3. The nightly fake customer (.github/workflows/live-search-sweep.yml) — separate.
//   4. THE NOTEBOOK (src/data/zeroResultLog.ts → ops_zero_result_log): every zero a user sees is
//      noted for the nightly 🔧 re-check (docs/ops/QUALITY_REPAIR_ENGINEER.md).
//
// EXECUTED, hermetic: the REAL resolveLocation()/liveShelfCount() are bundled with esbuild (supabase
// stubbed to serve a fixture location index, i18n stubbed) and run; the real shelfCheck is imported.
// Mutation proofs rebuild from a tmpdir copy — no repo file is ever written.
//
//   node --experimental-strip-types scripts/verify-zero-never-contradicts-shelf.ts   (in `npm test`)
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bundleResolver, type Resolver } from './lib/bundleResolver.ts';
import { windowBetween } from './lib/sourceWindow.ts';
import { NARROWING, shelfCount, zeroContradictsShelf, SHELF_FLOOR } from '../src/lib/shelfCheck.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

// ── fixture location index: real production spellings ───────────────────────────────────────────
const row = (district: string, city: string, n: number) => ({ district, city, region: city === 'Dammam' ? 'Eastern Province' : 'Riyadh', n });
// «حي الملك» spans several cities in production (the multi-city resolver branch) — mirrored here.
const FIXTURE = [
  row('حي الملك فهد', 'Dammam', 300),
  row('حي الملك فهد', 'Riyadh', 900), row('حي الملك عبدالله', 'Riyadh', 500), row('الملك فيصل', 'Riyadh', 296),
  row('حي الملقا', 'Riyadh', 3000), row('حي الملز', 'Riyadh', 800), row('حي السلي', 'Riyadh', 200),
  row('حي الأمل', 'Riyadh', 150), row('حي المها', 'Riyadh', 40), row('حي العمل', 'Riyadh', 60),
  row('حي الياسمين', 'Riyadh', 1200), row('الياسمين', 'Riyadh', 300),
  row('حي الريان', 'Riyadh', 400), row('حي الريحان', 'Riyadh', 90),
  // live-only names (not in the catalog), so they reach the spell-check path: one word is a typo-distance from the other
  row('حي الزبرجد', 'Riyadh', 70), row('حي الياقوته', 'Riyadh', 70), row('حي الياقوتي', 'Riyadh', 30),
  // production pair: a town read out of «ام الحمام» scoped the search to خميس مشيط, where «الغربي» matched
  row('حي ام الحمام الغربي', 'Riyadh', 161), row('ذهبان الغربي', 'Khamis Mushait', 20),
  // a district that shares its name with a TOWN in the catalog (العقيق, Al Baha) — the 2026-10-05 sweep's #1 loss
  row('حي العقيق', 'Riyadh', 1545), row('حي العقيق', 'Khobar', 408),
  row('Al Tayebat', 'Al Aqiq', 6), row('Al Iskan', 'Al Aqiq', 1), // the town itself has listings, as in production
];

const loadResolver = (srcRoot: string): Promise<Resolver> => bundleResolver(srcRoot, FIXTURE);

const NOT_KING = ['حي الملقا', 'حي الملز', 'حي السلي', 'حي الأمل', 'حي المها', 'حي العمل'];
const placeProblems = (r: Resolver): string[] => {
  const out: string[] = [];
  const king = r.resolveLocation('حي الملك', 'ar');
  if (!king.districts.length || king.districts.some((d) => !d.includes('الملك'))) out.push(`«حي الملك» searched ${JSON.stringify(king.districts)}`);
  for (const w of NOT_KING) if (king.districts.includes(w)) out.push(`«حي الملك» pulled in a different district «${w}»`);
  const typo = r.resolveLocation('حي الياسمن', 'ar');
  if (!typo.districts.length || typo.districts.some((d) => !d.includes('الياسمين'))) out.push(`typo «الياسمن» no longer recovers ONLY «الياسمين»: ${JSON.stringify(typo.districts)}`);
  const real = r.resolveLocation('حي الياقوته', 'ar');
  if (!real.districts.includes('حي الياقوته') || real.districts.includes('حي الياقوتي')) out.push(`«الياقوته» exists, yet spell-check "corrected" it to «الياقوتي» too: ${JSON.stringify(real.districts)}`);
  const umm = r.resolveLocation('حي ام الحمام الغربي', 'ar');
  if (!umm.districts.includes('حي ام الحمام الغربي')) out.push(`«حي ام الحمام الغربي» (Riyadh) was scoped to a town read out of its name: ${umm.city} ${JSON.stringify(umm.districts)}`);
  const aqiq = r.resolveLocation('حي العقيق', 'ar');
  if (aqiq.kind !== 'district' || !aqiq.districts.includes('حي العقيق')) out.push(`«حي العقيق» (Riyadh, 1,545) was read as the town العقيق: ${aqiq.kind} ${JSON.stringify(aqiq.districts)}`);
  const zab = r.resolveLocation('حي الزبرجد', 'ar');
  if (!zab.districts.includes('حي الزبرجد')) out.push(`«حي الزبرجد» was scoped to the town «الزبر» hidden in its name: ${zab.kind} ${zab.city}`);
  const town = r.resolveLocation('العقيق', 'ar');
  if (town.kind !== 'city') out.push(`a bare city name «العقيق» (no «حي») must stay the city (EXACT LOCATION ONLY): got ${town.kind}`);
  const twoWay = r.resolveLocation('حي الريهان', 'ar');
  if (twoWay.districts.some((d) => d.includes('الريحان') || d.includes('الريان'))) out.push(`«الريهان» could be الريحان OR الريان — a guess was searched: ${JSON.stringify(twoWay.districts)}`);
  return out;
};

// ── 1. Guard 2, executed on the real resolver ────────────────────────────────────────────────────
const real = await loadResolver(ROOT);
const rp = placeProblems(real);
check('right place only: a real word is never "corrected", a typo fixes to ONE word, «الملك» never fans out', rp.length === 0, rp.join('\n      '));
const kingLm = real.resolveLocation('حي الملك', 'ar');
check('the location index counts the shelf for exactly the districts searched', real.liveShelfCount(kingLm, kingLm.districts) === 1996,
  `got ${real.liveShelfCount(kingLm, kingLm.districts)}`);

// ── 2. Guard 1, the real shelf check ─────────────────────────────────────────────────────────────
const exactLm = { exact: true };
const base = { locationMatch: exactLm, districtListingCount: 1696 };
check('a place-only zero against a stocked shelf is a contradiction', zeroContradictsShelf(shelfCount(base, null)));
check('…but a price filter can make a TRUE zero — the shelf stays silent', shelfCount({ ...base, priceMax: '500000' }, null) === null);
check('…and «not new» (false) is a filter, not an empty field', shelfCount({ ...base, isNewConstruction: false }, null) === null);
check('a fuzzy place guess never counts as the place', shelfCount({ ...base, locationMatch: { exact: true, fuzzy: true } }, null) === null);
check('the all-deal index never speaks for a Buy-only search', shelfCount({ locationMatch: exactLm }, 1696) === null);
check('…nor for a category-scoped one', shelfCount({ locationMatch: exactLm, bothDeals: true, category: 'Commercial' }, 1696) === null);
check('…but does for a deal-agnostic, place-only chat search', zeroContradictsShelf(shelfCount({ locationMatch: exactLm, bothDeals: true }, 1696)));
check(`a shelf under ${SHELF_FLOOR} never raises an alarm (count drift)`, !zeroContradictsShelf(shelfCount({ ...base, districtListingCount: SHELF_FLOOR - 1 }, null)));

// Every SearchQuery field must be classified, or a NEW filter would let the shelf call a true zero false.
const SRC_SEARCH = readFileSync(join(ROOT, 'src/data/search.ts'), 'utf8');
const fields = [...windowBetween(SRC_SEARCH, 'export type SearchQuery = {', '\n};', 'src/data/search.ts').matchAll(/^ {2}([a-zA-Z]+)\??:/gm)].map((m) => m[1]);
const NOT_NARROWING = ['deal', 'location', 'category', 'bothDeals', 'priceIsAnnual', 'rentPeriod', 'dealCombined', 'locationMatch',
  'regionPin', 'priceOriginal', 'sort', 'count', 'districts', 'districtLabel', 'districtListingCount', 'afFacets'];
const unclassified = fields.filter((f) => !(NARROWING as readonly string[]).includes(f) && !NOT_NARROWING.includes(f));
check(`every one of the ${fields.length} SearchQuery fields is classified narrowing / not`, fields.length > 40 && unclassified.length === 0,
  `unclassified: ${unclassified.join(', ')} — add each to NARROWING in src/lib/shelfCheck.ts (or NOT_NARROWING here, if it can never make a true zero)`);

// ── 3. wiring: the shared runner uses it, a clash is worded as a failure, every zero is noted ────
const STORE = readFileSync(join(ROOT, 'src/store.tsx'), 'utf8');
const wired = (s: string) => /zeroContradictsShelf\(shelf\)[\s\S]{0,900}fetchFailed: rows === null \|\| shelfClash/.test(s)
  // the notebook notes the zero the USER SEES (after runSearch's client filters), not just an empty fetch
  && /const r = runSearch\([\s\S]{0,600}if \(rows !== null && r\.listings\.length === 0 && !signal\?\.aborted\) logZeroResult\(q, shelf, shelfClash\)/.test(s);
check('store.runQuery checks the shelf, words a clash as a failure and notes every zero', wired(STORE));

// ── mutation proofs ──────────────────────────────────────────────────────────────────────────────
const LOC = 'src/data/locations.ts';
const mustCatch = async (what: string, from: string, to: string) => {
  const src = readFileSync(join(ROOT, LOC), 'utf8');
  if (!src.includes(from)) { failed++; console.log(`FAIL  mutation anchor missing: ${what}`); return; }
  const dir = mkdtempSync(join(tmpdir(), 'shelf-mut-'));
  cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, LOC), src.replace(from, to));
  const caught = placeProblems(await loadResolver(dir)).length > 0;
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
await mustCatch('a town name read out of «حي X» beating the district (no exact-name rescue)',
  'return DISTRICT_MARKER.test(raw) ? namedExactly() : [];', 'return [];');
await mustCatch('a town found inside the text scoping away the district named exactly that',
  'if (named.length && !named.some(inTown)) return named;', '');
const ONE_WORD = 'if (!out.length && new Set(typoHits.map((h) => h.word)).size === 1)';
await mustCatch('spell-check "correcting" a word that exists', ONE_WORD, 'if (new Set(typoHits.map((h) => h.word)).size === 1)');
await mustCatch('a typo fanning out to two different words', ONE_WORD, 'if (!out.length && new Set(typoHits.map((h) => h.word)).size >= 1)');
const AGENT = readFileSync(join(ROOT, 'src/app/agent.tsx'), 'utf8');
check('the chat\'s location-probe «no results» is noted too', /probe\.listings && probe\.listings\.length === 0\) logZeroResult\(buildLocationProbeQuery\(turn\.query\)/.test(AGENT));
const fetchLevel = STORE.replace('if (rows !== null && r.listings.length === 0 && !signal?.aborted) logZeroResult(q, shelf, shelfClash);', '')
  .replace('const r = runSearch(', 'if (rows && rows.length === 0) logZeroResult(q, shelf, shelfClash);\n        const r = runSearch(');
const caughtFetchLevel = !wired(fetchLevel);
if (!caughtFetchLevel) failed++;
console.log(`${caughtFetchLevel ? 'PASS' : 'FAIL'}  (mutation) catches a notebook that only notes an EMPTY FETCH (missed «فيلا … بسعر 5000», 2026-10-05)`);
const unwired = STORE.replace('fetchFailed: rows === null || shelfClash', 'fetchFailed: rows === null');
const caughtWire = !wired(unwired);
if (!caughtWire) failed++;
console.log(`${caughtWire ? 'PASS' : 'FAIL'}  (mutation) catches a shelf clash shown as «no results»`);

console.log(failed === 0
  ? '\n✅ «no results» is only ever said when it is true — and every one is noted.\n'
  : `\n❌ ${failed} check(s) failed — a user can be told «no results» when we have listings.\n`);
process.exit(failed === 0 ? 0 : 1);
