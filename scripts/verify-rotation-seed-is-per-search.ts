// ROTATION BELONGS TO THE SEARCH, NOT TO THE PAGE, AND NOT TO THE WEEK.
//
// Owner rule 2026-09-26: "I do a search, it shows عقار first. I refresh — the same exact one
// shouldn't show عقار first. It changes and shows another website." Plus: "عقار has so much in our
// database. Don't always show me the exact one."
//
// Two halves ship that rule and BOTH can regress silently:
//   · SQL — the rotation term now sits inside div_rank's per-platform window, so the seed decides
//     WHICH listing fronts a platform (before, it could only reorder platforms). Asserted against
//     the deployed function by the live sibling, verify-rotation-varies-the-listings-live.ts.
//   · CLIENT — this file. A fresh seed per SEARCH, held constant for every page of that search.
//
// THE TWO FAILURE MODES THIS EXISTS FOR, and why neither is hypothetical:
//   1. THE SEED STOPS CHANGING. Reverting to the device+week seed (or hoisting newSearchSeed() to
//      module scope so it is minted once per app load) makes a refresh return the identical list —
//      the exact complaint. It would look completely healthy: no error, no red test elsewhere.
//   2. THE SEED CHANGES *DURING* A WALK. If «عرض المزيد» mints its own seed — or simply omits it
//      and lets the RPC call site fall back — the server ORDER BY is recomputed between pages, so
//      page 2 is a different sequence: cards repeat, other cards are skipped, and the closing
//      count line lies about what was shown. This is the more dangerous one, because more variety
//      is exactly what someone "fixing" rotation would be tempted to add.
//
// Hermetic by construction: executes the real seed functions and reads the real wiring; no network,
// no database, no browser. The live half asserts the served ORDER BY itself.
//
//   node --experimental-strip-types scripts/verify-rotation-seed-is-per-search.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newSearchSeed, rotationSeed } from '../src/lib/rotationSeed.ts';
import { stripComments } from './lib/stripComments.ts';

const root = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

console.log('\nRotation is per-SEARCH, and constant within one search (owner 2026-09-26)\n');

// ── 1. THE SEED ITSELF, EXECUTED ────────────────────────────────────────────────────────────────
const a = newSearchSeed();
const b = newSearchSeed();
const c = newSearchSeed();
check('newSearchSeed() returns a different value every call (a refresh cannot repeat a list)',
  a !== b && b !== c && a !== c, `${a} / ${b} / ${c}`);
check('newSearchSeed() returns a non-empty string (an empty seed would disable rotation server-side)',
  typeof a === 'string' && a.length > 0, JSON.stringify(a));
check('the seeds carry real entropy, not a counter that restarts at 0 on a fresh device',
  new Set([a, b, c].map((s) => s.length)).size === 1 && a.length >= 16, `len=${a.length}`);

// The device+week fallback must still be STABLE — it is what callers that pass no seed rely on,
// and a page of one walk must never differ from another page just because of it.
check('rotationSeed() (the fallback) is still stable across calls within a week',
  rotationSeed(new Date('2026-09-26T10:00:00Z')) === rotationSeed(new Date('2026-09-26T23:00:00Z')));
check('rotationSeed() still drifts across weeks (a long-lived device is not frozen forever)',
  rotationSeed(new Date('2026-09-26T10:00:00Z')) !== rotationSeed(new Date('2026-10-20T10:00:00Z')));

// ── 2. THE WIRING — minted once per search, reused by the pages ─────────────────────────────────
const store = stripComments(read('src/store.tsx'));
const remote = stripComments(read('src/data/remote.ts'));

check('store.tsx holds the search seed in a ref (survives between the search and its pages)',
  /searchSeedRef\s*=\s*useRef/.test(store));
