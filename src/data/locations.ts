// Location autocomplete for the home filter. As the user types — in English OR Arabic — we surface
// every matching place across the Kingdom: the country itself, an administrative region, a city, or
// a district. The user can pick at any level: "Saudi Arabia" (whole country), a region (e.g. Riyadh
// Region), a city (e.g. Riyadh), or a specific district. The more specific the input, the tighter
// the list. Names come from the official region/city/district dataset (sa-locations.json), Arabic-
// first with English fallbacks. (PRD §5.1, prototype matchLocations — extended to nationwide data.)

import raw from './sa-locations.json';

export type PlaceKind = 'country' | 'region' | 'city' | 'district';

// A selectable location at any administrative level. nameEn/nameAr is the place's own name;
// cityEn/cityAr and regionEn/regionAr carry parent context for display (districts show their city
// and region; cities show their region).
export type Place = {
  id: number; // stable unique id (assigned at index-build time) — used for React keys
  kind: PlaceKind;
  nameEn: string;
  nameAr: string;
  cityEn?: string;
  cityAr?: string;
  regionEn?: string;
  regionAr?: string;
};

// Monotonic id assigned to every indexed place at module load. Guarantees a unique React key even
// when the dataset has two districts with the same name in the same city (genuine duplicate rows,
// or distinct Arabic names that tidy to the same English string) — otherwise React drops the
// colliding rows and they silently never appear in the suggestions.
let _uid = 0;
const nextId = () => _uid++;

// ---------------------------------------------------------------------------------------------
// Raw dataset (compact tuples to keep the bundle small).
//   regions:   [region_id, name_en, name_ar]
//   cities:    [city_id, region_id, name_en, name_ar]
//   districts: [city_id, region_id, name_en, name_ar]
// ---------------------------------------------------------------------------------------------
type Raw = {
  regions: [number, string, string][];
  cities: [number, number, string, string][];
  districts: [number, number, string, string][];
};
const DATA = raw as Raw;

const COUNTRY_EN = 'Saudi Arabia';
const COUNTRY_AR = 'المملكة العربية السعودية';

// Tidy a raw English district name: "Al Amal Dist." → "Al Amal District".
function tidyDistEn(en: string): string {
  return en.replace(/\bDist\.?$/i, 'District').trim();
}

// region_id → names
const REGION_BY_ID = new Map<number, { en: string; ar: string }>();
for (const [id, en, ar] of DATA.regions) REGION_BY_ID.set(id, { en, ar });

// city_id → names + region
const CITY_BY_ID = new Map<number, { en: string; ar: string; regionId: number }>();
for (const [id, regionId, en, ar] of DATA.cities) CITY_BY_ID.set(id, { en, ar, regionId });

// ---------------------------------------------------------------------------------------------
// Normalization + search keys
// ---------------------------------------------------------------------------------------------
// Lowercase, strip Arabic diacritics + tatweel, fold common Arabic letter variants (أإآ→ا, ة→ه,
// ى/ي→ي) so spelling differences still match, then drop everything that isn't a letter or digit
// (spaces, dots, commas). Latin and Arabic letters are preserved.
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ً-ٟ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/[^\p{L}\p{N}]/gu, '');
// Drop a leading definite article so "narjis" matches "Al Narjis" / "النرجس".
const stripAl = (s: string) => s.replace(/^al/, '').replace(/^ال/, '');
// Drop the district word ("حي" / "District" / "Dist") wherever it sits in a NORMALIZED query —
// `norm` has already glued the words together (spaces removed), so "حي شهار" arrives as "حيشهار"
// and "shihar district" as "shihardistrict". District search keys have this word stripped out, so
// the query must drop it too or it can never prefix-match. Applied as an extra query variant, never
// destructively — the original query is still tried.
const stripDistrictWord = (s: string) =>
  s.replace(/^حي/, '').replace(/^(?:district|dist)/, '').replace(/(?:district|dist)$/, '');

// A search key. `lead` keys anchor at the start of the name ("name starts with query"); non-lead
// keys are individual words ("some word in the name starts with query"). Matching is always a
// prefix test — never a mid-word substring — so typing letters narrows the list cleanly.
type Key = { k: string; lead: boolean };

const ARTICLE = new Set(['al', 'ال']);
const DISTRICT_WORD = new Set(['district', 'dist', 'حي']);

function pushKey(map: Map<string, boolean>, k: string, lead: boolean) {
  if (!k) return;
  map.set(k, (map.get(k) ?? false) || lead); // if a key is ever a lead key, keep it as lead
}

