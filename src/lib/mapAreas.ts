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
  return level === 'city' ? 0.4 : 0.045;
}

/** The labels' total — the count pill's number. */
export const areasTotal = (rows: AreaRow[]): number => rows.reduce((a, r) => a + r.n, 0);
