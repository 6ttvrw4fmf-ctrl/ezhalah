// The map pill's second line (src/lib/mapViewFacts.ts decides what may be said): one bounded read of
// map_view_facts_ar() for exactly the box and choices the pill's count uses (postedCountArgs, the «نشر خلال» menu's
// arguments). null when the read failed — the line then stays hidden, never «0».
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import { reportMessage } from '@/lib/observability';
import { postedCountArgs, type PinFilter } from '@/lib/mapPins';
import { parseViewFacts, type ViewFacts } from '@/lib/mapViewFacts';

const CACHE_MS = 120_000;
const CACHE_MAX = 40;
const recent = new Map<string, { at: number; f: ViewFacts }>();

export async function fetchViewFacts(box: { s: number; w: number; n: number; e: number }, filter: PinFilter, signedIn: boolean): Promise<ViewFacts | null> {
  if (!supabase) return null;
  const args = postedCountArgs(box, filter);
  const key = `${signedIn ? 'u' : 'g'}|${JSON.stringify(args)}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.f;
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
  } catch {
    return null;
  }
}
