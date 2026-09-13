// PERMANENT BARRIER: «عرض المزيد» is pressed REPEATEDLY by real users, so the reveal ceiling must be
// measured across a SEQUENCE of presses — not one. (ops_incident #212, P1, owner routine-4 Search &
// Matching QA; found by routine-8 regression hunter 2026-09-12, reproduced by execution 2026-09-13.)
//
// WHY THIS FILE EXISTS SEPARATELY FROM verify-loadmore-failure-is-not-a-silent-tap.ts.
// That barrier's §CEILING is correct about what it tests and blind to what it does not: it seeds
// exactly ONE press (`seedRevealCount: 100`) and asserts the resulting reveal is within
// `cur + DRAIN_REVEAL_MAX`. Every press in isolation passes that. The user does not press in
// isolation. Threading each press's own output state into the next — which is all a second tap on
// the same turn IS — walks the mount straight past the size the constant exists to stay under:
//
//     press 1 →    100 mounted      press 4 →  6,100      press 11 → 20,100
//     press 2 →  2,100              press 5 →  8,100      press 12 → 21,010  ← and finishes
//     press 3 →  4,100                 …
//
// against a cohort (الرياض/إيجار/سنوي, 20,782 matching) whose renderer CRASH was measured on
// production at 20,782 mounted, and whose only size PROVEN to render is 5,706. The ceiling is
// exceeded at press 3 and the crash size is reached at press 12, by pressing one button.
//
// THE ROOT CAUSE, stated once: `src/app/agent.tsx` computes
//     const target = alreadyExpandedOnce ? cur + DRAIN_REVEAL_MAX : nextBatchTarget(...)
// so DRAIN_REVEAL_MAX bounds the DELTA of one press and never the resulting mount. The constant's
// own note justifies its VALUE with a total-mount measurement ("2,000 keeps a 2.8× margin under the
// only measured-good point (5,706)") while the code spends it per press. That mismatch is the bug.
//
// WHAT THIS BARRIER CAN AND CANNOT DO. It cannot assert "the cumulative mount is bounded" — that is
// FALSE in production today, and a barrier asserting it would be RED on main for every unrelated PR.
// Closing the gap for real needs either a virtualized results list (bound the MOUNT, leave the
// reveal unbounded — the only answer that keeps every owner contract) or an owner decision to cap
// cumulative reveal (which re-introduces the 2026-08-20 lifetime cap the owner removed, and turns
// «عرض المزيد» into the dead button verify-loadmore-failure-is-not-a-silent-tap.ts exists to
// forbid). Both are owner calls; #212 carries them. See docs/ops/SEARCH_MATCH_QA_ENGINEER.md §10.
//
// So what it DOES lock is the part that is unambiguously ours, and it is the part that actually
// protects users between now and that decision:
//
//   1. THE SEQUENCE IS EXECUTED, NOT ASSUMED. Chained presses run the REAL lifted `loadMore`. The
//      blind spot that let #212 ship — a ceiling verified only at press 1 — cannot reopen silently.
//   2. ONE PRESS CAN NEVER ALONE MOUNT AN UNRENDERABLE LIST. `DRAIN_REVEAL_MAX` must stay at or
//      under RENDER_PROVEN_SAFE (5,706). Today it is 2,000. Raising it past the only size proven to
//      render would make press 2 — the ordinary second tap, on the most common search in the
//      product — a dead tab on its own. That is the live regression risk this file forbids.
//   3. THE DELTA BOUND HOLDS ON EVERY PRESS, not just the first: no press in the sequence may reveal
//      more than DRAIN_REVEAL_MAX new cards.
//   4. THE KNOWN GAP IS MEASURED AND NAMED, by execution, so it can only shrink. `PRESSES_TO_*` are
//      recorded from the real run; a change that makes the walk STEEPER (fewer presses to reach an
//      unrenderable mount) fails here loudly instead of shipping.
//
//   node --experimental-strip-types scripts/verify-loadmore-cumulative-mount-is-bounded.ts
//   (auto-discovered by npm test — scripts/lib/testRegistry.ts)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { nextBatchTarget, drainPageBudget, LOAD_MORE_PAGE_SIZE, DRAIN_REVEAL_MAX } from '../src/data/resultCount.ts';

