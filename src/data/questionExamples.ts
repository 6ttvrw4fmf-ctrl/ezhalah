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
  'أي مدينة في بالك؟', 'أبدأ البحث في أي مدينة؟', 'طيب، في أي مدينة؟', 'وش المدينة اللي تبي تبحث فيها؟',
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
  const probe = (s: string) => s.replace(/\{[pc]\}/g, '\u0000').split('\u0000')[0].trim();
  for (let k = 0; k < pool.length; k++) {
    const c = pool[(start + k) % pool.length];
    if (!avoid || !avoid.includes(probe(c))) return c;
  }
  return pool[start];
}

export const cityExampleAr = (seed = ''): string => `مثلاً ${(seed ? EXAMPLE_PAIRS_AR[hash(`${seed}#`) % EXAMPLE_PAIRS_AR.length] : EXAMPLE_PAIRS_AR[0]).join(' أو ')}`;
export const cityExampleEn = (seed = ''): string => `For example ${(seed ? EXAMPLE_PAIRS_EN[hash(`${seed}#`) % EXAMPLE_PAIRS_EN.length] : EXAMPLE_PAIRS_EN[0]).join(' or ')}`;
export const cityQuestionAr = (seed: string, avoid = ''): string => `${pickVariant(CITY_ASK_AR, seed, avoid)} ${cityExampleAr(seed)} ${PIN}`;
export const cityQuestionEn = (seed: string, avoid = ''): string => `${pickVariant(CITY_ASK_EN, seed, avoid)} ${cityExampleEn(seed)} ${PIN}`;
export const nearQuestionAr = (phrase: string, seed: string, avoid = ''): string => `${pickVariant(NEAR_ASK_AR, seed, avoid).replace('{p}', phrase)} ${cityExampleAr(seed)} ${PIN}`;
export const geoQuestionAr = (seed: string, avoid = ''): string => `${pickVariant(GEO_ASK_AR, seed, avoid)} ${cityExampleAr(seed)} ${PIN}`;
export const wholeCityQuestionText = (cityAr: string, seed = cityAr, avoid = ''): string => `${pickVariant(WHOLE_CITY_ASK_AR, seed, avoid).replace('{c}', cityAr)} ${PIN}`;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WHOLE_CITY_RE = new RegExp(`^(?:${WHOLE_CITY_ASK_AR.map((t) => escapeRe(t).replace('\\{c\\}', '(.+?)')).join('|')})(?:\\s*\\p{Extended_Pictographic}\\uFE0F?)?$`, 'u');
/** The city a whole-city question (any of its phrasings) is about, or null when `text` is not one. */
export function wholeCityQuestionSubject(text: string | null | undefined): string | null {
  const m = WHOLE_CITY_RE.exec((text ?? '').trim());
  const city = m?.slice(1).find((g) => g !== undefined)?.trim();
  return city ? city : null;
}
