// A BARRIER'S SOURCE WINDOW MAY NOT WIDEN TO THE WHOLE FILE WHEN ITS MARKER MOVES.
//
// THE FINDING (2026-09-20, routine #10 — found by execution, not by reading).
// Forty-three barriers narrow a product file to the region they assert about with the raw idiom
//
//     const sig = index.slice(index.indexOf(START), index.indexOf(END));
//
// `indexOf` returns -1 for a marker it cannot find, and `slice` reads a negative end as an offset
// from the END of the string. So the day the END marker is renamed, destructured or refactored away,
// that window stops being a window and becomes almost the entire file — and every
// `window.includes(…)` assertion beneath it passes, because the needle exists somewhere in 200KB of
// unrelated source. The guard has quietly turned into a grep over the whole module, and it prints ✓.
//
// WATCHED, END TO END. `scripts/verify-district-counts-honest.ts` guards the 2026-08-22 count
// honesty defect — حي العارض advertising 2,914 listings over a search that lands on 1,231, because
// the combined-mode Rent budget was missing from `districtNarrowingSig`. Two edits to
// `src/app/index.tsx`: the real defect (delete `query.priceMinRent, query.priceMaxRent`), plus a
// behaviour-preserving, type-correct refactor of the END MARKER ALONE
// (`const hasDistrictNarrowing = useMemo(` → `const [hasDistrictNarrowing] = useMemo(`). The barrier
// printed `PASS  districtNarrowingSig includes query.priceMinRent` — over a signature that no longer
// contained it — and `npm run test:all` passed ALL 486 CHECKS. Its sibling over the same signature,
// `verify-district-field.ts`, was blind in exactly the same place. Both are repaired and
// mutation-proven; both have left `scripts/mutation-proof-grandfathered.txt`.
//
// WHY A RATCHET AND NOT A SWEEP. Sixty-three sites remain across forty-one files. Converting all of
// them in one diff would be a large unreviewable change across surfaces this routine does not own,
// and most are over code whose markers have not moved. So this is the shape AGENTS.md already pins
// for unbounded RPC calls (`verify-every-rpc-call-is-bounded.ts`): the known sites are a SHRINK-ONLY
// baseline under a pinned ceiling, a NEW raw site is RED, and a baseline row the tree has already
// outgrown is RED as STALE — so the ledger can never read better than reality.
//
// The blinding change and the defect need never be made by the same person, in the same PR, or in
// the same month. That is precisely why the guard cannot be left to depend on anyone noticing.
//
//   node --experimental-strip-types scripts/verify-source-windows-fail-closed.ts   (in `npm test`)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stripCommentsAndStrings } from './lib/stripComments.ts';
import {
  windowBetween, windowUpTo, MarkerMissing,
  rawWindowSites, parseBaseline, windowRatchetProblems,
} from './lib/sourceWindow.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const root = join(import.meta.dirname, '..');
const BASELINE = join(root, 'scripts', 'source-window-baseline.txt');

// The number of raw sites on the day this ratchet was installed. It may only FALL. Raising it means
// "we shipped another guard that reads the whole file when a marker moves", and that belongs in a
// reviewed source change, not in an append to a text file.
const RAW_SITE_CEILING = 61;

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '❌'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failed++;
};
const mustCatch = (what: string, caught: boolean) => {
  if (!caught) failed++;
  console.log(`  ${caught ? '✓' : '❌'} MUTATION: catches ${what}`);
};

console.log('\nA barrier\'s source window may not widen to the whole file when its marker moves\n');

// ── 1. THE READER ITSELF, EXECUTED ────────────────────────────────────────────────────────────────
// The whole repair rests on windowBetween() failing rather than widening, so that is proven by
// running it, never by asserting that the file mentions it.
const SAMPLE = 'aaa START one two THREE END bbb';
check('windowBetween returns exactly the region between the markers',
  windowBetween(SAMPLE, 'START', 'END') === 'START one two THREE ');
mustCatch('a missing END marker — a raw slice would have returned the rest of the file',
  (() => { try { windowBetween(SAMPLE, 'START', 'GONE'); return false; }
           catch (e) { return e instanceof MarkerMissing; } })());
mustCatch('a missing START marker',
  (() => { try { windowBetween(SAMPLE, 'GONE', 'END'); return false; }
           catch (e) { return e instanceof MarkerMissing; } })());
mustCatch('an END marker that only occurs BEFORE the start (a raw slice yields an empty window)',
  (() => { try { windowBetween('END xx START yy', 'START', 'END'); return false; }
           catch (e) { return e instanceof MarkerMissing; } })());
check('…and a window whose end DOES follow its start is still returned (not vacuously throwing)',
  windowBetween('END xx START yy END zz', 'START', 'END') === 'START yy ');
mustCatch('windowUpTo with a missing marker — the slice(0, -1) dress of the same bug',
  (() => { try { windowUpTo(SAMPLE, 'GONE'); return false; }
           catch (e) { return e instanceof MarkerMissing; } })());
check('…and windowUpTo returns the head when the marker is there',
  windowUpTo(SAMPLE, 'START') === 'aaa ');

