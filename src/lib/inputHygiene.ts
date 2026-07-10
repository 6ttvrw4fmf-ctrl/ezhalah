// Input hygiene for numeric text fields (price + area/size). Whole-number only.
//
// Pure and dependency-free ON PURPOSE so it can be unit-tested without the React
// Native / Expo runtime, and so every numeric input shares ONE implementation
// (the size box drifted from the price/area boxes and re-introduced the
// concatenation bug — a single shared helper prevents that from recurring).

const AR_INDIC = '٠١٢٣٤٥٦٧٨٩'; // U+0660–U+0669 (Arabic-Indic)
const AR_EXT = '۰۱۲۳۴۵۶۷۸۹';   // U+06F0–U+06F9 (extended/Persian, on some Arabic keyboards)

/** Convert Arabic-Indic / extended-Arabic digits to Latin 0-9; leave everything else untouched. */
export function toLatinDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const i = AR_INDIC.indexOf(ch);
    if (i >= 0) { out += String(i); continue; }
    const j = AR_EXT.indexOf(ch);
    if (j >= 0) { out += String(j); continue; }
    out += ch;
  }
  return out;
}

/**
 * Whole-number hygiene for price & area/size inputs. Steps:
 *   1. normalize Arabic digits → Latin
 *   2. TRUNCATE at the first decimal separator — Latin '.' or Arabic '٫' (U+066B)
 *   3. keep digits only (this also drops thousands separators ',' '،' '٬', spaces, etc.)
 *
 * Splitting at the decimal separator BEFORE stripping non-digits is what makes
 * 500.5 → "500" and never "5005": everything after the separator is DISCARDED,
 * not concatenated onto the integer part. Thousands separators are stripped (not
 * split), so 1,500.75 → "1500". A value with no integer part (".5") yields "".
 */
export function toWholeNumberDigits(input: string): string {
  if (!input) return '';
  return toLatinDigits(input).split(/[.٫]/)[0].replace(/\D/g, '');
}
