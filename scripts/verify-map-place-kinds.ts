// THE MAP SEARCH TELLS A CITY FROM A REGION FROM A DISTRICT FROM A STREET FROM A LANDMARK (owner 2026-11-01).
//
// Measured on ezhalah.com that day: «الرياض» listed six rows all titled «الرياض» with nothing saying which was the
// city, the region, a district in Jeddah or a village; "Red Sea Mall" listed one mall five times. This EXECUTES
// src/lib/placeKind.ts against the Places Apple really returned for those queries (recorded from MapKit JS on
// 2026-11-01), in Arabic and English, and proves the dedupe, the ordering and the subtitle rule; mutations prove each
// check can fail.
//   node --experimental-strip-types scripts/verify-map-place-kinds.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyPlace, placeSubtitle, dedupePlaces, sortByKind, isAreaKind, KIND_LABEL, type PlaceFacts, type PlaceKind } from '../src/lib/placeKind.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };

// Real Places, as MapKit JS resolved them on 2026-11-01 (fields: name, locality, subLocality, administrativeArea, thoroughfare, poi, span).
const CASES: [string, PlaceFacts, PlaceKind][] = [
  ['الرياض — the city', { name: 'الرياض', locality: 'الرياض', administrativeArea: 'منطقة الرياض', span: 0.463 }, 'city'],
  ['منطقة الرياض — the region', { name: 'منطقة الرياض', administrativeArea: 'منطقة الرياض', span: 8.494 }, 'region'],
  ['حي الرياض in Jeddah — a district', { name: 'حي الرياض', locality: 'جدة', subLocality: 'حي الرياض', administrativeArea: 'منطقة مكة', span: 0.095 }, 'district'],
  ['الرياض in الخرج — a sub-locality', { name: 'الرياض', locality: 'الخرج', subLocality: 'الرياض', administrativeArea: 'منطقة الرياض', span: 0.196 }, 'district'],
  ['المنطقة الشرقية — the region', { name: 'المنطقة الشرقية', administrativeArea: 'المنطقة الشرقية', span: 10.164 }, 'region'],
  ['المنطقة الشرقية in Tabuk — a street of that name', { name: 'المنطقة الشرقية', locality: 'تبوك', subLocality: 'حي النهضة', administrativeArea: 'منطقة تبوك', thoroughfare: 'المنطقة الشرقية', span: 0.009 }, 'street'],
  ['النرجس — a district of Riyadh', { name: 'النرجس', locality: 'الرياض', subLocality: 'النرجس', administrativeArea: 'منطقة الرياض', span: 0.169 }, 'district'],
  ['طريق الملك فهد — a street', { name: 'طريق الملك فهد', locality: 'جدة', subLocality: 'الربوة', administrativeArea: 'منطقة مكة', thoroughfare: 'طريق الملك فهد', span: 0.009 }, 'street'],
  ['Red Sea Mall — the mall (Apple: Store)', { name: 'Red Sea Mall', locality: 'Jeddah', subLocality: 'Al Shatia', administrativeArea: 'Makkah', poi: 'Store', span: 0.005 }, 'mall'],
  ['Red Sea Mall — its hotel (Apple: Hotel)', { name: 'Red Sea Mall', locality: 'Jeddah', subLocality: 'Ash Shati District', administrativeArea: 'Mecca', thoroughfare: 'King Abdulaziz Road', poi: 'Hotel', span: 0.009 }, 'hotel'],
  ['Lego - Red Sea Mall — a shop (Store, not a mall)', { name: 'Lego - Red Sea Mall', locality: 'Jeddah', subLocality: 'Ash Shati District', administrativeArea: 'Mecca', poi: 'Store', span: 0.009 }, 'mall'],
  ['الحرم المكي الشريف — the Grand Mosque (no category; known by name)', { name: 'الحرم المكي الشريف', locality: 'مكة المكرمة', subLocality: 'الحرم', administrativeArea: 'منطقة مكة', span: 0.009 }, 'mosque'],
  ['a pin-sized place inside a sub-locality is a place, not the district', { name: 'كشك الحرم', locality: 'مكة المكرمة', subLocality: 'الحرم', administrativeArea: 'منطقة مكة', span: 0.009 }, 'place'],
  ['مسجد عائشة — a mosque by name', { name: 'مسجد عائشة', locality: 'مكة المكرمة', subLocality: 'حي البحيرات', administrativeArea: 'منطقة مكة', thoroughfare: 'حي البحيرات', span: 0.002 }, 'mosque'],
  ['مسجد الأمير احمد — a mosque whose name Apple also gives as thoroughfare', { name: 'مسجد الأمير احمد', locality: 'مكة المكرمة', subLocality: 'حي الرصيفة', administrativeArea: 'منطقة مكة', thoroughfare: 'مسجد الأمير احمد', span: 0.009 }, 'mosque'],
  ['حي مسجد الدرع — a district whose name holds «مسجد»', { name: 'حي مسجد الدرع', locality: 'المدينة المنورة', subLocality: 'حي مسجد الدرع', administrativeArea: 'منطقة المدينة', span: 0.015 }, 'district'],
  ['المسجد — a village', { name: 'المسجد', locality: 'المسجد', administrativeArea: 'منطقة المدينة', span: 0.009 }, 'city'],
  ['مطار حرض — an airport', { name: 'مطار حرض المنطقة الشرقية المملكة العربية السعودية', locality: 'الاحساء', administrativeArea: 'المنطقة الشرقية', poi: 'Airport', span: 0.031 }, 'airport'],
  ['امانة المنطقة الشرقية — an office, a place', { name: 'امانة المنطقة الشرقية', locality: 'الدمام', subLocality: 'حي السلام', administrativeArea: 'المنطقة الشرقية', thoroughfare: 'شارع الملك عبدالعزيز', span: 0.001 }, 'place'],
  ['Riyadh Region (English)', { name: 'Riyadh Region', administrativeArea: 'Riyadh', span: 8.5 }, 'region'],
  ['Riyadh (English city)', { name: 'Riyadh', locality: 'Riyadh', administrativeArea: 'Riyadh', span: 0.46 }, 'city'],
  ['King Khalid International Airport', { name: 'Riyadh King Khalid International Airport', locality: 'Riyadh', thoroughfare: 'Airport Road', poi: 'Airport', span: 0.03 }, 'airport'],
  ['غرناطة مول — a mall by name', { name: 'غرناطة مول', locality: 'الرياض', subLocality: 'حي الشهداء', administrativeArea: 'منطقة الرياض', poi: 'Store', span: 0.008 }, 'mall'],
  ['مستشفى الملك فيصل التخصصي — a hospital', { name: 'مستشفى الملك فيصل التخصصي', locality: 'الرياض', subLocality: 'حي المعذر', administrativeArea: 'منطقة الرياض', poi: 'Hospital', span: 0.005 }, 'hospital'],
];
for (const [label, facts, want] of CASES) {
  const got = classifyPlace(facts);
  check(`classify: ${label} → ${want}`, got === want, `got ${got}`);
}
check('every kind has a label key', (Object.keys(KIND_LABEL) as PlaceKind[]).every((k) => KIND_LABEL[k].length > 0));

