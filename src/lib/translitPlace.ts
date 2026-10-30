// Transliterate Saudi PLACE names (districts, neighborhoods, cities) Arabic → English for the
// English UI. Scraped listings store raw Arabic district names like "حي العليا" — when the user is
// browsing in English we render them as "Al Olaya". Three layers, fastest first:
//
//   1. Direct lookup in the curated DICT below (top KSA neighborhoods + every city we have data for).
//   2. Strip the leading "حي " ("Neighborhood") prefix, retry the lookup.
//   3. Fall back to a deterministic letter-by-letter Arabic → Latin mapping with light cleanup
//      (collapse "ال" definite article into "Al ", trim, title-case). The result is imperfect for
//      uncommon names but always readable — no Arabic glyphs leak through to the EN UI.
//
// This is a CLIENT-SIDE helper — no API calls, instant render. The Gemini-backed `translit` edge
// function is reserved for personal names (where transliteration quality matters most).

const DICT: Record<string, string> = {
  // ── Riyadh districts ────────────────────────────────────────────────────────
  'العليا': 'Al Olaya',
  'النرجس': 'Al Narjis',
  'الياسمين': 'Al Yasmin',
  'الملقا': 'Al Malqa',
  'العارض': 'Al Arid',
  'قرطبة': 'Qurtubah',
  'الورود': 'Al Wurud',
  'الحمراء': 'Al Hamra',
  'السليمانية': 'Al Sulaymaniyah',
  'الروضة': 'Al Rawdah',
  'النسيم': 'Al Naseem',
  'الريان': 'Al Rayyan',
  'الربيع': 'Al Rabie',
  'الواحة': 'Al Wahah',
  'المنار': 'Al Manar',
  'المرسلات': 'Al Mursalat',
  'الفلاح': 'Al Falah',
  'الندى': 'Al Nada',
  'المحمدية': 'Al Muhammadiyah',
  'الصحافة': 'Al Sahafah',
  'النخيل': 'Al Nakheel',
  'الفيصلية': 'Al Faisaliyah',
  'الازدهار': 'Al Izdihar',
  'الإزدهار': 'Al Izdihar',
  'الرحمانية': 'Al Rahmaniyah',
  'النفل': 'Al Nafel',
  'النزهة': 'Al Nuzha',
  'المروج': 'Al Muruj',
  'التعاون': 'Al Taawun',
  'الغدير': 'Al Ghadir',
  'الصحراء': 'Al Sahra',
  'الندوة': 'Al Nadwah',
  'الخالدية': 'Al Khalidiyah',
  'الزهراء': 'Al Zahra',
  'المرقب': 'Al Marqab',
  'الديرة': 'Al Dirah',
  'العود': 'Al Ud',
  'الفوطة': 'Al Futah',
  'المعذر': 'Al Muathar',
  'شبرا': 'Shubra',
  'البديعة': 'Al Badeea',
  'السويدي': 'Al Suwaidi',
  'الشفا': 'Al Shifa',
  'الحزم': 'Al Hazm',
  'ظهرة لبن': 'Dharat Laban',
  'ظهرة البديعة': 'Dharat Al Badeea',
  'صياح': 'Sayyah',
  'النموذجية': 'Al Namuthajiyah',
  'الفاخرية': 'Al Fakhriyah',
  'اليرموك': 'Al Yarmouk',
  'الجزيرة': 'Al Jazirah',
  'الحائر': 'Al Hair',
  'الجنادرية': 'Al Janadriyah',
  'نمار': 'Nimar',
  'لبن': 'Laban',
  'بدر': 'Badr',
  'الشميسي': 'Al Shumaisi',
  'الجرادية': 'Al Jaradiyah',
  'العزيزية': 'Al Aziziyah',
  'الفاروق': 'Al Farouq',
  'الدار البيضاء': 'Al Dar Al Baida',
  'المصانع': 'Al Masani',
  'منفوحة': 'Manfuhah',
  'أم الحمام': 'Umm Al Hamam',
  'ام الحمام': 'Umm Al Hamam',
  'الخزامى': 'Al Khuzama',
  'المغرزات': 'Al Mughrizat',
  'المربع': 'Al Murabba',
  'الوزارات': 'Al Wazarat',
  'المنصورة': 'Al Mansurah',
  'النور': 'Al Nour',
  'اشبيلية': 'Ishbiliya',
  'إشبيلية': 'Ishbiliya',
  'الملك فهد': 'King Fahd',
  'الملك عبدالله': 'King Abdullah',
  'الملك عبدالعزيز': 'King Abdulaziz',
  'العقيق': 'Al Aqiq',
  'حطين': 'Hittin',
  'النظيم': 'Al Nadhim',
  'الرمال': 'Al Rimal',
  'العريجاء': 'Al Urayja',
  'العريجاء الغربية': 'Al Urayja Al Gharbiyah',
  'الشهداء': 'Al Shuhada',
  'الخليج': 'Al Khaleej',
  'السلام': 'Al Salam',
  'العمل': 'Al Amal',

  // ── KSA cities & regions (covering most scraped data) ───────────────────────
  'الرياض': 'Riyadh',
  'جدة': 'Jeddah',
  'مكة': 'Mecca',
  'مكة المكرمة': 'Mecca',
  'المدينة': 'Medina',
  'المدينة المنورة': 'Medina',
  'الدمام': 'Dammam',
  'الخبر': 'Khobar',
  'الظهران': 'Dhahran',
  'الأحساء': 'Al Ahsa',
  'الهفوف': 'Hofuf',
  'القطيف': 'Qatif',
  'الجبيل': 'Jubail',
  'ينبع': 'Yanbu',
  'الطائف': 'Taif',
  'أبها': 'Abha',
  'تبوك': 'Tabuk',
  'بريدة': 'Buraidah',
  'حائل': 'Hail',
  'عرعر': 'Arar',
  'نجران': 'Najran',
  'جازان': 'Jazan',
  'الباحة': 'Al Baha',
  'سكاكا': 'Sakaka',
  'القصيم': 'Qassim',
  'عسير': 'Asir',
  'تثليث': 'Tathlith',
  'خميس مشيط': 'Khamis Mushait',
  'بيشة': 'Bisha',
  'الزلفي': 'Al Zulfi',
  'الرس': 'Al Rass',
  'عنيزة': 'Unayzah',
  'الخرج': 'Al Kharj',
  'المجمعة': 'Al Majmaah',
  'شقراء': 'Shaqra',
  'الدوادمي': 'Al Duwadimi',
  'وادي الدواسر': 'Wadi Al Dawasir',
  'الأفلاج': 'Al Aflaj',
  'حفر الباطن': 'Hafar Al Batin',
  'رفحاء': 'Rafha',
  'طريف': 'Turaif',
  'الوجه': 'Al Wajh',
  'ضباء': 'Duba',
  'املج': 'Umluj',
  'العلا': 'Al Ula',
  'خيبر': 'Khaybar',
  'محايل عسير': 'Muhayil Asir',
  'صبيا': 'Sabya',
  'صامطة': 'Samtah',
};

