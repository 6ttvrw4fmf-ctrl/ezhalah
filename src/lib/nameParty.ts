import { Platform } from 'react-native';

// The «وش نناديك؟» box's motion and the party after «حفظ» — the owner-approved demo
// (mockups/name-box-party.html, 2026-10-23), its CSS ported as-is. Web only: the elements carry
// data-ezh-* attributes (react-native-web `dataSet`) and this one stylesheet animates them; native
// renders the same box without motion. prefers-reduced-motion: no motion, and startNameParty draws nothing.

/** THE CELEBRATION IS FIREWORKS (owner 2026-10-28, from the moving preview: «make it like fireworks, exploding … I want a
 *  lot and quick … keep sending»; it replaces the 2026-10-27 confetti). Rockets fire from the bottom of the screen, one
 *  every ~LAUNCH_EVERY_MS for LAUNCH_FOR_MS, all over the width, and each explodes into a round shell of sparks and
 *  confetti that falls and fades. The headline listens: at the FIRST pop it shows «نورت {name} 🥳…»
 *  (PARTY_FIRST_POP_EVENT) and when the last spark is gone it changes to the fact (PARTY_END_EVENT). One fixed full-screen
 *  canvas, removed at the end and in any case by PARTY_MS. Self-contained: no external script. */
export const LAUNCH_FOR_MS = 3500;
/** faster and denser (owner 2026-10-28: «faster, a lot of pops … full laptop screen … make it cool») */
export const LAUNCH_EVERY_MS = 35;
/** Wider screens get proportionally more rockets so a laptop is as full as a phone (at most ~1.7× the phone rate). */
export const launchEveryFor = (width: number): number => LAUNCH_EVERY_MS * Math.min(1, Math.max(0.6, 500 / (width || 500)));
export const SPARKS_PER_BURST = 85;
/** The layer is always gone by then (rise ≤ ~1 s and sparks ≤ ~1.6 s after the last launch). */
export const PARTY_MS = 6500;
/** Ezhalah green and gold first, then party colours. */
export const FIREWORK_COLORS = ['#2f7247', '#5fae7c', '#d8b14a', '#f2c14e', '#e9739a', '#4f8fe0', '#a77ee8', '#ff8a3d'];
export const PARTY_FIRST_POP_EVENT = 'ezhalah:party-first-pop';
export const PARTY_END_EVENT = 'ezhalah:party-end';
/** SOONER (owner 2026-10-29: «the fireworks come up a bit late, make it faster»): rockets climb faster, and the opening
 *  volley (the rockets of the first OPENING_MS) starts already high, so the first pop lands in about a third of a second. */
export const ROCKET_GRAVITY = 0.6;
export const OPENING_MS = 160;
export const OPENING_HOP = 0.09;
export type Rocket = { at: number; x: number; ty: number; c: string; c2: string };
/** The launch plan: when each rocket leaves, where (fraction of the width) and how high it bursts (fraction of the height). */
export function fireworksPlan(rand: () => number = Math.random, every: number = LAUNCH_EVERY_MS): Rocket[] {
  const out: Rocket[] = [];
  for (let at = 0, i = 0; at < LAUNCH_FOR_MS; at += every * (0.6 + 0.8 * rand()), i++) {
    out.push({ at: Math.round(at), x: 0.06 + 0.88 * rand(), ty: 0.06 + 0.54 * rand(), c: FIREWORK_COLORS[i % FIREWORK_COLORS.length], c2: FIREWORK_COLORS[(i + 3) % FIREWORK_COLORS.length] });
  }
  return out;
}
/** A second celebration this soon after one is skipped: the sign-up box and the sign-in welcome never stack. */
export const PARTY_GAP_MS = 6000;
/** The home headline listens for this to shine (2 passes) while the party plays. */
export const NAME_PARTY_EVENT = 'ezhalah:name-party';
export const SHINE_MS = 4800;


