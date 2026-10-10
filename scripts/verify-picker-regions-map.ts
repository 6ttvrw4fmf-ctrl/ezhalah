// THE PICKER'S REGIONS MAP IS A VIEW, NEVER A QUERY (owner 2026-10-10: «highlight the entire region … so
// users are aware of where they cover; user can select within the map»).
//
// What must hold:
//   1. The shapes file carries exactly the 13 catalogue regions (sa-locations ids), each a real outline,
//      with the OpenStreetMap attribution the ODbL licence requires — and the component prints it.
//   2. The tapped region narrows the OFFERED list (sites with listings there) and «كل المواقع» clears it.
//   3. The region never reaches the search: the only restriction is the lit sites (applyPickerSources).
// Mutation proofs run the broken shapes through the same predicates.
//   node --experimental-strip-types scripts/verify-picker-regions-map.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const AGENT = read('src/app/agent.tsx');
const MAP = read('src/components/PickerRegionsMap.tsx');
const PATHS = JSON.parse(read('src/data/saRegionPaths.json'));
const CATALOG = JSON.parse(read('src/data/sa-locations.json'));

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

// ── 1. shapes ────────────────────────────────────────────────────────────────────────────────────
const shapesOk = (paths: any): string[] => {
  const out: string[] = [];
  const ids = (paths.regions ?? []).map((r: any) => r.id).sort((a: number, b: number) => a - b);
  const catalogIds = CATALOG.regions.map((r: [number]) => r[0]).sort((a: number, b: number) => a - b);
  if (JSON.stringify(ids) !== JSON.stringify(catalogIds)) out.push(`region ids ${ids} ≠ catalogue ${catalogIds}`);
  for (const r of paths.regions ?? []) {
    if (!/^M[\d. L-]+Z/.test(r.d) || r.d.length < 150) out.push(`${r.en}: outline too thin (${r.d?.length ?? 0} chars)`);
    const row = CATALOG.regions.find((c: [number, string, string]) => c[0] === r.id);
    if (!row || row[2] !== r.name) out.push(`${r.en}: Arabic name ≠ catalogue`);
  }
  if (!/OpenStreetMap/.test(paths.attribution ?? '')) out.push('attribution missing');
  return out;
};
const shapeProblems = shapesOk(PATHS);
check('13 catalogue regions, real outlines, catalogue names, OSM attribution', shapeProblems.length === 0, shapeProblems.join('\n      '));
check('the component prints the attribution and draws every region', /OpenStreetMap contributors/.test(MAP) && /regionMap\.regions\.map\(/.test(MAP));

// ── 2 + 3. wiring ────────────────────────────────────────────────────────────────────────────────
const wired = (src: string) =>
  /offeredPlatforms\.filter\(\(platform\) => platformRegionIds\(platform\.name\)\.includes\(pickerRegion\)\)/.test(src)
  && /<PickerRegionsMap[\s\S]*?onSelectRegion=\{\(id\) => setPickerRegion\(\(current\) => \(current === id \? null : id\)\)\}/.test(src)
  && /if \(source === null\) setPickerRegion\(null\);/.test(src)
  && /pickerPlatforms\.map\(/.test(src)
  // The region's own offices first (owner: «should show the sites in that region»).
  && /\.sort\(\(a, b\) => platformRegionShare\(b\.name, pickerRegion\) - platformRegionShare\(a\.name, pickerRegion\)\)/.test(src)
  // The tapped region is the list's one heading (owner: «say the region title, then the websites»).
  && /const sectionLabel = pickerRegion !== null \? regionLabel\(pickerRegion, locale\) : group\.label;/.test(src)
  && /\{sectionLabel\}<\/Text>/.test(src)
  // «كل المواقع» = every site → the whole kingdom glows.
  && /selectedSources\.length \? selectedSources\.flatMap\(\(name\) => platformRegionIds\(name\)\) : Object\.keys\(pickerRegionCounts\)\.map\(Number\)/.test(src);
const neverAQuery = (src: string) => !/applyPickerSources\([^)]*pickerRegion/.test(src) && !/setSelectedSources\([^\n]*pickerRegion/.test(src);
check('a tapped region narrows the offered list; «كل المواقع» clears it; the list renders the view', wired(AGENT));
check('the region never reaches the search restriction', neverAQuery(AGENT));

// ── mutation proofs ──────────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, caught: boolean) => {
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
mustCatch('a map with a region missing', shapesOk({ ...PATHS, regions: PATHS.regions.slice(1) }).length > 0);
mustCatch('a collapsed outline', shapesOk({ ...PATHS, regions: PATHS.regions.map((r: any, i: number) => (i ? r : { ...r, d: 'M1 1L2 2Z' })) }).length > 0);
mustCatch('a dropped attribution', shapesOk({ ...PATHS, attribution: '' }).length > 0);
mustCatch('the region filter removed', !wired(AGENT.replace('offeredPlatforms.filter((platform) => platformRegionIds(platform.name).includes(pickerRegion))', 'offeredPlatforms')));
mustCatch('«كل المواقع» no longer clearing the region', !wired(AGENT.replace('if (source === null) setPickerRegion(null);', '')));
mustCatch('the region\'s own offices no longer listed first', !wired(AGENT.replace('.sort((a, b) => platformRegionShare(b.name, pickerRegion) - platformRegionShare(a.name, pickerRegion))', '')));
mustCatch('the region heading replaced by the coverage sections', !wired(AGENT.replace('const sectionLabel = pickerRegion !== null ? regionLabel(pickerRegion, locale) : group.label;', 'const sectionLabel = group.label;')));
mustCatch('«كل المواقع» no longer glowing the whole kingdom', !wired(AGENT.replace('selectedSources.length ? selectedSources.flatMap((name) => platformRegionIds(name)) : Object.keys(pickerRegionCounts).map(Number)', 'selectedSources.flatMap((name) => platformRegionIds(name))')));
mustCatch('the region leaking into the search', !neverAQuery(AGENT.replace('applyPickerSources(', 'applyPickerSources(pickerRegion, ')));

console.log(failed === 0 ? '\n✅ the picker regions map is a view over the offered sites, never a query.\n' : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
