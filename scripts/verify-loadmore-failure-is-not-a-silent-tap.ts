// PERMANENT BARRIER: a FAILED «عرض المزيد» page is never rendered to the user as a successful
// nothing. (ops_incident #33, owner routine-4 Search & Matching QA.)
//
// THE DEFECT THIS EXISTS FOR. `loadMoreListings` (src/store.tsx) was hardened on 2026-09-04 to stop
// a backend error counting as progress: on `rows === null` it advances nothing and reports
// `failed: true`, so the cursor and `hasMore` come back exactly as they went in and the pager is
// correctly re-offered. That half was right. But the CONSUMER never read the flag —
//
//     const { listings: more, nextOffset, hasMore } = await loadMoreListings(...);   // ← no `failed`
//
// — and every downstream value then made the failure indistinguishable from success: `more` is [],
// so `add` is [], so `mergedLen === fetched`, so `nextBatchTarget(cur, mergedLen)` returns `cur` and
// `cascadeIn(cur, cur)` is a no-op. The user taps «عرض المزيد», the spinner runs, ZERO cards appear,
// no error is shown, and the button stays. A silent dead tap.
//
// That is AGENTS.md's "A FAILED FETCH IS NOT AN EMPTY ANSWER" rule violated one layer above the
// place it is usually violated: the fetch layer got it right and the render layer threw the answer
// away. The producer being correct is exactly why it went unnoticed — a barrier reading store.tsx
// sees a well-formed failure signal and is satisfied.
//
// WHY THIS BARRIER EXECUTES INSTEAD OF GREPPING. AGENTS.md is explicit: all five defects of
// 2026-09-04 had a source-TEXT tripwire over the exact line, and every one of those tripwires stayed
// green for as long as the defect was live — two of them pinned the defective line as correct. So
// this barrier LIFTS the real `loadMore` out of src/app/agent.tsx and RUNS it against a
// `loadMoreListings` that resolves the way a failed page really resolves. The assertion is about
// what the user is left with, not about which identifiers appear in a destructuring pattern.
//
// WHAT IS LOCKED (each falls RED under the named mutation, proven at the bottom):
//   1. On `failed`, the user is TOLD — a message is appended, carrying the same retry wording page 0
//      already uses for its own fetch failure.                  [M-drop: omit `failed` → RED]
//   2. On `failed`, NOTHING is merged and the cursor is NOT advanced — the next tap retries the
//      same page rather than skipping 500 real matches.
//   3. A SUCCESSFUL page still merges its rows, advances the cursor, and shows NO error — the fix
//      must not turn a healthy page into a scary message.       [M-always: `if (true)` → RED]
//
//   node --experimental-strip-types scripts/verify-loadmore-failure-is-not-a-silent-tap.ts
//   (auto-discovered by npm test — scripts/lib/testRegistry.ts)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(import.meta.dirname, '..');
const AGENT = join(root, 'src/app/agent.tsx');
const STORE = join(root, 'src/store.tsx');
const agentSrc = readFileSync(AGENT, 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
/**
 * A MUTATION PROOF: this barrier's own predicate, applied to a deliberately broken input, asserting
 * that it really comes back RED. `caught` must be a computed boolean — a literal `true` here is the
 * shape scripts/verify-new-barriers-are-mutation-proven.ts exists to refuse.
 */
const mustCatch = (label: string, caught: boolean, detail = '') => check(`MUTATION \u2014 ${label}`, caught, detail);


/** Write a deliberately broken copy of the real file so the REAL lift can be run against it. */
const mutantOf = (src: string, from: string, to: string): string => {
  if (!src.includes(from)) throw new Error(`mutation anchor missing:\n${from}`);
  const f = join(mkdtempSync(join(tmpdir(), 'ezhalah-loadmore-mut-')), 'mutant.tsx');
  writeFileSync(f, src.replace(from, to));
  return f;
};

// ── the seam: everything `loadMore` closes over is a recorder ────────────────────────────────────
// The branching, the ordering, the merge arithmetic and the message key are production's own.
type Bus = {
  page: { listings: { source: string; id: string }[]; nextOffset: number; hasMore: boolean; failed?: boolean };
  appended: { role: string; text: string }[];
  merged: { source: string; id: string }[];
  offset: number | null;
  cascades: [number, number][];
  loading: boolean[];
};
const gb = globalThis as unknown as { __bus: Bus };

const PRELUDE = [
  'const bus: any = (globalThis as any).__bus;',
  'const uid = () => "m-test";',
  'const t = (k: string) => k;',
  'const runRef = { current: null };',
  'const revealCount: any = {};',
  'const loadingMore: any = {};',
  'const initialReveal = (_r: any) => 10;',
  'const nextBatchTarget = (cur: number, avail: number) => Math.min(cur + 100, avail);',
  'const cascadeIn = (_mid: string, from: number, target: number) => { bus.cascades.push([from, target]); };',
  'const setRevealCount = (_f: any) => {};',
  'const setLoadingMore = (f: any) => { bus.loading.push(true); void f({}); };',
  'const loadMoreListings = async (_q: any, _off: number) => bus.page;',
  // setMsgs is called two ways by the real code: with an appender (the failure message) and with a
  // mapper (the merge). Both are exercised for real; the bus records what each one produced.
  'const setMsgs = (f: any) => {',
  '  const msg: any = { id: "mid", role: "results", result: { listings: bus.merged, pageOffset: bus.offset, hasMore: true, query: {} } };',
  '  const out = f([msg]);',
  '  for (const m of out) {',
  '    if (m.role === "agent") bus.appended.push({ role: m.role, text: m.text });',
  '    if (m.role === "results" && m.result) { bus.merged = m.result.listings; bus.offset = m.result.pageOffset; }',
  '  }',
  '};',
].join('\n');

const runLoadMore = async (file: string, page: Bus['page'], fetched: { source: string; id: string }[]): Promise<Bus> => {
  gb.__bus = { page, appended: [], merged: [...fetched], offset: 0, cascades: [], loading: [] };
  const m = await liftSymbols(
    file,
    [{ header: '  const loadMore = async (m: Extract<ChatMsg, { role: \'results\' }>) => {', endsWith: /^  \};$/ }],
    ['loadMore'],
    PRELUDE,
  );
  const fn = m.loadMore as (msg: unknown) => Promise<void>;
  // `cur === fetched` puts the message at the batch boundary — branch (B), the real fetch path.
  await fn({ id: 'mid', role: 'results', result: { listings: fetched, hasMore: true, pageOffset: 0, query: { location: 'الرياض' } } });
  return gb.__bus;
};

