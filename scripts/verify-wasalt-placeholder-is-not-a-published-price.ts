// A PLACEHOLDER IS NOT A PUBLISHED PRICE.
//
// THE DEFECT (ops_incident #63/#65, owner product rule 2026-09-05). wasalt's listing form defaults an
// unset rent to 1, and publishes that 1 in `rentFreq` exactly like a real quote — with
// `default_freq: true`, which is a statement about which tab the site SHOWS, not about which number
// is real. The scraper took the default and ×12'd it.
//
// Live consequence, WST5892686 — a 3,519 m² commercial tower in Riyadh:
//     rentFreq.monthly = { amount: 1,     default_freq: true  }
//     rentFreq.yearly  = { amount: 50000, default_freq: false }
// stored price_annual = 1 × 12 = 12, so the card advertised the tower at «1 SAR/month» while the
// source published a real 50,000/year sitting in the same payload.
//
// WHY 1 IS A SENTINEL, ON SOURCE EVIDENCE AND NOT ON PLAUSIBILITY. Measured across the whole live
// fleet on 2026-09-05: of 11,599 active wasalt rows carrying rentFreq, exactly TWO have any amount
// ≤ 1 — 0.017% — and only two have a monthly between 2 and 100. The owner's standing rule is that a
// price is never corrected from plausibility; this barrier does not do that. It says a value the
// source emits twice in 11,599 rows, as its own form default, is not a quote.
//
// THE OWNER'S RULE, encoded:
//   • one side a placeholder, the other real  → keep the REAL figure AND its REAL period
//   • both sides placeholders                 → the source published NO price: assert none
//   • both real but disagreeing               → UNTOUCHED. That is a different class (388 rows) and
//     an architectural one — price_annual is a single column and cannot carry two published figures.
//     It stays routed as ops_incident #65, not silently resolved here. This barrier PINS that
//     non-interference, because quietly folding the 388 into this fix is the tempting mistake.
//
// Run: node --experimental-strip-types scripts/verify-wasalt-placeholder-is-not-a-published-price.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pyCall } from './lib/pythonMutant.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const MOD = 'scrapers.wasalt.run';
const SRC = join(ROOT, 'scrapers/wasalt/run.py');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

/** A search-list property shaped the way wasalt's __NEXT_DATA__ actually delivers one. */
const prop = (m: number | null, y: number | null) => {
  const rf: Record<string, unknown> = {};
  if (m !== null) rf.monthly = { freq: 'monthly', amount: m, default_freq: true };
  if (y !== null) rf.yearly = { freq: 'yearly', amount: y, default_freq: false };
  return { id: 5892686, propertyInfo: { slug: 'tower-for-rent-5892686',
    propertySubType: 'Commercial Building', rentFreq: rf, title: 'tower', city: 'Riyadh', zone: 'z' } };
};

const CASES: [string, number | null, number | null][] = [
  ['tower WST5892686: placeholder 1 + real 50,000', 1, 50000],
  ['apt WST5882159: both placeholders', 1, 1],
  ['both real but disagreeing (the 388 class)', 4000, 45000],
  ['mirror: real monthly + placeholder yearly', 3000, 1],
  ['monthly only', 2500, null],
  ['yearly only', null, 60000],
  ['zero is a placeholder too', 0, 72000],
];
const out = pyCall(ROOT, MOD, 'map_property', CASES.map(([, m, y]) => [prop(m, y), 'rent'])) as Array<Record<string, unknown>>;
const pa = (i: number) => out[i]?.price_annual ?? null;
const rp = (i: number) => out[i]?.rent_period ?? null;

// ── THE RULE ──────────────────────────────────────────────────────────────────────────────────
check('placeholder monthly + real yearly → the REAL 50,000 is kept, with its REAL period',
  Number(pa(0)) === 50000 && rp(0) === 'annual',
  `got price_annual=${pa(0)} rent_period=${rp(0)} — must not be 12/monthly`);
check('…and specifically NOT the 1×12 = 12 the defect produced', Number(pa(0)) !== 12);
check('both placeholders → NO price and NO period is asserted',
  pa(1) === null && rp(1) === null,
  `got price_annual=${pa(1)} rent_period=${rp(1)} — a 50-bedroom listing must not advertise 1 SAR`);
