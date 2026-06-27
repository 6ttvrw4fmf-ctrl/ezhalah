import { supabase } from '@/lib/supabase';
import type { Listing } from './listings';
import { type Deal } from './taxonomy';
import type { SearchQuery } from './search';
import { REGIONS, CITY_TO_REGION, isCountryWideQuery, interleave } from './regions';
import { translitPlace } from '@/lib/translitPlace';
import { normalizeType, queryForSelection, type SourceKind } from './propertyTypes';
import { scoreListingProximity } from './proximity';

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
function arCity(en: string | null): string | null {
  if (!en) return null;
  const k = en.trim().toLowerCase();
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

// The user's TYPE selection, in clean-type terms. `q.type` is a CLEAN property type (filter sets it
// directly; the agent path normalizes its raw output to clean before storing it here). `q.typeGroup`
// is a subcategory GROUP (soft/broad intent). Either resolves — via propertyTypes.queryForSelection —
// to the RAW property_type strings + table kinds we must actually query. (clean-type filter.)
function selection(q: SearchQuery): string | null {
  return q.type || q.typeGroup || null;
}

// Map the selection → the RAW DB property_type values to constrain to (server-side). null = no type
// constraint (a macro-only "all Residential/Commercial" search). The raw set covers every scraped
// spelling a clean type came from (e.g. Shop ⊇ {Shop, Kiosk}; Studio ⊇ {Studio, ستوديو, …}).
function dbTypesFor(q: SearchQuery): string[] | null {
  const cq = queryForSelection(selection(q));
  return cq && cq.rawTypes.length ? cq.rawTypes : null;
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
const RES_TABLES = ['aqar_residential_listings', 'wasalt_residential_listings', 'aldarim_residential_listings', 'aqargate_residential_listings', 'alhoshan_residential_listings', 'hajer_residential_listings', 'sanadak_residential_listings', 'eastabha_residential_listings', 'aqarcity_residential_listings', 'raghdan_residential_listings', 'eaqartabuk_residential_listings', 'satel_residential_listings', 'sadin_residential_listings', 'toor_residential_listings', 'mustqr_residential_listings', 'ramzalqasim_residential_listings', 'fursaghyr_residential_listings', 'jazwtn_residential_listings', 'mizlaj_residential_listings', 'muktamel_residential_listings', 'aqaratikom_residential_listings', 'awal_residential_listings', 'alkhaas_residential_listings', 'abeea_residential_listings', 'jurash_residential_listings', 'alnokhba_residential_listings', 'dealapp_residential_listings', 'erapulse_residential_listings', 'nowaisiry_residential_listings', 'october_residential_listings'];
const COM_TABLES = ['aqar_commercial_listings', 'wasalt_commercial_listings', 'aldarim_commercial_listings', 'aqargate_commercial_listings', 'alhoshan_commercial_listings', 'hajer_commercial_listings', 'sanadak_commercial_listings', 'eastabha_commercial_listings', 'aqarcity_commercial_listings', 'raghdan_commercial_listings', 'eaqartabuk_commercial_listings', 'satel_commercial_listings', 'sadin_commercial_listings', 'toor_commercial_listings', 'mustqr_commercial_listings', 'ramzalqasim_commercial_listings', 'fursaghyr_commercial_listings', 'jazwtn_commercial_listings', 'mizlaj_commercial_listings', 'muktamel_commercial_listings', 'aqaratikom_commercial_listings', 'awal_commercial_listings', 'alkhaas_commercial_listings', 'abeea_commercial_listings', 'jurash_commercial_listings', 'alnokhba_commercial_listings', 'dealapp_commercial_listings', 'erapulse_commercial_listings', 'nowaisiry_commercial_listings', 'october_commercial_listings'];

function resTables(q: SearchQuery): string[] {
  // Gathern + Aqar Monthly only on explicit monthly-rent searches (see [[gathern-source]]).
  return (q.deal === 'Rent' && q.rentPeriod === 'monthly')
    ? [...RES_TABLES, 'gathern_residential_listings', 'aqarmonthly_residential_listings']
    : RES_TABLES;
}

// Which table KIND(s) this query reads: from the selected clean type/group's CleanQuery, else (a
// macro-only search) from q.category. Default Residential.
function kindsFor(q: SearchQuery): SourceKind[] {
  const cq = queryForSelection(selection(q));
  if (cq) return cq.kinds;
  return q.category === 'Commercial' ? ['com'] : ['res'];
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
  // PLATFORM filter: the user named specific platforms ("show me Gathern only"). q.sources holds
  // table prefixes; keep only those platforms' tables. (user: "show me gathern only".)
  if (q.sources && q.sources.length) {
    const wanted = new Set(q.sources);
    const only = tables.filter((tbl) => wanted.has(tbl.replace(/_(residential|commercial)_listings$/, '')));
    if (only.length) tables = only;
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

const QUERY_LIMIT = 1500; // newest N matching rows — plenty for the 25-card display + load-more

// Apply the kept NON-location filters (deal, type, rent period) to a fresh query on the right table.
// Location scoping is added by the caller (city / region / country-wide). Keeps every branch identical
// on the strict-contract fields. (filter contract.)
function keptFiltersReq(q: SearchQuery, table?: string) {
  let req = supabase!.from(table ?? tableFor(q)).select(LIST_SELECT).eq('active', true);
  if (!q.bothDeals) req = req.eq('transaction_type', q.deal === 'Buy' ? 'Buy' : 'Rent');
  const types = dbTypesFor(q);
  if (types && types.length) req = req.in('property_type', types);
  // Rent-period filter only when the deal is actually Rent — NOT for a "rent or buy" (bothDeals) search,
  // where a monthly filter would wrongly drop every Buy row (Buy has no rent_period). (audit bug.)
  if (!q.bothDeals && q.deal === 'Rent' && q.rentPeriod === 'monthly') req = req.eq('rent_period', 'monthly');
  else if (!q.bothDeals && q.deal === 'Rent' && q.rentPeriod === 'annual') req = req.or('rent_period.eq.annual,rent_period.is.null');
  return req;
}

// A candidate row from the location index (the routing layer): just enough to find the exact raw row.
type Cand = { source_table: string; listing_id: number; platform: string };

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
type Scope = 'district' | 'city' | 'region' | 'country';
type Ranked = { l: Listing; platform: string; city: string; region: string; district: string; rank: number; source_table: string };

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

function rankedKey(r: Ranked, k: string): string {
  return k === 'platform' ? r.platform : k === 'city' ? r.city : k === 'region' ? r.region : k === 'district' ? r.district : '';
}

// Hierarchical round-robin: group by the first key, order groups by size (densest first) then freshness,
// take one card per group per pass, and recurse with the remaining keys. At the leaf (no keys), it is
// pure newest-first by the RPC recency rank.
function interleaveRanked(rows: Ranked[], keys: string[]): Ranked[] {
  if (!keys.length) return [...rows].sort((a, b) => a.rank - b.rank);
  const [k, ...rest] = keys;
  const groups = new Map<string, Ranked[]>();
  for (const r of rows) {
    const g = rankedKey(r, k) || '∅';
    let a = groups.get(g);
    if (!a) { a = []; groups.set(g, a); }
    a.push(r);
  }
  const lists = [...groups.values()].map((g) => interleaveRanked(g, rest));
  // Densest group leads (Riyadh before a tiny town); ties broken by the freshest listing in the group.
  lists.sort((a, b) => b.length - a.length || a[0].rank - b[0].rank);
  const out: Ranked[] = [];
  for (let i = 0; out.length < rows.length; i++) {
    let progressed = false;
    for (const g of lists) { if (i < g.length) { out.push(g[i]); progressed = true; } }
    if (!progressed) break;
  }
  return out;
}

function orderByScope(rows: Ranked[], scope: Scope): Ranked[] {
  // Diversity hierarchy per scope (user 2026-06-27): Region → cities → districts → platforms; City →
  // districts → platforms; District → platforms (price/type/freshness variety come from the recency leaf
  // + repeat-visit rotation). Always stays INSIDE the selected scope. Country adds region at the top.
  const keys = scope === 'country' ? ['region', 'city', 'district', 'platform']
    : scope === 'region' ? ['city', 'district', 'platform']
    : scope === 'city' ? ['district', 'platform']
    : scope === 'district' ? ['platform']
    : [];
  return interleaveRanked(rows, keys);
}

// Fetch the FULL card rows for a set of ids from ONE raw platform table, applying the kept server-side
// filters (transaction_type / property_type / rent period). Chunked because a `.in('id', […])` list
// can be long. Raw tables stay the source of truth — the index only told us WHICH rows to pull.
const ID_CHUNK = 200;
async function fetchRawByIds(q: SearchQuery, tbl: string, ids: number[]): Promise<Listing[]> {
  const kind: SourceKind = tbl.includes('_commercial') ? 'com' : 'res';
  const out: Listing[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data } = await keptFiltersReq(q, tbl).in('id', ids.slice(i, i + ID_CHUNK)).limit(ID_CHUNK);
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
export async function fetchListingsForQuery(q: SearchQuery): Promise<Listing[] | null> {
  if (!supabase) return null;
  const tables = tablesFor(q);
  if (!tables.length) return [];

  // Resolve the location scope into a set of cities to filter the index by.
  const lm = q.locationMatch;
  let cities: string[] | null = null;
  // TWIN CITY already disambiguated by the AI Agent's catalog backstop (q.regionPin = the region the
  // user chose, e.g. «القصب» → «منطقة الرياض»). Search THIS exact Arabic city, scoped to the pinned
  // region below — never re-flag it ambiguous, never honest-zero it. q.location is already the Arabic
  // canonical city the catalog returned. (2026-06-26 twin-city false-zero fix.)
  if (q.regionPin && (q.location || '').trim()) {
    cities = [arCity(q.location) || q.location];
  } else if (lm?.ambiguous && lm.cities && lm.cities.length > 1) {
    // Bug-fix #3+#4+#5 (2026-06-26): when the resolver flagged AMBIGUOUS (twin city, or bare district in
    // multiple cities), do NOT fan out across the matched cities — return [] so the deterministic agent
    // backstop's clarification fires («أي مدينة؟» / «أي منطقة؟»). Per locked rules: selected City →
    // search ONLY that city; same name in 2 regions → ask, never guess.
    cities = [];
  } else if (lm?.exact && lm.kind === 'city' && lm.city) {
    // EXACT catalog city match → push canonical Arabic straight to the RPC. Never re-route through
    // cityFilterFor (which would have substring-substituted 'Dhabhah'→'Abha' — see locked rule).
    // 2026-06-26 fix for the ذبحة→أبها cross-region leak: an exact catalog hit is the answer.
    cities = [arCity(lm.city) || lm.city];
  } else if (lm?.kind === 'region' && lm.cities && lm.cities.length) {
    // REGION search → every city in the region (resolver expanded it from the index's region→city data),
    // so we return the WHOLE region, not just its capital. (user: "Region = all listings in that region.")
    cities = Array.from(new Set(lm.cities.map((c) => arCity(cityFilterFor(c) || c)).filter(Boolean))) as string[];
  } else if (lm?.ambiguous && lm.cities && lm.cities.length) {
    // MULTI-CITY ambiguity (e.g. "Al Olaya" in Riyadh AND Khobar) → search all matched cities.
    cities = Array.from(new Set(lm.cities.map((c) => arCity(cityFilterFor(c) || c)).filter(Boolean))) as string[];
  } else {
    // CITY (or a district scoped to a city): prefer a city named in the raw text, else the resolver's.
    // Translate to the Arabic canonical city so the RPC hits the indexed Arabic column. (Arabic-only.)
    const city = arCity(cityFilterFor(q.location || '') || (lm?.city ? cityFilterFor(lm.city) : null));
    if (city) cities = [city];
  }
  const countryWide = isCountryWideQuery(q);

  // A place was NAMED but resolves to NO city, and it's not a district or a country-wide search →
  // honest ZERO (never substitute a nearby place). (user: real-but-empty location returns 0.)
  if ((!cities || !cities.length) && !countryWide && !(q.districts && q.districts.length) && (q.location || '').trim()) {
    return [];
  }
  // An explicit DISTRICT pick that has NO listings in our data (the resolver found no raw variants for it)
  // → honest ZERO; never widen to the whole city. The district is a real catalog place we simply have no
  // listings for. (Filter location policy: show real listings for the selected location, or a clear zero.)
  if (lm?.kind === 'district' && !(q.districts && q.districts.length)) return [];

  // 1) Ask the location index for the candidate set (newest-first, diverse, location + purpose filtered).
  const { data: cands, error } = await supabase.rpc('location_search_candidates', {
    p_purpose: q.bothDeals ? null : (q.deal === 'Buy' ? 'buy' : 'rent'),
    p_cities: cities,
    p_districts: q.districts && q.districts.length ? q.districts : null,
    p_tables: tables,
    p_platforms: q.sources && q.sources.length ? q.sources : null,
    p_per_platform: 400,
    p_limit: QUERY_LIMIT,
    // Region scope (bug-fix #2): pass region_id so same-name twin cities don't fuse cross-region.
    // A pinned region (twin disambiguated by the agent backstop) wins; else the resolver's region.
    p_region_ids: q.regionPin
      ? (REGION_TO_ID[q.regionPin] ? [REGION_TO_ID[q.regionPin]] : null)
      : regionIdsFor(lm),
  });
  if (error) return null;                       // index error → retry UI, not "no matches"
  if (!cands || !(cands as Cand[]).length) return [];

  // 2) Keep the RPC's newest-first order (true last_updated recency); remember each candidate's recency
  //    rank, and group ids by source_table to fetch the full cards.
  const cleanCands = (cands as any[]).map((c, i) => ({
    source_table: c.source_table as string, listing_id: Number(c.listing_id), platform: c.platform as string, rank: i,
  }));
  // The index returns the ARABIC-CANONICAL location for every candidate (region_ar/city_ar/district_ar).
  // We display THAT — never the raw English/transliterated value underneath. (user: Arabic is canonical;
  // the displayed location must come only from the Arabic location DB.)
  const arLoc = new Map<string, { region: string; city: string; district: string }>();
  for (const c of cands as any[]) {
    arLoc.set(`${c.source_table}:${Number(c.listing_id)}`, {
      region: (c.region_ar as string) || '', city: (c.city_ar as string) || '', district: (c.district_ar as string) || '',
    });
  }
  const byTable = new Map<string, number[]>();
  for (const c of cleanCands) {
    let a = byTable.get(c.source_table);
    if (!a) { a = []; byTable.set(c.source_table, a); }
    a.push(c.listing_id);
  }

  // 3) Fetch the full cards from the RAW tables by id (type/period filters applied there).
  const entries = [...byTable];
  const fetched = await Promise.all(entries.map(([tbl, ids]) => fetchRawByIds(q, tbl, ids)));
  const map = new Map<string, Listing>();
  entries.forEach(([tbl], i) => { for (const l of fetched[i]) map.set(`${tbl}:${l.id}`, l); });

  // 4) Rebuild in newest-first order (dropping rows the raw filters / index↔raw drift removed), attach
  //    each row's city + region, then DIVERSIFY by geography according to the search scope so broad
  //    searches show the whole market, not 25 cards from one city/platform. (user: adaptive ordering.)
  const ranked: Ranked[] = [];
  for (const c of cleanCands) {
    const l = map.get(`${c.source_table}:${c.listing_id}`);
    if (!l) continue;
    // Replace the raw location with the Arabic canonical one for DISPLAY + grouping. District falls back
    // to '' (city-level only) when there's no confident Arabic match — we never show the English original.
    const ar = arLoc.get(`${c.source_table}:${c.listing_id}`);
    if (ar) {
      if (ar.city) l.city = ar.city;
      l.district = ar.district || '';
      l.regionAr = ar.region || '';
    }
    const city = l.city || '';
    const region = ar?.region || CITY_TO_REGION[city] || city;
    ranked.push({ l, platform: c.platform, city, region, district: l.district || '', rank: c.rank, source_table: c.source_table });
  }
  const USE_RELATION_TABLE = true;
  const scoped = orderByScope(ranked, scopeOf(q, cities, countryWide));
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
      city: r.city ?? '',
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
      out.push({
        en: `${next.type} ${dEN} in ${districtEN}, ${cityEN}`,
        ar: `${typeToArabic(next.type)} ${dAR} في ${districtARStripped}، ${next.city}`,
      });
      if (out.length >= 80) break;
    }
  }
  return out;
}

// Arabic labels for our canonical residential property types. Used to build the AR prompt half.
function typeToArabic(t: string): string {
  switch (t) {
    case 'Apartment': return 'شقة';
    case 'Villa': return 'فيلا';
    case 'Floor': return 'دور';
    case 'House': return 'بيت';
    case 'Room': return 'غرفة';
    case 'Building': return 'عمارة';
    case 'Rest House': return 'استراحة';
    case 'Chalet': return 'شاليه';
    case 'Camp': return 'مخيم';
    case 'Residential Land': return 'أرض سكنية';
    case 'Commercial Land': return 'أرض تجارية';
    default: return t;
  }
}
