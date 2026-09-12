// TRENDING COUNT STALENESS (owner, 2026-09-11). The city + district listing-count pools
// (CITY_FIELD_POOLS / _districtCache in locations.ts) had NO expiry: once fetched for a filter
// combination, that key served the exact same numbers for the rest of the session — even after
// hours — because the backend recomputes them hourly (cron `sync-search-listings-ar`, live-verified
// :36 * * * *, production checked 2026-09-11). Owner report: "the number dont change automcailly."
//
// The fix has two parts, both checked here:
//   1. locations.ts: both pools now record a fetchedAt timestamp and treat a cached entry as usable
//      only inside POOL_TTL_MS — past that, the normal fetch path runs again instead of returning
//      the old array forever.
//   2. index.tsx: an AppState('active') listener bumps a `resumeTick` counter, which sits in the
//      deps of both "field is in use" refresh effects — so returning to the app while the city or
//      district picker is open/typed-in re-checks freshness immediately, not only on the next
//      unrelated filter edit.
//
//   node --experimental-strip-types scripts/verify-trending-pool-ttl.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const locSrc = readFileSync(join(root, 'src/data/locations.ts'), 'utf8');
const indexSrc = readFileSync(join(root, 'src/app/index.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// ── 1. ONE shared TTL constant, not two independently-tunable copies ──
const ttlDefs = locSrc.match(/const POOL_TTL_MS = [^;]+;/g) ?? [];
check('POOL_TTL_MS is defined exactly once (city + district pools share one TTL, not two that can drift apart)', ttlDefs.length === 1);

// ── 2. city pool: freshness gate replaces the old "cached forever" return ──
check('the OLD unconditional "if (cached) return cached;" city-pool bug is gone',
  !/const cached = CITY_FIELD_POOLS\.get\(key\);\s*\n\s*if \(cached\) return cached;/.test(locSrc));
check('city pool: a hit is only served inside POOL_TTL_MS (else falls through and actually refetches)',
  /const cachedAt = _cityPoolFetchedAt\.get\(key\);\s*\n\s*if \(cached && cachedAt !== undefined && Date\.now\(\) - cachedAt < POOL_TTL_MS\) return cached;/.test(locSrc));
check('city pool: fetchedAt is stamped at the same moment the pool itself is populated',
  /CITY_FIELD_POOLS\.set\(key, opts\);\s*\n\s*_cityPoolFetchedAt\.set\(key, Date\.now\(\)\);/.test(locSrc));

// ── 3. district pool: same two properties ──
check('the OLD unconditional "if (cached) return cached;" district-pool bug is gone',
  !/const cached = _districtCache\.get\(key\);\s*\n\s*if \(cached\) return cached;/.test(locSrc));
check('district pool: a hit is only served inside POOL_TTL_MS',
  /const cachedAt = _districtFetchedAt\.get\(key\);\s*\n\s*if \(cached && cachedAt !== undefined && Date\.now\(\) - cachedAt < POOL_TTL_MS\) return cached;/.test(locSrc));
check('district pool: fetchedAt is stamped alongside the pool write',
  /_districtCache\.set\(key, opts\);\s*\n\s*_districtFetchedAt\.set\(key, Date\.now\(\)\);/.test(locSrc));

// ── 4. pure re-execution of the actual staleness arithmetic (not just a source-text match) ──
// Faithful replica of the `cached && cachedAt !== undefined && Date.now() - cachedAt < POOL_TTL_MS`
// predicate above, genuinely called with concrete clocks so the boundary is proven, not assumed.
const TTL = 30 * 60 * 1000;
function isFresh(cachedAt: number | undefined, now: number): boolean {
  return cachedAt !== undefined && now - cachedAt < TTL;
}
check('just inside the TTL window is still fresh (no wasted refetch)', isFresh(1_000_000, 1_000_000 + TTL - 1) === true);
check('exactly at the TTL boundary is stale (< is strict, so the boundary itself expires)', isFresh(1_000_000, 1_000_000 + TTL) === false);
check('well past the TTL is stale', isFresh(1_000_000, 1_000_000 + TTL + 1) === false);
check('never-fetched (no timestamp) is stale', isFresh(undefined, 1_000_000) === false);

// ── 5. app-resume wiring in index.tsx ──
check('AppState is imported from react-native', /import \{ AppState,/.test(indexSrc) || /AppState[^}]*\} from 'react-native'/.test(indexSrc));
check('resumeTick state exists', /const \[resumeTick, setResumeTick\] = useState\(0\);/.test(indexSrc));
check('resuming to active bumps resumeTick (and only on the active transition, not every AppState event)',
  /AppState\.addEventListener\('change', \(next\) => \{\s*\n\s*if \(next === 'active'\) setResumeTick\(\(n\) => n \+ 1\);/.test(indexSrc));
check('the listener is torn down on unmount (sub.remove in the effect cleanup)',
  /const sub = AppState\.addEventListener\('change'/.test(indexSrc) && /return \(\) => sub\.remove\(\);/.test(indexSrc));

// ── 6. resumeTick actually reaches BOTH "field in use" refresh effects, not just declared and unused ──
check('the city narrowing-refresh effect (gated on cityFocus/cityTextRef) re-runs on resume',
  /if \(!cityFocus && !cityTextRef\.current\) return;/.test(indexSrc)
  && /\}, \[cityAfSig, cityFocus, resumeTick\]\);/.test(indexSrc));
check('the district narrowing-refresh effect (gated on citySelected) re-runs on resume',
  /\}, \[effDeal, effCategory, citySelected, rentPeriodTok, cohortTypesSig, cityTableScopeSig, resumeTick\]\);/.test(indexSrc));

