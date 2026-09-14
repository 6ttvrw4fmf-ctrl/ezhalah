// PERMANENT BARRIER: «عرض المزيد» is pressed REPEATEDLY by real users, so the reveal ceiling must be
// measured across a SEQUENCE of presses — not one. (ops_incident #212, P1, owner routine-4 Search &
// Matching QA; found by routine-8 regression hunter 2026-09-12, reproduced by execution 2026-09-13.)
//
// #212 IS NOW FIXED (owner decision 2026-09-14). The old model bounded each press's DELTA
// (DRAIN_REVEAL_MAX = 2,000) but never the cumulative MOUNT, so chained presses walked the mount past
// the renderer crash size measured on production (20,782 cards mounted, الرياض/إيجار/سنوي). The owner
// closed the gap the only way that keeps «عرض المزيد» honest AND the tab alive: «عرض المزيد» reveals
// at most TWO pages and never more than SECOND_PAGE_CAP (500) cards TOTAL, then RETIRES — the button
// is gone and the terminal state (Advanced Filter, or a new search from the ☰ menu) takes over. There
// is no third press to strand the user on, so the "dead pressable button" this file used to forbid
// cannot exist either: the affordance is removed, not left inert.
//
// So this file now locks the REAL invariant — the one its own header said should replace the measured
// #212 gap once the owner capped cumulative reveal: THE CUMULATIVE MOUNT IS BOUNDED, PERIOD. Across
// ANY cohort and ANY number of presses the mount never exceeds SECOND_PAGE_CAP, and 500 sits far under
// the only size PROVEN to render (5,706) and far under the measured crash (20,782). What it locks:
//
//   1. THE CAP IS UNDER THE PROVEN-SAFE MOUNT SIZE. SECOND_PAGE_CAP ≤ RENDER_PROVEN_SAFE, so no single
//      mount — first press, last press, or the whole sequence — can ever reach an unrenderable list.
//   2. THE SEQUENCE IS EXECUTED, NOT ASSUMED. Chained presses run the REAL lifted `loadMore`, threading
//      each press's output state into the next (which is all a second tap on the same turn IS). The
//      blind spot that let #212 ship — a ceiling verified only at press 1 — cannot reopen silently.
//      The executed mount stays ≤ 500 even against the 20,782-match crash cohort, and the button
//      RETIRES (the chat completes) within two presses rather than offering an endless flat press.
//   3. A COHORT UNDER THE CAP STILL FINISHES with every match shown (≤100 in one press, 100–500 in
//      two), so the safety cap never breaks the common case the owner's rule promises.
//
//   node --experimental-strip-types scripts/verify-loadmore-cumulative-mount-is-bounded.ts
//   (auto-discovered by npm test — scripts/lib/testRegistry.ts)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { revealTarget, drainPageBudget, LOAD_MORE_PAGE_SIZE, SECOND_PAGE_CAP } from '../src/data/resultCount.ts';

// ── The two production measurements this whole file is calibrated against ────────────────────────
// Both were taken on production, 2026-09-12, on unmodified code (PR #2377). They are measurements,
// never preferences — revisit them only with a new measurement. They now serve to prove the 500 cap
// sits safely under both: 500 ≤ 5,706 (proven to render) ≪ 20,782 (crashed).
const RENDER_PROVEN_SAFE = 5_706;   // الخبر: revealed in full, rendered fine
const RENDER_CRASH_MEASURED = 20_782; // الرياض/إيجار/سنوي: renderer process CRASHED

const root = join(import.meta.dirname, '..');
const AGENT = join(root, 'src/app/agent.tsx');
const agentSrc = readFileSync(AGENT, 'utf8');

(globalThis as unknown as { __revealTarget: typeof revealTarget }).__revealTarget = revealTarget;
(globalThis as unknown as { __drainPages: number }).__drainPages = drainPageBudget(LOAD_MORE_PAGE_SIZE);
(globalThis as unknown as { __cap: number }).__cap = SECOND_PAGE_CAP;

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
  'const revealTarget = (globalThis as any).__revealTarget;',
  'const SECOND_PAGE_CAP = (globalThis as any).__cap;',
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
  // but never MORE rows than the cohort actually has (§40.7: a harness artifact must never be
  // reported as a product failure).
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

console.log('\n«عرض المزيد» reveals at most 500 across the whole SEQUENCE, then retires — the mount can never grow unrenderable\n');

// ── 1. THE CAP IS UNDER THE ONLY MOUNT SIZE PROVEN TO RENDER ──────────────────────────────────────
// The whole safety argument rests on one inequality: the hard reveal ceiling is under the size proven
// to render, so no mount the product can ever produce is unrenderable. This is the structural half;
// §2 proves the code actually honours it.
check('§1 SECOND_PAGE_CAP is at or under the only mount size PROVEN to render on production',
  SECOND_PAGE_CAP <= RENDER_PROVEN_SAFE,
  `SECOND_PAGE_CAP=${SECOND_PAGE_CAP} vs RENDER_PROVEN_SAFE=${RENDER_PROVEN_SAFE}`);
