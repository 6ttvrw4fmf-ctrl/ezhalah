// THE LIVE SWEEP MUST KEEP ITS COVERAGE — nobody may quietly shrink it.
//
// The owner made the live browser sweep a permanent layer of the Senior Search & Matching routine
// precisely because static barriers are blind to what a browser renders. But a scheduled sweep rots
// in a way a unit test does not: a floor gets lowered "temporarily", a journey kind gets commented
// out after a flaky night, a watch for a fixed defect is deleted with the defect. Six months later
// the job is still green and covers a third of what it claims.
//
// So the SHAPE of the sweep is itself a contract, asserted here, hermetically (no browser, no
// network — this runs inside `npm test` on every PR):
//   1. every journey kind the owner listed still exists and is still called by the runner
//   2. the minimum coverage floors are still present and none has been lowered
//   3. every permanent watch for a 2026-08-23 defect is still declared AND still recorded
//   4. the six-layer comparison is still what decides pass/fail (not "did the click work")
//   5. the scheduled workflow still runs it on a schedule, against production, read-only
//
//   node --experimental-strip-types scripts/verify-live-sweep-coverage-contract.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const sweep = read('e2e/live-sweep/sweep.mjs');
const vstate = read('e2e/live-sweep/visibleState.mjs');
const journeys = read('e2e/live-sweep/journeys.mjs');
const runner = read('e2e/live-sweep/run.mjs');
const wf = read('.github/workflows/live-search-sweep.yml');

console.log('\nThe live browser sweep must keep the coverage the owner specified\n');

// ── 1. every journey kind still exists AND is actually called ───────────────────────────────────
const KINDS = ['normalFilter', 'trendingCity', 'trendingDistrict', 'advancedFilter',
               'zeroResult', 'cardClickBack', 'tabHistory', 'typedDistrict', 'clearAll'];
for (const k of KINDS) {
  check(`journey «${k}» is implemented`, new RegExp(`export async function ${k}\\b`).test(journeys));
  check(`journey «${k}» is actually run by the runner`, new RegExp(`\\b${k}\\(`).test(runner),
    'an implemented-but-uncalled journey is zero coverage');
}

// «عرض المزيد» lives in its own module, so the KINDS loop above (which reads journeys.mjs) does not
// reach it. Without these three the floor alone guards it — and a floor only fails at RUNTIME, after
// a full sweep; the point of this barrier is to catch the narrowing at review time instead.
const showMore = read('e2e/live-sweep/showmore.mjs');
check('journey «showMoreJourney» is implemented',
  /export async function showMoreJourney\b/.test(showMore));
check('journey «showMoreJourney» is imported by the runner',
  /import\s*\{[^}]*\bshowMoreJourney\b[^}]*\}\s*from\s*'\.\/showmore\.mjs'/.test(runner));
