// The Ezhalah AI Agent. Turns a free-text message into either a neutral listing search or a
// plain reply. It is deliberately NON-ADVISORY (PRD §7): it never recommends a property, never
// says "best/better/good deal", and never gives buying or financial advice — it only acknowledges
// and presents matching listings for the user to choose from.
//
// This is the mock-first heuristic. The async `respond` signature is the seam where a Saudi-hosted
// LLM endpoint slots in later (PRD §13 open question on the agent backend); the classification
// contract (AgentTurn) stays the same so the chat UI never changes.

import { emptyQuery, digitsOnly, grouped, type SearchQuery } from './search';
// The text-preserving latinizer. NOT './search' — that one keeps only the digits (see digitsOnly).
import { toLatinDigits } from '@/lib/inputHygiene';
import { parseProximity, proximityKeywords, type ProximityIntent } from './proximity';
import { type Category } from './taxonomy';
import { t, getLocale } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { partitionRequestedAmenities, cohortAllows } from '@/lib/afCohorts';
import { certifyAfOnMergedState as certifyAf, type CertifiableBackendQuery } from '@/lib/afCertify';
import { mergeConversationState, rescuedFields, describeKnownState } from '@/lib/conversationState';
import { landmarkHint, ensureLandmarks } from './landmarks';
import { normalizeType, isCleanType, CLEAN_MACRO } from './propertyTypes';

// askCount (owner-approved consolidation, 2026-08-30): the SERVER's own running clarifying-question
// count for this chat, echoed back on every turn. Conversation-scoped and never reset mid-chat by
// the client — src/app/agent.tsx just stores whatever the server last said. Optional because the
// bundled offline heuristic (backend unavailable) has no such concept and never sets it.
export type AgentTurn =
  | { kind: 'listings'; reply: string; query: SearchQuery; askCount?: number }
  // `query` is the state the agent understood on a turn that did NOT search — a clarification.
  // Optional because most message turns carry nothing; present, it MUST be remembered (see below).
  | { kind: 'message'; reply: string; query?: SearchQuery; askCount?: number; locationQuestion?: boolean }
  | { kind: 'interview'; askCount?: number };

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

// English free-text synonyms → CLEAN types only (canon = propertyTypes CLEAN_MACRO). studio/duplex
// used to mis-map to Apartment/Floor before Studio/Duplex became clean types; 'tower'/'block' used to
// map to the retired ambiguous 'Building' — removed rather than guessed (an unmapped word simply
// doesn't set a type, which broadens honestly). (audit items 1/5, 2026-07-27)
const TYPE_SYNONYMS: Record<string, string> = {
  flat: 'Apartment', apt: 'Apartment', studio: 'Studio', penthouse: 'Apartment', duplex: 'Duplex',
  mansion: 'Villa', palace: 'Villa', townhouse: 'Villa', home: 'Villa', dwelling: 'Villa',
  plot: 'Residential Land', cabin: 'Chalet',
  workspace: 'Office', clinic: 'Office', storage: 'Warehouse', depot: 'Warehouse',
  store: 'Shop', retail: 'Shop', boutique: 'Shop', gallery: 'Showroom', garage: 'Workshop',
  plant: 'Factory', ranch: 'Farm', orchard: 'Agriculture Plot', campsite: 'Camp',
};

