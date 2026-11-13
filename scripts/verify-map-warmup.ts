// INSTANT FIRST MAP (owner 2026-11-04: «why does it feel slow moving between tabs»). Measured on ezhalah.com: the first
// tap on «خريطة» downloaded Apple's script, the region outlines, a map key and the labels/dots feeds only then. The root
// layout now warms all of it once the page has settled. This barrier pins the warm-up's shape and its manners: web only,
// after a delay and idle, skipped on save-data, never on the first download's path (dynamic imports only), every
// failure swallowed, a warm map key used once and only while young, and the map screen keeping its loaded modules.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => check(`(mutation) catches ${name}`, caught);

const warm = readFileSync(join(root, 'src/lib/mapWarmup.ts'), 'utf8');
const layout = readFileSync(join(root, 'src/app/_layout.tsx'), 'utf8');
const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const native = readFileSync(join(root, 'src/components/AppleMap.tsx'), 'utf8');
const screen = readFileSync(join(root, 'src/app/map.tsx'), 'utf8');

const warmOk = (src: string) =>
  !/^import [^(]*from '@\/components\/AppleMap'/m.test(src)                         // never a static import (first download)
  && /import\('@\/components\/AppleMap'\), import\('@\/components\/MapDealRow'\)/.test(src)
  && /if \(conn\?\.saveData\) return;/.test(src)
  && /setTimeout\(\(\) => \(idle \? idle\(go, \{ timeout: 1500 \}\) : go\(\)\), delayMs\);/.test(src)
  && /\.catch\(\(\) => \{ started = false; \}\)/.test(src);
check('the warm-up is dynamic-import only, after a delay and idle, skipped on save-data, failure-safe', warmOk(warm));
check('the root layout starts it on the web only', /useEffect\(\(\) => \{ if \(Platform\.OS === 'web'\) warmMapSoon\(\); \}, \[\]\);/.test(layout));
check('prewarmMap fetches script, regions, a key, the dots and labels feeds — each failure swallowed',
  /void loadMapKit\(\)\.catch\(\(\) => \{\}\);/.test(web) && /void loadRegions\(\)\.catch\(\(\) => \{\}\);/.test(web)
  && /p\.catch\(\(\) => \{\}\); warmToken = \{ at: Date\.now\(\), p \};/.test(web) && /void fetchMapDots\(\);\n\s*void fetchAreasFeed\(\);/.test(web));
check('a warm key is used once and only while younger than 5 minutes (keys last 30)',
  /const WARM_TOKEN_MS = 5 \* 60_000;/.test(web) && /const w = warmToken; warmToken = null;\n\s*if \(w && Date\.now\(\) - w\.at < WARM_TOKEN_MS\)/.test(web));
check('the native build has a no-op prewarmMap (same import shape on every platform)', /export function prewarmMap\(\): void \{\}/.test(native));
check('the map screen keeps its loaded modules — a second visit renders at once', /const \[mods, setMods\] = useState<MapModules \| null>\(loadedMods\);/.test(screen) && /if \(loadedMods\) return;/.test(screen));

check('the warm-up also fetches the three tabs\' code (dynamic only) and the Smart Broker\'s site list', /void import\('@\/app\/agent'\)\.catch\(\(\) => \{\}\);/.test(warm) && /void import\('@\/app\/map'\)\.catch/.test(warm) && /void import\('@\/app\/index'\)\.catch/.test(warm) && /import\('@\/data\/loaderActivePlatforms'\)\.then\(\(m\) => m\.loadHiddenPlatformNames\(\)\)/.test(warm) && !/^import [^(]*from '@\/app\//m.test(warm));
mustCatch('a static import of a tab screen in the warm-up (it would pull ~500 KB into the first download)', /^import [^(]*from '@\/app\//m.test("import Agent from '@/app/agent';\n" + warm));
mustCatch('a static AppleMap import in the warm-up (it would join the first download)', !warmOk("import AppleMap from '@/components/AppleMap';\n" + warm));
mustCatch('a warm-up that ignores save-data', !warmOk(warm.replaceAll('if (conn?.saveData) return;', '')));  // both the timer and the first-touch path
mustCatch('a warm key reused however old', !/w && Date\.now\(\) - w\.at < WARM_TOKEN_MS/.test(web.replace('w && Date.now() - w.at < WARM_TOKEN_MS', 'w')));

// AN IMPATIENT TAP (owner 2026-11-05): the first touch on the page starts the warm-up at once, and the timer is short
// (1.2 s + ≤ 1.5 s idle). A straight tap on «خريطة» measured 5.8 s to city names when nothing was fetched yet.
const touchOk = (src: string) => /window\.addEventListener\('pointerdown', warmMapNow, \{ once: true, passive: true, capture: true \}\);/.test(src)
  && /export const WARM_DELAY_MS = 1200;/.test(src) && /if \(started\) return;\n\s*started = true;/.test(src);
check('the first touch starts the warm-up at once, and the timer is 1.2 s + ≤ 1.5 s idle', touchOk(warm));
mustCatch('no first-touch start', !touchOk(warm.replace("window.addEventListener('pointerdown', warmMapNow, { once: true, passive: true, capture: true });", '')));
const codeOk = (src: string) => /export const CODE_WARM_MS = 300;/.test(src) && /armed = true;\n\s*setTimeout\(goCode, CODE_WARM_MS\);/.test(src)
  && /void import\('@\/app\/agent'\)\.catch\(\(\) => \{ codeStarted = false; \}\);/.test(src) && /void import\('@\/app\/map'\)\.catch\(\(\) => \{ codeStarted = false; \}\);/.test(src);
check('the three tabs\' code is fetched 0.3 s after the page starts, before the map data (owner 2026-11-13)', codeOk(warm));
mustCatch('the tabs\' code waiting for the 1.2 s map warm-up again', !codeOk(warm.replace('setTimeout(goCode, CODE_WARM_MS);', '')));
mustCatch('the old 2.5 s delay', !touchOk(warm.replace('WARM_DELAY_MS = 1200;', 'WARM_DELAY_MS = 2500;')));
mustCatch('a warm-up that can run twice', !touchOk(warm.replace(/if \(started\) return;\n(\s*)started = true;/, '$1started = true;')));

if (failed) { console.error(`\n❌ verify-map-warmup: ${failed} check(s) failed.`); process.exit(1); }
console.log('\nverify-map-warmup: all checks passed');
