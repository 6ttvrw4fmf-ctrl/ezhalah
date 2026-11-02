// THE PINS INSIDE THE VISIBLE MAP (owner 2026-11-02): one bounded read of map_pins_ar() per view change, never the
// whole index. Exact points from city zoom inward (every listing on identical coordinates folded into one row with
// its count and ids), count cells when zoomed out. The pure rules — colours, the price head, the zoom→cell rule,
// the RPC arguments — live in src/lib/mapPins.ts so the barrier can execute them.
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import { pinsFrom, rpcArgs, type PinFilter, type PinRow } from '@/lib/mapPins';

export { cellForSpan, fineCellForSpan, PIN_LIMIT, PIN_SHOW_MAX, paddedBox, pinColor, dotColor, pinHead, bubbleText, polygonOf, idsByTable, orderLike, type PinFilter, type PinRow } from '@/lib/mapPins';

/** The pins (or count cells) for one view. 'unknown' when the fetch failed — the caller keeps what it has. */
export async function fetchMapPins(box: { s: number; w: number; n: number; e: number }, cell: number, filter: PinFilter, limit = 3000): Promise<PinRow[] | 'unknown'> {
  if (!supabase) return 'unknown';
  try {
    const result = await boundedRpc<PinRow[]>(supabase.rpc('map_pins_ar', rpcArgs(box, cell, filter, limit)));
    return pinsFrom(result);
  } catch {
    return 'unknown';
  }
}
