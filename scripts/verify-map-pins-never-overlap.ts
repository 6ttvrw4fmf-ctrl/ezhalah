// PINS NEVER SIT ON EACH OTHER, AND THE COUNT PILL NAMES THE DISTRICT (owner 2026-11-05: «user cannot select what he
// wants … so so many duplicated listings … we need to make sure they are in the same pin close by … whenever we get a
// new listing»; «you see how it says هذه المنطقة — include the name of the district»).
//
// EXECUTES the real src/lib/mapPins.ts (it has no imports): mergeOverlapping() over hundreds of random street-level
// layouts — dense piles like the 504 m² land scheme in حي البوادي, Jeddah, where ~35 heads sat within 30 m — and holds
// three facts on every one: no two heads touch; every listing's id is still there exactly once; the counts add up.
// Each fact has a mutation of the real source that must be caught. Then the wiring: the map merges before it draws,
// and the count pill reads viewCountText(). The live half (real heads on ezhalah.com) is e2e/map/map-pins-live.mjs.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(import.meta.dirname ?? '.', '..');
const LIB = join(root, 'src/lib/mapPins.ts');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  → ${detail}`}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

type Row = { lat: number; lng: number; n: number; deal: 'buy' | 'rent' | 'short' | 'mixed'; type_ar: string | null; platforms: number; ids: { t: string; i: number }[] | null; price: number | null; platform: string | null };
type Lib = typeof import('../src/lib/mapPins.ts');
const real = readFileSync(LIB, 'utf8');
async function load(src: string): Promise<Lib> {
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-pins-'));
  const f = join(dir, 'mapPins.mts'); writeFileSync(f, src);
  return import(pathToFileURL(f).href) as Promise<Lib>;
}

// A street-level view: 390 × 600 px over ~300 m; a seeded generator so a failure reproduces.
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const VIEW = { lat: 21.6133, lng: 39.1577, span: 0.003, w: 390, h: 600 };
const at = (lat: number, lng: number): [number, number] => [((lng - VIEW.lng) / VIEW.span + 0.5) * VIEW.w, ((VIEW.lat - lat) / VIEW.span + 0.5) * VIEW.h];
function layout(seed: number, count: number, pile: boolean): Row[] {
  const r = rng(seed); const rows: Row[] = []; let id = seed * 10_000;
  for (let k = 0; k < count; k++) {
    // A pile: most heads within ~30 m of one point (the land-scheme shape); otherwise spread over the view.
    const spread = pile && r() < 0.7 ? 0.0003 : VIEW.span;
    const n = r() < 0.2 ? 2 + Math.floor(r() * 5) : 1;
    const ids = Array.from({ length: n }, () => ({ t: r() < 0.5 ? 'aqar_residential_listings' : 'dealapp_residential_listings', i: ++id }));
    rows.push({ lat: VIEW.lat + (r() - 0.5) * spread, lng: VIEW.lng + (r() - 0.5) * spread, n, deal: (['buy', 'rent', 'short'] as const)[Math.floor(r() * 3)], type_ar: null, platforms: 1, ids, price: n > 1 ? null : 300_000 + Math.floor(r() * 3_000_000), platform: n > 1 ? null : 'aqar' });
  }
  return rows;
}
// The JUDGE is always the real source: a mutant must never grade its own output with its own (broken) rule.
let judge: Lib;
function verdict(lib: Lib, input: Row[]) {
  const widthOf = (row: Row) => judge.pinWidthGuess(judge.pinHead(row as never, 'ar'));
  const out = lib.mergeOverlapping(input as never, at, widthOf as never) as unknown as Row[];
  const placed = out.map((row) => { const [x, y] = at(row.lat, row.lng); return { x, y, w: widthOf(row) }; });
  let touching = 0;
  for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) if (judge.headsTouch(placed[a], placed[b])) touching++;
  const idsIn = input.flatMap((r) => r.ids ?? []).map((x) => `${x.t}:${x.i}`).sort();
  const idsOut = out.flatMap((r) => r.ids ?? []).map((x) => `${x.t}:${x.i}`).sort();
  const sameIds = idsIn.length === idsOut.length && idsIn.every((v, k) => v === idsOut[k]);
  const sameCount = input.reduce((s, r) => s + r.n, 0) === out.reduce((s, r) => s + r.n, 0);
  const goldMerged = out.every((r) => r.n === 1 || (r.price == null && r.platform == null));
  return { out, touching, sameIds, sameCount, goldMerged };
}
async function sweep(src: string) {
  const lib = await load(src);
  let touching = 0, lost = 0, miscount = 0, priced = 0, heads = 0, inputHeads = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const input = layout(seed, seed % 3 === 0 ? 400 : 60 + seed, seed % 2 === 0);
    const v = verdict(lib, input);
    touching += v.touching; lost += v.sameIds ? 0 : 1; miscount += v.sameCount ? 0 : 1; priced += v.goldMerged ? 0 : 1;
    heads += v.out.length; inputHeads += input.length;
  }
  return { touching, lost, miscount, priced, heads, inputHeads };
}

const lib = await load(real);
judge = lib;
// The screenshot of 2026-11-05: «660 ألف» drawn over «2 إعلانان», a few metres apart.
const two: Row[] = [
  { lat: 21.61330, lng: 39.15770, n: 1, deal: 'buy', type_ar: null, platforms: 1, ids: [{ t: 'aqar_residential_listings', i: 1 }], price: 660_000, platform: 'aqar' },
  { lat: 21.61331, lng: 39.15772, n: 2, deal: 'buy', type_ar: null, platforms: 1, ids: [{ t: 'dealapp_residential_listings', i: 2 }, { t: 'dealapp_residential_listings', i: 3 }], price: null, platform: null },
];
const v2 = verdict(lib, two);
check('«660 ألف» over «2 إعلانان» (2026-11-05) → ONE head «3 إعلانات» that lists all three ads', v2.out.length === 1 && v2.out[0].n === 3 && v2.out[0].ids?.length === 3 && lib.pinHead(v2.out[0] as never, 'ar') === '3 إعلانات');
const far: Row[] = [two[0], { ...two[0], lat: 21.6140, lng: 39.1585, ids: [{ t: 'aqar_residential_listings', i: 9 }] }];
check('two heads far apart on the screen stay two priced heads', verdict(lib, far).out.length === 2 && verdict(lib, far).out.every((r) => r.price === 660_000));
const s = await sweep(real);
check(`120 random street views (piles of up to 400 heads): no two heads touch (${s.inputHeads} → ${s.heads} heads)`, s.touching === 0, `${s.touching} touching pairs`);
check('…every listing id is still there exactly once (nothing dropped, nothing added — MATCH FIRST)', s.lost === 0, `${s.lost} views lost ids`);
check('…the counts add up', s.miscount === 0);
check('…a merged head shows its count, never one ad\'s price', s.priced === 0);

const noRecheck = real.replace('    i = lo;\n  }\n  return cs.map((c) => c.row);', '    i++;\n  }\n  return cs.map((c) => c.row);');
mustCatch('a merged head never checked again (a chain leaves two heads touching)', noRecheck !== real && (await sweep(noRecheck)).touching > 0);
const dropIds = real.replace('ids: a.ids || b.ids ? [...(a.ids ?? []), ...(b.ids ?? [])] : null,', 'ids: a.ids,');
mustCatch('a merge that keeps only the first head\'s ads (the others vanish from the card list)', dropIds !== real && (await sweep(dropIds)).lost > 0);
const xOnly = real.replace('&& Math.abs(a.y - b.y) < PIN_H_PX + PIN_GAP_PX;', '&& Math.abs(a.y - b.y) < 2;');
mustCatch('heads stacked on top of each other (a few px apart vertically) not counted as touching', xOnly !== real && (await sweep(xOnly)).touching > 0);
const noGap = real.replace('export const PIN_GAP_PX = 4;', 'export const PIN_GAP_PX = -12;');
mustCatch('heads allowed to overlap by a little (no air left for a finger)', noGap !== real && (await sweep(noGap)).touching > 0);

// ── the count pill names the district ───────────────────────────────────────────────────────────────────────────────
const P = (district: string | null, ds: number, city: string | null, cs: number) => ({ district, city, district_share: ds, city_share: cs });
check('most of the view in one district → «7 إعلانات في حي الشراع»', lib.viewCountText(7, lib.viewPlaceName(P('حي الشراع', 0.8, 'جدة', 1), 'ar'), 'ar') === '7 إعلانات في حي الشراع');
check('a district stored without «حي» still reads «حي …»', lib.viewPlaceName(P('الملقا', 0.9, 'الرياض', 1), 'ar') === 'حي الملقا');
check('the view split between districts but in one city → the city («25 إعلان في جدة»)', lib.viewCountText(25, lib.viewPlaceName(P('حي الشراع', 0.4, 'جدة', 0.95), 'ar'), 'ar') === '25 إعلان في جدة');
check('no clear district or city → «في هذه المنطقة» (never a name most of the view is not in)', lib.viewCountText(3, lib.viewPlaceName(P('حي أ', 0.3, 'جدة', 0.5), 'ar'), 'ar') === '3 إعلانات في هذه المنطقة');
check('a failed lookup (null) → the plain wording, never a blank', lib.viewCountText(2, lib.viewPlaceName(null, 'ar'), 'ar') === '2 إعلانان في هذه المنطقة' && lib.viewCountText(1200, null, 'en') === '1,200 listings here');
check('English names the place too', lib.viewCountText(7, lib.viewPlaceName(P('حي الشراع', 0.8, 'جدة', 1), 'en'), 'en') === '7 listings in الشراع');
const anyName = real.replace("if (bare && Number(p.district_share) >= PLACE_SHARE)", 'if (bare)');
mustCatch('a district named when only a minority of the view is in it', anyName !== real && (await load(anyName)).viewPlaceName(P('حي أ', 0.2, null, 0), 'ar') !== null);

// ── the read fails closed to the plain wording ─────────────────────────────────────────────────────────────────────
const fetchLift = async (answer: { data: unknown; error: unknown }) => {
  const m = await liftSymbols(join(root, 'src/data/mapPins.ts'), [
    { header: 'const CACHE_MS', endsWith: /;$/ }, { header: 'const CACHE_MAX', endsWith: /;$/ },
    { header: 'const placeRecent', endsWith: /;$/ }, { header: 'export async function fetchViewPlace(', endsWith: /^\}$/ },
  ], ['fetchViewPlace'], `type ViewPlace = any;\nconst supabase = { rpc: () => ({}) };\nconst boundedRpc = async (_b: unknown) => (${JSON.stringify(answer)});\n`) as { fetchViewPlace: (b: unknown) => Promise<unknown> };
  return m.fetchViewPlace({ s: Math.random(), w: 1, n: 2, e: 3 });
};
check('a failed place read is null (the pill keeps «في هذه المنطقة»)', (await fetchLift({ data: null, error: { message: 'timeout' } })) === null);
check('an empty view is null', (await fetchLift({ data: [], error: null })) === null);
check('a good read returns the row', ((await fetchLift({ data: [P('حي الشراع', 0.8, 'جدة', 1)], error: null })) as { district?: string })?.district === 'حي الشراع');

// ── wiring ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const map = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const mergeAt = map.indexOf('if (drawCell === 0) rows = mergeOverlapping(rows, onScreen, headWidth);');
check('the map merges touching heads BEFORE it draws them (street zoom)', mergeAt > 0 && mergeAt < map.indexOf('const next = new Map<string, PinRow>(); for (const row of rows) next.set(keyOf(row), row);'));
check('heads are measured in the font they are drawn in, through MapKit\'s own projection', /measure\.font = '600 11px -apple-system,system-ui,sans-serif'/.test(map) && /convertCoordinateToPointOnPage/.test(map.slice(map.indexOf('const onScreen'), map.indexOf('const onScreen') + 600)));
check('the count pill reads viewCountText() with the view\'s place', /viewCountText\(pinCount, viewPlace, locale === 'ar' \? 'ar' : 'en'\)/.test(map) && /setViewPlace\(viewPlaceName\(p, loc, translitPlace\)\)/.test(map));

if (failed) { console.error(`\n❌ verify-map-pins-never-overlap: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-map-pins-never-overlap: no two pins sit on each other, and the pill names the district');
