// THE PIN THE IN-APP AD PAGE MAY DRAW (owner 2026-10-10).
//
// A map is drawn ONLY from the two coordinates the SOURCE published for that very ad —
// search_listings_ar.latitude / longitude, read by (source_table, listing_id). Never a district
// centroid, never a geocoded address, never one half of a pair: a pin we did not get from the source
// is a guess, and the label on the map says «as published by {site}». 27% of listings carry a pair
// today (wasalt 67%, aqar 0% — aqar's own pins come in a later step).
// The read is bounded (boundedRpc) and cached per ad for the session. A read that failed is NOT an
// empty answer: null here means «nothing to draw», which is the honest rendering of a pin we could not
// fetch — never an invented one — and the failure is forgotten so the next open retries.
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import type { Listing } from '@/data/listings';

export type GeoPoint = { lat: number; lng: number };

const num = (v: unknown): number =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;

/** The pin WE may draw from a source row (PostgREST hands numerics over as strings): both coordinates, or nothing. */
export function mapPoint(row: { latitude?: unknown; longitude?: unknown } | null | undefined): GeoPoint | null {
  if (!row) return null;
  const lat = num(row.latitude), lng = num(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // ponytail: a 0 on either axis is the classic unset default, not a Saudi address — treated as silent.
  if (lat === 0 || lng === 0) return null;
  return { lat, lng };
}

/** Google's keyless embed: satellite with labels (t=h), the app's language. z=14 shows the surrounding
 *  landmarks on the first screen; the full-screen view opens one step closer (15). */
export const mapEmbedUrl = (p: GeoPoint, hl: string = 'ar', z: 14 | 15 = 14) =>
  `https://maps.google.com/maps?q=${p.lat},${p.lng}&z=${z}&t=h&hl=${hl}&output=embed`;

const cache = new Map<string, Promise<GeoPoint | null>>();

/** The opened ad's own index row → its pin. One bounded read per ad per session. */
export function fetchAdPin(l: Pick<Listing, 'id' | 'sourceTable'>): Promise<GeoPoint | null> {
  if (!supabase || !l.sourceTable) return Promise.resolve(null);
  const key = `${l.sourceTable}:${l.id}`;
  let p = cache.get(key);
  if (!p) {
    p = boundedRpc<{ latitude: unknown; longitude: unknown }[]>(
      supabase.from('search_listings_ar').select('latitude,longitude').eq('source_table', l.sourceTable).eq('listing_id', l.id).limit(1),
    ).then(({ data, error }) => {
      if (error) { cache.delete(key); return null; }
      const own = data?.[0];
      const geo = mapPoint(own);
      return geo;
    });
    cache.set(key, p);
  }
  return p;
}
