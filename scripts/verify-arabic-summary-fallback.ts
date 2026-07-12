// Automated tests — Arabic-only search summary regression guard.
// Owner complaint (2026-07-10): "the screen still shows some English text and English location
// values in parts of the summary... Everything visible must be Arabic except numbers." Root cause:
// t()/tPlace() intentionally fall back to the raw English argument when no Arabic dictionary/catalog
// entry matches (unresolved location, out-of-catalog district, ambiguous-match echo, etc.), so any
// city/district/region/landmark that doesn't resolve leaks straight into the Arabic summary.
//
// arabicOrPlaceholder() (src/lib/arabicText.ts) closes this: in the Arabic locale, any resolved place
// value that still contains NO Arabic character is swapped for the existing honest
// LOCATION_UNRESOLVED_AR sentinel instead of being shown raw. This proves that behavior in isolation.
//
// Runs with ZERO project dependencies via Node's built-in type stripping (Node >= 22.6, repo uses 24):
//   node --experimental-strip-types scripts/verify-arabic-summary-fallback.ts   (wired into `npm test`)
// Exits non-zero on any failure so it can gate CI.

import { hasArabicChar, arabicOrPlaceholder } from '../src/lib/arabicText.ts';

const PLACEHOLDER = 'الموقع غير محدد';

let failed = 0;
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};

// ── hasArabicChar ──
eq('hasArabicChar("الرياض") → true', hasArabicChar('الرياض'), true);
eq('hasArabicChar("Riyadh") → false', hasArabicChar('Riyadh'), false);
eq('hasArabicChar("") → false', hasArabicChar(''), false);
eq('hasArabicChar("Al Malqa, الرياض") → true (mixed, has some Arabic)', hasArabicChar('Al Malqa, الرياض'), true);
eq('hasArabicChar("123") → false (digits are not Arabic script)', hasArabicChar('123'), false);

// ── arabicOrPlaceholder: the owner's actual complaint scenario ──
eq(
  'unresolved English location in AR locale → placeholder, not raw English',
  arabicOrPlaceholder('Al Doha Dist.', 'ar', PLACEHOLDER),
  PLACEHOLDER,
);
eq(
  'resolved Arabic location in AR locale → shown as-is',
  arabicOrPlaceholder('الرياض', 'ar', PLACEHOLDER),
  'الرياض',
);
eq(
  'empty string → stays empty (callers already guard emptiness separately)',
  arabicOrPlaceholder('', 'ar', PLACEHOLDER),
  '',
);
eq(
  'English locale + English location → shown as-is (English there is CORRECT, not a leak)',
  arabicOrPlaceholder('Riyadh', 'en', PLACEHOLDER),
  'Riyadh',
);
eq(
  'English locale + Arabic location → untouched (no-op outside Arabic locale)',
  arabicOrPlaceholder('الرياض', 'en', PLACEHOLDER),
  'الرياض',
);
eq(
  'ambiguous-match raw echo (verbatim user input, English) in AR locale → placeholder',
  arabicOrPlaceholder('north riyadh area', 'ar', PLACEHOLDER),
  PLACEHOLDER,
);

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} arabic-summary-fallback assertion(s) FAILED`);
  process.exit(1);
}
console.log('✓ all arabic-summary-fallback assertions passed');
