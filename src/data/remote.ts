import { supabase } from '@/lib/supabase';
import type { Listing } from './listings';
import { type Deal } from './taxonomy';
import type { SearchQuery } from './search';
import { REGIONS, CITY_TO_REGION, isCountryWideQuery, interleave } from './regions';
import { translitPlace } from '@/lib/translitPlace';
import { normalizeType, queryForSelection, queryForTypes, SUBGROUPS, CLEAN_MACRO, CLEAN_TO_TYPE_AR, EN_TO_AR, typeArForTypes, typeArForSelection, type CleanQuery, type SourceKind, type Macro } from './propertyTypes';
import { effectiveTypes, effectiveGroups, bedroomTokens } from './search';
import { scoreListingProximity } from './proximity';
import { cityDisplay } from './locations';
import { arabicOrPlaceholder } from '@/lib/arabicText';
import { TYPE_UNRESOLVED_AR } from '@/i18n';
import { orderByScope, type Scope, type RankedRow } from '@/lib/platformDiversity';
import saLocations from './sa-locations.json';

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

// Bug-fix (P0, audit `duplicate-city-false-empty` 2026-07-18): CITY_AR above is a hand-maintained
// dictionary that has drifted out of sync with the catalog's actual spellings — e.g. it has 'hofuf'
// but the catalog spells the city "Al Hafuf"; it has 'al quwayiyah' but the catalog spells it "Al
// Quway'iyah" (apostrophe); it has 'al baha'/'al bahah' but one of the two real الباحة catalog rows
// is bare "Bahah" (no article). Any city whose catalog spelling doesn't happen to match a hand-typed
// CITY_AR key fell through to `|| en`, sending the untranslated ENGLISH name to the Arabic-indexed
// search RPC → a false, silent "no listings" for a real city (confirmed live: 758/280/740 hidden
// rows for these three; up to ~1,003 twin-named catalog cities share this gap).
//
// Fix: derive a second lookup DIRECTLY from sa-locations.json's own [city_id, region_id, name_en,
// name_ar] rows — the catalog already carries the correct Arabic spelling for every city it lists,
// so this can never drift out of sync the way a separate hand-typed dictionary can. Built once at
// module load (4,581 rows, negligible cost). Where a handful of catalog rows share the same English
// name with two DIFFERING Arabic spellings (39 cases, all minor transliteration variants like
// الأخضر/الاخضر — not different cities), first-occurrence wins, deterministically.
const CITY_AR_FROM_CATALOG: Record<string, string> = {};
for (const row of (saLocations as unknown as { cities: [number, number, string, string][] }).cities) {
  const key = row[2].trim().toLowerCase();
  if (!(key in CITY_AR_FROM_CATALOG)) CITY_AR_FROM_CATALOG[key] = row[3];
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
  const stripped = k.replace(/^(?:al|at|ad|as|ar|az|an|ash)\s+/, '');
  return CITY_AR[k] || CITY_AR[stripped]
    || CITY_AR_FROM_CATALOG[k] || CITY_AR_FROM_CATALOG[stripped]
    || en;
}

// Every Arabic-canonical CITY name we know (hand dict + full catalog), used ONLY by the Gathern
// district-fallback guard below to reject a value that is actually a city sitting in the district
// slot. Built once at module load from the same two sources arCity() trusts. (Gathern Tier-1.)
const KNOWN_CITY_AR_SET: Set<string> = new Set<string>([
  ...Object.values(CITY_AR),
  ...Object.values(CITY_AR_FROM_CATALOG),
].map((s) => (s ?? '').trim()).filter(Boolean));

// Gathern-only district fallback: when the canonical location index has NO district for a row (≈4,147
// live) and the raw neighborhood isn't Arabic, the card shows «الحي غير محدد» even though the source's
// own additional_info.district_ar (e.g. "حي العليا") is already stored. Surface THAT — display-only,
// never for grouping (canonical index stays the match key). Conservative city-name guard: the value
// must be a real Arabic token, must not equal this row's own city_ar, and must not itself be a known
// city name. Returns null for every non-Gathern source (naturally byte-identical elsewhere). (Tier-1.)
function gathernDistrictFallback(source: any, rawInfo: any): string | null {
  if (!(typeof source === 'string' && source.toLowerCase().includes('gathern'))) return null;
  if (!rawInfo || typeof rawInfo !== 'object' || Array.isArray(rawInfo)) return null;
  const d = String(rawInfo.district_ar ?? '').trim();
  if (!d || !/[ء-ي]/.test(d)) return null;                    // must be a real Arabic district token
  const cityAr = String(rawInfo.city_ar ?? '').trim();
  if (cityAr && d === cityAr) return null;                     // equals this row's city → not a district
  if (KNOWN_CITY_AR_SET.has(d)) return null;                  // a known city name in the district slot → reject
  return d;
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
  // MULTI-GROUP: queryForTypes unions over its argument list and accepts GROUP names as well as clean
  // types, so several groups resolve to the union of their raw types — OR across the group dimension,
  // through the one existing helper rather than a second expansion path. (owner 2026-08-20)
  const groups = effectiveGroups(q);
  if (groups.length) return groups.length === 1 ? queryForSelection(groups[0]) : queryForTypes(groups);
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
    if (q.rentPeriod === 'both') return amount;     // both → annual basis (the unit that spans periods)
    if (q.rentPeriod === 'monthly') return amount * 12;
    return amount <= 25_000 ? amount * 12 : amount; // agent magnitude heuristic (matches priceFilter)
  }
  return amount > 50_000 ? amount : null;           // Buy: only a fixed total ceiling maps (per-m² stays client-side)
}

