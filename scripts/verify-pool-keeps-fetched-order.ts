// PERMANENT BARRIER — the pool the search engine draws from keeps the FETCHED order, so the first
// screen is one card per platform (owner rule: "it must be one of each of the platforms", 2026-09-04).
//
// THE BUG THIS PINS. The RPC returns candidates in a platform round-robin (row 1..N = N distinct
// platforms, then the second row of each, …) and remote.ts preserves it. runSearch() then draws its
// rows through pickPool(), a mock-era bucketing layer (villa / apartment / land / budget / mixRent /
// mixBuy / room). Each bucket keeps relative order, but pickPool SPLICED buckets for two query shapes:
//   · شراء+إيجار (dealCombined / bothDeals)  → [...mixRent, ...mixBuy]  — every Rent row before every Buy
//   · a chosen type / group                   → every bucket in turn     — villa first, then apartment…
// Live 2026-09-04, الرياض + شراء + إيجار: the RPC's first 21 were 20 platforms with 14 Buy rows; the
// screen showed 21 RENTALS cycling through ~10 rent-capable platforms, and the 9 Buy-only platforms
// (wasalt, dealapp, aldarim, sadin, muktamel, nowaisiry, fursaghyr, alhoshan, rawasidark) never
// appeared at all. The fix: Pools carries `all` (every row, fetched order) and any multi-bucket read
// returns it — never a splice.
//
// EXECUTED, NOT GREPPED: the real buildPools() is imported; the real pickPool() is lifted out of
// src/data/search.ts (extension-less imports block a direct import — same technique as
// verify-combined-deal-budget-split.ts); the real distinctPlatformCount()/initialReveal() decide the
// first-screen size exactly as agent.tsx does. The fixture is the RPC's real output SHAPE: the exact
// 20-platform / deal sequence the production RPC returned for the owner's search, repeated.
//
// MUTATION-PROVEN (each fails this barrier):
//   M1 pickPool combined branch back to [...pools.mixRent, ...pools.mixBuy]  → A + B fail
//   M2 pickPool type branch back to "walk every bucket" (villa, apartment…) → C fails
//   M3 buildPools stores `all` REVERSED / re-sorted by id                   → A, C, D fail
//
//   node --experimental-strip-types scripts/verify-pool-keeps-fetched-order.ts   (in `npm test`)

import { buildPools, type Listing } from '../src/data/listings.ts';
import { distinctPlatformCount, platformIdentity } from '../src/lib/platformDiversity.ts';
import { initialReveal } from '../src/lib/initialReveal.ts';
import { liftSymbols } from './lib/liftSymbols.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

const lifted = await liftSymbols(
  new URL('../src/data/search.ts', import.meta.url).pathname,
  [{ header: 'function pickPool(' }],
  ['pickPool'],
  // effectiveGroups carries no logic for these fixtures (no group is ever set).
  'type SearchQuery = any; type Listing = any; type Pools = any; const effectiveGroups = (_q: any) => [];',
);
const pickPool = lifted.pickPool as (q: unknown, pools: unknown) => Listing[];

