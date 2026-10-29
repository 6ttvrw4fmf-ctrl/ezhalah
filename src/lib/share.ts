import { Platform, Share } from 'react-native';
import { getLocale } from '@/i18n';
import { loadSiteCount, siteCountNow } from '@/data/siteCount';

// The real, resolvable share target. ezhalah.com is the final address (owner 2026-10-26); the old
// ezhalah-app.vercel.app still serves the same deployment, so links shared before today keep working.
export const SHARE_LINK = 'https://ezhalah.com';
// The hosts that ARE the live site. A share made on any of them says ezhalah.com; a preview or local build
// keeps its own address so a test share opens the build that made it.
export const LIVE_SITE_HOSTS = ['ezhalah.com', 'www.ezhalah.com', 'ezhalah-app.vercel.app'];
/** The address a share link starts with: ezhalah.com on the live site and in the native app, else this page's own. */
export function shareOrigin(): string {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return SHARE_LINK;
  const host = window.location?.hostname ?? '';
  return LIVE_SITE_HOSTS.includes(host) ? SHARE_LINK : window.location.origin;
}
// Owner-approved share artwork (2026-10-11): the existing green eagle on white,
// identical to the app icon. The in-app preview uses the same image as external cards.
// THE FILENAME CARRIES A VERSION, AND THAT IS LOAD-BEARING. WhatsApp, Facebook and LinkedIn cache a
// link's preview card KEYED BY URL and re-fetch it on their own schedule — the same trap Chrome's
// favicon store sprang on 2026-09-05, where correct new bytes at an unchanged path stayed invisible
// for months. Replacing the bytes of og-image.jpg would leave everyone who has ever shared the link
// on the old picture. RENAME THE FILE when the artwork changes; never overwrite it in place.
// v7 = the cloud-eagle logo, 192×192 (owner 2026-10-24: «this is the final logo … replace it everywhere»). v6 = 192×192 (owner 2026-10-18: «look how big … keep it small»). WhatsApp draws a BIG banner for an
// og:image ≥ ~300px wide and a small side thumbnail below that — the same 192px card the search-share
// links (/s/…) already get. Keep it under 300px.
export const OG_IMAGE = `${SHARE_LINK}/og-image-v9.png`;
// THE PAGE DESCRIPTION — the sentence under Ezhalah's title in a Google result (owner 2026-10-27, built with the owner from
// phone-width previews): a free AI property search engine in Saudi Arabia, then three «from … to …» pairs — big
// platforms to small brokerage offices, Riyadh to Sharurah (a far, uncommon city with real listings; owner 2026-10-28 «شرورة not haql»), villas to raw
// land — then buy / rent / short stays and «إزهله. خله يدور عنك.» — the name standing alone
// (its Saudi meaning «leave it to me / count on me»), then «let it search for you» (the owner's exact words). English mirrors it: «Ezhalah. Let it search for you.» It opens without «إزهله»: the title
// above already says it and the ending repeats it. Shows uncut at phone width; no numbers, no harakat.
// It replaces the 2026-10-11 question-form wording.
// No emoji (owner 2026-10-18: «remove the emoji … make it professional»).
export const SHARE_BLURB_AR = 'محرك بحث عقاري مجاني بالذكاء الاصطناعي في السعودية: من المنصات الكبيرة لمكاتب الوساطة، من الرياض لشرورة، من الفلل للأراضي الخام. بيع وإيجار وإقامات قصيرة. إزهله. خله يدور عنك.';
// The preview CARD's own line (owner 2026-10-18: the card repeated the sent message and was cut off).
// middleware.ts serves link-preview bots the same line WITH live numbers (src/lib/homeCard.ts); this
// number-free form is the static fallback. Pinned equal to HOME_CARD_FALLBACK_AR.
export const SHARE_CARD_DESC_AR = 'كل مواقع العقار في السعودية في مكان واحد.';
export const SHARE_BLURB_EN = 'Free AI property search in Saudi Arabia: big platforms to small offices, Riyadh to Sharurah, villas to raw land. Buy, rent or short stays. Ezhalah. Let it search for you.';
// THE SENT MESSAGE (owner 2026-10-26: names Saudi Arabia so the card need not repeat 148, no harakat, «إزهله، خل إزهله»;
// first set 2026-10-20, replacing the long sentence above in the share message only):
// «ليش تدوّر في 148 موقع؟ إزهله يدوّر عنك». The number is LIVE — the same count the app shows
// («148»: the platform catalog minus the sites the registry marks dormant, src/data/loaderPlatforms.ts
// + loaderActivePlatforms.ts), never typed; while that count is unknown the sentence says «كل المواقع».
// SHARE_BLURB_* above stay the page's SEO description and the in-app preview text.
export const SHARE_LEAD_AR_TEMPLATE = 'ليش تدور في {count} موقع عقاري بالسعودية؟ إزهله، خل إزهله يدور عنك';
export const SHARE_LEAD_AR_NO_COUNT = 'ليش تدور في كل مواقع العقار بالسعودية؟ إزهله، خل إزهله يدور عنك';
// English (owner 2026-10-22, replacing 2026-10-20's «AI meta search engine… one search»): the Arabic line
// translated, longer, and saying what Ezhalah is — «Why search 148 sites one by one? Ezhalah, the AI real
// estate search engine, searches them all for you, in one place.»
export const SHARE_LEAD_EN_TEMPLATE = 'Why search {count} real estate sites across Saudi Arabia? Ezhalah, the AI real estate search engine, searches them all for you.';
export const SHARE_LEAD_EN_NO_COUNT = 'Why search every real estate site across Saudi Arabia? Ezhalah, the AI real estate search engine, searches them all for you.';
/**
 * The live site count — THE SAME number the WhatsApp card shows (src/data/siteCount.ts: sites with
 * searchable listings, one per platform), or null while it has not been read yet. Owner 2026-10-20:
 * the sentence said 146 (logo catalog minus dormant) next to a card saying 148 — one number now.
 */