// The cohort's Arabic type array — THE single definition shared by the search RPC params below and
// the Trending city/district pools (locations.ts). One definition means trending and search cannot
// disagree about what a selected type/group expands to (owner barriers #7/#17/#18, 2026-08-15).
export function cohortTypesAr(q: SearchQuery): string[] | null {
  const sel = effectiveTypes(q);
  if (sel.length) return typeArForTypes(sel);
  const groups = effectiveGroups(q);
  return groups.length ? typeArForTypes(groups) : null;   // OR across groups — union of their types
}

function rpcFilterParams(q: SearchQuery) {
  const p_types = cohortTypesAr(q);
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
    // Real server-side ordering (2026-07-27 fix) for the sort keys the RPC now understands — it then
    // orders the FULL matching set before LIMIT/OFFSET, not just the recency-capped page. 'newest'/
    // undefined need no param (NULL reproduces the RPC's own default order). ppm_asc/ppm_desc stay
    // client-side-only (RPC has no derived-ppm sort — see the migration's own comment on why that's
    // deliberate); sortListings() in search.ts still re-sorts the fetched page for those two, same as
    // before this fix.
    ...(RPC_SORT_KEYS.has(q.sort as string) ? { p_sort_by: q.sort } : {}),
  };
}

// Filter params for the COUNT RPCs (property_age_option_counts_ar / apartment_guided_counts_ar).
// Neither accepts p_sort_by — counts have no ordering — and PostgREST resolves named-param RPC calls
// by EXACT parameter-name match, so leaking it made BOTH counts calls 404 (PGRST202) the moment the
// user had an explicit sort active, silently killing the whole guided flow (bug-hunt 2026-07-30).
function rpcCountFilterParams(q: SearchQuery) {
  const { p_sort_by: _drop, ...rest } = rpcFilterParams(q) as ReturnType<typeof rpcFilterParams> & { p_sort_by?: string };
  return rest;
}
const RPC_SORT_KEYS = new Set(['oldest', 'price_asc', 'price_desc', 'area_asc', 'area_desc', 'beds_desc']);

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
//
// In-flight de-dup (2026-08-14, perf): the advanced-filter question pool fires up to 5 questions in
// one Promise.all every re-rank cycle, and 4 of them independently call resolveSearchScope(q) before
// their own RPC — for a district-scoped search that means up to 4 redundant resolve_district_cities
// round trips where 1 suffices. Keyed on the district list itself (the only input this specific RPC
// call depends on) so concurrent identical lookups share one promise; unrelated concurrent lookups
// (different districts) are unaffected, and nothing is cached past settlement. Same helper reused
// below by fetchPropertyAgeOptionCounts()/fetchApartmentGuidedCounts() for the same reason.
function dedupeInFlight<T>(cache: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
  const existing = cache.get(key);
  if (existing) return existing;
  const p = run().finally(() => { if (cache.get(key) === p) cache.delete(key); });
  cache.set(key, p);
  return p;
}
const inFlightDistrictCities = new Map<string, Promise<{ data: { city_ar: string; match_count: number }[] | null; error: unknown }>>();

