// TRIPWIRE: navigation (and any other hand-off the user is WAITING on) must never be gated solely on
// an Animated completion callback.
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
// THE RULE: the animation is decoration; the hand-off is the function. Keep them independent. Pair
// every `.start(cb)` whose callback performs a hand-off with a setTimeout fallback, and make the two
// paths idempotent so whichever wins first is the only one that acts. setTimeout is clamped in
// background tabs but still RUNS; rAF does not.
//
//   node --experimental-strip-types scripts/verify-nav-not-gated-on-animation.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// Comments describe the retired pattern by name; strip them so prose never counts as code.
const code = (p: string) => read(p).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// ── 1. the Search button ─────────────────────────────────────────────────────────────────────────
{
  const src = code('src/app/index.tsx');
  check('index.tsx: router.push is NOT the body of an Animated .start() callback',
    !/\.start\(\(\)\s*=>\s*\{[^}]*router\.push/s.test(src),
    'a frozen rAF would make Search silently do nothing');
  check('index.tsx: navigateWithQuery has a setTimeout fallback that drives navigation',
    /navigateWithQuery[\s\S]{0,1200}?setTimeout\(go,/.test(src),
    'without it, navigation depends entirely on the animation completing');
  check('index.tsx: the two paths are idempotent (a `navigated` latch guards a double push)',
    /let navigated = false;[\s\S]{0,400}?if \(navigated\) return;[\s\S]{0,120}?navigated = true;/.test(src));
  check('index.tsx: the animation still plays (the visual was kept, only the gating removed)',
    /RNAnimated\.timing\(heroAnim[\s\S]{0,240}?\)\.start\(go\)/.test(src));
}

// ── 2. the intro overlay ─────────────────────────────────────────────────────────────────────────
{
  const src = code('src/components/IntroVideo.tsx');
  check('IntroVideo.tsx: onDone() is NOT reachable only through an Animated .start() callback',
    !/\.start\(\(\)\s*=>\s*onDone\(\)\)/.test(src),
    'a frozen rAF would strand the app behind an undismissable splash screen');
  check('IntroVideo.tsx: finish() has a setTimeout fallback that hands control back',
    /const finish = \(\)[\s\S]{0,700}?setTimeout\(done,/.test(src));
  check('IntroVideo.tsx: onDone() fires exactly once (handedOff latch)',
    /let handedOff = false;[\s\S]{0,220}?if \(handedOff\) return;[\s\S]{0,120}?handedOff = true;/.test(src));
}

// ── 3. fleet-wide: no NEW animation-gated hand-off sneaks back in ────────────────────────────────
{
  // Any `.start(` callback that navigates or hands off must sit in a file that also has a timeout
  // fallback. Cheap structural check — it cannot prove intent, but it catches the copy-paste.
  const FILES = ['src/app/index.tsx', 'src/components/IntroVideo.tsx'];
  const offenders: string[] = [];
  for (const f of FILES) {
    const src = code(f);
    const gated = /\.start\(\s*\([^)]*\)\s*=>/.test(src) || /\.start\(\s*(go|done)\s*\)/.test(src);
    const hasFallback = /setTimeout\(\s*(go|done)\s*,/.test(src);
    if (gated && !hasFallback) offenders.push(f);
  }
  check('every file that hands off from an Animated .start() also ships a setTimeout fallback',
    offenders.length === 0, offenders.join(', '));
}

console.log(failures === 0
  ? '\n✓ navigation/hand-off never depends on an animation frame\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
