// Gathern and Aqar Monthly show NO price line at all (owner 2026-10-26: «remove the إقامات قصيرة price, no need
// for it» — until then, since 2026-10-02, they showed a «tap to see prices by length of stay» note). Aqar Monthly
// is Aqar's DailyRenting vertical, the Gathern twin.
//
// A stay there is priced by its length: the guest picks the dates on the platform, and the page they land on
// (src/lib/gathernUrl.ts opens it bare, no dates) prices whatever stay they choose. No single figure on our card
// is right, so there is none. The rule is display-only: the stored price, the short-stays pool, and every filter
// and sort are unchanged.
//
// EXECUTED, NOT READ: listingPrice(), monthlyLineText(), translate() and tPrice() are lifted from the shipped files
// and run; the source checks only pin that every surface that prints a listing's price goes through listingPrice()
// and prints nothing when it is ''.
//
//   node --experimental-strip-types scripts/verify-stay-length-platforms-show-a-note-not-a-price.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLD_NOTE_AR = 'اضغط للاطلاع على الأسعار حسب مدة الإقامة';

const i18n = await liftSymbols(join(root, 'src/i18n.tsx'), [
  { header: 'const AR: Record<string, string> = {' },
  { header: 'function fill(' },
  { header: 'const EN: Record<string, string> = {' }, // translate() reads the English wording table
  { header: 'export function translate(' },
  { header: 'export function tPrice(' },
  { header: "AR['SAR'] = 'ر.س';", endsWith: /;$/ }, // the currency word is added to AR after the dictionary; the monthly line prints it
], ['translate', 'tPrice'], "type Locale = 'ar' | 'en';\nlet _locale: Locale = 'ar';");
(globalThis as Record<string, unknown>).__i18n = i18n;
const { advertisedMonthly } = await import('../src/lib/rentPool.ts');
(globalThis as Record<string, unknown>).__advertisedMonthly = advertisedMonthly;
const display = await liftSymbols(join(root, 'src/lib/listingDisplay.ts'), [
  { header: 'export const isStayLengthPriced', endsWith: /;$/ },
  { header: 'export function listingPrice(' },
  { header: 'export function monthlyLineText(' },
], ['listingPrice', 'monthlyLineText'],
  "type Locale = 'ar' | 'en'; type Listing = { source: string; price: string; rentPeriod?: string | null; sourceRentPeriod?: string | null; priceAnnual?: number | null };\n" +
  'const { translate, tPrice } = (globalThis as any).__i18n; const advertisedMonthly = (globalThis as any).__advertisedMonthly;');
type L = { source: string; price: string; rentPeriod?: string | null; sourceRentPeriod?: string | null; priceAnnual?: number | null };
type PriceFn = (l: L, loc: 'ar' | 'en') => string;
const listingPrice = display.listingPrice as PriceFn;
const monthlyLineText = display.monthlyLineText as (l: L, loc: 'ar' | 'en') => string | null;
const tPrice = i18n.tPrice as (p: string, loc: 'ar' | 'en') => string;
const READ = (rel: string) => readFileSync(join(root, rel), 'utf8');

