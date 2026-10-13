import { nearQuestionAr, nearQuestionEn, geoQuestionAr, geoQuestionEn, regionQuestionText, variantText, listCities, PIN, HOUSE } from "./questionExamples.ts";
// ─────────────────────────────────────────────────────────────────────────────
// locationAmbiguity — the three LOST cases restored (round-2 fix, "LOST LOCATION-AMBIGUITY CASES").
//
// Round 1 proved the deleted client-side src/app/agent.tsx locationClarification() (removed by this
// consolidation branch, git-shown at commit dd303cb~1) covered more ambiguity shapes than the
// server's loc_classify()-based replacement in index.ts: a bare geography cue with no city, a plain
// (non-twin) region asking whole-region-vs-a-named-city, and an empty-location-with-proximity-phrase
// smart question. Ported here faithfully (see each function's own comment for what was and was not
// carried over, and why) as small, pure, Deno- and plain-Node-importable functions — same
// dependency-light convention as decide.ts and turnWiring.ts, so scripts/verify-agent-location-
// ambiguity.ts can import and execute the REAL logic instead of a re-typed copy of it.
//
// index.ts owns the loc_classify() DB round-trip and the "did we already ask this?" history check;
// these functions take their results as plain inputs and are otherwise pure — no I/O, no Deno APIs.
// ─────────────────────────────────────────────────────────────────────────────

// A bare "whole area" statement in the user's OWN words — same test the deleted client-side
// WHOLE_AREA regex ran, scoped here to just the one branch that needs it.
const WANTS_WHOLE_RE = /كامل|كاملة|بالكامل|كلها|كل\s*(?:ال)?منطق/;

/**
 * RESTORED CASE 1 — a plain region with no same-named city (e.g. «عسير», «المنطقة الشرقية»;
 * `region_or_city` in index.ts already handles the same-name-as-a-city twins like الرياض/جازان).
 * Ported from the deleted locationClarification()'s `lm.kind === 'region'` branch: ask whole-region
 * vs. a named city, unless the user already said "كاملة" this turn.
 *
 * Deliberately WITHOUT the old branch's "مثل جدة وأبها" example-cities hint: that came from a
 * client-only ranked-by-inventory city list (topCitiesInRegion) with no server-side RPC equivalent;
 * the question is still complete and correct without the hint (ponytail: add a top-cities-by-region
 * RPC if the hint is missed).
 *
 * @param nm the region's canonical Arabic name (loc_classify's `name`, kind === 'region')
 * @param text this turn's raw user message
 */
export function plainRegionQuestion(nm: string, text: string, avoid = "", en = false): string | null {
  if (WANTS_WHOLE_RE.test(text)) return null;
  return regionQuestionText(nm, text, avoid, en);
}

// A generic "near <phrase>" construct — Arabic + English. Deliberately NOT the deleted client's full
// structured {relationship, category, name} proximity parser (src/data/proximity.ts, client-only,
// keyword-categorized): a plain "near X" match is enough to ask a question that echoes the user's own
// words instead of a generic one (ponytail: promote to the real category parser if it under-fires).
const NEAR_PHRASE_RE = /((?:قريب(?:ة)?\s*من|بالقرب\s*من|قرب|جنب|جانب|بجانب|near|close\s+to|next\s+to)\s+[^\n.!؟?]{2,40})/iu;

// A bare geography cue (sea/mountain/desert) — mirrors index.ts's own system-prompt wording for this
// exact dimension ("near the sea / beach / coast / corniche / waterfront", "mountains / cool weather
// / highlands", "desert / edge of town / open land").
const GEOGRAPHY_CUE_RE = /بحر|شاطئ|ساحل|كورنيش|واجهة\s*بحرية|جبل|جبال|مرتفعات|صحراء|أطراف\s*(?:المدينة|البلد)|أرض\s*مفتوحة/;

