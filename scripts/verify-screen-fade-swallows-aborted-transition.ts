// A SKIPPED View Transition must never surface as an unhandled rejection (Sentry REACT-NATIVE-F, 2026-10-31).
//
// WHAT HAPPENED. ModeSwitch's withScreenFade() calls document.startViewTransition() for the Filter ↔ Smart Broker
// cross-fade and never looked at the ViewTransition it returned. When the browser skips a transition — a second tap
// before the first finished, the tab hidden, or the pill's view-transition-name present twice while both screens are
// mounted — it REJECTS transition.ready / finished / updateCallbackDone with «InvalidStateError: Transition was aborted
// because of invalid state». Nobody awaited them, so the rejection reached window.onunhandledrejection and a real
// customer's Sentry (/map, Chrome 152, 2 events). The switch itself had already happened; only the cross-fade was skipped.
//
// HOW THIS CHECKS IT — BY EXECUTION, not by grepping for `.catch`. It lifts the REAL withScreenFade() out of
// src/components/ModeSwitch.tsx, runs it against a stub `document.startViewTransition` that behaves like a skipping
// browser (runs the update callback, then rejects all three promises), and counts Node's 'unhandledRejection' events.
// Then it plants the mutant — the same source with the swallow call removed — and demands that the mutant DOES leak,
// so the check cannot pass while the fix is gone (AGENTS.md: a barrier must execute the function against an injected
// failure, and a mutation must be watched to catch it).

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'src/components/ModeSwitch.tsx');
const SWALLOW_CALL = 'swallowTransitionRejections(transition);';

const PRELUDE = `const IS_WEB = true;`;
const SYMBOLS = [
  { header: 'function withScreenFade(' },
  { header: 'function swallowTransitionRejections(' },
];

type Fade = (navigate: () => void) => void;

/** A browser that skips every transition: the callback runs, then all three promises reject like Chrome does. */
function installSkippingBrowser(): { pathname: () => string } {
  let path = '/';
  const g = globalThis as any;
  g.window = {
    location: { get pathname() { return path; } },
    matchMedia: () => ({ matches: false }),
  };
  g.document = {
    startViewTransition(cb: () => Promise<void> | void) {
      const err = Object.assign(new Error('Transition was aborted because of invalid state'), { name: 'InvalidStateError' });
      const updateCallbackDone = Promise.resolve().then(() => cb()).then(() => undefined);
      // Chrome rejects ready and finished on a skip; the update callback still ran.
      const ready = Promise.reject(err);
      const finished = updateCallbackDone.then(() => { throw err; });
      return { ready, finished, updateCallbackDone };
    },
  };
  return { pathname: () => path, ...({ set: (p: string) => { path = p; } } as any) };
}

async function leaks(file: string): Promise<number> {
  const { withScreenFade } = (await liftSymbols(file, SYMBOLS, ['withScreenFade'], PRELUDE)) as { withScreenFade: Fade };
  const browser = installSkippingBrowser() as any;
  let unhandled = 0;
  const onRej = () => { unhandled++; };
  process.on('unhandledRejection', onRej);
  try {
    withScreenFade(() => { browser.set('/agent'); });
    // The update callback polls at 16ms and settles 40ms after the path moves; a skipped transition's
    // rejections land right after. Wait well past both so a leak has every chance to surface.
    await new Promise((r) => setTimeout(r, 250));
  } finally {
    process.off('unhandledRejection', onRej);
  }
  return unhandled;
}

const src = readFileSync(FILE, 'utf8');
if (!src.includes(SWALLOW_CALL)) {
  console.error(`✗ ${SWALLOW_CALL} is gone from src/components/ModeSwitch.tsx — the fix for REACT-NATIVE-F was removed`);
  process.exit(1);
}

const real = await leaks(FILE);
if (real !== 0) {
  console.error(`✗ withScreenFade leaked ${real} unhandled rejection(s) when the browser skipped the transition`);
  process.exit(1);
}

// MUTATION: the same file with the swallow call removed must leak, or this check proves nothing.
const dir = mkdtempSync(join(tmpdir(), 'ezhalah-modeswitch-mutant-'));
const mutant = join(dir, 'ModeSwitch.mutant.tsx');
writeFileSync(mutant, src.replace(SWALLOW_CALL, '/* mutant: swallow removed */'));
const mutantLeaks = await leaks(mutant);
if (mutantLeaks === 0) {
  console.error('✗ the mutant (swallow removed) leaked nothing — the harness cannot see the failure it exists to catch');
  process.exit(1);
}

console.log(`✓ withScreenFade: a skipped View Transition leaks 0 unhandled rejections (mutant without the swallow leaks ${mutantLeaks})`);
