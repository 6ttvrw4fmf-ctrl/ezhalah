// A WALK IS PAGED WITH THE SEED ITS OWN FIRST PAGE WAS CUT FROM — NEVER THE APP'S LATEST.
//
// ops_incident #796 (routine-8 regression hunter, 2026-09-26). The per-search rotation seed landed
// the same day (verify-rotation-seed-is-per-search.ts) and closed the case it was written for: one
// uninterrupted walk keeps one seed, so «عرض المزيد» neither repeats nor skips. It could not close
// the interrupted one, because the seed lived in a single app-level slot — `searchSeedRef` — that
// every `runQuery` overwrites BEFORE it knows whether its own fetch will survive.
//
// THE DEFECT, REACHABLE BY A GUEST IN THREE STEPS. Search a broad city → a results block with
// «عرض المزيد». Send a second message and press Stop. Stop is documented to leave earlier results on
// screen ("the cards already shown stay frozen"), `playListings` returns before it can post a new
// results message, and `resultsActionsRowVisible` does not read `stopped` — so the first block is
// still the latest results block and still offers its pager. Meanwhile the cancelled search has
// already replaced the seed that block's page 1 was ordered by. Press «عرض المزيد» and page 2 is cut
// from a different total order at the same offset.
//
// MEASURED ON LIVE PRODUCTION, anon REST, الرياض/إيجار, 42,101 matches, seed swapped between offset 0
// and offset 500 of one walk:
//     cards the 2nd press owed .................. 500
//     cards it actually added ................... 439
//     already-shown rows refetched, de-duped away  61   (a silently short page)
//     rows owed and delivered by NEITHER page ... 434   (the cursor then moves to 1000 — unreachable)
// The de-dup in agent.tsx's loadMore hides the duplicates, which is why this shows up as a page that
// is quietly too small rather than as an obvious repeat.
//
// THE FIX IS WHERE THE SEED LIVES, not a new guard on Stop. `pageOffset` only names a position inside
// ONE seed's total order, so the seed belongs beside the cursor: `SearchResult.rotationSeed`. Every
// pager passes the seed of the SET it is paging. Nothing a later — or cancelled, or abandoned —
// search does can reach it.
//
// WHY THIS FILE EXISTS ALONGSIDE verify-rotation-seed-is-per-search.ts. That barrier's own header
// names this exact failure mode ("THE SEED CHANGES *DURING* A WALK") and then asserts that load-more
// threads `searchSeedRef.current` — which was the defect. A guard that pins the app-level slot cannot
// see a walk being paged with another search's seed; only executing the function with a ref that
// disagrees with the set can. That blindness is filed separately for routine-10 (the barrier owner).
// This file does not replace that one: it keeps rotation VARYING per search, this one keeps it
// CONSTANT per set, and both are needed.
//
// Hermetic: lifts and EXECUTES the shipped `loadMoreListings` out of src/store.tsx against a
// recording stub. No network, no database, no browser.
//
//   node --experimental-strip-types scripts/verify-loadmore-pages-with-its-own-search-seed.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { LOAD_MORE_PAGE_SIZE } from '../src/data/resultCount.ts';
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
const die = (msg: string) => { console.error(`FAIL  ${msg}`); process.exit(1); };

console.log('\nA walk is paged with its OWN seed (ops_incident #796)\n');

