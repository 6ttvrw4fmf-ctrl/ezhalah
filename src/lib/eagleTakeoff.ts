// The eagle that takes off from the falconer's hand (owner 2026-10-26): «show it occasionally when users open a new
// Ezhalah session; do not replay it when users refresh the page». A refresh keeps sessionStorage, so the session
// mark stops a replay; a new session plays only if the last take-off was long enough ago, so it stays occasional.
const SESSION_KEY = 'ez:eagleTakeoff:session:v1';
const LAST_KEY = 'ez:eagleTakeoff:last:v1';
/** At most one take-off per this long, however many sessions are opened. */
export const TAKEOFF_GAP_MS = 6 * 60 * 60 * 1000;
/** The animation's own length (assets/images/falcon-takeoff.svg runs 2.8 s), plus a little room. */
export const TAKEOFF_MS = 3000;

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const local = (): Store | null => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };
const session = (): Store | null => { try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; } };

/** Decide ONCE per session whether the eagle takes off. Marks the session either way, so a refresh or a second
 *  home view in the same tab never plays it; records the time when it does play. No storage → never plays. */
export function takeEagleTakeoff(now = Date.now(), s: Store | null = session(), l: Store | null = local()): boolean {
  try {
    if (!s || !l) return false;
    if (s.getItem(SESSION_KEY)) return false;
    s.setItem(SESSION_KEY, '1');
    const last = Number(l.getItem(LAST_KEY) ?? '');
    if (Number.isFinite(last) && last > 0 && now - last < TAKEOFF_GAP_MS) return false;
    l.setItem(LAST_KEY, String(now));
    return true;
  } catch { return false; }
}
