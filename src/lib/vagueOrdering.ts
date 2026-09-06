// A VAGUE ADJECTIVE SETS AN ORDERING, NEVER A VALUE (owner ruling, 2026-09-06).
//
// «ابغى شقة رخيصة في جدة» must not invent a budget, and «شقة كبيرة» must not invent a size — a
// number the user never said is a fabricated filter, and it silently hides listings they would
// have wanted. It also must not do nothing, which is what shipped before this: the word had no
// effect at all, so the app looked like it had not listened.
//
// So the word RANKS the honest result set and filters nothing. Every genuine match stays eligible.
//
// SIZE MEANS AREA, NEVER ROOMS (owner, verbatim: «never judge big by bedrooms or toilet, check by
// size»). «كبيرة» maps to area_desc — the m² our own index stores — not to bedrooms and not to
// bathrooms. A 4-room 90 m² flat is not "big"; a 2-room 200 m² one is.
//
// Deliberately deterministic and model-free: it runs on the user's own words, costs nothing, is
// testable offline, and can never drift from what the model happened to infer that turn. (The
// repo's standing rule: deterministic before an LLM call.)
//
// Unicode lookarounds, not \b: JS word boundaries are ASCII-only and NEVER match Arabic script —
// the bug that once killed edge-side disambiguation entirely (verify-region-or-city-arabic-boundary).

/** The subset of SortKey a vague word may choose. Price/area only — never beds. */
export type VagueSort = 'price_asc' | 'price_desc' | 'area_desc' | 'area_asc';

// The optional [وف] is the Arabic conjunction fused to the front of the next word — «كبيرة ورخيصة»
// is ONE token «ورخيصة», and without this the second adjective in any «X و Y» phrase is invisible.
// That is not hypothetical: it silently made «شقة كبيرة ورخيصة» order by size, ignoring the price
// word entirely, which is the exact both-words case this function is supposed to decide.
const B = (body: string) => new RegExp(`(?<![\\p{L}\\p{N}])[وف]?(?:${body})(?![\\p{L}\\p{N}])`, 'u');

// «رخيص» and friends. «مو غالي» / «مب غالي» is a negated expensive — same intent, cheapest first,
// and it must be tested BEFORE the expensive pattern or the negation reads as its opposite.
const NOT_EXPENSIVE = B('(?:مو|مب|مش|ما)\\s+(?:غالي|غاليه|غالية|غاليات)');
const CHEAP  = B('ا?رخص|أرخص|رخيص|رخيصه|رخيصة|رخيصين|بسعر\\s+مناسب|اقتصادي|اقتصاديه|اقتصادية');
const PRICEY = B('ا?غلى|أغلى|غالي|غاليه|غالية|فاخر|فاخره|فاخرة');
// «واسع» (spacious) is a size word in Arabic property listings, and «صغير» its opposite.
const BIG    = B('ا?كبر|أكبر|كبير|كبيره|كبيرة|واسع|واسعه|واسعة|واسعين');
const SMALL  = B('ا?صغر|أصغر|صغير|صغيره|صغيرة');

/**
 * The ordering the user's own words ask for, or null when they asked for none.
 *
 * WHEN BOTH A PRICE WORD AND A SIZE WORD APPEAR («شقة كبيرة ورخيصة») price wins. A list has one
 * order, so one of them has to; budget is the harder constraint for most buyers, and the owner's
 * guidance was that this edge case does not matter much next to shipping the behaviour. It is this
 * single line if that ever needs to flip.
 */
export function vagueOrdering(text: string | undefined | null): VagueSort | null {
  const s = String(text ?? '');
  if (NOT_EXPENSIVE.test(s)) return 'price_asc';
  if (CHEAP.test(s)) return 'price_asc';
  if (PRICEY.test(s)) return 'price_desc';
  if (BIG.test(s)) return 'area_desc';
  if (SMALL.test(s)) return 'area_asc';
  return null;
}
