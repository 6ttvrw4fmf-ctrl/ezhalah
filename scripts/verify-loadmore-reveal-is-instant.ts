// PERMANENT BARRIER: «عرض المزيد» REVEALS AT ONCE (owner 2026-10-05, real iPhone: «عرض المزيد takes
// time … should never ever have this»).
//
// MEASURED on a production export (`expo export --platform web`), Playwright Chromium 390×844, CDP
// CPU throttle 4×, الرياض/إيجار/شقة (132,757 matches), same search before/after:
//
//                        before (main 5b927aae)            after
//   press 1 (85 → 100)   all 1.5–2.1 s                     all 0.22–0.26 s
//   press 2 (100 → 500)  first 0.2 s, all 3.9–4.1 s,       first 0.11–0.13 s, all 0.90–0.95 s,
//                        main thread 17–22 s, one          main thread 1.2 s, longest frame
//                        8–12 s frozen frame               ~0.75 s (the 386 below-fold cards)
//
// Three causes, each locked here by EXECUTING the real code:
//
//  1. bottomPromptInset's MutationObserver watched the whole document (subtree + style/class) and
//     re-ran two document-wide querySelectorAll on EVERY mutation — each card mount and each
//     animation frame. 12.6 s of press 2's 15.6 s main-thread time. It now re-measures only for a
//     mutation that can change a prompt (`mutationTouchesPrompt`).
//  2. The press re-rendered the whole unvirtualized list once per card (a 55 ms drip of 14), then
//     mounted the rest in one more render. `cascadeIn` now mounts the on-screen cards in ONE render
//     (CardIn staggers them by index) and the rest once that frame has painted: two renders a press.
//  3. Each card's fade ran on reanimated, which on web is a JS loop per card per frame. Web CardIn
//     is a CSS keyframe now (compositor, no JS), and cards mounted below the fold mount still,
//     with `content-visibility: auto` so the browser skips their layout until they near the screen.
//
// WHICH cards and in WHAT order are untouched: the same slice of the same list reaches the same
// target (verify-result-cap-honesty / verify-loadmore-cumulative-mount-is-bounded own those).
//
//   node --experimental-strip-types scripts/verify-loadmore-reveal-is-instant.ts
//   (auto-discovered by npm test — scripts/lib/testRegistry.ts)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { windowBetween } from './lib/sourceWindow.ts';
import { mutationTouchesPrompt } from '../src/lib/bottomPromptInset.ts';

