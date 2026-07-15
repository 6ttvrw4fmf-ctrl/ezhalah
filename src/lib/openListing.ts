import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { Listing } from '@/data/listings';
import { getLocale } from '@/i18n';
import { gathernClickThroughUrl } from '@/lib/gathernUrl';

// Open a listing on its source platform in the way that "views it normally" for the user:
//   • WEB  → a new browser tab (real Aqar page in their own Chrome; can't be an iframe — Aqar sends
//            x-frame-options: SAMEORIGIN — and a new tab shows it perfectly).
//   • NATIVE (iOS/Android app) → an IN-APP browser (Chrome Custom Tab / Safari View Controller) via
//            expo-web-browser, so the real Aqar page opens INSIDE the app without leaving it. This is
//            the true "open inside using Chrome" experience. (user request.)
//
// The URL is localized to the app's language (Aqar has an /en variant).
function localizeAqarUrl(url: string | null | undefined, locale: string): string | undefined {
  if (!url) return undefined;
  if (locale !== 'en') return url;
  const m = url.match(/^(https?:\/\/sa\.aqar\.fm)(\/.*)$/);
  if (!m) return url;
  if (m[2].startsWith('/en/') || m[2] === '/en') return url;
  return `${m[1]}/en${m[2]}`;
}

// Gathern: open the bare stored /view/{chalet_id}/unit/{unit_id} URL unchanged.
//
// 2026-07-14 price-fidelity investigation: this used to append `?check_in=...&check_out=...` on the
// theory that it would land the user on the same discounted 30-night "monthly view" the scraper
// priced. Live-verified that Gathern's page ignores that querystring entirely (confirmed via
// __NEXT_DATA__.props.pageProps.query, which only ever carries {chalet_id, unit_id}) — both the bare
// URL and the date-appended URL render an identical single-night spot-price view that has no relation
// to the stored monthly figure. Appending fake date params therefore didn't help; it actively misled
// anyone comparing the click-through page's price against the stored one. See src/lib/gathernUrl.ts
// for the full evidence trail. Until a real deep link to Gathern's priced monthly view is found, we
// open the bare URL rather than dress it up as something it isn't.
export async function openListing(listing: Listing): Promise<void> {
  const raw = listing.source_url;
  const url = raw?.includes('gathern.co')
    ? gathernClickThroughUrl(raw)
    : localizeAqarUrl(raw, getLocale());
  if (!url) return;
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  try {
    await WebBrowser.openBrowserAsync(url, {
      // Tint the in-app browser chrome to the brand green so it feels like part of Ezhalah.
      toolbarColor: '#2f7247',
      controlsColor: '#ffffff',
      enableBarCollapsing: true,
    });
  } catch {
    // expo-web-browser unavailable for some reason — no-op (the card still rendered).
  }
}
