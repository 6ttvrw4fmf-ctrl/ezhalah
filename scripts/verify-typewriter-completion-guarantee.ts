// Typewriter completion guarantee (owner report, 2026-08-23 — "the advanced filter doesn't work in
// every property type"). Root cause: the AF "narrow it down" button, the Load-more/feedback row, and
// the Read Aloud button are ALL gated on `doneTyping`, which only fires when the results intro's
// character-by-character typewriter (src/app/agent.tsx's Typer/BrandReveal, driven by a
// setInterval-based `runTypewriter`) reaches its final character. Measured LIVE on two independent
// real browsers (this session's own test pane AND the owner's actual Windows Chrome — cross-checked
// specifically to rule out a tooling artifact) with a MutationObserver on the intro text: while the
// results cascade renders 10 cards alongside it, ticks that should fire every 24ms were landing
// ~1000ms apart instead, some runs taking 40-60+ real seconds before the intro's last character (and
// every feature gated behind it) ever appeared.
//
// The fix — matching src/lib/afterAnimation.ts's already-established runAfterAnimation pattern for
// exactly this class of problem — is a bounded fallback timer that forces completion even when the
// interval driving it is starved. This script proves it two ways: (1) source-level, that agent.tsx's
// Typer/BrandReveal both delegate to ONE runTypewriter helper carrying the fallback, so a future edit
// can't quietly restore two duplicated intervals with only one of them patched; and (2) EXECUTED,
// against a faithful pure replica driven by an injectable fake clock (never real timers, so this runs
// instantly) — proving that even when the "interval" NEVER fires even once (total starvation, the
// worst case actually observed), the fallback still forces `onDone`/full-text completion within the
// documented bounded ceiling, not the unbounded stall the interval alone would produce.
//
//   node --experimental-strip-types scripts/verify-typewriter-completion-guarantee.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const agent = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// ── SOURCE: one shared helper, both Typer and BrandReveal delegate to it ────────────────────────────
check('a single runTypewriter() helper exists, carrying both the interval AND a bounded fallback setTimeout', /function runTypewriter\(total: number, setN: \(n: number\) => void, onDone\?: \(\) => void\): \(\) => void \{/.test(agent) && /const fallback = setTimeout\(finish, Math\.max\(4000, expectedMs \* 3\)\);/.test(agent));
check('the fallback ceiling is derived from the SAME TYPE_CHARS/TYPE_TICK_MS cadence the interval itself uses — never a hand-picked, driftable second constant', /const expectedMs = Math\.ceil\(total \/ TYPE_CHARS\) \* TYPE_TICK_MS;/.test(agent));
check('finish() is idempotent (a `done` latch) — the fallback and a late-but-real interval completion can never both fire onDone/setN', /let done = false;\s*const finish = \(\) => \{\s*if \(done\) return;\s*done = true;/.test(agent));
check('the returned cleanup clears BOTH the interval and the fallback timeout — an unmounted/superseded Typer can never fire onDone after the fact', /return \(\) => \{ clearInterval\(id\); clearTimeout\(fallback\); \};/.test(agent));
check('Typer delegates to runTypewriter (no re-inlined duplicate interval that could go unpatched)', /function Typer\(\{ text, onDone \}[\s\S]{0,200}?return runTypewriter\(text\.length, setN, onDone\);/.test(agent));
check('BrandReveal delegates to runTypewriter too (the listings-reply path, not just plain chat replies)', /function BrandReveal\(\{ brand, text, onDone \}[\s\S]{0,300}?return runTypewriter\(full\.length, setN, onDone\);/.test(agent));
check('the closing block (AF button / Load more / feedback row / Read Aloud) is still gated on doneTyping — this fix guarantees that gate resolves promptly, it does not remove the gate', /if \(\(m\.typing && !doneTyping\[m\.id\]\) \|\| shown < Math\.min\(FIRST_PAGE, fetched\)\) return null;/.test(agent));

// ── EXECUTED: a faithful pure replica of runTypewriter, driven by an injectable fake clock (owner
//    2026-08-23) — no real timers, so this runs instantly regardless of the ceiling being tested.
//    Mirrors src/lib/afterAnimation.ts's own test-friendly "injectable timer" design. ─────────────────
const TYPE_TICK_MS = 24;
const TYPE_CHARS = 2;

type FakeClock = {
  setInterval: (fn: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  advance: (ms: number) => void; // fires every due callback, in schedule order, as real time would
};
function makeFakeClock(): FakeClock {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; due: number; interval: number | null }>();
  return {
    setInterval: (fn, ms) => { const id = nextId++; timers.set(id, { fn, due: now + ms, interval: ms }); return id; },
    clearInterval: (id) => { timers.delete(id); },
    setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { fn, due: now + ms, interval: null }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    advance(ms) {
      const target = now + ms;
      // Process in due-time order, one at a time, so an interval rescheduling itself mid-advance is
      // handled the same way a real event loop would (never skips or double-fires a tick).
      for (;;) {
        let earliest: [number, { fn: () => void; due: number; interval: number | null }] | null = null;
        for (const entry of timers) { if (!earliest || entry[1].due < earliest[1].due) earliest = entry; }
        if (!earliest || earliest[1].due > target) break;
        now = earliest[1].due;
        const [id, t] = earliest;
        if (t.interval == null) timers.delete(id); else timers.set(id, { ...t, due: now + t.interval });
        t.fn();
      }
      now = target;
    },
  };
}

// Faithful replica of the production runTypewriter — same structure, same constants, timers injected.
function runTypewriterReplica(total: number, setN: (n: number) => void, onDone: (() => void) | undefined, clock: FakeClock): void {
  if (total <= 0) { onDone?.(); return; }
  let i = 0;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    setN(total);
    onDone?.();
  };
  const id = clock.setInterval(() => {
    i += TYPE_CHARS;
    if (i >= total) { clock.clearInterval(id); finish(); } else { setN(i); }
  }, TYPE_TICK_MS);
  const expectedMs = Math.ceil(total / TYPE_CHARS) * TYPE_TICK_MS;
  clock.setTimeout(finish, Math.max(4000, expectedMs * 3));
}

{
  // NORMAL CASE: a healthy, un-starved clock — the interval completes well before the fallback ceiling,
  // and does so at exactly the expected time (proves the fallback is dormant under normal conditions).
  const clock = makeFakeClock();
  let doneAt = -1;
  let lastN = 0;
  runTypewriterReplica(30, (n) => { lastN = n; }, () => { doneAt = 1; }, clock);
  clock.advance(Math.ceil(30 / TYPE_CHARS) * TYPE_TICK_MS - 1); // one tick short of the real completion
  check('under normal (un-starved) conditions, the interval reaches full text right on its own natural schedule — the fallback never has to intervene', lastN < 30 && doneAt === -1);
  clock.advance(TYPE_TICK_MS);
  check('…and completes at exactly that point (onDone fires, text reaches its full length)', lastN === 30 && doneAt === 1);
}

{
  // TOTAL STARVATION: the worst case actually observed live — the "interval" NEVER fires even once
  // (main thread permanently starved). Advancing time WITHOUT ever letting the interval's own ticks
  // run (simulated by clearing it out from under the clock immediately) proves the fallback alone
  // still forces completion within the documented ceiling — this is the exact guarantee the owner-
  // reported bug needed and the interval alone could never have provided.
  const clock = makeFakeClock();
  const realSetInterval = clock.setInterval;
  clock.setInterval = (fn, ms) => { const id = realSetInterval(() => {}, ms); return id; }; // ticks that do nothing — total starvation
  let doneAt = -1;
  let lastN = -1;
  const total = 40;
  const expectedMs = Math.ceil(total / TYPE_CHARS) * TYPE_TICK_MS;
  const ceilingMs = Math.max(4000, expectedMs * 3);
  runTypewriterReplica(total, (n) => { lastN = n; }, () => { doneAt = 1; }, clock);
  clock.advance(ceilingMs - 1);
  check('a fully-starved interval (never ticks even once) is NOT rescued early — the fallback waits out its own documented ceiling, it does not fire prematurely', doneAt === -1);
  clock.advance(1);
  check('…but at the ceiling, the fallback forces BOTH the full text AND onDone through regardless — this is the guarantee that unblocks the AF button/feedback row/Read Aloud button', lastN === total && doneAt === 1);
  check('the bounded ceiling here (4000ms) is orders of magnitude below the 40-60+ real SECONDS measured live before this fix — the actual owner-reported failure mode', ceilingMs <= 5000);
}

{
  // ZERO-LENGTH TEXT: onDone must still fire (a message with no real intro shouldn't block doneTyping
  // just because there is nothing to type) — the plain, degenerate case both real components rely on.
  const clock = makeFakeClock();
  let doneAt = -1;
  runTypewriterReplica(0, () => {}, () => { doneAt = 1; }, clock);
  check('zero-length text calls onDone synchronously — never waits on a timer that would never fire a real tick', doneAt === 1);
}

console.log(failed === 0
  ? '\n✓ typewriter completion guarantee holds — a starved interval can never block doneTyping (and everything gated on it) indefinitely\n'
  : `\n✗ ${failed} check(s) FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
