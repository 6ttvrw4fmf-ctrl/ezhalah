import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useReducedMotion } from '@/lib/useReducedMotion';

// THE LIT TAB ICON (owner 2026-10-27: «can we make it light up … like the one we have … can u do that swap»).
// A browser shows a still picture in the tab, so «lighting up» is a swap: while someone is signed in, every
// <link rel="icon"> points at the owner's own lit logo WITH ITS CLOUDS (assets/images/logo-cloud-lit-sky.svg, the
// sidebar's lit eagle, rendered square by a browser — owner: «use the one we have with clouds»); signing out puts the
// regular icon back. Only the open tab changes — history,
// suggestions and the home-screen icon (apple-touch-icon) keep the regular one, which is what they store.
//
// The lit files carry their own ?v= token: a browser's icon store is keyed by URL (see +html.tsx).
export const LIT_ICON_32 = '/icon-32-lit.png?v=1';
export const LIT_ICON_192 = '/icon-192-lit.png?v=1';
const ORIGINAL = 'data-ezh-href';

type IconLink = { getAttribute(n: string): string | null; setAttribute(n: string, v: string): void; removeAttribute?(n: string): void };

/** The lit icon for one declared icon link: the 192 link gets the 192 picture, every other one the 32. */
export function litHrefFor(sizes: string | null): string {
  return sizes === '192x192' ? LIT_ICON_192 : LIT_ICON_32;
}

/** Point every icon link at the lit eagle (signed in) or back at what the page declared (signed out).
 *  The declared href is remembered on the element, so signing out restores it exactly. */
export function applyTabIcon(links: IconLink[], signedIn: boolean): void {
  for (const el of links) {
    const declared = el.getAttribute(ORIGINAL) ?? el.getAttribute('href');
    if (declared == null) continue;
    if (el.getAttribute(ORIGINAL) == null) el.setAttribute(ORIGINAL, declared);
    el.setAttribute('href', signedIn ? litHrefFor(el.getAttribute('sizes')) : declared);
  }
}

// THE FADE (owner 2026-10-27: «let it feel smooth»). A browser cannot fade a tab icon by itself, so the change is
// drawn: FADE_FRAMES in-between pictures (the regular eagle dissolving into the lit one, eased) are painted on a
// 32 px canvas and handed to the icon links one after another over FADE_MS, then the real lit file takes over.
// Only a REAL sign-in / sign-out fades: the session restore on a refresh is applied at once (no fade on every
// load), and so is everything under reduced motion. If anything fails to load, the plain swap still happens.
export const FADE_MS = 560;
export const FADE_FRAMES = 12;

/** The blend amount for each in-between frame: eased in and out, strictly between 0 and 1. */
export function fadeAlphas(frames: number = FADE_FRAMES): number[] {
  return Array.from({ length: frames }, (_, i) => { const t = (i + 1) / (frames + 1); return t * t * (3 - 2 * t); });
}

/** Should this change fade? Only after the session is known (not the restore on a refresh) and with motion allowed. */
export function shouldFade(settledBefore: boolean, reduced: boolean): boolean {
  return settledBefore && !reduced;
}

/** Web only: keep the tab icon lit for as long as someone is signed in, fading on a real sign-in or sign-out. */
export function useLitTabIcon(signedIn: boolean, authChecked: boolean): void {
  const reduced = useReducedMotion();
  const settled = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !authChecked) return;
    const links = Array.from(document.querySelectorAll('link[rel="icon"]'));
    const fade = shouldFade(settled.current, reduced);
    settled.current = true;
    if (!fade) { applyTabIcon(links, signedIn); return; }
    const small = links.find((l) => l.getAttribute('sizes') === '32x32');
    const regular = small?.getAttribute(ORIGINAL) ?? small?.getAttribute('href');
    if (!regular) { applyTabIcon(links, signedIn); return; }
    const [fromSrc, toSrc] = signedIn ? [regular, LIT_ICON_32] : [LIT_ICON_32, regular];
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
    Promise.all([load(fromSrc), load(toSrc)]).then(([from, to]) => {
      if (cancelled) return;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const ctx = canvas.getContext('2d');
      if (!ctx) { applyTabIcon(links, signedIn); return; }
      // remember the declared hrefs before the frames overwrite them, so the final swap restores exactly
      applyTabIcon(links, !signedIn);
      fadeAlphas().forEach((a, i, all) => timers.push(setTimeout(() => {
        ctx.globalAlpha = 1; ctx.drawImage(from, 0, 0, 32, 32);
        ctx.globalAlpha = a; ctx.drawImage(to, 0, 0, 32, 32);
        const frame = canvas.toDataURL('image/png');
        for (const el of links) el.setAttribute('href', frame);
      }, Math.round((FADE_MS * i) / all.length))));
      timers.push(setTimeout(() => applyTabIcon(links, signedIn), FADE_MS));
    }).catch(() => { if (!cancelled) applyTabIcon(links, signedIn); });
    return () => { cancelled = true; timers.forEach(clearTimeout); applyTabIcon(links, signedIn); };
  }, [signedIn, authChecked, reduced]);
}
