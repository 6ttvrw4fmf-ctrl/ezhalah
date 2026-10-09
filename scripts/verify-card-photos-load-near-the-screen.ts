// A CARD'S PHOTO IS DOWNLOADED WHEN THE CARD IS ABOUT TO BE SEEN, NOT WHEN IT MOUNTS (2026-10-06).
//
// THE DEFECT. «عرض المزيد» 100 → 500 mounts ~400 cards below the fold. Each card's <img> is lazy, but
// ListingPhoto's web probe (`new window.Image()`, the CORP / 404 safety net — see
// verify-card-photos-are-browser-renderable.ts) started on mount, so every one of those photos was
// downloaded at once. Measured on a production export, phone 390×844, CPU 4×, Fast 3G, الرياض/إيجار/
// شقة: ~325 photo requests (averaging 200–470 KB) fired within 3 s of the second press (within 1 s
// with PR #6172's instant reveal), and the first new card ON SCREEN waited 8–19 s for its photo, or
// never got it inside a minute. With the gate: 8 requests, the cards on and just below the screen.
//
// THE FIX. The probe waits for `near` (src/lib/nearViewport.ts whenNear): an IntersectionObserver with
// a generous rootMargin AND scrollMargin (the cards scroll inside a ScrollView, which clips them, so
// rootMargin alone would only fire once a card is visible). No observer / no element → runs at once,
// so the gate can delay the safety net but never remove it.
//
// 2026-10-09, AND EARLY ENOUGH THAT A BRISK SCROLL NEVER MEETS AN EMPTY BOX (owner: «photos start
// popping up»). Measured in WebKit 26.5: cards «عرض المزيد» mounts "still" sit inside
// `content-visibility: auto`, and WebKit reports nothing inside skipped content until it is on
// screen — each photo started ~75 ms before its card arrived, and 43 of 72 cards flashed an empty
// box on a brisk scroll. whenNear now watches the sleeping card's WRAPPER, against the list's own
// SCROLLER (nearGeometry): 0–1 of 72 in WebKit, 3 of 75 in Chromium on 4G (today's eager build: 38).
// The behaviour half lives in scripts/verify-web-runtime-smoke.mjs journey D2: the BUILT app must
// fetch ≤ 40 photos after the second press (old build: 367).
//
// This barrier EXECUTES whenNear against a scripted IntersectionObserver, proves each check can fail
// by running it against broken variants, then pins the wiring in ListingPhoto.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { whenNear, nearGeometry, NEAR_MARGIN } from '../src/lib/nearViewport.ts';
import { windowBetween } from './lib/sourceWindow.ts';

let failed = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failed++;
};
console.log('\nA card photo loads when the card nears the screen, and a broken photo still reaches the placeholder\n');

// A scripted IntersectionObserver: the test decides when the element "comes near".
type Init = { root?: unknown; rootMargin?: string; scrollMargin?: string };
function fakeIO() {
  const log = { created: 0, observed: [] as unknown[], disconnects: 0, init: undefined as Init | undefined,
    fire: (_hit: boolean) => {} };
  class IO {
    constructor(cb: (e: { isIntersecting: boolean }[]) => void, init?: Init) {
      log.created++; log.init = init; log.fire = (hit) => cb([{ isIntersecting: hit }]);
    }
    observe(el: unknown) { log.observed.push(el); }
    disconnect() { log.disconnects++; }
  }
  return { IO, log };
}

const px = (m?: string) => Number(/^(\d+)px$/.exec(m ?? '')?.[1] ?? 0);

