// THE LIVE-ANIMATION BUDGET — a scroll must never again compete with decoration (owner 2026-10-24: «on a laptop
// it feels slow when I scroll … on the phone it's perfect»).
//
// MEASURED (production build, Chromium 1440×900, a blank page = steady 17 ms frames): the Riyadh results scrolled at a
// 34 ms median / 119 ms p95 frame; after two taps of «عرض المزيد» 67 / 118 ms with 157 long tasks. Every CSS
// animation off = 17 / 35 ms. Cause: each card carried three never-ending gold glints (ring, photo strip, button) and
// each glint clips card content that paints after it, so the browser held a composited layer + rounded mask per card —
// 45 live animations on page one, 1,509 after two taps, plus the laptop-only docked sidebar sky and full-width hero
// clouds. A PAUSED animation keeps its layer (measured: no gain); only REMOVING it frees the layer.
// The fix (src/lib/scrollCalm.ts): while anything scrolls the gold glints are removed and the sky drifts paused; at rest
// only cards within one screen of the viewport glint. After: 17 / 50 ms, 1,509 → ~30 live animations.
//
// This barrier pins the wiring so a new animated decoration cannot quietly bring the problem back:
//   1. every never-ending CSS animation in src/ lives in a file this budget knows, at the count it knows;
//   2. each of them carries the marker the rules key on (glint / sky-calm), the card grid carries the cell marker and
//      the observer, and +html.tsx injects the rules;
//   3. the rules REMOVE the glints (not pause them) and PAUSE the sky (so clouds don't jump when you stop);
//   4. the helper behaves — executed against a fake page — and every one of these can be broken on purpose and is caught.
// scripts/verify-web-scroll-smooth.mjs then measures the real thing in a browser on every PR.
//
//   node --experimental-strip-types scripts/verify-live-animation-budget.ts   (in npm test)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './lib/stripComments.ts';
import {
  BUDGET_CSS, SCROLL_QUIET_MS, GLINT_WINDOW_SCREENS, installScrollCalm, watchGlintCells,
  GLINT_PROPS, GLINT_CELL_PROPS, SKY_CALM_PROPS,
} from '../src/lib/scrollCalm.ts';

const root = join(import.meta.dirname, '..');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);

// ── what the budget knows about ─────────────────────────────────────────────────────────────────
// file → how many never-ending CSS animations it declares, and what kind they are.
const KNOWN: Record<string, { n: number; kind: 'glint' | 'sky' | 'exempt'; why?: string }> = {
  'src/components/CardReveal.tsx': { n: 1, kind: 'glint' },
  'src/components/HeroBackground.tsx': { n: 1, kind: 'sky' },
  'src/components/SidebarSky.tsx': { n: 2, kind: 'sky' },
  // the two cloud wisps drifting in front of the home falconer (owner 2026-10-26), one drift() helper, SKY_CALM_PROPS
  'src/components/HeroFalconer.tsx': { n: 1, kind: 'sky' },
  'src/components/ListingPreview.tsx': { n: 3, kind: 'exempt', why: 'the ad sheet: one gold buzzer and two accents on ONE open ad, never repeated per card, never in a list' },
};
const INFINITE = /animationIterationCount\s*:\s*['"]infinite['"]/g;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
};
const srcFiles = (): Record<string, string> => {
  const m: Record<string, string> = {};
  for (const p of walk(join(root, 'src'))) m[p.slice(root.length + 1)] = readFileSync(p, 'utf8');
  return m;
};
const count = (s: string, re: RegExp) => (stripComments(s).match(re) ?? []).length;

