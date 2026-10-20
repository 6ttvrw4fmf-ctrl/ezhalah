// Live facts for the Filter home's rotating welcome (src/lib/filterWelcome.ts).
//
// Every number is read from the same production sources the app already trusts — no number is ever
// typed into a line — and only the facts the CHOSEN line needs are fetched, once per app session:
//   sites      → loader_active_platforms_ar() folded to one per platform (src/data/siteCount.ts — the card's number)
//   listings / cities / districts → loader_scale_stats_ar()   (the search loader's "big database" numbers)
//   regions, region counts, the user's city → top_cities_by_deal_ar(null)  (Trending's own city pool)
//   top district → district_options_ar(city)   (Trending districts, highest listing count first)
// Every read is bounded; any failure leaves that fact UNKNOWN, which makes the line unshowable and the
// normal subtitle stays. A failed fetch is never rendered as a zero (AGENTS.md: a failed fetch is not
// an empty answer).
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import { fetchLoaderScaleStats } from '@/data/loaderScaleStats';
import { loadSiteCount } from '@/data/siteCount';
import { translate } from '@/i18n';
import { cityNameEn, districtNameEn } from '@/data/locations';
import type { WelcomeFacts, WelcomeLine } from '@/lib/filterWelcome';

type CityRow = { city_id: number; city_ar: string; region_ar: string | null; listing_count: number };
type DistrictRow = { district_ar: string; listing_count: number; match_values?: string[] | null };

const WELCOME_RPC_MS = 6000; // a welcome line is decoration: give up fast and keep the normal subtitle
const once = <T,>(fn: () => Promise<T | null>) => {
  let p: Promise<T | null> | null = null;
  return () => {
    if (!p) p = fn().then((v) => { if (v === null) p = null; return v; }); // a failure is not cached
    return p;
  };
};

// The sites count is the shared one (src/data/siteCount.ts): one per PLATFORM, the number the WhatsApp
// card and the share sentence show — this used to count raw slugs (149 while the card said 148).
const siteCount = loadSiteCount;

const newToday = once(async () => {
  if (!supabase) return null;
  const { data, error } = await boundedRpc<number | string>(supabase.rpc('welcome_new_today_ar'), WELCOME_RPC_MS);
  const n = Number(data);
  return !error && Number.isFinite(n) && n > 0 ? n : null;
});

export const cityPool = once(async () => {
  if (!supabase) return null;
  const { data, error } = await boundedRpc<CityRow[]>(supabase.rpc('top_cities_by_deal_ar', { p_deal: null }), WELCOME_RPC_MS);
  return !error && Array.isArray(data) && data.length > 0 ? data : null;
});

const districtCache = new Map<number, Promise<DistrictRow[] | null>>();
/** The city's districts, most listings first (Trending's own ranking). */
export function topDistrictsOf(cityId: number): Promise<DistrictRow[] | null> {
  let p = districtCache.get(cityId);
  if (!p) {
    p = (async () => {
      if (!supabase) return null;
      const { data, error } = await boundedRpc<DistrictRow[]>(
        supabase.rpc('district_options_ar', { p_city_id: cityId, p_deal: null, p_category: null }), WELCOME_RPC_MS);
      if (error || !Array.isArray(data) || data.length === 0) return null;
      const ranked = [...data]
        .filter((d) => d.district_ar && Number(d.listing_count) > 0)
        .sort((a, b) => Number(b.listing_count) - Number(a.listing_count));
      return ranked.length ? ranked : null;
    })();
    p.then((v) => { if (v === null) districtCache.delete(cityId); });
    districtCache.set(cityId, p);
  }
  return p;
}