// One source of truth: every clean type + its macro, straight from the live hierarchy
// (stale CATEGORY_TYPES retired — audit item 1, 2026-07-27).
const ALL_TYPES = Object.entries(CLEAN_MACRO).map(([t, cat]) => [t, cat] as [string, Category]);

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
  'شقة': 'Apartment', 'شقه': 'Apartment', 'فيلا': 'Villa', 'فلة': 'Villa', 'دور': 'Floor', 'بيت': 'Villa',
  'منزل': 'Villa', 'غرفة': 'Room', 'غرفه': 'Room', 'عمارة': 'Building', 'عماره': 'Building',
  'استراحة': 'Rest House', 'استراحه': 'Rest House', 'شاليه': 'Chalet', 'مكتب': 'Office',
  'مستودع': 'Warehouse', 'محل': 'Shop', 'معرض': 'Showroom', 'مصنع': 'Factory', 'ورشة': 'Workshop',
  'مزرعة': 'Farm', 'مزرعه': 'Farm', 'مخيم': 'Camp',
  // Long-tail raw types folded into an existing clean type (owner-approved mappings — see
  // propertyTypes.ts CLEAN_TO_QUERY/RAW_TO_CLEAN). Card still shows the raw scraped text; this only
  // affects which clean type free-text search resolves to.
  'كشك': 'Shop', 'درايف ثرو': 'Shop',
  'صالة': 'Commercial Building', 'سينما': 'Commercial Building',
  'محطة': 'Gas Station',
  'مكاتب مشتركة': 'Office',
  'مخازن سحابية': 'Warehouse',
  'ملحق علوي': 'Apartment', 'مبنى شقق مخدومة': 'Apartment',
  'مجمع سكني': 'Residential Building',
  'حوش': 'Residential Land',
  // SPECIALIZATIONS FIRST: this loop (see parseQuery below) does `text.includes(ar)` and breaks on
  // the first hit in insertion order, so a more specific phrase MUST be listed before any shorter
  // generic phrase it contains as a literal prefix -- 'أرض زراعية' contains 'أرض', so it has to come
  // before the bare 'أرض'/'ارض' entries below or it can never be reached. (Found live 2026-07-23:
  // the original أرض-زراعية fix was silently dead code because of exactly this ordering.)
  'أرض زراعية': 'Agriculture Plot', 'ارض زراعية': 'Agriculture Plot',
  'أرض': 'Residential Land', 'ارض': 'Residential Land',
};
const RES_TYPES = new Set(Object.entries(CLEAN_MACRO).filter(([, c]) => c === 'Residential').map(([t]) => t));
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
  rentPeriod?: string; // explicit rental period the user stated («الشهري», or a monthly/annual budget basis) — maps to q.rentPeriod
  sort?: string; // objective ordering the user asked for (newest/price_asc/area_desc/…)
  count?: number; // how many listings the user asked to see (1–15)
  platforms?: string[]; // platform display names the user restricted to (carried across turns by the model)
  regionPin?: string;   // region_ar the edge catalog backstop pinned for a TWIN city (القصب → منطقة الرياض)
  districtPin?: string; // «حي …» the edge pinned for a TWIN district resolved to one city (حي الروضة → جدة)
  amenities?: string[]; // amenity tokens the model READ OUT of the user's sentence — proposals only,
                        // certified per-cohort below before any of them can reach q.amenities
  furnished?: string;   // 'yes' | 'no' | 'none' — a PROPOSAL. NOT an amenity: it maps to the tri-state
                        // q.furnishedPref, and only where the cohort certifies the furnished question.
  af?: Record<string, unknown>; // Advanced-Filter intents the model READ OUT of the sentence, keyed by
                        // canonical AF question id. Proposals only — applyAfIntents() runs each through
                        // cohortAllows() before any of them can touch the query.
  askAbout?: string[];  // things the user expressed VAGUELY ('size', 'rating') that must be ASKED, never
                        // turned into a number. Surfaced on lastVagueIntents for the reply layer.
};

/**
 * Vague intents the user expressed that we refuse to quantify («كبير» with no area, «تقييم عالي» with
 * no number). Owner rule: understanding a word is not permission to invent a value — ask instead.
 */
export let lastVagueIntents: string[] = [];

/**
 * Amenity tokens the model proposed that this scope does NOT certify. Surfaced (not swallowed) so the
 * chat can ASK rather than answer a narrower question than the user asked. Owner rule 2026-08-29:
 * "if an amenity is not certified for that cohort, use the clarification path instead of guessing."
 */
export let lastRejectedFilters: string[] = [];

// ── SAYING SO WHEN WE COULD NOT APPLY SOMETHING (owner ruling 2026-08-30) ────────────────────────
// lastRejectedFilters was written on every refusal and read by NOBODY, so a request we could not
// honour was dropped in total silence: the search ran without it and the reply never mentioned it.
// Silently ignoring part of what someone asked for is the same class of dishonesty as pretending we
// applied it.
//
// THE SHAPE OF THE TELLING (owner): natural and short, never technical. Do not say "Advanced
// Filter", do not name a certification, do not read like an error. One plain sentence, then carry on
// and show the best valid results — an unsupported OPTIONAL filter must never block a search.
//
// SAY IT ONCE. Repeating the same caveat every turn is its own kind of noise, so a filter we have
// already explained is not explained again; the set clears when a new conversation starts.
const announcedRejections = new Set<string>();

/** A new conversation explains itself from scratch. */
export function resetRejectionNotices(): void { announcedRejections.clear(); }

/**
 * The one-sentence note for anything we refused THIS turn and have not mentioned before, or '' when
 * there is nothing new to say. Keyed by the intent id, so «تقييم» explained once stays explained
 * even as the conversation moves on.
 */