// Build prefix keys for a place's English + Arabic names. Articles ("Al"/"ال") and the
// "District"/"حي" words are stripped so they never block a match.
function buildKeys(en: string, ar: string, isDistrict: boolean): Key[] {
  const map = new Map<string, boolean>();
  const handle = (raw: string, lang: 'en' | 'ar') => {
    if (!raw) return;
    // whole-name lead keys (with and without the leading article)
    let full = norm(raw);
    if (isDistrict && lang === 'en') full = full.replace(/(district|dist)$/, '');
    if (isDistrict && lang === 'ar') full = full.replace(/^حي/, '');
    pushKey(map, full, true);
    pushKey(map, stripAl(full), true);
    // per-word keys (skip 1-letter fragments — e.g. the "r" split out of "Bi'r" — which would
    // otherwise produce spurious single-letter matches)
    for (const w of raw.split(/[^\p{L}\p{N}]+/u)) {
      const nw = norm(w);
      if (nw.length < 2 || ARTICLE.has(nw) || DISTRICT_WORD.has(nw)) continue;
      pushKey(map, nw, false);
      pushKey(map, stripAl(nw), false);
    }
  };
  handle(en, 'en');
  handle(ar, 'ar');
  return [...map].map(([k, lead]) => ({ k, lead }));
}

type Indexed = { place: Place; keys: Key[] };

// Country — every key is a lead key (the country has no "parent" words to narrow within).
const COUNTRY: Indexed = {
  place: { id: nextId(), kind: 'country', nameEn: COUNTRY_EN, nameAr: COUNTRY_AR },
  keys: (() => {
    const map = new Map<string, boolean>();
    for (const k of ['saudi arabia', 'saudi', 'ksa', 'kingdom', COUNTRY_AR, 'المملكة', 'السعودية', 'العربية السعودية']) {
      const n = norm(k);
      pushKey(map, n, true);
      pushKey(map, stripAl(n), true);
    }
    return [...map].map(([k, lead]) => ({ k, lead }));
  })(),
};

// Regions
const REGIONS_IDX: Indexed[] = DATA.regions.map(([, en, ar]) => ({
  place: { id: nextId(), kind: 'region', nameEn: en, nameAr: ar },
  keys: buildKeys(en, ar, false),
}));

// Cities. Drop exact duplicate rows — the same city name (same Arabic + English) repeated in the
// same region — so a city never appears twice in the suggestions (and never collides on its key).
// Distinct cities that merely share a name (different region) are kept.
const CITIES_IDX: Indexed[] = [];
const seenCity = new Set<string>();
for (const [, regionId, en, ar] of DATA.cities) {
  const sig = `${regionId}|${norm(ar)}|${norm(en)}`;
  if (seenCity.has(sig)) continue;
  seenCity.add(sig);
  const r = REGION_BY_ID.get(regionId);
  CITIES_IDX.push({
    place: {
      id: nextId(),
      kind: 'city' as const,
      nameEn: en,
      nameAr: ar,
      regionEn: r?.en ?? '',
      regionAr: r?.ar ?? '',
    },
    keys: buildKeys(en, ar, false),
  });
}

// Districts (skip any whose city we don't have). Drop exact duplicate rows — the same district
// name repeated in the same city — so a neighborhood never appears twice. Distinct districts that
// merely share a name (different Arabic name, or a different city/region) are kept.
const DISTRICTS_IDX: Indexed[] = [];
const seenDistrict = new Set<string>();
for (const [cityId, regionId, en, ar] of DATA.districts) {
  const c = CITY_BY_ID.get(cityId);
  if (!c) continue;
  const sig = `${cityId}|${norm(ar)}|${norm(en)}`;
  if (seenDistrict.has(sig)) continue;
  seenDistrict.add(sig);
  const r = REGION_BY_ID.get(regionId) ?? REGION_BY_ID.get(c.regionId);
  DISTRICTS_IDX.push({
    place: {
      id: nextId(),
      kind: 'district',
      nameEn: tidyDistEn(en),
      nameAr: ar,
      cityEn: c.en,
      cityAr: c.ar,
      regionEn: r?.en ?? '',
      regionAr: r?.ar ?? '',
    },
    keys: buildKeys(en, ar, true),
  });
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------
// Levenshtein edit distance, capped — light typo tolerance on region/city names so a small
// misspelling ("riydah" → "Riyadh", "jedah" → "Jeddah") still surfaces the place.
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3; // we only care about distances ≤ 2
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[m];
}