check('journey «showMoreJourney» is actually run by the runner',
  /\bshowMoreJourney\s*\(/.test(runner),
  'an implemented-but-uncalled journey is zero coverage — §10 needs the pager CLICKED');

// The two assertions that make the journey worth running at all: filters must survive every batch,
// and the browse-cap message must still quote the TRUE total rather than the cap.
check('the «عرض المزيد» journey asserts filter persistence across batches',
  /FILTER-PERSISTENCE/.test(showMore),
  'a pager journey that does not re-check the filters proves only that a button is clickable');
// CONTRACT CHANGE (owner 2026-08-29): the lifetime cap is gone — the journey now asserts BOTH that
// a missing pager while matches remain is a defect (PAGER-MISSING) and that any total the closing
// line quotes is the search's true total (TRUE-TOTAL). Same honesty, new continuation shape.
check('the «عرض المزيد» journey asserts continuation (pager present while matches remain) + true totals',
  /TRUE-TOTAL/.test(showMore) && /PAGER-MISSING/.test(showMore),
  'the continuation is only honest while a missing pager with matches remaining is a defect');

// ── 2. the floors, at or above the values the owner set ─────────────────────────────────────────
const REQUIRED_FLOORS: Record<string, number> = {
  nonRiyadhCities: 3, mobileJourneys: 1, afJourneys: 1, trendingCityJourneys: 1,
  trendingDistrictJourneys: 1, buyRentJourneys: 1, monthlyJourneys: 1,
  zeroResultJourneys: 1, cardClickBackJourneys: 1,
  // §10 — «عرض المزيد» actually clicked in production every run. Added 2026-08-27: the sweep's ten
  // journeys covered normal-filter, trending, AF, honest-zero, card→back and clear-all, but nothing
  // clicked the pager, so the one daily requirement the static barriers CANNOT stand in for had no
  // browser evidence behind it. Pinned here so it cannot quietly disappear the way it never appeared.
  showMoreJourneys: 1,
};
const floorBlock = sweep.slice(sweep.indexOf('export const FLOORS'), sweep.indexOf('export const WATCHES'));
for (const [name, min] of Object.entries(REQUIRED_FLOORS)) {
  const m = floorBlock.match(new RegExp(`${name}:\\s*(\\d+)`));
  const actual = m ? Number(m[1]) : NaN;
  check(`floor ${name} >= ${min}`, Number.isFinite(actual) && actual >= min,
    m ? `declared ${actual}` : 'floor missing entirely');
}
check('the runner ENFORCES the floors (a short run fails, it does not just warn)',
  /floorMisses\.length/.test(runner) && /process\.exit\(findings\.length \|\| floorMisses\.length \? 1 : 0\)/.test(runner),
  'a sweep that silently covers less than the floor is how rotation rots');

// ── 3. the permanent watches for the 2026-08-23 defects ─────────────────────────────────────────
const WATCHES = ['exact-city-never-rescoped', 'monthly-af-counts-update', 'true-total-never-page-cap',
  'buyrent-summary-both-budgets', 'unknown-period-stays-unknown', 'no-html-entities-rendered',
  'typed-district-not-dropped', 'clarification-answer-commits', 'tab-switch-no-junk-history'];
for (const w of WATCHES) {
  check(`watch «${w}» is still declared`, sweep.includes(`'${w}'`),
    'this watch exists because that exact defect was live in production on 2026-08-23');
}
check('watch results are written back to the ledger', /ledgerRecord\('live_watch'/.test(runner));
// The three watches that are asserted inline rather than by a named probe.
check('exact-city-never-rescoped is asserted on EVERY journey (INTENT→UI)',
  /exact city .* was re-scoped to district/.test(sweep) && /INTENT→UI/.test(sweep));
check('true-total-never-page-cap is asserted against the 1,500 page limit',
  /rendered === 1500/.test(sweep));
// The rendered-text watches live in the pure parser module (extracted 2026-08-28 so the summary
// scoping could be unit-tested and mutation-proven offline — see visibleState.mjs). They are still
// asserted by the sweep; assert them WHERE THEY ARE, so the extraction cannot quietly drop one.
check('no-html-entities-rendered is asserted from the RENDERED text',
  /entities/.test(sweep) && /&\(\?:bull\|quot/.test(vstate));
check('the UI-state parse is the pure module the offline barrier can prove',
  /from '\.\/visibleState\.mjs'/.test(sweep) && /parseVisibleState\(await page\.evaluate/.test(sweep),
  'an in-page slice cannot be unit-tested, and the one that could not be tested read ad copy as app state');

// ── 4. the six-layer comparison is what decides ─────────────────────────────────────────────────
for (const pair of ['INTENT→UI', 'UI→REQUEST', 'RPC→DB', 'RPC→RENDERED']) {
  check(`the sweep can fail on ${pair}`, sweep.includes(pair),
    'clicking a control is never the assertion — adjacent layers must be compared');
}
check('DB truth comes from PostgREST filter operators, not the app\'s own SQL',
  /rest\/v1\/search_listings_ar\?select=listing_id/.test(sweep) && /Prefer: 'count=exact'|Prefer: "count=exact"|Prefer: `count=exact`/.test(sweep.replace(/Prefer: 'count=exact'/g, "Prefer: 'count=exact'")),
  'an oracle built from the function under test proves nothing');
check('the RPC layer replays the app\'s OWN captured request body',
  /rpcTotal = async \(body\)/.test(sweep) && /requests\.filter\(\(r\) => \(r\.p_limit \?\? 0\) > 1\)/.test(sweep));

// ── 4b. the sweep must RECOGNISE every terminal state production can render ─────────────────────
// A journey that cannot see the screen it landed on hangs until its timeout and dies, and a dead
// journey takes a COVERAGE FLOOR with it — the run fails while production is perfectly healthy.
//
// That is not hypothetical. Until 2026-08-26 the settle predicate was /لقينا|ما لقينا|ما فيه/,
// which does not match «ما لقيت …». Production answers an honest zero inside a selected حي with
// «ما لقيت نتائج في الحي المحدد — …تبيني أوسّع المنطقة؟» (correct: it OFFERS to widen, never widens
// silently), so every district-scoped journey landing on an honest zero hung for 70 s. It killed the
// trending-district journey on بقعاء and failed the whole sweep on a missed floor, while that city
// searched perfectly (سكني/بيع/بقعاء → «لقينا 87 إعلان»).
//
// So the predicate is PINNED against the product's own user-facing strings: every «لقينا …» result
// headline and every zero/widening-offer message in src/i18n.tsx must be recognised. A new phrasing
// shipping tomorrow fails HERE, in npm test, instead of silently costing a floor months later.
// Widening this predicate can never mask a defect — it only decides when to STOP waiting; the
// six-layer assertChain still judges what was found.
const i18n = read('src/i18n.tsx');
const arabicTerminalPhrases = [...i18n.matchAll(/'((?:لقينا|ما لقيت|ما لقينا|ما فيه)[^']*)'/g)]
  .map((m) => m[1])
  .filter((s) => !/محادثة/.test(s));   // «ما لقينا محادثة بهذا الاسم» is sidebar chat search, not a results state
check('the sweep declares ONE shared settle predicate (not a copy per journey)',
  /export const SETTLED_RE/.test(sweep)
  && !/\/لقينا\|ما لقينا\|ما فيه\//.test(sweep + journeys),
  'two hand-maintained copies is how one of them silently rots');
check('every journey waits on that shared predicate',
  (sweep.match(/SETTLED_RE\.source/g) ?? []).length + (journeys.match(/SETTLED_RE\.source/g) ?? []).length >= 2);
check('the product actually publishes terminal phrasings to check against',
  arabicTerminalPhrases.length >= 6, `found ${arabicTerminalPhrases.length} in src/i18n.tsx`);
{
  const m = sweep.match(/export const SETTLED_RE = (\/[^\n]*?\/);/);
  const re = m ? new RegExp(m[1].slice(1, -1)) : null;
  const unseen = re ? arabicTerminalPhrases.filter((p) => !re.test(p)) : arabicTerminalPhrases;
  check('the settle predicate recognises EVERY result/zero state src/i18n.tsx can render',
    re != null && unseen.length === 0,
    unseen.length ? `unrecognised → the sweep would hang on:\n      ${unseen.slice(0, 4).join('\n      ')}` : 'could not parse SETTLED_RE');
  // MUTATION — the pre-2026-08-26 predicate must FAIL this check.
  const old = /لقينا|ما لقينا|ما فيه/;
  check('MUTATION: the old predicate is rejected (it could not see «ما لقيت …»)',
    arabicTerminalPhrases.some((p) => !old.test(p)),
    'if nothing fails the old regex this check has stopped proving anything');
}

// ── 4c. the rotation must not lose a journey (and a FLOOR) to a legitimate refusal ──────────────
// The city field's pool is deal+category scoped BY DESIGN, so a city stocking only بيع is correctly
// not offered on an إيجار search. Pairing a city with a deal it does not stock therefore loses the
// journey to correct product behaviour — and takes a coverage floor with it. 2026-08-26: الدليمية
// (22 listings, ALL بيع, zero إيجار/سنوي) drew «إيجار/سنوي», was rightly not offered, and the run
// failed on «non-Riyadh cities: 2 < 3» while production was healthy. The floor is not the problem
// and must NOT be lowered — the pairing is.
check('the rotation pairs a city only with a deal it actually stocks',
  /deal_ar,rent_period_ar/.test(runner) && /dealsOf/.test(runner),
  'blind city×deal pairing loses journeys to correct refusals and fails the run on a missed floor');
check('deal availability is read from the live index, never hardcoded',
  /search_listings_ar\?select=city_ar,region_ar,deal_ar,rent_period_ar/.test(runner));
check('the floors themselves were NOT lowered to make the run pass',
  /nonRiyadhCities:\s*3/.test(sweep) && /trendingDistrictJourneys:\s*1/.test(sweep)
  && /mobileJourneys:\s*1/.test(sweep) && /cardClickBackJourneys:\s*1/.test(sweep),
  'lowering a floor is the forbidden way to turn this run green');

// A SKIPPED journey is not coverage. Recording it as 'pass' refreshes the city in the stalest-first
// ledger, so a city the sweep never manages to reach reads as permanently well-covered.
check('only a journey that actually RAN is written to the coverage ledger',
  /if \(ran\) \{/.test(runner) && /const ran = await run\(/.test(runner),
  'recording a skip as pass is how a rotation system rots quietly');

// A floor must not hinge on ONE rotated city being offerable. Backstops must target a city already
// PROVEN reachable this run, not the same pickCities[0] whose refusal cost the floor in the first
// place — and the mobile floor, which rode on `mobile = i === 0`, needs a backstop like the others.
check('floor backstops target a city proven reachable this run',
  /const reachable = \(\) =>/.test(runner) && /citiesTested\]\[0\]/.test(runner),
  'a backstop pinned to pickCities[0] fails for exactly the reason the floor was missed');
check('the MOBILE floor has a backstop of its own',
  /done\.mobile\)/.test(runner) && /mobile floor/.test(runner),
  'mobile rode on `i === 0` and vanished whenever that one city was not offered');
// STRENGTHENED 2026-08-30: a merely-"reachable" city is not enough. `reachable()` is deal-blind —
// it returns whichever city was reached first, for whatever deal reached it — so a rent-only city
// («المندق», 19 listings all إيجار) satisfied this check and was still handed to trending-district,
// which runs on the app's DEFAULT deal «بيع». The journey was skipped and the floor lost. The city
// must now be chosen for the deal the journey actually runs; that IMPLIES reachability, so this is
// a tightening, not a relaxation. A raw pickCities[0] still fails, as before.
check('the trending-district journey uses a DEAL-AWARE reachable city',
  /trendingDistrict\(\{\s*city:\s*tdCity/.test(runner)
  && /const tdCity = reachableFor\('بيع'\)/.test(runner)
  && !/trendingDistrict\(\{\s*city:\s*pickCities\[0\]/.test(runner),
  'a deal-blind city hands a بيع journey a rent-only city and silently deletes the floor');

// «not offered» must mean the PRODUCT refused, never "the list had not rendered yet". A flat sleep
// turned بريدة — a top-10 city with 4,850 listings — into a skipped journey and a missed floor.
check('the city option is POLLED for, not sampled once after a flat sleep',
  /waitForFunction\(/.test(sweep) && /CITY_OPTION_TIMEOUT_MS/.test(sweep),
  'a slow suggestion fetch must not read as a product refusal');
check('a city pick is confirmed by the field having COMMITTED, not by the click',
  /const committed = await input\.inputValue\(\)/.test(sweep),
  'a click that missed leaves the field empty and the later search is refused (§41.13)');

// ── 5. the schedule ─────────────────────────────────────────────────────────────────────────────
check('the sweep runs on a schedule', /^\s*schedule:/m.test(wf) && /cron:/.test(wf));
check('the scheduled target is production', /ezhalah-app\.vercel\.app/.test(wf));
check('it runs the runner, not a subset', /node e2e\/live-sweep\/run\.mjs/.test(wf));
check('it uses the anon key only (never the service role)',
  /EXPO_PUBLIC_SUPABASE_ANON_KEY/.test(wf) && !/SERVICE_ROLE/.test(wf));
check('rotation is driven by the coverage ledger, not a hardcoded city list',
  /ops_qa_sweep_plan/.test(sweep) && /stalestFirst/.test(runner));
check('the city pool is discovered LIVE (a hardcoded list would go stale)',
  /search_listings_ar\?select=city_ar,region_ar/.test(runner));

// ── §41.2 — NO BARE VIEWPORT-COORDINATE CLICKS ─────────────────────────────────────────────────
// «Never click bare viewport coordinates» is the repo's own rule, and the harness broke it in two
// places. `pickCity()` clicked a getBoundingClientRect() centre via page.mouse.click(x, y); on a
// 390 px phone that left the page in a state where the following «بحث» click NEVER became
// actionable, so ALL THREE mobile journeys died on every «بيع» rotation (CI runs #10/#11, local
// sweeps #3-#6) and the owner-mandated §34 mobile floor was never actually exercised while the
// workflow sat red. Replacing it with a real element click fixed it: mobile «لقينا 1,026 إعلان»,
// desktop byte-identical, sweep back to 10/10 with MOBILE JOURNEYS: 1.
//
// Only ONE coordinate click may remain: the explicitly-commented last-resort fallback inside
// pickCity, which runs only after a real element click has already been attempted and failed.
// Count CODE, not prose: these comments quote `page.mouse.click(x, y)` when explaining the bug,
// and a barrier that counts its own explanation can never be satisfied.
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const coordClicks = ['e2e/live-sweep/sweep.mjs', 'e2e/live-sweep/journeys.mjs', 'e2e/live-sweep/showmore.mjs']
  .flatMap((f) => [...stripComments(read(f)).matchAll(/page\.mouse\.click\(/g)]);
check('no bare viewport-coordinate clicks beyond the single documented fallback (§41.2)',
  coordClicks.length <= 1,
  `${coordClicks.length} page.mouse.click( call(s) — a coordinate click silently misses off-screen controls`);
check('pickCity clicks the ELEMENT, so Playwright scrolls and checks actionability',
  /const option = handle\.asElement\(\)/.test(sweep) && /option\.click\(\)/.test(sweep),
  'the mobile floor died for weeks on a coordinate click here');

console.log(failures === 0
  ? '\n✓ the live sweep still covers everything it promises, and still fails on a real mismatch\n'
  : `\n✗ ${failures} check(s) FAILED — the live sweep has been narrowed; restore the coverage\n`);
process.exit(failures === 0 ? 0 : 1);