// ── Fixture: the production RPC's real first-21 for الرياض + شراء + إيجار (2026-09-04), cycled ──────
const RPC_CYCLE: Array<[string, 'Rent' | 'Buy']> = [
  ['therc', 'Rent'], ['aqarmonthly', 'Rent'], ['aqargate', 'Buy'], ['dealapp', 'Rent'], ['sanadak', 'Buy'],
  ['aqar', 'Buy'], ['muktamel', 'Buy'], ['aldarim', 'Buy'], ['gathern', 'Rent'], ['wasalt', 'Buy'],
  ['aqaratikom', 'Buy'], ['satel', 'Rent'], ['sadin', 'Buy'], ['aqarcity', 'Buy'], ['raghdan', 'Buy'],
  ['mizlaj', 'Rent'], ['nowaisiry', 'Buy'], ['souq24', 'Rent'], ['alhoshan', 'Buy'], ['fursaghyr', 'Buy'],
];
function rows(types: string[], cycles = 3): Listing[] {
  const out: Listing[] = [];
  for (let c = 0; c < cycles; c++) {
    RPC_CYCLE.forEach(([source, deal], i) => out.push({
      id: c * 100 + i + 1, source, deal, type: types[(c * RPC_CYCLE.length + i) % types.length],
      price: deal === 'Rent' ? 'SAR 45,000/year' : 'SAR 900,000', listed: 'today',
    } as unknown as Listing));
  }
  return out;
}
const ids = (l: Listing[]) => l.map((r) => r.id).join(',');
// Exactly agent.tsx's call: floor 10, widened to the distinct matching platforms, capped by fetched.
const firstScreen = (drawn: Listing[]) =>
  drawn.slice(0, initialReveal({ fetched: drawn.length, honestTotal: 63_653, firstPage: 10, stopAt: 100,
    platforms: distinctPlatformCount(drawn) }));

// ── A. شراء+إيجار: the pool IS the fetched order, so the first screen is one card per platform ───
{
  const fetched = rows(['Apartment']);
  const drawn = pickPool({ deal: 'Rent', dealCombined: true, priceInput: '' }, buildPools(fetched));
  check('A. combined: pool keeps the fetched order exactly', ids(drawn) === ids(fetched),
    `got ${ids(drawn).slice(0, 80)}…`);
  const screen = firstScreen(drawn);
  const distinct = new Set(screen.map((r) => platformIdentity(r.source))).size;
  check(`A. combined: first screen (${screen.length}) is one per platform`, distinct === screen.length,
    `${distinct} distinct in ${screen.length}`);
  check('A. combined: first screen shows Buy AND Rent', screen.some((r) => r.deal === 'Buy') && screen.some((r) => r.deal === 'Rent'));
}

// ── B. bothDeals (agent could not tell rent from buy) takes the same path ──────────────────────────
{
  const fetched = rows(['Apartment']);
  const drawn = pickPool({ deal: 'Rent', bothDeals: true, priceInput: '' }, buildPools(fetched));
  check('B. bothDeals: pool keeps the fetched order exactly', ids(drawn) === ids(fetched));
}

// ── C. A chosen type reads the WHOLE fetched set in fetched order — never bucket by bucket ─────────
{
  // Types alternate so villa / apartment / land buckets are all populated: a bucket walk would put
  // every villa first.
  const fetched = rows(['Villa', 'Apartment', 'Residential Land']);
  const drawn = pickPool({ deal: 'Buy', type: 'Villa', priceInput: '' }, buildPools(fetched));
  check('C. typed: pool keeps the fetched order exactly', ids(drawn) === ids(fetched),
    `got ${ids(drawn).slice(0, 80)}…`);
}

// ── D. A single-deal search is a SUBSET in fetched order ──────────────────────────────────────────
{
  const fetched = rows(['Apartment']);
  const drawn = pickPool({ deal: 'Buy', priceInput: '' }, buildPools(fetched));
  const expected = fetched.filter((r) => r.deal === 'Buy');
  check('D. Buy-only: pool is the Buy rows in fetched order', ids(drawn) === ids(expected));
  check('D. Buy-only: no Rent row leaks in', drawn.every((r) => r.deal === 'Buy'));
}

// ── E. buildPools.all is every row, in order, aliasing nothing it should not ──────────────────────
{
  const fetched = rows(['Apartment', 'Villa']);
  const pools = buildPools(fetched);
  check('E. all = every fetched row in fetched order', ids(pools.all) === ids(fetched));
  check('E. mixRent ∪ mixBuy = all (nothing dropped by the buckets)',
    pools.mixRent.length + pools.mixBuy.length === pools.all.length);
}

console.log(failed === 0
  ? '\n✅ the search pool keeps the fetched order — the first screen stays one card per platform.'
  : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