// Classify how a place's keys match the query — always by PREFIX, never a mid-word substring.
// Matches on the NAME's start always beat matches on a later word, so a major place whose name
// begins with the query ranks above an obscure one that merely contains the word.
//   type:   0 = name == query, 1 = name starts with query, 2 = a word == query,
//           3 = a word starts with query, 4 = fuzzy (typo on the whole name)
//   metric: within-type tiebreak — matched key length for the prefix tiers (shorter = closer to a
//           full match), edit distance for fuzzy (smaller is better in every case)
// Returns null when nothing matches. Fuzzy candidates must share the first character with the
// query, which kills the flood of unrelated short names a bare edit-distance check produces.
type Score = { type: number; metric: number };
// `qs` is the set of query variants (raw, article-stripped, district-word-stripped, both) — a key
// matches if it equals / is prefixed by ANY of them. `q` (the raw variant) is used for fuzzy.
function scoreKeys(keys: Key[], qs: string[], q: string, fuzzyOk: boolean, maxDist: number): Score | null {
  let leadPrefix = Infinity;
  let wordExact = false;
  let wordPrefix = Infinity;
  for (const { k, lead } of keys) {
    const exact = qs.includes(k);
    const prefix = qs.some((qq) => k.startsWith(qq));
    if (lead) {
      if (exact) return { type: 0, metric: 0 };
      if (prefix) leadPrefix = Math.min(leadPrefix, k.length);
    } else {
      if (exact) wordExact = true;
      else if (prefix) wordPrefix = Math.min(wordPrefix, k.length);
    }
  }
  if (leadPrefix !== Infinity) return { type: 1, metric: leadPrefix };
  if (wordExact) return { type: 2, metric: 0 };
  if (wordPrefix !== Infinity) return { type: 3, metric: wordPrefix };
  if (fuzzyOk) {
    let best = Infinity;
    for (const { k, lead } of keys) if (lead && k[0] === q[0]) best = Math.min(best, editDistance(k, q));
    if (best <= maxDist) return { type: 4, metric: best };
  }
  return null;
}

const KIND_RANK: Record<PlaceKind, number> = { country: 0, region: 1, city: 2, district: 3 };
const MAX_RESULTS = 40;

// As the user types, surface matching places ranked by how well they match (exact → prefix → typo
// → substring), then by level (country → region → city → district), then by the within-type metric.
// Typo tolerance applies to regions and cities; districts match by prefix/substring only (there are
// thousands). The dropdown scrolls and the list is capped so it never floods.
export function matchLocations(query: string): Place[] {
  const q = norm(query.trim());
  if (!q) return [];
  // Query variants: raw, article-stripped ("ال"/"al"), district-word-stripped ("حي"/"District"),
  // and both — so "حي شهار", "شهار", "al shati", "shati district" all reach the same place. Deduped.
  const qd = stripDistrictWord(q);
  const qs = [...new Set([q, stripAl(q), qd, stripAl(qd)].filter(Boolean))];
  const fuzzyOk = q.length >= 4;
  const maxDist = q.length >= 6 ? 2 : 1;

  type Hit = { place: Place; primary: number; metric: number };
  const hits: Hit[] = [];

  const consider = (idx: Indexed, allowFuzzy: boolean) => {
    const sc = scoreKeys(idx.keys, qs, q, allowFuzzy && fuzzyOk, maxDist);
    if (!sc) return;
    hits.push({ place: idx.place, primary: sc.type * 10 + KIND_RANK[idx.place.kind], metric: sc.metric });
  };

  consider(COUNTRY, false);
  for (const r of REGIONS_IDX) consider(r, true);
  for (const c of CITIES_IDX) consider(c, true);
  for (const d of DISTRICTS_IDX) consider(d, false);

  hits.sort((a, b) => a.primary - b.primary || a.metric - b.metric);
  return hits.slice(0, MAX_RESULTS).map((h) => h.place);
}

// ---------------------------------------------------------------------------------------------
// AI-assisted location resolution (filter Price/Location Intelligence). When the user TYPES a custom
// location and doesn't pick from the dropdown, we still resolve it to the closest match in Ezhalah's
// location knowledge — so they never need the exact district, city, or spelling. Priority, per spec:
//   1) District   2) City   3) Landmark   4) Lifestyle   5) Geography
// A distinctive landmark / area-nickname / geography phrase ("Near KFUPM", "North Riyadh", "near the
// sea") is recognized first because it carries richer intent than the bare city a name-match would
// extract; a plain place name ("Almalqa", "Jeddah") falls through to the nationwide name matcher,
// which already ranks a district name above the city. This is deterministic + instant — it mirrors the
// agent's location knowledge WITHOUT an LLM round-trip, matching the filter's "one engine, direct"
// architecture. Result FILTERING is still city-level on the current mock data (district-level filtering
// lands with the scraper); this resolution + Search-Summary display is what the user verifies.
// ---------------------------------------------------------------------------------------------
export type LocationResolution = {
  raw: string;
  kind: 'district' | 'city' | 'region' | 'area' | 'landmark' | 'lifestyle' | 'geography' | 'none';
  city: string;        // canonical city for the engine/header ('' when not city-specific)
  label: string;       // primary matched label (place name, or the area/landmark/geography phrase)
  districts: string[]; // related / nearby districts to display
  cities: string[];    // extra nearby cities (landmark / geography)
  landmark?: string;
  note?: string;
};

