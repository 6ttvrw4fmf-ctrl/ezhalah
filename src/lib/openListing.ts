import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { Listing } from '@/data/listings';
import { getLocale } from '@/i18n';

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

// Gathern: append today→+30 day dates so the unit page opens directly in monthly view.
// The scraper stores the bare /view/{chalet_id}/unit/{unit_id} URL (no dates) so the click-through
// always uses a fresh date window rather than stale scraped dates.
function gathernDateUrl(url: string): string {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const checkIn = fmt(today);
  const out = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const checkOut = fmt(out);
  return `${url}?check_in=${checkIn}&check_out=${checkOut}`;
}

export async function openListing(listing: Listing): Promise<void> {
  const raw = listing.source_url;
  const url = raw?.includes('gathern.co')
    ? gathernDateUrl(raw)
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