const RETRY_KEY = 'Loading listings — please try again in a few seconds.';
const PAGE = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ source: 'aqar', id: `L${from + i}` }));

console.log('\nA failed «عرض المزيد» page is REPORTED, never shown as a successful nothing\n');

// ── 1. THE FAILURE PATH, EXECUTED ────────────────────────────────────────────────────────────────
// Exactly what store.tsx returns on `rows === null`: nothing fetched, cursor unmoved, hasMore kept.
const failedBus = await runLoadMore(
  AGENT,
  { listings: [], nextOffset: 0, hasMore: true, failed: true },
  PAGE(10),
);

check('the user is TOLD the page failed — a message is appended, not silence',
  failedBus.appended.length === 1,
  `appended: ${JSON.stringify(failedBus.appended)}`);
check('the message carries the same retry wording page 0 uses for its own fetch failure',
  failedBus.appended[0]?.text === RETRY_KEY,
  `saw: ${JSON.stringify(failedBus.appended[0]?.text)}`);
check('NOTHING is merged into the results on a failed page',
  failedBus.merged.length === 10,
  `merged ${failedBus.merged.length} rows (expected the original 10)`);
check('the cursor is NOT advanced — the next tap retries this same page, skipping no matches',
  failedBus.offset === 0,
  `pageOffset became ${failedBus.offset}`);
