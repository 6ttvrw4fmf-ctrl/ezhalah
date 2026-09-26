// THE EQUATION ON THE CARD MUST EQUAL THE PRICE ON THE CARD — owner 2026-09-26.
//
// Owner: "we need to multiply it on the total land size and display it … in the description it
// should be like the price per meters × the total size = the total price … the total price needs
// to show when user tries finding it in the filter."
//
// The multiplication, the '≈' total and its searchability already existed (owner reversal
// 2026-09-03, [[ppm-times-area-becomes-a-shown-searchable-total]]) — verified live 2026-09-26: a
// الرياض / تجاري / حي وسط ثول search with a 280,000–300,000 budget returned exactly the aqar land
// at 320 ريال/م² × 900 م², priced «≈ 288,000». What was missing was the WORKING: the card showed
// the answer and a generic «محتسب من سعر المتر × المساحة» note, never the three numbers.
//
// The one way this feature can go wrong is the equation and the price disagreeing — «320 × 900 =
// 288,000» beside a price of 287,999, or an area rounded for display but not for the total. That
// can only happen if the card multiplies on its own. So the contract this file proves is that the
// card's equation is produced by the SAME function that produces the price, on real production
// numbers, and that it appears exactly when the price is derived and never otherwise.
//
//   node --experimental-strip-types scripts/verify-derived-total-equation-matches-price.ts  (npm test)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { derivedTotalEquation, listingPriceString, isDerivedTotal } from '../src/data/listings.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  if (ok) console.log(`  PASS  ${msg}`);
  else { console.log(`  FAIL  ${msg}${extra ? ` — ${extra}` : ''}`); failed++; }
};
const mustCatch = (name: string, caught: boolean) => check(caught, `(mutation) catches ${name}`);

// The figure the PRICE LINE shows, read back out of the string the card renders.
const shownTotal = (ppm: number, area: number): number | null => {
  const s = listingPriceString('Buy', null, null, null, ppm, area);
  const m = s.match(/SAR ([\d,]+(?:\.\d+)?)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

// Real rows from search_listings_ar (production, 2026-09-26), plus a fractional area — the case a
// rounding display would get wrong — and a large-but-legal commercial one.
const REAL: Array<[number, number, string]> = [
  [320, 900, 'aqar أرض تجارية, حي وسط ثول — the row the live filter test found'],
  [700, 600, 'aqar أرض تجارية, حي محاسن البلدية'],
  [19000, 45, 'aqar مكتب, حي الرمال — a high per-metre rate on a small unit'],
  [5000, 374.72, 'a fractional area (374.72 m²) — rounding it anywhere would break the equation'],
  [1403, 900, 'earthapp land, the per-metre case the owner described'],
];

console.log('\n1. the equation equals the price shown, on real production numbers');
for (const [ppm, area, label] of REAL) {
  const eq = derivedTotalEquation(ppm, area);
  const price = shownTotal(ppm, area);
  check(eq !== null, `${label}: an equation is produced`);
  if (!eq) continue;
  check(eq.perMeter === ppm && eq.area === area, `${label}: it echoes the SOURCE's own rate and area, unchanged`,
    `got ${eq.perMeter} × ${eq.area}`);
  check(price !== null && Math.abs(eq.total - price) < 0.5,
    `${label}: ${ppm} × ${area} = ${eq.total.toLocaleString('en-US')} equals the price line (${price?.toLocaleString('en-US')})`);
}

console.log('\n2. it appears exactly when the price is derived — never otherwise');
// Each of these is a row whose price is NOT our arithmetic, so there is no working to show.
const NOT_DERIVED: Array<[string, () => boolean]> = [
  ['zero area', () => derivedTotalEquation(320, 0) === null],
  ['negative per-metre rate', () => derivedTotalEquation(-5, 900) === null],
  ['missing per-metre rate', () => derivedTotalEquation(null, 900) === null],
  ['a product above the 500,000,000 bound (the 1.5-trillion earthapp hotel)', () => derivedTotalEquation(1_540_200, 1_000_000) === null],
  ['a string where a number belongs', () => derivedTotalEquation('320', 900) === null],
];
for (const [label, ok] of NOT_DERIVED) check(ok(), `no equation for ${label}`);
// And agreement with the flag the card gates on, so the two can never be out of step.
for (const [ppm, area] of [[320, 900], [0, 900], [320, 0], [1_540_200, 1_000_000]] as const) {
  check((derivedTotalEquation(ppm, area) !== null) === isDerivedTotal('Buy', null, null, ppm, area),
    `equation presence agrees with isDerivedTotal for ${ppm} × ${area}`);
}

console.log('\n3. the card renders the equation through the shared function');
const card = readFileSync(join(root, 'src/components/ResultCard.tsx'), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
check(/derivedTotalEquation\(\s*listing\.pricePerMeter\s*,\s*listing\.area\s*\)/.test(card),
  'ResultCard computes the equation with derivedTotalEquation(listing.pricePerMeter, listing.area)');
check(!/pricePerMeter\s*\*\s*(listing\.)?area|area\s*\*\s*(listing\.)?pricePerMeter/.test(card),
  'ResultCard never multiplies per-metre × area itself (a second copy is how the two drift)');
check(/\{listing\.priceIsDerived \? \(\(\) => \{[\s\S]*?derivedTotalEquation/.test(card),
  'the equation is gated on priceIsDerived — it can never label a source-published price');
check(/Calculated from price per m² × area — not published by the source/.test(card),
  'the honesty note stays: the equation shows the working, it does not replace «غير معلن من المصدر»');

console.log('\n4. mutation proofs — each rebuilds a plausible defect and requires a check above to fail');
// A card that rounds the area for display but multiplies the raw one (or vice versa).
const roundedArea = (ppm: number, area: number) => ({ perMeter: ppm, area: Math.round(area), total: ppm * Math.round(area) });
mustCatch('an equation that rounds the area (374.72 → 375) and so disagrees with the price',
  Math.abs(roundedArea(5000, 374.72).total - (shownTotal(5000, 374.72) ?? 0)) >= 0.5);
// An inline multiplication without the 500M bound shows an equation the price line refuses.
const unbounded = (ppm: number, area: number) => ppm * area;
mustCatch('an inline multiply with no bound, which would print «= 1,540,200,000,000» under no price',
  unbounded(1_540_200, 1_000_000) > 0 && derivedTotalEquation(1_540_200, 1_000_000) === null);
// A card that echoes a normalised rate instead of the source's.
mustCatch('an equation that shows a rounded per-metre rate instead of the source figure',
  (derivedTotalEquation(1403.5, 900)?.perMeter ?? 0) !== Math.round(1403.5));
// A card that forgot the gate would show working on a published price.
const noGateCard = card.replace(/\{listing\.priceIsDerived \? \(\(\) => \{/, '{(() => {');
mustCatch('dropping the priceIsDerived gate',
  !/\{listing\.priceIsDerived \? \(\(\) => \{[\s\S]*?derivedTotalEquation/.test(noGateCard));

console.log(failed === 0
  ? '\n✅ verify-derived-total-equation-matches-price: the working on the card is the price on the card.'
  : `\n❌ verify-derived-total-equation-matches-price: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
