// A DISTRICT ROW MAY ONLY EVER SHOW A NUMBER IT CAN STAND BEHIND.
//
// OWNER RULE: Trending is the location breakdown of the user's EXACT current eligible set — the
// number beside a حي must equal what selecting it returns. Two live defects broke that, both found
// on production 2026-08-22 by a multi-agent hunt and both independently reproduced against the DB:
//
//   1. COMBINED-MODE RENT BUDGET WAS INVISIBLE TO THE COUNT. In شراء+إيجار mode the Rent-side budget
//      lives in priceMinRent/priceMaxRent, which were absent from districtNarrowingSig — so a search
//      narrowed ONLY by a rent budget read as un-narrowed, the live-count fetch never ran, and every
//      row kept district_options_ar's deal/category/period scope count. Measured: حي العارض
//      advertised 2,914, the search landed on 1,231 (2.4x) — while the CITY list on the same screen
//      was correct, so the two surfaces contradicted each other in one state. The ENGINE always
//      applied the bound (rpcFilterParams spreads p_price_min_rent/max whenever dealCombined); only
//      the count lied.
//   2. ONLY THE FIRST 12 ROWS GOT A TRUE COUNT. matchDistrictsByCityId returns up to 30 typed
//      matches and every one is rendered, but the live-count fetch was capped at 12 — so rows 13-30
//      silently fell back to the scope count, rendered identically to a real one.
//
// The three checks below are the contract: the rent budget is IN the signature, the fetch covers
// every row the list can render, and — belt and braces — a row with no live count prints NOTHING
// under an active filter rather than the wider number.
//
//   node --experimental-strip-types scripts/verify-district-counts-honest.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const index = read('src/app/index.tsx');
const locations = read('src/data/locations.ts');

console.log('\nA district row may only ever show a number it can stand behind\n');

// ── 1. the combined-mode Rent budget must reach the narrowing test ──────────────────────────────
const sig = index.slice(index.indexOf('const districtNarrowingSig'),
                        index.indexOf('const hasDistrictNarrowing'));
check('districtNarrowingSig exists', sig.length > 0);
for (const field of ['priceMin', 'priceMax', 'priceMinRent', 'priceMaxRent', 'areaMin', 'areaMax', 'detail']) {
  check(`districtNarrowingSig includes query.${field}`,
    new RegExp(`query\\.${field}\\b`).test(sig),
    field.endsWith('Rent')
      ? 'the combined-mode Rent budget narrows the engine, so it must narrow the count too — this is the 2,914-vs-1,231 defect'
      : 'a filter missing here makes a narrowed search read as un-narrowed');
}

// ── 2. the live-count fetch must cover every row the dropdown can render ────────────────────────
const renderCap = Number(locations.match(/scored\.slice\(0,\s*(\d+)\)/)?.[1] ?? NaN);
const fetchCapConst = Number(index.match(/const DISTRICT_COUNT_FETCH_MAX = (\d+);/)?.[1] ?? NaN);
check('the typed district list declares its own render cap', Number.isFinite(renderCap), `found ${renderCap}`);
check('the district live-count fetch uses the named DISTRICT_COUNT_FETCH_MAX bound',
  /districtSuggestions\.slice\(0, DISTRICT_COUNT_FETCH_MAX\)/.test(index),
  'a bare number here is how the fetch bound and the render cap drifted apart');
check(`the fetch bound (${fetchCapConst}) covers everything the list renders (${renderCap})`,
  Number.isFinite(fetchCapConst) && Number.isFinite(renderCap) && fetchCapConst >= renderCap,
  'rows past the fetch bound get no live count and would fall back to the wider scope number');

// ── 3. belt and braces: never print a scope count as if it were the filtered one ────────────────
const trendingRow = index.slice(index.indexOf('sublabel: districtLiveCounts'),
                                index.indexOf('sublabel: districtLiveCounts') + 700);
check('the trending district row prints NOTHING when narrowing is active and no live count exists',
  /hasDistrictNarrowing[\s\S]{0,200}districtLiveCounts\?\.\[opt\.districtAr\] != null[\s\S]{0,120}: ''/.test(trendingRow),
  'under an active filter the scope count is not an acceptable fallback — show no number instead');
check('the typed district row applies the same rule',
  /const n = hasDistrictNarrowing \? live : \(live \?\? opt\.listingCount\);/.test(index)
  && /return label \? <Text style=\{s\.suggDist\}>\{label\}<\/Text> : null;/.test(index));

// ── 4. the counts still come from the results RPC with the full state (the pre-existing contract) ──
const remote = read('src/data/remote.ts');
const districtFn = remote.slice(remote.indexOf('export async function fetchDistrictEligibleCounts'),
                                remote.indexOf('export async function fetchDistrictEligibleCounts') + 1400);
check('district counts still come from the results RPC itself', /location_search_candidates_ar/.test(districtFn));
check('…carrying the normal narrowing', /rpcCountFilterParams\(q\)/.test(districtFn));
check('…and the advanced answers', /rpcAdvancedFilterParams\(q\)/.test(districtFn));
check('…and, in combined mode, the Rent-side budget params',
  /p_price_min_rent/.test(remote) && /p_price_max_rent/.test(remote),
  'rpcFilterParams must spread the combined-mode rent bounds, or the count and the search disagree');

console.log(failures === 0
  ? '\n✓ district counts are filter-aware, cover every rendered row, and never fall back to a wider number\n'
  : `\n✗ ${failures} check(s) FAILED — a district is advertising inventory the search will not return\n`);
process.exit(failures === 0 ? 0 : 1);
