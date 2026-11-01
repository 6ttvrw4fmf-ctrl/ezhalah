// WHAT KIND OF PLACE IS THIS? — the map search tells a region from a city from a district from a street from a
// landmark (owner 2026-11-01: «identify between landmarks, cities and like this; it looks weird»). Measured on
// ezhalah.com that day: «الرياض» listed six rows all titled «الرياض» (the city, the region, a district in Jeddah, two
// villages, the Emirate office) with nothing saying which was which; "Red Sea Mall" listed the same mall five
// times (Apple returns its hotel, cafés and restaurants as separate places); subtitles were raw plus-code
// addresses («RFDA3062, 3062 …»).
//
// Apple's autocomplete rows carry only two display lines; the facts that decide the kind come from resolving each
// row to a Place (locality, subLocality, administrativeArea, thoroughfare, pointOfInterestCategory, span). This
// module is PURE — no MapKit, no React — so `scripts/verify-map-place-kinds.ts` executes it against the real
// places measured above, in both scripts.
export type PlaceKind =
  | 'region' | 'city' | 'district' | 'street'
  | 'mosque' | 'mall' | 'hospital' | 'airport' | 'hotel' | 'school' | 'university' | 'park' | 'station'
  | 'landmark' | 'place';

export type PlaceFacts = {
  name?: string;
  locality?: string;
  subLocality?: string;
  administrativeArea?: string;
  thoroughfare?: string;
  poi?: string;
  /** Apple's bounding region height in degrees (a region ≈ 8–10, a city ≈ 0.2–0.5, a district ≈ 0.1–0.3). */
  span?: number;
};

/** English i18n key shown as the row's tag (translated by the UI language). */
export const KIND_LABEL: Record<PlaceKind, string> = {
  region: 'Region', city: 'City', district: 'District', street: 'Street',
  mosque: 'Mosque', mall: 'Mall', hospital: 'Hospital', airport: 'Airport', hotel: 'Hotel', school: 'School',
  university: 'University', park: 'Park', station: 'Station', landmark: 'Landmark', place: 'Place',
};

/** Admin places first (what a property search is usually about), then streets, then landmarks. Stable within a rank. */
export const KIND_RANK: Record<PlaceKind, number> = {
  city: 0, region: 1, district: 2, street: 3,
  mosque: 4, mall: 4, hospital: 4, airport: 4, hotel: 4, school: 4, university: 4, park: 4, station: 4, landmark: 4,
  place: 5,
};

/** One spelling: ة/ه, ى/ي and the hamza forms of ا are one letter to a typist («المدينه المنوره» is المدينة المنورة),
 *  a leading «حي» / "District" / «ال» / "Al-" is not part of the name. */
const norm = (s?: string) => (s ?? '').trim().replace(/^(حي|حى)\s+/u, '').replace(/\s+district$/i, '').replace(/^al[- ]/i, '').replace(/^ال/u, '')
  .replace(/ة/gu, 'ه').replace(/ى/gu, 'ي').replace(/[أإآ]/gu, 'ا').replace(/عبد\s+ال/gu, 'عبدال').replace(/\s+/gu, ' ').toLowerCase();
const same = (a?: string, b?: string) => !!a && !!b && norm(a) === norm(b);
/** What the typist means by a name: «منطقة القصيم» IS «القصيم» when matching the typed text. */
const typedKey = (s?: string) => norm(norm(s).replace(/^(منطقه|اماره منطقه|محافظه)\s+/u, '').replace(/\s+(region|province)$/i, '').replace(/\s+(المكرمه|المنوره)$/u, ''));

const DISTRICT_NAME = /^(حي|حى)\s/u;
const MOSQUE_NAME = /^(مسجد|جامع|مصلى)\s|^(المسجد (الحرام|النبوي)|الحرم (المكي|النبوي))|^(masjid|mosque)\b|\b(mosque|masjid)$/iu;
/** The name's own first word says what it is, whatever Apple filed the pin under («مطار الملك خالد» was a «district»,
 *  «جامعة الملك سعود» a «district», «برج المملكة» a «hotel», «مستشفى … - القاعة الرئيسية» a «school»). */
