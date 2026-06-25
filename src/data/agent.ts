// The Ezhalah AI Agent. Turns a free-text message into either a neutral listing search or a
// plain reply. It is deliberately NON-ADVISORY (PRD §7): it never recommends a property, never
// says "best/better/good deal", and never gives buying or financial advice — it only acknowledges
// and presents matching listings for the user to choose from.
//
// This is the mock-first heuristic. The async `respond` signature is the seam where a Saudi-hosted
// LLM endpoint slots in later (PRD §13 open question on the agent backend); the classification
// contract (AgentTurn) stays the same so the chat UI never changes.

import { emptyQuery, toLatinDigits, grouped, type SearchQuery } from './search';
import { CATEGORY_TYPES, type Category } from './taxonomy';
import { t, getLocale } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { landmarkHint, ensureLandmarks } from './landmarks';
import { normalizeType, isCleanType, CLEAN_MACRO } from './propertyTypes';

export type AgentTurn =
  | { kind: 'listings'; reply: string; query: SearchQuery }
  | { kind: 'message'; reply: string }
  | { kind: 'interview' };

// "ask me questions" → hand off to the guided interview.
const INTERVIEW_RE =
  /\b(ask me|ask questions|question me|guide me|help me (choose|decide|find)|interview me|walk me through)\b/i;

// Recommendation / opinion / advice → must decline (non-advisory guardrail).
const ADVICE_RE =
  /\b(recommend|suggest|advi[cs]e|which (is|one)|better|best|good deal|worth it|should i|here or there|or there|vs\.?|versus|compare)\b/i;

const DISTRESS_RE = /\b(kill|murder|hurt|suicide|die|harm|hate myself|end it|kill myself)\b/i;

// A direct SEARCH ORDER — the user is telling Ezhalah to go fetch listings ("I want…", "show me…",
// "find me…"). For LOGGED-IN users this is the trigger that flips the assistant from conversational
// help into a real search; for guests every property query searches regardless. (user request.)
const ORDER_RE =
  /\b(i\s*(want|need|wanna)|i'?m looking|i am looking|i'?d like|i would like|looking for|give me|show me|find me|get me|search for|search|fetch|pull up|bring up|list|display)\b/i;
const AR_ORDER =
  /(أريد|اريد|أبغى|ابغى|أبي|ابي|أبا|اباء|عايز|عاوز|محتاج|أحتاج|احتاج|اعطني|أعطني|اعرض|أعرض|عرض|ابحث|أبحث|دور لي|دوّر لي|دور|هات|جيب|ودّي|ورني|ورّيني|اعرضلي|اعرض لي|ابي اشوف|ابغى اشوف)/;

const REALESTATE_RE =
  /\b(rent|buy|sell|lease|villa|villas|apartment|apartments|flat|studio|house|houses|home|homes|property|properties|real ?estate|land|plot|farm|chalet|resort|building|compound|townhouse|duplex|penthouse|office|shop|warehouse|commercial|bedroom|bed|sqm|square ?met|meters)\b|\b(riyadh|jeddah|khobar|dammam|mecca|makkah|medina|madinah|saudi|ksa|narjis|malqa|olaya|hittin|yasmin|corniche)\b|\bsar\b|\d{3,}/i;

const GREETING_RE = /^(hi|hey+|hello|yo|salam|hala|howdy|good (morning|afternoon|evening))\b/i;
const THANKS_RE = /(thank|thx)/i;
const SMALLTALK_RE = /(how are you|how's it going|what's up|who are you|what can you do)/i;

// Common real-estate / city typos → corrected form.
const SPELL: Record<string, string> = {
  vila: 'villa', villla: 'villa', vlla: 'villa', apparment: 'apartment', appartment: 'apartment',
  apartmnt: 'apartment', aparment: 'apartment', hse: 'house', hous: 'house', hosue: 'house',
  riyad: 'Riyadh', riadh: 'Riyadh', riyhad: 'Riyadh', ryadh: 'Riyadh', jeddh: 'Jeddah',
  jedah: 'Jeddah', jedda: 'Jeddah', khobr: 'Khobar', dammm: 'Dammam', proprty: 'property',
  propery: 'property', estaet: 'estate', buidling: 'building', comercial: 'commercial',
};

function spellFix(v: string): { text: string; corrected: boolean } {
  let corrected = false;
  const text = v.replace(/[A-Za-z]+/g, (w) => {
    const fix = SPELL[w.toLowerCase()];
    if (fix && fix.toLowerCase() !== w.toLowerCase()) {
      corrected = true;
      return fix;
    }
    return w;
  });
  return { text, corrected };
}

// Approximate currency → SAR, so a user who types another currency still gets a sane price.
// Includes the short Gulf aliases people actually type (SR=SAR, BD=BHD, KD=KWD, QR=QAR, DH=AED…)
// so the same amount resolves the same whether written long or short.
const CURRENCY_RATES: Record<string, number> = {
  sar: 1, sr: 1, riyal: 1,
  usd: 3.75, dollar: 3.75, aed: 1.02, dh: 1.02, dhm: 1.02, dhs: 1.02, dirham: 1.02,
  eur: 4.1, euro: 4.1, gbp: 4.8, pound: 4.8,
  kwd: 12.2, kd: 12.2, dinar: 12.2, bhd: 9.95, bd: 9.95,
  qar: 1.03, qr: 1.03, omr: 9.75, egp: 0.08,
};

const TYPE_SYNONYMS: Record<string, string> = {
  flat: 'Apartment', apt: 'Apartment', studio: 'Apartment', penthouse: 'Apartment', duplex: 'Floor',
  mansion: 'Villa', palace: 'Villa', townhouse: 'House', home: 'House', dwelling: 'House',
  tower: 'Building', block: 'Building', plot: 'Residential Land', cabin: 'Chalet',
  workspace: 'Office', clinic: 'Office', storage: 'Warehouse', depot: 'Warehouse',
  store: 'Shop', retail: 'Shop', boutique: 'Shop', gallery: 'Showroom', garage: 'Workshop',
  plant: 'Factory', ranch: 'Farm', orchard: 'Agriculture Plot', campsite: 'Camp',
};

const ALL_TYPES = (Object.entries(CATEGORY_TYPES) as [Category, string[]][]).flatMap(([cat, types]) =>
  types.map((t) => [t, cat] as [string, Category]),
);

