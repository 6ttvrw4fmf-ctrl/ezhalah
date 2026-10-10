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

// ── asking prices: each house once, down sites out, junk out, never under 10 houses ──────────────
type Stats = (rows: Record<string, unknown>[], down: Set<string>) => { houses: number; p10: number; median: number; p90: number; medianPpm: number | null } | null;
const liftStats = async (file: string): Promise<Stats> => (await liftSymbols(file, [
  { header: 'const num = (', endsWith: /: NaN;$/ },
  { header: 'const PRICE_MIN', endsWith: /;$/ }, { header: 'const PRICE_MAX', endsWith: /;$/ }, { header: 'const MIN_HOUSES', endsWith: /;$/ },
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
  if (r.houses !== 11) out.push(`houses: ${r.houses} ≠ 11 (a house listed twice was counted twice, or the junk/down rows got in)`);
  if (Math.abs(r.p10 - 1.1 * M) > 1) out.push(`p10 ${r.p10} ≠ 1.1M`);
  if (Math.abs(r.median - 1.4 * M) > 1) out.push(`median ${r.median} ≠ 1.4M`);
  if (Math.abs(r.p90 - 1.8 * M) > 1) out.push(`p90 ${r.p90} ≠ 1.8M (the down site's 9M or the 50k typo got in)`);
  if (r.medianPpm == null || Math.abs(r.medianPpm - 7000) > 1) out.push(`median per m² ${r.medianPpm} ≠ 7,000`);
  if (stats(FIXTURE.slice(0, 9), new Set()) !== null) out.push('nine houses still produced numbers (floor is 10)');
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
await mustCatchStats('a down site counted', 'if (!platform || downSlugs.has(platform)) continue;', 'if (!platform) continue;');
await mustCatchStats('a junk price counted', 'if (!Number.isFinite(price) || price < PRICE_MIN || price > PRICE_MAX) continue;', 'if (!Number.isFinite(price)) continue;');
await mustCatchStats('numbers shown from a handful of houses', 'if (best.size < MIN_HOUSES) return null;', 'if (best.size < 1) return null;');

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
const sourceMutant = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); };
sourceMutant('a district-centroid fallback for the pin', !wired(codeOnly(DATA_SRC).replace('const geo = mapPoint(own);', 'const geo = mapPoint(own) ?? { lat: 24.7136, lng: 46.6753 };'), PREVIEW));
sourceMutant('the page drawing a map without a pin', !wired(codeOnly(DATA_SRC), PREVIEW.replace('{geo && IS_WEB ? (', '{IS_WEB ? (')));
sourceMutant('the map opening a new tab from our UI', !wired(codeOnly(DATA_SRC), PREVIEW.replace('const openMap = () => {', "const openMap = () => { window.open(mapEmbedUrl(geo, locale, 15), '_blank');")));

console.log(failed === 0 ? '\n✅ the ad page pins only what the source published.\n' : `\n❌ ${failed} check(s) failed — a guessed pin can reach the page.\n`);
process.exit(failed === 0 ? 0 : 1);
