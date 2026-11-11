// IS THIS PLACE IN SAUDI ARABIA? (owner 2026-11-11: «the search on top should only get Saudi»). Apple's map search is
// asked for Saudi places only (limitToCountries: 'SA'), but that is a hint Apple may not keep. Every suggestion is also
// checked against the Kingdom's own outline (public/ksa-outline.json, the 13 regions merged and grown ~4 km so no coast
// or border town falls outside). Rings are [lng, lat] points, as in the file.
export type Ring = [number, number][];

function inRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when the point lies inside any ring of the outline. */
export function inSaudi(lat: number, lng: number, rings: Ring[]): boolean {
  return rings.some((r) => inRing([lng, lat], r));
}

/** Only the places inside the Kingdom. With no outline (it failed to load) Apple's own Saudi-only answer stands. */
export function keepSaudiPlaces<T extends { coordinate?: { latitude: number; longitude: number } }>(rows: T[], rings: Ring[] | null): T[] {
  if (!rings || !rings.length) return rows;
  return rows.filter((r) => r.coordinate && inSaudi(r.coordinate.latitude, r.coordinate.longitude, rings));
}
