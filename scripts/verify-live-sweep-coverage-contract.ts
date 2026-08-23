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

// ── 2. the floors, at or above the values the owner set ─────────────────────────────────────────
const REQUIRED_FLOORS: Record<string, number> = {
  nonRiyadhCities: 3, mobileJourneys: 1, afJourneys: 1, trendingCityJourneys: 1,
  trendingDistrictJourneys: 1, buyRentJourneys: 1, monthlyJourneys: 1,
  zeroResultJourneys: 1, cardClickBackJourneys: 1,
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
check('no-html-entities-rendered is asserted from the RENDERED text',
  /entities/.test(sweep) && /&\(\?:bull\|quot/.test(sweep));

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

console.log(failures === 0
  ? '\n✓ the live sweep still covers everything it promises, and still fails on a real mismatch\n'
  : `\n✗ ${failures} check(s) FAILED — the live sweep has been narrowed; restore the coverage\n`);
process.exit(failures === 0 ? 0 : 1);
