// THE SMALL FLOWS, WRITTEN DOWN (owner 2026-11-10: «find all of the implicit state machines … fix everything»).
//
// Each function here is ONE decision a screen used to make with loose booleans and an `await` nobody guarded. They
// are pure and import nothing, so scripts/verify-hidden-flows.ts RUNS them (no source-text matching) and a screen
// cannot quietly decide differently: it calls the function.
//
// The shared rule behind all of them is the repo's own: A FAILED STEP IS NOT A FINISHED STEP. A sign-in that failed
// is not a signed-in user; a page that arrived is not an error; a count that could not be read is not the old count;
// a chat turn that threw is not a turn still running.

// ── 1. Sign in with Google ────────────────────────────────────────────────────────────────────────────────────────
// 'preview' exists only when there is NO backend (the design preview). With a live backend a failure is 'failed' —
// never a made-up account. Before this, a failed Google sign-in fell through to done(fallback) and signed the
// visitor in as «User / user@gmail.com».
export type OAuthOutcome = 'redirected' | 'signed-in' | 'failed' | 'preview';
export function oauthOutcome(r: { redirected?: boolean; user?: unknown; error?: unknown } | null | undefined, backendLive: boolean): OAuthOutcome {
  if (r?.redirected) return 'redirected';
  if (r?.user) return 'signed-in';
  return backendLive ? 'failed' : 'preview';
}

// ── 2. A framed page (the in-app /browser viewer) ─────────────────────────────────────────────────────────────────
// One state instead of `frameLoaded` + `frameError`, which could both be true: the 12 s timer raised the error, the
// page then arrived, and the «couldn't load» cover stayed on top of a page that had loaded.
export type FrameState = 'loading' | 'loaded' | 'error';
export type FrameEvent = 'load' | 'error' | 'timeout' | 'reload';
export function frameNext(s: FrameState, e: FrameEvent): FrameState {
  if (e === 'reload') return 'loading';
  if (e === 'load') return 'loaded';      // a page that arrived always wins, even after the timeout fired
  if (s === 'loaded') return 'loaded';    // a late timer or error never covers a page that is showing
  return 'error';
}

// ── 3. The map's «N listings» pill ────────────────────────────────────────────────────────────────────────────────
// A view whose read FAILED has no known count: null hides the pill. Before this the pill kept the previous view's
// number over the new view.
export function pillCount(rows: ReadonlyArray<{ n: number }> | 'unknown'): number | null {
  if (rows === 'unknown') return null;
  let total = 0;
  for (const r of rows) total += r.n;
  return total;
}

// ── 4. A chat turn that threw ─────────────────────────────────────────────────────────────────────────────────────
// The spinner («status») of THAT turn goes, the failure line is added, and anything already answered stays. A turn
// whose reply already landed keeps its reply (same id, no longer a status) — only the spinner is ever removed.
export function failedTurnMsgs<M extends { id: string; role: string }>(msgs: ReadonlyArray<M>, statusId: string, bubble: M): M[] {
  return msgs.filter((x) => !(x.id === statusId && x.role === 'status')).concat(bubble);
}
// Who may end the turn: only the run that is still the current one, and never one the user already stopped (Stop has
// its own ending). A newer turn's spinner is never released by an older turn's failure.
export function mayFailTurn(run: { cancelled: boolean }, current: unknown): boolean {
  return !run.cancelled && current === run;
}

// ── 5. A shared-chat link whose card could not be read ────────────────────────────────────────────────────────────
// Wait before try number `attempt + 1`, or null = stop asking. Four more tries over ~22 s instead of two over 3 s: a
// link opened on a slow connection used to give up silently and leave the visitor on a plain home page.
const SHARED_CARD_WAITS_MS = [1500, 3000, 6000, 12000] as const;
export function sharedCardRetryMs(attempt: number): number | null {
  return Number.isInteger(attempt) && attempt >= 0 && attempt < SHARED_CARD_WAITS_MS.length ? SHARED_CARD_WAITS_MS[attempt] : null;
}

// ── 6. One at a time ──────────────────────────────────────────────────────────────────────────────────────────────
// A flow that must not run twice at once (a second tap on «Google», the same shared link opened by two effects).
// The latch is ALWAYS released, on success, failure and throw — a guard that can stay shut is a dead button.
export async function oneAtATime<T>(latch: { current: boolean }, fn: () => Promise<T>): Promise<T | undefined> {
  if (latch.current) return undefined;
  latch.current = true;
  try { return await fn(); } finally { latch.current = false; }
}
