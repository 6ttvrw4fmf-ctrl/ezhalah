// Filter ↔ Smart Broker switch is a cross-fade, not a hard cut (owner 2026-10-24). Measured on production: the Filter
// screen vanished in one frame and the pill jumped 87px. ModeSwitch now wraps the navigation in the browser's View
// Transition. The trap this pins: waiting for the new screen with requestAnimationFrame inside the transition callback
// froze the page for the browser's 4s limit (frames are paused there) — the wait must use timers.
import { readFileSync } from 'node:fs';

function problems(src: string): string[] {
  const fade = (/function withScreenFade[\s\S]*?\n}\n/.exec(src)?.[0] ?? '').replace(/\/\/.*$/gm, ''); // code only, not its comments
  const rules: [string, boolean][] = [
    ['press() navigates through withScreenFade', /withScreenFade\(\(\) => onSwitch\(to\)\)/.test(src)],
    ['uses the browser View Transition when it exists', /startViewTransition/.test(fade)],
    ['falls back to the instant switch without it or with reduced motion', /prefers-reduced-motion: reduce/.test(fade) && /navigate\(\); return;/.test(fade)],
    ['never waits on requestAnimationFrame inside the transition (froze the page 4s)', fade.length > 0 && !/requestAnimationFrame/.test(fade)],
    ['never holds the page longer than 400ms', /> 400/.test(fade)],
    ["both screens' pill share one transition name so it glides", /viewTransitionName = 'ez-mode-switch'/.test(src)],
  ];
  return rules.filter(([, ok]) => !ok).map(([name]) => name);
}

const SRC = readFileSync(new URL('../src/components/ModeSwitch.tsx', import.meta.url), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`); if (!ok) failed++; };
// A mutation proof: the predicate run on a deliberately broken copy of the real source must report a problem.
const mutation = (name: string, brokenStillPasses: boolean) => check(`(mutation) catches ${name}`, !brokenStillPasses);

const found = problems(SRC);
check('the real ModeSwitch cross-fades and never freezes the page', found.length === 0);
for (const p of found) console.log(`     ✗ ${p}`);
mutation('a frame-based wait (froze the page 4s)', problems(SRC.replace('setTimeout(wait, 16)', 'requestAnimationFrame(wait)')).length === 0);
mutation('a hard-cut navigation (no fade)', problems(SRC.replace('withScreenFade(() => onSwitch(to))', 'onSwitch(to)')).length === 0);
mutation('a lost reduced-motion fallback', problems(SRC.replace("'(prefers-reduced-motion: reduce)'", "'(min-width: 1px)'")).length === 0);

if (failed) { console.error(`\n✗ mode switch: ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the Filter ↔ Smart Broker switch cross-fades and never freezes the page');
