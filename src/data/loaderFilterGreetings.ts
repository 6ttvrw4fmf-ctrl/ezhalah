// RUNTIME fetch for the Filter-search bubble greeting rotation. Lives in its own file so
// filterGreetingRotation.ts — which the barrier imports and executes directly — has zero dependency
// on the Supabase client (Metro-only path aliases would otherwise break the barrier's plain-Node
// run). See loaderActivePlatforms.ts for the identical precedent. Owner rule 2026-09-18.

import { supabase } from '@/lib/supabase';
import { setFilterGreetingsCache, hasFilterGreetingsCache, type FilterGreeting } from '@/data/filterGreetingRotation';

let inFlight: Promise<void> | null = null;

// Every RPC await in this codebase must be bounded (AGENTS.md "A FAILED FETCH IS NOT AN EMPTY
// ANSWER" — an unbounded await leaves the caller hanging forever on a stalled connection, which
// reaches the user as a silent hang, never an error). This is the SAME timeout-via-AbortController
// mechanism src/data/locations.ts already uses (`.abortSignal(ctrl.signal)`), applied locally here
// rather than exporting remote.ts's private bounded() into a shared surface for one call site.
const RPC_TIMEOUT_MS = 15000; // matches remote.ts's RPC_TIMEOUT_MS default

async function load(): Promise<void> {
  if (!supabase) { setFilterGreetingsCache([]); return; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
  try {
    const { data, error } = await supabase.rpc('ui_filter_greetings_ar').abortSignal(ctrl.signal);
    setFilterGreetingsCache(
      !error && Array.isArray(data) && data.length
        ? (data as FilterGreeting[]).filter((g) => g && g.greeting && g.emoji)
        : [],
    );
  } catch {
    setFilterGreetingsCache([]);
  } finally {
    clearTimeout(timer);
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
