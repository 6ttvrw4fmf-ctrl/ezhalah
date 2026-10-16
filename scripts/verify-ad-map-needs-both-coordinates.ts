// THE AD PAGE'S MAP COMES FROM THE SOURCE'S OWN PIN — BOTH COORDINATES, NEVER A DISTRICT (owner 2026-10-10).
//
// The in-app ad page (components/ListingPreview.tsx) draws a map only when search_listings_ar carries
// latitude AND longitude for that very (source_table, listing_id). One half of a pair, a (0,0) default,
// a district centroid or a geocoded address would all put a pin somewhere the source never said — the
// label on the map reads «الموقع كما نشره {site}», so the pin must BE the source's. And the map never
// opens a tab from our own UI: the preview expands in place, inside Ezhalah.
//
// EXECUTED: mapPoint() is lifted from src/data/adPageData.ts and run on real-shaped rows (PostgREST
// hands numerics over as strings); the wiring is pinned in source; mutation proofs run the broken
// predicate and the broken wiring through the same checks.
//   node --experimental-strip-types scripts/verify-ad-map-needs-both-coordinates.ts   (in `npm test`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { stripComments as codeOnly } from './lib/stripComments.ts';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'src/data/adPageData.ts');
const DATA_SRC = readFileSync(DATA, 'utf8');
const PREVIEW = codeOnly(readFileSync(join(ROOT, 'src/components/ListingPreview.tsx'), 'utf8'));

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

type Row = Record<string, unknown>;
type Fns = { mapPoint: (r: Row | null) => { lat: number; lng: number } | null };
const lift = async (file: string): Promise<Fns> => (await liftSymbols(file, [
  { header: 'const num = (', endsWith: /: NaN;$/ },
  { header: 'export function mapPoint(' },
], ['mapPoint'])) as unknown as Fns;

// Real rows, 2026-10-10: wasalt 7392441 publishes a pin; aqar 13462300 (the same house) publishes none.
const WASALT: Row = { source_table: 'wasalt_residential_listings', listing_id: 7392441, latitude: '24.920875653372303', longitude: '46.780616430492536' };
const AQAR: Row = { source_table: 'aqar_residential_listings', listing_id: 13462300, latitude: null, longitude: null };

const problems = ({ mapPoint }: Fns): string[] => {
  const out: string[] = [];
  const pin = mapPoint(WASALT);
  if (!pin || Math.abs(pin.lat - 24.920875653372303) > 1e-9 || Math.abs(pin.lng - 46.780616430492536) > 1e-9) out.push('a published pair (as PostgREST strings) did not become the pin');
  if (!mapPoint({ latitude: 24.92, longitude: 46.78 })) out.push('a published numeric pair did not become the pin');
  if (mapPoint(AQAR)) out.push('a row with NO coordinates got a pin');
  if (mapPoint({ latitude: 24.92, longitude: null })) out.push('latitude alone got a pin');
  if (mapPoint({ latitude: null, longitude: 46.78 })) out.push('longitude alone got a pin');
  if (mapPoint({ latitude: '', longitude: '46.78' })) out.push('an empty latitude string got a pin');
  if (mapPoint({ latitude: 0, longitude: 0 })) out.push('the (0,0) default got a pin');
  if (mapPoint({ latitude: 'abc', longitude: 'def' })) out.push('garbage coordinates got a pin');
  if (mapPoint(null)) out.push('no row got a pin');
  return out;
};

const real = problems(await lift(DATA));
check('a pin needs BOTH published coordinates — strings or numbers, never a half, never (0,0)', real.length === 0, real.join('\n      '));

const sourceMutant = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); };