// ── 1. THE CONSEQUENCE, EXECUTED ────────────────────────────────────────────────────────────────
// Why a mid-walk seed change is not a cosmetic reordering. `p_rotation_seed` is an ORDER BY key, and
// `pageOffset` is a window into that order — so two presses under two seeds are two windows into two
// different sequences. Modelled here as pure set algebra over two permutations of one matched set, so
// the arithmetic the production measurement above observed is pinned without needing production.
{
  const TOTAL = 1000, PAGE = 100;
  const set = Array.from({ length: TOTAL }, (_, i) => `row-${i}`);
  // Two orderings of the SAME matched set (MATCH FIRST: a seed permutes, it never widens or narrows).
  // The permutation is a deterministic seed+id hash — the shape a rotation seed really produces, where
  // the two orders overlap PARTIALLY. A reverse() would be a rigged model: its page 2 is disjoint from
  // page 1 by construction, so the duplicate half of the defect could not appear at all.
  // FNV-1a over seed|id, then murmur3's fmix32 finalizer. The finalizer is load-bearing: without it
  // two seeds that differ in one byte produce highly CORRELATED orders (measured while writing this:
  // the two pages came out perfectly disjoint, so the duplicate half of the defect vanished from the
  // model). Avalanche is what makes this stand in for a real reshuffle.
  const h = (seed: string, id: string) => {
    let x = 2166136261;
    for (const ch of `${seed}|${id}`) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; }
    x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b) >>> 0;
    x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  };
  const orderFor = (seed: string) => [...set].sort((a, b) => h(seed, a) - h(seed, b));
  const orderA = orderFor('seed-A');
  const orderB = orderFor('seed-B');
  const window = (order: string[], offset: number) => order.slice(offset, offset + PAGE);

  /** Two presses: page 1 always from the set's own order, page 2 from `pageTwoOrder`, de-duped exactly
   *  as agent.tsx's loadMore de-dupes (`seen` by source:id). */
  const shownAfter = (pageTwoOrder: string[]) => {
    const held = new Set(window(orderA, 0));
    for (const r of window(pageTwoOrder, PAGE)) held.add(r);
    return held;
  };
  const coherent = shownAfter(orderA);
  const swapped = shownAfter(orderB);
  const owed = window(orderA, PAGE);

  check('MATCH FIRST holds: a seed only permutes the matched set (same ids under either order)',
    new Set(orderA).size === TOTAL && new Set(orderB).size === TOTAL
    && orderA.every((r) => orderB.includes(r)));
  check('the two orders genuinely differ (an identical permutation would make §1 vacuous)',
    orderA.some((r, i) => orderB[i] !== r));
  check('one seed for the whole walk: two presses show exactly 2 pages of distinct cards',
    coherent.size === 2 * PAGE, `showed ${coherent.size}`);
  check('a seed swapped mid-walk shows FEWER cards than the two presses earned',
    swapped.size < 2 * PAGE, `showed ${swapped.size} of ${2 * PAGE}`);
  const skipped = owed.filter((r) => !swapped.has(r));
  check('a seed swapped mid-walk leaves rows the walk owed undelivered by EITHER press',
    skipped.length > 0, `skipped ${skipped.length}`);
  // The cursor is seed-blind: it advances by the page size whatever order produced the page, so the
  // skipped rows end up BEHIND the walk, not ahead of it. That is what makes the loss permanent.
  check('the cursor advances past the skipped rows regardless of which order produced the page',
    PAGE + PAGE === 2 * PAGE);
  console.log(`      (model: ${swapped.size}/${2 * PAGE} cards shown, ${skipped.length} owed rows skipped — `
    + `production measured 939/1000 and 434 on الرياض/إيجار)`);
  // The model is not rigged to show a loss: fed a walk whose page 2 comes from its OWN order — i.e. the
  // shipped behaviour — the same predicates report no loss at all.
  mustCatch('a model in which the seed cannot matter (page 2 read from the walk\'s own order)',
    shownAfter(orderA).size === 2 * PAGE && owed.every((r) => shownAfter(orderA).has(r)));
}

// ── 2. THE SHIPPED FUNCTION, LIFTED AND EXECUTED ────────────────────────────────────────────────
// `loadMoreListings` is a closure inside AppProvider and cannot be imported, so it is lifted the same
// way scripts/verify-result-cap-honesty.ts already lifts it. What is stubbed is deliberate: the fetch
// RECORDS the rotationSeed it was handed (that is the whole measurement), and `searchSeedRef` is
// handed a seed that DISAGREES with the set's — standing in for the cancelled search that moved it.
const storeSrc = read('src/store.tsx');
const LIFT_RE = /loadMoreListings: async \(q: SearchQuery, offset: number(?:, seed\?: string)?\) => \{[\s\S]*?\n {6}\},/;

