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
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) failed++;
};
const mutation = (label: string, caught: boolean, detail = '') => check(`MUTATION — ${label}`, caught, detail);

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
mutation('a journey that listens only at the district tap is caught', !listensBeforeCityPick(lateListener));
mutation('a run without the الرياض retry is caught', !retriesInRiyadh(run.replace('if (!done.tDistrict && tdCity !== RIYADH)', 'if (false)')));

// 3. A FAILED answer is never «this scope has no districts» (CodeRabbit Major #12166): execute the real verdict.
type Rpc = { returned: boolean; rows: number | null; status: number | null };
const lifted = await liftSymbols(join(ROOT, 'e2e', 'live-sweep', 'journeys.mjs'),
  [{ header: 'export const districtPanelVerdict', endsWith: /;\s*$/ }], ['districtPanelVerdict']);
const verdict = lifted.districtPanelVerdict as (r: Rpc) => string;
const verdictHolds = (v: (r: Rpc) => string) =>
  v({ returned: false, rows: null, status: null }) === 'unanswered'
  && v({ returned: true, rows: -1, status: 429 }) === 'failed'      // the city-pick answer was a 429, nothing later came
  && v({ returned: true, rows: -1, status: 200 }) === 'failed'      // 200 with a non-array body
  && v({ returned: true, rows: 0, status: 500 }) === 'failed'
  && v({ returned: true, rows: 4, status: 200 }) === 'has-rows'
  && v({ returned: true, rows: 0, status: 200 }) === 'empty';
check('an empty panel is an honest skip ONLY after a successful [] — a 429/5xx or unreadable answer is a failure', verdictHolds(verdict));
mutation('the old reading (returned + rows ≤ 0 ⇒ «no districts») is caught',
  !verdictHolds((r) => (!r.returned ? 'unanswered' : (r.rows ?? 0) > 0 ? 'has-rows' : 'empty')));
mutation('a verdict that checks the body but not the status is caught',
  !verdictHolds((r) => (!r.returned ? 'unanswered' : r.rows == null || r.rows < 0 ? 'failed' : r.rows > 0 ? 'has-rows' : 'empty')));
/** The failed branch comes BEFORE the «rows > 0» and «no districts» branches, so a failed answer can never reach the skip. */
const usesVerdict = (src: string) => /\} else if \(districtPanelVerdict\(rpc\) === 'failed'\) \{\s*\n\s*defect\([\s\S]{0,400}?\} else if \(rpc\.rows > 0\)/.test(src);
check('trendingDistrict raises a defect on a failed answer before it can call the scope empty', usesVerdict(journeys));
mutation('a journey without the failed branch is caught',
  !usesVerdict(journeys.replace("} else if (districtPanelVerdict(rpc) === 'failed') {", '} else if (false) {')));

// 4. The ledger credits the city whose journey COMPLETED, and records a skip when neither did (CodeRabbit #12166).
const creditsTested = (src: string) => /tdTested = tdCity;/.test(src) && /tdTested = RIYADH;/.test(src)
  && /if \(tdTested\) await ledgerRecord\('trending_district', tdTested, 'pass'/.test(src)
  && /else await ledgerRecord\('trending_district', tdCity, 'skip'/.test(src);
check('run.mjs credits only the city actually tested, and records a skip otherwise', creditsTested(run));
mutation('crediting the drawn city unconditionally is caught',
  !creditsTested(run.replace(/  if \(tdTested\) await ledgerRecord[^\n]*\n  else await ledgerRecord[^\n]*\n/, "  await ledgerRecord('trending_district', tdCity, 'pass', 'live browser sweep');\n")));

console.log(failed === 0 ? '\n✓ the district journey hears the city-pick answer and keeps its floor' : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
