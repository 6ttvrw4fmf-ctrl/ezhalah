// RUNTIME truth source for the search-loading strip (SearchLoader.tsx). Lives in its own file so
// `loaderPlatforms.ts` — which the barriers import directly — has zero dependency on the Supabase
// client (Metro-only path aliases would otherwise break a plain-Node run).
//
// See loaderPlatforms.ts (hiddenLoaderNames) and scripts/verify-loader-hides-down-sites.ts.

import { supabase } from '@/lib/supabase';
import { hiddenLoaderNames } from '@/data/loaderPlatforms';
import { boundedRpc } from '@/data/boundedRpc';

// Websites down on their side (owner rule 2026-09-26): their logos leave the strip and the
// «Reviewing N platforms» count drops. Read ONCE per app session, never per search — the per-search
// loader_active_platforms_ar() round trip cost 0.4-3.7 s and was removed on 2026-09-21. null = not
// known (not loaded yet, or the read failed): the strip then shows the full catalog, never a guess.
type StatusRow = { platform: string; status: string };
let hidden: Set<string> | null = null;
let inFlight: Promise<void> | null = null;

/** The logos to hide, or null while unknown. Synchronous so a search's roster can freeze at mount. */
export function hiddenPlatformNames(): Set<string> | null {
  return hidden;
}

/**
 * Loads the registry statuses via `loader_platform_status_ar()`. After one success it never calls
 * again this session; after a failure the next call retries (a failed read is never cached as "none").
 */
export function loadHiddenPlatformNames(): Promise<void> {
  if (hidden || inFlight) return inFlight ?? Promise.resolve();
  inFlight = (async () => {
    if (!supabase) return;
    try {
      // Bounded: an unbounded await here never returns (#269).
      const { data, error } = await boundedRpc<StatusRow[]>(supabase.rpc('loader_platform_status_ar'));
      // An empty registry is a failure, not "every site is up".
      if (error || !Array.isArray(data) || data.length === 0) return;
      hidden = hiddenLoaderNames(data);
    } catch {
      // stays null → full catalog
    }
  })().finally(() => { inFlight = null; });
  return inFlight;
}