check('a published 0 is a placeholder as well', Number(pa(6)) === 72000 && rp(6) === 'annual');

// ── NON-INTERFERENCE — everything outside the placeholder class is byte-for-byte unchanged ────
check('both-real-but-disagreeing (the 388 class) is UNTOUCHED: still monthly ×12',
  Number(pa(2)) === 48000 && rp(2) === 'monthly',
  'this fix must not silently resolve ops_incident #65 — that is an architectural decision');
check('mirror case: real monthly + placeholder yearly stays monthly ×12',
  Number(pa(3)) === 36000 && rp(3) === 'monthly');
check('monthly-only is unchanged', Number(pa(4)) === 30000 && rp(4) === 'monthly');
check('yearly-only is unchanged', Number(pa(5)) === 60000 && rp(5) === 'annual');

// ── MUTATION PROOFS ───────────────────────────────────────────────────────────────────────────
const real = readFileSync(SRC, 'utf8');
const mutate = (label: string, fn: (s: string) => string, cases: [number | null, number | null][]) => {
  const mutated = fn(real);
  if (mutated === real) { check(`MUTATION ${label}: ANCHOR DRIFTED — mutant never applied`, false); return null; }
  try { return pyCall(ROOT, MOD, 'map_property', cases.map(([m, y]) => [prop(m, y), 'rent']), mutated) as Array<Record<string, unknown>>; }
  catch (e) { check(`MUTATION ${label}: python threw — ${(e as Error).message.split('\n')[0]}`, false); return null; }
};
const mustCatch = (what: string, wouldFail: boolean) => check(`MUTATION: catches ${what}`, wouldFail);

// (a) the sentinel set emptied — 1 becomes a real price again and the tower returns to 1 SAR/month.
const noSentinel = mutate('(a)', (s) => s.replace('_PLACEHOLDER_AMOUNTS = (0, 1)', '_PLACEHOLDER_AMOUNTS = ()'), [[1, 50000]]);
mustCatch('the placeholder set being emptied — the tower returns to 1×12 = 12',
  noSentinel !== null && Number(noSentinel[0]?.price_annual) === 12);

// (b) the both-placeholder branch REMOVED, so control falls through to the old default-freq path
//     and 1×12 = 12 is fabricated again. Replacing its body with `pass` would NOT discriminate —
//     rent_price is already None by default, so the answer would not change and the mutant would
//     survive while proving nothing. The branch has to actually go.
const bothFab = mutate('(b)', (s) => s.replace(
  '        elif (_m_sent or _y_sent) and m_amt is None and y_amt is None:\n' +
  '            rent_price = None                # every published amount is a placeholder → assert none\n' +
  '            rent_period_known = False\n', ''), [[1, 1]]);
mustCatch('the both-placeholder branch being removed — 1×12 = 12 is fabricated again',
  bothFab !== null && Number(bothFab[0]?.price_annual) === 12);

// (c) the three-way period collapsed back to binary — UNKNOWN silently becomes "annual".
const binary = mutate('(c)', (s) => s.replace(
  '"rent_period": (("monthly" if rent_is_monthly else "annual") if rent_period_known else None) if is_rent else None,',
  '"rent_period": ("monthly" if rent_is_monthly else "annual") if is_rent else None,'), [[1, 1]]);
mustCatch('the period collapsing back to binary, so UNKNOWN is published as "annual"',
  binary !== null && binary[0]?.rent_period === 'annual');

// (d) NOT VACUOUS — an over-eager sentinel that swallows real prices must also be caught.
const overEager = mutate('(d)', (s) => s.replace('_PLACEHOLDER_AMOUNTS = (0, 1)', '_PLACEHOLDER_AMOUNTS = tuple(range(0, 5000))'), [[4000, 45000]]);
mustCatch('an over-eager sentinel range that swallows a real 4,000 monthly rent',
  overEager !== null && Number(overEager[0]?.price_annual) !== 48000);

check('npm test runs this guard', npmTestRuns(ROOT, 'verify-wasalt-placeholder-is-not-a-published-price'));

console.log(failed === 0
  ? '\n✅ wasalt-placeholder: the real published figure survives; a form default never becomes a price.\n'
  : `\n❌ wasalt-placeholder: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
