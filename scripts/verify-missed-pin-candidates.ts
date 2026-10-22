// Hermetic proof of the weekly missed-pin robot's judgement (scripts/lib/missedPinCandidates.ts).
// Every fixture is a shape copied from a real page on 2026-10-20 night; every exclusion is a false alarm
// that night's sweeps actually produced. No network.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { judgeSite, pairsIn, key, type AdSample } from './lib/missedPinCandidates.ts';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '  ✓' : '  ✗'} ${name}`); if (!ok) failed++; };
const ad = (url: string, html: string, listingId?: number): AdSample => ({ url, html, listingId });
const has = (s: AdSample, a: number, b: number) => pairsIn(s).some((p) => key(p.lat, p.lng) === key(a, b));

console.log('verify-missed-pin-candidates: every measured pin shape is read, every measured false alarm is not.');
check('sokok: HTML-escaped page data «"map":{"latitude":…,"longitude":…}»',
  has(ad('s', '&quot;map&quot;:{&quot;latitude&quot;:26.437075817310653,&quot;longitude&quot;:43.88399117211289}'), 26.4371, 43.884));
check('raghdan: escaped JSON «\\"latitude\\":21.6138…,\\"longitude\\":39.1422…»',
  has(ad('r', '\\"postalCode\\":\\"23526\\",\\"latitude\\":21.613825871738374,\\"longitude\\":39.14225532020586'), 21.6138, 39.1423));
check('aljassim: DMS inside an embed ?q=',
  has(ad('a', '<iframe src="https://maps.google.com/maps?hl=ar&amp;q=25%C2%B024%2743.2%22N+49%C2%B036%2748.8%22E&amp;output=embed">'), 25.412, 49.6136));
check('wadod: embed centre !2dLNG!3dLAT',
  has(ad('w', 'maps/embed?pb=!1m17!1m12!1m3!1d3619.55!2d46.6229149!3d24.8792054!2m3'), 24.8792, 46.6229));
check('ksaaqar: hidden ad_lat / ad_lon fields',
  has(ad('k', '<input type="hidden" id="ad_lat" value="21.2817249"/> <input type="hidden" id="ad_lon" value="40.4325578"/>'), 21.2817, 40.4326));
check('nawafeth: propertyLat = parseFloat(…)',
  has(ad('n', "var propertyLat = parseFloat('27.0196');\n var propertyLng = parseFloat('49.5732');"), 27.0196, 49.5732));
check('ialqarawi: var uluru = {lat: X, lng: Y}', has(ad('i', 'var uluru = {lat: 24.941824, lng: 44.539865};'), 24.9418, 44.5399));
check('therc: description «الموقع : https://maps.google.com/?q=LAT,LNG»', has(ad('t', 'الموقع : https://maps.google.com/?q=24.639000,46.491997'), 24.639, 46.492));
check('sakan: a LatLng marker on a page WITHOUT show_exact_location = true is the site approximation',
  pairsIn(ad('a', "var show_exact_location = false; latLng = new google.maps.LatLng(21.5713, 39.77581);")).length === 0);
check('sakan: the same marker WITH show_exact_location = true is the ad pin',
  has(ad('e', 'var show_exact_location = true; var latLng = new google.maps.LatLng(21.40572, 39.4731);'), 21.4057, 39.4731));
check('sirdab: a coarse «24.91, 46.6» is not a pin', pairsIn(ad('c', '"lat":24.91,"lng":46.6')).length === 0);
check('a pair outside Saudi Arabia is not a pin', pairsIn(ad('x', '"lat":11.2477085,"lng":25.9967148')).length === 0);

const none = { points: new Set<string>(), listingIds: new Set<number>() };
const office = (i: number) => ad(`b${i}`, '<iframe src="https://www.google.com/maps/embed?pb=!2d49.63198218498713!3d25.361896383819893">');
check('bossbih: the office embed on every sampled ad is NOT a missed pin', !judgeSite([1, 2, 3, 4].map(office), new Set(), none).flagged);
const related = [ad('r1', 'maps/place/25.4218,49.6376'), ad('r2', 'maps/place/25.4276,49.5921')];
check('alshawaf: another ad\'s saved pin in a «similar ads» list is NOT a missed pin',
  !judgeSite(related, new Set([key(25.4218, 49.6376), key(25.4276, 49.5921)]), none).flagged);
const own = [ad('o1', '&quot;map&quot;:{&quot;latitude&quot;:26.317741424323515,&quot;longitude&quot;:43.907139560208286}'),
  ad('o2', '&quot;map&quot;:{&quot;latitude&quot;:26.317632311821644,&quot;longitude&quot;:43.90723915422684}')];