const problemsFor = (price: PriceFn, rd: (rel: string) => string): string[] => {
  const out: string[] = [];
  const check = (label: string, ok: boolean) => { if (!ok) out.push(label); };
  const gathern = { source: 'Gathern', price: 'SAR 4,200/mo', rentPeriod: 'monthly', sourceRentPeriod: 'monthly', priceAnnual: 50400 };
  const aqar = { source: 'Aqar', price: 'SAR 4,200/mo' };
  const aqarMonthly = { source: 'Aqar Monthly', price: 'SAR 4,200/mo', rentPeriod: 'monthly', sourceRentPeriod: 'monthly', priceAnnual: 50400 };
  check('a Gathern card prints NO price line in Arabic — not the figure, not the old note', price(gathern, 'ar') === '');
  check('a Gathern card prints NO price line in English either', price(gathern, 'en') === '');
  check('an Aqar Monthly card prints NO price line either', price(aqarMonthly, 'ar') === '' && price(aqarMonthly, 'en') === '');
  check('every other platform still prints its own price', price(aqar, 'ar') === 'ر.س 4,200/شهرياً' && price(aqar, 'en') === 'SAR 4,200/mo');
  check('a stay-length card gets no monthly line either', monthlyLineText(gathern, 'ar') === null && monthlyLineText(aqarMonthly, 'en') === null);

  const card = rd('src/components/ResultCard.tsx');
  check('the result card prints listingPrice(), not the raw listing.price', /\{listingPrice\(listing, locale\)\}/.test(card) && !/\{tPrice\(listing\.price\)\}/.test(card));
  check('both card layouts print NOTHING where the price would be on a stay-length row',
    /\{stay \? null : <Text style=\{\[card\.price, card\.lpPrice\]\}/.test(card)
    && /\{isStayLengthPriced\(listing\.source\) \? null : <Text style=\{\[card\.price, row && card\.priceRow/.test(card));
  check('the ad page prints the price line only when listingPrice() is non-empty', /\{listingPrice\(l, locale\) \? \(\s*\n\s*<Text testID="listing-preview-price"/.test(rd('src/components/ListingPreview.tsx')));
  check('Read Aloud speaks listingPrice() and skips it when empty', /return listingPrice\(listing, 'ar'\);/.test(rd('src/lib/listingDisplay.ts'))
    && /const sentences = \[headline, price\]\.filter\(Boolean\);/.test(rd('src/lib/readAloudScript.ts')));
  check('the agent\'s memory of the cards restates listingPrice() and omits it when empty', /\$\{listingPrice\(l, 'en'\) \? ` — \$\{listingPrice\(l, 'en'\)\}` : ''\}/.test(rd('src/app/agent.tsx')));
  check('the old note is gone from the app copy', !rd('src/i18n.tsx').includes(OLD_NOTE_AR) && !rd('src/lib/listingDisplay.ts').includes('STAY_LENGTH_PRICE_NOTE'));
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

// ── The monthly line under every yearly price (owner 2026-10-26), executed ──────────────────────
{
  const check = (label: string, ok: boolean) => { if (!ok) problems.push(label); };
  const quotedMonthly = { source: 'Aqar', price: 'SAR 36,000/yr', rentPeriod: 'annual', sourceRentPeriod: 'monthly', priceAnnual: 36000 };
  const quotedYearly = { source: 'Wasalt', price: 'SAR 36,000/yr', rentPeriod: 'annual', sourceRentPeriod: 'annual', priceAnnual: 36000 };
  const unpriced = { source: 'Aqar', price: 'Price on request', rentPeriod: 'annual', sourceRentPeriod: 'annual', priceAnnual: null };
  const noPeriod = { source: 'Aqar', price: 'SAR 36,000', rentPeriod: null, sourceRentPeriod: null, priceAnnual: 36000 };
  check('site quoted per month → «السعر المعلن ر.س 3,000 شهرياً»', monthlyLineText(quotedMonthly, 'ar') === 'السعر المعلن ر.س 3,000 شهرياً');
  check('site quoted per year → «≈ ر.س 3,000 شهرياً» (÷12)', monthlyLineText(quotedYearly, 'ar') === '≈ ر.س 3,000 شهرياً' && monthlyLineText(quotedYearly, 'en') === '≈ SAR 3,000/month');
  check('unpriced → no monthly line', monthlyLineText(unpriced, 'ar') === null);
  check('no published period → no monthly line (never guessed)', monthlyLineText(noPeriod, 'ar') === null);
  check('36,001 ÷ 12 rounds, never truncates to a wrong figure', monthlyLineText({ ...quotedYearly, priceAnnual: 36001 }, 'en') === '≈ SAR 3,000/month');
}

// ── Mutation proof: the same checks, run against broken copies of the REAL shipped files ─────────
const swap = (rel: string, from: string, to: string) => (r: string) => {
  const src = READ(r);
  if (r !== rel) return src;
  if (!src.includes(from)) throw new Error(`mutation anchor missing in ${rel}: ${from}`);
  return src.replace(from, to);
};
const mustCatch = (what: string, caught: boolean) => { if (!caught) problems.push(`MUTANT SURVIVED: ${what}`); };
mustCatch('Gathern priced like everyone else', problemsFor((l, loc) => tPrice(l.price, loc), READ).length > 0);
mustCatch('the old note back on Gathern', problemsFor((l, loc) => (/gathern/i.test(l.source) ? (loc === 'ar' ? OLD_NOTE_AR : 'Tap to see prices by length of stay') : listingPrice(l, loc)), READ).length > 0);
mustCatch('Aqar Monthly left out of the rule', problemsFor((l, loc) => (/aqar\s*monthly/i.test(l.source) ? tPrice(l.price, loc) : listingPrice(l, loc)), READ).length > 0);
mustCatch('the card printing the raw price', problemsFor(listingPrice, swap('src/components/ResultCard.tsx', '{listingPrice(listing, locale)}', '{tPrice(listing.price)}')).length > 0);
mustCatch('the laptop card drawing the (empty) price Text for a stay-length row', problemsFor(listingPrice, swap('src/components/ResultCard.tsx', '{stay ? null : <Text style={[card.price, card.lpPrice]}', '{<Text style={[card.price, card.lpPrice]}')).length > 0);
mustCatch('Read Aloud speaking the raw price', problemsFor(listingPrice, swap('src/lib/listingDisplay.ts', "return listingPrice(listing, 'ar');", "return tPrice(listing.price, 'ar');")).length > 0);
mustCatch('the agent restating the hidden figure', problemsFor(listingPrice, swap('src/app/agent.tsx', "${listingPrice(l, 'en') ? ` — ${listingPrice(l, 'en')}` : ''}", ' — ${l.price}')).length > 0);
mustCatch('the nightly rate back in the details panel', problemsFor(listingPrice, swap('src/data/remote.ts', "  ['amenities', 'Amenities'],", "  ['nightly_price', 'Nightly rate (SAR)'],\n  ['amenities', 'Amenities'],")).length > 0);

if (problems.length) {
  console.error('✗ stay-length platforms print no price line (Gathern + Aqar Monthly) / monthly line under yearly:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log('✅ Gathern + Aqar Monthly print no price line on any surface; every yearly card carries its monthly line; other platforms unchanged.');
