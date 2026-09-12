// PERMANENT BARRIER — the price a user reads is ARABIC, its digits are WESTERN, and a DERIVED
// total is never dressed up as the advertiser's number (owner rule, 2026-09-03).
//
// THE RULE, in the owner's words: "make sure it's in Arabic only, the numbers in English."
//
// WHY THIS NEEDS A BARRIER RATHER THAN A GLANCE. listingPriceString() deliberately returns an
// ENGLISH base string ("SAR 750,000") and tPrice() localises it at render time by string
// replacement. That split is easy to break in a way nothing else notices:
//   · add a new price shape (a suffix, a prefix, a range) and tPrice has no rule for it, so the
//     bare English leaks onto an Arabic-only card — this exact class already shipped once and was
//     fixed by hand ("Price on request" reached Arabic cards untranslated, ~2,600 live rows, see
//     tPrice's own RC-G comment);
//   · or localise the DIGITS too, which the owner explicitly does not want (٧٥٠٬٠٠٠).
// The 2026-09-03 derived-total work added a NEW shape — the "≈ " prefix — so this pins it.
//
// EXECUTED, NOT GREPPED. Both real shipped functions run: listingPriceString from
// src/data/listings.ts (imported directly), and tPrice from src/i18n.tsx, whose body is extracted
// and evaluated because that file is JSX and cannot be imported under node --experimental-strip-
// types. Extracting and RUNNING the real body is the repo rule (never assert against a re-typed
// copy — scripts/verify-af-independent-oracle.ts uses the same technique).
//
// MUTATION-PROVEN (each fails this barrier):
//   M1 drop the .replace('SAR','ر.س') from tPrice        -> Latin "SAR" leaks, check A fails
//   M2 localise digits (toLocaleString('ar-EG'))          -> Arabic-Indic digits, check B fails
//   M3 delete the '≈ ' prefix from listingPriceString     -> derived indistinguishable, check C fails
//   M4 remove the «محتسب» note from the AR dictionary     -> check D fails
//
//   node --experimental-strip-types scripts/verify-arabic-only-price-rendering.ts  (in `npm test`)

import { readFileSync } from 'node:fs';
import { derivedTotalFromPerMeter, listingPriceString } from '../src/data/listings.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

const i18nSrc = readFileSync(new URL('../src/i18n.tsx', import.meta.url), 'utf8');

// ── Extract and EXECUTE the real tPrice ─────────────────────────────────────────────────────────
const start = i18nSrc.indexOf('export function tPrice(');
check('tPrice located in src/i18n.tsx', start >= 0);
const body = i18nSrc.slice(start, i18nSrc.indexOf('\n}\n', start) + 3)
  .replace('export function tPrice(', 'function tPrice(')
  .replace(/loc: Locale = _locale/, "loc = 'ar'")
  .replace(/: string/g, '');
// eslint-disable-next-line no-new-func
const tPrice = new Function(`${body}; return tPrice;`)() as (p: string, loc?: string) => string;

const ARABIC_INDIC = /[٠-٩۰-۹]/;      // ٠-٩ — must NEVER appear
const LATIN_WORD = /[A-Za-z]{2,}/;                        // "SAR", "Price on request", …

// ── A. Every price shape renders with Arabic currency, no Latin words ───────────────────────────
const SHAPES: Array<[string, string]> = [
  ['derived total',    listingPriceString('Buy', null, null, null, 1500, 500)],
  ['derived (odd)',    listingPriceString('Buy', null, null, null, 1500, 511)],
  ['source total',     listingPriceString('Buy', null, null, 1400000)],
  ['annual rent',      listingPriceString('Rent', 'annual', 45000, null)],
  ['monthly rent',     listingPriceString('Rent', 'monthly', 60000, null)],
  ['no price at all',  listingPriceString('Buy', null, null, null)],
];
for (const [label, raw] of SHAPES) {
  const ar = tPrice(raw, 'ar');
  check(`A. ${label}: no Latin words survive localisation`, !LATIN_WORD.test(ar), `renders "${ar}"`);
  check(`B. ${label}: digits stay Western`, !ARABIC_INDIC.test(ar), `renders "${ar}"`);
}

// The two currency/period tokens must actually be translated, not merely absent.
check('A. currency reads ر.س', tPrice(listingPriceString('Buy', null, null, 1400000), 'ar').includes('ر.س'));
check('A. «Price on request» is Arabic',
  tPrice(listingPriceString('Buy', null, null, null), 'ar') === 'السعر عند الطلب');
check('A. monthly suffix is Arabic', tPrice(listingPriceString('Rent', 'monthly', 60000, null), 'ar').includes('شهرياً'));
check('A. annual suffix is Arabic', tPrice(listingPriceString('Rent', 'annual', 45000, null), 'ar').includes('سنوياً'));

// ── C. A DERIVED total is visibly marked, a published one is not ────────────────────────────────
const derivedAr = tPrice(listingPriceString('Buy', null, null, null, 1500, 500), 'ar');
const publishedAr = tPrice(listingPriceString('Buy', null, null, 750000), 'ar');
check('C. derived total carries the ≈ marker', derivedAr.startsWith('≈'), `got "${derivedAr}"`);
check('C. published total carries NO ≈ marker', !publishedAr.includes('≈'), `got "${publishedAr}"`);
check('C. both render the same amount', derivedAr.includes('750,000') && publishedAr.includes('750,000'),
  `${derivedAr} / ${publishedAr}`);

// ── D. The explicit calculated note exists in Arabic and names its inputs ───────────────────────
const NOTE_KEY = 'Calculated from price per m² × area — not published by the source';
const noteLine = i18nSrc.split('\n').find((l) => l.includes(NOTE_KEY));
check('D. the calculated note has an Arabic translation', Boolean(noteLine));
if (noteLine) {
  const ar = (noteLine.match(/:\s*'([^']+)'/) ?? [])[1] ?? '';
  check('D. the note is Arabic, not English', !LATIN_WORD.test(ar), ar);
  check('D. the note says it is calculated («محتسب»)', ar.includes('محتسب'), ar);
  check('D. the note says the source did not publish it', ar.includes('غير معلن'), ar);
}

// ── E. The guard rails behind the number the user reads ─────────────────────────────────────────
// A derived total may only exist for a sale with no published price, from real source values,
// within the credibility bound — the same four conditions the SQL column enforces.
check('E. rent never derives', derivedTotalFromPerMeter('Rent', null, null, 1500, 500) === null);
check('E. a published total wins', derivedTotalFromPerMeter('Buy', 900000, null, 1500, 500) === null);
check('E. a published rent wins', derivedTotalFromPerMeter('Buy', null, 50000, 1500, 500) === null);
check('E. no area ⇒ no derivation', derivedTotalFromPerMeter('Buy', null, null, 1500, null) === null);
check('E. area 0 ⇒ no derivation', derivedTotalFromPerMeter('Buy', null, null, 1500, 0) === null);
check('E. above the bound ⇒ UNKNOWN, never an absurd total',
  derivedTotalFromPerMeter('Buy', null, null, 1_000_000, 7_000_000) === null);
check('E. exactly at the bound is still derived',
  derivedTotalFromPerMeter('Buy', null, null, 1_000_000, 500) === 500_000_000);
// The real production rows this shipped for.
check('E. real row 1500/m² × 511 m² = 766,500',
  derivedTotalFromPerMeter('Buy', null, null, 1500, 511) === 766_500);

console.log(failed === 0
  ? '\n✅ prices read Arabic with Western digits, and a derived total is always marked as ours.'
  : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
