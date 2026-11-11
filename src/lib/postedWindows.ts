// «نُشر خلال» — PUBLISHED WITHIN (owner 2026-11-11: «time published … like Zillow … shows the number»).
// Each window is a MAXIMUM age, like Zillow's «Time on Zillow»: «7 أيام» = published in the last 7 days or less, so every
// window holds the ones before it. The date is the listing SITE's own posting date (search_listings_ar.posted_at), never
// the day Ezhalah found the ad; an ad whose site gives no date is in no window and shows only under «أي وقت».
// Not offered for short stays (Gathern / Aqar Monthly price by stay length; the owner kept them out).
import type { SearchQuery } from '@/data/search';

/** The windows, in days, in the order the menu lists them. Months are counted in days (6 / 12 / 24 / 36 months). */
export const POSTED_WINDOWS = [1, 7, 14, 30, 90, 183, 365, 730, 1095] as const;
export type PostedWindow = (typeof POSTED_WINDOWS)[number];

/** The menu label of a window («يوم واحد», «7 أيام», «6 أشهر» …), as an i18n key. null = «أي وقت». */
export function postedWindowLabel(days: number | null | undefined): string {
  switch (days) {
    case 1: return 'Published: 1 day';
    case 7: return 'Published: 7 days';
    case 14: return 'Published: 14 days';
    case 30: return 'Published: 30 days';
    case 90: return 'Published: 90 days';
    case 183: return 'Published: 6 months';
    case 365: return 'Published: 12 months';
    case 730: return 'Published: 24 months';
    case 1095: return 'Published: 36 months';
    default: return 'Published: any time';
  }
}

/** A value the menu can hold, or null — anything else (an old share link, a typo) reads as «أي وقت». */
export function validPostedWindow(v: unknown): PostedWindow | null {
  return typeof v === 'number' && (POSTED_WINDOWS as readonly number[]).includes(v) ? (v as PostedWindow) : null;
}

/** Short stays (the «إقامات قصيرة» pool = Rent with the monthly period) never get the publish filter. */
export function postedWindowOffered(q: Pick<SearchQuery, 'deal' | 'rentPeriod' | 'dealCombined'>): boolean {
  return !(q.deal === 'Rent' && !q.dealCombined && q.rentPeriod === 'monthly');
}

/** The window to SEND for this query: the picked one, unless the query is a short stay (then nothing). */
export function postedWindowParam(q: Pick<SearchQuery, 'deal' | 'rentPeriod' | 'dealCombined' | 'postedWithinDays'>): number | null {
  return postedWindowOffered(q) ? validPostedWindow(q.postedWithinDays) : null;
}

/** The window as a phrase for the search sentence («، منشور خلال آخر 7 أيام» / «, published in the last 7 days»);
 *  '' for «أي وقت». Written out here (not through i18n) so the plain-Node barrier can execute it. */
export function postedPhrase(days: number | null | undefined, loc: 'ar' | 'en'): string {
  const d = validPostedWindow(days);
  if (d == null) return '';
  const ar: Record<PostedWindow, string> = { 1: '24 ساعة', 7: '7 أيام', 14: '14 يوماً', 30: '30 يوماً', 90: '90 يوماً', 183: '6 أشهر', 365: '12 شهراً', 730: '24 شهراً', 1095: '36 شهراً' };
  const en: Record<PostedWindow, string> = { 1: '24 hours', 7: '7 days', 14: '14 days', 30: '30 days', 90: '90 days', 183: '6 months', 365: '12 months', 730: '24 months', 1095: '36 months' };
  return loc === 'ar' ? `، منشور خلال آخر ${ar[d]}` : `, published in the last ${en[d]}`;
}
