// PERMANENT BARRIER — the derived total is ONE rule with two implementations, and they must agree.
//
// THE HALF-STATE THIS EXISTS TO PREVENT. A per-metre-only sale listing becomes budget-searchable
// because the SQL generated column search_listings_ar.price_total_effective computes a total for it.
// The ResultCard computes the SAME total in TypeScript (derivedTotalFromPerMeter). If those two
// drift, a listing MATCHES a budget the card cannot show — or worse, shows a different number than
// the one it matched on. That state existed briefly on 2026-09-03 (SQL derived, card did not) and
// is exactly what this pins shut.
//
// WHAT IS ASSERTED:
//   1. The shipped SQL still encodes all four conditions (sale-only, no published price, real
//      per-metre AND real area, credible bound) — parsed from the migration, not assumed.
//   2. The bound is the SAME NUMBER on both sides (500,000,000).
//   3. The TS rule, EXECUTED, returns exactly what the SQL rule would for a table of cases that
//      covers every branch and both sides of the bound.
//   4. A derived total never masquerades as source-published: listingPriceString marks it with '≈',
//      and the Listing carries priceIsDerived so the card can label it.
//   5. The card still shows the SOURCE per-metre figure on a derived row (the advertiser's only
//      published price must not disappear behind our arithmetic).
//
// MUTATION-PROVEN — each of these fails this barrier:
//   M1 drop `deal !== 'Buy'`            -> rent rows derive, case R1 breaks
//   M2 drop the priceAnnual check       -> derives over a published rent price, case R2 breaks
//   M3 raise/lower DERIVED_TOTAL_MAX    -> parity with the SQL bound breaks (check 2)
//   M4 drop the '≈' prefix              -> check 4 breaks
//   M5 remove `|| listing.priceIsDerived` from the card -> check 5 breaks
//
//   node --experimental-strip-types scripts/verify-derived-total-rule-parity.ts   (in `npm test`)

import { readFileSync, readdirSync } from 'node:fs';
import { derivedTotalFromPerMeter, listingPriceString, DERIVED_TOTAL_MAX } from '../src/data/listings.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

// ── 1. The SQL half, read from the shipped migration ────────────────────────────────────────────
const MIG_DIR = new URL('../supabase/migrations/', import.meta.url);
const migFile = readdirSync(MIG_DIR)
  .filter((f) => f.includes('price_total_effective_derives_only_for_buy_rows'))
  .sort()
  .pop();
check('the generated-column migration is mirrored in the repo', Boolean(migFile), 'no matching file');

const sql = migFile ? readFileSync(new URL(migFile, MIG_DIR), 'utf8') : '';
check('SQL: derives only for SALE rows', /deal_ar\s*=\s*'بيع'/.test(sql));
check('SQL: refuses when a rent price is published', /price_annual\s+is\s+null/.test(sql));
check('SQL: requires a real per-metre price', /price_per_meter\s+is\s+not\s+null/.test(sql));
check('SQL: requires a real area > 0', /area_m2\s*>\s*0/.test(sql));
check('SQL: a source-published total always wins', /when\s+price_total\s+is\s+not\s+null\s+then\s+price_total/.test(sql));

// ── 2. The bound is the same number on both sides ───────────────────────────────────────────────
const sqlBound = sql.match(/<=\s*(\d{6,})/);
check('SQL declares a credibility bound', Boolean(sqlBound), 'no numeric bound found');
check(`the bound matches on both sides (${DERIVED_TOTAL_MAX})`,
  Boolean(sqlBound) && Number(sqlBound![1]) === DERIVED_TOTAL_MAX,
  `sql=${sqlBound?.[1]} ts=${DERIVED_TOTAL_MAX}`);

