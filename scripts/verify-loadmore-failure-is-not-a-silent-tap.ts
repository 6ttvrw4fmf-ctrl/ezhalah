// PERMANENT BARRIER: a FAILED «عرض المزيد» page is never rendered to the user as a successful
// nothing, and a SUCCESSFUL «عرض المزيد» tap reveals exactly what THIS press earned — the next
// 100-boundary on a first press, everything on a later one — finishing the search only once nothing
// is left to reveal. (ops_incident #33, owner routine-4 Search & Matching QA; redefined 2026-09-11
// Task 4, then REVISED the same day — Task 4 rev. 2 — before the one-tap-drains-everything version
// ever reached production.)
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
// THE TWO-PRESS RULE (Task 4 rev. 2). A FIRST tap on a turn (still at its initial-reveal floor)
// fetches and reveals only up to the next 100-boundary (`nextBatchTarget`), leaving any extra
// already-fetched rows buffered but unrevealed — the chat stays open, offering «عرض المزيد» and/or
// «خلّنا نحدد الطلب أكثر» again. A LATER tap (revealCount already past that floor) drains every
// remaining page and finishes the chat exactly like R11.1's small-set completion. Which branch a
// press takes is read from the turn's OWN reveal state — no separate "have I pressed before" flag.
// The failure contract is unchanged in both branches: a failure on ANY page tells the user, merges
// nothing from that failed page, leaves the cursor where it was, and never claims completion for a
// reveal that did not actually finish.
//
// WHY THIS BARRIER EXECUTES INSTEAD OF GREPPING. AGENTS.md is explicit: all five defects of
// 2026-09-04 had a source-TEXT tripwire over the exact line, and every one of those tripwires stayed
// green for as long as the defect was live. So this barrier LIFTS the real `loadMore` out of
// src/app/agent.tsx and RUNS it against a `loadMoreListings` that resolves the way real pages really
// resolve — including a multi-page drain and a pre-seeded "already expanded" reveal state to model
// the second press honestly, not just the first. The assertion is about what the user is left with,
// not about which identifiers appear in a destructuring pattern.
//
// WHAT IS LOCKED (each falls RED under the named mutation, proven at the bottom):
//   1. On `failed`, the user is TOLD — a message is appended, carrying the same retry wording page 0
//      already uses for its own fetch failure.                  [M-drop: omit `failed` → RED]
//   2. On `failed`, NOTHING is merged and the cursor is NOT advanced — the next tap retries the
//      same page rather than skipping real matches — AND completion is NOT claimed.
//   3. A FIRST press on a large total reveals only the next 100-boundary, buffers the rest, and does
//      NOT finish the chat — the exact behavior rev. 2 exists to lock in.
//   4. A FIRST press whose honest total already fits inside the boundary (a small set) still merges,
//      cascades, shows no error, and DOES finish — there is no dummy second press to force.
//                                                                 [M-always: `if (true)` → RED]
//   5. A LATER press (already past the initial floor) drains every remaining page — a genuine
//      multi-page drain merges BOTH pages, gap-free, and only finishes once the LAST page says
//      hasMore=false — never after the first of the two.
//
//   node --experimental-strip-types scripts/verify-loadmore-failure-is-not-a-silent-tap.ts
//   (auto-discovered by npm test — scripts/lib/testRegistry.ts)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
// The REAL boundary function, not a re-implementation — loadMore now calls this for its first-press
// target, so the lifted copy must reach the same one this file's own math tests already pin.
import { nextBatchTarget, drainPageBudget, DRAIN_ROW_BUDGET, LOAD_MORE_PAGE_SIZE, DRAIN_REVEAL_MAX } from '../src/data/resultCount.ts';
(globalThis as unknown as { __nextBatchTarget: typeof nextBatchTarget }).__nextBatchTarget = nextBatchTarget;
// The page backstop is a component-level sibling of loadMore, so the PRELUDE has to supply it — and
// it must supply the REAL one. Until 2026-09-12 the prelude declared a literal `50`, which is why
// every drain test here passed while production's own backstop was sized against the wrong page
// size AND threw away everything it had fetched when it tripped (see §BACKSTOP below).
(globalThis as unknown as { __drainPages: number }).__drainPages = drainPageBudget(LOAD_MORE_PAGE_SIZE);
// Same rule for the reveal ceiling: the REAL constant, so §CEILING measures the shipped bound.
(globalThis as unknown as { __revealMax: number }).__revealMax = DRAIN_REVEAL_MAX;

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
  revealedTo: number | null; // the reveal target this press actually wrote (instant or cascade end)
  // Pre-seeded so a test can model a LATER press: unset (undefined) means "still at the initial
  // floor" (10, from the stubbed initialReveal below) — a first press. Set to anything > 10 means
  // "already expanded past the floor" — the drain branch, exactly what a real second tap looks like.
  seedRevealCount?: number;
};
const gb = globalThis as unknown as { __bus: Bus };