const NAME_KIND: [RegExp, PlaceKind][] = [
  [/^(مطار)\s|\bairport\b/iu, 'airport'], [/^(جامعة|كلية)\s|\b(university|college)\b/iu, 'university'],
  [/^(مستشفى|مستوصف)\s|\bhospital\b/iu, 'hospital'], [/^(مدرسة|مدارس|ثانوية|متوسطة|ابتدائية)\s|\bschool\b/iu, 'school'],
  [/^(حديقة|منتزه|متنزه)\s|\bpark$/iu, 'park'], [/^(محطة)\s|\bstation\b/iu, 'station'], [/^(فندق)\s|^hotel\b|\bhotel$/iu, 'hotel'],
  [/^(متحف|قصر|قلعة|برج|ملعب|استاد|ستاد)\s|\b(museum|palace|tower|stadium)\b/iu, 'landmark'],
];
const MALL_NAME = /^(مول|سنتر)\s|\s(مول|سنتر)$|^mall\b|\b(mall|centre|center)$/iu;
const STREET_NAME = /^(طريق|شارع|الطريق|كورنيش|ممر|الدائري)\s|\b(road|street|st\.?|rd\.?|avenue|ave\.?|highway|boulevard|ring)\b/iu;
const REGION_NAME = /^(منطقة|المنطقة)\s|\b(region|province)\b/iu;
/** A name TITLED like a street («شارع التحلية», "King Fahd Road") is the street to the person who typed it, whatever
 *  Apple filed the pin under (Tahlia's rows are user-submitted shop pins whose thoroughfare is the road's official name). */
const STREET_TITLED = /^(طريق|شارع|الطريق|كورنيش|الدائري)\s|\b(road|street|rd|st|avenue|ave|highway|boulevard)\.?$/iu;
/** A user-written DESCRIPTION, not a place name («طريق الملك فهد اللي دايم زحمه», «كيو في نهاية شارع التحلية»). */
const NOISE_NAME = /(^|\s)(اللي|الي|جنب|عند|قدام|ورا|وراء|بجوار|بجانب|مقابل|قريب|دايم)(\s|$)|في نهاي/u;
export const isNoiseName = (name?: string) => NOISE_NAME.test((name ?? '').trim());

const POI_KIND: Record<string, PlaceKind> = {
  Airport: 'airport', Hospital: 'hospital', Hotel: 'hotel', School: 'school', University: 'university',
  Park: 'park', NationalPark: 'park', PublicTransport: 'station',
  Museum: 'landmark', Stadium: 'landmark', Zoo: 'landmark', AmusementPark: 'landmark', Beach: 'landmark', Marina: 'landmark',
  Aquarium: 'landmark', Theater: 'landmark', Library: 'landmark', Castle: 'landmark', Landmark: 'landmark', Fortress: 'landmark',
};

/** The part of «مطار الملك خالد الدولي - البوابة الشمالية» before the dash: a gate, terminal, hall or branch of a place. */
const parentName = (name: string) => name.split(/\s+[-–|]\s+|\s*،\s*/u)[0].trim();

export function classifyPlace(f: PlaceFacts): PlaceKind {
  // «Lego - Red Sea Mall» is Lego; «فندق التنفيذيين - كافد» is a hotel: the first segment of a composite name is the place.
  const name = parentName((f.name ?? '').trim());
  if (DISTRICT_NAME.test(name)) return 'district';
  if (MOSQUE_NAME.test(name)) return 'mosque';
  if (STREET_TITLED.test(name)) return 'street';
  for (const [re, kind] of NAME_KIND) if (re.test(name)) return kind;
  if (MALL_NAME.test(name)) return 'mall';
  if (f.poi) return f.poi === 'Store' ? 'place' : (POI_KIND[f.poi] ?? 'place');
  if (!f.locality && (same(f.administrativeArea, name) || (f.span ?? 0) >= 2 || REGION_NAME.test(name))) return 'region';
  if (f.thoroughfare && (same(f.thoroughfare, name) || STREET_NAME.test(name))) return 'street';
  if (f.subLocality && same(f.subLocality, name) && !same(f.locality, name)) return 'district';
  if (same(f.locality, name)) return 'city';
  // A named sub-locality with an area-sized span is a district; a pin-sized one (span ≈ 0.01) is a place inside it.
  if (f.subLocality && !f.thoroughfare && (f.span ?? 0) >= 0.03) return 'district';
  return 'place';
}