/** Every behaviour the photo gate promises, as a list of broken promises (empty = sound). */
function judge(impl: typeof whenNear): string[] {
  const bad: string[] = [];
  const el = { tag: 'card-photo' };

  // 1. Far away → nothing happens; near → exactly once; then it stops watching.
  { const { IO, log } = fakeIO(); let n = 0;
    impl(el, () => n++, IO);
    if (n !== 0) bad.push('fires before the card is near the screen (the eager download storm)');
    if (log.observed[0] !== el) bad.push('does not observe the card\'s own element');
    log.fire(false);
    if (n !== 0) bad.push('fires on a "not intersecting" entry');
    log.fire(true);
    if (n !== 1) bad.push(`near → onNear ran ${n}×, want exactly 1`);
    log.fire(true);
    if (n !== 1) bad.push('fires again after it already fired');
    if (log.disconnects < 1) bad.push('keeps observing after it fired (one live observer per card, forever)');
    // 2. The margin reaches through the results ScrollView, and is generous.
    if (px(log.init?.rootMargin) < 600) bad.push(`rootMargin ${log.init?.rootMargin} — too small to load before the card is seen`);
    if (px(log.init?.scrollMargin) < 600) bad.push(`scrollMargin ${log.init?.scrollMargin} — the ScrollView clips the card, so without it the photo waits until visible`);
  }
  // 3. The gate can only delay the safety net, never lose it.
  { let n = 0; impl(el, () => n++, undefined);
    if (n !== 1) bad.push('no IntersectionObserver → the probe never runs (a CORP-blocked photo stays a blank box)'); }
  { const { IO } = fakeIO(); let n = 0; impl(null, () => n++, IO);
    if (n !== 1) bad.push('no element to watch → the probe never runs'); }
  { const { IO } = fakeIO(); let n = 0;
    const Refuses = class extends IO { observe(): void { throw new TypeError('parameter 1 is not of type Element'); } };
    try { impl({ notAnElement: true }, () => n++, Refuses); } catch { bad.push('throws when the element cannot be observed (the card would crash)'); }
    if (n !== 1) bad.push('an element the observer refuses → the probe never runs'); }
  // 4. An unmounted card stops listening and never calls back (no setState after teardown).
  { const { IO, log } = fakeIO(); let n = 0;
    const stop = impl(el, () => n++, IO); stop(); log.fire(true);
    if (n !== 0) bad.push('calls back after its card unmounted');
    if (log.disconnects < 1) bad.push('unmount does not disconnect the observer'); }
  // 5. Inside the real list: watched through a sleeping card's wrapper, against the list's scroller.
  { const scroller = { name: 'scroller', parentElement: null as unknown };
    const grid = { name: 'grid', parentElement: scroller };
    const sleeping = { name: 'card-wrapper', parentElement: grid };
    const column = { name: 'photo-column', parentElement: sleeping };
    const photo = { name: 'photo', parentElement: column };
    const styles = new Map<unknown, object>([[scroller, { overflowY: 'auto' }], [sleeping, { contentVisibility: 'auto' }]]);
    const g = globalThis as { getComputedStyle?: unknown };
    const saved = g.getComputedStyle;
    g.getComputedStyle = (e: unknown) => styles.get(e) ?? { overflowY: 'visible', contentVisibility: 'visible' };
    try {
      const { IO, log } = fakeIO(); impl(photo, () => {}, IO);
      const seen = (log.observed[0] as { name?: string } | undefined)?.name;
      if (seen !== 'card-wrapper') bad.push(`watches the ${seen} inside a sleeping card, not its wrapper (WebKit then starts the photo only as the card reaches the screen)`);
      if (log.init?.root !== scroller) bad.push('measures nearness against the window, not the list\'s own scroller');
    } finally { g.getComputedStyle = saved; }
  }
  return bad;
}

// ── 1. the real gate keeps every promise ─────────────────────────────────────────────────────────
const real = judge(whenNear);
check('whenNear: waits until near, fires once, sees through the ScrollView, never loses or crashes the probe', real.length === 0, real.join('; '));
check(`NEAR_MARGIN (${NEAR_MARGIN}) is early enough to beat a brisk scroll, never a download-everything`, px(NEAR_MARGIN) >= 600 && px(NEAR_MARGIN) <= 3000);

