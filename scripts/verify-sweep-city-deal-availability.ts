/**
 * BARRIER — a sweep journey's city must stock the DEAL that journey actually runs.
 *
 * THE BUG CLASS THIS GUARDS (Search & Matching QA, twice observed):
 *   2026-08-26  «الدليمية» (22 listings, ALL بيع) was drawn for an إيجار/سنوي journey. Production
 *               correctly declined to offer a city with no rent inventory, the journey was skipped,
 *               and the run failed on «non-Riyadh cities: 2 < 3» — with production perfectly
 *               healthy. Fixed for the normal-filter loop ONLY, via dealsOf.
 *   2026-08-30  «المندق» (19 listings, ALL إيجار, zero بيع) was handed to trending-district,
 *               honest-zero AND card→back. Those three journeys never call setDeal, so they run on
 *               the app's DEFAULT deal «بيع» — the one deal that city cannot offer. Three coverage
 *               floors lost in a single run. The 2026-08-26 fix had patched the example, not the
 *               class (§37), because those journeys chose their city via `pickCities[0]` (blind to
 *               both deal and reachability) or a deal-blind `reachable()`.
 *
 * WHY THIS MATTERS BEYOND A RED RUN: a skipped journey is missing coverage. §39/§43.2 draw work
 * stalest-first, so a dimension that keeps being skipped is a permanent blind spot that a green
 * dashboard will never show. The floors exist to make that shrinkage loud; this barrier keeps the
 * floors from being lost to an unlucky rotation draw in the first place.
 *
 * Checked here: the pure chooser's semantics (with a MUTATION PROOF that the old deal-blind
 * behaviour fails), and that run.mjs actually routes every default-deal journey through it — a
 * correct helper nothing calls is decoration.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pickCityForDeal } from '../e2e/live-sweep/sweep.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RIYADH = 'الرياض';
let failed = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
  else console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`);
};

// The exact 2026-08-30 production shape: المندق stocks ONLY إيجار/شهري; الخرج stocks بيع too.
const dealsOf = new Map<string, Set<string>>([
  ['المندق', new Set(['إيجار/شهري', 'both/-'])],
  ['ثادق', new Set(['إيجار/سنوي', 'both/-'])],
  ['الخرج', new Set(['بيع/-', 'إيجار/سنوي', 'both/-'])],
]);
const pickCities = ['المندق', 'ثادق', 'الخرج'];

console.log('§1 the chooser never hands a بيع journey a rent-only city');
{
  // citiesTested holds المندق first — exactly what a deal-blind reachable() would have returned.
  const got = pickCityForDeal({ citiesTested: ['المندق'], pickCities, dealsOf, deal: 'بيع' });
  check('بيع journey does not get المندق', got !== 'المندق', `got «${got}»`);
  check('بيع journey gets a city that stocks بيع', got === 'الخرج', `got «${got}»`);
}

console.log('§2 a city already proven reachable is preferred when it DOES stock the deal');
{
  const got = pickCityForDeal({ citiesTested: ['الخرج', 'المندق'], pickCities, dealsOf, deal: 'بيع' });
  check('prefers the proven-reachable الخرج', got === 'الخرج', `got «${got}»`);
  const rent = pickCityForDeal({ citiesTested: ['المندق'], pickCities, dealsOf, deal: 'إيجار', period: 'شهري' });
  check('إيجار/شهري keeps المندق (it stocks that deal)', rent === 'المندق', `got «${rent}»`);
}

console.log('§3 الرياض is the last resort, never the first answer');
{
  const none = pickCityForDeal({ citiesTested: [], pickCities: ['المندق'], dealsOf, deal: 'بيع' });
  check('falls back to الرياض when nothing stocks the deal', none === RIYADH, `got «${none}»`);
  const notFirst = pickCityForDeal({ citiesTested: [], pickCities, dealsOf, deal: 'بيع' });
  check('does NOT shortcut to الرياض when a rotated city qualifies', notFirst === 'الخرج', `got «${notFirst}»`);
  // A thin/failed pool read must not crash the rotation — it degrades to الرياض, which is offerable.
  const noPool = pickCityForDeal({ citiesTested: ['المندق'], pickCities, dealsOf: undefined as never, deal: 'بيع' });
  check('an unreadable pool degrades to الرياض rather than throwing', noPool === RIYADH, `got «${noPool}»`);
}

console.log('§4 MUTATION PROOF — the old deal-blind choosers fail these cases');
{
  // The two shapes that were live before this fix.
  const oldReachable = (citiesTested: string[]) => citiesTested[0] ?? pickCities[0] ?? RIYADH;
  const oldPickFirst = () => pickCities[0];
  check('old deal-blind reachable() would have returned المندق for a بيع journey',
    oldReachable(['المندق']) === 'المندق');
  check('old pickCities[0] would have returned المندق for a بيع journey',
    oldPickFirst() === 'المندق');
  check('…and the fixed chooser disagrees with both',
    pickCityForDeal({ citiesTested: ['المندق'], pickCities, dealsOf, deal: 'بيع' }) !== 'المندق');
}

console.log('§5 run.mjs actually ROUTES the default-deal journeys through the chooser');
{
  const src = readFileSync(join(ROOT, 'e2e/live-sweep/run.mjs'), 'utf8');
  check('run.mjs imports the shared chooser', src.includes('pickCityForDeal'));
  check('there is ONE implementation, not a re-inlined copy',
    !/const\s+stocks\s*=\s*\(city,\s*deal/.test(src));
  // Each of these four journeys runs on the app's default deal «بيع» and must not take a raw
  // pickCities[0] / bare reachable(). They are named so a future edit that regresses one is caught.
  for (const [journey, re] of [
    ['trending district', /trendingDistrict\(\{\s*city:\s*tdCity/],
    ['honest zero', /zeroResult\(\{\s*city:\s*zeroCity/],
    ['card → source → back', /cardClickBack\(\{\s*city:\s*cbCity/],
    ['clear all', /clearAll\(\{\s*city:\s*reachableFor\('بيع'\)/],
  ] as [string, RegExp][]) check(`«${journey}» takes a deal-aware city`, re.test(src));
  check('no journey still passes a raw pickCities[0] as its city',
    !/\b(zeroResult|cardClickBack|clearAll|trendingDistrict)\(\{\s*city:\s*pickCities\[0\]/.test(src));
  // Coverage must be credited to the city that actually ran (crediting an unreached city marks it
  // fresh and pushes it to the back of the stalest-first rotation — quiet rot).
  check('trending_district coverage is recorded against the city that ran',
    /ledgerRecord\('trending_district',\s*tdCity/.test(src));
}

if (failed) { console.error(`\n✗ verify-sweep-city-deal-availability: ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ verify-sweep-city-deal-availability: sweep journeys are deal-aware; the class is closed');