// ── 2. THE RATCHET OVER THE REMAINING RAW SITES ───────────────────────────────────────────────────
const scanned = [
  ...readdirSync(join(root, 'scripts')).filter((f) => /^verify-.*\.(ts|mjs)$/.test(f))
    .map((f) => `scripts/${f}`),
  // scripts/lib too: a barrier's predicate extracted into a shared module is exactly where this
  // shape would next hide, and a ratchet that cannot see the lib is a ratchet with a back door.
  ...readdirSync(join(root, 'scripts', 'lib')).filter((f) => /\.(ts|mjs)$/.test(f))
    .map((f) => `scripts/lib/${f}`),
].sort();

check('there is something to scan (an empty run set is a failure, never a pass)', scanned.length > 100,
  `found ${scanned.length}`);

/** Raw sites per file, over CODE ONLY — a barrier must be able to quote the anti-pattern it forbids. */
export function scanTree(files: string[], read: (f: string) => string): Map<string, number> {
  const found = new Map<string, number>();
  for (const f of files) {
    const n = rawWindowSites(f, stripCommentsAndStrings(read(f))).length;
    if (n) found.set(f, n);
  }
  return found;
}

const read = (f: string) => readFileSync(join(root, f), 'utf8');
const found = scanTree(scanned, read);
const baseline = parseBaseline(existsSync(BASELINE) ? readFileSync(BASELINE, 'utf8') : '');
const total = [...found.values()].reduce((a, b) => a + b, 0);

console.log(`\n  raw window sites: ${total} in ${found.size} file(s) · ceiling ${RAW_SITE_CEILING} · `
  + `baseline rows ${baseline.size}\n`);

const problems = windowRatchetProblems(found, baseline, RAW_SITE_CEILING);
check('every raw source window in the tree is a known, baselined one', problems.length === 0,
  problems.join('\n      '));

// ── 3. THE RATCHET'S OWN MUTATION PROOFS ──────────────────────────────────────────────────────────
// The verdict is a pure function of (found, baseline, ceiling), so each direction is proven by
// handing it a tree that has the defect — never by describing one.
const asMap = (o: Record<string, number>) => new Map(Object.entries(o));

mustCatch('a NEW raw window site in a file already at its baseline',
  windowRatchetProblems(asMap({ 'scripts/verify-a.ts': 3 }), asMap({ 'scripts/verify-a.ts': 2 }), 99)
    .length === 1);
mustCatch('a raw window site in a file with no baseline row at all',
  windowRatchetProblems(asMap({ 'scripts/verify-new.ts': 1 }), asMap({}), 99).length === 1);
mustCatch('a STALE baseline row — a site that has been fixed but still counted (the ledger reading '
  + 'better than the tree)',
  windowRatchetProblems(asMap({ 'scripts/verify-a.ts': 1 }), asMap({ 'scripts/verify-a.ts': 2 }), 99)
    .some((p) => p.includes('STALE')));
mustCatch('a baselined file whose sites are ALL gone but whose row survives',
  windowRatchetProblems(asMap({}), asMap({ 'scripts/verify-a.ts': 2 }), 99).length === 1);
mustCatch('the total creeping past the pinned ceiling',
  windowRatchetProblems(asMap({ 'scripts/verify-a.ts': 5 }), asMap({ 'scripts/verify-a.ts': 5 }), 4)
    .some((p) => p.includes('ceiling')));
mustCatch('…while an exactly-matching tree is NOT flagged (the ratchet is not vacuously red, and it '
  + 'must welcome its own progress)',
  windowRatchetProblems(asMap({ 'scripts/verify-a.ts': 2 }), asMap({ 'scripts/verify-a.ts': 2 }), 99)
    .length === 0
  && windowRatchetProblems(asMap({}), asMap({}), 0).length === 0);

// The discovery half, proven on source rather than on a summary. The OFFSET form is deliberately not
// flagged: `slice(i, i + 700)` with a missing marker gives an end BELOW the start, i.e. an empty
// window, which fails closed. A ratchet that flagged the safe shape too would cry wolf, and a
// ratchet that cries wolf gets lowered.
const BARE = 'const w = src.slice(src.indexOf("A"), src.indexOf("B"));';
const OFFSET = 'const w = src.slice(src.indexOf("A"), src.indexOf("B") + 700);';
mustCatch('the bare two-marker window shape, in source',
  rawWindowSites('x.ts', BARE).length === 1);
check('…and the offset form (fail-closed) is NOT flagged',
  rawWindowSites('x.ts', OFFSET).length === 0);
check('a file that merely QUOTES the shape inside a string is not flagged (this file does, above)',
  rawWindowSites('x.ts', stripCommentsAndStrings(`const example = '${BARE}';`)).length === 0);

// ── 4. WIRING — asked by execution, never by string-matching package.json ─────────────────────────
check('this check runs in `npm test` (npmTestRuns, not a grep over package.json)',
  npmTestRuns(root, 'verify-source-windows-fail-closed'));

console.log(failed === 0
  ? '\n✅ every source window either fails closed or is a known, shrink-only baselined site\n'
  : `\n❌ ${failed} check(s) FAILED — a barrier can read the whole file when its marker moves\n`);
process.exit(failed === 0 ? 0 : 1);
