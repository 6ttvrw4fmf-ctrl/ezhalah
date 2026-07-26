// Automated test — the property card must show a SOURCE-PUBLISHED «سعر المتر» in Arabic on
// listings that have no total price, and must WITHHOLD the «1» placeholder. 2026-07-26.
//
// CONTEXT
// aqar prints a per-meter rate in its structured «تفاصيل الإعلان» spec row. The Python enricher
// parsed it, then public.trg_aqar_parse() overwrote the column with round(price_total/area_m2) and
// NULLed it whenever there was no total — so 1,077 live listings that DO publish a rate showed the
// user a bare «السعر عند الطلب» and nothing else. Migration 20260726120000 stops the derivation and
// re-extracts the published value; this file guards the DISPLAY half of that fix.
//
// WHAT IS ASSERTED
//   1. The Arabic strings the card renders are the real ones from src/i18n.tsx (read as text —
//      .tsx cannot be imported by the Node type-stripping runner; same approach the other
//      verifiers use for .tsx sources).
//   2. The show/withhold predicate, ported line-for-line from ResultCard.tsx, behaves correctly on
//      REAL rows frozen from the live DB after the migration.
//   3. The port cannot drift: the exact gate expression is asserted to still exist in the JSX, and
//      the value is asserted NOT to be folded into `Listing.price` (which src/data/search.ts parses
//      back into a number for the hard price filter and the cheapest/priciest sort).
//
// Run: node --experimental-strip-types scripts/verify-aqar-ppm-card-display.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) { failed++; if (detail) console.error(`  ${detail}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const I18N = readFileSync(new URL('../src/i18n.tsx', import.meta.url), 'utf8');
const CARD = readFileSync(new URL('../src/components/ResultCard.tsx', import.meta.url), 'utf8');
const REMOTE = readFileSync(new URL('../src/data/remote.ts', import.meta.url), 'utf8');

// ── 1. the Arabic the user actually sees ───────────────────────────────────────────────────────
const arOf = (key: string): string | null => {
  const m = I18N.match(new RegExp(`'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\s*:\\s*'([^']+)'`));
  return m ? m[1] : null;
};
eq("i18n renders the label «سعر المتر» for 'Price Per m²'", arOf('Price Per m²'), 'سعر المتر');
check("i18n renders the currency «ر.س» for 'SAR'", /AR\['SAR'\]\s*=\s*'ر\.س'/.test(I18N),
      "AR['SAR'] = 'ر.س' not found in src/i18n.tsx");
check('tPrice maps the price-less sentinel to «السعر عند الطلب»',
      /'Price on request'\)\s*return\s*'السعر عند الطلب'/.test(I18N));

// ── 2. the show/withhold rule, ported from ResultCard.tsx ──────────────────────────────────────
// PORT of:  listing.price === 'Price on request' && listing.pricePerMeter != null
//                                                && listing.pricePerMeter !== 1
type Row = { ad: string; price: string; pricePerMeter: number | null };
const showsPpm = (l: Row): boolean =>
  l.price === 'Price on request' && l.pricePerMeter != null && l.pricePerMeter !== 1;

// The Arabic line the card composes, ported from the JSX:
//   {t('Price Per m²')} <Text …>{t('SAR')} {Number(ppm).toLocaleString('en-US')}</Text>
const ppmLine = (ppm: number) => `سعر المتر ر.س ${ppm.toLocaleString('en-US')}`;

// REAL rows, frozen from the live DB after migration 20260726120000 (verified via the anon key).
const ROWS: Row[] = [
  { ad: '6237931', price: 'Price on request', pricePerMeter: 175 },   // Unaizah, 3,666 m² commercial land
  { ad: '6246621', price: 'Price on request', pricePerMeter: 50 },    // Unaizah, 238,000 m² commercial land
  { ad: '6781586', price: 'Price on request', pricePerMeter: 2000 },  // As Sulayyil
  { ad: '6694227', price: 'Price on request', pricePerMeter: 500 },   // Al Majmaah
  { ad: '6668714', price: 'Price on request', pricePerMeter: 1 },     // Al Qunfudhah — PLACEHOLDER
  // a priced listing must NEVER show the rate line (its real price is the headline)
  { ad: 'priced',  price: 'SAR 540,000',      pricePerMeter: 900 },
  // a listing with no published rate keeps today's behaviour exactly
  { ad: 'norate',  price: 'Price on request', pricePerMeter: null },
];

check('published rate renders on a price-less listing (ad 6237931)', showsPpm(ROWS[0]));
eq('…and its Arabic line reads «سعر المتر ر.س 175»', ppmLine(ROWS[0].pricePerMeter!), 'سعر المتر ر.س 175');
check('published rate renders on 238,000 m² land (ad 6246621)', showsPpm(ROWS[1]));
eq('…thousands separator is applied (ad 6781586)', ppmLine(ROWS[2].pricePerMeter!), 'سعر المتر ر.س 2,000');
check('rate renders for ad 6694227', showsPpm(ROWS[3]));

check('«سعر المتر 1» placeholder is WITHHELD (ad 6668714 keeps «السعر عند الطلب»)', !showsPpm(ROWS[4]),
      'a 1 SAR/m² token with no total is the seller\'s "call me" marker, not a market rate');
check('a listing WITH a real price never shows the rate line', !showsPpm(ROWS[5]));
check('a listing with no published rate is unchanged', !showsPpm(ROWS[6]));

// ── 3. anti-drift: the port must still match the shipped JSX ───────────────────────────────────
check('ResultCard still gates on the price-less sentinel',
      /listing\.price\s*===\s*'Price on request'/.test(CARD));
check('ResultCard still gates on a non-null pricePerMeter',
      /listing\.pricePerMeter\s*!=\s*null/.test(CARD));
check('ResultCard still withholds the literal 1 placeholder',
      /listing\.pricePerMeter\s*!==\s*1/.test(CARD));
check('ResultCard renders the rate with the Arabic label + currency helpers',
      /t\('Price Per m²'\)/.test(CARD) && /t\('SAR'\)/.test(CARD));

// The value must stay OUT of the `price` display string: search.ts parses that string back into a
// number (listingPriceValue) for the hard price filter and the cheapest/priciest sort, so folding a
// per-meter rate into it would corrupt both.
check('price_per_meter is NOT folded into the Listing.price string',
      !/priceStr[^\n]*price_per_meter/.test(REMOTE) && !/price_per_meter[^\n]*priceStr/.test(REMOTE));
check('remote.ts passes price_per_meter through verbatim (no rounding / no derivation)',
      /pricePerMeter:\s*typeof r\.price_per_meter === 'number' \? r\.price_per_meter : null/.test(REMOTE),
      'the field must be copied as-is — never computed from price/area');
check("LIST_SELECT actually requests the column (else the card can never see it)",
      /'price_per_meter'/.test(REMOTE));

console.log(failed === 0
  ? '\n✓ aqar price-per-meter card display verified (Arabic label, placeholder withheld, no price-string contamination)'
  : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