const root = join(import.meta.dirname, '..');
const AGENT = join(root, 'src/app/agent.tsx');
const agentSrc = readFileSync(AGENT, 'utf8');
const insetSrc = readFileSync(join(root, 'src/lib/bottomPromptInset.ts'), 'utf8');
const revealSrc = readFileSync(join(root, 'src/components/CardReveal.tsx'), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mutantOf = (from: string, to: string): string => {
  if (!agentSrc.includes(from)) throw new Error(`mutation anchor missing:\n${from}`);
  const f = join(mkdtempSync(join(tmpdir(), 'ezhalah-instant-mut-')), 'mutant.tsx');
  writeFileSync(f, agentSrc.replace(from, to));
  return f;
};

// ── 2. cascadeIn: two renders, the on-screen batch first, never lowers, ownership kept ──────────
type Bus = {
  state: Record<string, number>; renders: number[]; revealing: boolean[]; frames: (() => void)[];
  timers: (() => void)[]; active: { id: string; count: number } | null; ref: Record<string, number>;
  cardRow?: 'roomy' | 'tight';
  cardCols?: 2 | 3;
  live?: Set<string>; // results turns a search produced live in this conversation (liveTurnsRef)
};
const gb = globalThis as unknown as { __bus: Bus };
const PRELUDE = [
  'const bus: any = (globalThis as any).__bus;',
  'const CASCADE_VISIBLE = 14;',
  'const LOAD_MORE_STEP_MS = 55;',
  'const cardRow = bus.cardRow;',
  'const cardCols = bus.cardCols;',
  'const cascadeWindowRef: any = { current: {} };',
  'const liveTurnsRef: any = { get current() { return bus.live; } };',
  'const revealCountRef: any = { get current() { return bus.ref; } };',
  'const revealActiveRef: any = { get current() { return bus.active; }, set current(v) { bus.active = v; } };',
  'const revealTimers: any = { current: [] };',
  'const setRevealing = (v: boolean) => { bus.revealing.push(v); };',
  'const setRevealCount = (f: any) => { bus.state = f(bus.state); bus.renders.push(bus.state.mid); };',
  'const requestAnimationFrame = (f: () => void) => { bus.frames.push(f); return 0; };',
  'const setTimeout = (f: () => void, _ms?: number) => { bus.timers.push(f); return 0; };',
].join('\n');
const lift = (file: string) => liftSymbols(file, [
  { header: 'const STILL_CARD_HEIGHT = ', endsWith: /^  cols === 3 \? .*;$/ },
  { header: '  const cascadeIn = (mid: string, from: number, target: number) => {', endsWith: /^  \};$/ },
  { header: '  const cardInMotion = (mid: string, i: number) => {', endsWith: /^  \};$/ },
], ['cascadeIn', 'cardInMotion'], PRELUDE);
const flush = (b: Bus) => { while (b.frames.length || b.timers.length) { b.frames.splice(0).forEach((f) => f()); b.timers.splice(0).forEach((f) => f()); } };
const press = async (file: string, from: number, target: number, seed: Partial<Bus> = {}, between?: (b: Bus) => void) => {
  const b: Bus = { state: { mid: from }, renders: [], revealing: [], frames: [], timers: [], active: null, ref: { mid: from }, live: new Set(['mid', 'other']), ...seed };
  gb.__bus = b;
  const m = await lift(file);
  (m.cascadeIn as (mid: string, f: number, t: number) => void)('mid', from, target);
  const beforePaint = b.state.mid;
  between?.(b);
  flush(b);
  return { b, beforePaint, cardInMotion: m.cardInMotion as (mid: string, i: number) => { delayMs?: number; stillHeight?: number } };
};

const p2 = await press(AGENT, 100, 500);
check('press 100 → 500: the first render mounts only the on-screen batch (114), before any frame',
  p2.beforePaint === 114, `got ${p2.beforePaint}`);
check('…and the rest (500) lands after that frame — two renders in total, never one per card',
  p2.b.state.mid === 500 && p2.b.renders.length === 2, `renders ${JSON.stringify(p2.b.renders)}`);
check('…`revealing` holds through the press and clears once everything is mounted',
  JSON.stringify(p2.b.revealing) === '[true,false]' && p2.b.active === null, JSON.stringify(p2.b));
const motion = (i: number) => JSON.stringify(p2.cardInMotion('mid', i));
check('CardIn: on-screen cards stagger 55 ms apart from the press point; earlier cards untouched',
  motion(99) === '{}' && motion(100) === '{"delayMs":0}' && motion(113) === '{"delayMs":715}',
  `${motion(99)} ${motion(100)} ${motion(113)}`);
check('CardIn: every card past the on-screen batch mounts still (phone placeholder 370px)',
  motion(114) === '{"stillHeight":370}' && motion(499) === '{"stillHeight":370}', motion(114));
