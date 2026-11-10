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
// The 12 s clock counts only while a page is really on its way: the ad has been found AND its frame is on screen.
// Before this the clock started with the ad LOOKUP, so a slow lookup spent the page's time and the «couldn't load»
// cover came up over a page that had only just started.
export function frameTimerRuns(s: FrameState, frameOnScreen: boolean): boolean {
  return s === 'loading' && frameOnScreen;
}

// ── 3. The map's «N listings» pill ────────────────────────────────────────────────────────────────────────────────
// A view whose read FAILED has no known count: 'failed' swaps the pill for «couldn't load — try again». Before this
// the pill kept the previous view's number over the new view (and, for a while, just vanished with no way to retry).
export type PillCount = number | 'failed';
export function pillCount(rows: ReadonlyArray<{ n: number }> | 'unknown'): PillCount {
  if (rows === 'unknown') return 'failed';
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

// A refinement that never LANDED (it threw, or the user stopped it before any result) leaves no mark on the turn it
// started from: that turn's «round done» receipt goes, so its buttons come back and the round can be opened again.
export function withoutReceipt<R>(receipts: Readonly<Record<string, R>>, msgId: string): Record<string, R> {
  if (!(msgId in receipts)) return receipts as Record<string, R>;
  const next: Record<string, R> = { ...receipts };
  delete next[msgId];
  return next;
}

// ── 5. A shared-chat link whose card could not be read ────────────────────────────────────────────────────────────
// Wait before try number `attempt + 1`, or null = stop asking. Four more tries over ~22 s instead of two over 3 s: a
// link opened on a slow connection used to give up silently and leave the visitor on a plain home page.
const SHARED_CARD_WAITS_MS = [1500, 3000, 6000, 12000] as const;
export function sharedCardRetryMs(attempt: number): number | null {
  return Number.isInteger(attempt) && attempt >= 0 && attempt < SHARED_CARD_WAITS_MS.length ? SHARED_CARD_WAITS_MS[attempt] : null;
}
// After the last try the visitor is TOLD and offered «try again» — never a plain home page with no word.
export function sharedCardGaveUp(attempt: number): boolean {
  return sharedCardRetryMs(attempt) === null;
}
// What opening a shared chat does once its conversation has been asked for. A conversation that could not be READ is
// not a missing conversation: with a search in the link the search still opens (the owner's «never a dead tap»);
// with none there is nothing to open, so the visitor gets «couldn't open — try again» instead of a silent home page.
export type SharedChatNext = 'open-chat' | 'open-search' | 'retry-card' | 'stay';
export function afterSharedChatRead(read: 'ok' | 'absent' | 'failed', hasSearch: boolean): SharedChatNext {
  if (read === 'ok') return 'open-chat';
  if (hasSearch) return 'open-search';
  return read === 'failed' ? 'retry-card' : 'stay';
}

// ── 6. One at a time ──────────────────────────────────────────────────────────────────────────────────────────────
// A flow that must not run twice at once (a second tap on «Google», the same shared link opened by two effects).
// The latch is ALWAYS released, on success, failure and throw — a guard that can stay shut is a dead button.
export async function oneAtATime<T>(latch: { current: boolean }, fn: () => Promise<T>): Promise<T | undefined> {
  if (latch.current) return undefined;
  latch.current = true;
  try { return await fn(); } finally { latch.current = false; }
}
