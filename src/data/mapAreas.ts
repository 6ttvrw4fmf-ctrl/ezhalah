// CITY / DISTRICT LABELS INSIDE THE VISIBLE MAP: one bounded read of map_areas_ar() (precomputed hourly in map_area_ar)
// per settled view. A failed read is 'unknown' — the caller keeps its other path, never an empty map.
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import { parseAreasFeed, areasFromFeed, COUNTRY_CENTER, COUNTRY_NAME, type AreaFeedRow, type AreaLevel, type AreaRow } from '@/lib/mapAreas';

export { CROWD_ESTIMATE, visibleAreas, areaLevelFor, areaLevelShown, COUNTRY_BOX, areaCount, areaName, areaZoomSpan, areasTotal, denseShowsDistricts, bubbleTapSpan, inView, COUNTRY_NAME, COUNTRY_CENTER, areaPlaceName, areaPlace, type AreaLevel, type AreaRow } from '@/lib/mapAreas';

// The labels feed, once per visit (map_areas_feed_ar(), ~5.7k labels, ~70 KB brotli). A failed read is retried on the
// next ask and the per-view RPC below answers meanwhile — never an empty map.
let feed: AreaFeedRow[] | null = null;
let feedInflight: Promise<AreaFeedRow[] | null> | null = null;
export function fetchAreasFeed(): Promise<AreaFeedRow[] | null> {
  if (feed) return Promise.resolve(feed);
  if (feedInflight) return feedInflight;
  if (!supabase) return Promise.resolve(null);
  feedInflight = (async () => {
    try {
      const { data, error } = await boundedRpc<unknown>(supabase.rpc('map_areas_feed_ar'), 20_000);
      if (error || data == null) return null;
      const rows = parseAreasFeed(data);
      if (!rows.length) return null;   // an empty feed is a failed build, never «no labels anywhere»
      feed = rows;
      return rows;
    } catch {
      return null;
    } finally {
      feedInflight = null;
    }
  })();
  return feedInflight;
}

export async function fetchMapAreas(box: { s: number; w: number; n: number; e: number }, level: AreaLevel, deals: string[]): Promise<AreaRow[] | 'unknown'> {
  const local = await fetchAreasFeed();
  if (local) return areasFromFeed(local, level, deals, box, 400);
  if (!supabase) return 'unknown';
  try {
    // The per-view read knows cities and districts only: a region view shows its cities, the country view sums them.
    // Region views read up to 1000 cities, like the country, so the opening view (regions since 2026-11-09) is never cut.
    const ask = level === 'country' || level === 'region' ? 'city' : level;
    const { data, error } = await boundedRpc<AreaRow[]>(supabase.rpc('map_areas_ar', {
      p_s: box.s, p_w: box.w, p_n: box.n, p_e: box.e, p_level: ask, p_deals: deals.length === 3 ? null : deals, p_limit: level === 'country' || level === 'region' ? 1000 : 400,
    }));
    if (error || !Array.isArray(data)) return 'unknown';
    const rows = data.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng) && r.n > 0);
    if (level !== 'country') return rows;
    const n = rows.reduce((t, r) => t + r.n, 0);
    return n > 0 ? [{ city: COUNTRY_NAME.ar, district: '', lat: COUNTRY_CENTER.lat, lng: COUNTRY_CENTER.lng, n }] : [];
  } catch {
    return 'unknown';
  }
}