// Letters/digits only (drops spaces, punctuation, Arabic diacritics) — for phrase `includes` tests.
const flatLoc = (s: string) => s.toLowerCase().replace(/[ً-ْ]/g, '').replace(/[^a-z0-9ء-ي]/gu, '');
// Whole words — for single-keyword tests (geography/lifestyle) so "بحره" (a town) never trips "بحر".
const wordsOf = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// Landmarks → city (+ nearby districts/cities). Keys are pre-flattened (letters only).
const LANDMARKS: { keys: string[]; name: string; city: string; districts?: string[]; cities?: string[] }[] = [
  { keys: ['kingdomtower', 'almamlakahtower'], name: 'Kingdom Tower', city: 'Riyadh', districts: ['Al Olaya'] },
  { keys: ['alfaisaliah', 'faisaliahtower'], name: 'Al Faisaliah', city: 'Riyadh', districts: ['Al Olaya'] },
  { keys: ['kafd', 'kingabdullahfinancialdistrict'], name: 'KAFD', city: 'Riyadh', districts: ['Al Aqiq', 'Hittin'] },
  { keys: ['riyadhpark'], name: 'Riyadh Park', city: 'Riyadh', districts: ['Hittin', 'Al Aqiq', 'Al Malqa'] },
  { keys: ['diriyah', 'addiriyah'], name: 'Diriyah', city: 'Riyadh', districts: ['Al Diriyah', 'Hittin'] },
  { keys: ['diplomaticquarter', 'dpquarter'], name: 'Diplomatic Quarter', city: 'Riyadh', districts: ['As Safarat'] },
  { keys: ['kingkhalidairport', 'kkia'], name: 'King Khalid Airport', city: 'Riyadh', districts: ['Al Qirawan', 'Al Narjis'] },
  { keys: ['kingsauduniversity', 'ksu'], name: 'King Saud University', city: 'Riyadh', districts: ['An Nakhil', 'Al Aqiq'] },
  { keys: ['aramco', 'saudiaramco'], name: 'Aramco', city: 'Dhahran', cities: ['Dhahran', 'Khobar', 'Dammam'] },
  { keys: ['kfupm'], name: 'KFUPM', city: 'Dhahran', cities: ['Dhahran', 'Khobar', 'Dammam'] },
  { keys: ['ithra'], name: 'Ithra', city: 'Dhahran', cities: ['Dhahran', 'Khobar', 'Dammam'] },
  { keys: ['mallofdhahran'], name: 'Mall of Dhahran', city: 'Dhahran', cities: ['Dhahran', 'Khobar'] },
  { keys: ['jeddahcorniche'], name: 'Jeddah Corniche', city: 'Jeddah', districts: ['Ash Shati', 'Al Hamra'] },
  { keys: ['albalad', 'historicjeddah'], name: 'Al-Balad', city: 'Jeddah', districts: ['Al Balad'] },
  { keys: ['kingabdulazizairport', 'kaia'], name: 'King Abdulaziz Airport', city: 'Jeddah', districts: ['Al Naseem', 'Al Sulaymaniyah'] },
  { keys: ['kaust'], name: 'KAUST', city: 'Jeddah', cities: ['Jeddah'] },
  { keys: ['masjidalharam', 'alharam', 'clocktower', 'jabalomar'], name: 'Al-Masjid al-Haram', city: 'Mecca', districts: ['Ajyad', 'Al Aziziyah'] },
  { keys: ['masjidannabawi', 'annabawi', 'quba'], name: 'Al-Masjid an-Nabawi', city: 'Medina', districts: ['Al Haram', 'Quba'] },
  { keys: ['neom', 'theline'], name: 'NEOM', city: 'Tabuk', cities: ['Tabuk'] },
  { keys: ['abhahighcity', 'soudah', 'souda'], name: 'Abha High City', city: 'Abha', cities: ['Abha'] },
];

// Area nicknames → city + the districts that nickname covers.
const NICKNAMES: { keys: string[]; city: string; districts: string[] }[] = [
  { keys: ['northriyadh', 'northernriyadh', 'شمالالرياض'], city: 'Riyadh', districts: ['Al Malqa', 'Hittin', 'Al Yasmin', 'Al Aqiq', 'Al Narjis'] },
  { keys: ['eastriyadh', 'easternriyadh', 'شرقالرياض'], city: 'Riyadh', districts: ['Qurtubah', 'Granada', 'Al Rimal'] },
  { keys: ['westriyadh', 'غربالرياض'], city: 'Riyadh', districts: ['Al Wurud', 'Al Izdihar', 'Irqah'] },
  { keys: ['southriyadh', 'جنوبالرياض'], city: 'Riyadh', districts: ['Al Shifa', 'Al Naseem', 'Al Aziziyah'] },
  { keys: ['centralriyadh', 'وسطالرياض'], city: 'Riyadh', districts: ['Al Olaya', 'Al Malaz', 'Al Murabba'] },
  { keys: ['northjeddah', 'northernjeddah', 'شمالجده'], city: 'Jeddah', districts: ['Ash Shati', 'Obhur', 'Al Hamra'] },
  { keys: ['southjeddah', 'جنوبجده'], city: 'Jeddah', districts: ['Al Faisaliyah', 'Al Aziziyah'] },
];

