// PERMANENT BARRIER: a FAILED «عرض المزيد» page is never rendered to the user as a successful
// nothing, and a SUCCESSFUL «عرض المزيد» tap really does drain every remaining page and finish the
// search. (ops_incident #33, owner routine-4 Search & Matching QA; redefined 2026-09-11, Task 4.)
//
// THE ORIGINAL DEFECT THIS EXISTED FOR. `loadMoreListings` (src/store.tsx) was hardened on
// 2026-09-04 to stop a backend error counting as progress: on `rows === null` it advances nothing
// and reports `failed: true`, so the cursor and `hasMore` come back exactly as they went in. That
// half was right. But the CONSUMER never read the flag —
//
//     const { listings: more, nextOffset, hasMore } = await loadMoreListings(...);   // ← no `failed`
//
// — and every downstream value then made the failure indistinguishable from success. A silent dead
// tap. That is AGENTS.md's "A FAILED FETCH IS NOT AN EMPTY ANSWER" rule violated one layer above the
// place it is usually violated: the fetch layer got it right and the render layer threw the answer
// away.
//
// THE 2026-09-11 REDEFINITION (Task 4). «عرض المزيد» no longer fetches one 100-boundary page per
// tap — one tap now DRAINS every remaining page (looping loadMoreListings until the server says
// hasMore=false) and then finishes the chat exactly like R11.1's small-set completion. The failure
// contract is unchanged and must survive the redefinition unbroken: a failure on ANY page in the
// drain still tells the user, merges nothing from that failed page, leaves the cursor where it was,
// and — new — must NEVER claim completion for a reveal that did not actually finish.
//
// WHY THIS BARRIER EXECUTES INSTEAD OF GREPPING. AGENTS.md is explicit: all five defects of
// 2026-09-04 had a source-TEXT tripwire over the exact line, and every one of those tripwires stayed
// green for as long as the defect was live. So this barrier LIFTS the real `loadMore` out of
// src/app/agent.tsx and RUNS it against a `loadMoreListings` that resolves the way real pages really
// resolve — including a multi-page drain. The assertion is about what the user is left with, not
// about which identifiers appear in a destructuring pattern.
//
// WHAT IS LOCKED (each falls RED under the named mutation, proven at the bottom):
//   1. On `failed`, the user is TOLD — a message is appended, carrying the same retry wording page 0
//      already uses for its own fetch failure.                  [M-drop: omit `failed` → RED]
//   2. On `failed`, NOTHING is merged and the cursor is NOT advanced — the next tap retries the
//      same page rather than skipping real matches — AND completion is NOT claimed.
//   3. A SUCCESSFUL single-page drain still merges its rows, advances the cursor, shows NO error,
//      and DOES finish the chat.                                [M-always: `if (true)` → RED]
//   4. A GENUINE MULTI-PAGE drain (two real fetches) merges rows from BOTH pages, gap-free, and only
//      finishes once the SECOND page says hasMore=false — never after the first.
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
const mustCatch = (label: string, caught: boolean, detail = '') => check(`MUTATION — ${label}`, caught, detail);


/** Write a deliberately broken copy of the real file so the REAL lift can be run against it. */
const mutantOf = (src: string, from: string, to: string): string => {
  if (!src.includes(from)) throw new Error(`mutation anchor missing:\n${from}`);
  const f = join(mkdtempSync(join(tmpdir(), 'ezhalah-loadmore-mut-')), 'mutant.tsx');
  writeFileSync(f, src.replace(from, to));
  return f;
};

