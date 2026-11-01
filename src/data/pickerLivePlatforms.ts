import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import { normalizeSource } from '@/data/loaderPlatforms';

// THE SITE PICKER OFFERS ONLY SITES THAT CAN ANSWER (owner 2026-10-09: «the websites that are down we
// need to hide them — very important»). loader_strip_platforms_ar() = every platform with at least one
// searchable listing that the registry has not marked dormant/retired — 144 of 157 on 2026-10-09; it
// hides the down sites (sadin, toor, nafithh, dwelleo, aqaralsaudia, …) AND an «active» site with zero
// listings (alhumaidan), which the status list alone cannot see. ~0.2 s, so it runs once per session
// (never per search); a failed read is never cached, and until it lands the picker falls back to the
// status list (hiddenPlatformNames) so a down site is hidden either way.
let live: Set<string> | null = null;
let inFlight: Promise<void> | null = null;

/** Picker names that can answer right now, or null while unknown. */
export function livePickerNames(): Set<string> | null {
  return live;
}

export function loadLivePickerNames(): Promise<void> {
  if (live || inFlight) return inFlight ?? Promise.resolve();
  inFlight = (async () => {
    if (!supabase) return;
    try {
      const { data, error } = await boundedRpc<string[]>(supabase.rpc('loader_strip_platforms_ar'));
      if (error || !Array.isArray(data) || data.length === 0) return;
      live = new Set(data.map((slug) => normalizeSource(slug)).filter((n): n is string => !!n));
    } catch {
      // network hiccup: stay unknown, retry next time
    }
  })().finally(() => { inFlight = null; });
  return inFlight;
}

// A healthy site whose whole inventory is rented/sold keeps its logo and stays pickable (owner 2026-10-10:
// «even though they have 0 lets add it as part of the logos and deep search»). Never a DOWN site.
// ponytail: named list — a second empty-but-healthy site is added here by name.
export const OFFERED_WHILE_EMPTY = new Set(['Al Humaidan']);

/** Whether the picker may offer `name`: live list first, the down-status list until it lands. */
export function pickerMayOffer(name: string, liveNames: Set<string> | null, downNames: Set<string> | null): boolean {
  if (OFFERED_WHILE_EMPTY.has(name)) return !downNames?.has(name);
  return liveNames ? liveNames.has(name) : !downNames?.has(name);
}
