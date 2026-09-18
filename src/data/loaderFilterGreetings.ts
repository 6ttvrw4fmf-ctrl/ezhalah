// RUNTIME fetch for the Filter-search bubble greeting rotation. Lives in its own file so
// filterGreetingRotation.ts — which the barrier imports and executes directly — has zero dependency
// on the Supabase client (Metro-only path aliases would otherwise break the barrier's plain-Node
// run). See loaderActivePlatforms.ts for the identical precedent. Owner rule 2026-09-18.

import { supabase } from '@/lib/supabase';
import { setFilterGreetingsCache, hasFilterGreetingsCache, type FilterGreeting } from '@/data/filterGreetingRotation';

let inFlight: Promise<void> | null = null;

async function load(): Promise<void> {
  if (!supabase) { setFilterGreetingsCache([]); return; }
  try {
    const { data, error } = await supabase.rpc('ui_filter_greetings_ar');
    setFilterGreetingsCache(
      !error && Array.isArray(data) && data.length
        ? (data as FilterGreeting[]).filter((g) => g && g.greeting && g.emoji)
        : [],
    );
  } catch {
    setFilterGreetingsCache([]);
  }
}

/**
 * Kicks off the (lazy, once-per-app-lifetime) fetch of the greeting-rotation pool. Fire-and-forget
 * and idempotent — safe to call from anywhere, any number of times; only the very first call
 * actually starts a request. Until it resolves, `pickFilterGreetingOpening()` (filterGreetingRotation.ts)
 * returns the pre-rotation fallback, so the very first Filter search of a session is the only one
 * that can show it — every search after this resolves reads the live rotation.
 */
export function primeFilterGreetings(): void {
  if (hasFilterGreetingsCache() || inFlight) return;
  inFlight = load().finally(() => { inFlight = null; });
}