// THE PLACEHOLDER IS THE CARD'S REAL HEIGHT in the layout on screen (owner 2026-10-25, saved chats glitched): it was 140 for
// every laptop layout while the photo cards three across are ~400, so a reopened 500-card chat believed it was a third of
// its height and jumped as the cards filled in. Measured medians: phone 367 · 3 across 396 · 2 across 414–463 · pane open 148.
const heightIn = async (seed: Partial<Bus>) => JSON.stringify((await press(AGENT, 100, 500, seed)).cardInMotion('mid', 200));
check('CardIn: laptop, three cards across → the 400px photo card', await heightIn({ cardRow: 'roomy', cardCols: 3 }) === '{"stillHeight":400}');
check('CardIn: laptop, two across → the 440px photo card', await heightIn({ cardRow: 'roomy', cardCols: 2 }) === '{"stillHeight":440}');
check('CardIn: laptop with the ad pane open (one tight row) → 148px', await heightIn({ cardRow: 'tight' }) === '{"stillHeight":148}');
check('MUTATION — the old 140px placeholder on a three-across laptop is caught', await heightIn({ cardRow: 'roomy', cardCols: 3 }) !== '{"stillHeight":140}');
check('CardIn: a LIVE turn no press touched animates as before', JSON.stringify(p2.cardInMotion('other', 3)) === '{}');
// A REOPENED chat renders in its final state (owner 2026-10-10, iPhone: switching chats went blank). Its
// turns are not live, so every card mounts still — measured locally before this: switching to a 100-card
// chat started 100 mount-ins at once and the cards on screen sat at opacity 0 for 10 samples in a row.
const reopened = await press(AGENT, 100, 500, { live: new Set() });
const still = (i: number, mid = 'restored') => JSON.stringify(reopened.cardInMotion(mid, i));
check('CardIn: a reopened turn mounts every card still (no mount-in replayed on a chat switch)',
  still(0) === '{"stillHeight":370}' && still(3) === '{"stillHeight":370}', still(0));
check('CardIn: «عرض المزيد» on a reopened turn still cascades its new batch; its earlier cards stay still',
  still(99, 'mid') === '{"stillHeight":370}' && still(100, 'mid') === '{"delayMs":0}', `${still(99, 'mid')} ${still(100, 'mid')}`);

const small = await press(AGENT, 24, 30);
check('a press that fits on screen is ONE render with nothing left pending',
  small.beforePaint === 30 && small.b.renders.length === 1 && small.b.revealing.length === 0 && small.b.active === null,
  JSON.stringify(small.b));

// A scroll chunk mounted past this press's `from` (state 130 while the press read 100).
const raced = await press(AGENT, 100, 500, { state: { mid: 130 }, ref: { mid: 100 } });
check('a press never UN-mounts a card a scroll chunk already showed', raced.b.renders.every((n) => n >= 130),
  JSON.stringify(raced.b.renders));

// finalize/Stop/new turn took the reveal over between the two renders.
const stolen = await press(AGENT, 100, 500, {}, (b) => { b.active = { id: 'newer-turn', count: 7 }; });
check('a newer turn that took over the reveal is never written by the old press', stolen.b.state.mid === 114,
  `state ${stolen.b.state.mid}`);

const mustCatch = async (label: string, from: string, to: string, run: (file: string) => Promise<boolean>) =>
  check(`MUTATION — ${label}`, !(await run(mutantOf(from, to))));
await mustCatch('mounting everything in the press render is caught',
  "    requestAnimationFrame(() => { revealTimers.current.push(setTimeout(rest, 0)); });",
  '    rest();',
  async (f) => (await press(f, 100, 500)).beforePaint === 114);
await mustCatch('an absolute write that can un-mount scroll-chunk cards is caught',
  'setRevealCount((c) => ({ ...c, [mid]: Math.max(c[mid] ?? 0, animEnd) }));',
  'setRevealCount((c) => ({ ...c, [mid]: animEnd }));',
  async (f) => (await press(f, 100, 500, { state: { mid: 130 }, ref: { mid: 100 } })).b.renders.every((n) => n >= 130));
await mustCatch('dropping the ownership guard is caught',
  "      if (revealActiveRef.current?.id !== mid) return;   // finalize/Stop/new turn owns it now\n",
  '',
  async (f) => (await press(f, 100, 500, {}, (b) => { b.active = { id: 'newer-turn', count: 7 }; })).b.state.mid === 114);
await mustCatch('a reopened chat replaying every card\'s mount-in is caught',
  '    if (!w || i < w.from) return liveTurnsRef.current.has(mid) ? {} : still;',
  '    if (!w || i < w.from) return {};',
  async (f) => JSON.stringify((await press(f, 100, 500, { live: new Set() })).cardInMotion('restored', 0)) === '{"stillHeight":370}');
check('loadMore still hands its reveal to cascadeIn(mid, cur, revealTo)', /else cascadeIn\(mid, cur, revealTo\);/.test(agentSrc));