// Geography cues (whole-word) → a representative city + waterfront/mountain/etc. context.
const GEOGRAPHY: { words: string[]; city: string; cities: string[]; districts: string[]; note: string }[] = [
  { words: ['sea', 'beach', 'coast', 'coastal', 'waterfront', 'seaside', 'seafront', 'corniche', 'بحر', 'البحر', 'شاطئ', 'الشاطئ', 'كورنيش', 'الكورنيش', 'ساحل'], city: 'Jeddah', cities: ['Jeddah', 'Khobar', 'Dammam', 'Yanbu'], districts: ['Ash Shati', 'Obhur'], note: 'Waterfront' },
  { words: ['mountain', 'mountains', 'highland', 'highlands', 'جبل', 'جبال', 'مرتفعات'], city: 'Abha', cities: ['Abha', 'Taif', 'Al Baha'], districts: [], note: 'Mountains' },
  { words: ['desert', 'صحراء'], city: 'Al Kharj', cities: ['Al Kharj', 'Buraidah', 'Hail'], districts: [], note: 'Desert edge' },
];

// Lifestyle cues (whole-word) → fitting districts (default city Riyadh unless one is named).
const LIFESTYLE: { words: string[]; city: string; districts: string[]; note: string }[] = [
  { words: ['family', 'عائلي', 'عائلة'], city: 'Riyadh', districts: ['Al Malqa', 'Al Yasmin', 'Al Narjis', 'Hittin'], note: 'Family' },
  { words: ['luxury', 'upscale', 'فخم', 'راقي'], city: 'Riyadh', districts: ['Al Olaya', 'Hittin'], note: 'Luxury' },
  { words: ['business', 'أعمال'], city: 'Riyadh', districts: ['KAFD', 'Al Olaya'], note: 'Business' },
  { words: ['student', 'طلاب', 'جامعة'], city: 'Riyadh', districts: ['Al Sulaymaniyah', 'Al Malaz'], note: 'Student' },
];

