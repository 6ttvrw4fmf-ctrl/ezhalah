// A SALE CARD PRINTS — AND THE CLIENT BUDGET NET FILTERS ON — THE PRICE THE INDEX SERVES (falcon 2026-10-30).
//
// 20261028213252 made the search index serve the seller's figure when a sale total was typed into the «سعر المتر»
// box (dealapp 451328: source 52,000,000,000 SAR for 200,000 m², box 260,000). The card kept printing the platform
// table's 52 billion, and priceFilter() in src/data/search.ts re-reads the PRINTED price, so a 1,000,000 budget the
// server matched at 260,000 dropped the card after the count: «N نتيجة», N−1 cards. 43 served sale rows, 41 dealapp.
//
// This barrier EXECUTES the shipped code: src/lib/meterBoxPrice.ts against the SQL migration's own proof cases, and
// the real round trip — listingPriceString() (the card) → withinValue() (lifted from search.ts, the client net).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { priceTypedInMeterBox, servedSaleFigures } from '../src/lib/meterBoxPrice.ts';
import { listingPriceString } from '../src/data/listings.ts';
import { liftSymbols } from './lib/liftSymbols.ts';

const lifted = await liftSymbols(new URL('../src/data/search.ts', import.meta.url).pathname,
  [{ header: 'function listingPriceValue(' }, { header: 'function withinValue(' }], ['withinValue'], '');
const withinValue = lifted.withinValue as (price: string, min: number, max: number) => boolean;

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const mustCatch = (label: string, caught: boolean) => check(`catches: ${label}`, caught);

// 1. The SQL migration's own proof cases (20261028213252), executed against the TS mirror.
check('the proven typo is corrected', priceTypedInMeterBox(140360991328, 5585, 25132140) === 25132140);
check('the 14 SAR/m² farm is corrected', priceTypedInMeterBox(3858750000000, 525000, 7350000) === 7350000);
check('no per-meter field → no guess', priceTypedInMeterBox(6666666667, 450, null) === null);
check('a non-matching box → no guess', priceTypedInMeterBox(3000000000150, 450, 900000) === null);
check('a sane price is never touched', priceTypedInMeterBox(1500000, 600, 2500) === null);
check('an absurd per-meter box is never served', priceTypedInMeterBox(6200990767, 62, 100015980) === null);

// 1b. The siblings (owner 2026-10-30, migration *_meter_box_typo_ceiling_100k): the same cases the SQL proof block runs.
const riyadh = { city: 'الرياض', commercial: false };
check('the 1,350,000/m² sibling is corrected (dealapp 20483625, Riyadh land, 625 m²)', priceTypedInMeterBox(843750000, 625, 1350000, riyadh) === 1350000);
check('the 100,000 edge is in', priceTypedInMeterBox(40000000, 400, 100000, riyadh) === 100000);
check('99,999/m² is not', priceTypedInMeterBox(39999600, 400, 99999, riyadh) === null);
check('Madinah land at 850,000/m² with the box agreeing is a real price', priceTypedInMeterBox(673251000, 792, 850000, { city: 'المدينة المنورة', commercial: false }) === null);
check('…also when the platform row spells it in English', priceTypedInMeterBox(673251000, 792, 850000, { city: 'Madinah', commercial: false }) === null);
check('Makkah keeps the old bar', priceTypedInMeterBox(843750000, 625, 1350000, { city: 'Makkah', commercial: false }) === null);
check('a commercial row keeps the old bar', priceTypedInMeterBox(843750000, 625, 1350000, { city: 'الرياض', commercial: true }) === null);
check('no context = the 2026-10-28 rule exactly', priceTypedInMeterBox(843750000, 625, 1350000) === null);
mustCatch('the sibling without the residential bar (the pre-fix rule) stays at 843,750,000',
  servedSaleFigures(843750000, null, 625, 1350000).priceTotal === 843750000 && servedSaleFigures(843750000, null, 625, 1350000, riyadh).priceTotal === 1350000);

// 2. Real production rows (dealapp_residential_listings, read 2026-10-30), through the card and the client net.
const REAL: [string, number, number, number][] = [
  ['1136238', 52_000_000_000, 200_000, 260_000],
  ['3063140', 196_000_000_000, 400_000, 490_000],
  ['5440127', 242_440_000_000, 242_440, 1_000_000],
  ['14851747', 200_000_000_000, 200_000, 1_000_000],
];
const card = (pt: unknown, ppm: unknown, area: number) => listingPriceString('Buy', null, null, pt, ppm, area);
for (const [id, pt, area, ppm] of REAL) {
  const s = servedSaleFigures(pt, null, area, ppm);
  check(`dealapp ${id}: the card prints the seller's ${ppm.toLocaleString('en')} (index value)`, s.priceTotal === ppm);
  check(`dealapp ${id}: a 1,000,000 budget the server matched keeps the card`, withinValue(card(s.priceTotal, s.pricePerMeter, area), 0, 1_000_000));
  mustCatch(`dealapp ${id}: the pre-fix card (raw platform price) is dropped by that budget`,
    !withinValue(card(pt, ppm, area), 0, 1_000_000));
}
const sane = servedSaleFigures(1_500_000, null, 600, 2500);
check('a sane sale row is passed through unchanged', sane.priceTotal === 1_500_000 && sane.pricePerMeter === 2500);

// 3. The card path routes through it. (Execution above proves the rule; this pins that finalize() uses it.)
const remote = readFileSync(new URL('../src/data/remote.ts', import.meta.url), 'utf8');
const fin = remote.slice(remote.indexOf('function finalize('), remote.indexOf('function finalize(') + 6000);
check('finalize() derives the sale figures with servedSaleFigures()', /servedSaleFigures\(r\.price_total, r\.price_annual, r\.area_m2, r\.price_per_meter, \{ city: r\.city, commercial: kind === 'com' \}\)/.test(fin));
check('finalize() prints the served total, not r.price_total', /listingPriceString\(deal, pool, servedAnnual, sale\.priceTotal,/.test(fin));
mustCatch('a finalize() that prints r.price_total again', !/listingPriceString\(deal, pool, servedAnnual, sale\.priceTotal,/.test(fin.replace('sale.priceTotal,', 'r.price_total,')));

assert.equal(failed, 0, `${failed} check(s) failed`);
console.log('✓ a sale card prints and filters on the price the index serves');
