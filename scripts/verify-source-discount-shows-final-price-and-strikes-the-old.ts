// A SOURCE-PUBLISHED DISCOUNT SHOWS NEXT TO THE FINAL PRICE — AND ONLY THEN (owner 2026-10-19:
// «show the final price with the discount; no discount → the normal price»).
//
// aqar renders a discounted Buy listing as «~~60,000,000~~ 45,000,000 خصم 25%». PRICE = SOURCE
// already stores the 45,000,000 in price_total (the payload wins, see
// scrapers/common/tests/test_aqar_discount_price_is_not_the_struck_through_one.py), so search,
// filters and sort already work on the discounted figure. This barrier pins the DISPLAY half:
//   1. listingDiscountFrom() is EXECUTED (lifted from the shipped file): a real aqar discount yields
//      the struck-through original + the percentage; every other shape yields null — no discount,
//      a Rent row (no usable original), a stay-length platform, an original that is not above the
//      final price, a bogus percentage.
//   2. The struck line is formatted exactly like the Buy price («1,250,000 ر.س»).
//   3. The card renders `listing.discount` on BOTH layouts and the fetch selects both columns —
//      a source pin, because the card is JSX; the logic it renders is executed above.
//
//   node --experimental-strip-types scripts/verify-source-discount-shows-final-price-and-strikes-the-old.ts
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failed++;
};
// A mutation proof: `caught` is true only when the barrier's own assertion FAILS against the mutant.
const mustCatch = (label: string, caught: boolean) => check(`MUTATION caught: ${label}`, caught);

const i18n = await liftSymbols(join(root, 'src/i18n.tsx'), [
  { header: 'const AR: Record<string, string> = {' },
  { header: 'function fill(' },
  { header: 'const EN: Record<string, string> = {' },
  { header: 'export function translate(' },
  { header: 'export function tPrice(' },
], ['translate', 'tPrice'], "type Locale = 'ar' | 'en';\nlet _locale: Locale = 'ar';");
(globalThis as Record<string, unknown>).__i18n = i18n;
const display = await liftSymbols(join(root, 'src/lib/listingDisplay.ts'), [
  { header: 'export const isStayLengthPriced', endsWith: /;$/ },
  { header: 'export function listingDiscountFrom(' },
  { header: 'export function listingDiscountOldPrice(' },
], ['listingDiscountFrom', 'listingDiscountOldPrice'],
  "type Locale = 'ar' | 'en'; type ListingDiscount = { original: number; pct: number };\n" +
  'const { translate, tPrice } = (globalThis as any).__i18n;');
type D = { original: number; pct: number } | null;
const from = display.listingDiscountFrom as (deal: unknown, source: unknown, total: unknown, orig: unknown, pct: unknown) => D;
const oldPrice = display.listingDiscountOldPrice as (d: { original: number; pct: number }, loc: 'ar' | 'en') => string;

// 1. Executed against the two aqar listings measured live on 2026-09-19 (ads 6708444 and 6674913).
const a = from('Buy', 'Aqar', 45_000_000, 60_000_000, 25);
check('aqar 6708444: ~~60,000,000~~ 45,000,000 خصم 25% → original 60M, 25%', !!a && a.original === 60_000_000 && a.pct === 25, JSON.stringify(a));
const b = from('Buy', 'Aqar', 1_200_000, 1_250_000, 4);
check('aqar 6674913: ~~1,250,000~~ 1,200,000 خصم 4% → original 1.25M, 4%', !!b && b.original === 1_250_000 && b.pct === 4, JSON.stringify(b));

const nulls: [string, unknown[]][] = [
  ['no discount at all (the ordinary card)', ['Buy', 'Aqar', 1_200_000, null, null]],
  ['percentage without an original price', ['Buy', 'Aqar', 1_200_000, null, 4]],
  ['original price without a percentage', ['Buy', 'Aqar', 1_200_000, 1_250_000, null]],
  ['a Rent row (aqar stores no usable original for rent)', ['Rent', 'Aqar', 60_000, 65_000, 8]],
  ['a stay-length platform (shows no price at all)', ['Buy', 'Aqar Monthly', 1_200_000, 1_250_000, 4]],
  ['original equal to the final price', ['Buy', 'Aqar', 1_250_000, 1_250_000, 4]],
  ['original BELOW the final price (a swapped pair must never strike the real price)', ['Buy', 'Aqar', 1_250_000, 1_200_000, 4]],
  ['no final price', ['Buy', 'Aqar', null, 1_250_000, 4]],
  ['zero percent', ['Buy', 'Aqar', 1_200_000, 1_250_000, 0]],
  ['100 percent', ['Buy', 'Aqar', 1_200_000, 1_250_000, 100]],
  ['a string percentage (PostgREST never sends one here, but a stub might)', ['Buy', 'Aqar', 1_200_000, 1_250_000, '4']],
];
for (const [label, args] of nulls) {
  const r = from(...(args as [unknown, unknown, unknown, unknown, unknown]));
  check(`null → no discount line: ${label}`, r === null, JSON.stringify(r));
}