// Cities the free-text parser recognizes in English queries. Longer names first so "Al Khobar"
// matches before "Khobar". Kept focused (production hands free text to the LLM agent, PRD §13).
const CITIES = [
  'Hafar Al Batin', 'Khamis Mushait', 'Al Ahsa', 'Al Baha', 'Al Kharj',
  'Riyadh', 'Jeddah', 'Khobar', 'Dammam', 'Mecca', 'Medina', 'Dhahran',
  'Qatif', 'Jubail', 'Taif', 'Tabuk', 'Buraidah', 'Unaizah', 'Hail',
  'Abha', 'Najran', 'Jazan', 'Yanbu', 'Arar', 'Sakaka',
  // Eastern Province cities promoted to first-class search cities (user request): searched directly,
  // never auto-downgraded to a bigger neighbour.
  'Ras Tanura', 'Abqaiq', 'Khafji', 'Nairiyah',
  // Madinah Region cities as first-class (Medina itself is already above). (user request.)
  'AlUla', 'Badr', 'Khaybar', 'Al Mahd', 'Al Henakiyah',
  // Tabuk Region: NEOM (incl. its sub-zones Trojena/Oxagon/…) resolves to "NEOM"; + real coastal cities.
  'NEOM', 'AMAALA', 'Umluj', 'Al Wajh', 'Haql', 'Duba', 'Tayma', 'Al Bad', 'Sharma', 'Maqna', 'Wadi Disah', 'Shura Island',
  // Asir Region (Abha + Khamis Mushait already above).
  'Bisha', 'Al Namas', 'Ahad Rafidah', 'Rijal Almaa', 'Muhayil Aseer', 'Sarat Abidah', 'Tanomah', 'Dhahran Al-Janub',
  'Bareq', 'Al-Birk', 'Al-Majaridah', 'Balqarn', 'Tathleeth',
  // Hail Region (Hail capital already above).
  'Jubbah', 'Al Shuwaymis', 'Al Hait', 'Fayd', 'Baqaa', 'Ash Shinan', 'Al Ghazalah', 'Sumaira', 'Al Sulaimi', 'Al Shamli', 'Mawqaq',
  // Qassim Region (Unaizah already above; Buraydah is the Qassim spelling of Buraidah).
  'Buraydah', 'Ar Rass', 'Al Bukayriyah', 'Al Mithnab', 'Riyadh Al Khabra', 'Uyun Al Jiwa', 'Al Badayea', 'Al Shimasiyah', 'Al Nabhaniyah', 'Uqlat Al Suqur', 'Al Asyah',
  // Jazan Region (Jazan capital already above; Farasan Islands is its own search city).
  'Sabya', 'Abu Arish', 'Samtah', 'Farasan Islands', 'Baysh', 'Al Darb', 'Al Dayer', 'Al Aridhah', 'Ahad Al Masarihah', 'Al Eidabi', 'Damad', 'Fayfa', 'Al Harth', 'Al Rayta', 'Al Shuqaiq', 'Al Tuwal', 'Harub', 'Quba',
  // Al Baha Region (Al Baha capital already above). NOTE: "Al Aqiq" is also a north-Riyadh district and
  // "Al Hajr" echoes Madinah's Al-Hijr/Hegra — kept here as canonical Al Baha governorates; bare Arabic
  // العقيق/الحجر deliberately NOT mapped (they stay Riyadh-district / Hegra).
  'Baljurashi', 'Al Mikhwah', 'Al Aqiq', 'Al Mandaq', 'Qilwah', 'Bani Hassan', 'Al Hajr',
  // Al Jouf Region (Sakaka capital already above).
  'Al Qurayyat', 'Dumat Al Jandal', 'Tabarjal', 'Haditha', 'Suwayr', 'Abu Ajram', 'Al Isawiya', 'Al Nabk Abu Qasr', 'Al Nasfa', 'Zalom',
  // Northern Borders Region (Arar capital already above). "Turaif" (طريف) is distinct from Diriyah's At-Turaif (الطريف).
  'Rafha', 'Turaif', 'Al Uwayqilah', 'Jadidat Arar',
  // Najran Region (Najran capital already above; catalog labels its landmarks "Najran City" → maps to Najran).
  'Sharurah', 'Badr Al Janoub', 'Habona', 'Khubash', 'Thar', 'Yadamah', "Al Wadi'ah",
  // Riyadh Region governorates (Riyadh capital + Al Kharj already above) — from Riyadh V2. (user request: V2 governorates resolve.)
  'Diriyah', 'Al Dilam', 'Al Majmaah', 'Zulfi', 'Al Ghat', 'Thadiq', 'Huraymila', 'Rumah', 'Al Muzahimiyah', 'Dhurma', 'Al Quwayiyah', 'Al Dawadmi', 'Shaqra', 'Afif', 'Al Hariq', 'Hotat Bani Tamim', 'Al Hawtah', 'Al Aflaj', 'Wadi Al Dawasir', 'Al Sulayyil',
].sort((a, b) => b.length - a.length);