// Letter-by-letter Arabic → Latin map, used as a last-resort fallback when DICT misses. Keeps the
// reading order natural (the source is already LTR-stored as a plain string from Supabase, even
// though logically it's RTL — Postgres stores it as a sequence of code points, so we just walk it).
const LETTER: Record<string, string> = {
  'ا': 'a',  'أ': 'a',  'إ': 'i',  'آ': 'a',  'ء': '',   'ى': 'a',  'ة': 'h',
  'ب': 'b',  'ت': 't',  'ث': 'th', 'ج': 'j',  'ح': 'h',  'خ': 'kh',
  'د': 'd',  'ذ': 'dh', 'ر': 'r',  'ز': 'z',  'س': 's',  'ش': 'sh',
  'ص': 's',  'ض': 'd',  'ط': 't',  'ظ': 'z',  'ع': 'a',  'غ': 'gh',
  'ف': 'f',  'ق': 'q',  'ك': 'k',  'ل': 'l',  'م': 'm',  'ن': 'n',
  'ه': 'h',  'و': 'w',  'ي': 'y',  'ئ': 'y',  'ؤ': 'w',
  // Numerals (just in case)
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

const ARABIC_RE = /[؀-ۿ]/;

// ── Catalog-backed dictionary (the BIG win) ───────────────────────────────────────────────────────
// The curated DICT above is hand-tuned but tiny (~150). The official location catalog
// (sa-locations.json) carries a clean English name for EVERY city and ~6,500 districts, so we build a
// comprehensive Arabic→English map from it. This is what stops the letter-by-letter fallback from
// leaking garbled names ("Aldwhh Aljnwbyh") onto the English cards. (user: "the Arabic is a mess —
// translate it to English; match what's in the database.")
import sa from '@/data/sa-locations.json';
const _sa = sa as { regions: [number, string, string][]; cities: [number, number, string, string][]; districts: [number, number, string, string][] };

// Normalize an Arabic place key: drop diacritics/tatweel, the "حي " prefix, fold letter variants, keep
// word spacing. Used so a listing's raw Arabic ("حي العليا") matches the catalog's Arabic ("العليا").
function normAr(s: string): string {
  return s
    .replace(/[ً-ٰٟ]/g, '').replace(/ـ/g, '')
    .trim()
    // «حي» / «الحي» prefix. It read /^ال?حي/ — "ا then an optional ل" — so it never stripped a bare «حي», and
    // every listing that wrote its district WITHOUT «حي» («القدس», «غرناطة») missed the catalog's «حي القدس»
    // and showed letter-by-letter English: 471 district names, measured 2026-10-29 (owner: «everything must
    // be translated to English»).
    .replace(/^(?:ال)?حي\s+/, '').replace(/^حى\s+/, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىي]/g, 'ي').replace(/ئ/g, 'ي').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/ء/g, '')
    .replace(/\s+/g, ' ').trim();
}
// Tidy an English catalog name for display: drop the "Dist."/"District"/"Neighborhood" markers.
function tidyEn(s: string): string {
  return s
    .replace(/\bDist\.?/gi, '').replace(/\bDistrict\b/gi, '').replace(/\bNeighbou?rhood\b/gi, '')
    .replace(/[.,\s]+$/, '') // strip any trailing dot/comma/space the marker left behind
    .replace(/\s+/g, ' ').trim();
}
const CATALOG_AR: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [, , en, ar] of _sa.cities) { const k = normAr(ar); if (k && !m[k]) m[k] = en; }
  for (const [, , en, ar] of _sa.districts) { const k = normAr(ar); if (k && !m[k]) m[k] = tidyEn(en); }
  return m;
})();

