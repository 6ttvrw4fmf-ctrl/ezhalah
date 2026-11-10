// PINS NEVER SIT ON EACH OTHER, ONE PIN = ONE PLACE, AND THE COUNT PILL NAMES THE DISTRICT (owner 2026-11-05: «user
// cannot select what he wants»; «you see how it says هذه المنطقة — include the name of the district»; owner 2026-11-10:
// «the pins only go together if they are the same listings … just because they're close … if not, you put them beside
// each other. That's the rule. Just don't make them on top of each other where a user can't click»).
//
// EXECUTES the real src/lib/mapPins.ts (it has no imports): placeApart() over hundreds of random street-level
// layouts — dense piles like the 504 m² land scheme in حي البوادي, Jeddah, where ~35 heads sat within 30 m — and holds
// on every one: no two heads touch; every listing's id is still there exactly once; the counts add up; no head is
// drawn further than PIN_MAX_SHIFT_PX from its own spot; and neighbours with room beside them are NEVER joined.
// Each fact has a mutation of the real source that must be caught. Then the wiring: the map places before it draws,
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

type Row = { lat: number; lng: number; n: number; deal: 'buy' | 'rent' | 'short' | 'mixed'; type_ar: string | null; platforms: number; ids: { t: string; i: number }[] | null; price: number | null; platform: string | null; shift?: [number, number] };
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
  const out = lib.placeApart(input as never, at, widthOf as never) as unknown as Row[];
  // Where each head is DRAWN: its own spot plus its shift.
  const placed = out.map((row) => { const [x, y] = at(row.lat, row.lng); return { x: x + (row.shift?.[0] ?? 0), y: y + (row.shift?.[1] ?? 0), w: widthOf(row) }; });
  const tooFar = out.filter((row) => row.shift && Math.hypot(row.shift[0], row.shift[1]) > judge.PIN_MAX_SHIFT_PX + 1e-6).length;
  let touching = 0;
  for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) if (judge.headsTouch(placed[a], placed[b])) touching++;
  const idsIn = input.flatMap((r) => r.ids ?? []).map((x) => `${x.t}:${x.i}`).sort();
  const idsOut = out.flatMap((r) => r.ids ?? []).map((x) => `${x.t}:${x.i}`).sort();
  const sameIds = idsIn.length === idsOut.length && idsIn.every((v, k) => v === idsOut[k]);
  const sameCount = input.reduce((s, r) => s + r.n, 0) === out.reduce((s, r) => s + r.n, 0);
  const goldMerged = out.every((r) => r.n === 1 || (r.price == null && r.platform == null));
  return { out, touching, sameIds, sameCount, goldMerged, tooFar };
}
const verdictWith = (l: Lib, input: Row[]) => verdict(l, input);
async function sweep(src: string) {
  const lib = await load(src);
  let touching = 0, lost = 0, miscount = 0, priced = 0, heads = 0, inputHeads = 0, tooFar = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const input = layout(seed, seed % 3 === 0 ? 400 : 60 + seed, seed % 2 === 0);
    const v = verdict(lib, input);
    touching += v.touching; lost += v.sameIds ? 0 : 1; miscount += v.sameCount ? 0 : 1; priced += v.goldMerged ? 0 : 1;
    heads += v.out.length; inputHeads += input.length; tooFar += v.tooFar;
  }
  return { touching, lost, miscount, priced, heads, inputHeads, tooFar };
}

const lib = await load(real);
judge = lib;
// The screenshot of 2026-11-05: «660 ألف» drawn over «2 إعلانان», a few metres apart.
const two: Row[] = [
  { lat: 21.61330, lng: 39.15770, n: 1, deal: 'buy', type_ar: null, platforms: 1, ids: [{ t: 'aqar_residential_listings', i: 1 }], price: 660_000, platform: 'aqar' },
  { lat: 21.61331, lng: 39.15772, n: 2, deal: 'buy', type_ar: null, platforms: 1, ids: [{ t: 'dealapp_residential_listings', i: 2 }, { t: 'dealapp_residential_listings', i: 3 }], price: null, platform: null },
];
const v2 = verdict(lib, two);
const sideBySide = (v: ReturnType<typeof verdict>) => v.out.length === 2 && v.touching === 0
  && v.out.some((r) => r.price === 660_000 && r.n === 1 && r.ids?.length === 1) && v.out.some((r) => r.n === 2 && r.ids?.length === 2)
  && v.out.filter((r) => r.shift).length === 1;
