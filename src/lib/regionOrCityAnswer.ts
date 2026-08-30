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
// ── Which twin name is this location about? ─────────────────────────────────────────────────────
//
// DEFECT (found live on production 2026-08-29, routine #5): the whole region-vs-city twin feature
// was DEAD whenever the location arrived as an ENGLISH catalog name — which is exactly what the
// deterministic parser emits. Measured by executing the real resolver:
//
//   resolveLocation('الرياض') → kind:'city',   label:'الرياض',       regionOrCity:TRUE   ← the twin
//   resolveLocation('Riyadh') → kind:'region', label:'منطقة الرياض', regionOrCity:FALSE  ← not a twin
//
// Same place, two different verdicts. `parseQuery()` returns `location:'Riyadh'` for every Riyadh
// phrasing («في الرياض», «مدينة الرياض», «منطقة الرياض»), so on that path the old implementation —
// which stripped «منطقة » from the INPUT STRING only, and never from the RESOLVED LABEL — saw
// regionOrCity:false and returned null. With no twin name:
//
//   · `pendingScopeRef` was never armed, so the "you answered our question" recovery could not fire;
//   · the send() rewrite could not fire, so «مدينة الرياض» never became a committed city scope;
//   · locationClarification's region branch RE-ASKED the identical question;
//   · after the 2-ask cap the search widened to منطقة الرياض — all 20 cities, 23,628 listings —
//     the exact opposite of the scope the user had named twice.
//
// It is not Riyadh-only. Every twin the design names resolves the same way from its English catalog
// name: Jazan, Tabuk, Hail, Najran and Madinah all come back kind:'region', regionOrCity:false.
// Jeddah/Dammam/Abha resolve to kind:'city' either way, which is why only twins broke.
//
// THE FIX, stated as a rule: a location is about twin X if EITHER the name itself is the twin, OR it
// resolves to a region whose own label is «منطقة X» and X is the twin. The second half is what was
// missing — the label is normalised exactly as the input string already was.
//
// The resolver is INJECTED rather than imported: src/data/locations.ts transitively pulls
// react-native and cannot be loaded by a plain Node test, and this module is deliberately
// zero-dependency (same reason as the rest of this file) so scripts/verify-agent-twin-scope.ts can
// genuinely EXECUTE this instead of grepping it.

/** The subset of resolveLocation()'s result this rule reads. */
export type TwinResolved = { kind?: string; label?: string; regionOrCity?: boolean };
export type TwinResolver = (name: string) => TwinResolved;

/**
 * The region-AND-city twin name `loc` is about, or null when it is not one of those twins.
 *
 * Accepts every form the query can carry: the bare Arabic twin («الرياض»), the explicit Arabic
 * region («منطقة الرياض»), and — the case that was broken — any name that RESOLVES to that region,
 * including the English catalog name («Riyadh») the deterministic parser emits.
 *
 * Never guesses: a name that is not a twin, or whose region label is not «منطقة X», returns null.
 */
export function twinNameFor(loc: string | undefined | null, resolve: TwinResolver): string | null {
  const bare = (loc ?? '').trim().replace(/^منطقة\s+/, '').trim();
  if (!bare) return null;
  const direct = resolve(bare);
  if (direct?.regionOrCity) return direct.label ?? null;
  // Not a twin by name. It may still BE one under another spelling: if it resolved to a region,
  // strip «منطقة » from the resolved LABEL and ask again. «Riyadh» → «منطقة الرياض» → «الرياض».
  if (direct?.kind !== 'region') return null;
  const viaLabel = (direct.label ?? '').trim().replace(/^منطقة\s+/, '').trim();
  // Guard against a label that did not carry the prefix (no normalisation happened) so this can
  // never re-ask the resolver with the same string and recurse on a shared answer.
  if (!viaLabel || viaLabel === bare) return null;
  const second = resolve(viaLabel);
  return second?.regionOrCity ? second.label ?? null : null;
}

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

// ── «الرياض كاملة» means the CITY, not the region (OWNER DECISION, 2026-08-29) ───────────────────
//
// THE RULE, in the owner's words: «الرياض كاملة» must mean Riyadh CITY, not Riyadh Region. The
// administrative region requires EXPLICIT region wording — «منطقة الرياض». Generic «كاملة» is never
// permission to widen a twin-name city into its whole region. It applies to all five twins:
// الرياض · جازان · تبوك · حائل · نجران.
//
// WHY (owner's reasoning, recorded so a future reader does not "simplify" it away):
//   «الرياض»        usually means the city
//   «مدينة الرياض»  definitely means the city
//   «الرياض كاملة»  naturally reads as "all of Riyadh [city]"
//   «منطقة الرياض»  is the explicit region phrase
//
// WHAT IT REPLACED: agent.tsx's WHOLE_AREA rule ("the user asked for the whole area — honour it,
// don't ask to narrow") short-circuits the twin question entirely, and the location it then searched
// was whatever the parser produced — for a twin that is the REGION. Measured on production
// 2026-08-29: «أبغى شقة للإيجار السنوي في الرياض كاملة» searched all 20 cities of منطقة الرياض,
// 23,628 listings, with no question asked. The user said "Riyadh" and got Al-Kharj, Afif and
// Hawtat Bani Tamim.
//
// This rule only ever NARROWS (region → city) and only on a twin name, so it cannot widen anyone's
// scope. Explicit region intent — «منطقة X», or a standalone «منطقة»/«المنطقة» — always wins.

// Region intent in the user's own words. Deliberately LOOSER than SAYS_REGION above: this one also
// accepts «المنطقة» with the fused «ال», because «المنطقة كلها» is a real way to ask for the region
// and the strict form (built to keep «المنطقة الشرقية» out of a SCOPE CHOICE) would miss it. Here a
// false positive is safe — it just leaves the region scope alone — while a false negative would
// silently narrow someone who did ask for the region.
const SAYS_REGION_LOOSE = /(?<![\p{L}\p{N}])(?:ال)?منطقة(?![\p{L}\p{N}])/u;

/**
 * True when a whole-area phrase on the twin `twin` must be read as that twin's CITY.
 *
 * Returns false — leaving the scope untouched — when the user expressed explicit region intent, or
 * when there is no whole-area phrase at all (this rule has nothing to say about «الرياض» on its own,
 * which still earns the twin question).
 */
export function twinWholeAreaIsCity(text: string | undefined | null, twin: string | undefined | null): boolean {
  const s = (text ?? '').trim();
  if (!s || !twin) return false;
  if (!WHOLE_AREA_TOKEN.test(s)) return false;  // no «كاملة/كلها/…» → rule does not apply
  // Any explicit region wording wins: «منطقة الرياض», «منطقة الرياض كاملة», «المنطقة كلها».
  // ONE guard, not two: SAYS_REGION_LOOSE is strictly broader than scopeNamedForTwin's region form
  // (that one needs a standalone «منطقة» followed by the twin; this one needs a standalone
  // «منطقة»/«المنطقة» anywhere), so a second `scopeNamedForTwin(...) === 'region'` check here was
  // unreachable — no input could satisfy it without satisfying this. It was written, found
  // mutation-proof-blind, and removed rather than left as a branch no test can fail.
  if (SAYS_REGION_LOOSE.test(s)) return false;
  return true;
}
