// THE MAP BOX (owner 2026-11-12 — the agreed design is docs/ARCHITECTURE.md «THE MAP BOX AND ITS CARD»). Under the
// pill's count, word-labelled chips for EXACTLY the ads it counts, under every map filter:
//   «123 جديد» · «85 اختفى» · «المتر المعروض 6,100 ريال» · «أغلى من أحياء قريبة 9%» · «15 خفضوا السعر»
// The numbers come from map_view_facts_ar() (migrations 20261112191654 … 20261113031654). This file only decides what may
// be SAID:
//   • nothing when the read failed or the facts are switched off (a failed read is never a «0»);
//   • nothing unless the server counted the SAME ads the pill shows (its `any` equals the pill's number);
//   • nothing for a view with fewer than FACTS_MIN_ADS ads, and no chip whose number is 0 or missing;
//   • every price says «المعروض» (asking, never sold); with no single type picked the price is never mixed — the box
//     asks for a type instead;
//   • a guest gets the same chips as blurred shapes and «سجل الدخول لعرض الأرقام» — the server never sends a number.
import { shortMoney } from './mapPins.ts';

export type FactTone = 'up' | 'down' | 'plain';
export type FactChip = { text: string; tone: FactTone };
export type ViewFacts = {
  any: number;
  locked: boolean;
  new30: number | null;
  gone30: number | null;
  ppm: number | null;
  nbPpm: number | null;
  nbKind: 'near' | 'city' | null;
  nbNames: string[];
  cityAr: string | null;
  cuts30: number | null;
  oneType: boolean;
  /** guest only: which chips a signed-in user would see (the server sends yes/no, never the number) */
  has?: { new: boolean; gone: boolean; ppm: boolean; cmp: boolean; cuts: boolean };
};
export const FACTS_MIN_ADS = 30;
export const FACTS_DAYS = 30;
/** Under this difference from the neighbours the comparison says «قريب من …» rather than a percentage. */
export const SAME_AS_NEIGHBOURS_PCT = 5;

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
const money = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** The RPC's `{ data, error }` → facts, or null when the read failed, the facts are off (data null) or the shape is wrong. */
export function parseViewFacts(result: { data: unknown; error: unknown }): ViewFacts | null {
  if (result.error || !result.data || typeof result.data !== 'object') return null;
  const d = result.data as Record<string, unknown>;
  const any = count(d.any);
  if (any === null) return null;
  const nbKind: 'near' | 'city' | null = d.nb_kind === 'near' ? 'near' : d.nb_kind === 'city' ? 'city' : null;
  const base = { any, nbKind, oneType: d.one_type === true, nbNames: [] as string[], cityAr: null as string | null };
  if (d.locked === true) {
    const has = { new: d.has_new === true, gone: d.has_gone === true, ppm: d.has_ppm === true, cmp: d.has_cmp === true, cuts: d.has_cuts === true };
    return { ...base, locked: true, new30: null, gone30: null, ppm: null, nbPpm: null, cuts30: null, has };
  }
  const names = Array.isArray(d.nb_names) ? d.nb_names.filter((x): x is string => typeof x === 'string') : [];
  return {
    ...base, locked: false, nbNames: names, cityAr: typeof d.city_ar === 'string' ? d.city_ar : null,
    new30: count(d.new30), gone30: count(d.gone30), ppm: money(d.ppm), nbPpm: money(d.nb_ppm), cuts30: count(d.cuts30),
  };
}

/** «أغلى من أحياء قريبة 9%» / «أرخص من الرياض 12%» / «قريب من أحياء قريبة». The percentage is isolated left-to-right so an
 *  Arabic line never shows the flipped «%9». */
export function comparisonChip(ppm: number, nbPpm: number, nbKind: 'near' | 'city', city: string | null, loc: 'ar' | 'en', latin: (s: string) => string = (s) => s): FactChip {
  const pct = Math.round(((ppm - nbPpm) / nbPpm) * 100);
  const whom = nbKind === 'city' && city ? (loc === 'ar' ? city : latin(city)) : loc === 'ar' ? 'أحياء قريبة' : 'nearby districts';
  if (Math.abs(pct) < SAME_AS_NEIGHBOURS_PCT) return { text: loc === 'ar' ? `قريب من ${whom}` : `about the same as ${whom}`, tone: 'plain' };
  const p = `⁦${Math.abs(pct)}%⁩`;
  if (pct > 0) return { text: loc === 'ar' ? `أغلى من ${whom} ${p}` : `${p} pricier than ${whom}`, tone: 'up' };
  return { text: loc === 'ar' ? `أرخص من ${whom} ${p}` : `${p} cheaper than ${whom}`, tone: 'down' };
}