// 1b. MUTATION PROOFS — the REAL listingDisplay.ts is mutated on disk (a temp copy), lifted the same
// way, and executed: the barrier's assertions above must FAIL against each mutant, or they prove nothing.
const DISPLAY = join(root, 'src/lib/listingDisplay.ts');
const displaySrc = readFileSync(DISPLAY, 'utf8');
const liftMutant = async (from: string, to: string) => {
  if (!displaySrc.includes(from)) throw new Error(`mutation anchor missing: ${from}`);
  const file = join(mkdtempSync(join(tmpdir(), 'discount-mutant-')), 'listingDisplay.ts');
  writeFileSync(file, displaySrc.replace(from, to));
  const m = await liftSymbols(file, [
    { header: 'export const isStayLengthPriced', endsWith: /;$/ },
    { header: 'export function listingDiscountFrom(' },
  ], ['listingDiscountFrom'], 'type ListingDiscount = { original: number; pct: number };');
  return m.listingDiscountFrom as typeof from_;
};
const from_ = from;
{
  // Mutant A: drop the «original must exceed the final price» guard → a swapped pair would strike the REAL price.
  const mA = await liftMutant("!(priceOriginal > priceTotal)) return null;", "false) return null;");
  mustCatch('a builder that strikes an original BELOW the final price', mA('Buy', 'Aqar', 1_250_000, 1_200_000, 4) !== null);
  // Mutant B: drop the Buy-only guard → a Rent row (no usable original) grows a discount line.
  const mB = await liftMutant("if (deal !== 'Buy') return null;", "");
  mustCatch('a builder that shows a discount on a Rent row', mB('Rent', 'Aqar', 60_000, 65_000, 8) !== null);
  // Mutant C: drop the stay-length guard → Aqar Monthly / Gathern, which show no price, would show a discount.
  const mC = await liftMutant("if (isStayLengthPriced(typeof source === 'string' ? source : '')) return null;", "");
  mustCatch('a builder that shows a discount on a stay-length platform', mC('Buy', 'Aqar Monthly', 1_200_000, 1_250_000, 4) !== null);
  // Mutant D: a builder that never returns a discount — the happy path must be a real assertion too.
  const mD = await liftMutant("return { original: priceOriginal, pct: discountPct };", "return null;");
  mustCatch('a builder that never shows a discount', mD('Buy', 'Aqar', 45_000_000, 60_000_000, 25) === null);
}

// 2. The struck line reads like the Buy price line.
check('old price prints «ر.س 1,250,000» in Arabic — the same shape as the price line', oldPrice({ original: 1_250_000, pct: 4 }, 'ar') === 'ر.س 1,250,000', oldPrice({ original: 1_250_000, pct: 4 }, 'ar'));
check('old price prints «SAR 1,250,000» in English', oldPrice({ original: 1_250_000, pct: 4 }, 'en') === 'SAR 1,250,000', oldPrice({ original: 1_250_000, pct: 4 }, 'en'));
check('badge reads «خصم 4٪»', i18n.translate('ar', 'Discount {pct}%', { pct: 4 }) === 'خصم 4٪', i18n.translate('ar', 'Discount {pct}%', { pct: 4 }));

