import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import { placeOnly } from '@/lib/shelfCheck';
import type { SearchQuery } from './search';

// THE NOTEBOOK (owner 2026-10-05). Every «no results» a real user is shown is written down so the
// nightly 🔧 Quality & Repair engineer can re-check it against the database and fix any that was not
// true. Place + structured filters only — never free text (keywords/proximity are only flagged), never
// who searched. Best-effort like trackClick: it never delays or breaks the search.
const FILTERS = ['type', 'types', 'typeGroups', 'detail', 'priceInput', 'priceBand', 'priceMin', 'priceMax',
  'priceMinRent', 'priceMaxRent', 'rentPeriod', 'contextBeds', 'contextBedsList', 'contextSize', 'areaMin',
  'areaMax', 'ageMin', 'ageMax', 'ageBuckets', 'isNewConstruction', 'amenities', 'bathMin', 'ratingMin',
  'ratingBuckets', 'reviewsMin', 'unitSubtypes', 'furnishedPref', 'furnishedIn', 'streetWidthMin', 'directions',
  'sources'] as const;

export function logZeroResult(q: SearchQuery, shelf: number | null, clash: boolean): void {
  if (!supabase) return;
  const lm = q.locationMatch;
  const filters: Record<string, unknown> = {};
  for (const k of FILTERS) {
    const v = q[k];
    if (!(v == null || v === '' || (Array.isArray(v) && v.length === 0))) filters[k] = v;
  }
  const entry = {
    place: (lm?.label || q.location || '').slice(0, 80),
    kind: lm?.kind ?? null,
    exact: lm?.exact === true,
    city: lm?.city || null,
    cities: (lm?.cities ?? []).slice(0, 6),
    districts: (q.districts ?? []).slice(0, 20),
    deal: q.bothDeals ? 'any' : q.dealCombined ? 'combined' : q.deal,
    category: q.category,
    filters,
    af: (q.afFacets ?? []).map((f) => ({ id: f.id, keys: f.keys })),
    has_keywords: !!q.keywords?.length,
    place_only: placeOnly(q),
    shelf,
    clash,
    // Our own CI journeys (Playwright sets navigator.webdriver) probe honest zeros on purpose — e.g.
    // a 999,000,000-riyal price. Kept, but tagged, so the nightly 🔧 re-check reads real users first.
    robot: typeof navigator !== 'undefined' && !!(navigator as { webdriver?: boolean }).webdriver,
  };
  boundedRpc(supabase.rpc('log_zero_result', { p_entry: entry })).then(() => {}, () => {});
}
