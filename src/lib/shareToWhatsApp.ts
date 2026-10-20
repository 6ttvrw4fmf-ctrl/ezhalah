// A chat link shared through the phone's share menu reaches WhatsApp as a bare link — no card
// (owner, 2026-10-20: «the share button shows a normal link»). The card page itself answers correctly
// (/s/<code> → api/share-card.ts, verified against production with WhatsApp's user agent), so the
// missing card is made on the phone, not by us: WhatsApp builds a link preview in ITS OWN composer,
// and a link handed over by the share extension is sent without one. So on a phone the Share button
// opens WhatsApp's composer directly (the wa.me link) with the chat link pre-filled — the person picks
// the chat, sees the card, and sends. A desktop keeps the copy-link path (no WhatsApp app to open).
//
// Import-light on purpose (no react-native): scripts/verify-chat-share-opens-whatsapp-composer.ts
// imports and EXECUTES it.
export const WHATSAPP_COMPOSE_URL = 'https://wa.me/';

/** WhatsApp's composer with the link pre-filled (encoded once, nothing else in the message). */
export function whatsAppComposeUrl(link: string): string {
  return `${WHATSAPP_COMPOSE_URL}?text=${encodeURIComponent(link)}`;
}

type NavLike = { maxTouchPoints?: unknown } | null | undefined;
type WinLike = { matchMedia?: (q: string) => { matches: boolean }; location?: { assign: (u: string) => void } } | null | undefined;

/** A touch device (phone/tablet) — the same test src/lib/share.ts uses; a Mac reports 0 touch points. */
export function isTouchDevice(nav: NavLike, win: WinLike): boolean {
  if (nav && typeof nav.maxTouchPoints === 'number') return nav.maxTouchPoints > 0;
  if (win && typeof win.matchMedia === 'function') return win.matchMedia('(pointer: coarse)').matches;
  return false;
}

/**
 * On a touch device, navigates to WhatsApp's composer with the link and returns true; on a desktop
 * does nothing and returns false so the caller copies the link instead. Same-tab navigation on
 * purpose: wa.me is WhatsApp's universal link, so the app opens and the chat page stays behind it.
 */
export function openWhatsAppCompose(
  link: string,
  nav: NavLike = typeof navigator !== 'undefined' ? navigator : null,
  win: WinLike = typeof window !== 'undefined' ? (window as unknown as WinLike) : null,
): boolean {
  if (!isTouchDevice(nav, win)) return false;
  if (!win?.location?.assign) return false;
  win.location.assign(whatsAppComposeUrl(link));
  return true;
}
