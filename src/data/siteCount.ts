// ONE SITE COUNT FOR EVERYTHING A USER READS (owner 2026-10-20: «the message says 146 but when I send
// it says 148 — confusing»). The WhatsApp card (middleware.ts / api/share-card.ts) counts the sites
// with searchable listings — loader_active_platforms_ar(), one per PLATFORM (aqarmonthly folds into
// Aqar, src/data/loaderPlatforms.ts SOURCE_TOKENS) — and the share sentence counted the logo catalog
// minus the registry's dormant sites instead. Two truths, two numbers, side by side on one screen.
// Everything a user reads now takes THIS count: the share sentence and the Filter home's welcome line.
//
// Loaded once per session, bounded; a failed read stays null (never a zero, never a typed number) and
// the next call retries. Sync getter for tap handlers (navigator.share must run inside the gesture,
// so nothing may be awaited there) — the load is kicked off at app start by src/lib/share.ts.
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';
import { normalizeSource } from '@/data/loaderPlatforms';

const SITE_COUNT_MS = 6000;
let known: number | null = null;
let inFlight: Promise<number | null> | null = null;

/** The number of platforms behind a list of source slugs — the same fold the card and the logo strip use. */
export function sitesFromSlugs(slugs: unknown): number | null {
  if (!Array.isArray(slugs) || slugs.length === 0 || !slugs.every((s) => typeof s === 'string')) return null;
  const names = new Set<string>();
  for (const s of slugs as string[]) names.add(normalizeSource(s) ?? s);
  return names.size > 0 ? names.size : null;
}

/** The count as last read, or null while unknown. */
export function siteCountNow(): number | null { return known; }

/** Reads loader_active_platforms_ar() once per session; a failure is not cached. */
export function loadSiteCount(): Promise<number | null> {
  if (known !== null) return Promise.resolve(known);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (!supabase) return null;
    try {
      const { data, error } = await boundedRpc<string[]>(supabase.rpc('loader_active_platforms_ar'), SITE_COUNT_MS);
      const n = error ? null : sitesFromSlugs(data);
      if (n !== null) known = n;
      return n;
    } catch { return null; } finally { inFlight = null; }
  })();
  return inFlight;
}
