import { Platform, Share } from 'react-native';
import { getLocale } from '@/i18n';

// The real, resolvable share target (the deployed app).
export const SHARE_LINK = 'https://ezhalah-app.vercel.app';
// The picture people actually SEE in WhatsApp / iMessage / X / Telegram / LinkedIn. It must be an
// ABSOLUTE url — a crawler fetching the page has no origin to resolve "/og-image.jpg" against — and
// it is a crop of assets/images/eagle-night.jpg, the same artwork «من نحن» leads with. No new logo
// was drawn for it: the brand image already existed, it had simply never been offered to a crawler.
// THE FILENAME CARRIES A VERSION, AND THAT IS LOAD-BEARING. WhatsApp, Facebook and LinkedIn cache a
// link's preview card KEYED BY URL and re-fetch it on their own schedule — the same trap Chrome's
// favicon store sprang on 2026-09-05, where correct new bytes at an unchanged path stayed invisible
// for months. Replacing the bytes of og-image.jpg would leave everyone who has ever shared the link
// on the old picture. RENAME THE FILE when the artwork changes; never overwrite it in place.
export const OG_IMAGE = `${SHARE_LINK}/og-image-v2.jpg`;
// ONE sentence, used in three places that used to drift apart: the OS share text, the in-app sheet's
// preview, and og:description. Owner wording, 2026-09-05 — «في المملكة» is load-bearing, it says
// WHERE, and the line read as a generic slogan without it.
export const SHARE_BLURB_AR = 'مكان واحد لاستكشاف كل إعلانات العقارات في المملكة في ثواني. جرّبها الآن.';
export const SHARE_BLURB_EN = 'One place to explore every property listing in Saudi Arabia in seconds. Try it now.';
export const SHARE_TITLE_AR = 'إزهله';
// Note #3 — share content must follow the current UI language. Title is bilingual-safe ("Ezhalah" is
// the brand verbatim, written إزهله in Arabic). Blurb and message are picked at call time from the
// current locale. (user request: "Never mix Arabic and English in the shared content.")
const SHARE = {
  en: {
    title: 'Ezhalah',
    blurb: SHARE_BLURB_EN,
    message: `Ezhalah — one place to explore every property listing in Saudi Arabia in seconds. Try it now: ${SHARE_LINK}`,
  },
  ar: {
    title: SHARE_TITLE_AR,
    blurb: SHARE_BLURB_AR,
    message: `إزهله — مكان واحد تستكشف فيه كل إعلانات العقارات في المملكة في ثواني. جرّبها الآن: ${SHARE_LINK}`,
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
