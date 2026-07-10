// Tests for whole-number input hygiene (price + area/size fields).
// No test runner is configured in this repo, so this is a self-executing assertion
// script: run with `npx tsx src/lib/inputHygiene.test.ts` — it prints each case and
// exits non-zero if any case fails.

import { toWholeNumberDigits } from './inputHygiene';

const cases: Array<[label: string, input: string, expected: string]> = [
  // ── the four required by the spec ──
  ['500.5 → 500', '500.5', '500'],
  ['500٫5 → 500 (Arabic decimal ٫)', '500٫5', '500'],
  ['1,500.75 → 1500', '1,500.75', '1500'],
  ['1500 → 1500 (unchanged)', '1500', '1500'],
  // ── related coverage ──
  ['٥٠٠٫٥ → 500 (Arabic digits + Arabic decimal)', '٥٠٠٫٥', '500'],
  ['500. → 500 (trailing decimal)', '500.', '500'],
  ['1٬500 → 1500 (Arabic thousands sep stripped)', '1٬500', '1500'],
  ['"" → "" (empty stays empty)', '', ''],
  ['.5 → "" (no integer part)', '.5', ''],
  ['1,234,567 → 1234567 (multiple thousands seps)', '1,234,567', '1234567'],
];

let failed = 0;
for (const [label, input, expected] of cases) {
  const got = toWholeNumberDigits(input);
  const pass = got === expected;
  if (!pass) failed++;
  console.log(`${pass ? '✓ PASS' : '✗ FAIL'}  ${label}   got=${JSON.stringify(got)}`);
}

// Explicit anti-concatenation guard (the whole point of the fix).
const concat = toWholeNumberDigits('500.5');
const concatOk = concat !== '5005';
if (!concatOk) failed++;
console.log(`${concatOk ? '✓ PASS' : '✗ FAIL'}  NEVER concatenate: 500.5 → ${JSON.stringify(concat)} (must not be "5005")`);

console.log(`\n${failed === 0 ? '✓ ALL PASS' : `✗ ${failed} FAILED`}`);
if (failed > 0) process.exit(1);