const PRELUDE = [
  'const bus: any = (globalThis as any).__bus;',
  'const uid = () => "m-test";',
  'const t = (k: string) => k;',
  'const runRef = { current: null };',
  // Real shape: revealCount[mid] ?? initialReveal(m.result). Seeding it here — not by faking
  // initialReveal's return value — is what lets alreadyExpandedOnce read exactly as it does in the
  // real component: a first press has no entry (falls through to the floor), a later press has one.
  'const revealCount: any = bus.seedRevealCount != null ? { mid: bus.seedRevealCount } : {};',
  'const loadingMore: any = {};',
  'const initialReveal = (_r: any) => 10;',
  'const nextBatchTarget = (globalThis as any).__nextBatchTarget;',
  'const DRAIN_REVEAL_MAX = (globalThis as any).__revealMax;',
  'const cascadeIn = (_mid: string, from: number, target: number) => { bus.cascades.push([from, target]); bus.revealedTo = target; };',
  'const setRevealCount = (f: any) => { const next = f({}); bus.revealedTo = next.mid; };',
  'const setLoadingMore = (f: any) => { bus.loading.push(true); void f({}); };',
  'const setCompleted = (v: boolean) => { bus.completed = v; };',
  // The REAL backstop, computed by the shipped function from the shipped page size — never a
  // literal. A literal here is what made the backstop path untestable AND unfalsifiable.
  'const MAX_DRAIN_PAGES = (globalThis as any).__drainPages;',
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

const runLoadMore = async (
  file: string, pages: Page[], fetched: { source: string; id: string }[],
  opts?: { matchTotal?: number; seedRevealCount?: number },
): Promise<Bus> => {
  gb.__bus = {
    pages: [...pages], fetchCount: 0, appended: [], merged: [...fetched], offset: 0, cascades: [],
    loading: [], completed: null, revealedTo: null, seedRevealCount: opts?.seedRevealCount,
  };
  const m = await liftSymbols(
    file,
    [{ header: '  const loadMore = async (m: Extract<ChatMsg, { role: \'results\' }>) => {', endsWith: /^  \};$/ }],
    ['loadMore'],
    PRELUDE,
  );
  const fn = m.loadMore as (msg: unknown) => Promise<void>;
  await fn({
    id: 'mid', role: 'results',
    result: { listings: fetched, hasMore: true, pageOffset: 0, matchTotal: opts?.matchTotal, query: { location: 'الرياض' } },
  });
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

// ── 2. A FIRST PRESS ON A LARGE TOTAL — stops at the 100-boundary, does NOT finish ────────────────
// THE HEADLINE BEHAVIOR Task 4 rev. 2 exists to lock in: a turn nobody has expanded yet must not
// drain past the next hundred, no matter how much the single page it happens to fetch contains.
const firstPressBus = await runLoadMore(
  AGENT,
  [{ listings: PAGE(150, 10), nextOffset: 500, hasMore: true }], // one big page; plenty more exists
  PAGE(10),
  { matchTotal: 5000 },
);
check('a first press fetches only ONE page — it stops once the buffer covers the boundary',
  firstPressBus.fetchCount === 1, `fetchCount: ${firstPressBus.fetchCount}`);
check('a first press merges everything that page delivered (buffered, even if not all revealed)',
  firstPressBus.merged.length === 160, `merged ${firstPressBus.merged.length}`);
check('a first press REVEALS only the next 100-boundary, not the whole buffer',
  firstPressBus.revealedTo === 100, `revealedTo: ${firstPressBus.revealedTo}`);
check('a first press that stopped short of the buffer does NOT finish the chat',
  firstPressBus.completed !== true, `completed: ${firstPressBus.completed}`);
check('a first press shows no error — stopping at the boundary is not a failure',
  firstPressBus.appended.length === 0, `appended: ${JSON.stringify(firstPressBus.appended)}`);

// ── 3. A FIRST PRESS WHOSE HONEST TOTAL ALREADY FITS — merges, cascades, and FINISHES ─────────────
// No dummy second press is owed when there is nothing left to earn it: a total under the 100
// boundary reveals everything and finishes on the very first tap, same as before rev. 2.
const smallTotalBus = await runLoadMore(
  AGENT,
  [{ listings: PAGE(70, 10), nextOffset: 500, hasMore: false }], // this IS the last page
  PAGE(10),
  { matchTotal: 80 },
);
check('a small-total first press merges its rows', smallTotalBus.merged.length === 80, `merged ${smallTotalBus.merged.length}`);
check('a small-total first press advances the cursor', smallTotalBus.offset === 500, `pageOffset ${smallTotalBus.offset}`);
check('a small-total first press shows NO error message', smallTotalBus.appended.length === 0,
  `appended: ${JSON.stringify(smallTotalBus.appended)}`);
check('a small-total first press cascades the new cards in', smallTotalBus.cascades.length === 1,
  `cascades: ${JSON.stringify(smallTotalBus.cascades)}`);
check('a small-total first press reveals the TRUE total, not the 100-boundary',
  smallTotalBus.revealedTo === 80, `revealedTo: ${smallTotalBus.revealedTo}`);
check('a small-total first press FINISHES the search — nothing was left to reveal',
  smallTotalBus.completed === true, `completed: ${smallTotalBus.completed}`);

// De-duplication must survive the fix: a page that repeats a row the message already holds adds it
// once, never twice (§30 identity — source:id, never card text).
const dupBus = await runLoadMore(
  AGENT,
  [{ listings: [...PAGE(3, 0), ...PAGE(5, 10)], nextOffset: 500, hasMore: false }],
  PAGE(10),
);
check('a page repeating already-held rows merges each listing exactly once',
  dupBus.merged.length === 15, `merged ${dupBus.merged.length} (expected 10 + 5 new)`);

// ── 4. A LATER PRESS (already past the initial floor) — drains every remaining page ───────────────
// This is what a SECOND tap on the same turn looks like: `seedRevealCount` models a turn already
// expanded once, so this press must not stop at any 100-boundary — it drains until the server
// genuinely has nothing left, exactly the multi-page mechanic Task 4 introduced, now gated to the
// press that has earned it.
const multiBus = await runLoadMore(
  AGENT,
  [
    { listings: PAGE(100, 10), nextOffset: 110, hasMore: true },   // page 1: more still exists
    { listings: PAGE(50, 110), nextOffset: 160, hasMore: false },  // page 2: the actual last page
  ],
  PAGE(10),
  { seedRevealCount: 100 },
);
check('a later-press drain calls loadMoreListings exactly twice (once per real page)',
  multiBus.fetchCount === 2, `fetchCount: ${multiBus.fetchCount}`);
check('a later-press drain merges rows from BOTH pages, gap-free',
  multiBus.merged.length === 160, `merged ${multiBus.merged.length} (expected 10 + 100 + 50)`);
check('a later-press drain advances the cursor to where the SECOND page left it',
  multiBus.offset === 160, `pageOffset ${multiBus.offset}`);
check('a later-press drain reveals EVERYTHING merged, not a 100-boundary',
  multiBus.revealedTo === 160, `revealedTo: ${multiBus.revealedTo}`);
check('a later-press drain finishes only once the drain genuinely has nothing left',
  multiBus.completed === true, `completed: ${multiBus.completed}`);
check('a later-press drain shows no error along the way',
  multiBus.appended.length === 0, `appended: ${JSON.stringify(multiBus.appended)}`);

// A failure on the SECOND page of a later-press drain must behave exactly like a failure on the
// first: the first page's rows are real and stay merged (nothing already landed is un-merged), but
// the drain stops, reports the failure, and does not claim completion.
const midDrainFailBus = await runLoadMore(
  AGENT,
  [
    { listings: PAGE(100, 10), nextOffset: 110, hasMore: true },
    { listings: [], nextOffset: 110, hasMore: true, failed: true },
  ],
  PAGE(10),
  { seedRevealCount: 100 },
);
check('a failure on the SECOND page of a later-press drain is still reported',
  midDrainFailBus.appended.length === 1 && midDrainFailBus.appended[0]?.text === RETRY_KEY,
  `appended: ${JSON.stringify(midDrainFailBus.appended)}`);
check('a failure on the SECOND page of a later-press drain never claims completion',
  midDrainFailBus.completed !== true, `completed: ${midDrainFailBus.completed}`);

// ── §BACKSTOP. A PRESS THAT HITS THE PAGE BUDGET ADVANCES THE USER — it never discards the pages ──
// THE DEFECT THIS SECTION EXISTS FOR (found on production 2026-09-12, live sweep red 3 days running).
// The drain's page backstop used to `return`, skipping the merge and the reveal, so every row the
// press had just fetched was thrown away. Measured on الرياض, 37,532 matching: the second press
// fired 50 RPC searches over 3.5 minutes, added ZERO cards, posted «حاول مرة ثانية بعد لحظات», and —
// because nothing about the turn's state had advanced — the next press reproduced it exactly.
// Match 101 of 37,532 was unreachable by any route, and each attempt cost production 50 searches.
//
// Nothing here could catch it before, in TWO independent ways, which is why both are fixed:
//   · every drain scenario above queues 2 pages, so the backstop branch was never once executed;
//   · the PRELUDE declared `MAX_DRAIN_PAGES = 50` as a literal, so even a test that had tripped it
//     would have been asserting against a number this barrier made up rather than the shipped one.
// ── §CEILING. ONE PRESS NEVER REVEALS MORE THAN THE PRODUCT CAN RENDER ───────────────────────────
// MEASURED ON PRODUCTION 2026-09-12, unmodified code: الرياض/إيجار/سنوي (20,782 matching) — press 2
// drained 40 pages and the RENDERER PROCESS CRASHED while mounting the cards. The list is
// unvirtualized, so "reveal everything" is not implementable at that size; الخبر's 5,706 rendered
// fine, so the ceiling sits well under it. A press over the ceiling must reveal exactly the
// ceiling, keep «عرض المزيد», and NOT finish the search.
{
  // A cohort far larger than the ceiling, served in real pages.
  const pages = Array.from({ length: 40 }, (_, i) => ({
    listings: PAGE(LOAD_MORE_PAGE_SIZE, 100 + i * LOAD_MORE_PAGE_SIZE),
    nextOffset: 100 + (i + 1) * LOAD_MORE_PAGE_SIZE, hasMore: true,
  }));
  const bus = await runLoadMore(AGENT, pages, PAGE(100), { seedRevealCount: 100, matchTotal: 20_782 });
  check('§CEILING a later press reveals at most DRAIN_REVEAL_MAX new cards',
    bus.revealedTo === 100 + DRAIN_REVEAL_MAX,
    `revealedTo ${bus.revealedTo} (expected ${100 + DRAIN_REVEAL_MAX}) — an unbounded reveal is what crashed the tab`);
  check('§CEILING the search is NOT finished while matches remain beyond the ceiling',
    bus.completed !== true, `completed: ${bus.completed}`);
  check('§CEILING bounding the reveal also bounds the FETCH — a tap costs a few RPCs, not 40',
    bus.fetchCount <= Math.ceil(DRAIN_REVEAL_MAX / LOAD_MORE_PAGE_SIZE) + 1,
    `fetchCount ${bus.fetchCount} for a ${DRAIN_REVEAL_MAX}-row ceiling at ${LOAD_MORE_PAGE_SIZE} rows/page`);
  check('§CEILING nothing is discarded — every fetched row is merged into the buffer',
    bus.merged.length >= 100 + DRAIN_REVEAL_MAX, `merged ${bus.merged.length}`);
}
{
  // A cohort that FITS under the ceiling still drains to the end and finishes — the owner's
  // 2026-09-11 rule is untouched wherever it is implementable, which is the common case.
  const bus = await runLoadMore(AGENT,
    [{ listings: PAGE(400, 100), nextOffset: 500, hasMore: true },
     { listings: PAGE(120, 500), nextOffset: 620, hasMore: false }],
    PAGE(100), { seedRevealCount: 100, matchTotal: 620 });
  check('§CEILING a cohort UNDER the ceiling still drains to the end in one press',
    bus.merged.length === 620 && bus.revealedTo === 620,
    `merged ${bus.merged.length}, revealedTo ${bus.revealedTo}`);
  check('§CEILING a cohort UNDER the ceiling still FINISHES the search (owner rule intact)',
    bus.completed === true, `completed: ${bus.completed}`);
}

const BUDGET = drainPageBudget(LOAD_MORE_PAGE_SIZE);
// More pages than the budget allows, every one of them saying "there is still more after me" —
// i.e. a genuinely enormous cohort, exactly الرياض's shape.
const overBudget = Array.from({ length: BUDGET + 10 }, (_, i) => ({
  listings: PAGE(1, 10 + i), nextOffset: 11 + i, hasMore: true,
}));
const backstopBus = await runLoadMore(AGENT, overBudget, PAGE(10), { seedRevealCount: 100 });

check('§BACKSTOP the drain really is bounded — it stops at the budget, not at the server',
  backstopBus.fetchCount === BUDGET,
  `fetchCount ${backstopBus.fetchCount} (budget ${BUDGET})`);
check('§BACKSTOP every row the press fetched is MERGED, not discarded',
  backstopBus.merged.length === 10 + BUDGET,
  `merged ${backstopBus.merged.length} (expected the original 10 + ${BUDGET} fetched)`);
check('§BACKSTOP the user actually ADVANCES — the reveal grows past where the press started',
  backstopBus.revealedTo === 10 + BUDGET,
  `revealedTo ${backstopBus.revealedTo} (expected ${10 + BUDGET}); a stranded press reveals nothing new`);
check('§BACKSTOP the cursor advances, so the NEXT press resumes instead of refetching page 1',
  backstopBus.offset != null && backstopBus.offset > 0,
  `pageOffset ${backstopBus.offset}`);
check('§BACKSTOP the search is NOT claimed finished — matches remain, so «عرض المزيد» must stay',
  backstopBus.completed !== true, `completed: ${backstopBus.completed}`);
check('§BACKSTOP nothing FAILED, so the retry message is not shown',
  !backstopBus.appended.some((a) => a.text === RETRY_KEY),
  `appended: ${JSON.stringify(backstopBus.appended)}`);

// The budget is arithmetic over the page size actually used — not a number anyone can drift.
check('§BACKSTOP the budget is derived from the real page size, covering the whole row budget',
  BUDGET * LOAD_MORE_PAGE_SIZE >= DRAIN_ROW_BUDGET,
  `${BUDGET} pages × ${LOAD_MORE_PAGE_SIZE} rows < ${DRAIN_ROW_BUDGET}`);
check('§BACKSTOP drainPageBudget rounds UP so the last partial page is still reachable',
  drainPageBudget(500, 25_000) === 50 && drainPageBudget(500, 25_001) === 51 && drainPageBudget(1500, 25_000) === 17,
  `got ${drainPageBudget(500, 25_000)}/${drainPageBudget(500, 25_001)}/${drainPageBudget(1500, 25_000)}`);
check('§BACKSTOP drainPageBudget never returns 0 — a zero budget would fetch nothing at all',
  drainPageBudget(500, 0) === 1 && drainPageBudget(0, 25_000) >= 1);
// ONE definition of the page size. Two copies is the exact drift that sized the old backstop
// against 1,500 while the loader paged at 500.
check('§BACKSTOP agent.tsx derives the backstop instead of hardcoding a page count',
  /const MAX_DRAIN_PAGES = drainPageBudget\(LOAD_MORE_PAGE_SIZE\)/.test(agentSrc)
  && !/const MAX_DRAIN_PAGES = \d+/.test(agentSrc),
  'MAX_DRAIN_PAGES must be computed from the shipped page size, never a literal');

// ── 4. THE PRODUCER'S HALF still reports the failure this consumer now reads ─────────────────────
// If store.tsx ever stops emitting `failed`, the consumer above becomes dead code and the defect
// returns with every check here still green — so the two halves are pinned together.
const storeSrc = readFileSync(STORE, 'utf8');
check('store.tsx still reports failed:true on a backend-errored page, advancing nothing',
  /rows === null\) return \{ listings: \[\], nextOffset: offset, hasMore: true, failed: true \}/.test(storeSrc));
