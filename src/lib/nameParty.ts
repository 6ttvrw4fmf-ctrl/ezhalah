import { Platform } from 'react-native';

// The «وش نناديك؟» box's motion and the party after «حفظ» — the owner-approved demo
// (mockups/name-box-party.html, 2026-10-23), its CSS ported as-is. Web only: the elements carry
// data-ezh-* attributes (react-native-web `dataSet`) and this one stylesheet animates them; native
// renders the same box without motion. prefers-reduced-motion: no motion, and startNameParty draws nothing.

/** THE CELEBRATION IS A PARTY (owner 2026-11-04, from the moving preview: «i dont like the fire works i want party» → picked
 *  «4 · all together» and «yeah i love it put it live»; it replaces the 2026-10-28 fireworks). Three things at once, one
 *  canvas: PARTY POPPERS blast confetti and curly ribbons up from both bottom corners (two volleys), BALLOONS float up
 *  and each pops into confetti, and CONFETTI RAINS from the top. The headline listens: at the FIRST pop (the poppers, at
 *  once) it shows «نورت {name} 🥳…» (PARTY_FIRST_POP_EVENT) and when the last piece is gone it changes to the fact
 *  (PARTY_END_EVENT). One fixed full-screen canvas, removed at the end and in any case by PARTY_MS. Self-contained: no
 *  external script. Preview: claude.ai/artifact/8LXg8zQi5PRkwPAV9hHTFQ. */
/** Ezhalah green and gold first, then party colours. */
export const PARTY_COLORS = ['#2f7247', '#5fae7c', '#d8b14a', '#f2c14e', '#e9739a', '#4f8fe0', '#a77ee8', '#ff8a3d'];
/** confetti pieces each corner throws per volley; every RIBBON_EVERY-th piece is a curly ribbon */
export const POPPER_PIECES = 110;
export const POPPER_VOLLEYS_MS = [0, 450];
export const RIBBON_EVERY = 9;
/** balloons (on a phone): one leaves every BALLOON_EVERY_MS; each pops into BALLOON_BURST pieces */
export const BALLOONS = 14;
export const BALLOON_EVERY_MS = 90;
export const BALLOON_BURST = 26;
/** a balloon's climb, in 60 fps frames — fixed per balloon so it takes the same real time on a slow phone */
export const balloonFlightFrames = (i: number): number => 120 + ((i * 37) % 50);
/** confetti falling from the top (on a phone), spread over RAIN_FOR_MS */
export const RAIN_PIECES = 120;
export const RAIN_FOR_MS = 1600;
/** Wider screens get proportionally more balloons and rain so a laptop is as full as a phone (at most 1.7×). */
export const partyScale = (width: number): number => Math.min(1.7, Math.max(1, (width || 500) / 500));
/** The layer is always gone by then (last balloon ~1.2 s + climb ≤ ~2.8 s + its confetti ≤ 3 s). */
export const PARTY_MS = 7500;
export const PARTY_FIRST_POP_EVENT = 'ezhalah:party-first-pop';
export const PARTY_END_EVENT = 'ezhalah:party-end';
/** the first balloon popping — its climb runs on real time, so a slow phone must not delay it */
export const PARTY_BALLOON_POP_EVENT = 'ezhalah:party-balloon-pop';
export type PartyCue = { at: number; kind: 'popper' | 'balloon' | 'rain'; x: number; i: number };
/** The plan: when each popper fires (x = corner 0 | 1), each balloon leaves and each raindrop of confetti starts
 *  (x = fraction of the width), sorted by time. */
export function partyPlan(width: number, rand: () => number = Math.random): PartyCue[] {
  const out: PartyCue[] = [];
  const k = partyScale(width);
  for (const at of POPPER_VOLLEYS_MS) { out.push({ at, kind: 'popper', x: 0, i: 0 }, { at, kind: 'popper', x: 1, i: 0 }); }
  const nb = Math.round(BALLOONS * k);
  for (let i = 0; i < nb; i++) out.push({ at: i * BALLOON_EVERY_MS, kind: 'balloon', x: 0.06 + 0.88 * rand(), i });
  const nr = Math.round(RAIN_PIECES * k);
  for (let i = 0; i < nr; i++) out.push({ at: Math.round(rand() * RAIN_FOR_MS), kind: 'rain', x: rand(), i });
  return out.sort((a, b) => a.at - b.at);
}
/** How many confetti pieces and ribbons the whole show throws on a screen this wide. */
export const partyPieces = (width: number): number =>
  POPPER_VOLLEYS_MS.length * 2 * POPPER_PIECES + Math.round(BALLOONS * partyScale(width)) * BALLOON_BURST + Math.round(RAIN_PIECES * partyScale(width));
