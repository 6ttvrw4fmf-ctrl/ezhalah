// THE MAP'S CITY NAMES DOWNLOAD BEFORE THE SEARCH LOADER'S LOGOS (🔧 2026-11-11).
//
//   node --experimental-strip-types scripts/verify-logo-prefetch-yields-to-the-map.ts   (discovered by `npm test`)
//
// site-speed-live «map: tapped at once» read 7,321 ms against a 5,000 ms budget (run 43102576192, the timeline this
// fix's sibling PR added): map_areas_feed_ar 311 → 7,164 ms after the tap (server ~61 ms) while ~200 loader logos,
// prefetched 2.07 s after the tap, shared the phone's 1.5 Mbps line. EXECUTES afterMapIsLabelled() against a fake
// page and clock: every page but the map fetches at once; on the map it waits for the first painted city name, and
// never longer than the cap (the logos always arrive).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterMapIsLabelled, MAP_FIRST_CAP_MS, MAP_FIRST_POLL_MS } from '../src/lib/prefetchLoaderLogos.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

/** A fake page: `labelAt` = the clock time a city name paints (Infinity = never). Returns when the logos were fetched. */
function run(path: string, labelAt: number, fn = afterMapIsLabelled, leaveMapAt = Infinity): number | null {
  let now = 0; let fetchedAt: number | null = null; const q: [number, () => void][] = [];
  const env = {
    path: () => (now >= leaveMapAt ? '/' : path),
    labelled: () => now >= labelAt,
    wait: (f: () => void, ms: number) => { q.push([now + ms, f]); },
  };
  fn(() => { fetchedAt = now; }, env);
  for (let guard = 0; q.length && guard < 10_000; guard++) {
    q.sort((a, b) => a[0] - b[0]);
    const [t, f] = q.shift()!; now = t; f();
  }
  return fetchedAt;
}

check('the home page fetches the logos at once (unchanged)', run('/', Infinity) === 0);
check('the agent page fetches at once', run('/agent', Infinity) === 0);
check('on the map with city names already painted: at once', run('/map', 0) === 0);
const t = run('/map', 6_900);
check('on the map before its city names: the logos wait for the first one (measured feed end ~7.1 s)',
  t !== null && t >= 6_900 && t < 6_900 + MAP_FIRST_POLL_MS + 1, String(t));
const capped = run('/map', Infinity);
check('a map that never paints a name still gets its logos at the cap', capped !== null && capped >= MAP_FIRST_CAP_MS && capped <= MAP_FIRST_CAP_MS + MAP_FIRST_POLL_MS, String(capped));
const left = run('/map', Infinity, afterMapIsLabelled, 1_000);
check('leaving the map before names paint fetches the logos right away', left !== null && left >= 1_000 && left < 1_000 + MAP_FIRST_POLL_MS + 1, String(left));
check('without a browser (native / SSR) it fetches at once', (() => { let hit = false; afterMapIsLabelled(() => { hit = true; }, null); return hit; })());

// Mutations, executed the same way.
const fetchNow: typeof afterMapIsLabelled = (f) => { f(); };
mustCatch('the pre-fix prefetch (fetch at once on the map, sharing the line with the city names)', run('/map', 6_900, fetchNow) === 0);
const noCap: typeof afterMapIsLabelled = (f, env) => {
  if (!env || env.path() !== '/map' || env.labelled()) { f(); return; }
  const tick = () => (env.labelled() || env.path() !== '/map' ? f() : env.wait(tick, MAP_FIRST_POLL_MS));
  env.wait(tick, MAP_FIRST_POLL_MS);
};
mustCatch('a hold with no cap (a map that never paints a name never gets the loader logos)', run('/map', Infinity, noCap) === null);

const layout = readFileSync(join(import.meta.dirname, '..', 'src/app/_layout.tsx'), 'utf8');
check('the root layout routes the logo fetch through afterMapIsLabelled()',
  /scheduleLogoPrefetch\(PLATFORM_META\.map\(\(p\) => p\.logo\), \(uris\) => afterMapIsLabelled\(\(\) => \{ void ExpoImage\.prefetch\(uris\); \}\)\);/.test(layout));

if (failed) { console.error(`\n❌ verify-logo-prefetch-yields-to-the-map: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-logo-prefetch-yields-to-the-map: on the map, its city names download before the loader logos.');