const CSS = `
[data-ezh-scrim]{opacity:0;-webkit-backdrop-filter:blur(0px);backdrop-filter:blur(0px);transition:opacity .28s ease,backdrop-filter .28s ease,-webkit-backdrop-filter .28s ease}
[data-ezh-scrim="on"]{opacity:1;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
[data-ezh-scrim="leave"]{opacity:0;transition:opacity .22s ease-in}
[data-ezh-card]{transform:translateY(6%) scale(.94);opacity:0;transition:transform .46s cubic-bezier(.18,.95,.3,1.12),opacity .26s ease}
[data-ezh-scrim="on"] [data-ezh-card]{transform:none;opacity:1}
[data-ezh-scrim="leave"] [data-ezh-card]{transform:scale(.9);opacity:0;transition:transform .22s ease-in,opacity .2s ease-in}
[data-ezh-av]{transform:scale(.6);transition:transform .5s cubic-bezier(.2,1.4,.4,1) .12s}
[data-ezh-scrim="on"] [data-ezh-av]{transform:scale(1)}
[data-ezh-letter]{animation:ezhPop .32s cubic-bezier(.2,1.5,.4,1)}
@keyframes ezhPop{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}
[data-ezh-thumb]{transition:transform .32s cubic-bezier(.2,.9,.3,1.15)}
[data-ezh-segtext]{transition:color .2s}
[data-ezh-field]{transition:border-color .2s,box-shadow .2s}
[data-ezh-chipwrap]{display:grid!important;grid-template-rows:0fr;transition:grid-template-rows .3s ease}
[data-ezh-chipwrap="show"]{grid-template-rows:1fr}
[data-ezh-chipwrap]>*{overflow:hidden;min-height:0}
[data-ezh-save]{transition:background-color .25s,transform .12s}
[data-ezh-save]:active{transform:scale(.97)}
[data-ezh-shake="a"]{animation:ezhShakeA .26s}
[data-ezh-shake="b"]{animation:ezhShakeB .26s}
@keyframes ezhShakeA{0%{transform:translateX(0)}33%{transform:translateX(-6px)}66%{transform:translateX(6px)}100%{transform:translateX(0)}}
@keyframes ezhShakeB{0%{transform:translateX(0)}33%{transform:translateX(-6px)}66%{transform:translateX(6px)}100%{transform:translateX(0)}}
[data-ezh-shine="on"]{background-image:linear-gradient(100deg,#2f7247 30%,#5fae7c 45%,#d8b14a 50%,#5fae7c 55%,#2f7247 70%)!important;background-size:250% 100%!important;-webkit-background-clip:text!important;background-clip:text!important;-webkit-text-fill-color:transparent;color:transparent!important;animation:ezhShine 2.4s ease-in-out 2}
@keyframes ezhShine{from{background-position:110% 0}to{background-position:-10% 0}}
[data-ezh-shine="on"] [data-ezh-emoji]{-webkit-text-fill-color:initial!important;color:initial!important}
[data-ezh-party]{position:fixed;inset:0;pointer-events:none;z-index:2147483001;overflow:hidden}
[data-ezh-party] canvas{position:absolute;inset:0;width:100%;height:100%}
@media (prefers-reduced-motion:reduce){[data-ezh-scrim],[data-ezh-scrim] *,[data-ezh-shine]{animation:none!important;transition:none!important}[data-ezh-party]{display:none}}
`;

export function ensureNameBoxCss(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || document.getElementById('ezh-name-box-css')) return;
  const el = document.createElement('style');
  el.id = 'ezh-name-box-css';
  el.textContent = CSS;
  document.head.appendChild(el);
}

let lastParty = -Infinity;

/** ONE CONFETTI PER SIGN-IN (owner 2026-10-27: «it shows twice … the animation of the falconer first, then the confetti,
 *  that's it»). While the home's falconer is on screen HE starts the confetti, when his sign-in story ends; the name
 *  box's own trigger then stands down (it used to fire at once, before the story, and the falconer fired it again
 *  after). Away from the home (no falconer) the box still gives the party. */
let heroOwners = 0;
/** The falconer claims the party while mounted; returns the release. */
export function claimNameParty(): () => void {
  heroOwners++;
  return () => { heroOwners = Math.max(0, heroOwners - 1); };
}
/** The name box's trigger: nothing while the falconer owns the party. */
export function startNamePartyFromBox(reduced: boolean): void {
  if (heroOwners > 0) return;
  startNameParty(reduced);
}

/** The fireworks after a sign-in / sign-up. Decoration only: pointer-events:none, one canvas, and the whole layer removes
 *  itself when the last spark is gone (and at PARTY_MS at the latest). No external script. Reduced motion → nothing. */
