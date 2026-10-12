// MESSAGES THAT ARE NOT A PROPERTY SEARCH, EACH ANSWERED FOR WHAT IT IS (owner 2026-10-11: «not a chatbot that gives the same answer»).
//
// Found by testing the live agent with 30 odd messages: «اتمنى اموت», «حرامي انتم نصابين», «تنصحني أشتري ولا أأجر؟», «ابغى جيران
// سعوديين فقط», «أبي أبيع شقتي», «أبغى قرض عقاري», «ابي شقة في دبي» ALL got the same introduction («أنا إزهله… قلّي وش تدور عليه؟»), because
// every turn with no property in it was overwritten by one fixed sentence. A person in distress deserves a human answer, a
// complaint an apology, a request for advice an honest «I don't advise or rank, the decision is yours».
//
// Pure and deterministic: a message is classified by words (never by the model), and the reply is one of several phrasings
// (never the one the previous bot message used), with its emoji, no dash, no recommendation, and an example the user can type.
// `danger` is checked FIRST and wins over everything: the agent never searches in answer to it.
import { variantText, EXAMPLE_SEARCH_AR, EXAMPLE_SEARCH_EN } from "./questionExamples.ts";

export type Situation = "danger" | "complaint" | "protected" | "financial" | "advice" | "sell" | "outside";

const L = "(?<![\\p{L}])", R = "(?![\\p{L}])";
const re = (src: string) => new RegExp(src, "iu");
const DANGER = re(`${L}(?:اتمنى|أتمنى|ابي|أبي|ابغى|أبغى|ودي)\\s*(?:اموت|أموت|انتحر|أنتحر)(?!\\s*(?:من|عشان|بسبب)\\s*(?:الضحك|الضحكة|الجوع|الحر|البرد|الفرحة|الزحمة|الشوق|العطش|النوم|الطقة))${R}|انتحر|أنتحر|(?:اقتل|أقتل|اذي|أذي|اؤذي|أؤذي)\\s*نفسي|تعبت\\s*من\\s*(?:الحياة|الدنيا)|ما\\s*عاد\\s*أبي\\s*أعيش|\\b(?:kill\\s*myself|suicid\\w*|want\\s*to\\s*die|end\\s*my\\s*life|hurt\\s*myself|self[\\s-]?harm)\\b`);
const COMPLAINT = re(`${L}(?:نصاب\\w*|نصب|حرامي\\w*|كذاب\\w*|احتيال\\w*|غشاش\\w*|سرقة|غبي|غبية|حمار|تافه|فاشل\\w*)${R}|\\b(?:scam\\w*|fraud\\w*|cheat\\w*|liar\\w*|thie(?:f|ves)|stupid|idiot|useless|rubbish|rip[\\s-]?off)\\b`);
const PROTECTED = re(`(?:سعودي(?:ين|ة)?|اجنبي|أجنبي|اجانب|أجانب|مسلم(?:ين)?|مسيحي(?:ين)?|هندي|باكستاني|مصري|يمني|سوداني|فلبيني|بنقالي)\\s*(?:فقط|بس)|(?:فقط|بس)\\s*(?:سعودي|مسلم|عرب)|لسعودي\\s*(?:فقط|بس)|جيران\\s*(?:سعوديين|عرب|مسلمين)|\\b(?:saudis?|muslims?|arabs?|christians?|indians?|pakistanis?|egyptians?)\\s+only\\b|\\bno\\s+(?:foreigners|expats|indians|pakistanis|arabs)\\b|\\bwithout\\s+foreigners\\b`);
const FINANCIAL = re(`${L}(?:قرض|قروض|تمويل|رهن|مرابحة|استثمار|استثماري|ضريبة|ايجار\\s*موحد)${R}|\\b(?:mortgage|loan|financing|finance|invest(?:ment|ing)?|tax)\\b`);
const ADVICE = re(`${L}(?:تنصحني|تنصح|انصحني|أنصحني|نصيحة|نصيحتك|توصي|ترشح|ترشّح|اقترح\\s*علي|اقترح|قارن|قارنلي|مقارنة|يستاهل|صفقة|فرصة\\s*حلوة)${R}|(?:اشتري|أشتري)\\s*(?:ولا|أو)\\s*(?:اأجر|أأجر|اجر|أجر)|(?:ايش|وش|إيش)\\s*(?:أفضل|احسن|أحسن)|\\b(?:best|better|which\\s+is\\s+better|should\\s+i|good\\s+(?:time|deal)|worth\\s+it|compare|recommend\\w*|advice|advise)\\b`);
const SELL = re(`(?:ابي|أبي|ابغى|أبغى|ودي)\\s*(?:ابيع|أبيع|اعلن|أعلن|انشر|أنشر|اأجر|أأجر|اؤجر|أؤجر)|(?:انشر|أنشر|اضيف|أضيف)\\s*(?:اعلان|إعلان|عقاري)|\\b(?:i\\s+want\\s+to\\s+(?:sell|rent\\s+out|list)|sell\\s+my|list\\s+my|post\\s+(?:an?\\s+)?(?:ad|listing)|advertise\\s+my)\\b`);
const OUTSIDE = re(`${L}(?:دبي|ابوظبي|أبوظبي|الشارقة|عجمان|الكويت|القاهرة|الاسكندرية|الإسكندرية|عمّان|عمان|الدوحة|المنامة|مسقط|بيروت|دمشق|بغداد|اسطنبول|إسطنبول|لندن|باريس|مدريد|تركيا|مصر|الاردن|الأردن|لبنان)${R}|\\b(?:dubai|abu\\s*dhabi|sharjah|kuwait(?:\\s*city)?|cairo|alexandria|amman|doha|manama|muscat|beirut|damascus|baghdad|istanbul|london|paris|madrid|turkey|egypt|jordan|lebanon|qatar|uae|bahrain|oman)\\b`);

