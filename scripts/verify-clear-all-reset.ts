// THE CLEAN FILTER FORM — what the Filter home resets to when a search was left behind.
//
// AMENDED 2026-10-03 (owner: «there is no option called مسح الكل — this should never show»). The
// «مسح الكل» (Clear All) button, and hasActiveFilters() that decided when to show it, are gone: coming
// back to the Filter from a search ALWAYS opens a clean form (src/lib/searchLeftBehind.ts raises the
// flag, src/app/index.tsx's resetFilterForm acts on it). What this file still pins is the thing that
// reset lands on — HOME_DEFAULT_QUERY() — and that replacing the query with it is complete and
// idempotent. The file keeps its old name only so the repo's baselines need no edit.
//
// HOME_DEFAULT_QUERY() is pure and lives in src/lib/searchDefaults.ts (zero-dependency), so this test
// genuinely IMPORTS AND EXECUTES the real function used by src/app/index.tsx's reset and by
// src/store.tsx's initial state and newChat(), rather than grepping source text for the right shape.
//
//   node --experimental-strip-types scripts/verify-clear-all-reset.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HOME_DEFAULT_QUERY, emptyQuery } from '../src/lib/searchDefaults.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) console.error(`  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  check(label, ok);
};

// ── The default itself ──────────────────────────────────────────────────────────────────────────
eq('HOME_DEFAULT_QUERY() is exactly {Buy, empty location, Residential, no type/detail, annual rent}', HOME_DEFAULT_QUERY(), {
  deal: 'Buy',
  location: '',
  category: 'Residential',
  type: null,
  detail: null,
  priceInput: '',
  priceBand: null,
  rentPeriod: 'annual',
});
check('emptyQuery() itself stays Rent-default (the agent/chat base, unaffected by the Home screen override)', emptyQuery().deal === 'Rent');
// ── The reset is a FULL REPLACE ────────────────────────────────────────────────────────────────
// setQuery(() => HOME_DEFAULT_QUERY()) is a bare replacement (src/store.tsx's setQuery is a plain
// functional setState with no merge), so whatever a previous search left behind is gone, and the
// default is byte-for-byte the same every time.
const afterReset = HOME_DEFAULT_QUERY();
eq('the reset is idempotent — the default is byte-for-byte the same every time', afterReset, HOME_DEFAULT_QUERY());
check('the default carries no Advanced Filter answer (nothing to carry back to the Filter)',
  !('afFacets' in afterReset) || !(afterReset as any).afFacets?.length);

// ── The button is gone, and the form resets when a search was left behind ──────────────────────
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const index = read('src/app/index.tsx');
const noComments = index.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
check('the Filter home renders no «مسح الكل» button', !/Clear all/.test(noComments) && !/clearAllBtn/.test(noComments));
check('…and resets its form (store query, city, district, scroll) when a search was left behind',
  /takeSearchLeftBehind\(\)/.test(noComments)
  && /setQuery\(\(\) => HOME_DEFAULT_QUERY\(\)\)/.test(noComments)
  && /setCitySelected\(null\)/.test(noComments) && /clearDistrict\(\)/.test(noComments));
{
  const agentSrc = read('src/app/agent.tsx');
  // RAISED ONLY BY A SEARCH WHOSE RESULTS LANDED. A search cancelled during the loader never happened:
  // the Filter must restore it exactly (verify-web-runtime-smoke.mjs [E]/[F]/[H], CI run 37102531144
  // went red 6x when the flag rode the first user message instead).
  const raisesOnResults = (src: string) =>
    /const landedResultsCount = msgs\.filter\(\(m\) => m\.role === 'results'\)\.length;/.test(src)
    && /useEffect\(\(\) => \{ if \(landedResultsCount > 0\) markSearchLeftBehind\(\); \}, \[landedResultsCount\]\);/.test(src);
  check('…raised by the results screen each time a search\'s RESULTS land (a cancelled search raises nothing)',
    raisesOnResults(agentSrc));
  check('(mutation) catches the flag riding the first user message again (it would wipe a cancelled search)',
    !raisesOnResults(agentSrc.replace('if (landedResultsCount > 0) markSearchLeftBehind();', 'if (modeSearched) markSearchLeftBehind();')));
}
const flag = await import('../src/lib/searchLeftBehind.ts');
flag.takeSearchLeftBehind();
check('the flag starts lowered and a first focus after load finds nothing to reset', flag.takeSearchLeftBehind() === false);
flag.markSearchLeftBehind();
check('a search left behind is seen exactly once (read-and-clear)',
  flag.takeSearchLeftBehind() === true && flag.takeSearchLeftBehind() === false);

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} clean-filter-form assertion(s) FAILED`);
  process.exit(1);
}
console.log('✓ the filter form resets clean after a search, and nothing offers «مسح الكل»');
