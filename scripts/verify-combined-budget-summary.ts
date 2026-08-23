// COMBINED شراء+إيجار — BOTH budgets must be stated, each named for the half it caps.
//
// THE DEFECT THIS GUARDS AGAINST (reproduced twice on production 2026-08-23, ezhalah-app.vercel.app):
// dealCombined (owner feature 2026-08-20) carries TWO INDEPENDENT budgets — priceMin/priceMax cap the
// BUY half only, priceMinRent/priceMaxRent cap the RENT half (annual basis) — and remote.ts sends them
// as two separate RPC caps (p_price_max + p_price_max_rent). But BOTH user-facing restatements of the
// query (the green user bubble from filterToChat(), and the «ملخص البحث» panel from searchSummary() →
// budgetLines()) rendered ONE unlabelled `Budget` line read off priceMin/priceMax alone:
//
//   Variant A — Buy ≤ 500,000 + Rent ≤ 50,000 in الرياض/شقة:
//     bubble   «… للإيجار أو الشراء في الرياض بسعر إلى 500,000 ر.س»
//     summary  «• الميزانية: إلى 500,000 ر.س»           ← rent cap HIDDEN, buy cap presented as THE budget
//     RPC body  p_price_max:500000  p_price_max_rent:50000  → 7,466 (= the TWO-budget answer)
//   Variant B — Buy box EMPTY, Rent ≤ 50,000:
//     summary  had NO «الميزانية» bullet at all, while p_price_max_rent:50000 was still committed.
//
// Both variants breach VISIBLE UI STATE MUST EQUAL COMMITTED REQUEST STATE: the user could not see the
// cap that was actually narrowing their results, and in variant A was told a figure that never applied
// to the rent half. The fix routes both restatements through the pure, dependency-free
// src/lib/combinedBudget.ts, which emits one LABELLED fragment per half the user actually filled.
//
// This barrier bites in two ways: it EXECUTES the real formatter (a regex could be satisfied by a
// branch that never runs), and it asserts the two call sites really take the combined branch BEFORE
// the shared single-budget branch (execution alone cannot prove the wiring). Comments are stripped
// from the source under test, so prose can never satisfy a structural check.
//
//   node --experimental-strip-types scripts/verify-combined-budget-summary.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { combinedBudgetParts, type BudgetWords } from '../src/lib/combinedBudget.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    `got      ${JSON.stringify(actual)}\n      expected ${JSON.stringify(expected)}`);

console.log('\nCombined شراء+إيجار budget restatement — both halves stated, each labelled\n');

// ── 1. EXECUTED: the real formatter, with the real Arabic words the app passes it ────────────────
// (kept literal here on purpose — a drift between these and src/i18n.tsx is caught in section 3.)
const AR: BudgetWords = { buy: 'ميزانية الشراء', rent: 'ميزانية الإيجار (سنوياً)', from: 'من', to: 'إلى', sar: 'ر.س' };

// Variant A, exactly as reproduced: BOTH caps committed → BOTH stated, neither anonymous.
eq('A: buy 500,000 + rent 50,000 → two labelled bullets, rent never dropped',
  combinedBudgetParts({ priceMax: '500000', priceMaxRent: '50000' }, ': ', AR),
  ['ميزانية الشراء: إلى 500,000 ر.س', 'ميزانية الإيجار (سنوياً): إلى 50,000 ر.س']);

// Variant B, exactly as reproduced: only the RENT cap committed → it MUST be stated (it was silent).
eq('B: rent-only budget → the rent cap is stated (was: no budget line at all)',
  combinedBudgetParts({ priceMaxRent: '50000' }, ': ', AR),
  ['ميزانية الإيجار (سنوياً): إلى 50,000 ر.س']);

// The mirror case: a buy-only budget in COMBINED mode must still say it is the BUY budget — an
// unlabelled «الميزانية» would again claim to be the budget for the whole «إيجار أو شراء» search.
eq('buy-only budget in combined mode is labelled as the BUY budget, never bare',
  combinedBudgetParts({ priceMax: '500000' }, ': ', AR),
  ['ميزانية الشراء: إلى 500,000 ر.س']);

eq('full من/إلى ranges on both halves render verbatim, no math',
  combinedBudgetParts({ priceMin: '300000', priceMax: '500000', priceMinRent: '20000', priceMaxRent: '50000' }, ': ', AR),
  ['ميزانية الشراء: من 300,000 إلى 500,000 ر.س', 'ميزانية الإيجار (سنوياً): من 20,000 إلى 50,000 ر.س']);

eq('min-only halves say «من», never an invented ceiling',
  combinedBudgetParts({ priceMin: '300000', priceMinRent: '20000' }, ': ', AR),
  ['ميزانية الشراء: من 300,000 ر.س', 'ميزانية الإيجار (سنوياً): من 20,000 ر.س']);