// Arabic recognition (Arabic-first). Maps Arabic terms to the English values the engine works in,
// so an Arabic free-text query resolves the same SearchQuery as its English equivalent. Production
// hands free text to the LLM agent (PRD §13); this keeps the mock usable in Arabic.
const AR_CITY: Record<string, string> = {
  'الرياض': 'Riyadh', 'رياض': 'Riyadh', 'جدة': 'Jeddah', 'جده': 'Jeddah',
  'الخبر': 'Khobar', 'خبر': 'Khobar', 'الدمام': 'Dammam', 'دمام': 'Dammam', 'مكة': 'Mecca', 'مكه': 'Mecca',
  'المدينة': 'Medina', 'المدينه': 'Medina', 'الظهران': 'Dhahran', 'الأحساء': 'Al Ahsa', 'الاحساء': 'Al Ahsa',
  'الهفوف': 'Al Ahsa', 'القطيف': 'Qatif', 'الجبيل': 'Jubail', 'الطائف': 'Taif', 'الطايف': 'Taif',
  'تبوك': 'Tabuk', 'بريدة': 'Buraidah', 'بريده': 'Buraidah', 'عنيزة': 'Unaizah', 'حائل': 'Hail',
  'أبها': 'Abha', 'ابها': 'Abha', 'خميس مشيط': 'Khamis Mushait', 'خميس': 'Khamis Mushait',
  'نجران': 'Najran', 'جازان': 'Jazan', 'جيزان': 'Jazan', 'ينبع': 'Yanbu', 'الخرج': 'Al Kharj',
  'عرعر': 'Arar', 'سكاكا': 'Sakaka', 'الباحة': 'Al Baha', 'حفر الباطن': 'Hafar Al Batin',
  'رأس تنورة': 'Ras Tanura', 'راس تنورة': 'Ras Tanura', 'بقيق': 'Abqaiq', 'الخفجي': 'Khafji', 'النعيرية': 'Nairiyah',
  'العلا': 'AlUla', 'بدر': 'Badr', 'خيبر': 'Khaybar', 'مهد الذهب': 'Al Mahd', 'المهد': 'Al Mahd', 'الحناكية': 'Al Henakiyah',
  'نيوم': 'NEOM', 'أمالا': 'AMAALA', 'أمالى': 'AMAALA', 'أملج': 'Umluj', 'الوجه': 'Al Wajh', 'حقل': 'Haql',
  'ضباء': 'Duba', 'تيماء': 'Tayma', 'البدع': 'Al Bad', 'شرما': 'Sharma', 'مقنا': 'Maqna', 'وادي الديسة': 'Wadi Disah', 'جزيرة شورى': 'Shura Island',
  'بيشة': 'Bisha', 'النماص': 'Al Namas', 'أحد رفيدة': 'Ahad Rafidah', 'رجال ألمع': 'Rijal Almaa', 'رجال المع': 'Rijal Almaa', 'محايل': 'Muhayil Aseer', 'محايل عسير': 'Muhayil Aseer',
  'سراة عبيدة': 'Sarat Abidah', 'تنومة': 'Tanomah', 'ظهران الجنوب': 'Dhahran Al-Janub', 'بارق': 'Bareq', 'البرك': 'Al-Birk', 'المجاردة': 'Al-Majaridah', 'بلقرن': 'Balqarn', 'تثليث': 'Tathleeth',
  'جبة': 'Jubbah', 'الشويمس': 'Al Shuwaymis', 'الحائط': 'Al Hait', 'فيد': 'Fayd', 'بقعاء': 'Baqaa', 'الشنان': 'Ash Shinan', 'الغزالة': 'Al Ghazalah', 'سميراء': 'Sumaira', 'السليمي': 'Al Sulaimi', 'الشملي': 'Al Shamli', 'موقق': 'Mawqaq',
  'الرس': 'Ar Rass', 'البكيرية': 'Al Bukayriyah', 'المذنب': 'Al Mithnab', 'رياض الخبراء': 'Riyadh Al Khabra', 'عيون الجواء': 'Uyun Al Jiwa', 'البدائع': 'Al Badayea', 'الشماسية': 'Al Shimasiyah', 'النبهانية': 'Al Nabhaniyah', 'عقلة الصقور': 'Uqlat Al Suqur', 'الأسياح': 'Al Asyah',
  // Jazan Region (جازان/جيزان already above). "قباء" deliberately NOT mapped here — it stays Medina's Quba Mosque.
  'صبيا': 'Sabya', 'أبو عريش': 'Abu Arish', 'ابو عريش': 'Abu Arish', 'سامطة': 'Samtah', 'فرسان': 'Farasan Islands', 'جزر فرسان': 'Farasan Islands', 'بيش': 'Baysh', 'الدرب': 'Al Darb', 'الدائر': 'Al Dayer', 'العارضة': 'Al Aridhah', 'أحد المسارحة': 'Ahad Al Masarihah', 'العيدابي': 'Al Eidabi', 'ضمد': 'Damad', 'فيفا': 'Fayfa', 'الحرث': 'Al Harth', 'الريث': 'Al Rayta', 'الشقيق': 'Al Shuqaiq', 'الطوال': 'Al Tuwal', 'هروب': 'Harub',
  // Al Baha Region (الباحة already above). "العقيق" (→Riyadh district) and "الحجر" (→Madinah Hegra) deliberately NOT mapped.
  'بلجرشي': 'Baljurashi', 'المخواة': 'Al Mikhwah', 'المندق': 'Al Mandaq', 'قلوة': 'Qilwah', 'بني حسن': 'Bani Hassan',
  // Al Jouf Region (سكاكا already above).
  'القريات': 'Al Qurayyat', 'دومة الجندل': 'Dumat Al Jandal', 'طبرجل': 'Tabarjal', 'الحديثة': 'Haditha', 'صوير': 'Suwayr', 'أبو عجرم': 'Abu Ajram', 'العيساوية': 'Al Isawiya', 'النبك أبو قصر': 'Al Nabk Abu Qasr', 'النصفة': 'Al Nasfa', 'زلوم': 'Zalom',
  // Northern Borders Region (عرعر already above). "طريف" (Turaif city) ≠ "الطريف" (Diriyah's At-Turaif).
  'رفحاء': 'Rafha', 'طريف': 'Turaif', 'العويقيلة': 'Al Uwayqilah', 'جديدة عرعر': 'Jadidat Arar',
  // Najran Region (نجران already above). Governorates + "مدينة نجران" → Najran.
  'مدينة نجران': 'Najran', 'شرورة': 'Sharurah', 'بدر الجنوب': 'Badr Al Janoub', 'حبونا': 'Habona', 'خباش': 'Khubash', 'ثار': 'Thar', 'يدمة': 'Yadamah', 'الوديعة': "Al Wadi'ah",
  // Riyadh Region governorates (Riyadh V2). "الجبيل" deliberately NOT mapped (stays Jubail in Eastern Province).
  'الدرعية': 'Diriyah', 'الدلم': 'Al Dilam', 'المجمعة': 'Al Majmaah', 'الزلفي': 'Zulfi', 'الغاط': 'Al Ghat', 'ثادق': 'Thadiq', 'حريملاء': 'Huraymila', 'رماح': 'Rumah', 'المزاحمية': 'Al Muzahimiyah', 'ضرما': 'Dhurma', 'القويعية': 'Al Quwayiyah', 'الدوادمي': 'Al Dawadmi', 'شقراء': 'Shaqra', 'عفيف': 'Afif', 'الحريق': 'Al Hariq', 'حوطة بني تميم': 'Hotat Bani Tamim', 'الحوطة': 'Al Hawtah', 'الأفلاج': 'Al Aflaj', 'وادي الدواسر': 'Wadi Al Dawasir', 'السليل': 'Al Sulayyil',
};
const AR_TYPE: Record<string, string> = {
  'شقة': 'Apartment', 'شقه': 'Apartment', 'فيلا': 'Villa', 'فلة': 'Villa', 'دور': 'Floor', 'بيت': 'House',
  'منزل': 'House', 'غرفة': 'Room', 'غرفه': 'Room', 'عمارة': 'Building', 'عماره': 'Building',
  'استراحة': 'Rest House', 'استراحه': 'Rest House', 'شاليه': 'Chalet', 'مكتب': 'Office',
  'مستودع': 'Warehouse', 'محل': 'Shop', 'معرض': 'Showroom', 'مصنع': 'Factory', 'ورشة': 'Workshop',
  'مزرعة': 'Farm', 'مزرعه': 'Farm', 'مخيم': 'Camp', 'أرض': 'Residential Land', 'ارض': 'Residential Land',
};
const RES_TYPES = new Set(CATEGORY_TYPES.Residential);
const AR_BUY = /(شراء|للبيع|تمليك|اشتري|أشتري|بيع)/;
const AR_RENT = /(إيجار|ايجار|للإيجار|للايجار|استئجار|تأجير)/;
const AR_REALESTATE = new RegExp(
  '(' + [...Object.keys(AR_CITY), ...Object.keys(AR_TYPE), 'عقار', 'عقارات', 'سكني', 'تجاري', 'غرف', 'نوم'].join('|') + ')',
);