// ── the seam: everything `loadMore` closes over is a recorder ────────────────────────────────────
// The branching, the ordering, the merge arithmetic and the message key are production's own.
type Page = { listings: { source: string; id: string }[]; nextOffset: number; hasMore: boolean; failed?: boolean };
type Bus = {
  pages: Page[];         // one entry consumed per loadMoreListings call, in order
  fetchCount: number;
  appended: { role: string; text: string }[];
  merged: { source: string; id: string }[];
  offset: number | null;
  cascades: [number, number][];
  loading: boolean[];
  completed: boolean | null; // null = never called
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
  'const cascadeIn = (_mid: string, from: number, target: number) => { bus.cascades.push([from, target]); };',
  'const setRevealCount = (_f: any) => {};',
  'const setLoadingMore = (f: any) => { bus.loading.push(true); void f({}); };',
  'const setCompleted = (v: boolean) => { bus.completed = v; };',
  'const MAX_DRAIN_PAGES = 50;', // the same backstop constant, declared as a component sibling of loadMore
  // Consumes one queued page per call — models a REAL multi-page drain, not a static single answer.
  // Running out of queued pages means "the real server would say there is nothing more" — the loop
  // must terminate on that, not on this harness running dry, so a mutation that keeps looping past
  // where the real fix would have stopped is caught by the check it actually breaks, not by a crash.
  'const loadMoreListings = async (_q: any, off: number) => {',
  '  bus.fetchCount++;',
  '  const p = bus.pages.shift();',
  '  return p ?? { listings: [], nextOffset: off, hasMore: false };',
  '};',
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

const runLoadMore = async (file: string, pages: Page[], fetched: { source: string; id: string }[]): Promise<Bus> => {
  gb.__bus = { pages: [...pages], fetchCount: 0, appended: [], merged: [...fetched], offset: 0, cascades: [], loading: [], completed: null };
  const m = await liftSymbols(
    file,
    [{ header: '  const loadMore = async (m: Extract<ChatMsg, { role: \'results\' }>) => {', endsWith: /^  \};$/ }],
    ['loadMore'],
    PRELUDE,
  );
  const fn = m.loadMore as (msg: unknown) => Promise<void>;
  await fn({ id: 'mid', role: 'results', result: { listings: fetched, hasMore: true, pageOffset: 0, query: { location: 'الرياض' } } });
  return gb.__bus;
};

const RETRY_KEY = 'Loading listings — please try again in a few seconds.';
const PAGE = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ source: 'aqar', id: `L${from + i}` }));

console.log('\nA failed «عرض المزيد» page is REPORTED, never shown as a successful nothing; a successful drain finishes the search\n');

// ── 1. THE FAILURE PATH, EXECUTED ────────────────────────────────────────────────────────────────
// Exactly what store.tsx returns on `rows === null`: nothing fetched, cursor unmoved, hasMore kept.
const failedBus = await runLoadMore(
  AGENT,
  [{ listings: [], nextOffset: 0, hasMore: true, failed: true }],
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
check('a failed drain never claims completion — the search is NOT finished',
  failedBus.completed !== true,
  `completed: ${failedBus.completed}`);

// ── 2. A SUCCESSFUL SINGLE-PAGE DRAIN — merges, cascades, and FINISHES the search ────────────────
// A fix that shows an error on a healthy page would be a worse defect than the one it replaced.
const okBus = await runLoadMore(
  AGENT,
  [{ listings: PAGE(100, 10), nextOffset: 500, hasMore: false }], // this IS the last page
  PAGE(10),
);
check('a SUCCESSFUL page merges its rows', okBus.merged.length === 110, `merged ${okBus.merged.length}`);
check('a SUCCESSFUL page advances the cursor', okBus.offset === 500, `pageOffset ${okBus.offset}`);
check('a SUCCESSFUL page shows NO error message', okBus.appended.length === 0,
  `appended: ${JSON.stringify(okBus.appended)}`);
check('a SUCCESSFUL page cascades the new cards in', okBus.cascades.length === 1,
  `cascades: ${JSON.stringify(okBus.cascades)}`);
check('a SUCCESSFUL drain that reaches hasMore=false FINISHES the search (Task 4)',
  okBus.completed === true, `completed: ${okBus.completed}`);

// De-duplication must survive the fix: a page that repeats a row the message already holds adds it
// once, never twice (§30 identity — source:id, never card text).
const dupBus = await runLoadMore(
  AGENT,
  [{ listings: [...PAGE(3, 0), ...PAGE(5, 10)], nextOffset: 500, hasMore: false }],
  PAGE(10),
);
check('a page repeating already-held rows merges each listing exactly once',
  dupBus.merged.length === 15, `merged ${dupBus.merged.length} (expected 10 + 5 new)`);

// ── 3. A GENUINE MULTI-PAGE DRAIN — two real fetches, both merged, gap-free ───────────────────────
// This is the actual NEW behaviour Task 4 asks for: one tap must not stop at the first page just
// because a page happened to arrive. Only the SECOND page's hasMore=false may finish the search.
const multiBus = await runLoadMore(
  AGENT,
  [
    { listings: PAGE(100, 10), nextOffset: 110, hasMore: true },   // page 1: more still exists
    { listings: PAGE(50, 110), nextOffset: 160, hasMore: false },  // page 2: the actual last page
  ],
  PAGE(10),
);
check('a multi-page drain calls loadMoreListings exactly twice (once per real page)',
  multiBus.fetchCount === 2, `fetchCount: ${multiBus.fetchCount}`);
check('a multi-page drain merges rows from BOTH pages, gap-free',
  multiBus.merged.length === 160, `merged ${multiBus.merged.length} (expected 10 + 100 + 50)`);
check('a multi-page drain advances the cursor to where the SECOND page left it',
  multiBus.offset === 160, `pageOffset ${multiBus.offset}`);
check('a multi-page drain finishes only once the drain genuinely has nothing left',
  multiBus.completed === true, `completed: ${multiBus.completed}`);
check('a multi-page drain shows no error along the way',
  multiBus.appended.length === 0, `appended: ${JSON.stringify(multiBus.appended)}`);

// A failure on the SECOND page of a drain must behave exactly like a failure on the first: the
// first page's rows are real and stay merged (nothing already landed is un-merged), but the drain
// stops, reports the failure, and does not claim completion.
const midDrainFailBus = await runLoadMore(
  AGENT,
  [
    { listings: PAGE(100, 10), nextOffset: 110, hasMore: true },
    { listings: [], nextOffset: 110, hasMore: true, failed: true },
  ],
  PAGE(10),
);
check('a failure on the SECOND page of a drain is still reported',
  midDrainFailBus.appended.length === 1 && midDrainFailBus.appended[0]?.text === RETRY_KEY,
  `appended: ${JSON.stringify(midDrainFailBus.appended)}`);
check('a failure on the SECOND page of a drain never claims completion',
  midDrainFailBus.completed !== true, `completed: ${midDrainFailBus.completed}`);

// ── 4. THE PRODUCER'S HALF still reports the failure this consumer now reads ─────────────────────
// If store.tsx ever stops emitting `failed`, the consumer above becomes dead code and the defect
// returns with every check here still green — so the two halves are pinned together.
const storeSrc = readFileSync(STORE, 'utf8');
check('store.tsx still reports failed:true on a backend-errored page, advancing nothing',
  /rows === null\) return \{ listings: \[\], nextOffset: offset, hasMore: true, failed: true \}/.test(storeSrc));

