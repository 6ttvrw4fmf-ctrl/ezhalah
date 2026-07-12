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