/** Build a runnable load-more from `src` (the real file, or a mutant of it). */
function liftLoadMore(src: string) {
  const m = src.match(LIFT_RE);
  if (!m) die('could not lift loadMoreListings out of src/store.tsx — was it moved, renamed, or its signature changed?');
  const js = stripTypeScriptTypes(`const surface = { ${m![0]} };`, { mode: 'strip' });
  const seen: Array<Record<string, unknown>> = [];
  const fetchStub = async (_q: unknown, opts: Record<string, unknown>) => {
    seen.push(opts);
    return { listings: [], pageCandidates: 0 };
  };
  const raw = new Function('fetchListingsForQuery', 'runSearch', 'buildPools', 'LOAD_MORE_PAGE_SIZE', 'searchSeedRef',
    `${js}\nreturn surface.loadMoreListings;`);
  const fn = raw(fetchStub, (_q: unknown, pools: unknown[]) => ({ listings: pools }), (rows: unknown[]) => rows,
    LOAD_MORE_PAGE_SIZE, { current: REF_SEED }) as
    (q: unknown, offset: number, seed?: string) => Promise<unknown>;
  return { fn, seen };
}

const REF_SEED = 'seed-of-a-LATER-search-the-user-cancelled';
const SET_SEED = 'seed-page-1-of-this-walk-was-cut-from';