// English for the Saudi place names and name-words that neither the official catalog nor translitPlace's word rules
// can build (owner 2026-10-29: «everything must be translated to English»). Measured that day over the 3,578 district
// names in the served index: these are the most-listed leftovers, roughly in order. A key is a whole name or one word
// of a name; the official catalog still wins over anything here. Display only: every search and match uses the Arabic.
// Add an entry when a name shows up spelled letter by letter on an English card.
const PLACE_NAMES_EN: Record<string, string> = {
  // whole names
  'اسكان قوى الامن العام': 'Public Security Housing', 'قوى الامن': 'Security Forces', 'السكة الحديدية': 'Railway',
  'منسوبي التعليم': 'Education Staff', 'منسوب التعليم': 'Education Staff', 'تجمع سكاني': 'Residential Cluster',
  'الدخل المحدود': 'Limited Income', 'خدمات مساندة': 'Support Services', 'الخدمات المساندة': 'Support Services',
  // words
  'ظهرة': 'Dhahrat', 'القريقر': 'Al Qurayqir', 'درة': 'Durrat', 'النقيب': 'Al Naqib', 'مذينب': 'Mudhaynib',
  'القشاشية': 'Al Qashashiyah', 'جوهرة': 'Jawharat', 'الرغامة': 'Al Rughamah', 'المنسك': 'Al Mansak',
  'العمرة': 'Al Umrah', 'شعب': 'Shib', 'المسيال': 'Al Misyal', 'الغسانية': 'Al Ghassaniyah', 'ازميرالدا': 'Esmeralda',
  'الفلق': 'Al Falaq', 'الهادي': 'Al Hadi', 'عامر': 'Amer', 'محاسن': 'Mahasin', 'المحاسن': 'Al Mahasin', 'خب': 'Khub',
  'هذلولة': 'Hadhlulah', 'النسية': 'Al Nasiyah', 'الأصيل': 'Al Asil', 'قلعة': 'Qalat', 'مخيط': 'Mukhayt',
  'العفجه': 'Al Afjah', 'اسكان': 'Housing', 'الاسكان': 'Housing', 'الباب': 'Al Bab', 'دانة': 'Danat',
  'الليوان': 'Al Liwan', 'التوفيق': 'Al Tawfiq', 'فؤاد': 'Fouad', 'المنح': 'Al Minah', 'العام': 'General',
  'قوى': 'Forces', 'الامن': 'Security', 'سبعة': 'Seven', 'الوداد': 'Al Widad', 'مهزور': 'Mahzur',
  'البوادر': 'Al Bawadir', 'خزام': 'Khuzam', 'حبلين': 'Hablain', 'الزيتونة': 'Al Zaytunah', 'آل': 'Al',
  'المنسوب': 'Al Mansub', 'الرواف': 'Al Rawaf', 'هجرة': 'Hijrat', 'محطة': 'Station', 'بوسحبل': 'Bu Sihbil',
  'العنبرية': 'Al Anbariyah', 'الفاضلية': 'Al Fadiliyah', 'حقروصين': 'Haqrusin', 'الكدى': 'Al Kuda',
  'النقس': 'Al Naqs', 'الزراعية': 'Agricultural', 'الزراعي': 'Agricultural', 'مروج': 'Muruj', 'سيد': 'Sayed',
  'الجودية': 'Al Joudiyah', 'السامية': 'Al Samiyah', 'ريع': 'Ri', 'اذاخر': 'Adhakhir', 'الجراد': 'Al Jarad',
  'الذيب': 'Al Theeb', 'الأوامر': 'Al Awamir', 'بستان': 'Bustan', 'حثم': 'Hathm', 'قرى': 'Villages',
  'غليظ': 'Ghalith', 'عثمر': 'Uthmur', 'رقم': 'No.', 'نبعه': 'Nabaah', 'صناعية': 'Industrial', 'شاطئ': 'Shati',
  'شاطىء': 'Shati', 'المقام': 'Al Maqam', 'النازية': 'Al Naziyah', 'الهاف': 'Al Haf', 'مون': 'Moon',
  'المملكة': 'Kingdom', 'اليحيى': 'Al Yahya', 'القمر': 'Al Qamar', 'الموظفين': 'Employees', 'الورش': 'Workshops',
  'العانبس': 'Al Anbas', 'البشر': 'Al Bishr', 'الميداء': 'Al Maida', 'المصطفى': 'Al Mustafa', 'الصهبان': 'Al Sahban',
  'الصوامع': 'Al Sawami', 'الجطيلي': 'Al Jutaili', 'بدائع': 'Badai', 'السوسن': 'Al Sawsan', 'عريش': 'Arish',
  'الطيبات': 'Al Tayyibat', 'المظلل': 'Al Muzallal', 'قصور': 'Qusur', 'التسامح': 'Al Tasamuh', 'البريد': 'Post',
  'بريد': 'Post', 'المزروع': 'Al Mazrou', 'الخبيبية': 'Al Khubaybiyah', 'المطاوعة': 'Al Mutawaah', 'مقبل': 'Muqbil',
  'الموسي': 'Al Mousa', 'استراحات': 'Rest Houses', 'الميه': 'Al Miyah', 'الذهبي': 'Golden', 'الحضارى': 'Al Hadari',
  'الحضاري': 'Al Hadari', 'جبارة': 'Jabbarah', 'الحديبية': 'Al Hudaybiyah', 'النعمان': 'Al Numan', 'نعمان': 'Numan',
  'دار': 'Dar', 'المحلة': 'Al Mahallah', 'المحله': 'Al Mahallah', 'السناح': 'Al Sinah', 'الأمجاد': 'Al Amjad',
  'ضارج': 'Darij', 'مجمع': 'Complex', 'الفجر': 'Al Fajr', 'قطر': 'Qatar', 'الشرفة': 'Al Shurfah',
  'الهاشمية': 'Al Hashimiyah', 'الشبيلي': 'Al Shubaili', 'الخذامة': 'Al Khadhamah', 'الدائري': 'Ring Road',
  'معاد': 'Maad', 'المنارة': 'Al Manarah', 'أفنيو': 'Avenue', 'الهضيبة': 'Al Hudaybah', 'لحج': 'Lahj',
  'أوالة': 'Awalah', 'العيسى': 'Al Issa', 'حجله': 'Hajlah', 'الواصلية': 'Al Wasiliyah', 'المناهيل': 'Al Manahil',
  'مبروكة': 'Mabrukah', 'الجو': 'Al Jaw', 'التاخي': 'Al Taakhi', 'طوى': 'Tuwa', 'قرحش': 'Qarhash',
  'الاحياء': 'Districts', 'العارضية': 'Al Aridiyah', 'ملحق': 'Annex', 'اللواء': 'Al Liwa', 'الباج': 'Al Baj',
  'غياضة': 'Ghiyadah', 'قلوص': 'Qalus', 'السبطين': 'Al Sibtayn', 'مختارة': 'Mukhtarah', 'النصار': 'Al Nassar',
  'مخططات': 'Plans', 'مشار': 'Mishar', 'الوبرة': 'Al Wabrah', 'العطبة': 'Al Atbah', 'شيخة': 'Shaikhah',
  'مفرق': 'Junction', 'المجابل': 'Al Majabil', 'كريم': 'Karim', 'المنطقة': 'Area', 'الرونق': 'Al Rawnaq',
  'الكيفة': 'Al Kifah', 'الستين': 'Al Sitteen', 'المسمى': '', 'المسماه': '', 'المسميات': '', 'تابعة': '',
  'الخلايق': 'Al Khalayiq', 'الفيصلي': 'Al Faisali', 'الفالح': 'Al Falih', 'وهطان': 'Wahtan', 'قيشه': 'Qishah',
  'الزين': 'Al Zain', 'عكرمة': 'Ikrimah', 'العربه': 'Al Arabah', 'اللحيانية': 'Al Lihyaniyah', 'الفحياء': 'Al Fahya',
  'الدرزي': 'Al Darzi', 'الخدمات': 'Services', 'المساندة': 'Support', 'الحمزه': 'Al Hamzah', 'البري': 'Al Barri',
  'دمج': 'Damj', 'سوق': 'Market', 'البشرى': 'Al Bushra', 'العابدية': 'Al Abidiyah', 'الغويلا': 'Al Ghuwaila',
  'الشهاب': 'Al Shihab', 'الكليبية': 'Al Kulaibiyah', 'تنال': 'Tanal', 'مفتوحة': 'Open', 'لبلدية': 'Municipality',
  'بلدية': 'Municipality', 'الشهيبي': 'Al Shuhaibi', 'خط': 'Line', 'العريفي': 'Al Uraifi', 'سمحة': 'Samhah',
  'الآمتداد': 'Extension', 'الامتداد': 'Extension', 'امتداد': 'Extension', 'عز': 'Izz', 'الدين': 'Al Din',
  'الوكرة': 'Al Wakrah', 'جرية': 'Jurayyah', 'العريفيه': 'Al Uraifiyah', 'البهجة': 'Al Bahjah', 'الصهيل': 'Al Saheel',
  'درب': 'Darb', 'التخصصي': 'Specialist', 'شعبة': 'Shubah', 'الحزامي': 'Al Hizami', 'النغيلة': 'Al Nughaylah',
  'السياسب': 'Al Sayasib', 'سرار': 'Sarar', 'الحازم': 'Al Hazim', 'العزابيه': 'Al Azzabiyah', 'الكلاء': 'Al Kala',
  'الوكف': 'Al Wakf', 'مريبدة': 'Muraybidah', 'الزهوه': 'Al Zahwah', 'غربية': 'West', 'شرقية': 'East',
  'رحية': 'Rahiyah', 'رجوم': 'Rujum', 'بلدة': 'Town', 'البراك': 'Al Barrak', 'واحة': 'Oasis', 'حوايا': 'Hawaya',
  'القصبا': 'Al Qasba', 'الرايسية': 'Al Rayisiyah', 'المكرمية': 'Al Mukarramiyah', 'الكشرية': 'Al Kashriyah',
  'الحجر': 'Al Hijr', 'السمر': 'Al Samr', 'الاراضي': 'Lands', 'سندس': 'Sundus', 'العتبان': 'Al Utban',
  'الغزة': 'Al Ghazzah', 'فيضة': 'Faydah', 'بيروت': 'Beirut', 'العقبة': 'Al Aqabah', 'مثلث': 'Triangle',
  'لؤلؤة': 'Pearl', 'فرشه': 'Farshah', 'الليل': 'Al Lail', 'الفرعاء': 'Al Far’a', 'غنامة': 'Ghannamah',
  'العكرش': 'Al Akrash', 'الحطيم': 'Al Hatim', 'الجدور': 'Al Judur', 'السبيع': 'Al Subai', 'الجوز': 'Al Jawz',
  'هجر': 'Hajr', 'المبرز': 'Al Mubarraz', 'العيون': 'Al Uyun', 'الجشة': 'Al Jishah', 'الكلابية': 'Al Kilabiyah',
  'الحجازية': 'Al Hijaziyah', 'البطينه': 'Al Butaynah', 'البيان': 'Al Bayan',
};