// ── Real LLM backend (Gemini edge function) ──────────────────────────────────
// The 'agent' edge function classifies the message with a real model and returns
// the same {kind, reply, query} contract. Build a full SearchQuery from the flat
// fields it sends, deriving the category from the type (the engine needs both).
type BackendQuery = {
  deal?: string;
  location?: string;
  type?: string | null;
  detail?: string | null;
  price?: string;
  priceOriginal?: string; // the user's original foreign-currency budget, e.g. "USD 100,000"
  bothDeals?: boolean;
  priceIsAnnual?: boolean;
  sort?: string; // objective ordering the user asked for (newest/price_asc/area_desc/…)
  count?: number; // how many listings the user asked to see (1–15)
  platforms?: string[]; // platform display names the user restricted to (carried across turns by the model)
};

// AREA NICKNAMES → known district lists. The engine filters by district when these are present, so
// "north Riyadh" actually returns listings IN northern Riyadh districts (not just any Riyadh result).
// District names are kept BARE (no "حي " prefix) — the runSearch filter strips both sides before
// matching, so a stored "حي الملقا" still hits "الملقا". (user request: "the agent should know
// North Riyadh direct and show listings in North Riyadh.")
const AREA_DISTRICTS: Record<string, string[]> = {
  // Riyadh
  'riyadh:north':  ['الملقا', 'حطين', 'الياسمين', 'النرجس', 'العقيق', 'الصحافة', 'النفل', 'الورود', 'الندى', 'الربيع'],
  'riyadh:east':   ['قرطبة', 'غرناطة', 'الروضة', 'الرمال', 'النظيم', 'المونسية', 'الحمراء'],
  'riyadh:south':  ['بدر', 'الدار البيضاء', 'المصانع', 'منفوحة', 'الشفا', 'الحزم', 'لبن', 'نمار', 'العزيزية', 'سلطانة'],
  'riyadh:west':   ['السويدي', 'العريجاء', 'شبرا', 'ظهرة لبن', 'ظهرة البديعة', 'الفاخرية', 'العريجاء الغربية'],
  'riyadh:center': ['العليا', 'السليمانية', 'الملز', 'الورود', 'الفيصلية', 'المرسلات', 'المعذر', 'الديرة', 'المربع'],
  // Jeddah
  'jeddah:north':  ['الشاطئ', 'أبحر', 'الزهراء', 'الحمدانية', 'الواحة', 'النعيم'],
  'jeddah:south':  ['الجامعة', 'السبيل', 'العزيزية الجنوبية'],
  'jeddah:east':   ['الفيصلية', 'النسيم', 'الفيحاء'],
  'jeddah:west':   ['البلد', 'الشرفية', 'الكورنيش', 'النزهة'],
};

// Detect a North/South/East/West/center area phrase or an "حي X" / "in X district" mention in the
// user's raw text, scoped to the resolved city. Returns the list of district names to filter on.
function resolveDistrictsFromText(userText: string, city: string): string[] {
  const t = userText.toLowerCase();
  const ar = userText;
  const city_lc = city.toLowerCase();
  const out: string[] = [];

  const cityKey = (city_lc.includes('riyadh') || ar.includes('الرياض')) ? 'riyadh'
                : (city_lc.includes('jeddah') || ar.includes('جدة')) ? 'jeddah'
                : null;

  if (cityKey) {
    const has = (en: string[], arRe: RegExp) =>
      en.some((s) => t.includes(s)) || arRe.test(ar);
    if (has(['north '], /شمال\s*(الرياض|جدة|المدينة|الخبر|الدمام)?/)) {
      out.push(...(AREA_DISTRICTS[`${cityKey}:north`] ?? []));
    }
    if (has(['south '], /جنوب\s*(الرياض|جدة|المدينة|الخبر|الدمام)?/)) {
      out.push(...(AREA_DISTRICTS[`${cityKey}:south`] ?? []));
    }
    if (has(['east '], /شرق\s*(الرياض|جدة|المدينة|الخبر|الدمام)?/)) {
      out.push(...(AREA_DISTRICTS[`${cityKey}:east`] ?? []));
    }
    if (has(['west '], /غرب\s*(الرياض|جدة|المدينة|الخبر|الدمام)?/)) {
      out.push(...(AREA_DISTRICTS[`${cityKey}:west`] ?? []));
    }
    if (has(['central ', 'center'], /وسط\s*(الرياض|جدة|المدينة)?/)) {
      out.push(...(AREA_DISTRICTS[`${cityKey}:center`] ?? []));
    }
  }

  // Specific "حي X" / "X district" mentions — bug-fix #12: capture at most 2 Arabic tokens (was 3),
  // and stop on common scope/conjunction tokens (في / و / أو / منطقة / مدينة) so phrases like
  // «حي العزيزية في الرياض» don't capture «العزيزية في الرياض» as a district name.
  const arHi = ar.match(/حي\s+([؀-ۿ]+(?:\s+(?!في|و|أو|منطقة|مدينة)[؀-ۿ]+)?)/);
  if (arHi) out.push(arHi[1].trim());
  const enHi = userText.match(/\b(?:in|district\s+of|neighborhood\s+of)\s+(?:al[-\s])?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s*(?:district|neighborhood)?/);
  if (enHi) out.push(`Al ${enHi[1]}`);

  return Array.from(new Set(out));
}