/** What a message that is not a property search IS, or null. `danger` first; the order after it is the order of the checks. */
export function situationKind(text: string): Situation | null {
  const s = String(text ?? "").trim();
  if (!s) return null;
  if (DANGER.test(s)) return "danger";
  if (PROTECTED.test(s)) return "protected";
  if (COMPLAINT.test(s)) return "complaint";
  if (FINANCIAL.test(s)) return "financial";
  if (SELL.test(s)) return "sell";
  if (ADVICE.test(s)) return "advice";
  if (OUTSIDE.test(s)) return "outside";
  return null;
}

const POOLS: Record<Situation, { ar: readonly string[]; en: readonly string[] }> = {
  danger: {
    ar: [
      "حياتك غالية. لو تفكر تؤذي نفسك، اتصل الحين بالطوارئ 911 أو بمركز الاستشارات الصحية 937، وكلّم أحد تثق فيه 🤍",
      "أنا معك. لو تحس بخطر على نفسك، تواصل الحين مع الطوارئ 911 أو مع 937، ولا تبقى لحالك 🤍",
      "كلامك مهم عندي. لو في خطر على حياتك، اتصل على 911 أو 937 الحين، وخذ أقرب شخص تثق فيه معك 🤍",
    ],
    en: [
      "Your life matters. If you are thinking of hurting yourself, please call emergency services on 911 or the Ministry of Health line 937 right now, and talk to someone you trust 🤍",
      "I'm here with you. If you feel unsafe, contact 911 or 937 now, and please don't stay alone with this 🤍",
      "What you said matters to me. If your life is at risk, call 911 or 937 right away and reach out to someone close to you 🤍",
    ],
  },
  complaint: {
    ar: [
      "آسفين لو صار أي إزعاج. إزهله ما يملك الإعلانات، نعرضها من منصات ثانية، فتأكد من الإعلان من مصدره قبل أي قرار 🤍",
      "نعتذر منك. نحن نجمع الإعلانات من منصات عقارية ولا نملكها ولا نتحقق منها، فراجع كل التفاصيل عند المصدر 🤍",
      "حقك علينا لو تضايقت. الإعلانات تجي من مواقع ثانية، فراجعها من مصدرها قبل أي خطوة 🤍",
    ],
    en: [
      "We're sorry for any trouble. Ezhalah doesn't own the listings, it shows them from other platforms, so please check each one at its source before deciding 🤍",
      "Our apologies. We gather ads from property platforms and don't own or verify them, so please review every detail at the source 🤍",
      "Sorry you had a bad moment. The listings come from other sites, so please verify them at the source before any step 🤍",
    ],
  },
  protected: {
    ar: [
      "ما نفلتر على الجنسية ولا الدين. نقدر نفلتر على المدينة والسعر والغرف، مثلاً: {ex} 🏡",
      "البحث عندنا ما يميّز بين الناس، نفلتر على المدينة والحي والسعر وعدد الغرف بس. جرّب مثلاً: {ex} 🏡",
      "ما نقدر نحدد الجنسية أو الدين في البحث. اكتب لي المدينة والنوع والميزانية، مثلاً: {ex} 🏡",
    ],
    en: [
      "We don't filter by nationality or religion. We can filter by city, price and bedrooms, for example: {ex} 🏡",
      "Search here doesn't tell people apart, it only filters by city, district, price and rooms. Try for example: {ex} 🏡",
      "We can't set nationality or religion in a search. Tell me the city, type and budget, for example: {ex} 🏡",
    ],
  },
  financial: {
    ar: [
      "ما أقدّم نصايح مالية أو قانونية، بس أقدر أدور لك على العقارات. مثلاً: {ex} 🏡",
      "التمويل والقروض خارج شغلي، أنا أدور لك على الإعلانات بس. وش تبي أدور لك؟ مثلاً: {ex} 🏡",
      "ما أعطي رأي في القروض أو الاستثمار، القرار لك. أقدر أعرض لك الإعلانات، مثلاً: {ex} 🏡",
    ],
    en: [
      "I don't give financial or legal advice, but I can search properties for you. For example: {ex} 🏡",
      "Loans and financing are outside what I do, I only search listings. What should I look for? For example: {ex} 🏡",
      "I don't give opinions on loans or investment, the decision is yours. I can show you listings, for example: {ex} 🏡",
    ],
  },
  advice: {
    ar: [
      "ما أقدر أنصح أو أقارن، القرار لك. قلّي وش تدور عليه وأعرض لك الإعلانات، مثلاً: {ex} 🏡",
      "الاختيار لك، أنا أجمع لك الإعلانات من كل المنصات بدون ترشيح. وش تبي أدور لك؟ مثلاً: {ex} 🏡",
      "ما أرشّح ولا أرتّب، أعرض لك كل الإعلانات وإنت تقرر. مثلاً: {ex} 🏡",
    ],
    en: [
      "I can't advise or compare, the decision is yours. Tell me what to search for and I'll show the listings, for example: {ex} 🏡",
      "The choice is yours, I gather listings from every platform without ranking them. What should I look for? For example: {ex} 🏡",
      "I don't recommend or rank, I show you the listings and you decide. For example: {ex} 🏡",
    ],
  },
  sell: {
    ar: [
      "إزهله يدور لك على العقارات بس، ما ننشر إعلانات ولا نبيع. تبي أدور لك على شي؟ مثلاً: {ex} 🏡",
      "ما نقدر ننشر إعلان عندنا، نعرض إعلانات المنصات الثانية. لو تبي تدور على عقار قلّي، مثلاً: {ex} 🏡",
      "نشر الإعلانات يكون على المنصات نفسها، وأنا أدور لك فيها. وش تبي أدور؟ مثلاً: {ex} 🏡",
    ],
    en: [
      "Ezhalah only searches properties, we don't post ads or sell. Want me to search for something? For example: {ex} 🏡",
      "We can't publish a listing here, we show the ads of other platforms. If you want to look for a property, for example: {ex} 🏡",
      "Ads are posted on the platforms themselves, and I search them for you. What should I look for? For example: {ex} 🏡",
    ],
  },
  outside: {
    ar: [
      "إزهله يغطي السعودية بس حالياً. تبي أدور لك في مدينة سعودية؟ مثلاً: {ex} 📍",
      "للأسف بحثنا داخل المملكة فقط. اختر مدينة سعودية وأدور لك، مثلاً: {ex} 📍",
      "ما نغطي خارج السعودية الحين. قلّي مدينة سعودية وأبدأ، مثلاً: {ex} 📍",
    ],
    en: [
      "Ezhalah covers Saudi Arabia only for now. Want me to search a Saudi city? For example: {ex} 📍",
      "Sorry, we only search inside the Kingdom. Pick a Saudi city and I'll search, for example: {ex} 📍",
      "We don't cover outside Saudi Arabia yet. Tell me a Saudi city and I'll start, for example: {ex} 📍",
    ],
  },
};

/** The reply for a situation: one of several phrasings, never the one `avoid` (the previous bot message) already used. */
export function situationReplyText(kind: Situation, en: boolean, seed: string, avoid = ""): string {
  const pool = en ? POOLS[kind].en : POOLS[kind].ar;
  return variantText(pool, seed, avoid, { ex: en ? EXAMPLE_SEARCH_EN : EXAMPLE_SEARCH_AR });
}

export const SITUATION_POOLS = POOLS;
