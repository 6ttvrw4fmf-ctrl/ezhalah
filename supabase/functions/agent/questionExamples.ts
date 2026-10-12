// EXAMPLES INSIDE THE AGENT'S QUESTIONS (owner 2026-10-11: «always give examples so the user knows what to type»)
// AND NEVER THE SAME SENTENCE FOR EVERYONE (owner 2026-10-11: «don't ask every user the exact same question — in what
// city — it's not nice»). Picked by CODE from real data, never by the AI, so every example really works and costs no tokens.
//   • the example cities come from the six cities with the most listings (measured 2026-10-11, 12% sample ×8:
//     الرياض ~152k · جدة ~84k · الخبر ~15k · الدمام ~14k · مكة المكرمة ~11k · المدينة المنورة ~9k; the next, بريدة, ~8k);
//   • example SEARCHES are sentences already proven against the live agent (docs/ops/INTRO_EXAMPLES_PROOF.md).
// An example shows how to TYPE, never what to CHOOSE: no «best», no recommendation.
// Each question is one of several phrasings and one of several example pairs, picked from the user's own message
// (the same message always gets the same question; different messages get different ones) and never the phrasing the
// last bot message already used.
// Mirrored literally in supabase/functions/agent/questionExamples.ts (Deno cannot import from src/):
// scripts/verify-question-examples.ts fails if the two files drift apart.
export const EXAMPLE_CITIES_AR = ['الرياض', 'جدة'] as const;
export const EXAMPLE_CITIES_EN = ['Riyadh', 'Jeddah'] as const;
export const EXAMPLE_SEARCH_AR = 'أبي شقة ٣ غرف في الدمام';
export const EXAMPLE_SEARCH_EN = 'Villa in Jeddah';
export const PIN = '📍';
export const HOUSE = '🏡';

// Pairs of the six biggest cities; the first pair is the default when no seed is given.
export const EXAMPLE_PAIRS_AR: readonly (readonly [string, string])[] = [
  ['الرياض', 'جدة'], ['الدمام', 'الخبر'], ['مكة المكرمة', 'المدينة المنورة'], ['الرياض', 'الدمام'], ['جدة', 'الخبر'], ['الرياض', 'مكة المكرمة'],
];
export const EXAMPLE_PAIRS_EN: readonly (readonly [string, string])[] = [
  ['Riyadh', 'Jeddah'], ['Dammam', 'Khobar'], ['Makkah', 'Madinah'], ['Riyadh', 'Dammam'], ['Jeddah', 'Khobar'], ['Riyadh', 'Makkah'],
];

// «Which city?» — each a complete question; the example and the 📍 are added by cityQuestionAr/En.
export const CITY_ASK_AR: readonly string[] = [
  'في أي مدينة تبحث؟', 'وين تبي نبحث؟', 'أي مدينة تقصد؟', 'في أي مدينة تحب أدوّر لك؟',
  'أي مدينة في بالك؟', 'أبدأ البحث في أي مدينة؟', 'في أي مدينة بالضبط؟', 'وش المدينة اللي تبي تبحث فيها؟',
];
export const CITY_ASK_EN: readonly string[] = [
  'Which city are you searching in?', 'Where should I search?', 'Which city do you have in mind?', 'Which city should I look in?',
  'Which city shall I start with?', 'Which city are you after?', 'Which city would you like me to search?',
];
// «Which city?» for a place-near-X search; {p} is the user's own phrase («قريب من الافنيوز»).
export const NEAR_ASK_AR: readonly string[] = [
  'في أي مدينة تبحث عن عقار {p}؟', 'وين تبي عقار {p}؟', 'في أي مدينة أدوّر لك عقار {p}؟', 'عقار {p} في أي مدينة؟', 'أي مدينة تقصد لعقار {p}؟',
];
// «Which city or region?» for a sea / mountain / desert cue with no city.
export const GEO_ASK_AR: readonly string[] = [
  'تقصد في أي مدينة أو منطقة؟', 'في أي مدينة أو منطقة تبي؟', 'أي مدينة أو منطقة تقصد؟', 'وين بالضبط، مدينة أو منطقة؟',
];
// «Whole city or one district?»; {c} is the city. wholeCityQuestionSubject() must parse every one of these.
export const WHOLE_CITY_ASK_AR: readonly string[] = [
  'تقصد مدينة {c} كاملة، أو حي معيّن؟', 'مدينة {c} كاملة، ولا حي معيّن؟', 'تبي مدينة {c} كلها، أو حي معيّن؟', 'تبحث في مدينة {c} كاملة، أو في حي معيّن؟',
];