check('no cascade is started for cards that never arrived',
  failedBus.cascades.length === 0,
  `cascades: ${JSON.stringify(failedBus.cascades)}`);
check('the spinner is cleared (the finally block still runs through the early return)',
  failedBus.loading.length >= 1);

// ── 2. THE SUCCESS PATH MUST STAY UNTOUCHED ──────────────────────────────────────────────────────
// A fix that shows an error on a healthy page would be a worse defect than the one it replaced.
const okBus = await runLoadMore(
  AGENT,
  { listings: PAGE(100, 10), nextOffset: 500, hasMore: true },
  PAGE(10),
);
check('a SUCCESSFUL page merges its rows', okBus.merged.length === 110, `merged ${okBus.merged.length}`);
check('a SUCCESSFUL page advances the cursor', okBus.offset === 500, `pageOffset ${okBus.offset}`);
check('a SUCCESSFUL page shows NO error message', okBus.appended.length === 0,
  `appended: ${JSON.stringify(okBus.appended)}`);
check('a SUCCESSFUL page cascades the new cards in', okBus.cascades.length === 1,
  `cascades: ${JSON.stringify(okBus.cascades)}`);

// De-duplication must survive the fix: a page that repeats a row the message already holds adds it
// once, never twice (§30 identity — source:id, never card text).
const dupBus = await runLoadMore(
  AGENT,
  { listings: [...PAGE(3, 0), ...PAGE(5, 10)], nextOffset: 500, hasMore: true },
  PAGE(10),
);
check('a page repeating already-held rows merges each listing exactly once',
  dupBus.merged.length === 15, `merged ${dupBus.merged.length} (expected 10 + 5 new)`);

// ── 3. THE PRODUCER'S HALF still reports the failure this consumer now reads ─────────────────────
// If store.tsx ever stops emitting `failed`, the consumer above becomes dead code and the defect
// returns with every check here still green — so the two halves are pinned together.
const storeSrc = readFileSync(STORE, 'utf8');
check('store.tsx still reports failed:true on a backend-errored page, advancing nothing',
  /rows === null\) return \{ listings: \[\], nextOffset: offset, hasMore: true, failed: true \}/.test(storeSrc));

// ── 4. MUTATION PROOFS — each locked behaviour really falls RED ──────────────────────────────────
// M-drop: the exact pre-fix line. This is the defect, restored.
const mDrop = mutantOf(agentSrc,
  'const { listings: more, nextOffset, hasMore, failed } = await loadMoreListings(q, m.result.pageOffset ?? 0);',
  'const { listings: more, nextOffset, hasMore } = await loadMoreListings(q, m.result.pageOffset ?? 0);\n      const failed = undefined;');
const dropBus = await runLoadMore(mDrop, { listings: [], nextOffset: 0, hasMore: true, failed: true }, PAGE(10));
mustCatch('M-drop — ignoring `failed` reproduces the silent dead tap (no message, no cards)',
  dropBus.appended.length === 0 && dropBus.merged.length === 10,
  `appended ${dropBus.appended.length}, merged ${dropBus.merged.length}`);

// M-always: reporting a failure on every page would break the healthy path.
const mAlways = mutantOf(agentSrc, '      if (failed) {', '      if (true) {');
const alwaysBus = await runLoadMore(mAlways, { listings: PAGE(100, 10), nextOffset: 500, hasMore: true }, PAGE(10));
mustCatch('M-always — erroring on every page is caught by the success-path checks',
  alwaysBus.appended.length === 1 && alwaysBus.merged.length === 10,
  `appended ${alwaysBus.appended.length}, merged ${alwaysBus.merged.length}`);

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed — a failed «عرض المزيد» can reach the user as silence again.`);
  process.exit(1);
}
console.log('\n✓ a failed page is reported to the user, merges nothing, and advances no cursor; a healthy page is unaffected');
