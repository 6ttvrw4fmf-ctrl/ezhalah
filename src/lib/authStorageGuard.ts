// DROP A STORED SESSION THAT CAN NEVER BE REFRESHED, BEFORE THE AUTH CLIENT READS IT.
//
// Sentry REACT-NATIVE-A / -B ("AuthSessionMissingError: Auth session missing!", 14 + 7 users, 112
// events, still firing 2026-10-04). A stored session that is expired AND has an empty/missing
// refresh_token passes auth-js's _isValidSession() (it tests key presence only), then
// _callRefreshToken('') THROWS AuthSessionMissingError. getSession() is already bounded and caught
// (src/lib/sessionRestore.ts), but the SAME throw also happens inside onAuthStateChange's
// _emitInitialSession, whose promise nothing can reach: it surfaces as an unhandled rejection on every
// page load. The only place to stop it is before the client initialises: such a session can never
// become valid again (nothing to refresh with), so removing it signs the user out of a session that
// was already dead — it cannot sign out anyone who was actually signed in.

const KEY_RE = /^sb-.+-auth-token$/;
/** auth-js treats a token expiring within this many seconds as expired (EXPIRY_MARGIN). */
const EXPIRY_MARGIN_S = 90;

type StorageLike = {
  length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
  removeItem(k: string): void;
};

/** True when `raw` is a stored session that auth-js would try (and fail) to refresh. */
export function isUnrefreshableSession(raw: string | null, nowS: number): boolean {
  if (!raw) return false;
  let s: unknown;
  try { s = JSON.parse(raw); } catch { return false; }   // unparseable: auth-js already handles it
  if (!s || typeof s !== 'object') return false;
  const o = s as { refresh_token?: unknown; expires_at?: unknown };
  const hasRefresh = typeof o.refresh_token === 'string' && o.refresh_token.length > 0;
  if (hasRefresh) return false;
  const exp = typeof o.expires_at === 'number' ? o.expires_at : 0;
  return exp <= nowS + EXPIRY_MARGIN_S;   // still-valid access tokens are left alone
}

/** Removes every unrefreshable stored auth session. Returns the keys removed. Never throws. */
export function dropUnrefreshableStoredSessions(storage: StorageLike | null | undefined, nowS = Math.floor(Date.now() / 1000)): string[] {
  const removed: string[] = [];
  try {
    if (!storage) return removed;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && KEY_RE.test(k)) keys.push(k);
    }
    for (const k of keys) {
      if (isUnrefreshableSession(storage.getItem(k), nowS)) { storage.removeItem(k); removed.push(k); }
    }
  } catch { /* storage blocked (private mode): nothing to clean, and nothing was readable by auth-js either */ }
  return removed;
}