// Hand-written English for the most-listed names the words above cannot build (keys normalised like the catalog).
const PLACE_EN: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [ar, en] of Object.entries(PLACE_NAMES_EN)) m[normAr(ar)] = en;
  return m;
})();

function letterTransliterate(s: string): string {
  let out = '';
  // word-final «ية» / «ة» read «iyah» / «ah» («الشامية» → «Al Shamiyah», not «Al Shamyh»)
  const src = s.replace(/ي[ةه](?=\s|$)/g, 'iyah').replace(/ة(?=\s|$)/g, 'ah');
  for (const ch of src) out += LETTER[ch] ?? ch;
  // "ال" definite article that survived as "al" → render as " Al " for readability.
  out = out.replace(/(^|\s)al(?=[a-z])/g, '$1Al ');
  // Collapse double spaces, trim.
  out = out.replace(/\s+/g, ' ').trim();
  // Title-case every word.
  return out
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

// Compass-direction prefixes Aqar uses in its URL region segment (e.g. "شمال-الرياض").
const DIR_AR_TO_EN: Record<string, string> = {
  'شمال': 'North',
  'جنوب': 'South',
  'شرق': 'East',
  'غرب': 'West',
  'وسط': 'Central',
};

// Extract the REGION (e.g. "north Riyadh") from an Aqar listing URL. Aqar's path is
// category / city / {direction}-{city} / district / slug — so the 3rd segment, when it starts with
// a compass direction, is the region. Returns a bilingual label, or null when the URL has no region
// segment (some listings skip it). Client-side only — works on every already-stored listing_url with
// no DB change or re-scrape. (user request: extract & show the region on the card.)
export function regionFromUrl(url?: string | null): { ar: string; en: string } | null {
  if (!url) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(url); } catch { decoded = url; }
  const after = decoded.split('aqar.fm/')[1] ?? decoded;
  const parts = after.split(/[/?#]/).filter(Boolean);
  for (const seg of parts) {
    const m = seg.match(/^(شمال|جنوب|شرق|غرب|وسط)-(.+)$/);
    if (m) {
      const dirAr = m[1];
      const cityAr = m[2].replace(/-/g, ' ').trim();
      const dirEn = DIR_AR_TO_EN[dirAr] ?? '';
      const cityEn = translitPlace(cityAr);
      return {
        ar: `${dirAr} ${cityAr}`,
        en: dirEn ? `${dirEn} ${cityEn}` : cityEn,
      };
    }
  }
  return null;
}

// Public: render an Arabic place name in English. Returns the input as-is if it doesn't contain
// any Arabic letters (so an already-English string round-trips untouched).
export function translitPlace(raw: string): string {
  if (!raw) return raw;
  if (!ARABIC_RE.test(raw)) return raw;
  const trimmed = raw.trim();
  const whole = lookupPlace(trimmed);
  if (whole) return whole;
  // «الرياض - النرجس», «ضاحية هجر(الحي الخامس)»: each part is its own place name.
  const parts = trimmed.split(/\s*[-–—/،,()]+\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) return dedupeWords(parts.map(composePlace).filter(Boolean).join(' - '));
  return composePlace(trimmed);
}

// ── Place names built from words (owner 2026-10-29: «everything must be translated to English») ──────────
// 1,573 district names in the served index (18,838 listings) matched no dictionary and came out letter by
// letter: «Al Shamyh Al Jdyd», «Mtar Al Mlk Khald Al Dwly». Most are a known name plus known words — a
// direction, «new», an ordinal, «suburb / plan / farms / road / university / airport». So: peel those words
// off, look the core up again, translate the words, and spell out only what is left. Free and instant (no
// API call), and a name that is already in a dictionary is untouched.
function lookupPlace(s: string): string | null {
  const t = s.trim();
  const bare = t.replace(/^(?:ال)?حي\s+/, '').replace(/^حى\s+/, '');
  const key = normAr(t);
  return DICT[t] ?? DICT[bare] ?? CATALOG_AR[key] ?? PLACE_EN[key] ?? null;
}
const DIR_FIRST: Record<string, string> = { شمال: 'North', جنوب: 'South', شرق: 'East', غرب: 'West', وسط: 'Central' };
const DIR_LAST: Record<string, string> = {
  الشمالي: 'North', الشماليه: 'North', الجنوبي: 'South', الجنوبيه: 'South', الشرقي: 'East', الشرقيه: 'East',
  الغربي: 'West', الغربيه: 'West', الاوسط: 'Central', الوسطي: 'Central',
};
// A head word that English puts AFTER the name: «مطار الملك خالد» → «King Khalid Airport».
const HEAD: Record<string, string> = {
  ضاحيه: 'Suburb', الضاحيه: 'Suburb', مخطط: 'Plan', المخطط: 'Plan', مزارع: 'Farms', طريق: 'Road', شارع: 'Street',
  قريه: 'Village', جامعه: 'University', مطار: 'Airport', منطقه: 'Area', مركز: 'Center', مدينه: 'City',
  المدينه: 'City', الحي: 'District', حاره: 'Quarter', ميناء: 'Port', محافظه: 'Governorate', جزيره: 'Island',
};
const AFTER: Record<string, string> = {
  الدولي: 'International', الصناعيه: 'Industrial', الاقتصاديه: 'Economic', السكنيه: 'Residential',
  التجاريه: 'Commercial', الزراعيه: 'Agricultural', الجامعيه: 'University', الطبيه: 'Medical', ومزارعها: 'and Farms',
};
const ORDINAL: Record<string, string> = {
  الاول: '1', الاولي: '1', الثاني: '2', الثانيه: '2', الثالث: '3', الثالثه: '3', الرابع: '4', الرابعه: '4',
  الخامس: '5', الخامسه: '5', السادس: '6', السادسه: '6', السابع: '7', السابعه: '7', الثامن: '8', الثامنه: '8',
  التاسع: '9', التاسعه: '9', العاشر: '10', العاشره: '10', الحادي: '1',
};
// Lone letters number plots and plans in abjad order: «2566/أ» → «2566/A».
const ABJAD: Record<string, string> = { ا: 'A', ب: 'B', ج: 'C', د: 'D', ه: 'E', و: 'and' };
const NEW_WORD = new Set(['الجديد', 'الجديده', 'جديد', 'جديده']);
// Words that recur inside names. Names of people follow the spellings Saudi road signs use.
const WORD: Record<string, string> = {
  الملك: 'King', الشهيد: 'Al Shahid', الامير: 'Prince', الاميره: 'Princess', الشيخ: 'Sheikh', الامام: 'Imam', بن: 'bin', ابن: 'Ibn',
  ام: 'Umm', ابو: 'Abu', بني: 'Bani', عين: 'Ain', وادي: 'Wadi', جبل: 'Jabal', بئر: 'Bir', بير: 'Bir', راس: 'Ras',
  عبدالله: 'Abdullah', عبدالعزيز: 'Abdulaziz', عبدالرحمن: 'Abdulrahman', محمد: 'Mohammed', فهد: 'Fahd',
  فيصل: 'Faisal', خالد: 'Khalid', سلمان: 'Salman', سعود: 'Saud', سلطان: 'Sultan', نايف: 'Nayef', تركي: 'Turki',
  بندر: 'Bandar', عمر: 'Omar', علي: 'Ali', عثمان: 'Othman', نوره: 'Noura', متعب: 'Miteb', مشعل: 'Mishal',
  ماجد: 'Majed', سعد: 'Saad', احمد: 'Ahmed', حمد: 'Hamad', ناصر: 'Nasser', الراجحي: 'Al Rajhi',
  الدخل: 'Income', المحدود: 'Limited', الحديقه: 'Park', الحديقة: 'Park', الكورنيش: 'Corniche', البحر: 'Al Bahr',
  التعليم: 'Education', منسوبي: 'Staff', منسوب: 'Staff', الاسكان: 'Housing', الحرس: 'Guard', الوطني: 'National',
  الجامعه: 'University', المطار: 'Airport', الصناعيه: 'Industrial', الصناعية: 'Industrial', السكه: 'Railway',
  الحديديه: '', الميناء: 'Port', القديم: 'Old', القديمه: 'Old', البلد: 'Al Balad', الشمال: 'North', الجنوب: 'South',
};
function wordEn(w: string): string {
  const k = normAr(w);
  if (k in WORD) return WORD[k];
  if (ABJAD[k]) return ABJAD[k];
  const hit = lookupPlace(w);
  if (hit != null) return hit;
  // «بالهفوف» = «in Al Hofuf», «والبيان» = «and Al Bayan»
  if (/^[بو]ال./.test(k)) return `${k[0] === 'ب' ? 'in' : 'and'} ${wordEn(k.slice(1))}`;
  return letterTransliterate(w);
}
function dedupeWords(s: string): string {
  return s.split(' ').filter((w, i, a) => w && w !== a[i - 1]).join(' ').trim();
}
function composePlace(s: string): string {
  const hit = lookupPlace(s);
  if (hit) return hit;
  const words = s.replace(/^(?:ال)?حي\s+/, '').replace(/^حى\s+/, '').replace(/عبد\s+ال/g, 'عبدال')
    .split(/\s+/).filter(Boolean);
  const dirs: string[] = []; let head = ''; let isNew = false; let ord = ''; const after: string[] = [];
  while (words.length > 1 || (words.length === 1 && (HEAD[normAr(words[0])] || DIR_FIRST[normAr(words[0])]))) {
    const k = normAr(words[0]);
    if (DIR_FIRST[k]) { dirs.push(DIR_FIRST[k]); words.shift(); continue; }
    if (HEAD[k] && !head) { head = HEAD[k]; words.shift(); continue; }
    break;
  }
  while (words.length > 0) {
    const k = normAr(words[words.length - 1]);
    if (NEW_WORD.has(k)) { isNew = true; words.pop(); continue; }
    if (DIR_LAST[k] && words.length > 1) { dirs.push(DIR_LAST[k]); words.pop(); continue; }
    if (ORDINAL[k]) { ord = ORDINAL[k]; words.pop(); continue; }
    if (k === 'عشر' && words.length > 1 && ORDINAL[normAr(words[words.length - 2])]) {
      ord = String(Number(ORDINAL[normAr(words[words.length - 2])]) + 10); words.splice(-2); continue;
    }
    if (AFTER[k] && words.length > 1) { after.unshift(AFTER[k]); words.pop(); continue; }
    break;
  }
  const core = words.join(' ');
  const coreEn = core ? (lookupPlace(core) ?? words.map(wordEn).join(' ')) : '';
  // «الحي الخامس» / «حي الحادي عشر» are numbered districts: the ordinal alone would print a bare «5».
  const named = [...dirs, isNew ? 'New' : '', coreEn, ...after, head].filter(Boolean);
  if (!named.length && ord) return `District ${ord}`;
  return dedupeWords([...named, ord].filter(Boolean).join(' '));
}
