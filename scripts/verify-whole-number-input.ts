// Automated tests — whole-number input hygiene for the price/area/size filter boxes.
// The live search surface is 100% integer (verified 2026-07-10: 0 decimal prices across all
// platforms, area_m2 is INTEGER), so these boxes are whole-number domains. This proves:
//   (A) toWholeNumberDigits() truncates a decimal that arrives in ONE shot (paste / full value),
//       never concatenating the fraction ("500.5" must never → "5005"), and
//   (B) wholeNumberKeyDecision() — the WEB keydown guard — collapses CHAR-BY-CHAR typing to the
//       integer part while leaving delete / navigate / select / retype fully working.
//
// Runs with ZERO project dependencies via Node's built-in type stripping (Node >= 22.6, repo uses 24):
//   node --experimental-strip-types scripts/verify-whole-number-input.ts   (wired into `npm test`)
// Exits non-zero on any failure so it can gate CI. Reuses the SHARED helper — no duplicate logic.

import { toWholeNumberDigits, wholeNumberKeyDecision } from '../src/lib/inputHygiene.ts';

let failed = 0;
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};

console.log('── (A) toWholeNumberDigits — one-shot value / paste ──');
const valueCases: Array<[string, string, string]> = [
  // owner's four required
  ['500.5', '500', 'owner: Latin decimal truncated, NOT 5005'],
  ['500٫5', '500', 'owner: Arabic decimal separator U+066B'],
  ['1,500.75', '1500', 'owner: comma dropped, fraction cut'],
  ['1500', '1500', 'owner: whole number untouched'],
  // anti-concatenation regressions
  ['1.999', '1', 'multi-digit fraction dropped, not 1999'],
  ['0.5', '0', 'leading-zero decimal → 0'],
  ['.5', '', 'no integer part → empty ("no limit")'],
  ['500.', '500', 'trailing separator'],
  ['250.00', '250', 'whole-looking decimal → 250, not 25000'],
  ['99999.99', '99999', 'large value, fraction dropped, not 9999999'],
  // grouping separators
  ['1,000,000', '1000000', 'multiple grouping commas removed'],
  ['2٬500', '2500', 'Arabic thousands sep U+066C removed (not a decimal)'],
  // Arabic-Indic / Persian digit folding
  ['٥٠٠٫٥', '500', 'Arabic-Indic digits + Arabic decimal'],
  ['۲٬۵۰۰', '2500', 'Persian digits + Arabic thousands'],
  ['١٫٩', '1', 'Arabic-Indic decimal → 1'],
  // empty / junk / currency
  ['', '', 'empty stays empty'],
  ['abc', '', 'letters stripped → empty'],
  ['SAR 250', '250', 'currency prefix + space stripped'],
  ['250 SAR', '250', 'currency suffix stripped'],
];
for (const [input, expected, note] of valueCases) eq(`${JSON.stringify(input).padEnd(14)} → ${JSON.stringify(expected).padEnd(10)} | ${note}`, toWholeNumberDigits(input), expected);

console.log('\n── (B) wholeNumberKeyDecision — char-by-char web keydown guard ──');
type KC = [key: string, locked: boolean, block: boolean, nextLocked: boolean, note: string];
const keyCases: KC[] = [
  ['5', false, false, false, 'digit typed normally → allowed'],
  ['.', false, true, true, 'decimal separator blocked, starts fractional lock'],
  ['5', true, true, true, 'fractional-tail digit swallowed (prevents 500.5 → 5005)'],
  ['٫', false, true, true, 'Arabic decimal blocked'],
  ['Decimal', false, true, true, 'web "Decimal" key name blocked'],
  ['٥', false, false, false, 'Arabic-Indic digit typed normally → allowed'],
  ['٥', true, true, true, 'Arabic fractional-tail digit swallowed'],
  ['Backspace', true, false, false, 'DELETE works and resets the lock'],
  ['ArrowLeft', true, false, false, 'cursor navigation works and resets the lock'],
  ['Enter', false, false, false, 'submit works'],
  [',', false, true, false, 'grouping comma never typed manually → blocked, lock unchanged'],
  ['a', false, false, false, 'letter allowed at keypress (helper strips it on change)'],
];
for (const [key, locked, block, nextLocked, note] of keyCases) {
  eq(`key=${JSON.stringify(key).padEnd(11)} locked=${String(locked).padEnd(5)} → block=${block} next=${nextLocked} | ${note}`,
     wholeNumberKeyDecision(key, locked), { block, fracLocked: nextLocked });
}

console.log('');
if (failed > 0) { console.error(`✗ ${failed} assertion(s) FAILED`); process.exit(1); }
console.log(`✓ all ${valueCases.length + keyCases.length} whole-number-input assertions passed`);
