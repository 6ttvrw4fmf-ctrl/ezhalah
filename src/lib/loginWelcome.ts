// THE MOMENT OF SIGN-IN, for the Filter home's welcome line (owner 2026-10-22: «whenever the user logs in
// or signs up, this message appears»). Marked where a sign-in really completes, never on a session
// restore when a page loads:
//   • the OAuth landing route (src/app/auth.tsx) — Google and Apple redirect there, and only there,
//     after a sign-in or sign-up;
//   • Google One Tap (src/components/GoogleOneTap.tsx) once its id token is exchanged for a session.
// The home reads the mark when the signed-in user is known (lib/useFilterWelcome.ts): at mount when the
// session is already stored, otherwise the moment the store adopts the user. One Tap also fires an event
// because the home is already on screen then.
// Per-device convenience only: a blocked store just means no welcome, never a crash.

export const JUST_SIGNED_IN_KEY = 'ezhalah:justSignedIn:v1';
export const SIGNED_IN_EVENT = 'ezhalah:signed-in';
const COUNT_KEY = 'ezhalah:signInCount:v1';
/** A mark older than this is a sign-in the home never got to show (closed tab, cancelled OAuth): ignored. */
export const JUST_SIGNED_IN_MAX_MS = 10 * 60 * 1000;

export function markJustSignedIn(): void {
  try {
    const ls = globalThis.localStorage;
    const n = Number.parseInt(ls?.getItem(COUNT_KEY) ?? '0', 10);
    const count = Number.isFinite(n) && n >= 0 ? n : 0;
    ls?.setItem(COUNT_KEY, String(count + 1));
    ls?.setItem(JUST_SIGNED_IN_KEY, JSON.stringify({ at: Date.now(), count }));
  } catch { /* no store: no welcome */ }
  try { globalThis.dispatchEvent?.(new Event(SIGNED_IN_EVENT)); } catch { /* not a browser */ }
}

/** Is there a fresh mark? (Does not clear it.) */
export function hasJustSignedIn(now: number): boolean {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(JUST_SIGNED_IN_KEY) ?? 'null');
    const at = Number(v?.at);
    return Number.isFinite(at) && now - at >= 0 && now - at <= JUST_SIGNED_IN_MAX_MS;
  } catch { return false; }
}

/** Read AND clear the mark, so one sign-in shows its welcome once. null when there is none or it is stale. */
export function takeJustSignedIn(now: number): { count: number } | null {
  try {
    const ls = globalThis.localStorage;
    const raw = ls?.getItem(JUST_SIGNED_IN_KEY);
    if (!raw) return null;
    ls?.removeItem(JUST_SIGNED_IN_KEY);
    const v = JSON.parse(raw);
    const at = Number(v?.at);
    if (!Number.isFinite(at) || now - at < 0 || now - at > JUST_SIGNED_IN_MAX_MS) return null;
    return { count: Number(v?.count) || 0 };
  } catch { return null; }
}

// SIGN-UP, NOT LOG-IN (owner 2026-10-23): the «وش نناديك؟» box and its party are for the sign-in that
// CREATED the account — created within the last 10 minutes and still on its first sign-in (a returning
// user's last_sign_in_at moves past created_at). A returning Google/Apple user keeps today's welcome only.
export const SIGN_UP_WINDOW_MS = 10 * 60 * 1000;
export function isFreshSignUp(createdAt: unknown, lastSignInAt: unknown, now: number): boolean {
  const c = Date.parse(String(createdAt ?? ''));
  const l = Date.parse(String(lastSignInAt ?? ''));
  if (!Number.isFinite(c) || !Number.isFinite(l)) return false;
  return now - c >= 0 && now - c <= SIGN_UP_WINDOW_MS && Math.abs(l - c) <= 60_000;
}