const CITY_TOKENS: [string, string][] = [
  ['riyadh', 'Riyadh'], ['jeddah', 'Jeddah'], ['jiddah', 'Jeddah'], ['makkah', 'Mecca'], ['mecca', 'Mecca'],
  ['madinah', 'Medina'], ['medina', 'Medina'], ['dammam', 'Dammam'], ['khobar', 'Khobar'], ['dhahran', 'Dhahran'],
  ['abha', 'Abha'], ['taif', 'Taif'], ['tabuk', 'Tabuk'], ['yanbu', 'Yanbu'], ['jubail', 'Jubail'],
  ['buraidah', 'Buraidah'], ['hail', 'Hail'], ['najran', 'Najran'], ['jazan', 'Jazan'], ['الرياض', 'Riyadh'],
  ['جده', 'Jeddah'], ['مكه', 'Mecca'], ['المدينه', 'Medina'], ['الدمام', 'Dammam'], ['الخبر', 'Khobar'],
  // Eastern Province cities as first-class search cities (user request).
  ['qatif', 'Qatif'], ['alahsa', 'Al Ahsa'], ['ahsa', 'Al Ahsa'], ['hofuf', 'Al Ahsa'],
  ['ras tanura', 'Ras Tanura'], ['rastanura', 'Ras Tanura'], ['abqaiq', 'Abqaiq'], ['khafji', 'Khafji'], ['nairiyah', 'Nairiyah'],
  ['القطيف', 'Qatif'], ['الاحساء', 'Al Ahsa'], ['الأحساء', 'Al Ahsa'], ['الهفوف', 'Al Ahsa'],
  ['رأس تنورة', 'Ras Tanura'], ['راس تنورة', 'Ras Tanura'], ['بقيق', 'Abqaiq'], ['الخفجي', 'Khafji'], ['النعيرية', 'Nairiyah'],
  // Madinah Region cities as first-class search cities (user request).
  ['madinah', 'Medina'], ['alula', 'AlUla'], ['al ula', 'AlUla'], ['badr', 'Badr'], ['khaybar', 'Khaybar'], ['mahd', 'Al Mahd'], ['henakiyah', 'Al Henakiyah'],
  ['العلا', 'AlUla'], ['بدر', 'Badr'], ['خيبر', 'Khaybar'], ['المهد', 'Al Mahd'], ['مهد الذهب', 'Al Mahd'], ['الحناكية', 'Al Henakiyah'], ['ينبع', 'Yanbu'],
  // Tabuk Region: NEOM (+ sub-zones) and the real coastal cities (user request / implementation note).
  ['neom', 'NEOM'], ['amaala', 'AMAALA'], ['umluj', 'Umluj'], ['al wajh', 'Al Wajh'], ['wajh', 'Al Wajh'], ['haql', 'Haql'],
  ['duba', 'Duba'], ['tayma', 'Tayma'], ['al bad', 'Al Bad'], ['sharma', 'Sharma'], ['maqna', 'Maqna'], ['shura', 'Shura Island'], ['tabuk', 'Tabuk'],
  ['نيوم', 'NEOM'], ['أمالا', 'AMAALA'], ['أملج', 'Umluj'], ['الوجه', 'Al Wajh'], ['حقل', 'Haql'], ['ضباء', 'Duba'], ['تيماء', 'Tayma'], ['البدع', 'Al Bad'], ['شرما', 'Sharma'], ['مقنا', 'Maqna'], ['تبوك', 'Tabuk'],
  // Qassim Region (Buraydah/Buraidah are the same city).
  ['buraydah', 'Buraidah'], ['buraidah', 'Buraidah'], ['unaizah', 'Unaizah'], ['ar rass', 'Ar Rass'], ['al rass', 'Ar Rass'], ['al bukayriyah', 'Al Bukayriyah'], ['al mithnab', 'Al Mithnab'], ['uyun al jiwa', 'Uyun Al Jiwa'],
  ['بريدة', 'Buraidah'], ['عنيزة', 'Unaizah'], ['الرس', 'Ar Rass'], ['البكيرية', 'Al Bukayriyah'], ['المذنب', 'Al Mithnab'], ['رياض الخبراء', 'Riyadh Al Khabra'], ['عيون الجواء', 'Uyun Al Jiwa'], ['البدائع', 'Al Badayea'],
  // Asir Region (Abha/Khamis Mushait via the agent CITIES; add the rest for the filter resolver too).
  ['abha', 'Abha'], ['bisha', 'Bisha'], ['al namas', 'Al Namas'], ['ahad rafidah', 'Ahad Rafidah'], ['rijal almaa', 'Rijal Almaa'], ['rijal alma', 'Rijal Almaa'], ['muhayil', 'Muhayil Aseer'], ['tanomah', 'Tanomah'], ['sarat abidah', 'Sarat Abidah'],
  ['أبها', 'Abha'], ['خميس مشيط', 'Khamis Mushait'], ['بيشة', 'Bisha'], ['النماص', 'Al Namas'], ['أحد رفيدة', 'Ahad Rafidah'], ['رجال ألمع', 'Rijal Almaa'], ['محايل', 'Muhayil Aseer'], ['تنومة', 'Tanomah'],
  // Jazan Region (Jazan itself already above; Farasan Islands is its own search city).
  ['farasan', 'Farasan Islands'], ['sabya', 'Sabya'], ['abu arish', 'Abu Arish'], ['samtah', 'Samtah'], ['baysh', 'Baysh'], ['baish', 'Baysh'], ['al darb', 'Al Darb'], ['al dayer', 'Al Dayer'], ['al aridhah', 'Al Aridhah'], ['ahad al masarihah', 'Ahad Al Masarihah'], ['fayfa', 'Fayfa'], ['damad', 'Damad'],
  ['فرسان', 'Farasan Islands'], ['جزر فرسان', 'Farasan Islands'], ['صبيا', 'Sabya'], ['أبو عريش', 'Abu Arish'], ['سامطة', 'Samtah'], ['بيش', 'Baysh'], ['الدرب', 'Al Darb'], ['الدائر', 'Al Dayer'], ['العارضة', 'Al Aridhah'], ['أحد المسارحة', 'Ahad Al Masarihah'], ['فيفا', 'Fayfa'], ['ضمد', 'Damad'],
  // Al Baha Region (Al Baha itself already above). "العقيق"/"الحجر" intentionally omitted (Riyadh district / Madinah Hegra).
  ['baljurashi', 'Baljurashi'], ['al mikhwah', 'Al Mikhwah'], ['al makhwah', 'Al Mikhwah'], ['al mandaq', 'Al Mandaq'], ['qilwah', 'Qilwah'], ['bani hassan', 'Bani Hassan'],
  ['بلجرشي', 'Baljurashi'], ['المخواة', 'Al Mikhwah'], ['المندق', 'Al Mandaq'], ['قلوة', 'Qilwah'], ['بني حسن', 'Bani Hassan'],
  // Al Jouf Region (Sakaka itself already above).
  ['al qurayyat', 'Al Qurayyat'], ['qurayyat', 'Al Qurayyat'], ['gurayat', 'Al Qurayyat'], ['dumat al jandal', 'Dumat Al Jandal'], ['tabarjal', 'Tabarjal'], ['haditha', 'Haditha'], ['suwayr', 'Suwayr'],
  ['القريات', 'Al Qurayyat'], ['دومة الجندل', 'Dumat Al Jandal'], ['طبرجل', 'Tabarjal'], ['الحديثة', 'Haditha'], ['صوير', 'Suwayr'],
  // Northern Borders Region (Arar itself already above).
  ['rafha', 'Rafha'], ['turaif', 'Turaif'], ['al uwayqilah', 'Al Uwayqilah'], ['jadidat arar', 'Jadidat Arar'],
  ['رفحاء', 'Rafha'], ['طريف', 'Turaif'], ['العويقيلة', 'Al Uwayqilah'], ['جديدة عرعر', 'Jadidat Arar'],
  // Najran Region (Najran itself already above).
  ['sharurah', 'Sharurah'], ['sharorah', 'Sharurah'], ['badr al janoub', 'Badr Al Janoub'], ['habona', 'Habona'], ['khubash', 'Khubash'], ['yadamah', 'Yadamah'],
  ['شرورة', 'Sharurah'], ['بدر الجنوب', 'Badr Al Janoub'], ['حبونا', 'Habona'], ['خباش', 'Khubash'], ['يدمة', 'Yadamah'], ['الوديعة', "Al Wadi'ah"],
  // Riyadh Region governorates (Riyadh V2; Riyadh + Al Kharj already above).
  ['diriyah', 'Diriyah'], ['al majmaah', 'Al Majmaah'], ['majmaah', 'Al Majmaah'], ['zulfi', 'Zulfi'], ['al ghat', 'Al Ghat'], ['thadiq', 'Thadiq'], ['huraymila', 'Huraymila'], ['al muzahimiyah', 'Al Muzahimiyah'], ['al quwayiyah', 'Al Quwayiyah'], ['al dawadmi', 'Al Dawadmi'], ['dawadmi', 'Al Dawadmi'], ['shaqra', 'Shaqra'], ['afif', 'Afif'], ['hotat bani tamim', 'Hotat Bani Tamim'], ['wadi al dawasir', 'Wadi Al Dawasir'], ['al sulayyil', 'Al Sulayyil'],
  ['الدرعية', 'Diriyah'], ['المجمعة', 'Al Majmaah'], ['الزلفي', 'Zulfi'], ['الغاط', 'Al Ghat'], ['ثادق', 'Thadiq'], ['حريملاء', 'Huraymila'], ['المزاحمية', 'Al Muzahimiyah'], ['القويعية', 'Al Quwayiyah'], ['الدوادمي', 'Al Dawadmi'], ['شقراء', 'Shaqra'], ['عفيف', 'Afif'], ['حوطة بني تميم', 'Hotat Bani Tamim'], ['وادي الدواسر', 'Wadi Al Dawasir'], ['السليل', 'Al Sulayyil'],
];
const scopeCity = (f: string): string => { for (const [k, c] of CITY_TOKENS) if (f.includes(k)) return c; return ''; };