check('«660 ألف» over «2 إعلانان» a few metres apart → TWO heads side by side, each with its own ads (owner 2026-11-10)', sideBySide(v2));
check('…the shared spot keeps its own place; the single ad is the one drawn beside it', v2.out.find((r) => r.n === 2)?.shift === undefined && !!v2.out.find((r) => r.n === 1)?.shift);
// A small cluster with room around it: eight different places within ~12 m → eight heads, none joined.
const eight: Row[] = Array.from({ length: 8 }, (_, k) => ({ lat: 21.6133 + (k % 3) * 0.00004, lng: 39.1577 + Math.floor(k / 3) * 0.00004, n: 1, deal: 'buy' as const, type_ar: null, platforms: 1, ids: [{ t: 'aqar_residential_listings', i: 100 + k }], price: 900_000 + k * 10_000, platform: 'aqar' }));
const v8 = verdict(lib, eight);
check('eight different places within ~12 m, room around them → eight priced heads, none joined, none touching', v8.out.length === 8 && v8.touching === 0 && v8.out.every((r) => r.n === 1 && r.price != null) && v8.tooFar === 0);
check('…and at least two of them sit BESIDE a neighbour (same height, one head across), not only above or below', v8.out.filter((r) => r.shift && Math.abs(r.shift[0]) >= 52).length >= 2);
const tooTight = real.replace('export const PIN_MAX_SHIFT_PX = 84;', 'export const PIN_MAX_SHIFT_PX = 52;');
const far: Row[] = [two[0], { ...two[0], lat: 21.6140, lng: 39.1585, ids: [{ t: 'aqar_residential_listings', i: 9 }] }];
check('two heads far apart on the screen stay two priced heads', verdict(lib, far).out.length === 2 && verdict(lib, far).out.every((r) => r.price === 660_000));
const s = await sweep(real);
check(`120 random street views (piles of up to 400 heads): no two heads touch (${s.inputHeads} → ${s.heads} heads)`, s.touching === 0, `${s.touching} touching pairs`);
check('…every listing id is still there exactly once (nothing dropped, nothing added — MATCH FIRST)', s.lost === 0, `${s.lost} views lost ids`);
check('…the counts add up', s.miscount === 0);
check('…a joined head shows its count, never one ad\'s price', s.priced === 0);
check(`…no head is drawn more than ${lib.PIN_MAX_SHIFT_PX} px from its own spot`, s.tooFar === 0, `${s.tooFar} heads too far`);

const joinNear = real.replace('export const PIN_MAX_SHIFT_PX = 84;', 'export const PIN_MAX_SHIFT_PX = 0;');
mustCatch('the 2026-11-05 rule back: neighbours joined into one count just for being close', joinNear !== real && !sideBySide(verdictWith(await load(joinNear), two)) && verdictWith(await load(joinNear), eight).out.length < 8);
mustCatch('a shift limit too tight for a head to sit beside another (only above/below, the rest joined)', tooTight !== real && verdictWith(await load(tooTight), eight).out.length < 8);
const onTop = real.replace("for (const k of cellsOf(c)) for (const h of grid.get(k) ?? []) if (headsTouch(c, h)) return false;", '');
mustCatch('heads drawn on top of each other (no free-place check)', onTop !== real && (await sweep(onTop)).touching > 0);
const noRecheck = real.replace('      cur = start(joinPins(near.row, cur.row));', '      put(start(joinPins(near.row, cur.row))); break;');
mustCatch('a joined head put down without being placed again (it lands on a neighbour)', noRecheck !== real && (await sweep(noRecheck)).touching > 0);
const anyDistance = real.replace('    if (Math.hypot(dx, dy) <= max) out.push([dx, dy]);', '    out.push([dx * 3, dy * 3]);');
mustCatch('a head drawn far from its own spot', anyDistance !== real && (await sweep(anyDistance)).tooFar > 0);
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

