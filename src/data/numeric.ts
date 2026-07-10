// Pure numeric-input helpers. Kept in its own zero-dependency module so it can be unit-tested in
// isolation (importing src/data/search.ts would drag in React Native via @/i18n and the whole
// taxonomy/locations graph). No React, no RN, no side effects — safe to import from a plain Node test.

/**
 * Whole-number input hygiene for the price / area filter boxes.
 *
 * The live search surface (search_listings_ar) is 100% integer — verified against production
 * 2026-07-10: 0 decimal prices across all 32 platforms, and area_m2 is INTEGER-typed — so these
 * boxes are whole-number domains. A user who types or pastes a decimal must have it TRUNCATED at the
 * separator ("500.5" → "500"), and the fractional digits must NEVER be concatenated onto the integer
 * part ("500.5" must never become "5005").
 *
 * We deliberately do NOT reuse toLatinDigits() from search.ts: that helper strips every non-digit at
 * the end (`out.match(/\d/g).join('')`), which for "500.5" yields "5005" — the exact concatenation
 * bug we are fixing. Instead we fold Arabic/Persian digits while PRESERVING the separator, cut at the
 * first decimal separator, then drop remaining grouping/punctuation.
 *
 * Backend and search logic are unchanged — this only governs what the input box accepts.
 *
 * Examples:
 *   "500.5"     → "500"    (Latin decimal truncated, not concatenated)
 *   "500٫5"     → "500"    (Arabic decimal separator U+066B)
 *   "1,500.75"  → "1500"   (grouping comma dropped, fraction truncated)
 *   "1500"      → "1500"   (whole number untouched)
 *   "٥٠٠٫٥"     → "500"    (Arabic-Indic digits folded, then truncated)
 *   ""          → ""       (empty stays empty → "no limit")
 */
export function toWholeNumberDigits(input: string): string {
  // Fold Arabic-Indic (٠-٩, U+0660–U+0669) and Persian (۰-۹, U+06F0–U+06F9) digits to 0-9,
  // keeping separators intact so we can still see where the decimal point is.
  let folded = '';
  for (const ch of input ?? '') {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) folded += String(code - 0x0660); // Arabic-Indic
    else if (code >= 0x06f0 && code <= 0x06f9) folded += String(code - 0x06f0); // Persian
    else folded += ch;
  }
  // Truncate at the FIRST decimal separator — Latin '.' or Arabic decimal separator '٫' (U+066B) —
  // so the fractional part is discarded rather than merged into the integer part.
  const intPart = folded.split(/[.٫]/)[0];
  // Drop grouping commas (',' and Arabic thousands '٬' U+066C), spaces, currency and any non-digit.
  return intPart.replace(/\D/g, '');
}
