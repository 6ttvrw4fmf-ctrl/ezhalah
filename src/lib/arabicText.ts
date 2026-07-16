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
