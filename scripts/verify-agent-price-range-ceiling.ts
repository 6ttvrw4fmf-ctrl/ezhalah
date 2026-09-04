// Regression guard for the "price range collapses to the LOWER bound" bug found live 2026-07-27
// (round-8 filter/backend audit).
//
// supabase/functions/agent/index.ts's deterministic extractPrice() takes precedence over the model's
// own `price` field (the model is unreliable at exact arithmetic) — but it used to return the FIRST
// valid money figure it found in the raw text, with zero range awareness. So an explicit price range
// ("من 300,000 الى 1,500,000" / "from 300k to 1.5m") returned the LOWER bound as the price. Since this
// function's single price slot is always applied as a CEILING (never a minimum — see the SYSTEM
// prompt's `price` field docs and the client's agentPriceCapAnnual()), a stated 300k-1.5m budget
// silently became a "≤300,000 SAR only" search — live-reproduced: a 254,000 SAR listing came back,
// below the user's own stated floor, the wrong price band entirely.
//
// Fixed by collecting every valid money candidate instead of returning on the first match, and taking
// the HIGHEST one when 2+ candidates exist AND the text reads as an explicit range (a bare second
// number elsewhere in the message, with no range connector, still falls back to the original
// first-match behavior — unrelated figures must not silently become the budget).
//
// This second fix ALSO needed a Unicode-aware boundary fix for the Arabic range connectors (من...الى /
// بين...و) — a first attempt used plain /\bمن\b/, which (like the region_or_city Arabic-boundary bug
// elsewhere in this same file) can never match Arabic script with JS's ASCII-only \b, so the range
// branch was silently dead for every real Arabic user despite passing a code review that only checked
// the English connectors.
//
//   node --experimental-strip-types scripts/verify-agent-price-range-ceiling.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { loadRealExtractPrice } from './lib/extractRealExtractPrice.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const src = readFileSync(new URL('../supabase/functions/agent/index.ts', import.meta.url), 'utf8');
// Candidates now carry a text position so digit-written and Arabic WORD-written amounts merge in
// reading order (PR: «مليون ونص» fix). The point of the check is unchanged: collect, never
// return-on-first-match.
check('extractPrice collects candidates instead of returning on first match',
  /const candidates: Array<\{ n: number; index: number \}> = \[\];/.test(src));
check('RANGE_RE uses Unicode-aware lookarounds for the Arabic connectors (not a bare \\b)', /\(\?<!\[\\p\{L\}\\p\{N\}\]\)من\(\?!\[\\p\{L\}\\p\{N\}\]\)/.test(src));
check('the old bare-\\b Arabic pattern is gone as executable code', !/const RANGE_RE = \/\\bمن\\b/.test(src));
check('2+ candidates + range phrase -> take the MAX, never the first',
  /candidates\.length > 1 && RANGE_RE\.test\(input\)\) return String\(Math\.max\(\.\.\.candidates\.map\(\(c\) => c\.n\)\)\)/.test(src));

// THE REAL extractPrice(), lifted out of the deployed source — NOT a copy.
// This file used to keep a verbatim duplicate and test that. On 2026-08-29 the duplicate went stale
// the moment the real function changed (the «مليون ونص» fix), and the copy still went green — a test
// that cannot fail when production breaks is worse than no test. Now it executes the real thing.
const extractPrice = await loadRealExtractPrice();

const eq = (label: string, actual: string, expected: string) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (expected ${expected || "''"}, got ${actual || "''"})`}`);
};

eq('real repro: "من 300000 الى 1500000" -> HIGH bound (1500000), not the low one', extractPrice('أبغى شقة للبيع في جدة 3 غرف بسعر من 300000 الى 1500000'), '1500000');
eq('range with commas + ريال', extractPrice('من 300,000 إلى 1,500,000 ريال'), '1500000');
eq('بين X و Y range', extractPrice('بين 300 الف و 1.5 مليون ريال'), '1500000');
eq('English "from X to Y"', extractPrice('from 300k to 1.5m SAR'), '1500000');
eq('English "between X and Y"', extractPrice('between 300,000 and 1,500,000 SAR'), '1500000');
eq('bare hyphen range', extractPrice('300000-1500000 ريال'), '1500000');
// The 2026-08-29 live defect: the high bound was written in WORDS, so it produced no candidate and
// the range-MAX rule saw only one value. The user's ceiling silently halved.
eq('LIVE REPRO: "من ٨٠٠ الف الى مليون ونص" -> 1500000, not the 800000 low bound',
  extractPrice('دور للبيع في الرياض من ٨٠٠ الف الى مليون ونص مساحته اكبر من ٢٠٠ متر'), '1500000');
eq('word-written high bound, Western digits on the low bound',
  extractPrice('من 800 الف الى مليون ونص'), '1500000');
eq('single word-written amount is still a plain ceiling', extractPrice('ابغى شقة بنص مليون'), '500000');
eq('DUAL «مليونين» carries no numeral at all', extractPrice('فلل بأقل من مليونين'), '2000000');
eq('a word-written SIZE is never a budget', extractPrice('مساحة مليون متر'), '');
eq('«٨٠٠ الف» is not double-counted by the word scanner', extractPrice('800 الف'), '800000');
// ORDERING. With no range phrase the rule is "take the FIRST figure in the sentence", so a
// word-written amount appearing BEFORE a digit-written one must win. Without the positional sort the
// digit scanner's candidates all land first in the array regardless of where they sit in the text,
// and this returns 900000. (This exact case initially escaped mutation M6.)
eq('word amount earlier in the text beats a later digit amount (no range phrase)',
  extractPrice('نص مليون للشقة و 900000 للفيلا'), '500000');

eq('single number unchanged (ceiling)', extractPrice('فيلا للبيع تحت 2 مليون'), '2000000');
eq('single number with currency unchanged', extractPrice('شقة بميزانية 100000 دولار'), '375000');
eq('no price mentioned at all', extractPrice('شقة في الرياض 3 غرف'), '');
eq('a size is never treated as a price', extractPrice('أرض 500 متر'), '');
eq('two unrelated numbers, no range phrase -> first (unchanged legacy fallback)', extractPrice('3 غرف نوم وفيلا للبيع 900000 ريال قريبة من مدرسة تتسع 500 طالب'), '900000');
eq('trap: a place name containing "من" fused with no space must not false-positive as a range connector', extractPrice('شقة في اليمن للبيع بسعر 500000 ريال'), '500000');

console.log(
  failed === 0
    ? '\n✓ agent price-range-ceiling fix verified (extractPrice takes the upper bound of an explicit range)'
    : `\n✗ ${failed} check(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
