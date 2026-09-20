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

// THE WINDOW BELOW WAS FAIL-OPEN UNTIL 2026-09-20 (routine #10), and this guard was therefore blind
// to the very defect its header describes. `index.slice(index.indexOf(START), index.indexOf(END))`
// reads -1 for a missing END marker, and `slice` treats a negative end as an offset from the end of
// the string — so renaming the end marker silently widened this window from ~700 characters to the
// whole 200KB screen, and every `query.<field>` assertion under it then found its needle somewhere
// else in the file. Watched, by execution: with `query.priceMinRent, query.priceMaxRent` DELETED
// from the signature (the exact 2,914-vs-1,231 defect) and `const hasDistrictNarrowing = useMemo(`
// refactored to `const [hasDistrictNarrowing] = useMemo(`, this file printed
// `PASS  districtNarrowingSig includes query.priceMinRent` and closed green — and so did all 486
// checks of `npm run test:all`. `windowBetween()` throws instead. See scripts/lib/sourceWindow.ts.
import { readFileSync } from 'node:fs';
import { windowBetween } from './lib/sourceWindow.ts';

// The fields whose absence from the invalidation signature makes a narrowed search read as
// un-narrowed — i.e. makes a district advertise inventory the search will not return.
export const NARROWING_FIELDS = ['priceMin', 'priceMax', 'priceMinRent', 'priceMaxRent',
                                 'areaMin', 'areaMax', 'detail'] as const;

/**
 * The verdict, PURE, so a proof can hand it a broken `src/app/index.tsx` instead of trusting prose.
 * Throws `MarkerMissing` when the window cannot be formed — a marker that has moved is an UNKNOWN,
 * never a clean bill of health.
 */
export function narrowingSigProblems(index: string): string[] {
  const sig = windowBetween(index, 'const districtNarrowingSig', 'const hasDistrictNarrowing',
                            'src/app/index.tsx');
  return NARROWING_FIELDS
    .filter((f) => !new RegExp(`query\\.${f}\\b`).test(sig))
    .map((f) => `districtNarrowingSig does not carry query.${f}`
      + (f.endsWith('Rent')
        ? ' — the combined-mode Rent budget narrows the engine, so it must narrow the count too;'
          + ' this is the 2,914-vs-1,231 defect'
        : ' — a filter missing here makes a narrowed search read as un-narrowed'));
}

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
const sigProblems = narrowingSigProblems(index);   // throws if either marker has moved
check('districtNarrowingSig carries every narrowing field', sigProblems.length === 0,
  sigProblems.join('\n      '));

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

// ── 5. MUTATION PROOFS — the predicate is fed the REAL shipped file, deliberately broken ────────
// Not a fixture this barrier invented: every mutant below is `src/app/index.tsx` as production has
// it, with one edit applied. A proof that supplies its own input proves nothing.
const mustCatch = (what: string, caught: boolean) => {
  if (!caught) failures++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
const threw = (mutant: string) => {
  try { narrowingSigProblems(mutant); return false; } catch { return true; }
};

// (a) THE DEFECT ITSELF — the combined-mode Rent budget leaves the signature (2026-08-22, حي العارض
//     advertising 2,914 over a search that lands on 1,231).
const RENT_PAIR = 'query.priceMinRent, query.priceMaxRent, ';
mustCatch('the combined-mode Rent budget being dropped from the signature',
  index.includes(RENT_PAIR)
  && narrowingSigProblems(index.replace(RENT_PAIR, '')).length === 2);

// (b) THE BLINDING REFACTOR THAT MADE (a) INVISIBLE UNTIL 2026-09-20. The end marker alone is
//     refactored — behaviour-preserving, type-correct, innocent in isolation. Under the old raw
//     `slice(indexOf, indexOf)` the window became the whole file and (a) printed PASS with the field
//     gone; the FULL 486-check suite passed over it. It must now be an UNKNOWN, never a green.
const END_MARKER = 'const hasDistrictNarrowing = useMemo(';
mustCatch('the window END marker being refactored away (a raw slice would read the whole file)',
  index.includes(END_MARKER)
  && threw(index.replace(END_MARKER, 'const [hasDistrictNarrowing] = useMemo(')));

// (c) BOTH AT ONCE — the exact mutant that survived a green suite.
mustCatch('the defect AND the blinding refactor together (the mutant that survived, 2026-09-20)',
  threw(index.replace(RENT_PAIR, '').replace(END_MARKER, 'const [hasDistrictNarrowing] = useMemo(')));

// (d) A START marker that has moved is equally an UNKNOWN.
mustCatch('the window START marker being renamed',
  threw(index.replace('const districtNarrowingSig', 'const districtInvalidationSig')));

// (e) NEGATIVE CONTROL — the predicate is not vacuously red. The shipped file, untouched, is clean;
//     without this line a barrier that failed on everything would read as a strong one.
mustCatch('…while the SHIPPED file is NOT flagged (the predicate is not vacuously red)',
  narrowingSigProblems(index).length === 0);

console.log(failures === 0
  ? '\n✓ district counts are filter-aware, cover every rendered row, and never fall back to a wider number\n'
  : `\n✗ ${failures} check(s) FAILED — a district is advertising inventory the search will not return\n`);
process.exit(failures === 0 ? 0 : 1);
