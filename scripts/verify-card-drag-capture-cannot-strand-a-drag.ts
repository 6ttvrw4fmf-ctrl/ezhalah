// BARRIER: a failed pointer CAPTURE must never abort the rest of the drag's pointerdown.
//
// WHY THIS EXISTS (real production error, Sentry REACT-NATIVE-9 / ops_incident #289).
// `src/lib/cardDrag.ts` is the drag machinery both sign-in surfaces and «من نحن» share. Its
// pointerdown handler used to open with:
//
//     dragging = true; moved = false; id = e.pointerId;
//     grip.setPointerCapture(id);          // <- unguarded, and FIRST
//     …
//     grabX = e.clientX - off.x; grabY = e.clientY - off.y;
//
// `setPointerCapture` throws `NotFoundError` whenever no ACTIVE pointer carries that id — which is
// exactly the state of a pointerdown that is not a live trusted pointer (the reported event carried
// `isTrusted: false`), and also of a touch the browser cancelled between dispatching the event and
// our handler running. It throws `InvalidStateError` when the grip is already detached.
//
// THE DEFECT WAS NEVER THE LOG LINE. Because the throw happened AFTER `dragging` and `id` were set
// but BEFORE `grabX`/`grabY` were, it left a half-initialised drag: `dragging === true` with the
// grab offset still at its previous value. The very next `pointermove` then painted from the WRONG
// origin and the surface jumped by the full distance between the grab point and the card. The
// mirror call has always been guarded — `try { grip.releasePointerCapture(id); } catch {}` — so the
// ASYMMETRY between the two halves was the bug.
//
// THE RULE THIS PINS: capture is an optimisation, never a precondition. It is attempted LAST, it is
// guarded, and a drag whose capture failed still tracks correctly (every listener is bound on the
// grip itself, so events reach us with or without capture).
//
// This barrier EXECUTES the real `attachCardDrag` lifted out of the real file against a grip whose
// `setPointerCapture` throws, and compares the PAINTED transform. A source-text tripwire would not
// do: AGENTS.md's standing rule for this class is that the barrier must run the function against an
// injected failure, because every one of the 2026-09-04 defects had a text barrier over the exact
// line that stayed green for as long as the defect was live.
//
//   node --experimental-strip-types scripts/verify-card-drag-capture-cannot-strand-a-drag.ts
//   (discovered automatically by `npm test` — see scripts/lib/testRegistry.ts)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SOURCE = join(ROOT, 'src/lib/cardDrag.ts');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// ── the globals `attachCardDrag` closes over, stubbed with no logic of their own ─────────────────
// `matchMedia` and `sessionStorage` are deliberately NOT defined: the source guards the first with
// `typeof matchMedia === 'function'` and reaches the second only when `opts.posKey` is set, which
// these cases never set. Leaving them undefined proves those guards still hold.
const g = globalThis as Record<string, unknown>;
g.addEventListener = () => {};
g.removeEventListener = () => {};
g.requestAnimationFrame = () => 0;
g.cancelAnimationFrame = () => {};

type Handlers = Record<string, (e: unknown) => void>;

/** A grip/node pair that records what was painted and how capture was attempted. */
function makeSurface(opts: { captureThrows?: Error } = {}) {
  const handlers: Handlers = {};
  const captureCalls: number[] = [];
  const releaseCalls: number[] = [];
  const node = { style: { transform: '' } as Record<string, string> };
  const grip = {
    style: { cursor: '' } as Record<string, string>,
    addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn; },
    removeEventListener: () => {},
    setPointerCapture: (id: number) => {
      captureCalls.push(id);
      if (opts.captureThrows) throw opts.captureThrows;
    },
    releasePointerCapture: (id: number) => {
      releaseCalls.push(id);
      if (opts.captureThrows) throw opts.captureThrows;   // never captured ⇒ release fails too
    },
  };
  /** The painted vector, parsed back out of the transform the module actually wrote. */
  const painted = () => {
    const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(node.style.transform || '');
    return m ? { x: +m[1], y: +m[2] } : null;
  };
  return { node, grip, handlers, captureCalls, releaseCalls, painted };
}

