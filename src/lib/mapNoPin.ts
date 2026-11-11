// THE DISTRICT MARKER FOR LISTINGS WITH NO EXACT LOCATION — the pure half (owner 2026-11-09: «include the ones with
// no pins … make it professional … «موقع غير محدد» / «No exact location» … when the user clicks he sees them»).
//
// ~13,500 listings name their district but their website never says where the property is, and no sure twin lends
// them a pin (map_pin_borrow). From district zoom inward the map draws ONE marker per district for them, at the
// district's centre: dark purple, a crossed-out pin, the count, and the tag «موقع غير محدد», so nobody reads it as a
// house's spot. A tap opens the same card sheet a pin opens. The blue pins, the dots, the labels and the count pill
// are untouched — a real spot stays a real spot. No imports beyond types, so
// scripts/verify-map-no-pin-district-marker.ts can EXECUTE every rule here under plain Node.
// The fetch lives in src/data/mapNoPin.ts; the drawing in src/components/AppleMap.web.tsx; the server half is
// map_nopin_markers_ar() (supabase/migrations/20261109045105_map_no_pin_district_marker.sql).
import type { PinDeal, PinFilter, PinRow } from './mapPins';

/** One row of map_nopin_markers_ar(): a district's no-location listings, at the district's centre. */
export type NoPinRow = {
  city: string; district: string; lat: number; lng: number; n: number; deal: PinDeal;
  ids: { t: string; i: number }[] | null;
};

/** The app's own dark purple (the sign-in button), so the marker reads as Ezhalah's, not as a deal colour. */
export const NO_PIN_COLOR = '#4B3F6B';
/** Most card ids one marker carries (the biggest district holds ~220 today); the count stays the true count. */
export const NO_PIN_IDS_MAX = 500;

/** The tag under the marker, in the UI language. Short on purpose: it sits under a pin-sized pill on a phone. */
export function noPinTag(loc: 'ar' | 'en'): string {
  return loc === 'ar' ? 'موقع غير محدد' : 'No exact location';
}

/** The number on the pill — plain digits, grouped (1,204), the same digits the blue pins use. */
export function noPinHead(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString('en-US');
}

/** WHEN THE MARKER SHOWS: from district zoom inward (exact-point views, cell 0) — never among zoomed-out dots or area
 *  labels — and never while a drawn boundary is applied: a listing with no spot cannot be inside a shape. */
export function showNoPin(cell: number, f: Pick<PinFilter, 'poly'>): boolean {
  return cell === 0 && !f.poly;
}

/** The RPC arguments for one view + filter: the same narrowing the pins take (deal, category, type, bedrooms, size,
 *  price), no cell and no polygon. Every unset filter is null = not narrowed. */
export function noPinArgs(box: { s: number; w: number; n: number; e: number }, f: PinFilter, limit = 200) {
  return {
    p_s: box.s, p_w: box.w, p_n: box.n, p_e: box.e,
    p_deals: f.deals.length === 3 ? null : f.deals,
    p_category: f.category ?? null,
    p_types: f.types && f.types.length ? f.types : null,
    p_beds: f.beds && f.beds.length ? f.beds : null,
    p_area_min: f.areaMin ?? null, p_area_max: f.areaMax ?? null,
    p_price_min: f.priceMin ?? null, p_price_max: f.priceMax ?? null,
    p_limit: limit,
    ...(f.furnished != null ? { p_furnished: f.furnished } : {}),
    ...(f.scope ? { p_tables: f.scope.tables, p_tables2: f.scope.tables2, p_types2: f.scope.types2, p_macro: f.scope.macro } : {}),
  };
}

/** Pure: the RPC's `{ data, error }` → rows, or 'unknown' when the fetch failed (A FAILED FETCH IS NOT AN EMPTY ANSWER:
 *  a marker that vanishes after an error must never read as «no such listings here»). */
export function noPinFrom(result: { data: unknown; error: unknown }): NoPinRow[] | 'unknown' {
  if (result.error || !Array.isArray(result.data)) return 'unknown';
  return (result.data as NoPinRow[]).filter((r) => typeof r.lat === 'number' && typeof r.lng === 'number' && typeof r.n === 'number' && r.n > 0 && typeof r.district === 'string');
}

/** The marker as a pin row for the card sheet: the count, the ids, and `noPin` naming the district — no price, no
 *  platform (it is many listings), so the sheet titles it by district and never prints a head price. */
export function noPinPinRow(r: NoPinRow): PinRow {
  return { lat: r.lat, lng: r.lng, n: r.n, deal: r.deal, type_ar: null, platforms: 0, ids: r.ids, price: null, platform: null, noPin: { city: r.city, district: r.district } };
}

/** The annotation key: a pan keeps the marker that stays; a changed count replaces it. */
export function noPinKey(r: Pick<NoPinRow, 'city' | 'district' | 'n'>): string {
  return `NP|${r.city}|${r.district}|${r.n}`;
}
export const isNoPinKey = (k: string): boolean => k.startsWith('NP|');
