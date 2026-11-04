// EVERY LISTING'S SPOT, PAINTED AT ANY ZOOM (owner 2026-11-02: «can you do it in a way that even when I am zoomed out
// they all show?»). The map downloads the dots feed once — every pinned listing's 1 km cell with its deal and count
// (map_dots_ar(), rebuilt hourly) — and paints the ones in view on a canvas each time the view settles. A canvas
// draws 23,000 dots in a few milliseconds where 23,000 DOM annotations would freeze a phone. Pure rules only: the
// feed's shape, the deal filter, the box clip, and the projection from (lat, lng) to canvas pixels, so the barrier
// can execute them.
import type { PinDeal } from './mapPins';

export type MapDot = { lat: number; lng: number; deal: 'buy' | 'rent' | 'short'; n: number };

const DEAL_OF_CODE: Record<number, MapDot['deal']> = { 0: 'buy', 1: 'rent', 2: 'short' };

/** The feed's rows ([lat, lng, dealCode, n]) → dots. Anything that is not a finite 4-tuple is dropped, never invented. */
export function parseDots(raw: unknown): MapDot[] {
  if (!Array.isArray(raw)) return [];
  const out: MapDot[] = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length < 4) continue;
    const [lat, lng, code, n] = r as unknown[];
    const deal = DEAL_OF_CODE[Number(code)];
    if (!deal || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || !(Number(n) > 0)) continue;
    out.push({ lat: Number(lat), lng: Number(lng), deal, n: Number(n) });
  }
  return out;
}

/** The dots the current deal choice keeps, inside a lat/lng box. An empty deal list keeps nothing (the UI never sends one). */
export function dotsInView(dots: MapDot[], deals: PinDeal[] | string[], box: { s: number; w: number; n: number; e: number }): MapDot[] {
  const keep = new Set(deals as string[]);
  return dots.filter((d) => keep.has(d.deal) && d.lat >= box.s && d.lat <= box.n && d.lng >= box.w && d.lng <= box.e);
}

/** How many listings the kept dots stand for — the count pill's number. */
export const dotsTotal = (dots: MapDot[]): number => dots.reduce((a, d) => a + d.n, 0);

/** Web-Mercator y for a latitude (radians-free form, monotonic north → smaller). */
export function mercY(lat: number): number {
  const c = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
  return -Math.log(Math.tan(Math.PI / 4 + c / 2));
}

/** A projector (lat, lng) → [x, y] calibrated on two reference points the map itself placed on the page (MapKit's
 *  convertCoordinateToPointOnPage), so it matches Apple's own projection exactly: linear in longitude, linear in
 *  Mercator y. The two points must differ in both axes; otherwise null (never a wrong picture). */
export function projectorFrom(a: { lat: number; lng: number; x: number; y: number }, b: { lat: number; lng: number; x: number; y: number }): ((lat: number, lng: number) => [number, number]) | null {
  const dLng = b.lng - a.lng; const dMy = mercY(b.lat) - mercY(a.lat);
  if (!dLng || !dMy || !Number.isFinite(dLng) || !Number.isFinite(dMy)) return null;
  const sx = (b.x - a.x) / dLng; const sy = (b.y - a.y) / dMy; const my0 = mercY(a.lat);
  return (lat, lng) => [a.x + (lng - a.lng) * sx, a.y + (mercY(lat) - my0) * sy];
}

/** Dot radius in CSS px for a view: a whisper of a dot over the country, a clear one near a city. */
export function dotRadius(latitudeDelta: number): number {
  return latitudeDelta > 8 ? 1.6 : latitudeDelta > 2 ? 2.2 : 3;
}

/** The dot nearest to a tap, within `within` px, else null (a tap on empty map does nothing). */
export function nearestDot(dots: MapDot[], project: (lat: number, lng: number) => [number, number], x: number, y: number, within = 14): MapDot | null {
  let best: MapDot | null = null; let bd = within * within;
  for (const d of dots) {
    const [px, py] = project(d.lat, d.lng);
    const dd = (px - x) * (px - x) + (py - y) * (py - y);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}

/** The crowded close-in view's count bubbles, built on the phone from the dots feed (the feed IS the 0.01° grid the
 *  map would otherwise read again over the network): one bubble per cell, deals merged, position weighted by count. */
export function bubblesFromDots(dots: MapDot[], cell = 0.01): { lat: number; lng: number; n: number; deal: string }[] {
  const by = new Map<string, { la: number; lo: number; n: number; deals: Set<string> }>();
  for (const d of dots) {
    const k = `${Math.round(d.lat / cell)}|${Math.round(d.lng / cell)}`;
    const b = by.get(k) ?? { la: 0, lo: 0, n: 0, deals: new Set<string>() };
    b.la += d.lat * d.n; b.lo += d.lng * d.n; b.n += d.n; b.deals.add(d.deal); by.set(k, b);
  }
  return [...by.values()].map((b) => ({ lat: b.la / b.n, lng: b.lo / b.n, n: b.n, deal: b.deals.size === 1 ? [...b.deals][0] : 'mixed' }));
}
