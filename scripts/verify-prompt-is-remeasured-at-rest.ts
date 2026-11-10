// A SIGN-IN PROMPT THAT SLIDES INTO PLACE IS MEASURED AGAIN WHEN IT COMES TO REST (2026-11-10).
//
// journey-sweep 42789448147 (WebKit desktop, production): Google's card sat at 20,20 → 391,368 on top of the sidebar's
// «إنشاء حساب / تسجيل الدخول» while the sidebar had reserved nothing. The card's box was measured once, while it was
// still off screen, and never again: a CSS transform/opacity transition moves a box with no attribute change and no
// resize, so neither the MutationObserver nor the ResizeObserver in src/lib/bottomPromptInset.ts fires. Reproduced on
// ezhalah.com with a fixed box sliding in from translateY(-420px): the CTA stayed at y 85, under it, after it stopped.
//
// This barrier EXECUTES the real observer against a small fake page (no browser): the prompt's box moves with no
// mutation and no resize, and the observer must still report the band — on the browser's own «motion ended» event, and
// on its settle timers when no such event comes. It must NOT re-scan the page for motion that is not a prompt's
// (owner 2026-10-05: «عرض المزيد takes time» — every card animates). Each rule has a mutation of the real source.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname ?? '.', '..');
const real = readFileSync(join(root, 'src/lib/bottomPromptInset.ts'), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  → ${detail}`}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

type Lib = { observeColumnPromptInset: (column: { left: number; right: number }, onChange: (i: { top: number; bottom: number }) => void) => () => void; PROMPT_SETTLE_MS: readonly number[] };
// The real source minus its one import: the hooks are not exercised here, the observer is.
const REACT_IMPORT = "import { useEffect, useState } from 'react';";
async function load(src: string): Promise<Lib> {
  if (!src.includes(REACT_IMPORT)) throw new Error('the lib no longer imports its hooks the way this barrier expects');
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-prompt-'));
  const f = join(dir, 'bottomPromptInset.mts');
  writeFileSync(f, src.replace(REACT_IMPORT, 'const useEffect = (..._a: unknown[]) => {}; const useState = <T,>(x: T) => [x, (_v: T) => {}] as const;'));
  return import(pathToFileURL(f).href) as Promise<Lib>;
}

// ── a fake page: one Google card (a static iframe inside a fixed container), a sidebar column, and a clock ────────────
type Rect = { top: number; bottom: number; left: number; right: number; width: number; height: number };
const box = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom, width: right - left, height: bottom - top });
const OFF_SCREEN = box(20, -400, 391, -52);      // where the slide starts
const AT_REST = box(20, 20, 391, 368);           // where Google's card sits (the sweep's measured box)
const COLUMN = { left: 0, right: 300 };          // the docked sidebar

function scenario(lib: Lib) {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, window: g.window, getComputedStyle: g.getComputedStyle, MutationObserver: g.MutationObserver, ResizeObserver: g.ResizeObserver, setTimeout: g.setTimeout, clearTimeout: g.clearTimeout };
  let rect = OFF_SCREEN; let scans = 0;
  const container: Record<string, unknown> = { parentElement: null, style: { position: 'fixed', display: 'block', visibility: 'visible', opacity: '1' }, getBoundingClientRect: () => rect };
  const iframe: Record<string, unknown> = { parentElement: container, style: { position: 'static', display: 'block', visibility: 'visible', opacity: '1' }, getBoundingClientRect: () => rect, contains: (n: unknown) => n === iframe };
  container.contains = (n: unknown) => n === container || n === iframe;
  const card = { parentElement: null, contains: (n: unknown) => n === card };   // some listing card, animating
  const listeners = new Map<string, ((e: { target: unknown }) => void)[]>();
  const timers: { id: number; ms: number; fn: () => void }[] = []; let nextId = 1;
  g.document = {
    documentElement: {},
    querySelectorAll: () => { scans++; return [iframe]; },
    addEventListener: (type: string, fn: (e: { target: unknown }) => void) => { listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
    removeEventListener: (type: string, fn: unknown) => { listeners.set(type, (listeners.get(type) ?? []).filter((x) => x !== fn)); },
  };
  g.window = { innerHeight: 1000, innerWidth: 1440, addEventListener: () => {}, removeEventListener: () => {} };
  g.getComputedStyle = (n: { style: unknown }) => n.style;
  g.MutationObserver = class { observe() {} disconnect() {} };
  g.ResizeObserver = class { observe() {} disconnect() {} };
  g.setTimeout = ((fn: () => void, ms: number) => { const id = nextId++; timers.push({ id, ms, fn }); return id; }) as unknown;
  g.clearTimeout = ((id: number) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); }) as unknown;
  const seen: number[] = [];
  const stop = lib.observeColumnPromptInset(COLUMN, (i) => seen.push(i.top));
  return {
    seen, scans: () => scans, timers,
    slideIn: () => { rect = AT_REST; },                                   // the box moved: no mutation, no resize
    fire: (type: string, target: unknown) => { for (const fn of listeners.get(type) ?? []) fn({ target }); },
    runTimers: () => { for (const t of [...timers].sort((a, b) => a.ms - b.ms)) { const i = timers.indexOf(t); if (i >= 0) { timers.splice(i, 1); t.fn(); } } },
    container, iframe, card, listeners,
    done: () => { stop(); Object.assign(g, saved); },
  };
}

async function facts(src: string) {
  const lib = await load(src);
  // A. the browser says the container's transition ended
  let s = scenario(lib);
  const firstA = s.seen.at(-1); s.slideIn(); s.fire('transitionend', s.container);
  const byEvent = s.seen.at(-1); s.done();
  // B. no event at all (an engine that fires none): the settle timers
  s = scenario(lib);
  const before = s.seen.at(-1); s.slideIn(); s.runTimers();
  const byTimer = s.seen.at(-1); const timersAfter = s.timers.length; s.done();
  // C. a listing card's animation ends: not a prompt's motion, so no re-scan of the page
  s = scenario(lib);
  const scans0 = s.scans(); for (let k = 0; k < 50; k++) { s.fire('transitionend', s.card); s.fire('animationend', s.card); }
  const extraScans = s.scans() - scans0; s.done();
  // D. cleanup removes every listener and timer
  s = scenario(lib);
  s.done(); const left = [...s.listeners.values()].reduce((a, v) => a + v.length, 0) + s.timers.length;
  return { firstA, byEvent, before, byTimer, timersAfter, extraScans, left, settle: lib.PROMPT_SETTLE_MS };
}

const f = await facts(real);
check('measured while still off screen, the card reserves nothing (the first reading)', f.firstA === 0 && f.before === 0);
check('the card slides into place with no mutation and no resize → «transitionend» on its container re-measures: 368 px reserved', f.byEvent === 368, `got ${f.byEvent}`);
check('no motion event at all → the settle timers re-measure: 368 px reserved', f.byTimer === 368, `got ${f.byTimer}`);
check('the settle timers end (no polling left behind)', f.timersAfter === 0 && f.settle.length >= 2 && Math.max(...f.settle) <= 5000);
check('a listing card\'s own animation ending never re-scans the page (100 events → 0 scans)', f.extraScans === 0, `${f.extraScans} scans`);
check('stopping the observer removes every listener and timer', f.left === 0, `${f.left} left`);

const noMotion = real.replace("  for (const type of PROMPT_MOTION_END_EVENTS) document.addEventListener(type, onMotionEnd, true);\n", '');
mustCatch('the observer deaf to «motion ended» (a slid-in card stays unmeasured until a timer)', noMotion !== real && (await facts(noMotion)).byEvent !== 368);
const noSettle = real.replace('  const tick = () => { retarget(); emit(); settleLater(); };', '  const tick = () => { retarget(); emit(); };');
mustCatch('no settle re-measurement (an engine that fires no motion event leaves the card unmeasured)', noSettle !== real && (await facts(noSettle)).byTimer !== 368);
const anyMotion = real.replace('    if (t && watched.some((w) => w === t || t.contains(w))) emit();', '    if (t) emit();');
mustCatch('every animation on the page re-scanning it (the «عرض المزيد» slowdown)', anyMotion !== real && (await facts(anyMotion)).extraScans > 0);
const leak = real.replace("    for (const type of PROMPT_MOTION_END_EVENTS) document.removeEventListener(type, onMotionEnd, true);\n", '');
mustCatch('listeners left behind after the observer stops', leak !== real && (await facts(leak)).left > 0);

if (failed) { console.error(`\n❌ verify-prompt-is-remeasured-at-rest: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-prompt-is-remeasured-at-rest: a prompt that slides into place is measured where it comes to rest');