/** A second celebration this soon after one is skipped: the sign-up box and the sign-in welcome never stack. */
export const PARTY_GAP_MS = 6000;
/** The home headline listens for this to shine (2 passes) while the party plays. */
export const NAME_PARTY_EVENT = 'ezhalah:name-party';
export const SHINE_MS = 4800;
// THE SHINE NEVER HIDES THE WORDS (owner 2026-11-01: the headline was blank on iPhone after sign-in, «I don't get the fact»).
// It used to paint a dark-green gradient THROUGH see-through letters (background-clip:text + transparent text): on the dark
// theme that read as nothing, and iPhone Safari can leave such text unpainted altogether. It is now a gold glow ON the
// letters (color + text-shadow), which every browser paints. Guard: scripts/verify-headline-shine-never-hides-text.ts.


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
[data-ezh-shine="on"]{animation:ezhShine 2.4s ease-in-out 2}
@keyframes ezhShine{0%,100%{text-shadow:0 0 0 rgba(216,177,74,0)}50%{color:#d8b14a;text-shadow:0 0 14px rgba(216,177,74,.6)}}
[data-ezh-shine="on"] [data-ezh-emoji]{-webkit-text-fill-color:initial!important;color:initial!important}
[data-ezh-emoji="party"]{display:inline-block;transform-origin:50% 70%;animation:ezhParty .5s ease-in-out infinite}
@keyframes ezhParty{0%,100%{transform:rotate(-14deg) scale(1)}25%{transform:rotate(16deg) scale(1.18)}50%{transform:rotate(-10deg) scale(1.05)}75%{transform:rotate(12deg) scale(1.2)}}
[data-ezh-party]{position:fixed;inset:0;pointer-events:none;z-index:2147483001;overflow:hidden}
[data-ezh-party] canvas{position:absolute;inset:0;width:100%;height:100%}
@media (prefers-reduced-motion:reduce){[data-ezh-scrim],[data-ezh-scrim] *,[data-ezh-shine],[data-ezh-emoji]{animation:none!important;transition:none!important}[data-ezh-party]{display:none}}
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

/** The party after a sign-in / sign-up. Decoration only: pointer-events:none, one canvas, and the whole layer removes
 *  itself when the last piece is gone (and at PARTY_MS at the latest). No external script. Reduced motion → nothing. */
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
  let popped = false, balloonPopped = false;
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
  const color = () => PARTY_COLORS[(Math.random() * PARTY_COLORS.length) | 0];
  const plan = partyPlan(W);
  let next = 0;
  type Piece = { x: number; y: number; vx: number; vy: number; c: string; w: number; h: number; flip: number; life: number; max: number; ribbon: boolean; trail: number[] };
  type Balloon = { x: number; y: number; r: number; c: string; vy: number; sw: number; pop: number };
  const pieces: Piece[] = [];
  let balloons: Balloon[] = [];
  const piece = (x: number, y: number, vx: number, vy: number, ribbon: boolean) =>
    pieces.push({ x, y, vx, vy, c: color(), w: rnd(5, 9), h: rnd(9, 14), flip: rnd(0, 6), life: 0, max: rnd(2200, 3000), ribbon, trail: [] });
  const cue = (q: PartyCue) => {
    if (q.kind === 'popper') {
      firstPop();
      const left = q.x === 0;
      for (let i = 0; i < POPPER_PIECES; i++) {
        const a = -Math.PI / 2 + (left ? 1 : -1) * rnd(0.15, 0.75), sp = rnd(9, 17) * Math.min(1.25, Math.max(0.8, H / 800));
        piece(left ? 0 : W, H, Math.cos(a) * sp, Math.sin(a) * sp, i % RIBBON_EVERY === 0);
      }
    } else if (q.kind === 'rain') {
      piece(q.x * W, -20, rnd(-1, 1), rnd(1, 3), Math.random() < 0.12);
    } else {
      const pop = rnd(0.1, 0.45) * H;
      balloons.push({ x: q.x * W, y: H + 60, r: rnd(22, 32), c: color(), vy: (H + 60 - pop) / balloonFlightFrames(q.i), sw: rnd(0, 6), pop });
    }
  };
  // SMOOTH ON A PHONE (owner 2026-10-30: «it's slow … feels stuck»): pieces are DRAWN IN BATCHES — one path per colour ×
  // fade level for confetti, for ribbons, and for balloons — so a frame costs a few dozen draw calls, not one per piece;
  // finished pieces leave the list; and a frame steps by the time that really passed (≤ 50 ms), so a slow phone skips
  // frames instead of slowing the party down.
  const LEVELS = 3;
  const rects = new Map<string, number[]>();   // `${colour}|${level}` → x,y,w,h, …
  const ribbons = new Map<string, number[][]>(); // `${colour}|${level}` → [x0,y0,x1,y1,…] per ribbon
  const bodies = new Map<string, number[]>();  // colour → x,y,r, …
  const strings: number[] = [], shines: number[] = [];
  const push = <K,>(m: Map<K, number[]>, k: K, ...v: number[]) => { const a = m.get(k); if (a) a.push(...v); else m.set(k, v); };
  let t0 = -1, last = 0;
  const frame = (now: number) => {
    if (ended) return;
    if (t0 < 0) { t0 = now; last = now; }
    const t = now - t0, dt = Math.min(50, now - last) / 16.7; last = now;
    while (next < plan.length && plan[next].at <= t) cue(plan[next++]);
    ctx.clearRect(0, 0, W, H);
    let keepB = 0;
    for (let i = 0; i < balloons.length; i++) {
      const b = balloons[i];
      b.y -= b.vy * dt; b.sw += 0.04 * dt;
      const bx = b.x + Math.sin(b.sw) * 10;
      if (b.y <= b.pop) {
        if (!balloonPopped) { balloonPopped = true; say(PARTY_BALLOON_POP_EVENT); }
        for (let j = 0; j < BALLOON_BURST; j++) { const a = rnd(0, Math.PI * 2), sp = rnd(2, 6); piece(bx, b.y, Math.cos(a) * sp, Math.sin(a) * sp, false); }
        continue;
      }
      balloons[keepB++] = b;
      strings.push(bx, b.y + b.r * 1.2, bx + 8, b.y + b.r * 2, bx, b.y + b.r * 3);
      push(bodies, b.c, bx, b.y, b.r);
      shines.push(bx - b.r * 0.3, b.y - b.r * 0.35, b.r);
    }
    balloons.length = keepB;
    const drag = Math.pow(0.97, dt);
    let keep = 0;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      p.life += 16.7 * dt; if (p.life > p.max || p.y > H + 40) continue;
      pieces[keep++] = p;
      p.vx *= drag; p.vy = Math.min(2.6, p.vy * drag + 0.12 * dt);
      p.flip += 0.12 * dt; p.x += (p.vx + Math.sin(p.flip) * 0.6) * dt; p.y += p.vy * dt;
      const lv = Math.min(LEVELS - 1, Math.floor(Math.min(1, (p.max - p.life) / 500) * LEVELS));
      if (p.ribbon) {
        p.trail.push(p.x, p.y); if (p.trail.length > 40) p.trail.splice(0, 2);
        const line: number[] = [];
        for (let j = 0; j < p.trail.length; j += 2) line.push(p.trail[j] + Math.sin(j * 0.4 + p.flip) * 5, p.trail[j + 1]);
        const key = `${p.c}|${lv}`, a = ribbons.get(key); if (a) a.push(line); else ribbons.set(key, [line]);
      } else {
        // confetti flips (its height breathes with cos) and sways — drawn upright, which reads the same at this size
        const hh = Math.max(1, p.h * Math.abs(Math.cos(p.flip)));
        push(rects, `${p.c}|${lv}`, p.x - p.w / 2, p.y - hh / 2, p.w, hh);
      }
    }
    pieces.length = keep;
    const alphaOf = (lv: number) => (lv + 1) / LEVELS;
    if (strings.length) {
      ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let j = 0; j < strings.length; j += 6) { ctx.moveTo(strings[j], strings[j + 1]); ctx.quadraticCurveTo(strings[j + 2], strings[j + 3], strings[j + 4], strings[j + 5]); }
      ctx.stroke();
    }
    for (const [c, a] of bodies) {
      ctx.globalAlpha = 1; ctx.fillStyle = c;
      ctx.beginPath();
      for (let j = 0; j < a.length; j += 3) {
        const x = a[j], y = a[j + 1], r = a[j + 2];
        ctx.moveTo(x + r * 0.85, y); ctx.ellipse(x, y, r * 0.85, r, 0, 0, Math.PI * 2);
        ctx.moveTo(x - 4, y + r + 5); ctx.lineTo(x + 4, y + r + 5); ctx.lineTo(x, y + r - 1); ctx.closePath();
      }
      ctx.fill();
    }
    if (shines.length) {
      ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.beginPath();
      for (let j = 0; j < shines.length; j += 3) { const r = shines[j + 2]; ctx.moveTo(shines[j] + r * 0.18, shines[j + 1]); ctx.ellipse(shines[j], shines[j + 1], r * 0.18, r * 0.3, -0.5, 0, Math.PI * 2); }
      ctx.fill();
    }
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const [key, lines] of ribbons) {
      const [c, l] = key.split('|');
      ctx.globalAlpha = alphaOf(Number(l)); ctx.strokeStyle = c;
      ctx.beginPath();
      for (const a of lines) { ctx.moveTo(a[0], a[1]); for (let j = 2; j < a.length; j += 2) ctx.lineTo(a[j], a[j + 1]); }
      ctx.stroke();
    }
    for (const [key, a] of rects) {
      const [c, l] = key.split('|');
      ctx.globalAlpha = alphaOf(Number(l)); ctx.fillStyle = c;
      ctx.beginPath();
      for (let j = 0; j < a.length; j += 4) ctx.rect(a[j], a[j + 1], a[j + 2], a[j + 3]);
      ctx.fill();
    }
    rects.clear(); ribbons.clear(); bodies.clear(); strings.length = 0; shines.length = 0;
    ctx.globalAlpha = 1;
    if (next >= plan.length && !pieces.length && !balloons.length) { finish(); return; }
    raf(frame);
  };
  raf(frame);
}
