// THE MAP'S LABELS GO COUNTRY → REGION → CITY → DISTRICT, IN THE UI LANGUAGE (owner 2026-11-05: «when the user zooms in,
// first thing Saudi, the total number, then region, then city, and then district»; «I switched to English — why does
// it show Arabic in here? It should change automatically»).
//
// EXECUTES src/lib/mapAreas.ts (import-free) against a feed shaped like map_areas_feed_ar()'s — city rows carrying
// their region as the 9th element (20261105…_map_labels_carry_region) — and holds: one country label at the opening
// zoom carrying EVERY city's listings; all 13 regions shown, each the sum of its cities; an old 8-element feed still
// draws (cities, never an empty map); English names for every level. Each with a mutation of the real source.
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname ?? '.', '..');
const LIB = join(root, 'src/lib/mapAreas.ts');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  → ${detail}`}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
type Lib = typeof import('../src/lib/mapAreas.ts');
const real = readFileSync(LIB, 'utf8');
const load = async (src: string): Promise<Lib> => { const d = mkdtempSync(join(tmpdir(), 'ezhalah-areas-')); const f = join(d, 'mapAreas.mts'); writeFileSync(f, src); return import(pathToFileURL(f).href) as Promise<Lib>; };

// The 13 regions exactly as search_listings_ar.region_ar stores them (measured 2026-11-05).
const REGIONS13 = ['منطقة الرياض', 'منطقة مكة المكرمة', 'المنطقة الشرقية', 'منطقة القصيم', 'منطقة المدينة المنورة', 'منطقة عسير', 'منطقة جازان', 'منطقة حائل', 'منطقة تبوك', 'منطقة الباحة', 'منطقة الحدود الشمالية', 'منطقة نجران', 'منطقة الجوف'];
// [is_city, city, district, lat, lng, buy, rent, short, region]
const RAW = [
  [true, 'الرياض', '', 24.71, 46.67, 90000, 8000, 0, 'منطقة الرياض'], [true, 'الخرج', '', 24.15, 47.3, 900, 100, 0, 'منطقة الرياض'],
  [true, 'جدة', '', 21.54, 39.17, 50000, 9000, 3000, 'منطقة مكة المكرمة'], [true, 'الطائف', '', 21.27, 40.41, 2000, 300, 10, 'منطقة مكة المكرمة'],
  [true, 'الدمام', '', 26.42, 50.09, 20000, 3000, 0, 'المنطقة الشرقية'], [true, 'بريدة', '', 26.33, 43.97, 9000, 900, 0, 'منطقة القصيم'],
  [true, 'المدينة المنورة', '', 24.47, 39.61, 8000, 2000, 500, 'منطقة المدينة المنورة'], [true, 'أبها', '', 18.22, 42.5, 5000, 600, 0, 'منطقة عسير'],
  [true, 'جازان', '', 16.89, 42.55, 3000, 300, 0, 'منطقة جازان'], [true, 'حائل', '', 27.52, 41.69, 2000, 200, 0, 'منطقة حائل'],
  [true, 'تبوك', '', 28.38, 36.57, 1500, 200, 0, 'منطقة تبوك'], [true, 'الباحة', '', 20.01, 41.47, 600, 50, 0, 'منطقة الباحة'],
  [true, 'عرعر', '', 30.98, 41.04, 300, 30, 0, 'منطقة الحدود الشمالية'], [true, 'نجران', '', 17.49, 44.13, 250, 20, 0, 'منطقة نجران'],
  [true, 'سكاكا', '', 29.97, 40.21, 200, 21, 0, 'منطقة الجوف'],
  [false, 'جدة', 'حي الشراع', 21.76, 39.08, 700, 46, 0, ''], [false, 'الرياض', 'حي الملقا', 24.81, 46.6, 3000, 200, 0, ''],
];
const KSA = { s: 10, n: 36, w: 30, e: 60 };
const ALL = ['buy', 'rent', 'short'];

const lib = await load(real);
const feed = lib.parseAreasFeed(RAW);
const cityTotal = RAW.filter((r) => r[0] === true).reduce((t, r) => t + (r[5] as number) + (r[6] as number) + (r[7] as number), 0);

check('the opening view (17°, the whole Kingdom) is ONE country label, then regions (9°), cities (3°), districts (1°)', lib.areaLevelFor(17) === 'country' && lib.areaLevelFor(9) === 'region' && lib.areaLevelFor(3) === 'city' && lib.areaLevelFor(1) === 'district');
const country = lib.areasFromFeed(feed, 'country', ALL, KSA);
check(`the country label carries EVERY city's listings (${cityTotal.toLocaleString('en-US')})`, country.length === 1 && country[0].n === cityTotal, JSON.stringify(country));
check('…and it names the country: «السعودية» / «Saudi Arabia»', lib.areaName(country[0], 'country', 'ar') === 'السعودية' && lib.areaName(country[0], 'country', 'en') === 'Saudi Arabia');
const regions = lib.visibleAreas(lib.areasFromFeed(feed, 'region', ALL, KSA), 'region');
check('all 13 regions are drawn — even Al Jouf, 0.2% of Riyadh Region', regions.length === 13 && REGIONS13.every((r) => regions.some((x) => x.city === r)), `${regions.length}: ${regions.map((r) => r.city).join(',')}`);
const riyadh = regions.find((r) => r.city === 'منطقة الرياض');
check('a region label is the sum of its cities (Riyadh Region = الرياض + الخرج)', riyadh?.n === 98000 + 1000);
check('a region label sits among its cities (weighted centre)', !!riyadh && riyadh.lat > 24.1 && riyadh.lat < 24.8 && riyadh.lng > 46.6 && riyadh.lng < 47.3);
check('the deal button narrows region counts (Short stays only → Makkah Region = 3,010)', lib.areasFromFeed(feed, 'region', ['short'], KSA).find((r) => r.city === 'منطقة مكة المكرمة')?.n === 3010);
const old = lib.parseAreasFeed(RAW.map((r) => r.slice(0, 8)));
const oldRegions = lib.areasFromFeed(old, 'region', ALL, KSA);
check('a feed built before regions were stored (8 elements) still draws: the cities, never an empty map', oldRegions.length === 15 && oldRegions.every((r) => !r.district));
check('city and district levels are unchanged', lib.areasFromFeed(feed, 'city', ALL, KSA).length === 15 && lib.areasFromFeed(feed, 'district', ALL, KSA).length === 2);