function rejectionNotice(): string {
  const fresh = lastRejectedFilters
    .map((f) => String(f).split(':')[0])           // 'rating:ممتاز' -> 'rating'
    .filter((f) => f && !announcedRejections.has(f));
  if (!fresh.length) return '';
  for (const f of fresh) announcedRejections.add(f);
  return t('That option is not available in this search, so I showed the results without it.');
}

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

  // Specific "حي X" / "X district" mentions — capture EVERY one (multi-district same-city OR search,
  // Q33: «حي الملقا أو حي حطين أو حي الياسمين»). Each match is ≤2 Arabic tokens, stopping on
  // scope/conjunction tokens (في/و/أو/منطقة/مدينة) so «حي العزيزية في الرياض» captures «العزيزية», not
  // «العزيزية في الرياض». (audit #6: was a single .match() — only the first حي was kept.)
  const arHiRe = /حي\s+([؀-ۿ]+(?:\s+(?!في|و|أو|منطقة|مدينة)[؀-ۿ]+)?)/g;
  for (const m of ar.matchAll(arHiRe)) out.push(m[1].trim());
  const enHiRe = /\b(?:in|district\s+of|neighborhood\s+of)\s+(?:al[-\s])?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s*(?:district|neighborhood)?/g;
  for (const m of userText.matchAll(enHiRe)) out.push(`Al ${m[1]}`);

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
// When the edge already gave its own platform-restriction judgment (edgePlatforms is a real array,
// even an empty one), trust it verbatim — that judgment already applies the "incidental mention ≠
// restriction" nuance from its prompt (e.g. "Gathern's location is nice, I want a villa in Jeddah"
// must NOT restrict to Gathern). ALSO regex-scanning the raw text on top would silently re-add a
// platform the model correctly decided not to restrict to, defeating that exact prompt fix (found
// live 2026-07-27: the online path still returned platforms:["Gathern"] for that repro because this
// function unioned in a bare-mention regex hit regardless of the model's own empty decision).
// The raw-text regex scan is only the source of truth when there is NO edge decision at all — the
// pure offline parseQuery() fallback path, called with just (q, userText). (user: "deal doesn't show
// when I type it" — a platform named in a PRIOR turn is carried via edgePlatforms, not re-typed.)
function applySourceFilter(q: SearchQuery, userText: string, edgePlatforms?: string[]): void {
  const set = new Set<string>();
  if (edgePlatforms !== undefined) {
    for (const p of edgePlatforms) for (const s of resolveSourcesFromText(p)) set.add(s);
  } else {
    for (const s of resolveSourcesFromText(userText)) set.add(s);
  }
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
  // Geography helpers — sea/mountain/desert. «بحر(?![ةه])» avoids the town «بحرة». A bare sea/mountain/
  // desert cue with NO city is handled upstream (resolver needsCity / agent_notes Q39 asks the city);
  // here we only contribute the text-search TERMS once a city IS known. (audit #12.)
  { re: /\bsea\b|sea ?view|seafront|waterfront|بحر(?![ةه])|البحر|إطلال.* بحري|واجهة بحرية/i, terms: ['بحر', 'إطلالة بحرية', 'واجهة بحرية', 'كورنيش'] },
  { re: /\bmountain\b|highland|جبل|جبال|مرتفعات/i, terms: ['جبل', 'جبال'] },
  { re: /\bdesert\b|صحراء|البر\b/i, terms: ['صحراء'] },
  { re: /\bmarket\b|سوق|أسواق/i, terms: ['سوق', 'أسواق'] },
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

// A free-typed "location" that is actually a ROAD/STREET phrase ("طريق الملك فهد", "شارع الأمير محمد").
// Roads are proximity/location-intelligence signals, never administrative places — they must not be searched
// as a city (that yields a false zero). Detect the prefix so we can strip such a value out of q.location.
// NB: JS \b is ASCII-only and never fires after an Arabic letter, so we use an explicit separator
// lookahead instead — without it this regex silently never matched and roads stayed in q.location.
const ROAD_PREFIX_RE = /^\s*(?:على\s+|في\s+)?(?:طريق|شارع|الطريق|الشارع|درب|مخرج)(?=[\s،,]|$)/;
// Recover a real city named ANYWHERE in the user's text (Arabic-primary), or null — mirrors parseQuery's
// city scan, so «في الرياض على طريق الملك فهد» still anchors to الرياض when the agent mis-placed the road
// into q.location. Never invents a city: no match → null.
function cityFromText(text: string): string | null {
  for (const ar of Object.keys(AR_CITY)) if (text.includes(ar)) return ar;
  const lower = text.toLowerCase();
  for (const city of CITIES) if (lower.includes(city.toLowerCase())) return city;
  return null;
}

// EXPORTED so barriers can execute the REAL function instead of a copy of it. Behaviour-neutral —
// the only in-app caller is respond() below. (Repo rule: never test a stale verbatim copy; a copy
// passes while production breaks.)
/**
 * The DEFAULTED_FIELDS this turn's backend payload actually stated. The edge omits a field it did
 * not understand from the user's words, so presence here means "the user said it", while absence
 * means "not mentioned" — which is exactly the distinction mergeConversationState needs and cannot
 * make from the value alone.
 */
/**
 * THE Advanced-Filter certification pass. Runs on the MERGED state, and is the only one.
 *
 * WHY IT CANNOT LIVE IN queryFromBackend. cohortAllows() reads type, category, deal and rentPeriod —
 * and queryFromBackend only knows what THIS turn's model output carried. On a follow-up the model is
 * explicitly told not to restate what is already established, so a turn that says only «خلي تقييمها
 * ٩.٥» can arrive with no type at all; scopeCleanTypes() then returns [] and cohortAllows() rejects
 * EVERY intent the user just stated. The conversation's accumulated context only exists after
 * mergeConversationState, so certification has to happen where the cohort is actually known.
 *
 * It used to certify only the `af` family here, leaving amenities and furnished behind in
 * queryFromBackend — so those two kept the exact bug this function was written to fix. Both moved in
 * (2026-09-01), and the fresh pass was deleted rather than left to be corrected: two writers is how a
 * verdict reached against an empty cohort rode out to the user as «that option is not available in
 * this search» for a filter the merged pass had just applied.
 *
 * FOUR THINGS IT OWNS, in order:
 *   1-3. this turn's af / amenities / furnished, judged on the merged cohort;
 *   4.   the CARRIED state — a sticky answer whose cohort has since changed;
 *   5.   lastRejectedFilters, rewritten so the receipt matches the predicates that actually ran.
 *
 * Certification is still the ONLY gate. This widens the CONTEXT the gate sees, never the gate itself.
 */
function certifyAfOnMergedState(merged: SearchQuery, b: BackendQuery): SearchQuery {
  // ASSIGN, never push. This is the single writer of lastRejectedFilters after queryFromBackend's
  // per-turn reset, and verify-af-certified-on-merged-state.ts fails if a second writer appears.
  const res = certifyAf(merged, b as CertifiableBackendQuery);
  lastRejectedFilters = res.rejected;
  return res.q;
}
export function statedKeys(b: BackendQuery): string[] {
  const said: string[] = [];
  if (b.deal === 'Buy' || b.deal === 'Rent') said.push('deal');
  if (b.rentPeriod === 'monthly' || b.rentPeriod === 'annual' || b.rentPeriod === 'both') said.push('rentPeriod');
  if (b.bothDeals === true) said.push('bothDeals', 'deal');
  if (b.priceIsAnnual === true) said.push('priceIsAnnual');
  // category is never sent by the edge; it is DERIVED from the type, so it is stated exactly when a
  // type was stated.
  if (typeof b.type === 'string' && b.type.trim()) said.push('category');
  return said;
}

export function queryFromBackend(b: BackendQuery, userText: string = '', proximityTexts?: string[]): SearchQuery {
  let q = emptyQuery();
  q.deal = b.deal === 'Buy' ? 'Buy' : 'Rent';
  if (b.bothDeals === true) q.bothDeals = true; // agent searched without knowing rent/buy → show both
  if (b.priceIsAnnual === true) q.priceIsAnnual = true; // agent annualized a daily/weekly/monthly rent
  // Explicit rental-period signal from the edge («للإيجار الشهري», or a monthly/annual budget basis):
  // without this the emptyQuery() default ('annual') silently searched the ANNUAL pool for an
  // explicitly-monthly request — a 100% intent inversion (senior audit run #3, 2026-08-03: 0 of the
  // 6,909 monthly Riyadh apartments were reachable by asking for them). An unstated period keeps the
  // default — the same annual default the Filter form opens with (agent ≡ filter parity). Set BEFORE
  // applySourceFilter so the Gathern monthly-only override still wins.
  if (b.rentPeriod === 'monthly' || b.rentPeriod === 'annual' || b.rentPeriod === 'both') q.rentPeriod = b.rentPeriod;
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
  // The edge catalog backstop pinned a TWIN city's region (القصب → منطقة الرياض) or resolved a TWIN
  // district to one city (حي الروضة → جدة, districtPin="حي الروضة"). Honour both so the disambiguated
  // search hits the chosen scope and is NOT re-flagged ambiguous downstream. (twin false-zero fix.)
  if (typeof b.regionPin === 'string' && b.regionPin.trim()) q.regionPin = b.regionPin.trim();
  if (typeof b.districtPin === 'string' && b.districtPin.trim()) {
    const d = b.districtPin.trim();
    q.districts = Array.from(new Set([...(q.districts ?? []), d]));
  }
  applySourceFilter(q, userText, b.platforms);
  // Street / "near a mosque|school|park" terms from the raw message (Q3) — matched against the
  // listing's own street/title/description in runSearch; empty for an ordinary search.
  // Location-RELATIONSHIP layer (2026-06-26): parse «قريب من مستشفى الحبيب» → {near, hospital,
  // الحبيب}. q.proximity drives RANKING (strong phrase + exact name first); its terms also feed the
  // keyword filter so the matched set still narrows. Merged with the legacy nearby-keyword extractor.
  // Parse over the WHOLE search attempt (every user line this attempt), not just the last message —
  // otherwise «شقة بإطلالة بحرية» followed by a clarification «جدة كاملة» loses the sea-view intent,
  // because the edge `query` buckets never carry proximity. Parse each message SEPARATELY and merge:
  // concatenating the lines would let one message's tail bleed into the next phrase's entity name
  // («...البحر  جدة كاملة» → name «البحر جدة كاملة»). (multi-turn fix 2026-06-27.)
  const proxSources = (proximityTexts && proximityTexts.length) ? proximityTexts : [userText];
  const proxSeen = new Set<string>();
  const prox: ProximityIntent[] = [];
  for (const ptxt of proxSources) {
    for (const p of parseProximity(ptxt)) {
      const k = `${p.relationship}|${p.category}|${p.name}`;
      if (!proxSeen.has(k)) { proxSeen.add(k); prox.push(p); }
    }
  }
  if (prox.length) q.proximity = prox;
  // Road phrases are PROXIMITY signals, not administrative locations. The edge agent sometimes drops a road
  // into q.location («على طريق الملك فهد» → location="طريق الملك فهد"), which would then be searched as a
  // CITY → false zero. When the user expressed a ROAD proximity AND q.location is a bare road phrase, strip
  // it (the road already rides on q.proximity) and recover a real city from everything the user said this
  // attempt, so «في الرياض على طريق الملك فهد» still anchors to الرياض. No city in the text → leave location
  // empty (normal fallback); never invent a city, never search the road as a city. Gating on an actual road
  // proximity intent means a district legitimately named after a street (picked without «على/قريب من طريق»)
  // is left untouched. (road location-extraction fix 2026-06-27.)
  if (q.location && ROAD_PREFIX_RE.test(q.location) && prox.some((p) => p.category === 'road')) {
    q.location = cityFromText(proxSources.join(' ')) ?? '';
  }
  // ANTI-GUESS: the edge agent sometimes APPENDS a city/region the user never typed («حي العزيزية» →
  // location="حي العزيزية، الخبر»; «حي الروضة» → "حي الروضة، الدمام"). That guesses the region/city, which
  // the locked rule forbids — an ambiguous district must trigger a clarification, not a silent guess. If
  // q.location is a compound «X، anchor» whose trailing anchor does NOT appear in anything the user actually
  // typed this attempt, drop the anchor and keep the BARE place. The resolver then either resolves it
  // uniquely (→ search) or flags it ambiguous (→ the chat's locationClarification asks «أي مدينة؟»). An
  // anchor the user DID type is always kept. (anti-guess location fix 2026-06-27.)
  const saidAll = proxSources.join(' ');
  if (q.location && /[،,]/.test(q.location)) {
    const parts = q.location.split(/[،,]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const anchor = parts[parts.length - 1];
      const anchorCore = anchor.replace(/^\s*(?:ال)?منطقة\s+/, '').trim();
      if (!saidAll.includes(anchor) && (!anchorCore || !saidAll.includes(anchorCore))) {
        q.location = parts.slice(0, -1).join('، ');
      }
    }
  }
  // ANTI-GUESS (bare city): for a PROXIMITY-only ask with no city, the edge sometimes fills a default city
  // into q.location («قريب من مستشفى الحبيب» → "الرياض"; «قريب من الافنيوز» → "الرياض"; a road → "جدة").
  // The proximity/landmark already rides on q.proximity, so if the whole q.location does not appear in what
  // the user actually typed this attempt, it is invented → drop it. The chat's locationClarification then
  // asks «في أي مدينة تبحث؟» instead of silently searching a guessed city. A city the user typed (or that
  // carried over from a prior turn, since proxSources is the whole attempt) is always kept. (anti-guess.)
  if (q.location && prox.length && !cityFromText(saidAll) && !saidAll.includes(q.location)) {
    q.location = '';
  }
  const kw = Array.from(new Set([...extractNearbyKeywords(userText), ...proximityKeywords(prox)]));
  if (kw.length) q.keywords = kw;
  // ── AF CERTIFICATION HAPPENS ONCE, AND NOT HERE (2026-09-01) ───────────────────────────────────
  // The amenity / furnished / af gates used to run at this point, against the query built from THIS
  // turn's model output alone. That is the wrong cohort: on a follow-up the model is told not to
  // restate what is established, so «وتكون فيها مصعد» arrives with no type, scopeCleanTypes() is []
  // and cohortAllows() refuses a filter the conversation plainly certifies. certifyAfOnMergedState()
  // is now the SINGLE certification point — it runs after mergeConversationState, where the cohort is
  // actually known, and it owns lastRejectedFilters. Two writers is how the fresh pass's verdict rode
  // out to the user as «that option is not available» for a filter the merged pass then applied.
  //
  // The per-turn RESET stays here: this function starts every turn, and the list must not accumulate
  // across turns.
  lastRejectedFilters = [];

  lastVagueIntents = Array.isArray(b.askAbout) ? [...new Set(b.askAbout)] : [];
  return q;
}

// Call the edge function. Returns an AgentTurn on success, or null on any failure
// (no backend configured, network error, model not ready) so respond() can fall
// back to the bundled heuristic and the app never hard-fails.
export type AgentHistoryTurn = { role: 'user' | 'model'; text: string };

async function callAgentBackend(
  text: string,
  ctx: {
    loggedIn: boolean; order: boolean; history?: AgentHistoryTurn[]; attemptTexts?: string[];
    prevQuery?: SearchQuery | null;
    // Conversation-scoped decision state (owner-approved consolidation, 2026-08-30) — the server is
    // the single decision authority (supabase/functions/agent/decide.ts) but has no memory of its
    // own between HTTP calls, so the client sends back exactly what it was last told.
    askCount?: number;
    // Stamped once per user SEND (src/app/agent.tsx's send()), shared by this call and any retry it
    // triggers server-side, so ai_usage rows from the same turn can be told apart from a genuine
    // second message (mon_detect_agent_calls_per_message()).
    userMessageId?: string;
    // TRUE pre-cap conversation length (this screen's msgs.length before its own history slice).
    historyTurnsRaw?: number;
  },
): Promise<AgentTurn | null> {
  if (!supabase) return null;
  try {
    // Runtime landmark lookup: the prompt only carries ~40 distilled anchors, so we resolve the
    // long tail (any of the 607-record catalog) deterministically on the client and pass the
    // recognition hint to the model — "Boulevard City = ... (Mall), Riyadh" — so it never has to
    // know every landmark itself, and never asks "which city?" for one it could have recognized.
    await ensureLandmarks(); // make sure the DB-backed catalog is loaded before recognition
    const lmHint = landmarkHint(text);
    // RC-A (hardening 2026-07-13): functions.invoke has no default timeout, and the whole search turn
    // bare-awaits this — a stalled edge call spun «إزهله يبحث» forever. Race it against a 20s ceiling
    // (agent latency runs higher than a plain query, hence 20s vs the data layer's 15s); on timeout it
    // rejects → the existing catch returns null → the retry path fires instead of hanging.
    const { data, error } = (await Promise.race([
      supabase.functions.invoke('agent', {
        body: {
          text,
          locale: getLocale(),
          loggedIn: ctx.loggedIn,
          order: ctx.order,
          history: ctx.history ?? [],
          landmarkHint: lmHint || undefined,
          // WHAT THE CONVERSATION ALREADY ESTABLISHED (owner ruling 2026-08-29). Until now the model
          // received only raw text and history, so it had to re-derive every field from prose each
          // turn and could not tell what it already knew — which is how it asks a question whose
          // answer is already in the search state. A MIRROR of state, never a source: the model may
          // not edit it, it exists so the model can stop asking.
          knownState: describeKnownState(ctx.prevQuery) || undefined,
          // The merged conversation state so far — decideAgentTurn() reads this server-side to
          // evaluate hasEnoughToSearch() against the FULL conversation, not just this turn's own
          // model output. Sent raw (the server only reads the 7 gate fields off it); the client's
          // own merge-and-certify pipeline below (mergeConversationState + certifyAfOnMergedState) is unaffected.
          prevQuery: ctx.prevQuery ?? undefined,
          askCount: ctx.askCount ?? 0,
          userMessageId: ctx.userMessageId,
          historyTurnsRaw: ctx.historyTurnsRaw,
        },
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('agent-timeout')), 20000)),
    ])) as { data: any; error: any };
    if (error || !data || (data as any).error || !(data as any).kind) return null;
    const d = data as any;
    const askCountOut = typeof d.askCount === 'number' && isFinite(d.askCount) ? d.askCount : undefined;
    if (d.kind === 'interview') return { kind: 'interview', askCount: askCountOut };
    if (d.kind === 'listings') {
      return {
        kind: 'listings',
        reply: String(d.reply ?? ''),
        askCount: askCountOut,
        // CLARIFICATION MUST NOT RESET THE CONVERSATION (owner-reported bug 2026-08-29).
        // queryFromBackend builds a FRESH query from this turn's model output, so anything the model
        // does not re-state would vanish — «شهرية» silently became RentAnnual and a 9.5 rating
        // disappeared after one more clarifying question. The accumulated state fills the gaps; an
        // explicit change in THIS turn always wins.
        // A DEFAULT IS NOT AN ANSWER. emptyQuery() supplies deal:'Rent', rentPeriod:'annual',
        // category:'Residential' — all non-empty, so the merge could not tell "the user said annual"
        // from "nobody mentioned a period this turn". A follow-up that did not restate the period
        // therefore flipped an established MONTHLY search to ANNUAL while carrying its
        // monthly-only ratingMin along, producing a query that matches almost nothing.
        // So we tell the merge exactly what this turn stated.
        query: certifyAfOnMergedState(
          mergeConversationState(
            ctx.prevQuery ?? null,
            queryFromBackend(d.query ?? {}, text, ctx.attemptTexts ?? [text]),
            statedKeys(d.query ?? {}),
          ),
          d.query ?? {},
        ),
      };
    }
    if (d.kind === 'message') {
      // A CLARIFICATION MAY PAUSE THE SEARCH; IT MAY NOT ERASE WHAT WE ALREADY UNDERSTOOD
      // (owner ruling 2026-08-30). «شقة شهرية في الرياض تقييمها ٩.٥» + a city-vs-region question used
      // to discard Apartment + monthly + rating 9.5 outright: the edge answered kind:"message" with no
      // query, and this line dropped whatever it did send. When the user then answered «منطقة الرياض»,
      // the conversation had nothing to build on and started from zero.
      //
      // Same pipeline as a listings turn — deliberately, so a paused turn and a searching turn cannot
      // accumulate state by different rules: build from this turn, merge the conversation under it,
      // then certify AF against the MERGED cohort. No search runs; only the state advances.
      const understood = d.query
        ? certifyAfOnMergedState(
            mergeConversationState(ctx.prevQuery ?? null, queryFromBackend(d.query, text, ctx.attemptTexts ?? [text]), statedKeys(d.query)),
            d.query,
          )
        : undefined;
      // locationQuestion — the edge's own verdict that this question must be ANSWERED, never
      // searched past (see supabase/functions/agent/index.ts). Carried verbatim; never inferred here.
      return { kind: 'message', reply: String(d.reply ?? ''), askCount: askCountOut,
               ...(d.locationQuestion === true ? { locationQuestion: true } : {}),
               ...(understood ? { query: understood } : {}) };
    }
    return null;
  } catch {
    return null;
  }
}