const hash = (s: string): number => {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619); }
  return h >>> 0;
};
/** One entry of `pool`, chosen by `seed`; skips an entry whose wording the previous bot message (`avoid`) already contains. */
export function pickVariant(pool: readonly string[], seed: string, avoid = ''): string {
  const start = hash(seed) % pool.length;
  // the longest fixed stretch of the phrasing (a placeholder is filled differently each time)
  const probe = (s: string) => s.split(/\{\w+\}/).map((x) => x.trim()).sort((a, b) => b.length - a.length)[0] ?? '';
  for (let k = 0; k < pool.length; k++) {
    const c = pool[(start + k) % pool.length];
    if (!avoid || !probe(c) || !avoid.includes(probe(c))) return c;
  }
  return pool[start];
}

export const cityExampleAr = (seed = ''): string => `مثلاً ${(seed ? EXAMPLE_PAIRS_AR[hash(`${seed}#`) % EXAMPLE_PAIRS_AR.length] : EXAMPLE_PAIRS_AR[0]).join(' أو ')}`;
export const cityExampleEn = (seed = ''): string => `For example ${(seed ? EXAMPLE_PAIRS_EN[hash(`${seed}#`) % EXAMPLE_PAIRS_EN.length] : EXAMPLE_PAIRS_EN[0]).join(' or ')}`;
export const cityQuestionAr = (seed: string, avoid = '', type?: string | null): string => `${withOpener(false, seed, avoid, type)}${pickVariant(CITY_ASK_AR, seed, avoid)} ${cityExampleAr(seed)} ${PIN}`;
export const cityQuestionEn = (seed: string, avoid = '', type?: string | null): string => `${withOpener(true, seed, avoid, type)}${pickVariant(CITY_ASK_EN, seed, avoid)} ${cityExampleEn(seed)} ${PIN}`;
export const nearQuestionAr = (phrase: string, seed: string, avoid = ''): string => `${pickVariant(NEAR_ASK_AR, seed, avoid).replace('{p}', phrase)} ${cityExampleAr(seed)} ${PIN}`;
export const geoQuestionAr = (seed: string, avoid = '', type?: string | null): string => `${withOpener(false, seed, avoid, type)}${pickVariant(GEO_ASK_AR, seed, avoid)} ${cityExampleAr(seed)} ${PIN}`;
export const wholeCityQuestionText = (cityAr: string, seed = cityAr, avoid = ''): string => `${pickVariant(WHOLE_CITY_ASK_AR, seed, avoid).replace('{c}', cityAr)} ${PIN}`;

