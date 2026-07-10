// Automated test — whole-number input hygiene for the price/area filter boxes (owner-mandated,
// 2026-07-10). The live search surface is 100% integer (0 decimal prices, area_m2 INTEGER), so these
// boxes are whole-number domains. This test proves a typed/pasted decimal TRUNCATES at the separator
// and the fractional digits are NEVER concatenated onto the integer part ("500.5" must never → 5005).
//
// Runs with zero project dependencies via Node's built-in type stripping (Node >= 22.6):
//   node --experimental-strip-types scripts/verify-whole-number-input.ts
// Wired into `npm test`. Exits non-zero on any failure so it can gate CI / the build.

import { toWholeNumberDigits } from '../src/data/numeric.ts';

type Case = { input: string; expected: string; note: string };

const cases: Case[] = [
  // ── Owner's four required assertions ────────────────────────────────────────
  { input: '500.5', expected: '500', note: "owner: 500.5 → 500 (Latin decimal, NOT 5005)" },
  { input: '500٫5', expected: '500', note: "owner: 500٫5 → 500 (Arabic decimal separator U+066B)" },
  { input: '1,500.75', expected: '1500', note: "owner: 1,500.75 → 1500 (comma dropped, fraction cut)" },
  { input: '1500', expected: '1500', note: "owner: 1500 → 1500 (whole number untouched)" },

  // ── Anti-concatenation regression guards (the exact bug) ────────────────────
  { input: '1.999', expected: '1', note: 'multi-digit fraction fully dropped (not 1999)' },
  { input: '0.5', expected: '0', note: 'leading-zero decimal → 0' },
  { input: '.5', expected: '', note: 'no integer part → empty (means "no limit")' },
  { input: '500.', expected: '500', note: 'trailing separator' },
  { input: '250.00', expected: '250', note: 'whole-looking decimal → 250 (not 25000)' },
  { input: '99999.99', expected: '99999', note: 'large value fraction dropped (not 9999999)' },

  // ── Grouping separators ─────────────────────────────────────────────────────
  { input: '1,000,000', expected: '1000000', note: 'multiple grouping commas removed' },
  { input: '2٬500', expected: '2500', note: 'Arabic thousands separator U+066C removed (not a decimal)' },

  // ── Arabic-Indic / Persian digit folding ────────────────────────────────────
  { input: '٥٠٠٫٥', expected: '500', note: '٥٠٠٫٥ Arabic-Indic digits + Arabic decimal' },
  { input: '۲٬۵۰۰', expected: '2500', note: '۲٬۵۰۰ Persian digits + Arabic thousands' },
  { input: '١٫٩', expected: '1', note: '١٫٩ Arabic-Indic decimal → 1' },

  // ── Empty / junk / currency ─────────────────────────────────────────────────
  { input: '', expected: '', note: 'empty stays empty' },
  { input: 'abc', expected: '', note: 'letters stripped → empty' },
  { input: 'SAR 250', expected: '250', note: 'currency prefix + space stripped' },
  { input: '250 SAR', expected: '250', note: 'currency suffix stripped' },
];

let failed = 0;
for (const c of cases) {
  const actual = toWholeNumberDigits(c.input);
  const ok = actual === c.expected;
  if (!ok) failed++;
  const label = JSON.stringify(c.input);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(16)} → ${JSON.stringify(actual).padEnd(12)} ` +
      `${ok ? '' : `(expected ${JSON.stringify(c.expected)}) `}| ${c.note}`,
  );
}

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed}/${cases.length} whole-number-input assertions FAILED`);
  process.exit(1);
}
console.log(`✓ all ${cases.length} whole-number-input assertions passed`);