// Parse a free-text message into a full SearchQuery. Unstated fields stay at their empty defaults
// so the search broadens rather than dead-ends (PRD §6.1).
export function parseQuery(text: string): SearchQuery {
  // Latinize ONCE, at the door. Arabic-Indic digits are ordinary input here — «٣ غرف» and
  // «٧٠٠٠٠ ريال» must parse exactly like «3 غرف» / «70000 ريال». JS \d is ASCII-only, so every
  // numeric read below (bedrooms, NUM_RE budget scan) was blind to them and silently produced a
  // query with no bedrooms and no budget. toLatinDigits keeps the Arabic letters, so the city and
  // type dictionaries below still match — this is the text-preserving one, not digitsOnly.
  const src = toLatinDigits(text);
  const t = src.toLowerCase();
  const q = emptyQuery();

  if (/\b(buy|sale|for sale|purchase|buying)\b/.test(t) || AR_BUY.test(src)) q.deal = 'Buy';
  else if (/\b(rent|lease|rental|renting|to let)\b/.test(t) || AR_RENT.test(src)) q.deal = 'Rent';

  for (const city of CITIES) {
    if (t.includes(city.toLowerCase())) {
      q.location = city;
      break;
    }
  }
  if (!q.location) {
    for (const [ar, en] of Object.entries(AR_CITY)) {
      if (src.includes(ar)) {
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
      if (src.includes(ar)) {
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
    if (isCleanType(foundType)) {
      // AR_TYPE/TYPE_SYNONYMS can resolve directly to an already-CLEAN type name (e.g. AR_TYPE's
      // 'مجمع سكني' -> 'Residential Building') — use it directly with its real macro, exactly like
      // queryFromBackend already does above (line ~408), instead of re-running it through
      // normalizeType(), which expects a RAW type and has no reason to carry a self-mapping entry
      // for every clean name. Found live 2026-07-24: 'Residential Building' has no such self-entry,
      // so it fell through normalizeType()'s kind-based Unknown fallback, silently dropping the type
      // filter AND flipping category to Commercial (foundCat above is wrong for it too — RES_TYPES
      // only knows the legacy raw 'Building', not the clean 'Residential Building').
      q.type = foundType;
      q.category = CLEAN_MACRO[foundType];
    } else {
      // Normalize to the clean type (same as the edge + filter paths).
      const norm = normalizeType(foundType, foundCat === 'Commercial' ? 'com' : 'res');
      q.type = norm.clean === 'Unknown' ? null : norm.clean;
      q.category = norm.macro;
    }
  }

  const beds = t.match(/(\d+)\s*(?:bed|bedroom|br)\b/) ?? src.match(/(\d+)\s*(?:غرف|غرفة|غرفه)/);
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

  applySourceFilter(q, src);
  const kw = extractNearbyKeywords(src);
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
      const n = parseFloat(digitsOnly(num));
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

// Bug fix (live-tested 2026-08-30): the edge system prompt's "WHEN YOU SEARCH" rule tells the model
// to restate what it understood on EVERY listings reply, guest included — so before we unconditionally
// prepend withRestate()'s own canned line below, check whether the model's reply already opens with
// equivalent restate language. Without this a guest turn could read "تمام، فهمت أنك تبحث عن «...».
// تمام، فهمت أنك تبحث عن «...». أبشر..." — the same sentence twice. Checked against the opening only
// (a restate is always the lead, never buried mid-reply); deliberately NOT using `\b` around the
// Arabic alternatives — JS regex word boundaries are ASCII-`\w`-based and never match around
// Arabic letters, so a `\b` there would silently never fire.
const RESTATE_OPENER_AR = /^\s*(?:تمام|حسنا|حسناً|طيب)?[\s,،]*(?:فهمت|فاهم|أفهم)[^.!؟\n]{0,24}?(?:تبحث|تدور)/;
const RESTATE_OPENER_EN = /^\s*(?:got it|okay|ok|understood|i understand)\b[^.!\n]{0,24}?(?:looking for|searching for)/i;
function alreadyRestates(reply: string): boolean {
  const head = reply.slice(0, 140);
  return RESTATE_OPENER_AR.test(head) || RESTATE_OPENER_EN.test(head);
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
export async function respond(text: string, opts?: {
  loggedIn?: boolean; history?: AgentHistoryTurn[]; attemptTexts?: string[]; prevQuery?: SearchQuery | null;
  askCount?: number; userMessageId?: string; historyTurnsRaw?: number;
}): Promise<AgentTurn> {
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
  // A new chat starts blank (owner rule), so it arrives with no prior query — that is the signal to
  // forget which caveats this conversation has already given.
  if (!opts?.prevQuery) resetRejectionNotices();
  const backend = await callAgentBackend(v, {
    loggedIn, order, history: opts?.history, attemptTexts: opts?.attemptTexts, prevQuery: opts?.prevQuery ?? null,
    askCount: opts?.askCount, userMessageId: opts?.userMessageId, historyTurnsRaw: opts?.historyTurnsRaw,
  });
  if (backend) {
    // Named-platform filter safety net: if the user said "Aqar only" / "Gathern فقط" but the model
    // deflected, force the search. When we override, the reply is already final — return as-is.
    const forced = maybeForcePlatformSearch(backend, v);
    if (forced !== backend) return forced;
    // For a GUEST listings search we lead with the deterministic normalization echo ("Got it — you're
    // looking for …" with currencies/measurements fixed), keeping the fast search-first feel. For a
    // LOGGED-IN user the model already returns its own structured read-back ("Here is what I have for
    // you: …" — user's prompt spec), so we show that verbatim and DON'T prepend a second restatement.
    if (backend.kind === 'listings' && !loggedIn && !alreadyRestates(backend.reply)) {
      backend.reply = withRestate(v, backend.reply);
    }
    // Append AFTER the restatement so the reply still leads with what we ARE searching for; the
    // caveat is a tail, not a headline. The search itself is untouched — everything we could apply
    // has been applied.
    // LISTINGS ONLY, and the call itself is gated — not just its output. The sentence is «…so I
    // showed the results without it», which is simply untrue on a clarification turn where no results
    // are shown. Worse, rejectionNotice() MUTATES announcedRejections: saying it on a message turn
    // spent the once-per-conversation budget on a turn that showed nothing, so the listings turn that
    // really did search without the filter then stayed silent about it.
    //
    // Nothing is lost by waiting. lastRejectedFilters is rebuilt every turn from the merged state, so
    // if the filter is still uncertified when the search runs it is announced there — and if the
    // user's answer made it certifiable, it gets APPLIED and there was never anything to announce.
    const notice = backend.kind === 'listings' ? rejectionNotice() : '';
    if (notice && backend.kind === 'listings') {
      backend.reply = `${String(backend.reply ?? '').trim()}\n${notice}`.trim();
    }
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
