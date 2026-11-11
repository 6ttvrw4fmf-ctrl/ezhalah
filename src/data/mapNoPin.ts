// THE DISTRICT MARKERS INSIDE THE VISIBLE MAP (owner 2026-11-09): one bounded read of map_nopin_markers_ar() per view
// change from district zoom inward — one row per district whose centre is in view, with the count of its listings
// that have no exact location and their card ids. The pure rules live in src/lib/mapNoPin.ts so the barrier can
// execute them; the drawing is in src/components/AppleMap.web.tsx.
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import { noPinArgs, noPinFrom, type NoPinRow } from '@/lib/mapNoPin';
import type { PinFilter } from '@/lib/mapPins';

export { NO_PIN_COLOR, noPinTag, noPinHead, showNoPin, noPinPinRow, noPinKey, isNoPinKey, type NoPinRow } from '@/lib/mapNoPin';

// Recent views are remembered for two minutes, like the pins (src/data/mapPins.ts). Only successful reads are kept.
const CACHE_MS = 120_000;
const CACHE_MAX = 40;
const recent = new Map<string, { at: number; rows: NoPinRow[] }>();

/** The district markers for one view. 'unknown' when the fetch failed — the caller keeps what it has. */
export async function fetchMapNoPin(box: { s: number; w: number; n: number; e: number }, filter: PinFilter): Promise<NoPinRow[] | 'unknown'> {
  if (!supabase) return 'unknown';
  const args = noPinArgs(box, filter);
  const key = JSON.stringify(args);
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  try {
    const result = await boundedRpc<NoPinRow[]>(supabase.rpc('map_nopin_markers_ar', args));
    const rows = noPinFrom(result);
    if (rows !== 'unknown') {
      recent.delete(key); recent.set(key, { at: Date.now(), rows });
      if (recent.size > CACHE_MAX) recent.delete(recent.keys().next().value as string);
    }
    return rows;
  } catch {
    return 'unknown';
  }
}