/**
 * RESTORED CASES 2 & 3 — the model correctly left `location` "" (per its own prompt instructions for
 * a geography/proximity cue with no city), but the deleted client-side locationClarification() still
 * asked a SPECIFIC question for these two shapes rather than falling through to the model's generic
 * reply. Ported from its `if (!loc)` branch. The old KINGDOM_WIDE early-return there needs no port —
 * an explicit "everywhere in the Kingdom" statement already makes both regexes below not match (or,
 * for a random unrelated message, matches neither), which is exactly "no ambiguity, proceed".
 *
 * Checked in priority order: a NAMED proximity phrase (more specific — echo it) beats a bare
 * geography cue (less specific — ask generically).
 *
 * @param text this turn's raw user message (location has already been resolved to "" by the caller)
 */
export function emptyLocationQuestion(text: string, avoid = "", en = false): string | null {
  const near = text.match(NEAR_PHRASE_RE);
  if (near) return en ? nearQuestionEn(near[1].trim(), text, avoid) : nearQuestionAr(near[1].trim(), text, avoid);
  if (GEOGRAPHY_CUE_RE.test(text)) return en ? geoQuestionEn(text, avoid) : geoQuestionAr(text, avoid);
  return null;
}

// ── RULEBOOK DRAFT 2 (owner 2026-10-13: «I want those new instructions to be live»). Three things the live agent did wrong, each
// found by typing the message into production: it searched two cities at once, mixed residential with commercial, and said
// «أدور لك شقق قريبة من جامعة الملك سعود» although nothing measures distance yet (the search covers the whole city).

const orList = (names: readonly string[], en: boolean): string =>
  names.length > 1 ? `${names.slice(0, -1).join(en ? ", " : "، ")}${en ? " or " : " ولا "}${names[names.length - 1]}` : (names[0] ?? "");

// ONE CITY PER SEARCH. `cities` = the cities the user named, most listings first.
export const SEVERAL_CITIES_AR: readonly string[] = [
  "البحث يكون في مدينة وحدة كل مرة. نبدأ في {l}؟", "أدور لك في مدينة وحدة بكل بحث، تبي {l}؟", "كل بحث يكون لمدينة وحدة، أي وحدة نبدأ فيها: {l}؟",
];
export const SEVERAL_CITIES_EN: readonly string[] = [
  "I search one city at a time. Should we start with {l}?", "Each search covers one city. Which first, {l}?", "One city per search. Do you want {l}?",
];
export function severalCitiesQuestion(cities: readonly string[], seed: string, avoid = "", en = false): string {
  const names = en ? cities.map((c) => listCities([c], true)) : cities;
  return `${variantText(en ? SEVERAL_CITIES_EN : SEVERAL_CITIES_AR, seed, avoid, { l: orList(names, en) })} ${PIN}`;
}

// RESIDENTIAL AND COMMERCIAL ARE NEVER ONE SEARCH (the Filter can't mix them either). «شقة أو محل» used to search every type in the
// city (villas, land, all of it). A word inside a «near …» phrase («شقة قريبة من محلات») is a place, not a wish, so it doesn't count.
// «دور» is left out on purpose: it is also the verb «دوّر» (search).
const B = "(?<![\\p{L}])[وبل]?(?:ال)?";
const E = "(?![\\p{L}])";
const RES_WORD = new RegExp(`${B}(شقة|شقه|شقق|فيلا|فيلة|فله|فلل|بيت|بيوت|منزل|دوبلكس|دبلكس|استديو|ستوديو)${E}|\\b(apartments?|flats?|villas?|houses?|duplex(?:es)?|studios?)\\b`, "iu");
const COM_WORD = new RegExp(`${B}(محل|محلات|معرض|معارض|مكتب|مكاتب|مستودع|مستودعات|ورشة|ورش|فندق|مجمع\\s*تجاري|عمارة\\s*تجارية|مبنى\\s*تجاري)${E}|\\b(shops?|stores?|offices?|warehouses?|showrooms?|workshops?|hotels?)\\b`, "iu");
const NEAR_ANY = new RegExp(NEAR_PHRASE_RE.source, "giu");
export const RES_COM_AR: readonly string[] = [
  "السكني والتجاري كل واحد ببحث لحاله. تبي {r} ولا {c}؟", "نبحث سكني أو تجاري في كل مرة، أي واحد أول: {r} ولا {c}؟", "ما نخلط السكني مع التجاري في بحث واحد. تبي {r} أول ولا {c}؟",
];
export const RES_COM_EN: readonly string[] = [
  "Residential and commercial are searched separately. Do you want the {r} or the {c} first?", "Each search is either residential or commercial. Which first, {r} or {c}?",
  "I can't mix residential and commercial in one search. Start with the {r} or the {c}?",
];
export function residentialCommercialQuestion(text: string, avoid = "", en = false): string | null {
  const t = String(text ?? "").replace(NEAR_ANY, " ");
  const r = RES_WORD.exec(t), c = COM_WORD.exec(t);
  if (!r || !c) return null;
  const word = (m: RegExpExecArray) => (m[1] ?? m[2] ?? "").trim().toLowerCase();
  return `${variantText(en ? RES_COM_EN : RES_COM_AR, text, avoid, { r: word(r), c: word(c) })} ${HOUSE}`;
}

