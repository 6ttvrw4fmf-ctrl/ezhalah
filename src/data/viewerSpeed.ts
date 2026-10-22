// WHICH IN-APP SITES ARE MEASURED SLOW (owner 2026-10-21: «if it's very slowly … show this open a new window …
// create an agent that tracks the time»).
//
// e2e/viewer/speed-live.mjs (every 6 h and after every deploy) frames each in-app site on a phone over throttled 4G
// and writes its median time-to-show into public.viewer_site_speed. A site over SLOW_SITE_MS in the last 2 days is
// "known slow": its ad opens with the «open in a new window» button already showing, instead of after a wait.
//
// ONE bounded read per visit, shared by every tab. If it fails or times out the answer is `null` — «not known» —
// and the viewer falls back to its own timer (SLOW_HINT_MS), so a failed read can only make the button come a
// little later, never hide it and never claim a site is fast.
import { supabase } from '@/lib/supabase';
import { boundedRpc } from '@/data/boundedRpc';

export const SLOW_SITE_MS = 5_000;
const FRESH_MS = 2 * 24 * 3600_000;

let pending: Promise<Set<string> | null> | null = null;

export function fetchSlowHosts(): Promise<Set<string> | null> {
  if (!supabase) return Promise.resolve(null);
  if (!pending) {
    const since = new Date(Date.now() - FRESH_MS).toISOString();
    pending = boundedRpc<{ host: string }[]>(
      supabase.from('viewer_site_speed').select('host').gt('median_ms', SLOW_SITE_MS).gte('measured_at', since),
      8_000,
    ).then(({ data, error }) => {
      if (error || !data) { pending = null; return null; }      // not known — the next tab may try again
      return new Set(data.map((r) => String(r.host).toLowerCase()));
    });
  }
  return pending;
}
