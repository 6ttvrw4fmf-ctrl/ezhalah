import { Platform, Share } from 'react-native';
import { getLocale } from '@/i18n';

// The real, resolvable share target (the deployed app).
export const SHARE_LINK = 'https://ezhalah-app.vercel.app';
// The picture people actually SEE in WhatsApp / iMessage / X / Telegram / LinkedIn. It must be an
// ABSOLUTE url — a crawler fetching the page has no origin to resolve "/og-image.jpg" against — and
// it is a composed card: the existing eagle mark from assets/images/ezhalah-logo.png, knocked out
// white on the brand green, over the name and the one-line promise. No new logo was drawn — the mark
// is the project's own file. It replaced a crop of the eagle-night artwork (owner, 2026-09-05: "just
// include the logo, let it look professional") because a photographic crop reads as a stock image at
// thumbnail size, while a logo card reads as a brand.
// THE FILENAME CARRIES A VERSION, AND THAT IS LOAD-BEARING. WhatsApp, Facebook and LinkedIn cache a
// link's preview card KEYED BY URL and re-fetch it on their own schedule — the same trap Chrome's
// favicon store sprang on 2026-09-05, where correct new bytes at an unchanged path stayed invisible
// for months. Replacing the bytes of og-image.jpg would leave everyone who has ever shared the link
// on the old picture. RENAME THE FILE when the artwork changes; never overwrite it in place.
export const OG_IMAGE = `${SHARE_LINK}/og-image-v3.jpg`;
// ONE message, owner-authored 2026-09-05, used everywhere that used to keep its own copy and drift:
// the OS share text, the in-app sheet, X/Telegram/WhatsApp/Mail, and the og: card. The LEAD is the
// sentence alone — targets that take the link in their own `url=` parameter must not be handed it
// twice — and MESSAGE is that lead plus the link, for targets that carry everything in one string.
export const SHARE_LEAD_AR = 'إزهله. موقع واحد. كل إعلانات العقار في السعودية، بثوانٍ.\nجرّبه الآن 👇';
export const SHARE_LEAD_EN = 'Ezhalah. One site. Every property listing in Saudi Arabia, in seconds.\nTry it now 👇';
export const SHARE_MESSAGE_AR = `${SHARE_LEAD_AR}\n${SHARE_LINK}`;
export const SHARE_MESSAGE_EN = `${SHARE_LEAD_EN}\n${SHARE_LINK}`;
// og:description and the in-app preview get the sentence WITHOUT the emoji or the link: a preview
// card already shows the domain under it, and repeating the url inside the description is the mark
// of a page that was never actually looked at in a chat window.
export const SHARE_BLURB_AR = 'موقع واحد. كل إعلانات العقار في السعودية، بثوانٍ. جرّبه الآن.';
export const SHARE_BLURB_EN = 'One site. Every property listing in Saudi Arabia, in seconds. Try it now.';
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