// ── the pill says the deal, and an empty deal points at the others (Umluj, 2026-11-05) ───────────────────────────────
check('one deal chosen → the pill names it («12 إعلان للإيجار في أملج» / «12 listings for rent in Umluj»)', lib.viewCountText(12, 'أملج', 'ar', ['rent']) === '12 إعلان للإيجار في أملج' && lib.viewCountText(12, 'Umluj', 'en', ['rent']) === '12 listings for rent in Umluj');
check('none of the chosen deal but others in view → «لا يوجد للبيع في أملج · يوجد للإيجار و للإقامة القصيرة»', lib.viewCountText(0, 'أملج', 'ar', ['buy'], ['rent', 'short']) === 'لا يوجد للبيع في أملج · يوجد للإيجار وللإقامة القصيرة' && lib.viewCountText(0, null, 'en', ['buy'], ['rent']) === 'None for sale here · some for rent');
check('a real zero (no other deal either) stays a plain zero', lib.viewCountText(0, 'أملج', 'ar', ['buy'], []) === '0 إعلان للبيع في أملج');
mustCatch('the Umluj «0 listings here» with rentals on screen', !/^0 /.test(lib.viewCountText(0, null, 'en', ['buy'], ['rent'])));
const noOthers = real.replace('  if (n === 0 && one && others.length) {', '  if (false) {');
mustCatch('an empty deal that never points at the others', noOthers !== real && /^0 /.test((await load(noOthers)).viewCountText(0, null, 'en', ['buy'], ['rent'])));
check('the deal button is shown in full screen too', /\{full && M \? <View style=\{s\.fullDeals\}><M\.MapDealRow/.test(readFileSync(join(root, 'src/app/map.tsx'), 'utf8')));

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
const mergeAt = map.indexOf('if (drawCell === 0) rows = placeApart(rows, onScreen, headWidth);');
check('the map places heads apart BEFORE it draws them (street zoom)', mergeAt > 0 && mergeAt < map.indexOf('const next = new Map<string, PinRow>(); for (const row of rows) next.set(keyOf(row), row);'));
check('a shifted head is DRAWN at its shift (anchor offset) and redrawn when the shift changes (key)', /DOMPoint\(\.\.\.pinAnchorOffset\(row\.shift\)\)/.test(map) && /\|\$\{r\.shift \? r\.shift\.join\(','\) : ''\}`;/.test(map));
// The line is a MapKit OVERLAY (on the map, under every head): inside the head's own element it was painted over the
// neighbours' text (measured on ezhalah.com 2026-11-10, حي البوادي: dots on «25 إعلان», «399 ألف»).
check('a shifted head gets a line back to its own spot, drawn as map overlays that are never a tap target',
  /const to = row\.noPin \? null : pinStemTo\(row\.shift, headWidth\(row\) \/ 2\);/.test(map)
  && /new mk\.PolylineOverlay\(\[spot, head\], \{ style: new mk\.Style\(\{ strokeColor: color, strokeOpacity: 1, lineWidth: 2 \}\), enabled: false \}\)/.test(map)
  && /drawStems\(drawCell === 0 \? rows : \[\]\);/.test(map));
check('no line is drawn inside a head\'s own element (it would cover its neighbours)', !/map-pin-stem/.test(map));
check('the lines leave with the pins (clear, and when area labels take over)', /keyed\.clear\(\); clearStems\(\); \};/.test(map) && /setPlaceCount\(place\?\.n \?\? null\);\n\s*clearStems\(\);/.test(map));
// MapKit draws the element at (point − anchorOffset): measured on ezhalah.com/map 2026-11-10, (50, −30) → 50 px left, 30 px down.
const eq = (a: number[], b: number[]) => a.length === b.length && a.every((v, k) => Math.abs(v - b[k]) < 1e-9);
check('an unshifted head keeps its (0, −6) anchor', eq(lib.pinAnchorOffset(undefined), [0, -6]));
check('a head shifted 26 px right and 13 px up is anchored (−26, +7)', eq(lib.pinAnchorOffset([26, -13]), [-26, 7]));
const flipped = real.replace('return shift ? [-shift[0], PIN_ANCHOR_Y - shift[1]] : [0, PIN_ANCHOR_Y];', 'return shift ? [shift[0], PIN_ANCHOR_Y + shift[1]] : [0, PIN_ANCHOR_Y];');
mustCatch('the shift applied with MapKit\'s sign the wrong way round (heads drawn on the far side, onto neighbours)', flipped !== real && !eq((await load(flipped)).pinAnchorOffset([26, -13]), [-26, 7]));
check('no shift → no line; a head still covering its own spot → no line', lib.pinStemTo(undefined, 30) === null && lib.pinStemTo([0, 13], 30) === null);
const up = lib.pinStemTo([0, -26], 30);
check('a head moved 26 px up: the line runs from the spot to the head\'s centre, 31 px straight up', !!up && eq(up, [0, -31]));
const side = lib.pinStemTo([65, 0], 30);
check('a head moved one head across: the line ends at its centre (65 px across, 5 px up)', !!side && eq(side, [65, -5]));
const always = real.replace('  if (ty <= 0 && ty >= -PIN_H_PX && Math.abs(tx) <= halfWidth) return null;   // the head still covers its own spot\n', '');
mustCatch('a line drawn for a head that still covers its own spot (a stub poking out of the pill)', always !== real && (await load(always)).pinStemTo([0, 13], 30) !== null);
check('heads are measured in the font they are drawn in, through MapKit\'s own projection', /measure\.font = '600 11px -apple-system,system-ui,sans-serif'/.test(map) && /convertCoordinateToPointOnPage/.test(map.slice(map.indexOf('const onScreen'), map.indexOf('const onScreen') + 600)));
check('the count pill reads viewCountText() with the view\'s place', /viewCountText\(placeCount \?\? pinCount, viewPlace, locale === 'ar' \? 'ar' : 'en', pins\?\.deals, otherDeals\)/.test(map) && /setViewPlace\(viewPlaceName\(p, loc, translitPlace\)\)/.test(map));

if (failed) { console.error(`\n❌ verify-map-pins-never-overlap: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-map-pins-never-overlap: no two pins sit on each other, and the pill names the district');
