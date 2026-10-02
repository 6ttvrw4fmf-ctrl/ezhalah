// Gathern shows NO price — only «اضغط للاطلاع على الأسعار حسب مدة الإقامة» (owner rule 2026-10-02).
//
// A Gathern stay is priced by its length: the guest picks the dates on Gathern, and the page they
// land on (src/lib/gathernUrl.ts opens it bare, no dates) prices whatever stay they choose. One
// monthly figure on our card misstated that. The rule is display-only: the stored price, the
// monthly-only search, and every filter and sort are unchanged.
//
// EXECUTED, NOT READ: listingPrice(), sourceName(), translate(), tPrice() and the AR dictionary are
// lifted from the shipped files and run; the source checks only pin that every surface that prints a
// listing's price goes through listingPrice().
//
//   node --experimental-strip-types scripts/verify-gathern-shows-a-stay-length-note-not-a-price.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOTE_AR = 'اضغط للاطلاع على الأسعار حسب مدة الإقامة';

const i18n = await liftSymbols(join(root, 'src/i18n.tsx'), [
  { header: 'const AR: Record<string, string> = {' },
  { header: 'function fill(' },
  { header: 'export function translate(' },
  { header: 'export function tPrice(' },
], ['translate', 'tPrice'], "type Locale = 'ar' | 'en';\nlet _locale: Locale = 'ar';");
(globalThis as Record<string, unknown>).__i18n = i18n;
const display = await liftSymbols(join(root, 'src/lib/listingDisplay.ts'), [
  { header: 'export const GATHERN_PRICE_NOTE', endsWith: /;$/ },
  { header: 'export function sourceName(' },
  { header: 'export function listingPrice(' },
], ['listingPrice'],
  "type Locale = 'ar' | 'en'; type Listing = { source: string; price: string };\n" +
  'const { translate, tPrice } = (globalThis as any).__i18n;');
type L = { source: string; price: string };
type PriceFn = (l: L, loc: 'ar' | 'en') => string;
const listingPrice = display.listingPrice as PriceFn;
const tPrice = i18n.tPrice as (p: string, loc: 'ar' | 'en') => string;
const READ = (rel: string) => readFileSync(join(root, rel), 'utf8');

const problemsFor = (price: PriceFn, rd: (rel: string) => string): string[] => {
  const out: string[] = [];
  const check = (label: string, ok: boolean) => { if (!ok) out.push(label); };
  const gathern = { source: 'Gathern', price: 'SAR 4,200/mo' };
  const aqar = { source: 'Aqar', price: 'SAR 4,200/mo' };
  check('a Gathern card prints the owner\'s note in Arabic, never the figure', price(gathern, 'ar') === NOTE_AR);
  check('a Gathern card prints no price in English either', price(gathern, 'en') === 'Tap to see prices by length of stay');
  check('every other platform still prints its own price', price(aqar, 'ar') === 'ر.س 4,200/شهرياً' && price(aqar, 'en') === 'SAR 4,200/mo');

  const card = rd('src/components/ResultCard.tsx');
  check('the result card prints listingPrice(), not the raw listing.price', /\{listingPrice\(listing, locale\)\}/.test(card) && !/\{tPrice\(listing\.price\)\}/.test(card));
  check('Read Aloud speaks listingPrice()', /return listingPrice\(listing, 'ar'\);/.test(rd('src/lib/listingDisplay.ts')));
  check('the agent\'s memory of the cards restates listingPrice(), not the hidden figure', /— \$\{listingPrice\(l, 'en'\)\}/.test(rd('src/app/agent.tsx')));
  // The details panel must not bring the price back: Gathern's stored discount / pre-discount monthly
  // / nightly figures stay in the row, but no panel field reads them.
  const remote = rd('src/data/remote.ts');
  const gathernKeys = windowBetween(remote, 'const GATHERN_ONLY_ADDL_KEYS', 'function buildAdditionalInfo', 'src/data/remote.ts');
  for (const k of ['discount_label', 'monthly_price_before_discount', 'nightly_price']) {
    check(`the Gathern details panel shows no «${k}» row`, !new RegExp(`\\['${k}',`).test(remote) && !gathernKeys.includes(`'${k}'`));
  }
  return out;
};

const problems = problemsFor(listingPrice, READ);

// ── Mutation proof: the same checks, run against broken copies of the REAL shipped files ─────────
const swap = (rel: string, from: string, to: string) => (r: string) => {
  const src = READ(r);
  if (r !== rel) return src;
  if (!src.includes(from)) throw new Error(`mutation anchor missing in ${rel}: ${from}`);
  return src.replace(from, to);
};
const mustCatch = (what: string, caught: boolean) => { if (!caught) problems.push(`MUTANT SURVIVED: ${what}`); };
mustCatch('Gathern priced like everyone else', problemsFor((l, loc) => tPrice(l.price, loc), READ).length > 0);
mustCatch('a different Arabic note', problemsFor((l, loc) => (l.source === 'Gathern' && loc === 'ar' ? 'السعر حسب المدة' : listingPrice(l, loc)), READ).length > 0);
mustCatch('the card printing the raw price', problemsFor(listingPrice, swap('src/components/ResultCard.tsx', '{listingPrice(listing, locale)}', '{tPrice(listing.price)}')).length > 0);
mustCatch('Read Aloud speaking the raw price', problemsFor(listingPrice, swap('src/lib/listingDisplay.ts', "return listingPrice(listing, 'ar');", "return tPrice(listing.price, 'ar');")).length > 0);
mustCatch('the agent restating the hidden figure', problemsFor(listingPrice, swap('src/app/agent.tsx', "— ${listingPrice(l, 'en')}", '— ${l.price}')).length > 0);
mustCatch('the nightly rate back in the details panel', problemsFor(listingPrice, swap('src/data/remote.ts', "  ['amenities', 'Amenities'],", "  ['nightly_price', 'Nightly rate (SAR)'],\n  ['amenities', 'Amenities'],")).length > 0);

if (problems.length) {
  console.error('✗ Gathern price note:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log('✅ Gathern shows «' + NOTE_AR + '» instead of a price on every surface; other platforms unchanged.');
