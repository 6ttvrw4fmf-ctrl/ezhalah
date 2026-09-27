// RUNTIME truth source for the search-loading strip (SearchLoader.tsx). Lives in its own file so
// `loaderPlatforms.ts` — which the barrier reads directly — has zero dependency on the Supabase
// client (Metro-only path aliases would otherwise break the barrier's plain-Node run).
//
// See loaderPlatforms.ts and scripts/verify-loader-platforms-match-active.ts for the full contract.
// Owner rule 2026-08-29.

import { supabase } from '@/lib/supabase';
import { normalizeSource } from '@/data/loaderPlatforms';
import { boundedRpc } from '@/data/boundedRpc';

/**
 * Calls the `loader_strip_platforms_ar()` RPC — the platforms with rows in the index MINUS the ones
 * whose website is down on its side (platform_registry 'dormant'/'retired', owner rule 2026-09-26:
 * a down site's logo leaves the strip and the «Reviewing N platforms» count drops with it; both come
 * back on their own when the site does). Maps each raw platform value (`aqar`, `wasalt`, …) to its
 * canonical loader name via SOURCE_TOKENS. Returns a Set of names on success, or null on any failure
 * (network, RPC missing, RLS refusal). The caller falls back to the full PLATFORM_META on null — safe
 * degradation, never silently smaller than reality.
 */
export async function fetchActivePlatformNames(): Promise<Set<string> | null> {
  if (!supabase) return null;
  try {
    // Bounded: an unbounded await here never returns, and the loader waits forever (#269).
    const { data, error } = await boundedRpc<string[]>(supabase.rpc('loader_strip_platforms_ar'));
    if (error || !Array.isArray(data)) return null;
    const names = new Set<string>();
    for (const raw of data as string[]) {
      const n = normalizeSource(raw);
      if (n) names.add(n);
    }
    return names.size ? names : null;
  } catch {
    return null;
  }
}
