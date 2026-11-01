// The numbers of THIS search for the loading rotation (lib/searchLoaderTitles.ts): the user's city
// and district with their live listing counts. Read from the same once-per-session caches the
// Filter home's personal headline already uses (data/welcomeFacts.ts) — the city pool is Trending's
// own `top_cities_by_deal_ar(null)`, the district ranking `district_options_ar(city)` — so the loader
// never adds a per-search round trip of its own (the 2026-09-21 lesson: a loader fetch competing
// with the query the user is waiting for), and the number it says is the number the headline says.
// Any failure leaves the fact undefined and the line is simply not shown.
import type { SearchQuery } from '@/data/search';
import { cityPool, topDistrictsOf, matchCity, findDistrictIndex } from '@/data/welcomeFacts';
import { cityNameEn, districtNameEn } from '@/data/locations';

export type FunnelPlace = { ar: string; en: string; count: number };
export type FunnelFacts = { city?: FunnelPlace; district?: FunnelPlace };

/** The one district a query names, if exactly one: the Filter's pick, or the agent's single district. */
export function queryDistrict(q: SearchQuery | null | undefined): string | null {
  if (!q) return null;
  const label = q.districtLabel?.trim();
  if (label) return label;
  const ds = (q.districts ?? []).map((d) => String(d).trim()).filter(Boolean);
  return ds.length === 1 ? ds[0] : null;
}

/** Changes only when the place the search names changes — the loader refetches on this, not on every render. */
export const funnelKey = (q: SearchQuery | null | undefined): string => `${q?.location ?? ''}|${queryDistrict(q) ?? ''}`;

export async function loadSearchFunnelFacts(q: SearchQuery | null | undefined): Promise<FunnelFacts> {
  const f: FunnelFacts = {};
  if (!q?.location) return f;
  const pool = await cityPool();
  if (!pool) return f;
  const row = matchCity(pool, q.location);
  if (!row || !(row.listing_count > 0)) return f;
  f.city = { ar: row.city_ar.replace(/^مدينة\s+/, ''), en: cityNameEn(row.city_id, row.city_ar), count: row.listing_count };
  const want = queryDistrict(q);
  if (!want) return f;
  const ds = await topDistrictsOf(row.city_id);
  if (!ds) return f;
  const i = findDistrictIndex(ds, row.city_id, want);
  if (i >= 0) f.district = { ar: ds[i].district_ar, en: districtNameEn(row.city_id, ds[i].district_ar), count: Number(ds[i].listing_count) };
  return f;
}