// …and still pages at the SAME size the drain budget is derived from. A second private literal here
// is precisely how the old backstop came to cover 25,000 rows while its comment claimed 75,000.
check('store.tsx pages at the shared LOAD_MORE_PAGE_SIZE, not a private copy of the number',
  /const PAGE_MORE = LOAD_MORE_PAGE_SIZE;/.test(storeSrc) && !/const PAGE_MORE = \d+/.test(storeSrc),
  'PAGE_MORE must be the shared constant so the page size has exactly one definition');

// ── 5. MUTATION PROOFS — each locked behaviour really falls RED ──────────────────────────────────
// M-always-drain: THE regression this whole rev. 2 file update exists to catch — reverting to Task
// 4's original "every press drains everything" by hardcoding alreadyExpandedOnce true. Proves the
// first-press checks above are not vacuous: without the gate, a FIRST press on a 5,000-match search
// would drain and finish immediately, exactly the behavior the owner asked to delay behind a choice.
const mAlwaysDrain = mutantOf(agentSrc,
  'const alreadyExpandedOnce = cur > initialReveal(m.result);',
  'const alreadyExpandedOnce = true;');
const alwaysDrainBus = await runLoadMore(
  mAlwaysDrain,
  [{ listings: PAGE(150, 10), nextOffset: 500, hasMore: true }],
  PAGE(10),
  { matchTotal: 5000 },
);
mustCatch('M-always-drain — a first press that ignores the gate reveals past the 100-boundary',
  alwaysDrainBus.revealedTo !== 100, `revealedTo: ${alwaysDrainBus.revealedTo}`);

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

