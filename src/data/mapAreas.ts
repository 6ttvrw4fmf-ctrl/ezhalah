// CITY / DISTRICT LABELS INSIDE THE VISIBLE MAP: one bounded read of map_areas_ar() (precomputed hourly in map_area_ar)
// per settled view. A failed read is 'unknown' — the caller keeps its other path, never an empty map.
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import type { AreaLevel, AreaRow } from '@/lib/mapAreas';

export { areaLevelFor, areaCount, areaName, areaZoomSpan, areasTotal, denseShowsDistricts, type AreaLevel, type AreaRow } from '@/lib/mapAreas';

export async function fetchMapAreas(box: { s: number; w: number; n: number; e: number }, level: AreaLevel, deals: string[]): Promise<AreaRow[] | 'unknown'> {
  if (!supabase) return 'unknown';
  try {
    const { data, error } = await boundedRpc<AreaRow[]>(supabase.rpc('map_areas_ar', {
      p_s: box.s, p_w: box.w, p_n: box.n, p_e: box.e, p_level: level, p_deals: deals.length === 3 ? null : deals, p_limit: 400,
    }));
    if (error || !Array.isArray(data)) return 'unknown';
    return data.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng) && r.n > 0);
  } catch {
    return 'unknown';
  }
}