// ── The two production measurements this whole file is calibrated against ────────────────────────
// Both were taken on production, 2026-09-12, on unmodified code (PR #2377; see the DRAIN_REVEAL_MAX
// note in src/data/resultCount.ts). They are measurements, never preferences — revisit them only
// with a new measurement.
const RENDER_PROVEN_SAFE = 5_706;   // الخبر: revealed in full, rendered fine
const RENDER_CRASH_MEASURED = 20_782; // الرياض/إيجار/سنوي: renderer process CRASHED

const root = join(import.meta.dirname, '..');
const AGENT = join(root, 'src/app/agent.tsx');
const agentSrc = readFileSync(AGENT, 'utf8');

(globalThis as unknown as { __nextBatchTarget: typeof nextBatchTarget }).__nextBatchTarget = nextBatchTarget;
(globalThis as unknown as { __drainPages: number }).__drainPages = drainPageBudget(LOAD_MORE_PAGE_SIZE);
(globalThis as unknown as { __revealMax: number }).__revealMax = DRAIN_REVEAL_MAX;

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean, detail = '') => check(`MUTATION — ${label}`, caught, detail);

const mutantOf = (src: string, from: string, to: string): string => {
  if (!src.includes(from)) throw new Error(`mutation anchor missing:\n${from}`);
  const f = join(mkdtempSync(join(tmpdir(), 'ezhalah-cumulative-mut-')), 'mutant.tsx');
  writeFileSync(f, src.replace(from, to));
  return f;
};

// ── the seam ─────────────────────────────────────────────────────────────────────────────────────
// Same shape as verify-loadmore-failure-is-not-a-silent-tap.ts's bus: every value `loadMore` closes
// over is a recorder, and the branching/merge arithmetic is production's own. The ONE thing this
// file adds is that the bus is re-seeded from the PREVIOUS press's result instead of from a literal.
type Row = { source: string; id: string };
type Page = { listings: Row[]; nextOffset: number; hasMore: boolean; failed?: boolean };
type Bus = {
  pages: Page[]; fetchCount: number; appended: { role: string; text: string }[];
  merged: Row[]; offset: number | null; cascades: [number, number][]; loading: boolean[];
  completed: boolean | null; revealedTo: number | null; seedRevealCount?: number;
};
const gb = globalThis as unknown as { __bus: Bus };

const PRELUDE = [
  'const bus: any = (globalThis as any).__bus;',
  'const uid = () => "m-test";',
  'const t = (k: string) => k;',
  'const runRef = { current: null };',
  'const revealCount: any = bus.seedRevealCount != null ? { mid: bus.seedRevealCount } : {};',
  'const loadingMore: any = {};',
  'const initialReveal = (_r: any) => 10;',
  'const nextBatchTarget = (globalThis as any).__nextBatchTarget;',
  'const DRAIN_REVEAL_MAX = (globalThis as any).__revealMax;',
  'const cascadeIn = (_mid: string, from: number, target: number) => { bus.cascades.push([from, target]); bus.revealedTo = target; };',
  'const setRevealCount = (f: any) => { const next = f({}); bus.revealedTo = next.mid; };',
  'const setLoadingMore = (f: any) => { bus.loading.push(true); void f({}); };',
  'const setCompleted = (v: boolean) => { bus.completed = v; };',
  'const MAX_DRAIN_PAGES = (globalThis as any).__drainPages;',
  'const loadMoreListings = async (_q: any, off: number) => {',
  '  bus.fetchCount++;',
  '  const p = bus.pages.shift();',
  '  return p ?? { listings: [], nextOffset: off, hasMore: false };',
  '};',
  'const setMsgs = (f: any) => {',
  '  const msg: any = { id: "mid", role: "results", result: { listings: bus.merged, pageOffset: bus.offset, hasMore: true, query: {} } };',
  '  const out = f([msg]);',
  '  for (const m of out) {',
  '    if (m.role === "agent") bus.appended.push({ role: m.role, text: m.text });',
  '    if (m.role === "results" && m.result) { bus.merged = m.result.listings; bus.offset = m.result.pageOffset; }',
  '  }',
  '};',
].join('\n');

