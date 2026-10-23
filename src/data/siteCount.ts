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

// REMEMBERED ON THE DEVICE (owner 2026-10-23: «the Arabic share message doesn't show 148»). Measured on a fresh
// phone load: the count lands ~4 s after the page opens (it waits for the app bundle, not the database — the
// RPC itself is ~0.3 s), so a Share tapped sooner said «كل المواقع». The last count this device READ is kept
// for COUNT_KEEP_MS and used at once; a fresh read still runs and replaces it. Older than that → unknown, so
// a number is never shown from a stale guess. The count moves by a site at most every few days.
export const SITE_COUNT_KEY = 'ezhalah:siteCount';
export const COUNT_KEEP_MS = 6 * 60 * 60 * 1000;
/** The remembered count if it is a real count and young enough, else null. Pure (barrier-executed). */
export function rememberedCount(raw: string | null | undefined, nowMs: number): number | null {
  try {
    const v = raw ? JSON.parse(raw) : null;
    const n = v?.n, at = v?.at;
    if (!Number.isInteger(n) || n <= 0 || !Number.isFinite(at) || at > nowMs || nowMs - at > COUNT_KEEP_MS) return null;
    return n;
  } catch { return null; }
}
try { known = rememberedCount(globalThis.localStorage?.getItem(SITE_COUNT_KEY), Date.now()); } catch { /* storage off */ }

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
let fresh = false; // a remembered count is used at once but still refreshed once per session
export function loadSiteCount(): Promise<number | null> {
  if (known !== null && fresh) return Promise.resolve(known);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (!supabase) return null;
    try {
      const { data, error } = await boundedRpc<string[]>(supabase.rpc('loader_active_platforms_ar'), SITE_COUNT_MS);
      const n = error ? null : sitesFromSlugs(data);
      if (n !== null) {
        known = n; fresh = true;
        try { globalThis.localStorage?.setItem(SITE_COUNT_KEY, JSON.stringify({ n, at: Date.now() })); } catch { /* per-device nicety */ }
      }
      return n ?? known;
    } catch { return null; } finally { inFlight = null; }
  })();
  return inFlight;
}
