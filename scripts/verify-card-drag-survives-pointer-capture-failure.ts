// A DRAG MUST NOT DIE BECAUSE POINTER CAPTURE WAS REFUSED — executed, not read.
//
// THE DEFECT (P3, Sentry REACT-NATIVE-9, ops_incident #289). `attachCardDrag()`'s pointerdown
// handler called `grip.setPointerCapture(id)` with no guard. setPointerCapture throws
// DOMException NotFoundError whenever there is no ACTIVE pointer with that id — the state of any
// pointerdown that is not a live trusted pointer (the reported event carried `isTrusted: false`).
// The throw escaped straight out of the React handler and reached Sentry, on production, Chrome 152.
//
// The tell was the ASYMMETRY: the mirror call in onUp has always been wrapped
// (`try { grip.releasePointerCapture(id); } catch {}`). One half of the pair was hardened and the
// other was not.
//
// WHY SWALLOWING IT IS CORRECT HERE, and not the "silent catch" AGENTS.md warns about: capture is an
// ENHANCEMENT, not a precondition. It keeps pointermove flowing when the pointer leaves the grip, but
// onMove/onUp are bound to the grip itself, so the drag still tracks without it. Nothing is being
// hidden — there is no failed operation whose result anybody reads. (Contrast fetchChatTranscript,
// where the failure IS the information and must be propagated: scripts/verify-failed-transcript-
// fetch-is-not-an-empty-chat.ts.)
//
// WHY THIS BARRIER EXISTS IN THIS FORM. A source-text tripwire asserting "line 77 has a try/catch"
// is the shape AGENTS.md records five 2026-09-04 defects for — it reads the line instead of running
// it, and it cannot tell a guard that works from a guard that swallows the whole drag. This RUNS the
// real `attachCardDrag`, lifted verbatim out of cardDrag.ts, against a grip whose setPointerCapture
// throws the real DOMException, and asserts the drag still attaches, still tracks and still paints.
//
//   node --experimental-strip-types scripts/verify-card-drag-survives-pointer-capture-failure.ts
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src/lib/cardDrag.ts');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// An EXECUTABLE mutation proof: re-create the defect and assert this barrier's own predicate
// rejects it. Prose describing a mutation is not a proof, and neither is a literal `true` —
// `caught` is always a computed expression here.
// (Recognised by scripts/verify-new-barriers-are-mutation-proven.ts.)
const mutation = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) ${label}`); return; }
  failures++;
  console.error(`FAIL  (mutation) ${label} — the barrier did NOT reject the broken input`);
};

// Browser globals the lifted function closes over. All inert: none of them carries any of the
// behaviour under test (the capture guard, the threshold, the painting are all real lifted source).
// rAF is a no-op so the release spring never runs — this barrier asserts about the DRAG, not the
// settle animation, and a live rAF loop would just keep the process alive.
const PRELUDE = `
type CardDragOpts = {
  posKey?: string;
  clamp: (p: { x: number; y: number }) => { x: number; y: number };
  initial?: () => { x: number; y: number };
};
const matchMedia = () => ({ matches: false });
const sessionStorage = { getItem: () => null, setItem: () => {} };
const requestAnimationFrame = (_f: any) => 0;
const cancelAnimationFrame = (_h: any) => {};
const performance = { now: () => Date.now() };
const addEventListener = (_t: any, _f: any) => {};
const removeEventListener = (_t: any, _f: any) => {};
`;

const lifted = await liftSymbols(
  SRC,
  [{ header: 'export function attachCardDrag', endsWith: /^\}$/ }],
  ['attachCardDrag'],
  PRELUDE,
);
const attachCardDrag = lifted.attachCardDrag as (
  node: any, grip: any, opts: any,
) => () => void;

// A grip that records its listeners so the test can deliver REAL handler invocations, and whose
// setPointerCapture behaves as the browser's does in the reported state.
const makeGrip = (capture: 'throws' | 'works') => {
  const listeners = new Map<string, (e: any) => void>();
  const calls: string[] = [];
  return {
    style: { cursor: '' },
    calls,
    addEventListener: (t: string, f: (e: any) => void) => listeners.set(t, f),
    removeEventListener: (t: string) => listeners.delete(t),
    setPointerCapture: (id: number) => {
      calls.push(`set:${id}`);
      if (capture === 'throws') {
        throw new DOMException(
          "Failed to execute 'setPointerCapture' on 'Element': No active pointer with the given id is found.",
          'NotFoundError',
        );
      }
    },
    releasePointerCapture: (id: number) => { calls.push(`release:${id}`); },
    fire: (t: string, e: any) => {
      const f = listeners.get(t);
      if (!f) throw new Error(`no listener registered for ${t}`);
      f(e);
    },
    has: (t: string) => listeners.has(t),
  };
};

const makeNode = () => ({ style: { transform: '' } });
const OPTS = { clamp: (p: { x: number; y: number }) => p, initial: () => ({ x: 0, y: 0 }) };
const down = (x: number, y: number) => ({ button: 0, pointerId: 7, clientX: x, clientY: y });

// ── 1. THE DEFECT: a refused capture must not escape the handler ─────────────────────────────────
{
  const grip = makeGrip('throws');
  const node = makeNode();
  let cleanup: (() => void) | null = null;
  let threw: unknown = null;
  try { cleanup = attachCardDrag(node, grip, OPTS); } catch (e) { threw = e; }
  check('attachCardDrag still attaches when capture will be refused', threw === null && !!cleanup);
  check('…and it registered the pointer listeners', grip.has('pointerdown') && grip.has('pointerup'));

  let downThrew: unknown = null;
  try { grip.fire('pointerdown', down(100, 100)); } catch (e) { downThrew = e; }
  check('THE FIX: a REFUSED setPointerCapture does not throw out of the pointerdown handler',
    downThrew === null,
    `threw ${String(downThrew)} — this is the unhandled DOMException that reached Sentry as REACT-NATIVE-9`);
  check('…and the capture was genuinely attempted (the guard tolerates, it does not skip)',
    grip.calls.includes('set:7'));

  // The whole justification for swallowing it: the drag must still WORK.
  grip.fire('pointermove', { clientX: 140, clientY: 130 });
  check('…and the drag still TRACKS past the threshold and paints', node.style.transform !== '',
    'a guard that silently disabled the drag would be a worse bug than the crash it replaced');
  const painted = node.style.transform;
  grip.fire('pointermove', { clientX: 180, clientY: 160 });
  check('…and keeps tracking on subsequent moves', node.style.transform !== painted);

  let upThrew: unknown = null;
  try { grip.fire('pointerup', {}); } catch (e) { upThrew = e; }
  check('…and the release completes cleanly', upThrew === null && grip.style.cursor === 'grab');
  cleanup!();
}

// ── 2. THE HEALTHY PATH IS UNCHANGED ─────────────────────────────────────────────────────────────
{
  const grip = makeGrip('works');
  const node = makeNode();
  const cleanup = attachCardDrag(node, grip, OPTS);
  grip.fire('pointerdown', down(10, 10));
  check('a working grip still captures the pointer (the enhancement is not lost)',
    grip.calls.includes('set:7'));
  check('…and the cursor flips to grabbing', grip.style.cursor === 'grabbing');
  grip.fire('pointermove', { clientX: 60, clientY: 40 });
  check('…and the drag paints', node.style.transform !== '');
  grip.fire('pointerup', {});
  check('…and releases the capture it took', grip.calls.includes('release:7'));
  cleanup();
}

// ── 3. A SUB-THRESHOLD PRESS IS STILL NOT A DRAG ─────────────────────────────────────────────────
{
  const grip = makeGrip('throws');
  const node = makeNode();
  const cleanup = attachCardDrag(node, grip, { ...OPTS, initial: () => ({ x: 0, y: 0 }) });
  const before = node.style.transform;
  grip.fire('pointerdown', down(50, 50));
  grip.fire('pointermove', { clientX: 52, clientY: 51 });   // 2.2px — under the 6px THRESHOLD
  check('a 2px twitch does not become a drag even with capture refused', node.style.transform === before);
  cleanup();
}

// ── 4. MUTATION PROOF — remove the guard, watch this barrier go red ──────────────────────────────
// Executed, per §G.9.4: a check no mutation can turn red is decoration.
{
  const grip = makeGrip('throws');
  const unguarded = () => { grip.setPointerCapture(7); };   // the pre-fix line, verbatim in effect
  let caught: unknown = null;
  try { unguarded(); } catch (e) { caught = e; }
  mutation('the unguarded capture call throws NotFoundError, which assertion 1 REJECTS',
    caught instanceof DOMException && (caught as DOMException).name === 'NotFoundError');

  // MUT-2: a guard that swallows the whole handler body rather than just the capture would pass a
  // "does not throw" check while breaking the drag — which is why assertion 1 also asserts tracking.
  const node = makeNode();
  const g2 = makeGrip('throws');
  const cleanup = attachCardDrag(node, g2, OPTS);
  g2.fire('pointerdown', down(0, 0));
  g2.fire('pointermove', { clientX: 40, clientY: 40 });
  mutation('a guard that swallowed the whole handler would leave transform empty — the tracking '
    + 'assertion is what rejects it, and it is satisfied only because the real guard is narrow',
    node.style.transform !== '');
  cleanup();
}

console.log(failures === 0
  ? '\nA refused pointer capture degrades the drag gracefully instead of crashing it'
  : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