// ── EVERY OTHER MESSAGE THE CODE WRITES: several phrasings, never the same one twice in a row (owner 2026-10-11) ──────────
// No dash mark anywhere (a colon or a comma instead), every message ends with its emoji. {n} = a place name, {l} = a list of
// places, {ex} = an example search that is proven against the live agent.
export const TWIN_REGION_ASK_AR: readonly string[] = [
  '«{n}» موجودة في أكثر من منطقة: {l}. أي منطقة تقصد؟', 'عندنا «{n}» في أكثر من منطقة: {l}. وين تبي بالضبط؟',
  'تقصد أي «{n}»؟ موجودة في {l}.', 'في أكثر من «{n}» عندنا: {l}. أي وحدة تبي؟',
];
export const TWIN_DISTRICT_ASK_AR: readonly string[] = [
  'بالمناسبة، حي {n} موجود في أكثر من مدينة: {l}. أي وحدة منها تقصد؟', 'حي {n} نلقاه في أكثر من مدينة: {l}. وش المدينة اللي تبيها؟',
  'عندنا حي {n} في أكثر من مدينة: {l}. أي مدينة تقصد؟', 'حي {n} موجود في {l}. أي مدينة منها في بالك؟',
];
export const REGION_ASK_AR: readonly string[] = [
  'تقصد {n} كاملة، أو مدينة معيّنة؟', '{n} كاملة، ولا مدينة معيّنة منها؟', 'تبي {n} كلها، أو مدينة معيّنة؟', 'تبحث في {n} كاملة، أو في مدينة معيّنة؟',
];
export const NO_INTENT_AR: readonly string[] = [
  'أنا إزهله، أدور لك عقارات في السعودية من كل المنصات. قلّي وش تدور عليه؟ مثلاً: {ex}',
  'ارحب، أنا إزهله وأجمع لك العقارات من كل المنصات في السعودية. وش تبي أدور لك؟ مثلاً: {ex}',
  'تحت أمرك، إزهله يدور لك في كل منصات العقار. اكتب لي وش تبغى، مثلاً: {ex}',
  'أنا إزهله، أجمع لك إعلانات العقار من كل المنصات. وش تدور عليه؟ مثلاً: {ex}',
];
export const NO_INTENT_EN: readonly string[] = [
  "I'm Ezhalah, I find real estate across Saudi Arabia from every platform. What are you looking for? For example: {ex}",
  'Welcome, I am Ezhalah and I gather listings from every platform in Saudi Arabia. What should I look for? For example: {ex}',
  'At your service, Ezhalah searches every property platform for you. Tell me what you want, for example: {ex}',
  'I am Ezhalah, I bring you listings from all the platforms. What are you after? For example: {ex}',
];
export const UNSEARCHABLE_AR: readonly string[] = [
  'عذراً، ما قدرت أحدد مدينة أو حي لبحثك. جرب الفلتر للبحث بشكل أوسع 🤍', 'ما قدرت أعرف المدينة أو الحي اللي تقصده. تقدر تجرب الفلتر وتحدد بنفسك 🤍',
  'للأسف ما قدرت أحدد المكان في بحثك. جرب الفلتر وحدد منه 🤍',
];
export const UNSEARCHABLE_EN: readonly string[] = [
  "Sorry, I couldn't pin down a city or district for this search. Try the Filter to search more broadly 🤍",
  "I couldn't work out which city or district you mean. You can try the Filter and pick it yourself 🤍",
  "Unfortunately I couldn't pin down the place for your search. Try the Filter and choose it there 🤍",
];
export const REGION_OR_CITY_ASK_AR: readonly string[] = [
  '«{n}» اسم مدينة واسم منطقة في نفس الوقت. تقصد مدينة {n} ولا منطقة {n} كاملة؟', '«{n}» عندنا مدينة ومنطقة بنفس الاسم. أي وحدة تبي، المدينة ولا المنطقة كاملة؟',
  'تبي مدينة {n} بس، ولا منطقة {n} كاملة؟', 'في مدينة {n} وفي منطقة {n}. وش تقصد منهم؟',
];
export const SEARCHING_NOW_AR: readonly string[] = ['تمام، أدوّر لك الحين 🏡', 'حاضر، أبدأ البحث الحين 🏡', 'ثواني وأدوّر لك 🏡', 'ماشي، أدوّر لك الحين 🏡'];
export const SEARCHING_NOW_EN: readonly string[] = ['Got it, searching now 🏡', 'On it, searching for you 🏡', 'Sure, I am searching now 🏡', 'One moment, searching for you 🏡'];

const fillVars = (t: string, v: Record<string, string>): string => t.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
/** One phrasing of `pool`, chosen by `seed`, never the one the previous bot message used, with its {placeholders} filled. */
export const variantText = (pool: readonly string[], seed: string, avoid = '', vars: Record<string, string> = {}): string => fillVars(pickVariant(pool, seed, avoid), vars);
export const twinRegionQuestion = (n: string, l: string, seed: string, avoid = ''): string => `${variantText(TWIN_REGION_ASK_AR, seed, avoid, { n, l })} ${PIN}`;
export const twinDistrictQuestion = (n: string, l: string, seed: string, avoid = ''): string => `${variantText(TWIN_DISTRICT_ASK_AR, seed, avoid, { n, l })} ${PIN}`;
export const regionQuestionText = (n: string, seed: string, avoid = ''): string => `${variantText(REGION_ASK_AR, seed, avoid, { n })} ${PIN}`;
export const regionOrCityQuestion = (n: string, seed: string, avoid = ''): string => `${variantText(REGION_OR_CITY_ASK_AR, seed, avoid, { n })} ${PIN}`;
/** «{n} كاملة، أو مدينة معيّنة؟» with an optional «مثل جدة أو أبها» hint before the question mark. */
export const regionQuestionWithHint = (n: string, hint: string, seed: string, avoid = ''): string =>
  `${variantText(REGION_ASK_AR, seed, avoid, { n }).replace(/؟$/, `${hint}؟`)} ${PIN}`;