// M-backstop-discards: THE 2026-09-12 defect, restored exactly as it shipped — the backstop that
// `return`s instead of falling through to the merge. Proves the §BACKSTOP checks are not vacuous:
// with the old line back, a press over the budget fetches 50 pages and hands the user NOTHING.
const mBackstopDiscards = mutantOf(agentSrc,
  'if (++pages > MAX_DRAIN_PAGES) break;',
  `if (++pages > MAX_DRAIN_PAGES) {
          setMsgs((prev) => [...prev, { id: uid(), role: 'agent',
            text: t('Loading listings — please try again in a few seconds.') }]);
          return;
        }`);
const discardBus = await runLoadMore(mBackstopDiscards, overBudget.map((p) => ({ ...p })), PAGE(10), { seedRevealCount: 100 });
mustCatch('M-backstop-discards — a backstop that returns strands the user on zero new cards',
  discardBus.merged.length === 10 && discardBus.revealedTo === null,
  `merged ${discardBus.merged.length}, revealedTo ${discardBus.revealedTo} — the mutant must show the stranding`);

// M-unbounded: removing the backstop entirely would let ONE tap walk the server forever — 76 pages
// for الرياض today, unbounded if `hasMore` ever sticks. The budget check above must catch that.
const mUnbounded = mutantOf(agentSrc,
  'if (++pages > MAX_DRAIN_PAGES) break;',
  'if (++pages > Number.MAX_SAFE_INTEGER) break;');