// Platform-name → table-prefix patterns. When the user names a platform ("show me Gathern only",
// "Aqar and Wasalt"), we restrict results to it. Conservative on purpose: distinctive BRAND names
// only — bare "عقار" is just Arabic for "real estate", so Aqar needs its Latin name / a compound is
// matched first. Order matters only for the aqar-compounds vs bare-aqar disambiguation below.
const PLATFORM_PATTERNS: Array<[RegExp, string]> = [
  [/\bgathern\b|جاذرين|جاذر|قاذرن|كاذرن/i, 'gathern'],
  [/\bwasalt\b|وصلت/i, 'wasalt'],
  [/\baldarim\b|الدارم/i, 'aldarim'],
  [/\baqar\s*gate\b|aqargate|بوابة العقار/i, 'aqargate'],
  [/\bal\s*hoshan\b|alhoshan|الحوشان/i, 'alhoshan'],
  [/\bhajer\b|بيوت هجر|هجر/i, 'hajer'],
  [/\bsanadak\b|سندك/i, 'sanadak'],
  [/\beast\s*abha\b|eastabha|شرق ابها/i, 'eastabha'],
  [/\baqar\s*city\b|aqarcity|مدينة العقار/i, 'aqarcity'],
  [/\braghdan\b|رغدان/i, 'raghdan'],
  [/\bcandles\b|eaqartabuk|شموع/i, 'eaqartabuk'],
  [/\bsatel\b|ساتل/i, 'satel'],
  [/\bsadin\b|سادن/i, 'sadin'],
  [/\btoor\b|تور/i, 'toor'],
  [/\bmustqr\b|mustaqarr|مستقر/i, 'mustqr'],
  [/ramz\s*al\s*qass?im|ramzalqasim|رمز القصيم/i, 'ramzalqasim'],
  [/fursa\s*ghyr|fursaghyr|فرصة غير/i, 'fursaghyr'],
  [/jazan\s*watan|jazwtn|جازان وطن/i, 'jazwtn'],
  [/\bmizlaj\b|مزلاج/i, 'mizlaj'],
  [/\bmuktamel\b|مكتمل/i, 'muktamel'],
  [/\baqaratikom\b|عقاراتكم/i, 'aqaratikom'],
  [/\bawal\b|أوال|اوال/i, 'awal'],
  [/al\s*khaas|alkhaas|الخاص/i, 'alkhaas'],
  [/\babeea\b|ابيعا|أبيعا/i, 'abeea'],
  [/\bjurash\b|جرش/i, 'jurash'],
  [/al\s*nokhba|alnokhba|النخبة/i, 'alnokhba'],
  [/deal\s*app|dealapp|ديل/i, 'dealapp'],
  [/era\s*pulse|erapulse|نبض/i, 'erapulse'],
  [/al\s*nowaisiry|nowaisiry|النويصري/i, 'nowaisiry'],
  [/1\s*october|october|اكتوبر|أكتوبر/i, 'october'],
];
function resolveSourcesFromText(text: string): string[] {
  const out = new Set<string>();
  for (const [re, prefix] of PLATFORM_PATTERNS) if (re.test(text)) out.add(prefix);
  // Bare "Aqar" only when no aqar-compound already matched (so "Aqar Gate" → aqargate, not both).
  if (!out.has('aqargate') && !out.has('aqarcity') && !out.has('aqaratikom') && /\baqar\b|aqar\.fm/i.test(text)) {
    out.add('aqar');
  }
  return Array.from(out);
}
// Apply a platform filter (and Gathern's monthly implication) onto a query built from any path.
// Two signals are unioned: (1) platform names the EDGE resolved & CARRIES ACROSS TURNS (so "yes" to
// "did you mean Deal App?" still filters to Deal App), and (2) names in the raw current message (the
// offline-fallback path). Both run through resolveSourcesFromText to map any spelling → table prefix.
// (user: "deal doesn't show when I type it" — the name was in a prior turn; rely on the edge field.)
function applySourceFilter(q: SearchQuery, userText: string, edgePlatforms?: string[]): void {
  const set = new Set<string>();
  for (const p of edgePlatforms ?? []) for (const s of resolveSourcesFromText(p)) set.add(s);
  for (const s of resolveSourcesFromText(userText)) set.add(s);
  const sources = Array.from(set);
  if (!sources.length) return;
  q.sources = sources;
  // Gathern is monthly-only furnished rent — naming it means the user wants its monthly inventory,
  // so force Rent + monthly (otherwise the monthly-only table is never queried). (user request.)
  if (sources.includes('gathern')) {
    q.deal = 'Rent';
    q.bothDeals = false;
    q.rentPeriod = 'monthly';
  }
}