// The app's own follow-up questions and its error line: also several phrasings, taken in turn so two in a row are never alike.
export const REFINE_DISTRICT_AR: readonly string[] = ['أي حي تفضّل في {c}؟', 'وش الحي اللي تبيه في {c}؟', 'في أي حي من {c} تبحث؟'];
export const REFINE_DISTRICT_EN: readonly string[] = ['Which district in {c}?', 'Which part of {c} do you want?', 'Which neighbourhood in {c}?'];
export const REFINE_BUDGET_AR: readonly string[] = ['كم ميزانيتك تقريباً؟', 'وش الميزانية اللي في بالك؟', 'كم تبي تصرف تقريباً؟'];
export const REFINE_BUDGET_EN: readonly string[] = ['What is your approximate budget?', 'What budget do you have in mind?', 'Roughly how much do you want to spend?'];
export const REFINE_BEDS_AR: readonly string[] = ['كم غرفة نوم تبغى؟', 'كم غرفة تحتاج؟', 'كم عدد غرف النوم اللي تبيها؟'];
export const REFINE_BEDS_EN: readonly string[] = ['How many bedrooms?', 'How many bedrooms do you need?', 'How many bedrooms are you after?'];
export const REFINE_FREE_AR: readonly string[] = [
  'وش تحب نضيّق فيه أكثر؟ مثلاً الميزانية أو الحي أو عدد الغرف', 'وش تبي نحدد أكثر؟ مثلاً السعر أو الحي أو الغرف', 'تبي نضيّق البحث على إيش؟ مثلاً الميزانية أو عدد الغرف',
];
export const REFINE_FREE_EN: readonly string[] = [
  'What would you like to narrow further? For example budget, district or bedrooms', 'What should we narrow down? For example price, district or bedrooms',
  'What else should I narrow the search on? For example budget or bedrooms',
];
export const SEARCH_FAILED_AR: readonly string[] = ['تعذّر البحث، حاول مرة أخرى 🤍', 'ما قدرنا نكمل البحث، جرب مرة ثانية 🤍', 'صار خلل بسيط في البحث، حاول مرة أخرى 🤍', 'البحث ما اشتغل هالمرة، جرب مرة أخرى 🤍'];
export const SEARCH_FAILED_EN: readonly string[] = ['The search failed, please try again 🤍', 'We could not finish the search, try once more 🤍', 'Something went wrong with the search, please try again 🤍'];
const cursors = new Map<readonly string[], number>();
/** The next phrasing of `pool` in turn (the first one picked at random), so the same one never comes twice in a row. */
export function nextVariant(pool: readonly string[], vars: Record<string, string> = {}): string {
  const at = cursors.has(pool) ? ((cursors.get(pool) as number) + 1) % pool.length : Math.floor(Math.random() * pool.length);
  cursors.set(pool, at);
  return fillVars(pool[at], vars);
}
// ── A WARM OPENER BEFORE THE QUESTION, AND THE USER'S OWN PROPERTY WORD ECHOED (owner 2026-10-11) ──────────────────────────────
// Owner: «don't always give the same message: «أبغى شقة في أي مدينة تبحث…» → «Okay, nice. Where do you want us to search?»». So the
// «which city?» question usually starts with a short acknowledgement (3 in 4 times), and when the user already named the kind of
// property the acknowledgement names it back: «حلو، شقة. وين تبي نبحث؟». Never the opener the previous bot message used.
export const OPENER_AR: readonly string[] = ['تمام، حلو.', 'ممتاز.', 'طيب، زين.', 'ماشي.', 'حاضر.', 'تمام.', 'حلو.', 'زين.'];
export const OPENER_EN: readonly string[] = ['Okay, nice.', 'Great.', 'Sure thing.', 'Got it.', 'Alright.', 'Sounds good.'];
export const OPENER_TYPED_AR: readonly string[] = ['تمام، {t}.', 'حلو، {t}.', 'ممتاز، {t}.', 'طيب، {t}.', 'زين، {t}.', 'ماشي، {t}.'];
export const OPENER_TYPED_EN: readonly string[] = ['Okay, {t}.', 'Nice, {t}.', 'Great, {t}.', 'Got it, {t}.', 'Sure, {t}.'];
const TYPE_AR: Readonly<Record<string, string>> = {
  Apartment: 'شقة', Villa: 'فيلا', House: 'بيت', Floor: 'دور', Duplex: 'دوبلكس', Studio: 'استديو', Room: 'غرفة', 'Rest House': 'استراحة', Chalet: 'شاليه', Camp: 'مخيم',
  Farm: 'مزرعة', Building: 'عمارة', 'Residential Land': 'أرض', 'Commercial Land': 'أرض تجارية', 'Industrial Land': 'أرض صناعية', 'Raw Land': 'أرض خام', Land: 'أرض',
  Office: 'مكتب', Shop: 'محل', Warehouse: 'مستودع', Showroom: 'معرض', Workshop: 'ورشة', Factory: 'مصنع', Hotel: 'فندق',
};
const TYPE_EN: Readonly<Record<string, string>> = {
  Apartment: 'an apartment', Villa: 'a villa', House: 'a house', Floor: 'a floor', Duplex: 'a duplex', Studio: 'a studio', Room: 'a room', 'Rest House': 'a rest house', Chalet: 'a chalet',
  Camp: 'a camp', Farm: 'a farm', Building: 'a building', 'Residential Land': 'a plot of land', 'Commercial Land': 'a commercial plot', 'Industrial Land': 'an industrial plot', 'Raw Land': 'raw land',
  Land: 'a plot of land', Office: 'an office', Shop: 'a shop', Warehouse: 'a warehouse', Showroom: 'a showroom', Workshop: 'a workshop', Factory: 'a factory', Hotel: 'a hotel',
};
/** The user's property word in Arabic / English for the opener («شقة» / «an apartment»), from the canonical type or the Arabic word itself; '' when unknown. */
export const typeWord = (type: string | null | undefined, en: boolean): string => {
  const t = String(type ?? '').trim();
  if (!t) return '';
  if (en) return TYPE_EN[t] ?? '';
  return TYPE_AR[t] ?? (/^[؀-ۿ ]{2,20}$/.test(t) ? t : '');
};
const withOpener = (en: boolean, seed: string, avoid: string, type?: string | null): string => {
  if (hash(`${seed}!`) % 4 === 0) return '';                                   // one in four has no opener: not always the same shape either
  const word = typeWord(type, en);
  const pool = word ? (en ? OPENER_TYPED_EN : OPENER_TYPED_AR) : (en ? OPENER_EN : OPENER_AR);
  return `${variantText(pool, seed, avoid, { t: word })} `;
};
// ── chit-chat is not a search: thanks, hello and goodbye each have their own phrasings (owner 2026-10-11: not a chatbot that
// answers «thanks» with the same introduction it gives everyone) ────────────────────────────────────────────────────────────
export const THANKS_AR: readonly string[] = ['العفو، أي وقت 🤍', 'حياك الله، أنا حاضر لو احتجت شي 🏡', 'الله يعافيك، تحت أمرك 🤍', 'العفو، إذا تبي أدور لك على شي ثاني قلّي 🏡'];
export const THANKS_EN: readonly string[] = ["You're welcome, I'm here whenever you need me 🤍", 'Happy to help, just tell me what to search next 🏡', 'Anytime, tell me if you want another search 🏡', 'My pleasure 🤍'];
export const HELLO_AR: readonly string[] = [
  'ارحب فيك، وش تبي أدور لك؟ مثلاً: {ex}', 'حياك الله، أنا إزهله، وش تدور عليه؟ مثلاً: {ex}', 'ارحب، تحت أمرك. اكتب لي وش تبغى، مثلاً: {ex}', 'ارحب، وش تبغى أدور لك؟ مثلاً: {ex}',
];
export const SALAM_AR: readonly string[] = [
  'وعليكم السلام ورحمة الله، ارحب فيك. وش تدور عليه؟ مثلاً: {ex}', 'وعليكم السلام، حياك الله. وش تبي أدور لك؟ مثلاً: {ex}',
  'وعليكم السلام ورحمة الله وبركاته، تحت أمرك. اكتب لي وش تبغى، مثلاً: {ex}',
];
export const HELLO_EN: readonly string[] = [
  'Welcome, what are you looking for? For example: {ex}', 'Hi there, tell me what to search for, for example: {ex}', 'Hello, I am Ezhalah. What can I find for you? For example: {ex}',
  'Good to see you, what are you after? For example: {ex}',
];
export const BYE_AR: readonly string[] = ['مع السلامة، حياك الله في أي وقت 🤍', 'في أمان الله، أنا هنا لو احتجت شي 🤍', 'الله يحفظك، نشوفك على خير 🤍'];
export const BYE_EN: readonly string[] = ['Goodbye, come back anytime 🤍', 'Take care, I am here when you need me 🤍', 'See you soon 🤍'];
const THANKS_RE = /شكر|يعطيك\s*العافية|مشكور|يسلمو|\bthank|\bthx\b|\bcheers\b/i;
const BYE_RE = /مع\s*السلامة|في\s*أمان\s*الله|\bbye\b|\bgoodbye\b|\bsee\s*you\b/i;
const HELLO_RE = /^\s*(?:مرحبا|مرحبًا|مرحباً|ارحب|أرحب|هلا|هلا\s*والله|اهلا|أهلا|أهلاً|السلام\s*عليكم|سلام|صباح\s*الخير|مساء\s*الخير|هاي|hi|hello|hey|good\s*(?:morning|evening|afternoon))[\s!.،,؟?]*$/iu;
/** What a message with no property in it is: thanks, goodbye, hello — or null (the generic introduction). */
export const socialKind = (text: string): 'thanks' | 'bye' | 'hello' | null => {
  const s = String(text ?? '').trim();
  if (THANKS_RE.test(s)) return 'thanks';
  if (BYE_RE.test(s)) return 'bye';
  if (HELLO_RE.test(s)) return 'hello';
  return null;
};
/** The reply to a thanks / goodbye / hello, one of several phrasings, never the one the previous bot message used. */
export const socialReplyText = (kind: 'thanks' | 'bye' | 'hello', en: boolean, seed: string, avoid = ''): string => {
  const pool = kind === 'hello' && !en && /السلام\s*عليكم/.test(seed) ? SALAM_AR : kind === 'thanks' ? (en ? THANKS_EN : THANKS_AR) : kind === 'bye' ? (en ? BYE_EN : BYE_AR) : (en ? HELLO_EN : HELLO_AR);
  const t = variantText(pool, seed, avoid, { ex: en ? EXAMPLE_SEARCH_EN : EXAMPLE_SEARCH_AR });
  return kind === 'hello' ? `${t} ${HOUSE}` : t;
};
export const noIntentReplyText = (en: boolean, seed: string, avoid = ''): string =>
  `${variantText(en ? NO_INTENT_EN : NO_INTENT_AR, seed, avoid, { ex: en ? EXAMPLE_SEARCH_EN : EXAMPLE_SEARCH_AR })} ${HOUSE}`;
export const unsearchableText = (en: boolean, seed: string, avoid = ''): string => pickVariant(en ? UNSEARCHABLE_EN : UNSEARCHABLE_AR, seed, avoid);
export const searchingNowText = (en: boolean, seed: string, avoid = ''): string => pickVariant(en ? SEARCHING_NOW_EN : SEARCHING_NOW_AR, seed, avoid);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WHOLE_CITY_RE = new RegExp(`^(?:${WHOLE_CITY_ASK_AR.map((t) => escapeRe(t).replace('\\{c\\}', '(.+?)')).join('|')})(?:\\s*\\p{Extended_Pictographic}\\uFE0F?)?$`, 'u');
/** The city a whole-city question (any of its phrasings) is about, or null when `text` is not one. */
export function wholeCityQuestionSubject(text: string | null | undefined): string | null {
  const m = WHOLE_CITY_RE.exec((text ?? '').trim());
  const city = m?.slice(1).find((g) => g !== undefined)?.trim();
  return city ? city : null;
}
