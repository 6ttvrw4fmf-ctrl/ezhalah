// THE LAUNCH-TIME SESSION RESTORE, AS A UNIT THAT CAN BE EXECUTED AGAINST AN INJECTED FAILURE.
//
// `authChecked` is a GATE, not a nicety. src/store.tsx reads `if (!authChecked) return` in the local
// history restore, the server pull, the sign-in card, the cookie-consent banner and the intro. So a
// session restore that never settles does not degrade one feature — it parks the app in a FOURTH
// state no gate in that file expects, `user === null && authChecked === false`, which renders as a
// guest while withholding every affordance a guest is supposed to get, and emits no error at all.
//
// WHY THIS IS A SEPARATE UNIT rather than a few lines inside the effect: AGENTS.md ("A FAILED FETCH
// IS NOT AN EMPTY ANSWER") requires a barrier for this class to EXECUTE the code against a client
// that fails the way the real one does, not to grep the line. Five defects of that class each had a
// source-TEXT tripwire over the exact line and every one of those tripwires passed for the whole
// time the defect was live. A `useEffect` body cannot be lifted and run; this can.
//
// ── THE MEASUREMENT THIS EXISTS FOR (routine #6, 2026-09-27, production, Chromium 1440x900) ──
//
// `supabase.auth.getSession()` is NOT the local-only read its name suggests. On an EXPIRED session
// @supabase/auth-js's __loadSession() calls _callRefreshToken over the NETWORK — the identical
// hazard src/components/GoogleOneTap.tsx already bounds for getUser() ("the refresh with backoff, so
// it can take many seconds or never settle", measured live 2026-08-18). That comment was written two
// files away, about the same auth client, and this sibling call was never given the same treatment.
//
// Reproduced 2/2 in fresh browser contexts per arm, oracle = [data-testid="cookie-consent"] and
// [data-testid="signin-card"] (both gated on `authChecked && !user`), against a true-guest control
// that renders BOTH — same served bundle, one variable changed:
//
//   arm            stored session                     t=20s   t=40s   t=75s
//   A (control)    none at all                        1/1     —       —
//   E (control)    expired, refresh REJECTED by       1/1     —       —      ← recovers correctly
//                  the server (a clean AuthError)
//   C              expired, refresh_token: ''         0/0     0/0     0/0    ← PERMANENT
//   D              expired, refresh request FAILS     0/0     0/0     1/1    ← >40s dead, self-heals
//                  (offline / captive portal /
//                   blocking extension / 5xx)
//
// C is permanent because _isValidSession() tests key PRESENCE only, so the session passes as valid;
// _callRefreshToken('') then THROWS AuthSessionMissingError *before* the try/catch that converts
// errors into `{ error }`, and neither __loadSession nor _useSession carries a catch — so
// getSession() REJECTS. The un-caught `.then()` never ran, 3 uncaught page errors per load, and
// nothing else in the app ever flips the gate. D self-heals because auth-js retries while
// `now + nextBackoff - startedAt` still fits in AUTO_REFRESH_TICK_DURATION_MS (30_000, backoff
// 200*2^(n-1)) — after >40 s of a dead-looking app with ZERO error signal.
//
// So a catch alone does not fix this (arm D never rejects) and a timeout alone does not either
// (arm C rejects). Both are required, which is why they live here together.

/** How long the restore may hold the gate closed. */
export const GETSESSION_TIMEOUT_MS = 6000;

type MaybeUser = { app_metadata?: { provider?: string } } | null | undefined;
type GetSession = () => Promise<{ data: { session?: { user?: MaybeUser } | null } }>;

export type SessionRestoreDeps = {
  getSession: GetSession;
  /** Called at most once, and only with a real user. */
  onUser: (su: NonNullable<MaybeUser>) => void;
  /** Called EXACTLY once, on every path: success, empty, rejection, timeout. */
  onChecked: () => void;
  timeoutMs?: number;
  /** Injectable so a barrier can drive the clock instead of sleeping. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
};

/**
 * Begin the restore. Returns a cancel function for the effect's cleanup.
 *
 * THE SAFE DIRECTION IS "SIGNED OUT", exactly as GoogleOneTap chose for the same reason: flipping
 * the gate early is safe and SELF-CORRECTING. store.tsx keeps its onAuthStateChange subscription, so
 * a refresh that lands late fires TOKEN_REFRESHED and setUser(), and both the history-restore and
 * server-pull effects key on [authChecked, user] and re-run for the account that arrives. The push
 * effect cannot write anything meanwhile (`if (!user) return`), so an early flip can never overwrite
 * or delete a server copy.
 *
 * WHY 6s: the healthy path costs no network at all (an unexpired session returns straight from
 * storage in ms), so nothing normal waits on this; a successful refresh is well under 6s, which
 * keeps the flash the gate exists to prevent (a returning signed-in user seeing the guest state) out
 * of every non-pathological load, while capping the dead window at a fifth of auth-js's own 30s
 * retry ceiling. Past that the refresh is already pathological and showing the guest state is the
 * honest answer — never the indefinite blank that withholds both.
 */
export function beginSessionRestore(deps: SessionRestoreDeps): () => void {
  const timeoutMs = deps.timeoutMs ?? GETSESSION_TIMEOUT_MS;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let cancelled = false;
  let settled = false;

  // ONE settle path for all four outcomes, so "onChecked fires exactly once" is a property of this
  // function rather than of whoever remembers to add it to a new branch.
  const settle = (su: MaybeUser) => {
    if (cancelled || settled) return;
    settled = true;
    clearTimer(handle);
    if (su) deps.onUser(su);
    deps.onChecked();
  };

  const handle = setTimer(() => settle(null), timeoutMs);

  deps.getSession()
    .then((r) => settle(r?.data?.session?.user ?? null))
    .catch(() => settle(null));   // a REJECTED getSession() is not an empty answer — but it IS settled

  return () => {
    cancelled = true;
    clearTimer(handle);
  };
}
