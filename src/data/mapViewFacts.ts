// The map pill's second line (src/lib/mapViewFacts.ts decides what may be said): one bounded read of
// map_view_facts_ar() for exactly the box and choices the pill's count uses (postedCountArgs, the «نشر خلال» menu's
// arguments). null when the read failed — the line then stays hidden, never «0».
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import { reportError, reportMessage } from '@/lib/observability';
import { postedCountArgs, type PinFilter } from '@/lib/mapPins';
import { parseViewFacts, type ViewFacts } from '@/lib/mapViewFacts';
import type { PlaceFactsKey } from '@/lib/mapAreas';

const CACHE_MS = 120_000;
const CACHE_MAX = 40;
const recent = new Map<string, { at: number; f: ViewFacts }>();
// the same view asked twice while its read is still out (the map asks as soon as it moves, then again once the count
// lands) shares ONE read — the box appears when that read does, never after a second one
const inflight = new Map<string, Promise<ViewFacts | null>>();

export function fetchViewFacts(box: { s: number; w: number; n: number; e: number }, filter: PinFilter, signedIn: boolean): Promise<ViewFacts | null> {
  if (!supabase) return Promise.resolve(null);
  const args = postedCountArgs(box, filter);
  const key = `${signedIn ? 'u' : 'g'}|${JSON.stringify(args)}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.f);
  const out = inflight.get(key);
  if (out) return out;
  const p = readViewFacts(args, key).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function readViewFacts(args: ReturnType<typeof postedCountArgs>, key: string): Promise<ViewFacts | null> {
  if (!supabase) return null;
  try {
    const result = await boundedRpc<unknown>(supabase.rpc('map_view_facts_ar', args));
    const { error } = result as { error: unknown };
    if (error) { reportMessage('map_view_facts_ar failed (map pill second line hidden)', { error: String((error as { message?: string }).message ?? error) }); return null; }
    const f = parseViewFacts(result as { data: unknown; error: unknown });
    if (f) {
      recent.delete(key); recent.set(key, { at: Date.now(), f });
      if (recent.size > CACHE_MAX) recent.delete(recent.keys().next().value as string);
    }
    return f;
  } catch (e) {
    reportError(e, { where: 'map box facts (map_view_facts_ar)' });
    return null;
  }
}

/** The prepared facts of the city or district the pill names at area-label zoom (map_place_facts_ar). null when the read
 *  failed, the facts are stale or switched off, or the deal is not exactly one — the box then stays hidden, never «0». */
export async function fetchPlaceFacts(place: PlaceFactsKey, deals: string[], signedIn: boolean): Promise<ViewFacts | null> {
  if (!supabase || deals.length !== 1) return null;
  // the districts on screen (the pill names their city but counts only them): their facts summed on the server
  const fn = place.level === 'districts' ? 'map_place_facts_sum_ar' : 'map_place_facts_ar';
  const args = place.level === 'districts'
    ? { p_city: place.city, p_districts: [...new Set(place.districts ?? [])].sort(), p_deals: deals }
    : { p_level: place.level, p_city: place.city, p_district: place.district || null, p_deals: deals };
  const key = `${signedIn ? 'u' : 'g'}|${fn}|${JSON.stringify(args)}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.f;
  try {
    const result = await boundedRpc<unknown>(supabase.rpc(fn, args));
    const { error } = result as { error: unknown };
    if (error) { reportMessage(`${fn} failed (map box hidden at label zoom)`, { error: String((error as { message?: string }).message ?? error) }); return null; }
    const f = parseViewFacts(result as { data: unknown; error: unknown });
    if (f) {
      recent.delete(key); recent.set(key, { at: Date.now(), f });
      if (recent.size > CACHE_MAX) recent.delete(recent.keys().next().value as string);
    }
    return f;
  } catch (e) {
    reportError(e, { where: 'map box place facts (map_place_facts_ar)' });
    return null;
  }
}
