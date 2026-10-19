// A period flip must CLEAR the price and SAY SO — never silently reinterpret an annual budget as a
// monthly one. The bounds a user typed under «سنوي» are not the bounds they meant under «شهري», so
// the control clears them and tells the user why. Mirrors the existing Buy↔Rent toggle rule.
//
// R1, 2026-09-23 (routine #10). This file was on scripts/mutation-proof-grandfathered.txt: seven
// `wholeFile.includes('…')` assertions that nobody had ever watched fail, over a surface whose blast
// radius is price. The verdict now lives in scripts/lib/periodPriceFlip.ts as a pure function, and
// every rule below is proven in BOTH directions against a DELIBERATELY BROKEN COPY OF THE REAL
// SHIPPED FILE — not against a fixture this barrier invented, which would prove only that the
// barrier's author can write a string it rejects.
//
// Why it still reads source text: the handlers are inline JSX inside a large screen component and
// cannot be lifted out and executed — the same reason verify-city-rehydration.ts states at its line
// 44. So it carries what a text reader owes: a negative control (the shipped file is NOT flagged),
// a fail-closed UNKNOWN on an unreadable source, and one mutation per rule.
//
//   node --experimental-strip-types scripts/verify-period-price-flip.ts   (wired into `npm test`)
import { readFileSync } from 'node:fs';
import {
  periodPriceFlipProblems,
  RULE_IDS,
  stripWs,
  type FlipSources,
} from './lib/periodPriceFlip.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

// ── THE SHIPPED FILES ───────────────────────────────────────────────────────────────────────────
const real: FlipSources = {
  index: stripWs(readFileSync(new URL('../src/app/index.tsx', import.meta.url), 'utf8')),
  i18n: stripWs(readFileSync(new URL('../src/i18n.tsx', import.meta.url), 'utf8')),
};

console.log('\nA period or deal flip clears the price and explains it — never a silent unit inversion\n');

const problems = periodPriceFlipProblems(real);
check(`all ${RULE_IDS.length} clauses of the price-clearing contract still hold in the shipped source`,
  problems.length === 0, problems.join('\n      '));

// ── MUTATION PROOF — one per rule, each a broken copy of the REAL file ───────────────────────────
// Every `broken` below is `real` with exactly one shipped needle edited out, so a proof that passes
// is a statement about production's bytes. If a rule's needle ever stops appearing in the shipped
// file, its mutation becomes a no-op and would silently pass — so each one also asserts that the
// edit CHANGED something. That is what keeps this from decaying back into decoration.
console.log('\n  mutation proof — one broken copy of the shipped file per rule\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

/** Replace a needle in the real index source and assert the edit really bit. */
const brokenIndex = (needle: string, replacement: string): FlipSources | null => {
  const mutated = real.index.replace(needle, replacement);
  return mutated === real.index ? null : { ...real, index: mutated };
};

const catches = (id: string, m: FlipSources | null): boolean =>
  m !== null && periodPriceFlipProblems(m).some((p) => p.startsWith(`${id}:`));

mustCatch(
  'priceBand is dropped from the period-flip clear — an annual band survives into a monthly search',
  catches('period-flip-clears-all-four-carriers', brokenIndex(
    "rentPeriod:next,priceMin:null,priceMax:null,priceInput:'',priceBand:null",
    "rentPeriod:next,priceMin:null,priceMax:null,priceInput:''")),
);
mustCatch(
  're-tapping the SAME period stops being a no-op, so the app clears a budget for no reason',
  catches('same-period-retap-is-a-noop', brokenIndex(
    "if((q.rentPeriod??'annual')===next)returnq;", '')),
);
mustCatch(
  'the hadPrice gate is removed, so every period tap raises a notice about a budget never typed',
  catches('clear-is-gated-on-a-price-having-existed', brokenIndex(
    'consthadPrice=!!(q.priceMin||q.priceMax||q.priceInput||q.priceBand);setPeriodPriceCleared(hadPrice);',
    'setPeriodPriceCleared(true);')),
);
mustCatch(
  'the explanatory note stops rendering — the clear happens and the user is never told (the defect)',
  catches('note-renders-while-cleared-and-no-new-price', brokenIndex(
    'periodPriceCleared&&!query.priceMin&&!query.priceMax&&!query.priceInput', 'false&&')),
);
mustCatch(
  'the Arabic copy for the note is gone, so the user sees a key or nothing',
  periodPriceFlipProblems({ ...real, i18n: real.i18n.replace(
    stripWs('تم مسح حدود السعر لأن وحدة السعر تغيّرت'), 'PLACEHOLDER') })
    .some((p) => p.startsWith('note-has-a-real-arabic-translation:')),
);
mustCatch(
  'the deal toggle clears UNCONDITIONALLY again, wiping a Buy budget on a Buy-only↔Both press',
  catches('deal-toggle-clears-only-when-the-pair-changes-meaning', brokenIndex(
    'constflips=prevAppliesTo!==nextAppliesTo;', 'constflips=true;')),
);
mustCatch(
  'the retired Buy/Rent price-cleared NOTICE is reintroduced (owner retired it 2026-08-22)',
  periodPriceFlipProblems({ ...real, index: real.index + 'setDealPriceCleared(true);' })
    .some((p) => p.startsWith('retired-deal-notice-not-reintroduced:')),
);
mustCatch(
  'an unreadable product file is reported as UNKNOWN, never as a passing contract',
  periodPriceFlipProblems({ index: '', i18n: real.i18n }).length > 0,
);
mustCatch(
  '…while the REAL shipped files are NOT flagged (the predicate is not vacuously red)',
  periodPriceFlipProblems(real).length === 0,
);

const ok = failed === 0 && mutFail === 0;
console.log(
  ok
    ? '\n✓ all period-price-flip clauses hold, and each one has been watched to fail'
    : `\n✗ ${failed} assertion(s) failed, ${mutFail} mutation(s) survived`,
);
process.exit(ok ? 0 : 1);
