// AREA LABELS — CITY AND DISTRICT NAMES WITH THEIR COUNTS (owner's father, relayed by the owner 2026-11-03: «show only
// the number of listings in the area at such low zoom, and show place marks only when the user zooms in further»; «at
// this zoom level show the names of the districts only and the number of listings»). This barrier EXECUTES the pure
// rules (which level a zoom shows, the label words, where a tap goes) with mutation proofs, and pins the wiring by
// shape: un-narrowed views read the labels first, a failed read falls back to the dots, labels are keyed and tappable.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { areaLevelFor, areaCount, areaName, areaZoomSpan, areasTotal, CITY_LABELS_ABOVE, DISTRICT_LABELS_ABOVE } from '../src/lib/mapAreas.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => check(`(mutation) catches ${name}`, caught);

check('far out (the country, a region) shows one label per CITY', areaLevelFor(17) === 'city' && areaLevelFor(3) === 'city');
check('city zoom shows one label per DISTRICT', areaLevelFor(2.5) === 'district' && areaLevelFor(0.5) === 'district' && areaLevelFor(0.07) === 'district');
check('close in shows price pins (no label level)', areaLevelFor(0.06) === null && areaLevelFor(0.02) === null);
mustCatch('pins at city zoom (the clutter the owner\'s father saw)', areaLevelFor(0.3) !== null);
mustCatch('labels that never hand over to pins', areaLevelFor(0.01) === null);
check('the thresholds nest: city above district', CITY_LABELS_ABOVE > DISTRICT_LABELS_ABOVE);
check('counts are short: 245, 3.4 ألف / 3.4K, 1.2 مليون', areaCount(245, 'ar') === '245' && areaCount(3400, 'ar') === '3.4 ألف' && areaCount(3400, 'en') === '3.4K' && areaCount(12400, 'ar') === '12 ألف' && areaCount(1_200_000, 'ar') === '1.2 مليون');
check('the name is the city at city level and the district (no «حي ») at district level', areaName({ city: 'جدة', district: 'حي النعيم' }, 'city') === 'جدة' && areaName({ city: 'جدة', district: 'حي النعيم' }, 'district') === 'النعيم' && areaName({ city: 'جدة', district: '' }, 'district') === 'جدة');
check('a tap on a city opens at district level, a tap on a district opens at pin level', areaLevelFor(areaZoomSpan('city')) === 'district' && areaLevelFor(areaZoomSpan('district')) === null);
mustCatch('a district tap that lands still on labels (the user taps forever)', areaLevelFor(areaZoomSpan('district')) === null);
check('the count pill is the labels\' total', areasTotal([{ city: 'a', district: '', lat: 1, lng: 1, n: 3 }, { city: 'b', district: '', lat: 1, lng: 1, n: 4 }]) === 7);

const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const data = readFileSync(join(root, 'src/data/mapAreas.ts'), 'utf8');
check('an un-narrowed view reads the labels for its level first', /const level = narrowed \? null : areaLevelFor\(span\.latitudeDelta\);/.test(web) && /const areas = await fetchMapAreas\(paddedBox\(center, span\), level, pins\.deals\);/.test(web));
check('labels are drawn keyed, counted in the pill, and a failed read falls back to the dots', /drawAreas\(areas, level\);\n\s*setPinCount\(areasTotal\(areas\)\);\n\s*return;/.test(web) && /if \(areas !== 'unknown'\) \{/.test(web) && /next\.set\(`A\|\$\{level\}\|\$\{a\.city\}\|\$\{a\.district\}\|\$\{a\.n\}`, a\)/.test(web));
check('labels never pile up: MapKit collision hides the smaller neighbour, priority follows the count', /collisionMode: mk\.Annotation\.CollisionMode\?\.Rectangle, displayPriority: 250 \+ Math\.round\(499 \* a\.n \/ maxN\)/.test(web));
check('a tap on a label zooms into it', /if \(d && Math\.hypot\(e\.clientX - d\.x, e\.clientY - d\.y\) < 10\) \{ e\.stopPropagation\(\); pickArea\(a, level\); \}/.test(web));
check('the labels come through the bounded RPC and a failed read is unknown', /boundedRpc<AreaRow\[\]>\(supabase\.rpc\('map_areas_ar'/.test(data) && /if \(error \|\| !Array\.isArray\(data\)\) return 'unknown';/.test(data));
check('src/lib/mapAreas.ts is import-free (the barrier executes it in Node)', !/^import /m.test(readFileSync(join(root, 'src/lib/mapAreas.ts'), 'utf8')));
check('a committed migration builds map_area_ar (median positions) in the hourly refresh and serves map_areas_ar', readdirSync(join(root, 'supabase/migrations')).some((f) => { if (!/map_area_labels/.test(f)) return false; const sql = readFileSync(join(root, 'supabase/migrations', f), 'utf8'); return /create table if not exists public\.map_area_ar/.test(sql) && /percentile_cont\(0\.5\) within group \(order by k\.la\)/.test(sql) && /create or replace function public\.map_areas_ar\(/.test(sql) && /ops_public_secdef_allowlist/.test(sql); }));

if (failed) { console.error(`\n❌ verify-map-area-labels: ${failed} check(s) failed.`); process.exit(1); }
console.log('\nverify-map-area-labels: all checks passed');