const NOT_FOUND = Object.assign(
  new Error("Failed to execute 'setPointerCapture' on 'Element': No active pointer with the given id is found."),
  { name: 'NotFoundError' },
);

const down = (x: number, y: number, pointerId = 1) => ({ button: 0, pointerId, clientX: x, clientY: y });
const move = (x: number, y: number, pointerId = 1) => ({ pointerId, clientX: x, clientY: y });

// The identity clamp keeps the arithmetic readable: every number below is then purely the grab-offset
// maths, with no clamping to reason about. The rubber-band `band()` is a no-op at the clamp point
// (`cl + (v - cl) * 0.35` with `v === cl`), so a clamped-to-itself move paints exactly `v`.
const IDENTITY_CLAMP = (p: { x: number; y: number }) => p;

type Attach = (n: unknown, gr: unknown, o: unknown) => () => void;

/** Lift the REAL `attachCardDrag` out of a file — the shipped one, or a mutated copy of it. */
const liftAttach = async (file: string): Promise<Attach> => (await liftSymbols(
  file,
  [{ header: 'export function attachCardDrag(' }],
  ['attachCardDrag'],
)).attachCardDrag as Attach;

const attach = await liftAttach(SOURCE);

// ── THE ORACLE, as a function of an implementation ───────────────────────────────────────────────
// Stated once, applied twice: to the shipped code below, and to a MUTATED COPY OF THE REAL FILE in
// the mutation-proof section. Never to a hand-written stand-in — a barrier that tests a copy of
// production code is a test that passes while production breaks (the 2026-08-29 extractPrice case).
type Problem = { label: string; detail: string };
function dragProblems(impl: Attach): Problem[] {
  const out: Problem[] = [];
  const bad = (label: string, detail: string) => out.push({ label, detail });

  // The Sentry case: a throwing capture must not escape, and must not strand the grab offset.
  {
    const s = makeSurface({ captureThrows: NOT_FOUND });
    impl(s.node, s.grip, { clamp: IDENTITY_CLAMP });
    let threw: unknown = null;
    try { s.handlers.pointerdown(down(100, 100)); } catch (e) { threw = e; }
    if (threw !== null) bad('escape', `pointerdown threw ${String(threw).slice(0, 90)}`);
    s.handlers.pointermove(move(150, 140));
    const p = s.painted();
    if (!p || p.x !== 50 || p.y !== 40) bad('delta', `painted ${JSON.stringify(p)}, expected {"x":50,"y":40}`);
    if (s.grip.style.cursor !== 'grabbing') bad('cursor', `cursor is ${JSON.stringify(s.grip.style.cursor)}`);
  }
  // The stickiness: one throw must not poison the NEXT drag on the same surface.
  {
    const s = makeSurface({ captureThrows: NOT_FOUND });
    impl(s.node, s.grip, { clamp: IDENTITY_CLAMP });
    try { s.handlers.pointerdown(down(100, 100)); } catch { /* counted above */ }
    s.handlers.pointermove(move(150, 140));
    try { s.handlers.pointerup(); } catch { /* counted by E */ }
    try { s.handlers.pointerdown(down(300, 300)); } catch { /* counted above */ }
    s.handlers.pointermove(move(320, 330));
    const p = s.painted();
    if (!p || p.x !== 70 || p.y !== 70) bad('sticky', `painted ${JSON.stringify(p)}, expected {"x":70,"y":70}`);
  }
  return out;
}

// ── A. THE SENTRY CASE: a throwing capture must not escape the handler ───────────────────────────
{
  const s = makeSurface({ captureThrows: NOT_FOUND });
  attach(s.node, s.grip, { clamp: IDENTITY_CLAMP });
  let threw: unknown = null;
  try { s.handlers.pointerdown(down(100, 100)); } catch (e) { threw = e; }
  check('A1. a NotFoundError from setPointerCapture does not escape pointerdown',
    threw === null, `pointerdown threw ${String(threw)}`);
  check('A2. capture was still ATTEMPTED (the guard must not delete the optimisation)',
    s.captureCalls.length === 1, `setPointerCapture called ${s.captureCalls.length}x`);
}

