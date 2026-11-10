// THE PURE HALF OF THE MAP FILTER POPUP (owner 2026-11-02): the popup's state → the pin query's narrowing. Import-free
// (like src/lib/rentPool.ts) so scripts/verify-map-pins-every-listing.ts can execute it under plain Node; the group →
// Arabic type labels mapping is injected by the caller (typeArForTypes from src/data/propertyTypes.ts). The tiles
// themselves live in src/components/MapFilterCard.tsx.
import type { PinFilter } from './mapPins';

export type MapFilterState = {
  category: 'Residential' | 'Commercial' | null;
  groups: string[];
  /** Exact property types inside the chosen groups (owner 2026-11-10: «no property type, just group — looks wrong»). */
  types: string[];
  beds: ('1' | '2' | '3' | '4' | '5+')[];
  /** «الأثاث» — the Filter home's row, copied (owner 2026-11-10): true furnished, false unfurnished, null all. */
  furnished: boolean | null;
  areaMin: string; areaMax: string;
  priceMin: string; priceMax: string;
};
export const EMPTY_MAP_FILTER: MapFilterState = { category: null, groups: [], types: [], beds: [], furnished: null, areaMin: '', areaMax: '', priceMin: '', priceMax: '' };

export const digits = (v: string): string => v.replace(/[^\d]/g, '').slice(0, 10);
export const num = (v: string): number | null => { const d = digits(v); const n = Number(d); return d && Number.isFinite(n) && n > 0 ? n : null; };

/** The filter state → the pin query's narrowing (every untouched field = null = not narrowed). */
/** What the type filter asks for: a group with types picked narrows to those types; a group with none stays whole
 *  (like the Filter home: the type is the exact choice, the group the broad one). `members` lists a group's types. */
export function typeSelection(f: Pick<MapFilterState, 'groups' | 'types'>, members: (group: string) => string[]): string[] {
  const types = f.types ?? [];
  const out: string[] = [];
  for (const g of f.groups) {
    const picked = members(g).filter((t) => types.includes(t));
    if (picked.length) out.push(...picked); else out.push(g);
  }
  return out;
}

/** «الأثاث» applies where the Filter home offers it: yearly rent homes — the map on «إيجار» alone, «سكني». Anywhere
 *  else the choice is dropped, so a hidden row never narrows the pins. */
export const furnitureOffered = (deals: readonly string[], category: MapFilterState['category']): boolean =>
  deals.length === 1 && deals[0] === 'rent' && category === 'Residential';

export function pinFilterOf(f: MapFilterState, typeAr: (groups: string[]) => string[] | null, members: (group: string) => string[] = () => [], deals: readonly string[] = []): Omit<PinFilter, 'deals' | 'poly'> {
  const beds: number[] = [];
  for (const b of f.beds) { if (b === '5+') beds.push(5, 6, 7, 8, 9, 10, 11, 12); else beds.push(Number(b)); }
  return {
    category: f.category === 'Residential' ? 'residential' : f.category === 'Commercial' ? 'commercial' : null,
    types: f.groups.length ? typeAr(typeSelection(f, members)) : null,
    beds: beds.length ? beds : null,
    areaMin: num(f.areaMin), areaMax: num(f.areaMax),
    priceMin: num(f.priceMin), priceMax: num(f.priceMax),
    furnished: f.furnished != null && furnitureOffered(deals, f.category) ? f.furnished : null,
  };
}
export const isNarrowed = (f: MapFilterState): boolean => !!(f.category || f.groups.length || (f.types ?? []).length || f.furnished != null || f.beds.length || num(f.areaMin) || num(f.areaMax) || num(f.priceMin) || num(f.priceMax));