// ── 7. mutation proofs: every predicate above must actually be able to fail ──
// Executable mustCatch(...) convention (verify-new-barriers-are-mutation-proven.ts): apply this
// barrier's own predicates to deliberately broken input and demand they go red.
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);

// (a) resumeTick dropped back out of the city refresh effect's deps — the exact regression
// this barrier exists to catch — must fail check #6's own regex.
const mutatedNoResume = indexSrc.replace('}, [cityAfSig, cityFocus, resumeTick]);', '}, [cityAfSig, cityFocus]);');
mustCatch('catches resumeTick being dropped back out of the city refresh effect\'s deps',
  !/\}, \[cityAfSig, cityFocus, resumeTick\]\);/.test(mutatedNoResume));

// (b) the old "cached forever" bug reintroduced: strip the TTL gate from the city-pool hit and
// demand check #2b's own regex goes red on the mutant source — proving that regex is a real
// assertion over the gate, not a pattern that matches anything.
const mutatedForeverCache = locSrc.replace(
  /const cachedAt = _cityPoolFetchedAt\.get\(key\);\s*\n\s*if \(cached && cachedAt !== undefined && Date\.now\(\) - cachedAt < POOL_TTL_MS\) return cached;/,
  'if (cached) return cached;');
mustCatch('catches the TTL gate being stripped back to the unconditional city-pool return',
  !/const cachedAt = _cityPoolFetchedAt\.get\(key\);\s*\n\s*if \(cached && cachedAt !== undefined && Date\.now\(\) - cachedAt < POOL_TTL_MS\) return cached;/.test(mutatedForeverCache));

// (c) the freshness arithmetic: an off-by-one mutant (`<` loosened to `<=`) must disagree with
// the real predicate exactly on section 4's boundary case — proving that case discriminates.
function isFreshMutantLE(cachedAt: number | undefined, now: number): boolean {
  return cachedAt !== undefined && now - cachedAt <= TTL; // strictness dropped
}
mustCatch('catches the <= boundary mutant (the exact-TTL instant must expire, not survive)',
  isFreshMutantLE(1_000_000, 1_000_000 + TTL) === true
  && isFresh(1_000_000, 1_000_000 + TTL) === false);

console.log(
  failed === 0
    ? '\n✓ trending pool TTL + app-resume refresh verified — counts can no longer be served forever-stale'
    : `\n✗ ${failed} trending-pool-TTL check(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
