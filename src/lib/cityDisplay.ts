// Pure, zero-dependency Arabic city-name lookup — tiers 1 (hand-maintained overrides) and 3 (long-
// tail reverse lookup) of src/data/locations.ts's cityDisplay(). Kept free of the sa-locations.json /
// @/lib/supabase imports that make locations.ts un-importable by a plain Node test script (mirrors
// src/lib/arabicText.ts's zero-dependency design) — so this module's real behavior can be executed
// and asserted by a test, not just grepped as source text. Tier 2 (the sa-locations.json-backed city
// catalog, CITIES_IDX) stays in locations.ts, which calls cityDisplayPure() first and only falls
// through to its own catalog lookup on a miss.

// Authoritative DB-city-label → Arabic (mirrors the DB loc_city_map / remote.ts CITY_AR). The
// catalog's English spelling often differs from the DB label ("Al Hafuf" vs "Hofuf", "Makkah" vs
// "Mecca"), so the catalog lookup misses those and they used to leak English into the Arabic UI.
// Keyed lowercase.
//
// 2026-07-13 regression fix: 'qassim' / 'eastern province' / 'al jawf' were previously translated
// correctly via i18n.tsx's flat AR{} dictionary (as REGION names — these three values leak into the
// `city` column of location_index for a handful of rows with only region-level location data, a
// scraper-side data-quality issue, not a display bug). When noResultsSuggestion() was switched from
// generic tPlace() to this richer cityDisplay(), these three lost their translation and fell through
// to the generic LOCATION_UNRESOLVED_AR placeholder instead — a real regression. Restoring the exact
// same Arabic text i18n.tsx already used for them. 'al basr' / 'al bateen' / 'al dulaimiyah' are real
// Qassim villages (Ramz Al Qassim source, ~1-9 listings each) that were never added here; Arabic
// spellings taken verbatim from that scraper's own CITY_MAP_AR (scrapers/ramzalqasim/run.py).
export const CITY_AR_DISPLAY: Record<string, string> = {
  'abha': 'أبها', 'abqaiq': 'بقيق', 'abu arish': 'أبو عريش', 'afif': 'عفيف', 'ahad al masarihah': 'أحد المسارحة',
  'ahad rafidah': 'أحد رفيدة', 'al ammariyah': 'العمارية', 'al aqiq': 'العقيق', 'al badai': 'البدائع', 'al badaie': 'البدائع',
  'al baha': 'الباحة', 'al bahah': 'الباحة', 'al basr': 'البصر', 'al bateen': 'البطين', 'al birk': 'البرك',
  'al bukayriyah': 'البكيرية', 'al dalam': 'الدلم', 'al dulaimiyah': 'الدليمية',
  'al ghat': 'الغاط', 'al ghazalah': 'الغزالة', 'al hanakiyah': 'الحناكية', 'al hariq': 'الحريق', 'al hayathim': 'الهياثم',
  'al jawf': 'منطقة الجوف', 'al jumum': 'الجموم', 'al kamil': 'الكامل', 'al kharj': 'الخرج', 'al khurma': 'الخرمة', 'al lith': 'الليث',
  'al majardah': 'المجاردة', 'al majmaah': 'المجمعة', 'al mithnab': 'المذنب', 'al muzahimiyah': 'المزاحمية', 'al namas': 'النماص',
  'al qunfudhah': 'القنفذة', 'al quwayiyah': 'القويعية', 'al ula': 'العلا', 'al uyun': 'العيون', 'al wajh': 'الوجه',
  'al zulfi': 'الزلفي', 'an nabhaniyah': 'النبهانية', 'an nairyah': 'النعيرية', 'anak': 'عنك', 'ar rass': 'الرس',
  'arar': 'عرعر', 'as sulayyil': 'السليل', 'ash shamasiyah': 'الشماسية', 'ash shanan': 'الشنان', 'badr': 'بدر',
  'balsamar': 'بلسمر', 'baqaa': 'بقعاء', 'baysh': 'بيش', 'bish': 'بيش', 'bisha': 'بيشة', 'buraidah': 'بريدة',
  'dammam': 'الدمام', 'dawadmi': 'الدوادمي', 'dawmat al jandal': 'دومة الجندل', 'dhahran': 'الظهران',
  'dhahran al janub': 'ظهران الجنوب', 'diriyah': 'الدرعية', 'duba': 'ضباء',
  'eastern province': 'المنطقة الشرقية',
  'hafar al batin': 'حفر الباطن', 'hail': 'حائل',
  'hawtat bani tamim': 'حوطة بني تميم', 'hofuf': 'الهفوف', 'jazan': 'جازان', 'jeddah': 'جدة', 'jubail': 'الجبيل',
  'kaec': 'مدينة الملك عبدالله الاقتصادية', 'khafji': 'الخفجي', 'khamis mushait': 'خميس مشيط', 'khaybar': 'خيبر',
  'khobar': 'الخبر', 'mahayel': 'محايل عسير', 'mahd adh dhahab': 'مهد الذهب', 'malham': 'ملهم', 'mecca': 'مكة المكرمة',
  'medina': 'المدينة المنورة', 'najran': 'نجران', 'qassim': 'منطقة القصيم', 'qatif': 'القطيف', 'qurayyat': 'القريات', 'rabigh': 'رابغ',
  'rafha': 'رفحاء', 'raniyah': 'رنية', 'ras tanura': 'رأس تنورة', 'riyadh': 'الرياض', 'riyadh al khabra': 'رياض الخبراء',
  'rumah': 'رماح', 'sabya': 'صبيا', 'safwa': 'صفوى', 'sakaka': 'سكاكا', 'samtah': 'صامطة', 'sayhat': 'سيهات',
  'shaqra': 'شقراء', 'sharurah': 'شرورة', 'tabuk': 'تبوك', 'taif': 'الطائف', 'tarout': 'تاروت', 'tathleeth': 'تثليث',
  'tathlith': 'تثليث', 'tayma': 'تيماء', 'thadiq': 'ثادق', 'thuwal': 'ثول', 'turabah': 'تربة', 'turaif': 'طريف',
  'umluj': 'أملج', 'unaizah': 'عنيزة', 'yanbu': 'ينبع',
};

// Curated long-tail city Arabic spellings, keyed by every way a city can be TYPED (English or
// Arabic) → its canonical English DB label. Moved here verbatim from src/data/locations.ts.
export const CITY_TOKENS: [string, string][] = [
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

// Tier 3 alone (CITY_TOKENS reverse lookup) — kept separate from tier 1 so src/data/locations.ts's
// cityDisplay() can preserve its exact original tier order (1: CITY_AR_DISPLAY → 2: sa-locations.json
// catalog → 3: this). Returns null on a miss.
export function cityTokensReverseLookup(cityEn: string): string | null {
  for (const [k, c] of CITY_TOKENS) if (c === cityEn && /[ء-ي]/.test(k)) return k;
  return null;
}

// Tiers 1 + 3 combined, skipping tier 2 (the sa-locations.json catalog, which stays in
// locations.ts) — the two tiers this module can genuinely prove correct in isolation. Used by
// real runtime tests to assert the exact reported regression (e.g. cityDisplayPure('dhahran') ===
// 'الظهران') without needing the full catalog import chain.
export function cityDisplayPure(cityEn: string): string | null {
  const direct = CITY_AR_DISPLAY[cityEn.trim().toLowerCase()];
  if (direct) return direct;
  return cityTokensReverseLookup(cityEn);
}
