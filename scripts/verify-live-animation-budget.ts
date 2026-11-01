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
  BUDGET_CSS, SCROLL_QUIET_MS, GLINT_WINDOW_MARGIN, installScrollCalm, watchGlintCells,
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
  const grid = stripComments(files['src/components/ResultCardGrid.tsx'] ?? '');
  if (!/GLINT_CELL_PROPS/.test(grid)) out.push('ResultCardGrid cells do not carry GLINT_CELL_PROPS — every card would glint at once');
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
check('the glint window is at most one screen either side (a wide window is the 1,500-layer problem again)', /^(\d{1,3})% 0px$/.test(GLINT_WINDOW_MARGIN) && Number(GLINT_WINDOW_MARGIN.split('%')[0]) <= 100);

// ── mutations: break each part on purpose ───────────────────────────────────────────────────────
const mutate = (path: string, from: string | RegExp, to: string): Record<string, string> => {
  const before = files[path];
  const after = before.replace(from, to);
  if (after === before) throw new Error(`mutation anchor missing in ${path}: ${from}`);
  return { ...files, [path]: after };
};
mustCatch('the glint losing its marker is caught', problems(mutate('src/components/CardReveal.tsx', '{...GLINT_PROPS}', ''), BUDGET_CSS).length > 0);
mustCatch('a sky layer losing its marker is caught', problems(mutate('src/components/HeroBackground.tsx', '{...SKY_CALM_PROPS}', ''), BUDGET_CSS).length > 0);
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

// watchGlintCells with a fake IntersectionObserver / MutationObserver
class FakeCell extends Attrs { name: string; constructor(name: string) { super(); this.name = name; } }
const ioInstances: { cb: (e: { target: FakeCell; isIntersecting: boolean }[]) => void; opts: { root: unknown; rootMargin: string }; observed: FakeCell[]; disconnected: boolean }[] = [];
const moInstances: { cb: () => void; disconnected: boolean }[] = [];
g.IntersectionObserver = class { inst: (typeof ioInstances)[number];
  constructor(cb: (typeof ioInstances)[number]['cb'], opts: (typeof ioInstances)[number]['opts']) { this.inst = { cb, opts, observed: [], disconnected: false }; ioInstances.push(this.inst); }
  observe(c: FakeCell) { this.inst.observed.push(c); } disconnect() { this.inst.disconnected = true; } } as never;
g.MutationObserver = class { inst: (typeof moInstances)[number]; constructor(cb: () => void) { this.inst = { cb, disconnected: false }; moInstances.push(this.inst); }
  observe() {} disconnect() { this.inst.disconnected = true; } } as never;
const scroller = { overflowY: 'auto', scrollHeight: 5000, clientHeight: 700, parentElement: null };
g.getComputedStyle = ((n: { overflowY: string }) => ({ overflowY: n.overflowY })) as never;
const cells = [new FakeCell('a'), new FakeCell('b'), new FakeCell('c')];
const grid = { children: cells as unknown as HTMLCollection, parentElement: { overflowY: 'visible', scrollHeight: 1, clientHeight: 1, parentElement: scroller } };
const stop = watchGlintCells(grid as unknown as HTMLElement);
const io = ioInstances[0];
check('the observer is rooted on the chat\'s own scroller with the one-screen margin (the viewport cannot see past a scroller)',
  io.opts.root === scroller && io.opts.rootMargin === GLINT_WINDOW_MARGIN);
check('every cell is observed', io.observed.length === 3);
io.cb([{ target: cells[0], isIntersecting: true }, { target: cells[1], isIntersecting: false }]);
check('a cell inside the window is marked near, one outside is not', cells[0].hasAttribute('data-near') && !cells[1].hasAttribute('data-near'));
io.cb([{ target: cells[0], isIntersecting: false }, { target: cells[1], isIntersecting: true }]);
check('scrolling past a cell un-marks it and marks the next', !cells[0].hasAttribute('data-near') && cells[1].hasAttribute('data-near'));
const late = new FakeCell('d'); (grid.children as unknown as FakeCell[]).push(late);
moInstances[0].cb(); moInstances[0].cb();
check('a card added later («عرض المزيد») is observed once, never twice', io.observed.filter((c) => c === late).length === 1 && io.observed.length === 4);
stop();
check('cleanup disconnects both observers', io.disconnected && moInstances[0].disconnected);

// no IntersectionObserver (an old browser): nothing may be hidden
delete (g as Record<string, unknown>).IntersectionObserver;
const lone = [new FakeCell('z')];
watchGlintCells({ children: lone as unknown as HTMLCollection, parentElement: null } as unknown as HTMLElement);
check('without IntersectionObserver every cell counts as near (no windowing, nothing hidden)', lone[0].hasAttribute('data-near'));
g.setTimeout = savedTimeout; g.clearTimeout = savedClear;

if (failures) { console.error(`\n✗ ${failures} check(s) failed`); process.exit(1); }
console.log('\n✓ nothing decorative competes with a scroll, and no new animation can join silently');