// Subtitles name WHERE, never a plus-code or a street number.
const ar = 'المملكة العربية السعودية';
const facts = (name: string) => CASES.find(([, f]) => f.name === name)![1];
check('subtitle: city → its region', placeSubtitle(facts('الرياض'), 'city', ar) === 'منطقة الرياض');
check('subtitle: region → the country', placeSubtitle(facts('منطقة الرياض'), 'region', ar) === ar);
check('subtitle: district → its city', placeSubtitle(facts('حي الرياض'), 'district', ar) === 'جدة');
check('subtitle: landmark → district، city', placeSubtitle(facts('مسجد عائشة'), 'mosque', ar) === 'حي البحيرات، مكة المكرمة');
check('subtitle: never a plus-code', !/[A-Z]{4}\d{4}|\d{4}/.test(placeSubtitle(CASES.filter(([, f]) => f.name === 'Red Sea Mall')[1][1], 'hotel', 'Saudi Arabia')));

// Dedupe: Red Sea Mall's five Apple entries (mall, hotel, two restaurants, café within ~100 m) collapse to one; Lego stays.
const redSea = [
  { name: 'Red Sea Mall', subtitle: 'Al Shatia، Jeddah', coordinate: { latitude: 21.6279, longitude: 39.111 }, kind: 'mall' as PlaceKind },
  { name: 'Red Sea Mall', subtitle: 'Ash Shati District، Jeddah', coordinate: { latitude: 21.6281, longitude: 39.1111 }, kind: 'hotel' as PlaceKind },
  { name: 'Red Sea Mall', subtitle: 'Ash Shati District، Jeddah', coordinate: { latitude: 21.6277, longitude: 39.1112 }, kind: 'place' as PlaceKind },
  { name: 'Red Sea Mall', subtitle: 'Ash Shati District، Jeddah', coordinate: { latitude: 21.6286, longitude: 39.1099 }, kind: 'place' as PlaceKind },
  { name: 'Lego - Red Sea Mall', subtitle: 'Ash Shati District، Jeddah', coordinate: { latitude: 21.6277, longitude: 39.1118 }, kind: 'mall' as PlaceKind },
];
const d = dedupePlaces(redSea);
check('dedupe: Red Sea Mall ×4 → 1, Lego kept', d.length === 2 && d[0].kind === 'mall' && d[1].name.startsWith('Lego'), JSON.stringify(d.map((r) => r.name)));
check('dedupe: two cities sharing a name far apart both stay', dedupePlaces([
  { name: 'الرياض', subtitle: 'منطقة الرياض', coordinate: { latitude: 24.7, longitude: 46.68 } },
  { name: 'الرياض', subtitle: 'الخرج', coordinate: { latitude: 24.52, longitude: 47.21 } },
]).length === 2);

