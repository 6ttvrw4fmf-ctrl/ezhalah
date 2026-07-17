import { supabase } from '@/lib/supabase';
import type { Listing } from './listings';
import { type Deal } from './taxonomy';
import type { SearchQuery } from './search';
import { REGIONS, CITY_TO_REGION, isCountryWideQuery, interleave } from './regions';
import { translitPlace } from '@/lib/translitPlace';
import { normalizeType, queryForSelection, queryForTypes, SUBGROUPS, CLEAN_MACRO, CLEAN_TO_TYPE_AR, EN_TO_AR, typeArForTypes, typeArForSelection, type CleanQuery, type SourceKind, type Macro } from './propertyTypes';
import { effectiveTypes, bedroomTokens } from './search';
import { scoreListingProximity } from './proximity';
import { cityDisplay } from './locations';
import { arabicOrPlaceholder } from '@/lib/arabicText';
import { TYPE_UNRESOLVED_AR } from '@/i18n';
import { mergeDiversitySeed, filterBoosted, orderByScope, type Scope, type RankedRow } from '@/lib/platformDiversity';

// Maps proximity.ts Relationship values to the relationship_group stored in listing_location_relations.
function relGroupOf(rel: string): string {
  switch (rel) {
    case 'near': return 'near';
    case 'opposite': case 'behind': return 'position';
    case 'time_distance': return 'distance';
    case 'view': return 'view';
    case 'road_position': return 'road';
    case 'centrality': return 'centrality';
    default: return '__parked__'; // within etc. → never matches a stored group
  }
}

// Session cache of every listing we've fetched (by id) — lets the in-app browser open any listing
// the user has seen without a refetch, even though we no longer hold the whole table in memory.
const LISTING_CACHE = new Map<number, Listing>();
function cacheListings(rows: Listing[]): void { for (const r of rows) LISTING_CACHE.set(r.id, r); }
export function getCachedListing(id: number): Listing | undefined { return LISTING_CACHE.get(id); }

// Canonical Saudi city names as stored in the DB (English). Used to decide whether q.location is a
// CITY we can push to a server-side filter, vs a district/landmark phrase (which the client resolves
// fuzzily against the fetched subset). Substring match both ways so "Riyadh"/"al riyadh" both hit.
// MUST mirror the scraper's canonical city labels (scrapers/common/normalize.CITY_MAP_AR values) —
// these are the exact `city` strings stored in the DB, so a user searching any of these scopes the
// server-side fetch to it. Adding a town here is what makes it findable. (~90 towns, all 13 regions.)
const KNOWN_CITIES = [
  // Riyadh region
  'Riyadh', 'Al Kharj', 'Al Majmaah', 'Dawadmi', 'Al Zulfi', 'Afif', 'Al Quwayiyah', 'Shaqra',
  'Diriyah', 'Al Muzahimiyah', 'Thadiq', 'Hawtat Bani Tamim', 'Al Ghat', 'Rumah', 'Al Dalam',
  'Al Hariq', 'As Sulayyil', 'Al Hayathim',
  // Makkah region
  'Jeddah', 'Mecca', 'Taif', 'Rabigh', 'Al Qunfudhah', 'KAEC', 'Thuwal', 'Al Jumum', 'Al Kamil',
  'Al Lith', 'Turabah', 'Raniyah', 'Al Khurma',
  // Madinah region
  'Medina', 'Yanbu', 'Al Ula', 'Badr', 'Al Hanakiyah', 'Umluj', 'Khaybar', 'Mahd adh Dhahab',
  // Qassim region
  'Buraidah', 'Unaizah', 'Ar Rass', 'Al Bukayriyah', 'Al Mithnab', 'Al Badai', 'Riyadh Al Khabra',
  'An Nabhaniyah', 'Ash Shamasiyah',
  // Eastern region
  'Dammam', 'Khobar', 'Dhahran', 'Hofuf', 'Al Ahsa', 'Mubarraz', 'Jubail', 'Qatif',
  'Hafar Al Batin', 'Ras Tanura', 'Abqaiq', 'An Nairyah', 'Khafji', 'Sayhat', 'Safwa',
  'Tarout', 'Anak', 'Al Uyun',
  // Asir region
  'Abha', 'Khamis Mushait', 'Bisha', 'Mahayel', 'Ahad Rafidah', 'Al Majardah', 'Balsamar', 'Tathlith',
  // Tabuk region
  'Tabuk', 'Duba', 'Al Wajh', 'Tayma',
  // Hail region
  'Hail', 'Baqaa', 'Al Ghazalah', 'Ash Shanan',
  // Northern Borders region
  'Arar', 'Rafha', 'Turaif',
  // Jazan region
  'Jazan', 'Sabya', 'Abu Arish', 'Samtah', 'Baysh', 'Ahad Al Masarihah',
  // Najran region
  'Najran', 'Sharurah',
  // Al Bahah region
  'Al Baha',
  // Al Jouf region
  'Sakaka', 'Qurayyat', 'Dawmat Al Jandal',
];
// Alternate spellings → the canonical DB label. Two jobs: (1) human typos/synonyms (Al Ahsa's
// listings live under Hofuf); (2) CANONICALIZE the AI agent's output — the agent transliterates
// town names differently than the scraper labels them ("AlUla" vs DB "Al Ula"), so without this
// the agent's reply scopes to a city with 0 rows and silently returns nothing despite live data.
// Keys are lowercase (cityFilterFor lowercases before lookup). Audited agent↔DB drift, June 2026.
const CITY_ALIASES: Record<string, string> = {
  // الأحساء / الهفوف / المبرز — three DISTINCT Eastern-Province catalog cities. User decision #5 (locked
  // 2026-06-25): keep them strictly separate, never merged. Previously every form collapsed to "Hofuf";
  // that was the alias-collapse bug. Each Arabic form now maps to its OWN canonical English DB label.
  'الاحساء': 'Al Ahsa', 'الأحساء': 'Al Ahsa',
  'al ahsa': 'Al Ahsa', 'al hasa': 'Al Ahsa', 'alahsa': 'Al Ahsa', 'hasa': 'Al Ahsa', 'ahsa': 'Al Ahsa',
  'الهفوف': 'Hofuf', 'al hofuf': 'Hofuf', 'hofuf': 'Hofuf', 'al hafuf': 'Hofuf', 'alhafuf': 'Hofuf',
  'hafuf': 'Hofuf', 'hufuf': 'Hofuf',
  'المبرز': 'Mubarraz', 'al mubarraz': 'Mubarraz', 'mubarraz': 'Mubarraz', 'mubarrez': 'Mubarraz',
  // CATALOG-vs-DB city-label mismatches: the picker/agent surface the CATALOG's English spelling
  // (Makkah, Madinah, Khamis Mushayt, Buqayq, …) which differs from the DB label, so a pick dead-ended
  // at 0 results. Audited ALL 25 listing-cities the picker couldn't reach + their Arabic. (user-reported
  // via "Al Hafuf"; Mecca 6.2k + Medina 7k were the biggest.) Map every form → the DB label.
  'madinah': 'Medina', 'المدينة المنورة': 'Medina', 'المدينه المنوره': 'Medina',
  'makkah': 'Mecca', 'مكة المكرمة': 'Mecca', 'مكه المكرمه': 'Mecca', 'مكة': 'Mecca',
  'khamis mushayt': 'Khamis Mushait', 'خميس مشيط': 'Khamis Mushait',
  'unayzah': 'Unaizah', 'عنيزة': 'Unaizah',
  'al majma\'ah': 'Al Majmaah', 'al majmaah': 'Al Majmaah', 'المجمعة': 'Al Majmaah',
  'al quway\'iyah': 'Al Quwayiyah', 'القويعية': 'Al Quwayiyah',
  'riyad al khabra': 'Riyadh Al Khabra', 'رياض الخبراء': 'Riyadh Al Khabra',
  'buqayq': 'Abqaiq', 'بقيق': 'Abqaiq',
  'king abdullah economic city': 'KAEC', 'مدينة الملك عبدالله الاقتصادية': 'KAEC',
  'az zulfi': 'Al Zulfi', 'الزلفي': 'Al Zulfi',
  'ad duwadimi': 'Dawadmi', 'الدوادمي': 'Dawadmi',
  'al qunfidhah': 'Al Qunfudhah', 'القنفذة': 'Al Qunfudhah',
  'al hinakiyah': 'Al Hanakiyah', 'الحناكية': 'Al Hanakiyah',
  'an nu\'ayriyah': 'An Nairyah', 'النعيرية': 'An Nairyah',
  'bish': 'Baysh', 'بيش': 'Baysh',
  'ahad rifaydah': 'Ahad Rafidah', 'أحد رفيدة': 'Ahad Rafidah', 'احد رفيده': 'Ahad Rafidah',
  'baq\'a': 'Baqaa', 'بقعاء': 'Baqaa',
  'al midhnab': 'Al Mithnab', 'المذنب': 'Al Mithnab',
  'ad dilam': 'Al Dalam', 'الدلم': 'Al Dalam',
  'tarut': 'Tarout', 'تاروت': 'Tarout',
  'ahad al musarihah': 'Ahad Al Masarihah', 'أحد المسارحة': 'Ahad Al Masarihah',
  'بلسمر': 'Balsamar',
  'ras tannurah': 'Ras Tanura', 'رأس تنورة': 'Ras Tanura', 'راس تنوره': 'Ras Tanura',
  'تربة': 'Turabah',
  'an namas': 'Al Namas', 'النماص': 'Al Namas',
  'al khobar': 'Khobar', 'al qatif': 'Qatif',
  // Agent transliteration variants → canonical DB labels
  'alula': 'Al Ula', 'al ula': 'Al Ula',
  'al henakiyah': 'Al Hanakiyah',
  'al mahd': 'Mahd adh Dhahab', 'mahd al dhahab': 'Mahd adh Dhahab',
  'muhayil aseer': 'Mahayel', 'muhayil': 'Mahayel', 'mahayil': 'Mahayel', 'mahail': 'Mahayel',
  'nairiyah': 'An Nairyah', 'al nairyah': 'An Nairyah', 'nairyah': 'An Nairyah',
  'al majaridah': 'Al Majardah', 'al-majaridah': 'Al Majardah', 'majaridah': 'Al Majardah',
  'tathleeth': 'Tathlith',
  'al shimasiyah': 'Ash Shamasiyah', 'al shamasiyah': 'Ash Shamasiyah', 'shamasiyah': 'Ash Shamasiyah',
  'ash shinan': 'Ash Shanan', 'al shinan': 'Ash Shanan', 'shinan': 'Ash Shanan',
  'al nabhaniyah': 'An Nabhaniyah', 'nabhaniyah': 'An Nabhaniyah',
  'al badayea': 'Al Badai', 'badayea': 'Al Badai', 'al badai': 'Al Badai',
  'dumat al jandal': 'Dawmat Al Jandal',
  'al qurayyat': 'Qurayyat', 'qurayyat': 'Qurayyat',
  'al dawadmi': 'Dawadmi',
  'zulfi': 'Al Zulfi',
  'al dilam': 'Al Dalam', 'dilam': 'Al Dalam', 'al delam': 'Al Dalam',
  'hotat bani tamim': 'Hawtat Bani Tamim', 'hawtat bani tameem': 'Hawtat Bani Tamim',
  'al sulayyil': 'As Sulayyil', 'sulayyil': 'As Sulayyil', 'al sulayil': 'As Sulayyil',
  'buraydah': 'Buraidah',
  'uyun al jiwa': 'Al Uyun', 'oyun al jiwa': 'Al Uyun',
};
function cityFilterFor(location: string): string | null {
  const loc = location.trim().toLowerCase();
  if (!loc) return null;
  if (CITY_ALIASES[loc]) return CITY_ALIASES[loc];
  // Exact match against the curated KNOWN_CITIES list. Substring matching (loc.includes(c) ||
  // c.includes(loc)) was REMOVED 2026-06-26 — it silently substituted one real city for another
  // ('dhabhah'.includes('abha') → returned Abha for a search of Dhabhah, an Eastern-Province city
  // in a different region with 0 listings). Locked rule: never silently substitute one catalog city
  // for another. Unknown → null; the caller honest-zeroes at remote.ts:457.
  for (const c of KNOWN_CITIES) if (loc === c.toLowerCase()) return c;
  return null;
}

