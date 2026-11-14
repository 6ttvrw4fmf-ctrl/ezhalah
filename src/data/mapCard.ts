// The map card's one read (src/lib/mapCard.ts decides what it says): map_view_card_ar() for EXACTLY the box the pill's
// facts were read over (postedCountArgs — the same arguments), or for a named district (all its ads). null when the read
// failed — the card then says it could not load, never «0». Bounded, cached briefly, one read per view.
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import { reportError, reportMessage } from '@/lib/observability';
import { postedCountArgs, type PinFilter } from '@/lib/mapPins';
import { parseMapCard, type MapCard } from '@/lib/mapCard';

export type CardTarget =
  | { kind: 'box'; box: { s: number; w: number; n: number; e: number }; filter: PinFilter }
  | { kind: 'district'; city: string; district: string; deals: string[] };

const CACHE_MS = 120_000;
const recent = new Map<string, { at: number; c: MapCard | 'locked' }>();
const inflight = new Map<string, Promise<MapCard | 'locked' | null>>();

/** `priceType`: the type the user tapped on the card (null = the card picks the most common one). The card counts
 *  EXACTLY the pins the map shows, «نشر خلال» included (owner 2026-11-14: «it should strictly follow what the user selected»). */
export function cardArgs(t: CardTarget, priceType: string | null = null): Record<string, unknown> {
  const base = t.kind === 'box'
    ? { ...postedCountArgs(t.box, t.filter), ...(t.filter.postedWithinDays != null ? { p_posted_within_days: t.filter.postedWithinDays } : {}) }
    : { p_deals: t.deals, p_city: t.city, p_district: t.district };
  return priceType ? { ...base, p_price_type: priceType } : base;
}

export function fetchMapCard(t: CardTarget, signedIn: boolean, priceType: string | null = null): Promise<MapCard | 'locked' | null> {
  if (!supabase) return Promise.resolve(null);
  const args = cardArgs(t, priceType);
  const key = `${signedIn ? 'u' : 'g'}|${JSON.stringify(args)}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.c);
  const out = inflight.get(key);
  if (out) return out;
  const p = (async () => {
    if (!supabase) return null;
    try {
      const result = await boundedRpc<unknown>(supabase.rpc('map_view_card_ar', args));
      const { error } = result as { error: unknown };
      if (error) { reportMessage('map_view_card_ar failed (map card says it could not load)', { error: String((error as { message?: string }).message ?? error) }); return null; }
      const c = parseMapCard(result as { data: unknown; error: unknown });
      if (c) { recent.set(key, { at: Date.now(), c }); if (recent.size > 20) recent.delete(recent.keys().next().value as string); }
      return c;
    } catch (e) {
      reportError(e, { where: 'map card (map_view_card_ar)' });
      return null;
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
