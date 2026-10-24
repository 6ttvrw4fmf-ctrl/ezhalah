import { Platform } from 'react-native';

// The «وش نناديك؟» box's motion and the party after «حفظ» — the owner-approved demo
// (mockups/name-box-party.html, 2026-10-23), its CSS ported as-is. Web only: the elements carry
// data-ezh-* attributes (react-native-web `dataSet`) and this one stylesheet animates them; native
// renders the same box without motion. prefers-reduced-motion: no motion, and startNameParty draws nothing.

/** The party lasts 5 s: confetti waves, the light rain from the top and the disco lights all stop at 5 s. */
export const PARTY_MS = 5000;
/** The corner bursts, ms after the start (a centre burst rides on every other one). */
export const PARTY_WAVES_MS = [0, 700, 1400, 2100, 2900, 3700];
/** The home headline listens for this to shine (2 passes) while the party plays. */
export const NAME_PARTY_EVENT = 'ezhalah:name-party';
export const SHINE_MS = 4800;

// canvas-confetti, pinned (browser build + SRI), loaded only when a party starts.
const CONFETTI_SRC = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.js';
const CONFETTI_SRI = 'sha384-/Ko/tqVwPYurnBe+Mj8WWw+39WmyOZn/kU+neqXn4hRxGI575k07mB/hIekAT51+';
const COLORS = ['#2f7247', '#5fae7c', '#d8b14a', '#f2c14e', '#e9739a', '#4f8fe0', '#ffffff'];

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
[data-ezh-disco]{position:fixed;inset:0;pointer-events:none;z-index:2147483000;mix-blend-mode:multiply;opacity:0;transition:opacity .5s;overflow:hidden}
[data-ezh-disco="on"]{opacity:1}
[data-ezh-disco] i{position:absolute;left:0;top:0;width:260px;height:260px;border-radius:50%;filter:blur(40px);opacity:.38}
[data-ezh-disco] i:nth-child(1){background:#f2c14e;animation:ezhD1 2.2s ease-in-out infinite alternate}
[data-ezh-disco] i:nth-child(2){background:#5fae7c;animation:ezhD2 1.8s ease-in-out infinite alternate}
[data-ezh-disco] i:nth-child(3){background:#e9739a;animation:ezhD3 2s ease-in-out infinite alternate}
@keyframes ezhD1{from{transform:translate(-60px,80px)}to{transform:translate(220px,420px)}}
@keyframes ezhD2{from{transform:translate(240px,40px)}to{transform:translate(-40px,520px)}}
@keyframes ezhD3{from{transform:translate(80px,600px)}to{transform:translate(180px,120px)}}
canvas[data-ezh-party]{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483001}
@media (prefers-reduced-motion:reduce){[data-ezh-scrim],[data-ezh-scrim] *,[data-ezh-shine],[data-ezh-disco],[data-ezh-disco] *{animation:none!important;transition:none!important}}
`;

export function ensureNameBoxCss(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || document.getElementById('ezh-name-box-css')) return;
  const el = document.createElement('style');
  el.id = 'ezh-name-box-css';
  el.textContent = CSS;
  document.head.appendChild(el);
}

let confettiLoad: Promise<any> | null = null;
function loadConfetti(): Promise<any> {
  const w = globalThis as any;
  if (w.confetti) return Promise.resolve(w.confetti);
  if (!confettiLoad) {
    confettiLoad = new Promise((resolve) => {
      const el = document.createElement('script');
      el.src = CONFETTI_SRC;
      el.integrity = CONFETTI_SRI;
      el.crossOrigin = 'anonymous';
      el.async = true;
      el.onload = () => resolve(w.confetti ?? null);
      el.onerror = () => { confettiLoad = null; resolve(null); };
      document.head.appendChild(el);
    });
  }
  return confettiLoad;
}

/** The 5-second party after «حفظ». Decoration only: everything is pointer-events:none and removes itself;
 *  a confetti script that fails to load just means no confetti. Reduced motion → nothing at all. */
export function startNameParty(reduced: boolean): void {
  if (reduced || Platform.OS !== 'web' || typeof document === 'undefined') return;
  ensureNameBoxCss();
  try { globalThis.dispatchEvent?.(new Event(NAME_PARTY_EVENT)); } catch { /* not a browser */ }

  const disco = document.createElement('div');
  disco.setAttribute('data-ezh-disco', 'off');
  disco.innerHTML = '<i></i><i></i><i></i>';
  document.body.appendChild(disco);
  requestAnimationFrame(() => disco.setAttribute('data-ezh-disco', 'on'));
  setTimeout(() => { disco.setAttribute('data-ezh-disco', 'off'); setTimeout(() => disco.remove(), 600); }, PARTY_MS);

  const end = Date.now() + PARTY_MS;
  loadConfetti().then((confetti) => {
    if (!confetti) return;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('data-ezh-party', '');
    document.body.appendChild(canvas);
    const c = confetti.create(canvas, { resize: true, useWorker: false });
    PARTY_WAVES_MS.forEach((t, i) => setTimeout(() => {
      c({ particleCount: 70, spread: 70, startVelocity: 52, angle: 60, origin: { x: 0, y: 0.92 }, colors: COLORS, scalar: 1.05 });
      c({ particleCount: 70, spread: 70, startVelocity: 52, angle: 120, origin: { x: 1, y: 0.92 }, colors: COLORS, scalar: 1.05 });
      if (i % 2 === 0) c({ particleCount: 60, spread: 110, startVelocity: 38, origin: { x: 0.5, y: 0.38 }, colors: COLORS, shapes: ['circle', 'square'], scalar: 0.9 });
    }, t));
    const rain = () => {
      c({ particleCount: 3, angle: 270, spread: 40, startVelocity: 12, gravity: 0.7, ticks: 260, origin: { x: Math.random(), y: -0.05 }, colors: COLORS, scalar: 0.9 });
      if (Date.now() < end) requestAnimationFrame(rain);
    };
    rain();
    // The last pieces land a few seconds after the party ends; then the canvas goes.
    setTimeout(() => { try { c.reset(); } catch { /* gone */ } canvas.remove(); }, PARTY_MS + 5000);
  }).catch(() => {});
}