// English DB-city label → Arabic canonical city (mirrors the DB's loc_city_map). The RPC matches the
// indexed Arabic `city` column, so once the resolver picks a city we translate it to Arabic before
// querying. Falls back to English (the RPC also matches the raw English column). Keyed lowercase.
const CITY_AR: Record<string, string> = {
  'abha': 'أبها', 'abqaiq': 'بقيق', 'abu arish': 'أبو عريش',
  'afif': 'عفيف', 'ahad al masarihah': 'أحد المسارحة', 'ahad rafidah': 'أحد رفيدة',
  'al ammariyah': 'العمارية', 'al aqiq': 'العقيق', 'al badai': 'البدائع',
  'al badaie': 'البدائع', 'al baha': 'الباحة', 'al bahah': 'الباحة',
  'al birk': 'البرك', 'al bukayriyah': 'البكيرية', 'al dalam': 'الدلم',
  'al ghat': 'الغاط', 'al ghazalah': 'الغزالة', 'al hanakiyah': 'الحناكية',
  'al hariq': 'الحريق', 'al hayathim': 'الهياثم', 'al jumum': 'الجموم',
  'al kamil': 'الكامل', 'al kharj': 'الخرج', 'al khurma': 'الخرمة',
  'al lith': 'الليث', 'al majardah': 'المجاردة', 'al majmaah': 'المجمعة',
  'al mithnab': 'المذنب', 'al muzahimiyah': 'المزاحمية', 'al namas': 'النماص',
  'al qunfudhah': 'القنفذة', 'al quwayiyah': 'القويعية', 'al ula': 'العلا',
  'al uyun': 'العيون', 'al wajh': 'الوجه', 'al zulfi': 'الزلفي',
  'an nabhaniyah': 'النبهانية', 'an nairyah': 'النعيرية', 'anak': 'عنك',
  'ar rass': 'الرس', 'arar': 'عرعر', 'as sulayyil': 'السليل',
  'ash shamasiyah': 'الشماسية', 'ash shanan': 'الشنان', 'badr': 'بدر',
  'balsamar': 'بلسمر', 'baqaa': 'بقعاء', 'baysh': 'بيش',
  'bish': 'بيش', 'bisha': 'بيشة', 'buraidah': 'بريدة',
  'dammam': 'الدمام', 'dawadmi': 'الدوادمي', 'dawmat al jandal': 'دومة الجندل',
  'dhahran': 'الظهران', 'dhahran al janub': 'ظهران الجنوب', 'diriyah': 'الدرعية',
  'duba': 'ضباء', 'hafar al batin': 'حفر الباطن', 'hail': 'حائل',
  'hawtat bani tamim': 'حوطة بني تميم', 'hofuf': 'الهفوف',
  'al ahsa': 'الاحساء', 'mubarraz': 'المبرز',
  'jazan': 'جازان',
  'jeddah': 'جدة', 'jubail': 'الجبيل', 'kaec': 'مدينة الملك عبدالله الاقتصادية',
  'khafji': 'الخفجي', 'khamis mushait': 'خميس مشيط', 'khaybar': 'خيبر',
  'khobar': 'الخبر', 'mahayel': 'محايل عسير', 'mahd adh dhahab': 'مهد الذهب',
  'malham': 'ملهم', 'mecca': 'مكة المكرمة', 'medina': 'المدينة المنورة',
  // Catalog (sa-locations.json) spells these "Makkah"/"Madinah"; keep both so the resolver's own output maps.
  'makkah': 'مكة المكرمة', 'makkah al mukarramah': 'مكة المكرمة',
  'madinah': 'المدينة المنورة', 'al madinah': 'المدينة المنورة', 'al madinah al munawwarah': 'المدينة المنورة',
  'najran': 'نجران', 'qatif': 'القطيف', 'qurayyat': 'القريات',
  'rabigh': 'رابغ', 'rafha': 'رفحاء', 'raniyah': 'رنية',
  'ras tanura': 'رأس تنورة', 'riyadh': 'الرياض', 'riyadh al khabra': 'رياض الخبراء',
  'rumah': 'رماح', 'sabya': 'صبيا', 'safwa': 'صفوى',
  'sakaka': 'سكاكا', 'samtah': 'صامطة', 'sayhat': 'سيهات',
  'shaqra': 'شقراء', 'sharurah': 'شرورة', 'tabuk': 'تبوك',
  'taif': 'الطائف', 'tarout': 'تاروت', 'tathleeth': 'تثليث',
  'tathlith': 'تثليث', 'tayma': 'تيماء', 'thadiq': 'ثادق',
  'thuwal': 'ثول', 'turabah': 'تربة', 'turaif': 'طريف',
  'umluj': 'أملج', 'unaizah': 'عنيزة', 'yanbu': 'ينبع',
};
// Scraper-injected junk sentinels for "resolver couldn't match a location" (2026-07-10
// location-data-quality audit: the literal English word "Other" written by gathern/aqarcity/
// eastabha/raghdan/fursaghyr/aqargate/aqarmonthly/sanadak/aldarim/wasalt when their city resolver
// fails, instead of an honest NULL). Checked against the RAW value straight from the scraper table,
// BEFORE any translation attempt. Never add a real (if unmapped) city/town name here — that would
// blank out a legitimate location for every platform that scrapes that same place correctly; the
// platform-specific hardcoded-default bugs (e.g. sadin defaulting to "Medina", alkhaas to "Unaizah")
// are fixed at the scraper layer instead, not by blocklisting a real name here.
const JUNK_LOCATION_TOKENS = new Set(['other', 'unknown', 'n/a', '', 'null', 'undefined']);
function isJunkLocationToken(raw: string | null | undefined): boolean {
  return JUNK_LOCATION_TOKENS.has((raw ?? '').trim().toLowerCase());
}

function arCity(en: string | null): string | null {
  if (!en) return null;
  const k = en.trim().toLowerCase();
  // Never surface a scraper-junk sentinel as if it were a real (if untranslated) place name — this
  // function's own final `|| en` fallback below exists for GENUINE unmapped cities, not for a token
  // that isn't a place name at all. (2026-07-10 location-data-quality audit.)
  if (JUNK_LOCATION_TOKENS.has(k)) return null;
  // The Saudi catalog (sa-locations.json, used by resolveLocation/matchLocations) spells many cities WITH
  // the article — "Al Khobar", "At Taif", "Al Jubail" — while CITY_AR is keyed on the bare form
  // ("khobar", "taif", "jubail"). Without the article-stripped fallback the resolver's own city output
  // missed the map and the ENGLISH name reached the RPC (which matches the Arabic `city` column) → 0
  // results for WHOLE cities (الخبر 6089, etc.) in BOTH Filter and Chat. (city-canonical fix 2026-06-27.)
  return CITY_AR[k] || CITY_AR[k.replace(/^(?:al|at|ad|as|ar|az|an|ash)\s+/, '')] || en;
}

// Region name → region_id, mirrors loc_catalog_region (13 stable rows). Used to pass p_region_ids to
// the RPC so same-name twin cities (e.g. «الهفوف» Eastern vs Riyadh) never fuse across regions.
// Bug-fix #2 (audit `engine-no-region-scoping-twin-fusion`): the RPC matches city_ar only, so without
// a region scope, all 290 twin-city groups in the catalog blur cross-region.
const REGION_TO_ID: Record<string, number> = {
  // Arabic canonical
  'منطقة الرياض': 1, 'منطقة مكة المكرمة': 2, 'منطقة المدينة المنورة': 3, 'منطقة القصيم': 4,
  'المنطقة الشرقية': 5, 'منطقة عسير': 6, 'منطقة تبوك': 7, 'منطقة حائل': 8,
  'منطقة الحدود الشمالية': 9, 'منطقة جازان': 10, 'منطقة نجران': 11, 'منطقة الباحة': 12, 'منطقة الجوف': 13,
  // English labels the resolver may also emit
  'Riyadh': 1, 'Makkah': 2, 'Mecca': 2, 'Madinah': 3, 'Medina': 3, 'Qassim': 4,
  'Eastern Province': 5, 'Eastern': 5, 'Asir': 6, 'Tabuk': 7, 'Hail': 8,
  'Northern Borders': 9, 'Jazan': 10, 'Najran': 11, 'Al Bahah': 12, 'Al Baha': 12, 'Al Jawf': 13,
};
function regionIdsFor(lm: { exact?: boolean; kind?: string; region?: string } | null | undefined): number[] | null {
  if (!lm || !lm.region) return null;
  const id = REGION_TO_ID[lm.region.trim()];
  return id ? [id] : null;
}

// The clean-type query for the current selection. The filter's multi-select (`q.types`) ORs across the
// chosen types; a single `q.type` (agent path) is a 1-element selection; a `q.typeGroup` with no types
// expands to the whole group. Resolves to the RAW property_type strings + table kinds to query. This is
// macro-agnostic — Residential and Commercial groups go through the exact same path. (multi-type filter.)
function effectiveCleanQuery(q: SearchQuery): CleanQuery | null {
  const types = q.types && q.types.length ? q.types : (q.type ? [q.type] : []);
  if (types.length) return queryForTypes(types);
  if (q.typeGroup) return queryForSelection(q.typeGroup);
  return null;
}

// Map the selection → the RAW DB property_type values to constrain to (server-side). null = no type
// constraint (a macro-only "all Residential/Commercial" search). The raw set covers every scraped
// spelling a clean type came from (e.g. Shop ⊇ {Shop, Kiosk}; Studio ⊇ {Studio, ستوديو, …}).
function dbTypesFor(q: SearchQuery): string[] | null {
  const cq = effectiveCleanQuery(q);
  return cq && cq.rawTypes.length ? cq.rawTypes : null;
}