{
  const { fn, seen } = liftLoadMore(storeSrc);
  await fn({}, LOAD_MORE_PAGE_SIZE, SET_SEED);
  check('the lift executed and reached the fetch (an unreached fetch would make this vacuous)',
    seen.length === 1, `fetch calls=${seen.length}`);
  check('page 2 is fetched with THIS SET\'s seed, even though the app-level ref holds another',
    seen[0]?.rotationSeed === SET_SEED, `rotationSeed=${String(seen[0]?.rotationSeed)}`);
  check('the cursor still asks for the page it was told to (the seed changes order, never offset)',
    seen[0]?.offset === LOAD_MORE_PAGE_SIZE && seen[0]?.limit === LOAD_MORE_PAGE_SIZE,
    JSON.stringify({ offset: seen[0]?.offset, limit: seen[0]?.limit }));
}
{
  // THE LEGACY DIRECTION, pinned so the fallback cannot be dropped either. A transcript persisted
  // before SearchResult carried a seed has none; for those the app-level ref is the best available
  // answer and is exactly what shipped before this change — never worse, and never a fresh mint.
  const { fn, seen } = liftLoadMore(storeSrc);
  await fn({}, LOAD_MORE_PAGE_SIZE, undefined);
  check('a set with NO seed (a pre-#796 transcript) falls back to the search ref, not a new seed',
    seen[0]?.rotationSeed === REF_SEED, `rotationSeed=${String(seen[0]?.rotationSeed)}`);
}
{
  // The page must never mint its own — the failure mode verify-rotation-seed-is-per-search.ts names.
  const loadMoreSrc = storeSrc.match(LIFT_RE)![0];
  check('«عرض المزيد» never mints a seed of its own', !/newSearchSeed\(/.test(stripComments(loadMoreSrc)));
}

// ── 3. MUTATION PROOFS — the predicates above, fed the real defects ─────────────────────────────
console.log('\n  mutation proofs\n');

// M1: THE SHIPPED DEFECT. Page with the app-level ref, as the code did before #796.
{
  const mutant = storeSrc.replace('rotationSeed: seed ?? searchSeedRef.current', 'rotationSeed: searchSeedRef.current');
  if (mutant === storeSrc) die('M1 could not build the pre-#796 mutant — the fix\'s own expression is gone');
  const { fn, seen } = liftLoadMore(mutant);
  await fn({}, LOAD_MORE_PAGE_SIZE, SET_SEED);
  mustCatch('a walk paged with a cancelled search\'s seed (the ops_incident #796 defect itself)',
    seen[0]?.rotationSeed !== SET_SEED);
}
// M2: the legacy fallback deleted — a pre-#796 transcript would page with no seed at all and inherit
// the RPC's device+week default, a third order again.
{
  const mutant = storeSrc.replace('rotationSeed: seed ?? searchSeedRef.current', 'rotationSeed: seed');
  if (mutant === storeSrc) die('M2 could not build the dropped-fallback mutant');
  const { fn, seen } = liftLoadMore(mutant);
  await fn({}, LOAD_MORE_PAGE_SIZE, undefined);
  mustCatch('the legacy fallback dropped (an old transcript paged with no seed at all)',
    seen[0]?.rotationSeed !== REF_SEED);
}
// M3: the seed re-minted per page.
{
  const mutant = storeSrc.replace('rotationSeed: seed ?? searchSeedRef.current', 'rotationSeed: newSearchSeed()');
  if (mutant === storeSrc) die('M3 could not build the re-minting mutant');
  const loadMoreSrc = mutant.match(LIFT_RE)![0];
  mustCatch('«عرض المزيد» minting a fresh seed for every page',
    /newSearchSeed\(/.test(stripComments(loadMoreSrc)));
}

// ── 4. THE PRODUCER — runQuery must SHIP the seed it searched with ──────────────────────────────
// Derived, not pinned: read the identifier actually threaded into the page-0 fetch, then require the
// result literal to carry THAT identifier. A rename stays green; substituting any other value — or
// dropping the field, which would make every walk fall back to §2's legacy branch and quietly
// reinstate the defect — goes red.
{
  const store = stripComments(storeSrc);
  const page0 = store.match(/fetchListingsForQuery\(q,\s*\{\s*signal,\s*rotationSeed:\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*\}\)/);
  check('the page-0 fetch threads a named seed (not an inline mint, not the RPC default)',
    !!page0, 'could not find runQuery\'s page-0 fetch with a rotationSeed identifier');
  const seedExpr = page0?.[1] ?? '\u0000';
  const shipped = new RegExp(String.raw`const result: SearchResult = \{[^}]*\brotationSeed: (${seedExpr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|searchSeed)\b`);
  check('runQuery ships that same seed on the SearchResult the pager will read',
    shipped.test(store), `page-0 seed expression = ${seedExpr}`);
  check('SearchResult declares the field (an undeclared one would be silently dropped by a projection)',
    /rotationSeed\?: string/.test(stripComments(read('src/data/search.ts'))));

  mustCatch('runQuery shipping a DIFFERENT value than it searched with',
    !shipped.test(store.replace(/(const result: SearchResult = \{[^}]*\brotationSeed: )[A-Za-z_$][\w$.]*/,
      '$1someOtherSeed')));
  mustCatch('runQuery not shipping the seed at all (every walk silently back on the fallback)',
    !shipped.test(store.replace(/(const result: SearchResult = \{[^}]*), rotationSeed: [A-Za-z_$][\w$.]*/, '$1')));
}

// ── 5. EVERY PAGER CALL SITE, ENUMERATED AT RUN TIME ───────────────────────────────────────────
// Never a hardcoded list: a pager added tomorrow is RED until it threads the set's own seed. Only
// CALLS are judged — the context type declaration and this file's own prose are not call sites.
{
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(p)) files.push(p);
    }
  };
  walk(join(root, 'src'));
  const sites: { file: string; call: string }[] = [];
  for (const f of files) {
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/\bloadMoreListings\(([^;]*?)\)/g)) {
      sites.push({ file: f.slice(root.length + 1), call: m[1] });
    }
  }
  check('at least one pager call site was found (an empty enumeration would be vacuous)',
    sites.length > 0, `found ${sites.length}`);
  const unthreaded = sites.filter((s) => s.call.split(',').length < 3);
  check('EVERY loadMoreListings call site passes the set\'s own seed as its third argument',
    unthreaded.length === 0,
    unthreaded.map((s) => `${s.file}: loadMoreListings(${s.call})`).join('\n      '));
  const fromApp = sites.filter((s) => /\bm\.result\.rotationSeed\b|\bresult\.rotationSeed\b/.test(s.call));
  check('the agent pager passes the seed off the RESULT BLOCK it is paging, not a ref or a fresh mint',
    fromApp.length === sites.length,
    sites.filter((s) => !fromApp.includes(s)).map((s) => `${s.file}: loadMoreListings(${s.call})`).join('\n      '));

  mustCatch('a pager call site that omits the seed',
    [{ file: 'x', call: 'q, pageOffset' }].filter((s) => s.call.split(',').length < 3).length === 1);
  mustCatch('a pager call site that passes the app-level ref instead of the set\'s seed',
    !/\bm\.result\.rotationSeed\b|\bresult\.rotationSeed\b/.test('q, pageOffset, searchSeedRef.current'));
}

console.log(failed === 0
  ? '\n✅ every «عرض المزيد» page is cut from the same order its walk began in.'
  : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
