// THE HAND-OFF A REVEAL OWES THE REST OF THE UI IS BOUNDED PER RENDERED TURN, NEVER PER TEXT
// REVISION (routine #4, 2026-09-23 — ops_incident #347 part 3, and the open half of #339/#337).
//
// WHAT THIS GUARDS THAT THE NEIGHBOURING BARRIER DOES NOT.
// scripts/verify-typewriter-completion-guarantee.ts proves `runTypewriter`'s anti-starvation
// ceiling fires — for ONE uninterrupted reveal. It drives the helper directly, once, with a fixed
// `total`, and never re-enters it. The real component does re-enter it: `Typer`/`BrandReveal` key
// their effect on `[text]`, and that effect's cleanup clears the ceiling along with the interval.
// So text that changes faster than the ceiling restarted it every time and `onDone` never fired at
// all. The neighbouring barrier's summary line — "a starved interval can never block doneTyping
// indefinitely" — was therefore a guarantee nothing measured at the level that decides it. This is
// the AGENTS.md "a pointer reads as coverage" shape, and the repair is to EXECUTE the composition,
// not to assert a second sentence about it.
//
// Measured against the real lifted runTypewriter, driven exactly as the component drove it before
// the fix (cleanup → re-invoke on each text change) with the interval starved:
//
//     1000 ms churn for 90 s:  onDone 0 times,  0 of 35 glyphs      <- 90 s of nothing
//     churn stops, +10 s:      onDone 1 time,  35 of 35 glyphs
//
// which is exactly ops_incident #347's live production observation ("neither the interval nor the
// 4 s onDone fallback ever commits, for 90 s+").
//
// WHY IT MATTERS TO A USER, not just to a timer: `onDone` sets `doneTyping[m.id]`, which gates the
// results actions row via resultsRowIsReady() — «عرض المزيد», the AF "narrow it down" button, the
// feedback row, Read Aloud. A churning sentence withholds the only control that reaches the rest
// of the matched set, while leaving a half-written Arabic sentence on screen (§42).
//
// EVERY CHECK BELOW RUNS THE REAL CODE. The lifecycle replica is the COMPONENT's effect ordering
// (which is what broke); the reveal engine and the hand-off latch under it are the real shipped
// `runTypewriter` (lifted out of agent.tsx) and the real `createRevealHandoff`.
//
//   node --experimental-strip-types scripts/verify-reveal-handoff-is-bounded-per-turn.ts
//   (discovered and run by `npm test` — scripts/lib/testRegistry.ts)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { liftSymbols } from './lib/liftSymbols.ts';
import { createRevealHandoff, HANDOFF_CEILING_MS, type HandoffTimers } from '../src/lib/revealHandoff.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const agent = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// ── A fake clock, with a `starved` mode that models the condition actually measured live: the main
//    thread never gives the typewriter's interval a tick, while timeouts still come due. ──────────
type Entry = { fn: () => void; due: number; interval: number | null };
function makeClock() {
  let now = 0, nextId = 1;
  const timers = new Map<number, Entry>();
  const api = {
    setInterval: (fn: () => void, ms: number) => { const id = nextId++; timers.set(id, { fn, due: now + ms, interval: ms }); return id; },
    clearInterval: (id: number) => { timers.delete(id); },
    setTimeout: (fn: () => void, ms: number) => { const id = nextId++; timers.set(id, { fn, due: now + ms, interval: null }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    advance(ms: number, starved: boolean) {
      const target = now + ms;
      for (;;) {
        let earliest: [number, Entry] | null = null;
        for (const e of timers) {
          if (starved && e[1].interval != null) continue;   // the starved interval never gets a tick
          if (!earliest || e[1].due < earliest[1].due) earliest = e;
        }
        if (!earliest || earliest[1].due > target) break;
        now = earliest[1].due;
        const [id, t] = earliest;
        if (t.interval == null) timers.delete(id); else timers.set(id, { ...t, due: now + t.interval });
        t.fn();
      }
      now = target;
    },
  };
  return api;
}

// ── Lift the REAL runTypewriter (never a hand-copied replica — feedback_never-test-a-copy-of-
//    production-code). It reaches setInterval/setTimeout through the globals, so the clock is
//    installed around every execution below. ──────────────────────────────────────────────────────
const lifted = await liftSymbols(
  join(root, 'src/app/agent.tsx'),
  [{ header: 'function runTypewriter(' }],
  ['runTypewriter'],
  'const TYPE_TICK_MS = 24;\nconst TYPE_CHARS = 2;\n',
);
const runTypewriter = lifted.runTypewriter as (total: number, setN: (n: number) => void, onDone?: () => void) => () => void;

const realTimers = {
  setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
  setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
};
function withClock<T>(clock: ReturnType<typeof makeClock>, body: () => T): T {
  Object.assign(globalThis, {
    setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });
  try { return body(); } finally { Object.assign(globalThis, realTimers); }
}

const TOTAL = 35;              // a real shipped Results-Found template is ~35 glyphs
const CHURN_MS = 1000;         // well inside the ceiling — that is the entire point
const CHURN_SECONDS = 90;      // the duration #347 measured on production

/**
 * The component's effect ordering, as the two shipped components express it.
 *
 * `bounded: false` is the PRE-FIX composition (the mutation): the ceiling lives inside
 * runTypewriter and the `[text]` cleanup clears it. `bounded: true` is what ships now: one
 * absolute ceiling armed on mount, which no text change may clear.
 */
function driveTurn(opts: { bounded: boolean; churnFor: number; thenIdle: number }) {
  const clock = makeClock();
  let onDoneCalls = 0, n = 0;
  return withClock(clock, () => {
    const timers: HandoffTimers = { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout };
    const handoff = createRevealHandoff(HANDOFF_CEILING_MS, timers);
    const settle = () => { onDoneCalls++; };

    // Mount-only effect — armed exactly once, never re-armed by a text change.
    const disarm = opts.bounded
      ? handoff.arm(() => { n = TOTAL; settle(); })
      : () => {};

    const startReveal = () => {
      if (opts.bounded && handoff.isSettled()) { n = TOTAL; return () => {}; }
      n = 0;
      return runTypewriter(TOTAL, (v) => { n = v; }, () => { handoff.settle(); settle(); });
    };

    let cleanup = startReveal();
    for (let i = 0; i < opts.churnFor; i++) {
      clock.advance(CHURN_MS, /* starved */ true);
      cleanup();          // the `[text]` effect's cleanup — clears the interval AND (pre-fix) the ceiling
      cleanup = startReveal();
    }
    const during = { onDoneCalls, n };
    clock.advance(opts.thenIdle, true);
    cleanup(); disarm();
    return { during, after: { onDoneCalls, n } };
  });
}

// ── 1. THE MUTATION, EXECUTED: the pre-fix composition really does stall, so this barrier is
//       watching something that can actually fail. ─────────────────────────────────────────────────
{
  const r = driveTurn({ bounded: false, churnFor: CHURN_SECONDS, thenIdle: 10_000 });
  check(`MUTATION PROOF — the pre-fix composition (ceiling cleared by the [text] cleanup) stalls for the whole ${CHURN_SECONDS}s of churn: onDone ${r.during.onDoneCalls}x, ${r.during.n}/${TOTAL} glyphs`,
    r.during.onDoneCalls === 0 && r.during.n === 0);
  check('…and only pays out once the churn stops — proving the stall is caused by the churn, not by the starved interval alone',
    r.after.onDoneCalls === 1 && r.after.n === TOTAL);
}

// ── 2. THE SHIPPED COMPOSITION: the hand-off is paid within the ceiling despite identical churn. ──
{
  const r = driveTurn({ bounded: true, churnFor: CHURN_SECONDS, thenIdle: 0 });
  check(`the shipped per-turn ceiling pays the hand-off DURING the same ${CHURN_SECONDS}s of churn — «عرض المزيد» is offered instead of withheld`,
    r.during.onDoneCalls >= 1);
  check('…and commits the FULL text, so the user is never left on a half-written Arabic sentence',
    r.during.n === TOTAL);
  check('…exactly once, however long the churn runs — the latch makes a second pay-out impossible',
    r.during.onDoneCalls === 1);
}

// ── 3. THE BOUND IS THE DOCUMENTED ONE, and it is never LOOSER than the single-reveal ceiling the
//       neighbouring barrier already certifies. ────────────────────────────────────────────────────
{
  const clock = makeClock();
  let paid = -1;
  withClock(clock, () => {
    const timers: HandoffTimers = { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout };
    const handoff = createRevealHandoff(HANDOFF_CEILING_MS, timers);
    handoff.arm(() => { paid = 1; });
    clock.advance(HANDOFF_CEILING_MS - 1, true);
    check('the per-turn ceiling does not fire early — it waits out its own documented bound', paid === -1);
    clock.advance(1, true);
    check(`…and fires exactly at it (${HANDOFF_CEILING_MS}ms), the same floor runTypewriter itself uses, so this bound is never looser than the single-reveal one`, paid === 1);
  });
}

// ── 4. NORMAL RENDERING IS UNTOUCHED: an un-starved reveal still completes on its own natural
//       schedule, and the ceiling stays dormant. This fix adds an upper bound; it must not become
//       the thing that drives the animation. ─────────────────────────────────────────────────────
{
  const clock = makeClock();
  const r = withClock(clock, () => {
    const timers: HandoffTimers = { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout };
    const handoff = createRevealHandoff(HANDOFF_CEILING_MS, timers);
    let viaCeiling = 0, viaAnimation = 0, n = 0;
    handoff.arm(() => { viaCeiling++; });
    runTypewriter(TOTAL, (v) => { n = v; }, () => { handoff.settle(); viaAnimation++; });
    clock.advance(Math.ceil(TOTAL / 2) * 24, /* starved */ false);   // its own natural duration
    return { viaCeiling, viaAnimation, n };
  });
  check('under healthy rendering the ANIMATION still completes the reveal on its natural schedule', r.viaAnimation === 1 && r.n === TOTAL);
  check('…and the per-turn ceiling never fires — it is an upper bound, not the driver', r.viaCeiling === 0);
}

// ── 5. THE WIRING IS REAL: both shipped components must arm the bound in a MOUNT-ONLY effect.
//       An effect keyed on the text is the defect itself, so this is asserted by shape — a future
//       edit that re-keys it to [text]/[full] fails here. ──────────────────────────────────────────
for (const [name, dep, chars] of [['Typer', 'text', 1400], ['BrandReveal', 'full', 1700]] as const) {
  const at = agent.indexOf(`function ${name}(`);
  const body = at < 0 ? '' : agent.slice(at, at + chars);
  check(`${name} creates a per-turn hand-off latch`, /createRevealHandoff\(\)/.test(body));
  check(`${name} arms it in a MOUNT-ONLY effect (deps \`[]\`) — re-arming per \`${dep}\` is the defect this removes`,
    /useEffect\(\(\) => handoff\.arm\([\s\S]*?\}\), \[\]\);/.test(body));
  check(`${name} still hands the reveal itself to runTypewriter, and settles the latch when it completes naturally`,
    /return runTypewriter\(total, setN, \(\) => \{ handoff\.settle\(\); onDone\?\.\(\); \}\);/.test(body));
  check(`${name} renders an already-settled turn WHOLE rather than re-animating it from zero — churn after the hand-off must not put the user back on a partial sentence`,
    /if \(handoff\.isSettled\(\)\) \{ setN\(total\); return; \}/.test(body));
}

console.log(failed === 0
  ? '\n✓ the reveal hand-off is bounded per rendered turn — no amount of text churn can withhold «عرض المزيد» or strand a half-written sentence\n'
  : `\n✗ ${failed} check(s) FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
