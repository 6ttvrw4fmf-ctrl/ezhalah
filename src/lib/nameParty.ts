import { Platform } from 'react-native';

// The «وش نناديك؟» box's motion and the party after «حفظ» — the owner-approved demo
// (mockups/name-box-party.html, 2026-10-23), its CSS ported as-is. Web only: the elements carry
// data-ezh-* attributes (react-native-web `dataSet`) and this one stylesheet animates them; native
// renders the same box without motion. prefers-reduced-motion: no motion, and startNameParty draws nothing.

/** THE CELEBRATION IS GREEN RAIN (owner 2026-10-26: «remove the existing confetti … small green raindrop-like particles
 *  falling from clouds at the top of the screen … subtle, elegant and quick … once it finishes, remove all the particles»).
 *  Drops start over RAIN_MS from the top edge, spread across the whole width; the layer is gone at PARTY_MS. */
export const PARTY_MS = 2600;
export const RAIN_MS = 1400;
export const RAIN_DROPS = 140;
/** Ezhalah's greens only. */
export const RAIN_GREENS = ['#01361c', '#2f7247', '#3f8f5a', '#5fae7c', '#8fd0a4'];
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
[data-ezh-rain]{position:fixed;inset:0;pointer-events:none;z-index:2147483001;overflow:hidden}
[data-ezh-rain] i{position:absolute;top:-20px;width:3px;border-radius:3px;opacity:0;animation-name:ezhDrop;animation-timing-function:cubic-bezier(.45,0,.9,.6);animation-fill-mode:both}
@keyframes ezhDrop{0%{transform:translateY(0);opacity:0}12%{opacity:.85}82%{opacity:.8}100%{transform:translateY(104vh);opacity:0}}
@media (prefers-reduced-motion:reduce){[data-ezh-scrim],[data-ezh-scrim] *,[data-ezh-shine]{animation:none!important;transition:none!important}[data-ezh-rain]{display:none}}
`;

export function ensureNameBoxCss(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || document.getElementById('ezh-name-box-css')) return;
  const el = document.createElement('style');
  el.id = 'ezh-name-box-css';
  el.textContent = CSS;
  document.head.appendChild(el);
}

let lastParty = -Infinity;

/** The green rain after a sign-in / sign-up. Decoration only: pointer-events:none, and the whole layer removes itself at
 *  PARTY_MS. No external script. Reduced motion → nothing at all. */
export function startNameParty(reduced: boolean): void {
  if (reduced || Platform.OS !== 'web' || typeof document === 'undefined') return;
  const now = Date.now();
  if (now - lastParty < PARTY_GAP_MS) return;
  lastParty = now;
  ensureNameBoxCss();
  try { globalThis.dispatchEvent?.(new Event(NAME_PARTY_EVENT)); } catch { /* not a browser */ }

  const layer = document.createElement('div');
  layer.setAttribute('data-ezh-rain', '');
  let html = '';
  for (let i = 0; i < RAIN_DROPS; i++) {
    const left = (Math.random() * 100).toFixed(2);
    const delay = Math.round(Math.random() * RAIN_MS * 0.8);
    const dur = 700 + Math.round(Math.random() * 400);           // delay + dur stays inside PARTY_MS
    const len = 9 + Math.round(Math.random() * 9);
    const color = RAIN_GREENS[i % RAIN_GREENS.length];
    html += `<i style="left:${left}%;height:${len}px;background:${color};animation-delay:${delay}ms;animation-duration:${dur}ms"></i>`;
  }
  layer.innerHTML = html;
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), PARTY_MS);
}