// English: no Arabic letter on any label in the English UI. `latin` stands in for src/lib/translitPlace.ts (wired below).
const latin = (s: string) => ({ 'جدة': 'Jeddah', 'الشراع': 'Al Shara', 'الرياض': 'Riyadh' } as Record<string, string>)[s] ?? `LATIN(${s.length})`;
const AR = /[؀-ۿ]/;
const enNames = [
  lib.areaName(country[0], 'country', 'en', latin),
  ...regions.map((r) => lib.areaName(r, 'region', 'en', latin)),
  ...lib.areasFromFeed(feed, 'city', ALL, KSA).map((r) => lib.areaName(r, 'city', 'en', latin)),
  ...lib.areasFromFeed(feed, 'district', ALL, KSA).map((r) => lib.areaName(r, 'district', 'en', latin)),
];
check('English UI: every label at every level is in English (no Arabic letters)', enNames.every((n) => !AR.test(n)), enNames.filter((n) => AR.test(n)).join(','));
check('English region names are real names, not transliterations (every one of the 13 has an entry)', REGIONS13.every((r) => !!lib.REGION_EN[r]) && lib.areaName({ city: 'المنطقة الشرقية', district: '' }, 'region', 'en', latin) === 'Eastern Province');
check('English city/district names go through the transliterator; Arabic stays Arabic', lib.areaName({ city: 'جدة', district: 'حي الشراع' }, 'district', 'en', latin) === 'Al Shara' && lib.areaName({ city: 'جدة', district: 'حي الشراع' }, 'district', 'ar', latin) === 'الشراع');