// NEAR A LANDMARK / WITHIN A DISTANCE: not measured yet («maps later», owner 2026-10-09), the search covers the whole city, so the
// reply says exactly that instead of promising «قريبة من …». Only for a whole-city search (a district search is already narrower).
const DISTANCE_RE = /(?:تبعد|يبعد|على\s*بعد|مسافة)\s*[\d٠-٩]|[\d٠-٩]+\s*(?:كيلو|كم|km|دقايق|دقائق|دقيقة|minutes?|mins?)\s*(?:عن|من|from|to|away)(?![\p{L}])|[\d٠-٩]+\s*(?:متر|م)\s*(?:عن|from|away)(?![\p{L}])|\bwithin\s+[\d.]+\s*(?:km|kilomet\w*|met\w*|miles?|minutes?)|\bwalking\s+distance\b/iu;
export const NOT_MEASURED_AR: readonly string[] = [
  "ما نقدر نقيس القرب من المعالم حالياً، فأدور لك في {c} كلها", "تحديد المسافة عن المعالم ما هو متوفر للحين، أدور لك في {c} كاملة", "للحين ما نحدد القرب بالمسافة، أعرض لك {c} كلها",
];
export const NOT_MEASURED_EN: readonly string[] = [
  "We can't measure distance to landmarks yet, so I'm searching all of {c}", "Distance to a landmark isn't available yet, here is the whole of {c}", "We don't filter by distance yet, so I'm showing all of {c}",
];
export function proximityNotMeasuredText(text: string, city: string, en = false, avoid = ""): string | null {
  const c = String(city ?? "").trim();
  if (!c || /[،,]/.test(c) || !(NEAR_PHRASE_RE.test(text) || DISTANCE_RE.test(text))) return null;
  return `${variantText(en ? NOT_MEASURED_EN : NOT_MEASURED_AR, text, avoid, { c: en ? listCities([c], true) : c })} ${HOUSE}`;
}

/** The message names a property kind of its own («شقة», «محل», "villa"). */
export const namesAProperty = (text: string): boolean => RES_WORD.test(String(text ?? "")) || COM_WORD.test(String(text ?? ""));

// A COMPLETE NEW REQUEST — a property word AND the place, with no «خلها / ضيف / شيل / بدل…» change word — starts a fresh search: nothing
// from the previous one rides along (live 2026-10-13, the owner watching: «فيلا للبيع في جدة فيها مسبح» kept «٤ غرف» from a Riyadh
// apartment search and found nothing). A piece («٣ غرف», «بس بالملقا», «خلها شقق») still changes the current search.
const CHANGE_WORD = new RegExp(`(?<![\\p{L}])(?:خلها|خليها|خله|خلّها|ضيف|زيد|شيل|احذف|نفس|بدل|بدال|غير|غيرها|غيّرها|عدل|عدّل)${E}|\\b(?:make it|change|instead|same)\\b`, "iu");
const fold = (s: string) => String(s ?? "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase();
export function isFreshRequest(text: string, city: string): boolean {
  const c = String(city ?? "").trim();
  if (!c || /[،,]/.test(c) || CHANGE_WORD.test(String(text ?? "")) || !namesAProperty(text)) return false;
  const t = fold(text);
  return t.includes(fold(c).replace(/^ال/, "")) || t.includes(fold(listCities([c], true)));
}
