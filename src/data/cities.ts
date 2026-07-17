import { supabase } from '@/lib/supabase';

// Cities-only search for the Filter form's City field (owner spec 2026-07-17). Backed entirely by
// the `search_cities_ar` RPC, which keys strictly on the real city_id/region_id from
// loc_catalog_city/loc_catalog_region — so two cities that share an Arabic name (confirmed live:
// الباحة, الهفوف, القويعية, ...) are always returned as distinct rows with their own region, never
// merged or guessed. Never matches districts, regions, or landmarks.
export type CityHit = {
  cityId: number;
  cityAr: string;
  regionId: number;
  regionAr: string;
  listingCount: number;
};

function mapRows(rows: any[] | null | undefined): CityHit[] {
  return (rows ?? []).map((r) => ({
    cityId: r.city_id,
    cityAr: r.city_ar,
    regionId: r.region_id,
    regionAr: r.region_ar,
    listingCount: Number(r.listing_count) || 0,
  }));
}

// Top 6 cities in Saudi Arabia by LIVE production-ready listing count — shown the instant the City
// field is focused with nothing typed yet. Cached briefly (city counts move slowly; no reason to
// hit the DB on every single focus event).
let _top6Cache: { data: CityHit[]; ts: number } | null = null;
const TOP6_TTL_MS = 5 * 60 * 1000;

export async function topCitiesAr(): Promise<CityHit[]> {
  if (_top6Cache && Date.now() - _top6Cache.ts < TOP6_TTL_MS) return _top6Cache.data;
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('search_cities_ar', { p_query: null, p_limit: 6 });
  if (error) return _top6Cache?.data ?? [];
  const hits = mapRows(data);
  _top6Cache = { data: hits, ts: Date.now() };
  return hits;
}

// Real-time cities-only autocomplete. Empty/whitespace query returns the same Top 6 as above (so
// clearing the field back to empty falls back to the same list a fresh focus would show).
export async function searchCitiesAr(query: string): Promise<CityHit[]> {
  const q = query.trim();
  if (!q) return topCitiesAr();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('search_cities_ar', { p_query: q, p_limit: 20 });
  if (error) return [];
  return mapRows(data);
}