check('two border ads each with their own unsaved pin → FLAGGED (the sokok case)', judgeSite(own, new Set(), none).flagged);
check('…but one stray pair alone does not raise the alarm', !judgeSite(own.slice(0, 1), new Set(), none).flagged);
check('a row we strip on purpose (far from its city) is skipped',
  !judgeSite([{ ...own[0], listingId: 1 }, { ...own[1], listingId: 2 }], new Set(), { points: new Set(), listingIds: new Set([1, 2]) }).flagged);
check('a registered default point is skipped',
  !judgeSite(own, new Set(), { points: new Set([key(26.317741424323515, 43.907139560208286), key(26.317632311821644, 43.90723915422684)]), listingIds: new Set() }).flagged);

// Mutation proofs: break the REAL module one way at a time and prove a fixture above goes red on it.
const LIB = new URL('./lib/missedPinCandidates.ts', import.meta.url);
const SRC = readFileSync(LIB, 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'missed-pin-'));
async function mutant(name: string, from: string, to: string) {
  if (!SRC.includes(from)) throw new Error(`mutation anchor vanished: ${name}`);
  const p = join(dir, `m${Math.random().toString(36).slice(2)}.ts`);
  writeFileSync(p, SRC.replace(from, to));
  return (await import(pathToFileURL(p).href)) as typeof import('./lib/missedPinCandidates.ts');
}
const mutantCaught = (label: string, caught: boolean) => check(`(mutation) ${label}`, caught);
{
  const m = await mutant('no decode', "let t = text.replace(/&quot;/g, '\"')", "let t = text; if (0) t = text.replace(/&quot;/g, '\"')");
  mutantCaught('dropping the &quot; decode blinds the sokok fixture', !m.pairsIn(ad('s', '&quot;map&quot;:{&quot;latitude&quot;:26.437075817310653,&quot;longitude&quot;:43.88399117211289}')).length);
}
{
  const m = await mutant('no repeat filter', '(freq.get(k) ?? 0) < 3 &&', 'true &&');
  mutantCaught('dropping the repeated-point filter flags the bossbih office', m.judgeSite([1, 2, 3, 4].map(office), new Set(), none).flagged);
}
{
  const m = await mutant('one ad is enough', 'missed.length >= 2', 'missed.length >= 1');
  mutantCaught('lowering the threshold to one ad raises on a single stray pair', m.judgeSite(own.slice(0, 1), new Set(), none).flagged);
}
{
  const m = await mutant('no known-pin filter', '!knownPins.has(k) &&', 'true &&');
  mutantCaught('dropping the known-pin filter flags the alshawaf similar-ads cards', m.judgeSite(related, new Set([key(25.4218, 49.6376), key(25.4276, 49.5921)]), none).flagged);
}
{
  const m = await mutant('no KSA gate', 'if (!inKsa(a, b)) continue;', '');
  mutantCaught('dropping the Saudi gate reads a pair in Sudan', m.pairsIn(ad('x', '"lat":11.2477085,"lng":25.9967148')).length > 0);
}

{
  const m = await mutant('approx marker read', "if (shape === 'latlng-call' && approxMarker) continue;", '');
  mutantCaught('reading every LatLng marker again flags the sakan approximation', m.pairsIn(ad('a', "var show_exact_location = false; latLng = new google.maps.LatLng(21.5713, 39.77581);")).length > 0);
}

// nawafeth (run 39853742689): two ads in DIFFERENT towns drawn at the same Jubail point = the site's default
{
  const naw = (id: number, city: string, lat: string, lng: string) => ({ url: `n${id}`, listingId: id, city, html: `const propertyLat = parseFloat('${lat}'); const propertyLng = parseFloat('${lng}');` });
  const twoTowns = [naw(156, 'دخنة', '27.0220', '49.5732'), naw(160, 'الدمام', '27.0219', '49.5728')];
  check('a point drawn on ads of two different towns is the site default, never a missed pin', !judgeSite(twoTowns, new Set(), none).flagged);
  const twoOwn = [naw(176, 'المدينة المنورة', '24.476430', '39.611220'), naw(178, 'الدمام', '26.426045', '50.088101')];
  check('two ads with their OWN different points still raise the alarm', judgeSite(twoOwn, new Set(), none).flagged);
  const m = await mutant('no town filter', '!shared(p) &&', 'true &&');
  mutantCaught('dropping the different-towns filter flags the nawafeth default', m.judgeSite(twoTowns, new Set(), none).flagged);
}

if (failed) { console.log(`\n❌ verify-missed-pin-candidates: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-missed-pin-candidates: the robot reads every shape seen live and ignores every false alarm seen live.');