// ── 2. the checks have teeth: each broken gate is caught ─────────────────────────────────────────
type Impl = typeof whenNear;
// The real gate rebuilt from two switches, so a mutant differs from it in exactly one decision.
const variant = (watch: 'wrapper' | 'photo', against: 'scroller' | 'window'): Impl => (el, onNear, IO) => {
  if (!IO || !el) { onNear(); return () => {}; }
  const geo = nearGeometry(el); let done = false;
  const io = new IO((e) => { if (done || !e.some((x) => x.isIntersecting)) return; done = true; io.disconnect(); onNear(); },
    { root: against === 'scroller' ? geo.root : null, rootMargin: NEAR_MARGIN, scrollMargin: NEAR_MARGIN });
  try { io.observe((watch === 'wrapper' ? geo.target : el) as Element); } catch { done = true; io.disconnect(); onNear(); }
  return () => { done = true; io.disconnect(); };
};
check('the two-switch rebuild of the gate is itself sound (so its mutants below differ by one decision)', judge(variant('wrapper', 'scroller')).length === 0,
  judge(variant('wrapper', 'scroller')).join('; '));
const mutants: [string, Impl][] = [
  ['watching the photo inside a sleeping card (the 2026-10-09 WebKit pop-in)', variant('photo', 'scroller')],
  ['measuring against the window, not the list\'s scroller', variant('wrapper', 'window')],
  ['eager: probe on mount (the 2026-10-06 storm)', (_el, onNear) => { onNear(); return () => {}; }],
  ['never fires without an observer (safety net lost)', (el, onNear, IO) => (IO ? whenNear(el, onNear, IO) : () => {})],
  ['rootMargin only, no scrollMargin', (el, onNear, IO) => whenNear(el, onNear, IO && class extends (IO as any) {
    constructor(cb: any, init: any) { super(cb, { rootMargin: init?.rootMargin }); } } as any)],
  ['ignores isIntersecting', (el, onNear, IO) => whenNear(el, onNear, IO && class extends (IO as any) {
    constructor(cb: any, init: any) { super((e: any[]) => cb(e.map(() => ({ isIntersecting: true }))), init); } } as any)],
  ['unmount does not stop it', (el, onNear, IO) => { whenNear(el, onNear, IO); return () => {}; }],
  ['observe() errors escape', (el, onNear, IO) => {
    if (!IO || !el) { onNear(); return () => {}; }
    const io = new IO((e) => { if (e.some((x) => x.isIntersecting)) onNear(); }, { rootMargin: NEAR_MARGIN, scrollMargin: NEAR_MARGIN });
    io.observe(el as Element); return () => io.disconnect(); }],
];
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
for (const [name, impl] of mutants) mustCatch(`a gate that is «${name}»`, judge(impl).length > 0);

// ── 3. ListingPhoto is wired to the gate ─────────────────────────────────────────────────────────
const card = readFileSync(join(import.meta.dirname, '..', 'src/components/ResultCard.tsx'), 'utf8');
const fn = windowBetween(card, 'function ListingPhoto', 'function SourceBadge', 'src/components/ResultCard.tsx');
const probeEffect = windowBetween(fn, 'useEffect(() => {\n    if (!IS_WEB', 'const uri = photos[idx];\n  //', 'ListingPhoto');
check('the probe effect returns early until the card is near', /if \(!IS_WEB \|\| !near\b/.test(probeEffect), probeEffect.slice(0, 80));
mustCatch('the pre-2026-10-06 eager probe effect (no `near` gate)',
  !/if \(!IS_WEB \|\| !near\b/.test("useEffect(() => {\n    if (!IS_WEB || typeof window === 'undefined') return;"));
check('the probe effect re-runs when `near` flips', /\}, \[key, idx, near\]\);/.test(probeEffect));
check('`near` comes from whenNear watching the photo\'s own box', /whenNear\(box\.current, \(\) => setNear\(true\)\)/.test(fn) && /<View ref=\{box\} style=\{style\}>/.test(fn));
check('native is never gated (no probe there; expo-image onError works)', /useState\(!IS_WEB\)/.test(fn));
check('the <img> itself is lazy (pinned, not left to the expo-image default)', /<Image[\s\S]*?loading="lazy"[\s\S]*?\/>/.test(fn));
check('the probe still exists and still advances past a broken photo',
  /new window\.Image\(\)/.test(fn) && /i === idx \? i \+ 1 : i/.test(fn) && /No photo available/.test(fn));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ card photos load near the screen; the CORP / 404 safety net is intact');
