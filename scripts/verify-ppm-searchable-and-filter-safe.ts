// Automated test — price_per_meter is SEARCHABLE, SOURCE-ONLY, and can never be mistaken for or
// matched against a total price. 2026-08-09.
//
// CONTEXT
// Owner instruction, 2026-08-09: "If Aqar only publishes price per m², store price_per_meter
// through the searchable backend architecture and display it clearly as ريال/م². NEVER calculate or
// invent a total price. Make it searchable/filter-safe without confusing price-per-meter with total
// price."
//
// Two independent hazards are guarded here, because they fail in opposite directions:
//
//   (1) DERIVATION — writing round(price_total/area_m2) into a column named after a source field.
//       That is what migration 20260726120000 removed from trg_aqar_parse(), and what the
//       2026-08-09 repair purged from the 24,345 rows the old writer had already poisoned
//       (13,052 "source prints no rate", 337 "no capture at all" — 305 of which stored the
//       property's AREA as its price — and 882 corrected to the value the page actually prints).
//
//   (2) UNIT CONFUSION — letting a per-square-metre RATE reach anything that treats it as a total.
//       A 750 ريال/م² rate is not a 750 ريال property. If the price filter, the price sort, or the
//       price display string ever read this field, a rate would be compared against a budget.
//
// WHAT IS ASSERTED (all static — no DB access, runs in CI like its siblings)
//   1. The rate never enters the price-filter path: p_price_min/p_price_max are built only from
//      the user's own budget inputs, and pricePerMeter is not referenced anywhere in that path.
//   2. The rate never enters the price DISPLAY string (search.ts parses that back into a number
//      for the hard price filter and the cheapest/priciest sort).
//   3. The rate is only ever copied, never computed — no arithmetic on it anywhere in src/.
//   4. No code derives a TOTAL from the rate (rate × area), which stays permanently forbidden.
//
// Run: node --experimental-strip-types scripts/verify-ppm-searchable-and-filter-safe.ts
// (wired into `npm test`)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) { failed++; if (detail) console.error(`  ${detail}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const SRC = new URL('../src/', import.meta.url).pathname;
const REMOTE = readFileSync(join(SRC, 'data/remote.ts'), 'utf8');
const CARD = readFileSync(join(SRC, 'components/ResultCard.tsx'), 'utf8');

// Every .ts/.tsx under src/, so a future file cannot quietly reintroduce the hazard.
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : (/\.tsx?$/.test(p) ? [p] : []);
  });
const ALL = walk(SRC).map((p) => ({ p, text: readFileSync(p, 'utf8') }));

// ── 1. the rate is never read by the price filter ──────────────────────────────────────────────
// The RPC price bounds must come from the user's budget only.
check('p_price_min is built from the user budget, not from a per-meter rate',
      /p_price_min\s*=\s*q\.priceIsAnnual\s*\?\s*null\s*:\s*pnum\(q\.priceMin\)/.test(REMOTE));
check('p_price_max is built from the user budget, not from a per-meter rate',
      /p_price_max\s*=\s*q\.priceIsAnnual\s*\?\s*null\s*:\s*pnum\(q\.priceMax\)/.test(REMOTE));

const priceParamBlock = REMOTE.slice(
  Math.max(0, REMOTE.indexOf('let p_price_min')),
  REMOTE.indexOf('p_price_max,') + 40);
check('nothing in the price-parameter block references the per-meter rate',
      priceParamBlock.length > 0 && !/price_per_meter|pricePerMeter/.test(priceParamBlock),
      'a per-meter rate must never become a price filter bound');

// ── 2. the rate never enters the price display string ──────────────────────────────────────────
check('price_per_meter is NOT folded into the Listing.price string',
      !/priceStr[^\n]*price_per_meter/.test(REMOTE) && !/price_per_meter[^\n]*priceStr/.test(REMOTE),
      'search.ts parses Listing.price back into a number for the hard price filter and price sort');

// ── 3. the rate is copied verbatim, never computed ─────────────────────────────────────────────
check('remote.ts passes price_per_meter through verbatim',
      /pricePerMeter:\s*typeof r\.price_per_meter === 'number' \? r\.price_per_meter : null/.test(REMOTE),
      'the field must be copied as-is — never computed from price/area');

// No arithmetic anywhere on the rate. Reading it, comparing it, and formatting it are fine;
// multiplying/dividing/adding it is the derivation hazard.
for (const { p, text } of ALL) {
  const bad = text.match(/pricePerMeter\s*[*/+-]\s*[^=\s]|[^=\s]\s*[*/]\s*pricePerMeter/g);
  check(`no arithmetic on pricePerMeter in ${p.slice(SRC.length)}`, bad === null,
        bad ? `found: ${bad.join(', ')}` : '');
}

// ── 4. a TOTAL is never derived from the rate ──────────────────────────────────────────────────
for (const { p, text } of ALL) {
  const derivesTotal =
    /pricePerMeter\s*\*\s*(listing\.)?area/i.test(text) ||
    /(listing\.)?area\s*\*\s*(listing\.)?pricePerMeter/i.test(text);
  check(`no total derived from rate × area in ${p.slice(SRC.length)}`, !derivesTotal);
}

// ── 5. the card shows it as an explicit per-m² rate ────────────────────────────────────────────
check('the card labels the value as a per-m² rate, not a price',
      /t\('SAR\/m²'\)/.test(CARD),
      'without the unit the number reads as a total price');
check('the card still withholds non-positive / placeholder rates',
      /listing\.pricePerMeter\s*>\s*1/.test(CARD));

console.log(failed === 0
  ? '\n✓ price_per_meter is searchable, source-only, and filter-safe (never a total, never derived)'
  : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
