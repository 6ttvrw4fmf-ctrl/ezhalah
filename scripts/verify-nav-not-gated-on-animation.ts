// TRIPWIRE + BEHAVIOURAL TEST: a hand-off the user is WAITING on must never depend on an animation
// completing.
//
// WHY THIS EXISTS (real bug, 2026-08-07 — owner: "I press بحث and nothing happens").
// src/app/index.tsx put the entire Search navigation inside `.start(callback)`:
//
//     RNAnimated.timing(heroAnim, { duration: 300, useNativeDriver: true }).start(() => {
//       router.push({ pathname: '/agent', params: { filter: JSON.stringify(q) } });
//     });
//
// On web `useNativeDriver` is a no-op — RNAnimated is driven by requestAnimationFrame — and browsers
// SUSPEND rAF for a backgrounded tab, a minimised window, or under OS power throttling. The timing
// then never completes, the completion callback never fires, and Search does nothing whatsoever: no
// navigation, no error, no spinner. Reproduced live against production with rAF stalled: the press
// was registered and the app was still sitting on `/` ten seconds later.
//
// The same shape in src/components/IntroVideo.tsx was worse — onDone() gated on a fade meant the
// intro overlay could never be dismissed, stranding the whole app behind a splash screen.
//
// THE RULE: the animation is decoration; the hand-off is the function. Both live in
// src/lib/afterAnimation.ts now, so the guarantee is one tested function rather than a pattern
// re-typed per call site.
//
//   node --experimental-strip-types scripts/verify-nav-not-gated-on-animation.ts   (wired into `npm test`)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runAfterAnimation } from '../src/lib/afterAnimation.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// ── A. BEHAVIOUR — the actual guarantee, proved by running the code ──────────────────────────────
{
  // The bug condition: rAF frozen ⇒ the animation NEVER calls back.
  let handed = 0;
  const pending: (() => void)[] = [];
  runAfterAnimation(() => { /* animation started, never completes */ }, () => { handed++; },
    320, (fn) => { pending.push(fn); return 0; });
  check('A1. animation never completes → hand-off has NOT run yet (nothing fires early)', handed === 0);
  pending.forEach((f) => f()); // the timer fires
  check('A2. …and the timer fallback DOES hand off (this is the bug that broke Search)', handed === 1,
    `handed=${handed}`);

  // Normal path: the animation completes first.
  let h2 = 0; const q2: (() => void)[] = [];
  runAfterAnimation((done) => done(), () => { h2++; }, 320, (fn) => { q2.push(fn); return 0; });
  check('A3. animation completes → hand-off runs immediately (visual path still wins)', h2 === 1);
  q2.forEach((f) => f()); // the fallback also fires later
  check('A4. …and the later fallback is a NO-OP — exactly once, never a double navigation', h2 === 1,
    `handed=${h2}`);

  // Both paths racing, repeatedly — must still be exactly once each time.
  let h3 = 0;
  for (let i = 0; i < 100; i++) {
    let before = h3;
    const q: (() => void)[] = [];
    runAfterAnimation((done) => { if (i % 2) done(); }, () => { h3++; }, 320, (fn) => { q.push(fn); return 0; });
    q.forEach((f) => f());
    if (h3 !== before + 1) { h3 = -1; break; }
  }
  check('A5. 100 runs, animation completing or not → exactly one hand-off every time', h3 === 100,
    `total=${h3}`);

  // Production default must be a real timer, not a stub.
  let usedDefault = false;
  const realST = globalThis.setTimeout;
  (globalThis as any).setTimeout = (fn: any, ms: any) => { usedDefault = true; return realST(fn, ms); };
  runAfterAnimation(() => {}, () => {}, 320);
  (globalThis as any).setTimeout = realST;
  check('A6. the default scheduler is the real setTimeout (the fallback actually ships)', usedDefault);
}

// ── B. WIRING — both real call sites go through the tested helper ────────────────────────────────
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

for (const [file, what] of [
  ['src/app/index.tsx', 'Search navigation'],
  ['src/components/IntroVideo.tsx', 'intro overlay dismissal'],
] as const) {
  const code = strip(read(file));
  check(`B. ${what} (${file}) goes through runAfterAnimation()`,
    /runAfterAnimation\(/.test(code));
  check(`B. ${what} does NOT hand off from a bare .start(() => …) callback`,
    !/\.start\(\s*\(\s*\)\s*=>/.test(code),
    'a frozen rAF would make this silently do nothing');
}

// ── C. FLEET-WIDE — no NEW animation-gated hand-off anywhere in src/ ─────────────────────────────
// The earlier version of this tripwire only checked two hard-coded files, so a third call site could
// reintroduce the bug unnoticed. Walk the whole tree instead.
{
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : (/\.tsx?$/.test(n) ? [p] : []);
  });
  const root = new URL('../src', import.meta.url).pathname;
  const offenders: string[] = [];
  for (const file of walk(root)) {
    const code = strip(readFileSync(file, 'utf8'));
    // Any `.start(` that receives a callback is a potential gated hand-off. `.start()` with no
    // argument is fire-and-forget decoration and is always fine.
    const gated = [...code.matchAll(/\.start\(\s*([^)\s][^)]*)\)/g)]
      .map((m) => m[1].trim())
      .filter((arg) => arg !== '' && !/^\/\//.test(arg));
    if (!gated.length) continue;
    // Allowed only when the callback came from runAfterAnimation (i.e. the file uses the helper).
    if (!/runAfterAnimation\(/.test(code)) offenders.push(`${file.replace(root, 'src')} → .start(${gated[0]})`);
  }
  check('C. every .start(callback) in src/ is routed through runAfterAnimation()',
    offenders.length === 0,
    offenders.join('\n      ') || undefined);
}

console.log(failures === 0
  ? '\n✓ no hand-off depends on an animation frame — proved by behaviour, wiring and a full-tree scan\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
