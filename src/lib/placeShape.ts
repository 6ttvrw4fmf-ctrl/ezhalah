// THE PURE HALF OF src/data/placeShape.ts — no imports, so the barrier can EXECUTE it under plain Node
// (scripts/verify-map-area-pick-draws-real-boundary.ts). The fetch lives next door; this file only reads an answer.
export type ShapeKind = 'district' | 'city' | 'region';
/** GeoJSON MultiPolygon coordinates: [polygon][ring][point] with each point [lng, lat]. */
export type ShapeRings = number[][][][];
export type PlaceShape = { nameAr: string | null; nameEn: string | null; rings: ShapeRings; bbox: { n: number; s: number; e: number; w: number } };
export type ShapeRow = { name_ar: string | null; name_en: string | null; kind: string; geojson: string };

/** Pure: the RPC's `{ data, error }` → a shape, `null` (known: no shape there) or `'unknown'` (the fetch failed). */
export function placeShapeFrom(result: { data: ShapeRow[] | null; error: unknown }): PlaceShape | null | 'unknown' {
  if (result.error || !Array.isArray(result.data)) return 'unknown';
  const row = result.data[0];
  if (!row) return null;
  let rings: ShapeRings;
  try {
    const g = JSON.parse(row.geojson) as { type: string; coordinates: unknown };
    if (g.type === 'MultiPolygon') rings = g.coordinates as ShapeRings;
    else if (g.type === 'Polygon') rings = [g.coordinates as number[][][]];
    else return 'unknown';
  } catch {
    return 'unknown';
  }
  let n = -90, s = 90, e = -180, w = 180, pts = 0;
  for (const poly of rings) for (const [lng, lat] of poly[0] ?? []) { pts++; if (lat > n) n = lat; if (lat < s) s = lat; if (lng > e) e = lng; if (lng < w) w = lng; }
  if (pts < 3) return 'unknown';
  return { nameAr: row.name_ar, nameEn: row.name_en, rings, bbox: { n, s, e, w } };
}