// FILTER-FIRST (owner 2026-07-08): the search RPC applies these BEFORE the per-platform/limit cap, so the
// candidate window is the MATCHING set (not the newest-of-any-type slice that hid most matches). p_types is
// the ARABIC type_ar the index stores (NOT the English rawTypes, which match 0 rows). Beds are STRICT
// (exact 1–4, ≥5 for "5+"). Price/area are passed raw; the RPC applies the monthly ×12 via p_rent_period.
// The client-side filters in runSearch stay as a safety net (index↔raw drift). [[filter-candidate-cap-underreturn-2026-07-08]]
const pnum = (s: unknown): number | null => { const n = parseInt(String(s ?? '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) && n > 0 ? n : null; };

// The AGENT price path stores a single budget CEILING in q.priceInput (the filter UI uses priceMin/priceMax
// instead), and it was NEVER pushed to the RPC — so the candidate count ignored the budget (~2× inflated) and
// cheap matches sat past the first page. Return the effective ANNUAL (rent) / TOTAL (buy) ceiling, mirroring the
// client priceFilter's cap logic, or null when it can't map to a plain server bound (per-m², both-deals).
function agentPriceCapAnnual(q: SearchQuery): number | null {
  const amount = parseInt((q.priceInput || '').replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(amount) || amount < 100) return null;
  if (q.bothDeals) return null;                     // one cap over buy+rent — leave to the client
  if (q.deal === 'Rent') {
    if (q.priceIsAnnual) return amount;             // agent already annualized a daily/weekly/monthly rent
    if (q.rentPeriod === 'annual') return amount;
    if (q.rentPeriod === 'monthly') return amount * 12;
    return amount <= 25_000 ? amount * 12 : amount; // agent magnitude heuristic (matches priceFilter)
  }
  return amount > 50_000 ? amount : null;           // Buy: only a fixed total ceiling maps (per-m² stays client-side)
}

function rpcFilterParams(q: SearchQuery) {
  const sel = effectiveTypes(q);
  const p_types = sel.length ? typeArForTypes(sel) : (q.typeGroup ? typeArForSelection(q.typeGroup) : null);
  const toks = bedroomTokens(q);
  const exact = toks.filter((d) => /^[1-4]$/.test(d)).map((d) => parseInt(d, 10));
  const p_beds_exact = exact.length ? exact : null;
  const p_beds_min = toks.some((d) => d.startsWith('5')) ? 5 : null;
  // Standard filter RANGE (priceMin/priceMax) — bounds already in the displayed unit; the RPC ×12s a monthly
  // bound. priceIsAnnual never co-occurs with the filter range, so that guard is just a no-op safety net.
  let p_price_min = q.priceIsAnnual ? null : pnum(q.priceMin);
  let p_price_max = q.priceIsAnnual ? null : pnum(q.priceMax);
  if (p_price_min == null && p_price_max == null) {
    // No explicit range → push the agent's single ceiling so the count reflects the budget. Our cap is annual;
    // the RPC re-multiplies a rent bound by 12 for a monthly period, so divide by 12 there to cancel it.
    const annualCap = agentPriceCapAnnual(q);
    if (annualCap != null) p_price_max = rentPeriodParam(q) === 'شهري' ? Math.round(annualCap / 12) : annualCap;
  }
  return {
    p_types,
    p_beds_exact,
    p_beds_min,
    p_price_min,
    p_price_max,
    p_area_min: pnum(q.areaMin),
    p_area_max: pnum(q.areaMax),
  };
}

export type SearchScope = {
  p_deal: string | null;
  p_rent_period: string | null;
  p_cities: string[] | null;
  p_districts: string[] | null;
  p_tables: string[];
  p_platforms: string[] | null;
  p_region_ids: number[] | null;
  p_tables2: string[] | null;
  p_types2: string[] | null;
  p_category: string | null;
  isBroadCommercial: boolean;
};

// Resolves a SearchQuery into the location/table/region scope the search RPC needs — cities, table
// set, region pin, category purity, and the broad-Commercial/Residential misfile-recovery second
// scope. Extracted verbatim from fetchListingsForQuery (no behavior change) so the advanced-filter
// option-count RPCs can share the EXACT same scope resolution as the main listing fetch — a
// hand-rolled approximation here has already caused a real undercount bug once (missing
// match_city_ids in an ad-hoc copy), so this must stay the single source of truth rather than be
// reimplemented per caller. ASYNC (2026-07-16, merged from PR#86's district-without-city fix, which
// needs to await resolve_district_cities) — every caller must now await this.
// Returns null for an honest-zero case (unresolvable/ambiguous location, or a named district with no
// real listings) — callers should treat that as "0 results", not query further.
export async function resolveSearchScope(q: SearchQuery): Promise<SearchScope | null> {
  const tables = tablesFor(q);
  if (!tables.length) return null;
  const isBroadCommercial = q.category === 'Commercial' && !q.type && !(q.types && q.types.length) && !q.typeGroup;

  const lm = q.locationMatch;
  let cities: string[] | null = null;
  if (q.regionPin && (q.location || '').trim()) {
    cities = [arCity(q.location) || q.location];
  } else if (lm?.ambiguous && lm.cities && lm.cities.length > 1) {
    cities = [];
  } else if (lm?.exact && lm.kind === 'city' && lm.city) {
    cities = [arCity(lm.city) || lm.city];
  } else if (lm?.kind === 'region' && lm.cities && lm.cities.length) {
    cities = Array.from(new Set(lm.cities.map((c) => arCity(cityFilterFor(c) || c)).filter(Boolean))) as string[];
  } else if (lm?.ambiguous && lm.cities && lm.cities.length) {
    cities = Array.from(new Set(lm.cities.map((c) => arCity(cityFilterFor(c) || c)).filter(Boolean))) as string[];
  } else {
    const city = arCity(cityFilterFor(q.location || '') || (lm?.city ? cityFilterFor(lm.city) : null));
    if (city) cities = [city];
  }
  const countryWide = isCountryWideQuery(q);

  // DISTRICT-WITHOUT-CITY resolution — owner PERMANENT rule 2026-07-16, merged in from PR#86. A
  // district name alone must NEVER silently fan out across every city that happens to share it
  // (confirmed live: «العليا» alone spans 13 distinct real cities). Resolve which real city/cities
  // those districts actually belong to via resolve_district_cities (grounded in the live listings
  // themselves). STRICT `cities === null` (not `!cities.length`) — `cities` is also deliberately `[]`
  // above when locationMatch already flagged an unrelated ambiguity; that verdict must not be
  // re-litigated through this block's differently-tuned threshold.
  if (cities === null && q.districts && q.districts.length && supabase) {
    const { data: districtCities } = await supabase.rpc('resolve_district_cities', { p_districts: q.districts });
    const dcRows = (districtCities as { city_ar: string; match_count: number }[] | null) ?? [];
    if (dcRows.length === 1) {
      cities = [dcRows[0].city_ar];
    } else if (dcRows.length > 1) {
      const topCount = Number(dcRows[0].match_count);
      const threshold = Math.max(5, topCount * 0.05);
      const realCandidates = dcRows.filter((r) => Number(r.match_count) >= threshold);
      if (realCandidates.length === 1) {
        cities = [realCandidates[0].city_ar];
      } else {
        return null;
      }
    }
    // dcRows.length === 0 → no real matches anywhere for this district name; fall through, the main
    // RPC call will correctly return an honest zero on its own.
  }

  if ((!cities || !cities.length) && !countryWide && !(q.districts && q.districts.length) && (q.location || '').trim()) {
    return null;
  }
  if (lm?.kind === 'district' && !(q.districts && q.districts.length)) return null;

  // HARDENING (owner PERMANENT rule 2026-07-16, merged from PR#86): always return the filtered set,
  // even empty, rather than silently falling back to `tbls` unfiltered when the platform has no
  // table in this particular scope (e.g. Gathern + Buy) — that fallback bug let a platform filter
  // silently widen back to every platform.
  const platformScope = (tbls: string[]): string[] => {
    if (!(q.sources && q.sources.length)) return tbls;
    const wanted = new Set(q.sources);
    return tbls.filter((t) => wanted.has(t.replace(/_(residential|commercial)_listings$/, '')));
  };
  const mainTables = isBroadCommercial ? platformScope(resTables(q)) : tables;

  const isBroadResidential = q.category === 'Residential' && !q.type && !(q.types && q.types.length) && !q.typeGroup;
  const resSel = effectiveTypes(q);
  const resSelectedTypeAr = resSel.length ? typeArForTypes(resSel) : (q.typeGroup ? typeArForSelection(q.typeGroup) : null);
  const resMisfileTypes = isBroadResidential
    ? RESIDENTIAL_TYPE_AR_COM
    : (resSelectedTypeAr ? resSelectedTypeAr.filter((t) => RESIDENTIAL_TYPE_AR_COM.includes(t)) : []);
  const resScopeBTables = platformScope(COM_TABLES.filter((t) => !mainTables.includes(t)));
  const attachResScopeB = q.category === 'Residential' && !isBroadCommercial
    && resMisfileTypes.length > 0 && resScopeBTables.length > 0;

  const scopeB = isBroadCommercial
    ? { p_tables2: tables, p_types2: COMMERCIAL_TYPE_AR_COM }
    : attachResScopeB
      ? { p_tables2: resScopeBTables, p_types2: resMisfileTypes }
      : { p_tables2: null as string[] | null, p_types2: null as string[] | null };

  return {
    p_deal: q.bothDeals ? null : (q.deal === 'Buy' ? 'بيع' : 'إيجار'),
    p_rent_period: rentPeriodParam(q),
    p_cities: cities,
    p_districts: q.districts && q.districts.length ? q.districts : null,
    p_tables: mainTables,
    p_platforms: q.sources && q.sources.length ? q.sources : null,
    p_region_ids: q.regionPin
      ? (REGION_TO_ID[q.regionPin] ? [REGION_TO_ID[q.regionPin]] : null)
      : regionIdsFor(lm),
    // CATEGORY PURITY — owner PERMANENT rule 2026-07-16, merged from PR#86. Independent RPC-layer
    // enforcement (against the canonical known_type_ar.macro taxonomy) that a Residential search can
    // never surface a Commercial-macro row and vice versa, regardless of p_types. Shared here so the
    // age-bucket option-count RPC stays in exact parity with what Search actually returns. Uses
    // impliedCategory() (not raw q.category) — see its comment: closes the null-category leak.
    p_category: impliedCategory(q),
    ...scopeB,
    isBroadCommercial,
  };
}

// One row from property_age_option_counts_ar: combined cross-platform counts for every عمر العقار
// bucket, computed within the caller's exact current scope (2026-07-12 advanced-filter engine).
// `platform_breakdown` is INTERNAL ONLY (monitoring/concentration checks) — never render it to the
// user; the UI must only ever show the combined cnt_* totals (rule: one combined count, platform
// contribution stays internal).
export type AgeOptionCounts = {
  cnt_new: number;
  cnt_1_2: number;
  cnt_3_5: number;
  cnt_6_9: number;
  cnt_10p: number;
  cnt_unknown: number;
  cnt_total: number;
  platform_breakdown: Record<string, Record<string, number>> | null;
};

// A hung/slow RPC must never hang the advanced-question card indefinitely — proven latency for this
// exact predicate shape is 58–160ms even nationwide, so 4s is generous headroom for network/cold-start
// variance while still failing fast in a genuine outage. A timeout is treated identically to an RPC
// error: fetchPropertyAgeOptionCounts returns null either way.
const AGE_COUNT_TIMEOUT_MS = 4000;
function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T | { timedOut: true }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), ms);
    Promise.resolve(p).then((v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve({ timedOut: true }); });
  });
}