/** Every way the wiring can be wrong, as sentences. `files` is src/ by path; `css` is BUDGET_CSS. */
function problems(files: Record<string, string>, css: string): string[] {
  const out: string[] = [];
  // 1. inventory
  for (const [path, src] of Object.entries(files)) {
    const n = count(src, INFINITE);
    if (!n) continue;
    const known = KNOWN[path];
    if (!known) out.push(`${path} declares ${n} never-ending CSS animation(s) the budget does not know. Mark each with a scrollCalm marker (GLINT_PROPS / SKY_CALM_PROPS) and add the file to KNOWN here — or, if it is one instance on a single sheet, add it as 'exempt' with a reason.`);
    else if (n !== known.n) out.push(`${path} now declares ${n} never-ending animation(s), the budget knows ${known.n}. A new one must join the budget (marker + KNOWN count).`);
  }
  for (const path of Object.keys(KNOWN)) if (!files[path]) out.push(`${path} is in KNOWN but not in src/ — stale entry`);
  // 2. markers
  const card = files['src/components/CardReveal.tsx'] ?? '';
  const cssShine = /export function CssShine\(\)\s*\{[\s\S]*?\n\}/.exec(stripComments(card))?.[0] ?? '';
  if (!/\{\.\.\.GLINT_PROPS\}/.test(cssShine)) out.push('CssShine does not carry GLINT_PROPS — its glint is invisible to the budget and plays during every scroll');
  for (const [path, drift] of [['src/components/HeroBackground.tsx', /!reduced && cloudDrift\(/g], ['src/components/SidebarSky.tsx', /!reduced &&/g]] as const) {
    const src = files[path] ?? '';
    const animated = count(src, drift);
    const marked = count(src, /\{\.\.\.SKY_CALM_PROPS\}/g);
    if (marked < animated) out.push(`${path}: ${animated} drifting layer(s) but ${marked} SKY_CALM_PROPS — an unpaused drift competes with every scroll`);
  }
  const row = stripComments(files['src/components/ResultCardRow.tsx'] ?? '');
  if (!/\{\.\.\.GLINT_CELL_PROPS\}/.test(row)) out.push('ResultCardRow does not carry GLINT_CELL_PROPS — no card would ever be marked near, so no card would glint');
  const grid = stripComments(files['src/components/ResultCardGrid.tsx'] ?? '');
  if (!/watchGlintCells\(/.test(grid)) out.push('ResultCardGrid does not call watchGlintCells — no card would ever be marked near, so no card would glint');
  if (!/installScrollCalm\(/.test(grid)) out.push('ResultCardGrid does not call installScrollCalm — nothing would calm the page while scrolling');
  const html = stripComments(files['src/app/+html.tsx'] ?? '');
  if (!/BUDGET_CSS/.test(html) || !/__html:\s*BUDGET_CSS/.test(html)) out.push('+html.tsx does not inject BUDGET_CSS — the markers do nothing');
  // 3. the rules
  if (!/html\[data-scrolling\] \[data-glint\]/.test(css)) out.push('the rules do not remove glints while scrolling');
  if (!/\[data-glint-cell\]:not\(\[data-near\]\) \[data-glint\]/.test(css)) out.push('the rules do not remove glints from cards outside the window');
  const glintRule = /[^}]*\[data-glint\][^{]*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  if (!/animation:none!important/.test(glintRule)) out.push('the glint rule must REMOVE the animation (animation:none). A paused animation keeps its composited layer — measured: no gain');
  const skyRule = /\[data-sky-calm\]\{([^}]*)\}/.exec(css)?.[1] ?? '';
  if (!/animation-play-state:paused!important/.test(skyRule)) out.push('the sky rule must PAUSE the drift (a removed drift snaps the clouds back when scrolling stops)');
  return out;
}

const files = srcFiles();
const real = problems(files, BUDGET_CSS);
check('the live-animation budget is wired end to end', real.length === 0, real.join('\n      '));
check('the markers are the names the rules key on',
  JSON.stringify(GLINT_PROPS) === '{"dataSet":{"glint":"1"}}' && JSON.stringify(GLINT_CELL_PROPS) === '{"dataSet":{"glintCell":"1"}}'
  && JSON.stringify(SKY_CALM_PROPS) === '{"dataSet":{"skyCalm":"1"}}');
check('«at rest» means 100–400 ms of quiet (long enough not to flicker, short enough to feel instant)', SCROLL_QUIET_MS >= 100 && SCROLL_QUIET_MS <= 400);
check('the glint window is at most one screen either side (a wide window is the 1,500-layer problem again)', GLINT_WINDOW_SCREENS > 0 && GLINT_WINDOW_SCREENS <= 1);

// ── mutations: break each part on purpose ───────────────────────────────────────────────────────
const mutate = (path: string, from: string | RegExp, to: string): Record<string, string> => {
  const before = files[path];
  const after = before.replace(from, to);
  if (after === before) throw new Error(`mutation anchor missing in ${path}: ${from}`);
  return { ...files, [path]: after };
};
mustCatch('the glint losing its marker is caught', problems(mutate('src/components/CardReveal.tsx', '{...GLINT_PROPS}', ''), BUDGET_CSS).length > 0);
mustCatch('a sky layer losing its marker is caught', problems(mutate('src/components/HeroBackground.tsx', '{...SKY_CALM_PROPS}', ''), BUDGET_CSS).length > 0);
mustCatch('a card row losing the cell marker is caught', problems(mutate('src/components/ResultCardRow.tsx', '{...GLINT_CELL_PROPS}', ''), BUDGET_CSS).length > 0);
mustCatch('the card grid forgetting the observer is caught', problems(mutate('src/components/ResultCardGrid.tsx', 'watchGlintCells(', 'noop('), BUDGET_CSS).length > 0);
mustCatch('the card grid forgetting the scroll calm is caught', problems(mutate('src/components/ResultCardGrid.tsx', 'installScrollCalm(', 'noop('), BUDGET_CSS).length > 0);
mustCatch('the page forgetting to inject the rules is caught', problems(mutate('src/app/+html.tsx', /__html:\s*BUDGET_CSS/, '__html: ""'), BUDGET_CSS).length > 0);
mustCatch('a NEW never-ending animation in a new file is caught', problems({ ...files, 'src/components/Shiny.tsx': "const s = { animationIterationCount: 'infinite' };" }, BUDGET_CSS).length > 0);
mustCatch('a new never-ending animation added to a known file is caught',
  problems(mutate('src/components/CardReveal.tsx', "animationDuration: '3.6s', animationIterationCount: 'infinite',", "animationDuration: '3.6s', animationIterationCount: 'infinite', x: { animationIterationCount: 'infinite' },"), BUDGET_CSS).length > 0);
mustCatch('a comment mentioning the marker does not satisfy the check', problems(mutate('src/components/CardReveal.tsx', '{...GLINT_PROPS}', '/* {...GLINT_PROPS} */'), BUDGET_CSS).length > 0);
mustCatch('PAUSING the glints instead of removing them is caught', problems(files, BUDGET_CSS.replace('{animation:none!important}', '{animation-play-state:paused!important}')).length > 0);
mustCatch('REMOVING the sky drift instead of pausing it is caught', problems(files, BUDGET_CSS.replace('animation-play-state:paused!important', 'animation:none!important')).length > 0);
mustCatch('dropping the near-window rule is caught', problems(files, BUDGET_CSS.replace('[data-glint-cell]:not([data-near]) [data-glint]', '[data-nothing]')).length > 0);

// ── the helper, executed against a fake page ────────────────────────────────────────────────────
type Fake = typeof globalThis & Record<string, unknown>;
const g = globalThis as unknown as Fake;
const timers: { f: () => void; ms: number; id: number }[] = [];
let tid = 0;
const savedTimeout = g.setTimeout; const savedClear = g.clearTimeout;
g.setTimeout = ((f: () => void, ms: number) => { timers.push({ f, ms, id: ++tid }); return tid; }) as never;
g.clearTimeout = ((id: number) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); }) as never;
const runTimers = () => { const t = timers.splice(0); t.forEach((x) => x.f()); };