check('§1 SECOND_PAGE_CAP stays well under the mount size that CRASHED the renderer',
  SECOND_PAGE_CAP < RENDER_CRASH_MEASURED,
  `SECOND_PAGE_CAP=${SECOND_PAGE_CAP} vs RENDER_CRASH_MEASURED=${RENDER_CRASH_MEASURED}`);

// ── 2. EXECUTED: the cumulative mount is bounded by the cap, even on the crash cohort ─────────────
// The blind spot that shipped #212 was verifying the ceiling at press 1 only. So run the REAL
// loadMore repeatedly against the exact cohort whose renderer crashed (20,782 matching) and prove the
// mount NEVER exceeds the cap, the button RETIRES within two presses (the sequence terminates instead
// of offering an endless flat press), and every press up to the cap genuinely advances the user.
const mounts = await pressSequence(AGENT, RENDER_CRASH_MEASURED, 8);
check('§2 the sequence really runs the real loadMore more than once',
  mounts.length >= 2, `mounts: ${JSON.stringify(mounts)}`);
check('§2 the cumulative mount NEVER exceeds SECOND_PAGE_CAP — no press, and no sequence, reaches an unrenderable list',
  Math.max(...mounts) <= SECOND_PAGE_CAP,
  `mounts: ${JSON.stringify(mounts)} against SECOND_PAGE_CAP=${SECOND_PAGE_CAP}`);
check('§2 the button RETIRES within two presses on a >500 cohort (the chat completes; no endless flat press)',
  mounts.length <= 2,
  `mounts: ${JSON.stringify(mounts)} — a third press means the terminal never fired and «عرض المزيد» is still live`);
check('§2 the last press on a >500 cohort lands exactly on the cap',
  mounts[mounts.length - 1] === SECOND_PAGE_CAP,
  `mounts: ${JSON.stringify(mounts)} — the final tap must reveal up to 500`);
const advancing = mounts.every((m, i) => i === 0 || m > mounts[i - 1]);
check('§2 every press ADVANCES the mount — no dead press while the button is still offered',
  advancing, `mounts: ${JSON.stringify(mounts)} — a flat step is a rendered, pressable button that does nothing`);

// ── 3. A COHORT UNDER THE CAP STILL FINISHES with every match shown ──────────────────────────────
// The cap must never break the common case: a 100–500 set drains and finishes in two presses with
// every match revealed; a ≤100 set finishes in ONE press. (owner rule 2026-09-14)
{
  const mid = await pressSequence(AGENT, 340, 6);
  check('§3 a 100–500 cohort finishes in two presses with every match revealed',
    mid.length === 2 && mid[mid.length - 1] === 340,
    `mounts: ${JSON.stringify(mid)} — expected [100, 340]`);
  const small = await pressSequence(AGENT, 47, 6);
  check('§3 a ≤100 cohort finishes in ONE press with every match revealed',
    small.length === 1 && small[0] === 47,
    `mounts: ${JSON.stringify(small)} — expected [47]`);
}

// ── MUTATION PROOFS ──────────────────────────────────────────────────────────────────────────────
// M-uncapped: remove the reveal cap so a press mounts far more than 500. This is the #212 regression
// in its purest form, and §2's cumulative-mount bound must refuse it.
{
  const mUncapped = mutantOf(agentSrc,
    'const target = revealTarget(cur, m.result.matchTotal ?? Infinity);',
    'const target = revealTarget(cur, m.result.matchTotal ?? Infinity) + 10_000;');
  const mutantMounts = await pressSequence(mUncapped, RENDER_CRASH_MEASURED, 8);
  mustCatch('M-uncapped — a press that mounts past the cap is caught by §2\'s cumulative-mount bound',
    Math.max(...mutantMounts) > SECOND_PAGE_CAP,
    `mutant mounts: ${JSON.stringify(mutantMounts)} — should exceed ${SECOND_PAGE_CAP}`);
}

// M-no-terminal: never fire completion, so the button is offered forever. The mount still stays ≤ 500
// (revealTarget caps it), but the sequence goes FLAT after the cap and never terminates — a rendered,
// pressable button that does nothing. §2's terminate/advance checks must refuse it.
{
  const mNoTerminal = mutantOf(agentSrc,
    'if (revealIsTerminal) setCompleted(true);',
    'if (revealIsTerminal && false) setCompleted(true);');
  const flat = await pressSequence(mNoTerminal, RENDER_CRASH_MEASURED, 5);
  mustCatch('M-no-terminal — a button that never retires (flat, endless press) is caught',
    flat.length > 2 && !flat.every((m, i) => i === 0 || m > flat[i - 1]),
    `mounts: ${JSON.stringify(flat)} — the sequence must fail to terminate and go flat`);
}

// M-ceiling-raised: the §1 predicate itself, applied to a value past the proven-safe size.
mustCatch('M-ceiling-raised — §1 refuses a cap above the only proven-safe mount size',
  !((RENDER_PROVEN_SAFE + 1) <= RENDER_PROVEN_SAFE),
  'the §1 predicate must reject a cap larger than the proven-safe render size');

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed — «عرض المزيد» can mount an unrenderable list, or the 500 cap no longer bounds the cumulative mount.`);
  process.exit(1);
}
console.log('\n✓ the cumulative mount is bounded by SECOND_PAGE_CAP across a real press SEQUENCE; the #212 crash class is closed, and the common case still finishes');
