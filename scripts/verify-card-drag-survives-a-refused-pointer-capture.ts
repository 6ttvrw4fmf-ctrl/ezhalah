// A REFUSED POINTER CAPTURE MUST NOT LEAVE THE DRAG HALF-INITIALISED.
//
// WHY THIS EXISTS — Sentry REACT-NATIVE-9, first seen 2026-09-15 05:09Z on production
// (ezhalah-app.vercel.app, Chrome 152 / Mac OS X, `handled: no`, DOMException.code 8):
//
//   NotFoundError: Failed to execute 'setPointerCapture' on 'Element':
//   No active pointer with the given id is found.
//
// The reported event carries the cause in its own payload: `isTrusted: false` and a `MouseEvent`
// as the nativeEvent of a `pointerdown`. That is a SYNTHETIC press — React Native Web's responder
// system and any programmatic tap dispatch one — and its `pointerId` is not a live pointer, so
// `setPointerCapture(id)` throws.
//
// THE DEFECT WAS THE ORDERING, NOT THE THROW. src/lib/cardDrag.ts's onDown called capture as its
// FOURTH statement, after `dragging = true` and `id = e.pointerId` but BEFORE `grabX/grabY` were
// recomputed. An uncaught throw there aborts the handler mid-way and leaves `dragging === true`
// carrying the grab offset of the PREVIOUS drag, so the next pointermove paints
// `e.clientX - grabX` off a stale origin: the card JUMPS instead of tracking the cursor 1:1. That
// reaches users on all three surfaces attachCardDrag drives — SignInCard, AuthModal and «من نحن»
// (InfoModal) — which is why a one-event Sentry issue was worth fixing rather than filing.
//
// WHAT THIS BARRIER DOES. It EXECUTES the real attachCardDrag against a stub DOM whose
// `setPointerCapture` throws the genuine DOMException, then drives a real pointerdown → pointermove
// sequence and asserts the card tracked the cursor. It does not read the source text: AGENTS.md
// records five defects of 2026-09-04 that each had a source-TEXT tripwire over the exact line, two
// of which pinned the defective line as correct. A tripwire here would have asserted that
// `setPointerCapture` is called — which it was, and that was the bug.