// A tap must land one level closer even after MapKit widens the span to the screen (5.17° for a 4° ask, 2026-11-05).
const lands = (l: Lib) => (['country', 'region', 'city', 'district'] as const).every((lv, i) => {
  const next = (['region', 'city', 'district', null] as const)[i];
  return l.areaLevelFor(l.areaZoomSpan(lv)) === next && l.areaLevelFor(l.areaZoomSpan(lv) * l.TAP_WIDEN) === next;
});
check('every label tap lands one level closer, even widened ×1.6 by a tall phone screen', lands(lib));
const oldSpans = real.replace("level === 'region' ? 3 :", "level === 'region' ? 4 :");
mustCatch('the 4° region tap that stayed on regions on a phone (5.17° live)', oldSpans !== real && !lands(await load(oldSpans)));
// The count names where the view is at every zoom (owner 2026-11-05: «it shows the city name, then the district»).
const V = (lat: number, lng: number, d: number) => [{ latitude: lat, longitude: lng }, { latitudeDelta: d, longitudeDelta: d }] as const;
const riyadhRegion = lib.areasFromFeed(feed, 'region', ALL, KSA);
check('region zoom over Riyadh Region → «منطقة الرياض» / «Riyadh Region»', lib.areaPlaceName(riyadhRegion, 'region', 'ar', latin, ...V(24.7, 46.7, 2)) === 'منطقة الرياض' && lib.areaPlaceName(riyadhRegion, 'region', 'en', latin, ...V(24.7, 46.7, 2)) === 'Riyadh Region');
const cities = lib.areasFromFeed(feed, 'city', ALL, KSA);
check('city zoom over Jeddah → «جدة» / «Jeddah»', lib.areaPlaceName(cities, 'city', 'ar', latin, ...V(21.5, 39.2, 1)) === 'جدة' && lib.areaPlaceName(cities, 'city', 'en', latin, ...V(21.5, 39.2, 1)) === 'Jeddah');
const dists = [{ city: 'جدة', district: 'حي الشراع', lat: 21.76, lng: 39.08, n: 700 }, { city: 'جدة', district: 'حي أبحر', lat: 21.77, lng: 39.1, n: 200 }];
check('district zoom inside one district → «حي الشراع»', lib.areaPlaceName(dists, 'district', 'ar', latin, ...V(21.765, 39.09, 0.1)) === 'حي الشراع');
const split = [{ city: 'جدة', district: 'حي أ', lat: 21.76, lng: 39.08, n: 300 }, { city: 'جدة', district: 'حي ب', lat: 21.77, lng: 39.1, n: 300 }, { city: 'جدة', district: 'حي ج', lat: 21.75, lng: 39.09, n: 300 }];
check('district zoom across several districts of one city → the city («جدة»)', lib.areaPlaceName(split, 'district', 'ar', latin, ...V(21.76, 39.09, 0.1)) === 'جدة');
check('no place holds most of the view → null (the plain «في هذه المنطقة»)', lib.areaPlaceName(regions, 'region', 'ar', latin, ...V(24, 45, 30)) === null);
check('the country view names the country', lib.areaPlaceName(country, 'country', 'en', latin, ...V(23.9, 45.1, 17)) === 'Saudi Arabia');
// The number beside a name is that place's number (live 2026-11-05: «14,531 … في حي النرجس» where النرجس holds ~5,900).
const narjis = [{ city: 'الرياض', district: 'حي النرجس', lat: 24.83, lng: 46.64, n: 9000 }, { city: 'الرياض', district: 'حي العارض', lat: 24.86, lng: 46.6, n: 3000 }, { city: 'الرياض', district: 'حي الملقا', lat: 24.8, lng: 46.6, n: 1000 }];
const pn = lib.areaPlace(narjis, 'district', 'ar', latin, ...V(24.83, 46.62, 0.2));
check('a named district carries ITS count (9,000), not the whole view\'s (13,000)', pn?.name === 'حي النرجس' && pn?.n === 9000, JSON.stringify(pn));
check('a named region carries its own total', lib.areaPlace(riyadhRegion, 'region', 'ar', latin, ...V(24.7, 46.7, 2))?.n === 99000);
const viewCount = real.replace('n: top.n };', 'n: total };');
mustCatch('the whole view\'s count printed beside one district\'s name', viewCount !== real && (await load(viewCount)).areaPlace(narjis, 'district', 'ar', latin, ...V(24.83, 46.62, 0.2))?.n !== 9000);
check('the pill prints the named place\'s count when there is one', /viewCountText\(placeCount \?\? pinCount, viewPlace/.test(readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8')));
const anyTop = real.replace('  if (top.n / total >= AREA_PLACE_SHARE) {', '  if (true) {');
mustCatch('a place named when it holds only a minority of the view', anyTop !== real && (await load(anyTop)).areaPlaceName(regions, 'region', 'ar', latin, ...V(24, 45, 30)) !== null);
check('the map hands every label view to areaPlaceName (not a fixed «في هذه المنطقة» below the country)', /const place = (?:whole \? areaPlace\(whole, 'country', loc, translitPlace, m\.region\.center, m\.region\.span\) : )?areaPlace\(areas, level, loc, translitPlace, m\.region\.center, m\.region\.span\);\n\s*setViewPlace\(place\?\.name \?\? null\); setPlaceCount\(place\?\.n \?\? null\);/.test(readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8')));

const noCountry = real.replace("  if (latitudeDelta > COUNTRY_LABELS_ABOVE) return 'country';\n", '');
mustCatch('the opening view drawing regions or cities instead of the one Saudi total', noCountry !== real && (await load(noCountry)).areaLevelFor(17) !== 'country');
const shareRegions = real.replace("  if (level === 'country' || level === 'region') return rows.filter((r) => !r.offLabel);\n", '');
mustCatch('small regions hidden by the city share rule', shareRegions !== real && (await load(shareRegions)).visibleAreas(lib.areasFromFeed(feed, 'region', ALL, KSA), 'region').length < 13);
const arabicEn = real.replace("  return loc === 'en' ? latin(name) : name;", '  return name;');
mustCatch('an English UI showing Arabic city/district names (the 2026-11-05 screenshot)', arabicEn !== real && AR.test((await load(arabicEn)).areaName({ city: 'جدة', district: 'حي الشراع' }, 'district', 'en', latin)));
const emptyOld = real.replace("    if (!by.size) return areasFromFeed(feed, 'city', deals, box, limit);\n", '');
mustCatch('an old feed drawing an empty map at region zoom', emptyOld !== real && (await load(emptyOld)).areasFromFeed(old, 'region', ALL, KSA).length === 0);

// Wiring: the map names labels in the UI language through the real transliterator, and redraws on a language switch.
const map = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
check('the map names each label with areaName(a, level, loc, translitPlace)', /name\.textContent = areaName\(a, level, loc, translitPlace\)/.test(map) && /import \{ translitPlace \} from '@\/lib\/translitPlace';/.test(map));
check('a label tap asks a span shaped like the screen (a tall phone never widens it back into the same level)', /new mk\.CoordinateSpan\(sp, sp \* aspect\)/.test(map) && /Math\.min\(1, box\.width \/ box\.height\)/.test(map));
check('a language switch redraws the labels (locale is in the pin layer\'s deps)', /\}, \[pinsKey, failed, mapReady, locale\]\);/.test(map));
check('the count pill names the place in English too (viewPlaceName with translitPlace)', /viewPlaceName\(p, loc, translitPlace\)/.test(map));
// The server half: city labels carry their region, and the feed sends it as the 9th element.
const migs = readdirSync(join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
const lastFeed = [...migs].reverse().map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8')).find((s) => /create or replace function public\.map_areas_feed_ar\(/.test(s)) ?? '';
check('the labels feed sends each city label\'s region as its 9th element', /jsonb_build_array\(x\.is_city, x\.city, x\.district, x\.lat, x\.lng, x\.nb, x\.nr, x\.ns, x\.region\)/.test(lastFeed));

if (failed) { console.error(`\n❌ verify-map-labels-country-region-english: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-map-labels-country-region-english: country → region → city → district, in the UI language');