// 3. The wiring: fetch selects both columns, finalize builds the discount, both card layouts render it.
const remote = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');
// THE SELECT IS BUILT PER TABLE, AND EXECUTED HERE. 65 platform tables have no discount columns and
// PostgREST fails the whole select over an unknown column: with the two names in LIST_SELECT, CI's
// built-app smoke measured count=null on EVERY search (PR #7689, run 2795). So: the shared list never
// names them, and listSelectFor() adds them for the aqar tables only.
const sel = await liftSymbols(join(root, 'src/data/remote.ts'), [
  { header: 'const LIST_SELECT = [', endsWith: /^\]\.join\(', '\);$/ },
  { header: 'const DISCOUNT_COLUMN_TABLES', endsWith: /;$/ },
  { header: 'const DISCOUNT_COLUMNS', endsWith: /;$/ },
  { header: 'function listSelectFor(' },
], ['LIST_SELECT', 'listSelectFor']);
const LIST_SELECT = sel.LIST_SELECT as string;
const listSelectFor = sel.listSelectFor as (t: string) => string;
check('the shared LIST_SELECT names neither discount column (65 tables do not have them)', !/price_original|discount_pct/.test(LIST_SELECT));
for (const t of ['aqar_residential_listings', 'aqar_commercial_listings']) {
  check(`listSelectFor('${t}') asks for price_original + discount_pct`, /\bprice_original\b/.test(listSelectFor(t)) && /\bdiscount_pct\b/.test(listSelectFor(t)) && listSelectFor(t).startsWith(LIST_SELECT));
}
for (const t of ['wasalt_residential_listings', 'dealapp_commercial_listings', 'gathern_residential_listings', 'aqarmonthly_residential_listings', 'abeea_residential_listings']) {
  check(`listSelectFor('${t}') (no such columns) is exactly LIST_SELECT`, listSelectFor(t) === LIST_SELECT);
}
check('every list fetch goes through listSelectFor(table) — no bare .select(LIST_SELECT) remains', (remote.match(/\.select\(listSelectFor\(/g)?.length ?? 0) >= 3 && !/\.select\(LIST_SELECT\)/.test(remote));
{
  // MUTATION: the discount columns slipped back into the shared list → a wasalt select would carry them.
  const remoteSrc = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');
  const from = "  'price_per_meter',\n  'area_m2', 'bedrooms', 'bathrooms',";
  if (!remoteSrc.includes(from)) throw new Error('mutation anchor missing in remote.ts');
  const file = join(mkdtempSync(join(tmpdir(), 'remote-mutant-')), 'remote.ts');
  writeFileSync(file, remoteSrc.replace(from, "  'price_per_meter', 'price_original', 'discount_pct',\n  'area_m2', 'bedrooms', 'bathrooms',"));
  const m = await liftSymbols(file, [
    { header: 'const LIST_SELECT = [', endsWith: /^\]\.join\(', '\);$/ },
    { header: 'const DISCOUNT_COLUMN_TABLES', endsWith: /;$/ },
    { header: 'const DISCOUNT_COLUMNS', endsWith: /;$/ },
    { header: 'function listSelectFor(' },
  ], ['listSelectFor']);
  const mutant = m.listSelectFor as (t: string) => string;
  mustCatch('a shared select that asks every table for the discount columns', /price_original/.test(mutant('wasalt_residential_listings')));
}
check('finalize() builds `discount` with listingDiscountFrom(deal, source, price_total, price_original, discount_pct)',
  /discount:\s*priceIsDerived \? null : listingDiscountFrom\(deal, r\.source \?\? 'Aqar', r\.price_total, r\.price_original, r\.discount_pct\)/.test(remote));
const card = readFileSync(join(root, 'src/components/ResultCard.tsx'), 'utf8');
const renders = card.match(/\{listing\.discount \? \(/g)?.length ?? 0;
check(`ResultCard renders listing.discount on both layouts (found ${renders})`, renders === 2);
check('the struck price goes through listingDiscountOldPrice() (same formatting as the price line)', (card.match(/listingDiscountOldPrice\(listing\.discount, locale\)/g)?.length ?? 0) === 2);
check('the old price is struck through, not printed as a second price', /discountOld: \{[^}]*textDecorationLine: 'line-through'/.test(card));
const preview = readFileSync(join(root, 'src/components/ListingPreview.tsx'), 'utf8');
check('the details page (ListingPreview) renders l.discount under its price through listingDiscountOldPrice()',
  /\{l\.discount \? \(/.test(preview) && /listingDiscountOldPrice\(l\.discount, locale\)/.test(preview) && /discountOld: \{[^}]*textDecorationLine: 'line-through'/.test(preview));

console.log(failed === 0 ? '\n✓ a source discount shows next to the final price, and only then' : `\n✗ ${failed} discount check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
