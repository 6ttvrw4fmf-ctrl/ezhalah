import { Platform, Share } from 'react-native';
import { getLocale } from '@/i18n';

// The real, resolvable share target (the deployed app).
export const SHARE_LINK = 'https://ezhalah-app.vercel.app';
// Note #3 — share content must follow the current UI language. Title is bilingual-safe ("Ezhalah" is
// the brand verbatim, written إزهله in Arabic). Blurb and message are picked at call time from the
// current locale. (user request: "Never mix Arabic and English in the shared content.")
const SHARE = {
  en: {
    title: 'Ezhalah',
    blurb: 'One place to explore all listings and more in seconds. Try now.',
    message: `Ezhalah — one place to explore all property listings in seconds. Try it now: ${SHARE_LINK}`,
  },
  ar: {
    title: 'إزهله',
    blurb: 'مكان واحد لاستكشاف كل إعلانات العقارات في ثواني. جرّبها الآن.',
    message: `إزهله — مكان واحد تستكشف فيه كل إعلانات العقارات في ثواني. جرّبها الآن: ${SHARE_LINK}`,
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
