// AREA LABELS — CITY AND DISTRICT NAMES WITH THEIR COUNTS (owner's father, relayed 2026-11-03: «show only the number of
// listings in the area at such low zoom, and place marks only when the user zooms in further»; «at this zoom level
// show the names of the districts only and the number of listings»). Pure rules, import-free, so the barrier can
// execute them: which level a zoom shows, a label's words, and where a tap on a label takes the map.

export type AreaLevel = 'city' | 'district';
export type AreaRow = { city: string; district: string; lat: number; lng: number; n: number };

/** Wider than this (latitude span, degrees): one label per CITY. */
export const CITY_LABELS_ABOVE = 2.5;
/** Wider than this: one label per DISTRICT. At or below it the price pins show. */
export const DISTRICT_LABELS_ABOVE = 0.06;

/** The level a view shows; null = close enough for price pins. */
export function areaLevelFor(latitudeDelta: number): AreaLevel | null {
  if (latitudeDelta > CITY_LABELS_ABOVE) return 'city';
  if (latitudeDelta > DISTRICT_LABELS_ABOVE) return 'district';
  return null;
}

/** A count in few characters: 245, 3.4 ألف / 3.4K, 1.2 مليون / 1.2M. */
export function areaCount(n: number, loc: 'ar' | 'en'): string {
  const one = (v: number) => (v < 10 ? (Math.round(v * 10) / 10).toString() : Math.round(v).toString());
  if (n >= 1_000_000) return loc === 'ar' ? `${one(n / 1_000_000)} مليون` : `${one(n / 1_000_000)}M`;
  if (n >= 1_000) return loc === 'ar' ? `${one(n / 1_000)} ألف` : `${one(n / 1_000)}K`;
  return String(n);
}

/** The label's name: the city at city level, the district (without a leading «حي ») at district level. */
export function areaName(a: Pick<AreaRow, 'city' | 'district'>, level: AreaLevel): string {
  if (level === 'city' || !a.district) return a.city;
  return a.district.replace(/^حي\s+/, '');
}

/** Where a tap on a label takes the map: a city opens at district level, a district opens at pin level. */
export function areaZoomSpan(level: AreaLevel): number {
  return level === 'city' ? 0.4 : 0.015;
}

/** A view too crowded for price pins shows district names while two or more districts share it; once one district
 *  fills the screen, names would only repeat that one district, so the fine count grid takes over. */
export const denseShowsDistricts = (labelsInView: number, latitudeDelta: number): boolean =>
  labelsInView >= 2 && latitudeDelta > DENSE_DISTRICTS_ABOVE;
/** Inside a district (a tap lands at 0.015°) names never come back — only the counted bubbles and the pins. */
export const DENSE_DISTRICTS_ABOVE = 0.02;

/** A label whose position is on screen (the padded read box also holds labels just off the edge). */
export function inView(a: Pick<AreaRow, 'lat' | 'lng'>, center: { latitude: number; longitude: number }, span: { latitudeDelta: number; longitudeDelta: number }): boolean {
  return Math.abs(a.lat - center.latitude) <= span.latitudeDelta / 2 && Math.abs(a.lng - center.longitude) <= span.longitudeDelta / 2;
}

/** A tap on a grid bubble always zooms IN: the bubble's own neighbourhood, never wider than a third of the view. */
export function bubbleTapSpan(cell: number, latitudeDelta: number): number {
  return Math.min(cell * 2.2, latitudeDelta / 3);
}

/** The labels' total — the count pill's number. */
export const areasTotal = (rows: AreaRow[]): number => rows.reduce((a, r) => a + r.n, 0);

/** ONLY THE PLACES THAT MATTER AT THIS ZOOM (owner 2026-11-03, a country-view screenshot: «the numbers 1 … look a bit
 *  weird»). «الحزم 1», «يدمة 2», «طبرجل 8» sat beside «الرياض 98 ألف» and, by taking the space, hid Makkah, Buraidah
 *  and Taif. Like Zillow, a label shows only when it holds at least LABEL_SHARE of the biggest label in view (and never
 *  fewer than LABEL_MIN listings); smaller places appear as the user zooms in and the biggest in view gets smaller.
 *  Every listing still counts in the pill (areasTotal of ALL the areas, not just the drawn ones). */
export const LABEL_SHARE = 0.005;
export const LABEL_MIN = 10;
export function visibleAreas(rows: AreaRow[]): AreaRow[] {
  const max = rows.reduce((m, r) => Math.max(m, r.n), 0);
  const floor = Math.max(LABEL_MIN, max * LABEL_SHARE);
  return rows.filter((r) => r.n >= floor);
}

// ── THE LABELS FEED, FILTERED ON THE PHONE (owner 2026-11-03: «I want it to feel smooth»). Measured: each zoom waited
//    ~300-420 ms for the network although map_areas_ar() ran in 1 ms; map_areas_feed_ar() hands over every label once
//    ([is_city, city, district, lat, lng, n_buy, n_rent, n_short]) and these rules pick the ones in view.
export type AreaFeedRow = { isCity: boolean; city: string; district: string; lat: number; lng: number; buy: number; rent: number; short: number };

/** The feed's rows → labels. Anything that is not a well-formed row is dropped, never invented. */
export function parseAreasFeed(raw: unknown): AreaFeedRow[] {
  if (!Array.isArray(raw)) return [];
  const out: AreaFeedRow[] = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length < 8) continue;
    const [isCity, city, district, lat, lng, b, re, sh] = r as unknown[];
    if (typeof city !== 'string' || !city || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) continue;
    out.push({ isCity: isCity === true, city, district: typeof district === 'string' ? district : '', lat: Number(lat), lng: Number(lng),
      buy: Number(b) || 0, rent: Number(re) || 0, short: Number(sh) || 0 });
  }
  return out;
}

/** The labels of one level inside a box, counted for the chosen deals, biggest first — what map_areas_ar() returned. */
export function areasFromFeed(feed: AreaFeedRow[], level: AreaLevel, deals: string[], box: { s: number; w: number; n: number; e: number }, limit = 400): AreaRow[] {
  const want = { buy: deals.includes('buy'), rent: deals.includes('rent'), short: deals.includes('short') };
  const out: AreaRow[] = [];
  for (const a of feed) {
    if (a.isCity !== (level === 'city')) continue;
    if (a.lat < box.s || a.lat > box.n || a.lng < box.w || a.lng > box.e) continue;
    const n = (want.buy ? a.buy : 0) + (want.rent ? a.rent : 0) + (want.short ? a.short : 0);
    if (n > 0) out.push({ city: a.city, district: level === 'city' ? '' : a.district, lat: a.lat, lng: a.lng, n });
  }
  return out.sort((x, y) => y.n - x.n).slice(0, limit);
}

/** A close view estimated (from the dots feed) to hold more listings than this skips the exact read: it is crowded. */
export const CROWD_ESTIMATE = 1500;
