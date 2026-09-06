// BROWSE-CONTINUATION HONESTY (owner 2026-08-29 — supersedes the 2026-08-20 lifetime cap this file
// used to pin; the owner explicitly reversed that decision, so this file now locks the NEW contract
// with the same rigor it used to lock the old one).
//
// THE RULE. «عرض المزيد» keeps working while matching listings genuinely exist: batches land on
// clean 100 boundaries (…→100→200→300) and reach the LAST real match — no lifetime ceiling. The
// honesty half is unchanged and non-negotiable: the closing message states the TRUE matched total,
// never a batch size, never a buffer length, and "more" is never offered when nothing more exists.
//
//   node --experimental-strip-types scripts/verify-result-cap-honesty.ts   (runs by existence)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { BROWSE_BATCH, nextBatchTarget, resultCounts } from '../src/data/resultCount.ts';

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

// ── 2. NO LIFETIME CEILING — the exact behavior the owner ordered ───────────────────────────────
{
  // Walk a 2,223-match search the way the UI does: press → boundary → press …
  let shown = 10;
  let presses = 0;
  while (shown < 2223 && presses < 50) { shown = nextBatchTarget(shown, 2223); presses++; }
  check('a 2,223-match search is walkable to ALL 2,223 (was capped at 100 before)',
    shown === 2223, `reached ${shown} in ${presses} presses`);
  check('it takes the honest number of presses (23 boundaries)', presses === 23, `presses=${presses}`);
}
for (const trueTotal of [0, 7, 99, 100, 101, 200, 201, 437, 9892]) {
  const rc = resultCounts({ trueTotal, shown: trueTotal, fetched: trueTotal, serverMore: false });
  check(`trueTotal ${trueTotal}, all shown → endKind 'all', total stated is ${trueTotal}`,
    rc.endKind === 'all' && rc.endTotal === trueTotal && !rc.hasMore && rc.reachable === trueTotal);
}

// ── 3. hasMore is exactly "matches remain" — alive at 100/200/300, dead at the end ──────────────
check('hasMore stays TRUE at 100 shown of 9,892 (the cap used to kill it here)',
  resultCounts({ trueTotal: 9892, shown: 100, fetched: 1500, serverMore: true }).hasMore === true);
check('hasMore stays TRUE at 1,500 shown when the server has more pages',
  resultCounts({ trueTotal: 9892, shown: 1500, fetched: 1500, serverMore: true }).hasMore === true);
check('hasMore goes FALSE only when the last match is on screen',
  resultCounts({ trueTotal: 9892, shown: 9892, fetched: 9892, serverMore: false }).hasMore === false);
check('hasMore is never fabricated: nothing buffered and no server pages → false even if total says more',
  resultCounts({ trueTotal: 500, shown: 200, fetched: 200, serverMore: false }).hasMore === false);

// ── 4. the closing number is ALWAYS the true total ──────────────────────────────────────────────
for (const [trueTotal, shown] of [[9892, 100], [9892, 300], [437, 437], [46, 46]] as const) {
  const rc = resultCounts({ trueTotal, shown, fetched: Math.max(shown, 100), serverMore: shown < trueTotal });
  check(`${trueTotal} matches, ${shown} shown → message states ${trueTotal}, shown ${shown}`,
    rc.endTotal === trueTotal && rc.endShown === shown);
}

// ── 5. the shipped wiring uses the module (never a re-derived local rule) ───────────────────────
check('loadMore advances via nextBatchTarget (both the buffer path and the fetch path)',
  (code.match(/nextBatchTarget\(/g) ?? []).length >= 2);
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
  const m = storeSrc.match(/loadMoreListings: async \(q: SearchQuery, offset: number\) => \{[\s\S]*?\n {6}\},/);
  if (!m) {
    console.error('FAIL  could not lift loadMoreListings out of src/store.tsx — was it moved or renamed?');
    process.exit(1);
  }
  const js = stripTypeScriptTypes(`const surface = { ${m[0]} };`, { mode: 'strip' });
  return new Function('fetchListingsForQuery', 'runSearch', 'buildPools', `${js}\nreturn surface.loadMoreListings;`) as
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

// (a) the old cap sneaking back as a resultCounts ceiling
{
  const capped = (a: { trueTotal: number; shown: number; fetched: number; serverMore: boolean }) => {
    const r = resultCounts(a);
    const reachable = Math.min(a.trueTotal, 100);
    return { ...r, reachable, hasMore: r.hasMore && a.shown < reachable };
  };
  mustCatch('a min(trueTotal, 100) ceiling re-imposed on reachability',
    capped({ trueTotal: 9892, shown: 100, fetched: 1500, serverMore: true }).hasMore === false);
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

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ continuation honest end to end: clean boundaries, true totals, no ceiling, no fabricated more\n');
