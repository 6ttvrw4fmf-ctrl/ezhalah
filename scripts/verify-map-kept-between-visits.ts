// THE MAP IS KEPT BETWEEN VISITS (owner 2026-11-04: «why does it feel slow moving between tabs»). Measured on ezhalah.com:
// a new map got its 26 labels from our code in 0.25 s but Apple drew them ~3 s later (its first satellite render), on
// every visit, because the map was destroyed on leaving the tab. Proven live the same day: taking the live map's box out
// of the page and putting it back drew the labels in 36 ms and zooming still worked. This barrier pins the mechanism:
// the map lives in its own box, leaving parks it (no destroy), a return puts the same box back, and the map-wide
// listeners reach the current screen through mapSinks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => check(`(mutation) catches ${name}`, caught);

const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const kept = (src: string) =>
  /const el = document\.createElement\('div'\);\n\s*el\.style\.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0';\n\s*host\.appendChild\(el\);/.test(src)
  && /if \(kept && mkKept && hostEl\) \{\n\s*parked = null;\n\s*hostEl\.appendChild\(kept\.box\);/.test(src)
  && /kept\.box\.remove\(\);\n\s*parked = kept;/.test(src)
  && /if \(map && box\) \{ box\.remove\(\); parked = \{ map, box \}; \} else map\?\.destroy\(\);/.test(src)
  && /mapSinks\.setZoomed = setZoomed;/.test(src) && /mapSinks\.setZoomed\(lat < homeLatDelta \* 0\.85\);/.test(src)
  && /setMapReady\(\(n\) => n \+ 1\);\n\s*return \(\) => \{\n\s*cancelAnimationFrame\(id\);/.test(src);
check('the map lives in its own box, is parked on leaving and put back on return, listeners reach the current screen', kept(web));
mustCatch('a map destroyed on every leave (the 3 s wait on each visit)', !kept(web.replace('if (map && box) { box.remove(); parked = { map, box }; } else map?.destroy();', 'map?.destroy();')));
mustCatch('a zoom state written to the first, unmounted screen', !kept(web.replace('mapSinks.setZoomed(lat < homeLatDelta * 0.85);', 'setZoomed(lat < homeLatDelta * 0.85);')));

if (failed) { console.error(`\n❌ verify-map-kept-between-visits: ${failed} check(s) failed.`); process.exit(1); }
console.log('\nverify-map-kept-between-visits: all checks passed');