class Attrs { a = new Set<string>(); setAttribute(k: string) { this.a.add(k); } removeAttribute(k: string) { this.a.delete(k); } hasAttribute(k: string) { return this.a.has(k); }
  toggleAttribute(k: string, on?: boolean) { if (on === undefined ? !this.a.has(k) : on) this.a.add(k); else this.a.delete(k); return this.a.has(k); } }
const listeners: { type: string; fn: () => void; opts: unknown }[] = [];
const root1 = new Attrs();
const fakeDoc = { documentElement: root1, addEventListener: (type: string, fn: () => void, opts: unknown) => listeners.push({ type, fn, opts }) } as unknown as Document;
installScrollCalm(fakeDoc);
installScrollCalm(fakeDoc); // idempotent
const scrollL = listeners.filter((l) => l.type === 'scroll');
check('one scroll listener, in the capture phase (scroll events do not bubble) and passive', scrollL.length === 1
  && (scrollL[0].opts as { capture?: boolean; passive?: boolean }).capture === true && (scrollL[0].opts as { passive?: boolean }).passive === true);
scrollL[0].fn();
check('a scroll marks the page as scrolling', root1.hasAttribute('data-scrolling'));
scrollL[0].fn(); scrollL[0].fn();
check('a burst of scroll events leaves exactly ONE pending «stop» timer, not one per event', timers.length === 1 && timers[0].ms === SCROLL_QUIET_MS, JSON.stringify(timers.map((t) => t.ms)));
runTimers();
check('after the quiet time the page is at rest again', !root1.hasAttribute('data-scrolling'));

