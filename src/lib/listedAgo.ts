// «اليوم» / «أمس» / «قبل ٣ أيام» ON THE CARD (owner 2026-11-13: «I like اليوم … push it more far right»).
// The card's date is the SITE's own posting date, already cleaned to DD/MM/YYYY by ResultCard's cleanDate().
// It is read TEXTUALLY (never `new Date(stamp)`, which would shift a +03:00 Saudi date for a viewer elsewhere)
// and compared with TODAY IN RIYADH, so «اليوم» means the Saudi day the site published it. Pure: the barrier
// (scripts/verify-card-says-today.ts) executes it.
//   0 → اليوم · 1 → أمس · 2 → قبل يومين · 3–10 → قبل N أيام · 11–29 → قبل N يوم
// A date 30+ days old, a future date, or anything unreadable returns '' — the card then shows the date itself,
// never a guess.
export type Ymd = { y: number; m: number; d: number };

/** Today's calendar date in Riyadh. */
export function riyadhToday(now: Date = new Date()): Ymd {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** Whole days between a DD/MM/YYYY card date and `today`, or null when the text is not a real date. */
export function daysSinceCardDate(cardDate: string, today: Ymd): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((cardDate || '').trim());
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  const at = Date.UTC(y, mo - 1, d);
  const back = new Date(at);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null; // 31/02 etc.
  return Math.round((Date.UTC(today.y, today.m - 1, today.d) - at) / 86_400_000);
}

export const AGO_MAX_DAYS = 29;

/** The card's words for how long ago the site posted it, or '' to show the date instead. */
export function listedAgoText(cardDate: string, locale: 'ar' | 'en', today: Ymd = riyadhToday()): string {
  const n = daysSinceCardDate(cardDate, today);
  if (n === null || n < 0 || n > AGO_MAX_DAYS) return '';
  if (locale === 'en') return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : `${n} days ago`;
  if (n === 0) return 'اليوم';
  if (n === 1) return 'أمس';
  if (n === 2) return 'قبل يومين';
  return n <= 10 ? `قبل ${n} أيام` : `قبل ${n} يوم`;
}