export function resolveLocation(input: string, locale: string): LocationResolution {
  const raw = input.trim();
  const base: LocationResolution = { raw, kind: 'none', city: '', label: raw, districts: [], cities: [] };
  if (!raw) return base;
  const f = flatLoc(raw);
  const ws = wordsOf(raw);
  const hasWord = (set: string[]) => set.some((w) => ws.includes(w) || f.includes(w));

  // 1) Landmark phrase (distinctive → recognized before a bare name-match).
  for (const lm of LANDMARKS) if (lm.keys.some((k) => f.includes(k))) {
    return { raw, kind: 'landmark', city: lm.city, label: lm.name, districts: lm.districts ?? [], cities: lm.cities ?? [], landmark: lm.name };
  }
  // 2) Area nickname ("North Riyadh" → its districts).
  for (const nk of NICKNAMES) if (nk.keys.some((k) => f.includes(k))) {
    return { raw, kind: 'area', city: nk.city, label: raw, districts: nk.districts, cities: [] };
  }
  // 3) Real place name (district → city → region) via the nationwide matcher. Tried BEFORE
  //    geography/lifestyle so a genuine place always wins over a loose keyword. Districts rank above
  //    the city in the matcher when the typed name IS a district, satisfying the priority order.
  const hit = matchLocations(raw)[0];
  if (hit) {
    if (hit.kind === 'district') return { raw, kind: 'district', city: ar(locale) ? (hit.cityAr ?? '') : (hit.cityEn ?? ''), label: ar(locale) ? hit.nameAr : hit.nameEn, districts: [], cities: [] };
    if (hit.kind === 'city') return { raw, kind: 'city', city: ar(locale) ? hit.nameAr : hit.nameEn, label: ar(locale) ? hit.nameAr : hit.nameEn, districts: [], cities: [] };
    if (hit.kind === 'region') return { raw, kind: 'region', city: '', label: ar(locale) ? hit.nameAr : `${hit.nameEn} Region`, districts: [], cities: [] };
    // country → fall through to geography/lifestyle/none (it isn't a specific place to anchor on)
  }
  // 4) Geography cue ("near the sea" → coastal city + waterfront districts).
  for (const g of GEOGRAPHY) if (hasWord(g.words)) {
    return { raw, kind: 'geography', city: scopeCity(f) || g.city, label: g.note, districts: g.districts, cities: g.cities, note: g.note };
  }
  // 5) Lifestyle cue.
  for (const ls of LIFESTYLE) if (hasWord(ls.words)) {
    return { raw, kind: 'lifestyle', city: scopeCity(f) || ls.city, label: ls.note, districts: ls.districts, cities: [], note: ls.note };
  }
  return base;
}

// ---------------------------------------------------------------------------------------------
// Display + storage helpers (locale-aware). Centralized so the UI just renders strings.
// ---------------------------------------------------------------------------------------------
const ar = (locale: string) => locale === 'ar';

