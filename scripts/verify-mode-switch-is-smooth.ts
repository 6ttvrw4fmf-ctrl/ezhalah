// Filter ↔ Smart Broker switch is a cross-fade, not a hard cut (owner 2026-10-24). Measured on production: the Filter
// screen vanished in one frame and the pill jumped 87px. ModeSwitch now wraps the navigation in the browser's View
// Transition. The trap this pins: waiting for the new screen with requestAnimationFrame inside the transition callback
// froze the page for the browser's 4s limit (frames are paused there) — the wait must use timers.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/components/ModeSwitch.tsx', import.meta.url), 'utf8');
const fade = /function withScreenFade[\s\S]*?\n}\n/.exec(src)?.[0] ?? '';
const checks: [string, boolean][] = [
  ['press() navigates through withScreenFade', /withScreenFade\(\(\) => onSwitch\(to\)\)/.test(src)],
  ['uses the browser View Transition when it exists', /startViewTransition/.test(fade)],
  ['falls back to the instant switch without it or with reduced motion', /prefers-reduced-motion: reduce/.test(fade) && /navigate\(\); return;/.test(fade)],
  ['never waits on requestAnimationFrame inside the transition (froze the page 4s)', fade.length > 0 && !/requestAnimationFrame/.test(fade)],
  ['never holds the page longer than 400ms', /> 400/.test(fade)],
  ['both screens\' pill share one transition name so it glides', /viewTransitionName = 'ez-mode-switch'/.test(src)],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`); if (!ok) failed++; }
if (failed) { console.error(`\n✗ mode switch: ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the Filter ↔ Smart Broker switch cross-fades and never freezes the page');