const PAGE = (n: number, from = 0): Row[] =>
  Array.from({ length: n }, (_, i) => ({ source: 'aqar', id: `L${from + i}` }));

/** One «عرض المزيد» press against the REAL lifted loadMore, starting from the given turn state. */
const press = async (
  file: string, matchTotal: number,
  state: { fetched: Row[]; revealed: number | undefined; offset: number },
): Promise<Bus> => {
  // Enough queued pages that a press is never starved by the harness rather than by the product —
  // but never MORE rows than the cohort actually has. A generator that ignores `matchTotal` hands
  // back a buffer larger than the search, and the overshoot then reads as the product revealing
  // rows that do not exist (it made §4 below report 1,510 mounted for a 1,200-row cohort on this
  // file's first run). §40.7: a harness artifact must never be reported as a product failure.
  const pages: Page[] = Array.from({ length: 60 }, (_, i) => {
    const from = state.offset + i * LOAD_MORE_PAGE_SIZE;
    const size = Math.max(0, Math.min(LOAD_MORE_PAGE_SIZE, matchTotal - from));
    return { listings: PAGE(size, from), nextOffset: from + size, hasMore: from + size < matchTotal };
  });
  gb.__bus = {
    pages, fetchCount: 0, appended: [], merged: [...state.fetched], offset: state.offset,
    cascades: [], loading: [], completed: null, revealedTo: null, seedRevealCount: state.revealed,
  };
  const m = await liftSymbols(
    file,
    [{ header: '  const loadMore = async (m: Extract<ChatMsg, { role: \'results\' }>) => {', endsWith: /^  \};$/ }],
    ['loadMore'],
    PRELUDE,
  );
  await (m.loadMore as (msg: unknown) => Promise<void>)({
    id: 'mid', role: 'results',
    result: {
      listings: state.fetched, hasMore: true, pageOffset: state.offset,
      matchTotal, query: { location: 'الرياض' },
    },
  });
  return gb.__bus;
};

/** Drive presses until the search finishes or `max` is reached; return the mount after each. */
const pressSequence = async (file: string, matchTotal: number, max: number): Promise<number[]> => {
  const mounts: number[] = [];
  const state = { fetched: PAGE(10), revealed: undefined as number | undefined, offset: 10 };
  for (let i = 0; i < max; i++) {
    const bus = await press(file, matchTotal, state);
    state.fetched = bus.merged;
    state.revealed = bus.revealedTo ?? state.revealed;
    state.offset = bus.offset ?? state.offset;
    mounts.push(state.revealed ?? 0);
    if (bus.completed === true) break;
  }
  return mounts;
};

console.log('\n«عرض المزيد» is pressed repeatedly — the reveal ceiling is measured across the SEQUENCE, not at press 1\n');

// ── 1. ONE PRESS CAN NEVER ALONE MOUNT AN UNRENDERABLE LIST ──────────────────────────────────────
// This is the live regression this file forbids. The per-press bound is the ONLY bound that exists
// today, so it has to stay under the only size proven to render — otherwise the ordinary SECOND tap
// on the most common search in the product is a dead tab by itself, with no sequence required.
check('§1 DRAIN_REVEAL_MAX stays at or under the only mount size PROVEN to render on production',
  DRAIN_REVEAL_MAX <= RENDER_PROVEN_SAFE,
  `DRAIN_REVEAL_MAX=${DRAIN_REVEAL_MAX} vs RENDER_PROVEN_SAFE=${RENDER_PROVEN_SAFE} — a single press could mount an unrenderable list`);
check('§1 DRAIN_REVEAL_MAX stays well under the mount size that CRASHED the renderer',
  DRAIN_REVEAL_MAX < RENDER_CRASH_MEASURED,
  `DRAIN_REVEAL_MAX=${DRAIN_REVEAL_MAX} vs RENDER_CRASH_MEASURED=${RENDER_CRASH_MEASURED}`);