// The value stored in query.location when a suggestion is picked.
export function placeLabel(p: Place, locale: string): string {
  switch (p.kind) {
    case 'country':
      return ar(locale) ? COUNTRY_AR : COUNTRY_EN;
    case 'region':
      return ar(locale) ? p.nameAr : `${p.nameEn} Region`;
    case 'city':
      return ar(locale) ? p.nameAr : p.nameEn;
    case 'district':
      return ar(locale)
        ? `${p.nameAr}، ${p.cityAr}`
        : `${p.nameEn}, ${p.cityEn}`;
  }
}

// The bold first line in a suggestion row.
export function placeTitle(p: Place, locale: string): string {
  return ar(locale) ? p.nameAr : p.nameEn;
}

// The muted second line in a suggestion row.
export function placeSub(p: Place, locale: string): string {
  switch (p.kind) {
    case 'country':
      return ar(locale) ? 'كل مناطق المملكة' : 'All regions';
    case 'region':
      return ar(locale) ? 'منطقة' : 'Region';
    case 'city':
      return ar(locale) ? (p.regionAr ?? '') : (p.regionEn ?? '');
    case 'district':
      return ar(locale)
        ? `${p.cityAr} · ${p.regionAr}`
        : `${p.cityEn} · ${p.regionEn}`;
  }
}

// Ionicons name for the row's leading icon.
export function placeIcon(p: Place): 'flag' | 'map' | 'business' | 'location' {
  switch (p.kind) {
    case 'country': return 'flag';
    case 'region': return 'map';
    case 'city': return 'business';
    case 'district': return 'location';
  }
}

// Stable React key for a suggestion row. Uses the place's unique id so two same-named districts in
// the same city never collide (which would make React drop one of them from the list).
export function placeKey(p: Place): string {
  return `${p.kind}:${p.id}`;
}

// ---------------------------------------------------------------------------------------------
// Guided-interview location data — separate, hand-curated tree (mirrors the prototype
// LOCATION_TREE). Distinct from the nationwide autocomplete above.
// ---------------------------------------------------------------------------------------------
export const LOCATION_TREE: Record<string, Record<string, string[]>> = {
  Riyadh: {
    North: ['Al Narjis', 'Al Malqa', 'Al Yasmeen', 'Al Qirawan', 'Al Arid', 'Other'],
    East: ['Al Nadhim', 'Al Rimal', 'Al Khaleej', 'Al Rabwah', 'Al Rawabi', 'Other'],
    West: ['Al Wurud', 'Al Sulai', 'Al Rawdah', 'Al Uroubah', 'Al Izdihar', 'Other'],
    South: ['Al Shifa', 'Al Shabah', 'Al Naseem', 'Al Badr', 'Al Salam', 'Other'],
    Central: ['Al Olaya', 'Al Murabbaa', 'Al Malaz', 'Al Wizarat', 'Al Hamra', 'Other'],
  },
  Jeddah: {
    North: ['Al Hamra', 'Al Shati', 'Al Rawdah', 'Al Zahra', 'Al Corniche', 'Other'],
    Central: ['Al Balad', 'Al Sharafiyah', 'Al Andalus', 'Al Nuzha', 'Al Zahraa', 'Other'],
    South: ['Al Safa', 'Al Marwah', 'Al Rehab', 'Al Faisaliyah', 'Al Aziziyah', 'Other'],
  },
  Dammam: {
    North: ['Al Shati', 'Al Faisaliyah', 'Al Aqrabiyah', 'Al Iskan', 'Al Hamra', 'Other'],
    Central: ['Al Muraikabat', 'Al Nuzha', 'Al Aziziyah', 'Al Hamra', 'Al Khalidiyah', 'Other'],
    South: ['Al Jawharah', 'Al Fursan', 'Al Aziziyah', 'Al Badiyah', 'Al Rabi', 'Other'],
  },
  Makkah: {
    Central: ['Al Aziziyah', 'Al Zaher', 'Al Nuzha', 'Ajyad', 'Al Adl', 'Other'],
    North: ['Al Rusaifah', 'Al Shisha', 'Al Kakiyah', 'Al Zaidi', 'Al Hindawiyah', 'Other'],
    South: ['Al Awali', 'Al Mansour', 'Ash Shuhada', 'Al Naseem', 'Al Azhar', 'Other'],
  },
  Madina: {
    Central: ['Al Haram', 'Al Arid', 'Quba', 'Al Nuzha', 'Al Aqiq', 'Other'],
    North: ['Al Rawabi', 'Al Aqoul', 'Al Aziziyah', 'Al Mudhainib', 'Al Ranuna', 'Other'],
    South: ['Al Difa', 'Al Qiblatain', 'Bani Haritha', 'Al Buyutaat', 'Al Khalidiyah', 'Other'],
  },
};

export const INTERVIEW_CITIES = Object.keys(LOCATION_TREE);

// The neighborhood options shown for a city: flatten all regions, drop "Other", dedupe, cap at 8.
export function neighborhoodsFor(city: string): string[] {
  const tree = LOCATION_TREE[city];
  if (!tree) return [];
  const all = ([] as string[]).concat(...Object.values(tree)).filter((h) => h !== 'Other');
  return Array.from(new Set(all)).slice(0, 8);
}