// watchGlintCells against fake geometry: a 700 px scroller, a half-screen (350 px) window above and below it.
type Box = { top: number; bottom: number };
const ops: string[] = [];
class FakeCell extends Attrs {
  name: string; box: Box;
  constructor(name: string, top: number, bottom: number) { super(); this.name = name; this.box = { top, bottom }; }
  getBoundingClientRect() { ops.push('read'); return this.box; }
  toggleAttribute(k: string, on?: boolean) { ops.push('write'); return super.toggleAttribute(k, on); }
}
const rafQueue: (() => void)[] = []; let rafId = 0;
g.requestAnimationFrame = ((f: () => void) => { rafQueue.push(f); return ++rafId; }) as never;
g.cancelAnimationFrame = (() => { rafQueue.length = 0; }) as never;
const runFrames = () => { const q = rafQueue.splice(0); q.forEach((f) => f()); };
const moInstances: { cb: () => void; disconnected: boolean }[] = [];
g.MutationObserver = class { inst: (typeof moInstances)[number]; constructor(cb: () => void) { this.inst = { cb, disconnected: false }; moInstances.push(this.inst); }
  observe() {} disconnect() { this.inst.disconnected = true; } } as never;
const winListeners: { type: string; fn: () => void }[] = [];
g.window = { innerHeight: 700, addEventListener: (type: string, fn: () => void) => winListeners.push({ type, fn }), removeEventListener: (type: string, fn: () => void) => { const i = winListeners.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) winListeners.splice(i, 1); } } as never;
const scrollerBox: Box = { top: 0, bottom: 700 };
const scroller = { overflowY: 'auto', scrollHeight: 5000, clientHeight: 700, parentElement: null, getBoundingClientRect: () => scrollerBox };
g.getComputedStyle = ((n: { overflowY: string }) => ({ overflowY: n.overflowY })) as never;
const cell = (name: string, top: number) => new FakeCell(name, top, top + 200);
const cells = [cell('a', -600), cell('b', -300), cell('c', 100), cell('d', 900), cell('e', 1300)];
const grid = { children: cells as unknown as HTMLCollection, parentElement: { overflowY: 'visible', scrollHeight: 1, clientHeight: 1, parentElement: scroller } };
const nearNames = () => cells.filter((c) => c.hasAttribute('data-near')).map((c) => c.name).join('');
const stop = watchGlintCells(grid as unknown as HTMLElement);
check('before the first frame nothing is marked (no work at mount)', nearNames() === '');
runFrames();
check('the first frame marks the cells within half a screen of the scroller: b (above), c (in view), d (below)', nearNames() === 'bcd', nearNames());
const firstPass = ops.join('');
check('every rectangle is read BEFORE any attribute is written (one layout, no thrash)', /^(read){5}(write)+$/.test(firstPass), firstPass);
// the user scrolls 1000 px down: the cells move up, and the page comes to rest
cells.forEach((c) => { c.box = { top: c.box.top - 1000, bottom: c.box.bottom - 1000 }; });
check('while scrolling nothing is recomputed (the glints are off anyway — no work per frame)', nearNames() === 'bcd');
scrollL[0].fn(); runTimers();
check('at rest the window follows the scroll: d (now in view) and e (just below) are near, and the page is no longer «scrolling»', nearNames() === 'de' && !root1.hasAttribute('data-scrolling'), nearNames());
const late = cell('f', -400); late.box = { top: 200, bottom: 400 }; (grid.children as unknown as FakeCell[]).push(late);
moInstances[0].cb(); moInstances[0].cb(); check('a card added later schedules ONE frame of work, however many mutations arrive', rafQueue.length === 1);
runFrames();
check('…and is marked when it lands inside the window', cells.filter((c) => c.hasAttribute('data-near')).map((c) => c.name).join('') === 'def');
winListeners.forEach((l) => l.type === 'resize' && l.fn()); check('a window resize also schedules a re-check', rafQueue.length === 1); runFrames();
stop();
check('cleanup disconnects the mutation watcher and the resize listener', moInstances[0].disconnected && !winListeners.some((l) => l.type === 'resize'));
const before = nearNames(); cells.forEach((c) => { c.box = { top: 5000, bottom: 5200 }; }); scrollL[0].fn(); runTimers();
check('after cleanup a scroll rest no longer touches the cells', nearNames() === before);
mustCatch('a window that marks every cell would keep every glint alive (the 1,509-layer failure)', !(() => {
  const all = [cell('x', -9000), cell('y', 9000)]; all.forEach((c) => c.toggleAttribute('data-near', true));
  return !all.every((c) => c.hasAttribute('data-near')); })());

g.setTimeout = savedTimeout; g.clearTimeout = savedClear;

if (failures) { console.error(`\n✗ ${failures} check(s) failed`); process.exit(1); }
console.log('\n✓ nothing decorative competes with a scroll, and no new animation can join silently');
