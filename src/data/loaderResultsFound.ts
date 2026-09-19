// RUNTIME fetch for the Results-Found rotation pool. Lives in its own file so
// resultsFoundRotation.ts — which the barrier imports and executes directly — has zero dependency
// on the Supabase client (Metro-only path aliases would otherwise break the barrier's plain-Node
// run). Same split-and-mirror precedent as loaderFilterGreetings.ts / filterGreetingRotation.ts
// (owner rule 2026-09-18/19).

import { supabase } from '@/lib/supabase';
import { setResultsFoundCache, type ResultsFoundTemplate } from '@/data/resultsFoundRotation';

let inFlight: Promise<void> | null = null;

// Every RPC await in this codebase must be bounded (AGENTS.md "A FAILED FETCH IS NOT AN EMPTY
// ANSWER"). Same 15 s local AbortController pattern loaderFilterGreetings.ts already uses.
const RPC_TIMEOUT_MS = 15000;

async function load(): Promise<void> {
  if (!supabase) { setResultsFoundCache([]); return; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
  try {
    const { data, error } = await supabase.rpc('ui_results_found_ar').abortSignal(ctrl.signal);
    if (error || !Array.isArray(data)) { setResultsFoundCache([]); return; }
    // Server rows arrive as { lang, has_name, template } — normalise to the app's camelCase shape
    // BEFORE handing to setResultsFoundCache, so the picker never has to know the wire format.
    const rows: ResultsFoundTemplate[] = (data as Array<{ lang: 'ar' | 'en'; has_name: boolean; template: string }>)
      .filter((r) => r && r.template && (r.lang === 'ar' || r.lang === 'en'))
      .map((r) => ({ lang: r.lang, hasName: !!r.has_name, template: r.template }));
    setResultsFoundCache(rows);
  } catch {
    setResultsFoundCache([]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kicks off the (lazy, once-per-app-lifetime) fetch of the Results-Found rotation pool. Fire-and-
 * forget and idempotent — safe to call from anywhere, any number of times; only the very first
 * call actually starts a request. Until this resolves, the picker still rotates on the BAKED pool,
 * so a slow fetch never regresses to the retired «لقينا {n} إعلان يطابق طلبك.» wording.
 */
export function primeResultsFound(): void {
  if (inFlight) return;
  inFlight = load().finally(() => { inFlight = null; });
}
