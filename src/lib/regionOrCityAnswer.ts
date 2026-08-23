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
