// THE PURE HALF OF THE MAP FILTER POPUP (owner 2026-11-02): the popup's state → the pin query's narrowing. Import-free
// (like src/lib/rentPool.ts) so scripts/verify-map-pins-every-listing.ts can execute it under plain Node; the group →
// Arabic type labels mapping is injected by the caller (typeArForTypes from src/data/propertyTypes.ts). The tiles
// themselves live in src/components/MapFilterCard.tsx.
import type { PinFilter } from './mapPins';

export type MapFilterState = {
  category: 'Residential' | 'Commercial' | null;
  groups: string[];
  beds: ('1' | '2' | '3' | '4' | '5+')[];
  areaMin: string; areaMax: string;
  priceMin: string; priceMax: string;
};
export const EMPTY_MAP_FILTER: MapFilterState = { category: null, groups: [], beds: [], areaMin: '', areaMax: '', priceMin: '', priceMax: '' };

export const digits = (v: string): string => v.replace(/[^\d]/g, '').slice(0, 10);
export const num = (v: string): number | null => { const d = digits(v); const n = Number(d); return d && Number.isFinite(n) && n > 0 ? n : null; };

/** The filter state → the pin query's narrowing (every untouched field = null = not narrowed). */
export function pinFilterOf(f: MapFilterState, typeAr: (groups: string[]) => string[] | null): Omit<PinFilter, 'deals' | 'poly'> {
  const beds: number[] = [];
  for (const b of f.beds) { if (b === '5+') beds.push(5, 6, 7, 8, 9, 10, 11, 12); else beds.push(Number(b)); }
  return {
    category: f.category === 'Residential' ? 'residential' : f.category === 'Commercial' ? 'commercial' : null,
    types: f.groups.length ? typeAr(f.groups) : null,
    beds: beds.length ? beds : null,
    areaMin: num(f.areaMin), areaMax: num(f.areaMax),
    priceMin: num(f.priceMin), priceMax: num(f.priceMax),
  };
}
export const isNarrowed = (f: MapFilterState): boolean => !!(f.category || f.groups.length || f.beds.length || num(f.areaMin) || num(f.areaMax) || num(f.priceMin) || num(f.priceMax));
