// The user's ANSWER to Ezhalah's own «تقصد مدينة X ولا منطقة X كاملة؟» question.
//
// DEFECT `agent-clarify-loop` (found live 2026-08-23, 0/7 fresh runs searched): seven Saudi names are
// both a city and a region («الرياض», «جازان», «تبوك», «حائل», «نجران», «الباحة», «الجوف»), so the AI
// screen asks which one the user means. Answering with one of the two options the app itself offered
// («مدينة الرياض») did NOT search: src/app/agent.tsx's locationClarification() only ever looked at the
// parsed location — «الرياض» still resolves as a region-AND-city twin — so it re-asked the identical
// question, and once the 2-ask cap hit it threw the answered scope away and searched ALL of Saudi
// Arabia behind «ما قدرت أحدد الموقع بدقة، فبحثت في نطاق أوسع». The user had named an exact scope; the
// app must commit to it, never widen it (EXACT LOCATION ONLY).
//
// Deliberately zero-dependency (same shape as src/lib/arabicText.ts and src/lib/cityDisplay.ts) so
// scripts/verify-agent-scope-answer.ts can genuinely IMPORT AND EXECUTE it from plain Node —
// src/data/locations.ts transitively pulls react-native and cannot be loaded there.

// Unicode-aware word boundaries. JS \b is defined only against ASCII \w and NEVER matches Arabic
// script, so /\bمدينة\b/ can never fire (that exact bug already cost this repo the whole edge-side
// disambiguation — see scripts/verify-region-or-city-arabic-boundary.ts). The lookarounds also keep
// out place names that CONTAIN these words fused to «ال» with no space: «المدينة المنورة» (Madinah)
// contains «مدينة», «المنطقة الشرقية» (Eastern Province) contains «منطقة» — neither is a scope choice.
const SAYS_CITY = /(?<![\p{L}\p{N}])مدينة(?![\p{L}\p{N}])/u;
const SAYS_REGION = /(?<![\p{L}\p{N}])منطقة(?![\p{L}\p{N}])/u;

export type ScopeChoice = 'city' | 'region';

/**
 * Which of the two offered scopes the user named — or null when they named neither or both (no
 * answer yet, so the question still stands). Never guesses.
 */
export function regionOrCityChoice(text: string | undefined | null): ScopeChoice | null {
  const s = text ?? '';
  const city = SAYS_CITY.test(s);
  const region = SAYS_REGION.test(s);
  if (city === region) return null;
  return city ? 'city' : 'region';
}

/**
 * The location string that searches the chosen scope: «منطقة الرياض» = the whole region, «الرياض» =
 * the city. `name` is the twin name the app itself asked about — never a name the user did not give.
 */
export function scopedLocation(name: string, choice: ScopeChoice): string {
  const bare = (name ?? '').trim().replace(/^منطقة\s+/, '').trim();
  if (!bare) return '';
  return choice === 'region' ? `منطقة ${bare}` : bare;
}

/**
 * A scope the user named ABOUT THIS TWIN, in their own words: «مدينة الرياض» / «منطقة الرياض».
 *
 * WHY THIS EXISTS, and why regionOrCityChoice() is not enough on its own. «منطقة» is an ordinary
 * Arabic noun ("area"), so a bare scope word anywhere in a sentence is NOT an answer to our
 * question: «شقة في الرياض في منطقة هادئة» ("a flat in Riyadh in a quiet area") contains «منطقة»
 * and would otherwise silently widen the named CITY of Riyadh into the whole region — roughly a
 * thousand listings in other cities the user never asked for. That is exactly the
 * EXACT-LOCATION-ONLY violation the clarify fix exists to prevent, pointed the other way.
 *
 * So an UNPROMPTED rewrite requires the scope word to sit directly on the twin name («منطقة» +
 * «الرياض»), with an optional «ال» and an optional «كاملة/كلها» tail. When we DID just ask the
 * question, the caller may fall back to the looser regionOrCityChoice() — there a bare «المدينة»
 * really is an answer, because we asked.
 */
