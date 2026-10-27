import { useEffect } from 'react';
import { Platform } from 'react-native';

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

/** Web only: keep the tab icon lit for as long as someone is signed in. */
export function useLitTabIcon(signedIn: boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    applyTabIcon(Array.from(document.querySelectorAll('link[rel="icon"]')), signedIn);
  }, [signedIn]);
}