const stripCity = (s: string) => s.trim().replace(/^مدينة\s+/, '');
// Loose Arabic place key: no «حي», no «ال», unified alif / ta-marbuta / ya, no spaces — «حي النرجس» = «النرجس».
export const placeKey = (s: string) => s.trim().replace(/^حي\s+/, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه')
  .replace(/ى/g, 'ي').replace(/^ال/, '').replace(/\s+/g, '').toLowerCase();

/** A location string's city, matched STRICTLY against the live pool (Arabic or canonical English name); else undefined. */
export function matchCity(pool: CityRow[], location: string | null | undefined): CityRow | undefined {
  const parts = (location ?? '').split(/[,،]/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const ar = stripCity(translate('ar', part));
    const row = pool.find((c) => stripCity(c.city_ar) === ar);
    if (row) return row;
  }
  return undefined;
}

/** The user's most recent searched city, matched against the live pool; else the city with most listings. */
export function resolveCity(pool: CityRow[], lastLocation: string | null | undefined): CityRow | undefined {
  return matchCity(pool, lastLocation) ?? [...pool].sort((a, b) => b.listing_count - a.listing_count)[0];
}

/** Where a named district sits in a city's live ranking (Arabic key, any raw spelling, or the official English name); -1 if absent. */
export function findDistrictIndex(ds: DistrictRow[], cityId: number, name: string): number {
  const want = placeKey(translate('ar', name));
  const wantEn = name.trim().toLowerCase();
  return ds.findIndex((d) => placeKey(d.district_ar) === want
    || (d.match_values ?? []).some((m) => placeKey(m) === want)
    || districtNameEn(cityId, d.district_ar).trim().toLowerCase() === wantEn);
}

/** Fetch exactly the facts `line` states. Missing pieces stay undefined (→ the line is not shown). */
export async function loadWelcomeFacts(line: WelcomeLine, lastLocation: string | null | undefined, lastDistrict?: string | null): Promise<WelcomeFacts> {
  const f: WelcomeFacts = {};
  const needs = new Set(line.needs);
  const jobs: Promise<void>[] = [];
  if (needs.has('sites')) jobs.push(siteCount().then((n) => { if (n) f.sites = n; }));
  if (needs.has('newToday')) jobs.push(newToday().then((n) => { if (n) f.newToday = n; }));
  if (needs.has('listings') || needs.has('cities') || needs.has('districts')) {
    jobs.push(fetchLoaderScaleStats().then((s) => {
      if (!s) return;
      f.listings = s.listingCount; f.cities = s.cityCount; f.districts = s.districtCount;
    }).catch(() => {}));
  }
  const wantsMine = needs.has('myDistrict') || needs.has('myTop10');
  const wantsPool = wantsMine || ['allRegions', 'city', 'district', 'district3', 'rank', 'riyadhShare', 'top2', 'riyadh', 'makkah', 'eastern', 'qassim'].some((k) => needs.has(k as never));
  if (wantsPool) {
    jobs.push((async () => {
      const pool = await cityPool();
      if (!pool) return;
      const regionCounts: Record<string, number> = {};
      for (const c of pool) if (c.region_ar && c.listing_count > 0) regionCounts[c.region_ar] = (regionCounts[c.region_ar] ?? 0) + c.listing_count;
      f.regionCounts = regionCounts;
      f.regions = Object.keys(regionCounts).length;
      const ranked = [...pool].filter((c) => c.listing_count > 0).sort((a, b) => b.listing_count - a.listing_count);
      if (needs.has('top2')) {
        f.topCities = ranked.slice(0, 2).map((c) => ({ ar: stripCity(c.city_ar), en: cityNameEn(c.city_id, c.city_ar), count: c.listing_count }));
      }
      if (needs.has('city') || needs.has('district') || needs.has('district3') || wantsMine) {
        const row = resolveCity(pool, lastLocation);
        if (!row) return;
        // Official English names, the same ones the Filter home's own pickers show in the English UI.
        f.city = { ar: stripCity(row.city_ar), en: cityNameEn(row.city_id, row.city_ar), count: row.listing_count };
        const pos = ranked.findIndex((c) => c.city_id === row.city_id);
        if (pos >= 0) f.cityRank = pos + 1;
        if (needs.has('district') || needs.has('district3') || wantsMine) {
          const ds = await topDistrictsOf(row.city_id);
          if (ds && wantsMine && lastDistrict) {
            // The user's own district, found in the city's LIVE ranking (rank = its position by listings).
            const i = findDistrictIndex(ds, row.city_id, lastDistrict);
            if (i >= 0) f.myDistrict = { ar: ds[i].district_ar, en: districtNameEn(row.city_id, ds[i].district_ar), count: Number(ds[i].listing_count), rank: i + 1 };
          }
          if (ds) {
            const shaped = ds.map((d) => ({ ar: d.district_ar, en: districtNameEn(row.city_id, d.district_ar), count: Number(d.listing_count) }));
            f.topDistrict = shaped[0];
            f.topDistricts = shaped.slice(0, 3);
          }
        }
      }
    })().catch(() => {}));
  }
  await Promise.all(jobs);
  return f;
}
