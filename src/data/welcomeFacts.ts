// Live facts for the Filter home's rotating welcome (src/lib/filterWelcome.ts).
//
// Every number is read from the same production sources the app already trusts — no number is ever
// typed into a line — and only the facts the CHOSEN line needs are fetched, once per app session:
//   sites      → loader_active_platforms_ar()  (websites with searchable listings — the logo strip's truth)
//   listings / cities / districts → loader_scale_stats_ar()   (the search loader's "big database" numbers)
//   regions, region counts, the user's city → top_cities_by_deal_ar(null)  (Trending's own city pool)
//   top district → district_options_ar(city)   (Trending districts, highest listing count first)
// Every read is bounded; any failure leaves that fact UNKNOWN, which makes the line unshowable and the
// normal subtitle stays. A failed fetch is never rendered as a zero (AGENTS.md: a failed fetch is not
// an empty answer).
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import { fetchLoaderScaleStats } from '@/data/loaderScaleStats';
import { translate } from '@/i18n';
import { cityNameEn, districtNameEn } from '@/data/locations';
import type { WelcomeFacts, WelcomeLine } from '@/lib/filterWelcome';

type CityRow = { city_id: number; city_ar: string; region_ar: string | null; listing_count: number };
type DistrictRow = { district_ar: string; listing_count: number };

const WELCOME_RPC_MS = 6000; // a welcome line is decoration: give up fast and keep the normal subtitle
const once = <T,>(fn: () => Promise<T | null>) => {
  let p: Promise<T | null> | null = null;
  return () => {
    if (!p) p = fn().then((v) => { if (v === null) p = null; return v; }); // a failure is not cached
    return p;
  };
};

const siteCount = once(async () => {
  if (!supabase) return null;
  const { data, error } = await boundedRpc<string[]>(supabase.rpc('loader_active_platforms_ar'), WELCOME_RPC_MS);
  return !error && Array.isArray(data) && data.length > 0 ? data.length : null;
});

const cityPool = once(async () => {
  if (!supabase) return null;
  const { data, error } = await boundedRpc<CityRow[]>(supabase.rpc('top_cities_by_deal_ar', { p_deal: null }), WELCOME_RPC_MS);
  return !error && Array.isArray(data) && data.length > 0 ? data : null;
});

const districtCache = new Map<number, Promise<DistrictRow | null>>();
function topDistrictOf(cityId: number): Promise<DistrictRow | null> {
  let p = districtCache.get(cityId);
  if (!p) {
    p = (async () => {
      if (!supabase) return null;
      const { data, error } = await boundedRpc<DistrictRow[]>(
        supabase.rpc('district_options_ar', { p_city_id: cityId, p_deal: null, p_category: null }), WELCOME_RPC_MS);
      if (error || !Array.isArray(data) || data.length === 0) return null;
      const top = [...data].sort((a, b) => Number(b.listing_count) - Number(a.listing_count))[0];
      return top && top.district_ar && Number(top.listing_count) > 0 ? top : null;
    })();
    p.then((v) => { if (v === null) districtCache.delete(cityId); });
    districtCache.set(cityId, p);
  }
  return p;
}

const stripCity = (s: string) => s.trim().replace(/^مدينة\s+/, '');

/** The user's most recent searched city, matched against the live pool; else the city with most listings. */
export function resolveCity(pool: CityRow[], lastLocation: string | null | undefined): CityRow | undefined {
  const parts = (lastLocation ?? '').split(/[,،]/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const ar = stripCity(translate('ar', part));
    const row = pool.find((c) => stripCity(c.city_ar) === ar);
    if (row) return row;
  }
  return [...pool].sort((a, b) => b.listing_count - a.listing_count)[0];
}

/** Fetch exactly the facts `line` states. Missing pieces stay undefined (→ the line is not shown). */
export async function loadWelcomeFacts(line: WelcomeLine, lastLocation: string | null | undefined): Promise<WelcomeFacts> {
  const f: WelcomeFacts = {};
  const needs = new Set(line.needs);
  const jobs: Promise<void>[] = [];
  if (needs.has('sites')) jobs.push(siteCount().then((n) => { if (n) f.sites = n; }));
  if (needs.has('listings') || needs.has('cities') || needs.has('districts')) {
    jobs.push(fetchLoaderScaleStats().then((s) => {
      if (!s) return;
      f.listings = s.listingCount; f.cities = s.cityCount; f.districts = s.districtCount;
    }).catch(() => {}));
  }
  const wantsPool = ['allRegions', 'city', 'district', 'riyadh', 'makkah', 'eastern', 'qassim'].some((k) => needs.has(k as never));
  if (wantsPool) {
    jobs.push((async () => {
      const pool = await cityPool();
      if (!pool) return;
      const regionCounts: Record<string, number> = {};
      for (const c of pool) if (c.region_ar && c.listing_count > 0) regionCounts[c.region_ar] = (regionCounts[c.region_ar] ?? 0) + c.listing_count;
      f.regionCounts = regionCounts;
      f.regions = Object.keys(regionCounts).length;
      if (needs.has('city') || needs.has('district')) {
        const row = resolveCity(pool, lastLocation);
        if (!row) return;
        // Official English names, the same ones the Filter home's own pickers show in the English UI.
        f.city = { ar: stripCity(row.city_ar), en: cityNameEn(row.city_id, row.city_ar), count: row.listing_count };
        if (needs.has('district')) {
          const d = await topDistrictOf(row.city_id);
          if (d) f.topDistrict = { ar: d.district_ar, en: districtNameEn(row.city_id, d.district_ar), count: Number(d.listing_count) };
        }
      }
    })().catch(() => {}));
  }
  await Promise.all(jobs);
  return f;
}
