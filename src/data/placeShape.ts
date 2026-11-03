// THE REAL SHAPE OF A PICKED AREA (owner 2026-11-01: «create a boundary around it, don't make just a square
// boundary, it's like area»). When the map search picks a district, a city or a region, the map draws the place's
// actual boundary — OpenStreetMap's polygon, served by `place_shape_at()` from `public.place_shapes` — instead of
// Apple's bounding rectangle. The rectangle is only the fallback when no shape exists for that point.
//
// ONE read per pick, by COORDINATE, never by name: the RPC returns the smallest shape of the asked kind that
// contains the picked point, so Apple's spelling of the name and OSM's never have to agree.
//
// A FAILED FETCH IS NOT AN EMPTY ANSWER: `placeShapeFrom()` tells `'unknown'` (the request failed or timed out)
// apart from `null` (the point is inside no shape of that kind). The caller draws the rectangle in both cases —
// the map must never show nothing — but the two are distinct values so nothing upstream can mistake one for the other.
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import { placeShapeFrom, type PlaceShape, type ShapeKind, type ShapeRow } from '@/lib/placeShape';

export { placeShapeFrom, type PlaceShape, type ShapeKind, type ShapeRings } from '@/lib/placeShape';

/** The shape of the `kind` area that contains the point, bounded by the app's one RPC timeout. */
export async function placeShapeAt(lat: number, lng: number, kind: ShapeKind, name?: string): Promise<PlaceShape | null | 'unknown'> {
  if (!supabase) return 'unknown';
  try {
    const result = await boundedRpc<ShapeRow[]>(supabase.rpc('place_shape_at', { p_lat: lat, p_lng: lng, p_kind: kind, p_name: name ?? null }));
    return placeShapeFrom(result);
  } catch {
    return 'unknown';
  }
}