// ── 5. MUTATION PROOFS — each locked behaviour really falls RED ──────────────────────────────────
// M-drop: the exact pre-fix line. This is the defect, restored.
const mDrop = mutantOf(agentSrc,
  'const { listings: more, nextOffset, hasMore, failed } = await loadMoreListings(q, pageOffset);',
  'const { listings: more, nextOffset, hasMore } = await loadMoreListings(q, pageOffset);\n        const failed = undefined;');
const dropBus = await runLoadMore(mDrop, [{ listings: [], nextOffset: 0, hasMore: true, failed: true }], PAGE(10));
mustCatch('M-drop — ignoring `failed` reproduces the silent dead tap (no message, no cards)',
  dropBus.appended.length === 0 && dropBus.merged.length === 10,
  `appended ${dropBus.appended.length}, merged ${dropBus.merged.length}`);

// M-always: reporting a failure on every page would break the healthy path.
const mAlways = mutantOf(agentSrc, '        if (failed) {', '        if (true) {');
const alwaysBus = await runLoadMore(mAlways, [{ listings: PAGE(100, 10), nextOffset: 500, hasMore: false }], PAGE(10));
mustCatch('M-always — erroring on every page is caught by the success-path checks',
  alwaysBus.appended.length === 1 && alwaysBus.merged.length === 10,
  `appended ${alwaysBus.appended.length}, merged ${alwaysBus.merged.length}`);

// M-no-finish: a successful complete drain that forgets to call setCompleted would leave the user
// stuck — everything shown, but the composer still live and no New Chat offered.
const mNoFinish = mutantOf(agentSrc,
  'if (userChoseShowAllAndFinish) setCompleted(true);',
  'if (false) setCompleted(true);');
const noFinishBus = await runLoadMore(mNoFinish, [{ listings: PAGE(10, 10), nextOffset: 20, hasMore: false }], PAGE(10));
mustCatch('M-no-finish — a drain that reached the end but never finishes the chat is caught',
  noFinishBus.completed !== true, `completed: ${noFinishBus.completed}`);

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed — a failed «عرض المزيد» can reach the user as silence again, or a completed drain can fail to finish the search.`);
  process.exit(1);
}
console.log('\n✓ a failed page is reported to the user, merges nothing, and never claims completion; a successful single- or multi-page drain merges everything gap-free and finishes the search');