const unboundedBus = await runLoadMore(mUnbounded, overBudget.map((p) => ({ ...p })), PAGE(10), { seedRevealCount: 100 });
mustCatch('M-unbounded — a drain with no page budget runs past it and is caught',
  unboundedBus.fetchCount > BUDGET, `fetchCount ${unboundedBus.fetchCount} (budget ${BUDGET})`);

// M-unbounded-reveal: THE CRASH, restored — a later press targeting Infinity, exactly the code that
// mounted ~20,000 cards and killed the renderer on production. Proves §CEILING is not vacuous.
const mUnboundedReveal = mutantOf(agentSrc,
  'const target = alreadyExpandedOnce ? cur + DRAIN_REVEAL_MAX : nextBatchTarget(cur, m.result.matchTotal ?? Infinity);',
  'const target = alreadyExpandedOnce ? Infinity : nextBatchTarget(cur, m.result.matchTotal ?? Infinity);');
{
  const pages = Array.from({ length: 40 }, (_, i) => ({
    listings: PAGE(LOAD_MORE_PAGE_SIZE, 100 + i * LOAD_MORE_PAGE_SIZE),
    nextOffset: 100 + (i + 1) * LOAD_MORE_PAGE_SIZE, hasMore: true,
  }));
  const bus = await runLoadMore(mUnboundedReveal, pages, PAGE(100), { seedRevealCount: 100, matchTotal: 20_782 });
  mustCatch('M-unbounded-reveal — a press that reveals the whole cohort blows past the ceiling',
    (bus.revealedTo ?? 0) > 100 + DRAIN_REVEAL_MAX,
    `revealedTo ${bus.revealedTo} — the mutant must exceed the ceiling the fix imposes`);
}

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