export type FactBox =
  | { kind: 'none' }
  | { kind: 'locked'; chips: string[] }
  | { kind: 'chips'; chips: FactChip[]; hint: string | null };

/** What the box says, given the facts, the number the pill's first line shows, whether a property type is picked,
 *  whether the view is sale-only (the only place a price can appear, so the only place to ask for a type), and whether
 *  the count is a drawn boundary (then the facts are for the ads inside it, without «أحياء قريبة»). */
export function factBox(f: ViewFacts | null, shown: number | null, loc: 'ar' | 'en', typePicked: boolean, saleOnly = true,
                        latin: (s: string) => string = (s) => s, drawn = false): FactBox {
  if (!f || shown === null || f.any !== shown || f.any < FACTS_MIN_ADS) return { kind: 'none' };
  const n = (x: number) => x.toLocaleString('en-US');
  if (f.locked) {
    const h = f.has;
    const shapes = [
      h?.new ? (loc === 'ar' ? '88 جديد' : '88 new') : null,
      h?.gone ? (loc === 'ar' ? '88 اختفى' : '88 gone') : null,
      h?.ppm ? (loc === 'ar' ? 'المتر المعروض 8,888' : 'asking 8,888/m²') : null,
      h?.cmp && !drawn ? (loc === 'ar' ? 'مقارنة بأحياء قريبة 88%' : 'vs nearby 88%') : null,
      h?.cuts ? (loc === 'ar' ? '88 خفضوا السعر' : '88 price cuts') : null,
    ].filter((x): x is string => x !== null);
    return shapes.length ? { kind: 'locked', chips: shapes } : { kind: 'none' };
  }
  const chips: FactChip[] = [];
  if (f.new30) chips.push({ text: loc === 'ar' ? `${n(f.new30)} جديد` : `${n(f.new30)} new`, tone: 'plain' });
  if (f.gone30) chips.push({ text: loc === 'ar' ? `${n(f.gone30)} اختفى` : `${n(f.gone30)} gone`, tone: 'plain' });
  if (f.ppm) {
    chips.push({ text: loc === 'ar' ? `المتر المعروض ${n(f.ppm)} ريال` : `asking ${n(f.ppm)} SAR/m²`, tone: 'plain' });
    // a drawn boundary is not a district: nothing fair to compare it with, so «أحياء قريبة» is not said
    if (f.nbPpm && f.nbKind && !drawn) chips.push(comparisonChip(f.ppm, f.nbPpm, f.nbKind, f.cityAr, loc, latin));
  }
  if (f.cuts30) chips.push({ text: loc === 'ar' ? `${n(f.cuts30)} خفضوا السعر` : `${n(f.cuts30)} price cuts`, tone: 'plain' });
  const hint = saleOnly && !typePicked && !f.ppm ? (loc === 'ar' ? 'اختر نوع العقار لعرض السعر' : 'Pick a property type to see the price') : null;
  if (chips.length === 0 && !hint) return { kind: 'none' };
  return { kind: 'chips', chips, hint };
}

/** The small grey label after the count: «· آخر 30 يوما». */
export const factsWindowLabel = (loc: 'ar' | 'en'): string => (loc === 'ar' ? `آخر ${FACTS_DAYS} يوما` : `last ${FACTS_DAYS} days`);
export const lockedAsk = (loc: 'ar' | 'en'): string => (loc === 'ar' ? '🔒 سجل الدخول لعرض الأرقام' : '🔒 Sign in to see the numbers');

/** Facts are asked for only at exact-point zoom (a view under ~13 km tall), where the read takes tens of ms. */
export function factsZoom(latitudeDelta: number): boolean {
  return latitudeDelta <= 0.12;
}

// shortMoney stays exported from here for the card (step 2), which prints «1.4 مليون».
export { shortMoney };
