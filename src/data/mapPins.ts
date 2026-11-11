// THE PINS INSIDE THE VISIBLE MAP (owner 2026-11-02): one bounded read of map_pins_ar() per view change, never the
// whole index. Exact points from city zoom inward (every listing on identical coordinates folded into one row with
// its count and ids), count cells when zoomed out. The pure rules — colours, the price head, the zoom→cell rule,
// the RPC arguments — live in src/lib/mapPins.ts so the barrier can execute them.
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import { pinsFrom, rpcArgs, type PinFilter, type PinRow, type ViewPlace } from '@/lib/mapPins';

export { cellForSpan, fineCellForSpan, bubblesCanZoomIn, PIN_LIMIT, PIN_SHOW_MAX, PIN_COLOR, PIN_PAD_PX, paddedBox, pinColor, dotColor, pinHead, isFreshHead, freshTag, bubbleText, polygonOf, idsByTable, orderLike, placeApart, pinAnchorOffset, pinStemTo, pinWidthGuess, viewPlaceName, viewCountText, type PinFilter, type PinRow, type ViewPlace } from '@/lib/mapPins';

/** The pins (or count cells) for one view. 'unknown' when the fetch failed — the caller keeps what it has. */
// RECENT VIEWS ARE REMEMBERED (owner 2026-11-03: «I want it to feel smooth»): a pan or zoom back to a view read in the
// last two minutes answers from memory, no network wait. Only successful reads are kept.
const CACHE_MS = 120_000;
const CACHE_MAX = 40;
const recent = new Map<string, { at: number; rows: PinRow[] }>();

export async function fetchMapPins(box: { s: number; w: number; n: number; e: number }, cell: number, filter: PinFilter, limit = 3000): Promise<PinRow[] | 'unknown'> {
  if (!supabase) return 'unknown';
  const args = rpcArgs(box, cell, filter, limit);
  const key = JSON.stringify(args);
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  try {
    const result = await boundedRpc<PinRow[]>(supabase.rpc('map_pins_ar', args));
    const rows = pinsFrom(result);
    if (rows !== 'unknown') {
      recent.delete(key); recent.set(key, { at: Date.now(), rows });
      if (recent.size > CACHE_MAX) recent.delete(recent.keys().next().value as string);
    }
    return rows;
  } catch {
    return 'unknown';
  }
}

/** Which district (or city) most listings in the view sit in — map_view_place_ar(), served by the pin index in a few
 *  ms. null when the read failed or found nothing: the pill then keeps its plain «في هذه المنطقة». */
const placeRecent = new Map<string, { at: number; p: ViewPlace | null }>();
export async function fetchViewPlace(box: { s: number; w: number; n: number; e: number }): Promise<ViewPlace | null> {
  if (!supabase) return null;
  const args = { p_s: box.s, p_w: box.w, p_n: box.n, p_e: box.e };
  const key = [box.s, box.w, box.n, box.e].map((v) => v.toFixed(4)).join(',');
  const hit = placeRecent.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.p;
  try {
    const { data, error } = await boundedRpc<ViewPlace[]>(supabase.rpc('map_view_place_ar', args));
    if (error || !Array.isArray(data)) return null;
    const p = data[0] ?? null;
    placeRecent.delete(key); placeRecent.set(key, { at: Date.now(), p });
    if (placeRecent.size > CACHE_MAX) placeRecent.delete(placeRecent.keys().next().value as string);
    return p;
  } catch {
    return null;
  }
}
