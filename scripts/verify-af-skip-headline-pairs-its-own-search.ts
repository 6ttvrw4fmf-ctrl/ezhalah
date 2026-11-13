// The all-skip headline (R8.1.2) is judged against the search that PRINTED it (CodeRabbit on #12166, 🦅 2026-11-13).
//
// When the all-skip round re-searches, the newest headline belongs to that new search, and its hydration drops are that
// page's — not the baseline's. Pairing the refreshed headline with dropsOf(baseline) false-reds a correct page
// (baseline 1 drop, refreshed 0 → expects T−1, the page prints T). The live robot cannot be imported (it drives
// production), so this pins the pairing in its source AND executes the selection rule on both branches.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(import.meta.dirname, 'verify-af-option-card-truth-live.ts'), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };

/** The R8.1.2 block: from the all-skip headline comment to its check() call. */
const block = (src: string): string => {
  const a = src.indexOf('const shownSearch'); const b = src.indexOf("'2. R8.1.2 — after skipping every question the newest headline is still the baseline number'");
  return a >= 0 && b > a ? src.slice(a, b) : '';
};
/** The pairing rule as the source states it: one search supplies the headline wait AND the drops. */
export const pairsItsOwnSearch = (src: string): boolean => {
  const b = block(src);
  return /const shownSearch\s*=\s*roundEnd\s*\?\?\s*baseline/.test(b)
    && /waitForHeadline\(\s*shownSearch\.total\s*,[^)]*honestOf\(\s*shownSearch\s*\)\s*\)/.test(b)
    && /dropsOf\(\s*shownSearch\s*\)/.test(b)
    && !/dropsOf\(\s*baseline\s*\)/.test(b);
};
check('R8.1.2 reads the headline and the drops from the same search (roundEnd ?? baseline)', pairsItsOwnSearch(SRC));

// The selection itself, executed on both branches.
const pick = <T,>(roundEnd: T | null, baseline: T) => roundEnd ?? baseline;
check('a re-search after the skips supplies the headline (the refreshed page)', pick({ id: 'refresh' }, { id: 'base' }).id === 'refresh');
check('no re-search → the baseline supplies it (the no-refresh fallback)', pick(null, { id: 'base' }).id === 'base');

// Mutations: each pre-fix shape must fail.
const b = block(SRC);
check('MUTATION — restoring dropsOf(baseline) is caught', !pairsItsOwnSearch(SRC.replace(b, b.replace('dropsOf(shownSearch)', 'dropsOf(baseline)'))));
check('MUTATION — reading the headline without waiting on that search is caught',
  !pairsItsOwnSearch(SRC.replace(b, b.replace(/await waitForHeadline\([^\n]*\n/, 'headlineNum(hs[hs.length - 1]);\n'))));
check('MUTATION — always using the baseline (no roundEnd branch) is caught',
  !pairsItsOwnSearch(SRC.replace(b, b.replace('roundEnd ?? baseline', 'baseline'))));

console.log(failed === 0 ? '\n✓ the all-skip headline is judged against the search that printed it' : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