export function startNameParty(reduced: boolean): void {
  if (reduced || Platform.OS !== 'web' || typeof document === 'undefined') return;
  const now = Date.now();
  if (now - lastParty < PARTY_GAP_MS) return;
  lastParty = now;
  ensureNameBoxCss();
  const say = (name: string) => { try { globalThis.dispatchEvent?.(new Event(name)); } catch { /* not a browser */ } };
  say(NAME_PARTY_EVENT);

  const layer = document.createElement('div');
  layer.setAttribute('data-ezh-party', '');
  const canvas = document.createElement('canvas') as HTMLCanvasElement;
  (layer as any).appendChild?.(canvas);
  document.body.appendChild(layer);
  let ended = false;
  const finish = () => { if (ended) return; ended = true; layer.remove(); say(PARTY_END_EVENT); };
  setTimeout(finish, PARTY_MS);
  let popped = false;
  const firstPop = () => { if (!popped) { popped = true; say(PARTY_FIRST_POP_EVENT); } };

  const ctx = (canvas as any).getContext?.('2d') as CanvasRenderingContext2D | null | undefined;
  const raf = (globalThis as any).requestAnimationFrame as ((f: (t: number) => void) => number) | undefined;
  if (!ctx || !raf) { firstPop(); return; } // no canvas here: the headline still moves on; the timer clears the layer
  const dpr = Math.min(2, (globalThis as any).devicePixelRatio || 1);
  const W = (globalThis as any).innerWidth || 375, H = (globalThis as any).innerHeight || 812;
  canvas.width = W * dpr; canvas.height = H * dpr;
  (canvas as any).style.width = '100%'; (canvas as any).style.height = '100%';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const rockets = fireworksPlan(Math.random, launchEveryFor(W)).map((r) => ({ ...r, x: r.x * W, y: r.at < OPENING_MS ? (r.ty + OPENING_HOP) * H : H + 10, ty: r.ty * H, vy: 0, done: false }));
  type Spark = { x: number; y: number; px: number; py: number; vx: number; vy: number; life: number; max: number; c: string; kind: 0 | 1 | 2 | 3; w: number; h: number; rot: number; vr: number; flip: number };
  const sparks: Spark[] = [];
  const explode = (r: typeof rockets[number]) => {
    firstPop();
    const n = SPARKS_PER_BURST + ((Math.random() * 25) | 0), base = rnd(2.6, 3.8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.06, 0.06), sp = base * rnd(0.55, 1.05);
      sparks.push({ x: r.x, y: r.y, px: r.x, py: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rnd(1100, 1600),
        c: Math.random() < 0.5 ? r.c : r.c2, kind: Math.random() < 0.3 ? 1 : 0, w: rnd(3, 6), h: rnd(6, 10), rot: rnd(0, 6), vr: rnd(-0.3, 0.3), flip: rnd(0, 6) });
    }
    for (let i = 0; i < 10; i++) sparks.push({ x: r.x, y: r.y, px: r.x, py: r.y, vx: rnd(-0.6, 0.6), vy: rnd(-0.6, 0.6), life: 0, max: rnd(400, 700), c: '#fff6d8', kind: 2, w: 0, h: 0, rot: 0, vr: 0, flip: 0 });
    // «make it cool»: about a third of the shells get an inner ring of gold glitter that twinkles
    if (Math.random() < 0.35) for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2, sp = base * 0.45;
      sparks.push({ x: r.x, y: r.y, px: r.x, py: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rnd(900, 1300), c: '#f2c14e', kind: 3, w: 0, h: 0, rot: 0, vr: 0, flip: 0 });
    }
  };
  // SMOOTH ON A PHONE (owner 2026-10-30: «it's slow … feels stuck»). Up to ~5,000 sparks are in the air at once, and each
  // used to be its own beginPath + stroke (and a save/rotate/restore per confetti piece) — far more draw calls than a
  // phone can make in 16 ms, so frames dropped, and the old 32 ms cap on a frame's step turned every dropped frame into
  // slow motion. Now: sparks are DRAWN IN BATCHES (one path per colour × width × fade level — a few dozen draw calls a
  // frame, not thousands), finished sparks leave the list, and a frame steps by the time that really passed (≤ 50 ms),
  // so a slow phone skips frames instead of slowing the party down.
  const LEVELS = 3; // fade (alpha) and width steps a spark is drawn at
  const lines = new Map<string, number[]>(); // `${colour}|${level}` → x0,y0,x1,y1, …
  const rects = new Map<string, number[]>(); // `${colour}|${level}` → x,y,w,h, …
  const dots = new Map<number, number[]>();  // level → x,y,r, …
  const push = <K,>(m: Map<K, number[]>, k: K, ...v: number[]) => { const a = m.get(k); if (a) a.push(...v); else m.set(k, v); };
  let t0 = -1, last = 0;
  const frame = (now: number) => {
    if (ended) return;
    if (t0 < 0) { t0 = now; last = now; }
    const t = now - t0, dt = Math.min(50, now - last) / 16.7; last = now;
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    ctx.globalAlpha = 1; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (const r of rockets) {
      if (r.done) continue;
      alive++;
      if (t < r.at) continue;
      if (!r.vy) r.vy = -Math.sqrt(2 * ROCKET_GRAVITY * (r.y - r.ty)) * 1.02;
      r.y += r.vy * dt; r.vy += ROCKET_GRAVITY * dt;
      push(lines, `${r.c}|${LEVELS - 1}`, r.x, r.y - r.vy * 3, r.x, r.y);
      push(dots, LEVELS - 1, r.x, r.y, 2);
      if (r.vy >= -0.4) { r.done = true; explode(r); }
    }
    const drag = Math.pow(0.965, dt);
    let keep = 0;
    for (let i = 0; i < sparks.length; i++) {
      const s = sparks[i];
      s.life += 16.7 * dt; if (s.life > s.max) continue;
      sparks[keep++] = s;
      const k = 1 - s.life / s.max;
      const lv = Math.min(LEVELS - 1, Math.floor(Math.min(1, k * 1.4) * LEVELS));
      s.px = s.x; s.py = s.y; s.vx *= drag; s.vy = s.vy * drag + 0.045 * dt; s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.kind === 2) { push(dots, lv, s.x, s.y, 3 * k + 1); continue; }
      if (s.kind === 3) { if (Math.random() < 0.6) push(rects, `${Math.random() < 0.5 ? s.c : '#fff6d8'}|${lv}`, s.x - 1.2, s.y - 1.2, 2.4, 2.4); continue; }
      if (s.kind === 1) {
        // confetti: it flips (its height breathes with cos) and sways — drawn upright, which reads the same at this size
        s.flip += 0.14 * dt; s.x += Math.sin(s.flip) * 0.35;
        const hh = Math.max(0.8, s.h * Math.abs(Math.cos(s.flip)));
        push(rects, `${s.c}|${lv}`, s.x - s.w / 2, s.y - hh / 2, s.w, hh);
      } else {
        push(lines, `${s.c}|${lv}`, s.px - s.vx * 2, s.py - s.vy * 2, s.x, s.y);
      }
    }
    sparks.length = keep;
    alive += keep;
    const alphaOf = (lv: number) => (lv + 1) / LEVELS;
    for (const [key, a] of lines) {
      const [c, l] = key.split('|'); const lv = Number(l);
      ctx.globalAlpha = alphaOf(lv); ctx.strokeStyle = c; ctx.lineWidth = 0.9 + lv * 0.8;
      ctx.beginPath();
      for (let j = 0; j < a.length; j += 4) { ctx.moveTo(a[j], a[j + 1]); ctx.lineTo(a[j + 2], a[j + 3]); }
      ctx.stroke();
    }
    for (const [key, a] of rects) {
      const [c, l] = key.split('|');
      ctx.globalAlpha = alphaOf(Number(l)); ctx.fillStyle = c;
      ctx.beginPath();
      for (let j = 0; j < a.length; j += 4) ctx.rect(a[j], a[j + 1], a[j + 2], a[j + 3]);
      ctx.fill();
    }
    ctx.fillStyle = '#fff6d8';
    for (const [lv, a] of dots) {
      ctx.globalAlpha = alphaOf(lv);
      ctx.beginPath();
      for (let j = 0; j < a.length; j += 3) { ctx.moveTo(a[j] + a[j + 2], a[j + 1]); ctx.arc(a[j], a[j + 1], a[j + 2], 0, 7); }
      ctx.fill();
    }
    lines.clear(); rects.clear(); dots.clear();
    ctx.globalAlpha = 1;
    if (!alive) { finish(); return; }
    raf(frame);
  };
  raf(frame);
}