export async function resolveSearchScope(q: SearchQuery): Promise<SearchScope | null> {
  const tables = tablesFor(q);
  if (!tables.length) return null;
  const isBroadCommercial = q.category === 'Commercial' && !q.type && !(q.types && q.types.length) && !effectiveGroups(q).length;

  const lm = q.locationMatch;
  let cities: string[] | null = null;
  if (q.regionPin && (q.location || '').trim()) {
    cities = [arCity(q.location) || q.location];
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
  // themselves). STRICT `cities === null` (not `!cities.length`) — an ALREADY-DISAMBIGUATED locationMatch
  // (the `lm?.ambiguous` branch above, restricted to its own identified candidate cities) leaves
  // `cities` non-null, so that verdict is never re-litigated through this block's differently-tuned
  // threshold. FIXED 2026-07-24 (found live): an earlier version of the ambiguous branch set
  // `cities = []` (→ p_cities:null, i.e. UNRESTRICTED) instead of the candidate list, and because
  // `q.districts` is non-empty in this exact case, the honest-zero guard a few lines below (which only
  // fires when districts is empty) never caught it either — a bare multi-city district reached via the
  // AI-agent chat path (agent.tsx's 2-strike fallback) silently searched every city nationwide instead
  // of restricting to the real candidates or honest-zeroing.
  if (cities === null && q.districts && q.districts.length && supabase) {
    const { data: districtCities, error: districtCitiesError } = await dedupeInFlight(
      inFlightDistrictCities,
      JSON.stringify(q.districts),
      async () => {
        const r = await supabase!.rpc('resolve_district_cities', { p_districts: q.districts });
        return { data: r.data as { city_ar: string; match_count: number }[] | null, error: r.error };
      },
    );
    if (districtCitiesError) return null;        // RPC failure ≠ genuine zero matches — give up, don't fall through unrestricted
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

  const isBroadResidential = q.category === 'Residential' && !q.type && !(q.types && q.types.length) && !effectiveGroups(q).length;
  const resSel = effectiveTypes(q);
  const resGroups = effectiveGroups(q);
  const resSelectedTypeAr = resSel.length ? typeArForTypes(resSel) : (resGroups.length ? typeArForTypes(resGroups) : null);
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
    p_cities: cities && cities.length ? cities : null,
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
//
// In-flight de-dup (2026-08-14, perf, dedupeInFlight defined above resolveSearchScope): rankQuestions()
// Promise.all-fires the whole advanced-question pool every re-rank cycle; this function and
// fetchApartmentGuidedCounts() below are the two RPCs that batch drives. Collapsing CONCURRENT calls
// with identical `q` onto one shared promise cuts redundant round trips with zero behavior change —
// a later call (different q, or once this one settles) always gets a fresh fetch; nothing is cached
// past settlement.
const inFlightAgeCounts = new Map<string, Promise<AgeOptionCounts | null>>();

export async function fetchPropertyAgeOptionCounts(q: SearchQuery): Promise<AgeOptionCounts | null> {
  if (!supabase) return null;
  const scope = await resolveSearchScope(q);
  if (!scope) {
    return { cnt_new: 0, cnt_1_2: 0, cnt_3_5: 0, cnt_6_9: 0, cnt_10p: 0, cnt_unknown: 0, cnt_total: 0, platform_breakdown: null };
  }
  const { isBroadCommercial, ...scopeParams } = scope;
  return dedupeInFlight(inFlightAgeCounts, JSON.stringify(q), async () => {
    if (!supabase) return null;
    const result = await withTimeout(
      supabase.rpc('property_age_option_counts_ar', {
        ...scopeParams,
        ...rpcCountFilterParams(q),
        ...(isBroadCommercial ? { p_types: COMMERCIAL_TYPE_AR_RES } : {}),
        // Carry forward any earlier-answered guided-flow question (e.g. RNPL) — found live 2026-07-24:
        // without this, the age-bucket badges shown here silently ignored an already-selected amenities
        // filter, showing counts far larger than what Search (and apartment_guided_counts_ar, which
        // already receives these) actually returns for the same combination. Same pattern as
        // fetchApartmentGuidedCounts() below; the RPC's own p_amenities/p_bath_min default to NULL
        // (no-op) so an unanswered question never affects a call that omits them.
        ...(q.amenities?.length ? { p_amenities: q.amenities } : {}),
        ...(q.bathMin != null ? { p_bath_min: q.bathMin } : {}),
        ...(q.furnishedPref != null ? { p_furnished: q.furnishedPref } : {}),
        ...(q.streetWidthMin != null ? { p_street_width_min: q.streetWidthMin } : {}),
        ...(q.directions?.length ? { p_directions: q.directions } : {}),
        ...(q.ratingMin != null ? { p_rating_min: q.ratingMin } : {}),
        ...(q.reviewsMin != null ? { p_reviews_min: q.reviewsMin } : {}),
        ...(q.unitSubtypes?.length ? { p_unit_subtypes: q.unitSubtypes } : {}),
      }),
      AGE_COUNT_TIMEOUT_MS,
    );
    if ('timedOut' in result) return null;
    const { data, error } = result;
    if (error || !data || !(data as AgeOptionCounts[]).length) return null;
    return (data as AgeOptionCounts[])[0];
  });
}

// Annual-Rent apartment guided flow (2026-07-20): one scope-respecting count row that powers the RNPL,
// amenities, and min-bathrooms questions. `cnt_total_base` = the scope total BEFORE this question's own
// selection (drives the ≥150 gate). The per-option counts (cnt_rnpl/kitchen/parking/elevator/furnished,
// cnt_bath1..4) are STRICT standalone availabilities within that base — they IGNORE the passed
// p_amenities/p_bath_min so a chip's number stays stable as the user toggles. `cnt_selected` DOES honor
// the passed p_amenities (strict) + p_bath_min (strict >= N, unknown excluded) — that is the live count
// shown on the amenities continue button. Same scope resolution + predicate as the search RPC, so the
// number always equals what Search returns. RPC error/timeout → null (caller skips the question).
export type GuidedCounts = {
  cnt_total_base: number;
  cnt_rnpl: number;
  cnt_kitchen: number;
  cnt_parking: number;
  cnt_elevator: number;
  cnt_furnished: number;
  // Added 2026-08-10 once air_conditioner / private_entrance reached search on more than one
  // platform. A chip may only exist when its COUNT path exists — that is the whole contract.
  cnt_ac: number;
  cnt_private_entrance: number;
  cnt_unfurnished: number;
  cnt_maid_room: number;
  cnt_driver_room: number;
  cnt_bath1: number;
  cnt_bath2: number;
  cnt_bath3: number;
  cnt_bath4: number;
  // Cohort expansion 2026-08-15: direction + street-width counts (ResBldg/Apartment-Buy questions).
  cnt_dir_n: number; cnt_dir_s: number; cnt_dir_e: number; cnt_dir_w: number;
  cnt_dir_ne: number; cnt_dir_nw: number; cnt_dir_se: number; cnt_dir_sw: number;
  cnt_stw15: number; cnt_stw20: number; cnt_stw25: number; cnt_stw30: number;
  // Villa cohort 2026-08-16: aqar villa-form chips (مدخل سيارة / صرف صحي).
  cnt_car_entrance: number; cnt_sanitation: number;
  // Commercial expansion 2026-08-16: the utility chips the commercial market actually splits on.
  cnt_electricity: number; cnt_water_supply: number;
  cnt_selected: number;
  // Monthly (2026-08-18): Gathern rating thresholds + unit-subtype chips. Data-derived cuts on the
  // source-declared 1-10 scale — the only ones that split the distribution (<=8.0 keeps ~94%).
  cnt_rating95: number; cnt_rating90: number; cnt_rating90_rc10: number;
  cnt_sub_studio: number; cnt_sub_serviced: number; cnt_sub_regular: number;
};

// De-duped per the comment above fetchPropertyAgeOptionCounts — this is the function RNPL/amenities/
// bathrooms/furnished all call with identical params in the same Promise.all batch.
const inFlightGuidedCounts = new Map<string, Promise<GuidedCounts | null>>();

export async function fetchApartmentGuidedCounts(q: SearchQuery): Promise<GuidedCounts | null> {
  if (!supabase) return null;
  const scope = await resolveSearchScope(q);
  if (!scope) return null;
  const { isBroadCommercial, ...scopeParams } = scope;
  return dedupeInFlight(inFlightGuidedCounts, JSON.stringify(q), async () => {
    if (!supabase) return null;
    const result = await withTimeout(
      supabase.rpc('apartment_guided_counts_ar', {
        ...scopeParams,
        ...rpcCountFilterParams(q),
        ...(isBroadCommercial ? { p_types: COMMERCIAL_TYPE_AR_RES } : {}),
        ...(q.ageMin != null ? { p_age_min: q.ageMin } : {}),
        ...(q.ageMax != null ? { p_age_max: q.ageMax } : {}),
        ...(q.isNewConstruction != null ? { p_is_new_construction: q.isNewConstruction } : {}),
        ...(q.amenities?.length ? { p_amenities: q.amenities } : {}),
        ...(q.bathMin != null ? { p_bath_min: q.bathMin } : {}),
        ...(q.furnishedPref != null ? { p_furnished: q.furnishedPref } : {}),
        ...(q.streetWidthMin != null ? { p_street_width_min: q.streetWidthMin } : {}),
        ...(q.directions?.length ? { p_directions: q.directions } : {}),
      }),
      AGE_COUNT_TIMEOUT_MS,
    );
    if ('timedOut' in result) return null;
    const { data, error } = result;
    if (error || !data || !(data as GuidedCounts[]).length) return null;
    return (data as GuidedCounts[])[0];
  });
}

// Live count for the amenities continue button: re-runs the guided count with the tentative amenity
// selection merged in and returns just `cnt_selected`. Returns null on error so the card can hold the
// previous number rather than flashing a wrong one.
export async function fetchGuidedLiveCount(q: SearchQuery, amenities: string[], bathMin: number | null): Promise<number | null> {
  const counts = await fetchApartmentGuidedCounts({ ...q, amenities: amenities.length ? amenities : null, bathMin });
  return counts ? counts.cnt_selected : null;
}

// DISTRICT MARKING MUST USE THE USER'S CURRENT FILTER STATE (owner rule, 2026-08-13):
// «The number shown beside a district must equal the exact number of listings the user will get if
// they select that district with their current filter selections.»
//
// district_options_ar knows deal/category/period ONLY, so the district list's empty-marking lied the
// moment a نوع (or سعر/مساحة/غرف) was set: measured live, with نوع=مستودع picked, 10/10 of Riyadh's
// top rent districts presented as having inventory while holding ZERO warehouses — a guaranteed
// dead-end pick; استوديو 9/10; فيلا 0/10, which is exactly why it looked "sometimes fine, sometimes
// wrong". This helper closes the class BY CONSTRUCTION: the per-district signal is the RESULTS RPC
// itself (p_limit:1 → total_count) under the caller's full filter state — the same call selecting
// the district would run — so count and outcome cannot disagree. One lightweight call per VISIBLE
// option (Top-6 trending / the first dropdown rows, ~65 ms each server-side), fired only when a
// narrowing filter beyond district_options_ar's scope is active; the base scope needs no calls
// because scope-count = results there (pinned by mon_trending_district_barrier, 40/40 exact).
// Each option's own match_values OVERRIDE any districts already in q (spread order is load-bearing).
export async function fetchDistrictEligibleCounts(
  q: SearchQuery,
  options: { districtAr: string; matchValues: string[] }[],
): Promise<Record<string, number> | null> {
  if (!supabase || !options.length) return null;
  const scope = await resolveSearchScope(q);
  if (!scope) return null;
  const { isBroadCommercial, ...scopeParams } = scope;
  const base = {
    ...scopeParams,
    ...rpcCountFilterParams(q),
    ...(isBroadCommercial ? { p_types: COMMERCIAL_TYPE_AR_RES } : {}),
    p_limit: 1,
    p_offset: 0,
  };
  const out: Record<string, number> = {};
  await Promise.all(options.map(async (opt) => {
    const result = await withTimeout(
      supabase!.rpc('location_search_candidates_ar', { ...base, p_districts: opt.matchValues }),
      AGE_COUNT_TIMEOUT_MS,
    );
    if ('timedOut' in result) return;           // absent key → caller falls back to the scope count
    const { data, error } = result;
    if (error) return;
    out[opt.districtAr] = data && (data as { total_count: number }[]).length
      ? Number((data as { total_count: number }[])[0].total_count) || 0
      : 0;                                       // empty result set = an honest zero, not an error
  }));
  return out;
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
  // ── Gathern Tier-1 additions (APPENDED — never reorder the above; these keys exist ONLY in
  //    Gathern's additional_info, and buildAdditionalInfo() further gates them to source=Gathern so
  //    NO other platform's panel can change). Order = display priority within the Gathern panel.
  ['unit_type_ar', 'Sub-type'],                          // شقة / استديو / غرفة
  ['furnished', 'Furnished'],                            // boolean true → "Yes"/"نعم"
  ['discount_label', 'Discount'],                        // "خصم 20%" (Arabic, shown as-is)
  ['monthly_price_before_discount', 'Monthly before discount (SAR)'],
  ['nightly_price', 'Nightly rate (SAR)'],
  ['amenities', 'Amenities'],                            // real Arabic labels only (see gate below)
  ['suitability', 'Suitable for'],                       // Gathern detail page: عوائل و عزاب (families / singles)
  ['guest_capacity', 'Guest capacity'],                  // int → "4"
  ['check_in', 'Check-in'],                              // "03:00 مساءً"
  ['check_out', 'Check-out'],                            // "01:00 مساءً"
  ['house_rules', 'House rules'],                        // array of Arabic strings → joined
];
// The Gathern-only keys appended to ADDL_FIELDS above. buildAdditionalInfo skips them unless the row's
// source is Gathern, so a future/other platform that happened to store one of these keys would NOT get
// a new field — guaranteeing every non-Gathern card stays byte-identical. (Gathern Tier-1.)
const GATHERN_ONLY_ADDL_KEYS = new Set<string>([
  'unit_type_ar', 'furnished', 'discount_label', 'monthly_price_before_discount', 'nightly_price', 'amenities', 'suitability',
  'guest_capacity', 'check_in', 'check_out', 'house_rules',
]);
function buildAdditionalInfo(raw: any, source?: string): Array<{ key: string; label: string; value: string }> | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    // TYPE COERCION (P0 fix 2026-08-18, Search & Matching QA run): the LEGACY array shape is stored
    // by the source scraper verbatim, and Wasalt publishes NUMERIC values for noOfParkings /
    // noOfFloors / floorNumber (`{"key":"noOfFloors","label":"Total Floors","value":2}`) — 2,977
    // production_ready rows carry one. This branch used to pass the row object through untouched,
    // so a number reached ResultCard's arAttrValue(), whose very first statement is
    // `(value ?? '').trim()`. `(2).trim is not a function` threw an UNCAUGHT TypeError that
    // unmounted the whole React tree: production served a BLANK WHITE PAGE for any search whose
    // rendered cards included one of those listings (live-reproduced on
    // https://ezhalah-app.vercel.app: تجاري → المباني والمرافق → «مبنى تجاري» → الرياض → «بحث»
    // returned 40 real matches from the RPC, fetched all 40 raw cards, then rendered nothing at all
    // — document.body had ONE div and zero text).
    //
    // The object branch below already ends every value with `String(v).trim()`; the array branch
    // simply never did. The source value STAYS EXACTLY AS PUBLISHED (String(2) === '2') — this only
    // fixes the type the renderer is handed, never the datum. (rule: never change source truth.)
    // The truthiness filter is UNCHANGED on purpose — only the types of the surviving rows are
    // normalised, so no row starts or stops being shown because of this fix.
    const rows = raw
      .filter((r: any) => r && r.label && r.value)
      .map((r: any) => ({ key: String(r.key ?? r.label), label: String(r.label), value: String(r.value) }));
    return rows.length ? rows : null;
  }
  if (typeof raw !== 'object') return null;
  const isGathern = typeof source === 'string' && source.toLowerCase().includes('gathern');
  const out: Array<{ key: string; label: string; value: string }> = [];
  const seen = new Set<string>();
  for (const [key, label] of ADDL_FIELDS) {
    // Gathern-only keys never surface on any other source → non-Gathern output is unchanged.
    if (GATHERN_ONLY_ADDL_KEYS.has(key) && !isGathern) continue;
    if (seen.has(label)) continue;
    let v: any = raw[key];
    if (v === null || v === undefined || v === '' || v === '0' || v === false) continue;
    if (Array.isArray(v)) {
      let arr = v.filter(Boolean);
      // 'amenities' self-heals: Gathern's CURRENT store is numeric junk (["60","3",…] from the old
      // amenities[].title). Only surface once it's an array of REAL Arabic labels (post re-crawl);
      // reject anything without an Arabic letter or that is purely a number. (Gathern Tier-1.)
      if (key === 'amenities') {
        arr = arr.filter((x: any) => typeof x === 'string' && /[ء-ي]/.test(x) && !/^\d+$/.test(x.trim()));
        if (!arr.length) continue;
      }
      v = arr.join('، ');
      if (!v) continue;
    }
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
  // Gathern + Aqar Monthly on any search whose period scope INCLUDES monthly (see [[gathern-source]]).
  // 'both' must list them too — they are the two monthly-only sources, so omitting them would let a
  // "monthly AND annual" search silently return an annual-only pool. (owner feature 2026-08-14.)
  const wantsMonthly = q.rentPeriod === 'monthly' || q.rentPeriod === 'both';
  return (q.deal === 'Rent' && wantsMonthly)
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
  // 'كلاهما' is NOT the same as null. null = "apply no period filter", which also sweeps in the rent rows
  // whose source published no period at all. The user asking for BOTH is asking for the union of two KNOWN
  // periods, so the RPC branch is exactly monthly-predicate OR annual-predicate and an unpublished period
  // stays out. (migration rent_period_both_monthly_and_annual, 2026-08-14.)
  if (q.rentPeriod === 'both') return 'كلاهما';
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
// The category a category-less search DEFAULTS to — exported so the City/District count pools
// (src/data/locations.ts via index.tsx) scope their counts to the SAME category the results RPC
// will actually search, from ONE literal (count-scope parity, findings 2026-08-13 R1). Never
// duplicate this string at a call site.
export const IMPLIED_CATEGORY_DEFAULT = 'Residential' as const;
function impliedCategory(q: SearchQuery): Macro | null {
  if (q.category) return q.category;
  return effectiveCleanQuery(q) ? null : IMPLIED_CATEGORY_DEFAULT;
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
// Result shape for fetchListingsForQuery. pageCandidates = how many MATCHING candidates the main RPC call
// returned this page (before index↔raw detail drops) — the store uses it to advance the Load-More offset
// and decide hasMore, so broad searches (e.g. Riyadh villas = 11,438) page through the FULL set, not just
// the first window. (owner 2026-07-08) [[filter-candidate-cap-underreturn-2026-07-08]]
// pageTotal = EXACT total matching count for the search — the RPC's `count(*) over()` (full filtered set
// before the page limit), same on every page. The store surfaces it as SearchResult.matchTotal for the
// "لقينا N إعلان يطابق طلبك" headline. Falls back to the page length if the column is absent. (owner 2026-07-08)
//
// These used to be module-global (_lastPageCandidates/_lastPageTotal) written mid-function and read by the
// caller via lastPageCandidates()/lastPageTotal() getters right after their own await — but the function
// keeps awaiting several more async steps after writing them (diversity seed / raw-card fetch / proximity
// RPC), so a SECOND concurrent fetchListingsForQuery() call (real: runQuery + loadMoreListings can overlap)
// could clobber the globals before the FIRST call's caller read them. Same hazard class as the sibling
// diversityBoostedKeys Set (see the race note below, ~1104). Fixed the same way that fix's simpler sibling
// would be fixed: no shared mutable state at all — return the values directly, scoped to this call's own
// closure, so there's nothing to race. (owner 2026-08-03 concurrency fix)
export type FetchListingsResult = { listings: Listing[] | null; pageCandidates: number; pageTotal: number };

// (2026-08-06) The page-0 diversity seed and its per-query boosted-key memory are GONE. Platform
// diversification now lives in the RPC's own ORDER BY (migration
// platform_diversity_round_robin_ordering), so the ordering the client receives is already one stable
// diversified total order across every page. There is no page-0 special case left to remember, and
// therefore no cross-page bookkeeping to keep in sync. See fetchListingsForQuery.

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
  //  • BOTH: the union of the two KNOWN periods — mixed platforms must carry an explicit monthly OR
  //    annual rent_period (a null one is still neither, and never guessed); monthly-only platforms pass
  //    wholesale exactly as they do on a monthly search. (owner feature 2026-08-14.)
  if (!q.bothDeals && q.deal === 'Rent' && q.rentPeriod === 'monthly') {
    if (!MONTHLY_ONLY_TABLE.test(tbl)) req = req.eq('rent_period', 'monthly');
  } else if (!q.bothDeals && q.deal === 'Rent' && q.rentPeriod === 'annual') {
    req = req.eq('rent_period', 'annual');
  } else if (!q.bothDeals && q.deal === 'Rent' && q.rentPeriod === 'both') {
    if (!MONTHLY_ONLY_TABLE.test(tbl)) req = req.in('rent_period', ['monthly', 'annual']);
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
// Stop-button cancellation (owner 2026-08-18): `signal` is an EXTERNAL abort source (the pressed
// Stop button), separate from the internal timeout controller above. Forwarding it into the same
// controller means one `.abort()` call genuinely tears down the in-flight HTTP request — not just
// makes the caller stop waiting on it. A signal already aborted before this call starts (Stop
// pressed between two chunked requests) aborts immediately, before any network work begins.
async function bounded<T = any>(builder: any, ms = RPC_TIMEOUT_MS, signal?: AbortSignal): Promise<{ data: T | null; error: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const onExternalAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onExternalAbort);
  }
  try {
    return await builder.abortSignal(ctrl.signal);
  } catch (e: any) {
    return { data: null, error: { message: String(e?.message || e), timeout: true, cancelled: signal?.aborted === true } };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

async function fetchRawByIds(q: SearchQuery, tbl: string, ids: number[], signal?: AbortSignal): Promise<Listing[]> {
  const kind: SourceKind = tbl.includes('_commercial') ? 'com' : 'res';
  const out: Listing[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError'); // Stop pressed between chunks
    // RC-A: capture the error (was silently dropped → a chunk that 500s produced a blank/partial grid
    // that contradicted the «لقينا N إعلان» headline). On any chunk failure, surface it so the caller
    // returns null → retry, rather than showing a misleadingly-short result set.
    const { data, error } = await bounded(keptFiltersReq(q, tbl).in('id', ids.slice(i, i + ID_CHUNK)).limit(ID_CHUNK), RPC_TIMEOUT_MS, signal);
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
export async function fetchListingsForQuery(
  q: SearchQuery,
  opts?: { offset?: number; limit?: number; signal?: AbortSignal },
): Promise<FetchListingsResult> {
  let pageCandidates = 0;
  let pageTotal = 0;
  const pageOffset = Math.max(0, opts?.offset ?? 0);
  const pageLimit = opts?.limit ?? QUERY_LIMIT;
  const signal = opts?.signal;
  if (!supabase) return { listings: null, pageCandidates, pageTotal };
  if (signal?.aborted) return { listings: null, pageCandidates, pageTotal }; // Stop pressed before any network call started
  // Location/table/region scope — shared with the advanced-filter option-count RPCs (resolveSearchScope).
  const scope = await resolveSearchScope(q);
  if (!scope) return { listings: [], pageCandidates, pageTotal };
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
    // Annual-Rent apartment guided flow (2026-07-20). p_amenities + p_bath_min already exist on the
    // live RPC signature (unlike p_is_new_construction, which once needed its migration first), so
    // sending them is safe. STRICT: p_amenities requires each token present; p_bath_min excludes
    // unknown-bathroom rows (the strict-bathrooms migration removes the `s.bathrooms is null` pass).
    ...(q.amenities?.length ? { p_amenities: q.amenities } : {}),
    ...(q.bathMin != null ? { p_bath_min: q.bathMin } : {}),
    ...(q.furnishedPref != null ? { p_furnished: q.furnishedPref } : {}),
    // Cohort-expansion answers (2026-08-15): both params exist on the live RPC signature.
    ...(q.streetWidthMin != null ? { p_street_width_min: q.streetWidthMin } : {}),
    ...(q.directions?.length ? { p_directions: q.directions } : {}),
    // Monthly guided answers (2026-08-18): params exist on the live signature (template rebuild).
    // STRICT + UNKNOWN-safe by SQL: NULL rating/subtype rows can never satisfy them.
    ...(q.ratingMin != null ? { p_rating_min: q.ratingMin } : {}),
    ...(q.reviewsMin != null ? { p_reviews_min: q.reviewsMin } : {}),
    ...(q.unitSubtypes?.length ? { p_unit_subtypes: q.unitSubtypes } : {}),
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
  }), RPC_TIMEOUT_MS, signal);
  if (error) return { listings: null, pageCandidates, pageTotal };   // index error OR timeout (RC-A) → retry UI, not "no matches"
  pageCandidates = (cands as Cand[] | null)?.length ?? 0;   // this page's matching-candidate count → drives Load-More offset/hasMore
  // EXACT total match count from the RPC's count(*) over() (same on every page); fall back to this page's
  // length if the column is missing. Captured from the MAIN call before any supplementary sweep. (owner 2026-07-08)
  pageTotal = Number((cands as any[] | null)?.[0]?.total_count ?? 0) || ((cands as Cand[] | null)?.length ?? 0);
  if (!cands || !(cands as Cand[]).length) return { listings: [], pageCandidates, pageTotal };

  // PLATFORM DIVERSITY — owner PERMANENT rule (2026-07-13, restated and widened 2026-08-05):
  // "MATCH FIRST -> DIVERSIFY SECOND. Never let one platform unnecessarily take over the results while
  // other qualifying platforms are available — and keep it working through عرض المزيد / Show More."
  //
  // This is now enforced ENTIRELY in the RPC's own ORDER BY (migration
  // platform_diversity_round_robin_ordering, 2026-08-06). The RPC numbers each platform's own eligible
  // rows 1..n and sorts by that number first, so the ordering it returns is already a neutral
  // round-robin over the WHOLE eligible set, applied BEFORE limit/offset and ending in the unique
  // (source_table, listing_id) — i.e. ONE stable total order that every page and every Show More batch
  // simply walks. Nothing is left for the client to re-diversify per page.
  //
  // What used to be here (2026-07-13 -> 2026-08-05) was a page-0-ONLY seed: a second RPC call with
  // p_per_platform, merged into the pool via mergeDiversitySeed(). It could not satisfy the rule and had
  // to go, for three independent reasons:
  //   1. it ran only when pageOffset === 0, so every Show More batch fell back to raw recency order —
  //      live-measured on Riyadh/annual-rent/apartment: 11 qualifying platforms, 9,257 eligible rows,
  //      yet a 65-row single-platform streak and only 3 platforms in the first 100;
  //   2. mergeDiversitySeed() re-sorts the merged pool by last_updated DESC, which would now CLOBBER the
  //      diversified order the RPC just computed;
  //   3. it needed cross-page bookkeeping (_diversityBoostedByQuery) purely to stop a pulled-forward card
  //      reappearing later — a whole class of duplicate bug that a single total order cannot produce.
  // Bonus: page 0 now costs ONE RPC call instead of two (live: 326ms -> 173ms).
  //
  // Objective sorts (price/area/beds/oldest) are unaffected: the RPC leaves its diversity key NULL for
  // them, so they keep their exact prior ordering — verified 0 mismatched positions over 300 rows x 6 sorts.
  const allCands: any[] = cands as any[];

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
    fetched = await Promise.all(entries.map(([tbl, ids]) => fetchRawByIds(q, tbl, ids, signal)));
  } catch {
    return { listings: null, pageCandidates, pageTotal };   // RC-A: a raw-card chunk failed or timed out → retry UI, not a misleadingly-partial grid (incl. Stop-cancelled)
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
    // Gathern Tier-1: when the canonical index has NO district and the raw neighborhood isn't Arabic,
    // fall back to the source's own Arabic district token (l.districtArFallback, Gathern-only &
    // city-name-guarded in finalize). null for every other source → `|| ''` keeps them byte-identical.
    l.district = /[ء-ي]/.test(rawDistrict || '') ? rawDistrict : ((ar?.district) || l.districtArFallback || '');
    l.regionAr = (ar?.region) || l.regionAr || '';
    const region = (ar?.region) || CITY_TO_REGION[canonCity] || canonCity;
    ranked.push({ l, platform: c.platform, city: canonCity, region, district: canonDistrict, rank: c.rank, source_table: c.source_table });
  }
  const USE_RELATION_TABLE = true;
  // multiType → spread across the picked clean types (cleanType diversity key). True for a genuine
  // multi-select AND for a subgroup box like «مرافق خدمية» that expands to 5 member types, so its results
  // come out as a balanced MIX of the five rather than clumped by one type. (owner 2026-07-07)
  const multiType = (q.types?.length ?? 0) > 1 || (q.types ?? []).some((t) => (SUBGROUPS[t]?.length ?? 0) > 1);
  // mixPeriods → the user asked for BOTH rent periods, so interleave monthly/annual (nested inside the
  // platform key) instead of letting the denser period own the top of the list. (owner 2026-08-14.)
  const mixPeriods = !q.bothDeals && q.deal === 'Rent' && q.rentPeriod === 'both';
  const scoped = orderByScope(ranked, scopeOf(q, scope.p_cities, isCountryWideQuery(q)), multiType, mixPeriods);
  // Diversification (orderByScope) reorders `scoped` away from pure recency, so the true RPC recency
  // rank (r.rank, 0 = newest) must travel WITH each listing — sortListings()'s newest/oldest sort has
  // nothing else to key off once `rows` is just bare Listings. (sort=newest/oldest fix, 2026-07-25.)
  const rows = scoped.map((r) => ({ ...r.l, recencyRank: r.rank }));
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
      // p.name has its category noun stripped (proximity.ts: "مستشفى الحبيب" -> name "الحبيب", for
      // display/dedup), but listing_location_relations.specific_landmark_norm always KEEPS the noun
      // ("مستشفى الحبيب") — sending the stripped name means it can never match, so the RPC always
      // returns boost=0 for named landmarks (found live 2026-07-25). Reconstruct the noun-inclusive
      // form the same way p.text already does (phrase + noun + name), by stripping just the phrase
      // prefix back off p.text. Category-only asks (p.name empty) stay null so the RPC's separate
      // category-tier fallback still applies instead of matching a bare noun against no landmark.
      const intents = q.proximity!.map((p) => ({
        group: relGroupOf(p.relationship),
        phrase: p.phrase,
        category_en: p.category || null,
        name: p.name ? (p.text.slice(p.phrase.length).trim() || p.name) : null,
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
  return { listings: rows, pageCandidates, pageTotal };
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
  // Source-published «سعر المتر». Present on all 63 platform tables. Shown on the card only when
  // the listing has no total/annual price (2026-07-26 aqar fidelity fix).
  'price_per_meter',
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
    // Aqar (both residential & commercial) scrapes its own "no photo" placeholder graphic
    // (villa-default.png, at one of a couple CDN sizes, sometimes with a corrupted trailing
    // backslash) as a literal photo_urls entry - filter it out so a listing with only this
    // placeholder falls through to the app's own neutral "No photo available" state instead
    // of showing Aqar's stock icon as if it were the real photo, and a listing with real
    // photos elsewhere in the array surfaces those instead of the placeholder occupying
    // index 0. Confirmed live 2026-07-26: ~6.7% of active aqar_residential_listings had this
    // as their displayed photo; 0 occurrences on any other platform.
    const realPhotoUrls = Array.isArray(r.photo_urls)
      ? r.photo_urls.filter((u: unknown) => typeof u === 'string' && !u.includes('/props/villa-default.png'))
      : [];
    const photo = realPhotoUrls.length > 0 ? realPhotoUrls[0] : '';
    // Raw additional_info as a plain object (Gathern/new-platform shape). Aqar leaves it null; Wasalt/
    // Aqar Gate store the LEGACY array shape — neither is an object, so `rawInfo` is null for them and
    // every field derived from it below stays null → no non-Gathern card changes. (Gathern Tier-1.)
    const rawInfo = r.additional_info && typeof r.additional_info === 'object' && !Array.isArray(r.additional_info)
      ? r.additional_info : null;
    // Guest rating (0–10) + review count — Gathern marketplace fields. null for every other platform
    // (the key simply isn't present), so ResultCard renders no rating element for them. (Gathern Tier-1.)
    const ratingNum = rawInfo && rawInfo.rating != null ? Number(rawInfo.rating) : NaN;
    const rating = Number.isFinite(ratingNum) ? ratingNum : null;
    const reviewsNum = rawInfo && rawInfo.reviews_count != null ? Number(rawInfo.reviews_count) : NaN;
    const reviews_count = Number.isFinite(reviewsNum) ? reviewsNum : null;
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
      // Passed through VERBATIM — no rounding, no unit conversion, no derivation. The decision of
      // whether to SHOW it (and the «سعر المتر 1» placeholder rule) lives in ResultCard, so this
      // field always means "what the source published", nothing else.
      pricePerMeter: typeof r.price_per_meter === 'number' ? r.price_per_meter : null,
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
      rating,
      reviews_count,
      districtArFallback: gathernDistrictFallback(r.source, rawInfo),
      additional_info: buildAdditionalInfo(r.additional_info, r.source),
      photos: realPhotoUrls,
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
