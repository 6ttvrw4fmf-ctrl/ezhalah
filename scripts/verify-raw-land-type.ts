// «أرض خام» (Raw Land) — the two halves of one selection must never be confused (owner 2026-10-09).
//
// The SERVER half sends the TAG token 'أرض خام' in p_types (af_eligibility_clause matches it against
// search_listings_ar.unit_subtype_ar). The CARD half re-reads the chosen ids from the raw tables by
// property_type — where no row is stored as «أرض خام», because a raw land keeps its own source type.
// Live 2026-10-10 on production: Riyadh / حي بنبان counted 167 and returned 0, because the card fetch
// asked the raw tables for property_type = 'أرض خام'. This executes both halves and proves each.
//
//   node --experimental-strip-types scripts/verify-raw-land-type.ts   (in `npm test`)
import {
  CLEAN_TO_QUERY, RAW_LAND_TOKEN, RAW_LAND_CARRIER_TYPES, storedRawTypes, typeArForTypes, groupMembers,
} from '../src/data/propertyTypes.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};

const raw = CLEAN_TO_QUERY['Raw Land']?.rawTypes ?? [];
const stored = storedRawTypes(raw);
const carriers = RAW_LAND_CARRIER_TYPES.flatMap((t) => CLEAN_TO_QUERY[t].rawTypes);

check('the server token for the box is exactly «أرض خام»', JSON.stringify(typeArForTypes(['Raw Land'])) === JSON.stringify([RAW_LAND_TOKEN]),
  `typeArForTypes(['Raw Land']) = ${JSON.stringify(typeArForTypes(['Raw Land']))}`);
check('the card fetch never asks the raw tables for the token itself', !stored.includes(RAW_LAND_TOKEN), JSON.stringify(stored));
check('the card fetch asks for every land type a raw row can carry', carriers.every((c) => stored.includes(c)), JSON.stringify(stored));
check('a selection without the token is passed through untouched',
  JSON.stringify(storedRawTypes(CLEAN_TO_QUERY['Commercial Land'].rawTypes)) === JSON.stringify(CLEAN_TO_QUERY['Commercial Land'].rawTypes));
check('«أرض خام» + «أرض تجارية» keeps commercial land and adds the carriers, deduped',
  (() => { const u = storedRawTypes([...CLEAN_TO_QUERY['Commercial Land'].rawTypes, RAW_LAND_TOKEN]); return u.includes('Commercial Land') && new Set(u).size === u.length && !u.includes(RAW_LAND_TOKEN); })());
check('the box is offered in the commercial land group (owner placement)', groupMembers('Commercial & Industrial Plots').includes('Raw Land'));

// The predicate both checks above encode, applied to any candidate mapping.
const cardFetchIsRight = (fn: (r: string[]) => string[]): boolean => {
  const out = fn(raw);
  return !out.includes(RAW_LAND_TOKEN) && carriers.every((c) => out.includes(c));
};
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);
check('the shipped storedRawTypes satisfies the predicate', cardFetchIsRight(storedRawTypes));
mustCatch('an identity mapping (the 2026-10-10 bug: property_type IN («أرض خام»)) is caught', !cardFetchIsRight((r) => r));
mustCatch('a mapping that drops the token but forgets Agriculture Plot is caught',
  !cardFetchIsRight((r) => storedRawTypes(r).filter((x) => x !== 'Agriculture Plot')));

console.log(failed ? `\n✗ ${failed} assertion(s) FAILED` : '\n✓ verify-raw-land-type: the server token and the card fetch agree');
process.exit(failed ? 1 : 0);