import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (what: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${what}`); return; }
  failures++;
  console.error(`FAIL  (mutation) did NOT catch ${what}`);
};

console.log('\nCard drag survives a refused pointer capture — executed, not grepped\n');

// ── A DOM small enough to reason about, faithful where it matters. ──────────────────────────────
type Listener = (e: any) => void;
type Stub = {
  style: Record<string, string>;
  listeners: Map<string, Listener[]>;
  captureCalls: number;
  addEventListener(t: string, fn: Listener): void;
  removeEventListener(t: string, fn: Listener): void;
  setPointerCapture(id: number): void;
  releasePointerCapture(id: number): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  fire(t: string, e: any): void;
};

/** `refuse: true` reproduces production: capture throws exactly as Chrome does. */
function stubEl(refuse: boolean): Stub {
  const el: Stub = {
    style: {} as Record<string, string>,
    listeners: new Map(),
    captureCalls: 0,
    addEventListener(t, fn) { el.listeners.set(t, [...(el.listeners.get(t) ?? []), fn]); },
    removeEventListener(t, fn) { el.listeners.set(t, (el.listeners.get(t) ?? []).filter((f) => f !== fn)); },
    setPointerCapture() {
      el.captureCalls++;
      if (refuse) {
        const err: any = new Error(
          "Failed to execute 'setPointerCapture' on 'Element': No active pointer with the given id is found.",
        );
        err.name = 'NotFoundError';
        err.code = 8;
        throw err;
      }
    },
    releasePointerCapture() { /* onUp has always guarded this one */ },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
    fire(t, e) { for (const fn of el.listeners.get(t) ?? []) fn(e); },
  };
  return el;
}

const g: any = globalThis as any;
g.matchMedia ??= () => ({ matches: false });
g.innerWidth ??= 1280;
g.innerHeight ??= 900;
g.performance ??= { now: () => Date.now() };
g.cancelAnimationFrame ??= () => {};
g.requestAnimationFrame ??= () => 0;
g.sessionStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

// attachCardDrag also listens at window scope (a resize re-clamp, and the move/up pair so a drag
// survives the cursor leaving the grip). Capture those so the test can drive whichever scope the
// module really chose, instead of hard-coding an assumption about its wiring.
const winListeners = new Map<string, Listener[]>();
g.addEventListener = (t: string, fn: Listener) => winListeners.set(t, [...(winListeners.get(t) ?? []), fn]);
g.removeEventListener = (t: string, fn: Listener) =>
  winListeners.set(t, (winListeners.get(t) ?? []).filter((f) => f !== fn));
const fireWindow = (t: string, e: any) => { for (const fn of [...(winListeners.get(t) ?? [])]) fn(e); };

// LIFT the real declaration rather than importing the module: src/ uses bundler resolution
// (extensionless './authPopupBehavior'), which Node's ESM loader cannot resolve. liftSymbols slices
// the SHIPPED function out of the file, so what runs below is production's own code, not a copy.
const { attachCardDrag } = (await liftSymbols(
  join(ROOT, 'src/lib/cardDrag.ts'),
  [{ header: 'export function attachCardDrag' }],
  ['attachCardDrag'],
  // attachCardDrag closes over nothing from the module but its own params; these two types keep the
  // lifted slice parseable without importing anything that carries logic.
  'type HTMLElement = any; type CardDragOpts = any; type PointerEvent = any;\n',
)) as { attachCardDrag: (node: any, grip: any, opts: any) => () => void };

/** Drive a real press-and-drag and report the painted transform. `pointerId` may be undefined,
 *  which is what a synthetic MouseEvent-backed pointerdown actually delivers. */
function press(refuse: boolean, pointerId: number | undefined, from: { x: number; y: number }, to: { x: number; y: number }) {
  const node = stubEl(false);
  const grip = stubEl(refuse);
  let threw: unknown = null;
  const cleanup = attachCardDrag(node as any, grip as any, { clamp: (p) => p });
  try {
    grip.fire('pointerdown', { button: 0, pointerId, clientX: from.x, clientY: from.y, isTrusted: false });
  } catch (e) { threw = e; }
  // The move listener may live on the grip or at window scope; drive both so the test does not
  // depend on which, and keeps working if that wiring legitimately changes.
  const move = { pointerId, clientX: to.x, clientY: to.y };
  grip.fire('pointermove', move);
  fireWindow('pointermove', move);
  const painted = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(node.style.transform || '');
  return { threw, captureCalls: grip.captureCalls, painted: painted ? { x: +painted[1], y: +painted[2] } : null, cleanup, grip, node };
}

// ── 1. THE PRODUCTION EVENT. A refused capture must not escape onDown. ─────────────────────────
const refused = press(true, undefined, { x: 100, y: 100 }, { x: 160, y: 140 });
check('a refused setPointerCapture does NOT throw out of pointerdown (the Sentry event, handled:no)',
  refused.threw === null,
  refused.threw ? `escaped: ${String(refused.threw).slice(0, 140)}` : '');

// ── 2. AND THE DRAG STILL TRACKS. This is the half a try/catch alone would not give: if capture
// still ran BEFORE the grab offset was computed, onDown would return early and the grab origin
// would be stale, so the first move would paint a jump rather than the 60,40 the cursor moved.
check('…and the drag still tracks the cursor 1:1 from the grab point (not a jump off a stale origin)',
  refused.painted !== null && Math.abs(refused.painted.x - 60) < 0.001 && Math.abs(refused.painted.y - 40) < 0.001,
  `painted ${JSON.stringify(refused.painted)}, expected {x:60,y:40}`);

// ── 3. NOT VACUOUS. Capture is still ATTEMPTED — the fix is a guard, not a removal. ────────────
check('capture is still attempted (the fix guards it; it does not delete it)',
  refused.captureCalls === 1, `captureCalls=${refused.captureCalls}`);

// ── 4. THE HEALTHY PATH is unchanged: a real pointer captures and tracks. ──────────────────────
const ok = press(false, 7, { x: 100, y: 100 }, { x: 160, y: 140 });
check('a real pointer still captures exactly once and tracks identically',
  ok.threw === null && ok.captureCalls === 1
  && ok.painted !== null && Math.abs(ok.painted.x - 60) < 0.001 && Math.abs(ok.painted.y - 40) < 0.001,
  `threw=${String(ok.threw)} captureCalls=${ok.captureCalls} painted=${JSON.stringify(ok.painted)}`);

// ── 5. A press that never moves stays nothing (the grip is not a button) — guard against the fix
// having turned a refused capture into a spurious drag commit.
// attachCardDrag paints the REST position once at attach time, so "nothing happened" is the card
// still sitting at {0,0} — not an unset transform. (Asserting null here was this test's own error.)
const tap = press(true, undefined, { x: 100, y: 100 }, { x: 101, y: 101 });
check('a 1px press under the 6px threshold leaves the card at rest, refused capture or not',
  tap.threw === null && tap.painted !== null && tap.painted.x === 0 && tap.painted.y === 0,
  `painted ${JSON.stringify(tap.painted)}, expected the untouched rest position {x:0,y:0}`);

// ── 6. MUTATION. Re-introduce the defect exactly as it shipped — capture FIRST and unguarded —
// and watch these assertions go red. Without this the file could pass over the broken code.
{
  const mutantOnDown = (grip: Stub, state: { dragging: boolean; grabX: number; grabY: number; id: number }, e: any) => {
    if (e.button !== 0) return;
    state.dragging = true; state.id = e.pointerId;
    grip.setPointerCapture(state.id);          // ← the shipped bug: first, and unguarded
    state.grabX = e.clientX; state.grabY = e.clientY;
  };
  const grip = stubEl(true);
  // Pre-load a STALE grab origin, as a previous drag would have left behind.
  const state = { dragging: false, grabX: 999, grabY: 999, id: -1 };
  let escaped: unknown = null;
  try { mutantOnDown(grip, state, { button: 0, pointerId: undefined, clientX: 100, clientY: 100 }); }
  catch (e) { escaped = e; }
  mustCatch('the shipped ordering: the throw ESCAPES pointerdown', escaped !== null);
  mustCatch('…and leaves the drag armed with a STALE grab origin (the jump users would see)',
    state.dragging === true && state.grabX === 999 && state.grabY === 999);
}

// ── 7. The guard must be in the SHIPPED module, not only in this test's idea of it. Executed:
// a module that still threw would have failed check 1 — this asserts the call survives at all,
// so a future "simplification" that deletes capture entirely is caught too.
assert.ok(refused.captureCalls + ok.captureCalls === 2, 'capture must be attempted on both paths');
check('both paths attempted capture, so neither the guard nor the call was optimised away', true);

refused.cleanup(); ok.cleanup(); tap.cleanup();

console.log(failures === 0
  ? '\n✓ a refused pointer capture degrades the drag instead of breaking it\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