// ── B. THE USER-VISIBLE CONSEQUENCE: the drag still tracks from the real grab point ──────────────
// This is the assertion the old code fails on. Grab at (100,100) with the card resting at (0,0),
// then move to (150,140): the card must follow the POINTER DELTA — (50,40) — not the pointer's
// absolute position. On the unguarded build the throw skipped the `grabX`/`grabY` assignment, which
// left them at their initial 0, so the same move painted (150,140): a 100px jump under the finger.
{
  const s = makeSurface({ captureThrows: NOT_FOUND });
  attach(s.node, s.grip, { clamp: IDENTITY_CLAMP });
  try { s.handlers.pointerdown(down(100, 100)); } catch { /* A1 already reports the throw */ }
  s.handlers.pointermove(move(150, 140));
  const p = s.painted();
  check('B1. a drag whose capture FAILED still paints the pointer delta, not the pointer position',
    !!p && p.x === 50 && p.y === 40,
    `painted ${JSON.stringify(p)}, expected {"x":50,"y":40} — a half-initialised drag paints {"x":150,"y":140}`);
  check('B2. the grip still shows the grabbing cursor after a failed capture',
    s.grip.style.cursor === 'grabbing', `cursor is ${JSON.stringify(s.grip.style.cursor)}`);
}

// ── C. THE HAPPY PATH IS UNCHANGED ───────────────────────────────────────────────────────────────
// A guard that also broke the normal drag would pass A and B while shipping a worse bug.
{
  const s = makeSurface();
  attach(s.node, s.grip, { clamp: IDENTITY_CLAMP });
  s.handlers.pointerdown(down(100, 100, 7));
  s.handlers.pointermove(move(150, 140, 7));
  check('C1. a successful capture is taken with the event\'s own pointerId',
    s.captureCalls.length === 1 && s.captureCalls[0] === 7, `captured ${JSON.stringify(s.captureCalls)}`);
  const p = s.painted();
  check('C2. the ordinary drag paints the pointer delta',
    !!p && p.x === 50 && p.y === 40, `painted ${JSON.stringify(p)}`);
}

// ── D. A SECOND DRAG AFTER A FAILED ONE DOES NOT INHERIT THE FIRST GRAB ──────────────────────────
// The half-initialised state was sticky: `grabX`/`grabY` are closure variables, so ONE throw
// poisoned every later drag on that surface until the component remounted.
{
  const s = makeSurface({ captureThrows: NOT_FOUND });
  attach(s.node, s.grip, { clamp: IDENTITY_CLAMP });
  try { s.handlers.pointerdown(down(100, 100)); } catch { /* reported by A1 */ }
  s.handlers.pointermove(move(150, 140));           // card now rests at (50,40)
  try { s.handlers.pointerup(); } catch { /* release is already guarded; D asserts the drag, not it */ }
  // Grab the card again, this time at (300,300). The card rests at (50,40), so the new grab offset
  // is (250,260) and a move to (320,330) must paint (70,70).
  try { s.handlers.pointerdown(down(300, 300)); } catch { /* reported by A1 */ }
  s.handlers.pointermove(move(320, 330));
  const p = s.painted();
  check('D1. a later drag re-reads its own grab point rather than inheriting the poisoned one',
    !!p && p.x === 70 && p.y === 70, `painted ${JSON.stringify(p)}, expected {"x":70,"y":70}`);
}