// ── 3. EXECUTE the TS rule over every branch, including both sides of the bound ─────────────────
type Case = { name: string; deal: 'Buy' | 'Rent'; total: unknown; annual: unknown; ppm: unknown; area: unknown; want: number | null };
const CASES: Case[] = [
  { name: 'B1 sale, no price, ppm x area',        deal: 'Buy',  total: null, annual: null, ppm: 1700, area: 400, want: 680000 },
  { name: 'B2 sale, source total wins',           deal: 'Buy',  total: 900000, annual: null, ppm: 1700, area: 400, want: null },
  { name: 'B3 sale, no area',                     deal: 'Buy',  total: null, annual: null, ppm: 1700, area: null, want: null },
  { name: 'B4 sale, area 0',                      deal: 'Buy',  total: null, annual: null, ppm: 1700, area: 0,    want: null },
  { name: 'B5 sale, no ppm',                      deal: 'Buy',  total: null, annual: null, ppm: null, area: 400,  want: null },
  // B6 is the case the mutation sweep proved was MISSING: a BUY row that nevertheless carries a
  // published annual price. R2 below never exercised the published-price guard, because the
  // sale-only guard caught it first — so removing the annual check left the suite green. The
  // SQL guards this shape explicitly (deal_ar='بيع' AND price_annual is null); so must TS.
  { name: 'B6 sale WITH a published annual price -> refuses', deal: 'Buy', total: null, annual: 60000, ppm: 1700, area: 400, want: null },
  { name: 'R1 RENT never derives',                deal: 'Rent', total: null, annual: null, ppm: 1700, area: 400,  want: null },
  { name: 'R2 rent with published annual',        deal: 'Rent', total: null, annual: 60000, ppm: 1700, area: 400, want: null },
  { name: 'X1 exactly at the bound  -> derives',  deal: 'Buy',  total: null, annual: null, ppm: 1, area: DERIVED_TOTAL_MAX, want: DERIVED_TOTAL_MAX },
  { name: 'X2 one over the bound    -> refuses',  deal: 'Buy',  total: null, annual: null, ppm: 1, area: DERIVED_TOTAL_MAX + 1, want: null },
  { name: 'X3 absurd product (7e12) -> refuses',  deal: 'Buy',  total: null, annual: null, ppm: 1000000, area: 7000000, want: null },
];
for (const c of CASES) {
  const got = derivedTotalFromPerMeter(c.deal, c.total, c.annual, c.ppm, c.area);
  check(`${c.name}`, got === c.want, `got ${got}, want ${c.want}`);
}

// The SQL is `price_per_meter::bigint * area_m2 <= BOUND` — inclusive. X1/X2 above pin that the TS
// comparison is inclusive in the same direction, which is the classic off-by-one between the halves.

// ── 4. A derived total is never presented as source-published ───────────────────────────────────
const derivedStr = listingPriceString('Buy', null, null, null, 1700, 400);
const publishedStr = listingPriceString('Buy', null, null, 680000, 1700, 400);
check('a DERIVED total is marked with ≈', derivedStr.startsWith('≈ '), derivedStr);
check('a PUBLISHED total is NOT marked', !publishedStr.startsWith('≈'), publishedStr);
check('both render the same amount', derivedStr.replace('≈ ', '') === publishedStr,
  `${derivedStr} vs ${publishedStr}`);
check('a price-less, area-less row still says Price on request',
  listingPriceString('Buy', null, null, null, null, null) === 'Price on request');
check('rent is untouched by the rule',
  listingPriceString('Rent', 'annual', 60000, null, 1700, 400) === 'SAR 60,000/yr');

// ── 5. The card keeps the SOURCE per-metre figure on a derived row, and labels the total ────────
const card = readFileSync(new URL('../src/components/ResultCard.tsx', import.meta.url), 'utf8');
check('card still shows the source per-metre rate when the total is derived',
  /listing\.price === 'Price on request' \|\| listing\.priceIsDerived/.test(card),
  'the per-metre line is gated on "Price on request" alone, so it disappears once a total is derived');
check('card renders an explicit calculated-total note',
  card.includes('Calculated from price per m² × area'));
const remote = readFileSync(new URL('../src/data/remote.ts', import.meta.url), 'utf8');
check('remote.ts passes per-metre + area into the price string',
  /listingPriceString\(deal, r\.rent_period, r\.price_annual, r\.price_total,\s*\n?\s*r\.price_per_meter, r\.area_m2\)/.test(remote));
check('remote.ts marks the row as derived for the card',
  remote.includes('priceIsDerived'));

console.log(failed === 0
  ? '\n✅ the derived-total rule is identical in SQL and TS, and never poses as a source price.'
  : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