// Live, scope-respecting bucket counts for the عمر العقار advanced question. Reuses resolveSearchScope
// + rpcFilterParams verbatim (same predicate the main search RPC uses) so a bucket's count always
// matches what Search will actually return if the user picks it — never a separate, hand-approximated
// query. An unresolvable scope (see resolveSearchScope) returns all-zero counts rather than null, so
// the advanced-question engine's "fewer than 2 options → fall back" rule applies uniformly instead of
// needing a separate null-handling branch. An RPC error OR timeout returns null — the caller (see
// advancedFilters.ts) treats that exactly like "no viable options" and falls back, so a backend
// problem here degrades gracefully instead of leaving the tap with no effect.
export async function fetchPropertyAgeOptionCounts(q: SearchQuery): Promise<AgeOptionCounts | null> {
  if (!supabase) return null;
  const scope = await resolveSearchScope(q);
  if (!scope) {
    return { cnt_new: 0, cnt_1_2: 0, cnt_3_5: 0, cnt_6_9: 0, cnt_10p: 0, cnt_unknown: 0, cnt_total: 0, platform_breakdown: null };
  }
  const { isBroadCommercial, ...scopeParams } = scope;
  const result = await withTimeout(
    supabase.rpc('property_age_option_counts_ar', {
      ...scopeParams,
      ...rpcFilterParams(q),
      ...(isBroadCommercial ? { p_types: COMMERCIAL_TYPE_AR_RES } : {}),
    }),
    AGE_COUNT_TIMEOUT_MS,
  );
  if ('timedOut' in result) return null;
  const { data, error } = result;
  if (error || !data || !(data as AgeOptionCounts[]).length) return null;
  return (data as AgeOptionCounts[])[0];
}

// Convert a listing's `additional_info` into the {key,label,value} rows the card's
// AdditionalInformationPanel renders. Two shapes exist in the DB:
//   • LEGACY (Wasalt/Aqar Gate): already an array of {label,value} → pass through.
//   • NEW (Aqarcity/Eastabha/Sanadak/Raghdan/Candles/Satel/Sadin): a JSON object of rich fields
//     (REGA license, amenities, services, furnishing, parcel/plan, facade, …) — whitelist the
//     user-valuable keys here, in priority order, with i18n-able labels. Internal/raw keys
//     (city_ar, lat/lng, *_ar, dates, ids) are intentionally excluded. (user: the valuable
//     fields in "additional features" weren't showing for the new sources.)
const ADDL_FIELDS: Array<[string, string]> = [
  ['features', 'Amenities'],
  ['features_ar', 'Amenities'],
  ['services', 'Property services'],
  ['furnishing', 'Furnishing'],
  ['property_age', 'Building age (years)'],
  ['age_text', 'Building age (years)'],
  ['facade', 'Facade'],
  ['floors', 'Total Floors'],
  ['kitchens', 'Kitchens'],
  ['halls', 'Majlis / Halls'],
  ['property_use', 'Property usage'],
  ['usage', 'Property usage'],
  ['street_width', 'Street width'],
  ['parking_type', 'Parking type'],
  ['parking_spots', 'Number of Parkings'],
  ['air_conditioning_type', 'AC type'],
  ['kitchen', 'Kitchen'],
  ['rega_ad_license_number', 'Ad license number'],
  ['rega_license_status', 'License status'],
  ['rega_license_issue_date', 'License Issuance Date'],
  ['rega_license_expiry_date', 'License expiry'],
  ['broker_fal_license', 'FAL license'],
  ['parcel_number', 'Parcel number'],
  ['plan_number', 'Plan number'],
  ['postal_code', 'Postal Code'],
  ['building_code_compliant', 'Building code compliant'],
  ['warranties', 'Warranties'],
  ['deed_location_text', 'Deed location'],
  ['status_ar', 'Status'],
  ['availability_status', 'Status'],
  ['address', 'Address'],
  ['street_address', 'Address'],
];
function buildAdditionalInfo(raw: any): Array<{ key: string; label: string; value: string }> | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const rows = raw.filter((r: any) => r && r.label && r.value);
    return rows.length ? rows : null;
  }
  if (typeof raw !== 'object') return null;
  const out: Array<{ key: string; label: string; value: string }> = [];
  const seen = new Set<string>();
  for (const [key, label] of ADDL_FIELDS) {
    if (seen.has(label)) continue;
    let v: any = raw[key];
    if (v === null || v === undefined || v === '' || v === '0' || v === false) continue;
    if (Array.isArray(v)) { v = v.filter(Boolean).join('، '); if (!v) continue; }
    else if (typeof v === 'boolean') v = 'Yes';
    else if (typeof v === 'object') continue;
    else v = String(v).trim();
    if (!v || v === '0') continue;
    if (v.length > 120) v = v.slice(0, 117) + '…';
    seen.add(label);
    out.push({ key, label, value: v });
  }
  return out.length ? out : null;
}

// Every platform's residential / commercial table. A clean type's CleanQuery.kinds says which kind(s)
// to read — and because macro_category is decoupled from the physical table (Commercial Land lives in
// RESIDENTIAL tables, etc.), cross-table types ('both' kinds) read both and the client filters by the
// normalized macro. Gathern + Aqar Monthly are monthly-only RESIDENTIAL sources (no commercial table).
const RES_TABLES = ['aqar_residential_listings', 'wasalt_residential_listings', 'aldarim_residential_listings', 'aqargate_residential_listings', 'alhoshan_residential_listings', 'hajer_residential_listings', 'sanadak_residential_listings', 'eastabha_residential_listings', 'aqarcity_residential_listings', 'raghdan_residential_listings', 'eaqartabuk_residential_listings', 'satel_residential_listings', 'sadin_residential_listings', 'toor_residential_listings', 'mustqr_residential_listings', 'ramzalqasim_residential_listings', 'fursaghyr_residential_listings', 'jazwtn_residential_listings', 'mizlaj_residential_listings', 'muktamel_residential_listings', 'aqaratikom_residential_listings', 'awal_residential_listings', 'alkhaas_residential_listings', 'abeea_residential_listings', 'jurash_residential_listings', 'alnokhba_residential_listings', 'dealapp_residential_listings', 'erapulse_residential_listings', 'nowaisiry_residential_listings', 'october_residential_listings', 'souq24_residential_listings'];
const COM_TABLES = ['aqar_commercial_listings', 'wasalt_commercial_listings', 'aldarim_commercial_listings', 'aqargate_commercial_listings', 'alhoshan_commercial_listings', 'hajer_commercial_listings', 'sanadak_commercial_listings', 'eastabha_commercial_listings', 'aqarcity_commercial_listings', 'raghdan_commercial_listings', 'eaqartabuk_commercial_listings', 'satel_commercial_listings', 'sadin_commercial_listings', 'toor_commercial_listings', 'mustqr_commercial_listings', 'ramzalqasim_commercial_listings', 'fursaghyr_commercial_listings', 'jazwtn_commercial_listings', 'mizlaj_commercial_listings', 'muktamel_commercial_listings', 'aqaratikom_commercial_listings', 'awal_commercial_listings', 'alkhaas_commercial_listings', 'abeea_commercial_listings', 'jurash_commercial_listings', 'alnokhba_commercial_listings', 'dealapp_commercial_listings', 'erapulse_commercial_listings', 'nowaisiry_commercial_listings', 'october_commercial_listings', 'souq24_commercial_listings'];

// Gathern + Aqar Monthly are MONTHLY-ONLY sources: every listing is a monthly rental. On a monthly
// search we therefore include ALL their rows — even ones whose raw rent_period is null — because the
// platform's confirmed rule makes them monthly. (owner rent-period rule 2026-07-06; mirrors the
// location_search_candidates_ar backend fix.) [[gathern-source]] [[monthly-rent]]
const MONTHLY_ONLY_TABLE = /^(gathern|aqarmonthly)_/;

function resTables(q: SearchQuery): string[] {
  // Gathern + Aqar Monthly only on explicit monthly-rent searches (see [[gathern-source]]).
  return (q.deal === 'Rent' && q.rentPeriod === 'monthly')
    ? [...RES_TABLES, 'gathern_residential_listings', 'aqarmonthly_residential_listings']
    : RES_TABLES;
}

// Arabic rent-period token for the search RPC. Only a single-deal Rent search with a period chosen sends
// one ('شهري'/'سنوي'); Buy, "rent or buy" (bothDeals), or no-period send null so the RPC applies NO period
// filter (and Buy stays untouched). Keeps the candidate budget filled with the correct period so monthly
// results aren't crowded out by annual. (owner rent-period rule 2026-07-06.)
function rentPeriodParam(q: SearchQuery): string | null {
  if (q.bothDeals || q.deal !== 'Rent') return null;
  if (q.rentPeriod === 'monthly') return 'شهري';
  if (q.rentPeriod === 'annual') return 'سنوي';
  return null;
}

// Commercial-macro type_ar labels — DERIVED from propertyTypes (the single source of truth for the
// clean-type ↔ macro ↔ type_ar mapping, kept complete by the novel-type alarm). A BROAD Commercial search
// (macro Commercial, no specific type) must reach the ENTIRE commercial set, which spans BOTH table kinds:
//   • commercial tables — every commercial type, INCLUDING عمارة (=Commercial Building there);
//   • residential tables — the commercial types Aqar files under residential (أرض تجارية/أرض صناعية/فندق/
//     مستودع/…), EXCLUDING عمارة (which is a Residential Building in a residential table).
// عمارة is the one DUAL type_ar (Commercial vs Residential Building), disambiguated by the physical table —
// exactly how the client's macro filter resolves it — so the two lists keep total_count == the reachable set.
// These feed the RPC's two (tables,types) scopes in fetchListingsForQuery, replacing the old page-0-only,
// per-platform-capped res sweep that left ~77% of broad-commercial inventory unreachable. (owner 2026-07-09)
const COMMERCIAL_TYPE_AR_ALL = Array.from(new Set(
  Object.keys(CLEAN_MACRO).filter((c) => CLEAN_MACRO[c] === 'Commercial').flatMap((c) => CLEAN_TO_TYPE_AR[c] ?? []),
));
const COMMERCIAL_TYPE_AR_COM = COMMERCIAL_TYPE_AR_ALL;                              // commercial tables: incl عمارة
const COMMERCIAL_TYPE_AR_RES = COMMERCIAL_TYPE_AR_ALL.filter((t) => t !== 'عمارة'); // residential tables: excl عمارة

