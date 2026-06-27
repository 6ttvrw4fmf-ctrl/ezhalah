// Location autocomplete for the home filter. As the user types — in English OR Arabic — we surface
// every matching place across the Kingdom: the country itself, an administrative region, a city, or
// a district. The user can pick at any level: "Saudi Arabia" (whole country), a region (e.g. Riyadh
// Region), a city (e.g. Riyadh), or a specific district. The more specific the input, the tighter
// the list. Names come from the official region/city/district dataset (sa-locations.json), Arabic-
// first with English fallbacks. (PRD §5.1, prototype matchLocations — extended to nationwide data.)

import raw from './sa-locations.json';
import { supabase } from '@/lib/supabase';

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

// Homophone / look-alike letter folding — used for FUZZY matching ONLY (never exact lookup), so a
// typist who confuses near-identical Arabic letters still lands on the right place: ص/ث→س, ض/ظ/ذ→ز,
// ط→ت. Built on top of `norm` (which already folds the alef variants, ة→ه, ى/ي→ي). Latin is left
// untouched. Example: "القرص" → "القرس", one edit from "الرس" (Ar Rass) — the typo the user hit.
const fuzzyFold = (s: string) =>
  norm(s).replace(/[صث]/g, 'س').replace(/[ضظذ]/g, 'ز').replace(/ط/g, 'ت');

// Character-bigram Dice coefficient (0…1). Tolerant of length differences and transposed letters in a
// way raw edit distance is not — a useful second opinion when deciding if a typed place ≈ a real one.
function dice(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
    return m;
  };
  const A = grams(a), B = grams(b);
  let inter = 0;
  for (const [g, c] of A) { const d = B.get(g); if (d) inter += Math.min(c, d); }
  return (2 * inter) / ((a.length - 1) + (b.length - 1));
}

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
const MAX_RESULTS = 14; // picker list size — small + clean (was 40, which flooded the dropdown with noise)

// As the user types, surface matching places ranked by how well they match (exact → prefix → typo
// → substring), then by level (country → region → city → district), then by the within-type metric.
// Typo tolerance applies to regions and cities; districts match by prefix/substring only (there are
// thousands). The dropdown scrolls and the list is capped so it never floods.
// Does this catalog place have ANY scraped listing in our DB? Used to rank real places above zero-listing
// catalog entries in the picker — the catalog is the full Saudi hierarchy; the listing DB is a subset.
// (filter location policy: inventory first, but zero-listing places stay selectable below.)
function placeHasInventory(p: Place): boolean {
  switch (p.kind) {
    case 'country':
    case 'region':
      return true; // every region has scraped listings
    case 'city':
      return cityHasListings(p.nameEn);
    case 'district': {
      // Does this catalog district have listings? Match the city by ARABIC (the live index stores the
      // city as an English DB label whose spelling can differ from the catalog's — "Unaizah" vs "Unayzah"
      // — so we map the index city → Arabic via CITY_AR_DISPLAY and compare in Arabic), and the district
      // cross-script (word-aligned Arabic, or English exact). (fix: عنيزة's العليا was wrongly "no inventory".)
      const cityAr = p.cityAr;
      const cityEnK = flatLoc(p.cityEn ?? '');
      const arKey = normDist(p.nameAr);
      const enKey = normDist(p.nameEn);
      for (const d of LIVE_DISTRICTS) {
        const dCityEnK = flatLoc(d.city);
        if (dCityEnK !== cityEnK && CITY_AR_DISPLAY[dCityEnK] !== cityAr) continue;
        const nd = normDist(d.district);
        if ((arKey.length >= 2 && (nd === arKey || districtMatchesProbe(d.district, arKey))) ||
            (enKey.length >= 2 && nd === enKey)) return true;
      }
      return false;
    }
  }
}

// placeHasInventory loops the live index, and matchLocations runs on EVERY keystroke — so memoize it.
// The catalog Place objects are stable singletons (REGIONS/CITIES/DISTRICTS_IDX), so a WeakMap keyed by
// the place is safe; it's reset whenever the live index reloads (ensureLocationIndex). (perf: typing froze.)
let _invMemo = new WeakMap<Place, boolean>();
function placeHasInventoryMemo(p: Place): boolean {
  const cached = _invMemo.get(p);
  if (cached !== undefined) return cached;
  const v = placeHasInventory(p);
  _invMemo.set(p, v);
  return v;
}