// Order: city, region, district, street, then landmarks — stable inside a rank (Apple's relevance kept).
const ordered = sortByKind([{ kind: 'mosque' as PlaceKind, n: 1 }, { kind: 'district' as PlaceKind, n: 2 }, { kind: 'city' as PlaceKind, n: 3 }, { kind: 'region' as PlaceKind, n: 4 }, { kind: 'street' as PlaceKind, n: 5 }, { kind: 'mall' as PlaceKind, n: 6 }]);
check('order: city → region → district → street → landmarks (stable)', ordered.map((r) => r.n).join(',') === '3,4,2,5,1,6', ordered.map((r) => r.n).join(','));
check('isAreaKind: region/city/district are areas, a mall is not', isAreaKind('region') && isAreaKind('city') && isAreaKind('district') && !isAreaKind('mall') && !isAreaKind('street'));

// Mutations: the rules can fail.
check('(mutation) a Store named without «mall» is NOT a mall', classifyPlace({ name: 'Adidas', locality: 'Riyadh', poi: 'Store' }) === 'place');
check('(mutation) a sub-locality named like its city is the city, not a district', classifyPlace({ name: 'جدة', locality: 'جدة', subLocality: 'جدة', span: 0.3 }) === 'city');
check('(mutation) a region needs no locality', classifyPlace({ name: 'منطقة مكة', locality: 'مكة', administrativeArea: 'منطقة مكة', span: 3 }) !== 'region');

// Wiring: the web map resolves rows through this module and the field shows the tag; the native stub shares the type.
const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const field = readFileSync(join(root, 'src/components/MapDealRow.tsx'), 'utf8');
const i18n = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');
check('AppleMap.web.tsx: suggestPlaces classifies, dedupes and sorts', /classifyPlace\(facts\)/.test(web) && /sortByKind\(dedupePlaces\(/.test(web) && /placeSubtitle\(facts, kind, country\)/.test(web));
check('AppleMap.web.tsx: an unresolved row is kept with its two lines (timeout → resolve(r))', /setTimeout\(\(\) => resolve\(r\), \d+\)/.test(web));
check('AppleMap.web.tsx: the mark follows the kind (pin for a landmark, outline for an area)', /isAreaKind\(p\.kind\)/.test(web));
check('MapDealRow.tsx: the row shows t(KIND_LABEL[kind]) and the clean subtitle', /t\(KIND_LABEL\[p\.kind\]\)/.test(field) && /p\.subtitle \?\? p\.displayLines\[1\]/.test(field));
check('i18n: every tag label is translated', (Object.values(KIND_LABEL)).every((k) => new RegExp(`^\\s*'${k}':\\s*'[^']+'`, 'm').test(i18n)), Object.values(KIND_LABEL).filter((k) => !new RegExp(`^\\s*'${k}':`, 'm').test(i18n)).join(','));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nverify-map-place-kinds: all checks passed');
process.exit(failed ? 1 : 0);