// Proximity / landmark / street cues → the Arabic-primary search TERMS matched against a listing's own
// text (street_name / title / description) in runSearch. CONSERVATIVE on purpose: the noun terms fire
// only with a clear "near/قريب" cue (so a place called "Park View" never becomes a park search); a
// named street fires on its explicit شارع/طريق/"street" marker. Arabic terms only — descriptions are
// Arabic and Arabic is the primary matching key (agent_notes id 3 rule 6). Empty for an ordinary search.
const PROX_CUE = /\b(near|close to|next to|beside|walking distance|overlook|facing)\b|قريب|قرب|بجانب|\bجنب\b|جوار|مقابل|يطل|تطل|حذاء|ملاصق|محاذي|قبالة/i;
const NEARBY_LEX: { re: RegExp; terms: string[] }[] = [
  { re: /mosque|masjid|مسجد|جامع/i, terms: ['مسجد', 'جامع'] },
  { re: /school|مدرسة|مدرسه|مدارس/i, terms: ['مدرسة', 'مدارس'] },
  { re: /\bpark\b|garden|حديقة|حديقه|منتزه|متنزه/i, terms: ['حديقة', 'منتزه'] },
  { re: /hospital|clinic|مستشفى|مستوصف|عيادة/i, terms: ['مستشفى', 'عيادة'] },
  { re: /university|college|جامعة|كلية/i, terms: ['جامعة', 'كلية'] },
  { re: /\bmall\b|بلازا|سنتر/i, terms: ['مول', 'بلازا'] },
  { re: /metro|مترو|محطة/i, terms: ['مترو', 'محطة'] },
  { re: /corniche|كورنيش/i, terms: ['كورنيش'] },
  { re: /\bbeach\b|seafront|شاطئ/i, terms: ['شاطئ'] },
  { re: /airport|مطار/i, terms: ['مطار'] },
];
function extractNearbyKeywords(text: string): string[] {
  const out = new Set<string>();
  if (PROX_CUE.test(text)) for (const { re, terms } of NEARBY_LEX) if (re.test(text)) terms.forEach((x) => out.add(x));
  // A named street/road → match the street name itself ("شارع الملك فهد" → "الملك فهد"). Trim a trailing
  // "في المدينة / حي …" so the keyword is just the street, not the city.
  const ar = text.match(/(?:شارع|طريق)\s+([^\n,،.()]{2,30})/);
  const en = text.match(/\b([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(?:street|st\.?|road|rd\.?)\b/i);
  let st = ar ? ar[1].replace(/\s+(في|قرب|قريب|بجانب|بحي|حي)\s+.*/, '').trim() : (en ? en[1].trim() : '');
  st = st.replace(/^(?:on|in|at|the|near|by)\s+/i, '').trim();
  if (st.length >= 2) out.add(st);
  return [...out];
}

function queryFromBackend(b: BackendQuery, userText: string = ''): SearchQuery {
  const q = emptyQuery();
  q.deal = b.deal === 'Buy' ? 'Buy' : 'Rent';
  if (b.bothDeals === true) q.bothDeals = true; // agent searched without knowing rent/buy → show both
  if (b.priceIsAnnual === true) q.priceIsAnnual = true; // agent annualized a daily/weekly/monthly rent
  q.location = typeof b.location === 'string' ? b.location.trim() : '';

  const ty = typeof b.type === 'string' && b.type.trim() ? b.type.trim() : null;
  if (ty) {
    if (isCleanType(ty)) {
      // The agent already returned a CLEAN type (it knows them from the DB behavior notes, e.g.
      // "Residential Building", "Specialized Facilities") → use it directly with its macro.
      q.type = ty;
      q.category = CLEAN_MACRO[ty];
    } else {
      // A raw/legacy type → resolve to the engine type, then normalize to the same clean type the
      // filter uses, so both paths produce one normalized query before the DB. (user: filter + AI
      // must end with the exact same property type.)
      const hit = ALL_TYPES.find(([k]) => k.toLowerCase() === ty.toLowerCase());
      if (hit) {
        q.type = hit[0];
        q.category = hit[1];
      } else {
        q.type = ty;
        q.category = RES_TYPES.has(ty) ? 'Residential' : 'Commercial';
      }
      const norm = normalizeType(q.type, q.category === 'Commercial' ? 'com' : 'res');
      q.type = norm.clean === 'Unknown' ? null : norm.clean;
      q.category = norm.macro;
    }
  }

  // `detail` may be a bedroom count (1–5+) OR a size in m² — for a home the user can give EITHER (their
  // choice). We keep whatever was given; the summary labels it Bedrooms vs Size by its value.
  const detail = typeof b.detail === 'string' && b.detail.trim() ? b.detail.trim() : null;
  if (detail) q.detail = detail;

  q.priceInput = String(b.price ?? '').replace(/[^\d]/g, '');
  if (typeof b.priceOriginal === 'string' && b.priceOriginal.trim()) q.priceOriginal = b.priceOriginal.trim();
  if (typeof b.sort === 'string' && b.sort.trim() && b.sort !== 'none') q.sort = b.sort.trim() as SearchQuery['sort'];
  if (typeof b.count === 'number' && b.count >= 1) q.count = Math.min(Math.floor(b.count), 25);
  // Layer on the explicit district resolution from the raw user text — area phrases ("North
  // Riyadh") expand to known district lists; literal district mentions ("حي الرمال") pass through.
  const districts = resolveDistrictsFromText(userText, q.location);
  if (districts.length) q.districts = districts;
  applySourceFilter(q, userText, b.platforms);
  // Street / "near a mosque|school|park" terms from the raw message (Q3) — matched against the
  // listing's own street/title/description in runSearch; empty for an ordinary search.
  const kw = extractNearbyKeywords(userText);
  if (kw.length) q.keywords = kw;
  return q;
}

// Call the edge function. Returns an AgentTurn on success, or null on any failure
// (no backend configured, network error, model not ready) so respond() can fall
// back to the bundled heuristic and the app never hard-fails.
export type AgentHistoryTurn = { role: 'user' | 'model'; text: string };

async function callAgentBackend(
  text: string,
  ctx: { loggedIn: boolean; order: boolean; history?: AgentHistoryTurn[] },
): Promise<AgentTurn | null> {
  if (!supabase) return null;
  try {
    // Runtime landmark lookup: the prompt only carries ~40 distilled anchors, so we resolve the
    // long tail (any of the 607-record catalog) deterministically on the client and pass the
    // recognition hint to the model — "Boulevard City = ... (Mall), Riyadh" — so it never has to
    // know every landmark itself, and never asks "which city?" for one it could have recognized.
    await ensureLandmarks(); // make sure the DB-backed catalog is loaded before recognition
    const lmHint = landmarkHint(text);
    const { data, error } = await supabase.functions.invoke('agent', {
      body: {
        text,
        locale: getLocale(),
        loggedIn: ctx.loggedIn,
        order: ctx.order,
        history: ctx.history ?? [],
        landmarkHint: lmHint || undefined,
      },
    });
    if (error || !data || (data as any).error || !(data as any).kind) return null;
    const d = data as any;
    if (d.kind === 'interview') return { kind: 'interview' };
    if (d.kind === 'listings') {
      return {
        kind: 'listings',
        reply: String(d.reply ?? ''),
        query: queryFromBackend(d.query ?? {}, text),
      };
    }
    if (d.kind === 'message') return { kind: 'message', reply: String(d.reply ?? '') };
    return null;
  } catch {
    return null;
  }
}

// Parse a free-text message into a full SearchQuery. Unstated fields stay at their empty defaults
// so the search broadens rather than dead-ends (PRD §6.1).
export function parseQuery(text: string): SearchQuery {
  const t = text.toLowerCase();
  const q = emptyQuery();

  if (/\b(buy|sale|for sale|purchase|buying)\b/.test(t) || AR_BUY.test(text)) q.deal = 'Buy';
  else if (/\b(rent|lease|rental|renting|to let)\b/.test(t) || AR_RENT.test(text)) q.deal = 'Rent';

  for (const city of CITIES) {
    if (t.includes(city.toLowerCase())) {
      q.location = city;
      break;
    }
  }
  if (!q.location) {
    for (const [ar, en] of Object.entries(AR_CITY)) {
      if (text.includes(ar)) {
        q.location = en;
        break;
      }
    }
  }

  let foundType: string | null = null;
  let foundCat: Category | null = null;
  for (const [ty, cat] of ALL_TYPES) {
    if (new RegExp('\\b' + ty.toLowerCase() + '\\b').test(t)) {
      foundType = ty;
      foundCat = cat;
      break;
    }
  }
  if (!foundType) {
    for (const [ar, en] of Object.entries(AR_TYPE)) {
      if (text.includes(ar)) {
        foundType = en;
        foundCat = RES_TYPES.has(en) ? 'Residential' : 'Commercial';
        break;
      }
    }
  }
  if (!foundType) {
    for (const [syn, ty] of Object.entries(TYPE_SYNONYMS)) {
      if (new RegExp('\\b' + syn + '\\b').test(t)) {
        foundType = ty;
        foundCat = ALL_TYPES.find(([k]) => k === ty)?.[1] ?? null;
        break;
      }
    }
  }
  if (foundType) {
    // Normalize to the clean type (same as the edge + filter paths).
    const norm = normalizeType(foundType, foundCat === 'Commercial' ? 'com' : 'res');
    q.type = norm.clean === 'Unknown' ? null : norm.clean;
    q.category = norm.macro;
  }

  const beds = t.match(/(\d+)\s*(?:bed|bedroom|br)\b/) ?? text.match(/(\d+)\s*(?:غرف|غرفة|غرفه)/);
  if (beds) q.detail = parseInt(beds[1], 10) >= 5 ? '5+' : beds[1];

  // Pick the budget figure. Scan every number and skip the ones that are clearly bedroom counts or
  // sizes (a "3" in "3 bedroom" or "250" in "250 sqm" must not be read as the price), so a query
  // like "3 bedroom villa under 90000" resolves the price to 90,000 rather than to 3.
  const NUM_RE =
    /(\d[\d,.]*)\s*(?:(k|m|mn|million|thousand|bn|billion)(?![A-Za-z]))?\s*(sar|sr|riyal|usd|\$|dollar|aed|dirham|dhm|dhs|dh|eur|€|euro|gbp|£|pound|kwd|kd|dinar|bhd|bd|qar|qr|omr|egp)?/gi;
  for (const mm of t.matchAll(NUM_RE)) {
    const tail = t.slice(mm.index + mm[0].length, mm.index + mm[0].length + 12);
    // Skip figures that are bedroom counts or AREA (sqm/m²/sqft/ft²) — those aren't the budget.
    if (/^\s*(bed|bedroom|br\b|sqm|sq\.?\s*m|m2|m²|meter|metre|sqft|sq\.?\s*ft|ft2|ft²|foot|feet|sq\b)/i.test(tail)) continue;
    let n = parseFloat(mm[1].replace(/,/g, ''));
    const scale = (mm[2] || '').toLowerCase();
    if (scale === 'k' || scale === 'thousand') n *= 1000;
    if (scale === 'm' || scale === 'mn' || scale === 'million') n *= 1_000_000;
    if (scale === 'bn' || scale === 'billion') n *= 1_000_000_000;
    const cur = (mm[3] || '').toLowerCase();
    if (cur && cur !== 'sar' && cur !== 'sr' && cur !== 'riyal') {
      const rate = CURRENCY_RATES[cur];
      if (rate) n = Math.round(n * rate);
    }
    if (n >= 100) {
      q.priceInput = String(Math.round(n));
      break;
    }
  }

  applySourceFilter(q, text);
  const kw = extractNearbyKeywords(text);
  if (kw.length) q.keywords = kw;
  return q;
}

// Act like a real assistant when reading the request back: fix the user's wording. Foreign
// currencies are converted to SAR, shorthand amounts ("90k", "2 million") are expanded into full
// grouped numbers, and area units ("sqm", "m2", "square meters") are normalised to m². This is
// purely how Ezhalah ECHOES the request — the search engine does its own parsing. (user request:
// "you fix measurements, currencies, money, everything — act like an AI agent.")
function normalizeForReadback(original: string): string {
  const { text: fixed } = spellFix(original);
  let s = toLatinDigits(fixed);

  // 1) Area units → m² (do this first so later number passes see a normalised unit and skip it).
  //    Imperial (sqft/ft²) is converted to metric: 1 sq ft ≈ 0.092903 m².
  s = s.replace(
    /(\d[\d,.]*)\s*(?:sq\.?\s*ft|sqft|ft2|ft²|square\s*f(?:ee|oo)t)\b/gi,
    (whole, num) => {
      const n = parseFloat(String(num).replace(/,/g, ''));
      if (!isFinite(n)) return whole;
      return `${grouped(Math.round(n * 0.092903))} m²`;
    },
  );
  s = s
    .replace(/(\d)\s*(?:sq\.?\s*m|sqms?|m2|square\s*met(?:er|re)s?)\b/gi, '$1 m²')
    .replace(/\bsquare\s*met(?:er|re)s?\b/gi, 'm²')
    .replace(/(\d)\s*(?:قدم\s*مربع|قدم)/g, (whole: string, num: string) => {
      const n = parseFloat(toLatinDigits(num));
      return isFinite(n) ? `${grouped(Math.round(n * 0.092903))} م²` : whole;
    })
    .replace(/(\d)\s*(?:متر\s*مربع|م2|متر)/g, '$1 م²');

  // 2) Currency amounts → SAR. Handles symbols ($/€/£), codes (usd/aed/eur…), words
  //    (dollars/dirhams/pounds…) and an optional scale (k/m/million/thousand), e.g.
  //    "$3,000" → "SAR 11,250", "2k dollars" → "SAR 7,500", "1.5 million eur" → "SAR 6,150,000".
  const symCur: Record<string, string> = { '$': 'usd', '€': 'euro', '£': 'pound' };
  const sar = getLocale() === 'en' ? 'SAR' : 'ريال';
  const CUR_RE =
    /(?:([$€£])\s*)?(\d[\d,.]*)(?:\s*(million|thousand|billion|mn|bn|k|m)(?![A-Za-z]))?(?:\s*(usd|us\$|dollars?|aed|dirhams?|dhm|dhs|dh|euros?|eur|gbp|pounds?|kwd|dinars?|bhd|bd|kd|qar|qr|omr|egp|sar|sr|riyals?|دولار(?:ات)?|يورو|درهم|دينار|ريال(?:ات)?)(?![A-Za-z]))?/gi;
  s = s.replace(CUR_RE, (whole, sym, numStr, scale, word) => {
    let curKey = '';
    if (word) {
      const w = word.toLowerCase();
      const arMap: Record<string, string> = {
        'دولار': 'usd', 'دولارات': 'usd', 'يورو': 'euro', 'درهم': 'dirham', 'دينار': 'dinar',
        'ريال': 'sar', 'ريالات': 'sar',
      };
      if (arMap[w]) curKey = arMap[w];
      else if (w === 'us$' || w === 'usd') curKey = 'usd';
      else curKey = w.replace(/s$/, ''); // dollars→dollar, riyals→riyal, dirhams→dirham, euros→euro
    } else if (sym && symCur[sym]) {
      curKey = symCur[sym];
    }
    const rate = CURRENCY_RATES[curKey];
    if (!rate) return whole; // no currency → leave the number for the shorthand pass below
    let n = parseFloat(numStr.replace(/,/g, ''));
    if (!isFinite(n)) return whole;
    const sc = (scale || '').toLowerCase();
    if (sc === 'k' || sc === 'thousand') n *= 1_000;
    if (sc === 'm' || sc === 'mn' || sc === 'million') n *= 1_000_000;
    if (sc === 'bn' || sc === 'billion') n *= 1_000_000_000;
    return `${sar} ${grouped(Math.round(n * rate))}`;
  });

  // 3) Standalone shorthand amounts (no currency) → full grouped numbers. The negative lookahead
  //    keeps "250 m²" from being read as "250 million".
  s = s.replace(/(\d[\d,.]*)\s*(million|thousand|billion|mn|bn|k|m)(?![²\w])/gi, (whole, numStr, scale) => {
    let n = parseFloat(numStr.replace(/,/g, ''));
    if (!isFinite(n)) return whole;
    const sc = scale.toLowerCase();
    if (sc === 'k' || sc === 'thousand') n *= 1_000;
    else if (sc === 'm' || sc === 'mn' || sc === 'million') n *= 1_000_000;
    else if (sc === 'bn' || sc === 'billion') n *= 1_000_000_000;
    return grouped(Math.round(n));
  });

  return s.replace(/\s+/g, ' ').trim();
}

// Lead every listings reply with a clean restatement of what the user wrote — corrected for typos,
// with currencies/measurements normalised and shown with Western digits — so Ezhalah always "reads
// back" the request before the cards appear. (user request: "always retype as an AI what the user
// wrote… fix what he wrote… always rewrite what the user wrote before displaying the property.")
function withRestate(original: string, tail: string): string {
  const shown = normalizeForReadback(original);
  const lead =
    getLocale() === 'en'
      ? `Got it — you're looking for "${shown}".`
      : `تمام، فهمت أنك تبحث عن «${shown}».`;
  return tail ? `${lead} ${tail}` : lead;
}

// Platform-filter safety net. If the user clearly NAMES one of our platforms to FILTER by
// ("show me Aqar only", "Gathern فقط", "give me wasalt") — an imperative, NOT a "which sites do you
// search?" question — but the model deflected with a non-search reply, we run the search ourselves.
// This guarantees a named-platform filter ALWAYS returns that platform, independent of the model's
// mood (the LLM is unreliable for a bare platform-only request). Genuine confidentiality QUESTIONS
// keep the model's neutral deflection. (user: "if I type give me aqar only, show me aqar only.")
const PLATFORM_Q_RE = /[?؟]|\b(do|does|did|are|is|can|could|would|which|what|where|how|why|who)\b|\b(هل|وش|وين|كيف|ليش|ايش|إيش)\b/i;
function maybeForcePlatformSearch(turn: AgentTurn, text: string): AgentTurn {
  if (turn.kind === 'listings') return turn;       // already searching → sources set by queryFromBackend
  const sources = resolveSourcesFromText(text);
  if (!sources.length) return turn;                // no platform named → leave the model's reply
  if (PLATFORM_Q_RE.test(text)) return turn;       // "do you search Aqar?" → keep neutral deflection
  const q = parseQuery(text);                      // applySourceFilter sets q.sources (+ Gathern→monthly)
  if (!q.sources || !q.sources.length) return turn;
  return { kind: 'listings', reply: withRestate(text, ''), query: q };
}

// Classify the message and craft a neutral reply. Deterministic; the listings themselves are
// produced by runSearch in the store so the agent path and the filter path share one engine.
//
// Auth-aware (user request): a GUEST (not signed in) is search-first — any property query shows
// listings right away. A LOGGED-IN user gets a full conversational assistant — listings appear ONLY
// when they give a direct search order ("I want…/show me…/أريد…"); otherwise Ezhalah just helps,
// neutrally, like a normal assistant and invites them to say "show me" when ready.
export async function respond(text: string, opts?: { loggedIn?: boolean; history?: AgentHistoryTurn[] }): Promise<AgentTurn> {
  const v = text.trim();
  const loggedIn = !!opts?.loggedIn;
  if (!v) return { kind: 'message', reply: t("Tell me what you're looking for and I'll search for it.") };

  if (INTERVIEW_RE.test(v)) return { kind: 'interview' };

  if (DISTRESS_RE.test(v)) {
    return {
      kind: 'message',
      reply: t(
        "I'm really sorry you're feeling this way, please reach out to someone you trust. I'm Ezhalah and I help with real estate in Saudi Arabia, what are you looking for?",
      ),
    };
  }

  const order = ORDER_RE.test(v) || AR_ORDER.test(v);

  // Real LLM agent (Gemini edge function). It handles Arabic natively, applies the non-advisory
  // rules, and now also the auth-aware behavior (we pass loggedIn + order). If it's unavailable for
  // any reason, fall through to the bundled heuristic below so the app never hard-fails.
  const backend = await callAgentBackend(v, { loggedIn, order, history: opts?.history });
  if (backend) {
    // Named-platform filter safety net: if the user said "Aqar only" / "Gathern فقط" but the model
    // deflected, force the search. When we override, the reply is already final — return as-is.
    const forced = maybeForcePlatformSearch(backend, v);
    if (forced !== backend) return forced;
    // For a GUEST listings search we lead with the deterministic normalization echo ("Got it — you're
    // looking for …" with currencies/measurements fixed), keeping the fast search-first feel. For a
    // LOGGED-IN user the model already returns its own structured read-back ("Here is what I have for
    // you: …" — user's prompt spec), so we show that verbatim and DON'T prepend a second restatement.
    if (backend.kind === 'listings' && !loggedIn) backend.reply = withRestate(v, backend.reply);
    return backend;
  }

  // ── Heuristic fallback (backend unavailable) ──────────────────────────────────
  const fixed = spellFix(v);
  const isRealEstate = REALESTATE_RE.test(fixed.text) || AR_REALESTATE.test(v);

  // Logged-in users get a normal assistant: only pull listings on a direct order; otherwise help
  // them think it through (neutrally — no recommendations, no "best", no financial advice).
  if (loggedIn && !order) {
    if (ADVICE_RE.test(v)) {
      return {
        kind: 'message',
        reply: t(
          "I can't recommend or rank options for you — the choice is yours. But tell me your situation (where, rent or buy, rough size or budget) and I'll lay out neutral listings whenever you say \"show me\".",
        ),
      };
    }
    if (isRealEstate) {
      return {
        kind: 'message',
        reply: t(
          "Happy to help you think it through. Tell me roughly what you need — where, rent or buy, and a size or budget — and whenever you're ready just say \"show me\" and I'll pull up listings.",
        ),
      };
    }
    // greetings / thanks / small talk fall through to the shared handlers below.
  } else {
    // Guest, or a logged-in user giving a direct order → show listings for any property search.
    if (isRealEstate || order) {
      const base = t('Here are some properties you might be interested in:');
      return { kind: 'listings', reply: withRestate(v, base), query: parseQuery(fixed.text) };
    }
    if (ADVICE_RE.test(v)) {
      return {
        kind: 'message',
        reply: t(
          "I can only show you listings, I can't recommend or advise. But I can show you a mix of both options in one set if you'd like. Just tell me what you're after.",
        ),
      };
    }
  }

  if (GREETING_RE.test(v)) {
    return {
      kind: 'message',
      reply: t(
        "Hey! I'm Ezhalah, your real estate assistant for Saudi Arabia. Tell me what you're looking for, to rent or buy, and I'll find it.",
      ),
    };
  }
  if (THANKS_RE.test(v)) {
    return {
      kind: 'message',
      reply: t("You're welcome! I'm Ezhalah, whenever you're ready, tell me what property you're after and I'll search for it."),
    };
  }
  if (SMALLTALK_RE.test(v)) {
    return {
      kind: 'message',
      reply: t("I'm Ezhalah, your real estate assistant for Saudi Arabia. Tell me what you're looking for and I'll find listings for you."),
    };
  }

  return {
    kind: 'message',
    reply: t("I'm Ezhalah, I only help with real estate across Saudi Arabia. Tell me what you're looking for, or tap Filter at the top to search by details."),
  };
}