// Residential-macro type_ar labels — the MIRROR of the commercial lists above, feeding the residential
// misfile-recovery scope B in fetchListingsForQuery (FIX A, owner 2026-07-10). A handful of genuinely
// RESIDENTIAL listings (أرض سكنية/مزرعة/استراحة/شقة/فيلا/بيت/غرفة) are physically misfiled INTO
// *_commercial_listings tables on some platforms. Broad Residential reads only RES_TABLES, so those rows
// were reachable by NO Residential search (and specific searches reached them only for the clean types
// whose CleanQuery.kinds already spans both tables). RESIDENTIAL_TYPE_AR_COM is the set we look for in the
// COMMERCIAL tables: عمارة is EXCLUDED because in a commercial table عمارة = Commercial Building (macro
// Commercial) — exactly how the client's macro filter resolves it — so including it would leak Commercial
// Buildings into Residential results. This mirrors COMMERCIAL_TYPE_AR_RES excluding عمارة, in reverse.
const RESIDENTIAL_TYPE_AR_ALL = Array.from(new Set(
  Object.keys(CLEAN_MACRO).filter((c) => CLEAN_MACRO[c] === 'Residential').flatMap((c) => CLEAN_TO_TYPE_AR[c] ?? []),
));
const RESIDENTIAL_TYPE_AR_COM = RESIDENTIAL_TYPE_AR_ALL.filter((t) => t !== 'عمارة'); // com tables: excl عمارة (=Commercial Building there)

// Which table KIND(s) this query reads: from the selected clean type/group's CleanQuery, else (a
// macro-only search) from q.category. Default Residential.
function kindsFor(q: SearchQuery): SourceKind[] {
  const cq = effectiveCleanQuery(q);
  if (cq) return cq.kinds;
  return q.category === 'Commercial' ? ['com'] : ['res'];
}

// The macro this query is EFFECTIVELY scoped to for the RPC's category-purity gate. Mirrors kindsFor's
// own "Default Residential" fallback: when NOTHING is selected (no type, no group, no category — the
// state reached by tapping an already-selected category pill to deselect it), kindsFor() already reads
// ONLY residential-kind tables, but p_category used to go through as null, making the RPC's purity
// predicate `(p_category IS NULL OR ...)` an unconditional no-op for that call. Any Commercial-macro row
// misfiled into a residential-kind table (e.g. Aqar's أرض تجارية, ~14.4k rows — [[residential-commercial-
// isolation-audit-2026-07-17]]) then sailed straight through, live-quantified at 1,202 rows on a single
// realistic query. Explicitly resolving the implied macro here — instead of leaving it null — makes the
// already-documented "Default Residential" behavior actually enforced end-to-end, not just at the table
// level. A specific type/group selection (cq != null) is left untouched: it's already exactly scoped by
// dbTypesFor's raw type_ar constraint, so this only tightens the one path proven to leak.
function impliedCategory(q: SearchQuery): Macro | null {
  if (q.category) return q.category;
  return effectiveCleanQuery(q) ? null : 'Residential';
}

function tableFor(q: SearchQuery): string {
  return kindsFor(q).includes('res') ? 'aqar_residential_listings' : 'aqar_commercial_listings';
}

// Multi-source: which platform tables to read. Built from the query's table kind(s); a clean type
// scoped to one kind reads only that kind, a cross-table type reads both. Each card renders its own
// SourceBadge. (user request: mix all sources.)
function tablesFor(q: SearchQuery): string[] {
  const kinds = kindsFor(q);
  let tables: string[] = [];
  if (kinds.includes('res')) tables.push(...resTables(q));
  if (kinds.includes('com')) tables.push(...COM_TABLES);
  // EXTRA tables: a clean type may name specific extra tables to scan (a type misfiled into the other
  // kind's table on one platform, e.g. مكاتب مشتركة → Office but sitting in dealapp_residential). Adds
  // just that table so the row is reachable via its filter, without widening kinds for every platform.
  const cq = effectiveCleanQuery(q);
  if (cq?.extraTables?.length) for (const tb of cq.extraTables) if (!tables.includes(tb)) tables.push(tb);
  // PLATFORM filter: the user named specific platforms ("show me Gathern only"). q.sources holds
  // table prefixes; keep only those platforms' tables. (user: "show me gathern only".)
  // HARDENING (owner PERMANENT rule 2026-07-16): always assign the filtered set, even when it's EMPTY
  // (e.g. requesting Gathern — monthly-rent-only — together with Buy, or with annual Rent: Gathern has
  // no table in this search's kind/deal scope at all). The prior `if (only.length) tables = only` guard
  // silently fell back to the FULL unfiltered table list on an empty intersection — masked in production
  // only because the RPC's own independent p_platforms clause happened to also enforce this, but a real,
  // confirmed correctness bug on its own (audit 2026-07-16). An empty table list here correctly reaches
  // the `if (!tables.length) return [];` guard just below → honest zero, never a silent fallback.
  if (q.sources && q.sources.length) {
    const wanted = new Set(q.sources);
    tables = tables.filter((tbl) => wanted.has(tbl.replace(/_(residential|commercial)_listings$/, '')));
  }
  return tables;
}

// Round-robin interleave so cards alternate between Aqar and Wasalt instead of front-loading one.
function interleaveSources<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

const QUERY_LIMIT = 1500; // page size — the newest N MATCHING rows per page (filter-first); Load More pages the rest
// How many MATCHING candidates the last main RPC call returned (before index↔raw detail drops). The store
// reads this to advance the Load-More offset and decide hasMore, so broad searches (e.g. Riyadh villas =
// 11,438) page through the FULL set, not just the first window. (owner 2026-07-08) [[filter-candidate-cap-underreturn-2026-07-08]]
let _lastPageCandidates = 0;
export const lastPageCandidates = (): number => _lastPageCandidates;
// EXACT total matching count for the last search — the RPC's `count(*) over()` (full filtered set before
// the page limit), so it's the same on every page. The store surfaces it as SearchResult.matchTotal for
// the "لقينا N إعلان يطابق طلبك" headline. Falls back to the page length if the column is absent. (owner 2026-07-08)
let _lastPageTotal = 0;
export const lastPageTotal = (): number => _lastPageTotal;

// Per-query set of (source_table:listing_id) keys pulled forward by the page-0 platform-diversity seed
// (owner PERMANENT rule 2026-07-13, see fetchListingsForQuery). Keyed by JSON.stringify(q) rather than a
// single flat Set so an unrelated search started in between a page-0 fetch and a later Load-More click
// (both real in the AI Agent, which keeps every past search's "Load More" live in the same conversation)
// can never clobber a different search's boosted-id memory. Capped to bound memory over a long session.
const _diversityBoostedByQuery = new Map<string, Set<string>>();
const _DIVERSITY_QUERY_CAP = 50;
function noteDiversityQuery(key: string, keys: Set<string>) {
  _diversityBoostedByQuery.set(key, keys);
  if (_diversityBoostedByQuery.size > _DIVERSITY_QUERY_CAP) {
    const oldest = _diversityBoostedByQuery.keys().next().value;
    if (oldest !== undefined) _diversityBoostedByQuery.delete(oldest);
  }
}

// Apply the kept NON-location filters (deal, type, rent period) to a fresh query on the right table.
// Location scoping is added by the caller (city / region / country-wide). Keeps every branch identical
// on the strict-contract fields. (filter contract.)
function keptFiltersReq(q: SearchQuery, table?: string) {
  const tbl = table ?? tableFor(q);
  let req = supabase!.from(tbl).select(LIST_SELECT).eq('active', true);
  if (!q.bothDeals) req = req.eq('transaction_type', q.deal === 'Buy' ? 'Buy' : 'Rent');
  const types = dbTypesFor(q);
  if (types && types.length) req = req.in('property_type', types);
  // Rent-period filter only when the deal is actually Rent — NOT for a "rent or buy" (bothDeals) search,
  // where a monthly filter would wrongly drop every Buy row (Buy has no rent_period). (audit bug.)
  // Rules (owner 2026-07-06, mirror of the location_search_candidates_ar backend fix):
  //  • MONTHLY: mixed platforms → strict rent_period='monthly'. Monthly-only platforms (Gathern, Aqar
  //    Monthly) → include ALL their rows (every listing is monthly, even rows with a null raw rent_period).
  //  • ANNUAL: strict rent_period='annual' only — a null rent_period on a mixed platform is NOT annual and
  //    must appear in NEITHER monthly nor annual (never guess).
  if (!q.bothDeals && q.deal === 'Rent' && q.rentPeriod === 'monthly') {
    if (!MONTHLY_ONLY_TABLE.test(tbl)) req = req.eq('rent_period', 'monthly');
  } else if (!q.bothDeals && q.deal === 'Rent' && q.rentPeriod === 'annual') {
    req = req.eq('rent_period', 'annual');
  }
  return req;
}

// A candidate row from the location index (the routing layer): just enough to find the exact raw row.
type Cand = { source_table: string; listing_id: number; platform: string; total_count?: number };

// Round-robin the candidates by platform (preserving each platform's newest-first order) so a broad
// search shows a balanced mix instead of the top being monopolised by the platforms that scrape most
// often. (user: "preserve platform diversity for broad searches.")
function interleaveByPlatform(cands: Cand[]): Cand[] {
  const groups = new Map<string, Cand[]>();
  for (const c of cands) {
    let g = groups.get(c.platform);
    if (!g) { g = []; groups.set(c.platform, g); }
    g.push(c);
  }
  const arrs = [...groups.values()];
  const out: Cand[] = [];
  for (let i = 0; out.length < cands.length; i++) {
    let progressed = false;
    for (const a of arrs) { if (i < a.length) { out.push(a[i]); progressed = true; } }
    if (!progressed) break;
  }
  return out;
}

// ── Adaptive, scope-aware result ordering ───────────────────────────────────────────────────────
// The RPC returns candidates already newest-first (true last_updated recency), so a candidate's INDEX
// is its recency rank — `listed` on the card is only a coarse human label ("today"/"2 months ago") and
// is NOT sortable. We keep that recency, then DIVERSIFY by geography according to how BROAD the search
// is, so a Region or country-wide search shows the whole market instead of 25 cards from one city. (user.)
//   District : newest only (recency wins — if the 25 newest are all one platform, that's fine).
//   City     : newest + platform diversity (no single platform monopolises the page).
//   Region   : city diversity → platform diversity → newest (every city in the region contributes).
//   Country  : region diversity → city diversity → platform diversity → newest (the whole Kingdom).
// Scope + the diversity-order algorithm itself (interleaveRanked/orderByScope) now live in the pure,
// zero-dependency @/lib/platformDiversity module (owner 2026-07-13 platform-diversity-first-page fix) so
// the exact reordering behavior is unit-testable without this file's react-native import chain. `Ranked`
// is this file's concrete instantiation of the generic `RankedRow<L>`.
type Ranked = RankedRow<Listing>;