// ── 2. THE DELTA BOUND HOLDS ON EVERY PRESS, NOT JUST THE FIRST ──────────────────────────────────
const mounts = await pressSequence(AGENT, RENDER_CRASH_MEASURED, 14);
const deltas = mounts.map((m, i) => m - (i === 0 ? 0 : mounts[i - 1]));
check('§2 the sequence really runs the real loadMore more than once',
  mounts.length >= 3, `mounts: ${JSON.stringify(mounts)}`);
check('§2 no single press in the sequence reveals more than DRAIN_REVEAL_MAX new cards',
  deltas.every((d) => d <= DRAIN_REVEAL_MAX),
  `deltas: ${JSON.stringify(deltas)} against DRAIN_REVEAL_MAX=${DRAIN_REVEAL_MAX}`);
// EVERY press must ADVANCE the user while matches remain. This is the "silent tap" contract of
// verify-loadmore-failure-is-not-a-silent-tap.ts extended from one press to the sequence — and it is
// the check that makes the naive "fix" for #212 fail loudly: clamping cumulative reveal to a
// constant leaves «عرض المزيد» rendered and pressable while doing nothing, which is a dead button,
// not a safety bound. Any real fix has to bound the MOUNT without stranding the user (a virtualized
// list), or retire the affordance honestly — never leave it offered and inert.
const advancing = mounts.every((m, i) => i === 0 || m > mounts[i - 1]);
check('§2 every press in the sequence ADVANCES the mount — no dead press while matches remain',
  advancing, `mounts: ${JSON.stringify(mounts)} — a flat step is a rendered, pressable button that does nothing`);

// ── 3. THE KNOWN GAP, MEASURED BY EXECUTION AND RATCHETED ────────────────────────────────────────
// These are NOT an endorsement of the gap; they are its size, recorded so it cannot quietly widen.
// `>=` on both: a change that needs MORE presses to reach an unrenderable mount is an improvement
// and passes; a change that gets there FASTER is a regression and fails. When #212 is properly
// fixed — a virtualized list, or an owner-approved cumulative cap — both become Infinity and this
// section should be replaced by the real assertion ("cumulative mount is bounded, period").
const PRESSES_TO_EXCEED_PROVEN_SAFE = 4;   // measured 2026-09-13: press 4 → 6,100 > 5,706
const PRESSES_TO_REACH_CRASH_SIZE = 12;    // measured 2026-09-13: press 12 → 21,010 > 20,782
// AT OR OVER, never strictly over: the cohort under test has exactly RENDER_CRASH_MEASURED matches,
// so a strict `>` could never be satisfied and that check would silently be unfailable — the shape
// AGENTS.md calls decoration. Mounting exactly the size that crashed production IS the crash.
const firstOver = (limit: number) => {
  const i = mounts.findIndex((m) => m >= limit);
  return i === -1 ? Infinity : i + 1;
};
check('§3 reaching an unrenderable mount does not get FASTER than the recorded measurement',
  firstOver(RENDER_PROVEN_SAFE) >= PRESSES_TO_EXCEED_PROVEN_SAFE,
  `presses to exceed ${RENDER_PROVEN_SAFE}: ${firstOver(RENDER_PROVEN_SAFE)}, recorded ${PRESSES_TO_EXCEED_PROVEN_SAFE} — mounts ${JSON.stringify(mounts)}`);
check('§3 reaching the measured CRASH mount does not get FASTER than the recorded measurement',
  firstOver(RENDER_CRASH_MEASURED) >= PRESSES_TO_REACH_CRASH_SIZE,
  `presses to reach ${RENDER_CRASH_MEASURED}: ${firstOver(RENDER_CRASH_MEASURED)}, recorded ${PRESSES_TO_REACH_CRASH_SIZE} — mounts ${JSON.stringify(mounts)}`);
console.log(`      [#212 open gap, measured] mounts by press: ${JSON.stringify(mounts)}`);

