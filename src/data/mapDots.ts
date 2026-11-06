// THE DOTS FEED, ONCE PER SESSION (owner 2026-11-02: «even when I am zoomed out they all show»). One bounded read of
// map_dots_ar() — every pinned listing's 1 km cell with its deal and count (~23k rows, ~150 KB brotli) — cached in
// memory; the map paints the ones in view on a canvas. A failed read is 'unknown' (the caller keeps the live grid
// path, never an empty map), and is retried on the next ask.
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import { parseDots, type MapDot } from '@/lib/mapDots';

export { bubblesFromDots, dotsInView, dotsTotal, dotsEstimateInBox, projectorFrom, dotRadius, nearestDot, mercY, parseDots, type MapDot } from '@/lib/mapDots';

let cache: MapDot[] | null = null;
let inflight: Promise<MapDot[] | 'unknown'> | null = null;

export function fetchMapDots(): Promise<MapDot[] | 'unknown'> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  if (!supabase) return Promise.resolve('unknown');
  inflight = (async () => {
    try {
      const { data, error } = await boundedRpc<unknown>(supabase.rpc('map_dots_ar'), 20_000);
      if (error || data == null) return 'unknown';
      const dots = parseDots(data);
      if (!dots.length) return 'unknown';   // an empty feed is a failed build, never «no listings anywhere»
      cache = dots;
      return dots;
    } catch {
      return 'unknown';
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