// ── asking prices: each house once, down sites out, junk out, never under 10 houses ──────────────
type Stats = (rows: Record<string, unknown>[], down: Set<string>) => { houses: number; ads: number; sites: number; p10: number; median: number; p90: number; medianPpm: number | null } | null;
const liftStats = async (file: string): Promise<Stats> => (await liftSymbols(file, [
  { header: 'const num = (', endsWith: /: NaN;$/ },
  { header: 'export const PRICE_MIN', endsWith: /;$/ }, { header: 'export const PRICE_MAX', endsWith: /;$/ }, { header: 'const MIN_HOUSES', endsWith: /;$/ },
  { header: 'const percentile = (' },
  { header: 'export function askingPriceStats(' },
], ['askingPriceStats'])).askingPriceStats as Stats;
// Ten licensed houses at 1.0M…1.9M (200 m² → 5,000…9,500 per m²) + the first one AGAIN on another site at
// 1.5M (one house, its lowest figure) + two identical unlicensed rows (one house, 4,000 per m²) + a 50k typo
// + a 9M row on a DOWN site. 11 houses: p10 1.1M · median 1.4M · p90 1.8M · median per m² 7,000.
const M = 1_000_000;
const FIXTURE: Record<string, unknown>[] = [
  ...Array.from({ length: 10 }, (_, i) => ({ platform: i % 2 ? 'wasalt' : 'aqar', license_number: `L${i}`, area_m2: 200, price_total: String(M + i * 100_000) })),
  { platform: 'wasalt', license_number: 'L0', area_m2: 200, price_total: '1500000' },
  { platform: 'sakan', license_number: null, area_m2: 300, price_total: '1200000' },
  { platform: 'sakan', license_number: '', area_m2: 300, price_total: 1_200_000 },
  { platform: 'aqar', license_number: 'J1', area_m2: 100, price_total: '50000' },
  { platform: 'toor', license_number: 'D1', area_m2: 200, price_total: '9000000' },
];
const statsProblems = (stats: Stats): string[] => {
  const out: string[] = [];
  const r = stats(FIXTURE, new Set(['toor']));
  if (!r) return ['the fixture (11 houses) produced no numbers'];
  // what the explanation prints: the ads that passed the filters (13: the 10 + the repeat + two unlicensed; the 50k typo and the down site are out) and the websites they came from (aqar, wasalt, sakan)
  if (r.ads !== 13) out.push(`ads ${r.ads} ≠ 13 (a typo or a down site's row was counted as an ad, or a row was dropped)`);
  if (r.sites !== 3) out.push(`sites ${r.sites} ≠ 3 (a down site counted as a source, or one missed)`);
  if (r.houses !== 11) out.push(`houses: ${r.houses} ≠ 11 (a house listed twice was counted twice, or the junk/down rows got in)`);
  if (Math.abs(r.p10 - 1.1 * M) > 1) out.push(`p10 ${r.p10} ≠ 1.1M`);
  if (Math.abs(r.median - 1.4 * M) > 1) out.push(`median ${r.median} ≠ 1.4M`);
  if (Math.abs(r.p90 - 1.8 * M) > 1) out.push(`p90 ${r.p90} ≠ 1.8M (the down site's 9M or the 50k typo got in)`);
  if (r.medianPpm == null || Math.abs(r.medianPpm - 7000) > 1) out.push(`median per m² ${r.medianPpm} ≠ 7,000`);
  if (stats(FIXTURE.slice(0, 9), new Set()) !== null) out.push('nine houses still produced numbers (floor is 10)');
  if (r.each.length !== 11) out.push(`the deduped set has ${r.each.length} houses ≠ 11`);
  // 11 prices summing to 15.7M → mean 1,427,273; 11 per-m² prices summing to 76,500 → mean 6,955.
  if (Math.abs(r.mean - 15_700_000 / 11) > 1) out.push(`mean ${r.mean} ≠ 1,427,273`);
  if (r.meanPpm == null || Math.abs(r.meanPpm - 76_500 / 11) > 1) out.push(`mean per m² ${r.meanPpm} ≠ 6,955`);
  // The key carries the TYPE (owner update 24): the same licence + area as a villa AND as a floor is two houses.
  const typed = stats([...FIXTURE, { platform: 'aqar', license_number: 'L1', area_m2: 200, price_total: '900000', type_ar: 'دور' }], new Set(['toor']));
  if (!typed || typed.houses !== 12) out.push(`a different TYPE under the same licence + area was folded into one house (${typed?.houses})`);
  return out;
};
const statsReal = statsProblems(await liftStats(DATA));
check('asking prices: each house once (licence+area, lowest figure), junk and down sites out, nothing under 10 houses', statsReal.length === 0, statsReal.join('\n      '));
const mustCatchStats = async (what: string, from: string, to: string) => {
  if (!DATA_SRC.includes(from)) { failed++; console.log(`FAIL  mutation anchor missing: ${what}`); return; }
  const file = join(mkdtempSync(join(tmpdir(), 'ad-prices-')), 'adPageData.ts');
  writeFileSync(file, DATA_SRC.replace(from, to));
  const caught = statsProblems(await liftStats(file)).length > 0;
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
await mustCatchStats('a house counted once per row', 'if (!cur || price < cur.price) best.set(key, { price, area });', 'best.set(`${key}|${best.size}`, { price, area });');
await mustCatchStats('the ad count including a junk-price row', 'if (!Number.isFinite(price) || price < PRICE_MIN || price > PRICE_MAX) continue;\n    ads++;\n    sites.add(platform);', 'ads++;\n    sites.add(platform);\n    if (!Number.isFinite(price) || price < PRICE_MIN || price > PRICE_MAX) continue;');
await mustCatchStats('the website count counting every ad as a website', 'sites.add(platform);', "sites.add(platform + ads);");
await mustCatchStats('a junk price counted', 'if (!Number.isFinite(price) || price < PRICE_MIN || price > PRICE_MAX) continue;', 'if (!Number.isFinite(price)) continue;');
await mustCatchStats('numbers shown from a handful of houses', 'if (best.size < MIN_HOUSES) return null;', 'if (best.size < 1) return null;');
await mustCatchStats('the type dropped from the dedupe key', 'const key = lic ? `${lic}|${type}|${area}` : `${platform}|${type}|${price}|${area}`;', 'const key = lic ? `${lic}|${area}` : `${platform}|${price}|${area}`;');

// ── the «الأسعار» block's other three rules (owner 2026-10-10) ──────────────────────────────────
type Split = { n: number; dearer: number; cheaper: number; k: number } | null;
type Block = {
  isSameAd: (a: Row, b: Row) => boolean;
  dearerSplit: (each: { price: number; area: number }[], adPpm: number) => Split;
  sameAdSiblings: (own: Row, rows: Row[], down: Set<string>) => Row[];
  mojFacts: (row: Row | null) => { path: string | null; deals: number; avgDeal: number; avgPpm: number; p10: number | null; p90: number | null; from: string; to: string } | null;
};
const liftBlock = async (file: string): Promise<Block & Stats> => {
  const mod = await liftSymbols(file, [
    { header: 'const num = (', endsWith: /: NaN;$/ },
    { header: 'export const PRICE_MIN', endsWith: /;$/ }, { header: 'export const PRICE_MAX', endsWith: /;$/ }, { header: 'const MIN_HOUSES', endsWith: /;$/ }, { header: 'const MOJ_MIN_DEALS', endsWith: /;$/ },
    { header: 'const percentile = (' },
    { header: 'export function askingPriceStats(' },
    { header: 'export function dearerSplit(' },
    { header: 'export function isSameAd(' },
    { header: 'export function sameAdSiblings(' },
    { header: 'export function mojFacts(' },
  ], ['askingPriceStats', 'dearerSplit', 'isSameAd', 'sameAdSiblings', 'mojFacts']);
  return Object.assign(mod.askingPriceStats as Stats, mod) as unknown as Block & Stats;
};
// The real pair (2026-10-10): aqar 13462300 and wasalt 7392441 — licence 7201079013, 199 m², different prices.
const SAME_A: Row = { source_table: 'aqar_residential_listings', listing_id: 13462300, platform: 'aqar', license_number: '7201079013', area_m2: 199, price_total: '1100000' };
const SAME_B: Row = { source_table: 'wasalt_residential_listings', listing_id: 7392441, platform: 'wasalt', license_number: '7201079013', area_m2: '199', price_total: '1250000' };
// Ten houses at 5,000…9,500 per m², the dearest one listed on FIVE more sites: deduped, 5 of 10 cost more
// than 7,000 per m² → k = 5; counted per row, 10 of 15 → k = 7.
const K_FIXTURE: Row[] = [
  ...Array.from({ length: 10 }, (_, i) => ({ platform: 'aqar', license_number: `K${i}`, area_m2: 200, price_total: String(M + i * 100_000) })),
  ...['wasalt', 'sakan', 'dealapp', 'sukna', 'aqargate'].map((platform) => ({ platform, license_number: 'K9', area_m2: 200, price_total: '1900000' })),
];
// The seeded ministry row (الرياض · حي الرمال, 2026-10-10): the period ends in May 2026, not today.
const MOJ_ROW: Row = { moj_region: 'منطقة الرياض', moj_area: 'الرياض/الرمال', deals: 285, avg_deal: '1390633.21', avg_ppm: '4449.37', p10_deal: '430000', p90_deal: '1650000', window_from: '2025-10-10', window_to: '2026-05-18', source_refreshed_at: '2026-10-10T03:09:39+00:00' };
const blockProblems = (b: Block & Stats): string[] => {
  const out: string[] = [];
  if (!b.isSameAd(SAME_A, SAME_B) || !b.isSameAd(SAME_B, SAME_A)) out.push('the real aqar/wasalt pair (same licence + area, different price) was not matched');
  if (b.isSameAd(SAME_A, { ...SAME_B, license_number: '7201079014' })) out.push('a DIFFERENT licence was shown as the same ad');
  if (b.isSameAd(SAME_A, { ...SAME_B, area_m2: 200 })) out.push('a different area was shown as the same ad');
  if (b.isSameAd(SAME_A, { ...SAME_B, platform: 'aqar' })) out.push('the same platform was offered as another site');
  if (b.isSameAd({ ...SAME_A, license_number: '' }, { ...SAME_B, license_number: '' })) out.push('two rows WITHOUT a licence were matched');
  const ks = b(K_FIXTURE, new Set());
  const kd = ks ? b.dearerSplit(ks.each, 7000) : null;
  if (kd?.k !== 5) out.push(`k = ${kd?.k} ≠ 5 (not computed from the deduped set)`);
  if (b.dearerSplit([], 7000) !== null || b.dearerSplit([{ price: M, area: 200 }], 0) !== null) out.push('k shown without houses or without an ad m² price');
  // The live case (aqar 14856194, 2,900,000 / 312 m² = 9,295/m²): 36 of 1,493 villas dearer → the sentence says 36,
  // the picture shows ONE dark glyph — never «0 أغلى» while 36 are dearer.
  const h = (ppm: number) => ({ price: ppm * 100, area: 100 });
  const LIVE = [...Array.from({ length: 36 }, () => h(12_000)), ...Array.from({ length: 1457 }, () => h(5_000))];
  const live = b.dearerSplit(LIVE, 9295);
  if (!live || live.n !== 1493 || live.dearer !== 36 || live.cheaper !== 1457) out.push(`36/1493: counts ${JSON.stringify(live)}`);
  if (live?.k !== 1) out.push(`36/1493: k = ${live?.k} ≠ 1 (the picture must not show 0 while 36 are dearer)`);
  const none = b.dearerSplit(Array.from({ length: 20 }, () => h(5_000)), 9295);
  if (none?.dearer !== 0 || none?.k !== 0) out.push(`none dearer: ${JSON.stringify(none)} (k must be 0)`);
  const all = b.dearerSplit(Array.from({ length: 20 }, () => h(12_000)), 9295);
  if (all?.cheaper !== 0 || all?.k !== 10) out.push(`all dearer: ${JSON.stringify(all)} (k must be 10)`);
  const nearlyAll = b.dearerSplit([...Array.from({ length: 1492 }, () => h(12_000)), h(5_000)], 9295);
  if (nearlyAll?.k !== 9) out.push(`1492 of 1493 dearer: k = ${nearlyAll?.k} ≠ 9 (the picture must not show 10 while one is cheaper)`);
  const eq = b.dearerSplit([h(12_000), h(9_295), h(9_295), h(5_000)], 9295);
  if (!eq || eq.n !== 4 || eq.dearer !== 1 || eq.cheaper !== 1) out.push(`equal per-m² houses must count in neither: ${JSON.stringify(eq)}`);
  // Duplicates on the SAME live set as the asking stats: a hidden site (dwelleo) with the same licence neither appears nor counts.
  const DWELLEO: Row = { source_table: 'dwelleo_residential_listings', listing_id: 77, platform: 'dwelleo', license_number: '7201079013', area_m2: 199, price_total: '1300000' };
  const sibs = b.sameAdSiblings(SAME_A, [SAME_A, SAME_B, DWELLEO, { ...SAME_B, listing_id: 1 }], new Set(['dwelleo']));
  if (sibs.length !== 1 || sibs[0].platform !== 'wasalt') out.push(`siblings with dwelleo hidden: ${sibs.map((r) => r.platform).join(',')} ≠ wasalt alone (one per platform, hidden site out)`);
  if (b.sameAdSiblings(SAME_A, [SAME_B, DWELLEO], new Set()).length !== 2) out.push('with nothing hidden, both other sites should show');
  const f = b.mojFacts(MOJ_ROW);
  if (!f) return [...out, 'the seeded ministry row produced no facts'];
  if (f.deals !== 285) out.push(`deals ${f.deals} ≠ 285`);
  if (f.avgPpm !== 4449.37) out.push(`avg_ppm ${f.avgPpm} ≠ 4449.37 (recomputed, not the ministry’s own mean)`);
  if (f.avgDeal !== 1390633.21) out.push(`avg_deal ${f.avgDeal} ≠ 1390633.21`);
  if (f.from !== '2025-10-10' || f.to !== '2026-05-18') out.push(`period ${f.from} → ${f.to} ≠ the row’s own 2025-10-10 → 2026-05-18 (taken from the clock?)`);
  if (f.p10 !== 430000 || f.p90 !== 1650000) out.push(`the ministry spread ${f.p10} – ${f.p90} ≠ the row’s 430,000 – 1,650,000`);
  // where to find them in the ministry's report: Region / City / District exactly as the ministry names them; none when it is incomplete
  if (f.path !== 'منطقة الرياض / الرياض / الرمال') out.push(`the ministry path «${f.path}» ≠ «منطقة الرياض / الرياض / الرمال»`);
  if (b.mojFacts({ ...MOJ_ROW, moj_area: 'الرياض' })?.path !== null) out.push('a path was built from a half-known area');
  if (b.mojFacts({ ...MOJ_ROW, moj_region: null })?.path !== null) out.push('a path was built without the region');
  const half = b.mojFacts({ ...MOJ_ROW, p90_deal: null });
  if (!half || half.p10 !== null || half.p90 !== null) out.push('a half-filled spread was shown (or the row dropped)');
  if (b.mojFacts({ ...MOJ_ROW, deals: 9 }) !== null) out.push('nine deals still produced a card (floor is 10)');
  if (b.mojFacts(null) !== null) out.push('no row produced a card');
  return out;
};
const blockReal = blockProblems(await liftBlock(DATA));
check('same ad = licence + area, other platform; k from the deduped set; the ministry’s numbers and period as the row carries them', blockReal.length === 0, blockReal.join('\n      '));
const mustCatchBlock = async (what: string, from: string, to: string) => {
  if (!DATA_SRC.includes(from)) { failed++; console.log(`FAIL  mutation anchor missing: ${what}`); return; }
  const file = join(mkdtempSync(join(tmpdir(), 'ad-block-')), 'adPageData.ts');
  writeFileSync(file, DATA_SRC.replace(from, to));
  const caught = blockProblems(await liftBlock(file)).length > 0;
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
await mustCatchBlock('a different licence shown as the same ad', "if (!lic || lic !== String(other.license_number ?? '').trim()) return false;", 'if (!lic) return false;');
await mustCatchBlock('a different area shown as the same ad', 'if (!Number.isFinite(a) || !(a > 0) || a !== b) return false;', 'if (!Number.isFinite(a) || !(a > 0)) return false;');
await mustCatchBlock('k computed from every row instead of the deduped set', 'each: [...best.values()],', 'each: rows.map((r) => ({ price: num(r.price_total), area: num(r.area_m2) })),');
await mustCatchBlock('the picture showing 0 while some house is dearer (no lower clamp)', 'Math.max(dearer > 0 ? 1 : 0, raw)', 'raw');
await mustCatchBlock('the picture showing 10 while some house is cheaper (no upper clamp)', 'Math.min(cheaper > 0 ? 9 : 10, ', 'Math.min(10, ');
await mustCatchBlock('an equal per-m² house counted as dearer', 'const dearer = ppms.filter((p) => p > adPpm).length;', 'const dearer = ppms.filter((p) => p >= adPpm).length;');
await mustCatchBlock('a hidden site shown and counted as a duplicate', 'if (!platform || downSlugs.has(platform)) continue;\n    if (!isSameAd(own, r)', 'if (!platform) continue;\n    if (!isSameAd(own, r)');
await mustCatchBlock('the ministry period taken from the clock', "const from = String(row.window_from ?? '').slice(0, 10), to = String(row.window_to ?? '').slice(0, 10);", "const from = String(row.window_from ?? '').slice(0, 10), to = new Date().toISOString().slice(0, 10);");
await mustCatchBlock('avg_ppm recomputed instead of shown', 'const deals = num(row.deals), avgDeal = num(row.avg_deal), avgPpm = num(row.avg_ppm);', 'const deals = num(row.deals), avgDeal = num(row.avg_deal), avgPpm = Math.round(num(row.avg_deal) / 312);');
await mustCatchBlock('the ministry spread invented from its average', "const p10 = num(row.p10_deal), p90 = num(row.p90_deal);", 'const p10 = num(row.avg_deal) * 0.3, p90 = num(row.avg_deal) * 1.2;');
await mustCatchBlock('the ministry path built without its region', "const path = region && city && district ? `${region} / ${city} / ${district}` : null;", "const path = city && district ? `${city} / ${district}` : null;");
await mustCatchBlock('the ministry path built from a half-known area', "const path = region && city && district ?", "const path = region && city ?");
await mustCatchBlock('the ministry card shown from a handful of deals', 'deals < MOJ_MIN_DEALS', 'deals < 1');
// The tiles multiply the SHOWN averages by the ad's own area; k comes from the deduped set.
const tilesWired = (p: string) => /dearerSplit\(prices\.stats\.each, adPpm\)/.test(p)
  // the sentence prints the EXACT counts and the glyphs read split.k; the duplicates wrap in two columns, no sideways scroll
  && /\{ n: fmtInt\(split\.n\), type: typePlural\(\), dearer: fmtInt\(split\.dearer\), cheaper: fmtInt\(split\.cheaper\) \}/.test(p) && /i < split\.k \? s\.houseUp : s\.houseDn/.test(p)
  && /sameRow: \{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 \}/.test(p) && !/<ScrollView horizontal[^>]*s\.sameRow/.test(p)
  // the tile is computed from the SHOWN figure (tileFromShown) and prints exactly those figures beneath it
  && /fmtInt\(tileFromShown\(prices\.stats\.meanPpm, prices\.area\)\)/.test(p)
  && /\$\{fmtInt\(prices\.stats\.meanPpm\)\} × \$\{fmtInt\(prices\.area\)\}/.test(p)
  // the split card prints our MEANS beside the ministry's means, and the same four labels on both halves
  && /fmtM\(st\.mean\)/.test(p) && /fmtInt\(st\.meanPpm\)/.test(p) && /fmtInt\(mj\.avgPpm\)/.test(p) && /labels\.map\(\(label, i\) => cell\(label, h\.rows\[i\]/.test(p)
  // the ministry half names its source and its window; a figure the row lacks is a hidden cell («—»), never an estimate
  && /h\.gov \? \(\s*<Pressable[\s\S]{0,600}\{t\('Source: Ministry of Justice'\)\}/.test(p) && /mj\.p10 != null && mj\.p90 != null \? `\$\{fmtM\(mj\.p10\)\} – \$\{fmtM\(mj\.p90\)\} \$\{t\('million'\)\}` : null/.test(p);
check('the tiles multiply the shown averages by this ad’s area and k reads the deduped set', tilesWired(PREVIEW));
sourceMutant('the listed tile recomputing the per-m² figure', !tilesWired(PREVIEW.replace('tileFromShown(prices.stats.meanPpm, prices.area)', 'Math.round(prices.stats.mean)')));
sourceMutant('the duplicates row scrolling sideways again', !tilesWired(PREVIEW.replace("sameRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }", 'sameRow: { gap: 8 }')));
sourceMutant('the sentence back to rounded tenths', !tilesWired(PREVIEW.replaceAll('dearer: fmtInt(split.dearer), cheaper: fmtInt(split.cheaper) }', 'dearer: split.k, cheaper: 10 - split.k }')));
sourceMutant('a tile multiplying the unrounded figure instead of the shown one', !tilesWired(PREVIEW.replace('fmtInt(tileFromShown(prices.stats.meanPpm, prices.area))', 'fmtInt(Math.round(prices.stats.meanPpm * prices.area / 1000) * 1000)')));

// ── HONEST LABELS (owner 2026-10-16: «accuracy, transparency, legal safety — no misleading comparisons») ─────────────
// 1. NO tile may multiply the ministry's per-m² mean by THIS ad's area: the ministry's mean spans every deal it classified
//    residential (it records no property type), so «villa area × that mean» reads as «what a similar villa sold for».
// 2. The ministry's half says what it IS (its class, and that the type is not recorded) and never lists types it does not know.
// 3. Our half lists EXACTLY the types the query uses; the explanation prints the ads / websites / properties from the stats
//    object, the price band from the constants, and says the numbers are neighbourhood numbers, not a valuation.
const I18N = readFileSync(join(ROOT, 'src/i18n.tsx'), 'utf8');
const RESIDENTIAL_TYPES = (DATA_SRC.match(/export const RESIDENTIAL_GROUP_AR: readonly string\[\] = \[([^\]]*)\]/)?.[1] ?? '').split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean);
const labelsHonest = (p: string, i18n: string): string[] => {
  const out: string[] = [];
  if (/prices\.moj\.avgPpm,\s*prices\.area/.test(p) || /prices\.moj\.avg\w*\s*\*\s*prices\.area/.test(p) || /At the sold average/.test(p) || /At the sold average/.test(i18n))
    out.push('a tile multiplies the ministry’s per-m² mean by this ad’s area («At the sold average»)');
  if (/villas, apartments and land/.test(p) || /villas, apartments and land/.test(i18n)) out.push('the ministry’s half lists property types the ministry does not record');
  if (!/Classified residential by the Ministry, which does not record the property type\./.test(p) || !/Classified commercial by the Ministry, which does not record the property type\./.test(p)) out.push('the ministry’s half does not say it records no property type');
  if (!/All residential types listed for sale: \{types\}/.test(p) || !/\{ types: typesList \}/.test(p)) out.push('our half does not list the types it is made of');
  for (const need of ['prices.moj?.path', 'path: prices.moj.path', 'The report cannot open already filtered.', 'prices.group.ads', 'prices.group.sites', 'prices.group.houses', 'PRICE_MIN', 'PRICE_MAX', 'These are neighbourhood numbers. They are not a valuation of this property and not the sale price of a similar one.', "setExplainOpen((o) => !o)", 'listing-preview-prices-explain'])
    if (!p.includes(need)) out.push(`the explanation is missing «${need}»`);
  // our half's type list names every type the query uses (so adding a type to RESIDENTIAL_GROUP_AR fails here until the words follow)
  const words: Record<string, string> = { 'فيلا': 'villas', 'شقة': 'apartments', 'دور': 'floors', 'أرض سكنية': 'residential land', 'عمارة': 'buildings', 'تاون هاوس': 'townhouses', 'ملحق علوي': 'rooftop annexes' };
  const listed = p.match(/'(villas, apartments, floors[^']*)'/)?.[1] ?? '';
  if (RESIDENTIAL_TYPES.length !== 7 || RESIDENTIAL_TYPES.some((t) => !words[t])) out.push(`RESIDENTIAL_GROUP_AR changed (${RESIDENTIAL_TYPES.join(' | ')}): update the words in the explanation`);
  for (const t of RESIDENTIAL_TYPES) if (words[t] && !listed.includes(words[t])) out.push(`our type list omits «${words[t]}» (${t})`);
  return out;
};
// The ministry's source is a REAL LINK that opens a new tab (owner 2026-10-16). The page cannot be framed (X-Frame-Options SAMEORIGIN and
// CSP frame-ancestors allow only itself and Microsoft domains), so an in-page viewer would show a blank box: new tab only, URL pinned.
const MOJ_URL = 'https://moj.gov.sa/ar/OpenData/PowerBIReport/Pages/BIReportRealestate.aspx';
const mojLinkOk = (p: string, d: string): boolean =>
  new RegExp(`export const MOJ_SOURCE_URL = '${MOJ_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}';`).test(d)
  && /testID="listing-preview-moj-source"[\s\S]{0,200}onPress=\{\(\) => open\(MOJ_SOURCE_URL\)\}[\s\S]{0,120}accessibilityRole="link"/.test(p)
  && /h\.gov \? \(\s*<Pressable/.test(p) && !/<iframe|<Frame[^>]*MOJ_SOURCE_URL|src=\{MOJ_SOURCE_URL\}/.test(p);
check('the ministry source is a real link that opens the exact ministry page in a new tab (never framed)', mojLinkOk(PREVIEW, DATA_SRC));
sourceMutant('the source link going back to plain text', !mojLinkOk(PREVIEW.replace('onPress={() => open(MOJ_SOURCE_URL)}', ''), DATA_SRC));
sourceMutant('the source link pointing at another page', !mojLinkOk(PREVIEW, DATA_SRC.replace(MOJ_URL, 'https://moj.gov.sa/')));
sourceMutant('the source shown inside our page in a frame', !mojLinkOk(PREVIEW + '\n<Frame src={MOJ_SOURCE_URL} />', DATA_SRC));

const honestReal = labelsHonest(PREVIEW, I18N);
check('honest labels: no sold-average tile, the ministry half names its class, our half names its types, the explanation is wired', honestReal.length === 0, honestReal.join('\n      '));
sourceMutant('the sold-average tile coming back', labelsHonest(PREVIEW + "\n<Text>{fmtInt(tileFromShown(prices.moj.avgPpm, prices.area))}</Text>", I18N).length > 0);
sourceMutant('the ministry half listing types again', labelsHonest(PREVIEW.replace('Classified residential by the Ministry, which does not record the property type.', 'villas, apartments and land'), I18N).length > 0);
sourceMutant('the explanation losing its «not a valuation» line', labelsHonest(PREVIEW.replace('These are neighbourhood numbers. They are not a valuation of this property and not the sale price of a similar one.', 'x'), I18N).length > 0);
sourceMutant('our type list forgetting townhouses', labelsHonest(PREVIEW.replace('townhouses and rooftop annexes', 'and rooftop annexes'), I18N).length > 0);
sourceMutant('the explanation hiding the number of ads', labelsHonest(PREVIEW.replace('prices.group.ads', '0'), I18N).length > 0);

// ── the tile equals the formula it displays (owner: a reader who multiplies the two printed numbers gets our number) ──
type Tile = (ppm: number, area: number) => number;
const liftTile = async (file: string): Promise<Tile> => (await liftSymbols(file, [{ header: 'export function tileFromShown(' }], ['tileFromShown'])).tileFromShown as Tile;
const shown = (v: number) => Math.round(v);
const tileProblems = (tile: Tile): string[] => {
  const out: string[] = [];
  // the real case from the review: 4,449.37 × 275 — the PRINTED 4,449 × 275 = 1,223,475 → 1,223,000, never 1,224,000
  if (tile(4449.37, 275) !== 1_223_000) out.push(`tile(4449.37, 275) = ${tile(4449.37, 275)} ≠ 1,223,000 (= round(4,449 × 275, -3))`);
  if (tile(6586.3, 275) !== 1_811_000) out.push(`tile(6586.3, 275) = ${tile(6586.3, 275)} ≠ 1,811,000`);
  for (const [p, a] of [[4449.37, 199], [6498.28, 199], [7815.4, 360], [10714.49, 267], [3724.9, 500]] as [number, number][]) {
    const want = Math.round((shown(p) * shown(a)) / 1000) * 1000;
    if (tile(p, a) !== want) out.push(`tile(${p}, ${a}) = ${tile(p, a)} ≠ round(${shown(p)} × ${shown(a)}, -3) = ${want}`);
  }
  return out;
};
const tileReal = tileProblems(await liftTile(DATA));
check('every product tile equals round(shown per-m² × shown area, -3) — the formula printed under it', tileReal.length === 0, tileReal.join('\n      '));
const mustCatchTile = async (what: string, from: string, to: string) => {
  if (!DATA_SRC.includes(from)) { failed++; console.log(`FAIL  mutation anchor missing: ${what}`); return; }
  const file = join(mkdtempSync(join(tmpdir(), 'ad-tile-')), 'adPageData.ts');
  writeFileSync(file, DATA_SRC.replace(from, to));
  const caught = tileProblems(await liftTile(file)).length > 0;
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
await mustCatchTile('the tile multiplying the unrounded per-m² figure (prints 1,224,000 under «4,449 × 275»)', 'return Math.round((Math.round(ppm) * Math.round(area)) / 1000) * 1000;', 'return Math.round((ppm * area) / 1000) * 1000;');
await mustCatchTile('the tile not rounded to the thousand', 'return Math.round((Math.round(ppm) * Math.round(area)) / 1000) * 1000;', 'return Math.round(ppm) * Math.round(area);');

// ── the embed URL: the official Maps Embed API (satellite) with a key, the keyless embed without ───
type Embed = (p: { lat: number; lng: number }, hl?: string, z?: 14 | 15) => string;
const liftEmbed = async (file: string): Promise<Embed> => (await liftSymbols(file, [{ header: 'export const mapEmbedUrl = (' }], ['mapEmbedUrl'])).mapEmbedUrl as Embed;
const PIN = { lat: 24.920875653372303, lng: 46.780616430492536 };
const embedProblems = (embed: Embed): string[] => {
  const out: string[] = [];
  const prev = process.env.EXPO_PUBLIC_GOOGLE_MAPS_EMBED_KEY;
  try {
    delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_EMBED_KEY;
    const free = embed(PIN, 'ar', 14);
    if (!/^https:\/\/maps\.google\.com\/maps\?q=24\.920875653372303,46\.780616430492536&z=14&t=h&hl=ar&output=embed$/.test(free)) out.push(`without a key the keyless satellite embed is expected, got ${free}`);
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_EMBED_KEY = 'TEST-KEY';
    const official = embed(PIN, 'ar', 15);
    if (!official.startsWith('https://www.google.com/maps/embed/v1/place?key=TEST-KEY&')) out.push(`with a key the official Maps Embed API is expected, got ${official}`);
    if (!official.includes('maptype=satellite')) out.push('the official embed is not satellite');
    if (!official.includes('q=24.920875653372303,46.780616430492536') || !official.includes('zoom=15') || !official.includes('language=ar')) out.push(`the official embed lost the pin, the zoom or the language: ${official}`);
  } finally {
    if (prev === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_EMBED_KEY; else process.env.EXPO_PUBLIC_GOOGLE_MAPS_EMBED_KEY = prev;
  }
  return out;
};
const embedReal = embedProblems(await liftEmbed(DATA));
check('with the owner’s key the official satellite embed, without it the keyless one — both carrying both coordinates', embedReal.length === 0, embedReal.join('\n      '));
const mustCatchEmbed = async (what: string, from: string, to: string) => {
  if (!DATA_SRC.includes(from)) { failed++; console.log(`FAIL  mutation anchor missing: ${what}`); return; }
  const file = join(mkdtempSync(join(tmpdir(), 'ad-embed-')), 'adPageData.ts');
  writeFileSync(file, DATA_SRC.replace(from, to));
  const caught = embedProblems(await liftEmbed(file)).length > 0;
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
await mustCatchEmbed('the official embed losing satellite', '&maptype=satellite&language=', '&language=');
await mustCatchEmbed('the keyless fallback gone when no key is set', 'return key\n    ?', 'return true\n    ?');
await mustCatchEmbed('the official embed dropping the longitude', '&q=${p.lat},${p.lng}&zoom=', '&q=${p.lat}&zoom=');

// ── scope: the prices block is for Aqar SALE ads only (owner update 22) ──────────────────────────
type Eligible = (row: Row | null) => boolean;
const liftEligible = async (file: string): Promise<Eligible> => (await liftSymbols(file, [{ header: 'export function pricesBlockEligible(' }], ['pricesBlockEligible'])).pricesBlockEligible as Eligible;
const eligibleProblems = (e: Eligible): string[] => {
  const out: string[] = [];
  if (!e({ platform: 'aqar', deal_ar: 'بيع', type_ar: 'فيلا' })) out.push('an Aqar sale ad got no prices block');
  if (!e({ platform: 'AQAR', deal_ar: 'بيع', type_ar: 'محل' })) out.push('an Aqar commercial sale ad got no prices block');
  if (e({ platform: 'aqar', deal_ar: 'إيجار', type_ar: 'فيلا' })) out.push('an Aqar RENT ad got a prices block');
  if (e({ platform: 'wasalt', deal_ar: 'بيع', type_ar: 'فيلا' })) out.push('a non-Aqar sale ad got a prices block');
  if (e({ platform: 'aqar', deal_ar: null, type_ar: 'فيلا' }) || e(null)) out.push('a row without a deal (or no row) got a prices block');
  if (e({ platform: 'aqar', deal_ar: 'بيع', type_ar: 'غير معروف' }) || e({ platform: 'aqar', deal_ar: 'بيع', type_ar: '' })) out.push('an ad whose type the source never stated got a prices block (our guess of its group)');
  // «أرض» = Other Land: the source states no usage (owner 2026-10-10) — no group to compare it with.
  if (e({ platform: 'aqar', deal_ar: 'بيع', type_ar: 'أرض' })) out.push('an Other Land plot («أرض», no stated usage) got a prices block');
  return out;
};
const eligibleReal = eligibleProblems(await liftEligible(DATA));
check('the prices block: Aqar + sale only; rent ads and other platforms render none', eligibleReal.length === 0, eligibleReal.join('\n      '));
const mustCatchEligible = async (what: string, from: string, to: string) => {
  if (!DATA_SRC.includes(from)) { failed++; console.log(`FAIL  mutation anchor missing: ${what}`); return; }
  const file = join(mkdtempSync(join(tmpdir(), 'ad-scope-')), 'adPageData.ts');
  writeFileSync(file, DATA_SRC.replace(from, to));
  const caught = eligibleProblems(await liftEligible(file)).length > 0;
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
await mustCatchEligible('a rent ad getting the block', " && String(row.deal_ar ?? '').trim() === 'بيع'\n", '\n');
await mustCatchEligible('an unknown-type ad getting the block', "\n    && !['', 'غير معروف', 'أرض'].includes(String(row.type_ar ?? '').trim());", ';');
await mustCatchEligible('an Other Land plot («أرض») getting the block', "'غير معروف', 'أرض']", "'غير معروف']");
await mustCatchEligible('a non-Aqar ad getting the block', "String(row.platform ?? '').trim().toLowerCase() === 'aqar' && ", '');
const gated = (p: string) => /if \(!pricesBlockEligible\(row\)\) return;\s*const price = Number\(row\?\.price_total\)/.test(p) && /fetchMojSales\(row, commercial \? 'تجاري' : 'سكني'\)/.test(p);
check('the page fetches the block only behind pricesBlockEligible(row), with the ministry class by macro', gated(PREVIEW));
sourceMutant('the page fetching the block for every ad', !gated(PREVIEW.replace('if (!pricesBlockEligible(row)) return;', '')));

// ── a duplicate site card opens THAT platform's own listing_url (owner update 25): real cards through
//    finalize() (source_url = the source table's listing_url), the href through listingOpenUrl — never a URL
//    built from our internal id ──────────────────────────────────────────────────────────────────────
const siteHrefWired = (p: string, dataSrc: string, remoteSrc: string) =>
  /href: listingOpenUrl\(sib\) \?\? ''/.test(p)
  && !/href: `[^`]*\$\{(?:sib|card)\.id\}/.test(p) && !/listing_id/.test(p)
  && /const cards = await Promise\.all\(\[\.\.\.byTable\]\.map\(\(\[t, ids\]\) => fetchListingCards\(t, ids\)\)\);/.test(dataSrc)
  && /source_url: r\.listing_url,/.test(remoteSrc);
const REMOTE = codeOnly(readFileSync(join(ROOT, 'src/data/remote.ts'), 'utf8'));
check('a duplicate site card opens the platform’s own listing_url (real card → listingOpenUrl), never an id-built URL', siteHrefWired(PREVIEW, codeOnly(DATA_SRC), REMOTE));
sourceMutant('a site card href built from our id', !siteHrefWired(PREVIEW.replace("href: listingOpenUrl(sib) ?? ''", 'href: `https://wasalt.sa/ar/listing/${sib.id}`'), codeOnly(DATA_SRC), REMOTE));
sourceMutant('the siblings handed over as index rows instead of real cards', !siteHrefWired(PREVIEW, codeOnly(DATA_SRC).replace('const cards = await Promise.all([...byTable].map(([t, ids]) => fetchListingCards(t, ids)));', 'const cards = [[...byTable].map(([t, ids]) => ({ source: t, id: ids[0] }))];'), REMOTE));

// ── the split card follows the ministry's GROUP (owner update 24): our half is the macro group, never this ad's type ──
const groupWired = (p: string, dataSrc: string) =>
  /fetchGroupPrices\(row, commercial \? 'Commercial' : 'Residential'\)/.test(p)
  && /const st = prices\.group, mj = prices\.moj;/.test(p)
  && /dearerSplit\(prices\.stats\.each, adPpm\)/.test(p)             // card 3 stays same-type
  && /\.in\('type_ar', \[\.\.\.scope\.types\]\)/.test(dataSrc)
  // paged reads are ORDERED on a stable key, or the pages overlap and houses go missing (measured: 3,192 vs 3,728)
  && /\.order\('source_table'\)\.order\('listing_id'\)\.range\(page \* PAGE, page \* PAGE \+ PAGE - 1\)/.test(dataSrc)
  && /types: groupTypesAr\(group\), key: `group:\$\{group\}`/.test(dataSrc)
  && /RESIDENTIAL_GROUP_AR: readonly string\[\] = \['فيلا', 'شقة', 'دور', 'أرض سكنية', 'تاون هاوس', 'عمارة', 'ملحق علوي'\]/.test(dataSrc);
check('the split card’s right half is the macro group the ministry’s half is built on; card 3 stays same-type', groupWired(PREVIEW, codeOnly(DATA_SRC)));
sourceMutant('a residential ad’s right half filtered to its own type', !groupWired(PREVIEW.replace('const st = prices.group, mj = prices.moj;', 'const st = prices.stats, mj = prices.moj;'), codeOnly(DATA_SRC)));
sourceMutant('the group read narrowed to the ad’s type', !groupWired(PREVIEW, codeOnly(DATA_SRC).replace('types: groupTypesAr(group), key: `group:${group}`', 'types: [row.type_ar as string], key: `group:${group}`')));
sourceMutant('the paged read losing its order (overlapping pages)', !groupWired(PREVIEW, codeOnly(DATA_SRC).replace(".order('source_table').order('listing_id').range(", '.range(')));

// ── wiring: the page draws only the fetched pin; the data module never guesses one ────────────────
const wired = (dataSrc: string, previewSrc: string) =>
  /const geo = mapPoint\(own\);\s*return \{ geo, row: own \};/.test(dataSrc)
  && /select\(AD_ROW_SELECT\)\.eq\('source_table', l\.sourceTable\)\.eq\('listing_id', l\.id\)/.test(dataSrc)
  && /const AD_ROW_SELECT = 'latitude,longitude,/.test(dataSrc)
  && !/geocod|centroid/i.test(dataSrc) && !/mapPoint\((?!own\)|row[):])/.test(dataSrc)
  && /\{geo && IS_WEB \? \(/.test(previewSrc) && /\{mapOpen && geo && IS_WEB \? \(/.test(previewSrc)
  && /mapEmbedUrl\(geo, locale, 14\)/.test(previewSrc) && /mapEmbedUrl\(geo, locale, 15\)/.test(previewSrc) && !/mapEmbedUrl\((?!geo, locale, 1[45]\))/.test(previewSrc)
  && (previewSrc.match(/window\.open\(/g) ?? []).length === 1;   // only the one button to the real ad — never the map
check('the page draws the map only from the fetched pin, both previews use the same embed, and only the ad button opens a tab', wired(codeOnly(DATA_SRC), PREVIEW));

// ── mutation proofs ──────────────────────────────────────────────────────────────────────────────
const mustCatch = async (what: string, from: string, to: string) => {
  if (!DATA_SRC.includes(from)) { failed++; console.log(`FAIL  mutation anchor missing: ${what}`); return; }
  const file = join(mkdtempSync(join(tmpdir(), 'ad-map-')), 'adPageData.ts');
  writeFileSync(file, DATA_SRC.replace(from, to));
  const caught = problems(await lift(file)).length > 0;
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
await mustCatch('a pin from one coordinate', 'if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;', 'if (!Number.isFinite(lat) && !Number.isFinite(lng)) return null;');
await mustCatch('a pin from the (0,0) default', 'if (lat === 0 || lng === 0) return null;', '');
sourceMutant('a district-centroid fallback for the pin', !wired(codeOnly(DATA_SRC).replace('const geo = mapPoint(own);', 'const geo = mapPoint(own) ?? { lat: 24.7136, lng: 46.6753 };'), PREVIEW));
sourceMutant('the page drawing a map without a pin', !wired(codeOnly(DATA_SRC), PREVIEW.replace('{geo && IS_WEB ? (', '{IS_WEB ? (')));
sourceMutant('the map opening a new tab from our UI', !wired(codeOnly(DATA_SRC), PREVIEW.replace('const openMap = () => {', "const openMap = () => { window.open(mapEmbedUrl(geo, locale, 15), '_blank');")));

// ── the page counts only what search shows (owner 2026-10-10: a site the engineer marks dead/suspended
// is hidden EVERYWHERE). Search's own switch is production_ready (a dormant platform's rows are false);
// both search_listings_ar reads behind the block must carry it, on top of the registry's down list.
const prodGated = (src: string) => {
  const reads = codeOnly(src).match(/from\('search_listings_ar'\)[^;]*?\.(limit|range)\(/g) ?? [];
  const block = reads.filter((r) => /license_number|deal_ar/.test(r));   // the duplicates + asking-price reads
  return block.length === 2 && block.every((r) => /\.eq\('production_ready', true\)/.test(r));
};
check('the duplicates and asking-price reads count only rows search shows (production_ready)', prodGated(DATA_SRC));
sourceMutant('the duplicates read without search\'s switch', !prodGated(DATA_SRC.replace(".eq('area_m2', area).eq('production_ready', true)", ".eq('area_m2', area)")));
sourceMutant('the asking-price read without search\'s switch', !prodGated(DATA_SRC.replace(".eq('district_ar', row.district_ar as string).eq('production_ready', true)", ".eq('district_ar', row.district_ar as string)")));

// ── the gold buzzer's motion must reach the browser. react-native-web DROPS transform arrays inside
// animationKeyframes — the generated @keyframes come out empty (measured live 2026-10-10: the shine's
// rule was `0% { } 28% { } 100% { }`, so it never moved on any listing; the tap ring never burst).
// String properties survive (boxShadow, backgroundPosition, backgroundColor). So: no transform in any
// keyframe on this page, and the shine moves by background position.
const PREVIEW_RAW = readFileSync(join(ROOT, 'src/components/ListingPreview.tsx'), 'utf8');
const keyframeBlocks = (src: string) => codeOnly(src).match(/animationKeyframes: \[\{[\s\S]*?\}\]/g) ?? [];
const motionOk = (src: string) => {
  const blocks = keyframeBlocks(src);
  const shine = /goldShine: \{[\s\S]*?animationKeyframes: \[\{[^\]]*backgroundPosition: '110% 0'[^\]]*backgroundPosition: '-10% 0'/.test(codeOnly(src));
  return blocks.length >= 3 && blocks.every((b) => !/transform/.test(b)) && shine;
};
check('every keyframe on the ad page uses properties react-native-web keeps (no transform); the shine sweeps by background position', motionOk(PREVIEW_RAW));
sourceMutant('a transform keyframe (silently empty on web)', !motionOk(PREVIEW_RAW.replace("'60%': { backgroundPosition: '-10% 0' }", "'60%': { backgroundPosition: '-10% 0', transform: [{ translateX: '-130%' }] }")));
sourceMutant('a shine that never moves', !motionOk(PREVIEW_RAW.replace("'0%': { backgroundPosition: '110% 0' }, '60%': { backgroundPosition: '-10% 0' }", "'0%': { opacity: 1 }, '60%': { opacity: 1 }")));

console.log(failed === 0 ? '\n✅ the ad page pins only what the source published, and its prices block shows only computed-for-this-ad, source-true numbers.\n' : `\n❌ ${failed} check(s) failed — a guessed pin or a wrong number can reach the page.\n`);
process.exit(failed === 0 ? 0 : 1);
