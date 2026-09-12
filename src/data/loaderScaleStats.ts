// RUNTIME truth source for the "big database" numbers baked into the search-loading copy
// (SearchLoader.tsx). Owner 2026-09-12: "those things are more like marketing... people would be
// like wow, this has a big database" — total searchable listings + distinct cities/districts,
// pulled live so the numbers grow on their own as the database grows. Same shape and same
// safe-degradation contract as loaderActivePlatforms.ts (this file's sibling for the platform count):
// resolve once, return null on any failure, and the caller falls back to the plain (numberless)
// copy rather than showing a stale or fabricated number.

import { supabase } from '@/lib/supabase';

export type LoaderScaleStats = {
  listingCount: number;
  cityCount: number;
  districtCount: number;
};

export async function fetchLoaderScaleStats(): Promise<LoaderScaleStats | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('loader_scale_stats_ar');
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row) return null;
    const listingCount = Number(row.listing_count);
    const cityCount = Number(row.city_count);
    const districtCount = Number(row.district_count);
    if (!Number.isFinite(listingCount) || !Number.isFinite(cityCount) || !Number.isFinite(districtCount)) return null;
    return { listingCount, cityCount, districtCount };
  } catch {
    return null;
  }
}
