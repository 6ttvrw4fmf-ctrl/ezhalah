// THE DEAL PAIR SAYS NOTHING UNLESS BOTH SIDES ARE ON — AND NEVER SHOUTS.
//
// OWNER RULE (2026-08-22): «شراء only → no message. إيجار only → no message. شراء + إيجار → a short,
// clean Arabic helper. It must look like calm helper text, not a red warning/error.»
//
// WHAT WAS THERE. A red/amber warning — «تم مسح حدود السعر لأن التبديل بين الشراء والإيجار غيّر
// المقصود بالميزانية — الرجاء إدخالها من جديد.» — rendered whenever the price BASIS flipped. That
// includes the ordinary Buy→Rent switch, so a user who simply wanted Rent was shown an error about a
// budget they had usually never typed. The clearing LOGIC is correct and is unchanged; only the
// message was wrong, and it was wrong precisely in the single-deal states.
//
//   node --experimental-strip-types scripts/verify-deal-pair-helper-copy.ts

import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const index = read('src/app/index.tsx');
const code = index.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const i18n = read('src/i18n.tsx');

console.log('\nThe Buy/Rent pair: silent when one deal is selected, calm helper when both are\n');

const KEY = 'When you choose Buy and Rent together, each one has its own budget.';

check('the helper string exists and is gated on dealCombined ONLY',
  new RegExp(`query\\.dealCombined \\?[\\s\\S]{0,200}${KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(code),
  'a single-deal state must render nothing at all');

check('the retired price-cleared WARNING is gone from the deal selector',
  !/Price limits were cleared because Buy\/Rent changed which budget they meant/.test(code),
  'this fired on the ordinary Buy→Rent switch — the owner-reported annoyance');

check('the state that drove it is gone too (no dead flag left behind)',
  !/dealPriceCleared/.test(code));

check('the helper is NOT styled as a warning',
  new RegExp(`s\\.rangeNote\\}>\\{t\\('${KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(code),
  'it must use the muted rangeNote style, never rangeNoteWarn (amber + bold)');

// The Arabic copy itself: one short sentence, no error vocabulary, no exclamation.
const ar = i18n.match(new RegExp(`'${KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*\\n?\\s*'([^']+)'`))?.[1];
check('the Arabic helper copy is present', !!ar, String(ar));
if (ar) {
  check('…it explains the separate budgets', /ميزانية/.test(ar) && /مستقل/.test(ar), ar);
  check('…it is one short sentence', ar.length <= 90 && (ar.match(/\./g) ?? []).length <= 1, `${ar.length} chars: ${ar}`);
  check('…it uses no error/warning vocabulary', !/خطأ|تحذير|مسح|فشل|!/.test(ar), ar);
}

// The clearing BEHAVIOUR must survive — this was a copy/visibility fix, not a logic change.
check('the price-basis clearing logic is unchanged (still clears when the basis flips)',
  /const flips = prevAppliesTo !== nextAppliesTo;/.test(code)
  && /flips \? \{ priceMin: null, priceMax: null/.test(code),
  'the owner asked to keep all Buy+Rent logic exactly the same');

console.log(failures === 0
  ? '\n✓ silent on a single deal, calm helper on both, clearing logic intact\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