// ── 1. the prompt observer ignores mutations that cannot touch a prompt ─────────────────────────
class N {
  nodeType = 1; parent: N | null = null; kids: N[] = []; prompt: boolean;
  constructor(prompt = false) { this.prompt = prompt; }
  add(...k: N[]) { for (const c of k) { c.parent = this; this.kids.push(c); } return this; }
  matches() { return this.prompt; }
  querySelector(): N | null { for (const k of this.kids) { if (k.prompt) return k; const d = k.querySelector(); if (d) return d; } return null; }
  contains(n: N) { for (let x: N | null = n; x; x = x.parent) if (x === this) return true; return false; }
}
const text = { nodeType: 3, contains: () => false } as unknown as N;
const body = new N();
const card = new N().add(new N(), new N().add(new N()));
const iframe = new N(true);
const fixedBox = new N().add(iframe);
body.add(card, fixedBox);
const watched = [iframe, fixedBox];
const rec = (r: Partial<{ type: string; target: N; addedNodes: N[]; removedNodes: N[] }>) =>
  ({ type: 'childList', target: body, addedNodes: [], removedNodes: [], ...r }) as unknown as MutationRecord;
type Case = [string, MutationRecord[], boolean];
const cases: Case[] = [
  ['a card subtree mounting', [rec({ addedNodes: [card] })], false],
  ['an animation frame restyling a card', [rec({ type: 'attributes', target: card.kids[1] })], false],
  ['a text node', [rec({ addedNodes: [text] })], false],
  ['the prompt iframe arriving', [rec({ addedNodes: [iframe] })], true],
  ['a container holding the prompt arriving', [rec({ addedNodes: [fixedBox] })], true],
  ['the watched prompt leaving', [rec({ removedNodes: [iframe] })], true],
  ['a subtree holding the watched prompt leaving', [rec({ removedNodes: [fixedBox] })], true],
  ['the prompt restyled (slide-in, hide)', [rec({ type: 'attributes', target: iframe })], true],
  ['an ancestor of the prompt restyled', [rec({ type: 'attributes', target: body })], true],
  ['one relevant record among card noise', [rec({ addedNodes: [card] }), rec({ type: 'attributes', target: fixedBox })], true],
];
const runCases = (fn: typeof mutationTouchesPrompt) =>
  cases.every(([, records, want]) => fn(records, 'x', watched as unknown as Node[]) === want);
for (const [label, records, want] of cases) {
  check(`prompt observer: ${label} → ${want ? 're-measure' : 'ignored'}`,
    mutationTouchesPrompt(records, 'x', watched as unknown as Node[]) === want);
}
check('MUTATION — the old "every mutation re-measures" observer is caught', !runCases(() => true));
check('MUTATION — ignoring an ancestor restyle is caught',
  !runCases((records, sel, w) => Array.from(records).some((r) => r.type === 'childList'
    ? mutationTouchesPrompt([r], sel, w) : w.includes(r.target))));
check('observePromptInsets routes its MutationObserver through mutationTouchesPrompt',
  /new MutationObserver\(\(records\) => \{ if \(mutationTouchesPrompt\(records, selector, watched\)\) tick\(\); \}\)/.test(insetSrc)
  && !/new MutationObserver\(tick\)/.test(insetSrc));

// ── 3. web CardIn is CSS, and still cards skip off-screen layout ────────────────────────────────
const webBody = windowBetween(revealSrc, 'function CardInWeb', 'function CardInNative', 'src/components/CardReveal.tsx');
check('web CardIn uses CSS keyframes, not a reanimated shared value per card',
  /export const CardIn = Platform\.OS === 'web' \? CardInWeb : CardInNative;/.test(revealSrc)
  && !/useSharedValue|withTiming|Animated\./.test(webBody) && /animationKeyframes/.test(revealSrc));
check('a still card mounts with content-visibility: auto and its placeholder height (no animation)',
  /stillHeight\s*\? \(\{ contentVisibility: 'auto', containIntrinsicSize: `auto \$\{stillHeight\}px` \}/.test(webBody));

if (failures) { console.error(`\n✗ ${failures} check(s) failed`); process.exit(1); }
console.log('\n✓ «عرض المزيد» reveals in two renders, and nothing re-scans the page per card');