check('a NEW search mints a NEW seed', /searchSeedRef\.current\s*=\s*newSearchSeed\(\)/.test(store));
check('the first page is fetched WITH that seed',
  /fetchListingsForQuery\(q,\s*\{[^}]*rotationSeed:\s*searchSeedRef\.current/.test(store));

// The load-more call site must pass the SAME ref and must NOT mint its own.
// Anchor on the IMPLEMENTATION (`loadMoreListings: async`), never on the bare property name — the
// context type declares `loadMoreListings:` hundreds of lines earlier, and slicing from there gave
// a span that contained no call at all, so every assertion below passed on an empty string.
const loadMoreStart = store.indexOf('loadMoreListings: async');
const loadMore = loadMoreStart === -1 ? '' : store.slice(loadMoreStart, store.indexOf('trackOpen:', loadMoreStart));
check('the load-more implementation was located (an empty span would make the checks below vacuous)',
  loadMoreStart !== -1 && loadMore.includes('fetchListingsForQuery'), `span=${loadMore.length} chars`);
// STRENGTHENED 2026-09-26 by ops_incident #796. This used to require the literal
// `rotationSeed: searchSeedRef.current` — i.e. it asserted that load-more reads the app-level slot,
// which is the very thing that let a CANCELLED search re-key a live walk (failure mode 2 in this
// file's own header, which this predicate could not actually see). The contract now: the seed comes
// from the paged SET, with the ref kept only as the pre-#796-transcript fallback. Executed — rather
// than matched — by scripts/verify-loadmore-pages-with-its-own-search-seed.ts.
check('«عرض المزيد» passes the seed of the SET it is paging, falling back to the search ref',
  /rotationSeed:\s*seed\s*\?\?\s*searchSeedRef\.current/.test(loadMore),
  'load-more does not thread the set\'s own seed — a later or cancelled search would re-key this walk');
check('«عرض المزيد» never mints its own seed (that is how paging repeats and skips cards)',
  !/newSearchSeed\(/.test(loadMore));

check('the RPC call site prefers the threaded seed and only falls back to device+week',
  /p_rotation_seed:\s*opts\?\.rotationSeed\s*\?\?\s*rotationSeed\(\)/.test(remote),
  'the call site no longer honours a caller-supplied seed — per-search rotation is dead');
check('fetchListingsForQuery accepts the seed in its options',
  /rotationSeed\?\:\s*string/.test(remote));

// ── 3. MUTATION PROOFS — each assertion above, fed the defect it exists to catch ────────────────
console.log('\n  mutation proofs\n');

// M1: the seed hoisted to module scope / reverted to the device+week constant → every search
// identical. Runs the REAL predicate from check #1 against a stub generator that behaves the way a
// reverted newSearchSeed() would.
{
  const frozenGenerator = () => 'device|2026-W39';
  const [x, y, z] = [frozenGenerator(), frozenGenerator(), frozenGenerator()];
  const predicatePasses = x !== y && y !== z && x !== z;   // the exact check #1 assertion
  mustCatch('a seed that never changes between searches (the frozen-refresh complaint)',
    !predicatePasses);
}
// M2: load-more minting its own seed.
{
  const mutant = loadMore.replace(/rotationSeed:\s*seed\s*\?\?\s*searchSeedRef\.current/, 'rotationSeed: newSearchSeed()');
  mustCatch('«عرض المزيد» minting a fresh seed mid-walk (cards repeat and vanish)',
    /newSearchSeed\(/.test(mutant));
}
// M3: load-more omitting the seed entirely (falls back to device+week → different order than page 1).
{
  const mutant = loadMore.replace(/,\s*rotationSeed:\s*seed\s*\?\?\s*searchSeedRef\.current/, '');
  mustCatch('«عرض المزيد» dropping the seed and inheriting the fallback instead',
    !/rotationSeed:\s*(?:seed\s*\?\?\s*)?searchSeedRef\.current/.test(mutant));
}
// M3b (#796): load-more reading the app-level slot ALONE — the shape this file used to require.
{
  const mutant = loadMore.replace(/rotationSeed:\s*seed\s*\?\?\s*searchSeedRef\.current/,
    'rotationSeed: searchSeedRef.current');
  mustCatch('«عرض المزيد» paging with the app\'s latest seed instead of the paged set\'s own',
    !/rotationSeed:\s*seed\s*\?\?\s*searchSeedRef\.current/.test(mutant));
}
// M4: the RPC call site ignoring the caller's seed.
{
  const mutant = remote.replace(/p_rotation_seed:\s*opts\?\.rotationSeed\s*\?\?\s*rotationSeed\(\)/,
    'p_rotation_seed: rotationSeed()');
  mustCatch('the call site ignoring the threaded seed (per-search rotation silently dead)',
    !/p_rotation_seed:\s*opts\?\.rotationSeed/.test(mutant));
}
// M5: runQuery not re-minting (seed minted once per app load, so a refresh repeats).
{
  const mutant = store.replace(/searchSeedRef\.current\s*=\s*newSearchSeed\(\)/, '');
  mustCatch('a search that reuses the previous search\'s seed',
    !/searchSeedRef\.current\s*=\s*newSearchSeed\(\)/.test(mutant));
}
// M6: the real files are NOT flagged — the proofs above are not vacuously true.
mustCatch('nothing — the shipped wiring still passes every predicate above',
  /rotationSeed:\s*seed\s*\?\?\s*searchSeedRef\.current/.test(loadMore)
  && /searchSeedRef\.current\s*=\s*newSearchSeed\(\)/.test(store)
  && /p_rotation_seed:\s*opts\?\.rotationSeed\s*\?\?\s*rotationSeed\(\)/.test(remote));

console.log(failed === 0
  ? '\n✅ rotation is minted per search and held constant across that search\'s pages.'
  : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
