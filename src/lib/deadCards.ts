import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import type { Listing } from '@/data/listings';

// A saved chat shows its cards exactly as they were when it was searched (owner 2026-10-18): when it
// is reopened from the history, ask once which of them were REMOVED at their source since, so they can
// be shown as dead — never hidden. Identity = source table + row id (ids repeat across tables).
export const cardKey = (l: Listing): string | null => (l.sourceTable ? `${l.sourceTable}:${l.id}` : null);

export async function fetchGoneKeys(listings: Listing[]): Promise<Set<string>> {
  const keys = [...new Set(listings.map(cardKey).filter((k): k is string => !!k))].slice(0, 600);
  if (!supabase || keys.length === 0) return new Set();
  const { data, error } = await boundedRpc<string[]>(supabase.rpc('listing_keys_gone', { p_keys: keys }));
  // A failed or timed-out check marks nothing dead: a card we could not verify is never labelled removed.
  if (error || !Array.isArray(data)) return new Set();
  return new Set(data as string[]);
}