// No cap sent → nothing claimed. Never invent a budget the RPC body does not carry.
eq('no budget at all → no bullet (nothing invented)', combinedBudgetParts({}, ': ', AR), []);
eq('empty / zero / non-numeric boxes send no cap → no bullet',
  combinedBudgetParts({ priceMin: '', priceMax: '0', priceMinRent: null, priceMaxRent: 'abc' }, ': ', AR), []);

// The bubble uses a space separator (' ') rather than ': ' — same two figures, same two labels.
eq('bubble separator variant keeps both labelled halves',
  combinedBudgetParts({ priceMax: '500000', priceMaxRent: '50000' }, ' ', AR),
  ['ميزانية الشراء إلى 500,000 ر.س', 'ميزانية الإيجار (سنوياً) إلى 50,000 ر.س']);

// Western digits with thousands separators (PRD rule) — never Arabic-Indic, never rounded.
check('figures are echoed exactly, Western digits, never rounded',
  combinedBudgetParts({ priceMaxRent: '47350' }, ': ', AR)[0] === 'ميزانية الإيجار (سنوياً): إلى 47,350 ر.س');

// ── 2. WIRING: both restatements must take the combined branch BEFORE the shared single-budget one ─
const search = codeOnly(read('src/data/search.ts'));
const bodyOf = (start: string, end: string) => {
  const i = search.indexOf(start), j = search.indexOf(end, i + 1);
  return i < 0 || j < 0 ? '' : search.slice(i, j);
};
for (const [fn, start, end, bareBudget] of [
  // `bareBudget` = where that function emits the SINGLE unlabelled budget phrase — the exact string
  // the defect showed. The combined branch must come strictly BEFORE it, so it is unreachable when
  // dealCombined is set.
  ['filterToChat() — the green user bubble', 'export function filterToChat', 'export const grouped', "t(' for {a}'"],
  ['budgetLines() — the «ملخص البحث» budget bullets', 'function budgetLines(', 'function locationLines', "`${t('Budget')}: "],
] as const) {
  const body = bodyOf(start, end);
  check(`${fn}: body located`, body.length > 0);
  const combined = body.indexOf('combinedBudgetParts(q');
  const guard = body.indexOf('q.dealCombined');
  const bare = body.indexOf(bareBudget);
  check(`${fn}: routes the combined case through combinedBudgetParts()`, combined > 0,
    'without it, priceMinRent/priceMaxRent are never rendered anywhere');
  check(`${fn}: guards on q.dealCombined`, guard > 0);
  check(`${fn}: still has the single-deal branch that emits the bare budget phrase`, bare > 0);
  check(`${fn}: the q.dealCombined guard comes BEFORE the bare budget phrase`,
    guard > 0 && bare > 0 && guard < bare && combined < bare,
    'the shared unlabelled `Budget` phrase must never be reachable when dealCombined is set');
}
// The shared single-budget line must stay UNREACHABLE in combined mode: it is emitted from the
// `else if` / post-return path only. Assert the guard is an early return / else-if, not a no-op.
check('budgetLines() returns early for dealCombined (the bare `Budget:` line stays unreachable)',
  /if \(q\.dealCombined\) return \[\.\.\.orig, \.\.\.combinedBudgetParts\(q, ': ', budgetWords\(\)\)\];/.test(search));
check('filterToChat() puts the shared range branch behind `else if`',
  /if \(q\.dealCombined\) \{[\s\S]{0,400}?\} else if \(pLo != null \|\| pHi != null\)/.test(search));

// ── 3. LABELS: the summary must echo the SAME words as the two Filter boxes the figures were typed in ─
const i18n = read('src/i18n.tsx');
const home = read('src/app/index.tsx');
for (const [key, ar] of [['Buy budget', 'ميزانية الشراء'], ['Rent budget (yearly basis)', 'ميزانية الإيجار (سنوياً)']] as const) {
  check(`i18n AR['${key}'] === «${ar}»`, i18n.includes(`'${key}': '${ar}',`));
  check(`«${ar}» is the label on the Filter budget box itself (form and summary can't drift)`, home.includes(`'${key}'`));
  check(`the summary passes t('${key}') to combinedBudgetParts`, search.includes(`t('${key}')`));
  check(`this barrier's executed expectation uses the same AR wording`, [AR.buy, AR.rent].includes(ar));
}
check("i18n has the bubble carrier ' with {a}' and joiner ' and '",
  /' with \{a\}': ' ب\{a\}',/.test(i18n) && /' and ': ' و',/.test(i18n));

console.log('');
if (failures > 0) {
  console.error(`✗ ${failures} combined-budget-summary assertion(s) FAILED`);
  process.exit(1);
}
console.log('✓ combined شراء+إيجار states BOTH budgets, each labelled — all assertions passed');
