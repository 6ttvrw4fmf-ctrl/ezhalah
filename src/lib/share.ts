import { Platform, Share } from 'react-native';
import { getLocale } from '@/i18n';

// The real, resolvable share target (the deployed app).
export const SHARE_LINK = 'https://ezhalah-app.vercel.app';
// Owner-approved share artwork (2026-10-11): the existing green eagle on white,
// identical to the app icon. The in-app preview uses the same image as external cards.
// THE FILENAME CARRIES A VERSION, AND THAT IS LOAD-BEARING. WhatsApp, Facebook and LinkedIn cache a
// link's preview card KEYED BY URL and re-fetch it on their own schedule — the same trap Chrome's
// favicon store sprang on 2026-09-05, where correct new bytes at an unchanged path stayed invisible
// for months. Replacing the bytes of og-image.jpg would leave everyone who has ever shared the link
// on the old picture. RENAME THE FILE when the artwork changes; never overwrite it in place.
// v6 = 192×192 (owner 2026-10-18: «look how big … keep it small»). WhatsApp draws a BIG banner for an
// og:image ≥ ~300px wide and a small side thumbnail below that — the same 192px card the search-share
// links (/s/…) already get. Keep it under 300px.
export const OG_IMAGE = `${SHARE_LINK}/og-image-v6.png`;
// Owner-approved original wording, without the AI sentence or dashes (2026-10-11), shared by metadata and every share target.
// No emoji (owner 2026-10-18: «remove the emoji … make it professional»).
export const SHARE_BLURB_AR = 'تدور على عقار وتبي تشوف المعروض من مختلف المواقع بمكان واحد؟ إزهله، الطريقة الأذكى للبحث على العقار في المملكة.';
export const SHARE_BLURB_EN = 'Looking for a property and want to see everything on offer in one place? Ezhalah, the smarter way to find properties in the Kingdom.';
export const SHARE_LEAD_AR = SHARE_BLURB_AR;
export const SHARE_LEAD_EN = SHARE_BLURB_EN;
export const SHARE_MESSAGE_AR = `${SHARE_LEAD_AR}\n${SHARE_LINK}`;
export const SHARE_MESSAGE_EN = `${SHARE_LEAD_EN}\n${SHARE_LINK}`;
export const SHARE_TITLE_AR = 'إزهله';
const SHARE = {
  en: {
    title: 'Ezhalah',
    blurb: SHARE_BLURB_EN,
    message: SHARE_MESSAGE_EN,
  },
  ar: {
    title: SHARE_TITLE_AR,
    blurb: SHARE_BLURB_AR,
    message: SHARE_MESSAGE_AR,
  },
};

// Invoke the device's REAL share sheet so the user can actually send the link to any app or
// contact (AirDrop, WhatsApp, Messages, Mail, etc.):
//   • web   → the Web Share API (navigator.share) — present on iOS/Android browsers and macOS
//             Safari. MUST be called inside a user gesture (a tap handler), which it is.
//   • native → React Native's Share.share(), which raises the iOS/Android system sheet.
// Returns true when the OS sheet was shown (or the user dismissed it) so callers can SKIP the
// in-app fallback; returns false only when no native sharing exists (e.g. desktop Chrome), so the
// caller can open the custom ShareSheet instead.
export async function shareNative(): Promise<boolean> {
  const L = SHARE[getLocale() === 'ar' ? 'ar' : 'en'];
  if (Platform.OS === 'web') {
    const nav: any = typeof navigator !== 'undefined' ? navigator : undefined;
    // TOUCH DEVICES ONLY (owner report, 2026-09-05: "on macbook just the link pops up, but on my
    // phone the sentence shows"). navigator.share EXISTS in desktop Chrome, so the old code handed
    // off to the macOS sheet — and macOS passes the URL to most targets while silently dropping
    // `text`, so the written sentence evaporated and the recipient got a naked link. A phone's sheet
    // carries the whole thing and is genuinely better than anything we can draw; a desktop's is
    // worse. So: hand off on touch, and on a desktop fall through to our own sheet, which always
    // sends the full message. maxTouchPoints is 0 on a Mac and 5 on an iPad, and the coarse-pointer
    // query is the fallback for browsers that do not report it.
    const coarse = typeof nav?.maxTouchPoints === 'number'
      ? nav.maxTouchPoints > 0
      : (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia('(pointer: coarse)').matches
          : false);
    if (!coarse) return false;
    if (typeof nav?.share === 'function') {
      try {
        await nav.share({ title: L.title, text: L.blurb, url: SHARE_LINK });
        return true;
      } catch (e: any) {
        // Only a deliberate user dismiss (AbortError) counts as "handled" — don't pop the fallback
        // on top of it. ANY other failure (NotAllowedError on desktop, permission policy, etc.) means
        // the native sheet never showed, so fall through to the in-app ShareSheet instead of doing
        // nothing. (Bug fix: desktop NotAllowedError used to be swallowed → button appeared dead.)
        if (e && e.name === 'AbortError') return true;
        return false;
      }
    }
    return false;
  }

  try {
    await Share.share({ message: L.message, url: SHARE_LINK, title: L.title });
    return true;
  } catch {
    return false;
  }
}