export function scopeNamedForTwin(text: string | undefined | null, twin: string | undefined | null): ScopeChoice | null {
  const s = (text ?? '').trim();
  const bare = (twin ?? '').trim().replace(/^منطقة\s+/, '').replace(/^مدينة\s+/, '').trim();
  if (!s || !bare) return null;
  // «ال» is optional on the twin so «مدينة رياض» and «مدينة الرياض» both count.
  const core = bare.replace(/^ال/, '');
  const name = `(?:ال)?${core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
  const city = new RegExp(`(?<![\\p{L}\\p{N}])مدينة\\s+${name}(?![\\p{L}\\p{N}])`, 'u').test(s);
  const region = new RegExp(`(?<![\\p{L}\\p{N}])منطقة\\s+${name}(?![\\p{L}\\p{N}])`, 'u').test(s);
  if (city === region) return null;
  return city ? 'city' : 'region';
}

// ── The answer to the PLAIN-CITY question «تقصد مدينة X كاملة، أو حي معيّن؟» ─────────────────────
//
// DEFECT (found live on production 2026-08-29, routine #5): answering that question with the phrase
// it invites — «المدينة كاملة» ("the whole city") — searched the MADINAH REGION instead of the city
// the app had just named. Measured the same minute against ezhalah-app.vercel.app:
//
//   ask «أبغى شقة للإيجار السنوي في الدمام» → app asks «تقصد مدينة الدمام كاملة، أو حي معيّن؟»
//   answer «المدينة كاملة» → p_cities = [المدينة المنورة, ينبع, العلا, أملج, بدر, الحناكية, خيبر,
//                                        مهد الذهب]  ·  1,155 results
//   answer «كامل الدمام»  → p_cities = [الدمام]        ·  2,600 results
//
// Same wrong 8-city fan-out for جدة and أبها, and for the phrasing «المدينة كلها». The generic noun
// «المدينة» in the user's answer is re-parsed as the CITY NAME المدينة المنورة, and the city already
// under discussion is silently discarded — so every downstream surface (results, the Advanced Filter
// questions and their counts, Trending) is computed on a city 1,200 km from the one the user asked
// about. It is the EXACT-LOCATION-ONLY violation the twin fix above exists to prevent, arriving
// through the one branch that fix never covered: `pendingScopeRef` is only ever set for region/city
// TWIN names, so for a plain city like الدمام the app remembered nothing about what it had just asked.
//
// The predicate below is deliberately STRICT — it fires only on an answer that carries NO place
// information of its own. Every token must be generic scope vocabulary («المدينة», «كاملة», «كلها»,
// «الحي», a bare yes). The moment anything else survives the strip — «كامل الدمام», «حي الشاطئ» —
// this returns false and the model's own parse is left alone. It can therefore never overwrite a
// city the user actually named; it only refuses to FORGET the one the app itself just asked about.
const WHOLE_AREA_TOKEN = /كامل|كاملة|كلها|كله|بالكامل|\bwhole\b|\ball\b|\bentire\b/iu;
// Generic scope vocabulary, affirmations and filler. Stripped in full before asking "did the user
// name a place?". «المدينة»/«المنطقة» are here BECAUSE they are the words that collide with the real
// place names المدينة المنورة and المنطقة الشرقية — that collision is the whole defect.
const GENERIC_SCOPE_WORDS = [
  'المدينة', 'مدينة', 'المنطقة', 'منطقة', 'البلد', 'الحي', 'حي', 'الأحياء', 'الاحياء',
  'كامل', 'كاملة', 'كامله', 'بالكامل', 'كلها', 'كله', 'كل', 'الكل', 'جميع', 'كافة',
  'نعم', 'أيوه', 'ايوه', 'ايه', 'أي', 'اي', 'تمام', 'اوك', 'أوك', 'طيب', 'زين', 'ابغى', 'أبغى',
  'ابي', 'أبي', 'بحث', 'ابحث', 'في', 'من', 'على', 'يا',
  'whole', 'entire', 'all', 'city', 'the', 'of', 'yes', 'please', 'ok',
];

/**
 * True when `text` answers «تقصد مدينة X كاملة، أو حي معيّن؟» with a GENERIC whole-area affirmation
 * that names no place of its own — «المدينة كاملة», «المدينة كلها», «كاملة», «كل المدينة», «الكل».
 *
 * The caller must only consult this when the app ITSELF asked that question on the previous turn
 * (the same "because we asked" rule scopeNamedForTwin's doc comment states). On a true result the
 * caller keeps the city it asked about; it must never derive a NEW city from this text, because by
 * construction there is none in it.
 *
 * Returns false for anything carrying its own place information, so a user who answers with a real
 * location keeps their own words.
 */
export function isGenericWholeAreaAnswer(text: string | undefined | null): boolean {
  const s = (text ?? '').trim();
  if (!s) return false;
  // Tokenise on anything that is not a letter or digit, so punctuation and «،» never survive.
  const tokens = s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!tokens.length) return false;
  const generic = new Set(GENERIC_SCOPE_WORDS.map((w) => w.toLowerCase()));
  // Every token must be generic vocabulary — one real word left over and this is not a bare answer.
  if (!tokens.every((tk) => generic.has(tk.toLowerCase()))) return false;
  // …and it must actually AFFIRM the whole area, or name the scope we offered. A message made only
  // of filler («في من») is not an answer to anything.
  return WHOLE_AREA_TOKEN.test(s) || SAYS_CITY.test(s) || /(?<![\p{L}\p{N}])المدينة(?![\p{L}\p{N}])/u.test(s);
}