function scopeOf(q: SearchQuery, cities: string[] | null, countryWide: boolean): Scope {
  if (countryWide) return 'country';
  const lm = q.locationMatch;
  if (lm?.kind === 'region') return 'region';
  // A name that matched several cities (e.g. "Al Rawdah" in Jeddah/Riyadh/Khobar) is searched across
  // all of them → diversify by city like a region. (user: search all matches, balanced.)
  if (lm?.ambiguous && lm.cities && lm.cities.length > 1) return 'region';
  if (cities && cities.length > 1) return 'region';
  if (q.districts && q.districts.length) return 'district';
  return 'city';
}

// Fetch the FULL card rows for a set of ids from ONE raw platform table, applying the kept server-side
// filters (transaction_type / property_type / rent period). Chunked because a `.in('id', […])` list
// can be long. Raw tables stay the source of truth — the index only told us WHICH rows to pull.
const ID_CHUNK = 200;
// RC-A (hardening 2026-07-13): supabase-js issues a plain fetch with NO request timeout, and no call
// here ever passed an AbortSignal — so a stalled TCP / overloaded-DB request never settled, `runQuery`
// bare-awaited it, and the «إزهله يبحث» loader spun forever with no recovery. `bounded()` wraps every
// Supabase query builder with a timeout + AbortController: on timeout it aborts the request and
// returns a {data:null, error} shaped exactly like a backend error, so the EXISTING `error → return
// null → retry UI` path fires instead of hanging. 15s matches the iframe guard in browser.tsx.
const RPC_TIMEOUT_MS = Number(process.env.EXPO_PUBLIC_RPC_TIMEOUT_MS) || 15000;
async function bounded<T = any>(builder: any, ms = RPC_TIMEOUT_MS): Promise<{ data: T | null; error: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await builder.abortSignal(ctrl.signal);
  } catch (e: any) {
    return { data: null, error: { message: String(e?.message || e), timeout: true } };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRawByIds(q: SearchQuery, tbl: string, ids: number[]): Promise<Listing[]> {
  const kind: SourceKind = tbl.includes('_commercial') ? 'com' : 'res';
  const out: Listing[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    // RC-A: capture the error (was silently dropped → a chunk that 500s produced a blank/partial grid
    // that contradicted the «لقينا N إعلان» headline). On any chunk failure, surface it so the caller
    // returns null → retry, rather than showing a misleadingly-short result set.
    const { data, error } = await bounded(keptFiltersReq(q, tbl).in('id', ids.slice(i, i + ID_CHUNK)).limit(ID_CHUNK));
    if (error) throw new Error(`fetchRawByIds(${tbl}): ${error.message}`);
    if (data) out.push(...finalize(data, kind));
  }
  return out;
}

// Per-search fetch — ROUTING LAYER (Phase 1.5). The buy/rent location index (a materialized view over
// the raw tables, refreshed by pg_cron) is queried for the location-scoped, purpose-split, newest-first,
// platform-diverse set of (source_table, listing_id). We then pull the FULL cards from the RAW tables by
// id — raw stays the single source of truth; the index only maps "location search → exact raw listing".
// Returns null on a backend error (UI shows retry), [] when the location genuinely has no listings.
// (user spec: route rent→rent_location_index, buy→buy_location_index, then fetch details from raw.)
export async function fetchListingsForQuery(q: SearchQuery, opts?: { offset?: number; limit?: number }): Promise<Listing[] | null> {
  _lastPageCandidates = 0;
  _lastPageTotal = 0;
  const pageOffset = Math.max(0, opts?.offset ?? 0);
  const pageLimit = opts?.limit ?? QUERY_LIMIT;
  if (!supabase) return null;
  // Location/table/region scope — shared with the advanced-filter option-count RPCs (resolveSearchScope).
  const scope = await resolveSearchScope(q);
  if (!scope) return [];
  const { isBroadCommercial, ...scopeParams } = scope;

  // 1) Ask the location index for the candidate set (newest-first, diverse, location + purpose filtered).
  // P0 FIX 2026-07-05: use the verified Arabic search RPC (reads the denormalized search_listings_ar,
  // single indexed scan ~0.2s even country-wide) instead of the legacy location_search_candidates
  // (matview joins ~1.3s) which timed out (HTTP 500) under DB load. Same output shape → card-fetch +
  // ranking unchanged. Only p_purpose('buy'/'rent') → p_deal('بيع'/'إيجار'). p_types stays client-side.
  // BROAD COMMERCIAL (owner 2026-07-09): the commercial matching set spans BOTH table kinds, so read it as ONE
  // filtered, paged, COUNTED stream via the RPC's two (tables,types) scopes — scope A (p_tables) = residential
  // tables constrained to commercial type_ar EXCL عمارة (Residential Building there); scope B = commercial tables
  // incl عمارة (Commercial Building there). This makes total_count EXACT and lets Load-More page the WHOLE set,
  // replacing the page-0-only, per-platform-capped res sweep that left ~77% of the inventory unreachable.

  // Shared filter params for BOTH the main recency-window call and the page-0 diversity-seed call below —
  // built once so the two calls can never drift apart (a diversity-seed row must satisfy the exact same
  // WHERE clause as the main pool, or Rule 1 — filter exactness — would be at risk). Spreads scopeParams
  // (from resolveSearchScope, computed once above) rather than re-deriving cities/tables/region/scopeB
  // locally — same single-source-of-truth reasoning as resolveSearchScope's own header comment.
  //
  // P0 HISTORY (2026-07-15): an earlier version of this block referenced `cities`/`mainTables`/`scopeB`/
  // `lm` as bare local variables that don't exist in this function's scope (their computation lives inside
  // resolveSearchScope). That shipped to production once — see PR #78/outage/PR #82 revert — throwing a
  // ReferenceError on every search, silently swallowed upstream, with the loading UI stuck forever and no
  // visible error. Verify this exact block against `git show <commit>:src/data/remote.ts` (not just the
  // working tree) before ever calling it tested again.
  const baseRpcParams = {
    ...scopeParams,
    ...rpcFilterParams(q),
    // Broad Commercial: override rpcFilterParams' p_types (null for a broad macro search) so the residential
    // scope is constrained to commercial type_ar; scope B carries the commercial-tables constraint. (2026-07-09)
    ...(isBroadCommercial ? { p_types: COMMERCIAL_TYPE_AR_RES } : {}),
    // Property-age advanced-filter answer (2026-07-13). IMPORTANT: only included when actually answered —
    // PostgREST resolves named-parameter RPC calls by exact parameter-name match, so unconditionally
    // sending p_is_new_construction breaks EVERY search with "function not found" until the backend
    // migration adding that parameter is deployed (caught live: this exact failure mode, before it ever
    // shipped). Shared here (not just the main call) so the page-0 diversity-seed call below also respects
    // any active age answer — a diversity-boosted row must satisfy the exact same WHERE clause as the main
    // pool (see comment above), or a listing outside the user's chosen age bucket could be pulled forward.
    ...(q.ageMin != null ? { p_age_min: q.ageMin } : {}),
    ...(q.ageMax != null ? { p_age_max: q.ageMax } : {}),
    ...(q.isNewConstruction != null ? { p_is_new_construction: q.isNewConstruction } : {}),
  };

  // RC-A rebase note (2026-07-16): main's baseRpcParams block above is the P0-fixed parameter source
  // (see the P0 HISTORY comment) — it is kept verbatim; the ONLY change here is the bounded() wrapper.
  const { data: cands, error } = await bounded<Cand[]>(supabase.rpc('location_search_candidates_ar', {
    ...baseRpcParams,
    // p_per_platform null → pure recency order, so Load-More offset paging is consistent + gap-free
    // (per-platform diversity is still applied client-side in runSearch). (owner 2026-07-08)
    p_per_platform: null,
    p_limit: pageLimit,
    p_offset: pageOffset,
  }));
  if (error) return null;                       // index error OR timeout (RC-A) → retry UI, not "no matches"
  _lastPageCandidates = (cands as Cand[] | null)?.length ?? 0;   // this page's matching-candidate count → drives Load-More offset/hasMore
  // EXACT total match count from the RPC's count(*) over() (same on every page); fall back to this page's
  // length if the column is missing. Captured from the MAIN call before any supplementary sweep. (owner 2026-07-08)
  _lastPageTotal = Number((cands as any[] | null)?.[0]?.total_count ?? 0) || ((cands as Cand[] | null)?.length ?? 0);
  if (!cands || !(cands as Cand[]).length) return [];

  // PLATFORM-DIVERSITY SEED — owner PERMANENT rule 2026-07-13 (Rule 2: the first page must show the
  // widest platform mix, never let one platform crowd out others that also have matches).
  // Root cause this fixes (SQL-verified against search_listings_ar, project aannarbkwcymrotzwdbo, on a
  // live Rent+Apartment+Riyadh search): the main call above is ONE global window ordered by
  // `last_updated DESC`, capped at pageLimit. When a platform's rows were all (re)scraped in the same run,
  // they share near-identical timestamps and can occupy the ENTIRE window — e.g. aqar's batch filled every
  // one of the first 1,500 ranked rows while wasalt (the LARGER platform for that exact filter: 6,458 vs
  // aqar's 3,238) had its freshest matching row rank 2,076th — outside the window entirely. No client-side
  // interleave (orderByScope/interleaveRanked) can diversify a platform it never received, so the first
  // page rendered 100% aqar. Fix: for page 0 only, when the main window is saturated (cands.length >=
  // pageLimit — a window that ISN'T full already contains every matching row, so no platform can be
  // missing), issue a second small call using the RPC's existing p_per_platform windowing to pull each
  // qualifying platform's own freshest rows regardless of global recency rank, and merge them into the
  // pool the diversify step actually sees. Load-More is untouched (still walks the main window by its own
  // real recency rank — offset math below is unaffected), and pulled-forward ids are remembered so a later
  // Load-More page never re-shows the same card (see diversityBoostedKeys below).
  let allCands: any[] = cands as any[];
  const diversityKey = JSON.stringify(q);
  if (pageOffset === 0 && allCands.length >= pageLimit) {
    const DIVERSITY_SEED_PER_PLATFORM = 20;
    const { data: seedCands } = await supabase.rpc('location_search_candidates_ar', {
      ...baseRpcParams,
      p_per_platform: DIVERSITY_SEED_PER_PLATFORM,
      p_limit: 2000, // generous cap: far more than DIVERSITY_SEED_PER_PLATFORM × (every known platform)
      p_offset: 0,
    });
    // Commit the boosted-key set to the map in ONE atomic write, built fresh from this call's own result
    // rather than read-then-mutate-in-place — two page-0 fetches for the identical query (diversityKey)
    // racing across this await could otherwise have the second call's reset silently orphan the first
    // call's in-flight Set, losing its boosted ids from the map entirely (real, if narrow, race caught in
    // adversarial review — the old pattern mutated a Set object fetched from the map BEFORE this await).
    if (seedCands && (seedCands as any[]).length) {
      const { merged, boostedKeys } = mergeDiversitySeed(allCands, seedCands as any[]);
      allCands = merged;
      noteDiversityQuery(diversityKey, boostedKeys);
    } else {
      noteDiversityQuery(diversityKey, new Set<string>());
    }
  } else if (pageOffset > 0) {
    // Load-More continuation: drop any candidate already shown via a page-0 diversity seed for this exact
    // query, so the same card never appears twice as the main window's offset later reaches that
    // platform's true rank.
    const priorBoostedKeys = _diversityBoostedByQuery.get(diversityKey);
    if (priorBoostedKeys && priorBoostedKeys.size) allCands = filterBoosted(allCands, priorBoostedKeys);
  }

  // 2) Keep the RPC's newest-first order (true last_updated recency); remember each candidate's recency
  //    rank, and group ids by source_table to fetch the full cards.
  const cleanCands = allCands.map((c, i) => ({
    source_table: c.source_table as string, listing_id: Number(c.listing_id), platform: c.platform as string, rank: i,
  }));
  // The index returns the ARABIC-CANONICAL location for every candidate (region_ar/city_ar/district_ar).
  // We display THAT — never the raw English/transliterated value underneath. (user: Arabic is canonical;
  // the displayed location must come only from the Arabic location DB.)
  const arLoc = new Map<string, { region: string; city: string; district: string }>();
  for (const c of allCands) {
    arLoc.set(`${c.source_table}:${Number(c.listing_id)}`, {
      region: (c.region_ar as string) || '', city: (c.city_ar as string) || '', district: (c.district_ar as string) || '',
    });
  }
  // NOTE (owner 2026-07-09): the former page-0-only broad-Commercial res sweep AND the facility-type
  // supplementary call are GONE. Both are now covered by the main stream above — broad Commercial via the two
  // (tables,types) scopes, and facility types via the normal filter-first path (kinds=BOTH → res+com tables,
  // p_types = facility type_ar, p_per_platform=null, paged). Everything the user can match is now a single
  // filtered, paged, count(*)-backed stream, so Load-More reaches the WHOLE set and total_count is exact.

  const byTable = new Map<string, number[]>();
  for (const c of cleanCands) {
    let a = byTable.get(c.source_table);
    if (!a) { a = []; byTable.set(c.source_table, a); }
    a.push(c.listing_id);
  }

  // 3) Fetch the full cards from the RAW tables by id (transaction_type / property_type / rent period applied
  // there). Broad-Commercial residential candidates are already commercial-only (RPC scope A constrained them
  // to commercial type_ar), so the plain by-id fetch returns exactly them — no separate type re-filter needed.
  const entries = [...byTable];
  let fetched: Listing[][];
  try {
    fetched = await Promise.all(entries.map(([tbl, ids]) => fetchRawByIds(q, tbl, ids)));
  } catch {
    return null;   // RC-A: a raw-card chunk failed or timed out → retry UI, not a misleadingly-partial grid
  }
  const map = new Map<string, Listing>();
  entries.forEach(([tbl], i) => { for (const l of fetched[i]) map.set(`${tbl}:${l.id}`, l); });

  // 4) Rebuild in newest-first order (dropping rows the raw filters / index↔raw drift removed), attach
  //    each row's city + region, then DIVERSIFY by geography according to the search scope so broad
  //    searches show the whole market, not 25 cards from one city/platform. (user: adaptive ordering.)
  const ranked: Ranked[] = [];
  for (const c of cleanCands) {
    const l = map.get(`${c.source_table}:${c.listing_id}`);
    if (!l) continue;
    // #1 (owner 2026-07-06, source-accurate): the CARD shows the RAW scraped location when it is already
    // Arabic (dealapp/wasalt); for English-raw sources (aqar) it shows the Arabic-canonical value that
    // matches the source site — never the English original. GROUPING/diversity still keys on the canonical
    // value (canonCity/canonDistrict) so spelling variants collapse. Layout + filters unchanged.
    const ar = arLoc.get(`${c.source_table}:${c.listing_id}`);
    const rawCity = l.city, rawDistrict = l.district;
    const canonCity = (ar?.city) || rawCity || '';
    const canonDistrict = (ar?.district) || '';
    // English raw city (aqar stores "Abha"/"Riyadh"…): prefer the resolved canonical, else map it to Arabic
    // via CITY_AR (arCity) so the card NEVER shows Latin when a mapping is known; only truly-unmapped cities
    // fall through to the raw value. (owner 2026-07-07: no Latin city/region on cards.) Fixes the ~41 cards
    // whose canonical was null (unresolved) and were showing raw Latin (أبها/محايل/بلسمر/أبو عريش/…).
    // JUNK_LOCATION_TOKENS guard (2026-07-10): a scraper-injected sentinel like the literal word
    // "Other" has no Arabic chars, so it falls into this (non-Arabic) branch same as a real English
    // city would — without the guard it rides the final `|| rawCity` all the way to the card. Swap
    // it for '' up front so every fallback below (arCity's own `|| en`, and this line's own
    // `|| rawCity`) sees an empty string instead of the junk token, and the card ends up honestly
    // unresolved (ResultCard/agent.tsx render the neutral «الموقع غير محدد») rather than "Other". A
    // genuine, if unmapped, raw city name is untouched — this only fires for a known junk token.
    const safeRawCity = isJunkLocationToken(rawCity) ? '' : rawCity;
    l.city = /[ء-ي]/.test(rawCity || '') ? rawCity : ((ar?.city) || arCity(safeRawCity) || safeRawCity || '');
    l.district = /[ء-ي]/.test(rawDistrict || '') ? rawDistrict : ((ar?.district) || '');
    l.regionAr = (ar?.region) || l.regionAr || '';
    const region = (ar?.region) || CITY_TO_REGION[canonCity] || canonCity;
    ranked.push({ l, platform: c.platform, city: canonCity, region, district: canonDistrict, rank: c.rank, source_table: c.source_table });
  }
  const USE_RELATION_TABLE = true;
  // multiType → spread across the picked clean types (cleanType diversity key). True for a genuine
  // multi-select AND for a subgroup box like «مرافق خدمية» that expands to 5 member types, so its results
  // come out as a balanced MIX of the five rather than clumped by one type. (owner 2026-07-07)
  const multiType = (q.types?.length ?? 0) > 1 || (q.types ?? []).some((t) => (SUBGROUPS[t]?.length ?? 0) > 1);
  const scoped = orderByScope(ranked, scopeOf(q, scope.p_cities, isCountryWideQuery(q)), multiType);
  const rows = scoped.map((r) => r.l);
  // Location-RELATIONSHIP ranking (2026-06-27): when the user expressed a proximity intent
  // («قريب من مستشفى الحبيب» / «يطل على البحر»), ATTACH a boost score to every candidate so the
  // ranking step in runSearch can lead with the listings that express that same relationship+entity.
  // NB: reordering `rows` here is pointless — runSearch re-sorts from scratch (recency + rankResults),
  // so the boost MUST travel on the listing object and be consumed there. (live-path fix.)
  if (q.proximity && q.proximity.length) {
    if (!USE_RELATION_TABLE) {
      // OFF: runtime text scorer.
      const blobOf = (l: Listing) => [l.title, l.description, l.street_name, l.district, l.direction,
        l.project_name, l.road, ...((l.additional_info ?? []).map((a) => a.value))].filter(Boolean).join(' ');
      for (const r of scoped) r.l.proximityBoost = scoreListingProximity(blobOf(r.l), q.proximity!);
    } else {
      // ON: precomputed listing_location_relations via the loc_rel_rank RPC.
      const intents = q.proximity!.map((p) => ({
        group: relGroupOf(p.relationship),
        phrase: p.phrase,
        category_en: p.category || null,
        name: p.name || null,
      }));
      const st  = scoped.map((r) => r.source_table);
      const ids = scoped.map((r) => r.l.id);
      const bmap = new Map<string, number>();
      let rpcCount = 0;
      let rpcErr: unknown = null;
      try {
        if (supabase) {
          const { data: boosts, error } = await supabase.rpc('loc_rel_rank', {
            p_source_tables: st, p_listing_ids: ids, p_intents: intents,
          });
          if (error) rpcErr = error;
          for (const b of (boosts ?? [])) bmap.set(`${b.source_table}:${Number(b.listing_id)}`, Number(b.boost));
          rpcCount = (boosts ?? []).length;
        }
      } catch (e) {
        rpcErr = e;
      }
      for (const r of scoped) r.l.proximityBoost = bmap.get(`${r.source_table}:${r.l.id}`) ?? 0;
    }
  }
  cacheListings(rows);
  return rows;
}

// Resolve a single listing by id (in-app browser deep-links / a listing not in the current subset).
export async function fetchListingById(id: number): Promise<Listing | null> {
  const hit = LISTING_CACHE.get(id);
  if (hit) return hit;
  if (!supabase) return null;
  // All four tables share one id sequence, so an id is unique across them. Try residential first
  // (far larger), then commercial; try Aqar before Wasalt only because Aqar is bigger.
  for (const table of [
    'aqar_residential_listings', 'aqar_commercial_listings',
    'wasalt_residential_listings', 'wasalt_commercial_listings',
    'gathern_residential_listings',
    'aldarim_residential_listings', 'aldarim_commercial_listings',
    'aqargate_residential_listings', 'aqargate_commercial_listings',
    'alhoshan_residential_listings', 'alhoshan_commercial_listings',
    'hajer_residential_listings', 'hajer_commercial_listings',
    'sanadak_residential_listings', 'sanadak_commercial_listings',
    'eastabha_residential_listings', 'eastabha_commercial_listings',
    'aqarcity_residential_listings', 'aqarcity_commercial_listings',
    'raghdan_residential_listings', 'raghdan_commercial_listings',
    'eaqartabuk_residential_listings', 'eaqartabuk_commercial_listings',
    'satel_residential_listings', 'satel_commercial_listings',
    'sadin_residential_listings', 'sadin_commercial_listings',
    'toor_residential_listings', 'toor_commercial_listings',
    'mustqr_residential_listings', 'mustqr_commercial_listings',
    'ramzalqasim_residential_listings', 'ramzalqasim_commercial_listings',
    'fursaghyr_residential_listings', 'fursaghyr_commercial_listings',
    'jazwtn_residential_listings', 'jazwtn_commercial_listings',
    'mizlaj_residential_listings', 'mizlaj_commercial_listings',
    'muktamel_residential_listings', 'muktamel_commercial_listings',
    'aqaratikom_residential_listings', 'aqaratikom_commercial_listings',
    'awal_residential_listings', 'awal_commercial_listings',
    'alkhaas_residential_listings', 'alkhaas_commercial_listings',
    'abeea_residential_listings', 'abeea_commercial_listings',
    'jurash_residential_listings', 'jurash_commercial_listings',
    'alnokhba_residential_listings', 'alnokhba_commercial_listings',
    'dealapp_residential_listings', 'dealapp_commercial_listings',
    
    'erapulse_residential_listings', 'erapulse_commercial_listings',
    'nowaisiry_residential_listings', 'nowaisiry_commercial_listings',
    'october_residential_listings', 'october_commercial_listings',
    'souq24_residential_listings', 'souq24_commercial_listings',
  ]) {
    const { data, error } = await supabase.from(table).select(LIST_SELECT).eq('id', id).limit(1);
    if (error || !data || !data.length) continue;
    const [row] = finalize(data, table.includes('_commercial') ? 'com' : 'res');
    if (row) { LISTING_CACHE.set(row.id, row); return row; }
  }
  return null;
}

// Fetches the REAL Aqar listings + every column the new card design needs (rank/photo/title/
// All columns the rich card design needs (rank/photo/title/price/RNPL badge/stat row/features grid).
// Shared by every fetch so the row shape is consistent.
const LIST_SELECT = [
  'id', 'ad_number', 'listing_url',
  'property_type', 'transaction_type',
  'city', 'neighborhood',
  'price_annual', 'price_total', 'rent_period',
  'area_m2', 'bedrooms', 'bathrooms',
  'master_bedrooms', 'halls', 'reception_rooms_majlis',
  'property_age', 'direction', 'street_name', 'residence_type', 'project_name',
  'parking', 'elevator', 'kitchen', 'maid_room', 'driver_room',
  'air_conditioner', 'water_supply', 'electricity', 'sanitation',
  'private_entrance', 'optical_fibers', 'laundry_room', 'balcony_terrace',
  'photo_urls',
  'date_added',
  'rent_now_pay_later', 'rent_now_pay_later_monthly',
  // CRITICAL: source must come from the DB row (rows in wasalt_* tables have source='Wasalt'),
  // not hardcoded — otherwise the card lies about "Hosted on AQAR" while linking to wasalt.sa.
  'source', 'rega_location_verified',
  // Wasalt's "Additional Information" panel (Property usage / Age / Facade / Street / Ad source /
  // Plan number / Land number / ...) — jsonb of {key,label,value}[]. Aqar rows leave it NULL.
  'additional_info',
  // Free-text fields for the street / "near X" search (Q3) — present on all 63 platform tables.
  'title', 'description',
].join(', ');

// Map raw DB rows → in-app `Listing` shape. `kind` = which table-kind the rows came from (res/com),
// needed to normalize the ambiguous "Building" type (residential vs commercial) into the clean type.
function finalize(rows: any[], kind: SourceKind = 'res'): Listing[] {
  return rows.map((r: any): Listing => {
    const deal: Deal = r.transaction_type === 'Buy' ? 'Buy' : 'Rent';
    // Normalize the raw scraped property_type → {macro_category, clean_property_type}. The card shows
    // `cleanType`; `type` keeps the raw value for the engine + debugging. (clean-type filter, step 2.)
    const norm = normalizeType(r.property_type, kind);
    // A genuinely MONTHLY rental → show its monthly figure (price_annual was stored as monthly×12, so
    // dividing back gives the exact monthly rent). Annual rentals keep the yearly figure. (user request.)
    const isMonthlyRent = deal === 'Rent' && r.rent_period === 'monthly' && typeof r.price_annual === 'number';
    const amount = deal === 'Rent'
      ? (isMonthlyRent ? Math.round(r.price_annual / 12) : r.price_annual)
      : r.price_total;
    const priceStr =
      typeof amount === 'number'
        ? `SAR ${amount.toLocaleString('en-US')}${deal === 'Rent' ? (isMonthlyRent ? '/mo' : '/yr') : ''}`
        : 'Price on request';
    const photo = Array.isArray(r.photo_urls) && r.photo_urls.length > 0 ? r.photo_urls[0] : '';
    return {
      id: Number(r.id),
      type: r.property_type ?? 'Apartment',
      cleanType: norm.clean,
      macro: norm.macro,
      deal,
      // JUNK_LOCATION_TOKENS guard (2026-07-10 location-data-quality audit): this path (a listing
      // not already in the ranked-candidates cache — deep link / direct id lookup) has no arLoc/index
      // correction at all, so a raw junk `city` would otherwise reach the card completely unguarded.
      // A genuine, unmapped city name still passes through untouched.
      city: isJunkLocationToken(r.city) ? '' : (r.city ?? ''),
      district: r.neighborhood ?? '',
      road: r.street_name ?? '',
      price: priceStr,
      area: r.area_m2 ?? 0,
      beds: r.bedrooms ?? 0,
      // CRITICAL: source comes from the DB row, never hardcoded — the card's logo, "Hosted on X",
      // and click-through hostname all derive from it. Wasalt rows have source='Wasalt'.
      source: r.source ?? 'Aqar',
      rentPeriod: deal === 'Rent' ? (r.rent_period ?? 'annual') : null,
      listed: r.date_added ?? 'recently',
      photo,
      source_url: r.listing_url,
      // Rich extras for the new card design — all optional, fall back to safe defaults.
      ad_number: r.ad_number,
      bathrooms: r.bathrooms ?? 0,
      master_bedrooms: r.master_bedrooms ?? 0,
      halls: r.halls ?? 0,
      reception_rooms_majlis: r.reception_rooms_majlis ?? 0,
      property_age: r.property_age ?? null,
      direction: r.direction ?? null,
      street_name: r.street_name ?? null,
      title: r.title ?? null,
      description: r.description ?? null,
      residence_type: r.residence_type ?? null,
      project_name: r.project_name ?? null,
      driver_room: !!r.driver_room,
      rega_location_verified: !!r.rega_location_verified,
      additional_info: buildAdditionalInfo(r.additional_info),
      photos: Array.isArray(r.photo_urls) ? r.photo_urls : [],
      rent_now_pay_later: !!r.rent_now_pay_later,
      rent_now_pay_later_monthly: r.rent_now_pay_later_monthly ?? null,
      features: {
        parking: !!r.parking,
        elevator: !!r.elevator,
        kitchen: !!r.kitchen,
        maid_room: !!r.maid_room,
        master_bedrooms: (r.master_bedrooms ?? 0) > 0,
        halls: (r.halls ?? 0) > 0,
        air_conditioner: !!r.air_conditioner,
        water_supply: !!r.water_supply,
        electricity: !!r.electricity,
        sanitation: !!r.sanitation,
        private_entrance: !!r.private_entrance,
        optical_fibers: !!r.optical_fibers,
        laundry_room: !!r.laundry_room,
        balcony_terrace: !!r.balcony_terrace,
      },
    };
  });
}

// Pulls a varied sample of REAL (type, deal, city, district) combos from the active scraped data,
// and formats them as natural-language prompt strings the user can tap. Both language variants are
// built from the same row so the EN and AR pools stay in sync — Arabic district stays Arabic,
// English UI gets it transliterated ("حي العليا" → "Al Olaya"). Diversified across property types
// so the chips don't all read "apartment, apartment, apartment". Returns null on any failure → the
// caller falls back to the static EN_POOL/AR_POOL in examplePrompts.ts. (user request: pull example
// prompts from the database, include unique things.)
export type PromptIdea = { en: string; ar: string };
export async function fetchPromptIdeas(): Promise<PromptIdea[] | null> {
  if (!supabase) return null;
  // Limit ~600 — wide enough for a good cross-section of types/cities/districts without hammering
  // the DB. We then de-dupe by (type, city, district) and round-robin across types so the final
  // sample isn't dominated by the most common combo.
  const { data, error } = await supabase
    .from('aqar_residential_listings')
    .select('property_type, transaction_type, city, neighborhood')
    .eq('active', true)
    .not('neighborhood', 'is', null)
    .order('id', { ascending: false })
    .limit(600);
  if (error || !data) return null;

  // De-dupe and bucket by property_type so we can round-robin for diversity.
  const seen = new Set<string>();
  const byType = new Map<string, Array<{ type: string; deal: string; city: string; district: string }>>();
  for (const r of data as any[]) {
    const type = String(r.property_type ?? '').trim();
    const deal = r.transaction_type === 'Buy' ? 'Buy' : 'Rent';
    const city = String(r.city ?? '').trim();
    const district = String(r.neighborhood ?? '').trim();
    if (!type || !city || !district) continue;
    const key = `${type}|${deal}|${city}|${district}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bucket = byType.get(type) ?? [];
    bucket.push({ type, deal, city, district });
    byType.set(type, bucket);
  }
  // Shuffle inside each bucket, then round-robin take one from each until exhausted — this gives
  // type-diverse output instead of 20 apartments + 1 villa.
  const shuffled = Array.from(byType.values()).map((arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  });
  const out: PromptIdea[] = [];
  let added = true;
  while (added && out.length < 80) {
    added = false;
    for (const bucket of shuffled) {
      const next = bucket.shift();
      if (!next) continue;
      added = true;
      const dEN = next.deal === 'Buy' ? 'for sale' : 'for rent';
      const dAR = next.deal === 'Buy' ? 'للبيع' : 'للإيجار';
      const districtEN = translitPlace(next.district);
      const cityEN = translitPlace(next.city);
      // Avoid the "حي" prefix doubling — translitPlace already strips it in the dict path.
      const districtARStripped = next.district.replace(/^حي\s+/, '');
      // 2026-07-13 production audit: this used to interpolate the raw DB `next.city` (English,
      // e.g. "Riyadh") straight into the Arabic half — every single AI-agent example prompt showed
      // an English city name inside an Arabic sentence. cityDisplay() is the same guarded lookup
      // used everywhere else in the app for this exact purpose (and self-guards its own fallback).
      const cityAR = cityDisplay(next.city, 'ar');
      out.push({
        en: `${next.type} ${dEN} in ${districtEN}, ${cityEN}`,
        ar: `${typeToArabic(next.type)} ${dAR} في ${districtARStripped}، ${cityAR}`,
      });
      if (out.length >= 80) break;
    }
  }
  return out;
}

// Arabic label for a property type, used to build the AR prompt half.
// 2026-07-13 production audit: this was a hand-rolled 11-case switch that had drifted out of sync
// with the canonical EN_TO_AR map (src/data/propertyTypes.ts, 39 keys, already deploy-gated by
// scripts/verify-taxonomy.ts) — e.g. 'Industrial Land' fell to `default: return t`, leaking the raw
// English words into an Arabic sentence. Reusing EN_TO_AR directly means there is only ONE place
// that maps a property type to Arabic; arabicOrPlaceholder is a safety net for any type EN_TO_AR
// itself hasn't caught up to yet (a future new raw type), never a real translation fallback.
function typeToArabic(t: string): string {
  return arabicOrPlaceholder(EN_TO_AR[t] ?? t, 'ar', TYPE_UNRESOLVED_AR);
}