// ── 4. A COHORT UNDER THE CEILING IS UNAFFECTED — the owner's rule still holds where it can ──────
// Guards against a "fix" that buys safety by breaking the common case: a set that fits under the
// ceiling must still drain and FINISH on the second press, exactly as owner rule 2026-09-11 says.
{
  const small = await pressSequence(AGENT, 1_200, 6);
  check('§4 a cohort under the ceiling still finishes in two presses, with every match revealed (owner rule 2026-09-11 intact)',
    small.length === 2 && small[small.length - 1] === 1_200,
    `mounts: ${JSON.stringify(small)} — expected [100, 1200]`);
}

// ── MUTATION PROOFS ──────────────────────────────────────────────────────────────────────────────
// M-steeper: raise the per-press ceiling so the walk reaches an unrenderable mount FASTER. This is
// the regression §1 and §3 exist for — and the one a per-press-only barrier cannot see at all.
{
  const mSteeper = mutantOf(agentSrc,
    'const target = alreadyExpandedOnce ? cur + DRAIN_REVEAL_MAX : nextBatchTarget(cur, m.result.matchTotal ?? Infinity);',
    'const target = alreadyExpandedOnce ? cur + DRAIN_REVEAL_MAX * 5 : nextBatchTarget(cur, m.result.matchTotal ?? Infinity);');
  const mutantMounts = await pressSequence(mSteeper, RENDER_CRASH_MEASURED, 14);
  const mutantFirstOver = mutantMounts.findIndex((m) => m > RENDER_PROVEN_SAFE) + 1;
  mustCatch('M-steeper — a bigger per-press reveal reaches an unrenderable mount in fewer presses',
    mutantFirstOver > 0 && mutantFirstOver < PRESSES_TO_EXCEED_PROVEN_SAFE,
    `mutant reached ${RENDER_PROVEN_SAFE} at press ${mutantFirstOver}; recorded ${PRESSES_TO_EXCEED_PROVEN_SAFE} — mounts ${JSON.stringify(mutantMounts)}`);
  // And the delta bound in §2 must itself be falsifiable, or §2 is decoration.
  const mutantDeltas = mutantMounts.map((m, i) => m - (i === 0 ? 0 : mutantMounts[i - 1]));
  mustCatch('M-steeper — §2\'s per-press delta bound really fails when a press reveals more',
    !mutantDeltas.every((d) => d <= DRAIN_REVEAL_MAX),
    `mutant deltas: ${JSON.stringify(mutantDeltas)}`);
}

// M-dead-press: the naive cumulative cap — clamp the mount to a constant and leave «عرض المزيد»
// exactly as it is. This is the shape a well-meaning #212 "fix" takes, and §2 must refuse it: the
// sequence goes flat while matches remain, i.e. a rendered, pressable button that does nothing.
{
  const mDeadPress = mutantOf(agentSrc,
    'const revealTo = Math.min(target, mergedLen);',
    'const revealTo = Math.min(target, mergedLen, 2_000);');
  const flat = await pressSequence(mDeadPress, RENDER_CRASH_MEASURED, 5);
  mustCatch('M-dead-press — a cumulative clamp that strands the user on a live button is caught',
    !flat.every((m, i) => i === 0 || m > flat[i - 1]),
    `mounts: ${JSON.stringify(flat)} — the sequence must go flat and be refused`);
}

// M-ceiling-raised: the §1 predicate itself, applied to a value past the proven-safe size.
mustCatch('M-ceiling-raised — §1 refuses a DRAIN_REVEAL_MAX above the only proven-safe mount size',
  !((RENDER_PROVEN_SAFE + 1) <= RENDER_PROVEN_SAFE),
  'the §1 predicate must reject a ceiling larger than the proven-safe render size');

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed — «عرض المزيد» can mount an unrenderable list, or the measured #212 gap has widened.`);
  process.exit(1);
}
console.log('\n✓ the reveal ceiling is measured across a real press SEQUENCE; no single press can mount an unrenderable list, and the open #212 gap has not widened');
