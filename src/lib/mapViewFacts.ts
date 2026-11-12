// THE MAP PILL'S SECOND LINE (owner 2026-11-12: «whenever a user zooms in we show that message here», «آخر 30 يوما»,
// «we need proper guards … it can't be wrong»). Under «1,081 إعلان للبيع في حي الملقا» the pill adds, for EXACTLY the
// ads it counts: «آخر 30 يوما: 🆕 123 إعلان جديد · ⚡ 85 اختفى · 💰 متوسط السعر 1.4 مليون».
// The numbers come from map_view_facts_ar() (migration 20261112191654). This file only decides what may be SAID:
//   • nothing when the read failed or the line is switched off (a failed read is never a «0»);
//   • nothing unless the server counted the SAME ads the pill shows (its `any` equals the pill's number);
//   • nothing for a view with fewer than FACTS_MIN_ADS ads, and no part whose number is 0 or missing;
//   • a guest gets a blurred line and «سجل الدخول لعرض الأرقام» — the server never sends a guest the numbers.
// «إعلان جديد», never «جديد» alone: «جديد» in the Filter means a newly BUILT property (src/lib/mapPins.ts freshTag).
import { adsNounAr, shortMoney } from './mapPins.ts';

export type ViewFacts = { any: number; locked: boolean; new30: number | null; gone30: number | null; median: number | null;
  /** the same three numbers over the map as it stood 28–34 days ago (the month-arrows migration); null = no baseline */
  prevNew30?: number | null; prevGone30?: number | null; prevMedian?: number | null;
  /** guest only: which parts a signed-in user would see (the server sends yes/no, never the number) */
  has?: { new: boolean; gone: boolean; median: boolean } };
export const FACTS_MIN_ADS = 30;
export const FACTS_DAYS = 30;

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/** The RPC's `{ data, error }` → facts, or null when the read failed, the line is off (data null) or the shape is wrong. */
export function parseViewFacts(result: { data: unknown; error: unknown }): ViewFacts | null {
  if (result.error || !result.data || typeof result.data !== 'object') return null;
  const d = result.data as Record<string, unknown>;
  const any = count(d.any);
  if (any === null) return null;
  if (d.locked === true) {
    const has = { new: d.has_new === true, gone: d.has_gone === true, median: d.has_median === true };
    return { any, locked: true, new30: null, gone30: null, median: null, has };
  }
  const median = typeof d.median === 'number' && d.median > 0 ? d.median : null;
  const prevMedian = typeof d.prev_median === 'number' && d.prev_median > 0 ? d.prev_median : null;
  return { any, locked: false, new30: count(d.new30), gone30: count(d.gone30), median,
           prevNew30: count(d.prev_new30), prevGone30: count(d.prev_gone30), prevMedian };
}

/** «123 إعلان جديد» — the last two digits decide, as everywhere on the map. */
export function newAdsAr(n: number): string {
  if (n === 1) return 'إعلان جديد واحد';
  if (n === 2) return 'إعلانان جديدان';
  const noun = adsNounAr(n);
  return `${n.toLocaleString('en-US')} ${noun === 'إعلانات' ? 'إعلانات جديدة' : 'إعلان جديد'}`;
}
/** «85 اختفى» / «5 اختفت». */
export function goneAr(n: number): string {
  const r = n % 100;
  return `${n.toLocaleString('en-US')} ${n !== 1 && r >= 2 && r <= 10 ? 'اختفت' : 'اختفى'}`;
}

/** THE ARROW AGAINST LAST MONTH (owner 2026-11-12): said only when the change is real, never for noise.
 *  Counts: both months at least ARROW_MIN_COUNT and a change of at least ARROW_MIN_COUNT_PCT. Price: the home facts'
 *  rule — a move of at least ARROW_MIN_PRICE_PCT. Rounded to a whole percent; «↑12%» / «↓5%». */
export const ARROW_MIN_COUNT = 20;
export const ARROW_MIN_COUNT_PCT = 10;
export const ARROW_MIN_PRICE_PCT = 3;
export function monthArrow(now: number | null, prev: number | null | undefined, kind: 'count' | 'price'): string {
  if (now === null || prev === null || prev === undefined || prev <= 0 || now <= 0) return '';
  if (kind === 'count' && (now < ARROW_MIN_COUNT || prev < ARROW_MIN_COUNT)) return '';
  const pct = Math.round(((now - prev) / prev) * 100);
  if (Math.abs(pct) < (kind === 'count' ? ARROW_MIN_COUNT_PCT : ARROW_MIN_PRICE_PCT)) return '';
  // Isolated left-to-right (LRI … PDI) so an Arabic line shows «↑12%», never the flipped «%12↑».
  return ` \u2066${pct > 0 ? '↑' : '↓'}${Math.abs(pct)}%\u2069`;
}

export type FactLine = { kind: 'none' } | { kind: 'locked' } | { kind: 'facts'; text: string };

/** What the second line says, given the facts and the number the pill's first line shows. */
export function factLine(f: ViewFacts | null, shown: number | null, loc: 'ar' | 'en'): FactLine {
  if (!f || shown === null || f.any !== shown || f.any < FACTS_MIN_ADS) return { kind: 'none' };
  if (f.locked) return f.has && (f.has.new || f.has.gone || f.has.median) ? { kind: 'locked' } : { kind: 'none' };
  const parts: string[] = [];
  if (f.new30) parts.push((loc === 'ar' ? `🆕 ${newAdsAr(f.new30)}` : `🆕 ${f.new30.toLocaleString('en-US')} new listing${f.new30 === 1 ? '' : 's'}`) + monthArrow(f.new30, f.prevNew30, 'count'));
  if (f.gone30) parts.push((loc === 'ar' ? `⚡ ${goneAr(f.gone30)}` : `⚡ ${f.gone30.toLocaleString('en-US')} gone`) + monthArrow(f.gone30, f.prevGone30, 'count'));
  if (f.median) parts.push((loc === 'ar' ? `💰 متوسط السعر ${shortMoney(f.median, 'ar')}` : `💰 avg price ${shortMoney(f.median, 'en')}`) + monthArrow(f.median, f.prevMedian, 'price'));
  if (parts.length === 0) return { kind: 'none' };
  return { kind: 'facts', text: `${loc === 'ar' ? `آخر ${FACTS_DAYS} يوما` : `Last ${FACTS_DAYS} days`}: ${parts.join(' · ')}` };
}

/** The guest's line: the words stay, the numbers are blurred shapes (never real numbers), then the sign-in ask. */
export function lockedLine(f: ViewFacts, loc: 'ar' | 'en'): { lead: string; blurred: string; ask: string } {
  const shapes = [f.has?.new ? '🆕 888' : null, f.has?.gone ? '⚡ 88' : null, f.has?.median ? '💰 8.8' : null].filter(Boolean).join(' · ');
  return loc === 'ar'
    ? { lead: `آخر ${FACTS_DAYS} يوما:`, blurred: shapes, ask: '🔒 سجل الدخول لعرض الأرقام' }
    : { lead: `Last ${FACTS_DAYS} days:`, blurred: shapes, ask: '🔒 Sign in to see the numbers' };
}

/** Facts are asked for only at exact-point zoom (a view under ~13 km tall), where the read takes tens of ms. */
export function factsZoom(latitudeDelta: number): boolean {
  return latitudeDelta <= 0.12;
}
