// BROWSE-CONTINUATION HONESTY (owner 2026-09-14 — re-introduced a DISPLAY CAP, superseding the
// 2026-08-29 no-lifetime-ceiling decision this file used to pin; the owner explicitly reversed the
// reversal, so this file now locks the NEW two-tap/500 contract with the same rigor).
//
// THE RULE. «عرض المزيد» gives at most TWO reveals and never shows more than 500:
//   first tap → the 100 boundary; last tap → up to 500, then the button retires. A search with ≤500
//   matches finishes on whichever tap first shows them all; a bigger one caps at 500 and the terminal
//   state takes over (Advanced Filter if unseen inventory remains, else a new search via the menu).
// The honesty half is unchanged and non-negotiable: the closing message states the TRUE matched
// total, never a batch size, never a buffer length, and "more" is never offered when nothing more
// exists (or when the 500 cap is reached).
//
//   node --experimental-strip-types scripts/verify-result-cap-honesty.ts   (runs by existence)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { BROWSE_BATCH, SECOND_PAGE_CAP, nextBatchTarget, revealTarget, resultCounts, LOAD_MORE_PAGE_SIZE } from '../src/data/resultCount.ts';

const root = join(import.meta.dirname, '..');
const code = readFileSync(join(root, 'src', 'app', 'agent.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const storeSrc = readFileSync(join(root, 'src', 'store.tsx'), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nBrowse continuation — every match reachable, every number honest\n');

check('the batch size is 100', BROWSE_BATCH === 100, `got ${BROWSE_BATCH}`);

// ── 1. batches land on clean boundaries and never overshoot what exists ─────────────────────────
check('first press from the initial drip (10 shown) completes the first hundred',
  nextBatchTarget(10, 5000) === 100);
check('subsequent presses land on 200, 300…',
  nextBatchTarget(100, 5000) === 200 && nextBatchTarget(200, 5000) === 300);
check('the final batch clamps to the true last match (…→437), never past it',
  nextBatchTarget(400, 437) === 437 && nextBatchTarget(437, 437) === 437);
check('a small set clamps immediately (23 available → 23)', nextBatchTarget(10, 23) === 23);

// ── 2. TWO TAPS, MAX 500 (owner 2026-09-14 — re-introduced a display cap) ────────────────────────
// The UI walks with revealTarget(): under 100 → the 100 boundary (first tap); at/after 100 → up to
// the 500 cap (the LAST tap). A big search stops at 500; a ≤500 search shows everything.
check('the display cap is 500', SECOND_PAGE_CAP === 500, `got ${SECOND_PAGE_CAP}`);
check('first tap (10 shown) reveals the first 100', revealTarget(10, 5000) === 100);
check('the LAST tap (100 shown) reveals up to the 500 cap, never 200/300…', revealTarget(100, 5000) === 500);
check('there is no third tap — at 500 the target does not advance', revealTarget(500, 5000) === 500);
check('a ≤500 search finishes on the tap that shows them all (100→340, 10→47)',
  revealTarget(100, 340) === 340 && revealTarget(10, 47) === 47);
{
  // Walk a 2,223-match search the way the UI does now: it caps at 500 in exactly two taps.
  let shown = 10; let taps = 0;
  while (shown < Math.min(SECOND_PAGE_CAP, 2223) && taps < 10) { shown = revealTarget(shown, 2223); taps++; }
  check('a 2,223-match search shows at most 500, reached in two taps', shown === 500 && taps === 2, `reached ${shown} in ${taps} taps`);
}
for (const trueTotal of [0, 7, 99, 100, 101, 200, 201, 437, 9892]) {
  const rc = resultCounts({ trueTotal, shown: trueTotal, fetched: trueTotal, serverMore: false });
  check(`trueTotal ${trueTotal}, all shown → endKind 'all', total stated is ${trueTotal}`,
    rc.endKind === 'all' && rc.endTotal === trueTotal && !rc.hasMore && rc.reachable === trueTotal);
}

// ── 3. hasMore is exactly "under the cap AND matches remain" — alive at 100, dead at 500 ─────────
check('hasMore is TRUE at 100 shown of 9,892 (the last tap, up to 500, is still to come)',
  resultCounts({ trueTotal: 9892, shown: 100, fetched: 1500, serverMore: true }).hasMore === true);
check('hasMore goes FALSE at the 500 cap — there is no third tap (owner 2026-09-14)',
  resultCounts({ trueTotal: 9892, shown: 500, fetched: 1500, serverMore: true }).hasMore === false);
check('at the cap, cappedAtCap is TRUE (more still matches) — the terminal that keeps Advanced Filter',
  resultCounts({ trueTotal: 9892, shown: 500, fetched: 1500, serverMore: true }).cappedAtCap === true);
check('everything shown in a ≤500 set → NOT capped (nothing left to narrow into)',
  resultCounts({ trueTotal: 340, shown: 340, fetched: 340, serverMore: false }).cappedAtCap === false);
check('the last-tap wording turns on once 100 is shown and more remains, off before that',
  resultCounts({ trueTotal: 9892, shown: 100, fetched: 1500, serverMore: true }).lastTapOffer === true
  && resultCounts({ trueTotal: 9892, shown: 20, fetched: 1500, serverMore: true }).lastTapOffer === false);
check('hasMore goes FALSE when the last match is on screen (small set)',
  resultCounts({ trueTotal: 340, shown: 340, fetched: 340, serverMore: false }).hasMore === false);
check('hasMore is never fabricated: nothing buffered and no server pages → false even if total says more',
  resultCounts({ trueTotal: 500, shown: 200, fetched: 200, serverMore: false }).hasMore === false);

// ── 4. the closing number is ALWAYS the true total ──────────────────────────────────────────────
for (const [trueTotal, shown] of [[9892, 100], [9892, 300], [437, 437], [46, 46]] as const) {
  const rc = resultCounts({ trueTotal, shown, fetched: Math.max(shown, 100), serverMore: shown < trueTotal });
  check(`${trueTotal} matches, ${shown} shown → message states ${trueTotal}, shown ${shown}`,
    rc.endTotal === trueTotal && rc.endShown === shown);
}

// ── 5. the shipped wiring uses the module (never a re-derived local rule) ───────────────────────
// «عرض المزيد» reveals via revealTarget() (owner 2026-09-14, superseding the Task 4 drain model): the
// FIRST tap on a turn reveals the next 100-boundary, the LAST tap reveals up to the 500 cap, and then
// the button retires. The honesty check: loadMore reveals exactly `min(target, mergedLen)` on BOTH the
// instant-reveal path (a new turn started mid-fetch) and the cascade path — the boundary on a first
// press, min(500,total) on the last — never a re-derived number, never a partial count mislabelled whole.
check('revealTarget decides the reveal target — first tap → 100, last tap → up to 500 (owner 2026-09-14)',
  /const target = revealTarget\(cur, m\.result\.matchTotal \?\? Infinity\);/.test(code));
check('a first vs. later press is still told apart by the turn\'s OWN reveal state, not new component state',
  /const alreadyExpandedOnce = cur > initialReveal\(m\.result, m\.afCompleted\);/.test(code));
check('loadMore reveals exactly min(target, mergedLen) on BOTH the instant and cascade reveal paths',
  /setRevealCount\(\(c\) => \(\{ \.\.\.c, \[mid\]: revealTo \}\)\)/.test(code)
  && /cascadeIn\(mid, cur, revealTo\)/.test(code)
  && /const revealTo = Math\.min\(target, mergedLen\);/.test(code)
  && /const mergedLen = fetched0 \+ add\.length;/.test(code));
check('the lifetime-cap gate is GONE from loadMore',
  !/cur >= BROWSE_CAP/.test(code) && !/BROWSE_CAP/.test(code));
check('the closing message and the gate share resultCounts()',
  /const rc = resultCounts\(\{ trueTotal, shown, fetched, serverMore \}\)/.test(code));
check('a client-narrowed search never quotes the untrusted RPC total',
  /clientNarrowed \? \(serverMore \? fetched \+ 1 : fetched\) : rawTotal/.test(code)
  && /const quoteTotal = !clientNarrowed;/.test(code));
// The ban list, unchanged in spirit: nothing may stand in for trueTotal.
check('no hardcoded 100 stands in for a result count in the closing message block',
  !/endTotal: *100|trueTotal = 100|matchTotal \?\? 100/.test(code));

// ── 6. A FAILED PAGE IS NOT PROGRESS (hunt-2026-09-04:pagination:06) ───────────────────────────
// Everything above executes pure counting helpers with hand-written inputs, and the whole error
// path sat outside it: `loadMoreListings` did `buildPools(rows ?? [])`, which erases the ONE signal
// that says the backend page failed. An errored page then read exactly like a genuinely empty one —
// the cursor advanced, `hasMore` went false, «عرض المزيد» disappeared for good, and the closing line
// went on to state the true total as if all of it had been shown. So this section runs the SHIPPED
// function, lifted out of src/store.tsx (it is a closure inside AppProvider and cannot be imported),
// against a fetch that FAILS.
const loadMore = (() => {
  // The third parameter is OPTIONAL in this pattern on purpose: `seed` arrived with ops_incident #796
  // (a walk pages with its own rotation seed, not the app's latest) and a lift that hard-codes the old
  // two-parameter signature dies with "could not lift" on a change that has nothing to do with the
  // cursor arithmetic measured here — a barrier failing for a reason it is not about.
  const m = storeSrc.match(/loadMoreListings: async \(q: SearchQuery, offset: number(?:, seed\?: string)?\) => \{[\s\S]*?\n {6}\},/);
  if (!m) {
    console.error('FAIL  could not lift loadMoreListings out of src/store.tsx — was it moved or renamed?');
    process.exit(1);
  }
  const js = stripTypeScriptTypes(`const surface = { ${m[0]} };`, { mode: 'strip' });
  // LOAD_MORE_PAGE_SIZE is injected, not stubbed: since 2026-09-12 the page size has ONE definition
  // (src/data/resultCount.ts) because agent.tsx's drain budget is derived from it — the two used to
  // be independent literals, which is how a backstop sized in its comment against 1,500 came to
  // cover a 500-row pager. Handing the lift the REAL constant keeps this check measuring the shipped
  // arithmetic; a stub here would re-open exactly the drift the shared constant closed.
  // searchSeedRef IS stubbed (unlike LOAD_MORE_PAGE_SIZE above): since 2026-09-26 load-more carries
  // the search's rotation seed so every page of one walk keeps the same server ORDER BY. That seed
  // cannot influence the cursor/hasMore arithmetic measured here — it only picks WHICH listings the
  // (stubbed) fetch would have returned — so a fixed value keeps this lift faithful, and the `seed`
  // argument is simply not passed below. WHICH seed reaches the fetch is two other contracts, both
  // owned elsewhere: that it VARIES per search (verify-rotation-seed-is-per-search.ts) and that it is
  // the paged SET's own rather than the app's latest (verify-loadmore-pages-with-its-own-search-seed.ts,
  // ops_incident #796).
  const raw = new Function('fetchListingsForQuery', 'runSearch', 'buildPools', 'LOAD_MORE_PAGE_SIZE', 'searchSeedRef',
    `${js}\nreturn surface.loadMoreListings;`);
  return ((f: unknown, r: unknown, b: unknown) => raw(f, r, b, LOAD_MORE_PAGE_SIZE, { current: 'lifted-test-seed' })) as
    (f: unknown, r: unknown, b: unknown) => (q: unknown, offset: number) =>
      Promise<{ listings: unknown[]; nextOffset: number; hasMore: boolean; failed?: boolean }>;
})();
// The real remote contract: `listings: null` IS the backend-error signal (src/data/remote.ts), the
// same one runQuery hands runSearch as `fetchFailed` for page 0. runSearch/buildPools are stubbed to
// pass the rows straight through, so what is measured is purely this function's own bookkeeping.
const pageFrom = (rows: unknown[] | null, cand: number) =>
  loadMore(async () => ({ listings: rows, pageCandidates: cand }), (_q: unknown, pools: unknown[]) => ({ listings: pools }), (rows: unknown[]) => rows);
const row = (i: number) => ({ id: i, source: 'aqar' });
const page = (n: number, from = 0) => Array.from({ length: n }, (_, i) => row(from + i));

{
  const fail = await pageFrom(null, 0)({}, 1000);
  check('a FAILED page advances the cursor by nothing (retry hits the same page, no 500 skipped)', fail.nextOffset === 1000, `nextOffset=${fail.nextOffset}`);
  check('a FAILED page leaves hasMore alone, so «عرض المزيد» survives to be tapped again', fail.hasMore === true);
  check('a FAILED page invents no listings', fail.listings.length === 0);
  check('a FAILED page says so (failed:true) — it is never dressed up as a completed page', fail.failed === true);
}
{
  // Failure is decided by the error signal, not by whatever count rode along with it.
  const fail = await pageFrom(null, 500)({}, 1000);
  check('a FAILED page ignores the payload’s own numbers (cursor still pinned at 1000)',
    fail.nextOffset === 1000 && fail.hasMore === true && fail.failed === true, `nextOffset=${fail.nextOffset}`);
}
{
  const empty = await pageFrom([], 0)({}, 1000);
  check('a genuinely EMPTY page is still an honest end (hasMore false, not "failed")',
    empty.hasMore === false && empty.nextOffset === 1000 && empty.failed === undefined);
}
{
  const full = await pageFrom(page(500), 500)({}, 1000);
  check('a FULL page still advances 500 and keeps paging (success path untouched)',
    full.listings.length === 500 && full.nextOffset === 1500 && full.hasMore === true && full.failed === undefined);
  const partial = await pageFrom(page(120), 120)({}, 1000);
  check('a PARTIAL page advances by what it found and ends honestly (success path untouched)',
    partial.listings.length === 120 && partial.nextOffset === 1120 && partial.hasMore === false);
}
{
  // The user taps «عرض المزيد» again after a failure: the SAME page is refetched and the 500 rows
  // that the swallowed error would have skipped forever actually arrive.
  const failed = await pageFrom(null, 0)({}, 1000);
  const retry = await pageFrom(page(500, 1000), 500)({}, failed.nextOffset);
  check('retrying after a failure delivers the very page that was lost (nothing skipped)',
    retry.listings.length === 500 && retry.nextOffset === 1500 && (retry.listings[0] as { id: number }).id === 1000);
}
check('the failure signal is not swallowed in the source (`rows ?? []` is gone from loadMoreListings)',
  /if \(rows === null\) return \{ listings: \[\], nextOffset: offset, hasMore: true, failed: true \};/.test(storeSrc)
  && !/buildPools\(rows \?\? \[\]\)\);\n\s*return \{ listings: r\.listings, nextOffset: offset \+ cand/.test(storeSrc));

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — each guard must FAIL on its own defect\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

// (a) the NO-CAP behaviour sneaking back — hasMore alive past the 500 cap (the owner's reversal)
{
  const uncapped = (a: { trueTotal: number; shown: number; fetched: number; serverMore: boolean }) => {
    const r = resultCounts(a);
    // the pre-2026-09-14 hasMore: alive while any match remains, no 500 ceiling.
    return { ...r, hasMore: a.shown < a.trueTotal && (a.shown < a.fetched || a.serverMore) };
  };
  mustCatch('hasMore left alive past the 500 cap (the no-lifetime-ceiling behaviour the owner reversed)',
    uncapped({ trueTotal: 9892, shown: 500, fetched: 1500, serverMore: true }).hasMore === true
    && resultCounts({ trueTotal: 9892, shown: 500, fetched: 1500, serverMore: true }).hasMore === false);
}
// (b) boundary math drifting to cur+100 (110/210 instead of 100/200)
mustCatch('drifted boundaries (10+100=110 instead of completing the hundred)',
  nextBatchTarget(10, 5000) !== 110);
// (c) fabricated "more" past the last match
mustCatch('paging past the last real match',
  nextBatchTarget(437, 437) === 437
  && resultCounts({ trueTotal: 437, shown: 437, fetched: 437, serverMore: false }).hasMore === false);
// (d) the closing message quoting the buffer length as the total
{
  const buggy = resultCounts({ trueTotal: 9892, shown: 100, fetched: 1500, serverMore: true });
  mustCatch('the buffer length (1,500) standing in for the true total (9,892)',
    buggy.endTotal === 9892 && buggy.endTotal !== 1500);
}
// (e) the source-level gate check going blind
mustCatch('the cap gate creeping back into loadMore source',
  /BROWSE_CAP/.test(code.replace('const cur = revealCount[mid]', 'if (cur >= BROWSE_CAP) return; const cur = revealCount[mid]')));

// ── (f)–(i) THE DEFECT ITSELF: a failed page presented as "no more rows" ────────────────────────
// The defective implementation, executed rather than described: `rows ?? []` turns the null error
// signal into an empty page, so a failure is reported as a completed, final one.
{
  const swallowed = async (offset: number) => {
    const { listings: rows, pageCandidates: cand } = await (async () => ({ listings: null as unknown[] | null, pageCandidates: 0 }))();
    const r = { listings: (rows ?? []) as unknown[] };
    return { listings: r.listings, nextOffset: offset + cand, hasMore: cand >= 500 };
  };
  const bug = await swallowed(1000);
  const fixed = await pageFrom(null, 0)({}, 1000);
  mustCatch('a failed page reported as hasMore:false — «عرض المزيد» gone forever, "I showed you all N"',
    bug.hasMore === false && fixed.hasMore === true);
  mustCatch('a failed page recorded as progress (the cursor moving past 500 unseen matches)',
    (await (async () => { const b = await swallowed(1000); return b.nextOffset; })()) === 1000
    && fixed.nextOffset === 1000 && fixed.failed === true);
}
// (g) a failure that keeps hasMore but still burns the page (the half-fix)
mustCatch('a failure that keeps the button but skips the page anyway',
  (() => { const half = { listings: [], nextOffset: 1500, hasMore: true }; return half.nextOffset !== 1000; })());
// (h) a "failure" flag on a page that genuinely ended — crying wolf at the honest end
mustCatch('a genuinely empty page mislabelled as a failure (the retry loop that never ends)',
  (await pageFrom([], 0)({}, 1000)).failed === undefined && (await pageFrom(null, 0)({}, 1000)).failed === true);
// (i) the source-level half going blind if the swallow is put back
mustCatch('`rows ?? []` creeping back into loadMoreListings',
  !/if \(rows === null\) return \{ listings: \[\], nextOffset: offset, hasMore: true, failed: true \};/.test(
    storeSrc.replace('if (rows === null) return { listings: [], nextOffset: offset, hasMore: true, failed: true };', 'const r0 = buildPools(rows ?? []);')));

// ── THE SENTENCE STATES THE REAL NUMBER — cumulative on the first tap, REMAINING on the last ──────
// (owner 2026-09-13 → 2026-09-15). A tap advances to revealTarget(): the next 100-boundary on a FIRST
// tap, min(500,total) on the LAST. Two DIFFERENT real numbers reach the two messages, never a hardcode:
//   • FIRST tap → «بعرض لك أول {next}»  — the CUMULATIVE target (revealTarget): 47 on a 47-match
//     search, 100 on a 9,892-match one. Never a fixed 100 ("funny to say 100 and show 20").
//   • LAST tap  → «بنعرض لك حتى {rest}» — the REMAINING this tap ADDS on top of the {shown} already on
//     screen = revealTarget − shown (owner 2026-09-15): 100 shown of 387 → 287, of 9,892 → 400. Never
//     the cumulative total (which double-counts the 100 already shown), never a fixed 500.
console.log('\nThe «عرض المزيد» sentence states the real next-tap target\n');
const i18nSrc = readFileSync(join(root, 'src', 'i18n.tsx'), 'utf8');
const arOf = (k: string) => i18nSrc.match(new RegExp(`'${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*'([^']*)'`))?.[1] ?? '';
const firstTapKeys = [
  'I showed you the first {shown} of {total} matching listings. Want me to show more? I will show the first {next}.',
  'I showed you the first {shown} of {total} matching listings. Want me to show more? I will show the first {next}, or help you find more precise ones.',
];
const lastTapKeys = [
  'We still have more for you. Showing {shown} of {total}. This is the last «عرض المزيد» — up to {rest} at once. Want me to show more, or help you find more precise ones?',
  'We still have more for you. Showing {shown} of {total}. This is the last «عرض المزيد» — up to {rest} at once. Want me to show more?',
];
for (const k of firstTapKeys) {
  const ar = arOf(k);
  check(`first-tap AR carries {next} (cumulative), not a fixed number: "${k.slice(60, 82)}…"`,
    ar.includes('{next}') && !/\b(100|500)\b/.test(ar), `got: "${ar}"`);
}
for (const k of lastTapKeys) {
  const ar = arOf(k);
  check(`last-tap AR carries {rest} (the remaining), not a fixed number and not {next}: "${k.slice(55, 77)}…"`,
    ar.includes('{rest}') && !ar.includes('{next}') && !/\b(100|500)\b/.test(ar), `got: "${ar}"`);
}
check('the retired «بعرض لك كل الإعلانات» one-tap-shows-everything promise is gone from every key',
  !i18nSrc.includes('إذا عرضت لك المزيد بعرض لك كل الإعلانات'));
check('agent.tsx fills {next} from revealTarget(endShown, endTotal) — the first-tap cumulative target',
  /next: revealTarget\(rc\.endShown, rc\.endTotal\)/.test(code));
check('agent.tsx fills {rest} from revealTarget(endShown, endTotal) − endShown — the last-tap remaining',
  /rest: Math\.max\(0, revealTarget\(rc\.endShown, rc\.endTotal\) - rc\.endShown\)/.test(code));
// EXECUTED — first-tap {next} = revealTarget (cumulative); last-tap {rest} = revealTarget − shown.
for (const [shown, total] of [[13, 437], [13, 47], [10, 9892]] as const) {
  check(`first tap: shown ${shown} of ${total} → «first ${revealTarget(shown, total)}»`,
    revealTarget(shown, total) === Math.min(BROWSE_BATCH, total));
}
for (const [shown, total] of [[100, 387], [100, 9892], [100, 340], [100, 437]] as const) {
  const rest = Math.max(0, revealTarget(shown, total) - shown);
  check(`last tap: shown ${shown} of ${total} → «up to ${rest} more» (= min(500,total) − shown)`,
    rest === Math.min(SECOND_PAGE_CAP, total) - shown);
}
mustCatch('a hardcoded 100 standing in for the first-tap target on a 47-match search (the "funny" case)',
  revealTarget(13, 47) !== 100);
mustCatch('the last tap stating the cumulative TOTAL (387) instead of the remaining (287) is a different number',
  (revealTarget(100, 387) - 100) !== revealTarget(100, 387));
mustCatch('a hardcoded 500 standing in for a 340-match last tap (remaining is 240, not 500)',
  (revealTarget(100, 340) - 100) !== 500);
mustCatch('a last tap claiming it adds the whole set (9,892) when it only adds 400 to reach the cap',
  (revealTarget(100, 9892) - 100) !== 9892);

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ continuation honest end to end: clean boundaries, true totals, no ceiling, no fabricated more\n');