/** The line under the name: where the place is, never a street number or a plus-code. */
export function placeSubtitle(f: PlaceFacts, kind: PlaceKind, country: string): string {
  const join = (...parts: (string | undefined)[]) => parts.filter((p, i, a) => p && a.indexOf(p) === i && !same(p, f.name)).join('، ');
  switch (kind) {
    case 'region': return country;
    case 'city': return f.administrativeArea || country;
    case 'district': return f.locality || f.administrativeArea || country;
    default: return join(f.subLocality, f.locality) || f.administrativeArea || country;
  }
}

/** Collapse Apple's several entries for one place: same name within ~250 m, or same name + same subtitle. */
export function dedupePlaces<T extends { name: string; subtitle?: string; kind?: PlaceKind; locality?: string; coordinate?: { latitude: number; longitude: number } }>(rows: T[]): T[] {
  const kept: T[] = [];
  const sameTown = (k: T, r: T) => !!k.locality && same(k.locality, r.locality) && !isAreaKind(k.kind) && !isAreaKind(r.kind) && k.kind !== 'street' && r.kind !== 'street';
  for (const r of rows) {
    const dup = kept.some((k) => (same(k.name, r.name) && (
      (k.subtitle && k.subtitle === r.subtitle) || sameTown(k, r) ||
      (!!k.coordinate && !!r.coordinate && Math.abs(k.coordinate.latitude - r.coordinate.latitude) < 0.0025 && Math.abs(k.coordinate.longitude - r.coordinate.longitude) < 0.0025)
    )) || (parentName(r.name) !== r.name && same(k.name, parentName(r.name)) && (sameTown(k, r) || k.kind === 'district')));
    if (!dup) kept.push(r);
  }
  return kept;
}

/** A city or region in the list owns its name: a district, street or pin elsewhere that merely CARRIES that name
 *  («مكة المكرمة» the sub-locality of الجموم, a street called «الدمام» in ظهران الجنوب, «جدة» the district of بحرة) is
 *  what made every city search end in five rows of noise (measured 2026-11-01). Areas keep each other. */
export function dropAreaShadows<T extends { name?: string; kind?: PlaceKind }>(rows: T[]): T[] {
  const owners = rows.filter((r) => r.kind === 'city' || r.kind === 'region');
  if (!owners.length) return rows;
  return rows.filter((r) => isAreaKind(r.kind) && r.kind !== 'district' ? true : !owners.some((o) => same(typedKey(o.name), typedKey(r.name))));
}

/** Order: what the user TYPED first — the exact name, then a name that starts with it, then one containing it, then the rest
 *  (owner 2026-11-01: «when user types it let the map take him»; «برج المملكة» must not sit under districts called
 *  «البرج») — and inside each tier city → region → district → street → landmarks, stable. */
export function sortByKind<T extends { kind?: PlaceKind; name?: string }>(rows: T[], query = ''): T[] {
  const q = typedKey(query);
  const tier = (r: T) => { if (!q) return 0; const n = typedKey(r.name); return n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3; };
  return rows.map((r, i) => ({ r, i, t: tier(r) })).sort((a, b) => (a.t - b.t) || (KIND_RANK[a.r.kind ?? 'place'] - KIND_RANK[b.r.kind ?? 'place']) || a.i - b.i).map(({ r }) => r);
}

/** A landmark-like kind is marked with a pin and a soft circle; an area with an outline. */
export const isAreaKind = (k?: PlaceKind) => k === 'region' || k === 'city' || k === 'district';
