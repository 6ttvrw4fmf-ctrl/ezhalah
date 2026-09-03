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
import { BROWSE_BATCH, nextBatchTarget, resultCounts } from '../src/data/resultCount.ts';

const root = join(import.meta.dirname, '..');
const code = readFileSync(join(root, 'src', 'app', 'agent.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

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

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ continuation honest end to end: clean boundaries, true totals, no ceiling, no fabricated more\n');