// ── E. THE RELEASE SIDE STAYS GUARDED ────────────────────────────────────────────────────────────
// The fix is symmetry. A future edit that hardens the capture side by UNGUARDING the release side
// would trade one half of the bug for the other, so both halves are pinned here.
{
  const s = makeSurface({ captureThrows: NOT_FOUND });
  attach(s.node, s.grip, { clamp: IDENTITY_CLAMP });
  try { s.handlers.pointerdown(down(100, 100)); } catch { /* reported by A1 */ }
  s.handlers.pointermove(move(150, 140));
  let threw: unknown = null;
  try { s.handlers.pointerup(); } catch (e) { threw = e; }
  check('E1. a throwing releasePointerCapture does not escape pointerup',
    threw === null, `pointerup threw ${String(threw)}`);
  check('E2. release was still attempted', s.releaseCalls.length === 1);
}

// ── MUTATION PROOF ───────────────────────────────────────────────────────────────────────────────
// Not a description of a proof — an executable one, and against the REAL FILE rather than a
// hand-written stand-in. The shipped source is transformed back into the exact pre-fix shape
// (capture called FIRST and UNGUARDED), lifted, and run through the SAME oracle the checks above
// use. A barrier that cannot be shown failing against the defect it claims to guard is decoration.
//
// Both anchors are asserted to occur EXACTLY once before the edit, so a reformat of cardDrag.ts
// fails loudly here instead of silently mutating nothing and "proving" the barrier works.
const GUARDED = '    try { grip.setPointerCapture(id); } catch { /* uncaptured: still tracks while over the grip */ }\n';
const ANCHOR = '    dragging = true; moved = false; id = e.pointerId;\n';

const mustCatch = (label: string, run: () => Promise<boolean>) => run().then(
  (caught) => {
    if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
    failures++;
    console.error(`FAIL  (mutation) MISSED ${label} — this barrier cannot fail against the defect it guards`);
  },
  (e) => { console.log(`PASS  (mutation) catches ${label} (mutant threw: ${String(e).slice(0, 60)})`); },
);

const occurrences = (hay: string, needle: string) => hay.split(needle).length - 1;

await mustCatch('the pre-fix shape: setPointerCapture called FIRST and unguarded', async () => {
  const src = readFileSync(SOURCE, 'utf8');
  if (occurrences(src, GUARDED) !== 1) {
    throw new Error(`the guarded capture line is not present exactly once in ${SOURCE} — `
      + `this proof mutates the real file and must be updated with it`);
  }
  if (occurrences(src, ANCHOR) !== 1) {
    throw new Error(`the pointerdown anchor is not present exactly once in ${SOURCE}`);
  }
  // Remove the guard, and put the bare call back where it used to be: before grabX/grabY are set.
  const mutated = src.replace(GUARDED, '').replace(ANCHOR, ANCHOR + '    grip.setPointerCapture(id);\n');
  const file = join(mkdtempSync(join(tmpdir(), 'ezhalah-carddrag-mutant-')), 'cardDrag.ts');
  writeFileSync(file, mutated);
  const problems = dragProblems(await liftAttach(file));
  // The mutant must be caught on the SPECIFIC shapes this barrier exists for, not merely "somehow".
  const labels = problems.map((p) => p.label).sort().join(',');
  const caught = ['escape', 'delta', 'cursor', 'sticky'].every((l) => problems.some((p) => p.label === l));
  if (!caught) console.error(`      mutant produced only: ${labels || '(nothing)'}`);
  return caught;
});

// The mirror direction: the SHIPPED file must produce no problems at all. Without this, a mutation
// proof that flagged everything unconditionally would still read as green.
check('the shipped cardDrag.ts produces no problems under the same oracle',
  dragProblems(attach).length === 0,
  dragProblems(attach).map((p) => `${p.label}: ${p.detail}`).join('; '));

// ── F. WIRING ────────────────────────────────────────────────────────────────────────────────────
// Never string-match package.json for this — the registry guard rejects that pattern outright, and
// the naive repair (matching `run-tests`) is a wiring check that cannot fail.
check('F1. this barrier is discovered and run by `npm test`',
  npmTestRuns(ROOT, 'verify-card-drag-capture-cannot-strand-a-drag'));

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