export function matchLocations(query: string): Place[] {
  const q = norm(query.trim());
  if (!q) return [];
  // Query variants: raw, article-stripped ("ال"/"al"), district-word-stripped ("حي"/"District"),
  // and both — so "حي شهار", "شهار", "al shati", "shati district" all reach the same place. Deduped.
  const qd = stripDistrictWord(q);
  const qs = [...new Set([q, stripAl(q), qd, stripAl(qd)].filter(Boolean))];
  const fuzzyOk = q.length >= 4;
  const maxDist = q.length >= 6 ? 2 : 1;

  type Hit = { place: Place; type: number; kind: number; metric: number };
  const hits: Hit[] = [];

  const consider = (idx: Indexed, allowFuzzy: boolean) => {
    const sc = scoreKeys(idx.keys, qs, q, allowFuzzy && fuzzyOk, maxDist);
    if (!sc) return;
    hits.push({ place: idx.place, type: sc.type, kind: KIND_RANK[idx.place.kind], metric: sc.metric });
  };

  consider(COUNTRY, false);
  for (const r of REGIONS_IDX) consider(r, true);
  for (const c of CITIES_IDX) consider(c, true);
  for (const d of DISTRICTS_IDX) consider(d, false);

  // Drop FUZZY (typo) matches when the query already hit enough REAL places — they're pure noise then, and
  // they cause wrong resolutions (e.g. "العقيق الرياض" fuzzy-hitting the Asir city "العقيقة", or flooding
  // "الرياض" with الريان/الراس/الرفاع…). Keep fuzzy ONLY when there's little solid signal, so genuine typo
  // recovery ("القرص"→الرس) still works. (picker cleanup + user bug 2026-06-25.)
  const solid = hits.filter((h) => h.type < 4);
  const ranked = solid.length >= 3 ? solid : hits;
  // Rank: best match TYPE first; then INVENTORY (places we have listings for rank above zero-listing
  // catalog entries); then kind (region > city > district); then closeness. placeHasInventory loops the
  // live index, so do a CHEAP sort first (no inventory) and compute inventory ONLY for the top candidates —
  // otherwise a broad one-letter query that matches hundreds of districts froze the picker on every
  // keystroke. The slice is generous (>> MAX_RESULTS) so inventory can still promote within the shortlist.
  ranked.sort((a, b) => a.type - b.type || a.kind - b.kind || a.metric - b.metric);
  const top = ranked.slice(0, Math.max(MAX_RESULTS * 4, 48));
  const inv = new Map<Place, number>();
  for (const h of top) if (!inv.has(h.place)) inv.set(h.place, placeHasInventoryMemo(h.place) ? 0 : 1);
  top.sort((a, b) => a.type - b.type || inv.get(a.place)! - inv.get(b.place)! || a.kind - b.kind || a.metric - b.metric);
  return top.slice(0, MAX_RESULTS).map((h) => h.place);
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
  region?: string;     // canonical region (for the "Region → District" display rule)
  label: string;       // primary matched label (place name, or the area/landmark/geography phrase)
  districts: string[]; // related / nearby districts to display
  cities: string[];    // extra nearby cities (landmark / geography); multi-city ambiguity matches
  landmark?: string;
  note?: string;
  ambiguous?: boolean; // the typed district matched 2+ cities → multi-city search + "refine" notice
  exact?: boolean;     // an EXACT catalog/inventory place (district/city/region), NOT a fuzzy typo guess —
                       // gates the zero-state vs "did you mean": exact + empty = honest zero (no substitute);
                       // fuzzy (a misspelled near-miss) keeps the «هل تقصد…؟» suggestion. (filter location policy)
  fuzzy?: boolean;     // bug-fix #9: a fuzzy-corrected city (e.g. «القرص»→«الرس»). The «هل تقصد X؟»
                       // banner must surface whenever this is set, regardless of whether the corrected
                       // city has listings. Locked rule: fuzzy correction never silently swaps cities.
  // For an AMBIGUOUS twin city/district: the Arabic REGION (twin city) or CITY (twin district) labels of
  // each candidate, parallel to `cities`. The clarifier shows THESE — city display labels are identical
  // for twins («الهفوف»/«الهفوف») so without the region/city distinction the picker dedupes to one blank
  // option. (audit #2: twin clarifier showed no regions.)
  twinRegions?: string[];
  // The bare token is BOTH a region name AND a city name (الرياض/جازان/تبوك/حائل/نجران/الباحة/الجوف).
  // The UI must ask «تقصد مدينة X ولا منطقة X؟» before searching — never silently default to the city.
  // (audit #4: region-vs-city same-name silently defaulted to city.)
  regionOrCity?: boolean;
  // A geography cue (sea/mountain/desert) with NO city in the input. We must NOT auto-pick a default
  // city — ask «تقصد في أي مدينة أو منطقة؟». `cities` carries suggested coastal/mountain cities only as
  // options, never an auto-search. (audit #12: «قريب من البحر» silently became Jeddah.)
  needsCity?: boolean;
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

// ── LIVE district index (read-time merge: catalog + real listing districts) ──────────────────────
// The static catalog (sa-locations.json) misses districts that exist in real listings (e.g. "Al Doha
// Dist." in Yanbu). We load the DB's `location_index` materialized view once per session and merge it
// in, so any district that actually has inventory is recognized + narrowable. (user: DB is the source
// of truth; every district stored must be searchable.)
type LiveDistrict = { district: string; city: string; region: string; n: number };
type LiveCity = { city: string; region: string; n: number };
let LIVE_DISTRICTS: LiveDistrict[] = [];
// Distinct cities that actually have inventory, with their region + listing count. This is the
// AUTHORITATIVE city→region source (the catalog can be stale; the DB is the source of truth) and the
// target set for fuzzy city correction ("القرص"→Ar Rass, "jedah"→Jeddah). (user: DB is the truth.)
let LIVE_CITIES: LiveCity[] = [];
let _liveLoaded = false;
let _livePromise: Promise<void> | null = null;

export async function ensureLocationIndex(): Promise<void> {
  if (_liveLoaded || !supabase) return;
  if (_livePromise) return _livePromise;
  _livePromise = (async () => {
    try {
      const { data } = await supabase.from('location_index').select('city,district,region,n');
      if (data) {
        LIVE_DISTRICTS = data.filter((r: any) => r.city && r.district) as LiveDistrict[];
        // City→region aggregation over EVERY row (a city counts even where its district is null), so
        // any city with listings resolves and carries its real region.
        const agg = new Map<string, LiveCity>();
        for (const r of data as any[]) {
          if (!r.city || r.city === 'Other') continue;
          const e = agg.get(r.city) ?? { city: r.city, region: r.region ?? '', n: 0 };
          e.n += Number(r.n) || 0;
          if (!e.region && r.region) e.region = r.region;
          agg.set(r.city, e);
        }
        LIVE_CITIES = [...agg.values()];
        _cityKeys = null; // rebuild the fuzzy-city index now that live cities are loaded
        _invMemo = new WeakMap(); // recompute inventory against the fresh index
      }
      _liveLoaded = true;
    } catch { /* keep the catalog-only resolver as fallback */ }
  })();
  return _livePromise;
}

// The region a canonical (English) city sits in — live index first (truth), catalog as fallback.
function regionForCity(city: string): string {
  const lc = city.toLowerCase();
  for (const v of LIVE_CITIES) if (v.city.toLowerCase() === lc) return v.region;
  const cc = CITIES_IDX.find((c) => c.place.nameEn.toLowerCase() === lc);
  return cc?.place.regionEn ?? '';
}

// Expand a REGION name → its canonical DB region value + the list of cities it contains, read straight
// from the live index (LIVE_CITIES holds every city-with-inventory and its region). Used so a region
// search resolves to "all cities in that region" without any region→city map to maintain. The catalog
// region name can differ slightly from the DB value ("Bahah"→"Al Bahah", "Jawf"→"Al Jawf"), so we match
// exact-or-contains. (user: "Region search = all listings in that region.")
function citiesInRegion(regionName: string): { region: string; cities: string[] } {
  const want = (regionName || '').trim().toLowerCase();
  if (!want) return { region: '', cities: [] };
  // pick the index's region value that matches (exact, or one contains the other — handles Al Bahah/Bahah)
  let region = '';
  for (const v of LIVE_CITIES) {
    const rl = v.region.toLowerCase();
    if (rl === want || rl.includes(want) || want.includes(rl)) { region = v.region; break; }
  }
  if (!region) return { region: '', cities: [] };
  const cities = Array.from(new Set(LIVE_CITIES.filter((v) => v.region === region).map((v) => v.city)));
  return { region, cities };
}

// Top-K cities in a region BY REAL INVENTORY — for the agent's "whole region or a specific city?"
// clarifier, so the suggested cities are ones we actually have listings in. (user: name real cities.)
export function topCitiesInRegion(regionName: string, k = 2): string[] {
  const want = (regionName || '').trim().toLowerCase();
  if (!want) return [];
  let region = '';
  for (const v of LIVE_CITIES) { const rl = v.region.toLowerCase(); if (rl === want || rl.includes(want) || want.includes(rl)) { region = v.region; break; } }
  if (!region) return [];
  return LIVE_CITIES.filter((v) => v.region === region && v.n > 0).sort((a, b) => b.n - a.n).slice(0, k).map((v) => v.city);
}

// The locale-appropriate display name for a canonical (English) city — Arabic from the catalog when we
// have it, else the canonical English. Used so a fuzzy-corrected city shows in the user's language.
// Authoritative DB-city-label → Arabic (mirrors the DB loc_city_map / remote.ts CITY_AR). The catalog's
// English spelling often differs from the DB label ("Al Hafuf" vs "Hofuf", "Makkah" vs "Mecca"), so the
// catalog lookup below MISSES those and they used to leak English into the Arabic UI. Keyed lowercase.
const CITY_AR_DISPLAY: Record<string, string> = {
  'abha': 'أبها', 'abqaiq': 'بقيق', 'abu arish': 'أبو عريش', 'afif': 'عفيف', 'ahad al masarihah': 'أحد المسارحة',
  'ahad rafidah': 'أحد رفيدة', 'al ammariyah': 'العمارية', 'al aqiq': 'العقيق', 'al badai': 'البدائع', 'al badaie': 'البدائع',
  'al baha': 'الباحة', 'al bahah': 'الباحة', 'al birk': 'البرك', 'al bukayriyah': 'البكيرية', 'al dalam': 'الدلم',
  'al ghat': 'الغاط', 'al ghazalah': 'الغزالة', 'al hanakiyah': 'الحناكية', 'al hariq': 'الحريق', 'al hayathim': 'الهياثم',
  'al jumum': 'الجموم', 'al kamil': 'الكامل', 'al kharj': 'الخرج', 'al khurma': 'الخرمة', 'al lith': 'الليث',
  'al majardah': 'المجاردة', 'al majmaah': 'المجمعة', 'al mithnab': 'المذنب', 'al muzahimiyah': 'المزاحمية', 'al namas': 'النماص',
  'al qunfudhah': 'القنفذة', 'al quwayiyah': 'القويعية', 'al ula': 'العلا', 'al uyun': 'العيون', 'al wajh': 'الوجه',
  'al zulfi': 'الزلفي', 'an nabhaniyah': 'النبهانية', 'an nairyah': 'النعيرية', 'anak': 'عنك', 'ar rass': 'الرس',
  'arar': 'عرعر', 'as sulayyil': 'السليل', 'ash shamasiyah': 'الشماسية', 'ash shanan': 'الشنان', 'badr': 'بدر',
  'balsamar': 'بلسمر', 'baqaa': 'بقعاء', 'baysh': 'بيش', 'bish': 'بيش', 'bisha': 'بيشة', 'buraidah': 'بريدة',
  'dammam': 'الدمام', 'dawadmi': 'الدوادمي', 'dawmat al jandal': 'دومة الجندل', 'dhahran': 'الظهران',
  'dhahran al janub': 'ظهران الجنوب', 'diriyah': 'الدرعية', 'duba': 'ضباء', 'hafar al batin': 'حفر الباطن', 'hail': 'حائل',
  'hawtat bani tamim': 'حوطة بني تميم', 'hofuf': 'الهفوف', 'jazan': 'جازان', 'jeddah': 'جدة', 'jubail': 'الجبيل',
  'kaec': 'مدينة الملك عبدالله الاقتصادية', 'khafji': 'الخفجي', 'khamis mushait': 'خميس مشيط', 'khaybar': 'خيبر',
  'khobar': 'الخبر', 'mahayel': 'محايل عسير', 'mahd adh dhahab': 'مهد الذهب', 'malham': 'ملهم', 'mecca': 'مكة المكرمة',
  'medina': 'المدينة المنورة', 'najran': 'نجران', 'qatif': 'القطيف', 'qurayyat': 'القريات', 'rabigh': 'رابغ',
  'rafha': 'رفحاء', 'raniyah': 'رنية', 'ras tanura': 'رأس تنورة', 'riyadh': 'الرياض', 'riyadh al khabra': 'رياض الخبراء',
  'rumah': 'رماح', 'sabya': 'صبيا', 'safwa': 'صفوى', 'sakaka': 'سكاكا', 'samtah': 'صامطة', 'sayhat': 'سيهات',
  'shaqra': 'شقراء', 'sharurah': 'شرورة', 'tabuk': 'تبوك', 'taif': 'الطائف', 'tarout': 'تاروت', 'tathleeth': 'تثليث',
  'tathlith': 'تثليث', 'tayma': 'تيماء', 'thadiq': 'ثادق', 'thuwal': 'ثول', 'turabah': 'تربة', 'turaif': 'طريف',
  'umluj': 'أملج', 'unaizah': 'عنيزة', 'yanbu': 'ينبع',
};
export function cityDisplay(cityEn: string, locale: string): string {
  if (!ar(locale)) return cityEn;
  // Authoritative DB-label map first (covers the aliased cities the catalog spells differently).
  const direct = CITY_AR_DISPLAY[cityEn.trim().toLowerCase()];
  if (direct) return direct;
  const cc = CITIES_IDX.find((c) => c.place.nameEn.toLowerCase() === cityEn.toLowerCase());
  if (cc?.place.nameAr) return cc.place.nameAr;
  // Catalog miss → the curated CITY_TOKENS map carries Arabic spellings for the long tail of towns.
  for (const [k, c] of CITY_TOKENS) if (c === cityEn && /[ء-ي]/.test(k)) return k;
  return cityEn;
}

// ── Fuzzy CITY index (typo/Arabic correction) ────────────────────────────────────────────────────
// Every way a city can be written → its canonical English DB label: the curated CITY_TOKENS map
// (Arabic + transliterations for ~150 towns), the nationwide catalog (EN + AR), and the live cities.
// Rebuilt when the live index loads. Each entry caches a homophone-folded key for fuzzy comparison.
type CityKey = { key: string; fold: string; city: string };
let _cityKeys: CityKey[] | null = null;
function cityKeys(): CityKey[] {
  if (_cityKeys) return _cityKeys;
  const out: CityKey[] = [];
  const seen = new Set<string>();
  const add = (rawName: string, city: string) => {
    const k = norm(rawName);
    if (k.length < 3) return;
    const sig = `${k}|${city}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push({ key: k, fold: fuzzyFold(rawName), city });
  };
  for (const [k, c] of CITY_TOKENS) add(k, c);
  for (const c of CITIES_IDX) { add(c.place.nameEn, c.place.nameEn); add(c.place.nameAr, c.place.nameEn); }
  for (const lc of LIVE_CITIES) add(lc.city, lc.city);
  _cityKeys = out;
  return out;
}

// Best fuzzy city match for a typed/parsed location, or null. Pure typo correction — exact/substring
// city resolution is handled upstream; this is the last resort BEFORE a "couldn't find it" so a near
// miss ("القرص"≈الرس, "khubar"≈Khobar) still finds real inventory instead of dead-ending. Requires a
// shared first letter + a small edit distance (scaled by length), or a high Dice overlap; never a
// loose guess (precision matters — we must not show the WRONG city's cards). (user: match or say none.)
function fuzzyCity(raw: string): { city: string; region: string } | null {
  const q = norm(raw);
  if (q.length < 4) return null; // too short to correct safely
  const qf = fuzzyFold(raw);
  // STRICT thresholds (post «ذبحة»→«أبها» bug, 2026-06-26): rely on EDIT DISTANCE only — that's what
  // a "typo" actually is. Drop the loose Dice-OR-ed-OR fallback that previously let «ذبحة» (ed=3 to
  // «أبها», Dice tiny — clearly different words) substitute «أبها» on a generous Dice threshold.
  // Real typos like «القرص»→«الرس» have ed=1 and pass cleanly under ed alone. Locked rule: never
  // silently substitute one catalog city for another.
  //   • exact folded match → return immediately
  //   • else require shared first letter + length within ±1 + ed ≤ maxD (small)
  //   • Dice is only a tie-breaker, never a sole acceptance signal
  const maxD = qf.length <= 4 ? 1 : qf.length <= 7 ? 2 : 3;
  let best: { city: string; ed: number; d: number } | null = null;
  for (const ck of cityKeys()) {
    if (ck.key === q) return { city: ck.city, region: regionForCity(ck.city) }; // exact (folded earlier)
    if (ck.fold[0] !== qf[0]) continue; // shared first letter REQUIRED
    if (Math.abs(ck.fold.length - qf.length) > 1) continue; // length within ±1 (different-length = different word)
    const ed = editDistance(ck.fold, qf);
    if (ed > maxD) continue; // ed is the only acceptance gate
    const d = dice(ck.fold, qf);
    if (!best || ed < best.ed || (ed === best.ed && d > best.d)) best = { city: ck.city, ed, d };
  }
  return best ? { city: best.city, region: regionForCity(best.city) } : null;
}

// Detect an EXPLICITLY-named city anywhere in a free-typed location — for "District, City" / "حي X،
// المدينة" phrases where norm() glues the words so matchLocations misses the city. Scans the FULL
// city-key set (catalog EN+AR + curated tokens + live cities), which is far more complete than the
// curated CITY_TOKENS the old scopeCity used — e.g. it knows "الظهران" = Dhahran from the catalog.
// Longest key wins (most specific) and the key must be shorter than the whole input (a bare city is a
// city search, handled elsewhere). Returns { city, key } or null. (user: "…، الظهران" must scope to Dhahran.)
function cityInInput(raw: string): { city: string; key: string } | null {
  const q = norm(raw);
  if (q.length < 5) return null;
  let best: { city: string; key: string } | null = null;
  let bestLen = 0;
  for (const ck of cityKeys()) {
    if (ck.key.length < 4 || ck.key.length <= bestLen || ck.key.length >= q.length) continue;
    if (q.includes(ck.key)) { best = { city: ck.city, key: ck.key }; bestLen = ck.key.length; }
  }
  return best;
}

// Does a canonical (English) city actually have live inventory? Used to decide whether a 0-result
// search is "this city is empty / obscure" vs "the filters were too tight on a busy city".
export function cityHasListings(cityEn: string): boolean {
  const lc = (cityEn || '').toLowerCase();
  return LIVE_CITIES.some((v) => v.city.toLowerCase() === lc && v.n > 0);
}

// A close city that DOES have inventory and the user might have meant — to offer an honest "did you
// mean X?" when the place they named is real but empty (e.g. "القرص" = Al Qars, Tabuk, 0 listings; the
// likely intent is "الرس" = Ar Rass, Qassim, 213). We SUGGEST a real alternative, never silently swap
// it in — the database is still the source of truth. (user: don't dead-end; propose a place with data.)
export function nearbyCityWithListings(raw: string, excludeCityEn?: string): { cityEn: string; region: string; n: number } | null {
  const q = norm(raw);
  if (q.length < 4) return null;
  const qf = fuzzyFold(raw);
  const maxD = qf.length <= 4 ? 1 : qf.length <= 7 ? 2 : 3;
  const ex = (excludeCityEn || '').toLowerCase();
  const keys = cityKeys();
  let best: { cityEn: string; region: string; n: number; ed: number } | null = null;
  for (const lc of LIVE_CITIES) {
    if (lc.n <= 0 || lc.city.toLowerCase() === ex) continue;
    let bestEd = 99;
    for (const ck of keys) {
      if (ck.city.toLowerCase() !== lc.city.toLowerCase() || ck.fold[0] !== qf[0]) continue;
      bestEd = Math.min(bestEd, editDistance(ck.fold, qf));
    }
    // Fallback: some live cities have no curated spelling key — compare the city's own English name.
    const lf = fuzzyFold(lc.city);
    if (lf[0] === qf[0]) bestEd = Math.min(bestEd, editDistance(lf, qf));
    if (bestEd > maxD) continue;
    if (!best || bestEd < best.ed || (bestEd === best.ed && lc.n > best.n)) best = { cityEn: lc.city, region: lc.region, n: lc.n, ed: bestEd };
  }
  return best ? { cityEn: best.cityEn, region: best.region, n: best.n } : null;
}

// Normalize a district string for matching. flatLoc already lowercases + strips spaces/diacritics/
// punctuation, so we remove the "district"/"dist"/"neighborhood"/"حي" MARKERS as substrings. So
// "Al Doha District" ~ "Al Doha Dist." ~ "حي الدوحة" compare equal-ish. (Don't strip "al" — it would
// corrupt names like "Al Salam"/"السلام".)
function normDist(s: string): string {
  return flatLoc(s)
    .replace(/district/g, '')
    .replace(/neighbou?rhood/g, '')
    .replace(/dist/g, '')
    .replace(/الحي/g, '')
    .replace(/حي/g, '');
}

// Whole-WORD (word-aligned) probe match: the probe must equal a CONTIGUOUS run of WHOLE words of the
// district name — NOT a loose substring/prefix. So «البلد» matches «حي البلد», «العليا الرياض» (city
// noise) and the glued English «albalad» vs «Al Balad Dist.», but NEVER «حي البلدية» / «محاسن البلدية»
// where «البلد» is only a PREFIX of the longer word «البلدية». (fix: «حي البلد» wrongly pulled البلدية in
// الهفوف/حفر الباطن — a different neighbourhood — because of substring matching.)
function districtMatchesProbe(district: string, probe: string): boolean {
  if (!probe) return false;
  const words = district
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => flatLoc(w).replace(/district|dist|neighbou?rhood/g, ''))
    .filter((w) => w.length >= 2 && !DISTRICT_WORD.has(w) && w !== 'الحي');
  for (let i = 0; i < words.length; i++) {
    let acc = '';
    for (let j = i; j < words.length; j++) {
      acc += words[j];
      if (acc === probe) return true;
      if (acc.length >= probe.length) break; // longer than the probe → this run can't equal it
    }
  }
  return false;
}

// Cross-script district bridge, built once from the catalog's en↔ar district pairs: a normalized
// district name in ONE script → its equivalent forms in the OTHER. Lets an English query ("Al Olaya")
// match Arabic-tagged live districts ("حي العليا") and vice-versa — without it, the 106 Arabic-tagged
// Al-Olaya Buy listings were invisible to a Latin search (user: "only 5? are you sure?").
let _distBridge: Map<string, Set<string>> | null = null;
function districtBridge(): Map<string, Set<string>> {
  if (_distBridge) return _distBridge;
  const m = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!a || !b || a === b || a.length < 3 || b.length < 3) return;
    if (!m.has(a)) m.set(a, new Set());
    m.get(a)!.add(b);
  };
  for (const d of DISTRICTS_IDX) {
    const en = normDist(d.place.nameEn), ar = normDist(d.place.nameAr);
    link(en, ar); link(ar, en);
  }
  _distBridge = m;
  return m;
}

// Find live districts matching the typed input. The district "probe" is the input with the named city
// removed — so "Al Doha District, Yanbu" probes "al doha" (not the city). A bare city name probes to
// empty → no district match (stays a city search). When a city is named we scope to it; otherwise a
// district name shared by several cities returns all of them (the ambiguity case).
function liveDistrictLookup(raw: string): LiveDistrict[] {
  if (!LIVE_DISTRICTS.length) return [];
  const cityHit = matchLocations(raw).find((p) => p.kind === 'city');
  let cityKey = cityHit ? flatLoc(cityHit.nameEn) : '';
  let cityKeyAr = cityHit ? flatLoc(cityHit.nameAr) : '';
  let probe = normDist(raw);
  // A "District, City" / "حي X، المدينة" phrase glues into one token (norm strips spaces/commas), so
  // matchLocations usually MISSES the city. Fall back to a substring city-token scan (scopeCity) so an
  // EXPLICITLY-named city scopes the search to itself instead of going ambiguous across the Kingdom.
  // (user bug: "Al Olaya District, Riyadh" returned Riyadh+Mecca+Khobar+Jeddah and a non-Olaya Mecca land.)
  if (!cityKey) {
    const ci = cityInInput(raw); // full catalog/live scan — knows Arabic city names the tokens miss
    if (ci) {
      cityKey = flatLoc(ci.city);
      // Strip the matched city token + its English name from the probe so it doesn't bloat (a long probe
      // inflates the fuzzy edit-distance budget and over-matches unrelated districts).
      probe = probe.replace(ci.key, '').replace(flatLoc(ci.city), '');
    }
  }
  if (cityKey) probe = probe.replace(cityKey, '');
  if (cityKeyAr) probe = probe.replace(cityKeyAr, '');
  if (probe.length < 2) return []; // input is just a city (or nothing district-specific)
  // Add the OTHER-script equivalents of the probe so a Latin query reaches Arabic-tagged districts and
  // vice-versa (the catalog provides the en↔ar pairing). (user: Al Olaya missed its Arabic listings.)
  const probeAlts = [probe, ...(districtBridge().get(probe) || [])];
  const probeF = fuzzyFold(probe);
  // Fuzzy-match the probe against the WORDS of a district name (not just the glued whole), so a typo'd
  // or partial district token still hits — "Rakk" ≈ the "Rakah" in "Al Rakah Al Shamaliyah". Shared
  // first letter + a small edit distance keeps it tight. CAP at 2: editDistance() returns 3 as its
  // "too different" sentinel (length diff > 2), so a budget of 3 would let unrelated tokens through.
  const tokenMaxD = probeF.length <= 3 ? 1 : 2;
  const fuzzyTokenHit = (district: string): boolean => {
    if (probeF.length < 4) return false;
    for (const tok of district.split(/[^\p{L}\p{N}]+/u)) {
      const tf = fuzzyFold(tok);
      if (tf.length < 4 || ARTICLE.has(tf) || DISTRICT_WORD.has(tf)) continue;
      if (tf === probeF) return true;
      // Typo recovery: same first letter, SIMILAR length (±1), small edit distance. The length guard
      // stops a longer DIFFERENT word from passing as a typo — «البلد»(5) vs «البلدية»(7) is a +2 suffix,
      // a different word, not a typo, so it must NOT match. (paired with the word-aligned exact match.)
      if (tf[0] === probeF[0] && Math.abs(tf.length - probeF.length) <= 1 && editDistance(tf, probeF) <= tokenMaxD) return true;
    }
    return false;
  };
  const out: LiveDistrict[] = [];
  for (const d of LIVE_DISTRICTS) {
    const nd = normDist(d.district);
    if (nd.length < 2) continue;
    // Arabic-first, SAME rule as the picker (rawDistrictVariants): the raw value must CONTAIN a probe
    // (probeAlts already include the cross-script ARABIC equivalent of an English probe, so an English
    // query is matched on its Arabic form) OR fuzzy-match a word (typo recovery). Do NOT match the
    // reverse (probe contains raw) — that let a long English probe pull a SHORTER, different district
    // ("assafarat" ⊃ "assafa"). Raw Arabic is the source of truth; English is a helper alias. (user.)
    if (!(probeAlts.some((p) => districtMatchesProbe(d.district, p)) || fuzzyTokenHit(d.district))) continue;
    if (cityKey) {
      // Bug-fix #11 (audit `liveDistrictLookup-canonical-mismatch`): the live index stores d.city in
      // English DB labels while the picker / catalog may pass cityKeyAr in Arabic. Route through
      // CITY_AR_DISPLAY so an English raw city compares correctly against the Arabic catalog city
      // (mirrors rawDistrictVariants' check at line 881). Without this, picker-chosen Arabic cities
      // failed to match their English-labelled live districts → districts dropped silently.
      const dc = flatLoc(d.city);
      const dcAr = CITY_AR_DISPLAY[dc] || '';
      if (dc !== cityKey && dc !== cityKeyAr && flatLoc(dcAr) !== cityKeyAr) continue;
    }
    out.push(d);
  }
  out.sort((a, b) => b.n - a.n); // strongest (most listings) first
  return out;
}

// PICKER → RAW bridge. Given a CLEAN catalog place (from sa-locations.json) the user picked in the
// filter, return every RAW district spelling for it that actually exists in the listing index — so the
// search covers ALL variants at once. Example: catalog "Al Olaya" (Riyadh) → ["حي العليا","Al-Olaya",
// "Al Olaya","Al Olaya Dist.","العليا","العليا الرياض",…] (7 spellings / ~562 listings, otherwise split).
// The GitHub catalog controls what the user SEES; this controls what the app SEARCHES. Raw values stay
// untouched. EXACT/substring match only (no fuzzy — the catalog name is exact) so a neighbouring district
// like "حي عليشة" is never pulled in. City-scoped (a famous district name can exist in several cities).
// Used by both the filter picker and — via resolveLocation — the AI agent, so they share one mapping.
export function rawDistrictVariants(place: Place): string[] {
  if (place.kind !== 'district' || !LIVE_DISTRICTS.length) return [];
  const cityKeys = [flatLoc(place.cityEn ?? ''), flatLoc(place.cityAr ?? '')].filter(Boolean);
  const cityArName = place.cityAr ?? ''; // also match the live index's English city label by its Arabic
                                         // mapping (catalog "Al Khobar" vs index "Khobar"). (transliteration)
  // ARABIC is the canonical matching KEY — the platforms and the GitHub catalog are Arabic-first, and
  // English transliterations are inconsistent. The Arabic name matches EXACT, or when the raw value
  // carries city/marker noise ("العليا الرياض" ⊇ "العليا"). The English name is ONLY an EXACT alias —
  // it recovers English-TAGGED raw rows ("Al-Olaya") but NEVER matches by loose substring, which is what
  // wrongly pulled a different district ("Assafarat" ⊃ "As-Safa"). (user: Arabic is the source of truth.)
  const arKey = normDist(place.nameAr);
  const enKey = normDist(place.nameEn);
  if (arKey.length < 2 && enKey.length < 2) return [];
  const out = new Set<string>();
  for (const d of LIVE_DISTRICTS) {
    const dCityK = flatLoc(d.city);
    if (cityKeys.length && !cityKeys.includes(dCityK) && CITY_AR_DISPLAY[dCityK] !== cityArName) continue;
    const nd = normDist(d.district);
    if (nd.length < 2) continue;
    const arHit = arKey.length >= 2 && (nd === arKey || districtMatchesProbe(d.district, arKey)); // Arabic: exact OR word-aligned (raw + city noise), never a prefix of a longer word («البلد» ≠ «البلدية»)
    const enHit = enKey.length >= 2 && nd === enKey;                          // English: EXACT alias only
    if (arHit || enHit) out.add(d.district);
  }
  return [...out];
}

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
  // 2.3) "منطقة X" — an explicit REGION pick (the picker's region label, or a typed "منطقة الرياض"). Resolve
  //      X to its REGION and search the WHOLE region — NEVER a district. Region names that are ALSO city
  //      names ("منطقة الرياض" / "منطقة تبوك" / "منطقة مكة") otherwise fall into the live-district merge below
  //      and over-match dozens of districts (منطقة الرياض → 40 districts). Must run BEFORE that merge.
  //      (user: selecting a region searches the whole region and never auto-attaches a district.)
  const regM = /^\s*منطقة\s+(.+)$/.exec(raw);
  if (regM) {
    const rHit = matchLocations(regM[1].trim()).find((p) => p.kind === 'region');
    if (rHit) {
      const rr = citiesInRegion(rHit.nameEn);
      return { raw, kind: 'region', city: '', region: rr.region || undefined, label: ar(locale) ? rHit.nameAr : `${rHit.nameEn} Region`, districts: [], cities: rr.cities, exact: true };
    }
  }
  // 2.5) "District، City" — the picker's OWN label format (nameAr، cityAr) and Gemini's "حي العليا، الرياض".
  //      Re-resolving such a label as one string is lossy: the city token ("الرياض") bloats the district
  //      probe and over-matches the city-noise in raw district strings, and the district name can collide
  //      with a spurious catalog "city". So split on the comma and resolve the DISTRICT part scoped EXACTLY
  //      to the named CITY. (user bug 2026-06-25: picking the "حي الملقا" suggestion re-resolved to العليا /
  //      الملز / الملك فهد / جامعة الملك سعود instead of الملقا.)
  const cp = raw.split(/[،,]/).map((s) => s.trim()).filter(Boolean);
  if (cp.length >= 2) {
    const cityM = matchLocations(cp[cp.length - 1]).find((p) => p.kind === 'city');
    const distM = matchLocations(cp[0]).find((p) => p.kind === 'district');
    if (cityM && distM) {
      const scoped: Place = { ...distM, cityEn: cityM.nameEn, cityAr: cityM.nameAr, regionEn: cityM.regionEn, regionAr: cityM.regionAr };
      const variants = rawDistrictVariants(scoped);
      if (variants.length) {
        return { raw, kind: 'district', city: cityM.nameEn, region: cityM.regionEn, label: ar(locale) ? distM.nameAr : distM.nameEn, districts: variants, cities: [], exact: true };
      }
    }
  }
  // 3) Real place name (district → city → region) via the nationwide matcher. Tried BEFORE
  //    geography/lifestyle so a genuine place always wins over a loose keyword. Districts rank above
  //    the city in the matcher when the typed name IS a district, satisfying the priority order.
  const hit = matchLocations(raw)[0];
  // A catalog DISTRICT wins (clean names + region context).
  if (hit && hit.kind === 'district') {
    // Bare-district ambiguity: if this district name recurs across SEVERAL cities in real inventory and
    // the user did NOT pin a city, ASK which city (inventory-first) instead of silently picking the
    // biggest. liveDistrictLookup already scopes to a city the user named — so «الروضة، جدة» stays
    // single-city while a bare «الروضة» surfaces the multi-city options. (user: ask «تقصد… الرياض أو جدة؟».)
    const liveCat = liveDistrictLookup(raw);
    if (liveCat.length) {
      const byCity = new Map<string, { region: string; n: number }>();
      for (const d of liveCat) { const e = byCity.get(d.city) ?? { region: d.region, n: 0 }; e.n += d.n; byCity.set(d.city, e); }
      const entries = Array.from(byCity.entries()).sort((a, b) => b[1].n - a[1].n);
      const maxN = entries[0][1].n;
      const strong = entries.filter(([, e]) => e.n >= Math.max(3, maxN * 0.15)).slice(0, 6);
      if (strong.length >= 2) {
        // Multi-city → the engine searches ALL `cities` (+ "multiple locations" notice) and the agent's
        // deterministic backstop asks «أي مدينة؟», listing these cities inventory-first.
        const allDistricts = Array.from(new Set(liveCat.map((d) => d.district)));
        return { raw, kind: 'district', city: strong[0][0], region: strong[0][1].region, label: ar(locale) ? hit.nameAr : hit.nameEn, districts: allDistricts, cities: strong.map(([c]) => c), ambiguous: true, exact: true };
      }
    }
    // Single, unambiguous district. city/region are ENGINE-FACING (the engine's cityFilterFor only
    // understands the English DB labels) → always canonical English; `label` carries the locale display.
    // GitHub catalog controls the clean name SHOWN; the raw listing index controls what's SEARCHED:
    // expand the picked clean district to EVERY raw spelling that actually exists (حي العليا / Al-Olaya
    // / Al Olaya Dist. / …) so one tidy pick returns all variants across all platforms. Arabic-primary
    // (rawDistrictVariants probes the catalog's Arabic name first). Empty → store falls back to the label.
    return { raw, kind: 'district', city: hit.cityEn ?? '', region: hit.regionEn, label: ar(locale) ? hit.nameAr : hit.nameEn, districts: rawDistrictVariants(hit), cities: [], exact: true };
  }
  // 3b) LIVE district merge — a district that exists in real inventory but NOT the static catalog
  //     (e.g. "Al Doha Dist." in Yanbu). Beats a bare city match so the typed district actually
  //     narrows. One city → district scope; 2+ cities → multi-city ambiguity (search all + notice).
  const live = liveDistrictLookup(raw);
  if (live.length) {
    // Aggregate the matched districts BY CITY (a famous district like "Al Olaya" exists in several
    // cities AND is fragmented across spelling variants — Al-Olaya / Al Olaya / Al Olaya Dist. — so we
    // must sum per city, not pick the single biggest row, or Khobar's one big row beats Riyadh's split
    // total). Keep only HIGH-CONFIDENCE cities (≥15% of the top city, max 6) so tiny 1-2 listing
    // coincidental matches don't dilute. (user: search all high-confidence matches; rank by intent.)
    const byCity = new Map<string, { region: string; n: number; districts: Set<string> }>();
    for (const d of live) {
      const e = byCity.get(d.city) ?? { region: d.region, n: 0, districts: new Set<string>() };
      e.n += d.n; e.districts.add(d.district);
      byCity.set(d.city, e);
    }
    const entries = Array.from(byCity.entries()).sort((a, b) => b[1].n - a[1].n);
    const maxN = entries[0][1].n;
    const strong = entries.filter(([, e]) => e.n >= Math.max(3, maxN * 0.15)).slice(0, 6);
    const allDistricts = Array.from(new Set(live.map((d) => d.district)));
    if (strong.length === 1) {
      const [cityName, e] = strong[0];
      return { raw, kind: 'district', city: cityName, region: e.region, label: Array.from(e.districts)[0], districts: Array.from(e.districts), cities: [], exact: true };
    }
    // Multi-city ambiguity → the engine searches ALL `cities` + shows the "multiple locations" notice.
    return { raw, kind: 'district', city: strong[0][0], region: strong[0][1].region, label: raw, districts: allDistricts, cities: strong.map(([c]) => c), ambiguous: true, exact: true };
  }
  if (hit) {
    if (hit.kind === 'city') {
      // Bug-fix #3 (audit `resolver-no-twin-ambiguity-branch`): the catalog has ~300 city-name groups
      // that repeat across regions (e.g. «الهفوف» Eastern + Riyadh hamlet, «بيش» Asir + Jazan). If the
      // user typed the bare city name with NO region hint, the resolver previously silently picked
      // matchLocations()[0] — which could be the wrong twin. Detect any other matched city with the
      // SAME Arabic/English name in a different region and surface as ambiguous so the agent backstop
      // asks «تقصد X في R1 ولا X في R2؟» and the engine refuses to fan out across regions.
      const allMatches = matchLocations(raw);
      const twins = allMatches.filter((p) =>
        p.kind === 'city' && p !== hit && p.regionEn !== hit.regionEn &&
        (p.nameAr === hit.nameAr || p.nameEn.toLowerCase() === hit.nameEn.toLowerCase())
      );
      if (twins.length > 0) {
        const all = [hit, ...twins];
        return {
          raw, kind: 'city', city: hit.nameEn, region: hit.regionEn,
          label: ar(locale) ? hit.nameAr : hit.nameEn,
          districts: [], cities: all.map((p) => p.nameEn),
          // Region labels parallel to `cities` so the clarifier shows «الشرقية / الرياض» — without this the
          // identical city display labels («الهفوف»/«الهفوف») dedupe to one blank option. (audit #2.)
          twinRegions: all.map((p) => (ar(locale) ? (p.regionAr || p.regionEn || '') : (p.regionEn || ''))).filter(Boolean),
          ambiguous: true, exact: true,
        };
      }
      // Region-vs-city SAME NAME (الرياض/جازان/تبوك/حائل/نجران/الباحة/الجوف): the bare token also matches a
      // region of the same name → ask «مدينة ولا منطقة؟», never default to city. (audit #4 / Q38.)
      const sameRegion = matchLocations(raw).find((p) => p.kind === 'region' &&
        (p.nameAr === hit.nameAr || p.nameEn.toLowerCase() === hit.nameEn.toLowerCase()));
      if (sameRegion) {
        return { raw, kind: 'city', city: hit.nameEn, region: hit.regionEn,
          label: ar(locale) ? hit.nameAr : hit.nameEn, districts: [], cities: [],
          regionOrCity: true, exact: true };
      }
      return { raw, kind: 'city', city: hit.nameEn, region: hit.regionEn, label: ar(locale) ? hit.nameAr : hit.nameEn, districts: [], cities: [], exact: true };
    }
    if (hit.kind === 'region') {
      // Region search → carry the DB region value + ALL its cities, so the engine returns the whole
      // region (not just the capital). (user: "Region search = all listings in that region.")
      const r = citiesInRegion(hit.nameEn);
      return { raw, kind: 'region', city: '', region: r.region || undefined, label: ar(locale) ? hit.nameAr : `${hit.nameEn} Region`, districts: [], cities: r.cities, exact: true };
    }
    // country → fall through to geography/lifestyle/none (it isn't a specific place to anchor on)
  }
  // 3c) FUZZY city correction — a typo'd / homophone-spelled city the exact matchers missed ("القرص"→
  //     Ar Rass, "khubar"→Khobar, "jedah"→Jeddah). Last resort before geography cues / "couldn't find
  //     it", so a near-miss still finds the real city's inventory instead of dead-ending. Region comes
  //     from the live DB index, so the summary can show Region → City. (user: don't dead-end a typo.)
  const fc = fuzzyCity(raw);
  if (fc && fc.city) {
    // `city` is ENGINE-FACING → canonical English (cityFilterFor / cityHasListings / nearbyCity all key
    // off the English DB label); `label` carries the localized display. (Returning the localized name
    // here would silently break server-side scoping for Arabic-locale fuzzy hits — caught in review.)
    // Bug-fix #9: tag this as a fuzzy correction so the «هل تقصد X؟» banner ALWAYS surfaces — even if
    // the corrected city has live inventory (the old gate hid the banner when the substitute city
    // happened to have listings, silently swapping cities). Per locked rule: never silently substitute.
    return { raw, kind: 'city', city: fc.city, region: fc.region || undefined, label: cityDisplay(fc.city, locale), districts: [], cities: [], fuzzy: true };
  }
  // 4) Geography cue ("near the sea / mountain / desert"). NEVER auto-pick a default city: if the user
  //    named a city, scope to it; otherwise ASK «تقصد في أي مدينة أو منطقة؟» and offer the candidate
  //    cities as options only — the cue is a HELPER, not a location. (audit #12 / Q39: no silent Jeddah.)
  for (const g of GEOGRAPHY) if (hasWord(g.words)) {
    const sc = scopeCity(f);
    if (sc) return { raw, kind: 'geography', city: sc, label: g.note, districts: [], cities: [], note: g.note };
    return { raw, kind: 'geography', city: '', label: g.note, districts: [], cities: g.cities, needsCity: true, note: g.note };
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