export function liveSiteCount(): number | null {
  return siteCountNow();
}
// Start the read at app load so the count is known by the time anyone taps Share (the tap handler
// must not await: navigator.share only works inside the gesture). Same guard SearchLoader.tsx uses.
if (Platform.OS !== 'web' || typeof window !== 'undefined') void loadSiteCount();
/** The sentence on its own (X / Telegram put the link in their own url= parameter). */
export function shareLead(loc: 'ar' | 'en', count: number | null): string {
  const live = typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : null;
  if (loc === 'ar') return live ? SHARE_LEAD_AR_TEMPLATE.replace('{count}', String(live)) : SHARE_LEAD_AR_NO_COUNT;
  return live ? SHARE_LEAD_EN_TEMPLATE.replace('{count}', String(live)) : SHARE_LEAD_EN_NO_COUNT;
}
/** The sentence WITH the link — what WhatsApp / Mail / Copy receive. One link, always last. */
export function shareMessage(loc: 'ar' | 'en', count: number | null): string {
  return `${shareLead(loc, count)}\n${SHARE_LINK}`;
}
export const SHARE_TITLE_AR = 'إزهله';
// The browser tab / history / suggestion / Google title (owner 2026-10-27, picked from phone-width previews: the
// Kingdom wording). Both are checked to FIT uncut — the owner's longer English «…at once in the Kingdom» was cut off,
// so the English is «All Saudi properties in one place» (matches the Arabic, fits). The share card keeps the plain name.
export const PAGE_TITLE_AR = 'إزهله | ابحث في كل عقارات المملكة بمكان واحد';
export const PAGE_TITLE_EN = 'Ezhalah | All Saudi properties in one place';
const SHARE = {
  en: { title: 'Ezhalah' },
  ar: { title: SHARE_TITLE_AR },
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
  const loc: 'ar' | 'en' = getLocale() === 'ar' ? 'ar' : 'en';
  const L = SHARE[loc];
  const count = liveSiteCount();
  const lead = shareLead(loc, count);
  const message = shareMessage(loc, count);
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
        await nav.share({ title: L.title, text: lead, url: SHARE_LINK });
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
    await Share.share({ message, url: SHARE_LINK, title: L.title });
    return true;
  } catch {
    return false;
  }
}
