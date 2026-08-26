// Pure helpers for detecting Arabic script and choosing a safe placeholder when resolved text isn't
// Arabic. Zero-dependency ON PURPOSE so it is unit-testable without the React Native / Expo runtime
// (mirrors src/lib/inputHygiene.ts's design).

/** True if the string contains at least one Arabic-script character (the Arabic Unicode block ء-ي). */
export function hasArabicChar(s: string): boolean {
  return /[ء-ي]/.test(s);
}

/**
 * In the Arabic locale, a resolved place/label that still contains NO Arabic character after
 * translation/catalog lookup means nothing really matched (a raw scraped or typed English name, an
 * out-of-catalog district, an ambiguous-match echo, etc.). Returning that raw text would leak English
 * into an otherwise-Arabic summary, so this returns `placeholder` instead.
 *
 * No-op for an empty string (callers already guard those separately) and no-op for any non-Arabic
 * locale (an English place name there is correct, not a leak).
 */
export function arabicOrPlaceholder(text: string, locale: string, placeholder: string): string {
  if (!text) return text;
  if (locale !== 'ar') return text;
  return hasArabicChar(text) ? text : placeholder;
}

/** True if the string contains at least one Latin letter (a-z/A-Z). */
export function hasLatinLetter(s: string): boolean {
  return /[a-zA-Z]/.test(s);
}

/**
 * Like arabicOrPlaceholder, but for FREE-TEXT attribute values (street address, "other
 * obligations", ad source, plan/land numbers, …) rather than a place/type LABEL. A label with no
 * Arabic character means nothing matched (always a leak); free-text is different — a plan number
 * ("REGA-4471") or land number has no Arabic AND no Latin letters either, and is legitimate raw
 * source content that must pass through unchanged (never invent/never rewrite raw values). Only
 * text with an actual Latin LETTER and no Arabic character is a real English-word leak (e.g. a
 * scraped English street address on an otherwise-Arabic card) and gets replaced.
 */
export function arabicOrPlaceholderForFreeText(text: string, locale: string, placeholder: string): string {
  if (!text) return text;
  if (locale !== 'ar') return text;
  if (hasArabicChar(text)) return text;
  return hasLatinLetter(text) ? placeholder : text;
}

/**
 * Fold the Arabic letter variants that are the SAME letter typed differently: أ/إ/آ/ٱ → ا, ة → ه,
 * ى/ي → ي. Exactly the folding `norm()` in src/data/locations.ts applies when it builds its search
 * keys — which is why «أبها» finds the catalog's «ابها» — but 1:1 and LENGTH-PRESERVING, so the
 * result can be index-aligned with its input. Latin text passes through untouched.
 */
export function foldArabicVariants(s: string): string {
  return s.replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىي]/g, 'ي');
}

/**
 * Subtract a PLACE NAME from a text, ignoring those same alef/ta-marbuta/ya spelling variants.
 * Returns `text` unchanged when the place isn't in it, and always removes exactly `place.length`
 * characters of the ORIGINAL text (foldArabicVariants is length-preserving, so the fold-space index
 * is also the real index) — never a folded rewrite of what the user or a source actually wrote.
 *
 * WHY IT EXISTS: src/data/locations.ts decides "the typed location is JUST a city, so there is no
 * district to look up" by subtracting the matched city's name from the district probe and checking
 * that nothing is left. A plain String.replace() made that test blind to spelling: the catalog
 * spells Abha «ابها» while users and the AI agent write «أبها», nothing was subtracted, the whole
 * city name survived as a "district probe", word-matched the live district «روابي أبها» — and the
 * CITY of Abha was silently re-scoped to one neighbourhood (0 results where 15 exist, 22 where 770
 * exist). 27 city spellings across the Kingdom resolved to a district that way.
 * (defect abha-city-rescope, 2026-08-23; barrier scripts/verify-city-never-rescoped-to-district.ts.)
 */
export function cutPlaceName(text: string, place: string): string {
  if (!text || !place) return text;
  const i = foldArabicVariants(text).indexOf(foldArabicVariants(place));
  return i < 0 ? text : text.slice(0, i) + text.slice(i + place.length);
}
