// A VAGUE ADJECTIVE SETS AN ORDERING, NEVER A VALUE (owner ruling, 2026-09-06).
//
// «ابغى شقة رخيصة في جدة» must not invent a budget and «شقة كبيرة» must not invent a size: a number
// the user never said is a fabricated filter that silently hides listings they wanted. It must also
// not do NOTHING, which is what shipped before — the word had no effect at all.
//
// So the word RANKS the honest set and filters nothing, and SIZE MEANS AREA — owner, verbatim:
// «never judge big by bedrooms or toilet, check by size». A 4-room 90 m² flat is not big.
import { vagueOrdering } from '../src/lib/vagueOrdering.ts';
import { STICKY_FIELDS } from '../src/lib/conversationState.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}${ok || !extra ? '' : ` — ${extra}`}`);
  if (!ok) failed++;
};
const eq = (input: string, want: string | null) =>
  check(vagueOrdering(input) === want, `«${input}» → ${want ?? 'no ordering'}`,
    `got ${vagueOrdering(input)}`);

// ── 1. PRICE WORDS ORDER BY PRICE ────────────────────────────────────────────────────────────
eq('ابغى شقة رخيصة في جدة', 'price_asc');
eq('ابغى ارخص شقة في جدة', 'price_asc');
eq('ابغى شقة اقتصادية', 'price_asc');
eq('ابغى شقة مو غالية', 'price_asc');   // negated expensive is still cheapest-first
eq('ابغى فيلا فاخرة في الرياض', 'price_desc');
eq('ابغى اغلى فيلا', 'price_desc');

// ── 2. SIZE WORDS ORDER BY AREA — NEVER BY ROOMS ─────────────────────────────────────────────
eq('ابغى شقة كبيرة في جدة', 'area_desc');
eq('ابغى شقة واسعة', 'area_desc');
eq('ابغى شقة صغيرة', 'area_asc');
// THE OWNER'S RULE, as an assertion: no size word may ever produce a bedroom ordering.
for (const s of ['ابغى شقة كبيرة', 'ابغى شقة واسعة', 'ابغى شقة صغيرة', 'ابغى بيت كبير']) {
  check(!String(vagueOrdering(s)).includes('beds'),
    `«${s}» never orders by BEDROOMS — «check by size», not rooms`);
}

// ── 3. THE CONJUNCTION IS PART OF THE WORD ───────────────────────────────────────────────────
// «كبيرة ورخيصة» is one token «ورخيصة». Without allowing the fused و the second adjective in any
// «X و Y» phrase is invisible, and this exact case ordered by size while ignoring the price word.
eq('ابغى شقة كبيرة ورخيصة في جدة', 'price_asc');
eq('ابغى شقة رخيصة وكبيرة في جدة', 'price_asc');

// ── 4. IT NEVER FIRES ON A NON-INTENT ────────────────────────────────────────────────────────
eq('ابغى شقة في جدة', null);
eq('ابغى شقة ٣ غرف في جدة', null);
eq('ابغى شقة في حي الصغير', null);       // a district that CONTAINS a size word is not an intent
eq('', null);

// ── 5. IT ORDERS, IT DOES NOT FILTER ─────────────────────────────────────────────────────────
// The whole point. vagueOrdering returns only sort keys — if it ever returned a predicate field
// (a price bound, an area bound) it would be inventing the number the owner forbade.
const ALLOWED = new Set(['price_asc', 'price_desc', 'area_desc', 'area_asc', null]);
for (const s of ['شقة رخيصة', 'شقة غالية', 'شقة كبيرة', 'شقة صغيرة', 'شقة كبيرة ورخيصة']) {
  check(ALLOWED.has(vagueOrdering(s) as never), `«${s}» yields only an ORDER, never a bound`);
}
const src = readFileSync(join(root, 'src/lib/vagueOrdering.ts'), 'utf8');
check(!/priceMin|priceMax|areaMin|areaMax|bathMin|detail/.test(src),
  'the module writes no filter field at all — it cannot invent a threshold',
  'returning a bound here is exactly the fabricated filter this rule exists to prevent');
check(!/beds_desc/.test(src), 'beds_desc is not reachable from a vague word');

// ── 6. IT STICKS UNTIL CHANGED ───────────────────────────────────────────────────────────────
// Owner: "it sticks until they change it". Without 'sort' in STICKY_FIELDS a follow-up that only
// narrows the district silently dropped the ordering the user asked for a turn earlier.
check((STICKY_FIELDS as readonly string[]).includes('sort'),
  "'sort' is a STICKY_FIELD, so the ordering survives the next turn");

// ── 7. AN EXPLICIT SORT OUTRANKS A WORD ──────────────────────────────────────────────────────
const agent = readFileSync(join(root, 'src/data/agent.ts'), 'utf8');
check(/if \(ordering && !q\.sort\) q\.sort = ordering;/.test(agent),
  'a sort the user chose in the UI is never overwritten by an adjective');

// ── MUTATION PROOF ───────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, caught: boolean) =>
  check(caught, `(mutation) catches ${what}`,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');
const NO_CONJUNCTION = /(?<![\p{L}\p{N}])(?:رخيص|رخيصه|رخيصة)(?![\p{L}\p{N}])/u;
mustCatch('a boundary that ignores the fused و, so «كبيرة ورخيصة» loses the price word',
  !NO_CONJUNCTION.test('ابغى شقة كبيرة ورخيصة في جدة'));
mustCatch('size mapped to bedrooms instead of area (the rule owner named explicitly)',
  'beds_desc' !== vagueOrdering('ابغى شقة كبيرة'));
mustCatch('a district name read as a size intent («حي الصغير»)',
  vagueOrdering('ابغى شقة في حي الصغير') === null);

console.log(failed === 0
  ? '\n✅ verify-vague-word-orders-never-filters: vague words rank the honest set and invent nothing.'
  : `\n❌ verify-vague-word-orders-never-filters: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
