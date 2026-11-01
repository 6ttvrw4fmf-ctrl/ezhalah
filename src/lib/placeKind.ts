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

const norm = (s?: string) => (s ?? '').trim().replace(/^(حي|حى)\s+/u, '').replace(/\s+district$/i, '').replace(/^al[- ]/i, '').replace(/^ال/u, '').toLowerCase();
const same = (a?: string, b?: string) => !!a && !!b && norm(a) === norm(b);
/** Letter folding for matching what the user typed: ة/ه, ى/ي and the hamza forms of ا are one letter to a typist. */
const fold = (s: string) => norm(s).replace(/ة/gu, 'ه').replace(/ى/gu, 'ي').replace(/[أإآ]/gu, 'ا');

const DISTRICT_NAME = /^(حي|حى)\s/u;
const MOSQUE_NAME = /^(مسجد|جامع|مصلى)\s|\b(mosque|masjid)\b|الحرم (المكي|النبوي)|المسجد (الحرام|النبوي)/iu;
const MALL_NAME = /مول|\bmall\b|\bcentre\b|\bcenter\b|سنتر/iu;
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

export function classifyPlace(f: PlaceFacts): PlaceKind {
  const name = (f.name ?? '').trim();
  if (DISTRICT_NAME.test(name)) return 'district';
  if (MOSQUE_NAME.test(name)) return 'mosque';
  if (STREET_TITLED.test(name)) return 'street';
  if (f.poi) {
    if (f.poi === 'Store') return MALL_NAME.test(name) ? 'mall' : 'place';
    return POI_KIND[f.poi] ?? 'place';
  }
  if (MALL_NAME.test(name)) return 'mall';
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
  const join = (...parts: (string | undefined)[]) => parts.filter((p, i, a) => p && a.indexOf(p) === i).join('، ');
  switch (kind) {
    case 'region': return country;
    case 'city': return f.administrativeArea || country;
    case 'district': return f.locality || f.administrativeArea || country;
    default: return join(f.subLocality, f.locality) || f.administrativeArea || country;
  }
}

/** Collapse Apple's several entries for one place: same name within ~250 m, or same name + same subtitle. */
export function dedupePlaces<T extends { name: string; subtitle?: string; coordinate?: { latitude: number; longitude: number } }>(rows: T[]): T[] {
  const kept: T[] = [];
  for (const r of rows) {
    const dup = kept.some((k) => same(k.name, r.name) && (
      (k.subtitle && k.subtitle === r.subtitle) ||
      (!!k.coordinate && !!r.coordinate && Math.abs(k.coordinate.latitude - r.coordinate.latitude) < 0.0025 && Math.abs(k.coordinate.longitude - r.coordinate.longitude) < 0.0025)
    ));
    if (!dup) kept.push(r);
  }
  return kept;
}

/** Order: what the user TYPED first — a name that starts with the query, then one that contains it, then the rest
 *  (owner 2026-11-01: «when user types it let the map take him»; «برج المملكة» must not sit under districts called
 *  «البرج») — and inside each tier city → region → district → street → landmarks, stable. */
export function sortByKind<T extends { kind?: PlaceKind; name?: string }>(rows: T[], query = ''): T[] {
  const q = fold(query);
  const tier = (r: T) => { if (!q) return 0; const n = fold(r.name ?? ''); return n.startsWith(q) ? 0 : n.includes(q) ? 1 : 2; };
  return rows.map((r, i) => ({ r, i, t: tier(r) })).sort((a, b) => (a.t - b.t) || (KIND_RANK[a.r.kind ?? 'place'] - KIND_RANK[b.r.kind ?? 'place']) || a.i - b.i).map(({ r }) => r);
}

/** A landmark-like kind is marked with a pin and a soft circle; an area with an outline. */
export const isAreaKind = (k?: PlaceKind) => k === 'region' || k === 'city' || k === 'district';
