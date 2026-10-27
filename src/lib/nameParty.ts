import { Platform } from 'react-native';

// The «وش نناديك؟» box's motion and the party after «حفظ» — the owner-approved demo
// (mockups/name-box-party.html, 2026-10-23), its CSS ported as-is. Web only: the elements carry
// data-ezh-* attributes (react-native-web `dataSet`) and this one stylesheet animates them; native
// renders the same box without motion. prefers-reduced-motion: no motion, and startNameParty draws nothing.

/** THE CELEBRATION IS A CONFETTI PARTY (owner 2026-10-27: «change the rain to confetti party … on a laptop full screen,
 *  phone full screen … let it last 4 seconds 5», after the moving preview; it replaces the 2026-10-26 green rain).
 *  CONFETTI_PIECES pieces burst from just under the clouds over BURST_MS, flutter down the WHOLE screen (fixed layer,
 *  every viewport width), and the layer is gone at PARTY_MS. Self-contained CSS/DOM: no external script. */
export const PARTY_MS = 5000;
export const BURST_MS = 2200;
export const CONFETTI_PIECES = 360;
/** Party colours: Ezhalah greens and gold plus pink, blue, violet and white. */
export const CONFETTI_COLORS = ['#2f7247', '#5fae7c', '#d8b14a', '#f2c14e', '#e9739a', '#4f8fe0', '#ffffff', '#a77ee8'];
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
[data-ezh-party]{position:fixed;inset:0;pointer-events:none;z-index:2147483001;overflow:hidden}
[data-ezh-party] i{position:absolute;opacity:0;animation-name:ezhFall;animation-timing-function:cubic-bezier(.25,.4,.55,1);animation-fill-mode:both;will-change:transform}
[data-ezh-party] i b{display:block;width:100%;height:100%;border-radius:inherit;background:inherit;animation:ezhFlip linear infinite}
@keyframes ezhFall{0%{transform:translate(0,0) rotate(0);opacity:0}6%{opacity:1}88%{opacity:1}100%{transform:translate(var(--dx),calc(100vh + 40px)) rotate(var(--rot));opacity:0}}
@keyframes ezhFlip{0%{transform:rotateX(0) rotateY(0)}50%{transform:rotateX(180deg) rotateY(90deg)}100%{transform:rotateX(360deg) rotateY(180deg)}}
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

/** The confetti party after a sign-in / sign-up. Decoration only: pointer-events:none, and the whole layer removes itself
 *  at PARTY_MS. No external script. Reduced motion → nothing at all. */
export function startNameParty(reduced: boolean): void {
  if (reduced || Platform.OS !== 'web' || typeof document === 'undefined') return;
  const now = Date.now();
  if (now - lastParty < PARTY_GAP_MS) return;
  lastParty = now;
  ensureNameBoxCss();
  try { globalThis.dispatchEvent?.(new Event(NAME_PARTY_EVENT)); } catch { /* not a browser */ }

  const layer = document.createElement('div');
  layer.setAttribute('data-ezh-party', '');
  let html = '';
  for (let i = 0; i < CONFETTI_PIECES; i++) {
    const left = (Math.random() * 100).toFixed(2);
    const top = 50 + Math.round(Math.random() * 30);                // just under the clouds
    const delay = Math.round(Math.random() * BURST_MS);
    const dur = 2000 + Math.round(Math.random() * 700);             // delay + dur stays inside PARTY_MS
    const w = 5 + Math.random() * 6;
    const h = Math.random() < 0.35 ? w : w * (1.6 + Math.random());
    const round = Math.random() < 0.25 ? '50%' : '2px';
    const dx = Math.round((Math.random() - 0.5) * 160);
    const rot = Math.round((Math.random() - 0.5) * 1080);
    const flip = 500 + Math.round(Math.random() * 700);
    const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    html += `<i style="left:${left}%;top:${top}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;border-radius:${round};background:${color};animation-delay:${delay}ms;animation-duration:${dur}ms;--dx:${dx}px;--rot:${rot}deg"><b style="animation-duration:${flip}ms"></b></i>`;
  }
  layer.innerHTML = html;
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), PARTY_MS);
}
