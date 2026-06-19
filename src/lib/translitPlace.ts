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

function letterTransliterate(s: string): string {
  let out = '';
  for (const ch of s) out += LETTER[ch] ?? ch;
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
  if (DICT[trimmed]) return DICT[trimmed];
  // Strip "حي " ("Neighborhood ") prefix and retry — the scraped district field very often comes
  // through as "حي العليا" but our dict keys on the bare name.
  const stripped = trimmed.replace(/^حي\s+/, '').replace(/^حى\s+/, '');
  if (DICT[stripped]) return DICT[stripped];
  return letterTransliterate(stripped);
}
