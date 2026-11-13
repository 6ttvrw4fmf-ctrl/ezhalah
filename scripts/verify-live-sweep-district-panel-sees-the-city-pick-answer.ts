// The live sweep's district journey hears the district list the app fetched at the CITY pick (🦅 2026-11-13).
//
// The app asks district_options_ar when the city is picked (src/app/index.tsx, the citySelected effect). The sweep
// attached its listener only when it tapped the district field, so a city with no districts (حرض: 54 sale ads, 0
// districts, the RPC answers [] in 16 ms) was reported as «district panel never rendered … the user is left with an
// empty surface» — a defect on a correct product (live sweep 43403869090) — and the trending-district floor was lost.
// Two rules, executed against the real source order:
//   1. trendingDistrict() registers a district_options_ar listener BEFORE pickCity();
//   2. run.mjs retries the journey in الرياض when the drawn city yields none.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) failed++;
};

/** Rule 1 on a journeys.mjs text: inside trendingDistrict, a district_options_ar listener precedes pickCity(). */
export const listensBeforeCityPick = (src: string): boolean => {
  const start = src.indexOf('export async function trendingDistrict(');
  if (start < 0) return false;
  const end = src.indexOf('\nexport async function', start + 10);
  const body = src.slice(start, end < 0 ? undefined : end);
  const listen = body.search(/page\.on\('response'[\s\S]{0,200}?district_options_ar/);
  const pick = body.indexOf('pickCity(page');
  return listen >= 0 && pick >= 0 && listen < pick;
};
/** Rule 2 on a run.mjs text: a trending-district retry in RIYADH guarded by «no district journey yet». */
export const retriesInRiyadh = (src: string): boolean =>
  /if \(!done\.tDistrict && tdCity !== RIYADH\)[\s\S]{0,300}?trendingDistrict\(\{ city: RIYADH/.test(src);

const journeys = readFileSync(join(ROOT, 'e2e', 'live-sweep', 'journeys.mjs'), 'utf8');
const run = readFileSync(join(ROOT, 'e2e', 'live-sweep', 'run.mjs'), 'utf8');
check('trendingDistrict listens for district_options_ar before it picks the city', listensBeforeCityPick(journeys));
check('run.mjs retries the trending-district journey in الرياض when the drawn city has no districts', retriesInRiyadh(run));

// Mutations: the pre-fix shapes must fail.
const lateListener = journeys.replace(/    const early = \{[\s\S]*?\n    \}\);\n/, '');
check('MUTATION — a journey that listens only at the district tap is caught', !listensBeforeCityPick(lateListener));
check('MUTATION — a run without the الرياض retry is caught', !retriesInRiyadh(run.replace('if (!done.tDistrict && tdCity !== RIYADH)', 'if (false)')));

console.log(failed === 0 ? '\n✓ the district journey hears the city-pick answer and keeps its floor' : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
