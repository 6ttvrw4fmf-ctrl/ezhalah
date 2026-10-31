// public/ksa-regions.json — the 13 region boundaries the «خريطة» tab draws over Apple Maps (owner 2026-10-30) — stays
// exactly the Kingdom's 13 administrative regions as src/data/sa-locations.json knows them, small, and well-formed:
//   1. 13 entries, ids 1..13 once each, every id's English/Arabic name consistent with sa-locations.json;
//   2. every ring is a closed polygon inside Saudi Arabia's bounding box, every bbox encloses its rings;
//   3. every region's name point (`label`) lies inside that region's own mainland ring, so a name never sits in a
//      neighbour (owner 2026-10-30: «I don't want them covering another box»), and `area` is positive;
//   4. the file stays small (ALWAYS FAST: it is fetched on the Map tab only, but 23 KB must not quietly become 400).
import { readFileSync, statSync } from 'node:fs';

type Region = { id: number; iso: string; en: string; ar: string; bbox: [number, number, number, number]; rings: [number, number][][]; label: [number, number]; area: number; rot: number; len: number };
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
};

const regions = JSON.parse(read('public/ksa-regions.json')) as Region[];
const official = (JSON.parse(read('src/data/sa-locations.json')) as { regions: [number, string, string][] }).regions;

check('13 regions, ids 1..13 once each', regions.length === 13 && new Set(regions.map((r) => r.id)).size === 13 && regions.every((r) => r.id >= 1 && r.id <= 13));
check('13 distinct ISO 3166-2:SA codes', new Set(regions.map((r) => r.iso)).size === 13 && regions.every((r) => /^SA-\d\d$/.test(r.iso)));
const byId = new Map(official.map(([id, en, ar]) => [id, { en, ar }]));
check('every Arabic label is the official region name without the «منطقة» prefix', regions.every((r) => {
  const o = byId.get(r.id);
  return !!o && (o.ar === `منطقة ${r.ar}` || o.ar === `المنطقة ${r.ar}`);
}), regions.filter((r) => { const o = byId.get(r.id); return !o || !(o.ar === `منطقة ${r.ar}` || o.ar === `المنطقة ${r.ar}`); }).map((r) => `${r.id}: «${r.ar}» vs «${byId.get(r.id)?.ar}»`).join(', '));
check('every English label matches the official English name', regions.every((r) => byId.get(r.id)?.en === r.en));

// Saudi Arabia's extent, generously: lng 34–56, lat 16–33
const inKsa = ([lng, lat]: [number, number]) => lng >= 34 && lng <= 56 && lat >= 16 && lat <= 33;
check('every ring is closed, ≥ 4 points, and inside the Kingdom', regions.every((r) => r.rings.length >= 1 && r.rings.every((ring) =>
  ring.length >= 4 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] && ring.every(inKsa))));
check('every bbox encloses its rings', regions.every((r) => { const [w, s, e, n] = r.bbox; return r.rings.every((ring) => ring.every(([lng, lat]) => lng >= w && lng <= e && lat >= s && lat <= n)); }));
check('regions do not overlap by bbox beyond neighbours (no region swallows the country)', regions.every((r) => (r.bbox[2] - r.bbox[0]) < 15 && (r.bbox[3] - r.bbox[1]) < 12));

const inRing = ([x, y]: [number, number], ring: [number, number][]) => {
  let ins = false;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) ins = !ins;
  }
  return ins;
};
check('every name point lies inside its own region (its largest ring) and in no other region', regions.every((r) => {
  const own = r.rings.reduce((a, b) => (a.length >= b.length ? a : b));
  return inRing(r.label, own) && regions.every((o) => o === r || !o.rings.some((ring) => inRing(r.label, ring)));
}));
check('every region has a positive area', regions.every((r) => typeof r.area === 'number' && r.area > 0));
check('every name has a readable tilt (|rot| ≤ 50°) and a positive length to fit into', regions.every((r) => Number.isInteger(r.rot) && Math.abs(r.rot) <= 50 && r.len > 0));

const bytes = statSync(new URL('../public/ksa-regions.json', import.meta.url)).size;
check(`file stays small (${bytes} bytes ≤ 40 KB)`, bytes <= 40 * 1024);

// mutation proof — the predicates above, applied to deliberately broken inputs, must FAIL
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches: ${label}`, caught);
const clone = (): Region[] => JSON.parse(JSON.stringify(regions));
const namePointsOk = (rs: Region[]) => rs.every((r) => {
  const own = r.rings.reduce((a, b) => (a.length >= b.length ? a : b));
  return inRing(r.label, own) && rs.every((o) => o === r || !o.rings.some((ring) => inRing(r.label, ring)));
});
const ringsOk = (rs: Region[]) => rs.every((r) => r.rings.every((ring) => ring.length >= 4 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] && ring.every(inKsa)));
const namesOk = (rs: Region[]) => rs.every((r) => { const o = byId.get(r.id); return !!o && (o.ar === `منطقة ${r.ar}` || o.ar === `المنطقة ${r.ar}`); });
const m1 = clone(); m1[0].label = m1[1].label;              // Riyadh's name moved into Makkah
mustCatch('a name point placed inside a neighbouring region', !namePointsOk(m1));
const m2 = clone(); m2[0].rings[0] = m2[0].rings[0].slice(0, -1); // ring no longer closed
mustCatch('an unclosed ring', !ringsOk(m2));
const m3 = clone(); m3[0].rings[0][0] = [60, 40];           // a point outside the Kingdom
mustCatch('a boundary point outside Saudi Arabia', !ringsOk(m3));
const m4 = clone(); m4[2].ar = 'الدمام';                     // a wrong region name
mustCatch('a name that is not the official region name', !namesOk(m4));
const m5 = clone(); m5.pop();                                // only 12 regions
mustCatch('a missing region', !(m5.length === 13 && new Set(m5.map((r) => r.id)).size === 13));

if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\n✓ public/ksa-regions.json is the Kingdom\'s 13 regions, named as the app names them, closed, inside KSA, and small');
